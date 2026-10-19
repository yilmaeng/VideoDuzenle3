const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const originalLoad = Module._load;
const engine = {
    installed: () => null,
    downloadInfo: async () => ({ size: 1867858152, unpackedSize: 5403676103,
        requiredSpace: 7808405217, approval: 'test' })
};
Module._load = function(id, ...args) {
    if (id === './vocal-engine-manager') return engine;
    if (id === 'electron') return {};
    return originalLoad.call(this, id, ...args);
};
const { register } = require('../main/vocal-separation');
Module._load = originalLoad;
const handlers = {};
const sequence = [];
let seen;
register({
    ipcMain: { handle: (name, handler) => { handlers[name] = handler; } },
    BrowserWindow: { fromWebContents: () => ({}) },
    i18n: { getCurrentLanguage: () => 'tr', t: (key, args) => {
        if (args) seen = args;
        return key;
    } },
    announce: async () => sequence.push('announce'),
    dialog: {
        showMessageBox: async (win, options) => {
            sequence.push('confirm');
            assert.equal(options.defaultId, 1);
            assert.equal(options.cancelId, 1);
            return { response: 1 };
        },
        showOpenDialog: async () => { throw new Error('Destination must not open after denial'); }
    }
});
(async () => {
    const sender = new EventEmitter();
    sender.isDestroyed = () => false;
    const result = await handlers['vocal-separation-run']({ sender }, { consent: true });
    assert.deepEqual(result, { cancelled: true });
    assert.deepEqual(sequence, ['announce', 'confirm']);
    assert.deepEqual(seen, { size: '1,87', installed: '5,40', free: '7,81' });
    console.log('Download consent: localized sizes, accessibility announcement and safe cancellation passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
