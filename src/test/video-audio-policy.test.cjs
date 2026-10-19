const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const handler = require('../main/ffmpeg-handler');
const { aacEncodingArgs, sourceAudioProfile } = require('../main/slideshow-audio-policy');
const { renderContinuousAudio } = require('../main/export/continuous-audio-renderer');
const { analyzeSource } = require('../main/export/source-profile-analyzer');
const { isUnmodifiedSelection } = require('../main/export/selection-audio-copy');
const { ffmpegPath, ffprobePath } = handler.getFFmpegPaths();
const run = (exe, args) => execFileSync(exe, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
const info = file => JSON.parse(run(ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', file])).streams.find(s => s.codec_type === 'audio');
const packets = file => JSON.parse(run(ffprobePath, ['-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_entries', 'packet=pts_time,data_hash', '-show_data_hash', 'sha256', '-of', 'json', file])).packets;
const root = fs.mkdtempSync(path.join(__dirname, '../../temp/video-audio-policy-'));
async function main() {
    for (const [channels, layout, rate] of [[1, 'mono', 22050], [2, 'stereo', 48000], [6, '5.1', 48000]]) {
        const p = sourceAudioProfile([{ channels, channelLayout: layout, sampleRate: rate, codec: 'aac' }]);
        assert.equal(p.channels, channels);
        assert.equal(p.sampleRate, rate);
        assert.equal(p.layout, layout);
        assert(p.encoding.includes(`-b:a ${channels * 160000}`));
    }
    const segment = { start: 1.024, end: 3.072 };
    for (const edit of [{ speed: 1.2 }, { audioVolume: 80 }, { isMuted: true }, { audioChannelMode: 'mono' }, { audioEffects: [{}] }, { overlays: [{}] }]) {
        assert(!isUnmodifiedSelection([{ ...segment, ...edit }]));
    }
    const source = path.join(root, 'source.mp4');
    run(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=160x90:r=25:d=4.096', '-f', 'lavfi', '-i', 'sine=frequency=997:sample_rate=48000:duration=4.096', '-c:v', 'libx264', '-preset', 'ultrafast', ...aacEncodingArgs([{ channels: 2, sampleRate: 48000 }]), '-shortest', source]);
    const profile = await analyzeSource(ffprobePath, source);
    const copied = path.join(root, 'copy.mov');
    const result = await renderContinuousAudio({ ffmpegPath, ffprobePath, inputPath: source, segments: [segment], sourceProfiles: [profile], outputPath: copied });
    assert.equal(result.copied, true, 'Packet-aligned clean AAC selection must be copied');
    const expected = packets(source).filter(p => Number(p.pts_time) >= segment.start - 0.000001 && Number(p.pts_time) < segment.end - 0.000001).map(p => p.data_hash);
    assert.deepEqual(packets(copied).map(p => p.data_hash), expected, 'Selected AAC packet payloads must be unchanged');
    const classicCopy = path.join(root, 'classic-copy.mp4');
    await handler.renderTimeline(source, [segment], classicCopy, () => {});
    assert.deepEqual(packets(classicCopy).map(p => p.data_hash), expected, 'Classic selection must preserve eligible AAC packets too');
    const precise = await renderContinuousAudio({ ffmpegPath, ffprobePath, inputPath: source, segments: [{ start: 1.025, end: 3.071 }], sourceProfiles: [profile], outputPath: path.join(root, 'precise.mov') });
    assert(!precise.copied, 'Sub-packet cuts must remain sample accurate');
    const output = path.join(root, 'classic.mp4');
    await handler.renderTimeline(source, [{ start: 0.3, end: 2.6 }], output, () => {});
    const audio = info(output);
    assert.equal(audio.sample_rate, '48000');
    assert.equal(audio.channels, 2);
    assert.equal(audio.profile, 'LC');
    const monoOutput = path.join(root, 'requested-mono.mp4');
    await handler.renderTimeline(source, [{ start: 0.3, end: 2.6, audioChannelMode: 'mono' }], monoOutput, () => {});
    assert.equal(info(monoOutput).channels, 1, 'Explicit mono request must override source stereo');
    const rms = (file, start, duration) => {
        const bytes = run(ffmpegPath, ['-v', 'error', '-i', file, '-ss', String(start), '-t', String(duration), '-vn', '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1']);
        let sum = 0;
        for (let i = 0; i < bytes.length; i += 4) sum += bytes.readFloatLE(i) ** 2;
        return Math.sqrt(sum / (bytes.length / 4));
    };
    const delta = 20 * Math.log10(rms(output, 0.2, 1.5) / rms(source, 0.5, 1.5));
    assert(Math.abs(delta) < 0.25, `Unexpected level change: ${delta} dB`);
    for (const [channels, layout] of [[1, 'mono'], [6, '5.1']]) {
        const multichannelSource = path.join(root, `source-${channels}.mov`);
        const multichannelOutput = path.join(root, `output-${channels}.mp4`);
        run(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=160x90:r=25:d=1', '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=${layout}`, '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'pcm_f32le', multichannelSource]);
        await handler.renderTimeline(multichannelSource, [{ start: 0.1, end: 0.9 }], multichannelOutput, () => {});
        assert.equal(info(multichannelOutput).channels, channels);
        assert.equal(info(multichannelOutput).sample_rate, '48000');
    }
    console.log('Video audio policy passed: channel/rate preservation, AAC-LC, copy packet hashes, precise fallback, level within 0.25 dB.');
    console.log(`Fixtures: ${root}`);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
