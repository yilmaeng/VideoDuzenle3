const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../renderer/scripts/broadcast-room.js'), 'utf8');
test('audio diagnostics sample deltas without leaking addresses or recording audio', async () => {
    const timers = [], reports = [], root = {};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/scripts/room-audio-diagnostics.js'), 'utf8'),
        { window: root, setTimeout: fn => timers.push(fn) });
    let packets = 10;
    const track = { mediaStreamTrack: { readyState: 'live' }, getRTCStatsReport: async () =>
        new Map([['a', { id: 'a', type: 'inbound-rtp', kind: 'audio', packetsReceived: packets,
            totalAudioEnergy: 0.1, address: 'private-address' }]]) };
    root.sampleRoomAudioDiagnostics(track, value => reports.push(value));
    await timers[0]();
    packets = 25;
    await timers[1]();
    assert.equal(reports[1].rows[0].packetsReceivedDelta, 15);
    assert.ok(!JSON.stringify(reports).includes('private-address'));
    track.mediaStreamTrack.readyState = 'ended';
    await timers[2]();
    assert.equal(reports.length, 2);
});
function functionSource(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0);
    return source.slice(start, source.indexOf('\n}\n', start) + 2);
}
test('translation and recording keep the original mic while publication uses processed audio', () => {
    const raw = { id: 'raw' }, processed = { id: 'krisp' };
    const state = { liveRoom: { localAudioTrack: { mediaStreamTrack: processed, __evdOriginalMicrophoneTrack: raw }, remoteParticipants: {} } };
    const context = vm.createContext({ state });
    for (const name of ['getUnprocessedRoomMicrophoneTrack', 'getTranslationTrackMediaStreamTracks', 'getLiveInterpreterRecordingTrackEntries', 'getNativeAudioTrackFromLiveKitTrack']) {
        vm.runInContext(functionSource(name), context);
    }
    assert.equal(context.getTranslationTrackMediaStreamTracks()[0], raw);
    assert.equal(context.getLiveInterpreterRecordingTrackEntries()[0].track, raw);
    assert.equal(context.getNativeAudioTrackFromLiveKitTrack(state.liveRoom.localAudioTrack), raw);
    assert.equal(state.liveRoom.localAudioTrack.mediaStreamTrack, processed);
    delete state.liveRoom.localAudioTrack.__evdOriginalMicrophoneTrack;
    assert.equal(context.getUnprocessedRoomMicrophoneTrack(), processed);
    state.liveRoom.localAudioTrack = null;
    assert.equal(context.getUnprocessedRoomMicrophoneTrack(), null);
});
test('both room roles use post-publication preview without OBS or microphone recapture', () => {
    const body = functionSource('syncDesktopKrispPreview');
    assert.ok(!/ipcRenderer|syncObs|syncHostLiveKitMedia|createLocalAudioTrack/.test(body));
    assert.ok(source.includes('await room.localParticipant.publishTrack(state.liveRoom.localAudioTrack);\n                // Do not delay'));
    assert.ok(source.includes('syncDesktopKrispPreview(state.liveRoom.localAudioTrack);'));
    const html = fs.readFileSync(path.join(__dirname, '../renderer/dialogs/broadcast-room.html'), 'utf8');
    assert.match(html, /label for="host-microphone-krisp-preview"/);
    assert.match(html, /id="host-microphone-krisp-preview" type="checkbox" checked aria-describedby=/);
});
