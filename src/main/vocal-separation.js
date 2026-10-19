'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const crypto = require('crypto');
const engine = require('./vocal-engine-manager');
const { aacEncodingArgs, sourceAudioProfile } = require('./slideshow-audio-policy');
const { planSelections, buildReplacementTimeline } = require('./vocal-selection-plan');
const { renderContinuousAudio } = require('./export/continuous-audio-renderer');

function run(executable, args, { signal, env, onLine } = {}) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error('cancelled'));
        const child = spawn(executable, args, { windowsHide: true, env: env || process.env });
        let output = '', errors = '', pending = '';
        const abort = () => child.kill();
        signal?.addEventListener('abort', abort, { once: true });
        child.stdout.on('data', chunk => {
            output = (output + chunk).slice(-1024 * 1024);
            pending += chunk;
            const lines = pending.split(/[\r\n]+/);
            pending = lines.pop().slice(-65536);
            for (const line of lines) onLine?.(line);
        });
        child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-6000); });
        child.once('error', error => { signal?.removeEventListener('abort', abort); reject(error); });
        child.once('close', code => {
            signal?.removeEventListener('abort', abort);
            if (signal?.aborted) return reject(new Error('cancelled'));
            if (code !== 0) { console.error('Vocal separation child failed:', code, errors); reject(new Error('processing')); }
            else resolve(output);
        });
    });
}

async function probe(ffprobePath, file, signal) {
    return JSON.parse(await run(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { signal }));
}

function parseWorkerProgress(line) {
    if (!line.startsWith('EVD_VOCAL:')) return null;
    try {
        const data = JSON.parse(line.slice(10));
        if (!['loading', 'separating', 'separated'].includes(data.stage)) return null;
        return { stage: data.stage, percent: Number.isFinite(data.percent) ? Math.max(0, Math.min(100, data.percent)) : null,
            remainingSeconds: Number.isFinite(data.remainingSeconds) ? Math.max(0, data.remainingSeconds) : null };
    } catch { return null; }
}

