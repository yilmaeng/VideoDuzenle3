const { app, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '../..');
const resultPath = path.join(root, 'temp/native-menu-smoke-result.json');
app.setPath('userData', path.join(root, 'temp/native-menu-smoke-profile'));
app.whenReady().then(() => {
    const source = fs.readFileSync(path.join(root, 'src/main/menu.js'), 'utf8');
    for (const language of ['tr', 'en', 'de', 'es', 'fr']) {
        const locale = require(`../locales/${language}.json`);
        const exported = { exports: {} };
        vm.runInNewContext(source, {
            module: exported, process, console,
            require(name) {
                if (name === 'electron') return { Menu };
                if (name === './i18n') return {
                    getCurrentLanguage: () => language,
                    t: (key, params={}) => String(key.split('.').reduce((value, part) => value?.[part], locale) || key)
                        .replace(/\{(\w+)\}/g, (_,name)=>params[name] ?? `{${name}}`)
                };
                if (name === '../shared/editor-menu-state') return require('../shared/editor-menu-state');
                if (name === './dialog-windows') return { hasActiveRecordingWizardSession: () => false };
                return require(name);
            }
        });
        const contents = new EventEmitter();
        let replacements = 0;
        const window = {webContents:contents, setMenu(next) { menu=next; replacements++; }};
        let menu = exported.exports.createMenu(window);
        const editMenu = menu.items.find(item=>item.submenu?.items.some(child=>child.id==='editor-menu.edit.undo')).submenu;
        assert.equal(editMenu.items[0].id,'editor-menu.edit.undo');
        assert.equal(editMenu.items[1].id,'editor-menu.edit.redo');
        assert.equal(menu.getMenuItemById('editor-menu.play.toggle').enabled, false);
        contents.emit('ipc-message', {}, 'editor-menu-availability', { media: true });
        assert.equal(menu.getMenuItemById('editor-menu.play.toggle').enabled, true);
        contents.emit('ipc-message', {}, 'editor-menu-availability', {media:true,loaded:true,undo:true,undoAction:'Test action'});
        assert(menu.getMenuItemById('editor-menu.edit.undo').label.includes('Test action'));
        assert.equal(replacements,1,'Changed labels must rebuild the native menu, not only mutate JS properties');
        contents.emit('ipc-message', {}, 'editor-menu-availability', {media:true,loaded:true,undo:true,undoAction:'Test action'});
        assert.equal(replacements,1,'Unchanged state must not rebuild the menu');
        contents.emit('ipc-message', {}, 'editor-menu-availability', {media:true,loaded:true,redo:true,redoAction:'Test action'});
        assert.equal(replacements,2);
        assert(menu.getMenuItemById('editor-menu.edit.redo').label.includes('Test action'));
        contents.emit('ipc-message', {}, 'editor-menu-availability', {text:true,textUndo:true});
        assert.equal(menu.getMenuItemById('editor-menu.edit.undo').label,locale.menu.edit.undo);
    }
    fs.writeFileSync(resultPath, JSON.stringify({ success: true, electron: process.versions.electron, locales: 5 }));
    app.quit();
}).catch(error => {
    fs.writeFileSync(resultPath, JSON.stringify({ success: false, error: error.stack }));
    app.exit(1);
});
