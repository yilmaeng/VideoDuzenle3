// Run with Electron, not Node. Uses a hidden window and fake audio/IPC so it
// checks the real Chromium dialog/listbox without network or media changes.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const reportPath = path.join(root, 'tmp/speech-search-ui-result.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
app.setPath('userData', path.join(root, 'tmp/speech-search-ui-profile'));
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await window.loadURL('data:text/html;charset=utf-8,<html><body><button id="origin">Origin</button><section id="timeline-section"></section><video id="video-player" tabindex="-1"></video></body></html>');
    await window.webContents.executeJavaScript(`
        window.locale = ${JSON.stringify(require('../locales/tr.json'))};
        window.i18nHelper = {
            t(key, params = {}) {
                let text = key.split('.').reduce((o, k) => o?.[k], locale);
                if (typeof text !== 'string') throw new Error('Missing locale: ' + key);
                for (const [k, v] of Object.entries(params)) text = text.replaceAll('{' + k + '}', String(v));
                return text;
            },
            translateDOM(root) { root.querySelectorAll('[data-i18n]').forEach(el => el.textContent = this.t(el.dataset.i18n)); }
        };
        window.Timeline = { sourceFile: 'one.mp4', segments: [{start:0,end:20},{start:0,end:20}], getTotalDuration: () => 40 };
        window.Utils = {formatTime: n => n.toFixed(2)};
        window.VideoPlayer = {
            video: document.querySelector('video'), currentFilePath: 'one.mp4', position: 7,
            cursorPosition: 7, isPlaying: false, getTimelineTime() {return this.position},
            hasVideo: () => true, seekToTimelineTime(n) {this.position=n},
            pause(){this.isPlaying=false}, play(){this.isPlaying=true},
            setCursorToCurrentTime(){this.cursorPosition=this.position}, updateCursorDisplay(){}
        };
        window.progressListener = null; window.analyses = 0; window.cancelled = [];
        window.api = {
            speechSearchInspect: async () => ({ready:false,supported:true,available:true}),
            speechSearchCached: async () => null,
            speechSearchAnalyze: async ({jobId}) => {
                analyses++;
                progressListener({jobId,stage:'model',percent:50});
                await new Promise(r=>setTimeout(r,20));
                return {transcripts:[{sourcePath:'one.mp4',words:[{text:'Merhaba',start:2,end:3},{text:'dünya',start:3,end:4}]}]};
            },
            speechSearchCancel: async id => {cancelled.push(id);return true},
            onSpeechSearchProgress(cb){progressListener=cb;return ()=>{progressListener=null}}
        };
        document.getElementById('origin').focus();
    `);
    for (const file of ['speech-search-core.js', 'speech-search.js']) {
        await window.webContents.executeJavaScript(fs.readFileSync(path.join(root, 'src/renderer/scripts', file), 'utf8'));
    }
    const result = await window.webContents.executeJavaScript(`(async () => {
        const assert = (ok, message) => {if (!ok) throw new Error(message)};
        const wait = () => new Promise(r=>setTimeout(r,80));
        await SpeechSearch.open();
        assert(analyses===0, 'Opening dialog must not download or analyze');
        assert(document.activeElement.id==='speech-search-query','Query focus');
        assert(document.querySelector('#speech-search-info').textContent.includes('indir'), 'Missing download explanation');
        const query=document.getElementById('speech-search-query');
        query.value='Merhaba'; query.dispatchEvent(new Event('input',{bubbles:true}));
        document.querySelector('[data-action="analyze"]').click(); await wait();
        const list=document.querySelector('[role="listbox"]');
        assert(list.children.length===2,'Copied source must produce two results');
        list.focus();
        list.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})); await wait();
        assert(VideoPlayer.isPlaying,'Result preview should play');
        assert(VideoPlayer.position===21,'Preview starts one second before edited timeline result');
        list.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); await wait();
        assert(!document.querySelector('dialog'),'Enter must close');
        assert(VideoPlayer.position===21,'Enter must leave a one-second lead-in');
        assert(document.activeElement.id==='timeline-section','Timeline focus restored: ' + document.activeElement.outerHTML);
        assert(VideoPlayer.cursorPosition===21,'Editing cursor follows the lead-in');
        assert(!VideoPlayer.isPlaying,'Jump does not start editing playback');
        await SpeechSearch.open();
        document.querySelector('dialog').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await wait();
        assert(VideoPlayer.position===21,'Escape restores original position');
        assert(!document.querySelector('dialog'),'Escape closes');
        return {success:true, tests:12};
    })()`);
    fs.writeFileSync(reportPath, JSON.stringify({ ...result, electron: process.versions.electron }));
    window.destroy();
    app.quit();
}).catch(error => {
    fs.writeFileSync(reportPath, JSON.stringify({ success: false, error: error.stack }));
    app.exit(1);
});
