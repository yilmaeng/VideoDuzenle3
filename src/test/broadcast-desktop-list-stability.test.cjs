const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../renderer/scripts/broadcast-room.js'), 'utf8');
let mutations = 0;
class Option {
    constructor() { this.value = ''; this.text = ''; }
    get textContent() { return this.text; }
    set textContent(value) { this.text = value; mutations++; }
    remove() { if (this.parent) { this.parent.options.splice(this.parent.options.indexOf(this), 1); mutations++; } }
}
class Select {
    constructor() { this.options = []; this.current = ''; this.scrollTop = 54; this.size = 6; }
    get value() { return this.current; }
    set value(value) { this.current = value; mutations++; }
    get selectedIndex() { return this.options.findIndex((option) => option.value === this.current); }
    set selectedIndex(index) { this.value = this.options[index]?.value || ''; }
    insertBefore(option, before) {
        option.remove(); const index = this.options.indexOf(before);
        this.options.splice(index < 0 ? this.options.length : index, 0, option); option.parent = this; mutations++;
    }
    focus() { throw new Error('Background rendering must not move focus'); }
}
const state = {
    participants: [{ id: 'a', name: 'A', role: 'guest', microphoneEnabled: true }, { id: 'b', name: 'B', role: 'guest', microphoneEnabled: true }],
    selectedParticipantControlId: 'a', participantListRenderSignature: '',
    roomChat: { selectedIndex: 0, messages: [{ id: 'm1', text: 'One' }, { id: 'm2', text: 'Two' }] },
    youtube: { chatSelectedIndex: 0, chatMessages: [{ id: 'y1', text: 'First' }] }
};
const list = new Select();
const menu = { disabled: false }, globalButton = { hidden: false };
const detail = { set innerHTML(value) { this.html = value; mutations++; }, get innerHTML() { return this.html; } };
const els = { participantList: {
    querySelector(selector) { return selector.includes('listbox') ? list : selector.includes('global') ? globalButton : menu; },
    set innerHTML(_) { throw new Error('Existing participant list must not be rebuilt'); }
}, roomChatList: new Select(), roomChatSelectedDetail: detail, roomChatTarget: new Select(), youtubeChatList: new Select() };
const context = {
    rememberRoomChatForExport() {},
    state, els, document: { activeElement: list, createElement: () => new Option() },
    t: (_key, fallback, values) => fallback?.replace(/\{(\w+)\}/g, (_, key) => values?.[key] ?? ''),
    getParticipantById: (id) => state.participants.find((p) => p.id === id),
    getParticipantRoleLabel: (role) => role, getLocalRoomRole: () => 'host', isLocalRoomHost: () => true,
    formatStatusLabel: (value) => String(!!value), formatParticipantConnectionQuality: () => 'good',
    getVisibleRoomChatMessages: () => state.roomChat.messages,
    describeRoomChatMessage: (message) => message.text, normalizeChatMessageText: (message) => message.text,
    escapeHtml: (value) => value, renderTextWithClickableLinks: (value) => value,
    buildChatListLabel: (message) => message.text,
    getSelectedChatMessage: () => state.youtube.chatMessages[state.youtube.chatSelectedIndex],
    getRoomChatTargetOptions: () => [{ value: 'all', label: 'All' }],
    announceChatMessage() { throw new Error('No unsolicited announcement'); }
};
vm.createContext(context);
for (const [name, next] of [
    ['reconcileRoomListOptions', 'getSelectedRoomChatTarget'],
    ['renderRoomChatList', 'async function sendHostRoomChatMessage'],
    ['renderYouTubeChatList', 'function setSelectedChatIndex'],
    ['renderParticipants', 'function renderSourceGroup']
]) {
    const start = source.indexOf(`function ${name}(`);
    const stop = source.indexOf(next.includes('function ') ? next : `function ${next}(`, start + 1);
    assert(start >= 0 && stop > start);
    vm.runInContext(source.slice(start, stop), context);
}
const render = () => { context.renderParticipants(); context.renderRoomChatList(); context.renderRoomChatTargetSelector(); context.renderYouTubeChatList(); };
render();
const participantA = list.options[0], participantB = list.options[1];
const messageOne = els.roomChatList.options[0];
let before = mutations;
render(); render();
assert.equal(mutations, before, 'Identical snapshots cause no list/detail mutations');
list.value = 'b'; state.selectedParticipantControlId = 'b';
els.roomChatList.value = 'm2'; state.roomChat.selectedIndex = 1;
context.renderSelectedRoomChatDetail();
before = mutations; render();
assert.equal(mutations, before, 'User selection must not rebuild lists on next snapshot');
state.participants[0].microphoneEnabled = false;
context.renderParticipants();
assert.equal(list.options[0], participantA); assert.equal(list.options[1], participantB);
assert.equal(list.value, 'b'); assert.equal(list.scrollTop, 54);
state.participants.push({ id: 'c', name: 'C', role: 'guest' });
context.renderParticipants();
assert.equal(list.options[1], participantB);
state.roomChat.messages.push({ id: 'm3', text: 'Three' });
context.renderRoomChatList();
assert.equal(els.roomChatList.options[0], messageOne);
assert.equal(els.roomChatList.value, 'm2');
state.roomChat.messages.shift(); context.renderRoomChatList();
assert.equal(els.roomChatList.value, 'm2'); assert.equal(state.roomChat.selectedIndex, 0);
state.youtube.chatMessages.unshift({ id: 'y0', text: 'Older' });
context.renderYouTubeChatList();
assert.equal(els.youtubeChatList.value, 'y1'); assert.equal(state.youtube.chatSelectedIndex, 1);
before = mutations; render();
assert.equal(mutations, before);
console.log('Desktop participant, room chat, YouTube chat and recipient lists retain nodes, focus, selection and scroll.');
