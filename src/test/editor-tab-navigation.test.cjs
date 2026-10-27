const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
    let focused;
    const timeline = { focus() { focused = 'timeline'; }, getAttribute: () => 'application', closest(selector) { return selector.includes('#timeline-section') ? this : null; } };
    const tab = { focus() { focused = 'tab'; }, closest(selector) { return selector.includes('#tab-bar') ? this : null; } };
    const document = { body: {}, getElementById: () => timeline, querySelector: selector => selector.startsWith('#tab-bar') ? tab : null };
    const context = { window: {}, document, VideoPlayer: { hasVideo: () => true }, navigator: { userAgent: 'Windows' }, console };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/scripts/keyboard.js'), 'utf8'), context);
    const event = (target, extra = {}) => ({ key: 'Tab', target, preventDefault() {}, stopPropagation() {}, ...extra });
    return { keyboard: context.window.Keyboard, timeline, tab, document, event, focused: () => focused };
}

test('Tab and Shift+Tab alternate document tab and keyboard timeline', () => {
    const s = setup();
    for (const shiftKey of [false, true]) {
        assert.equal(s.keyboard.handleEditorTabNavigation(s.event(s.tab, { shiftKey })), true);
        assert.equal(s.focused(), 'timeline');
        assert.equal(s.keyboard.handleEditorTabNavigation(s.event(s.timeline, { shiftKey })), true);
        assert.equal(s.focused(), 'tab');
    }
    assert.ok(!s.keyboard.isInputFocused(s.timeline));
});

test('document switching, unrelated fields and export UI retain their navigation', () => {
    const s = setup();
    assert.equal(s.keyboard.handleEditorTabNavigation(s.event(s.tab, { ctrlKey: true })), false);
    assert.equal(s.keyboard.handleEditorTabNavigation(s.event({ closest: () => null })), false);
    s.document.querySelector = () => ({});
    assert.equal(s.keyboard.handleEditorTabNavigation(s.event(s.tab)), false);
});
