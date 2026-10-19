const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createWaitingRoom } = require('../src/services/waiting-room');
const { RoomStore } = require('../src/store/room-store');
const { createBroadcastRoomRouter } = require('../src/routes/broadcast-room');
const crypto = require('node:crypto');

test('secrets bind room/name; expiry, cancel, rejection and replay cannot admit', () => {
    let clock = 100;
    const queue = createWaitingRoom({ now: () => clock, ttl: 100, limit: 3 });
    const room = { active: true, settings: { waitingRoomEnabled: true } };
    const credentials = queue.enter(room, 'Guest').waiting;
    assert.ok(credentials.secret.length >= 40);
    assert.equal(JSON.stringify(queue.list(room)).includes(credentials.secret), false);
    assert.throws(() => queue.status(room, { ...credentials, secret: 'fake' }), /credentials_invalid/);
    assert.throws(() => queue.status({ ...room }, credentials), /credentials_invalid/);
    assert.throws(() => queue.enter(room, 'Impostor', credentials), /credentials_invalid/);
    queue.decide(room, { requestId: credentials.requestId, decision: 'approve' });
    assert.equal(queue.enter(room, 'Guest', credentials), null);
    assert.equal(queue.enter(room, 'Guest', credentials).waiting.status, 'redeemed');
    const rejected = queue.enter(room, 'Rejected').waiting;
    queue.decide(room, { all: true, decision: 'reject' });
    room.settings.waitingRoomEnabled = false;
    assert.equal(queue.enter(room, 'Rejected', rejected).waiting.status, 'rejected');
    assert.throws(() => queue.enter(room, 'Rejected', {}), /credentials_invalid/);
    room.settings.waitingRoomEnabled = true;
    const cancelled = queue.enter(room, 'Cancelled').waiting;
    queue.cancel(room, cancelled);
    assert.equal(queue.enter(room, 'Cancelled', cancelled).waiting.status, 'cancelled');
    assert.throws(() => queue.enter(room, 'Full'), /queue_full/);
    clock = 301;
    assert.equal(queue.list(room).length, 0);
    const expiring = queue.enter(room, 'Expires').waiting;
    clock = 402;
    assert.equal(queue.status(room, expiring).status, 'expired');
});

test('settings validate, persist, default off and require an explicit disabling decision', () => {
    const store = new RoomStore();
    const created = store.createRoom({ ownerKey: 'owner', hostDisplayName: 'Host', inviteBaseUrl: 'https://example.com' });
    const room = store.getRoom(created.roomId);
    assert.equal(room.settings.waitingRoomEnabled, false);
    const update = settings => store.updateRoomSettings(room.roomId, { ownerKey: 'owner', ...settings });
    assert.throws(() => update({ waitingRoomEnabled: 'true' }), /setting_invalid/);
    update({ waitingRoomEnabled: true });
    store.upsertParticipant(room.roomId, { identity: 'existing', role: 'guest', connected: true });
    const waiting = store.waitingRoom.enter(room, 'Waiting').waiting;
    assert.throws(() => update({ waitingRoomEnabled: false }), /disable_decision_required/);
    assert.equal(room.settings.waitingRoomEnabled, true);
    update({ waitingRoomEnabled: false, waitingRoomDecision: 'admit' });
    assert.equal(store.waitingRoom.enter(room, 'Waiting', waiting), null);
    assert.ok(room.participants.some(item => item.identity === 'existing'));
    update({ waitingRoomEnabled: true });
    const reject = store.waitingRoom.enter(room, 'Reject').waiting;
    update({ waitingRoomEnabled: false, waitingRoomDecision: 'reject' });
    assert.equal(store.waitingRoom.enter(room, 'Reject', reject).waiting.status, 'rejected');
});

async function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-waiting-'));
    const store = new RoomStore({ persistentRoomsFilePath: path.join(dir, 'rooms.json') });
    const created = store.createRoom({ hostDisplayName: 'Host', ownerKey: 'owner', persistentRoom: true, inviteBaseUrl: 'https://example.com',
        waitingRoomEnabled: true, allowJoinWhenHostAbsent: true, password: 'password', requirePasswordWhenHostAbsent: true });
    const room = store.getRoom(created.roomId);
    const config = { dataDir: dir, appBaseUrl: 'https://example.com', broadcastRoomBasePath: '/yayinodasi',
        livekitUrl: 'ws://127.0.0.1:9', livekitApiKey: 'fixture', livekitApiSecret: 'fixture-secret-not-for-production', tokenTtlSeconds: 3600 };
    const router = createBroadcastRoomRouter({ config, roomStore: store });
    const app = express(); app.use(express.json(), router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { router.disposePresence(); server.closeAllConnections(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    async function call(action, body = {}, headers = {}) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/broadcast-room/${action}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({ roomId: room.roomId, inviteId: room.inviteId, displayName: 'Guest', password: 'password', ...body }) });
        return { status: response.status, value: await response.json() };
    }
    return { store, room, call, owner: { 'X-EVD-Room-Owner-Key': 'owner' }, dir };
}

