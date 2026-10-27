const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { installClipboardBridge } = require('../main/clipboard-bridge');
test('clipboard writes are acknowledged only for local renderer frames', () => {
    let handler, copied;
    const root = path.resolve(__dirname, '../renderer');
    installClipboardBridge({
        ipcMain: { on(name, callback) { assert.equal(name, 'evd-clipboard-write-text'); handler = callback; } },
        clipboard: { writeText(text) { copied = text; } }
    }, root);
    const event = { senderFrame: { url: pathToFileURL(path.join(root, 'dialogs/broadcast-room.html')).href } };
    handler(event, 'test');
    assert.equal(copied, 'test');
    assert.deepEqual(event.returnValue, { ok: true });
    for (const url of ['https://example.com/', pathToFileURL(path.resolve(root, '../outside.html')).href]) {
        copied = null;
        const invalid = { senderFrame: { url } };
        handler(invalid, 'blocked');
        assert.equal(copied, null);
        assert.equal(invalid.returnValue.ok, false);
    }
});
