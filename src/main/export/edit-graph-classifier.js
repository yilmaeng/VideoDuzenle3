function hasValue(value) {
    return value !== undefined && value !== null && value !== '';
}

function classifyEditGraph({ inputPath, segments = [], transitions = [], globalEffects = [], ctaCount = 0 } = {}) {
    const sources = new Set(segments.map((segment) => segment.sourceFile || inputPath).filter(Boolean));
    const reasons = [];
    let classification = 'time_only';

    const hasAudioEdits = segments.some((segment) =>
        segment.isMuted
        || (hasValue(segment.audioVolume) && Number(segment.audioVolume) !== 100)
        || (segment.audioChannelMode && segment.audioChannelMode !== 'source')
        || (Number(segment.speed || 1) !== 1)
        || segment.speedBgAudio
        || (Array.isArray(segment.audioEffects) && segment.audioEffects.length > 0)
        || segment.noiseReduction?.enabled);

    const hasLocalVisualEffects = segments.some((segment) =>
        (Array.isArray(segment.overlays) && segment.overlays.length > 0)
        || segment.noiseReduction?.videoEnabled
        || segment.visualFilter
        || segment.blur?.enabled)
        || transitions.length > 0
        || Number(ctaCount || 0) > 0;

    const hasGlobalVisualEffects = globalEffects.length > 0 || segments.some((segment) =>
        segment.outputWidth
        || segment.outputHeight
        || segment.crop
        || segment.rotation
        || segment.frameRate
        || segment.globalSubtitle);

    if (hasGlobalVisualEffects) {
        classification = 'global_visual';
        reasons.push('global_visual_effect');
    } else if (hasLocalVisualEffects) {
        classification = 'local_visual';
        reasons.push('local_visual_effect');
    } else if (hasAudioEdits) {
        classification = 'audio_edit';
        reasons.push('audio_edit');
    }

    if (sources.size > 1) reasons.push('multiple_sources');
    if (!segments.length) reasons.push('empty_timeline');

    return {
        classification,
        reasons,
        sourceCount: sources.size,
        hasAudioEdits,
        hasLocalVisualEffects,
        hasGlobalVisualEffects,
        hybridEligible: segments.length > 0
            && !hasLocalVisualEffects
            && !hasGlobalVisualEffects
            && !segments.some((segment) => Number(segment.speed || 1) !== 1 || segment.speedBgAudio || segment.noiseReduction?.enabled)
    };
}

module.exports = { classifyEditGraph };
