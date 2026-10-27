const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const native = require('./description-whisper-native');

const MODELS = ['Xenova/whisper-tiny', 'Xenova/whisper-base', 'Xenova/whisper-small'];
const VERSION = 2;
const SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 60;
const TRANSFORMER_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json',
    'preprocessor_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];

function abortError() {
    return Object.assign(new Error('speech_search_cancelled'), { name: 'AbortError', code: 'ABORT_ERR' });
}
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
function modelName(value) {
    // Speech search favors recognition quality; narration matching retains its
    // own model default. Model-specific cache identities avoid reusing base text.
    const model = value || MODELS[2];
    if (!MODELS.includes(model)) throw new Error('speech_search_model_unsupported');
    return model;
}
function nonempty(file) {
    try { const stat = fs.statSync(file); return stat.isFile() && stat.size > 0; } catch { return false; }
}
function normalize(items, offset = 0, duration = Infinity) {
    return (Array.isArray(items) ? items : []).flatMap(item => {
        const start = Number(item.start);
        const end = Number(item.end);
        const text = String(item.text || '').trim();
        if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end < start || start > duration) return [];
        const safeStart = Math.max(0, start);
        // Quantized Whisper token boundaries can collapse to one timestamp.
        const safeEnd = Math.min(duration, Math.max(safeStart + 0.02, end));
        if (safeEnd <= safeStart) return [];
        return [{ text, start: safeStart + offset, end: safeEnd + offset,
            ...(item.alignmentQuality ? {alignmentQuality:item.alignmentQuality} : {}) }];
    });
}

function chunkBounds(position, bytes) {
    const context = 2 * SAMPLE_RATE * 4;
    const step = CHUNK_SECONDS * SAMPLE_RATE * 4;
    return { from: Math.max(0, position - context), to: Math.min(bytes, position + step + context),
        ownerStart: position / 4 / SAMPLE_RATE, ownerEnd: Math.min(bytes, position + step) / 4 / SAMPLE_RATE };
}
function owned(items, bounds) {
    return items.filter(item => {
        const midpoint = (item.start + item.end) / 2;
        return midpoint >= bounds.ownerStart && midpoint < bounds.ownerEnd;
    });
}

function probeDuration(executable, sourcePath, signal, spawnProcess) {
    if (!executable) return Promise.resolve(0);
    checkAbort(signal);
    return new Promise((resolve, reject) => {
        const child = spawnProcess(executable, ['-v', 'error', '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1', sourcePath],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        const abort = () => child.kill('SIGKILL');
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        child.stdout.on('data', chunk => { output = (output + chunk).slice(-16000); });
        child.stderr.on('data', () => {});
        child.on('error', () => {
            signal?.removeEventListener('abort', abort);
            if (signal?.aborted) reject(abortError()); else resolve(0);
        });
        child.on('close', code => {
            signal?.removeEventListener('abort', abort);
            if (signal?.aborted) reject(abortError());
            else resolve(code === 0 && Number(output) > 0 ? Number(output) : 0);
        });
    });
}

function decode(ffmpegPath, sourcePath, output, onProgress, signal, spawnProcess, duration) {
    checkAbort(signal);
    return new Promise((resolve, reject) => {
        const child = spawnProcess(ffmpegPath, ['-nostdin', '-y', '-v', 'error', '-i', sourcePath,
            '-map', '0:a:0', '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_f32le',
            '-f', 'f32le', '-progress', 'pipe:1', output],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let errors = '';
        let progress = '';
        const abort = () => child.kill('SIGKILL');
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        child.stdout.on('data', chunk => {
            progress += chunk.toString();
            const lines = progress.split(/\r?\n/);
            progress = lines.pop();
            for (const line of lines) {
                const match = /^out_time_ms=(\d+)$/.exec(line);
                if (match) {
                    const seconds = Number(match[1]) / 1e6;
                    onProgress({ phase: 'decoding', percent: duration > 0 ? Math.min(99, Math.round(seconds / duration * 100)) : 0,
                        seconds, duration, indeterminate: !duration });
                }
            }
        });
        child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-16000); });
        child.on('error', error => { signal?.removeEventListener('abort', abort); reject(signal?.aborted ? abortError() : error); });
        child.on('close', code => {
            signal?.removeEventListener('abort', abort);
            if (signal?.aborted) reject(abortError());
            else if (code !== 0) reject(Object.assign(new Error('speech_search_decode_failed'), { detail: errors }));
            else resolve();
        });
    });
}

