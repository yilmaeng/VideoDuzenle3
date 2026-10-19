'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');
const extractZip = require('extract-zip');
const { app } = require('electron');

const MODEL = 'mel_band_roformer_instrumental_becruily.ckpt';
const CONFIG = 'config_mel_band_roformer_instrumental_becruily.yaml';
const MANIFEST = 'https://evd.drenginyilmaz.net/downloads/vocal-engine/manifest.json';
const platform = () => `${process.platform}-${process.arch}`;
const root = () => path.join(app.getPath('userData'), 'optional-components', 'vocal-separator');

function runtimeFromRoot(dir) {
    if (!dir) return null;
    const python = path.join(dir, 'python', ...(process.platform === 'win32' ? ['python.exe'] : ['bin', 'python3']));
    const packages = path.join(dir, 'packages');
    const models = path.join(dir, 'models');
    return [python, path.join(packages, 'audio_separator', '__init__.py'),
        path.join(models, MODEL), path.join(models, CONFIG)].every(file => fs.existsSync(file))
        ? { python, packages, models } : null;
}

function installed() {
    // Explicit developer override only; release builds never use test directories.
    if (!app.isPackaged && process.env.EVD_VOCAL_ENGINE_ROOT) {
        return runtimeFromRoot(path.resolve(process.env.EVD_VOCAL_ENGINE_ROOT));
    }
    if (!app.isPackaged) {
        const dev = runtimeFromRoot(path.join(app.getAppPath(), 'dist', 'vocal-engine', `staging-${platform()}-1.0.0`));
        if (dev) return dev;
    }
    try {
        const pointer = JSON.parse(fs.readFileSync(path.join(root(), 'current.json'), 'utf8'));
        if (!/^[a-zA-Z0-9._-]+$/.test(pointer.version) || pointer.version.startsWith('.')) return null;
        return runtimeFromRoot(path.join(root(), pointer.version));
    } catch { return null; }
}

function validateManifest(data, key = platform()) {
    const entry = data?.platforms?.[key];
    if (!entry || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,60}$/.test(entry.version || '')
        || !/^https:\/\//.test(entry.url || '') || !/^[a-f0-9]{64}$/i.test(entry.sha256 || '')
        || !Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > 12 * 1024 ** 3
        || !Number.isSafeInteger(entry.unpackedSize) || entry.unpackedSize <= 0 || entry.unpackedSize > 32 * 1024 ** 3) {
        throw new Error('unavailable');
    }
    return entry;
}

function fingerprint(entry) {
    return crypto.createHash('sha256').update(JSON.stringify([
        entry.version, entry.url, entry.sha256, entry.size, entry.unpackedSize
    ])).digest('hex');
}

async function downloadInfo() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
        const response = await fetch(MANIFEST, { signal: controller.signal });
        if (!response.ok) throw new Error('unavailable');
        const entry = validateManifest(await response.json());
        return { ...entry, approval: fingerprint(entry),
            requiredSpace: entry.size + entry.unpackedSize + 512 * 1024 ** 2 };
    } finally { clearTimeout(timer); }
}

async function ensure({ signal, onProgress, approval }) {
    const ready = installed();
    if (ready) return ready;
    onProgress({ stage: 'downloading' });
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) controller.abort();
    let timeout = setTimeout(abort, 60000);
    const staging = path.join(root(), `.install-${crypto.randomUUID()}`);
    const archive = `${staging}.zip`;
    try {
        const response = await fetch(MANIFEST, { signal: controller.signal });
        if (!response.ok) throw new Error('unavailable');
        const entry = validateManifest(await response.json());
        // Consent applies to this exact package, not a later, possibly larger replacement.
        if (!approval || approval !== fingerprint(entry)) throw new Error('consent');
        clearTimeout(timeout);
        timeout = setTimeout(abort, 60 * 60 * 1000);
        fs.mkdirSync(root(), { recursive: true });
        if (typeof fs.statfsSync === 'function') {
            const disk = fs.statfsSync(root());
            if (disk.bavail * disk.bsize < entry.size + entry.unpackedSize + 512 * 1024 ** 2) throw new Error('disk_space');
        }
        const download = await fetch(entry.url, { signal: controller.signal });
        if (!download.ok || !download.body) throw new Error('download');
        let received = 0;
        const downloadStarted = Date.now();
        const hash = crypto.createHash('sha256');
        let previous = -1;
        const measure = new Transform({ transform(chunk, encoding, callback) {
            received += chunk.length;
            if (received > entry.size) return callback(new Error('checksum'));
            hash.update(chunk);
            const percent = Math.floor(received * 100 / entry.size);
            if (percent !== previous) {
                previous = percent;
                onProgress({ stage: 'downloading', percent,
                    remainingSeconds: received > 0 ? (Date.now() - downloadStarted) / 1000 / received * (entry.size - received) : null });
            }
            callback(null, chunk);
        } });
        await pipeline(Readable.fromWeb(download.body), measure, fs.createWriteStream(archive, { flags: 'wx' }),
            { signal: controller.signal });
        if (received !== entry.size || hash.digest('hex') !== entry.sha256.toLowerCase()) throw new Error('checksum');
        onProgress({ stage: 'installing' });
        fs.mkdirSync(staging);
        let extractedSize = 0;
        await extractZip(archive, { dir: staging, onEntry: zipEntry => {
            if (controller.signal.aborted) throw new Error('cancelled');
            extractedSize += zipEntry.uncompressedSize;
            if (extractedSize > entry.unpackedSize) throw new Error('checksum');
            // Optional packages must not contain symlinks escaping their installation.
            if (((zipEntry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error('checksum');
        } });
        const runtime = runtimeFromRoot(staging);
        if (!runtime) throw new Error('engine');
        if (process.platform !== 'win32') fs.chmodSync(runtime.python, 0o755);
        if (controller.signal.aborted) throw new Error('cancelled');
        const target = path.join(root(), entry.version);
        if (fs.existsSync(target)) {
            if (!runtimeFromRoot(target)) throw new Error('engine');
        } else fs.renameSync(staging, target);
        const pointer = path.join(root(), `current-${crypto.randomUUID()}.json`);
        fs.writeFileSync(pointer, JSON.stringify({ version: entry.version }));
        fs.renameSync(pointer, path.join(root(), 'current.json'));
        return runtimeFromRoot(target);
    } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        fs.rmSync(archive, { force: true });
        fs.rmSync(staging, { force: true, recursive: true });
    }
}

module.exports = { ensure, installed, runtimeFromRoot, validateManifest, downloadInfo, MODEL, CONFIG };
