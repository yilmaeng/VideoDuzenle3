const { app, BrowserWindow } = require('electron');
const path = require('path');
const assert = require('node:assert/strict');
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
    // No microphone capture, model download, room connection or account access.
    await window.loadURL('about:blank');
    const sdkPath = path.resolve(__dirname, '../broadcast-room-web/frontend/public/vendor/krisp-0.4.5/index.js');
    const result = await window.webContents.executeJavaScript(`(() => {
        const sdk = require(${JSON.stringify(sdkPath)});
        return { factory: typeof sdk.KrispNoiseFilter, supported: sdk.isKrispNoiseFilterSupported(),
            electron: process.versions.electron };
    })()`);
    assert.equal(result.factory, 'function');
    assert.equal(typeof result.supported, 'boolean');
    console.log(JSON.stringify(result));
    window.destroy();
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
