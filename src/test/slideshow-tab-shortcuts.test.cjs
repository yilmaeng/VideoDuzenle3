const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../renderer/dialogs/slideshow-editor.html'), 'utf8');
const start = source.indexOf('        function handleSlideshowTabShortcut(event)');
const end = source.indexOf("        document.addEventListener('keydown', handleSlideshowTabShortcut, true);", start);
assert(start >= 0 && end > start);
let active = 0;
let focused = null;
let modal = false;
let menu = false;
const tabs = [0, 1, 2].map(index => ({
    disabled: false, hidden: false,
    getAttribute: () => null,
    classList: { contains: () => active === index },
    click: () => { active = index; },
    focus: () => { focused = index; }
}));
const context = {
    document: { querySelector: () => modal, querySelectorAll: () => tabs },
    hasVisibleContextMenu: () => menu
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
function press(options = {}) {
    const event = { key: 'Tab', ctrlKey: true, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; },
        stopImmediatePropagation() { this.stopped = true; }, ...options };
    context.handleSlideshowTabShortcut(event);
    return event;
}
assert(press().prevented);
assert.equal(active, 1); assert.equal(focused, 1);
press(); assert.equal(active, 2);
press(); assert.equal(active, 0);
press({ shiftKey: true }); assert.equal(active, 2);
tabs[1].disabled = true;
press({ shiftKey: true }); assert.equal(active, 0);
modal = true; assert(!press().prevented); assert.equal(active, 0);
modal = false; menu = true; assert(!press().prevented);
menu = false;
for (const options of [{ ctrlKey: false }, { altKey: true }, { metaKey: true }, { key: 'ArrowRight' }, { isComposing: true }]) {
    assert(!press(options).prevented);
}
console.log('Slideshow Ctrl+Tab navigation tests passed.');