async function separate({ source, destination, mode, format = 'wav', selections = null, consent, approval, signal, onProgress, ffmpegPath, ffprobePath }) {
    if (!['instrumental', 'vocals', 'both'].includes(mode) || !['wav', 'mp4'].includes(format)
        || typeof source !== 'string' || !path.isAbsolute(source) || !path.isAbsolute(destination)) throw new Error('invalid');
    const metadata = await probe(ffprobePath, source, signal);
    const audio = metadata.streams?.find(stream => stream.codec_type === 'audio');
    if (!audio) throw new Error('no_audio');
    const video = metadata.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
    if (format === 'mp4' && !video) throw new Error('no_video');
    // No hidden quality-changing fallback: unsupported video codecs can still export WAV.
    if (format === 'mp4' && !['h264', 'hevc', 'mpeg4'].includes(video.codec_name)) throw new Error('video_codec');
    if (![1, 2].includes(Number(audio.channels))) throw new Error('channels');
    const duration = Number(audio.duration || metadata.format?.duration);
    const rate = Number(audio.sample_rate);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(rate) || rate <= 0) throw new Error('invalid');
    const plan = selections === null ? null : planSelections(selections, source, duration, rate);
    if (plan && mode !== 'instrumental') throw new Error('selections');
    if (!engine.installed() && !consent) throw new Error('consent');
    const runtime = await engine.ensure({ signal, onProgress, approval });
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-vocal-'));
    const stage = path.join(destination, `.evd-vocal-${crypto.randomUUID()}`);
    const start = Date.now();
    try {
        fs.mkdirSync(stage);
        const input = path.join(scratch, 'source.wav');
        const progress = phase => {
            const phaseStarted = Date.now();
            return line => {
                const match = /^out_time_ms=(\d+)$/.exec(line);
                if (!match) return;
                const processed = Number(match[1]) / 1000000;
                onProgress({ stage: phase, percent: Math.min(99, processed / duration * 100),
                    remainingSeconds: processed > 0 ? Math.max(0, (Date.now() - phaseStarted) / 1000 / processed * (duration - processed)) : null });
            };
        };
        onProgress({ stage: 'decoding', percent: 0 });
        await run(ffmpegPath, ['-nostdin', '-v', 'error', '-i', source, '-map', '0:a:0', '-vn',
            ...(plan ? ['-af', require('./export/seamless-timeline').sourceAudioTimelineFilter(rate)] : []),
            '-c:a', 'pcm_f32le', '-progress', 'pipe:1', input], { signal, onLine: progress('decoding') });
        let manifest = null, jobs = [];
        if (plan) {
            for (let index = 0; index < plan.length; index++) {
                const row = plan[index], directory = path.join(scratch, `part-${index}`);
                fs.mkdirSync(directory);
                const clip = path.join(directory, 'input.wav');
                onProgress({ stage: 'preparing_selections', percent: index / plan.length * 100 });
                await run(ffmpegPath, ['-nostdin', '-v', 'error', '-ss', (row.contextStart/rate).toFixed(9), '-i', input, '-af',
                    `atrim=end_sample=${row.contextEnd-row.contextStart},asetpts=PTS-STARTPTS`,
                    '-c:a', 'pcm_f32le', clip], { signal });
                jobs.push({ input: clip, output: directory, weight: (row.contextEnd-row.contextStart)/rate });
            }
            manifest = path.join(scratch, 'jobs.json');
            fs.writeFileSync(manifest, JSON.stringify(jobs), 'utf8');
        }
        // Copy the lightweight script out of ASAR for the external interpreter.
        const worker = path.join(scratch, 'worker.py');
        fs.copyFileSync(path.join(__dirname, 'vocal-separation-worker.py'), worker);
        onProgress({ stage: 'loading' });
        await run(runtime.python, ['-u', worker, ...(manifest ? ['--manifest', manifest] : ['--input', input]), '--output', scratch, '--models', runtime.models], {
            signal,
            env: { ...process.env, PYTHONNOUSERSITE: '1', PYTHONPATH: runtime.packages,
                PATH: `${path.dirname(ffmpegPath)}${path.delimiter}${process.env.PATH || ''}` },
            onLine: line => { const data = parseWorkerProgress(line); if (data) onProgress(data); }
        });
        let replacement;
        if (plan) {
            const stems = [];
            for (let index = 0; index < jobs.length; index++) {
                const found = fs.readdirSync(jobs[index].output).filter(name => name.includes('_(Instrumental)_') && name.endsWith('.wav'));
                if (found.length !== 1) throw new Error('processing');
                const stem = path.join(jobs[index].output, found[0]);
                const info = await probe(ffprobePath, stem, signal);
                const stemDuration = Number(info.format?.duration);
                if (!Number.isFinite(stemDuration) || Math.abs(stemDuration - jobs[index].weight) > 0.05) throw new Error('validation');
                // Normalize the stem to the source layout/rate before the shared
                // timeline. Model stereo/44.1kHz output must not change untouched audio.
                const normalized = path.join(jobs[index].output, 'normalized.wav');
                await run(ffmpegPath, ['-nostdin', '-v', 'error', '-i', stem, '-ar', String(rate), '-ac', String(audio.channels),
                    '-c:a', 'pcm_f32le', normalized], { signal });
                stems.push(normalized);
            }
            replacement = path.join(scratch, 'continuous.wav');
            onProgress({ stage: 'assembling', percent: 0 });
            await renderContinuousAudio({ ffmpegPath, ffprobePath, inputPath: input,
                segments: buildReplacementTimeline(plan, input, stems, duration, rate),
                sourceProfiles: [input, ...stems].map(filePath => ({ filePath, audio: [{ ...audio, codec_name: 'pcm_f32le' }] })),
                outputPath: replacement, signal, protectiveFadeMs: 3,
                onProgress: percent => onProgress({ stage: 'assembling', percent }) });
        }
        const stems = mode === 'both' ? ['Instrumental', 'Vocals'] : [mode === 'vocals' ? 'Vocals' : 'Instrumental'];
        const names = [];
        for (const stem of stems) {
            if (signal?.aborted) throw new Error('cancelled');
            const found = replacement ? [path.basename(replacement)] : fs.readdirSync(scratch).filter(name => name.includes(`_(${stem})_`) && name.endsWith('.wav'));
            if (found.length !== 1) throw new Error('processing');
            const name = `${path.parse(source).name}_saved_${stem.toLowerCase()}.${format}`;
            const file = path.join(stage, name);
            onProgress({ stage: 'exporting', percent: 0 });
            const separated = path.join(scratch, found[0]);
            const args = format === 'mp4'
                ? ['-nostdin', '-v', 'error', '-i', source, '-i', separated, '-map', `0:${video.index}`, '-map', '1:a:0',
                    '-map_metadata', '0', '-c:v', 'copy', ...aacEncodingArgs([audio]), '-movflags', '+faststart']
                : ['-nostdin', '-v', 'error', '-i', separated, '-ar', String(rate), '-ac', String(audio.channels), '-c:a', 'pcm_s24le'];
            await run(ffmpegPath, [...args, '-progress', 'pipe:1', file],
            { signal, onLine: progress('exporting') });
            const result = await probe(ffprobePath, file, signal);
            const stream = result.streams?.find(s => s.codec_type === 'audio');
            const expectedRate = format === 'mp4' ? sourceAudioProfile([audio]).outputSampleRate : rate;
            const outputDuration = Number(stream?.duration || result.format.duration);
            if (!Number.isFinite(outputDuration) || Math.abs(outputDuration - duration) > 0.15 || Number(stream?.sample_rate) !== expectedRate
                || Number(stream?.channels) !== Number(audio.channels)) throw new Error('validation');
            if (stream.codec_name !== (format === 'mp4' ? 'aac' : 'pcm_s24le')
                || (format === 'mp4' && stream.profile !== 'LC')) throw new Error('validation');
            if (format === 'mp4') {
                const renderedVideo = result.streams.find(s => s.codec_type === 'video');
                const sourceVideoDuration = Number(video.duration || metadata.format.duration);
                const outputVideoDuration = Number(renderedVideo?.duration || result.format.duration);
                if (!renderedVideo || renderedVideo.codec_name !== video.codec_name || renderedVideo.width !== video.width
                    || renderedVideo.height !== video.height || !Number.isFinite(outputVideoDuration)
                    || Math.abs(outputVideoDuration - sourceVideoDuration) > 0.1) throw new Error('validation');
            }
            names.push(name);
        }
        if (signal?.aborted) throw new Error('cancelled');
        const base = path.parse(source).name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100);
        const target = path.join(destination, `${base}-MelBand-${crypto.randomUUID().slice(0, 8)}`);
        fs.renameSync(stage, target);
        onProgress({ stage: 'done', percent: 100 });
        return { directory: target, files: names.map(name => path.join(target, name)), seconds: (Date.now() - start) / 1000 };
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
        fs.rmSync(stage, { recursive: true, force: true });
    }
}

