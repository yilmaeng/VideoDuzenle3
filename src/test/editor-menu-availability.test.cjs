const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const policy = require('../shared/editor-menu-state');

assert(Object.entries(policy()).every(([key, value]) => value === (policy.requirements[key] === 'always')));
assert.equal(policy({ media: true })['menu.edit.cut'], false);
assert.equal(policy({ media: true, selection: true })['menu.edit.cut'], true);
assert.equal(policy({ paste: true })['menu.edit.paste'], true, 'Cross-tab paste into an empty project');
assert.equal(policy({ undo: true })['menu.edit.undo'], true, 'Undo after deleting every segment');
assert.equal(policy({ media: true })['menu.play.toggle'], true);
assert.equal(policy({ media: true })['menu.play.play_selection'], false);
assert.equal(policy({ media: true, anyMarkers: true })['menu.goto.next_marker'], true);
assert.equal(policy({ text: true, writable: true })['menu.edit.paste'], true, 'API-key text fields stay editable');
assert.equal(policy({ text: true, textSelection: true })['menu.edit.copy'], true);
assert.equal(policy({ text: true, textSelection: true })['menu.edit.cut'], false, 'Read-only text cannot be cut');

const source = fs.readFileSync(path.join(__dirname, '../main/menu.js'), 'utf8');
function build(items) {
    for (const item of items) {
        assert(!Object.hasOwn(item, 'commandId'), 'Reserved Electron commandId must not be supplied');
        assert(!Object.hasOwn(item, 'availabilityKey'), 'Policy metadata must be stripped');
    }
    return { items: items.map(item => ({ ...item, enabled: item.enabled !== false,
        submenu: item.submenu ? build(item.submenu) : undefined })) };
}
function flatten(menu) {
    return menu.items.flatMap(item => [item, ...(item.submenu ? flatten(item.submenu) : [])]);
}
for (const platform of ['win32', 'darwin']) for (const language of ['tr', 'en', 'de', 'es', 'fr']) {
    const locale = require(`../locales/${language}.json`);
    const translate = key => key.split('.').reduce((value, part) => value?.[part], locale) || key;
    const exported = { exports: {} };
    const i18n = { getCurrentLanguage: () => language, t: translate };
    vm.runInNewContext(source, {
        module: exported, process: { platform }, console,
        require(name) {
            if (name === 'electron') return { Menu: { buildFromTemplate: build } };
            if (name === './i18n') return i18n;
            if (name === '../shared/editor-menu-state') return policy;
            if (name === './dialog-windows') return { hasActiveRecordingWizardSession: () => false };
            return require(name);
        }
    });
    const contents = new EventEmitter();
    const window = { webContents: contents };
    let menu = exported.exports.createMenu(window);
    let items = flatten(menu);
    const recordMenu = menu.items.find(item => item.label === translate('menu.record.label'));
    const exempt = flatten(recordMenu.submenu);
    const exemptBefore = exempt.map(item => item.enabled);
    function checkCoverage(items, recording = false) {
        for (const item of items) {
            const exempt = recording || item.label === translate('menu.record.label');
            if (item.submenu) checkCoverage(item.submenu.items, exempt);
            // Radio language choices and dynamic recent-file entries are
            // independent commands with their own existing availability.
            else if (item.click && !exempt && item.type !== 'radio' && !/^\d+\./.test(item.label)) {
                assert(item.id?.startsWith('editor-'), `Unclassified menu command: ${item.label}`);
            }
        }
    }
    checkCoverage(menu.items);
    for (const key of Object.keys(policy())) {
        assert(items.some(item => item.id === `editor-${key}`), `${language}: missing ${key}`);
    }
    assert(items.filter(item => item.id?.startsWith('editor-')).every(item => item.enabled === (policy.requirements[item.id.slice(7)] === 'always')));
    for (const key of ['menu.file.open', 'menu.file.new_slideshow', 'menu.insert.video', 'menu.insert.description_subtitle_editor', 'menu.ai.instant_voice_translation', 'menu.help.shortcuts']) {
        assert.equal(items.find(item => item.label === translate(key)).enabled, true, key);
    }
    contents.emit('ipc-message', {}, 'editor-menu-availability', { media: true, selection: true, undo: true, loaded: true });
    assert(items.filter(item => item.id === 'editor-menu.play.goto_start').every(item => item.enabled));
    assert.equal(items.find(item => item.id === 'editor-menu.edit.cut').enabled, true);
    assert.equal(items.find(item => item.id === 'editor-menu.edit.redo').enabled, false);
    assert.deepEqual(exempt.map(item => item.enabled), exemptBefore, 'Recording/broadcast menu is untouched');
    menu = exported.exports.createMenu(window);
    items = flatten(menu);
    assert.equal(contents.listenerCount('ipc-message'), 1, 'Rebuilding must not duplicate listeners');
    assert.equal(items.find(item => item.id === 'editor-menu.edit.cut').enabled, true, 'State survives language/recent-menu rebuild');
    contents.emit('ipc-message', {}, 'editor-menu-availability', {});
    assert(items.filter(item => item.id?.startsWith('editor-')).every(item => item.enabled === (policy.requirements[item.id.slice(7)] === 'always')));
}
assert.equal(policy({ media: true })['menu.insert.apply_active_transition'], false);
assert.equal(policy({ media: true, activeTransition: true })['menu.insert.apply_active_transition'], true);
assert.equal(policy({ media: true, activeTransition: true })['menu.insert.apply_transition_to_markers'], false);
assert.equal(policy({ media: true, activeTransition: true, anyMarkers: true })['menu.insert.apply_transition_to_markers'], true);
assert.equal(policy({ media: true })['menu.insert.apply_all_transitions'], false);
assert.equal(policy({ media: true, transitions: true })['menu.insert.apply_all_transitions'], true);
assert.equal(policy({ selectionQueue: true })['menu.insert.vertical_video_queue_open'], true);
assert.equal(policy({ selectionQueue: true })['menu.file.save_selection'], true);
console.log('All native menu policies passed (five locales, Windows and macOS templates).');

