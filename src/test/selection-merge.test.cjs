const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../renderer/scripts/app.js'), 'utf8');
const method = source.slice(source.indexOf('    async mergeVerticalClipQueue() {'), source.indexOf('    clearVerticalClipQueue('));
const clips = [
    {sourcePath: 'a.mp4', startTime: 8.137, endTime: 10.281},
    {sourcePath: 'a.mp4', startTime: 1.013, endTime: 4.007},
    {sourcePath: 'b.mp4', startTime: 2.111, endTime: 3.999}
];
async function run({cancel = false, fail = false} = {}) {
    const calls = []; const errors = []; const opened = [];
    const context = vm.createContext({window: {api: {
        showSaveDialog: async () => {
            app.verticalClipQueue.length = 0;
            return {canceled: cancel, filePath: 'out.mp4'};
        },
        renderTimeline: async args => { calls.push(args); return {success: !fail, error: fail ? 'render failed' : undefined}; }
    }}, Accessibility: {alert() {}, announce() {}, announceComplete() {}, announceError: e => errors.push(e)}});
    const app = vm.runInContext(`({${method}})`, context);
    Object.assign(app, {
        verticalClipQueue: clips.map(c => ({...c})),
        getVerticalClipQueueSnapshot() { return this.verticalClipQueue.map(c => ({...c})); },
        parseFilePath: () => ({name: 'source'}), t: key => key,
        showProgress() {}, hideProgress() {}, openFile: async p => opened.push(p)
    });
    await app.mergeVerticalClipQueue();
    assert.equal(calls.length, cancel ? 0 : 1);
    if (!cancel) {
        assert.deepEqual(JSON.parse(JSON.stringify(calls[0].segments)), clips.map(c => ({sourceFile:c.sourcePath, start:c.startTime, end:c.endTime})));
        assert.equal(calls[0].options.exportMode, 'legacy');
    }
    assert.deepEqual(opened, !cancel && !fail ? ['out.mp4'] : []);
    assert.deepEqual(errors, fail ? ['render failed'] : []);
}
(async () => {
    await run(); await run({cancel:true}); await run({fail:true});
    console.log('PASS: selection merge uses one continuous render, preserves snapshot/order/bounds, handles cancel/error');
})().catch(e => { console.error(e); process.exitCode = 1; });
