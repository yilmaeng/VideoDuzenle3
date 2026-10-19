const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { planSelections, buildReplacementTimeline } = require('../main/vocal-selection-plan');
const { renderContinuousAudio, runFfmpeg } = require('../main/export/continuous-audio-renderer');
const { getFFmpegPaths } = require('../main/ffmpeg-handler');

async function main() {
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'evd-selection-test-'));
    const source = path.join(dir, 'source.wav'), stem = path.join(dir, 'stem.wav');
    const output = path.join(dir, 'result.wav');
    const { ffmpegPath, ffprobePath } = getFFmpegPaths();
    const rows = [[3, 4], [1, 2], [1.5, 3]].map(([startTime, endTime]) => ({ sourcePath: source, startTime, endTime }));
    assert.deepEqual(planSelections(rows, source, 5, 48000), [{ start: 48000, end: 192000, contextStart: 0, contextEnd: 240000 }]);
    assert.throws(() => planSelections([], source, 5, 48000), /selections/);
    assert.throws(() => planSelections([{ ...rows[0], sourcePath: stem }], source, 5, 48000), /selections/);
    assert.throws(() => planSelections([{ ...rows[0], endTime: 6 }], source, 5, 48000), /selections/);
    try {
        for (const [rate, channels] of [[48000, 2], [44100, 1]]) {
            await runFfmpeg(ffmpegPath, ['-y', '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=${rate}:duration=5`, '-ac', String(channels), '-c:a', 'pcm_f32le', source]);
            await runFfmpeg(ffmpegPath, ['-y', '-i', source, '-af', 'volume=0.25', '-c:a', 'pcm_f32le', stem]);
            const plan = planSelections([{ sourcePath: source, startTime: 1, endTime: 4 }], source, 5, rate);
            await renderContinuousAudio({ ffmpegPath, ffprobePath, inputPath: source, outputPath: output,
                segments: buildReplacementTimeline(plan, source, [stem], 5, rate),
                sourceProfiles: [source, stem].map(filePath => ({ filePath, audio: [{ codec_name: 'pcm_f32le', sample_rate: rate, channels }] })) });
            const raw = file => execFileSync(ffmpegPath, ['-v', 'error', '-i', file, '-f', 'f32le', '-c:a', 'pcm_f32le', '-'], { maxBuffer: 10e6 });
            const original = raw(source), result = raw(output);
            assert.equal(result.length, original.length, 'Output duration and channel count must remain exact');
            const frameBytes = channels * 4;
            assert.deepEqual(result.subarray(0, Math.floor(rate * 0.99) * frameBytes), original.subarray(0, Math.floor(rate * 0.99) * frameBytes));
            assert.deepEqual(result.subarray(Math.ceil(rate * 4.01) * frameBytes), original.subarray(Math.ceil(rate * 4.01) * frameBytes));
            for (let frame = rate * 2; frame < rate * 3; frame += 31) {
                const index = frame * frameBytes;
                assert(Math.abs(result.readFloatLE(index) - original.readFloatLE(index) * 0.25) < 1e-6);
            }
        }
        const controller = new AbortController(); controller.abort();
        await assert.rejects(runFfmpeg(ffmpegPath, [], { signal: controller.signal }));
        console.log('Selection merging, boundaries, unchanged samples, processed ranges, mono/stereo and cancellation passed.');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
