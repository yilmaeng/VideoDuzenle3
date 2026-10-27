const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const clone = x => JSON.parse(JSON.stringify(x));
const context = {
    console:{log(){}}, Event:class {}, document:{dispatchEvent(){}},
    window:{i18nHelper:{t:(key,params)=>key+JSON.stringify(params||{})}},
    Utils:{formatTime:String},
    VideoPlayer:{time:7,getTimelineTime(){return this.time;},seekToTimelineTime(t){this.time=t;},updateCursorDisplay(){}},
    Selection:{start:4,end:8,extendedAnchor:7,stopExtended(){this.extendedAnchor=null;},getSelection(){return {start:this.start,end:this.end};},updateUI(){},clear(){this.stopExtended();this.start=this.end=null;}},
    Markers:{markers:[{time:5}],getAll(){return this.markers;},handleTimelineDelete(){this.markers=[];},updateMarkerList(){},updateMarkerCount(){}}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../renderer/scripts/timeline.js'),'utf8'),context);
const t=context.window.Timeline;
t.renderVisuals=()=>{};
const reset=()=>{t.reset();t.sourceFile='a';t.segments=[{start:0,end:20,audioVolume:100,speed:1}];context.VideoPlayer.time=7;context.Selection.start=4;context.Selection.end=8;context.Markers.markers=[{time:5}];};
reset();
t.deleteRange(4,8);
assert.equal(t.undoStack.length,1);
assert.equal(t.undoStack[0].action,'delete');
assert(t.historyLabel(t.undoStack[0],true).includes('"seconds":"4"'));
context.VideoPlayer.time=12;context.Selection.clear();
const edited=clone(t.segments);
context.Selection.extendedAnchor=12;
assert(t.undo());t.restoreHistoryView();
assert.equal(context.Selection.extendedAnchor,null);
assert.equal(context.VideoPlayer.time,7);
assert.equal(context.Selection.start,4);
assert.equal(context.Selection.end,8);
assert.deepEqual(clone(context.Markers.markers),[{time:5}]);
assert(t.redo());t.restoreHistoryView();
assert(t.historyLabel(t.lastHistoryAction,true).includes('"seconds":"4"'));
assert.deepEqual(clone(t.segments),edited);
assert.equal(context.VideoPlayer.time,12);
assert.equal(context.Selection.start,null);
reset();t.applySpeedToRange(4,8,2,false);
assert.equal(t.undoStack.length,1,'Internal splits must not add history');
assert.equal(t.undoStack[0].action,'speed');
assert(t.undo());assert.equal(t.segments.length,1);assert.equal(t.segments[0].speed,1);
assert(t.redo());assert(t.segments.some(s=>s.speed===2));
reset();t.splitAt(0);assert.equal(t.undoStack.length,0);
t.splitAt(5);t.splitAt(5);assert.equal(t.undoStack.length,1,'No-op does not consume history');
reset();t.transaction('silences',null,()=>{t.deleteRange(12,13);t.deleteRange(3,4);});
assert.equal(t.undoStack.length,1);t.undo();assert.equal(t.getTotalDuration(),20);
reset();t.cut(4,8);assert.equal(t.undoStack.length,1);assert.equal(t.undoStack[0].action,'cut');
t.undo();t.deleteRange(1,2);assert.equal(t.redoStack.length,0);
reset();for(let i=0;i<55;i++) t.transaction('audio',null,()=>{t.segments[0].audioVolume++;});
assert.equal(t.undoStack.length,50);
for(let i=0;i<50;i++) assert(t.undo());assert.equal(t.undo(),false);
for(let i=0;i<50;i++) assert(t.redo());assert.equal(t.redo(),false);
assert.equal(t.segments[0].audioVolume,155);
for(const locale of ['tr','en','de','es','fr']) {
    const data=JSON.parse(fs.readFileSync(path.join(__dirname,`../locales/${locale}.json`),'utf8')).edit_history;
    assert(data.undone && data.redone && data.menu_undo && data.menu_redo && data.range);
    for(const action of ['edit','delete','cut','paste','split','speed','insert','audio','silences']) assert(data.actions[action]);
}
console.log('PASS: cursor, selection, markers, redo, nested edits, no-ops, batch delete, 50-step limit and locales');

(async()=>{
    context.App={updateAfterEdit(){}};
    context.VideoPlayer.getCurrentTime=()=>context.VideoPlayer.time;
    context.VideoPlayer.loadVideoSilent=async()=>{};
    context.VideoPlayer.seekTo=time=>{context.VideoPlayer.time=time;};
    context.VideoPlayer.showEmptyState=()=>{};
    context.Selection.setSelectionSilent=(start,end)=>{context.Selection.start=start;context.Selection.end=end;};
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../renderer/scripts/tab-manager.js'),'utf8'),context);
    const tabs=context.window.TabManager;
    tabs.updateFileInfo=()=>{};
    const makeTab=()=>({filePath:'a',timeline:{segments:[{start:0,end:20}],sourceFile:'a'},selection:{start:null,end:null},markers:[],cursorPosition:0});
    tabs.tabs=[makeTab(),makeTab()];tabs.activeTabIndex=0;
    reset();t.deleteRange(4,8);tabs.saveCurrentTabState();
    tabs.activeTabIndex=1;await tabs.loadTabState(tabs.tabs[1]);
    assert.equal(t.undoStack.length,0,'Fresh tab has no other tab history');
    t.splitAt(3);tabs.saveCurrentTabState();
    tabs.activeTabIndex=0;await tabs.loadTabState(tabs.tabs[0]);
    assert.equal(t.undoStack.length,1);assert.equal(t.undoStack[0].action,'delete');
    t.undo();t.restoreHistoryView();assert.equal(t.getTotalDuration(),20);
    assert.equal(context.VideoPlayer.time,7);
    assert.equal(tabs.tabs[1].undoStack[0].action,'split');
    console.log('PASS: independent deep-copied tab histories and cursor restoration after tab switching');
})().catch(error=>{console.error(error);process.exitCode=1;});
