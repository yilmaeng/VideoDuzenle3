'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const express = require('express');
const { ServerRecordings, PENDING } = require('../src/services/server-recordings');
const { RecordingMedia } = require('../src/services/recording-media');
const { RoomStore } = require('../src/store/room-store');
const { createAdminRecordingRouter } = require('../src/routes/admin-recordings');
const { createMeetingRecordingAccess } = require('../src/routes/meeting-recording-access');

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

// Independent fixture: requiring another test file would register its tests again.
function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-lifecycle-'));
    const rooms = new RoomStore();
    const created = rooms.createRoom({ title: 'Lifecycle', hostDisplayName: 'Host', ownerKey: 'owner', inviteBaseUrl: 'https://example.com' });
    const room = rooms.getRoom(created.roomId);
    room.participants = [{ role: 'host', connected: true, identity: 'host' }];
    const config = { dataDir: dir, recordingFilesDir: path.join(dir, 'files'), recordingEgressDir: '/out',
        recordingEnabled: true, recordingMinFreeBytes: 1, recordingMaxMinutes: 180,
        livekitUrl: 'wss://example.com', appBaseUrl: 'https://example.com',
        localeDir: path.resolve(__dirname, '../../../locales') };
    fs.mkdirSync(config.recordingFilesDir);
    let now = Date.now(), starts = 0, stops = 0, loseReply = false;
    const jobs = [], assemblies = [];
    const client = {
        async startRoomCompositeEgress(roomName, output) {
            starts++;
            const job = { egressId: `EG-${starts}`, roomName, status: 1,
                request: { case: 'roomComposite', value: { fileOutputs: [output] } } };
            jobs.push(job);
            if (loseReply) throw new Error('lost_reply');
            return job;
        },
        async listEgress() { return jobs; },
        async stopEgress(id) {
            stops++;
            const job = jobs.find(item => item.egressId === id);
            job.status = 3;
            return job;
        }
    };
    const roomClient = { async listParticipants() { return [{ kind: 0 }]; } };
    const media = { checkDisk() {}, async assemble(names, output) {
        assemblies.push({ names: [...names], output });
        fs.writeFileSync(path.join(config.recordingFilesDir, output), 'assembled');
    } };
    const make = () => new ServerRecordings({ config, roomStore: rooms, client, roomClient, media, now: () => now });
    const service = make();
    t.after(async () => {
        service.close();
        await Promise.allSettled([...service.assembling.values()]);
        fs.rmSync(dir, { recursive: true, force: true });
    });
    return { dir, config, rooms, room, service, client, roomClient, media, jobs, assemblies, make,
        get starts() { return starts; }, get stops() { return stops; },
        loseReply() { loseReply = true; }, advance(ms) { now += ms; },
        write(name, value = 'fixture') { fs.writeFileSync(path.join(service.root, name), value); },
        exists(name) { return fs.existsSync(path.join(service.root, name)); } };
}

async function paused(f, resumed = false) {
    await f.service.start(f.room, 'owner');
    const row = f.service.state.recordings[0];
    f.write(row.fileName);
    await f.service.pause(row.id, 'owner');
    if (resumed) {
        await f.service.resume(row.id, 'owner');
        f.write(row.fileName);
        await f.service.pause(row.id, 'owner');
    }
    assert.equal(row.status, 'paused');
    return row;
}

async function completed(f) {
    const row = await paused(f);
    await f.service.stop(row.id, 'owner');
    return row;
}

async function assembled(service, row) {
    await service.assembling.get(row.id);
    assert.equal(row.status, 'complete');
}

for (const resumed of [false, true]) {
    for (const reason of ['stop', 'empty', 'ended']) test(`paused ${resumed ? 'multiple' : 'single'} segment finalizes on ${reason}`, async t => {
        const f = fixture(t), row = await paused(f, resumed), starts = f.starts, stops = f.stops;
        if (reason === 'stop') await f.service.stop(row.id, 'owner');
        if (reason === 'empty') {
            f.roomClient.listParticipants = async () => [{ kind: 2 }];
            await f.service.refresh('owner'); f.advance(119999);
            await f.service.refresh('owner'); assert.equal(row.status, 'paused');
            f.advance(1); await f.service.refresh('owner');
        }
        if (reason === 'ended') {
            f.room.settings.persistentRoom = true;
            f.rooms.endRoomSessionForEveryone(f.room.roomId);
            await assert.rejects(f.service.resume(row.id, 'owner'), /recording_not_ready/);
            await f.service.refresh('owner');
        }
        await assembled(f.service, row);
        assert.equal(f.starts, starts); assert.equal(f.stops, stops);
        assert.equal(f.assemblies.length, resumed ? 1 : 0);
        assert.equal(f.service.pending(), false);
    });
}

