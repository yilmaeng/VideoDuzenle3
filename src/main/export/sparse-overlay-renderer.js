const fs = require('fs');
const path = require('path');
const { analyzeSource, getKeyframes } = require('./source-profile-analyzer');
const { runFfmpeg } = require('./continuous-audio-renderer');
const { getAvailableEncoders } = require('./source-aware-renderer');
const {
    resolveBoundaryEncoder,
    renderHybridChunk,
    writeConcatList
} = require('./hybrid-smart-renderer');
const { buildSparseTransitionPlan, muxSparseResult } = require('./sparse-transition-renderer');

function overlayInterval(overlay, duration) {
    const start = Math.max(0, Number(overlay.startTime || 0));
    return {
        start,
        end: Math.min(duration, start + Math.max(0.001, Number(overlay.duration || duration)))
    };
}

function buildSparseOverlayPlan(overlays, keyframes, duration, frameRate = 25) {
    const windows = overlays.map((overlay) => {
        const interval = overlayInterval(overlay, duration);
        return {
            time: (interval.start + interval.end) / 2,
            duration: interval.end - interval.start,
            type: 'overlay_window'
        };
    });
    return buildSparseTransitionPlan(windows, keyframes, duration, frameRate);
}

function overlapsChunk(overlay, chunk, duration) {
    const interval = overlayInterval(overlay, duration);
    return interval.end >= chunk.start && interval.start <= chunk.end;
}

async function renderSparseOverlays({
    ffmpegPath,
    ffprobePath,
    inputPath,
    outputPath,
    overlays,
    audioItems = [],
    renderEffectChunk,
    onProgress = null
}) {
    const profile = await analyzeSource(ffprobePath, inputPath, { force: true });
    const codec = String(profile.video?.codec || '').toLowerCase();
    const pixelFormat = String(profile.video?.pixelFormat || '').toLowerCase();
    const rotation = ((Number(profile.video?.rotation || 0) % 360) + 360) % 360;
    const supportedPixelFormat = ['yuv420p', 'yuvj420p'].includes(pixelFormat);
    if (!profile.video || !['h264', 'hevc', 'h265'].includes(codec) || profile.video.variableFrameRate || ![0, 90, 180, 270].includes(rotation) || !supportedPixelFormat) {
        return { success: false, fallbackRequired: true, reason: 'sparse_overlay_source_not_supported' };
    }
    const encoders = await getAvailableEncoders(ffmpegPath);
    const encoder = resolveBoundaryEncoder(profile, encoders);
    if (!encoder?.codec) return { success: false, fallbackRequired: true, reason: 'sparse_overlay_encoder_not_available' };

    const duration = Math.max(0, Number(profile.duration || profile.video.duration || 0));
    const keyframes = await getKeyframes(ffprobePath, inputPath, {
        duration,
        onProgress: (percent) => onProgress?.(Math.min(4, Number(percent || 0) * 0.04))
    });
    const chunks = buildSparseOverlayPlan(overlays, keyframes, duration, profile.video.averageFrameRate);
    if (!chunks.length || !chunks.some((chunk) => chunk.type === 'encode')) {
        return { success: false, fallbackRequired: true, reason: 'sparse_overlay_plan_empty' };
    }

    const tempBase = path.join(path.dirname(outputPath), `evd_sparse_overlay_${Date.now()}_${process.pid}`);
    const chunkFiles = [];
    const effectFiles = [];
    const listPath = `${tempBase}.concat.txt`;
    const encodedDuration = chunks.filter((chunk) => chunk.type === 'encode').reduce((sum, chunk) => sum + chunk.end - chunk.start, 0);
    let completedDuration = 0;
    try {
        for (let index = 0; index < chunks.length; index += 1) {
            const chunk = chunks[index];
            const chunkDuration = chunk.end - chunk.start;
            const chunkPath = `${tempBase}.chunk-${index}.ts`;
            chunkFiles.push(chunkPath);
            if (chunk.type === 'copy') {
                await renderHybridChunk({
                    ffmpegPath,
                    source: inputPath,
                    chunk,
                    outputPath: chunkPath,
                    sourceProfile: profile,
                    targetProfile: profile,
                    encoder,
                    onProgress: (percent) => onProgress?.(4 + ((completedDuration + chunkDuration * Number(percent || 0) / 100) / duration) * 82)
                });
            } else {
                const effectPath = `${tempBase}.effect-${index}.mp4`;
                effectFiles.push(effectPath);
                const relevantOverlays = overlays.filter((overlay) => overlapsChunk(overlay, chunk, duration));
                await renderEffectChunk({
                    inputPath,
                    outputPath: effectPath,
                    start: chunk.start,
                    duration: chunkDuration,
                    overlays: relevantOverlays,
                    onProgress: (percent) => onProgress?.(4 + ((completedDuration + chunkDuration * Number(percent || 0) / 100) / duration) * 78)
                });
                await runFfmpeg(ffmpegPath, [
                    '-y', '-i', effectPath,
                    '-map', '0:v:0', '-an', '-c:v', 'copy',
                    '-bsf:v', encoder.bitstreamFilter,
                    '-avoid_negative_ts', 'make_zero', '-mpegts_flags', '+resend_headers',
                    '-f', 'mpegts', chunkPath
                ], { duration: chunkDuration });
            }
            completedDuration += chunkDuration;
        }
        writeConcatList(listPath, chunkFiles);
        await muxSparseResult({
            ffmpegPath,
            videoListPath: listPath,
            sourcePath: inputPath,
            outputPath,
            duration,
            sfxFiles: audioItems,
            profile,
            onProgress: (percent) => onProgress?.(86 + Number(percent || 0) * 0.14)
        });
        onProgress?.(100);
        console.info('[EVD Sparse Overlay Complete]', {
            overlayCount: overlays.length,
            chunkCount: chunks.length,
            encodedDuration,
            copiedDuration: Math.max(0, duration - encodedDuration)
        });
        return { success: true, outputPath, mode: 'sparse_overlay', encodedDuration, copiedDuration: Math.max(0, duration - encodedDuration) };
    } finally {
        for (const file of [...chunkFiles, ...effectFiles, listPath]) {
            try { fs.unlinkSync(file); } catch (_error) {}
        }
    }
}

module.exports = { renderSparseOverlays, buildSparseOverlayPlan, overlayInterval };