test('HTTP withholds all media/session credentials, checks password and admits exactly once', async t => {
    const f = await fixture(t);
    assert.equal((await f.call('join-token', { password: 'wrong' })).status, 403);
    assert.equal(f.store.waitingRoom.list(f.room).length, 0);
    const waiting = (await f.call('join-token')).value;
    assert.equal(waiting.token, undefined); assert.equal(waiting.participantApiKey, undefined);
    assert.equal(f.room.participants.length, 0);
    assert.equal((await f.call('waiting-list')).status, 403);
    assert.equal((await f.call('waiting-decision', { all: true, decision: 'approve' })).status, 403);
    const listed = (await f.call('waiting-list', {}, f.owner)).value;
    assert.equal(listed.requests.length, 1); assert.equal(listed.requests[0].secret, undefined);
    assert.equal((await f.call('waiting-status', { waiting: { ...waiting.waiting, secret: 'bad' } })).status, 409);
    await f.call('waiting-decision', { requestId: waiting.waiting.requestId, decision: 'approve' }, f.owner);
    assert.equal((await f.call('join-token', { waiting: waiting.waiting, password: 'wrong' })).status, 403);
    const [first, second] = await Promise.all([f.call('join-token', { waiting: waiting.waiting }), f.call('join-token', { waiting: waiting.waiting })]);
    assert.equal([first, second].filter(item => item.value.token).length, 1);
    assert.equal(f.room.participants.length, 1);
    const reloaded = new RoomStore({ persistentRoomsFilePath: path.join(f.dir, 'rooms.json') });
    assert.equal(reloaded.getRoom(f.room.roomId).settings.waitingRoomEnabled, true);
});

test('HTTP disable is explicit; invalid credentials never bypass disabled waiting; cohost is session-bound', async t => {
    const f = await fixture(t);
    const pending = (await f.call('join-token')).value.waiting;
    assert.equal((await f.call('room-settings', { waitingRoomEnabled: false }, f.owner)).value.error, 'waiting_disable_decision_required');
    await f.call('room-settings', { waitingRoomEnabled: false, waitingRoomDecision: 'reject' }, f.owner);
    assert.equal((await f.call('join-token', { waiting: pending })).value.waiting.status, 'rejected');
    assert.equal((await f.call('join-token', { waiting: {} })).status, 409);
    const member = (await f.call('join-token')).value;
    const headers = { 'X-EVD-Participant-Identity': member.participantIdentity, 'X-EVD-Participant-Key': member.participantApiKey };
    assert.equal((await f.call('waiting-list', {}, headers)).status, 403);
    f.room.participants.find(item => item.identity === member.participantIdentity).role = 'co_host';
    assert.equal((await f.call('waiting-list', {}, headers)).status, 200);
    assert.equal((await f.call('waiting-decision', { all: true, decision: 'approve' }, headers)).status, 200);
    assert.equal((await f.call('room-settings', { waitingRoomEnabled: true }, headers)).status, 403);
    assert.equal((await f.call('waiting-list', {}, { ...headers, 'X-EVD-Participant-Key': 'forged' })).status, 403);
    f.room.participants.find(item => item.identity === member.participantIdentity).role = 'guest';
    assert.equal((await f.call('waiting-list', {}, headers)).status, 403);
});

test('create and reopening cannot silently disable a queued persistent room', async t => {
    const f = await fixture(t);
    assert.equal((await f.call('create', { waitingRoomEnabled: 'false' }, f.owner)).value.error, 'waiting_setting_invalid');
    await f.call('join-token');
    const reopen = { persistentRoom: true, roomSlug: f.room.inviteId, waitingRoomEnabled: false };
    assert.equal((await f.call('create', reopen, f.owner)).value.error, 'waiting_disable_decision_required');
    assert.equal(f.room.settings.waitingRoomEnabled, true);
    assert.equal((await f.call('create', { ...reopen, waitingRoomDecision: 'reject' }, f.owner)).status, 200);
    assert.equal(f.room.settings.waitingRoomEnabled, false);
});