test('ambiguous resume reconciles its own output after restart, not the completed previous egress', async t => {
    const f = fixture(t), row = await paused(f), first = row.fileName;
    f.loseReply();
    await f.service.resume(row.id, 'owner');
    assert.equal(row.status, 'unknown');
    const output = row.fileName;
    const restarted = f.make();
    await assert.rejects(restarted.resume(row.id, 'owner'), /recording_not_ready/);
    await assert.rejects(restarted.start(f.room, 'owner'), /recording_already_running/);
    await restarted.refresh('owner');
    const restored = restarted.state.recordings[0];
    assert.equal(restored.status, 'active'); assert.equal(restored.egressId, 'EG-2');
    assert.equal(restored.fileName, output);
    assert.deepEqual(restored.segments, [{ fileName: first, egressId: 'EG-1' }]);
    assert.equal(f.starts, 2);
});

test('definitive resume rejection does not leave prior recorded content pending forever', async t => {
    const f = fixture(t), row = await paused(f), first = row.fileName;
    f.client.startRoomCompositeEgress = async () => { throw Object.assign(new Error('rejected'), { code: 'permission_denied' }); };
    await f.service.resume(row.id, 'owner');
    await f.service.stop(row.id, 'owner');
    await f.service.refresh('owner');
    await f.service.assembling.get(row.id);
    assert.equal(PENDING.has(row.status), false, 'definitive rejection must not reserve capacity forever');
    assert.equal(f.exists(first), true);
    assert.equal(f.service.public(row).available, true, 'previous recorded segment must remain downloadable');
});

test('concurrent pause and resume requests never create duplicate segments or egress jobs', async t => {
    const f = fixture(t);
    await f.service.start(f.room, 'owner');
    const row = f.service.state.recordings[0]; f.write(row.fileName);
    await Promise.all([f.service.pause(row.id, 'owner'), f.service.pause(row.id, 'owner')]);
    assert.equal(f.stops, 1);
    const results = await Promise.allSettled([f.service.resume(row.id, 'owner'), f.service.resume(row.id, 'owner')]);
    assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected']);
    assert.equal(f.starts, 2); assert.equal(row.segments.length, 1);
});

test('queued resume rechecks authorization before mutating persisted state', async t => {
    const f = fixture(t), row = await paused(f), gate = deferred();
    f.service.serial(() => gate.promise);
    let allowed = true;
    const result = f.service.resume(row.id, 'owner', () => allowed);
    allowed = false; gate.resolve();
    await assert.rejects(result, /recording_not_found/);
    assert.equal(f.starts, 1); assert.equal(row.status, 'paused');
    assert.equal(row.segments, undefined);
    assert.equal(JSON.parse(fs.readFileSync(f.service.file)).recordings[0].status, 'paused');
});

test('assembly restart preserves durable inputs/output and repeated refreshes start one job', async t => {
    const f = fixture(t), row = await paused(f, true);
    // Crash snapshot after assembly publication but before its completion is persisted.
    row.status = 'assembling'; row.pauseRequested = false;
    row.assemblyInputs = [...row.segments.map(segment => segment.fileName), row.fileName];
    row.assemblyFileName = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.mp4';
    f.write(row.assemblyFileName, 'already published'); f.service.save();
    const gate = deferred(); let calls = 0;
    f.media.assemble = async (names, output) => {
        calls++; assert.deepEqual(names, row.assemblyInputs); assert.equal(output, row.assemblyFileName);
        await gate.promise;
    };
    const restarted = f.make(), restored = restarted.state.recordings[0];
    await Promise.all([restarted.refresh('owner'), restarted.refresh('owner')]);
    assert.equal(calls, 1);
    await assert.rejects(restarted.remove(row.id, 'owner'), /recording_delete_running/);
    gate.resolve(); await assembled(restarted, restored);
    const again = f.make(); await again.refresh('owner');
    assert.equal(calls, 1); assert.equal(again.state.recordings[0].fileName, row.assemblyFileName);
    assert.deepEqual(again.state.recordings[0].assemblyInputs, row.assemblyInputs);
});

