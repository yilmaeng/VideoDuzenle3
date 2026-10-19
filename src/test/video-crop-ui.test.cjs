const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1100, height: 1100, show: false, webPreferences: { contextIsolation: false, offscreen: true, backgroundThrottling: false } });
    await win.loadURL('about:blank');
    const policy = fs.readFileSync(path.resolve(__dirname, '../renderer/index.html'), 'utf8').match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)[1];
    await win.webContents.executeJavaScript(`const meta=document.createElement('meta');meta.httpEquiv='Content-Security-Policy';meta.content=${JSON.stringify(policy)};document.head.append(meta);void 0;`);
    const locale = require('../locales/tr.json');
    await win.webContents.executeJavaScript(`
        window.locale = ${JSON.stringify(locale)};
        window.i18nHelper = {
            t(key,args={}) { let s=key.split('.').reduce((x,k)=>x?.[k],locale)||key; for(const [k,v] of Object.entries(args)) s=s.split('{'+k+'}').join(v); return s; },
            translateDOM(root) { root.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=this.t(el.dataset.i18n)); root.querySelectorAll('[data-i18n-aria]').forEach(el=>el.setAttribute('aria-label',this.t(el.dataset.i18nAria))); }
        };
        window.App={currentFilePath:'fixture.mp4'}; window.Timeline={};
        window.VideoPlayer={hasVideo:()=>true,pause:()=>{}};
        window.Accessibility={announce:()=>{}}; window.tones=[]; window.Utils={playSound:()=>{window.soundPlayed=true},playProgressTone:p=>tones.push(p)};
        window.requestCount=0;
        window.AiServices={request:async(params)=>{window.requestCount++;window.lastPrompt=params.prompt;return {success:true,text:JSON.stringify(document.querySelector('#crop-goal-framing').checked
            ? {confidence:{top:'high',bottom:'high',left:'high',right:'high'},handsConfidence:{top:'high',bottom:'low',left:'high',right:'high'},internalGap:false,reason:'Baş üzerinde fazla tavan var; azaltılması kişiyi öne çıkarabilir.',frames:[0,1,2].map(()=>({content:{left:250,top:400,right:750,bottom:1000},hands:{left:100,top:300,right:900,bottom:1000}}))}
            : {crop:{top:50,bottom:50,left:40,right:40},reason:'Test önerisi'})};}};
        const c=document.createElement('canvas'); c.width=320;c.height=240;const ctx=c.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,320,240);ctx.fillStyle='white';ctx.fillRect(40,50,240,140);
        window.analysis={width:320,height:240,duration:10,sampleCount:3,uncertain:false,crop:{top:48,bottom:48,left:38,right:38},frames:[0,4,8].map(time=>({time,image:c.toDataURL()}))};
        window.api={
            videoCropAnalyze:async()=>analysis,
            videoCropClose:()=>{}, onVideoCropProgress:callback=>{window.cropProgress=callback;return ()=>{};},
            getGeminiApiData:async()=>({apiKey:'fixture',model:'fixture'}),
            geminiVisionRequest:async()=>({success:true,text:JSON.stringify({crop:{top:50,bottom:50,left:40,right:40},reason:'Test önerisi'})}),
            videoCropExport:async crop=>{window.exported=crop;cropProgress({stage:'exporting',percent:40});cropProgress({stage:'exporting',percent:40});return {output:'fixture-cropped.mp4'}}
        };
        const style=document.createElement('style');style.textContent=${JSON.stringify(fs.readFileSync(path.resolve(__dirname,'../renderer/styles/main.css'),'utf8'))};document.head.append(style);
    `);
    await win.webContents.executeJavaScript(fs.readFileSync(path.resolve(__dirname,'../renderer/scripts/crop-framing.js'),'utf8'));
    await win.webContents.executeJavaScript(fs.readFileSync(path.resolve(__dirname,'../renderer/scripts/video-crop.js'),'utf8'));
    await win.webContents.executeJavaScript('VideoCrop.open()');
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#video-crop-dialog details').open"), false);
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#crop-framing-options').disabled"), true);
    await win.webContents.executeJavaScript("document.querySelector('[data-action=analyze]').onclick()");
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#crop-top').value"),'48');
    assert.equal(await win.webContents.executeJavaScript('document.activeElement.id'), 'crop-report');
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#crop-goal-framing').checked"),true);
    await win.webContents.executeJavaScript("document.querySelector('#crop-goal-borders').click()");
    await win.webContents.executeJavaScript("document.querySelector('[data-action=ai]').onclick()");
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#crop-top').value"),'48','AI must not auto-apply');
    assert(await win.webContents.executeJavaScript("lastPrompt.includes('Yalnızca sürekli boş kenarları kaldır')"));
    await win.webContents.executeJavaScript("document.querySelector('#crop-goal-framing').click()");
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#crop-framing-options').disabled"), false);
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('[data-action=apply]').disabled"), true);
    await win.webContents.executeJavaScript("document.querySelector('#crop-request').value='İki kişi de kalsın.\\nYazıları koru.'");
    await win.webContents.executeJavaScript("document.querySelector('[data-action=ai]').onclick()");
    assert(await win.webContents.executeJavaScript("lastPrompt.includes('İki kişi de kalsın.') && lastPrompt.includes('currentCrop')"));
    assert(await win.webContents.executeJavaScript("document.querySelector('#crop-advice').value.startsWith('Görsel değerlendirme: Baş üzerinde')"));
    assert(await win.webContents.executeJavaScript("document.querySelector('#crop-advice').value.includes('Alt: konum belirsiz')"));
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#crop-advice').value.includes('tahmini dış alan')"), false);
    assert(await win.webContents.executeJavaScript("lastPrompt.includes('konum tahminleri') && lastPrompt.includes('handsConfidence') && lastPrompt.includes('Her iki dikdörtgene')"));
    assert(await win.webContents.executeJavaScript("document.querySelector('#crop-advice').value.includes('52 piksel')"));
    await win.webContents.executeJavaScript("document.querySelector('#crop-tightness-tight').click();document.querySelector('#crop-protect-hands').click()");
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('[data-action=apply]').disabled"), false);
    assert.equal(await win.webContents.executeJavaScript('requestCount'),2,'Tightness and hand protection must reuse geometry');
    assert(await win.webContents.executeJavaScript("document.querySelector('#crop-advice').value.includes('88 piksel')"));
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#crop-top').value"),'48');
    await win.webContents.executeJavaScript("document.querySelector('[data-action=apply]').click()");
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#crop-top').value"),'88');
    await win.webContents.executeJavaScript("document.querySelector('#crop-request').value='Önceki önerinin yanlarını koru.';document.querySelector('#crop-request').dispatchEvent(new Event('input',{bubbles:true}))");
    assert.equal(await win.webContents.executeJavaScript('requestCount'),2,'Typing must not send requests');
    await win.webContents.executeJavaScript("document.querySelector('[data-action=ai]').onclick()");
    assert(await win.webContents.executeJavaScript("lastPrompt.includes('Önceki önerinin yanlarını koru.') && lastPrompt.includes('previousSuggestion') && lastPrompt.includes('88')"));
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#crop-top').value"),'88','New advice must not change applied values');
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#crop-request').value"),'Önceki önerinin yanlarını koru.');
    win.webContents.invalidate();
    await new Promise(resolve=>setTimeout(resolve,300));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.resolve(__dirname,'../../temp/video-crop-ui.png'),image.toPNG());
    await win.webContents.executeJavaScript("document.querySelector('[data-action=export]').onclick()");
    assert.deepEqual(await win.webContents.executeJavaScript('exported'),{top:88,bottom:0,left:72,right:72});
    assert.equal(await win.webContents.executeJavaScript('soundPlayed'),true);
    assert.deepEqual(await win.webContents.executeJavaScript('tones'), [40]);
    assert.equal(await win.webContents.executeJavaScript("document.activeElement.dataset.action"),'export');
    await win.webContents.executeJavaScript("document.querySelector('#crop-top').value='3';document.querySelector('#crop-top').dispatchEvent(new Event('input'))");
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('[data-action=export]').disabled"),true);
    const prevented = await win.webContents.executeJavaScript("!document.querySelector('#crop-advice').dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,data:'x'}))");
    assert(prevented);
    await win.webContents.executeJavaScript("document.querySelector('#crop-top').value='0';document.querySelector('#crop-top').dispatchEvent(new Event('input'))");
    // Optional replay of real responses, without any network request or credentials.
    for (const file of process.argv.slice(2)) {
        const response = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
        const data = JSON.parse(response.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
        await win.webContents.executeJavaScript(`analysis.frames=Array.from({length:${data.frames.length}},(_,time)=>({time,image:analysis.frames[0].image}));AiServices.request=async()=>(${JSON.stringify(response)});document.querySelector('[data-action=analyze]').onclick()`);
        await win.webContents.executeJavaScript("document.querySelector('[data-action=ai]').onclick()");
        assert.equal(await win.webContents.executeJavaScript("document.querySelector('[data-action=apply]').disabled"),false, file);
    }
    for (const [response, key] of [[{success:false,error:'Test service failure'},'ai_service'],[{success:true,text:'not json'},'ai_format'],[{success:true,text:'{}'},'ai_geometry']]) {
        await win.webContents.executeJavaScript(`AiServices.request=async()=>(${JSON.stringify(response)});document.querySelector('[data-action=ai]').onclick()`);
        assert((await win.webContents.executeJavaScript("document.querySelector('#crop-advice').value")).startsWith(locale.video_crop.errors[key]));
        assert.equal(await win.webContents.executeJavaScript("document.querySelector('[data-action=apply]').disabled"),true);
    }
    await win.webContents.executeJavaScript("document.querySelector('[data-action=close]').click()");
    assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('dialog')"),false);
    console.log('Crop Electron UI: analysis, explicit AI apply, export, completion sound, focus and read-only navigation guards passed.');
    win.destroy();app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