test('persistent restart retains valid recording session and end persists invalidation', async t => {
    const f = await fixture(t);
    const file = path.join(f.dir, 'rooms.json');
    const waiting = f.store.waitingRoom.enter(f.room, 'Old session').waiting;
    f.store.waitingRoom.decide(f.room, { requestId: waiting.requestId, decision: 'approve' });
    const id = crypto.randomUUID();
    f.room.recordingMeetingId = id; f.room.settings.sessionEndedAt = 1234;
    f.store.savePersistentRooms();
    const reloaded = new RoomStore({ persistentRoomsFilePath: file });
    assert.equal(reloaded.getRoom(f.room.roomId).recordingMeetingId, id);
    assert.equal(reloaded.getRoom(f.room.roomId).settings.sessionEndedAt, 1234);
    f.store.endRoomSessionForEveryone(f.room.roomId);
    assert.equal(f.store.waitingRoom.status(f.room, waiting).status, 'cancelled');
    const ended = new RoomStore({ persistentRoomsFilePath: file }).getRoom(f.room.roomId);
    assert.equal(ended.recordingMeetingId, undefined);
    assert.ok(ended.settings.sessionEndedAt > 1234);
    f.room.recordingMeetingId = '../../not-a-uuid'; f.room.settings.sessionEndedAt = Infinity;
    f.store.savePersistentRooms();
    const invalid = new RoomStore({ persistentRoomsFilePath: file }).getRoom(f.room.roomId);
    assert.equal(invalid.recordingMeetingId, undefined); assert.equal(invalid.settings.sessionEndedAt, 0);
});