for (const storageState of ['missing', 'empty']) test(`assembly waits for ${storageState} final segment, then refresh assembles after restart`, async t => {
    const f = fixture(t), row = await paused(f), first = row.fileName;
    await f.service.resume(row.id, 'owner');
    const last = row.fileName;
    if (storageState === 'empty') f.write(last, '');
    await f.service.stop(row.id, 'owner');
    assert.equal(row.status, 'assembling');
    assert.equal(f.assemblies.length, 0);
    assert.equal(f.service.assembling.has(row.id), false);
    assert.equal(f.service.public(row).available, false);
    const waitingAt = row.assemblyWaitingAt, output = row.assemblyFileName;
    assert.equal(waitingAt, f.service.now());
    assert.deepEqual(row.assemblyInputs, [first, last]);
    const persisted = JSON.parse(fs.readFileSync(f.service.file)).recordings[0];
    assert.equal(persisted.assemblyWaitingAt, waitingAt);
    assert.deepEqual(persisted.assemblyInputs, [first, last]);

    f.advance(30000);
    const restarted = f.make(), restored = restarted.state.recordings[0];
    await restarted.refresh('owner');
    assert.equal(restored.status, 'assembling');
    assert.equal(restored.assemblyWaitingAt, waitingAt);
    assert.equal(f.assemblies.length, 0);
    f.write(last, 'storage upload finished');
    await restarted.refresh('owner'); await assembled(restarted, restored);
    await restarted.refresh('owner');
    assert.deepEqual(f.assemblies, [{ names: [first, last], output }]);
    assert.equal(restored.fileName, output);
    assert.equal(restarted.public(restored).available, true);
    assert.equal(f.starts, 2);
    assert.equal(f.make().state.recordings[0].status, 'complete');
});

test('missing assembly input times out at ten minutes without resetting its deadline on refresh or restart', async t => {
    const f = fixture(t), row = await paused(f);
    await f.service.resume(row.id, 'owner');
    const missing = row.fileName;
    await f.service.stop(row.id, 'owner');
    const waitingAt = row.assemblyWaitingAt;
    assert.equal(row.status, 'assembling');
    f.advance(5 * 60000);
    await f.service.refresh('owner');
    assert.equal(row.assemblyWaitingAt, waitingAt);
    const restarted = f.make(), restored = restarted.state.recordings[0];
    f.advance(5 * 60000 - 1);
    await restarted.refresh('owner');
    assert.equal(restored.status, 'assembling');
    assert.equal(restored.assemblyWaitingAt, waitingAt);
    assert.equal(restarted.pending(), true);
    assert.equal(f.assemblies.length, 0);

    f.advance(1); await restarted.refresh('owner');
    assert.equal(restored.status, 'processing_failed');
    assert.equal(restored.checkFailed, true);
    assert.equal(restarted.pending(), false);
    assert.equal(f.room.settings.serverRecordingStatus, 'idle');
    assert.equal(restarted.public(restored).available, false);
    assert.equal(restarted.assembling.has(row.id), false);
    const again = f.make();
    assert.equal(again.state.recordings[0].status, 'processing_failed');
    assert.equal(again.state.recordings[0].assemblyWaitingAt, waitingAt);
    f.write(missing, 'arrived too late');
    await again.refresh('owner');
    assert.equal(f.assemblies.length, 0, 'terminal failure must not silently restart processing');
    assert.equal(again.state.recordings[0].status, 'processing_failed');
});

for (const action of ['delete', 'retention']) test(`${action} removes every segment, assembly input/output and M4A`, async t => {
    const f = fixture(t), row = await paused(f, true);
    await f.service.stop(row.id, 'owner'); await assembled(f.service, row);
    f.write(`${row.id}.m4a`); f.write('keep.txt');
    const names = f.service.fileNames(row);
    assert.ok(names.length >= 4);
    if (action === 'delete') await f.service.remove(row.id, 'owner');
    else { f.advance(7 * 86400000); await f.service.purgeExpired(); }
    for (const name of names) assert.equal(f.exists(name), false, name);
    assert.equal(f.exists('keep.txt'), true);
    assert.equal(f.make().state.recordings[0].status, action === 'delete' ? 'deleted' : 'expired');
});

for (const action of ['delete', 'expiry']) test(`M4A finishing after ${action} is denied and removed`, async t => {
    const f = fixture(t), row = await completed(f), gate = deferred(), entered = deferred();
    const output = path.join(f.service.root, `${row.id}.m4a`);
    f.media.audio = async () => { entered.resolve(); await gate.promise; fs.writeFileSync(output, 'audio'); return output; };
    const download = f.service.audioDownload(row.id, 'owner');
    await entered.promise;
    if (action === 'delete') await f.service.remove(row.id, 'owner');
    else { f.advance(7 * 86400000); await f.service.purgeExpired(); }
    gate.resolve(); await assert.rejects(download, /recording_not_found/);
    assert.equal(fs.existsSync(output), false);
});

function controlledAudio(f) {
    const gate = deferred(), entered = deferred(); let encodes = 0;
    const media = new RecordingMedia({ root: f.service.root, execute: async (command, args) => {
        if (command === 'ffprobe') return JSON.stringify({ streams: [{ codec_type: 'audio', codec_name: 'aac', profile: 'LC', channels: 2, sample_rate: '48000' }] });
        encodes++; entered.resolve(); await gate.promise;
        fs.writeFileSync(args.at(-1), 'audio'); return '';
    } });
    media.checkDisk = () => {};
    f.service.media = media;
    return { gate, entered, get encodes() { return encodes; } };
}

