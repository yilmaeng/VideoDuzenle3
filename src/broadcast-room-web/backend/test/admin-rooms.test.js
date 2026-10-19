const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { RoomStore } = require('../src/store/room-store');
const { AdminAccountStore } = require('../src/services/admin-account-store');
const { createAdminAuthRouter } = require('../src/routes/admin-auth');

const input = { title: 'Deneme odası', persistent: true, passwordEnabled: false,
    allowJoinWhenHostAbsent: true, allowGuestCamera: true, allowGuestMicrophone: true, allowGuestScreenShare: true };
async function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-room-admin-'));
    const roomFile = path.join(dir, 'rooms.json');
    const accounts = new AdminAccountStore(path.join(dir, 'accounts.json'));
    const rooms = new RoomStore({ persistentRoomsFilePath: roomFile });
    const users = ['one', 'two'].map(name => accounts.verify({ ...accounts.request(`${name}@example.com`, name), ip: name }));
    const events = [];
    const app = express();
    app.use('/auth', createAdminAuthRouter({ config: { appBaseUrl: 'https://meet.other.example', broadcastRoomBasePath: '/yayinodasi',
        localeDir: path.resolve(__dirname, '../../../locales') }, store: accounts, roomStore: rooms,
        mailer: { ready: false }, onRoomChanged: room => events.push(room.roomId) }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    async function call(route = '', body, who = 0, origin = 'https://meet.other.example') {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/auth/rooms${route}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { 'Content-Type': 'application/json', Origin: origin,
                ...(who === null ? {} : { Cookie: `__Host-evd-admin=${users[who].session}` }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: response.status, value: await response.json() };
    }
    return { call, rooms, accounts, users, events, roomFile };
}
test('signed-in ownership, domain isolation, safe payload and persistence', async t => {
    const f = await fixture(t);
    assert.equal((await f.call('', undefined, null)).status, 401);
    assert.equal((await f.call('', input, 0, 'https://evil.example')).status, 403);
    const result = await f.call('', input);
    assert.equal(result.status, 201);
    const room = result.value.room;
    assert.ok(room.inviteUrl.startsWith('https://meet.other.example/yayinodasi/join/'));
    assert.ok(!JSON.stringify(room).includes('ownerKey'));
    assert.ok(!JSON.stringify(room).includes('roomPasswordHash'));
    assert.equal((await f.call()).value.rooms.length, 1);
    assert.equal((await f.call('', undefined, 1)).value.rooms.length, 0);
    assert.equal((await f.call(`/${room.roomId}/settings`, input, 1)).status, 404);
    assert.equal((await f.call(`/${room.roomId}/delete`, { confirm: true }, 1)).status, 404);
    const loaded = new RoomStore({ persistentRoomsFilePath: f.roomFile });
    assert.ok(f.accounts.ownsRoom(f.users[0].user.id, loaded.getRoom(room.roomId)));
    loaded.getRoom(room.roomId).settings.ownerKey = 'rotated';
    assert.equal(f.accounts.ownsRoom(f.users[0].user.id, loaded.getRoom(room.roomId)), false);
});
test('password and guest permissions update the shared room model and event path', async t => {
    const f = await fixture(t);
    assert.equal((await f.call('', { ...input, passwordEnabled: true })).status, 400);
    const room = (await f.call('', { ...input, passwordEnabled: true, password: 'secret' })).value.room;
    const stored = f.rooms.getRoom(room.roomId);
    assert.ok(f.rooms.isPasswordRequired(stored, { hostConnected: true }));
    assert.ok(f.rooms.verifyRoomPassword(stored, 'secret'));
    assert.equal(f.rooms.verifyRoomPassword(stored, 'wrong'), false);
    await f.call(`/${room.roomId}/settings`, { ...input, title: 'Yeni ad', passwordEnabled: true, password: '', allowGuestMicrophone: false });
    assert.ok(f.rooms.verifyRoomPassword(stored, 'secret'));
    assert.equal(stored.settings.allowGuestMicrophone, false);
    assert.equal(stored.title, 'Yeni ad');
    assert.deepEqual(f.events, [room.roomId]);
    await f.call(`/${room.roomId}/settings`, input);
    assert.equal(f.rooms.isPasswordRequired(stored, { hostConnected: true }), false);
    assert.equal(f.rooms.isPasswordRequired(stored, { hostConnected: false }), false);
});
test('link requires actual owner key and cannot transfer a bound room', async t => {
    const f = await fixture(t);
    const legacy = f.rooms.createRoom({ title: 'Legacy', ownerKey: 'desktop-secret', persistentRoom: true, inviteBaseUrl: 'https://meet.other.example/yayinodasi' });
    assert.equal((await f.call('/link', { inviteId: legacy.inviteId, ownerKey: 'wrong' })).status, 400);
    assert.equal((await f.call('/link', { inviteId: legacy.inviteId, ownerKey: 'desktop-secret' })).status, 200);
    assert.equal((await f.call('/link', { inviteId: legacy.inviteId, ownerKey: 'desktop-secret' }, 1)).status, 400);
    assert.equal(f.rooms.getRoom(legacy.roomId).settings.ownerKey, 'desktop-secret');
    assert.equal((await f.call()).value.rooms.length, 1);
    const reload = new AdminAccountStore(f.accounts.filePath);
    assert.ok(reload.ownsRoom(f.users[0].user.id, f.rooms.getRoom(legacy.roomId)));
});
test('delete requires confirmation and idle room, persists removal, leaves recording files', async t => {
    const f = await fixture(t);
    const room = (await f.call('', input)).value.room;
    const route = `/${room.roomId}/delete`;
    assert.equal((await f.call(route, {})).status, 400);
    const stored = f.rooms.getRoom(room.roomId);
    stored.participants.push({ identity: 'host-test', role: 'host', connected: true });
    assert.equal((await f.call(route, { confirm: true })).status, 409);
    stored.participants = []; stored.settings.hostRecordingActive = true;
    assert.equal((await f.call(route, { confirm: true })).status, 409);
    stored.settings.hostRecordingActive = false;
    const recording = path.join(path.dirname(f.roomFile), 'test-recording.txt'); fs.writeFileSync(recording, 'keep');
    assert.equal((await f.call(route, { confirm: true })).status, 200);
    assert.equal(f.rooms.getRoomByInviteId(room.inviteId), null);
    assert.equal(new RoomStore({ persistentRoomsFilePath: f.roomFile }).getRoom(room.roomId), null);
    assert.equal(fs.readFileSync(recording, 'utf8'), 'keep');
});
test('temporary rooms support password and absent-host policy but are not persisted', async t => {
    const f = await fixture(t);
    const room = (await f.call('', { ...input, persistent: false, passwordEnabled: true, password: 'test' })).value.room;
    assert.equal(room.persistent, false);
    assert.equal(room.allowJoinWhenHostAbsent, true);
    assert.equal(room.passwordEnabled, true);
    assert.equal(new RoomStore({ persistentRoomsFilePath: f.roomFile }).getRoom(room.roomId), null);
});
