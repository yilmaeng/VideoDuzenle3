const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { getFFmpegPaths } = require('../main/ffmpeg-handler');
const { runFfmpeg } = require('../main/export/continuous-audio-renderer');
const { analyzeSource, getKeyframes } = require('../main/export/source-profile-analyzer');
const { renderHybridSmart, renderHybridChunk, buildHybridChunkPlan, resolveBoundaryEncoder } = require('../main/export/hybrid-smart-renderer');

(async () => {
    const paths = getFFmpegPaths();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-bframe-regression-'));
    const source = path.join(dir, 'source.mp4');
    try {
        await runFfmpeg(paths.ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=12',
            '-f', 'lavfi', '-i', 'sine=sample_rate=48000:duration=12', '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p', '-g', '25', '-keyint_min', '25', '-sc_threshold', '0', '-bf', '3',
            '-c:a', 'aac', '-aac_coder', 'twoloop', source]);
        const profile = await analyzeSource(paths.ffprobePath, source);
        const keyframes = await getKeyframes(paths.ffprobePath, source);
        assert(keyframes.decodeTimes.get(2.5) < 2.5, 'Fixture must contain reordered B frames');
        const chunks = buildHybridChunkPlan([{ start: 2.5, end: 7.5 }], keyframes, 0.025);
        const chunkPath = path.join(dir, 'copy.ts');
        await renderHybridChunk({ ffmpegPath: paths.ffmpegPath, source, chunk: chunks[0], outputPath: chunkPath,
            sourceProfile: profile, targetProfile: profile, encoder: resolveBoundaryEncoder(profile, new Set(['libx264'])) });
        const copy = await analyzeSource(paths.ffprobePath, chunkPath);
        assert(Math.abs(copy.video.duration - 5) < 0.001, 'Copy must contain exactly the intended GOPs');
        const frames = file => JSON.parse(execFileSync(paths.ffprobePath, ['-v', 'error', '-select_streams', 'v',
            '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'json', file], { encoding: 'utf8' })).streams[0].nb_read_packets;
        assert.strictEqual(Number(frames(chunkPath)), 50);
        for (const segments of [[{ start: 0.688, end: 11.91 }], [{ start: 0, end: 5 }],
            [{ start: 0.688, end: 4.5 }, { start: 7.5, end: 11.91 }]]) {
            const result = await renderHybridSmart({ ...paths, inputPath: source, segments, outputPath: path.join(dir, 'out.mp4') });
            assert(result.success);
            assert(result.validation.avDrift < 0.1);
            assert(Math.abs(result.validation.profile.video.startTime) < 0.001);
            assert(Math.abs(result.validation.profile.audio[0].startTime) < 0.001);
        }
        console.log('Low-frame-rate B-frame hybrid timing passed.');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
