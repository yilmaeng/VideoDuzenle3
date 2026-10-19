const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const handler = require('../main/ffmpeg-handler');
const {renderContinuousAudioPass} = require('../main/export/continuous-audio-renderer');
const {analyzeSource} = require('../main/export/source-profile-analyzer');
const {renderPreviewAudio} = require('../main/export/timeline-preview-audio');
const {ffmpegPath, ffprobePath} = handler.getFFmpegPaths();
const root = fs.mkdtempSync(path.join(__dirname, '../../temp/inserted-video-audio-'));
const run = (exe, args) => execFileSync(exe, args, {windowsHide:true, maxBuffer:32*1024*1024});
const decode = file => run(ffmpegPath, ['-v','error','-i',file,'-vn','-ar','48000','-ac','2','-f','f32le','pipe:1']);
function rms(pcm, start, end) {
    let sum=0, count=0;
    for(let n=Math.round(start*48000)*2; n<Math.round(end*48000)*2; n++) { sum+=pcm.readFloatLE(n*4)**2; count++; }
    return Math.sqrt(sum/count);
}
(async () => {
    const sources = [path.join(root,'original.mp4'), path.join(root,'inserted.mp4')];
    for (const [i, source] of sources.entries()) {
        run(ffmpegPath,['-v','error','-f','lavfi','-i','color=s=160x90:r=30:d=8',
            '-f','lavfi','-i',`sine=frequency=${i ? 733 : 997}:sample_rate=48000:duration=8`,
            '-ac','2','-c:v','libx264','-preset','ultrafast','-c:a','aac','-aac_coder','twoloop',source]);
    }
    const gapSource = path.join(root,'original-gap.mp4');
    run(ffmpegPath,['-v','error','-i',sources[0],'-af','asetpts=PTS+if(gte(N\\,1024)\\,0.244\\,0)/TB',
        '-c:v','copy','-c:a','aac','-aac_coder','twoloop',gapSource]);
    sources[0] = gapSource;
    const profiles = await Promise.all(sources.map(s => analyzeSource(ffprobePath,s)));
    for (const [name, segments] of [
        ['middle',[{sourceFile:sources[0],start:0,end:3.137},{sourceFile:sources[1],start:0,end:2.281},{sourceFile:sources[0],start:3.137,end:5.991}]],
        ['ends',[{sourceFile:sources[1],start:0,end:1.137},{sourceFile:sources[0],start:1,end:4.281},{sourceFile:sources[1],start:2,end:3.993}]]
    ]) {
        const ordinary=path.join(root,`${name}.mp4`);
        await handler.renderTimeline(sources[0],segments,ordinary,()=>{});
        const continuous=path.join(root,`${name}.wav`);
        await renderContinuousAudioPass({ffmpegPath,inputPath:sources[0],segments,sourceProfiles:profiles,outputPath:continuous});
        const duration=segments.reduce((sum,s)=>sum+s.end-s.start,0);
        const preview = await renderPreviewAudio(ffmpegPath, {source:sources[0], spans:segments.map((s,i)=>({
            source:s.sourceFile,start:s.start,end:s.end,segmentStart:s.start,segmentEnd:s.end,
            fadeIn:i>0,fadeOut:i<segments.length-1
        }))}, ffprobePath);
        assert(Math.abs(preview.pcm.length/8/48000-duration)<1/48000);
        for(const file of [ordinary,continuous]) {
            const pcm=decode(file);
            assert(Math.abs(pcm.length/8/48000-duration)<.024, 'No accumulating audio padding');
            let join=0;
            for(const s of segments.slice(0,-1)) {
                join+=s.end-s.start;
                for(let t=join-.4; t<join+.1; t+=.005) assert(rms(pcm,t,t+.005)>.004, `Unexpected silence at ${t}: ${file}`);
                if(file===continuous) assert(rms(pcm,join,join+.001)<rms(pcm,join+.01,join+.02)*.5, '3ms fade at source switch');
            }
        }
        let join=0;
        for(const s of segments.slice(0,-1)) {
            join+=s.end-s.start;
            for(let t=join-.1;t<join+.1;t+=.005) assert(rms(preview.pcm,t,t+.005)>.004,'Preview has no source-switch gap');
        }
    }
    const silent=path.join(root,'silent.mp4');
    run(ffmpegPath,['-v','error','-i',sources[1],'-an','-c:v','copy',silent]);
    const preview = await renderPreviewAudio(ffmpegPath,{source:sources[1],spans:[
        {source:sources[1],start:0,end:1},{source:silent,start:0,end:1},{source:sources[1],start:2,end:3}
    ]},ffprobePath);
    assert.equal(preview.pcm.length,3*48000*8);
    assert(rms(preview.pcm,1.1,1.9)<1e-8,'Video without audio retains silent duration');
    assert(rms(preview.pcm,2.1,2.9)>.01,'Sound resumes after silent video');
    console.log('PASS: inserted videos at start/middle/end, ordinary and hybrid audio paths, timestamp gap, duration and smoothing');
})().catch(e=>{console.error(e);process.exitCode=1;});
