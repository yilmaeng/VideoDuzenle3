const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { ServerRecordings } = require('../src/services/server-recordings');
const { RoomStore } = require('../src/store/room-store');
const { AdminAccountStore } = require('../src/services/admin-account-store');
const { createAdminAuthRouter } = require('../src/routes/admin-auth');

function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-recording-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const rooms = new RoomStore();
    const created = rooms.createRoom({ title: 'Test', hostDisplayName: 'Host', ownerKey: 'owner', inviteBaseUrl: 'https://example.com/yayinodasi' });
    const room = rooms.getRoom(created.roomId);
    room.participants = [{ role: 'host', connected: true, identity: 'host-test' }];
    const config = { dataDir: dir, recordingFilesDir: path.join(dir, 'files'), recordingEgressDir: '/out/recordings',
        recordingEnabled: true, recordingMinFreeBytes: 1, recordingMaxMinutes: 180,
        livekitUrl: 'wss://example.com', appBaseUrl: 'https://example.com', broadcastRoomBasePath: '/yayinodasi',
        localeDir: path.resolve(__dirname, '../../../locales') };
    let now = 1000000, starts = 0, stops = 0, lastOutput, job = null, loseReply = false, offline = false;
    const client = {
        async startRoomCompositeEgress(roomName, output, options) {
            starts++; lastOutput = output; assert.equal(options.layout, 'grid');
            job = { egressId: 'EG-test', roomName, status: 0, request: { case: 'roomComposite', value: { fileOutputs: [output] } } };
            if (loseReply) throw new Error('network contains secrets');
            return job;
        },
        async listEgress() { if (offline) throw new Error('offline'); return job ? [job] : []; },
        async stopEgress() { stops++; job.status = 2; return job; }
    };
    const roomClient = { async listParticipants() { return [{ kind: 0 }]; } };
    const signals = [];
    const service = new ServerRecordings({ config, roomStore: rooms, client, roomClient, now: () => now,
        onRoomChanged: changed => signals.push(changed.settings.serverRecordingStatus) });
    t.after(() => service.close());
    return { config, rooms, room, service, client, roomClient, signals,
        get starts() { return starts; }, get stops() { return stops; }, get job() { return job; }, get output() { return lastOutput; },
        loseReply() { loseReply = true; }, offline() { offline = true; }, advance(ms) { now += ms; } };
}

test('pause/resume retains one recording and assembles only recorded segments', async t => {
    const f = fixture(t), result = await f.service.start(f.room, 'user'), row = f.service.state.recordings[0];
    f.job.status = 1; await f.service.refresh('user');
    const first = row.fileName;
    fs.writeFileSync(path.join(f.service.root, first), 'first');
    let assembled;
    f.service.media = { checkDisk() {}, async assemble(names, output) { assembled = names; fs.writeFileSync(path.join(f.service.root, output), 'joined'); } };
    await f.service.pause(result.id, 'user');
    assert.equal(row.status, 'pausing');
    await f.service.pause(result.id, 'user'); assert.equal(f.stops, 1);
    f.job.status = 3; await f.service.refresh('user'); assert.equal(row.status, 'paused');
    f.advance(60000); await f.service.resume(result.id, 'user');
    assert.equal(f.starts, 2); assert.equal(f.service.state.recordings.length, 1);
    assert.notEqual(row.fileName, first);
    const second = row.fileName; fs.writeFileSync(path.join(f.service.root, second), 'second');
    f.job.status = 1; await f.service.refresh('user');
    await f.service.stop(result.id, 'user');
    f.job.status = 3; await f.service.refresh('user');
    await f.service.assembling.get(row.id);
    assert.equal(row.status, 'complete'); assert.deepEqual(assembled, [first, second]);
    assert.equal(f.service.download(row.id, 'user').path, path.join(f.service.root, row.assemblyFileName));
    await f.service.remove(row.id, 'user');
    for (const name of [first, second, row.assemblyFileName]) assert.equal(fs.existsSync(path.join(f.service.root, name)), false);
});

