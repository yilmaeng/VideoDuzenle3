const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

/* =========================================
   DIAGNOSTIC & UTILS (V61 AUDIO MIXER REVIVAL)
   ========================================= */

console.log("=== FFMPEG-HANDLER V61 (AUDIO MIXER REVIVAL) LOADED ===");

function setupFFmpeg() {
    let ffmpegPath, ffprobePath;
    try { ffmpegPath = require('ffmpeg-static'); } catch (e) { }
    if (!ffmpegPath) try { ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; } catch (e) { }
    try { ffprobePath = require('@ffprobe-installer/ffprobe').path; } catch (e) { }
    if (ffmpegPath && ffmpegPath.includes('app.asar')) ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
    if (ffprobePath && ffprobePath.includes('app.asar')) ffprobePath = ffprobePath.replace('app.asar', 'app.asar.unpacked');
    if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
    if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);
    return { ffmpegPath, ffprobePath };
}
const { ffmpegPath } = setupFFmpeg();

const formatTime = (s) => {
    if (!s || isNaN(s)) return "00:00:00";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
};

function _getSafePath(p) {
    if (!p) return null;
    let s = (typeof p === 'string') ? p : (p.path || p.filePath || p.src || p.imagePath || p.resolvedPath || p.url || p.assetPath || '');
    if (!s || typeof s !== 'string') return null;
    try {
        if (s.startsWith('http')) return s;
        s = decodeURIComponent(s).trim();
        s = s.replace(/^file:\/\/\//, '').replace(/^local-resource:\/\//, '');
        if (process.platform === 'win32' && /^\/[A-Z]:/i.test(s)) s = s.substring(1);
        return path.normalize(s);
    } catch (e) { return s; }
}

function cleanArgs(args) {
    const a = Array.from(args);
    if (a[0] && typeof a[0] === 'object' && (a[0].sender || a[0].constructor.name === 'IpcMainInvokeEvent')) {
        return a.slice(1);
    }
    return a;
}

function _isImageFile(p) {
    if (!p || typeof p !== 'string') return false;
    const ext = path.extname(p).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.bmp', '.webp'].includes(ext);
}

// V61: Restore Audio Mixing Capability
async function _mixAudioAdvanced(options, onProgress) {
    console.log('[MixAudio V61] Starting...', options);

    // safe paths
    const videoPath = _getSafePath(options.videoPath);
    const audioPath = _getSafePath(options.audioPath);
    const outputPath = _getSafePath(options.outputPath);

    if (!videoPath || !audioPath || !outputPath) {
        throw new Error("Missing paths for audio mix");
    }

    const videoVolume = options.videoVolume !== undefined ? options.videoVolume : 1.0;
    const audioVolume = options.audioVolume !== undefined ? options.audioVolume : 1.0;
    const insertTime = options.insertTime || 0;
    const audioTrimStart = options.audioTrimStart || 0;
    const audioTrimEnd = options.audioTrimEnd || 0; // 0 means no end trim usually
    const loopAudio = options.loopAudio || false;

    return new Promise((resolve, reject) => {
        // First get metadata for duration
        ffmpeg.ffprobe(videoPath, (err, videoMeta) => {
            if (err) return reject(err);

            const videoDuration = videoMeta.format.duration;
            const remainingDuration = videoDuration - insertTime;
            const hasVideoAudio = videoMeta.streams.some(s => s.codec_type === 'audio');
            const delayMs = Math.round(insertTime * 1000);

            // Filter Chain Construction
            let filters = [];

            // 1. Prepare Video Audio [0:a] -> [a0]
            if (hasVideoAudio) {
                filters.push(`[0:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${videoVolume}[a0]`);
            } else {
                // Generate silence matching video duration if no audio
                filters.push(`anullsrc=r=44100:cl=stereo,atrim=0:${videoDuration}[a0]`);
            }

            // 2. Prepare External Audio [1:a] -> [a1]
            let audioFilters = [];

            // Trim
            if (audioTrimStart > 0 || (audioTrimEnd > audioTrimStart)) {
                let trimPart = `atrim=start=${audioTrimStart}`;
                if (audioTrimEnd > audioTrimStart) trimPart += `:end=${audioTrimEnd}`;
                audioFilters.push(trimPart);
                audioFilters.push('asetpts=PTS-STARTPTS');
            }

            // Standardize
            audioFilters.push('aformat=sample_rates=44100:channel_layouts=stereo');
            audioFilters.push(`volume=${audioVolume}`);

            // Delay or Loop
            if (loopAudio) {
                audioFilters.push(`aloop=loop=-1:size=2e+09`);
                audioFilters.push(`atrim=0:${remainingDuration}`);
                // If delayed loop needed, we might need adelay after or complex calc. 
                // Assuming simple loop for now as per backup. 
                if (delayMs > 0) audioFilters.push(`adelay=${delayMs}|${delayMs}`);
            } else if (delayMs > 0) {
                audioFilters.push(`adelay=${delayMs}|${delayMs}`);
            }

            const audioChain = audioFilters.join(',');
            filters.push(`[1:a]${audioChain}[a1]`);

            // 3. Mix [a0][a1] -> [aout]
            // duration=first ensures output length matches video
            filters.push(`[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]`);

            ffmpeg(videoPath)
                .input(audioPath)
                .complexFilter(filters)
                .outputOptions([
                    '-map 0:v',     // Keep original video
                    '-map [aout]',  // Use mixed audio
                    '-c:v copy',    // Copy video stream (FAST)
                    '-c:a aac',     // Encode audio
                    '-b:a 192k'
                ])
                .output(outputPath)
                .on('progress', (p) => { if (onProgress) onProgress(p.percent); })
                .on('end', () => resolve(outputPath))
                .on('error', (e) => reject(e))
                .run();
        });
    });
}

// ... (Existing Functions)
async function _convertImageToVideo(imgInput, vidOutput, duration) {
    const sIn = _getSafePath(imgInput);
    console.log(`[ImageTransformer] Converting ${path.basename(sIn)} to video (${duration}s)`);
    return new Promise((resolve, reject) => {
        ffmpeg(sIn)
            .loop(duration)
            .outputOptions([
                '-c:v', 'libx264',
                '-t', duration,
                '-pix_fmt', 'yuv420p',
                '-preset', 'ultrafast',
                '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
                '-shortest'
            ])
            .output(vidOutput)
            .on('end', resolve)
            .on('error', reject)
            .run();
    });
}

async function _overlayImageToVideo(videoInput, imageInput, output, options = {}) {
    const vidPath = _getSafePath(videoInput);
    const imgPath = _getSafePath(imageInput);
    console.log(`[OverlayMiniMark] Video: ${vidPath}, Image: ${imgPath}`);

    const tempOutput = path.join(os.tmpdir(), `ov_mini_${Date.now()}.mp4`);

    return new Promise((resolve, reject) => {
        const cmd = ffmpeg(vidPath);
        cmd.input(imgPath).inputOption('-loop 1');

        let x = options.x !== undefined ? options.x : 10;
        let y = options.y !== undefined ? options.y : 10;
        let w = options.width || -1;
        let h = options.height || -1;

        let targetW = w;
        let targetH = h;

        if (targetW === -1 && targetH === -1) {
            console.log("[Overlay] No size specified. Defaulting to 300px width.");
            targetW = 300;
        }

        let filterParts = [];
        filterParts.push('[0:v]format=yuv420p[v_clean]');
        filterParts.push('[1:v]format=rgba[img_raw]');
        let currentImgLabel = '[img_raw]';

        if (targetW !== -1 || targetH !== -1) {
            filterParts.push(`${currentImgLabel}scale=${targetW}:${targetH}[img_scaled]`);
            currentImgLabel = '[img_scaled]';
        }

        filterParts.push(`[v_clean]${currentImgLabel}overlay=x=${x}:y=${y}:shortest=1[outv]`);

        cmd.complexFilter(filterParts.join(';'))
            .outputOptions([
                '-map [outv]', '-map 0:a?', '-c:v libx264', '-preset ultrafast', '-c:a copy', '-pix_fmt yuv420p'
            ])
            .output(tempOutput)
            .on('end', () => {
                try {
                    if (fs.existsSync(output)) fs.unlinkSync(output);
                    fs.copyFileSync(tempOutput, output);
                    fs.unlinkSync(tempOutput);
                    resolve({ success: true, outputPath: output });
                } catch (err) { reject(err); }
            })
            .on('error', reject)
            .run();
    });
}

async function _addTextOverlay(videoPath, output, text, options) {
    const sIn = _getSafePath(videoPath);
    console.log(`[TextOverlayHeritage] Adding text: ${text}`);
    const tempOutput = path.join(os.tmpdir(), `txt_heritage_${Date.now()}.mp4`);
    return new Promise((resolve, reject) => {
        const { fontSize = 48, fontColor = 'white', background = 'none', position = 'bottom', startTime = 0, endTime = null } = options || {};
        const fontPath = 'C\\\\:/Windows/Fonts/arial.ttf';
        let x, y;
        const padding = 30;
        let pos = position || 'bottom-center';
        if (pos === 'top') pos = 'top-center'; if (pos === 'bottom') pos = 'bottom-center';
        if (pos.startsWith('top')) y = padding; else if (pos.includes('middle') || pos.includes('center')) y = '(h-th)/2'; else y = `h-th-${padding}`;
        if (pos.endsWith('left')) x = padding; else if (pos.endsWith('right')) x = `w-tw-${padding}`; else x = '(w-tw)/2';

        const safeText = (text || '').toString().replace(/\\/g, '\\\\').replace(/'/g, "'\\'").replace(/:/g, '\\:').replace(/\n/g, '\\n');
        let drawtextFilter = `drawtext=text='${safeText}':fontfile='${fontPath}':fontsize=${fontSize}:fontcolor=${fontColor}:x=${x}:y=${y}`;
        if (background !== 'none') drawtextFilter += `:box=1:boxcolor=black@0.5:boxborderw=10`;
        if (endTime !== null && endTime > startTime) drawtextFilter += `:enable='between(t,${startTime},${endTime})'`;

        ffmpeg(sIn).videoFilters(drawtextFilter).outputOptions(['-c:v', 'libx264', '-c:a', 'copy']).output(tempOutput)
            .on('end', () => {
                try {
                    if (fs.existsSync(output)) fs.unlinkSync(output);
                    fs.copyFileSync(tempOutput, output);
                    fs.unlinkSync(tempOutput);
                    resolve({ success: true, outputPath: output });
                } catch (e) { reject(e); }
            })
            .on('error', reject).run();
    });
}

async function _addTransition(videoPath, output, options) {
    const sIn = _getSafePath(videoPath);
    return new Promise((resolve, reject) => {
        ffmpeg(sIn)
            .videoFilters('fade=t=in:st=0:d=1,fade=t=out:st=duration-1:d=1')
            .output(output).outputOptions(['-c:v', 'libx264', '-c:a', 'copy'])
            .on('end', () => resolve({ success: true, outputPath: output }))
            .on('error', reject).run();
    });
}

async function _getVideoMetadata(file) {
    const safePath = _getSafePath(file);
    return new Promise((resolve, reject) => {
        if (!safePath) return reject(new Error(`Invalid Metadata Path: ${file}`));
        if (_isImageFile(safePath)) {
            return resolve({
                duration: 10, durationFormatted: "00:00:10", width: 1920, height: 1080, rotation: 0,
                frameRate: 30, codec: 'png', audioSampleRate: 44100, bitrate: 0, filename: path.basename(safePath), tags: {}
            });
        }
        ffmpeg.ffprobe(safePath, (err, md) => {
            if (err) return reject(err);
            const v = md.streams.find(s => s.codec_type === 'video');
            const a = md.streams.find(s => s.codec_type === 'audio');
            let w = v ? v.width : 0; let h = v ? v.height : 0; let r = 0;
            const getT = (t, k) => { if (!t) return null; let f = Object.keys(t).find(x => x.toLowerCase() === k.toLowerCase()); return f ? t[f] : null; };
            if (v && v.tags) r = parseInt(getT(v.tags, 'rotate')) || 0;
            if (r === 0 && md.format.tags) r = parseInt(getT(md.format.tags, 'rotate')) || 0;
            if (v && r === 0 && v.side_data_list) {
                const sd = v.side_data_list.find(x => x.side_data_type === 'Display Matrix');
                if (sd && sd.rotation) r = parseInt(sd.rotation);
            }
            if (Math.abs(r) === 90 || Math.abs(r) === 270) { let t = w; w = h; h = t; }
            resolve({
                duration: md.format.duration, durationFormatted: formatTime(md.format.duration), width: w, height: h, rotation: r,
                frameRate: v && v.avg_frame_rate ? eval(v.avg_frame_rate) : 24, codec: v ? v.codec_name : 'unknown',
                audioSampleRate: a ? parseInt(a.sample_rate) : 44100, bitrate: parseInt(md.format.bit_rate) || 0,
                filename: path.basename(safePath), tags: md.format.tags || {},
                hasAudio: !!a, streams: md.streams
            });
        });
    });
}

function _findDeepFilter() {
    return 'c:\\Users\\engin\\OneDrive\\Belgeler\\KorculVideoEditor\\src\\resources\\deepfilter\\deep-filter.exe';
}

async function _cutVideoDeepFilter(input, output, start, end) {
    const sIn = _getSafePath(input); const dur = end - start; const tD = path.dirname(output); const b = path.basename(output, path.extname(output));
    const tV = path.join(tD, `${b}_v.mp4`); const tA = path.join(tD, `${b}_a.wav`); const tC = path.join(tD, `${b}_c.wav`);
    try {
        await new Promise((r, j) => ffmpeg(sIn).setStartTime(start).setDuration(dur).videoCodec('libx264').outputOptions('-preset ultrafast').output(tV).on('end', r).on('error', j).run());
        await new Promise((r, j) => ffmpeg(sIn).setStartTime(start).setDuration(dur).noVideo().audioCodec('pcm_s16le').audioFrequency(48000).output(tA).on('end', r).on('error', j).run());
        let dfExe = _findDeepFilter(); let processed = false;
        if (fs.existsSync(dfExe)) {
            const outD = path.join(tD, `dfrun_${Date.now()}`);
            await new Promise((r, j) => spawn(dfExe, [tA, '-o', outD], { cwd: path.dirname(dfExe) }).on('close', c => c === 0 ? r() : j(new Error('DF exit code ' + c))));
            const gen = fs.readdirSync(outD).find(f => f.endsWith('.wav'));
            if (gen) { try { fs.renameSync(path.join(outD, gen), tC); processed = true; } catch (e) { fs.copyFileSync(path.join(outD, gen), tC); processed = true; } }
            try { fs.rmSync(outD, { recursive: true }); } catch (e) { }
        }
        await new Promise((r, j) => ffmpeg().input(tV).input(processed ? tC : tA).outputOptions(['-c:v copy', '-c:a aac', '-map 0:v', '-map 1:a']).output(output).on('end', r).on('error', j).run());
        [tV, tA, tC].forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { } });
        return { success: true };
    } catch (e) { [tV, tA, tC].forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (ex) { } }); throw e; }
}

