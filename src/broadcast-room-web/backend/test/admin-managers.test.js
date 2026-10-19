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

async function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-managers-test-'));
    let now = Date.now();
    const accounts = new AdminAccountStore(path.join(dir, 'accounts.json'), { now: () => now });
    const rooms = new RoomStore({ persistentRoomsFilePath: path.join(dir, 'rooms.json') });
    const users = ['owner', 'manager', 'other'].map(name => accounts.verify({ ...accounts.request(`${name}@example.com`, name), ip: name, remember: true }));
    const created = rooms.createRoom({ title: 'Test', ownerKey: 'owner-key', persistentRoom: true, inviteBaseUrl: 'https://example.com/yayinodasi' });
    const room = rooms.getRoom(created.roomId); accounts.bindRoom(users[0].user.id, room);
    rooms.upsertParticipant(room.roomId, { identity: 'guest', displayName: 'Guest', role: 'guest', connected: true });
    const config = { dataDir: dir, appBaseUrl: 'https://example.com', broadcastRoomBasePath: '/yayinodasi',
        localeDir: path.resolve(__dirname, '../../../locales'), livekitUrl: 'ws://127.0.0.1:9',
        livekitApiKey: 'test', livekitApiSecret: 'test-secret-not-for-production', tokenTtlSeconds: 3600,
        recordingEnabled: true, recordingEgressDir: '/out', recordingMinFreeBytes: 1 };
    const jobs = [];
    const recordings = new ServerRecordings({ config, roomStore: rooms, roomClient: { async listParticipants() { return [{ kind: 0 }]; } }, client: {
        async startRoomCompositeEgress(roomName) { const job = { egressId: 'job', roomName, status: 1 }; jobs.push(job); return job; },
        async listEgress() { return jobs; }, async stopEgress() { jobs[0].status = 3; return jobs[0]; }
    } });
    const mails = []; const mailer = { ready: true, async send(message) { mails.push(message); } };
    const broadcastRouter = createBroadcastRoomRouter({ config, roomStore: rooms });
    const app = express();
    app.use('/auth', createAdminAuthRouter({ config, store: accounts, roomStore: rooms, recordings, broadcastRouter, mailer }));
    app.use('/api', express.json(), broadcastRouter);
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function call(route, body, who = 0, origin = config.appBaseUrl) {
        const response = await fetch(base + '/auth' + route, { method: body === undefined ? 'GET' : 'POST',
            headers: { 'Content-Type': 'application/json', Origin: origin, ...(who === null ? {} : { Cookie: `__Host-evd-admin=${users[who].session}` }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const raw = await response.text(); let value; try { value = JSON.parse(raw); } catch { value = raw; }
        return { status: response.status, value };
    }
    const url = `/managers/${room.roomId}`;
    async function invite(read = false) {
        const result = await call(url + '/invite', { email: 'MANAGER@example.com', recordings: read, lang: 'tr' });
        assert.equal(result.status, 200);
        return accounts.state.roomManagers.at(-1);
    }
    const accept = id => call(`/managers/invitations/${id}/accept`, {}, 1);
    return { accounts, users, room, rooms, recordings, mails, mailer, call, url, invite, accept, advance: ms => now += ms, base };
}

test('verified recipient must accept; owner-only administration, scope isolation and revocation', async t => {
    const f = await fixture(t); const invite = await f.invite();
    assert.equal(f.mails.length, 1); assert.ok(f.mails[0].text.includes('https://example.com/admin'));
    assert.equal(f.accounts.roomAccess(f.users[1].user.id, f.room), null);
    assert.equal((await f.call('/rooms', undefined, 1)).value.rooms.length, 0);
    assert.equal((await f.call(`/managers/invitations/${invite.id}/accept`, {}, 2)).status, 400);
    assert.equal((await f.accept(invite.id)).status, 200);
    assert.equal((await f.accept(invite.id)).status, 400);
    assert.equal((await f.call('/rooms', undefined, 1)).value.rooms[0].accessRole, 'manager');
    assert.equal((await f.call(f.url + '/invite', { email: 'other@example.com', recordings: true }, 1)).status, 404);
    assert.equal((await f.call(`/rooms/${f.room.roomId}/delete`, { confirm: true }, 1)).status, 404);
    assert.equal((await f.call(`/rooms/${f.room.roomId}/settings`, {}, 1)).status, 404);
    assert.equal((await f.call(f.url, undefined, 1)).status, 404);
    assert.equal((await f.call(f.url + '/revoke', { invitationId: invite.id, confirm: true }, 0, 'https://evil.example')).status, 403);
    assert.equal((await f.call(`/meeting/${f.room.roomId}/all`, { operation: 'mute' }, 1)).status, 200);
    await f.call(f.url + '/revoke', { invitationId: invite.id, confirm: true });
    assert.equal((await f.call(`/meeting/${f.room.roomId}/all`, { operation: 'mute' }, 1)).status, 404);
    assert.equal((await f.call('/rooms', undefined, 1)).value.rooms.length, 0);
    const reloaded = new AdminAccountStore(f.accounts.filePath);
    assert.equal(reloaded.roomAccess(f.users[1].user.id, f.room), null);
    assert.ok(reloaded.state.audit.some(item => item.action === 'meeting_all_requested' && item.userId === f.users[1].user.id));
});

test('delegated recording belongs to owner; playback permission and revocation are enforced separately', async t => {
    const f = await fixture(t); const invitation = await f.invite(); await f.accept(invitation.id);
    const started = await f.call('/recordings/start', { roomId: f.room.roomId, confirm: true }, 1);
    assert.equal(started.status, 200); const id = started.value.recording.id;
    const row = f.recordings.state.recordings[0];
    assert.equal(row.userId, f.users[0].user.id);
    assert.equal((await f.call('/recordings', undefined, 1)).value.recordings.length, 1);
    assert.equal((await f.call(`/recordings/${id}/stop`, {}, 1)).status, 200);
    fs.writeFileSync(path.join(f.recordings.root, row.fileName), 'fixture-media');
    assert.equal((await f.call('/recordings', undefined, 1)).value.recordings.length, 0);
    assert.equal((await f.call(`/recordings/${id}/download`, undefined, 1)).status, 404);
    assert.equal((await f.call(`/recordings/${id}/download`)).status, 200);
    await f.call(f.url + '/revoke', { invitationId: invitation.id, confirm: true });
    const second = await f.invite(true); await f.accept(second.id);
    assert.equal((await f.call(`/recordings/${id}/download`, undefined, 1)).status, 200);
    assert.equal((await f.call(`/recordings/${id}/delete`, { confirm: true }, 1)).status, 404);
    assert.equal((await f.call('/recordings', undefined, 1)).value.recordings.find(row => row.id === id).canDelete, false);
    await f.call(f.url + '/revoke', { invitationId: second.id, confirm: true });
    assert.equal((await f.call(`/recordings/${id}/download`, undefined, 1)).status, 404);
    assert.equal((await f.call(`/recordings/${id}/stop`, {}, 1)).status, 404);
    assert.ok(f.accounts.state.audit.some(item => item.action === 'recording_start_requested' && item.userId === f.users[1].user.id));
});

test('expired and rotated-owner invitations fail; mail failure queues a persistent notification', async t => {
    const f = await fixture(t); const invite = await f.invite(); f.advance(8 * 86400000);
    assert.equal((await f.accept(invite.id)).status, 400);
    const next = await f.invite(); f.room.settings.ownerKey = 'changed';
    assert.equal((await f.accept(next.id)).status, 400);
    f.room.settings.ownerKey = 'owner-key'; await f.call(f.url + '/revoke', { invitationId: next.id, confirm: true });
    f.mailer.send = async () => { throw new Error('smtp failed'); };
    const queued = await f.call(f.url + '/invite', { email: 'other@example.com', recordings: true });
    assert.equal(queued.status, 200); assert.equal(queued.value.notificationPending, true);
    assert.equal(f.accounts.state.roomManagers.at(-1).revokedAt, 0);
    assert.ok(new AdminAccountStore(f.accounts.filePath).state.managerNotifications.some(item => !item.sentAt));
});

test('owner may provision a manager, never reset another account; no plaintext password in storage or mail', async t => {
    const f = await fixture(t);
    const password = 'initial-test-password-123';
    f.mailer.ready = false;
    const result = await f.call(f.url + '/invite', { method: 'account', email: 'new@example.com', password, recordings: true });
    assert.equal(result.status, 200); assert.equal(result.value.notificationPending, true);
    const login = await f.accounts.passwordLogin({ email: 'new@example.com', password, ip: 'test' });
    assert.equal(login.user.passwordChangeRequired, true);
    assert.equal(f.accounts.roomAccess(login.user.id, f.room).role, 'manager');
    assert.equal(f.accounts.ownsRoom(login.user.id, f.room), false);
    assert.ok(!fs.readFileSync(f.accounts.filePath, 'utf8').includes(password));
    const existing = await f.call(f.url + '/invite', { method: 'account', email: 'other@example.com', password, recordings: true });
    assert.equal(existing.value.error, 'manager_account_exists');
    f.mailer.ready = true;
    const assigned = await f.call(f.url + '/invite', { method: 'account', email: 'other@example.com', recordings: true });
    assert.equal(assigned.status, 200);
    assert.equal(f.accounts.roomAccess(f.users[2].user.id, f.room).role, 'manager');
    assert.equal(f.mails.length, 2);
    assert.ok(f.mails.every(mail => !mail.text.includes(password)));
    assert.equal((await f.call(f.url + '/invite', { method: 'account', email: 'blocked@example.com', password, recordings: true }, 2)).status, 404);
});

test('web host media token cannot bypass revoked account permissions using LiveKit admin grants', async t => {
    const f = await fixture(t); const invite = await f.invite(); await f.accept(invite.id);
    const joined = await f.call(`/meeting/${f.room.roomId}/join`, { displayName: 'Manager' }, 1);
    assert.equal(joined.status, 200);
    const claims = JSON.parse(Buffer.from(joined.value.token.split('.')[1], 'base64url'));
    assert.notEqual(claims.video.roomAdmin, true); assert.notEqual(claims.video.roomRecord, true);
    const response = await fetch(f.base + '/api/broadcast-room/participant-role-token', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-EVD-Participant-Key': joined.value.participantApiKey }, body: JSON.stringify({ roomId: f.room.roomId, identity: joined.value.participantIdentity }) });
    assert.equal(response.status, 200);
    const renewed = await response.json();
    const again = JSON.parse(Buffer.from(renewed.token.split('.')[1], 'base64url'));
    assert.notEqual(again.video.roomAdmin, true);
});
