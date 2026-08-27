const fs = require('fs');
const path = require('path');
const { analyzeSource, getKeyframes } = require('./source-profile-analyzer');
const { runFfmpeg } = require('./continuous-audio-renderer');
const { getAvailableEncoders, atomicReplace } = require('./source-aware-renderer');
const {
    resolveBoundaryEncoder,
    renderHybridChunk,
    writeConcatList
} = require('./hybrid-smart-renderer');

function transitionWindow(transition, duration) {
    const type = String(transition.type || transition.transitionType || '');
    const time = Math.max(0, Number(transition.time || 0));
    const effectDuration = Math.max(0.001, Number(transition.duration || 1));
    if (type === 'fade_in' || type === 'fade_out') {
        return { start: time, end: Math.min(duration, time + effectDuration) };
    }
    return {
        start: Math.max(0, time - effectDuration / 2),
        end: Math.min(duration, time + effectDuration / 2)
    };
}

function previousKeyframe(keyframes, time) {
    let result = 0;
    for (const keyframe of keyframes) {
        if (keyframe > time + 0.000001) break;
        result = keyframe;
    }
    return result;
}

function nextKeyframe(keyframes, time, duration) {
    for (const keyframe of keyframes) {
        if (keyframe >= time - 0.000001) return keyframe;
    }
    return duration;
}

function buildSparseTransitionPlan(transitions, keyframes, duration, frameRate = 25) {
    const frameStep = 1 / Math.max(1, Number(frameRate || 25));
    const windows = transitions
        .map((transition) => transitionWindow(transition, duration))
        .filter((window) => window.end - window.start > frameStep / 2)
        .map((window) => ({
            start: previousKeyframe(keyframes, Math.max(0, window.start - frameStep)),
            end: nextKeyframe(keyframes, Math.min(duration, window.end + frameStep), duration)
        }))
        .sort((left, right) => left.start - right.start);

    const merged = [];
    for (const window of windows) {
        const previous = merged[merged.length - 1];
        if (previous && window.start <= previous.end + frameStep) {
            previous.end = Math.max(previous.end, window.end);
        } else {
            merged.push({ ...window });
        }
    }

    const chunks = [];
    let cursor = 0;
    for (const window of merged) {
        if (window.start - cursor > frameStep / 2) {
            chunks.push({ type: 'copy', start: cursor, end: window.start });
        }
        if (window.end - window.start > frameStep / 2) {
            chunks.push({ type: 'encode', start: window.start, end: window.end });
        }
        cursor = Math.max(cursor, window.end);
    }
    if (duration - cursor > frameStep / 2) chunks.push({ type: 'copy', start: cursor, end: duration });
    return chunks;
}

function buildTransitionFilter(transitions, offset) {
    const filters = [];
    for (const transition of transitions) {
        const type = String(transition.type || transition.transitionType || '');
        const time = Number(transition.time || 0) - offset;
        const duration = Math.max(0.001, Number(transition.duration || 1));
        const half = duration / 2;
        const start = time - half;
        const end = time + half;

        if (type === 'dip_white' || type === 'flash') {
            filters.push(`eq=brightness='if(between(t,${start},${time}),(t-${start})/${half},if(between(t,${time},${end}),1-(t-${time})/${half},0))':eval=frame`);
        } else if (type.includes('black') || ['dip', 'dipToBlack', 'dibtoblack'].includes(type)) {
            filters.push(`eq=brightness='if(between(t,${start},${time}),(t-${start})/${half}*-1,if(between(t,${time},${end}),-1+(t-${time})/${half},0))':eval=frame`);
        } else if (type === 'fade_in') {
            filters.push(`fade=t=in:st=${time}:d=${duration}`);
        } else if (type === 'fade_out') {
            filters.push(`fade=t=out:st=${time}:d=${duration}`);
        } else if (['fade', 'cross_dissolve', 'crossDissolve', 'crossdissolve'].includes(type)) {
            const shortHalf = half * 0.5;
            const shortStart = time - shortHalf;
            const shortEnd = time + shortHalf;
            filters.push(`eq=brightness='if(between(t,${shortStart},${time}),(t-${shortStart})/${shortHalf}*-1,if(between(t,${time},${shortEnd}),-1+(t-${time})/${shortHalf},0))':eval=frame`);
        } else if (type === 'wiperight' || type === 'wipeRight') {
            filters.push(`drawbox=x=0:y=0:w='min(iw,iw*(t-${start})/${half})':h=ih:color=black:t=fill:enable='between(t,${start},${time})'`);
            filters.push(`drawbox=x='min(iw,iw*(t-${time})/${half})':y=0:w='max(0,iw-iw*(t-${time})/${half})':h=ih:color=black:t=fill:enable='between(t,${time},${end})'`);
        } else if (type === 'wipeleft' || type === 'wipeLeft') {
            filters.push(`drawbox=x='max(0,iw-iw*(t-${start})/${half})':y=0:w='min(iw,iw*(t-${start})/${half})':h=ih:color=black:t=fill:enable='between(t,${start},${time})'`);
            filters.push(`drawbox=x=0:y=0:w='max(0,iw-iw*(t-${time})/${half})':h=ih:color=black:t=fill:enable='between(t,${time},${end})'`);
        }
    }
    return filters.join(',');
}