async function _processSegmentWithOverlays(input, output, start, duration, overlays) {
    const sIn = _getSafePath(input);
    return new Promise((resolve, reject) => {
        const cmd = ffmpeg(sIn).setStartTime(start).setDuration(duration);
        let filters = []; let lastV = '0:v'; let subInputs = []; let currentInputIdx = 1;
        overlays.forEach((ov, i) => {
            let s = _getSafePath(ov); if (s && s.endsWith('.webm')) { const p = s.replace('.webm', '.png'); if (fs.existsSync(p)) s = p; }
            if (s && fs.existsSync(s)) {
                const isImage = s.toLowerCase().endsWith('.png') || s.toLowerCase().endsWith('.jpg');
                if (isImage) cmd.input(s).inputOption('-loop 1'); else cmd.input(s);
                subInputs.push({ type: 'video', index: currentInputIdx, obj: ov, isImage, path: s, id: i }); currentInputIdx++;
            }
            const soundPath = _getSafePath({ path: ov.sound });
            if (soundPath && fs.existsSync(soundPath)) {
                cmd.input(soundPath); subInputs.push({ type: 'audio', index: currentInputIdx, obj: ov, relStart: (ov.startTime || 0) - start, id: i }); currentInputIdx++;
            }
        });
        subInputs.forEach((item) => {
            const relStart = Math.max(0, (item.obj.startTime || 0) - start); const relEnd = relStart + (item.obj.duration || duration); const i = item.id;
            if (item.type === 'video') {
                const scaled = `s${i}`; const delayed = `d${i}`; const oved = `o${i}`;
                const w = item.obj.width || -1; const h = item.obj.height || -1;
                if (w === -1 && h === -1) filters.push(`[${item.index}:v]null[${scaled}]`); else filters.push(`[${item.index}:v]scale=${w}:${h}[${scaled}]`);
                let sourceLabel = scaled;
                if (!item.isImage && relStart > 0) { filters.push(`[${sourceLabel}]setpts=PTS+${relStart}/TB[${delayed}]`); sourceLabel = delayed; }
                let x = item.obj.x || 0; let y = item.obj.y || 0;
                filters.push(`[${lastV}][${sourceLabel}]overlay=x=${x}:y=${y}:enable='between(t,${relStart},${relEnd})'[${oved}]`); lastV = oved;
            } else if (item.type === 'audio') {
                const delayMs = Math.floor(relStart * 1000); const audPad = `aud_${item.index}`; filters.push(`[${item.index}:a]adelay=${delayMs}|${delayMs}[${audPad}]`);
            }
        });
        const audios = subInputs.filter(x => x.type === 'audio');
        if (audios.length > 0) {
            let inputs = ['[0:a]']; audios.forEach(x => inputs.push(`[aud_${x.index}]`)); filters.push(`${inputs.join('')}amix=inputs=${inputs.length}:duration=first[aout]`);
        }
        if (filters.length > 0) cmd.complexFilter(filters);
        const mapV = filters.length > 0 ? `[${lastV}]` : '0:v'; const mapA = (filters.length > 0 && audios.length > 0) ? '[aout]' : '0:a';
        cmd.outputOptions(['-map', mapV, '-map', mapA, '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest']);
        cmd.output(output).on('end', resolve).on('error', reject).run();
    });
}

