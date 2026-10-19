const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const crop = require('../main/video-crop');
const paths = { ffmpegPath: require('@ffmpeg-installer/ffmpeg').path, ffprobePath: require('@ffprobe-installer/ffprobe').path };
const dir = fs.mkdtempSync(path.resolve(__dirname, '../../temp/crop-test-'));
const signal = new AbortController().signal;
function ff(args) { return execFileSync(paths.ffmpegPath, ['-v', 'error', ...args], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }); }
function flatten(x, prefix = '') { return Object.entries(x).flatMap(([k,v]) => typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]); }
function fixture(file, audio = 'aac') {
    ff(['-f','lavfi','-i','color=white:s=240x140:r=25:d=3', '-f','lavfi','-i','sine=frequency=700:sample_rate=44100:duration=3',
        '-vf','pad=320:240:40:50:black','-c:v','libx264','-pix_fmt','yuv420p','-c:a',audio,'-y',file]);
}
(async () => {
    const keys = flatten(require('../locales/en.json').video_crop).sort();
    for (const lang of ['tr','de','es','fr']) assert.deepEqual(flatten(require(`../locales/${lang}.json`).video_crop).sort(), keys);
    assert.throws(() => crop.validateCrop({ left: 1, right: 1, top: 0, bottom: 0 }, 320, 240), /invalid/);
    assert.throws(() => crop.validateCrop({ left: -2, right: 2, top: 0, bottom: 0 }, 320, 240), /invalid/);
    assert.deepEqual(crop.geometry({ width: 320, height: 240, tags: { rotate: '90' } }), { width: 240, height: 320 });
    const stable = { left: 40, right: 40, top: 50, bottom: 50 };
    assert(crop.combineEdges([stable, null, stable], 320, 240, 320, 240).uncertain);
    assert.deepEqual(crop.combineEdges([stable, {...stable, left: 0}, stable], 320,240,320,240).crop, { left:0,right:0,top:0,bottom:0 });
    assert.equal(crop.detectEdges(Buffer.alloc(320*240*3),320,240),null);
    const input = path.join(dir, 'source.mp4'); fixture(input);
    const analysis = await crop.analyze(input, paths, signal);
    assert.equal(analysis.uncertain, false);
    assert.deepEqual(analysis.crop, { left: 38, right: 38, top: 48, bottom: 48 });
    assert(analysis.frames.length >= 3);
    const output = path.join(dir,'cropped.mp4');
    await crop.render(analysis, analysis.crop, output, paths, signal);
    const packets = file => execFileSync(paths.ffprobePath, ['-v','error','-select_streams','a','-show_packets','-show_data_hash','sha256','-of','json',file], { maxBuffer: 8*1024*1024 }).toString();
    const hashes = file => JSON.parse(packets(file)).packets.map(p=>p.data_hash);
    assert.deepEqual(hashes(input), hashes(output), 'Untouched AAC packet payloads must remain identical');
    const pcm = path.join(dir,'pcm.mov'); fixture(pcm, 'pcm_s16le');
    const pcmAnalysis = await crop.analyze(pcm, paths, signal);
    await crop.render(pcmAnalysis, pcmAnalysis.crop, path.join(dir,'aac.mp4'), paths, signal);
    const audio = JSON.parse(execFileSync(paths.ffprobePath,['-v','error','-show_streams','-of','json',path.join(dir,'aac.mp4')])).streams.find(s=>s.codec_type==='audio');
    assert.equal(audio.profile,'LC'); assert.equal(audio.sample_rate,'44100'); assert.equal(audio.channels,1);
    const rotated = path.join(dir,'rotated.mp4');
    ff(['-i',input,'-c','copy','-metadata:s:v:0','rotate=90',rotated]);
    const rotatedAnalysis = await crop.analyze(rotated,paths,signal);
    assert.equal(rotatedAnalysis.width,240); assert.equal(rotatedAnalysis.height,320);
    await crop.render(rotatedAnalysis,rotatedAnalysis.crop,path.join(dir,'rotated-cropped.mp4'),paths,signal);
    const rotatedVideo = JSON.parse(execFileSync(paths.ffprobePath,['-v','error','-show_streams','-of','json',path.join(dir,'rotated-cropped.mp4')])).streams.find(s=>s.codec_type==='video');
    assert.deepEqual(crop.geometry(rotatedVideo),crop.validateCrop(rotatedAnalysis.crop,rotatedAnalysis.width,rotatedAnalysis.height));
    const full = path.join(dir,'fullrange.mp4');
    ff(['-f','lavfi','-i','testsrc2=s=320x240:r=25:d=1','-vf','scale=in_range=tv:out_range=pc','-c:v','libx264','-pix_fmt','yuvj420p','-color_range','pc','-colorspace','bt709',full]);
    const fullAnalysis = await crop.analyze(full,paths,signal);
    const fullOutput = path.join(dir,'fullrange-cropped.mp4');
    await crop.render(fullAnalysis,{left:20,right:20,top:20,bottom:20},fullOutput,paths,signal);
    const fullVideo = JSON.parse(execFileSync(paths.ffprobePath,['-v','error','-show_streams','-of','json',fullOutput])).streams.find(s=>s.codec_type==='video');
    assert.equal(fullVideo.color_range,'pc'); assert.equal(fullVideo.color_space,'bt709');
    const silent = path.join(dir,'silent-low-fps.mp4');
    ff(['-f','lavfi','-i','color=white:s=240x140:r=1:d=3','-vf','pad=320:240:40:50:black','-c:v','libx264','-pix_fmt','yuv420p',silent]);
    const silentAnalysis = await crop.analyze(silent,paths,signal);
    await crop.render(silentAnalysis,silentAnalysis.crop,path.join(dir,'silent-cropped.mp4'),paths,signal);
    const multi = path.join(dir,'multi.mov');
    ff(['-i',pcm,'-i',input,'-map','0:v','-map','0:a','-map','1:a','-c','copy',multi]);
    const multiAnalysis = await crop.analyze(multi,paths,signal);
    await crop.render(multiAnalysis,multiAnalysis.crop,path.join(dir,'multi-cropped.mp4'),paths,signal);
    await assert.rejects(crop.render(analysis,analysis.crop,input,paths,signal),/overwrite/);
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(crop.analyze(input,paths,cancelled.signal),/cancelled/);
    console.log('Crop: conservative detection, rotated/low-frame-rate/silent export, identical AAC packets, mixed multi-track audio policy, cancellation, validation and five locales passed.');
})().finally(()=>fs.rmSync(dir,{recursive:true,force:true})).catch(e=>{console.error(e);process.exitCode=1;});
