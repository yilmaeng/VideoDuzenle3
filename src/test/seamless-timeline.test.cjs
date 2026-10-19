const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const handler = require('../main/ffmpeg-handler');
const { planTimeline } = require('../main/export/seamless-timeline');
const { renderPreviewAudio } = require('../main/export/timeline-preview-audio');
const { ffmpegPath, ffprobePath } = handler.getFFmpegPaths();
const root = fs.mkdtempSync(path.join(__dirname, '../../temp/seamless-'));
const run = (exe, args) => execFileSync(exe, args, { windowsHide: true, maxBuffer: 32*1024*1024 });
const decode = file => run(ffmpegPath, ['-v','error','-i',file,'-vn','-f','f32le','pipe:1']);
const rms = (bytes, start, end, channels = 2) => {
    let sum = 0; let count = 0;
    for (let i = Math.round(start*48000)*channels; i < Math.min(bytes.length/4, Math.round(end*48000)*channels); i++) {
        sum += bytes.readFloatLE(i*4)**2; count++;
    }
    return Math.sqrt(sum/count);
};
async function main() {
    const durations = Array.from({length: 500}, () => .213);
    const plan = planTimeline(durations, 30);
    assert.equal(plan.reduce((n,p) => n+p.count,0), Math.round(500*.213*30));
    const source = path.join(root, 'source.mp4');
    run(ffmpegPath, ['-v','error','-f','lavfi','-i','color=s=160x90:r=30:d=16', '-f','lavfi','-i',
        'sine=frequency=997:sample_rate=48000:duration=16', '-ac','2','-c:v','libx264','-preset','ultrafast','-c:a','aac','-aac_coder','twoloop','-b:a','320k',source]);
    const cases = [
        [{start:0,end:5.137},{start:10.283,end:14}],
        Array.from({length:31},(_,i)=>({start:i*.431,end:i*.431+.213})),
        [{start:0,end:1.137,speed:2,audioVolume:50},{start:4.283,end:6,isMuted:true},{start:8,end:10}],
        [{start:10.283,end:14},{start:1.137,end:3.281},{start:6.011,end:7.993}],
    ];
    for (let c=0;c<cases.length;c++) {
        const segments = cases[c];
        const out = path.join(root, `case-${c}.mp4`);
        await handler.renderTimeline(source,segments,out,()=>{});
        const streams = JSON.parse(run(ffprobePath,['-v','error','-show_streams','-of','json',out])).streams;
        const a = streams.find(s=>s.codec_type==='audio');
        const v = streams.find(s=>s.codec_type==='video');
        const expected = segments.reduce((n,s)=>n+(s.end-s.start)/(s.speed||1),0);
        assert(Math.abs(Number(a.duration)-expected)<.024, 'Audio duration must not accumulate frame padding');
        assert(Math.abs(Number(v.duration)-expected)<1/30+.002, 'Video must stay within one frame of timeline');
        assert.equal(a.sample_rate,'48000'); assert.equal(a.channels,2);
        const pcm = decode(out);
        if(c!==2) {
            let t=0;
            for(const s of segments.slice(0,-1)) {
                t+=s.end-s.start;
                for(let dt=-.015;dt<.015;dt+=.002) assert(rms(pcm,t+dt,t+dt+.002)>.01,`Silence near cut ${t}`);
            }
        } else {
            assert(rms(pcm,.1,.4)>.01);
            assert(rms(pcm,.8,1.2)<.0001,'Muted segment must remain muted');
        }
    }
    // A malformed first packet spans 265 ms while decoding only 1024 samples.
    // Its missing time must not become silence at the first edit boundary.
    for (const [gap, atSample, cut] of [[.08,1024,4.137],[.244,1024,5],[.6,96000,6.271]]) {
        const gapSource = path.join(root, `timestamp-gap-${gap}.mp4`);
        run(ffmpegPath, ['-v','error','-i',source,'-af',
            `asetpts=PTS+if(gte(N\\,${atSample})\\,${gap}\\,0)/TB`,
            '-c:v','copy','-c:a','aac','-aac_coder','twoloop',gapSource]);
        const gapOut = path.join(root, `timestamp-gap-cut-${gap}.mp4`);
        await handler.renderTimeline(gapSource,[{start:0,end:cut},{start:8,end:12}],gapOut,()=>{});
        const gapPcm = decode(gapOut);
        for(let t=cut-.7;t<cut+.1;t+=.005) {
            assert(rms(gapPcm,t,t+.005)>.01, `Timestamp gap ${gap} moved to cut at ${t}`);
        }
    }
    const spans=[{start:0,end:5.137},{start:10.283,end:14}];
    const preview = await renderPreviewAudio(ffmpegPath,{source,spans});
    const original=decode(source);
    const expected=Buffer.concat(spans.map(s=>original.subarray(Math.round(s.start*48000)*8,Math.round(s.end*48000)*8)));
    assert.equal(preview.pcm.length,expected.length);
    let squaredError=0;
    for(let i=0;i<expected.length;i+=4) squaredError+=(expected.readFloatLE(i)-preview.pcm.readFloatLE(i))**2;
    assert(Math.sqrt(squaredError/(expected.length/4))<.0001,`PCM preview must match source cuts: error=${Math.sqrt(squaredError/(expected.length/4))}`);
    assert(rms(preview.pcm,5.137,5.147)>.01);
    console.log(`PASS: 500-cut frame plan; actual exports, speeds, mute, A/V timing and PCM preview. ${root}`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