test('stopping a paused single segment does not start another Egress', async t => {
    const f = fixture(t), result = await f.service.start(f.room, 'user'), row = f.service.state.recordings[0];
    f.job.status = 1; await f.service.refresh('user'); await f.service.pause(result.id, 'user');
    f.job.status = 3; await f.service.refresh('user');
    await assert.rejects(f.service.resume(result.id, 'user', () => false), /recording_not_found/);
    await f.service.stop(result.id, 'user'); assert.equal(row.status, 'complete'); assert.equal(f.starts, 1);
});

test('audio extraction rechecks permissions without deleting shared output after revocation', async t => {
    const f = fixture(t), result = await f.service.start(f.room, 'user'), row = f.service.state.recordings[0];
    f.job.status = 3; await f.service.refresh('user'); fs.writeFileSync(path.join(f.service.root, row.fileName), 'video');
    let allowed = true;
    const output = path.join(f.service.root, `${row.id}.m4a`);
    f.service.media = { async audio() { fs.writeFileSync(output, 'audio'); allowed = false; return output; } };
    await assert.rejects(f.service.audioDownload(result.id, 'user', 'tr', () => allowed), /recording_not_found/);
    assert.equal(fs.existsSync(output), true);
});
test('empty media room stops after two minutes, ignoring recorder and stale application participants', async t => {
    const f = fixture(t);
    await f.service.start(f.room, 'user');
    f.roomClient.listParticipants = async () => [{ kind: 2 }];
    await f.service.refresh('user');
    f.advance(119999); await f.service.refresh('user'); assert.equal(f.stops, 0);
    f.advance(1); await f.service.refresh('user'); assert.equal(f.stops, 1);
    assert.equal(f.service.state.recordings[0].stopReason, 'empty_room');
    await f.service.refresh('user'); assert.equal(f.stops, 1);
});

test('returning participants reset the empty-room grace period', async t => {
    const f = fixture(t); await f.service.start(f.room, 'user');
    f.roomClient.listParticipants = async () => [];
    await f.service.refresh('user'); f.advance(110000);
    f.roomClient.listParticipants = async () => [{ kind: 0 }];
    await f.service.refresh('user');
    f.roomClient.listParticipants = async () => [];
    f.advance(10000); await f.service.refresh('user'); assert.equal(f.stops, 0);
    f.advance(120000); await f.service.refresh('user'); assert.equal(f.stops, 1);
});

test('background monitor checks empty rooms without a browser or list refresh', async t => {
    const f = fixture(t); await f.service.start(f.room, 'user');
    f.roomClient.listParticipants = async () => [];
    f.service.startMonitor(); await f.service.queue;
    await new Promise(resolve => setImmediate(resolve));
    f.service.close(); f.advance(120000);
    f.service.startMonitor(); await f.service.queue;
    assert.equal(f.stops, 1);
});

test('monitor checks transitions promptly without increasing steady-state polling', async t => {
    const f = fixture(t); await f.service.start(f.room, 'user');
    let tick, period, checks = 0;
    const originalInterval = global.setInterval;
    t.mock.method(global, 'setInterval', (callback, milliseconds) => {
        tick = callback; period = milliseconds;
        return originalInterval(callback, 3600000);
    });
    const originalReconcile = f.service.reconcile.bind(f.service);
    f.service.reconcile = async row => { checks++; return originalReconcile(row); };
    f.service.startMonitor(); await f.service.queue;
    assert.equal(period, 2000); assert.equal(checks, 1);
    await new Promise(resolve => setImmediate(resolve));
    f.advance(2000); f.job.status = 1; tick(); await f.service.queue;
    assert.equal(checks, 2); assert.equal(f.service.state.recordings[0].status, 'active');
    await new Promise(resolve => setImmediate(resolve));
    f.advance(2000); tick(); await f.service.queue; assert.equal(checks, 2);
    await new Promise(resolve => setImmediate(resolve));
    f.advance(8000); tick(); await f.service.queue; assert.equal(checks, 3);
    f.service.close();
});

