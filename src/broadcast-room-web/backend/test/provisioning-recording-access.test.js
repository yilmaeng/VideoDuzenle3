const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { AdminAccountStore } = require('../src/services/admin-account-store');
const { RoomStore } = require('../src/store/room-store');
const { ServerRecordings } = require('../src/services/server-recordings');
const { createAdminAuthRouter } = require('../src/routes/admin-auth');
const { createBroadcastRoomRouter } = require('../src/routes/broadcast-room');
const { createMeetingRecordingAccess } = require('../src/routes/meeting-recording-access');

async function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-provision-test-'));
    const accounts = new AdminAccountStore(path.join(dir, 'accounts.json'));
    const rooms = new RoomStore({ persistentRoomsFilePath: path.join(dir, 'rooms.json') });
    const config = { dataDir: dir, appBaseUrl: 'https://example.com', broadcastRoomBasePath: '/yayinodasi',
        localeDir: path.resolve(__dirname, '../../../locales'), livekitUrl: 'ws://127.0.0.1:9',
        livekitApiKey: 'test', livekitApiSecret: 'not-a-production-secret', tokenTtlSeconds: 3600,
        webinarAdminSecret: 'fixture-admin-secret', recordingEnabled: true, recordingEgressDir: '/out', recordingMinFreeBytes: 1 };
    const jobs = [];
    const recordings = new ServerRecordings({ config, roomStore: rooms, roomClient: { async listParticipants() { return [{ kind: 0 }]; } }, client: {
        async startRoomCompositeEgress(roomName) { const job = { egressId: 'job-' + jobs.length, roomName, status: 1 }; jobs.push(job); return job; },
        async listEgress() { return jobs; }, async stopEgress(id) { const job = jobs.find(item => item.egressId === id); job.status = 3; return job; }
    } });
    const broadcast = createBroadcastRoomRouter({ config, roomStore: rooms });
    const app = express();
    app.use('/access', createMeetingRecordingAccess({ config, roomStore: rooms, broadcastRouter: broadcast, recordings }));
    app.use('/auth', createAdminAuthRouter({ config, store: accounts, roomStore: rooms, recordings, broadcastRouter: broadcast, mailer: { ready: false } }));
    app.use('/api', express.json(), broadcast);
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    async function call(route, body = {}, headers = {}) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: 'POST',
            headers: { Origin: config.appBaseUrl, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
        const raw = await response.text(); let value; try { value = JSON.parse(raw); } catch { value = raw; }
        return { status: response.status, value, cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    const adminToken = (await call('/api/broadcast-room/admin-login', { adminSecret: config.webinarAdminSecret })).value.adminToken;
    const provision = (action, body = {}) => call('/api/broadcast-room/admin/accounts/' + action, { adminToken, ...body });
    return { accounts, rooms, recordings, call, provision, jobs };
}

test('system admin provisions password account, mandatory change, ownership and explicit reset/transfer', async t => {
    const f = await fixture(t);
    assert.equal((await f.call('/api/broadcast-room/admin/accounts/account', { email: 'x@example.com', password: 'a-long-password' })).status, 403);
    assert.equal((await f.provision('account', { email: 'owner@example.com', password: 'short' })).value.error, 'password_policy');
    assert.equal((await f.provision('account', { email: 'owner@example.com', password: 'first-password' })).status, 200);
    assert.equal(f.accounts.state.users[0].verifiedAt, undefined);
    assert.ok(!fs.readFileSync(f.accounts.filePath, 'utf8').includes('first-password'));
    const bad = await f.call('/auth/password-login', { email: 'owner@example.com', password: 'wrong-password' });
    assert.equal(bad.value.error, 'credentials_invalid');
    const signed = await f.call('/auth/password-login', { email: 'owner@example.com', password: 'first-password' });
    assert.equal(signed.value.user.passwordChangeRequired, true);
    assert.equal((await f.call('/auth/rooms', {}, { Cookie: signed.cookie })).value.error, 'password_change_required');
    const changed = await f.call('/auth/password-change', { password: 'second-password' }, { Cookie: signed.cookie });
    assert.equal(changed.status, 200);
    assert.equal(f.accounts.session(signed.cookie.split('=')[1]), null);
    const created = await f.provision('create', { email: 'owner@example.com', title: 'Existing room' });
    assert.equal(created.status, 201);
    const room = f.rooms.getRoom(created.value.roomId);
    assert.equal(f.accounts.ownsRoom(signed.value.user.id, room), true);
    assert.equal((await f.provision('account', { email: 'owner@example.com', password: 'third-password' })).value.error, 'account_exists');
    await f.provision('account', { email: 'other@example.com', password: 'other-password' });
    assert.equal((await f.provision('assign', { email: 'other@example.com', roomId: room.roomId })).value.error, 'owner_transfer_confirmation');
    assert.equal((await f.provision('assign', { email: 'other@example.com', roomId: room.roomId, transfer: true })).status, 200);
    assert.equal(f.accounts.ownsRoom(signed.value.user.id, room), false);
    f.rooms.upsertParticipant(room.roomId, { identity: 'guest', role: 'guest', connected: true });
    assert.equal((await f.provision('assign', { email: 'owner@example.com', roomId: room.roomId, transfer: true })).value.error, 'room_busy');
    await f.provision('account', { email: 'owner@example.com', password: 'third-password', reset: true });
    assert.equal(f.accounts.session(changed.cookie.split('=')[1]), null);
    assert.equal((await f.call('/auth/password-login', { email: 'owner@example.com', password: 'second-password' })).status, 401);
    assert.equal((await f.call('/auth/password-login', { email: 'owner@example.com', password: 'third-password' }, { Origin: 'https://evil.example' })).status, 403);
});

test('temporary manager authorization, session-only recording links, revocation and next meeting isolation', async t => {
    const f = await fixture(t);
    const created = f.rooms.createRoom({ title: 'Meeting', ownerKey: 'owner-key', persistentRoom: true, allowJoinWhenHostAbsent: true, inviteBaseUrl: 'https://example.com/yayinodasi' });
    const room = f.rooms.getRoom(created.roomId);
    const joined = await f.call('/api/broadcast-room/join-token', { inviteId: room.inviteId, displayName: 'Manager' });
    assert.equal(joined.status, 200);
    const id = joined.value.participantIdentity;
    const headers = { 'X-EVD-Participant-Identity': id, 'X-EVD-Participant-Key': joined.value.participantApiKey };
    const base = `/access/${room.roomId}`;
    assert.equal((await f.call(base + '/recording/link', {}, headers)).status, 403);
    f.rooms.updateParticipantControls(room.roomId, id, { role: 'co_host' });
    assert.equal((await f.call(base + '/recording/link', {}, { ...headers, 'X-EVD-Participant-Key': 'forged' })).status, 403);
    assert.equal((await f.call(base + '/end', { confirm: true }, headers)).status, 403);
    assert.equal((await f.call(base + '/permissions', { key: 'allowGuestCamera', value: false }, headers)).status, 403);
    assert.equal((await f.call(base + '/all', { operation: 'mute' }, headers)).status, 200);
    f.rooms.updateParticipantControls(room.roomId, id, { role: 'guest' });
    assert.equal((await f.call(base + '/all', { operation: 'mute' }, headers)).status, 403);
    f.rooms.updateParticipantControls(room.roomId, id, { role: 'co_host' });
    const shared = await f.call(base + '/recording/link', {}, headers);
    assert.equal(shared.status, 200);
    const token = new URL(shared.value.link.url).hash.slice(1);
    assert.ok(!fs.readFileSync(f.recordings.file, 'utf8').includes(token));
    assert.equal((await f.call(base + '/recording/start', {}, headers)).value.error, 'recording_confirmation');
    const started = await f.call(base + '/recording/start', { confirm: true }, headers);
    assert.equal(started.status, 200);
    const row = f.recordings.state.recordings[0];
    const stopped = await f.call(base + '/recording/stop', { id: row.id }, headers);
    assert.equal(stopped.status, 200);
    fs.writeFileSync(path.join(f.recordings.root, row.fileName), 'test-mp4');
    f.rooms.endRoomSessionForEveryone(room.roomId);
    assert.equal((await f.call(base + '/recording/list', {}, headers)).status, 403);
    const listed = await f.call('/access/shared/list', { token });
    assert.equal(listed.value.recordings.length, 1);
    assert.equal((await f.call('/access/shared/download', { token, id: row.id })).value, 'test-mp4');
    assert.equal((await f.call('/access/shared/download', { token, id: 'other' })).status, 400);
    room.settings.sessionEndedAt = 0;
    f.rooms.upsertParticipant(room.roomId, { identity: 'new-person', role: 'guest', connected: true });
    const next = await f.recordings.start(room, 'next-owner');
    assert.equal((await f.call('/access/shared/list', { token })).value.recordings.length, 1);
    assert.equal((await f.call('/access/shared/download', { token, id: next.id })).status, 400);
    f.recordings.state.downloadGrants[0].revoked = true;
    assert.equal((await f.call('/access/shared/list', { token })).value.error, 'recording_link_invalid');
    f.recordings.state.downloadGrants[0].revoked = false;
    f.recordings.state.downloadGrants[0].expires = Date.now() - 1;
    assert.equal((await f.call('/access/shared/list', { token })).value.error, 'recording_link_invalid');
});

test('new admin and shared-recording UI keys exist in all five locales', () => {
    const publicDir = path.resolve(__dirname, '../../frontend/public');
    const desktop = fs.readFileSync(path.resolve(__dirname, '../../../renderer/dialogs/broadcast-room.html'), 'utf8');
    const web = ['admin.html', 'recordings.html', 'join.html'].map(name => fs.readFileSync(path.join(publicDir, name), 'utf8'));
    for (const lang of ['tr','en','de','es','fr']) {
        const strings = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../locales', lang + '.json'), 'utf8'));
        for (const html of [desktop, ...web]) for (const match of html.matchAll(/data-i18n="(admin_auth\.[^"]+)"/g)) {
            assert.ok(strings.admin_auth[match[1].split('.')[1]], `${lang}: ${match[1]}`);
        }
        for (const html of web.slice(0, 2)) for (const match of html.matchAll(/data-i18n="([^"]+)"/g)) assert.ok(strings.admin_auth[match[1]], `${lang}: ${match[1]}`);
    }
});
