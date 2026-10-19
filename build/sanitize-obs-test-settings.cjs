'use strict';
const fs = require('fs');
const path = require('path');

function sanitize(root) {
    if (!fs.existsSync(root)) return;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const file = path.join(root, entry.name);
        if (entry.isDirectory()) { sanitize(file); continue; }
        if (!/\.json(?:\.bak)?$/.test(entry.name)) continue;
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        function visit(value) {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value.filters)) value.filters = value.filters.filter(f =>
                f.id !== 'net.nagater.obs.asynchronous-audio-filter');
            Object.values(value).forEach(visit);
        }
        visit(data);
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    }
}

// Sanitize the packaged copy only; preserve the developer's successful test setup.
module.exports = async context => {
    if (context.electronPlatformName !== 'win32') return;
    // Personal OBS config is excluded by extraResources. Seed only connection
    // defaults; never distribute profiles, stream keys, scenes or browser cookies.
    const root = path.join(context.appOutDir, 'resources', 'obs-studio', 'config', 'obs-studio');
    const socket = path.join(root, 'plugin_config', 'obs-websocket');
    fs.mkdirSync(socket, { recursive: true });
    fs.writeFileSync(path.join(socket, 'config.json'), JSON.stringify({server_enabled:true, server_port:4455, auth_required:false, alerts_enabled:false}, null, 2));
    fs.writeFileSync(path.join(root, 'global.ini'), '[General]\nMaxLogs=10\nEnableAutoUpdates=false\n\n[Audio]\nDisableAudioDucking=true\n');
    fs.writeFileSync(path.join(root, 'user.ini'), '[General]\nFirstRun=true\n\n[BasicWindow]\nWarnBeforeStartingStream=true\n');
};
module.exports.sanitize = sanitize;