test('presence outage is not treated as empty; missing room is empty and failed stops retry', async t => {
    const f = fixture(t); await f.service.start(f.room, 'user');
    f.roomClient.listParticipants = async () => [];
    await f.service.refresh('user'); f.advance(120000);
    f.roomClient.listParticipants = async () => { throw new Error('unavailable'); };
    await f.service.refresh('user'); assert.equal(f.stops, 0);
    f.roomClient.listParticipants = async () => { throw Object.assign(new Error('missing'), { code: 'not_found' }); };
    await f.service.refresh('user'); assert.equal(f.stops, 0);
    const stop = f.client.stopEgress;
    f.client.stopEgress = async () => { throw new Error('unavailable'); };
    f.advance(120000); await f.service.refresh('user');
    assert.equal(f.service.state.recordings[0].stopRequested, true);
    f.client.stopEgress = stop;
    await f.service.refresh('user'); assert.equal(f.stops, 1);
});

test('meeting acknowledgements are scoped to actor and reset at session end', async t => {
    const f = fixture(t);
    f.service.meetingId(f.room);
    assert.equal(f.service.consent(f.room, 'account:one', true).confirmed, true);
    assert.equal(f.service.consent(f.room, 'account:two').confirmed, false);
    assert.equal(f.service.consent(f.room, 'participant:one').confirmed, false);
    f.rooms.endRoomSessionForEveryone(f.room.roomId);
    assert.equal(f.service.consent(f.room, 'account:one').confirmed, false);
});

test('recording removal deletes only terminal file and immediately blocks shared downloads', async t => {
    const f = fixture(t); const row = await f.service.start(f.room, 'user');
    await assert.rejects(f.service.remove(row.id, 'user'), /recording_delete_running/);
    f.job.status = 3; await f.service.refresh('user');
    const filename = path.join(f.service.root, f.service.state.recordings[0].fileName);
    fs.writeFileSync(filename, 'fixture');
    const link = f.service.share(f.room.roomId, f.room.recordingMeetingId, 'user');
    await assert.rejects(f.service.remove(row.id, 'user', () => false), /recording_not_found/);
    assert.equal(fs.existsSync(filename), true);
    await f.service.remove(row.id, 'user');
    assert.equal(fs.existsSync(filename), false);
    assert.equal(f.service.shared(link.url.split('#')[1]).rows.length, 0);
    assert.equal(f.service.list('user').length, 0);
    assert.equal(f.service.state.recordings[0].status, 'deleted');
    assert.throws(() => f.service.download(row.id, 'user'), /recording_not_ready/);
    assert.equal((await f.service.remove(row.id, 'user')).status, 'deleted');
});

test('disabled feature does not issue any Egress request', async t => {
    const f = fixture(t); f.service.ready = false;
    await assert.rejects(f.service.start(f.room, 'user'), /recording_unavailable/);
    assert.equal(f.starts, 0);
});

test('Cloud S3 output keeps credentials out of persisted/public rows and maps a private local file', async t => {
    const f = fixture(t);
    const s3 = { endpoint: 'https://storage.example.com', bucket: 'recordings', region: 'us-east-1', accessKey: 'access-test', secret: 'secret-test' };
    const service = new ServerRecordings({ config: { ...f.config, recordingEgressDir: '', recordingS3: s3 }, roomStore: f.rooms, client: f.client });
    assert.equal(service.ready, true);
    const row = await service.start(f.room, 'user');
    assert.equal(f.output.output.case, 's3');
    assert.equal(f.output.output.value.forcePathStyle, true);
    assert.equal(f.output.filepath, `${row.id}.mp4`);
    assert.ok(!fs.readFileSync(service.file, 'utf8').includes('secret-test'));
    assert.ok(!JSON.stringify(row).includes('access-test'));
});

