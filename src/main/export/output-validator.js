const fs = require('fs');
const { analyzeSource } = require('./source-profile-analyzer');
const { sumTimelineDuration } = require('./export-estimator');

async function validateOutput({
    ffprobePath,
    outputPath,
    segments = [],
    expectedVideo = null,
    targetSize = 0,
    sizeTolerance = 0.1,
    durationTolerance: requestedDurationTolerance = 0,
    avDriftTolerance: requestedAvDriftTolerance = 0
} = {}) {
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
        return { valid: false, reasons: ['output_missing'] };
    }
    const profile = await analyzeSource(ffprobePath, outputPath, { force: true });
    const expectedDuration = sumTimelineDuration(segments);
    const frameDuration = expectedVideo?.frameRate > 0 ? 1 / expectedVideo.frameRate : 0.04;
    const durationTolerance = Math.max(0.04, frameDuration, Number(requestedDurationTolerance || 0));
    const durationDelta = Math.abs(Number(profile.duration || 0) - expectedDuration);
    const reasons = [];
    if (!profile.video) reasons.push('video_stream_missing');
    if (!profile.audio?.length) reasons.push('audio_stream_missing');
    if (expectedDuration > 0 && durationDelta > durationTolerance) reasons.push('duration_mismatch');
    if (expectedVideo?.width && profile.video?.width !== expectedVideo.width) reasons.push('width_mismatch');
    if (expectedVideo?.height && profile.video?.height !== expectedVideo.height) reasons.push('height_mismatch');
    if (expectedVideo?.frameRate && profile.video?.averageFrameRate
        && Math.abs(profile.video.averageFrameRate - expectedVideo.frameRate) > 0.05) {
        reasons.push('frame_rate_mismatch');
    }
    const videoDuration = Number(profile.video?.duration || 0);
    const audioStream = profile.audio?.[0] || null;
    const audioDuration = Number(audioStream?.duration || 0);
    const avDrift = videoDuration > 0 && audioDuration > 0 ? Math.abs(videoDuration - audioDuration) : 0;
    const audioCodecFrameDuration = String(audioStream?.codec || '').toLowerCase() === 'aac'
        ? 1024 / Math.max(1, Number(audioStream?.sampleRate || 48000))
        : 0;
    // AAC priming/tail metadata may differ by up to three codec frames even when samples remain synchronized.
    const avDriftTolerance = Math.max(
        0.04,
        frameDuration,
        audioCodecFrameDuration * 3 + 0.001,
        Number(requestedAvDriftTolerance || 0)
    );
    if (avDrift > avDriftTolerance) reasons.push('av_drift');
    if (Number(profile.container?.startTime || 0) < -0.001
        || Number(profile.video?.startTime || 0) < -0.001
        || Number(profile.audio?.[0]?.startTime || 0) < -0.001) {
        reasons.push('negative_timestamp');
    }
    let sizeDifferenceRatio = 0;
    if (targetSize > 0) {
        sizeDifferenceRatio = Math.abs(profile.fileSize - targetSize) / targetSize;
        if (sizeDifferenceRatio > sizeTolerance) reasons.push('size_outside_target');
    }
    return {
        valid: reasons.length === 0 || (reasons.length === 1 && reasons[0] === 'size_outside_target'),
        reasons,
        profile,
        expectedDuration,
        actualDuration: profile.duration,
        durationDelta,
        durationTolerance,
        avDrift,
        avDriftTolerance,
        sizeDifferenceRatio
    };
}

module.exports = { validateOutput };
