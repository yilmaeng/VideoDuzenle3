function sumTimelineDuration(segments = []) {
    return segments.reduce((sum, segment) => {
        const duration = Math.max(0, Number(segment.end || 0) - Number(segment.start || 0));
        const speed = Math.max(0.01, Number(segment.speed || 1));
        return sum + (duration / speed);
    }, 0);
}

function estimateExport({ profiles = [], segments = [], mode = 'legacy' } = {}) {
    const outputDuration = sumTimelineDuration(segments);
    const sourceDuration = profiles.reduce((sum, profile) => sum + Number(profile.duration || 0), 0);
    const sourceSize = profiles.reduce((sum, profile) => sum + Number(profile.fileSize || 0), 0);
    const weightedBitrate = profiles.reduce((sum, profile) => {
        const duration = Number(profile.duration || 0);
        return sum + (Number(profile.container?.calculatedBitrate || profile.container?.bitrate || 0) * duration);
    }, 0) / Math.max(0.001, sourceDuration);
    const primaryAudio = profiles.find((profile) => profile.audio?.length)?.audio?.[0] || null;
    const preferredAudioBitrate = primaryAudio?.lossless
        ? Math.max(768000, Number(primaryAudio.bitrate || 0))
        : Math.max(320000, Number(primaryAudio?.bitrate || 0));
    const containerOverhead = 0.015;
    let targetTotalBitrate = weightedBitrate;
    let targetVideoBitrate = Math.max(500000, targetTotalBitrate - preferredAudioBitrate);

    if (mode === 'source_quality') {
        targetVideoBitrate = 0;
    } else if (mode === 'lossless_master') {
        targetTotalBitrate = 0;
        targetVideoBitrate = 0;
    }

    const durationRatio = sourceDuration > 0 ? outputDuration / sourceDuration : 1;
    const targetSize = mode === 'source_quality'
        ? Math.round(sourceSize * durationRatio * 0.7)
        : mode === 'lossless_master'
            ? Math.round(sourceSize * durationRatio * 2.5)
            : Math.round((targetTotalBitrate * outputDuration / 8) * (1 + containerOverhead));
    const legacyBitrate = 4500000 + 320000;
    const legacySize = Math.round((legacyBitrate * outputDuration) / 8);
    const compressionRatio = sourceSize > 0 ? legacySize / Math.max(1, sourceSize * durationRatio) : 1;

    return {
        mode,
        outputDuration,
        sourceDuration,
        sourceSize,
        sourceAverageBitrate: Math.round(weightedBitrate || 0),
        targetTotalBitrate: Math.round(targetTotalBitrate || 0),
        targetVideoBitrate: Math.round(targetVideoBitrate || 0),
        targetAudioBitrate: preferredAudioBitrate,
        estimatedOutputSize: Math.max(0, targetSize || legacySize),
        legacyEstimatedSize: legacySize,
        legacyCompressionRatio: compressionRatio,
        highCompressionWarning: compressionRatio > 0 && compressionRatio < 0.25
    };
}

module.exports = { estimateExport, sumTimelineDuration };
