const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { buildSlideshowAudioMix: mix } = require('../main/slideshow-audio-mix');
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
const music = 'aevalsrc=0.08*sin(2*PI*440*t)|0.04*sin(2*PI*660*t):s=48000:d=3';
const silence = 'anullsrc=r=48000:cl=stereo';

function render(inputs, graph, output = 'out') {
    const args = ['-v', 'error'];
    for (const source of inputs) args.push('-f', 'lavfi', '-i', source);
    args.push('-filter_complex', graph, '-map', `[${output}]`, '-t', '3', '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1');
    const result = spawnSync(ffmpeg, args, { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
    const values = new Float32Array(result.stdout.length / 4);
    for (let i = 0; i < values.length; i++) values[i] = result.stdout.readFloatLE(i * 4);
    return values;
}
function same(actual, expected, name) {
    assert.equal(actual.length, expected.length, `${name}: duration/channels`);
    let maxError = 0;
    for (let i = 0; i < actual.length; i++) maxError = Math.max(maxError, Math.abs(actual[i] - expected[i]));
    assert(maxError < 0.000001, `${name}: max sample error ${maxError}`);
    console.log(`${name}: pass (max sample error ${maxError})`);
}
const reference = render([music], '[0:a]anull[out]');
same(render([music, silence], mix(['0:a', '1:a'], 'out', 3)), reference, 'Music plus silent image track');
same(render([music, silence], `[1:a]atrim=0:1[short];${mix(['0:a', 'short'], 'out', 3)}`), reference, 'Short silent input does not raise later music gain');
same(render([music], '[0:a]asplit=3[a][b][c];[a]atrim=0:1[x];[b]atrim=1:2,asetpts=PTS-STARTPTS,adelay=1000|1000[y];[c]atrim=2:3,asetpts=PTS-STARTPTS,adelay=2000|2000[z];' + mix(['x', 'y', 'z'], 'out', 3)), reference, 'Sequential paired audio segments retain their gain');
same(render([music, silence], `${mix(['0:a', '1:a'], 'bg', 3)};[bg]volume=0.35[ducked];[1:a]atrim=0:3[base];${mix(['base', 'ducked'], 'out', 3)}`), Float32Array.from(reference, value => value * 0.35), 'Nested mix preserves intentional ducking');
const tone = 'aevalsrc=0.02*sin(2*PI*220*t)|0.03*sin(2*PI*330*t):s=48000:d=1';
const toneReference = render([tone], '[0:a]apad,atrim=0:3[out]');
same(render([music, tone], mix(['0:a', '1:a'], 'out', 3)), Float32Array.from(reference, (value, i) => value + toneReference[i]), 'Real video audio plus music, including shorter video audio');
assert(!mix(['a', 'b'], 'out', 3).includes('normalize='));
assert(!mix(['a', 'b'], 'out', 3).includes('pad_dur='));
const handler = fs.readFileSync(path.join(__dirname, '../main/slideshow-handler.js'), 'utf8');
assert(!handler.includes('amix=inputs='), 'All slideshow mixing must use the gain-stable helper');
console.log('Slideshow audio regression tests passed using bundled FFmpeg.');