function overlapsChunk(transition, chunk, duration) {
    const window = transitionWindow(transition, duration);
    return window.end >= chunk.start && window.start <= chunk.end;
}

async function muxSparseResult({ ffmpegPath, videoListPath, sourcePath, outputPath, duration, sfxFiles, profile, onProgress }) {
    const extension = path.extname(outputPath) || '.mp4';
    const partialPath = path.join(path.dirname(outputPath), `${path.basename(outputPath, extension)}.sparse-partial-${Date.now()}${extension}`);
    const args = ['-y', '-f', 'concat', '-safe', '0', '-i', videoListPath, '-i', sourcePath];
    for (const item of sfxFiles) args.push('-i', item.file);
    args.push('-map', '0:v:0', '-c:v', 'copy');

    const sourceAudio = profile.audio?.[0];
    if (sfxFiles.length && sourceAudio) {
        const sampleRate = Math.max(32000, Number(sourceAudio.sampleRate || 48000));
        const filters = [`[1:a:0]aformat=sample_rates=${sampleRate}[a_orig]`];
        const inputs = ['[a_orig]'];
        sfxFiles.forEach((item, index) => {
            const delayTime = Number.isFinite(Number(item.delayTime))
                ? Number(item.delayTime)
                : Number(item.time || 0) - Number(item.duration || 0) * 0.25;
            const delay = Math.round(Math.max(0, delayTime * 1000));
            const volume = Math.max(0, Number.isFinite(Number(item.volume)) ? Number(item.volume) : 0.5);
            const trim = Number(item.trimDuration) > 0 ? `atrim=0:${Number(item.trimDuration)},` : '';
            filters.push(`[${index + 2}:a:0]${trim}asetpts=PTS-STARTPTS,aformat=sample_rates=${sampleRate},adelay=${delay}|${delay},volume=${volume},apad[sfx_${index}]`);
            inputs.push(`[sfx_${index}]`);
        });
        const count = inputs.length;
        filters.push(`${inputs.join('')}amix=inputs=${count}:duration=first,volume=${count}[a_out]`);
        args.push('-filter_complex', filters.join(';'), '-map', '[a_out]', '-c:a', 'aac', '-b:a', String(Math.max(192000, Number(sourceAudio.bitrate || 0))));
    } else if (sourceAudio) {
        args.push('-map', '1:a:0', '-c:a', 'copy');
    }
    args.push('-map_metadata', '1', '-map_chapters', '1', '-fflags', '+genpts', '-avoid_negative_ts', 'make_zero', '-t', duration.toFixed(6));
    if (['.mp4', '.mov', '.m4v'].includes(extension.toLowerCase())) args.push('-movflags', '+faststart');
    args.push(partialPath);

    try {
        await runFfmpeg(ffmpegPath, args, { duration, onProgress });
        await atomicReplace(partialPath, outputPath);
    } catch (error) {
        try { fs.unlinkSync(partialPath); } catch (_cleanupError) {}
        throw error;
    }
}