test('download name uses localized start date, room title and Istanbul time with safe Windows characters', async t => {
    const f = fixture(t);
    f.room.title = 'Engelsiz Erişimli Saatler';
    const row = await f.service.start(f.room, 'user');
    const stored = f.service.state.recordings[0];
    const start = Date.parse('2026-10-11T06:17:00Z');
    f.advance(start - stored.createdAt); stored.createdAt = start;
    f.job.status = 3; await f.service.refresh('user');
    fs.writeFileSync(path.join(f.service.root, stored.fileName), 'fixture');
    assert.equal(f.service.download(row.id, 'user').name, '11 Ekim 2026 Engelsiz Erişimli Saatler Saat 09.17.mp4');
    assert.ok(f.service.download(row.id, 'user', 'en').name.includes('October'));
    stored.title = '../unsafe: room?';
    assert.ok(!/[<>:"/\\|?*]/.test(f.service.download(row.id, 'user').name));
    assert.equal(f.service.download(row.id, 'user').path, path.join(f.service.root, stored.fileName));
});

test('seven-day deadline blocks download and deletes the actual recording without removing other files', async t => {
    const f = fixture(t);
    const row = await f.service.start(f.room, 'user');
    f.job.status = 3; await f.service.refresh('user');
    const filename = path.join(f.service.root, `${row.id}.mp4`);
    fs.writeFileSync(filename, 'fixture');
    fs.writeFileSync(path.join(f.service.root, 'keep.txt'), 'unrelated');
    const link = f.service.share(f.room.roomId, f.service.state.recordings[0].meetingId, 'user');
    f.advance(7 * 86400000);
    assert.equal(f.service.list('user')[0].available, false);
    assert.throws(() => f.service.download(row.id, 'user'), /recording_not_ready/);
    assert.throws(() => f.service.shared(link.url.split('#')[1]), /recording_link_invalid/);
    await f.service.purgeExpired();
    assert.equal(fs.existsSync(filename), false);
    assert.equal(fs.existsSync(path.join(f.service.root, 'keep.txt')), true);
    assert.equal(f.service.list('user')[0].status, 'expired');
});
test('serial start, explicit lifecycle, safe paths, completion and private download', async t => {
    const f = fixture(t);
    const results = await Promise.allSettled([f.service.start(f.room, 'user'), f.service.start(f.room, 'user')]);
    assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected'); assert.equal(f.starts, 1);
    const row = results[0].value;
    assert.equal(row.status, 'starting'); assert.equal(row.available, false);
    assert.ok(f.output.filepath.startsWith('/out/recordings/')); assert.ok(f.output.disableManifest);
    assert.equal(f.room.settings.hostRecordingActive, false);
    f.job.status = 1; await f.service.refresh('user'); await f.service.refresh('user');
    assert.deepEqual(f.signals, ['starting', 'active']);
    const stopped = await f.service.stop(row.id, 'user'); assert.equal(stopped.status, 'ending'); assert.equal(f.stops, 1);
    assert.throws(() => f.service.download(row.id, 'other'), /recording_not_found/);
    assert.throws(() => f.service.download(row.id, 'user'), /recording_not_ready/);
    f.job.status = 3; await f.service.refresh('user');
    assert.equal(f.service.list('user')[0].available, false);
    const filename = f.service.state.recordings[0].fileName;
    fs.writeFileSync(path.join(f.config.recordingFilesDir, filename), 'test fixture, not media');
    assert.equal(f.service.list('user')[0].available, true);
    assert.ok(f.service.download(row.id, 'user').path.endsWith(filename));
    assert.deepEqual(f.service.list('other'), []);
    assert.ok(!JSON.stringify(f.service.list('user')).includes('/out/'));
    assert.equal(f.room.settings.serverRecordingStatus, 'idle');
    f.service.state.recordings[0].fileName = '../outside.mp4';
    assert.throws(() => f.service.download(row.id, 'user'), /recording_not_ready/);
});
test('lost start reply is reconciled after restart without starting a second recorder', async t => {
    const f = fixture(t); f.loseReply();
    const row = await f.service.start(f.room, 'user'); assert.equal(row.status, 'unknown');
    const restarted = new ServerRecordings({ config: f.config, roomStore: f.rooms, client: f.client, roomClient: f.roomClient, now: f.service.now });
    await assert.rejects(restarted.start(f.room, 'user'), /recording_already_running/);
    f.job.status = 1; await restarted.refresh('user');
    assert.equal(restarted.list('user')[0].status, 'active'); assert.equal(f.starts, 1);
});
test('outage retains pending state and blocks duplicate work', async t => {
    const f = fixture(t); await f.service.start(f.room, 'user'); f.offline();
    await f.service.refresh('user');
    assert.ok(f.service.list('user')[0].checkFailed); assert.ok(f.service.pending());
    await assert.rejects(f.service.start(f.room, 'user'), /recording_already_running/);
});
test('maximum duration and ended rooms request stop; failures are not downloadable', async t => {
    const f = fixture(t); await f.service.start(f.room, 'user'); f.job.status = 1;
    f.advance(181 * 60000); await f.service.refresh('user'); assert.equal(f.stops, 1);
    f.job.status = 4; await f.service.refresh('user');
    assert.equal(f.service.list('user')[0].status, 'failed'); assert.equal(f.service.pending(), false);
    const next = await f.service.start(f.room, 'user'); f.job.status = 1; f.room.active = false;
    await f.service.refresh('user'); assert.equal(f.stops, 2); assert.equal(f.service.list('user').find(row => row.id === next.id).status, 'ending');
});
test('recording directory cannot be the public frontend directory', t => {
    const f = fixture(t);
    assert.throws(() => new ServerRecordings({ config: { ...f.config, frontendPublicDir: f.config.recordingFilesDir }, roomStore: f.rooms, client: f.client }), /recording_public_directory_forbidden/);
});
test('HTTP recording routes require session, ownership, origin and informed-start confirmation', async t => {
    const f = fixture(t);
    const accounts = new AdminAccountStore(path.join(f.config.dataDir, 'accounts.json'));
    const users = ['one','two'].map(name => accounts.verify({ ...accounts.request(`${name}@example.com`, name), ip: name }));
    accounts.bindRoom(users[0].user.id, f.room);
    const app = express();
    app.use('/auth', createAdminAuthRouter({ config: f.config, store: accounts, roomStore: f.rooms, recordings: f.service, mailer: { ready: false } }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const call = (route, body, who = 0, origin = 'https://example.com') => fetch(`http://127.0.0.1:${server.address().port}/auth/recordings${route}`, {
        method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json', ...(who === null ? {} : { Cookie: `__Host-evd-admin=${users[who].session}` }) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await call('', null, null)).status, 401);
    assert.equal((await call('/start', { roomId: f.room.roomId, confirm: true }, 1)).status, 404);
    assert.equal((await call('/start', { roomId: f.room.roomId })).status, 400);
    assert.equal((await call('/start', { roomId: f.room.roomId, confirm: true }, 0, 'https://evil.example')).status, 403);
    const row = (await (await call('/start', { roomId: f.room.roomId, confirm: true })).json()).recording;
    assert.equal((await call(`/${row.id}/download`, null, 1)).status, 404);
    assert.equal((await call(`/${row.id}/stop`, {}, 1)).status, 404);
    assert.equal((await (await call('', null, 1)).json()).recordings.length, 0);
    f.job.status = 3; await f.service.refresh(users[0].user.id);
    fs.writeFileSync(path.join(f.config.recordingFilesDir, f.service.state.recordings[0].fileName), 'fixture');
    const response = await call(`/${row.id}/download`);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(response.headers.get('content-disposition').includes('attachment'));
    assert.equal(await response.text(), 'fixture');
    const preview = await call(`/${row.id}/download?view=1`);
    assert.equal(preview.status, 200);
    assert.ok(preview.headers.get('content-disposition').startsWith('inline;'));
    assert.equal(preview.headers.get('content-type'), 'video/mp4');
    assert.equal(preview.headers.get('cache-control'), 'no-store');
    assert.equal((await call(`/${row.id}/download?view=1`, null, 1)).status, 404);
    const range = await fetch(`http://127.0.0.1:${server.address().port}/auth/recordings/${row.id}/download?view=1`, {
        headers: { Cookie: `__Host-evd-admin=${users[0].session}`, Range: 'bytes=0-2' }
    });
    assert.equal(range.status, 206); assert.equal(await range.text(), 'fix');
    assert.equal((await call(`/${row.id}/delete`, { confirm: true }, 1)).status, 404);
    assert.equal((await call(`/${row.id}/delete`, {})).status, 409);
    assert.equal((await call(`/${row.id}/delete`, { confirm: true }, 0, 'https://evil.example')).status, 403);
    assert.equal((await call(`/${row.id}/delete`, { confirm: true })).status, 200);
    assert.equal((await (await call('')).json()).recordings.length, 0);
    assert.equal((await call(`/${row.id}/download`)).status, 409);
    assert.equal((await call('/start', { roomId: f.room.roomId })).status, 200);
    f.job.status = 3; await f.service.refresh(users[0].user.id);
    f.rooms.endRoomSessionForEveryone(f.room.roomId);
    assert.equal((await call('/start', { roomId: f.room.roomId })).status, 400);
});
