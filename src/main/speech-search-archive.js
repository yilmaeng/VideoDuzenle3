'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MAX_BYTES = 32 * 1024 * 1024;
const fail = code => { throw new Error(`speech_archive_${code}`); };

async function fingerprint(file) {
    const before = await fs.promises.stat(file);
    if (!before.isFile()) fail('invalid');
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    const after = await fs.promises.stat(file);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail('changed');
    return { size: before.size, sha256: hash.digest('hex') };
}

function cleanTranscript(value) {
    if (!value || !['Xenova/whisper-base', 'Xenova/whisper-small'].includes(value.model)
        || !Number.isFinite(value.duration) || value.duration <= 0) fail('invalid');
    const clean = items => {
        if (!Array.isArray(items) || items.length > 500000) fail('invalid');
        return items.map(item => {
            if (!item || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 50000
                || !Number.isFinite(item.start) || !Number.isFinite(item.end)
                || item.start < 0 || item.end <= item.start || item.end > value.duration + 0.001) fail('invalid');
            return { text: item.text, start: item.start, end: item.end };
        });
    };
    const words = clean(value.words), segments = clean(value.segments);
    return { model: value.model, duration: value.duration, words, segments, language: 'auto',
        transcript: (words.length ? words : segments).map(item => item.text).join(' ') };
}

function validateArchive(data) {
    if (!data || data.format !== 'evd-speech-analysis' || data.version !== 1
        || !Array.isArray(data.sources) || !data.sources.length || data.sources.length > 1000) fail('invalid');
    return data.sources.map(entry => {
        if (!entry || !Number.isSafeInteger(entry.size) || entry.size < 0
            || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) fail('invalid');
        return { size: entry.size, sha256: entry.sha256, analysis: cleanTranscript(entry.analysis) };
    });
}

async function createArchive(service, sources) {
    const cached = service.readCached({ sources });
    if (!cached) fail('missing');
    const entries = [];
    for (const result of cached.transcripts) {
        const stamp = await fingerprint(result.sourcePath);
        // Ensure the source did not change after the cache identity was checked.
        if (!service.readCached({ sources: [result.sourcePath], model: result.model })) fail('changed');
        entries.push({ name: path.basename(result.sourcePath), ...stamp, analysis: cleanTranscript(result) });
    }
    const text = JSON.stringify({ format: 'evd-speech-analysis', version: 1, sources: entries });
    if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) fail('invalid');
    return text;
}

async function importArchive(service, file, sources) {
    const handle = await fs.promises.open(file, 'r');
    let text;
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_BYTES) fail('invalid');
        const buffer = Buffer.alloc(stat.size + 1);
        let offset = 0;
        while (offset < buffer.length) {
            const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
            if (!bytesRead) break;
            offset += bytesRead;
        }
        if (offset > stat.size) fail('invalid');
        text = buffer.subarray(0, offset).toString('utf8');
    } finally { await handle.close(); }
    let data;
    try { data = JSON.parse(text); } catch { fail('invalid'); }
    return importArchiveData(service, data, sources);
}

async function importArchiveData(service, data, sources) {
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_BYTES) fail('invalid');
    const entries = validateArchive(data);
    const transcripts = [];
    const snapshots = [];
    for (const sourcePath of sources) {
        snapshots.push(await fs.promises.stat(sourcePath));
        const stamp = await fingerprint(sourcePath);
        const entry = entries.find(item => item.size === stamp.size && item.sha256 === stamp.sha256);
        if (!entry) fail('mismatch');
        transcripts.push({ ...entry.analysis, sourcePath, importedAt: new Date().toISOString(), cacheHit: true });
    }
    // Validate every source before changing any cache entry. No paths from the archive are used.
    for (let i = 0; i < sources.length; i++) {
        const now = await fs.promises.stat(sources[i]), before = snapshots[i];
        if (now.size !== before.size || now.mtimeMs !== before.mtimeMs || now.ctimeMs !== before.ctimeMs) fail('changed');
    }
    await service.storeImported(transcripts);
    return { transcripts };
}

async function writeArchive(file, text, sources) {
    const destination = path.resolve(file);
    if (sources.some(source => path.resolve(source).toLowerCase() === destination.toLowerCase())) fail('invalid');
    try {
        const dest = await fs.promises.realpath(destination);
        for (const source of sources) {
            if (dest === await fs.promises.realpath(source)) fail('invalid');
        }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temp = `${destination}.${crypto.randomUUID()}.tmp`;
    try {
        await fs.promises.writeFile(temp, text, { encoding: 'utf8', flag: 'wx' });
        await fs.promises.rename(temp, destination);
    } finally { await fs.promises.rm(temp, { force: true }); }
}

async function createProjectAnalysis(service, sources) {
    const available = sources.filter(source => service.readCached({ sources: [source] }));
    if (!available.length) return null;
    const data = JSON.parse(await createArchive(service, available));
    // Bind source-relative times to the project's original paths. Relocation is
    // explicit on load; byte hashes still decide whether the media really matches.
    data.sources.forEach((entry, index) => { entry.sourcePath = available[index]; });
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_BYTES) fail('invalid');
    return data;
}

async function restoreProjectAnalysis(service, data, mappings) {
    validateArchive(data);
    const sources = data.sources.map(entry => {
        const mapping = mappings.find(item => item.from === entry.sourcePath);
        if (!mapping || typeof mapping.to !== 'string' || !mapping.to || mapping.to.includes('\0')) fail('mismatch');
        return mapping.to;
    });
    return importArchiveData(service, data, [...new Set(sources)]);
}

module.exports = { createArchive, importArchive, importArchiveData, writeArchive, validateArchive, fingerprint,
    createProjectAnalysis, restoreProjectAnalysis };