test('concurrent M4A requests share one encode and return the same usable file', async t => {
    const f = fixture(t), row = await completed(f), audio = controlledAudio(f);
    const first = f.service.audioDownload(row.id, 'owner'), second = f.service.audioDownload(row.id, 'owner');
    await audio.entered.promise; audio.gate.resolve();
    const results = await Promise.all([first, second]);
    assert.equal(audio.encodes, 1); assert.equal(results[0].path, results[1].path);
    assert.equal(fs.readFileSync(results[0].path, 'utf8'), 'audio');
});

test('revoking one concurrent downloader must not remove another authorized downloader output', async t => {
    const f = fixture(t), row = await completed(f), audio = controlledAudio(f);
    let allowed = true;
    const revoked = f.service.audioDownload(row.id, 'owner', 'en', () => allowed);
    const authorized = f.service.audioDownload(row.id, 'owner');
    const results = Promise.allSettled([revoked, authorized]);
    await audio.entered.promise; allowed = false; audio.gate.resolve();
    const [denied, accepted] = await results;
    assert.equal(denied.status, 'rejected'); assert.equal(denied.reason.message, 'recording_not_found');
    assert.equal(accepted.status, 'fulfilled'); assert.equal(audio.encodes, 1);
    assert.equal(fs.existsSync(accepted.value.path), true, 'authorized response must not point at a deleted shared output');
});

async function listen(t, app) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    return `http://127.0.0.1:${server.address().port}`;
}

for (const kind of ['admin', 'shared']) test(`${kind} route rechecks M4A authorization after processing`, async t => {
    const f = fixture(t), row = await completed(f), audio = controlledAudio(f);
    let allowed = true;
    const app = express(); let route, options, revoke;
    if (kind === 'admin') {
        app.use((req, _res, next) => { req.account = { id: 'manager' }; next(); });
        app.use(createAdminRecordingRouter({ recordings: f.service, roomStore: f.rooms,
            accounts: { roomAccess: () => allowed ? { recordings: true, role: 'manager' } : null, auditAction() {} } }));
        route = `/${row.id}/download?format=m4a`; revoke = () => { allowed = false; };
    } else {
        const token = f.service.share(row.roomId, row.meetingId, 'owner').url.split('#')[1];
        app.use(createMeetingRecordingAccess({ config: f.config, roomStore: f.rooms, recordings: f.service, broadcastRouter: {} }));
        route = '/shared/download';
        options = { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, id: row.id, format: 'm4a' }) };
        revoke = () => { f.service.state.downloadGrants[0].revoked = true; f.service.save(); };
    }
    const base = await listen(t, app), response = fetch(base + route, options);
    await audio.entered.promise; revoke(); audio.gate.resolve();
    const result = await response;
    assert.equal(result.status, kind === 'admin' ? 404 : 400);
    assert.deepEqual(await result.json(), { error: 'recording_not_found' });
});

test('independent Python retention uses recording age for all segments and M4A, preserving fresh unrelated files', t => {
    const f = fixture(t), now = Date.now(), old = now - 8 * 86400000;
    const row = { id: 'aaaa', createdAt: old, fileName: 'bbbb.mp4', assemblyFileName: 'cccc.mp4',
        assemblyInputs: ['dddd.mp4'], segments: [{ fileName: 'eeee.mp4' }] };
    for (const name of ['aaaa.m4a', 'bbbb.mp4', 'cccc.mp4', 'dddd.mp4', 'eeee.mp4', 'ffff.mp4', 'keep.txt']) f.write(name);
    f.service.state.recordings = [row]; f.service.save();
    const script = path.resolve(__dirname, '../deploy/storage/recording-retention.py');
    // Execute production code with only deployment paths replaced; never touch deployment storage.
    const harness = "import sys; from pathlib import Path; source=Path(sys.argv[1]).read_text(encoding='utf-8'); source=source.replace(\"ROOT = Path('/var/lib/evd-recordings/evd-recordings')\", 'ROOT = Path(' + repr(sys.argv[2]) + ')').replace(\"STORE = Path('/var/www/evd/evd-yayinodasi-server/data/server-recordings.json')\", 'STORE = Path(' + repr(sys.argv[3]) + ')'); exec(compile(source, sys.argv[1], 'exec'))";
    execFileSync('python', ['-c', harness, script, f.service.root, f.service.file], { windowsHide: true });
    for (const name of ['aaaa.m4a', 'bbbb.mp4', 'cccc.mp4', 'dddd.mp4', 'eeee.mp4']) assert.equal(f.exists(name), false, name);
    assert.equal(f.exists('ffff.mp4'), true); assert.equal(f.exists('keep.txt'), true);
});
