const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const handler = require('../main/ffmpeg-handler');
const { buildLayerPlan } = require('../main/video-layer-renderer');
const { ffmpegPath, ffprobePath } = handler.getFFmpegPaths();
const run = (exe,args) => execFileSync(exe,args,{windowsHide:true,maxBuffer:16*1024*1024});
const root = fs.mkdtempSync(path.join(__dirname,'../../temp/video-layer-'));
function make(name,color,size,tone,duration=3) {
    const file=path.join(root,name+'.mp4');
    run(ffmpegPath,['-v','error','-f','lavfi','-i',`color=c=${color}:s=${size}:r=25:d=${duration}`,
        ...(tone?['-f','lavfi','-i',`sine=frequency=${tone}:sample_rate=44100:duration=${duration}`]:[]),
        '-c:v','libx264','-preset','ultrafast',...(tone?['-c:a','aac','-aac_coder','twoloop','-b:a','160k']:['-an']),file]);
    return file;
}
function amplitude(file,time,tone) {
    const pcm=run(ffmpegPath,['-v','error','-i',file,'-ss',String(time),'-t','0.2','-vn','-ac','1','-ar','44100','-f','f32le','pipe:1']);
    let real=0,imag=0; const n=pcm.length/4;
    for(let i=0;i<n;i++){const x=pcm.readFloatLE(i*4);real+=x*Math.cos(2*Math.PI*tone*i/44100);imag+=x*Math.sin(2*Math.PI*tone*i/44100);}
    return 2*Math.hypot(real,imag)/n;
}
async function main(){
    const mainVideoPath=make('main','red','240x136',440,4);
    const layerVideoPath=make('layer','blue','80x160',880,3);
    const cases=[
        {mode:'split-screen'},
        {mode:'split-screen',muteLayer:true},
        {mode:'custom',position:{x:20,y:10},size:{width:60,height:100},startTime:1,endTime:2,syncOffset:500},
        {mode:'split-screen',cutRegions:[{start:.5,end:1}]},
        {mode:'split-screen',layerVideoPath:make('silent','blue','80x160',null)},
    ];
    for(let i=0;i<cases.length;i++) {
        const outputPath=path.join(root,`out-${i}.mp4`);
        await handler.addVideoLayer({mainVideoPath,layerVideoPath,outputPath,mainVolume:100,layerVolume:100,...cases[i]},()=>{});
        const streams=JSON.parse(run(ffprobePath,['-v','error','-show_streams','-of','json',outputPath])).streams;
        assert(Math.abs(Number(streams[0].duration)-4)<.06,'Short layer must not truncate main video');
        assert(amplitude(outputPath,1.2,440)>.08,'Main audio must remain present at intended gain');
        if(i===1||i===4) assert(amplitude(outputPath,1.2,880)<.003,'Muted/missing layer audio');
        else assert(amplitude(outputPath,1.2,880)>.08,'Layer audio must be included');
        if(i===0) {
            const pixels=run(ffmpegPath,['-v','error','-ss','1','-i',outputPath,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
            const pixel=(x,y)=>Array.from(pixels.subarray((y*240+x)*3,(y*240+x)*3+3));
            assert(pixel(60,68)[2]>200,'Added video must occupy left panel');
            assert(pixel(180,68)[0]>200,'Main video must occupy right panel');
            assert(pixel(180,4)[0]>200,'Empty panel area uses blurred source, not black');
            assert(amplitude(outputPath,3.4,440)>.08,'Ending layer must not change main gain');
        }
        if(i===2) {
            assert(amplitude(outputPath,.2,880)<.003);
            assert(amplitude(outputPath,2.3,880)<.003);
        }
    }
    const m=await handler.getVideoMetadata(mainVideoPath), l=await handler.getVideoMetadata(layerVideoPath);
    assert(buildLayerPlan({mode:'split-screen',layerVolume:100},m,l).filters.join(';').includes('boxblur'));
    console.log(`PASS: split layout, blur fill, mixed/muted/missing audio, timing, cuts, shorter layer. ${root}`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
