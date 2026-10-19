const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { ServerRecordings } = require('../src/services/server-recordings');
const { createMeetingRecordingAccess } = require('../src/routes/meeting-recording-access');

async function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-shared-origin-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const room = { roomId: 'room', recordingMeetingId: 'meeting', active: true, participants: [] };
    const rooms = { getRoom: id => id === 'room' ? room : undefined };
    const config = { dataDir: dir, appBaseUrl: 'https://example.com', localeDir: path.resolve(__dirname, '../../../locales') };
    const recordings = new ServerRecordings({ config, roomStore: rooms, client: {}, roomClient: {} });
    fs.mkdirSync(recordings.root);
    const row = { id: 'one', roomId: 'room', meetingId: 'meeting', userId: 'owner', title: 'Meeting', status: 'complete', createdAt: Date.now(), fileName: 'abc-def.mp4' };
    recordings.state.recordings.push(row);
    fs.writeFileSync(path.join(recordings.root, row.fileName), 'mp4-fixture');
    const audioPath = path.join(recordings.root, 'fixture.m4a');
    fs.writeFileSync(audioPath, 'm4a-fixture');
    recordings.audioDownload = async (id, owner, lang, authorize) => {
        assert.equal(id, row.id); assert.equal(owner, row.userId);
        if (!authorize()) throw new Error('recording_not_found');
        return { path: audioPath, name: 'fixture.m4a' };
    };
    const link = recordings.share('room', 'meeting', 'issuer');
    const token = new URL(link.url).hash.slice(1);
    const broadcastRouter = { isTemporaryManager: (id, identity, key) => id === 'room' && identity === 'manager' && key === 'valid' };
    const app = express();
    app.use('/api/meeting-access', createMeetingRecordingAccess({ config, roomStore: rooms, broadcastRouter, recordings }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    async function call(route, body, origin, headers = {}, method = 'POST') {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/meeting-access${route}`, {
            method, headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(origin === undefined ? {} : { Origin: origin }), ...headers },
            ...(method === 'POST' ? { body: new URLSearchParams(body) } : {})
        });
        const raw = await response.text();
        let value; try { value = JSON.parse(raw); } catch { value = raw; }
        return { status: response.status, value, headers: response.headers };
    }
    return { call, token, recordings, link };
}

test('native shared downloads accept missing/null Origin without login for both formats', async t => {
    const f = await fixture(t);
    for (const origin of [undefined, 'null', 'https://example.com', 'https://external.example']) {
        const listed = await f.call('/shared/list', { token: f.token }, origin);
        assert.equal(listed.status, 200); assert.equal(listed.value.recordings.length, 1);
        for (const format of ['mp4', 'm4a']) {
            const result = await f.call('/shared/download', { token: f.token, id: 'one', format }, origin);
            assert.equal(result.status, 200);
            assert.equal(result.value, format + '-fixture');
            assert.equal(result.headers.get('cache-control'), 'no-store');
            assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
        }
    }
});

test('shared routes still reject absent, invalid, expired, revoked and out-of-scope bearer access', async t => {
    const f = await fixture(t);
    for (const origin of [undefined, 'null']) {
        for (const token of ['', 'invalid']) {
            const denied = await f.call('/shared/download', { token, id: 'one' }, origin, { Cookie: '__Host-evd-admin=not-authority' });
            assert.equal(denied.value.error, 'recording_link_invalid');
        }
        assert.equal((await f.call('/shared/download', { token: f.token, id: 'other' }, origin)).value.error, 'recording_not_found');
        assert.equal((await f.call('/shared/download', { token: f.token, id: 'one', format: 'bad' }, origin)).value.error, 'recording_not_found');
        for (const state of ['revoked', 'expired']) {
            const grant = f.recordings.state.downloadGrants[0];
            grant.revoked = state === 'revoked'; grant.expires = state === 'expired' ? Date.now() - 1 : Date.now() + 60000;
            for (const route of ['/shared/list', '/shared/download']) {
                const denied = await f.call(route, { token: f.token, id: 'one', format: 'm4a' }, origin);
                assert.equal(denied.value.error, 'recording_link_invalid');
            }
            grant.revoked = false; grant.expires = Date.now() + 60000;
        }
    }
    assert.equal((await f.call('/shared/list', {}, undefined, {}, 'GET')).status, 403);
});

test('bearer exceptions never bypass moderation Origin or participant authentication', async t => {
    const f = await fixture(t);
    const headers = { 'X-EVD-Participant-Identity': 'manager', 'X-EVD-Participant-Key': 'valid' };
    for (const origin of [undefined, 'null', 'https://external.example']) {
        for (const route of ['/room/recording/list', '/room/recording/link', '/room/all', '/shared/anything']) {
            assert.equal((await f.call(route, { token: f.token }, origin, headers)).status, 403);
        }
    }
    assert.equal((await f.call('/room/recording/list', { token: f.token }, 'https://example.com')).status, 403);
    assert.equal((await f.call('/room/recording/list', {}, 'https://example.com', headers)).status, 200);
});