// A dedicated worker isolates Transformers' global cache settings and makes both
// downloads and ONNX inference cancellable, including the existing macOS fallback.
function runFallback(options, onProgress, signal, WorkerClass) {
    checkAbort(signal);
    return new Promise((resolve, reject) => {
        const worker = new WorkerClass(__filename, { workerData: { speechSearch: true, ...options } });
        let settled = false;
        const finish = async (error, result) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', abort);
            try { await worker.terminate(); } catch (terminationError) { error = error || terminationError; }
            if (error) reject(error); else resolve(result);
        };
        const abort = () => { void finish(abortError()); };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        worker.on('message', message => {
            if (settled) return;
            if (message.type === 'progress') onProgress(message.payload);
            else if (message.type === 'result') void finish(null, message.payload);
            else if (message.type === 'error') void finish(new Error(message.message));
        });
        worker.on('error', error => { void finish(error); });
        worker.on('exit', code => { if (!settled) void finish(new Error(`speech_search_worker_exited_${code}`)); });
    });
}

async function fallbackWorker(options) {
    const transformers = await import('@xenova/transformers');
    transformers.env.cacheDir = options.modelCacheDir;
    transformers.env.allowLocalModels = true;
    transformers.env.allowRemoteModels = options.allowDownload;
    const report = payload => parentPort.postMessage({ type: 'progress', payload });
    const transcriber = await transformers.pipeline('automatic-speech-recognition', options.model, {
        local_files_only: !options.allowDownload,
        progress_callback: progress => report({ phase: 'model', percent: Number.isFinite(progress.progress) ? progress.progress : 0, file: progress.file })
    });
    const fd = fs.openSync(options.audioPath, 'r');
    const bytes = fs.fstatSync(fd).size;
    const words = [];
    const segments = [];
    try {
        const chunkBytes = SAMPLE_RATE * CHUNK_SECONDS * 4;
        for (let position = 0; position < bytes; position += chunkBytes) {
            const bounds = chunkBounds(position, bytes);
            const buffer = Buffer.alloc(bounds.to - bounds.from);
            fs.readSync(fd, buffer, 0, buffer.length, bounds.from);
            const audio = new Float32Array(buffer.length / 4);
            for (let index = 0; index < audio.length; index += 1) audio[index] = buffer.readFloatLE(index * 4);
            const result = await transcriber(audio, { return_timestamps: 'word', chunk_length_s: 30,
                stride_length_s: 5, task: 'transcribe', ...(options.language === 'auto' ? {} : { language: options.language }) });
            const offset = bounds.from / 4 / SAMPLE_RATE;
            const duration = audio.length / SAMPLE_RATE;
            const chunkWords = owned(normalize((result.chunks || []).map(chunk => ({ text: chunk.text,
                start: chunk.timestamp?.[0] ?? 0, end: chunk.timestamp?.[1] ?? duration })), offset, duration), bounds);
            words.push(...chunkWords);
            if (chunkWords.length) segments.push({ start: chunkWords[0].start, end: chunkWords.at(-1).end,
                text: chunkWords.map(word => word.text).join(' ') });
            report({ phase: 'transcribing', percent: Math.round(bounds.ownerEnd / (bytes / 4 / SAMPLE_RATE) * 100) });
        }
        return { words, segments };
    } finally {
        fs.closeSync(fd);
        await transcriber.dispose();
    }
}

