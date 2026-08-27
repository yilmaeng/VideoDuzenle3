const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const extractZip = require('extract-zip');

const RUNTIME_VERSION = 'v1.9.2';
const RUNTIME_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${RUNTIME_VERSION}/whisper-bin-x64.zip`;
const RUNTIME_SHA256 = '49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a';
const MODELS = {
    'Xenova/whisper-tiny': { file: 'ggml-tiny-q5_1.bin', size: 32200000 },
    'Xenova/whisper-base': { file: 'ggml-base-q5_1.bin', size: 59700000 },
    'Xenova/whisper-small': { file: 'ggml-small-q5_1.bin', size: 190000000 }
};

function sha256(filePath) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
}

async function downloadFile(url, destination, onProgress, range = [0, 100]) {
    const partial = `${destination}.part`;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`whisper_download_http_${response.status}`);
    const total = Number(response.headers.get('content-length')) || 0;
    const output = fs.createWriteStream(partial);
    const reader = response.body.getReader();
    let received = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = Buffer.from(value);
            received += chunk.length;
            if (!output.write(chunk)) await new Promise(resolve => output.once('drain', resolve));
            if (total > 0) {
                const ratio = received / total;
                onProgress?.(Math.round(range[0] + ((range[1] - range[0]) * ratio)));
            }
        }
    } finally {
        await new Promise((resolve, reject) => output.end(error => error ? reject(error) : resolve()));
    }
    if (!received) throw new Error('whisper_download_empty');
    if (fs.existsSync(destination)) fs.unlinkSync(destination);
    fs.renameSync(partial, destination);
}

async function ensureRuntime(root, onProgress) {
    const runtimeRoot = path.join(root, `runtime-${RUNTIME_VERSION}`);
    const executable = path.join(runtimeRoot, 'Release', 'whisper-cli.exe');
    if (fs.existsSync(executable)) return executable;
    const archive = path.join(root, `whisper-bin-x64-${RUNTIME_VERSION}.zip`);
    if (!fs.existsSync(archive) || sha256(archive) !== RUNTIME_SHA256) {
        if (fs.existsSync(archive)) fs.unlinkSync(archive);
        await downloadFile(RUNTIME_URL, archive, onProgress, [0, 20]);
        if (sha256(archive) !== RUNTIME_SHA256) throw new Error('whisper_runtime_checksum_failed');
    }
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });
    await extractZip(archive, { dir: runtimeRoot });
    if (!fs.existsSync(executable)) throw new Error('whisper_runtime_executable_missing');
    return executable;
}

async function ensureModel(root, modelName, onProgress) {
    const model = MODELS[modelName] || MODELS['Xenova/whisper-base'];
    const modelPath = path.join(root, 'models', model.file);
    if (fs.existsSync(modelPath) && fs.statSync(modelPath).size >= model.size * 0.98) return modelPath;
    if (fs.existsSync(modelPath)) fs.unlinkSync(modelPath);
    const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${model.file}?download=true`;
    await downloadFile(url, modelPath, onProgress, [20, 100]);
    if (!fs.existsSync(modelPath) || fs.statSync(modelPath).size < model.size * 0.98) {
        throw new Error('whisper_model_download_incomplete');
    }
    return modelPath;
}

async function ensureNativeWhisper(options = {}) {
    if (process.platform !== 'win32' || process.arch !== 'x64') return null;
    const root = path.join(path.dirname(options.modelCacheDir), 'whisper-cpp');
    fs.mkdirSync(root, { recursive: true });
    const report = percent => options.onProgress?.({ stage: 'model', percent });
    const executable = await ensureRuntime(root, report);
    const modelPath = await ensureModel(root, options.model, report);
    options.onProgress?.({ stage: 'model', percent: 100 });
    return { executable, modelPath, root };
}

function parseTimestamp(value) {
    const match = String(value || '').match(/^(\d+):(\d+):(\d+)[.,](\d+)$/);
    if (!match) return 0;
    return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]) + (Number(match[4]) / 1000);
}

function parseTranscriptLine(line) {
    const match = String(line || '').match(/^\s*\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.+?)\s*$/);
    if (!match) return null;
    const text = match[3].trim();
    if (!text) return null;
    return { start: parseTimestamp(match[1]), end: parseTimestamp(match[2]), text };
}

function wordsFromFullJson(payload) {
    const words = [];
    const segments = Array.isArray(payload?.transcription) ? payload.transcription : [];
    let current = null;
    const flush = () => {
        if (!current?.text?.trim()) return;
        words.push({
            text: current.text.trim(),
            start: current.start,
            end: Math.max(current.start, current.end)
        });
        current = null;
    };
    segments.forEach(segment => {
        (Array.isArray(segment?.tokens) ? segment.tokens : []).forEach(token => {
            const raw = String(token?.text || '');
            if (!raw || /^\[_.*\]$/.test(raw) || !raw.trim()) return;
            const offsets = token.offsets || {};
            const start = Number(offsets.from) / 1000;
            const end = Number(offsets.to) / 1000;
            if (!Number.isFinite(start) || !Number.isFinite(end)) return;
            if (/^\s/u.test(raw)) flush();
            if (!current) current = { text: '', start, end };
            current.text += raw.trimStart();
            current.end = Math.max(current.end, end);
        });
        flush();
    });
    return words;
}
function runWhisperChunk(runtime, options = {}) {
    return new Promise((resolve, reject) => {
        const durationMs = Math.max(1, Math.round(options.duration * 1000));
        const offsetMs = Math.max(0, Math.round(options.offset * 1000));
        const threadCount = Math.max(2, Math.min(16, (os.cpus()?.length || 4) - 2));
        const outputBase = path.join(os.tmpdir(), `evd-whisper-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        const jsonPath = `${outputBase}.json`;
        const args = [
            '-m', runtime.modelPath,
            '-f', options.sourcePath,
            '-ot', String(offsetMs),
            '-d', String(durationMs),
            '-l', 'auto',
            '-t', String(threadCount),
            '-pp', '-sow', '-ojf', '-of', outputBase
        ];
        const child = spawn(runtime.executable, args, {
            cwd: path.dirname(runtime.executable), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
        });
        const segments = [];
        const errors = [];
        let stdoutBuffer = '';
        let stderrBuffer = '';
        const consumeStdout = flush => {
            const lines = stdoutBuffer.split(/\r?\n/);
            stdoutBuffer = flush ? '' : (lines.pop() || '');
            if (flush && stdoutBuffer) lines.push(stdoutBuffer);
            lines.forEach(line => {
                const segment = parseTranscriptLine(line);
                if (segment) segments.push(segment);
            });
        };
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', data => { stdoutBuffer += data; consumeStdout(false); });
        child.stderr.on('data', data => {
            stderrBuffer += data;
            const matches = [...stderrBuffer.matchAll(/progress\s*=\s*(\d+)%/g)];
            if (matches.length) options.onChunkProgress?.(Math.max(0, Math.min(100, Number(matches[matches.length - 1][1]))));
            if (stderrBuffer.length > 32000) stderrBuffer = stderrBuffer.slice(-16000);
        });
        child.on('error', reject);
        child.on('close', code => {
            consumeStdout(true);
            if (code !== 0) {
                if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
                reject(new Error(stderrBuffer.trim() || `whisper_cpp_exited_${code}`));
                return;
            }
            try {
                const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8').replace(/^\uFEFF/, ''));
                resolve({ segments, words: wordsFromFullJson(payload) });
            } catch (error) {
                reject(error);
            } finally {
                if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
            }
        });
    });
}

module.exports = { ensureNativeWhisper, runWhisperChunk };