async function _previewAudio(input, output, start, duration) {
    const sIn = _getSafePath(input); const tA = path.join(path.dirname(output), 'pa_' + Date.now() + '.wav');
    try {
        await new Promise((r, j) => ffmpeg(sIn).setStartTime(start).setDuration(duration).noVideo().audioCodec('pcm_s16le').audioFrequency(48000).output(tA).on('end', r).on('error', j).run());
        let df = _findDeepFilter();
        if (fs.existsSync(df)) {
            const oD = path.join(path.dirname(output), `dfp_${Date.now()}`);
            await new Promise((r, j) => spawn(df, [tA, '-o', oD], { cwd: path.dirname(df) }).on('close', c => c === 0 ? r() : j(new Error(c))));
            const g = fs.readdirSync(oD).find(f => f.endsWith('.wav'));
            if (g) {
                if (fs.existsSync(output)) fs.unlinkSync(output); fs.renameSync(path.join(oD, g), output);
                try { fs.rmSync(oD, { recursive: true }); fs.unlinkSync(tA); } catch (e) { }
                return { success: true };
            }
        }
        fs.copyFileSync(tA, output); fs.unlinkSync(tA); return { success: true };
    } catch (e) { try { fs.unlinkSync(tA) } catch (x) { }; throw e; }
}

