// Execute with Electron. No network, credentials or visible application window.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const report = path.join(root, 'tmp/ai-model-picker-result.json');
app.setPath('userData', path.join(root, 'tmp/ai-model-picker-profile'));
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await win.loadURL('data:text/html,<body></body>');
    const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
    const dialogs = ['gemini', 'openai'].map(provider => html.match(new RegExp(`<dialog id="${provider}-api-key-dialog"[\\s\\S]*?</dialog>`))[0]);
    await win.webContents.executeJavaScript(`
        document.body.innerHTML = ${JSON.stringify(dialogs.join(''))};
        window.i18nHelper = {t:key=>key};
        window.api = {refreshAiModels:async ()=>({success:true,models:[{id:'future-model',label:'Future',selectable:true}]})};
        void 0;
    `);
    await win.webContents.executeJavaScript(fs.readFileSync(path.join(root, 'src/renderer/scripts/ai-model-picker.js'), 'utf8'));
    await win.webContents.executeJavaScript(`(async()=>{
        for (const provider of ['gemini','openai']) {
            AiModelPicker.prepare(provider,{model:'saved-model'});
            const dialog=document.getElementById(provider+'-api-key-dialog');
            dialog.showModal();
            document.getElementById(provider+'-api-key-input').value='fake';
            const button=document.getElementById(provider+'-models-refresh');
            button.focus(); button.click();
            await new Promise(resolve=>setTimeout(resolve,20));
            if(document.activeElement!==button) throw new Error('Focus moved');
            if(!dialog.open) throw new Error('Refresh submitted form');
            const select=document.getElementById(provider+'-model-select');
            if(select.value!=='saved-model'||select.options.length!==2) throw new Error('Selection lost');
            dialog.close();
        }
    })()`);
    fs.writeFileSync(report, JSON.stringify({ success: true, electron: process.versions.electron }));
    win.destroy(); app.quit();
}).catch(error => { fs.writeFileSync(report, JSON.stringify({ success: false, error: error.message })); app.exit(1); });
