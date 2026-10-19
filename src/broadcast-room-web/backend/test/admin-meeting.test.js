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

async function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-host-test-'));
    const rooms = new RoomStore({ persistentRoomsFilePath: path.join(dir, 'rooms.json') });
    const accounts = new AdminAccountStore(path.join(dir, 'accounts.json'));
    const users = ['one', 'two'].map(name => accounts.verify({ ...accounts.request(`${name}@example.com`, name), ip: name }));
    const config = { dataDir: dir, appBaseUrl: 'https://example.com', broadcastRoomBasePath: '/yayinodasi',
        localeDir: path.resolve(__dirname, '../../../locales'), livekitUrl: 'ws://127.0.0.1:9',
        livekitApiKey: 'fixture', livekitApiSecret: 'fixture-secret-not-for-production', tokenTtlSeconds: 3600 };
    const created = rooms.createRoom({ title: 'Test', ownerKey: 'private-owner', persistentRoom: true, inviteBaseUrl: 'https://example.com/yayinodasi' });
    const room = rooms.getRoom(created.roomId);
    accounts.bindRoom(users[0].user.id, room);
    rooms.upsertParticipant(room.roomId, { identity: 'guest1', displayName: 'Guest', role: 'guest', connected: true });
    const router = createBroadcastRoomRouter({ config, roomStore: rooms });
    const app = express();
    app.use('/auth', createAdminAuthRouter({ config, store: accounts, roomStore: rooms, broadcastRouter: router, mailer: { ready: false } }));
    app.use('/api', express.json(), router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function call(action = '', body, who = 0, origin = config.appBaseUrl) {
        const response = await fetch(`${base}/auth/meeting/${room.roomId}${action ? '/' + action : ''}`, {
            method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Origin: origin,
                ...(who === null ? {} : { Cookie: `__Host-evd-admin=${users[who].session}` }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: response.status, value: await response.json() };
    }
    return { room, rooms, accounts, users, call, base };
}

test('saved account name is returned for automatic join and used for the media token', async t => {
    const f = await fixture(t);
    f.accounts.updateProfile(f.users[0].user.id, 'Engin Yılmaz');
    assert.equal((await f.call()).value.displayName, 'Engin Yılmaz');
    const joined = await f.call('join', {});
    assert.equal(joined.status, 200);
    const claims = JSON.parse(Buffer.from(joined.value.token.split('.')[1], 'base64url'));
    assert.equal(claims.name, 'Engin Yılmaz');
});

test('web host requires owner account and same origin; returns scoped media credentials without owner secrets', async t => {
    const f = await fixture(t);
    assert.equal((await f.call('', undefined, null)).status, 401);
    assert.equal((await f.call('', undefined, 1)).status, 404);
    assert.equal((await f.call('join', { displayName: 'Host' }, 0, 'https://evil.example')).status, 403);
    assert.equal((await f.call('join', { displayName: 'Host' }, 1)).status, 404);
    assert.equal((await f.call('join', { displayName: '' })).status, 400);
    const result = await f.call('join', { displayName: 'Engin' });
    assert.equal(result.status, 200); assert.equal(result.value.participantRole, 'host');
    assert.ok(result.value.participantApiKey); assert.ok(result.value.token);
    assert.ok(!JSON.stringify(result.value).includes('private-owner'));
    assert.ok(!JSON.stringify(result.value).includes('ownerKey'));
    assert.equal((await f.call('join', { displayName: 'Second' })).value.error, 'meeting_host_present');
    assert.equal(f.room.participants.filter(p => p.role === 'host').length, 1);
    const forged = await fetch(`${f.base}/api/broadcast-room/participant-controls`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId: f.room.roomId, identity: 'guest1', requestedMicrophoneEnabled: false, authenticatedWebOwnerRoomId: f.room.roomId }) });
    assert.equal(forged.status, 403);
});

test('moderation reuses room control state; volume merges and OBS state stays intact', async t => {
    const f = await fixture(t);
    const host = (await f.call('join', { displayName: 'Host' })).value;
    f.room.settings.hostRecordingActive = true; f.room.settings.youtubeLiveActive = true;
    f.room.settings.participantVolumes = { another: 80 };
    assert.equal((await f.call('all', { operation: 'mute' })).status, 200);
    assert.equal(f.room.participants.find(p => p.identity === 'guest1').requestedMicrophoneEnabled, false);
    assert.equal(f.room.participants.find(p => p.role === 'host').requestedMicrophoneEnabled, undefined);
    assert.equal((await f.call('participant', { identity: 'guest1', operation: 'camera-off' })).status, 200);
    assert.equal(f.room.participants.find(p => p.identity === 'guest1').requestedCameraEnabled, false);
    assert.equal((await f.call('participant', { identity: host.participantIdentity, operation: 'mute' })).status, 404);
    assert.equal((await f.call('volume', { identity: 'guest1', value: 155 })).status, 200);
    assert.deepEqual(f.room.settings.participantVolumes, { another: 80, guest1: 155 });
    assert.equal((await f.call('volume', { identity: 'guest1', value: 201 })).status, 400);
    assert.equal((await f.call('permissions', { key: 'allowGuestMicrophone', value: false })).status, 200);
    assert.equal(f.room.settings.allowGuestMicrophone, false);
    assert.equal((await f.call('permissions', { key: 'ownerKey', value: false })).status, 400);
    assert.equal((await f.call('participant', { identity: 'guest1', operation: 'spotlight', value: true })).status, 200);
    assert.equal(f.room.participants.find(p => p.identity === 'guest1').spotlighted, true);
    assert.equal(f.room.settings.hostRecordingActive, true); assert.equal(f.room.settings.youtubeLiveActive, true);
    assert.equal(f.room.settings.ownerKey, 'private-owner');
});

test('end requires confirmation and host identity; logout immediately revokes account controls', async t => {
    const f = await fixture(t);
    const host = (await f.call('join', { displayName: 'Host' })).value;
    assert.equal((await f.call('end', { identity: host.participantIdentity })).status, 400);
    assert.equal((await f.call('end', { identity: 'guest1', confirm: true })).status, 403);
    assert.equal((await f.call('end', { identity: host.participantIdentity, confirm: true })).status, 200);
    f.accounts.logout(f.users[0].session);
    assert.equal((await f.call('all', { operation: 'mute' })).status, 401);
});

test('all host UI keys exist in every locale', () => {
    const root = path.resolve(__dirname, '../../frontend/public');
    const html = fs.readFileSync(path.join(root, 'join.html'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'web-host.js'), 'utf8');
    const keys = new Set([...html.matchAll(/data-i18n="admin_auth\.([\w]+)"/g), ...js.matchAll(/\bt\('([\w]+)'\)/g)].map(match => match[1]));
    for (const lang of ['tr', 'en', 'de', 'es', 'fr']) {
        const strings = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../locales', `${lang}.json`), 'utf8')).admin_auth;
        for (const key of keys) assert.ok(strings[key], `${lang}:${key}`);
    }
});
