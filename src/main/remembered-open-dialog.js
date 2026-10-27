const fs = require('fs');
const path = require('path');

async function openRemembered(dialog, owner, options, store) {
    const key = 'last_media_open_directory';
    const saved = store?.get(key);
    const settings = { ...options };
    if (!settings.defaultPath && typeof saved === 'string') {
        try { if (fs.statSync(saved).isDirectory()) settings.defaultPath = saved; } catch (_) { /* Removed or offline folder. */ }
    }
    const result = await dialog.showOpenDialog(owner, settings);
    if (!result.canceled && result.filePaths?.length) {
        store?.set(key, path.dirname(result.filePaths[0]));
    }
    return result;
}
module.exports = { openRemembered };
