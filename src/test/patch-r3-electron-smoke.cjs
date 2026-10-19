const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'temp/patch-r3-smoke.json');
const failures = [];
function fail(error) {
    fs.writeFileSync(output, JSON.stringify({ success: false, error: error?.stack || String(error), failures }, null, 2));
    app.exit(1);
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
app.setPath('userData', path.join(root, 'temp/patch-r3-smoke-profile'));
app.on('window-all-closed', () => {});
const timeout = setTimeout(() => fail(new Error('timeout')), 60000);
app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const appRoot = process.env.EVD_PATCH_APP_ROOT || path.join(root, 'dist/win-unpacked/resources/app.asar');
    const requireFromApp = createRequire(path.join(appRoot, 'package.json'));
    assert.equal(requireFromApp('./package.json').version, '5.0.0');
    await requireFromApp('./src/main/i18n').init();
    const patchDirectory = path.join(root, 'dist/patch-5.0.0-r3/payload');
    require(path.join(patchDirectory, 'main.js')).apply({ app, appRoot, patchDirectory, requireFromApp, electron: require('electron') });
    assert.equal(typeof requireFromApp('./src/main/slideshow-audio-policy').aacEncodingArgs, 'function');
    assert.equal(typeof requireFromApp('./src/main/export/selection-audio-copy').tryCopySelectionAudio, 'function');
    const map = require(path.join(patchDirectory, 'assets/replacements.json'));
    for (const file of map.modules) requireFromApp(`./${file}`);
    const results = [];
    for (const page of ['index.html', 'dialogs/slideshow-editor.html', 'dialogs/broadcast-room.html',
        'description-subtitle-editor.html', 'instant-voice-translation.html', 'dialogs/slideshow-karaoke-editor.html']) {
        const window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(appRoot, 'src/preload/index.js') } });
        window.webContents.on('render-process-gone', (_event, details) => failures.push({ page, crash: details }));
        window.webContents.on('preload-error', (_event, preload, error) => failures.push({ page, preload, error: error.message }));
        await window.loadFile(path.join(appRoot, 'src/renderer', page));
        const result = await window.webContents.executeJavaScript(`({base:document.baseURI,
            scripts:[...document.scripts].map(s=>s.src).filter(Boolean),
            styles:[...document.querySelectorAll('link[rel=stylesheet]')].map(s=>s.href),
            volume:!!document.getElementById('btn-participant-volume'),
            spotlight:!!document.getElementById('btn-participant-spotlight')})`);
        assert(result.base.includes('app.asar'));
        assert(window.webContents.getURL().includes('runtime-5.0.0-r3'));
        if (!page.includes('slideshow-')) assert(result.scripts.some(src => src.includes('patch-5.0.0-r3')), JSON.stringify({ page, result }));
        if (page.includes('broadcast-room')) {
            assert(result.volume && result.spotlight);
            assert(result.scripts.some(src => src.includes('patch-5.0.0-r3') && src.endsWith('/broadcast-room.js')));
        }
        if (page.includes('description-subtitle') || page.includes('instant-voice')) assert(result.styles.some(src => src.includes('patch-5.0.0-r3')));
        results.push({ page, ...result });
        window.destroy();
    }
    assert.deepEqual(failures, []);
    fs.writeFileSync(output, JSON.stringify({ success: true, electron: process.versions.electron, failures, results }, null, 2));
    clearTimeout(timeout);
    app.exit(0);
}).catch(fail);
