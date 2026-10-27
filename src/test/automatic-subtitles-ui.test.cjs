const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
    const jobs=[], saves=[], inserts=[], cancelled=[]; let document;
    class Element {
        constructor(){this.events={};this.style={};this.nodes=new Map();this.isConnected=true;}
        addEventListener(k,f){(this.events[k] ||= []).push(f);}
        emit(k,e={}){return Promise.all((this.events[k]||[]).map(f=>f({preventDefault(){},...e})));}
        setAttribute(){} removeAttribute(){}
        querySelector(k){if(!this.nodes.has(k))this.nodes.set(k,new Element());return this.nodes.get(k);}
        querySelectorAll(){return ['small','base'].map(name=>{const r=this.querySelector(name);r.value=`Xenova/whisper-${name}`;r.checked=name==='small';return r;});}
        focus(){document.activeElement=this;}
        showModal(){this.open=true;}
        close(){this.open=false;this.emit('close');}
        remove(){this.isConnected=false;}
    }
    const elements=[];
    document={activeElement:new Element(),body:{append(){}},createElement(){const el=new Element();elements.push(el);return el;}};
    const api={platform:'win32',speechSearchInspect:async()=>({supported:true,ready:false}),
        onSpeechSearchProgress:()=>()=>{},speechSearchCancel:async id=>cancelled.push(id),
        speechSearchAnalyze(params){return new Promise((resolve,reject)=>jobs.push({...params,resolve,reject}));},
        showSaveDialog:async()=>({filePath:'D:/video_subtitles.srt'}),saveFileContent:async data=>{saves.push(data);return {success:true};}};
    const window={api,i18nHelper:{t:key=>key,translateDOM(){}},AutomaticSubtitlesCore:require('../renderer/scripts/automatic-subtitles-core')};
    const App={currentFilePath:'D:/video.mp4',insertSubtitle:async file=>inserts.push(file)};
    vm.runInNewContext(fs.readFileSync(require.resolve('../renderer/scripts/automatic-subtitles.js'),'utf8'),{window,document,App,VideoPlayer:{hasVideo:()=>true,pause(){}},console});
    return {window,elements,jobs,saves,inserts,cancelled,App};
}
test('explicit start is required; generated SRT enters the original insertion flow',async()=>{
    const h=harness();await h.window.AutomaticSubtitles.generate();
    assert.equal(h.jobs.length,0);
    const d=h.elements[0];assert.equal(d.querySelector('[data-start]').disabled,false);
    const running=d.querySelector('[data-start]').emit('click');
    assert.equal(h.jobs.length,1);assert.equal(h.jobs[0].model,'Xenova/whisper-small');
    h.jobs[0].resolve({transcripts:[{words:[{start:1,end:2,text:'Merhaba.'}]}]});
    await running;
    assert.match(h.saves[0].content,/00:00:01,000 --> 00:00:02,000/);
    assert.deepEqual(h.inserts,['D:/video_subtitles.srt']);
    assert.equal(d.isConnected,false);
});
test('close cancels analysis and stale completion cannot save or insert subtitles',async()=>{
    const h=harness();await h.window.AutomaticSubtitles.generate();
    const d=h.elements[0];const running=d.querySelector('[data-start]').emit('click');
    await d.querySelector('[data-close]').emit('click');
    assert.equal(h.cancelled[0],h.jobs[0].jobId);
    h.jobs[0].resolve({transcripts:[{words:[{start:1,end:2,text:'No.'}]}]});
    await running;await flush();assert.equal(h.saves.length,0);assert.equal(h.inserts.length,0);
});
test('silence and errors remain in dialog without invoking insertion',async()=>{
    const h=harness();await h.window.AutomaticSubtitles.generate();
    const d=h.elements[0];let running=d.querySelector('[data-start]').emit('click');
    h.jobs[0].resolve({transcripts:[{words:[]}]});await running;
    assert.equal(d.querySelector('[data-status]').textContent,'automatic_subtitles.empty');
    running=d.querySelector('[data-start]').emit('click');h.jobs[1].reject(new Error('failed'));await running;
    assert.equal(d.querySelector('[data-status]').textContent,'automatic_subtitles.error');
    assert.equal(h.saves.length,0);assert.equal(h.inserts.length,0);
});
