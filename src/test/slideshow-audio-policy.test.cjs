const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sourceAudioProfile, singleAudioMap, canBypassSlideshowAudioMix } = require('../main/slideshow-audio-policy');
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
const ffprobe = require('@ffprobe-installer/ffprobe').path;
const profile = sourceAudioProfile([{ codec_name: 'mp3', sample_rate: '44100', channels: 1, channel_layout: 'mono', bit_rate: '128000' }]);
assert.equal(profile.sampleRate, 44100);
assert.equal(profile.channels, 1);
assert(profile.encoding.includes('-ar 44100 -ac 1'));
assert(profile.encoding.includes('-aac_coder twoloop'));
assert(sourceAudioProfile([{ codec_name: 'mp3', sample_rate: '48000', channels: 2, bit_rate: '128000' }]).encoding.includes('-b:a 320000'));
assert(singleAudioMap(0, { codec_name: 'mp3' }, 2).includes('-aac_coder twoloop'));
assert(!singleAudioMap(0, { codec_name: 'aac', profile: 'LC' }, 2).includes('-aac_coder'));
assert(!profile.intermediate.includes('-aac_coder'));
assert(sourceAudioProfile([{ codec_name: 'flac', sample_rate: '96000', channels: 2 }]).encoding.includes('-ar 96000'));
assert.equal(sourceAudioProfile([{ codec_name: 'aac', sample_rate: '48000', channels: 6, channel_layout: '5.1', bit_rate: '512000' }]).layout, '5.1');
assert(canBypassSlideshowAudioMix([{}], [{ type: 'image' }]));
assert(canBypassSlideshowAudioMix([{}], [{ type: 'video', muteVideoAudio: true }]));
assert(!canBypassSlideshowAudioMix([{}], [{ type: 'video' }]));
assert(!canBypassSlideshowAudioMix([{}], [{ type: 'image', pairedAudioId: 'a' }]));
assert(!canBypassSlideshowAudioMix([{}, {}], []));
for (const track of [{ volume: 35 }, { speed: 1.1 }, { delay: 1 }, { fadeIn: 1 }, { loop: true }]) assert(!canBypassSlideshowAudioMix([track], []));

const directory = fs.mkdtempSync(path.join(__dirname, '../../temp/slideshow-audio-policy-'));
const run = (exe, args) => execFileSync(exe, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
function packets(file) {
    return JSON.parse(run(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_entries', 'packet=data_hash', '-show_data_hash', 'sha256', '-of', 'json', file])).packets.map(p => p.data_hash);
}
for (const [codec, extension] of [['mp3', 'mp3'], ['aac', 'm4a']]) {
    const input = path.join(directory, `source-${codec}.${extension}`);
    const output = path.join(directory, `output-${codec}.mp4`);
    run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=2', '-c:a', codec === 'mp3' ? 'libmp3lame' : codec, input]);
    const sourceInfo = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', input])).streams[0];
    run(ffmpeg, ['-v', 'error', '-i', input, ...singleAudioMap(0, sourceInfo, 3).split(' '), output]);
    const result = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', output])).streams[0];
    assert.equal(result.codec_name, 'aac');
    assert.equal(result.profile, 'LC');
    assert.equal(result.sample_rate, sourceInfo.sample_rate);
    assert.equal(result.channels, sourceInfo.channels);
    if (codec === 'aac') assert.deepEqual(packets(output), packets(input), 'AAC packet payloads changed');
}
const source = path.join(directory, 'source.wav');
const converted = path.join(directory, 'converted.mp4');
run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=sample_rate=44100:duration=2', '-c:a', 'pcm_s16le', source]);
run(ffmpeg, ['-v', 'error', '-i', source, ...singleAudioMap(0, { codec_name: 'pcm_s16le', sample_rate: '44100', channels: 1 }, 2).split(' '), converted]);
const info = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', converted])).streams[0];
assert.equal(info.codec_name, 'aac');
assert.equal(info.sample_rate, '44100');
assert.equal(info.channels, 1);
const pcm = file => run(ffmpeg, ['-v', 'error', '-i', file, '-f', 's16le', '-c:a', 'pcm_s16le', 'pipe:1']);
const intermediate = path.join(directory, 'intermediate.mov');
run(ffmpeg, ['-v', 'error', '-i', source, ...sourceAudioProfile([{ sample_rate: '44100', channels: 1 }]).intermediate.split(' '), intermediate]);
assert(pcm(source).equals(pcm(intermediate)), 'Lossless intermediate changed decoded samples');
console.log('Audio policy: MP3 to AAC-LC, AAC packet identity and lossless MOV intermediates passed.');
