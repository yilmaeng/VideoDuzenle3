function installMacEditingShortcuts(targetWindow) {
    if (process.platform !== 'darwin' || !targetWindow?.webContents) {
        return;
    }

    const contents = targetWindow.webContents;
    if (contents.__evdMacEditingShortcutsInstalled) {
        return;
    }
    contents.__evdMacEditingShortcutsInstalled = true;

    // Menu-less editor windows still need the standard macOS text-editing commands.
    contents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || !input.meta || input.control || input.alt || input.isComposing) {
            return;
        }

        const key = String(input.key || '').toLowerCase();
        const actions = { v: 'paste', c: 'copy', x: 'cut', a: 'selectAll' };
        const action = key === 'z' ? (input.shift ? 'redo' : 'undo') : actions[key];
        if (!action || typeof contents[action] !== 'function') {
            return;
        }

        event.preventDefault();
        contents[action]();
    });
}

module.exports = { installMacEditingShortcuts };
