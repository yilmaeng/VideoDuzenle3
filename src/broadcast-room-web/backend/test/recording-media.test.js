const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const { RecordingMedia } = require('../src/services/recording-media');

test('real FFmpeg: M4A keeps AAC payloads and resumed segments exclude the pause', async t => {
    try { await exec('ffmpeg', ['-version']); await exec('ffprobe', ['-version']); }
    catch (_) { return t.skip('FFmpeg/FFprobe unavailable'); }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-media-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const names = [crypto.randomUUID() + '.mp4', crypto.randomUUID() + '.mp4'];
    for (let index = 0; index < names.length; index++) await exec('ffmpeg', ['-nostdin', '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=25:d=2', '-f', 'lavfi', '-i', `sine=frequency=${440 + index * 100}:sample_rate=48000:duration=2`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-profile:a', 'aac_low', '-aac_coder', 'twoloop', '-shortest', path.join(root, names[index])]);
    const media = new RecordingMedia({ root });
    const audioName = crypto.randomUUID() + '.m4a';
    await media.audio(names[0], audioName);
    const hash = async name => (await exec('ffmpeg', ['-v', 'error', '-i', path.join(root, name), '-map', '0:a:0', '-c:a', 'copy', '-f', 'hash', '-hash', 'sha256', '-'])).stdout;
    assert.equal(await hash(names[0]), await hash(audioName));
    const combined = crypto.randomUUID() + '.mp4';
    await media.assemble(names, combined);
    const info = await media.probe(path.join(root, combined));
    assert.ok(Math.abs(Number(info.format.duration) - 4) < 0.1);
    assert.throws(() => media.file('../outside.mp4'), /recording_not_found/);
});
