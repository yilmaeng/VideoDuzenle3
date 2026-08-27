const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { app, safeStorage } = require('electron');

const BASE_URL = 'https://studioapi.binclusive.io';
const PART_SIZE = 64 * 1024 * 1024;

function keyFilePath() {
    return path.join(app.getPath('userData'), 'contentstudio-api-key.enc');
}

function saveApiKey(value) {
    const apiKey = String(value || '').trim();
    if (!apiKey) throw new Error('contentstudio_api_key_required');
    const filePath = keyFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!safeStorage.isEncryptionAvailable()) throw new Error('contentstudio_secure_storage_unavailable');
    fs.writeFileSync(filePath, `safe:${safeStorage.encryptString(apiKey).toString('base64')}`, 'utf8');
}

function getApiKey() {
    const filePath = keyFilePath();
    if (!fs.existsSync(filePath)) return '';
    try {
        const stored = fs.readFileSync(filePath, 'utf8').trim();
        if (stored.startsWith('safe:')) {
            return safeStorage.decryptString(Buffer.from(stored.slice(5), 'base64'));
        }
        if (stored.startsWith('base64:')) {
            return Buffer.from(stored.slice(7), 'base64').toString('utf8');
        }
        return '';
    } catch (_error) {
        return '';
    }
}

function hasApiKey() {
    return Boolean(getApiKey());
}

function contentTypeFor(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const types = {
        '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
        '.webm': 'video/webm', '.avi': 'video/x-msvideo', '.m4v': 'video/x-m4v',
        '.wmv': 'video/x-ms-wmv', '.mpeg': 'video/mpeg', '.mpg': 'video/mpeg'
    };
    return types[extension] || 'application/octet-stream';
}

function apiError(status, payload) {
    const body = payload?.error || payload || {};
    const code = String(body.code || `contentstudio_http_${status}`);
    const message = String(body.message || code);
    const requestId = String(body.requestId || '');
    const error = new Error(requestId ? `${message} (${requestId})` : message);
    error.code = code;
    error.status = status;
    error.requestId = requestId;
    return error;
}

async function sleep(milliseconds) {
    await new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function apiRequest(endpoint, options = {}) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('contentstudio_api_key_missing');
    const attempts = Math.max(1, Number(options.attempts) || 4);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const response = await fetch(`${BASE_URL}${endpoint}`, {
            method: options.method || 'GET',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {})
            },
            body: options.body !== undefined ? JSON.stringify(options.body) : undefined
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok) return payload?.data;
        if (response.status === 429 && attempt < attempts) {
            const retrySeconds = Math.max(1, Number(response.headers.get('retry-after')) || 5);
            await sleep(retrySeconds * 1000);
            continue;
        }
        throw apiError(response.status, payload);
    }
    throw new Error('contentstudio_request_failed');
}

async function getAccount() {
    const [me, credits] = await Promise.all([
        apiRequest('/v1/me'),
        apiRequest('/v1/me/credits')
    ]);
    return { me, credits };
}

async function putPart(url, buffer) {
    const response = await fetch(url, { method: 'PUT', body: buffer });
    if (!response.ok) throw new Error(`contentstudio_upload_http_${response.status}`);
    const etag = response.headers.get('etag');
    if (!etag) throw new Error('contentstudio_upload_etag_missing');
    return etag;
}

async function uploadVideo(filePath, onProgress) {
    const resolvedPath = path.resolve(String(filePath || ''));
    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile() || stats.size <= 0) throw new Error('contentstudio_video_missing');
    if (stats.size > 5 * 1024 * 1024 * 1024) throw new Error('contentstudio_video_too_large');
    const started = await apiRequest('/v1/uploads', {
        method: 'POST',
        body: {
            filename: path.basename(resolvedPath),
            contentType: contentTypeFor(resolvedPath),
            kind: 'video',
            size: stats.size
        }
    });
    const handle = fs.openSync(resolvedPath, 'r');
    const parts = [];
    let offset = 0;
    let partNumber = 1;
    try {
        while (offset < stats.size) {
            const length = Math.min(PART_SIZE, stats.size - offset);
            const buffer = Buffer.allocUnsafe(length);
            let bytesRead = 0;
            while (bytesRead < length) {
                const read = fs.readSync(handle, buffer, bytesRead, length - bytesRead, offset + bytesRead);
                if (read <= 0) break;
                bytesRead += read;
            }
            if (bytesRead <= 0) throw new Error('contentstudio_upload_read_failed');
            const signed = await apiRequest('/v1/uploads/sign-part', {
                method: 'POST',
                body: { key: started.key, uploadId: started.uploadId, partNumber }
            });
            const etag = await putPart(signed.url, bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead));
            parts.push({ partNumber, etag });
            offset += bytesRead;
            onProgress?.({ stage: 'uploading', percent: Math.round((offset / stats.size) * 100), partNumber });
            partNumber += 1;
        }
    } finally {
        fs.closeSync(handle);
    }
    await apiRequest('/v1/uploads/complete', {
        method: 'POST',
        body: { key: started.key, uploadId: started.uploadId, parts }
    });
    onProgress?.({ stage: 'upload_complete', percent: 100 });
    return { key: started.key, fileName: path.basename(resolvedPath), size: stats.size };
}

