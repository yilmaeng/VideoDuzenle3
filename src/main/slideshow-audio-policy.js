'use strict';

// MP3-in-MP4 plays on desktop but can be silent in iPhone playback paths.
// Default slideshow exports must be portable, not merely muxer-compatible.
const LAYOUTS = { 1: 'mono', 2: 'stereo', 3: '2.1', 4: 'quad', 5: '5.0', 6: '5.1', 7: '6.1', 8: '7.1' };
const AAC_CODEC_ARGS = ['-c:a', 'aac', '-aac_coder', 'twoloop', '-profile:a', 'aac_low'];
const AAC_CODEC_OPTIONS = ['-c:a aac', '-aac_coder twoloop', '-profile:a aac_low'];

function sourceAudioProfile(streams = []) {
    const sources = streams.filter(Boolean).map(s => ({ ...s,
        codec_name: s.codec_name || s.codec,
        sample_rate: s.sample_rate || s.sampleRate,
        channel_layout: s.channel_layout || s.channelLayout,
        bit_rate: s.bit_rate || s.bitrate,
        channels: s.channels || Number(Object.keys(LAYOUTS).find(k => LAYOUTS[k] === (s.channel_layout || s.channelLayout))) || 2
    }));
    const sampleRate = Math.max(0, ...sources.map(s => Number(s.sample_rate) || 0)) || 48000;
    const channels = Math.max(0, ...sources.map(s => Number(s.channels) || 0)) || 2;
    const dominant = sources.find(s => Number(s.channels) === channels);
    const layout = /^[a-zA-Z0-9_.()+-]+$/.test(dominant?.channel_layout || '') && dominant.channel_layout !== 'unknown'
        ? dominant.channel_layout : LAYOUTS[channels];
    if (!layout) throw new Error(`Unsupported slideshow audio channel count: ${channels}`);
    // This bundled MP4 muxer does not accept ALAC. Keep processing lossless in MOV,
    // then encode AAC once only when source packets cannot be copied.
    const aacRates = [7350, 8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000, 88200, 96000];
    const outputRate = aacRates.find(rate => rate >= sampleRate) || 96000;
    const bitRate = Math.max(160000 * channels, ...sources.filter(s => !/^(pcm_|flac$|alac$)/.test(s.codec_name || '')).map(s => Number(s.bit_rate) || 0));
    return {
        sampleRate, outputSampleRate: outputRate, channels, layout,
        filter: `aformat=sample_rates=${sampleRate}:channel_layouts=${layout}`,
        // Bundled FFmpeg defaults to fast; twoloop preserved music more closely
        // in the source comparison. Keep this explicit across all export paths.
        encoding: `${AAC_CODEC_ARGS.join(' ')} -b:a ${bitRate} -ar ${outputRate} -ac ${channels}`,
        intermediate: `-c:a pcm_f32le -ar ${sampleRate} -ac ${channels}`
    };
}

function singleAudioMap(inputIndex, stream, duration) {
    const copy = String(stream?.codec_name || '').toLowerCase() === 'aac' && stream?.profile === 'LC';
    return `-map ${inputIndex}:a:0 ${copy ? '-c:a copy' : sourceAudioProfile([stream]).encoding} -t ${Number(duration).toFixed(3)}`;
}

function canBypassSlideshowAudioMix(tracks, media) {
    if (tracks.length !== 1) return false;
    const track = tracks[0];
    if (media.some(item => item.pairedAudioId || (item.type === 'video' && !item.muteVideoAudio))) return false;
    // Conservative guard for future track-level editing options.
    if ((track.volume != null && Number(track.volume) !== 100) || (track.speed != null && Number(track.speed) !== 1)) return false;
    return !['trimStart', 'trimEnd', 'startTime', 'delay', 'fadeIn', 'fadeOut', 'loop', 'effects'].some(key => Boolean(track[key]));
}

function aacEncodingArgs(streams = []) {
    return sourceAudioProfile(streams).encoding.split(' ');
}

module.exports = { sourceAudioProfile, singleAudioMap, canBypassSlideshowAudioMix, aacEncodingArgs, AAC_CODEC_ARGS, AAC_CODEC_OPTIONS };