let registered = false;
function register({ ipcMain, dialog, BrowserWindow, i18n, ffmpegPath, ffprobePath, announce }) {
    if (registered) return;
    registered = true;
    let active = null;
    const trusted = event => {
        if (!event.sender || event.sender.isDestroyed() || (event.senderFrame && event.senderFrame !== event.sender.mainFrame)) throw new Error('invalid');
    };
    ipcMain.handle('vocal-separation-inspect', event => { trusted(event); return { ready: !!engine.installed() }; });
    ipcMain.handle('vocal-separation-source', async event => {
        trusted(event);
        const win = BrowserWindow.fromWebContents(event.sender);
        const options = { title: i18n.t('vocal_separation.source'), properties: ['openFile'] };
        await announce(win, options);
        const result = await dialog.showOpenDialog(win, options);
        return result.canceled ? null : result.filePaths[0];
    });
    ipcMain.handle('vocal-separation-cancel', event => {
        trusted(event);
        if (active?.sender === event.sender) active.controller.abort();
    });
    ipcMain.handle('vocal-separation-run', async (event, params = {}) => {
        trusted(event);
        if (active) return { error: 'busy' };
        const sender = event.sender;
        const controller = new AbortController();
        active = { sender, controller };
        const cancel = () => controller.abort();
        sender.once('destroyed', cancel);
        sender.once('did-start-loading', cancel);
        sender.once('render-process-gone', cancel);
        try {
            const win = BrowserWindow.fromWebContents(sender);
            if (params.scope === 'selections' && (!Array.isArray(params.selections) || !params.selections.length)) throw new Error('selections');
            let approval;
            if (!engine.installed()) {
                const info = await engine.downloadInfo();
                if (controller.signal.aborted) return { cancelled: true };
                const number = new Intl.NumberFormat(i18n.getCurrentLanguage?.() || 'en', {
                    minimumFractionDigits: 2, maximumFractionDigits: 2
                });
                const gb = bytes => number.format(bytes / 1e9);
                const confirmation = {
                    type: 'question', title: i18n.t('vocal_separation.download_title'),
                    message: i18n.t('vocal_separation.download_question', {
                        size: gb(info.size), installed: gb(info.unpackedSize), free: gb(info.requiredSpace)
                    }),
                    buttons: [i18n.t('vocal_separation.download_yes'), i18n.t('vocal_separation.cancel')],
                    defaultId: 1, cancelId: 1, noLink: true
                };
                await announce(win, confirmation);
                const answer = await dialog.showMessageBox(win, confirmation);
                if (answer.response !== 0 || controller.signal.aborted) return { cancelled: true };
                approval = info.approval;
            }
            const options = { title: i18n.t('vocal_separation.destination'), properties: ['openDirectory', 'createDirectory'] };
            await announce(win, options);
            const choice = await dialog.showOpenDialog(win, options);
            if (choice.canceled || controller.signal.aborted) return { cancelled: true };
            return await separate({ source: params.source, mode: params.mode, format: params.format, consent: params.consent === true,
                selections: params.scope === 'selections' ? params.selections : null,
                approval, destination: choice.filePaths[0], signal: controller.signal, ffmpegPath, ffprobePath,
                onProgress: payload => { if (!sender.isDestroyed() && !controller.signal.aborted) sender.send('vocal-separation-progress', payload); } });
        } catch (error) {
            console.error('Vocal separation:', error);
            return controller.signal.aborted ? { cancelled: true } : { error: ['selections', 'no_audio', 'no_video', 'video_codec', 'channels', 'consent', 'unavailable', 'checksum', 'validation', 'disk_space'].includes(error.message) ? error.message : 'failed' };
        } finally {
            sender.removeListener('destroyed', cancel);
            sender.removeListener('did-start-loading', cancel);
            sender.removeListener('render-process-gone', cancel);
            active = null;
        }
    });
}

module.exports = { separate, register, parseWorkerProgress, run };
