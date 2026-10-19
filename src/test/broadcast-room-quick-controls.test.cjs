const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'src/broadcast-room-web/frontend/public/join.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'src/broadcast-room-web/frontend/public/join.js'), 'utf8');
const stack = [];
const ids = new Map();
const voidTags = new Set(['input', 'img', 'meta', 'link', 'br', 'hr', 'source']);
for (const match of html.matchAll(/<\/?([a-z][\w-]*)\b[^>]*>/gi)) {
    const tag = match[1].toLowerCase();
    if (match[0].startsWith('</')) {
        assert.equal(stack.pop()?.tag, tag, `Unbalanced ${tag}`);
        continue;
    }
    const id = match[0].match(/\bid="([^"]+)"/)?.[1];
    if (id) {
        assert(!ids.has(id), `Duplicate ${id}`);
        ids.set(id, [...stack]);
    }
    if (!voidTags.has(tag)) stack.push({ tag, markup: match[0] });
}
assert.equal(stack.length, 0);
for (const id of ['btn-toggle-chat-panel', 'chat-panel', 'btn-hand-raise']) {
    assert(ids.get(id).some((parent) => parent.markup.includes('class="meeting-controls-dock"')));
    assert(!ids.get(id).some((parent) => parent.markup.includes('id="post-join-section"')));
}
function control() {
    return { hidden: false, dataset: {}, setAttribute(key, value) { this[key] = value; }, getAttribute(key) { return this[key]; } };
}
const state = { roomConnection: null, chatPanelExpanded: true, handRaiseActive: false };
const els = { chatPanel: control(), btnToggleChatPanel: control(), btnHandRaise: control(), microphoneEnabled: { checked: false } };
const context = vm.createContext({ state, els, t: (key) => key, renderChatTargetSelector() {},
    updateHandRaiseStatusVisibility() {}, setControlText: (el, label) => { el.label = label; },
    setShortcutAccessibleLabel() {} });
for (const [start, end] of [['renderChatPanel', 'renderHostActivityPanel'], ['updateHandRaiseButtonUi', 'updateHandRaiseStateFromParticipants']]) {
    vm.runInContext(js.slice(js.indexOf(`    function ${start}(`), js.indexOf(`    function ${end}(`)), context);
}
context.renderChatPanel(); context.updateHandRaiseButtonUi();
assert(els.chatPanel.hidden && els.btnToggleChatPanel.hidden && els.btnHandRaise.hidden);
state.roomConnection = {};
context.renderChatPanel(); context.updateHandRaiseButtonUi();
assert(!els.chatPanel.hidden && !els.btnToggleChatPanel.hidden && !els.btnHandRaise.hidden);
state.localAudioTrack = {}; els.microphoneEnabled.checked = true;
context.updateHandRaiseButtonUi(); assert(els.btnHandRaise.hidden);
state.handRaiseActive = true;
context.updateHandRaiseButtonUi();
assert(!els.btnHandRaise.hidden);
assert.equal(els.btnHandRaise.label, 'broadcast_room_join.hand_raise_cancel');
for (const locale of ['tr', 'en', 'de', 'es', 'fr']) {
    const data = JSON.parse(fs.readFileSync(path.join(root, 'src/locales', `${locale}.json`), 'utf8'));
    for (const key of ['chat_panel_button', 'hand_raise_request', 'hand_raise_cancel']) assert(data.broadcast_room_join[key]);
}
console.log('PASS: valid HTML, unique IDs, dock placement, joined/left controls, request cancellation, five locales');
