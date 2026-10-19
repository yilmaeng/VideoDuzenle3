const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../renderer/scripts/broadcast-room.js'), 'utf8');
const start = source.indexOf('const roomChatExportArchive = new Map();');
const end = source.indexOf('function promptRoomExitChoice(', start);
assert(start > 0 && end > start);
const strings = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/tr.json'), 'utf8')).broadcast_room;
let choice = 'leave', failWrite = false, endCalls = 0;
let saveResult = { filePath: 'chat.txt', canceled: false };
const writes = [];
const state = { roomState: { mode: 'live', roomId: 'one', hostIdentity: 'host' }, roomSettings: { title: 'Oda' }, roomChat: { messages: [] } };
const context = {
    state, i18nState: { currentLang: 'tr' },
    t: (key, fallback, vars = {}) => (strings[key.replace('broadcast_room.', '')] || fallback || key).replace(/\{(\w+)\}/g, (_, name) => vars[name] || ''),
    isLocalRoomHost: () => true, announce() {}, setStatus() {},
    describeRoomChatMessage: (m) => `${m.senderName}: ${m.text}`,
    promptRoomExitChoice: async () => choice,
    ipcRenderer: { invoke: async (channel) => { assert.equal(channel, 'show-save-dialog'); return saveResult; } },
    fs: { promises: { writeFile: async (...args) => { if (failWrite) throw new Error('disk full'); writes.push(args); } } },
    requestLiveBroadcastRoomApi: async () => { endCalls++; }, leaveCurrentLiveRoom: async () => {},
    refreshPersistentRooms: async () => {}, window: { close() {} }
};
vm.createContext(context); vm.runInContext(source.slice(start, end), context);
const count = () => vm.runInContext('roomChatExportArchive.size', context);
async function run() {
    assert.equal(await context.offerRoomChatExport(), true, 'No question for empty chat');
    state.roomChat.messages = [
        { id: '1', audience: 'all', senderName: 'Konuk', text: 'Herkese merhaba', createdAt: 2000 },
        { id: '2', audience: 'participant', senderIdentity: 'a', recipientIdentity: 'b', text: 'Private' },
        { id: '3', audience: 'participant', senderIdentity: 'a', recipientIdentity: 'host', senderName: 'A', text: 'Yöneticiye', createdAt: 1000 }
    ];
    context.rememberRoomChatForExport(); assert.equal(count(), 2);
    assert.equal(await context.offerRoomChatExport(), true);
    assert.equal(writes.length, 1);
    assert(writes[0][1].startsWith('\uFEFF'));
    assert(writes[0][1].includes('Herkese merhaba'));
    assert(!writes[0][1].includes('Private'));
    assert(writes[0][1].indexOf('Yöneticiye') < writes[0][1].indexOf('Herkese merhaba'));
    state.roomChat.messages = [{ id: '4', audience: 'all', text: 'New' }];
    context.rememberRoomChatForExport(); assert.equal(count(), 3, 'Retain messages rolled out of server history');
    saveResult = { canceled: true }; assert.equal(await context.offerRoomChatExport(), false);
    saveResult = { filePath: 'chat.txt' }; failWrite = true;
    assert.equal(await context.offerRoomChatExport(), false, 'Write failure prevents meeting termination');
    failWrite = false; choice = 'cancel'; assert.equal(await context.offerRoomChatExport(), false);
    choice = 'end_for_everyone'; assert.equal(await context.offerRoomChatExport(), true);
    state.roomState.roomId = 'two'; state.roomChat.messages = [];
    context.rememberRoomChatForExport(); assert.equal(count(), 0, 'Do not mix rooms');
    for (const lang of ['tr', 'en', 'de', 'es', 'fr']) {
        const locale = JSON.parse(fs.readFileSync(path.join(__dirname, `../locales/${lang}.json`), 'utf8')).broadcast_room;
        for (const key of Object.keys(strings).filter((key) => key.startsWith('chat_export_'))) assert(locale[key]);
    }
    assert(source.indexOf('if (!await offerRoomChatExport()) return;') < source.indexOf('/end-session`,', source.indexOf('async function performRoomExit')));
    assert.equal(endCalls, 0);
    console.log('Chat export: public/private filtering, chronological UTF-8 text, archive, cancel/error protection and locales passed.');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
