const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
    createCancelledError,
    isCurrentExportCancelled,
    registerExportProcess
} = require('./export-process-registry');

const cache = new Map();
const keyframeCache = new Map();

function parseFraction(value) {
    const text = String(value || '').trim();
    if (!text) return 0;
    const parts = text.split('/').map(Number);
    if (parts.length === 2) return parts[1] ? parts[0] / parts[1] : 0;
    const number = Number(text);
    return Number.isFinite(number) ? number : 0;
}

function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function getBitDepth(stream = {}) {
    const raw = numberOrZero(stream.bits_per_raw_sample || stream.bits_per_sample);
    if (raw) return raw;
    const pixelFormat = String(stream.pix_fmt || '').toLowerCase();
    const match = pixelFormat.match(/(?:p|le|be)(10|12|14|16)(?:le|be)?$/);
    return match ? Number(match[1]) : 8;
}

function getRotation(stream = {}) {
    const tagRotation = numberOrZero(stream.tags?.rotate);
    if (tagRotation) return tagRotation;
    const displayMatrix = (stream.side_data_list || []).find((item) =>
        String(item?.side_data_type || '').toLowerCase().includes('display matrix'));
    return numberOrZero(displayMatrix?.rotation);
}

function isLosslessAudioCodec(codec) {
    return ['pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le', 'pcm_f64le', 'alac', 'flac', 'wavpack', 'ape']
        .includes(String(codec || '').toLowerCase());
}

function runProbe(ffprobePath, filePath, extraArgs = []) {
    return new Promise((resolve, reject) => {
        const args = ['-v', 'error', ...extraArgs, '-of', 'json', filePath];
        const child = spawn(ffprobePath, args, { windowsHide: true });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(stderr.trim() || `ffprobe_exited_${code}`));
                return;
            }
            try {
                resolve(JSON.parse(stdout || '{}'));
            } catch (error) {
                reject(new Error(`ffprobe_json_invalid: ${error.message}`));
            }
        });
    });
}

function normalizeProfile(filePath, probe, stat) {
    const streams = Array.isArray(probe.streams) ? probe.streams : [];
    const format = probe.format || {};
    const video = streams.find((stream) => stream.codec_type === 'video') || null;
    const audioStreams = streams.filter((stream) => stream.codec_type === 'audio');
    const duration = numberOrZero(format.duration || video?.duration || audioStreams[0]?.duration);
    const fileSize = numberOrZero(format.size) || stat.size;
    const calculatedBitrate = duration > 0 ? Math.round((fileSize * 8) / duration) : 0;
    const averageFrameRate = parseFraction(video?.avg_frame_rate);
    const realFrameRate = parseFraction(video?.r_frame_rate);
    const rotation = getRotation(video || {});
    const rotated = Math.abs(Math.round(rotation)) % 180 === 90;
    const videoBitrate = numberOrZero(video?.bit_rate);

    return {
        filePath,
        fileName: path.basename(filePath),
        fileSize,
        modifiedAt: stat.mtimeMs,
        duration,
        container: {
            formatName: String(format.format_name || ''),
            formatLongName: String(format.format_long_name || ''),
            bitrate: numberOrZero(format.bit_rate) || calculatedBitrate,
            calculatedBitrate,
            startTime: numberOrZero(format.start_time),
            tags: format.tags || {},
            chapterCount: Array.isArray(probe.chapters) ? probe.chapters.length : 0
        },
        video: video ? {
            codec: String(video.codec_name || ''),
            codecLongName: String(video.codec_long_name || ''),
            profile: String(video.profile || ''),
            level: numberOrZero(video.level),
            width: rotated ? numberOrZero(video.height) : numberOrZero(video.width),
            height: rotated ? numberOrZero(video.width) : numberOrZero(video.height),
            storageWidth: numberOrZero(video.width),
            storageHeight: numberOrZero(video.height),
            codedWidth: numberOrZero(video.coded_width || video.width),
            codedHeight: numberOrZero(video.coded_height || video.height),
            sampleAspectRatio: String(video.sample_aspect_ratio || '1:1'),
            displayAspectRatio: String(video.display_aspect_ratio || ''),
            pixelFormat: String(video.pix_fmt || ''),
            bitDepth: getBitDepth(video),
            averageFrameRate,
            realFrameRate,
            variableFrameRate: Boolean(averageFrameRate && realFrameRate && Math.abs(averageFrameRate - realFrameRate) > 0.01),
            bitrate: videoBitrate,
            duration: numberOrZero(video.duration || format.duration),
            timeBase: String(video.time_base || ''),
            startTime: numberOrZero(video.start_time),
            firstDts: numberOrZero(video.start_pts),
            rotation,
            colorRange: String(video.color_range || ''),
            colorSpace: String(video.color_space || ''),
            colorPrimaries: String(video.color_primaries || ''),
            colorTransfer: String(video.color_transfer || ''),
            fieldOrder: String(video.field_order || ''),
            sideData: video.side_data_list || [],
            disposition: video.disposition || {}
        } : null,
        audio: audioStreams.map((audio, index) => ({
            index,
            streamIndex: numberOrZero(audio.index),
            codec: String(audio.codec_name || ''),
            codecLongName: String(audio.codec_long_name || ''),
            profile: String(audio.profile || ''),
            lossless: isLosslessAudioCodec(audio.codec_name),
            bitrate: numberOrZero(audio.bit_rate),
            duration: numberOrZero(audio.duration || format.duration),
            sampleRate: numberOrZero(audio.sample_rate),
            channels: numberOrZero(audio.channels),
            channelLayout: String(audio.channel_layout || (numberOrZero(audio.channels) === 1 ? 'mono' : 'stereo')),
            sampleFormat: String(audio.sample_fmt || ''),
            bitDepth: getBitDepth(audio),
            timeBase: String(audio.time_base || ''),
            startTime: numberOrZero(audio.start_time),
            initialPadding: numberOrZero(audio.initial_padding),
            trailingPadding: numberOrZero(audio.trailing_padding),
            title: String(audio.tags?.title || ''),
            language: String(audio.tags?.language || '')
        })),
        raw: { format, streams }
    };
}