function writeWave(raw, target) {
    const samples = raw.length / 4;
    const wave = Buffer.alloc(44 + samples * 2);
    wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
    wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
    wave.writeUInt32LE(SAMPLE_RATE, 24); wave.writeUInt32LE(SAMPLE_RATE * 2, 28);
    wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36);
    wave.writeUInt32LE(samples * 2, 40);
    for (let index = 0; index < samples; index += 1) {
        const sample = Math.max(-1, Math.min(1, raw.readFloatLE(index * 4) || 0));
        wave.writeInt16LE(Math.round(sample * (sample < 0 ? 32768 : 32767)), 44 + index * 2);
    }
    fs.writeFileSync(target, wave);
}

/** Backend only: no commands/shortcuts are registered here; the consuming UI owns them.
 * inspect never downloads. Set allowDownload:false to require offline readiness.
 * Timings are source-relative seconds. Only complete, unchanged sources are cached.
 * modelCacheDir can reuse description-subtitle-cache/whisper-models.
 */
function createSpeechSearchService(options = {}) {
    if (!options.cacheDir || !options.ffmpegPath) throw new Error('speech_search_configuration_missing');
    const root = path.resolve(options.cacheDir);
    const cacheDir = path.join(root, 'speech-search');
    const modelCacheDir = path.resolve(options.modelCacheDir || path.join(root, 'whisper-models'));
    const nativeApi = options.nativeWhisper || native;
    const platform = options.platform || process.platform;
    const arch = options.arch || process.arch;
    const backend = platform === 'win32' && arch === 'x64' ? 'whisper.cpp' : 'transformers';
    let busy = false;

    function cacheLocation(source, model, language = 'auto') {
        const sourcePath = fs.realpathSync(path.resolve(source));
        const stat = fs.statSync(sourcePath);
        if (!stat.isFile()) throw new Error('speech_search_source_invalid');
        const identity = { version: VERSION, sourcePath, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs,
            model: modelName(model), language, backend };
        const key = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
        return { identity, cachePath: path.join(cacheDir, `${key}.json`) };
    }

    function readCached({ sources, model, allowPartial = false } = {}) {
        const transcripts = [];
        for (const source of sources) {
            let found;
            for (const candidate of model ? [modelName(model)] : [MODELS[2], MODELS[1]]) {
                const { identity, cachePath } = cacheLocation(source, candidate);
                try {
                    const entry = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
                    if (JSON.stringify(entry.identity) === JSON.stringify(identity)
                        && Array.isArray(entry.result.words) && Array.isArray(entry.result.segments)
                        && Number.isFinite(entry.result.duration)) {
                        const result = { ...entry.result, sourcePath: source, cacheHit: true };
                        const date = item => Date.parse(item?.importedAt || item?.analyzedAt || '') || 0;
                        if (!found || date(result) > date(found)) found = result;
                    }
                } catch { /* A missing cache never starts recognition or a download. */ }
            }
            if (!found) {
                if (allowPartial) continue;
                return null;
            }
            transcripts.push(found);
        }
        return transcripts.length ? { version: VERSION, transcripts } : null;
    }

    async function storeImported(transcripts) {
        if (busy) throw new Error('speech_search_busy');
        await fs.promises.mkdir(cacheDir, { recursive: true });
        for (const result of transcripts) {
            const { identity, cachePath } = cacheLocation(result.sourcePath, result.model);
            const temporary = `${cachePath}.${crypto.randomUUID()}.tmp`;
            try {
                await fs.promises.writeFile(temporary, JSON.stringify({ identity, result: { ...result, language: 'auto', backend } }), 'utf8');
                await fs.promises.rename(temporary, cachePath);
            } finally { await fs.promises.rm(temporary, { force: true }); }
        }
    }

    function inspect(request = {}) {
        const model = modelName(request.model);
        const info = nativeApi.inspectNativeWhisper({ modelCacheDir, model, platform, arch });
        const missingFiles = backend === 'transformers'
            ? TRANSFORMER_FILES.filter(file => !nonempty(path.join(modelCacheDir, model, file))) : [];
        let dependencyReady = true;
        if (backend === 'transformers') {
            try { require.resolve('@xenova/transformers'); } catch { dependencyReady = false; }
        }
        const modelReady = backend === 'whisper.cpp' ? info.modelReady : missingFiles.length === 0;
        const runtimeReady = backend === 'whisper.cpp' ? info.runtimeReady : dependencyReady;
        const ffmpegReady = nonempty(options.ffmpegPath);
        return { backend, model, modelCacheDir, modelReady, runtimeReady, ffmpegReady,
            supported: dependencyReady,
            available: ffmpegReady && dependencyReady,
            ready: ffmpegReady && runtimeReady && modelReady,
            downloadRequired: !modelReady || (backend === 'whisper.cpp' && !runtimeReady), missingFiles };
    }

    async function analyze(request = {}, onProgress, signal) {
        signal = signal || request.signal;
        onProgress = onProgress || request.onProgress;
        checkAbort(signal);
        if (busy) throw new Error('speech_search_busy');
        if (!Array.isArray(request.sources) || !request.sources.length || request.sources.some(source => typeof source !== 'string' || !source.trim())) {
            throw new Error('speech_search_sources_missing');
        }
        const model = modelName(request.model);
        const language = request.language || 'auto';
        const fillers = request.mode === 'fillers';
        if (fillers && backend !== 'whisper.cpp') throw new Error('filler_backend_unsupported');
        const fillerPolicy = fillers ? require('./filler-analysis') : null;
        if (typeof language !== 'string' || !/^[a-zA-Z-]{2,24}$/.test(language)) throw new Error('speech_search_language_invalid');
        const stages = { cache: 'analyze', model: 'model', decoding: 'extract', transcribing: 'analyze', caching: 'analyze', complete: 'complete' };
        const report = payload => { if (!signal?.aborted) onProgress?.({ ...payload, stage: stages[payload.phase] }); };
        busy = true;
        let temporary;
        try {
            fs.mkdirSync(cacheDir, { recursive: true });
            const results = [];
            let runtime;
            for (let sourceIndex = 0; sourceIndex < request.sources.length; sourceIndex += 1) {
                checkAbort(signal);
                const requestedSourcePath = request.sources[sourceIndex];
                const sourcePath = fs.realpathSync(path.resolve(requestedSourcePath));
                const stat = fs.statSync(sourcePath);
                if (!stat.isFile()) throw new Error('speech_search_source_invalid');
                const identity = { version: VERSION, sourcePath, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, model, language, backend,
                    ...(fillers ? {analysisMode:fillerPolicy.VERSION} : {}) };
                const key = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
                const cachePath = path.join(cacheDir, `${key}.json`);
                const progress = payload => report({ sourcePath: requestedSourcePath, sourceIndex, sourceCount: request.sources.length, ...payload });
                progress({ phase: 'cache', percent: 0 });
                let cached;
                if (!request.force) {
                    try {
                        const entry = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
                        if (JSON.stringify(entry.identity) === JSON.stringify(identity) && Array.isArray(entry.result.words) && Array.isArray(entry.result.segments)
                            && typeof entry.result.transcript === 'string' && Number.isFinite(entry.result.duration)) cached = entry.result;
                    } catch { /* Missing or interrupted cache entries are recomputed. */ }
                }
                if (cached) {
                    results.push({ ...cached, sourcePath: requestedSourcePath, cacheHit: true });
                    progress({ phase: 'cache', percent: 100 });
                    continue;
                }
                const readiness = inspect({ model });
                if (!readiness.available) throw new Error('speech_search_unavailable');
                if (readiness.downloadRequired && request.allowDownload === false) {
                    throw Object.assign(new Error('speech_search_download_required'), { code: 'SPEECH_SEARCH_DOWNLOAD_REQUIRED', readiness });
                }
                if (backend === 'whisper.cpp' && !runtime) {
                    progress({ phase: 'model', percent: 0 });
                    runtime = await nativeApi.ensureNativeWhisper({ model, modelCacheDir, signal,
                        onProgress: payload => progress({ ...payload, phase: 'model' }) });
                    if (!runtime) throw new Error('speech_search_runtime_missing');
                }
                temporary = fs.mkdtempSync(path.join(cacheDir, 'analysis-'));
                const audioPath = path.join(temporary, 'audio.f32');
                progress({ phase: 'decoding', percent: 0 });
                const sourceDuration = await probeDuration(options.ffprobePath, sourcePath, signal, options.spawnProcess || spawn);
                await decode(options.ffmpegPath, sourcePath, audioPath, progress, signal, options.spawnProcess || spawn, sourceDuration);
                checkAbort(signal);
                progress({ phase: 'decoding', percent: 100 });
                const bytes = fs.statSync(audioPath).size;
                if (!bytes || bytes % 4) throw new Error('speech_search_audio_empty');
                const duration = bytes / 4 / SAMPLE_RATE;
                progress({ phase: 'transcribing', percent: 0 });
                let transcription;
                if (backend === 'transformers') {
                    transcription = await runFallback({ audioPath, model, modelCacheDir, language, allowDownload: request.allowDownload !== false }, progress, signal, options.WorkerClass || Worker);
                } else {
                    transcription = { words: [], segments: [] };
                    const fd = fs.openSync(audioPath, 'r');
                    try {
                        const chunkBytes = SAMPLE_RATE * CHUNK_SECONDS * 4;
                        for (let position = 0; position < bytes; position += chunkBytes) {
                            checkAbort(signal);
                            const bounds = chunkBounds(position, bytes);
                            const raw = Buffer.alloc(bounds.to - bounds.from);
                            fs.readSync(fd, raw, 0, raw.length, bounds.from);
                            const wav = path.join(temporary, 'chunk.wav');
                            writeWave(raw, wav);
                            const chunkDuration = raw.length / 4 / SAMPLE_RATE;
                            const result = await nativeApi.runWhisperChunk(runtime, { sourcePath: wav, offset: 0, duration: chunkDuration, language, signal,
                                ...(fillers ? {initialPrompt:fillerPolicy.PROMPT, preciseFillerTiming:true} : {}),
                                onChunkProgress: percent => progress({ phase: 'transcribing', percent: Math.round((position + Math.min(chunkBytes, bytes - position) * percent / 100) / bytes * 100) }) });
                            checkAbort(signal);
                            for (const field of ['words', 'segments']) transcription[field].push(...owned(normalize(result[field], bounds.from / 4 / SAMPLE_RATE, chunkDuration), bounds));
                            progress({ phase: 'transcribing', percent: Math.round(bounds.ownerEnd / duration * 100) });
                        }
                    } finally { fs.closeSync(fd); }
                }
                checkAbort(signal);
                const current = fs.statSync(sourcePath);
                if (current.size !== stat.size || current.mtimeMs !== stat.mtimeMs || current.ctimeMs !== stat.ctimeMs) throw new Error('speech_search_source_changed');
                const result = { sourcePath: requestedSourcePath, model, language, backend, duration,
                    words: normalize(transcription.words, 0, duration), segments: normalize(transcription.segments, 0, duration),
                    transcript: (transcription.words.length ? transcription.words : transcription.segments).map(item => item.text).join(' ').trim(),
                    analyzedAt: new Date().toISOString(), cacheHit: false };
                if (fillers) result.fillers = fillerPolicy.candidates(result.words, audioPath);
                progress({ phase: 'caching', percent: 0 });
                const partial = path.join(temporary, 'transcript.json');
                fs.writeFileSync(partial, JSON.stringify({ identity, result }), 'utf8');
                checkAbort(signal);
                fs.renameSync(partial, cachePath);
                results.push(result);
                fs.rmSync(temporary, { recursive: true, force: true });
                temporary = null;
                progress({ phase: 'caching', percent: 100 });
            }
            report({ phase: 'complete', percent: 100 });
            return { version: VERSION, transcripts: results };
        } catch (error) {
            if (signal?.aborted) throw abortError();
            throw error;
        } finally {
            if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
            busy = false;
        }
    }
    return { inspect, analyze, readCached, storeImported };
}

if (!isMainThread && workerData?.speechSearch) {
    fallbackWorker(workerData).then(payload => parentPort.postMessage({ type: 'result', payload }))
        .catch(error => parentPort.postMessage({ type: 'error', message: error.message }));
}

module.exports = { createSpeechSearchService };