// Exercise renderer publication without timers or repeated identical IPC messages.
const listeners = new Map();
const jobs = [];
const sent = [];
const timeline = { getTotalDuration: () => 60, undoStack: [], redoStack: [], clipboard: null, historyLabel: () => 'Deletion' };
let tab = {};
const document = {
    activeElement: null,
    addEventListener: (name, callback) => listeners.set(name, callback),
    queryCommandEnabled: () => false
};
const context = {
    document, Timeline: timeline, Selection: { getSelection: () => null },
    TabManager: { getActiveTab: () => tab, clipboard: null },
    Markers: { markers: [] }, App: { verticalClipQueue: [] },
    queueMicrotask: callback => jobs.push(callback),
    window: { api: { send: (channel, state) => sent.push(state) }, addEventListener() {} }
};
const flush = () => { while (jobs.length) jobs.shift()(); };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/scripts/native-menu-availability.js'), 'utf8'), context);
flush();
assert.equal(sent.at(-1).media, true);
listeners.get('keyup')(); flush();
assert.equal(sent.length, 1, 'Unchanged state sends no IPC');
timeline.undoStack.push('previous');
listeners.get('editor-menu-state-changed')(); flush();
assert.equal(sent.at(-1).undo, true);
tab = null;
listeners.get('editor-menu-state-changed')(); flush();
assert.equal(sent.at(-1).media, false);
assert.equal(sent.at(-1).undo, false, 'Closing the last tab disables stale undo history');
document.activeElement = { matches: () => true, value: 'key', selectionStart: 0, selectionEnd: 3, getAttribute: () => null };
listeners.get('focusin')(); flush();
assert.equal(policy(sent.at(-1))['menu.edit.paste'], true);
assert.equal(policy(sent.at(-1))['menu.edit.copy'], true);
console.log('Renderer menu state synchronization tests passed.');
