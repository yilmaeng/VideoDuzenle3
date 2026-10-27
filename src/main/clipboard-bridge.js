const path = require('node:path');
const { fileURLToPath } = require('node:url');

function installClipboardBridge({ ipcMain, clipboard }, rendererRoot) {
    const root = path.resolve(rendererRoot) + path.sep;
    ipcMain.on('evd-clipboard-write-text', (event, text) => {
        event.returnValue = { ok: false };
        try {
            const url = new URL(event.senderFrame.url);
            const file = path.resolve(fileURLToPath(url));
            if (url.protocol !== 'file:' || !file.startsWith(root) ||
                typeof text !== 'string' || text.length > 4 * 1024 * 1024) return;
            clipboard.writeText(text);
            event.returnValue = { ok: true };
        } catch (_error) {
            // Never log clipboard text: room credentials may be copied here.
        }
    });
}
module.exports = { installClipboardBridge };