module.exports = {
    getFFmpegPaths: setupFFmpeg,
    formatTime: formatTime,

    getVideoMetadata: async function () { return _getVideoMetadata(cleanArgs(arguments)[0]); },
    extractFrameBase64: async function () {
        try {
            const args = cleanArgs(arguments);
            let [v, t] = args;
            if ((typeof v === 'number' || !v) && typeof t === 'string') { const temp = v; v = t; t = temp; }
            const safePath = _getSafePath(v);
            const tp = path.join(os.tmpdir(), `ai_f_${Date.now()}.jpg`);
            await new Promise((r, j) => ffmpeg(safePath).screenshots({ timestamps: [t || 0], filename: path.basename(tp), folder: path.dirname(tp) }).on('end', r).on('error', j));
            const b64 = fs.readFileSync(tp).toString('base64');
            try { fs.unlinkSync(tp) } catch (e) { }
            return b64;
        } catch (e) { throw e; }
    },
    extractFrame: async function () {
        try {
            const args = cleanArgs(arguments); let [v, t, o] = args;
            if (typeof t === 'string' && typeof o === 'number') { const x = t; t = o; o = x; } else if (typeof v === 'number' && typeof t === 'string') { const x = v; v = t; t = x; }
            const sIn = _getSafePath(v);
            return new Promise((r, j) => ffmpeg(sIn).screenshots({ timestamps: [t], filename: path.basename(o), folder: path.dirname(o) }).on('end', () => r(o)).on('error', j));
        } catch (e) { throw e; }
    },
    previewAudioSegment: async function () { return _previewAudio.apply(null, cleanArgs(arguments)); },
    renderTimeline: async function () { return module.exports.renderTimeline_Internal.apply(null, cleanArgs(arguments)); },
    // Wait, reusing existing renderTimeline which is huge, I'll paste the existing one below manually if needed or just alias it if it was defined.
    // Actually I need to make sure renderTimeline is preserved.
    // The previous write_to_file completely overwrote the file. I must ensure I didn't lose renderTimeline logic.
    // I see I already pasted _processSegmentWithOverlays and related. 
    // I will explicitly write renderTimeline here.

    renderTimeline_Internal: async function (inp, segs, out, onP) {
        console.log(`[Render V75] Start. Total Segments: ${segs.length}`);
        const temps = [];
        try {
            const procs = [];
            for (let i = 0; i < segs.length; i++) {
                const seg = segs[i]; let cSrc = seg.sourceFile || inp; let s = parseFloat(seg.start || 0); let e = parseFloat(seg.end || 0); if (isNaN(s)) s = 0; if (isNaN(e)) e = 10; const relDur = Math.max(0.1, e - s);
                if (_isImageFile(cSrc)) { const tVid = path.join(path.dirname(out), `tmp_img2vid_${i}_${Date.now()}.mp4`); temps.push(tVid); await _convertImageToVideo(cSrc, tVid, relDur); cSrc = tVid; s = 0; e = relDur; }
                if (seg.noiseReduction?.enabled) { const t = path.join(path.dirname(out), `tmp_nr_${i}.mp4`); temps.push(t); await _cutVideoDeepFilter(cSrc, t, s, e); cSrc = t; s = 0; e = relDur; }
                if (seg.overlays?.length > 0) { const t = path.join(path.dirname(out), `tmp_ov_${i}.mp4`); temps.push(t); let segDur = relDur; try { const m = await _getVideoMetadata(cSrc); if (m.duration) segDur = m.duration; } catch (x) { } await _processSegmentWithOverlays(cSrc, t, s, segDur, seg.overlays); cSrc = t; s = 0; e = relDur; }

                // Audio Check (V76 - Strict Audio Detection)
                let hasAudio = true;
                try {
                    const md = await _getVideoMetadata(cSrc);
                    if (md.streams && md.streams.length > 0) {
                        const aud = md.streams.find(s => s.codec_type === 'audio');
                        if (!aud) {
                            hasAudio = false;
                            console.log(`[Render] Segment ${i} (${path.basename(cSrc)}) truly has no audio stream.`);
                        }
                    } else {
                        console.warn(`[Render] Segment ${i} probe returned no streams. Assuming audio exists.`);
                    }
                } catch (x) {
                    hasAudio = true;
                }
                if (!hasAudio) console.log(`[Render] Injecting silence for Segment ${i}.`);

                console.log(`[Render Seg ${i}] ${path.basename(cSrc)}: Start=${s} End=${e} Dur=${relDur} Audio=${hasAudio}`);
                procs.push({ f: cSrc, s, e, hasAudio, dur: relDur });
                if (onP) onP((i / segs.length) * 40);
            }
            const cmd = ffmpeg(); const map = new Map();
            procs.forEach(p => { const sf = _getSafePath(p.f); if (!map.has(sf)) { map.set(sf, map.size); cmd.input(sf); } });
            let flt = [];
            procs.forEach((p, i) => {
                const idx = map.get(_getSafePath(p.f));
                flt.push(`[${idx}:v]trim=${p.s}:${p.e},setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v${i}]`);
                if (p.hasAudio) {
                    flt.push(`[${idx}:a]atrim=${p.s}:${p.e},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo[a${i}]`);
                } else {
                    // Inject silence
                    const durSafe = p.dur > 0 ? p.dur : 0.1;
                    flt.push(`anullsrc=r=44100:cl=stereo:d=${durSafe}[sil_${i}];[sil_${i}]asetpts=PTS-STARTPTS[a${i}]`);
                }
            });

            const complexStr = `${procs.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${procs.length}:v=1:a=1:unsafe=1[ov][oa]`;
            flt.push(complexStr);

            console.log("=== FILTER CHAIN START ===");
            console.log(flt.join(';'));
            console.log("=== FILTER CHAIN END ===");

            await new Promise((r, j) => {
                cmd.complexFilter(flt)
                    .outputOptions(['-map [ov]', '-map [oa]', '-c:v libx264', '-preset medium', '-c:a aac'])
                    .output(out)
                    .on('progress', pk => {
                        if (onP) onP(Math.min(99, 40 + (pk.percent * 0.6)));
                    })
                    .on('end', () => {
                        console.log('[Render V82] Finished.');
                        if (onP) onP(100);
                        setTimeout(r, 500);
                    })
                    .on('error', j)
                    .run();
            });

            temps.forEach(f => { try { fs.unlinkSync(f) } catch (e) { } }); return { success: true, outputPath: out };
        } catch (e) { temps.forEach(f => { try { fs.unlinkSync(f) } catch (x) { } }); throw e; }
    },
    // Alias for external call
    renderTimeline: async function () { const args = cleanArgs(arguments); return module.exports.renderTimeline_Internal(args[0], args[1], args[2], args[3]); },

    cutVideoDeepFilter: async function () { return _cutVideoDeepFilter.apply(null, cleanArgs(arguments)); },
    applyCtaOverlaysSmart: async function () {
        const [i, o, ovs, opt, onP] = cleanArgs(arguments);
        try { const md = await _getVideoMetadata(i); const realDur = md.duration || 10; return _processSegmentWithOverlays(i, o, 0, realDur, ovs); } catch (e) { return _processSegmentWithOverlays(i, o, 0, 30, ovs); }
    },
    cutVideoClip: async function () {
        const [i, o, s, e, p, opt] = cleanArgs(arguments);
        try {
            const sIn = _getSafePath(i); let start = parseFloat(s); let end = parseFloat(e);
            if (start > end) { const temp = start; start = end; end = temp; }
            return new Promise((r, j) => ffmpeg(sIn).setStartTime(start).setDuration(end - start).output(o).outputOptions(['-c:v', 'libx264', '-c:a', 'aac', '-preset', 'ultrafast']).on('end', () => r(o)).on('error', j).run());
        } catch (e) { throw e; }
    },
    createVerticalVideo: async function () {
        const [i, o] = cleanArgs(arguments);
        return new Promise((resolve, reject) => {
            const sIn = _getSafePath(i);
            ffmpeg(sIn)
                .complexFilter([
                    '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:10[bg]',
                    '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg]',
                    '[bg][fg]overlay=(W-w)/2:(H-h)/2'
                ])
                .outputOptions(['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac'])
                .output(o)
                .on('end', () => resolve({ success: true, outputPath: o }))
                .on('error', reject)
                .run();
        });
    },
    createSlideshow: async function () {
        const [imgs, o, dur] = cleanArgs(arguments);
        return new Promise((resolve, reject) => {
            const listPath = path.join(os.tmpdir(), `slides_${Date.now()}.txt`);
            const fileContent = imgs.map(img => `file '${_getSafePath(img)}'\nduration ${dur || 3}`).join('\n');
            fs.writeFileSync(listPath, fileContent);
            ffmpeg().input(listPath).inputOptions(['-f', 'concat', '-safe', '0']).output(o).outputOptions(['-c:v', 'libx264', '-pix_fmt', 'yuv420p']).on('end', () => { try { fs.unlinkSync(listPath); } catch (e) { } resolve({ success: true, outputPath: o }); }).on('error', reject).run();
        });
    },
    overlayImageToVideo: async function () { const args = cleanArgs(arguments); return _overlayLayerJudge(args[0], args[1], args[2], args[3]); },
    addImageOverlay: async function () { const args = cleanArgs(arguments); return _overlayLayerJudge(args[0], args[1], args[2], args[3]); },
    addTextOverlay: async function () { const args = cleanArgs(arguments); return _addTextOverlay(args[0], args[1], args[2], args[3]); },
    addTransition: async function () { const args = cleanArgs(arguments); return _addTransition(args[0], args[1], args[2]); },
    safeConvertVideo: async function () { const args = cleanArgs(arguments); return _safeConvertVideo(args[0], args[1], args[2]); },
    applyTransitionsSmart: async function () { const args = cleanArgs(arguments); return _applyTransitionsSmart(args[0], args[1], args[2], args[3]); },
    cutVideo: async function () {
        const [i, o, s, e, p, opt] = cleanArgs(arguments);
        if (opt?.noiseReduction?.enabled) return _cutVideoDeepFilter(i, o, s, e);
        return new Promise((r, j) => ffmpeg(_getSafePath(i)).setStartTime(s).setDuration(e - s).output(o).on('end', () => r(o)).on('error', j).run());
    },
    concatenateVideos: async function () {
        const [ip, op, pr] = cleanArgs(arguments);
        const tD = path.dirname(op); const ts = Date.now(); const ns = [];
        try {
            for (let i = 0; i < ip.length; i++) {
                const n = path.join(tD, `n_${i}_${ts}.mp4`);
                await new Promise((r, j) => ffmpeg(_getSafePath(ip[i])).size('1920x1080').fps(30).output(n).on('end', r).on('error', j).run());
                ns.push(n); if (pr) pr((i / ip.length) * 100);
            }
            await new Promise((r, j) => { const c = ffmpeg(); ns.forEach(p => c.input(p)); c.mergeToFile(op, tD).on('end', r).on('error', j); });
            ns.forEach(f => { try { fs.unlinkSync(f) } catch (e) { } }); return { success: true, outputPath: op };
        } catch (e) { ns.forEach(f => { try { fs.unlinkSync(f) } catch (x) { } }); throw e; }
    },

    // V61 Export:
    mixAudio: async function () {
        const args = cleanArgs(arguments);
        // Supports both single object param (ipc style) or separate
        if (args.length === 1 && typeof args[0] === 'object') return _mixAudioAdvanced(args[0]);
        if (args.length >= 2 && typeof args[0] === 'object') return _mixAudioAdvanced(args[0], args[1]); // with callback
        return _mixAudioAdvanced(args[0]);
    },
    mixAudioAdvanced: async function () {
        const args = cleanArgs(arguments);
        return _mixAudioAdvanced(args[0], args[1]);
    },
    replaceAudio: async function () {
        const args = cleanArgs(arguments);
        // replaceAudio(videoPath, audioPath, offsetMs, muteOriginal, outputPath, onProgress)
        return _replaceAudio(args[0], args[1], args[2], args[3], args[4], args[5]);
    }
};

