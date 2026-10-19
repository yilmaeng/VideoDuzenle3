const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../frontend/public/join.js'), 'utf8');
function fixture() {
    const data = new Map(), nodes = new Map(), messages = [];
    const context = { state: { room: { roomId: 'one' }, webHost: false }, els: { displayName: { value: 'Guest' } },
        localStorage: { getItem: k => data.get(k) || null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) },
        document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); } },
        t: key => key, setStatus: message => messages.push(message) };
    for (const name of ['guestNameStorageKey','syncRememberGuestNameControls','persistGuestName','restoreGuestName','shouldAutoJoinRememberedGuest']) {
        const match = new RegExp(`^( *)function ${name}\\(`, 'm').exec(source);
        const end = source.indexOf(`\n${match[1]}}`, match.index) + match[1].length + 2;
        context[name] = vm.runInNewContext(`(${source.slice(match.index, end)})`, context);
    }
    return { ...context, context, data, messages };
}
test('name storage requires opt-in, is room-scoped, updates name and forgets immediately', () => {
    const f = fixture(); f.persistGuestName(); assert.equal(f.data.size, 0);
    f.state.rememberGuestName = true; f.persistGuestName('First');
    f.els.displayName.value = ''; f.restoreGuestName();
    assert.equal(f.els.displayName.value, 'First'); assert.equal(f.shouldAutoJoinRememberedGuest(), true);
    f.persistGuestName('Changed'); f.restoreGuestName(); assert.equal(f.els.displayName.value, 'Changed');
    f.state.room.roomId = 'two'; f.restoreGuestName(); assert.equal(f.shouldAutoJoinRememberedGuest(), false);
    f.state.room.roomId = 'one'; f.restoreGuestName(); assert.equal(f.state.rememberGuestName, true);
    f.state.rememberGuestName = false; f.persistGuestName(); f.restoreGuestName(); assert.equal(f.data.size, 0);
});
test('remembered identity does not bypass passwords, grant host access, or block manual join on storage failure', () => {
    const f = fixture(); f.state.rememberGuestName = true; f.persistGuestName();
    assert.deepEqual(Object.keys(JSON.parse([...f.data.values()][0])).sort(), ['name','version']);
    f.state.passwordConfigured = true; assert.equal(f.shouldAutoJoinRememberedGuest(), false);
    f.state.passwordConfigured = false; f.state.webHost = true;
    f.restoreGuestName(); assert.equal(f.state.rememberGuestName, false); assert.equal(f.shouldAutoJoinRememberedGuest(), false);
    f.state.webHost = false; f.context.localStorage.getItem = () => { throw new Error('blocked'); };
    f.restoreGuestName(); assert.equal(f.shouldAutoJoinRememberedGuest(), false);
    f.context.localStorage.setItem = () => { throw new Error('blocked'); }; f.state.rememberGuestName = true;
    f.persistGuestName(); assert.equal(f.state.rememberGuestName, false); assert.equal(f.messages.length, 1);
});
test('preference labels exist in every active language', () => {
    for (const lang of ['tr','en','de','es','fr']) {
        const strings = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../locales', lang + '.json'), 'utf8')).broadcast_room_join;
        for (const key of ['remember_guest_name','remember_guest_name_hint','remember_guest_name_failed']) assert.ok(strings[key]);
    }
});
