// Opt-in integration test: prepared optional runtime required; runs actual model inference.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const work = path.join(root, 'temp/vocal-feature-smoke');
fs.mkdirSync(work, { recursive: true });
const load = Module._load;
Module._load = function(id, ...args) {
    if (id === 'electron') return { app: { isPackaged: false, getAppPath: () => root, getPath: () => work } };
    return load.call(this, id, ...args);
};
const service = require('../main/vocal-separation');
Module._load = load;
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const file = path.join(work, `sample-${Date.now()}.mp4`);
(async () => {
    await service.run(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=25:d=1',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-aac_coder', 'twoloop', '-ac', '2', file]);
    const stages = [];
    const result = await service.separate({ source: file, destination: work, mode: 'both', format: 'mp4', consent: false,
        signal: new AbortController().signal, ffmpegPath, ffprobePath, onProgress: data => { stages.push(data.stage); console.log(data); } });
    assert.equal(result.files.length, 2);
    assert(stages.includes('separating'));
    assert(stages.includes('done'));
    const hashes = async input => (await service.run(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_packets', '-show_data_hash', 'sha256',
        '-show_entries', 'packet=data_hash', '-of', 'json', input]));
    const original = await hashes(file);
    for (const output of result.files) assert.equal(await hashes(output), original, 'Video packets must be unchanged');
    const wav = await service.separate({ source: file, destination: work, mode: 'instrumental', format: 'wav', consent: false,
        signal: new AbortController().signal, ffmpegPath, ffprobePath, onProgress: () => {} });
    assert.equal(wav.files.length, 1);
    const wavMeta = JSON.parse(await service.run(ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', wav.files[0]]));
    assert.equal(wavMeta.streams[0].codec_name, 'pcm_s24le');
    assert.equal(wavMeta.streams[0].sample_rate, '44100');
    assert.equal(wavMeta.streams[0].channels, 2);
    const before = fs.readdirSync(work).sort();
    const controller = new AbortController();
    await assert.rejects(service.separate({ source: file, destination: work, mode: 'both', format: 'wav', consent: false,
        signal: controller.signal, ffmpegPath, ffprobePath,
        onProgress: p => { if (p.stage === 'separating') controller.abort(); } }), /cancelled/);
    assert.deepEqual(fs.readdirSync(work).sort(), before, 'Cancellation must not publish partial output');
    console.log('REAL_MODEL_MP4_SMOKE_OK', JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