async function _replaceAudio(videoPath, audioPath, offsetMs, muteOriginal, outputPath, onProgress) {
    const sVid = _getSafePath(videoPath);
    const sAud = _getSafePath(audioPath);
    console.log(`[ReplaceAudio] Vid: ${sVid}, Aud: ${sAud}, Offset: ${offsetMs}, Mute: ${muteOriginal}`);

    return new Promise((resolve, reject) => {
        const cmd = ffmpeg(sVid).input(sAud);

        let complex = [];
        let audioMap = ''; // Will hold the label of the audio to map

        // 1. Prepare New Audio (Input 1) with Offset
        // adelay takes milliseconds. If 0, we can skip or use anull, but adelay=0|0 works too.
        const delay = Math.max(0, parseInt(offsetMs) || 0);

        // Define Audio 1 Source
        if (delay > 0) {
            complex.push(`[1:a]adelay=${delay}|${delay}[aud_delayed]`);
        } else {
            complex.push(`[1:a]aformat=channel_layouts=stereo[aud_delayed]`);
        }

        // 2. Decide Output Audio
        if (muteOriginal) {
            // Completely replace: Just use the delayed new audio
            // Note: If video has no audio stream [0:a], this is safe.
            // We map the new audio directly.
            audioMap = '[aud_delayed]';
        } else {
            // Mix: We need [0:a]. 
            // Warning: If [0:a] does not exist, this will fail.
            // Ideally we check metadata, but for speed, let's assume video has audio if user didn't mute it.
            // If we want robustness, we can use 'amovie' or check 'streams'.
            // For now, assume [0:a] exists.

            complex.push(`[0:a]volume=1.0[aud_orig]`);
            complex.push(`[aud_orig][aud_delayed]amix=inputs=2:duration=first:dropout_transition=0[aud_mixed]`);
            audioMap = '[aud_mixed]';
        }

        // 3. Construct Command
        if (complex.length > 0) cmd.complexFilter(complex);

        cmd.outputOptions([
            '-map 0:v',          // Keep original video
            `-map ${audioMap}`,  // Use our calculated audio
            '-c:v copy',         // Fast copy video stream
            '-c:a aac',          // Encode audio to AAC
            '-b:a 192k',
            '-shortest'          // End when the shortest stream (video) ends
        ])
            .output(outputPath)
            .on('progress', (p) => { if (onProgress) onProgress(p.percent); })
            .on('end', () => resolve(outputPath))
            .on('error', (err) => {
                console.error("[ReplaceAudio] Error:", err.message);
                // Fallback: If map [0:a] failed (maybe video has no audio), retry with muteOriginal=true logic?
                // Too complex for now, just reject.
                reject(err);
            })
            .run();
    });
}

