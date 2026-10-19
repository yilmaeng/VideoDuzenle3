const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const segments = [{start:0,end:5.137},{start:10.283,end:30}];
let requests = 0;
const audioRequests = [];
const scheduled = [];
const context = {
    currentTime:0, destination:{}, resume:async()=>{},
    createGain:()=>({gain:{value:1},connect(){},disconnect(){}}),
    createBuffer:(channels, frames, rate)=>({duration:frames/rate,getChannelData:()=>new Float32Array(frames)}),
    createBufferSource:()=>({connect(){},disconnect(){},stop(){this.stopped=true;},start(t){this.startAt=t;scheduled.push(this);}}),
};
const sandbox = {window:{api:{getTimelinePreviewAudio:async({spans})=>{
    requests++;
    audioRequests.push(spans);
    return {pcm:new Uint8Array(Math.round(spans.reduce((n,s)=>n+s.end-s.start,0)*48000)*8),channels:2,sampleRate:48000};
}}}, Timeline:{segments,sourceFile:'source.mp4'},console,performance:{now:()=>1000},setInterval:()=>1,clearInterval(){},Float32Array,Uint8Array};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../renderer/scripts/seamless-preview.js'),'utf8'),sandbox);
const player={audioContext:context,currentFilePath:'source.mp4',playbackVolumePercent:100,
    video:{currentTime:0,paused:false,seeking:false},updateTimeDisplay(){},pause(){preview.stop();}};
const preview=new sandbox.window.SeamlessPreview(player);
async function main(){
    assert(preview.eligible(segments));
    assert(!preview.eligible([{...segments[0],speed:2},segments[1]]));
    assert(!preview.eligible([{...segments[0],speedBgAudio:'music'},segments[1]]));
    assert(await preview.start(0,segments));
    assert.equal(scheduled[0].startAt,.05);
    context.currentTime=.05+5.14;
    preview.tick();
    assert.equal(player._currentTimelineSegmentIndex,1);
    assert(Math.abs(player.video.currentTime-10.286)<.00001);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(scheduled[1].startAt,12.05,'Next audio block must be scheduled without a gap');
    player.playbackVolumePercent=150; preview.tick(); assert.equal(preview.gain.gain.value,1.5);
    preview.stop(); assert(!preview.active); assert(scheduled.every(n=>n.stopped));
    const pending=preview.start(2,segments); preview.stop(); assert.equal(await pending,false);
    assert(!preview.active,'Cancelled asynchronous preview must not restart');
    assert(requests>=3);
    const multi = [{sourceFile:'source.mp4',start:0,end:1},{sourceFile:'other.mp4',start:1,end:4},
        {sourceFile:'source.mp4',start:5,end:15}];
    sandbox.Timeline.segments=multi;
    let finishLoad;
    player.loadVideoSilent = file => {
        player.currentFilePath=file;
        return new Promise(resolve => { finishLoad=resolve; });
    };
    context.currentTime=0;
    assert(preview.eligible(multi));
    assert(await preview.start(0,multi));
    assert.equal(audioRequests.at(-1)[1].source,'other.mp4');
    assert.equal(audioRequests.at(-1)[0].fadeOut,true,'Source switch fades even at matching timestamps');
    context.currentTime=1.15;
    preview.tick();
    assert(preview.active && preview.switchingVideo);
    const scheduledBefore=scheduled.length;
    context.currentTime=1.55;
    finishLoad(); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(player._currentTimelineSegmentIndex,1);
    assert(Math.abs(player.video.currentTime-1.5)<1e-6,'Image catches up to audio, not stale load time');
    assert.equal(scheduled.length,scheduledBefore,'Source switch does not restart audio');
    context.currentTime=4.15; preview.tick();
    assert(preview.switchingVideo);
    preview.stop();
    finishLoad(); await new Promise(resolve=>setImmediate(resolve));
    assert(!preview.active && !preview.switchingVideo,'Stale video load cannot resume stopped preview');
    console.log('PASS: eligibility, timeline mapping, exact block scheduling, volume, stop, cancellation');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
