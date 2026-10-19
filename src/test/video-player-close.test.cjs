const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const handlers = {};
const announcements = [];
const context = { window: { location: { href: 'file:///editor.html' }, api: {} },
    document: { getElementById: () => null }, console, clearTimeout, setTimeout,
    Accessibility: { announceError: message => announcements.push(message) },
    MediaError: { MEDIA_ERR_ABORTED: 1, MEDIA_ERR_NETWORK: 2, MEDIA_ERR_DECODE: 3, MEDIA_ERR_SRC_NOT_SUPPORTED: 4 } };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/scripts/video-player.js'), 'utf8'), context);
const player = context.window.VideoPlayer;
let rawSource = 'file:///video.mp4';
let setEmptySource = false;
let loads = 0;
player.video = {
    addEventListener: (name, fn) => { handlers[name] = fn; },
    get src() { return rawSource || 'file:///editor.html#fragment'; },
    set src(value) { if (!value) setEmptySource = true; rawSource = value; },
    getAttribute: () => rawSource,
    removeAttribute: () => { rawSource = null; },
    pause() {}, load() { loads++; handlers.error(); },
    error: { code: 4 }
};
player.applyPlaybackVolume = () => {};
player.stopTimelineBoundaryMonitor = () => {};
player.setupEventListeners();
let conversionCalls = 0;
player.onConversionNeeded = () => conversionCalls++;
player.currentFilePath = 'video.mp4';
handlers.error();
assert.equal(conversionCalls, 1, 'Real unsupported files must still offer conversion');
announcements.length = 0;
player.unloadVideo();
handlers.error();
assert.equal(setEmptySource, false, 'Closing must remove src, not assign an empty URL');
assert.equal(rawSource, null);
assert.equal(conversionCalls, 1);
assert.equal(announcements.length, 0);
assert.equal(player.currentFilePath, null);
assert.equal(loads, 1);

async function run() {
    let resolveMetadata;
    context.window.api.getVideoMetadata = () => new Promise(resolve => { resolveMetadata = resolve; });
    const pending = player.loadVideo('late.mp4');
    player.unloadVideo();
    resolveMetadata({ success: true, data: { filename: 'late.mp4' } });
    await pending;
    assert.equal(rawSource, null, 'A completed metadata request must not reopen a closed file');
    assert.equal(player.currentFilePath, null);
    const appSource = fs.readFileSync(path.join(__dirname, '../renderer/scripts/app.js'), 'utf8');
    const start = appSource.indexOf('    async handleVideoConversionNeeded(');
    const guardEnd = appSource.indexOf("        console.log('Video oynatma hatası", start);
    context.VideoPlayer = player;
    context.guardCalls = 0;
    vm.runInContext(`globalThis.appGuard = { ${appSource.slice(start, guardEnd)} globalThis.guardCalls++; } };`, context);
    context.appGuard.currentFilePath = null;
    await context.appGuard.handleVideoConversionNeeded('video.mp4', 'stale');
    assert.equal(context.guardCalls, 0);
    console.log('Close-file regression passed: real errors retained, unload errors ignored, delayed load invalidated.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
