const { app, BrowserWindow, session, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../..');
const revision = Number(process.env.EVD_PATCH_REVISION || 4);
const output = path.join(root, `temp/patch-r${revision}-smoke.json`);
const failures = [];
function fail(error) {
    fs.writeFileSync(output, JSON.stringify({ success: false, error: error?.stack || String(error), failures }, null, 2));
    app.exit(1);
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
app.setPath('userData', path.join(root, `temp/patch-r4-smoke-profile-${process.pid}`));
app.on('window-all-closed', () => {});
app.on('before-quit', event => event.preventDefault());
const timeout = setTimeout(() => fail(new Error('timeout')), 90000);
app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const appRoot = process.env.EVD_PATCH_APP_ROOT || path.join(root, 'dist/win-unpacked/resources/app.asar');
    const requireFromApp = createRequire(path.join(appRoot, 'package.json'));
    assert.equal(requireFromApp('./package.json').version, '5.0.0');
    await requireFromApp('./src/main/i18n').init();
    const patchDirectory = path.join(root, `dist/patch-5.0.0-r${revision}/payload`);
    require(path.join(patchDirectory, 'main.js')).apply({ app, appRoot, patchDirectory, requireFromApp, electron: require('electron') });
    const map = require(path.join(patchDirectory, 'assets/replacements.json'));
    for (const file of map.modules) requireFromApp(`./${file}`);
    const room = requireFromApp('./src/main/room-account-client');
    ipcMain.handle('patch-test-room-trusted', event => room.isAccountSender(event));
    const { registerSpeechSearchIpc } = requireFromApp('./src/main/speech-search-ipc');
    registerSpeechSearchIpc({ ipcMain, service: { inspect: async () => ({ patchBridge: true }) }, dialogs: {} });
    ipcMain.handle('refresh-gemini-models', () => ({ models: [{ id: 'test-model' }] }));
    if (revision >= 5) ipcMain.handle('timeline-preview-audio', () => ({previewBridge:true}));
    ipcMain.removeHandler('i18n-get-language');
    ipcMain.removeHandler('i18n-get-all');
    ipcMain.handle('i18n-get-language', () => 'tr');
    ipcMain.handle('i18n-get-all', () => JSON.parse(fs.readFileSync(path.join(patchDirectory, 'locales/tr.json'), 'utf8')));
    const results = [];
    for (const page of ['index.html', 'dialogs/slideshow-editor.html', 'dialogs/broadcast-room.html',
        'description-subtitle-editor.html', 'instant-voice-translation.html', 'dialogs/slideshow-karaoke-editor.html']) {
        const nodeDialog = page.startsWith('dialogs/');
        const window = new BrowserWindow({ show: false, webPreferences: nodeDialog
            ? { nodeIntegration: true, contextIsolation: false }
            : { preload: path.join(appRoot, 'src/preload/index.js') } });
        window.webContents.on('render-process-gone', (_event, details) => failures.push({ page, crash: details }));
        window.webContents.on('preload-error', (_event, preload, error) => failures.push({ page, preload, error: error.message }));
        await window.loadFile(path.join(appRoot, 'src/renderer', page));
        if (page.includes('broadcast-room')) {
            for (let attempt = 0; attempt < 30; attempt++) {
                const ready = await window.webContents.executeJavaScript('typeof desktopCloudControls !== "undefined" && !!desktopCloudControls && !!desktopWaitingControls');
                if (ready) break;
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            assert(await window.webContents.executeJavaScript('!!desktopCloudControls && !!desktopWaitingControls && !!desktopRecordingNotice'), 'Desktop room controllers did not initialize');
        }
        const result = await window.webContents.executeJavaScript(`(async()=>({base:document.baseURI,
            scripts:[...document.scripts].map(s=>s.src).filter(Boolean),
            bridge:await window.evdPatchApi.speechSearchInspect({}),
            models:await window.evdPatchApi.refreshAiModels('gemini','test'),
            originalApi:typeof window.api?.getVideoMetadata,
            volume:!!document.getElementById('btn-participant-volume'),
            spotlight:!!document.getElementById('btn-participant-spotlight')}))()`);
        assert(result.base.includes('app.asar'));
        assert(window.webContents.getURL().includes(`runtime-5.0.0-r${revision}`));
        if (revision >= 5) {
            assert.equal(await window.webContents.executeJavaScript('(window.evdPatchApi || window.api).getTimelinePreviewAudio({}).then(r=>r.previewBridge)'), true);
            if (page === 'index.html') assert.equal(await window.webContents.executeJavaScript('typeof window.SeamlessPreview'), 'function');
        }
        if (!nodeDialog) assert.equal(result.originalApi, 'function');
        assert.equal(result.bridge.patchBridge, true);
        assert.equal(result.models.models[0].id, 'test-model');
        if (page.includes('broadcast-room')) {
            assert(result.volume && result.spotlight);
            assert(room.isAccountSender({ sender: window.webContents, senderFrame: window.webContents.mainFrame }));
        } else assert(!room.isAccountSender({ sender: window.webContents, senderFrame: window.webContents.mainFrame }));
        results.push({ page, ...result });
        fs.writeFileSync(output, JSON.stringify({ success: false, phase: page, results }, null, 2));
        window.destroy();
    }
    const Worker = require('worker_threads').Worker;
    await new Promise((resolve, reject) => {
        const worker = new Worker(path.join(appRoot, 'src/main/speech-search-service.js'), { workerData: {} });
        worker.on('error', reject);
        worker.on('exit', code => code === 0 ? resolve() : reject(new Error(`worker_exit_${code}`)));
    });
    const workerMessage = await new Promise((resolve, reject) => {
        const worker = new Worker(path.join(appRoot, 'src/main/speech-search-service.js'), { workerData: {
            speechSearch: true, model: 'Xenova/whisper-small', modelCacheDir: path.join(app.getPath('userData'), 'empty-model-cache'),
            allowDownload: false, audioPath: 'not-used-without-model'
        } });
        worker.on('error', reject);
        worker.on('message', async message => {
            if (message.type !== 'error') return;
            await worker.terminate();
            if (/Cannot find|ERR_MODULE|callback|not-used-without-model/i.test(message.message)) reject(new Error(message.message));
            else resolve(message.message);
        });
    });
    assert.deepEqual(failures, []);
    fs.writeFileSync(output, JSON.stringify({ success: true, electron: process.versions.electron, failures, worker: true, workerMessage, results }, null, 2));
    clearTimeout(timeout);
    app.exit(0);
}).catch(fail);
