const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { RoomStore } = require('../src/store/room-store');
const { AdminAccountStore } = require('../src/services/admin-account-store');
const { createAdminAuthRouter } = require('../src/routes/admin-auth');
const { createBroadcastRoomRouter } = require('../src/routes/broadcast-room');
const { RoomAccountClient } = require('../../../main/room-account-client');

async function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-desktop-account-'));
    const rooms = new RoomStore({ persistentRoomsFilePath: path.join(dir, 'rooms.json') });
    const accounts = new AdminAccountStore(path.join(dir, 'accounts.json'));
    const users = ['one', 'two'].map(name => accounts.verify({ ...accounts.request(`${name}@example.com`, name), ip: name }));
    const config = { dataDir: dir, appBaseUrl: 'https://example.com', broadcastRoomBasePath: '/yayinodasi',
        localeDir: path.resolve(__dirname, '../../../locales'), livekitUrl: 'ws://127.0.0.1:9',
        livekitApiKey: 'fixture', livekitApiSecret: 'fixture-secret-not-production', tokenTtlSeconds: 3600 };
    const room = rooms.getRoom(rooms.createRoom({ title: 'Assigned room', ownerKey: 'private-owner',
        persistentRoom: true, inviteBaseUrl: 'https://example.com/yayinodasi' }).roomId);
    accounts.bindRoom(users[0].user.id, room);
    const app = express();
    const broadcastRouter = createBroadcastRoomRouter({ config, roomStore: rooms });
    app.use('/auth', createAdminAuthRouter({ config, store: accounts, roomStore: rooms, broadcastRouter, mailer: { ready: false } }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    async function call(endpoint, body, who = 0, origin = config.appBaseUrl) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/auth/${endpoint}`, {
            method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, 'Content-Type': 'application/json',
                ...(who === null ? {} : { Cookie: `__Host-evd-admin=${users[who].session}` }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: response.status, value: await response.json() };
    }
    return { dir, rooms, room, accounts, users, call };
}

test('desktop rooms require account ownership and never expose owner keys', async t => {
    const f = await fixture(t);
    assert.equal((await f.call('desktop/rooms', undefined, null)).status, 401);
    assert.deepEqual((await f.call('desktop/rooms', undefined, 1)).value.rooms, []);
    const listed = await f.call('desktop/rooms');
    assert.equal(listed.value.rooms[0].roomId, f.room.roomId);
    assert.ok(!JSON.stringify(listed).includes('private-owner'));
    assert.equal((await f.call('desktop/remember', { confirm: true }, 0, 'https://evil.example')).status, 403);
    const body = { roomId: f.room.roomId, action: 'host-token', data: { hostDisplayName: 'Sevda' } };
    assert.equal((await f.call('desktop/room', body, 1)).status, 403);
    const joined = await f.call('desktop/room', body);
    assert.equal(joined.status, 200);
    assert.equal(joined.value.participantRole, 'host');
    assert.ok(joined.value.participantApiKey);
    assert.ok(!JSON.stringify(joined.value).includes('private-owner'));
    assert.equal((await f.call('desktop/room', body)).value.error, 'meeting_host_present');
    for (const action of ['admin-login', 'create', '../admin/accounts/create']) {
        assert.equal((await f.call('desktop/room', { ...body, action })).status, 400);
    }
    const changed = await f.call('desktop/room', { ...body, action: 'room-settings',
        data: { roomId: 'forged-room', ownerKey: 'replacement', allowGuestMicrophone: false } });
    assert.equal(changed.status, 200);
    assert.equal(f.room.settings.ownerKey, 'private-owner');
    assert.equal(f.room.settings.allowGuestMicrophone, false);
    await f.call('desktop/room', { ...body, action: 'room-settings', data: { waitingRoomEnabled: true } });
    const waiting = f.rooms.waitingRoom.enter(f.room, 'Guest');
    const queue = await f.call('desktop/room', { ...body, action: 'waiting-list', data: {} });
    assert.equal(queue.status, 200);
    assert.equal(queue.value.requests[0].displayName, 'Guest');
    assert.ok(!JSON.stringify(queue.value).includes(waiting.waiting.secret));
    assert.equal((await f.call('desktop/room', { ...body, action: 'waiting-decision',
        data: { requestId: waiting.waiting.requestId, decision: 'approve' } }, 1)).status, 403);
    assert.equal((await f.call('desktop/room', { ...body, action: 'waiting-decision',
        data: { requestId: waiting.waiting.requestId, decision: 'approve' } })).status, 200);
    assert.equal(f.rooms.waitingRoom.status(f.room, waiting.waiting).status, 'approved');
    assert.equal((await f.call('desktop/room', { ...body, method: 'GET', action: 'snapshot' })).status, 200);
    f.accounts.assignRoom('two@example.com', f.room, true);
    assert.equal((await f.call('desktop/room', { ...body, action: 'room-settings' })).status, 403);
});

test('remembered device survives restart but password reset revokes it and first-login restrictions remain', async t => {
    const f = await fixture(t);
    assert.equal((await f.call('desktop/remember', { confirm: false })).status, 400);
    assert.equal((await f.call('desktop/remember', { confirm: true })).status, 200);
    const reopened = new AdminAccountStore(path.join(f.dir, 'accounts.json'), { now: () => Date.now() + 366 * 86400000 });
    assert.equal(reopened.session(f.users[0].session).id, f.users[0].user.id);
    assert.ok(!fs.readFileSync(reopened.filePath, 'utf8').includes(f.users[0].session));
    await f.accounts.provision('one@example.com', 'temporary-password-123', true);
    assert.equal((await f.call('desktop/rooms')).status, 401);
    const login = await f.accounts.passwordLogin({ email: 'one@example.com', password: 'temporary-password-123', ip: 'test' });
    f.users[0] = login;
    assert.equal((await f.call('desktop/rooms')).status, 403);
    assert.equal((await f.call('desktop/remember', { confirm: true })).status, 403);
    f.users[0] = await f.accounts.changePassword(login.user.id, 'new-personal-password-123');
    assert.equal((await f.call('desktop/rooms')).status, 200);
    f.accounts.logout(f.users[0].session);
    assert.equal((await f.call('desktop/rooms')).status, 401);
});

test('desktop client stores only encrypted device grant, restores it and forgets invalid sessions', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-account-client-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const token = 'A'.repeat(43), filePath = path.join(dir, 'device.enc');
    const calls = [];
    const safeStorage = { isEncryptionAvailable: () => true,
        encryptString: value => Buffer.from(value.split('').map(c => String.fromCharCode(c.charCodeAt(0) + 1)).join('')),
        decryptString: buffer => buffer.toString().split('').map(c => String.fromCharCode(c.charCodeAt(0) - 1)).join('') };
    const request = async (endpoint, method, cookie, body) => {
        calls.push({ endpoint, method, cookie, body });
        if (endpoint === 'password-login') return { status: 200, cookie: token, payload: { user: { email: 'test@example.com' } } };
        return { status: 200, payload: { user: { email: 'test@example.com' } } };
    };
    const client = new RoomAccountClient({ filePath, safeStorage, request });
    const login = await client.call('password-login', { email: 'test@example.com', password: 'not-written-to-disk' });
    assert.ok(!JSON.stringify(login).includes(token));
    assert.ok(!fs.existsSync(filePath));
    assert.equal((await client.call('desktop/remember', { confirm: true })).remembered, true);
    assert.ok(!fs.readFileSync(filePath, 'utf8').includes(token));
    const restored = new RoomAccountClient({ filePath, safeStorage, request });
    assert.equal((await restored.call('session')).remembered, true);
    assert.equal(calls.at(-1).cookie, token);
    assert.equal((await restored.call('../admin/accounts', {})).error, 'request_failed');
    restored.request = async () => ({ status: 401, payload: { error: 'session_required' } });
    await restored.call('desktop/rooms');
    assert.ok(!fs.existsSync(filePath));
    assert.equal(restored.cookie, '');
    const insecure = new RoomAccountClient({ filePath, safeStorage: { isEncryptionAvailable: () => false }, request });
    assert.equal((await insecure.call('desktop/remember', { confirm: true })).error, 'secure_storage_unavailable');
    assert.ok(!fs.existsSync(filePath));
});

test('desktop account strings and labels exist in all locales', () => {
    for (const lang of ['tr', 'en', 'de', 'es', 'fr']) {
        const strings = require(`../../../locales/${lang}.json`).admin_auth;
        for (const key of ['desktop_title', 'desktop_hint', 'desktop_remember', 'desktop_logout', 'desktop_ready', 'desktop_leave_first', 'secure_storage_unavailable']) {
            assert.equal(typeof strings[key], 'string', `${lang}:${key}`);
        }
    }
});

test('renderer routes owned rooms through account bridge; guests retain scoped participant access', async () => {
    const vm = require('node:vm');
    const source = fs.readFileSync(path.resolve(__dirname, '../../../renderer/scripts/broadcast-room.js'), 'utf8');
    const start = source.indexOf('async function requestLiveBroadcastRoomApi(');
    const end = source.indexOf('\nfunction getBroadcastRoomApiErrorMessage', start);
    const calls = [];
    const roomAccount = { rooms: [{ roomId: 'assigned' }], activeRoomId: '' };
    const state = { roomState: { roomId: 'assigned' } };
    let role = 'host';
    const context = vm.createContext({ roomAccount, state, Headers, getLocalRoomRole: () => role,
        roomParticipantApiKeys: new Map([['assigned', 'participant-session']]),
        roomAccountRequest: async (endpoint, body) => { calls.push({ endpoint, body }); return { success: true }; },
        getBroadcastRoomOwnerKey: () => 'legacy-key', getLiveBroadcastRoomApiUrl: value => value,
        fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ success: true }) }; }
    });
    vm.runInContext(source.slice(start, end), context);
    await context.requestLiveBroadcastRoomApi('/broadcast-room/participant-controls', { method: 'POST', body: JSON.stringify({ roomId: 'assigned', identity: 'guest' }) });
    assert.equal(calls.at(-1).endpoint, 'desktop/room');
    assert.equal(calls.at(-1).body.action, 'participant-controls');
    assert.ok(!JSON.stringify(calls.at(-1)).includes('legacy-key'));
    roomAccount.rooms = []; roomAccount.activeRoomId = 'assigned';
    await context.requestLiveBroadcastRoomApi('/broadcast-room/assigned/end-session', { method: 'POST' });
    assert.equal(calls.at(-1).endpoint, 'desktop/room');
    assert.equal(calls.at(-1).body.roomId, 'assigned');
    role = 'guest';
    await context.requestLiveBroadcastRoomApi('/broadcast-room/participant-state', { method: 'POST', body: JSON.stringify({ roomId: 'assigned', identity: 'self' }) });
    assert.equal(calls.at(-1).url, '/broadcast-room/participant-state');
    assert.equal(calls.at(-1).options.headers.get('X-EVD-Participant-Key'), 'participant-session');
    role = 'host';
    await context.requestLiveBroadcastRoomApi('/broadcast-room/host-token', { method: 'POST', body: JSON.stringify({ roomId: 'legacy-room' }) });
    assert.equal(calls.at(-1).options.headers.get('X-EVD-Room-Owner-Key'), 'legacy-key');
});