async function renderSparseTransitions({ ffmpegPath, ffprobePath, inputPath, outputPath, transitions, sfxFiles = [], onProgress = null }) {
    const profile = await analyzeSource(ffprobePath, inputPath, { force: true });
    const codec = String(profile.video?.codec || '').toLowerCase();
    const rotation = ((Number(profile.video?.rotation || 0) % 360) + 360) % 360;
    if (!profile.video || !['h264', 'hevc', 'h265'].includes(codec) || profile.video.variableFrameRate || ![0, 90, 180, 270].includes(rotation)) {
        return { success: false, fallbackRequired: true, reason: 'sparse_transition_source_not_supported' };
    }
    const encoders = await getAvailableEncoders(ffmpegPath);
    const encoder = resolveBoundaryEncoder(profile, encoders);
    if (!encoder?.codec) return { success: false, fallbackRequired: true, reason: 'sparse_transition_encoder_not_available' };

    const duration = Math.max(0, Number(profile.duration || profile.video.duration || 0));
    const keyframes = await getKeyframes(ffprobePath, inputPath, {
        duration,
        onProgress: (percent) => onProgress?.(Math.min(4, Number(percent || 0) * 0.04))
    });
    const chunks = buildSparseTransitionPlan(transitions, keyframes, duration, profile.video.averageFrameRate);
    if (!chunks.length || !chunks.some((chunk) => chunk.type === 'encode')) {
        return { success: false, fallbackRequired: true, reason: 'sparse_transition_plan_empty' };
    }

    const tempBase = path.join(path.dirname(outputPath), `evd_sparse_transition_${Date.now()}_${process.pid}`);
    const chunkFiles = [];
    const listPath = `${tempBase}.concat.txt`;
    const encodedDuration = chunks.filter((chunk) => chunk.type === 'encode').reduce((sum, chunk) => sum + chunk.end - chunk.start, 0);
    let completedDuration = 0;
    try {
        for (let index = 0; index < chunks.length; index += 1) {
            const chunk = chunks[index];
            const chunkDuration = chunk.end - chunk.start;
            const chunkPath = `${tempBase}.chunk-${index}.ts`;
            const relevantTransitions = transitions.filter((transition) => overlapsChunk(transition, chunk, duration));
            chunkFiles.push(chunkPath);
            await renderHybridChunk({
                ffmpegPath,
                source: inputPath,
                chunk,
                outputPath: chunkPath,
                sourceProfile: profile,
                targetProfile: profile,
                encoder,
                videoFilter: chunk.type === 'encode' ? buildTransitionFilter(relevantTransitions, chunk.start) : '',
                onProgress: (percent) => onProgress?.(4 + ((completedDuration + chunkDuration * Number(percent || 0) / 100) / duration) * 82)
            });
            completedDuration += chunkDuration;
        }
        writeConcatList(listPath, chunkFiles);
        await muxSparseResult({
            ffmpegPath,
            videoListPath: listPath,
            sourcePath: inputPath,
            outputPath,
            duration,
            sfxFiles,
            profile,
            onProgress: (percent) => onProgress?.(86 + Number(percent || 0) * 0.14)
        });
        onProgress?.(100);
        console.info('[EVD Sparse Transition Complete]', {
            transitionCount: transitions.length,
            chunkCount: chunks.length,
            encodedDuration,
            copiedDuration: Math.max(0, duration - encodedDuration)
        });
        return {
            success: true,
            outputPath,
            mode: 'sparse_transition',
            encodedDuration,
            copiedDuration: Math.max(0, duration - encodedDuration),
            sfxCount: sfxFiles.length
        };
    } finally {
        for (const file of [...chunkFiles, listPath]) {
            try { fs.unlinkSync(file); } catch (_error) {}
        }
    }
}

module.exports = {
    renderSparseTransitions,
    buildSparseTransitionPlan,
    buildTransitionFilter,
    transitionWindow,
    muxSparseResult
};
