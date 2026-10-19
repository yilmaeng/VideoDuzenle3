const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1050, height: 1050, show: false,
        webPreferences: { contextIsolation: false, offscreen: true, backgroundThrottling: false } });
    await win.loadURL('about:blank');
    await win.webContents.executeJavaScript(`
        const locale=${JSON.stringify(require('../locales/tr.json'))};
        window.i18nHelper={t(key,args={}) { let s=key.split('.').reduce((x,k)=>x?.[k],locale)||key; for(const [k,v] of Object.entries(args)) s=s.split('{'+k+'}').join(v);return s; },
            translateDOM(root) {root.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=this.t(el.dataset.i18n));}};
        window.Accessibility={announce:()=>{}};
        window.calls=[];
        window.state={success:true,settings:{primary:'gemini',fallback:'openai',fallbackEnabled:false},providers:['gemini','openai','claude','deepseek','groq'].map(id=>({id,name:id,hasKey:id==='gemini',model:id==='gemini'?'gemini-saved':'',models:[]}))};
        window.api={onAiServicesOpen:()=>{},onAiServicesNotice:()=>{},aiServices:async(action,input)=>{
            calls.push({action,input});
            if(action==='status')return state;
            if(action==='refresh')return {success:true,models:[{id:'claude-new',label:'Claude New',selectable:true}]};
            if(action==='save-service'){Object.assign(state.providers.find(p=>p.id===input.provider),{model:input.model,hasKey:true});return state;}
            if(action==='save-settings'){state.settings=input;return state;}
            if(action==='pricing')return {success:true,retrievedAt:'2026-10-18T10:00:00Z',url:'https://example.test/pricing',html:'<main><h1>Pricing</h1><script>window.bad=true</script><table><tr><th>Model</th><th>USD</th></tr><tr><td>Test model</td><td>$1 per million tokens</td></tr></table><p>Input and output conditions are listed separately for each model on this official page.</p></main>'};
            return {success:true};
        }};
        const style=document.createElement('style');style.textContent=${JSON.stringify(fs.readFileSync(path.resolve(__dirname,'../renderer/styles/main.css'),'utf8'))};document.head.append(style);
        const origin=document.createElement('button');origin.id='origin';origin.textContent='Test';document.body.append(origin);origin.focus();
    `);
    const js = code => win.webContents.executeJavaScript(code);
    await js(fs.readFileSync(path.resolve(__dirname,'../renderer/scripts/api-key-guide.js'),'utf8'));
    await js(fs.readFileSync(path.resolve(__dirname,'../renderer/scripts/ai-services.js'),'utf8'));
    await js("AiServices.open('claude')");
    assert.equal(await js('document.activeElement.id'), 'ais-key');
    assert.equal(await js("document.querySelector('#ais-fallback').disabled"), true);
    assert.equal(await js("document.querySelectorAll('#ais-provider option').length"), 5);
    assert.equal(await js("document.querySelector('#ais-model').options.length"), 0);
    await js("document.querySelector('[data-action=key-guide]').focus();document.querySelector('[data-action=key-guide]').click()");
    assert.equal(await js('document.activeElement.id'), 'akg-steps');
    assert(await js("document.querySelector('#akg-title').textContent.includes('Claude')"));
    assert.equal(await js("document.querySelector('#api-key-guide a').href"), 'https://platform.claude.com/settings/keys');
    assert.equal(await js("document.querySelector('#akg-steps').readOnly"), false);
    for (const type of ['beforeinput','paste','cut','drop']) {
        assert(await js(`!document.querySelector('#akg-steps').dispatchEvent(new Event('${type}',{cancelable:true,bubbles:true}))`));
    }
    await js("document.querySelector('#api-key-guide').dispatchEvent(new Event('cancel',{cancelable:true}))");
    assert.equal(await js('document.activeElement.dataset.action'), 'key-guide');
    await js("window.openedUrls=[];window.api.openExternalUrl=async url=>{openedUrls.push(url);return {success:true}};ApiKeyGuide.open('elevenlabs')");
    await js("document.querySelector('#api-key-guide a').click()");
    assert.equal(await js('openedUrls[0]'), 'https://elevenlabs.io/app/developers/api-keys');
    await js("document.querySelector('#api-key-guide button').click()");
    await js("document.querySelector('#ais-key').value='fixture'; document.querySelector('[data-action=refresh]').onclick()");
    assert.equal(await js('document.activeElement.dataset.action'), 'refresh');
    assert.equal(await js("document.querySelector('#ais-model').value"), 'claude-new');
    await js("document.querySelector('[data-action=save]').onclick()");
    assert.equal(await js("document.querySelector('#ais-key').value"), '');
    assert.equal(await js("calls.find(c=>c.action==='save-service').input.provider"), 'claude');
    await js("document.querySelector('#ais-primary').value='claude';document.querySelector('[data-action=preferences]').onclick()");
    assert.equal(await js('state.settings.primary'), 'claude');
    await js("document.querySelector('[data-action=prices]').onclick()");
    assert.equal(await js('window.bad === undefined'), true);
    const prices = await js("document.querySelector('#ais-pricing').value");
    assert(prices.includes('$1')); assert(prices.includes('alınma zamanı')); assert(!prices.includes('window.bad'));
    assert(await js("!document.querySelector('#ais-pricing').dispatchEvent(new InputEvent('beforeinput',{cancelable:true,bubbles:true,data:'x'}))"));
    assert.equal(await js("document.querySelector('#ais-pricing').readOnly"), false);
    await js("document.querySelector('#ais-provider').value='openai';document.querySelector('#ais-provider').dispatchEvent(new Event('change'))");
    assert.equal(await js("document.querySelector('#ais-pricing').value"), '');
    // Native selects and password fields keep explicit label associations.
    assert(await js("[...document.querySelectorAll('select,input[type=password],textarea')].every(e=>document.querySelector('label[for='+e.id+']'))"));
    await js("document.querySelector('#ais-primary').focus(); document.querySelector('dialog').scrollTop=0");
    win.webContents.invalidate(); await new Promise(r => setTimeout(r, 300));
    fs.mkdirSync(path.resolve(__dirname, '../../temp'), { recursive: true });
    fs.writeFileSync(path.resolve(__dirname, '../../temp/ai-services-ui.png'), (await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('[data-action=close]').click()");
    assert.equal(await js('document.activeElement.id'), 'origin');
    console.log('AI services Electron UI passed: model refresh/save, preferences, pricing text, input labels, focus restoration and read-only caret support.');
    win.destroy(); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
