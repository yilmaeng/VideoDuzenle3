const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function exists(p) {
    try {
        return !!p && fs.existsSync(p);
    } catch (e) {
        return false;
    }
}

function findInPath(cmd) {
    try {
        const whichCmd = process.platform === 'win32' ? 'where' : 'which';
        const result = spawnSync(whichCmd, [cmd], { encoding: 'utf8' });
        if (result.status === 0) {
            const lines = (result.stdout || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            return lines[0] || null;
        }
    } catch (e) { }
    return null;
}

function detectWindowsOBS() {
    const candidates = [];
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'];

    candidates.push(path.join(programFiles, 'obs-studio', 'bin', '64bit', 'obs64.exe'));
    candidates.push(path.join(programFilesX86, 'obs-studio', 'bin', '64bit', 'obs64.exe'));
    candidates.push(path.join(programFiles, 'obs-studio', 'bin', '32bit', 'obs32.exe'));
    candidates.push(path.join(programFilesX86, 'obs-studio', 'bin', '32bit', 'obs32.exe'));

    if (localAppData) {
        candidates.push(path.join(localAppData, 'Programs', 'obs-studio', 'bin', '64bit', 'obs64.exe'));
        candidates.push(path.join(localAppData, 'Programs', 'obs-studio', 'bin', '32bit', 'obs32.exe'));
    }

    for (const candidate of candidates) {
        if (exists(candidate)) {
            return candidate;
        }
    }

    const found = findInPath('obs64.exe') || findInPath('obs.exe');
    return found;
}

function detectMacOBS() {
    const appPath = '/Applications/OBS.app/Contents/MacOS/OBS';
    if (exists(appPath)) return appPath;
    const found = findInPath('OBS');
    return found;
}

function detectLinuxOBS() {
    const found = findInPath('obs');
    return found;
}

function detectOBS() {
    // Check bundled resource first (Portable Mode)
    if (process.resourcesPath) {
        // Windows path structure for OBS Portable
        const bundledPath = path.join(process.resourcesPath, 'obs-studio', 'bin', '64bit', 'obs64.exe');
        if (exists(bundledPath)) {
            return {
                found: true,
                path: bundledPath,
                platform: process.platform,
                bundled: true
            };
        }
    }

    // Check Development Environment (src/resources)
    // This allows testing the portable OBS while running 'electron .'
    try {
        const devPath = path.join(__dirname, '..', 'resources', 'obs-studio', 'bin', '64bit', 'obs64.exe');
        if (exists(devPath)) {
            return {
                found: true,
                path: devPath,
                platform: process.platform,
                bundled: true // Treat as bundled to enable --portable flag
            };
        }
    } catch (e) { }

    let pathFound = null;
    if (process.platform === 'win32') pathFound = detectWindowsOBS();
    else if (process.platform === 'darwin') pathFound = detectMacOBS();
    else pathFound = detectLinuxOBS();

    return {
        found: !!pathFound,
        path: pathFound || null,
        platform: process.platform
    };
}

module.exports = { detectOBS };
