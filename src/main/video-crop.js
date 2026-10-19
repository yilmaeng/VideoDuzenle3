'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const sharp = require('sharp');
const { aacEncodingArgs } = require('./slideshow-audio-policy');

function run(exe, args, signal, onLine) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error('cancelled'));
        const child = spawn(exe, args, { windowsHide: true });
        const chunks = []; let size = 0, errors = '', pending = '';
        const abort = () => child.kill();
        signal?.addEventListener('abort', abort, { once: true });
        child.stdout.on('data', data => {
            size += data.length;
            if (size > 8 * 1024 * 1024) { child.kill(); return; }
            chunks.push(data);
            if (onLine) {
                pending += data.toString();
                const lines = pending.split(/\r?\n/); pending = lines.pop();
                lines.forEach(onLine);
            }
        });
        child.stderr.on('data', data => { errors = (errors + data).slice(-4000); });
        child.on('error', error => { signal?.removeEventListener('abort', abort); reject(error); });
        child.on('close', code => {
            signal?.removeEventListener('abort', abort);
            if (signal?.aborted) return reject(new Error('cancelled'));
            if (code !== 0 || size > 8 * 1024 * 1024) {
                console.error('Crop process failed', errors); return reject(new Error('processing'));
            }
            resolve(Buffer.concat(chunks));
        });
    });
}

function geometry(stream) {
    const rotation = Number(stream.side_data_list?.find(x => x.rotation != null)?.rotation ?? stream.tags?.rotate ?? 0);
    if (Math.abs(rotation % 90) > 0.01) throw new Error('unsupported');
    const sideways = Math.abs(Math.round(rotation / 90)) % 2;
    return { width: sideways ? stream.height : stream.width, height: sideways ? stream.width : stream.height };
}

function validateCrop(crop, width, height) {
    if (!crop || !['top', 'bottom', 'left', 'right'].every(k => Number.isSafeInteger(crop[k]) && crop[k] >= 0)) throw new Error('invalid');
    const w = width - crop.left - crop.right, h = height - crop.top - crop.bottom;
    // Even offsets and dimensions avoid implicit chroma rounding by crop/yuv420p.
    if (w < 16 || h < 16 || w % 2 || h % 2 || crop.left % 2 || crop.top % 2) throw new Error('invalid');
    return { width: w, height: h };
}

function detectEdges(rgb, width, height) {
    const content = (x, y) => {
        const i = (y * width + x) * 3;
        return Math.max(rgb[i], rgb[i + 1], rgb[i + 2]) > 28;
    };
    let x0 = width, y0 = height, x1 = -1, y1 = -1, bright = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (content(x, y)) { bright++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    }
    // Fades and very dark shots cannot establish a safe content rectangle.
    if (bright < width * height * 0.02) return null;
    return { left: x0, right: width - 1 - x1, top: y0, bottom: height - 1 - y1 };
}

function combineEdges(samples, width, height, sw, sh) {
    const valid = samples.filter(Boolean), crop = { left: 0, right: 0, top: 0, bottom: 0 };
    let uncertain = valid.length !== samples.length || valid.length < 3;
    for (const key of Object.keys(crop)) {
        if (!valid.length) continue;
        const values = valid.map(x => x[key]), low = Math.min(...values), high = Math.max(...values);
        if (high - low > 4) uncertain = true;
        const scale = ['left', 'right'].includes(key) ? width / sw : height / sh;
        // Retain two sampled pixels as a guard; never round into visible content.
        crop[key] = low < 4 ? 0 : Math.max(0, Math.floor((low - 2) * scale / 2) * 2);
    }
    if (uncertain) Object.keys(crop).forEach(k => { crop[k] = 0; });
    return { crop, uncertain };
}

