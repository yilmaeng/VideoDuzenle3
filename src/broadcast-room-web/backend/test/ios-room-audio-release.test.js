const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../frontend/public/join.js'), 'utf8');
function load(name, context) {
    const match = new RegExp(`^( *)(?:async )?function ${name}\\(`, 'm').exec(source);
    const end = source.indexOf(`\n${match[1]}}`, match.index) + match[1].length + 2;
    return vm.runInNewContext(`(${source.slice(match.index, end)})`, context);
}
function audioRelease(context) {
    context.pendingRoomAudioClosures = new Set();
    context.roomAudioReleaseGeneration = 0;
    context.closeRoomAudioContext = load('closeRoomAudioContext', context);
    return load('releaseRoomAudioSession', context);
}

test('leaving releases the notification context and returns supported audio sessions to auto', async () => {
    let closed = 0;
    const context = { state: { roomConnection: null, intentionalDisconnect: true },
        mediaToggleToneContext: { close() { closed++; return Promise.resolve(); } }, navigator: { audioSession: { type: 'play-and-record' } } };
    await audioRelease(context)();
    assert.equal(closed, 1); assert.equal(context.mediaToggleToneContext, null);
    assert.equal(context.navigator.audioSession.type, 'auto');
});
test('delayed leave cleanup cannot affect a rejoined room or a replacement context', async () => {
    let closed = 0;
    const old = { close() { closed++; } };
    const context = { state: { roomConnection: {}, intentionalDisconnect: false }, mediaToggleToneContext: old, navigator: {} };
    const release = audioRelease(context);
    await release(old); assert.equal(closed, 0);
    context.state.roomConnection = null; context.state.intentionalDisconnect = true; context.mediaToggleToneContext = {};
    await release(old); assert.equal(closed, 0);
    context.mediaToggleToneContext = old;
    await assert.doesNotReject(() => release(old)); assert.equal(closed, 1);
});

test('audio-session reset waits for all closing contexts and never resets a newly joined room', async () => {
    for (const rejoin of [false, true]) {
        let finish;
        const context = { state: { roomConnection: null, intentionalDisconnect: true }, mediaToggleToneContext: null,
            navigator: { audioSession: { type: 'play-and-record' } } };
        const release = audioRelease(context);
        context.closeRoomAudioContext({ close: () => new Promise(resolve => { finish = resolve; }) });
        const work = release();
        await Promise.resolve();
        assert.equal(context.navigator.audioSession.type, 'play-and-record');
        if (rejoin) { context.state.roomConnection = {}; context.state.intentionalDisconnect = false; }
        finish(); await work;
        assert.equal(context.navigator.audioSession.type, rejoin ? 'play-and-record' : 'auto');
    }
});
test('leave sound releases its context after playback and has a suspended-playback fallback', async () => {
    const timers = []; let released = 0;
    const context = { prepareMediaToggleTone: () => ({}), playNotificationSound: () => Promise.resolve(),
        releaseRoomAudioSession: () => { released++; }, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return 1; }, clearTimeout() {} };
    load('playRoomTone', context)('leave');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(released, 1); assert.equal(timers[0].ms, 5000);
});
test('local capture stops before network leave notification and hidden download frame is gone', () => {
    const disconnect = String(load('disconnectRoom', {}));
    assert.ok(disconnect.indexOf('state.localAudioTrack.stop()') < disconnect.indexOf('notifyLeave()'));
    assert.ok(disconnect.includes('stopMicrophoneTest({ announceStatus: false })'));
    assert.ok(disconnect.includes('await state.roomConnection.disconnect()'));
    const html = fs.readFileSync(path.join(__dirname, '../../frontend/public/recordings.html'), 'utf8');
    assert.ok(!html.includes('<iframe'));
});
