const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const file = path.resolve(__dirname, '../main/slideshow-handler.js');
const localRequire = createRequire(file);
const ffmpeg = localRequire('@ffmpeg-installer/ffmpeg').path;
const ffprobe = localRequire('@ffprobe-installer/ffprobe').path;
const directory = fs.mkdtempSync(path.resolve(__dirname, '../../temp/slideshow-export-test-'));
const run = (exe, args) => execFileSync(exe, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
const sandbox = {
    module: { exports: {} }, process, Buffer, setTimeout, clearTimeout,
    console: { log() {}, warn: console.warn, error: console.error },
    require(name) {
        if (['electron', './karaoke-forced-alignment', './karaoke-engine-manager', './mac-editing-shortcuts'].includes(name)) return {};
        if (name === './i18n') return { t: key => `[${key}]` };
        return localRequire(name);
    }
};
vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\nmodule.exports = { createSlideshowVideo, createMixedMediaSlideshowVideo, createSlideshowVideoBatched };', sandbox, { filename: file });
function hashes(input) {
    return JSON.parse(run(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_entries', 'packet=data_hash', '-show_data_hash', 'sha256', '-of', 'json', input])).packets.map(packet => packet.data_hash);
}
(async () => {
    const audio = path.join(directory, 'source.mp3');
    const image = path.join(directory, 'image.png');
    run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=sample_rate=44100:duration=1', '-c:a', 'libmp3lame', audio]);
    await localRequire('sharp')({ create: { width: 64, height: 36, channels: 3, background: 'navy' } }).png().toFile(image);
    const project = { aspectRatio: '16:9', visualFitMode: 'fit', images: [{ id: 'i', path: image, duration: 1.1 }], audioTracks: [{ id: 'a', path: audio, duration: 1.1 }], textOverlays: [], karaokeTracks: [] };
    for (const [name, render] of Object.entries(sandbox.module.exports)) {
        const output = path.join(directory, `${name}.mp4`);
        await render(project, output, null);
        const result = JSON.parse(run(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_streams', '-of', 'json', output])).streams[0];
        assert.equal(result.codec_name, 'aac');
        assert.equal(result.profile, 'LC');
        assert.equal(result.sample_rate, '44100');
        assert.equal(result.channels, 1);
        console.log(`${name}: MP3 source exports as compatible AAC-LC`);
    }
    const paired = { ...project, images: [{ ...project.images[0], pairedAudioId: 'a' }] };
    for (const name of ['createMixedMediaSlideshowVideo', 'createSlideshowVideoBatched']) {
        const output = path.join(directory, `${name}-paired.mp4`);
        await sandbox.module.exports[name](paired, output, null);
        const audioInfo = JSON.parse(run(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_streams', '-of', 'json', output])).streams[0];
        assert.equal(audioInfo.sample_rate, '44100');
        assert.equal(audioInfo.channels, 1);
        assert.equal(audioInfo.codec_name, 'aac');
        console.log(`${name}: processed render retains source rate and channels`);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