async function probe(ffprobePath, source, signal) {
    return JSON.parse((await run(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', source], signal)).toString());
}

async function analyze(source, paths, signal, progress) {
    const stat = fs.statSync(source);
    if (!stat.isFile()) throw new Error('invalid');
    const metadata = await probe(paths.ffprobePath, source, signal);
    const stream = metadata.streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
    if (!stream) throw new Error('no_video');
    const { width, height } = geometry(stream), duration = Number(metadata.format.duration);
    if (!(duration > 0 && width >= 16 && height >= 16)) throw new Error('invalid');
    const scale = Math.min(1, 640 / width, 640 / height);
    const sw = Math.max(16, Math.round(width * scale)), sh = Math.max(16, Math.round(height * scale));
    const samples = [], frames = [];
    const [rateN, rateD] = String(stream.avg_frame_rate || '25/1').split('/').map(Number);
    const frameDuration = 1 / (rateN / rateD || 25);
    const sampleDuration = Number(stream.duration) || duration;
    const lastTime = Math.max(0, sampleDuration - Math.max(0.15, frameDuration * 2));
    const count = Math.max(3, Math.min(24, Math.ceil(duration / 3)));
    for (let i = 0; i < count; i++) {
        const time = lastTime * i / (count - 1);
        const rgb = await run(paths.ffmpegPath, ['-v', 'error', '-ss', String(time), '-i', source,
            '-map', `0:${stream.index}`, '-frames:v', '1', '-vf', `scale=${sw}:${sh}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], signal);
        if (rgb.length !== sw * sh * 3) throw new Error('processing');
        samples.push(detectEdges(rgb, sw, sh));
        // Six evenly spaced reference frames keep optional cloud requests bounded.
        if (i === 0 || i === count - 1 || i % Math.max(1, Math.ceil(count / 5)) === 0) {
            const jpeg = await sharp(rgb, { raw: { width: sw, height: sh, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
            frames.push({ time, image: `data:image/jpeg;base64,${jpeg.toString('base64')}` });
        }
        progress?.(Math.round((i + 1) * 100 / count));
    }
    return { source, stat: { size: stat.size, mtimeMs: stat.mtimeMs }, metadata, stream,
        width, height, duration, frames, sampleCount: count, ...combineEdges(samples, width, height, sw, sh) };
}

async function render(analysis, crop, output, paths, signal, progress) {
    const expected = validateCrop(crop, analysis.width, analysis.height);
    const stat = fs.statSync(analysis.source);
    if (stat.size !== analysis.stat.size || stat.mtimeMs !== analysis.stat.mtimeMs) throw new Error('changed');
    if (path.resolve(output).toLowerCase() === path.resolve(analysis.source).toLowerCase()) throw new Error('overwrite');
    if (/smpte2084|arib-std-b67/.test(analysis.stream.color_transfer || '') || analysis.stream.color_primaries === 'bt2020') throw new Error('hdr');
    const temporary = path.join(path.dirname(output), `.evd-crop-${crypto.randomUUID()}.mp4`);
    const args = ['-v', 'error', '-i', analysis.source, '-map', `0:${analysis.stream.index}`, '-map', '0:a?',
        '-vf', `crop=${expected.width}:${expected.height}:${crop.left}:${crop.top}`, '-vsync', '0', '-c:v', 'libx264', '-preset', 'medium',
        '-crf', '18', '-pix_fmt', analysis.stream.color_range === 'pc' ? 'yuvj420p' : 'yuv420p', '-metadata:s:v:0', 'rotate=0'];
    for (const [field, option] of [['color_range', '-color_range'], ['color_space', '-colorspace'], ['color_transfer', '-color_trc'], ['color_primaries', '-color_primaries']]) {
        const value = analysis.stream[field];
        if (value && value !== 'unknown' && value !== 'reserved') args.push(option, value);
    }
    const audio = analysis.metadata.streams.filter(s => s.codec_type === 'audio');
    audio.forEach((s, i) => {
        if (s.codec_name === 'aac' && s.profile === 'LC') args.push(`-c:a:${i}`, 'copy');
        else {
            const policy = aacEncodingArgs([s]);
            for (let j = 0; j < policy.length; j += 2) {
                const key = policy[j].includes(':a') ? `${policy[j]}:${i}` : `${policy[j]}:a:${i}`;
                args.push(key, policy[j + 1]);
            }
        }
    });
    args.push('-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', temporary);
    try {
        await run(paths.ffmpegPath, args, signal, line => {
            if (line.startsWith('out_time_ms=')) progress?.(Math.min(98, Number(line.slice(12)) / 1e6 / analysis.duration * 100));
        });
        const check = await probe(paths.ffprobePath, temporary, signal);
        const video = check.streams.find(s => s.codec_type === 'video');
        const [n, d] = String(analysis.stream.avg_frame_rate || '25/1').split('/').map(Number);
        const tolerance = Math.max(0.05, 2 / (n / d || 25));
        // Preserve source frame timestamps; automatic CFR sync can insert frames
        // in OBS recordings, changing duration even though cropping is spatial.
        if (!video || video.width !== expected.width || video.height !== expected.height ||
            Math.abs(Number(check.format.duration) - analysis.duration) > tolerance ||
            check.streams.filter(s => s.codec_type === 'audio').length !== audio.length) {
            console.error('Video crop validation:', { expected, actual: video && { width: video.width, height: video.height },
                sourceDuration: analysis.duration, outputDuration: check.format.duration, tolerance,
                sourceAudioCount: audio.length, outputAudioCount: check.streams.filter(s => s.codec_type === 'audio').length });
            throw new Error('validation');
        }
        if (signal.aborted) throw new Error('cancelled');
        fs.renameSync(temporary, output);
        progress?.(100);
        return { output };
    } finally { fs.rmSync(temporary, { force: true }); }
}

let registered = false;
function register({ ipcMain, dialog, BrowserWindow, i18n, announce, ...paths }) {
    if (registered) return;
    registered = true;
    const sessions = new Map(), jobs = new Map();
    const trusted = event => {
        if (!event.sender || event.sender.isDestroyed() || (event.senderFrame && event.senderFrame !== event.sender.mainFrame)) throw new Error('invalid');
    };
    async function job(event, task) {
        trusted(event); const sender = event.sender;
        if (jobs.has(sender.id)) return { error: 'busy' };
        const controller = new AbortController(), cancel = () => controller.abort();
        jobs.set(sender.id, controller); sender.once('destroyed', cancel); sender.once('did-start-loading', cancel);
        try { return await task(controller.signal); }
        catch (error) {
            console.error('Video crop:', error.message);
            return { error: controller.signal.aborted ? 'cancelled' : ['invalid', 'no_video', 'unsupported', 'changed', 'overwrite', 'hdr', 'validation'].includes(error.message) ? error.message : 'processing' };
        } finally {
            jobs.delete(sender.id); sender.removeListener('destroyed', cancel); sender.removeListener('did-start-loading', cancel);
            if (sender.isDestroyed()) sessions.delete(sender.id);
        }
    }
    ipcMain.handle('video-crop-analyze', (event, source) => job(event, async signal => {
        sessions.delete(event.sender.id);
        const result = await analyze(source, paths, signal, percent => {
            if (!event.sender.isDestroyed()) event.sender.send('video-crop-progress', { stage: 'analyzing', percent });
        });
        if (signal.aborted) throw new Error('cancelled');
        sessions.set(event.sender.id, result);
        const { width, height, duration, frames, crop, uncertain, sampleCount } = result;
        return { width, height, duration, frames, crop, uncertain, sampleCount };
    }));
    ipcMain.handle('video-crop-export', (event, crop) => job(event, async signal => {
        const analysis = sessions.get(event.sender.id);
        if (!analysis) throw new Error('invalid');
        validateCrop(crop, analysis.width, analysis.height);
        const win = BrowserWindow.fromWebContents(event.sender);
        const options = { title: i18n.t('video_crop.export'), defaultPath: analysis.source.replace(/\.[^.]+$/, '_cropped.mp4'),
            filters: [{ name: 'MP4', extensions: ['mp4'] }] };
        await announce(win, options);
        const choice = await dialog.showSaveDialog(win, options);
        if (choice.canceled || signal.aborted) return { error: 'cancelled' };
        const output = /\.mp4$/i.test(choice.filePath) ? choice.filePath : `${choice.filePath}.mp4`;
        return render(analysis, crop, output, paths, signal, percent => {
            if (!event.sender.isDestroyed()) event.sender.send('video-crop-progress', { stage: 'exporting', percent });
        });
    }));
    ipcMain.handle('video-crop-cancel', event => { trusted(event); jobs.get(event.sender.id)?.abort(); });
    ipcMain.handle('video-crop-close', event => { trusted(event); jobs.get(event.sender.id)?.abort(); sessions.delete(event.sender.id); });
}
module.exports = { register, analyze, render, detectEdges, combineEdges, validateCrop, geometry };