async function analyzeSource(ffprobePath, filePath, { force = false } = {}) {
    const resolved = path.resolve(String(filePath || ''));
    const stat = fs.statSync(resolved);
    const key = `${resolved}|${stat.size}|${stat.mtimeMs}`;
    if (!force && cache.has(key)) return cache.get(key);
    const probe = await runProbe(ffprobePath, resolved, ['-show_format', '-show_streams', '-show_chapters']);
    const profile = normalizeProfile(resolved, probe, stat);
    cache.set(key, profile);
    if (cache.size > 24) cache.delete(cache.keys().next().value);
    return profile;
}

async function getKeyframes(ffprobePath, filePath, { duration = 0, onProgress = null, force = false } = {}) {
    const resolved = path.resolve(filePath);
    const stat = fs.statSync(resolved);
    const key = `${resolved}|${stat.size}|${stat.mtimeMs}`;
    if (!force && keyframeCache.has(key)) {
        onProgress?.(100);
        return keyframeCache.get(key);
    }
    if (isCurrentExportCancelled()) throw createCancelledError();

    const frames = await new Promise((resolve, reject) => {
        const args = [
            '-v', 'error', '-select_streams', 'v:0',
            '-show_packets', '-show_entries', 'packet=pts_time,dts_time,flags',
            '-of', 'csv=p=0', resolved
        ];
        const child = spawn(ffprobePath, args, { windowsHide: true });
        let unregister = () => {};
        try {
            unregister = registerExportProcess(child);
        } catch (error) {
            reject(error);
            return;
        }
        let stdoutBuffer = '';
        let stderr = '';
        const values = [];
        let lastPercent = -1;
        const parseLines = (text, flush = false) => {
            stdoutBuffer += text;
            const lines = stdoutBuffer.split(/\r?\n/);
            const tail = lines.pop() || '';
            stdoutBuffer = flush ? '' : tail;
            if (flush && tail) lines.push(tail);
            for (const line of lines) {
                const fields = line.split(',').map((value) => value.trim()).filter(Boolean);
                const timestamp = fields
                    .map((value) => value.trim())
                    .map(Number)
                    .find((value) => Number.isFinite(value) && value >= 0);
                if (!Number.isFinite(timestamp)) continue;
                const flags = fields.find((value) => /^[A-Z_]+$/.test(value)) || '';
                if (flags.includes('K')) values.push(timestamp);
                if (duration > 0 && onProgress) {
                    const percent = Math.min(99.9, timestamp / duration * 100);
                    if (percent >= lastPercent + 0.1) {
                        lastPercent = percent;
                        onProgress(percent);
                    }
                }
            }
        };
        child.stdout.on('data', (chunk) => parseLines(chunk.toString()));
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
            if (stderr.length > 12000) stderr = stderr.slice(-12000);
        });
        child.on('error', (error) => {
            unregister();
            reject(isCurrentExportCancelled() ? createCancelledError() : error);
        });
        child.on('close', (code) => {
            unregister();
            if (isCurrentExportCancelled()) {
                reject(createCancelledError());
                return;
            }
            parseLines('', true);
            if (code !== 0) {
                reject(new Error(stderr.trim() || `ffprobe_exited_${code}`));
                return;
            }
            onProgress?.(100);
            resolve(values.sort((a, b) => a - b));
        });
    });
    keyframeCache.set(key, frames);
    if (keyframeCache.size > 12) keyframeCache.delete(keyframeCache.keys().next().value);
    return frames;
}

module.exports = { analyzeSource, getKeyframes, parseFraction, isLosslessAudioCodec };
