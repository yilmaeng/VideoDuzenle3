const path = require('node:path');
const { fileURLToPath } = require('node:url');

function installClipboardBridge({ ipcMain, clipboard }, rendererRoot) {
    const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
    const root = normalize(path.resolve(rendererRoot) + path.sep);
    ipcMain.on('evd-clipboard-write-text', async (event, text) => {
        let ok = false;
        try {
            const url = new URL(event.senderFrame.url);
            const actual = path.resolve(fileURLToPath(url));
            // Trust only generated pages registered by the signed patch loader.
            const original = global[Symbol.for('evd.patch.rendererPaths')]?.get(actual) || actual;
            const file = normalize(path.resolve(original));
            if (url.protocol !== 'file:' || !file.startsWith(root) ||
                typeof text !== 'string' || text.length > 4 * 1024 * 1024) return;
            await clipboard.writeText(text);
            ok = true;
        } catch (_error) {
            // Never log clipboard text: room credentials may be copied here.
        } finally {
            // Electron replies on assignment; never send a provisional failure.
            event.returnValue = { ok };
        }
    });
}
module.exports = { installClipboardBridge };