test('locale additions have matching keys and web sources parse without a build', () => {
    const vm = require('node:vm');
    const additions = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../docs/waiting-room-locale-additions.json'), 'utf8'));
    const desktop = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../docs/desktop-cloud-locale-additions.json'), 'utf8'));
    function verifyNested(actual, expected) {
        for (const [key, value] of Object.entries(expected)) {
            if (value && typeof value === 'object') verifyNested(actual[key], value);
            else assert.equal(actual[key], value);
        }
    }
    for (const lang of ['en', 'de', 'es', 'fr']) {
        for (const namespace of ['waiting_room', 'admin_auth']) assert.deepEqual(Object.keys(additions[lang][namespace]).sort(), Object.keys(additions.tr[namespace]).sort());
    }
    for (const lang of ['tr', 'en', 'de', 'es', 'fr']) {
        const actual = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../locales', lang + '.json'), 'utf8'));
        for (const namespace of ['waiting_room', 'admin_auth']) for (const [key, value] of Object.entries(additions[lang][namespace])) assert.equal(actual[namespace][key], value);
        assert.ok(actual.admin_auth.recording_pause); assert.ok(actual.admin_auth.recording_resume);
        verifyNested(actual, desktop[lang]);
    }
    const admin = fs.readFileSync(path.resolve(__dirname, '../../frontend/public/admin.html'), 'utf8');
    assert.match(admin, /for="room-waiting-enabled" data-i18n="waiting_room_enabled"/);
    assert.match(admin, /for="room-waiting-decision" data-i18n="waiting_room_disable_label"/);
    assert.doesNotMatch(admin, /data-i18n="admin_auth\.waiting/);
    const join = fs.readFileSync(path.resolve(__dirname, '../../frontend/public/join.html'), 'utf8');
    const waitingScript = join.search(/<script src="\/yayinodasi\/waiting-room\.js\?v=/);
    const joinScript = join.search(/<script src="\/yayinodasi\/join\.js\?v=/);
    assert.ok(waitingScript >= 0 && joinScript > waitingScript);
    const deploy = fs.readFileSync(path.resolve(__dirname, '../../../../build/deploy-broadcast-room.ps1'), 'utf8');
    assert.match(deploy, /Remote = 'public\/waiting-room.js'/);
    assert.match(deploy, /Remote = 'src\/services\/waiting-room.js'/);
    for (const file of ['waiting-room.js', 'join.js', 'admin-rooms.js']) {
        new vm.Script(fs.readFileSync(path.resolve(__dirname, '../../frontend/public', file), 'utf8'), { filename: file });
    }
});

test('manager polling announces new IDs once, serializes fetches and clears stale room rows', async () => {
    const vm = require('node:vm');
    const nodes = [], intervals = [];
    const handlers = {};
    let dialog = null;
    const document = { addEventListener(type, handler) { handlers[type] = handler; }, activeElement: null, querySelector() { return dialog; } };
    function element(tag) {
        const node = { tag, children: [], dataset: {}, events: {}, attributes: {}, writes: 0,
            get textContent() { return this.text || ''; }, set textContent(value) { this.text = value; this.writes++; },
            append(...items) { for (const item of items) { item.parentElement = this; this.children.push(item); } },
            replaceChildren(...items) { this.children = []; this.append(...items); },
            remove() { this.parentElement.children = this.parentElement.children.filter(item => item !== this); },
            after(item) { item.parentElement = this.parentElement; this.parentElement.children.splice(this.parentElement.children.indexOf(this) + 1, 0, item); },
            contains(item) { return this === item || this.children.some(child => child.contains(item)); },
            setAttribute(key, value) { this.attributes[key] = value; },
            addEventListener(key, fn) { this.events[key] = fn; }, focus() { document.activeElement = this; }
        };
        nodes.push(node); return node;
    }
    const host = element('host'), personActions = element('fieldset'); personActions.id = 'host-person-actions'; host.append(personActions);
    document.body = element('body'); document.getElementById = id => id === 'web-host-panel' ? host : nodes.find(node => node.id === id); document.createElement = element;
    const state = { webHost: true, participantRole: 'host', roomConnection: {}, room: { roomId: 'one' } };
    let calls = 0, queue = [{ requestId: 'a', displayName: 'Alice' }], failure = false, pending;
    const requests = [];
    const response = data => ({ ok: true, json: async () => ({ requests: data, waitingRoomEnabled: true }) });
    const sandbox = { document, window: { addEventListener() {} }, setInterval(fn) { intervals.push(fn); }, clearInterval() {},
        fetch: async (url, options) => { calls++; requests.push({ url, body: JSON.parse(options.body) }); if (pending) return pending; if (failure) throw new Error('offline'); return response(queue); } };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../frontend/public/waiting-room.js'), 'utf8'), sandbox);
    sandbox.window.EvdWaitingRoom.init({ state: () => state, t: key => key === 'waiting_room.new_requests' ? '{count}: {names}' : key });
    await new Promise(resolve => setImmediate(resolve));
    const poll = intervals[0], message = nodes.find(node => node.attributes.role === 'status'), list = nodes.find(node => node.tag === 'ul');
    assert.equal(message.parentElement, document.body);
    const disclosure = nodes.find(node => node.id === 'waiting-room-toggle');
    const body = nodes.find(node => node.id === 'waiting-room-controls');
    assert.equal(host.children[1], disclosure.parentElement);
    assert.equal(disclosure.tag, 'button'); assert.equal(disclosure.attributes['aria-expanded'], 'false');
    assert.equal(disclosure.attributes['aria-controls'], body.id); assert.equal(disclosure.attributes['aria-label'], 'waiting_room.title');
    assert.equal(disclosure.children[0].attributes['aria-hidden'], 'true'); assert.equal(body.hidden, true);
    assert.equal(nodes.some(node => node.tag === 'h3'), false);
    disclosure.focus(); disclosure.events.click();
    assert.equal(body.hidden, false); assert.equal(disclosure.attributes['aria-expanded'], 'true');
    assert.equal(message.textContent, '1: Alice');
    const firstRow = list.children[0], writes = message.writes;
    await poll(); assert.equal(message.writes, writes); assert.equal(list.children[0], firstRow);
    assert.equal(body.hidden, false); assert.equal(document.activeElement, disclosure);
    queue = [...queue, { requestId: 'b', displayName: 'Bob' }, { requestId: 'c', displayName: 'Carol' }];
    await poll(); assert.equal(message.textContent, '2: Bob, Carol');
    failure = true; await poll(); const errorWrites = message.writes;
    await poll(); assert.equal(message.writes, errorWrites);
    failure = false;
    let resolvePending; pending = new Promise(resolve => { resolvePending = resolve; });
    const inFlight = poll(), callCount = calls;
    await poll(); assert.equal(calls, callCount);
    state.room = { roomId: 'two' };
    await poll(); assert.equal(list.children.length, 0);
    assert.equal(body.hidden, true); assert.equal(disclosure.attributes['aria-expanded'], 'false');
    resolvePending(response(queue)); await inFlight; assert.equal(list.children.length, 0);
    pending = null; queue = [{ requestId: 'new', displayName: 'New room' }];
    await poll(); assert.equal(list.children.length, 1); assert.equal(message.textContent, '1: New room');
    host.hidden = true;
    const focus = element('button'); document.activeElement = focus;
    const key = overrides => ({ altKey: true, ctrlKey: true, code: 'KeyA', target: focus, preventDefault() { this.prevented = true; }, ...overrides });
    for (const overrides of [{ target: { isContentEditable: true } }, { target: { closest: () => ({}) } }, { repeat: true }, { defaultPrevented: true }, { isComposing: true }, { metaKey: true }]) {
        const event = key(overrides); handlers.keydown(event); assert.equal(event.prevented, undefined);
    }
    dialog = {}; const inDialog = key(); handlers.keydown(inDialog); assert.equal(inDialog.prevented, undefined); dialog = null;
    state.participantRole = 'guest'; const guest = key(); handlers.keydown(guest); assert.equal(guest.prevented, undefined);
    state.participantRole = 'co_host'; state.webHost = false;
    const admitted = key(); handlers.keydown(admitted); assert.equal(admitted.prevented, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(requests.some(item => item.url === '/api/meeting-access/two/waiting-decision' && item.body.all === true && item.body.decision === 'approve'));
    assert.equal(document.activeElement, focus);
});
