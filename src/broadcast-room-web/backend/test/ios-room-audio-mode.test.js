const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../frontend/public/join.js'), 'utf8');
function fixture(userAgent = 'iPhone', supported = true) {
    const writes = [];
    let type = 'auto';
    const navigator = { userAgent, maxTouchPoints: 1 };
    if (supported) navigator.audioSession = { get type() { return type; }, set type(value) { type = value; writes.push(value); } };
    const context = { navigator, state: { roomConnection: {}, intentionalDisconnect: false } };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('    let pendingMicrophoneCaptures'), source.indexOf('    function loadNotificationSound')), context);
    return { context, writes, get type() { return type; } };
}
test('iOS selects conversation before capture and playback only after the track stops', async () => {
    const f = fixture(), track = { readyState: 'live' };
    f.context.syncIOSRoomAudioMode(); assert.equal(f.type, 'playback');
    await f.context.acquireRoomMicrophone(async () => {
        assert.equal(f.type, 'play-and-record'); return { mediaStreamTrack: track };
    });
    assert.equal(f.type, 'play-and-record');
    track.readyState = 'ended'; f.context.syncIOSRoomAudioMode();
    assert.equal(f.type, 'playback');
    const count = f.writes.length; f.context.syncIOSRoomAudioMode(); assert.equal(f.writes.length, count);
});
test('permission failure restores listening without acquiring a hidden microphone', async () => {
    const f = fixture(); let requests = 0;
    await assert.rejects(f.context.acquireRoomMicrophone(async () => { requests++; throw new Error('denied'); }), /denied/);
    assert.equal(requests, 1); assert.equal(f.type, 'playback');
});
test('overlapping device capture stays in conversation mode until every capture ends', async () => {
    const f = fixture(), first = { readyState: 'live' }, second = { readyState: 'live' };
    await f.context.acquireRoomMicrophone(async () => ({ getAudioTracks: () => [first] }));
    await f.context.acquireRoomMicrophone(async () => ({ mediaStreamTrack: second }));
    first.readyState = 'ended'; f.context.syncIOSRoomAudioMode(); assert.equal(f.type, 'play-and-record');
    second.readyState = 'ended'; f.context.state.intentionalDisconnect = true;
    f.context.syncIOSRoomAudioMode(); assert.equal(f.type, 'play-and-record', 'final cleanup controls auto restoration');
});
test('unsupported platforms keep browser defaults', async () => {
    for (const f of [fixture('Windows'), fixture('iPhone', false)]) {
        await f.context.acquireRoomMicrophone(async () => ({ readyState: 'live' }));
        f.context.syncIOSRoomAudioMode(); assert.deepEqual(f.writes, []);
    }
});
