const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const load = Module._load;
Module._load = function(id, ...args) {
    if (id === 'electron') return { app: { isPackaged: false, getAppPath: () => root,
        getPath: () => path.join(root, 'temp/vocal-unit-userdata') } };
    return load.call(this, id, ...args);
};
const manager = require('../main/vocal-engine-manager');
const { parseWorkerProgress, run } = require('../main/vocal-separation');
Module._load = load;
const valid = { platforms: { 'win32-x64': { version: '1.0.0', size: 1024, unpackedSize: 4096,
    url: 'https://example.com/engine.zip', sha256: 'a'.repeat(64) } } };
assert.equal(manager.validateManifest(valid, 'win32-x64').version, '1.0.0');
for (const change of [{ version: '../escape' }, { version: '..' }, { url: 'http://example.com/x' },
    { sha256: 'invalid' }, { size: 0 }, { size: 99 * 1024 ** 3 }]) {
    assert.throws(() => manager.validateManifest({ platforms: { 'win32-x64': { ...valid.platforms['win32-x64'], ...change } } }, 'win32-x64'));
}
assert.throws(() => manager.validateManifest(valid, 'darwin-arm64'));
assert.equal(parseWorkerProgress('anything'), null);
assert.equal(parseWorkerProgress('EVD_VOCAL:{'), null);
assert.equal(parseWorkerProgress('EVD_VOCAL:{"stage":"unknown"}'), null);
assert.deepEqual(parseWorkerProgress('EVD_VOCAL:{"stage":"separating","percent":52,"remainingSeconds":90}'),
    { stage: 'separating', percent: 52, remainingSeconds: 90 });
function flatten(data, prefix = '') {
    return Object.entries(data).flatMap(([key, value]) => typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]);
}
const keys = flatten(require('../locales/en.json').vocal_separation).sort();
for (const locale of ['tr', 'de', 'es', 'fr']) assert.deepEqual(flatten(require(`../locales/${locale}.json`).vocal_separation).sort(), keys);
assert(!JSON.stringify(require('../../package.json').build.extraResources).includes('vocal-engine'));
const renderer = fs.readFileSync(path.join(root, 'src/renderer/scripts/vocal-separation.js'), 'utf8');
assert(renderer.includes("Utils.playSound('success')"));
assert(renderer.includes('30000'), 'Live progress must be throttled');
assert(renderer.includes('vocal-format'));
(async () => {
    const controller = new AbortController();
    const promise = run(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(promise, /cancelled/);
    console.log('Vocal separation validation, locales, cancellation and packaging tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
