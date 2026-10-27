// Isolated Chromium smoke test: no real media, microphone, network or credentials.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
app.setPath('userData',path.join(root,'temp/timeline-subtitles-smoke-profile'));
app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{sandbox:true}});
    try {
        await win.loadURL('data:text/html,<html><body><button id="origin">Origin</button><section id="timeline-section" tabindex="0" aria-describedby="timeline-focus-duration"><span id="timeline-focus-duration"></span><div id="timeline-visual" style="height:80px;width:100%;background:%23123456"></div></section></body></html>');
        await win.webContents.executeJavaScript(`
            window.locale=${JSON.stringify(require('../locales/tr.json'))};
            window.i18nHelper={t(key,p={}){let text=key.split('.').reduce((o,k)=>o?.[k],locale);if(typeof text!=='string')throw Error(key);for(const[k,v]of Object.entries(p))text=text.replaceAll('{'+k+'}',String(v));return text;},translateDOM(el){el.querySelectorAll('[data-i18n]').forEach(e=>e.textContent=this.t(e.dataset.i18n));}};
            window.calls=[];window.saved=[];window.inserted=[];window.analyses=0;
            window.VideoPlayer={video:{},position:0,hasVideo:()=>true,getTimelineTime(){return this.position},pause(){},seekToTimelineTime(t){this.position=t},updateCursorDisplay(){},updateDurationDisplay(){},togglePlay(){},playSelection(){},playCutPreview(){}};
            window.Timeline={getTotalDuration:()=>100,undoStack:[],redoStack:[],clipboard:null};
            window.Selection={selection:null,getSelection(){return this.selection},hasSelection(){return !!this.selection},clear(){this.selection=null},setSelectionSilent(start,end){this.selection={start,end}},setSelection(start,end){this.selection={start,end}}};
            window.Utils={formatTime:n=>n.toFixed(3),formatTimeForSpeech:n=>n.toFixed(3)};
            window.App={currentFilePath:'D:/source.mp4',insertSubtitle:async p=>inserted.push(p)};
            for(const key of ['cut','copy','paste','delete','undo','redo','addSelectionToVerticalQueue'])App[key]=()=>calls.push(key);
            window.api={platform:'win32',speechSearchInspect:async()=>({ready:false,supported:true}),onSpeechSearchProgress:cb=>{window.progressCallback=cb;return()=>{}},speechSearchCancel:async()=>true,
                speechSearchAnalyze:async({jobId})=>{analyses++;progressCallback({jobId,stage:'analyze',percent:100});return{transcripts:[{words:[{start:1,end:2,text:'Merhaba.'}]}]};},
                showSaveDialog:async()=>({filePath:'D:/source_subtitles.srt'}),saveFileContent:async p=>{saved.push(p);return{success:true}}};
            void 0;
        `);
        for(const file of ['timeline-pointer.js','automatic-subtitles-core.js','automatic-subtitles.js'])
            await win.webContents.executeJavaScript(fs.readFileSync(path.join(root,'src/renderer/scripts',file),'utf8') + '\n;void 0;');
        await win.webContents.executeJavaScript("document.dispatchEvent(new Event('DOMContentLoaded'))");
        const rect=await win.webContents.executeJavaScript("(()=>{const r=document.getElementById('timeline-visual').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width}})()");
        const start={x:Math.round(rect.x+rect.width*.2),y:Math.round(rect.y+30)};
        const end={x:Math.round(rect.x+rect.width*.6),y:start.y};
        win.webContents.sendInputEvent({type:'mouseDown',...start,button:'left',clickCount:1});
        win.webContents.sendInputEvent({type:'mouseMove',...end,button:'left'});
        win.webContents.sendInputEvent({type:'mouseUp',...end,button:'left',clickCount:1});
        await new Promise(r=>setTimeout(r,100));
        const result=await win.webContents.executeJavaScript(`(async()=>{
            const assert=(ok,message)=>{if(!ok)throw Error(message)};
            assert([...document.querySelectorAll('.timeline-pointer-tools button, #timeline-pointer-zoom, .timeline-pointer-viewport')].every(el=>el.tabIndex===-1),'Pointer controls excluded from Tab order');
            const zoom=document.getElementById('timeline-pointer-zoom');zoom.value='2';zoom.dispatchEvent(new Event('input'));assert(document.getElementById('timeline-visual').style.width==='200%','Pointer zoom remains functional');
            assert(Selection.selection && Math.abs(Selection.selection.start-20)<0.2 && Math.abs(Selection.selection.end-60)<0.2,'Real pointer drag');
            const remove=document.querySelector('[data-action="delete"]');assert(!remove.disabled,'Delete enabled');remove.click();assert(calls.includes('delete'),'Existing deletion');
            document.getElementById('origin').focus();await AutomaticSubtitles.generate();
            assert(analyses===0,'No automatic download');assert(document.activeElement.id==='automatic-subtitles-small','Initial radio focus');
            document.querySelector('[data-start]').click();await new Promise(r=>setTimeout(r,100));
            assert(inserted[0]==='D:/source_subtitles.srt','Normal insertion');assert(saved[0].content.includes('Merhaba.'),'SRT content');
            assert(!document.querySelector('dialog'),'Dialog cleanup');assert(document.activeElement.id==='origin','Restored focus');
            return {pointer:true,subtitles:true,focus:true};
        })()`);
        console.log(JSON.stringify(result));
        await win.webContents.executeJavaScript(`
            VideoPlayer.video=document.createElement('video');
            VideoPlayer.startContinuousAudition=async ranges=>{window.lastAudition=ranges;return true};
            Timeline.sourceFile='D:/source.mp4';Timeline.segments=[{start:0,end:100}];
            window.transactions=0;window.deleted=[];
            Timeline.transaction=(_action,_range,fn)=>{transactions++;fn()};Timeline.deleteRange=(a,b)=>deleted.push([a,b]);
            App.updateAfterEdit=()=>{};window.Accessibility={announce:()=>{},clearPending:()=>{}};
            window.Dialogs={showAccessibleConfirm:async()=>true};
            api.speechSearchInspect=async()=>({backend:'whisper.cpp',available:true,ready:true});
            api.speechSearchAnalyze=async()=>({transcripts:[{sourcePath:'D:/source.mp4',fillers:[{text:'eee',start:10,end:10.5,context:'bir eee örnek'}]}]});
            void 0;
        `);
        for(const file of ['filler-review-core.js','filler-review.js'])await win.webContents.executeJavaScript(fs.readFileSync(path.join(root,'src/renderer/scripts',file),'utf8')+'\n;void 0;');
        const fillers=await win.webContents.executeJavaScript(`(async()=>{
            const assert=(ok,message)=>{if(!ok)throw Error(message)},wait=()=>new Promise(r=>setTimeout(r,50));
            await FillerReview.open();document.querySelector('[data-analyze]').click();await wait();
            const list=document.getElementById('filler-list');assert(list.options.length===1,'Candidate list');
            assert(!document.querySelector('details').open,'Help initially collapsed');
            assert(document.querySelector('[data-apply]').disabled,'Not automatically approved');
            document.querySelector('[data-preview]').click();await wait();assert(lastAudition.length===1&&lastAudition[0][0]===9&&lastAudition[0][1]===11.5,'Context audition uses one second on each side');
            document.querySelector('[data-cut]').click();await wait();assert(lastAudition.length===2&&lastAudition[0][0]===8&&lastAudition[0][1]===10&&lastAudition[1][0]===10.5&&lastAudition[1][1]===12.5,'Cut audition retains two seconds on each side');
            list.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));assert(!document.querySelector('[data-apply]').disabled,'Space approves');
            await wait();assert(document.querySelector('[data-status]').textContent===locale.filler_review.selected_for_deletion,'Selected state announced');
            const auditionBeforeToggle=lastAudition;
            list.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));await wait();
            assert(document.querySelector('[data-status]').textContent===locale.filler_review.not_selected_for_deletion,'Deselected state announced');
            assert(document.activeElement===list&&lastAudition===auditionBeforeToggle,'Toggle retains focus without restarting preview');
            list.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));await wait();
            document.querySelector('[data-apply]').click();await wait();assert(transactions===1&&deleted.length===1&&deleted[0][0]===10,'Single undo transaction');
            const result=document.getElementById('filler-result');assert(result?.open&&document.activeElement===result.querySelector('button'),'Result OK button owns focus');
            assert(document.getElementById(result.getAttribute('aria-describedby'))?.textContent&& !result.querySelector('p').hasAttribute('tabindex'),'Result is described without a text focus stop');
            result.querySelector('button').click();await wait();assert(!document.querySelector('dialog[open]'),'Filler cleanup');return{fillers:true};
        })()`);
        console.log(JSON.stringify(fillers));
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(root,'src/renderer/scripts/dialogs.js'),'utf8')+'\n;void 0;');
        console.log(await win.webContents.executeJavaScript(`(async()=>{
            const dialog=document.createElement('dialog');
            dialog.innerHTML='<h2 id="accessible-confirm-title"></h2><p id="accessible-confirm-message"></p><button id="accessible-confirm-yes"></button><button id="accessible-confirm-no"></button><button id="accessible-confirm-cancel"></button>';
            document.body.append(dialog);Dialogs.accessibleConfirmDialog=dialog;
            const pending=Dialogs.showAccessibleChoice({title:'Test',message:'Confirm?',buttons:['Yes','No']});
            document.getElementById('accessible-confirm-yes').click();await pending;
            document.getElementById('origin').focus();await new Promise(r=>setTimeout(r,150));
            if(dialog.open||dialog.querySelector('[role="alert"]')||document.activeElement.id!=='origin')throw Error('Confirmation focus/announcement leaked after close: '+JSON.stringify({open:dialog.open,alert:!!dialog.querySelector('[role="alert"]'),focus:document.activeElement.id}));
            dialog.remove();return JSON.stringify({confirmationCleanup:true});
        })()`));
        const html=fs.readFileSync(path.join(root,'src/renderer/index.html'),'utf8');
        const silenceMarkup=['silence-params-dialog','silence-list-dialog'].map(id=>html.match(new RegExp('<dialog id="'+id+'"[\\s\\S]*?</dialog>'))[0]).join('');
        console.log(await win.webContents.executeJavaScript(`(async()=>{
            document.body.insertAdjacentHTML('beforeend',${JSON.stringify(silenceMarkup)});
            Dialogs.silenceParamsDialog=document.getElementById('silence-params-dialog');Dialogs.silenceListDialog=document.getElementById('silence-list-dialog');
            Dialogs.setupListContextMenu=()=>{};Dialogs.setupSilenceEventListeners();
            App.showProgress=()=>{};App.hideProgress=()=>{};api.onFfmpegProgress=()=>{};api.offFfmpegProgress=()=>{};
            let finish;api.detectSilence=()=>new Promise(resolve=>finish=resolve);
            Dialogs.silenceParamsDialog.showModal();
            document.getElementById('silence-params-confirm').click();
            if(!Dialogs.silenceParamsDialog.open||!Dialogs.silenceParamsDialog.contains(document.activeElement))throw Error('Focus left parameters during analysis');
            finish({success:true,data:[{start:1,end:2,duration:1}]});await new Promise(r=>setTimeout(r,80));
            if(Dialogs.silenceParamsDialog.open||!Dialogs.silenceListDialog.open||!document.activeElement.closest('#silence-intervals-list'))throw Error('List handoff failed');
            Dialogs.showSilenceCleanupResult(2,1.25,0,true);
            const result=document.getElementById('silence-cleanup-result-title').closest('dialog');
            if(!result.open||document.activeElement!==result.querySelector('button')||!result.textContent.includes('1,25'))throw Error('Silence result popup failed');
            if(!document.getElementById(result.getAttribute('aria-describedby'))?.textContent||result.querySelector('p').hasAttribute('tabindex'))throw Error('Silence result description/focus failed');
            result.querySelector('button').click();return JSON.stringify({silenceFocus:true,silenceResult:true});
        })()`));
        await win.webContents.executeJavaScript(fs.readFileSync(path.join(root,'src/renderer/scripts/video-player.js'),'utf8')+'\n;void 0;');
        console.log(await win.webContents.executeJavaScript(`(()=>{
            document.body.insertAdjacentHTML('beforeend','<span id="total-duration"></span>');
            VideoPlayer.video={duration:77,paused:true};Timeline.sourceFile='source.mp4';Timeline.segments=[{start:0,end:67}];Timeline.getTotalDuration=()=>67;
            document.getElementById('origin').focus();VideoPlayer.updateDurationDisplay();
            const description=document.getElementById('timeline-focus-duration');
            if(!description.textContent.endsWith('67.000')||description.textContent.includes('77.000'))throw Error('Focus description must be ready before timeline focus');
            if(!document.getElementById('total-duration').getAttribute('aria-label').endsWith('67.000'))throw Error('Visible and accessible durations differ');
            document.getElementById('timeline-section').focus();
            return JSON.stringify({editedDurationBeforeFocus:true});
        })()`));
        win.destroy();app.exit(0);
    }catch(error){console.error(error);win.destroy();app.exit(1);}
});
