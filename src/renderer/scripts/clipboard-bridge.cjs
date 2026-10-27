const { ipcRenderer } = require('electron');
// Preserve synchronous completion: callers announce success only after OS write.
exports.writeText = text => {
    const result = ipcRenderer.sendSync('evd-clipboard-write-text', String(text));
    if (result?.ok !== true) throw new Error('clipboard_write_failed');
};