function normalizeJobStatus(status) {
    return String(status || '').toLowerCase() === 'completed' ? 'succeeded' : String(status || '').toLowerCase();
}

function normalizeProjectResponse(value = {}) {
    const nested = value.project || value.job || value.data || value;
    const id = nested.id || value.projectId || value.jobId || value.resultRef || '';
    return {
        ...nested,
        id: String(id || ''),
        status: normalizeJobStatus(nested.status || value.status || 'queued')
    };
}

async function listVideoProjects(limit = 20) {
    const result = await apiRequest(`/v1/projects?kind=video&limit=${Math.max(1, Math.min(100, Number(limit) || 20))}&offset=0`);
    const items = Array.isArray(result) ? result : (Array.isArray(result?.items) ? result.items : []);
    return items.map(normalizeProjectResponse);
}

async function findLatestVideoProject(sourceName) {
    const wanted = String(sourceName || '').trim().toLocaleLowerCase();
    if (!wanted) return null;
    const items = await listVideoProjects(50);
    return items.find(item => String(item.name || '').trim().toLocaleLowerCase() === wanted) || null;
}

async function createVideoProject(options = {}, onProgress) {
    const upload = await uploadVideo(options.videoPath, onProgress);
    onProgress?.({ stage: 'creating_project', percent: 100 });
    const body = {
        kind: 'video',
        name: String(options.name || upload.fileName),
        sourceType: 'file',
        videoR2Key: upload.key,
        videoFileName: upload.fileName,
        language: String(options.language || 'tr'),
        duration: Math.max(0.01, Number(options.duration) || 0.01),
        promptTemplateId: String(options.promptTemplateId || 'accessibility'),
        verbosityLevel: ['concise', 'detailed', 'comprehensive'].includes(options.verbosityLevel)
            ? options.verbosityLevel : 'detailed',
        processingMode: options.processingMode === 'enhanced' ? 'enhanced' : 'standard',
        captionsEnabled: options.captionsEnabled !== false,
        confidenceThreshold: Math.max(0, Math.min(1, Number(options.confidenceThreshold) || 0)),
        temperature: Math.max(0, Math.min(1, Number(options.temperature) || 0)),
        customInstructions: String(options.customInstructions || '').trim()
    };
    if (!body.customInstructions) delete body.customInstructions;
    const created = normalizeProjectResponse(await apiRequest('/v1/projects', { method: 'POST', body }));
    if (created.id) return created;
    const recovered = await findLatestVideoProject(body.name);
    if (recovered?.id) return recovered;
    throw new Error('contentstudio_project_id_missing');
}

async function getJob(projectId) {
    return normalizeProjectResponse(await apiRequest(`/v1/jobs/${encodeURIComponent(String(projectId || ''))}`));
}

async function getDescriptions(projectId) {
    return apiRequest(`/v1/projects/${encodeURIComponent(String(projectId || ''))}/descriptions`);
}

async function requestExport(projectId, format, quality, includeCaptions) {
    return apiRequest('/v1/exports', {
        method: 'POST',
        body: {
            projectId: String(projectId || ''),
            format,
            ...(format === 'srt' ? {} : { quality, includeCaptions: Boolean(includeCaptions) })
        }
    });
}

async function getExportStatus(projectId) {
    return apiRequest(`/v1/exports/${encodeURIComponent(String(projectId || ''))}`);
}

async function downloadFile(url, outputPath) {
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`contentstudio_download_http_${response.status}`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(outputPath));
    return outputPath;
}

module.exports = {
    BASE_URL,
    saveApiKey,
    getApiKey,
    hasApiKey,
    getAccount,
    createVideoProject,
    findLatestVideoProject,
    getJob,
    getDescriptions,
    requestExport,
    getExportStatus,
    downloadFile,
    sleep
};
