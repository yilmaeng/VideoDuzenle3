const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const activeJobs = new Map();

function getFfmpegPath() {
    let ffmpegPath = null;
    try { ffmpegPath = require('ffmpeg-static'); } catch (_error) {}
    if (!ffmpegPath) {
        try { ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; } catch (_error) {}
    }
    if (ffmpegPath && ffmpegPath.includes('app.asar')) {
        ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
    }
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
        throw new Error('ffmpeg_not_found');
    }
    return ffmpegPath;
}

function validateSource(filePath) {
    const resolved = path.resolve(String(filePath || ''));
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error('source_is_not_file');
    return { resolved, stat };
}

function getCacheInfo(filePath, stat) {
    const fingerprint = crypto.createHash('sha256')
        .update(`${filePath}|${stat.size}|${stat.mtimeMs}`)
        .digest('hex');
    const directory = path.join(app.getPath('userData'), 'description-subtitle-cache');
    fs.mkdirSync(directory, { recursive: true });
    return {
        fingerprint,
        waveformPath: path.join(directory, `${fingerprint}-waveform.json`),
        scenesPath: path.join(directory, `${fingerprint}-scenes.json`)
    };
}

function readCache(filePath, kind) {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (parsed?.kind === kind && parsed.version === 1) return parsed;
    } catch (_error) {}
    return null;
}

function writeCache(filePath, data) {
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(data)}\n`, 'utf8');
    fs.renameSync(temporaryPath, filePath);
}

function parseProgressSeconds(line) {
    const match = String(line || '').match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match) return null;
    return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
}

function sendProgress(webContents, kind, current, duration) {
    if (!webContents || webContents.isDestroyed()) return;
    const percent = duration > 0 ? Math.max(0, Math.min(100, Math.round((current / duration) * 100))) : 0;
    webContents.send('description-subtitle-analysis-progress', { kind, percent });
}

function stopJob(webContentsId) {
    const job = activeJobs.get(webContentsId);
    if (!job) return false;
    job.cancelled = true;
    try { job.process?.kill(); } catch (_error) {}
    activeJobs.delete(webContentsId);
    return true;
}

function createJob(webContents, kind) {
    stopJob(webContents.id);
    const job = { kind, cancelled: false, process: null };
    activeJobs.set(webContents.id, job);
    return job;
}

function finishJob(webContentsId, job) {
    if (activeJobs.get(webContentsId) === job) activeJobs.delete(webContentsId);
}

async function generateWaveform(webContents, options = {}) {
    const { resolved, stat } = validateSource(options.filePath);
    const cache = getCacheInfo(resolved, stat);
    const cached = readCache(cache.waveformPath, 'waveform');
    if (cached) return { ...cached, cached: true };

    const duration = Math.max(0, Number(options.duration) || 0);
    const sampleRate = 8000;
    const peaksPerSecond = 50;
    const samplesPerPeak = Math.max(1, Math.floor(sampleRate / peaksPerSecond));
    const job = createJob(webContents, 'waveform');

    return new Promise((resolve, reject) => {
        const child = spawn(getFfmpegPath(), [
            '-hide_banner', '-nostdin', '-i', resolved,
            '-map', '0:a:0?', '-vn', '-ac', '1', '-ar', String(sampleRate),
            '-f', 's16le', 'pipe:1'
        ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        job.process = child;
        const peaks = [];
        let pendingByte = null;
        let peak = 0;
        let sampleCount = 0;
        let stderr = '';

        child.stdout.on('data', chunk => {
            if (job.cancelled) return;
            let buffer = chunk;
            if (pendingByte !== null) {
                buffer = Buffer.concat([Buffer.from([pendingByte]), chunk]);
                pendingByte = null;
            }
            if (buffer.length % 2) {
                pendingByte = buffer[buffer.length - 1];
                buffer = buffer.subarray(0, buffer.length - 1);
            }
            for (let offset = 0; offset < buffer.length; offset += 2) {
                peak = Math.max(peak, Math.abs(buffer.readInt16LE(offset)) / 32768);
                sampleCount += 1;
                if (sampleCount >= samplesPerPeak) {
                    peaks.push(Number(peak.toFixed(4)));
                    peak = 0;
                    sampleCount = 0;
                }
            }
        });
        child.stderr.on('data', chunk => {
            const text = chunk.toString();
            stderr = `${stderr}${text}`.slice(-8000);
            const current = parseProgressSeconds(text);
            if (current !== null) sendProgress(webContents, 'waveform', current, duration);
        });
        child.on('error', error => {
            finishJob(webContents.id, job);
            reject(error);
        });
        child.on('close', code => {
            finishJob(webContents.id, job);
            if (job.cancelled) return reject(new Error('analysis_cancelled'));
            if (code !== 0) return reject(new Error(`waveform_analysis_failed:${stderr.trim().slice(-500)}`));
            if (sampleCount > 0) peaks.push(Number(peak.toFixed(4)));
            const result = {
                kind: 'waveform', version: 1, fingerprint: cache.fingerprint,
                sampleRate, peaksPerSecond, duration, peaks, createdAt: new Date().toISOString()
            };
            writeCache(cache.waveformPath, result);
            sendProgress(webContents, 'waveform', duration, duration);
            resolve({ ...result, cached: false });
        });
    });
}

async function detectScenes(webContents, options = {}) {
    const { resolved, stat } = validateSource(options.filePath);
    const cache = getCacheInfo(resolved, stat);
    const cached = readCache(cache.scenesPath, 'scenes');
    if (cached) return { ...cached, cached: true };
    const duration = Math.max(0, Number(options.duration) || 0);
    const threshold = Math.max(0.1, Math.min(0.9, Number(options.threshold) || 0.34));
    const job = createJob(webContents, 'scenes');

    return new Promise((resolve, reject) => {
        const filter = `select='gt(scene,${threshold})',showinfo`;
        const child = spawn(getFfmpegPath(), [
            '-hide_banner', '-nostdin', '-i', resolved,
            '-an', '-vf', filter, '-vsync', 'vfr', '-f', 'null', '-'
        ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        job.process = child;
        const scenes = [];
        let stderr = '';
        child.stderr.on('data', chunk => {
            const text = chunk.toString();
            stderr = `${stderr}${text}`.slice(-12000);
            for (const match of text.matchAll(/pts_time:([0-9.]+)/g)) {
                const time = Number(match[1]);
                if (Number.isFinite(time) && (scenes.length === 0 || Math.abs(time - scenes[scenes.length - 1]) > 0.08)) {
                    scenes.push(Number(time.toFixed(3)));
                }
            }
            const current = parseProgressSeconds(text);
            if (current !== null) sendProgress(webContents, 'scenes', current, duration);
        });
        child.on('error', error => {
            finishJob(webContents.id, job);
            reject(error);
        });
        child.on('close', code => {
            finishJob(webContents.id, job);
            if (job.cancelled) return reject(new Error('analysis_cancelled'));
            if (code !== 0) return reject(new Error(`scene_analysis_failed:${stderr.trim().slice(-500)}`));
            const result = {
                kind: 'scenes', version: 1, fingerprint: cache.fingerprint,
                duration, threshold, scenes, createdAt: new Date().toISOString()
            };
            writeCache(cache.scenesPath, result);
            sendProgress(webContents, 'scenes', duration, duration);
            resolve({ ...result, cached: false });
        });
    });
}

module.exports = { detectScenes, generateWaveform, stopJob };
