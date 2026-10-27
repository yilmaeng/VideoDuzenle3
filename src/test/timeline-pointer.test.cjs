const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function harness() {
    class Element {
        constructor() { this.events={};this.children=[];this.dataset={};this.style={};this.value=''; }
        addEventListener(k,fn) { this.events[k]=fn; }
        emit(k,extra={}) { this.events[k]?.({button:0,pointerId:1,clientX:0,preventDefault(){},...extra}); }
        append(...children) {this.children.push(...children);}
        before(...children) {this.siblings=children;}
        setAttribute() {}
        querySelectorAll() {return this.children.filter(x=>x.type==='button');}
        getBoundingClientRect() {return {left:0,width:1000};}
        setPointerCapture(id) {this.capture=id;}
        hasPointerCapture(id) {return this.capture===id;}
        releasePointerCapture() {this.capture=null;}
    }
    const visual=new Element(), events={};
    const document={getElementById:()=>visual,createElement:()=>new Element(),addEventListener:(k,f)=>{events[k]=f;}};
    let selected=null,time=10,announcements=0;const calls=[];
    const VideoPlayer={video:{},hasVideo:()=>true,getTimelineTime:()=>time,pause:()=>calls.push('pause'),seekToTimelineTime:t=>{time=t;},updateCursorDisplay(){},togglePlay(){},playSelection(){},playCutPreview(){}};
    const Selection={getSelection:()=>selected,hasSelection:()=>!!selected,clear:()=>{selected=null;},setSelectionSilent:(start,end)=>{selected={start,end};},setSelection:(start,end)=>{selected={start,end};announcements++;}};
    const App=Object.fromEntries(['cut','copy','paste','delete','undo','redo','addSelectionToVerticalQueue'].map(k=>[k,()=>calls.push(k)]));
    const context={document,window:{i18nHelper:{t:k=>k}},VideoPlayer,Selection,App,Timeline:{getTotalDuration:()=>100,undoStack:[],redoStack:[],clipboard:null},Utils:{formatTime:String}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../renderer/scripts/timeline-pointer.js'),'utf8'),context);
    events.DOMContentLoaded();
    return {visual,VideoPlayer,calls,selection:()=>selected,time:()=>time,announcements:()=>announcements};
}
test('click seeks, reverse drag selects, and toolbar uses existing delete command',()=>{
    const h=harness();
    h.visual.emit('pointerdown',{clientX:400});h.visual.emit('pointerup',{clientX:400});
    assert.equal(h.time(),40);assert.equal(h.selection(),null);
    h.visual.emit('pointerdown',{clientX:600});h.visual.emit('pointermove',{clientX:200});
    assert.equal(h.announcements(),0);
    h.visual.emit('pointerup',{clientX:200});
    assert.equal(h.selection().start,20);assert.equal(h.selection().end,60);assert.equal(h.announcements(),1);
    const toolbar=h.visual.siblings[0];
    const button=toolbar.children.find(x=>x.dataset.action==='delete');
    assert.equal(button.disabled,false);button.emit('click');assert.ok(h.calls.includes('delete'));
});
test('cancelling pointer operation restores previous selection and position',()=>{
    const h=harness();
    h.visual.emit('pointerdown',{clientX:100});h.visual.emit('pointermove',{clientX:300});h.visual.emit('pointerup',{clientX:300});
    h.visual.emit('pointerdown',{clientX:500});h.visual.emit('pointermove',{clientX:900});h.visual.emit('pointercancel');
    assert.equal(h.time(),30);assert.equal(h.selection().start,10);assert.equal(h.selection().end,30);
});
test('right click does not change cursor or selection',()=>{
    const h=harness();h.visual.emit('pointerdown',{button:2,clientX:900});h.visual.emit('pointerup',{button:2,clientX:900});
    assert.equal(h.time(),10);assert.equal(h.selection(),null);
});
