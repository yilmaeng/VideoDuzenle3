// Quantize cumulative positions, never each duration independently. This keeps
// sub-frame edits from accumulating A/V drift across hundreds of cuts.
function planTimeline(durations, rate) {
    if (!(rate > 0) || !Number.isFinite(rate)) throw new Error('invalid_timeline_rate');
    let time = 0;
    return durations.map(duration => {
        if (!(duration > 0) || !Number.isFinite(duration)) throw new Error('invalid_segment_duration');
        const start = Math.round(time * rate);
        time += duration;
        const end = Math.round(time * rate);
        return { start, end, count: end - start };
    });
}

function videoTimingFilter(frameCount, frameRate) {
    // A short last frame is held, rather than padding AUDIO to a video frame.
    return `fps=${frameRate},tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${frameCount},setpts=N/(${frameRate}*TB)`;
}

function sourceAudioTimelineFilter(sampleRate) {
    // Materialize timestamp gaps at their source positions BEFORE trimming.
    // Otherwise final apad moves missing samples to a cut boundary (e.g. a
    // 265 ms first AAC packet containing only 21 ms of decoded audio).
    return `aresample=${sampleRate}:async=1:first_pts=0`;
}

function concatTimeline(videoIndexes, audioCount) {
    return `${videoIndexes.map(i => `[v${i}]`).join('')}concat=n=${videoIndexes.length}:v=1:a=0[ov];\n`
        + `${Array.from({ length: audioCount }, (_, i) => `[a${i}]`).join('')}concat=n=${audioCount}:v=0:a=1,asetpts=N/SR/TB[oa]`;
}

function cutSmoothingFilter(samples, rate, fadeIn, fadeOut) {
    const length = Math.min(Math.round(rate * .003), Math.floor(samples / 2));
    if (length < 1) return '';
    return (fadeIn ? `,afade=t=in:ss=0:ns=${length}` : '')
        + (fadeOut ? `,afade=t=out:ss=${samples-length}:ns=${length}` : '');
}

function needsCutSmoothing(left, right) {
    if (!left || !right) return false;
    return left.f !== right.f || Math.abs(left.e-right.s) > 1e-7
        || left.speed !== right.speed || left.audioVolume !== right.audioVolume
        || left.isMuted !== right.isMuted || left.audioChannelMode !== right.audioChannelMode;
}

module.exports = { planTimeline, videoTimingFilter, concatTimeline, sourceAudioTimelineFilter, cutSmoothingFilter, needsCutSmoothing };
