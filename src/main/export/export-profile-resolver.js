const { sourceAudioProfile } = require('../slideshow-audio-policy');

function cleanColorValue(value) {
    const text = String(value || '').trim().toLowerCase();
    return text && !['unknown', 'unspecified', 'reserved'].includes(text) ? text : '';
}

function resolveAudioProfile(sourceProfile = {}, mode = 'source_quality', outputExtension = '.mp4') {
    const source = sourceProfile.audio?.[0] || {};
    const shared = sourceAudioProfile([source]);
    const sampleRate = shared.sampleRate;
    const channelLayout = shared.layout;
    const extension = String(outputExtension).toLowerCase();
    const losslessContainer = ['.mov', '.mkv'].includes(extension);
    if ((mode === 'lossless_master' || source.lossless) && losslessContainer) {
        const sourceCodec = String(source.codec || '').toLowerCase();
        if (sourceCodec.startsWith('pcm_')) {
            return { codec: sourceCodec, bitrate: 0, sampleRate, channelLayout, lossless: true };
        }
        if (sourceCodec === 'flac' && extension === '.mkv') {
            return { codec: 'flac', bitrate: 0, sampleRate, channelLayout, lossless: true };
        }
        return { codec: 'alac', bitrate: 0, sampleRate, channelLayout, lossless: true };
    }
    return {
        codec: 'aac',
        bitrate: Math.max(Number(shared.encoding.match(/-b:a (\d+)/)[1]), Math.min(512000, Number(source.bitrate || 0))),
        channels: shared.channels,
        sampleRate,
        channelLayout,
        lossless: false
    };
}

function resolveVideoProfile(sourceProfile = {}, mode = 'source_quality', estimator = {}, encoders = new Set()) {
    const source = sourceProfile.video || {};
    const sourceCodec = String(source.codec || '').toLowerCase();
    const canUseX265 = encoders.has('libx265');
    const codec = ['hevc', 'h265'].includes(sourceCodec) && canUseX265 ? 'libx265' : 'libx264';
    const tenBit = Number(source.bitDepth || 8) > 8 && codec === 'libx265';
    const base = {
        codec,
        preset: 'slow',
        pixelFormat: tenBit ? 'yuv420p10le' : 'yuv420p',
        width: Number(source.width || 1920),
        height: Number(source.height || 1080),
        frameRate: Number(source.averageFrameRate || source.realFrameRate || 30),
        color: {
            range: cleanColorValue(source.colorRange),
            space: cleanColorValue(source.colorSpace),
            primaries: cleanColorValue(source.colorPrimaries),
            transfer: cleanColorValue(source.colorTransfer)
        }
    };
    if (mode === 'source_size') {
        return { ...base, twoPass: true, exactTargetSize: true, bitrate: Math.max(500000, Number(estimator.targetVideoBitrate || 0)) };
    }
    if (mode === 'lossless_master') {
        if (Number(source.bitDepth || 8) > 8 && canUseX265) {
            return {
                ...base,
                codec: 'libx265',
                preset: 'slow',
                pixelFormat: 'yuv420p10le',
                encoderArgs: ['-x265-params', 'lossless=1']
            };
        }
        return { ...base, codec: 'libx264', preset: 'slow', crf: 0, pixelFormat: 'yuv444p' };
    }
    return { ...base, crf: codec === 'libx265' ? 21 : 18 };
}

module.exports = { resolveAudioProfile, resolveVideoProfile };