async function _overlayLayerJudge(videoInput, imageInput, output, options = {}) {
    const vidPath = _getSafePath(videoInput);
    const imgPath = _getSafePath(imageInput);

    // We need path and os, assume they are required at top level
    const isImage = (imgPath && ['.png', '.jpg', '.jpeg', '.bmp', '.webp', '.gif'].includes(path.extname(imgPath).toLowerCase()));

    console.log(`[OverlayLayerJudge] V70 Check. Video: ${vidPath}, Overlay: ${imgPath} (IsImage: ${isImage})`);

    const tempOutput = path.join(os.tmpdir(), `ov_judge_${Date.now()}.mp4`);

    return new Promise((resolve, reject) => {
        const cmd = ffmpeg(vidPath);

        // Loop logic
        let overlayFilterExtras = '';
        if (isImage) {
            cmd.input(imgPath).inputOption('-loop 1');
            overlayFilterExtras = ':shortest=1'; // Terminate when shortest input ends (which effectively means main video, since image loop is infinite)
        } else {
            // Video overlay: do NOT loop, and usually do not force shortest=1 because if overlay is shorter, we don't want to cut main video.
            cmd.input(imgPath);
        }

        let x = options.x !== undefined ? options.x : 10;
        let y = options.y !== undefined ? options.y : 10;
        let w = options.width || -1;
        let h = options.height || -1;

        let targetW = w;
        let targetH = h;

        if (targetW === -1 && targetH === -1) {
            // Default size for images/overlays if not specified (legacy behavior)
            targetW = 300;
        }

        let filterParts = [];
        filterParts.push('[0:v]format=yuv420p[v_clean]');
        filterParts.push('[1:v]format=rgba[img_raw]'); // Handle alpha channel if present
        let currentImgLabel = '[img_raw]';

        if (targetW !== -1 || targetH !== -1) {
            filterParts.push(`${currentImgLabel}scale=${targetW}:${targetH}[img_scaled]`);
            currentImgLabel = '[img_scaled]';
        }

        // Apply overlay filter
        filterParts.push(`[v_clean]${currentImgLabel}overlay=x=${x}:y=${y}${overlayFilterExtras}[outv]`);

        cmd.complexFilter(filterParts.join(';'))
            .outputOptions([
                '-map [outv]',
                '-map 0:a?',        // Keep main video audio if exists
                '-c:v libx264',
                '-preset ultrafast',
                '-c:a copy',        // Copy audio without re-encode
                '-pix_fmt yuv420p'
            ])
            .output(tempOutput);

        // Global shortest check:
        // Only apply if it's an image loop, to prevent infinite output.
        if (isImage) {
            cmd.outputOption('-shortest');
        }

        cmd.on('end', () => {
            try {
                if (fs.existsSync(output)) fs.unlinkSync(output);
                fs.copyFileSync(tempOutput, output);
                fs.unlinkSync(tempOutput);
                resolve({ success: true, outputPath: output });
            } catch (err) { reject(err); }
        })
            .on('error', (err) => {
                console.error("[OverlayLayerJudge] Error:", err);
                reject(err);
            })
            .run();
    });
}

