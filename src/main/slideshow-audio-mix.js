'use strict';

// Old bundled FFmpeg has no amix normalize=0. Keep every input alive for the
// whole mix so its divisor stays constant, then undo that divisor exactly once.
// Without padding, finished inputs would make the remaining tracks get louder.
function buildSlideshowAudioMix(inputLabels, outputLabel, duration, profile = { sampleRate: 48000, layout: 'stereo' }) {
    if (!Array.isArray(inputLabels) || inputLabels.length === 0 || !Number.isFinite(duration) || duration <= 0) {
        throw new Error('Invalid slideshow audio mix');
    }
    const end = duration.toFixed(6);
    const prepared = inputLabels.map((_, index) => `${outputLabel}_input_${index}`);
    const filters = inputLabels.map((label, index) =>
        `[${label}]aformat=sample_fmts=fltp:sample_rates=${profile.sampleRate}:channel_layouts=${profile.layout},apad,atrim=0:${end},asetpts=PTS-STARTPTS[${prepared[index]}]`
    );
    if (prepared.length === 1) {
        filters.push(`[${prepared[0]}]anull[${outputLabel}]`);
    } else {
        filters.push(`${prepared.map(label => `[${label}]`).join('')}amix=inputs=${prepared.length}:duration=longest:dropout_transition=0,volume=${prepared.length}[${outputLabel}]`);
    }
    return filters.join('; ');
}

module.exports = { buildSlideshowAudioMix };
