const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../frontend/public/join.js'), 'utf8');
function load(name, context, code = source) {
    const match = new RegExp(`^( *)(?:async )?function ${name}\\(`, 'm').exec(code);
    assert.ok(match);
    const end = code.indexOf(`\n${match[1]}}`, match.index) + match[1].length + 2;
    return vm.runInNewContext(`(${code.slice(match.index, end)})`, context);
}

test('microphone capture disables implicit isolation but preserves every processing preference', () => {
    for (let bits = 0; bits < 8; bits++) {
        const state = { microphoneEchoCancellation: !!(bits & 1), microphoneNoiseSuppression: !!(bits & 2), microphoneAutoGainControl: !!(bits & 4) };
        const build = load('buildAudioCaptureOptions', { state, document: { getElementById: () => null }, getMicrophoneVolume: () => 0.8 });
        const options = build('device');
        assert.equal(options.voiceIsolation, false);
        assert.equal(options.echoCancellation, state.microphoneEchoCancellation);
        assert.equal(options.noiseSuppression, state.microphoneNoiseSuppression);
        assert.equal(options.autoGainControl, state.microphoneAutoGainControl);
        assert.equal(options.deviceId, 'device');
        assert.equal(options.volume, 0.8);
    }
});

test('unavailable device fallback also disables isolation without changing user preferences', async () => {
    const state = { microphoneEchoCancellation: true, microphoneNoiseSuppression: false, microphoneAutoGainControl: false };
    const calls = [];
    const context = { state, document: { getElementById: () => null }, getMicrophoneVolume: () => 1, window: { LivekitClient: {
        async createLocalAudioTrack(options) { calls.push(options); if (calls.length === 1) throw new Error('old device'); return 'track'; }
    } } };
    context.buildAudioCaptureOptions = load('buildAudioCaptureOptions', context);
    context.window.captureWithSystemEcho = (capture, options) => capture(options);
    context.acquireRoomMicrophone = acquire => acquire();
    assert.equal(await load('createLocalMicrophoneTrack', context)('old-device'), 'track');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].voiceIsolation, false);
    assert.equal(calls[1].echoCancellation, true);
    assert.equal(calls[1].noiseSuppression, false);
    assert.equal(calls[1].autoGainControl, false);
    assert.equal(calls[1].deviceId, undefined);
});

test('music mode overrides processing without modifying saved preferences', () => {
    const state = { microphoneEchoCancellation: true, microphoneNoiseSuppression: true, microphoneAutoGainControl: true };
    const control = { checked: true };
    const build = load('buildAudioCaptureOptions', { state, document: { getElementById: () => control }, getMicrophoneVolume: () => 1 });
    const options = build();
    for (const key of ['echoCancellation', 'noiseSuppression', 'autoGainControl', 'voiceIsolation']) assert.equal(options[key], false);
    assert.equal(state.microphoneEchoCancellation, true);
    control.checked = false;
    assert.equal(build().echoCancellation, true);
});

test('desktop music mode has the same processing override and restores preferences', () => {
    const code = fs.readFileSync(path.join(__dirname, '../../../renderer/scripts/broadcast-room.js'), 'utf8');
    const state = { audioDevices: { microphoneEchoCancellation: true, microphoneNoiseSuppression: true, microphoneAutoGainControl: true } };
    const control = { checked: true };
    const build = load('buildHostAudioCaptureOptions', { state, process: { env: {} }, document: { getElementById: () => control }, getHostMicrophoneVolume: () => 1 }, code);
    for (const key of ['echoCancellation', 'noiseSuppression', 'autoGainControl', 'voiceIsolation']) assert.equal(build()[key], false);
    control.checked = false;
    assert.equal(build().echoCancellation, true);
});

test('device changes arriving during enumeration are not lost', async () => {
    const state = {}; let release, calls = 0;
    const first = new Promise(resolve => { release = resolve; });
    const handler = load('handleDeviceListChanged', { state, refreshDevices: async () => { calls++; if (calls === 1) await first; } });
    const running = handler();
    await handler(); release(); await running;
    assert.equal(calls, 2);
    assert.equal(state.deviceRefreshInProgress, false);
});

test('music mode and clipboard guidance exist in every locale', () => {
    for (const lang of ['tr','en','de','es','fr']) {
        const locale = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../locales', lang + '.json'), 'utf8'));
        assert.ok(locale.broadcast_room.microphone_music_mode);
        assert.ok(locale.broadcast_room.microphone_music_hint);
        assert.ok(locale.admin_auth.recording_link_copied);
        assert.ok(locale.admin_auth.recording_link_copy_failed);
    }
});
