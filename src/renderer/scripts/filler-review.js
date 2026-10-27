(() => {
    'use strict';
    let active=false;
    const t=(key,params)=>window.i18nHelper.t(`filler_review.${key}`,params);
    async function open(){
        if(active||!VideoPlayer.hasVideo())return;
        active=true;
        const original=JSON.stringify(Timeline.segments),source=Timeline.sourceFile,position=VideoPlayer.getTimelineTime();
        const previousFocus=document.activeElement;
        VideoPlayer.pause({announce:false});
        const dialog=document.createElement('dialog');
        dialog.style.cssText='width:min(780px,94vw);max-height:90vh;overflow:auto';
        dialog.setAttribute('aria-labelledby','filler-title');
        dialog.innerHTML=`<h2 id="filler-title" data-i18n="filler_review.title"></h2><details><summary data-i18n="filler_review.help_title"></summary><p data-i18n="filler_review.help"></p></details>
            <p data-info></p><button type="button" data-analyze data-i18n="filler_review.analyze" disabled></button>
            <label for="filler-progress" data-i18n="speech_search.progress_label"></label><progress id="filler-progress" max="100" value="0"></progress>
            <p data-status role="status" aria-live="polite" aria-atomic="true"></p>
            <label for="filler-list" data-i18n="filler_review.list"></label><select id="filler-list" size="7" style="width:100%"></select>
            <p data-context></p>
            <label for="filler-start" data-i18n="filler_review.start"></label><input id="filler-start" type="number" min="0" step="0.01">
            <label for="filler-end" data-i18n="filler_review.end"></label><input id="filler-end" type="number" min="0" step="0.01">
            <div><button type="button" data-range data-i18n="filler_review.range"></button>
            <button type="button" data-preview data-i18n="filler_review.preview"></button><button type="button" data-cut data-i18n="filler_review.cut"></button>
            <button type="button" data-stop data-i18n="filler_review.stop"></button><button type="button" data-toggle data-i18n="filler_review.toggle"></button></div>
            <button type="button" data-apply data-i18n="filler_review.apply" disabled></button><button type="button" data-apply-all data-i18n="filler_review.apply_all" disabled></button><button type="button" data-close data-i18n="speech_search.close"></button>`;
        document.body.append(dialog);window.i18nHelper.translateDOM(dialog);
        const q=s=>dialog.querySelector(s),list=q('select'),status=q('[data-status]'),progress=q('progress'),analyze=q('[data-analyze]');
        let items=[],job=null,closed=false,unsubscribe=null,previewToken=0,previewChain=Promise.resolve(),changed=false;
        let selectionAnnouncementTimer=null;
        const valid=()=>!closed&&JSON.stringify(Timeline.segments)===original&&Timeline.sourceFile===source;
        function stop(){previewToken++;VideoPlayer.pause({announce:false});VideoPlayer.allowContinuousDialogPreview=false;VideoPlayer.allowPlaybackWithOpenDialog=false;}
        const playGuard=()=>{if(!closed&&VideoPlayer.allowContinuousDialogPreview)VideoPlayer.allowPlaybackWithOpenDialog=true;};
        VideoPlayer.video.addEventListener('play',playGuard,true);
        function close(restoreFocus=true){
            if(closed)return;closed=true;stop();
            clearTimeout(selectionAnnouncementTimer);
            if(job)window.api.speechSearchCancel(job).catch(console.warn);
            unsubscribe?.();window.removeEventListener('keydown',keyGuard,true);VideoPlayer.video.removeEventListener('play',playGuard,true);
            dialog.close();dialog.remove();active=false;
            previewChain.finally(()=>{if(!active&&!changed&&Timeline.sourceFile===source&&JSON.stringify(Timeline.segments)===original){VideoPlayer.seekToTimelineTime(position);VideoPlayer.cursorPosition=position;VideoPlayer.updateCursorDisplay();}});
            if(restoreFocus&&previousFocus?.isConnected)previousFocus.focus();
        }
        function label(item){return t('item',{text:item.text,time:Utils.formatTime(item.start),end:Utils.formatTime(item.end),state:t(item.approved?'approved':'review')});}
        function update(){
            const item=items[list.selectedIndex];
            for(const key of ['range','preview','cut','toggle'])q(`[data-${key}]`).disabled=!item||!!job;
            q('[data-apply]').disabled=!items.some(x=>x.approved)||!!job;
            q('[data-apply-all]').disabled=!items.length||!!job;
            for(const key of ['start','end']){q(`#filler-${key}`).disabled=!item;q(`#filler-${key}`).value=item?item[key].toFixed(3):'';}
            q('[data-context]').textContent=item?.context||'';
        }
        async function preview(cut=false){
            const item=items[list.selectedIndex];if(!item||!valid())return;
            stop();const token=previewToken;
            const contextSeconds=cut?2:1;
            const from=Math.max(0,item.start-contextSeconds),to=Math.min(Timeline.getTotalDuration(),item.end+contextSeconds);
            previewChain=previewChain.then(async()=>{
                if(!valid()||token!==previewToken)return;
                VideoPlayer.allowPlaybackWithOpenDialog=true;VideoPlayer.allowContinuousDialogPreview=true;
                const ok=await VideoPlayer.startContinuousAudition(cut?[[from,item.start],[item.end,to]]:[[from,to]]);
                if(!valid()||token!==previewToken)return;
                if(!ok){stop();status.textContent=t('preview_unavailable');}
            }).catch(error=>{if(!closed){stop();status.textContent=t('error',{error:error.message});}});
            return previewChain;
        }
        function toggle(){
            const item=items[list.selectedIndex];if(!item||job)return;
            item.approved=!item.approved;list.options[list.selectedIndex].textContent=label(item);update();
            // Native option text changes are not reliably spoken by JAWS. Use the
            // dialog's visible live region without moving focus or replaying audio.
            clearTimeout(selectionAnnouncementTimer);status.textContent='';
            const message=t(item.approved?'selected_for_deletion':'not_selected_for_deletion');
            selectionAnnouncementTimer=setTimeout(()=>{if(!closed)status.textContent=message;},40);
        }
        function keyGuard(e){if(!dialog.contains(e.target))return;e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();}
            else if(e.target===list&&e.key===' '){e.preventDefault();if(e.ctrlKey||e.metaKey)preview(true);else toggle();}
            else if(e.target===list&&e.key==='Enter'){e.preventDefault();preview();}}
        window.addEventListener('keydown',keyGuard,true);
        list.addEventListener('change',()=>{update();preview();});
        q('[data-preview]').onclick=()=>preview();q('[data-cut]').onclick=()=>preview(true);q('[data-stop]').onclick=stop;q('[data-toggle]').onclick=toggle;
        q('[data-range]').onclick=()=>{
            const item=items[list.selectedIndex];if(!item)return;
            const start=Number(q('#filler-start').value),end=Number(q('#filler-end').value);
            if(!q('#filler-start').value||!q('#filler-end').value||!Number.isFinite(start)||!Number.isFinite(end)||start<item.lower||end>item.upper||end<=start){status.textContent=t('invalid');return;}
            stop();item.start=start;item.end=end;item.approved=false;list.options[list.selectedIndex].textContent=label(item);update();preview();
        };
        q('[data-close]').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('close',close);
        // Dialog-local destructive action; deliberately no global keyboard-manager shortcut.
        async function apply(all=false){
            stop();if(!valid()){status.textContent=t('stale');return;}
            const ranges=window.FillerReviewCore.ranges(all?items.map(item=>({...item,approved:true})):items);if(!ranges.length)return;
            const yes=await Dialogs.showAccessibleConfirm(t('title'),t(all?'confirm_all':'confirm',{count:all?items.length:ranges.length}));
            if(!yes||!valid())return;
            const durationBefore=Timeline.getTotalDuration();
            Timeline.transaction('delete',null,()=>{for(const range of ranges.slice().reverse())Timeline.deleteRange(range.start,range.end);});
            const seconds=new Intl.NumberFormat(document.documentElement.lang||'tr',{maximumFractionDigits:3}).format(Math.max(0,durationBefore-Timeline.getTotalDuration()));
            changed=true;App.hasChanges=true;Selection.clear(true);App.updateAfterEdit();close(false);
            const message=t('done',{count:ranges.length,seconds,total:Utils.formatTimeForSpeech(Timeline.getTotalDuration())});
            const result=document.createElement('dialog');
            result.id='filler-result';
            result.setAttribute('aria-labelledby','filler-result-title');
            result.setAttribute('aria-describedby','filler-result-message');
            const title=document.createElement('h2');title.id='filler-result-title';title.textContent=t('result_title');
            const text=document.createElement('p');text.id='filler-result-message';text.textContent=message;
            const ok=document.createElement('button');ok.type='button';ok.autofocus=true;ok.textContent=t('ok');
            ok.onclick=()=>result.close();
            result.append(title,text,ok);document.body.append(result);
            result.addEventListener('close',()=>{result.remove();VideoPlayer.updateDurationDisplay();if(previousFocus?.isConnected)previousFocus.focus();},{once:true});
            window.Accessibility?.clearPending();
            result.showModal();ok.focus();
        }
        q('[data-apply]').onclick=()=>apply();
        q('[data-apply-all]').onclick=()=>apply(true);
        analyze.onclick=async()=>{
            if(job||!valid())return;
            stop();analyze.disabled=true;items=[];list.replaceChildren();update();
            job=`fillers-${Date.now()}`;let bucket='';
            unsubscribe=window.api.onSpeechSearchProgress(e=>{
                if(closed||e.jobId!==job||!['model','extract','analyze','complete'].includes(e.stage))return;
                const percent=Number.isFinite(e.percent)&&!e.indeterminate?Math.round(e.percent):null;
                if(percent===null)progress.removeAttribute('value');else progress.value=percent;
                const key=`${e.sourceIndex}:${e.stage}:${Math.floor((percent||0)/10)}`;
                if(bucket!==key){bucket=key;status.textContent=window.i18nHelper.t(`speech_search.${percent===null?'progress_indeterminate':'progress'}`,{stage:window.i18nHelper.t(`speech_search.stages.${e.stage}`),percent});}
            });
            try{
                status.textContent=window.i18nHelper.t('speech_search.starting');
                const result=await window.api.speechSearchAnalyze({mode:'fillers',model:'Xenova/whisper-small',jobId:job,
                    sources:[...new Set(Timeline.segments.map(s=>s.sourceFile||source))]});
                if(!valid())return;
                items=window.FillerReviewCore.map(result.transcripts,JSON.parse(original),source);
                items.sort((a,b)=>Number(b.highConfidence===true)-Number(a.highConfidence===true)||a.start-b.start);
                for(const high of [true,false]){
                    const group=document.createElement('optgroup');group.label=t(high?'strong_group':'review_group');
                    for(const item of items.filter(x=>(x.highConfidence===true)===high)){const option=document.createElement('option');option.textContent=label(item);group.append(option);}
                    if(group.children.length)list.append(group);
                }
                status.textContent=t('results',{count:items.length});if(items.length){list.selectedIndex=0;list.focus();}
            }catch(error){if(!closed)status.textContent=t('error',{error:error.message});}
            finally{unsubscribe?.();unsubscribe=null;job=null;if(!closed){analyze.disabled=false;update();}}
        };
        dialog.showModal();update();
        try{
            const inspection=await window.api.speechSearchInspect({model:'Xenova/whisper-small'});
            if(closed)return;
            if(inspection.backend!=='whisper.cpp'||!inspection.available){q('[data-info]').textContent=t('unsupported');return;}
            q('[data-info]').textContent=window.i18nHelper.t(`speech_search.${inspection.ready?'local_info':'download_consent'}`)+' '+window.i18nHelper.t('speech_search.model_size_windows');
            analyze.disabled=false;analyze.focus();
        }catch(error){if(!closed)status.textContent=t('error',{error:error.message});}
    }
    window.FillerReview={open};
})();