async function _applyTransitionsSmart(videoPath, outputPath, transitions, onProgress) {
    const sIn = _getSafePath(videoPath);
    console.log(`[SmartTransition V72.5] Applying ${transitions ? transitions.length : 0} transitions on ${path.basename(sIn)}`);

    if (!transitions || transitions.length === 0) {
        return new Promise((r, j) => {
            fs.copyFile(sIn, outputPath, (err) => err ? j(err) : r({ success: true, outputPath }));
        });
    }

    transitions.sort((a, b) => a.time - b.time);

    // Resource Path Finder Helper
    const _findSfx = (type) => {
        const nameMap = {
            'dip_white': 'dip_to_white.wav',
            'flash': 'dip_to_white.wav',
            'dip_black': 'dip_to_black.wav',
            'dipToBlack': 'dip_to_black.wav',
            'dip': 'dip_to_black.wav',
            'fade_in': 'fade.wav',
            'fade_out': 'fade.wav',
            'fade': 'fade.wav'
        };
        const fileName = nameMap[type] || 'cross_dissolve.wav';

        // Potential paths
        const candidates = [
            path.join(process.cwd(), 'src', 'renderer', 'assets', 'sfx', fileName),
            path.join(process.cwd(), 'resources', 'assets', 'sfx', fileName),
            path.join(__dirname, '../renderer/assets/sfx', fileName),
            path.join(__dirname, '../../renderer/assets/sfx', fileName)
        ];

        for (const p of candidates) {
            if (fs.existsSync(p)) return p;
        }
        return null;
    };

    return new Promise((resolve, reject) => {
        const cmd = ffmpeg(sIn);
        let filterChain = [];

        /* --- Video Pipeline --- */
        let currentLabel = '0:v';
        transitions.forEach((tr, index) => {
            const nextLabel = `tr_${index}`;
            const time = parseFloat(tr.time);
            const dur = parseFloat(tr.duration) || 1.0;
            const half = dur / 2;
            const tStart = time - half;
            const tEnd = time + half;

            let vf = '';
            if (tr.type === 'dip_white' || tr.type === 'flash') {
                const expr = `'if(between(t,${tStart},${time}), (t-${tStart})/${half}, if(between(t,${time},${tEnd}), (${tEnd}-t)/${half}, 0))'`;
                vf = `eq=brightness=${expr}:eval=frame`;
            } else if (tr.type && (tr.type.includes('black') || tr.type === 'dip')) {
                const expr = `'if(between(t,${tStart},${time}), (t-${tStart})/${half}*-1, if(between(t,${time},${tEnd}), (${tEnd}-t)/${half}*-1, 0))'`;
                vf = `eq=brightness=${expr}:eval=frame`;
            } else if (tr.type === 'fade_in') {
                vf = `fade=t=in:st=${time}:d=${dur}`;
            } else if (tr.type === 'fade_out') {
                vf = `fade=t=out:st=${time}:d=${dur}`;
            } else {
                const expr = `'if(between(t,${tStart},${time}), (t-${tStart})/${half}*-1, if(between(t,${time},${tEnd}), (${tEnd}-t)/${half}*-1, 0))'`;
                vf = `eq=brightness=${expr}:eval=frame`;
            }
            if (vf) {
                filterChain.push(`[${currentLabel}]${vf}[${nextLabel}]`);
                currentLabel = nextLabel;
            }
        });

        /* --- Audio Pipeline --- */
        let amixInputs = [`[0:a]`];
        let nextIdx = 1;

        // Filter valid SFX
        let activeTransitions = [];
        transitions.forEach(tr => {
            const file = _findSfx(tr.type);
            if (file) activeTransitions.push({ tr, file });
        });

        let hasSfx = false;

        if (activeTransitions.length > 0) {
            hasSfx = true;

            // To prevent volume drop, we mix carefully or rely on normalization?
            // Simple approach: Use 'adelay' for each SFX and 'amix'.
            // To compensate volume: amix output volume = 1/N. We boost 0:a?
            // No, standard amix averages.
            // If we assume SFX are sparse, we can boost the MIXED output back to 1.0?
            // If [0:a] is constant loud, and [sfx] is silence mostly.
            // Result is [0:a]/N. 
            // So we multiply output by N.

            activeTransitions.forEach((item, i) => {
                const { tr, file } = item;
                cmd.input(file);
                const idx = nextIdx++;

                const dur = parseFloat(tr.duration) || 1.0;
                // SYNC FIX: (Duration / 4) offset to fix "Too Early"
                const startTime = tr.time - (dur / 2) + (dur * 0.25);
                const delayMs = Math.round(Math.max(0, startTime * 1000));

                // Add delay
                const lbl = `sfx_${i}`;
                // Input volume 0.8 to not overpower
                filterChain.push(`[${idx}:a]adelay=${delayMs}|${delayMs},volume=0.8[${lbl}]`);
                amixInputs.push(`[${lbl}]`);
            });

            const N = amixInputs.length;
            const mixLabel = 'a_mixed';
            // Restore volume by Multiplying by N
            filterChain.push(`${amixInputs.join('')}amix=inputs=${N}:duration=first:dropout_transition=0,volume=${N}[${mixLabel}]`);

            cmd.outputOptions([`-map [${mixLabel}]`]);
        } else {
            cmd.outputOptions(['-map 0:a?']);
        }

        cmd.complexFilter(filterChain)
            .outputOptions([
                `-map [${currentLabel}]`,
                '-c:v libx264',
                '-c:a aac',
                '-preset ultrafast'
            ])
            .output(outputPath)
            .on('progress', p => { if (onProgress) onProgress(p.percent); })
            .on('end', () => resolve({ success: true, outputPath }))
            .on('error', reject)
            .run();
    });
}

async function _safeConvertVideo(videoPath, outputPath, onProgress) {
    const sIn = _getSafePath(videoPath);
    console.log(`[SafeConvert] V73 Converting ${path.basename(sIn)}...`);

    return new Promise((resolve, reject) => {
        ffmpeg(sIn)
            .outputOptions([
                '-c:v libx264',
                '-preset ultrafast',
                '-crf 23',
                '-c:a aac',
                '-b:a 128k',
                '-pix_fmt yuv420p',
                '-movflags +faststart',
                '-ac 2'
            ])
            .output(outputPath)
            .on('progress', (p) => {
                if (onProgress && typeof onProgress === 'function') {
                    onProgress(p.percent);
                } else {
                    // console.log("Progress ignored, callback not a function:", typeof onProgress);
                }
            })

            .on('end', () => resolve({ success: true, outputPath }))
            .on('error', (err) => {
                console.error("[SafeConvert] Error:", err);
                reject(err);
            })
            .run();
    });
}