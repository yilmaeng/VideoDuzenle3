const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'temp/patch-r2-smoke.json');
const failures = [];
function fail(error) {
    fs.writeFileSync(output, JSON.stringify({ success: false, error: error?.stack || String(error), failures }, null, 2));
    app.exit(1);
}
// Keep test failures in the report instead of showing Electron error dialogs.
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
app.setPath('userData', path.join(root, 'temp/patch-r2-smoke-profile'));
app.on('window-all-closed', () => {});
const timeout = setTimeout(() => { fs.writeFileSync(output, JSON.stringify({ error: 'timeout' })); app.exit(1); }, 45000);
app.whenReady().then(async () => {
    const appRoot = path.join(root, 'dist/win-unpacked/resources/app.asar');
    const requireFromApp = createRequire(path.join(appRoot, 'package.json'));
    await requireFromApp('./src/main/i18n').init();
    const patchDirectory = path.join(root, 'dist/patch-5.0.0-r2/payload');
    require(path.join(patchDirectory, 'main.js')).apply({ app, appRoot, patchDirectory, requireFromApp, electron: require('electron') });
    assert(requireFromApp('./src/main/slideshow-audio-policy').sourceAudioProfile([]).encoding.includes('-aac_coder twoloop'));
    assert.equal(typeof requireFromApp('./src/main/slideshow-handler').setupSlideshowHandlers, 'function');
    assert.equal(typeof requireFromApp('./src/main/menu').createMenu, 'function');
    const results = [];
    for (const page of ['index.html', 'dialogs/slideshow-editor.html']) {
        const window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(appRoot, 'src/preload/index.js') } });
        window.webContents.on('render-process-gone', (_event, details) => failures.push({ page, crash: details }));
        window.webContents.on('preload-error', (_event, preload, error) => failures.push({ page, preload, error: error.message }));
        await window.loadFile(path.join(appRoot, 'src/renderer', page));
        const result = await window.webContents.executeJavaScript(`({base:document.baseURI, scripts:[...document.scripts].map(s=>s.src).filter(Boolean), utils:typeof Utils, tabs:typeof handleSlideshowTabShortcut})`);
        assert(result.base.includes('app.asar'));
        if (page.startsWith('dialogs')) {
            assert.equal(result.utils, 'object');
            assert.equal(result.tabs, 'function');
            assert(result.scripts.some(src => src.includes('patch-5.0.0-r2') && src.endsWith('/utils.js')));
        } else {
            assert(result.scripts.some(src => src.includes('patch-5.0.0-r2') && src.endsWith('/native-menu-availability.js')));
        }
        results.push({ page, ...result });
        window.destroy();
    }
    assert.deepEqual(failures, []);
    fs.writeFileSync(output, JSON.stringify({ success: true, electron: process.versions.electron, failures, results }, null, 2));
    clearTimeout(timeout);
    app.exit(0);
}).catch(error => {
    fs.writeFileSync(output, JSON.stringify({ success: false, error: error.stack }, null, 2));
    clearTimeout(timeout);
    app.exit(1);
});
