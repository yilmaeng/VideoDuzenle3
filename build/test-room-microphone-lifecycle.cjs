const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/broadcast-room-web/frontend/public/join.js'), 'utf8');
function extract(name) {
    const match = new RegExp(`    (?:async )?function ${name}\\(`).exec(source);
    assert.ok(match, name);
    return source.slice(match.index, source.indexOf('\n    }', match.index) + 6);
}
function fixture() {
    const sent = [], tracks = [];
    const room = { localParticipant: { async publishTrack(track, options) { sent.push({ track, options, enabled: track.mediaStreamTrack.enabled }); } } };
    const state = { roomConnection: room, localAudioTrack: null, intentionalDisconnect: false };
    const els = { microphoneEnabled: { checked: true }, microphoneDevice: { value: 'mic' } };
    const context = { state, els, Promise, window: {}, traceMicrophoneTransition() {}, stopLocalBackupRecording() {}, syncLocalBackupRecordingWithHostState() {},
        syncIOSRoomAudioMode() {}, updateJoinMediaToggleButtons() {}, prepareMediaToggleTone() {}, playMediaToggleTone() {},
        async applyMicrophoneVolumeToTrack() {}, async postParticipantState(value) { context.lastPosted = value; },
        isScreenShareActive: () => false, setStatus() {}, t: () => '',
        buildAudioCaptureOptions: deviceId => ({ deviceId }), acquireRoomMicrophone: work => work(),
        async createLocalMicrophoneTrack() {
            const track = { isMuted: false, mediaStreamTrack: { enabled: true, readyState: 'live' }, stopped: false,
                async mute() { this.isMuted = true; this.mediaStreamTrack.enabled = false; },
                async unmute() { if (!this.isMuted) return; this.isMuted = false; this.mediaStreamTrack.enabled = true; },
                stop() { this.stopped = true; this.mediaStreamTrack.readyState = 'ended'; },
                async restartTrack(options) { this.restarted = options; } };
            tracks.push(track); return track;
        } };
    vm.createContext(context);
    vm.runInContext('let microphoneOperation = Promise.resolve(); let microphoneCaptureSettingsDirty = false;\n' +
        ['queueMicrophoneOperation', 'handleMicrophoneToggleChange', 'applyMicrophoneToggleChange'].map(extract).join('\n'), context);
    return { context, state, els, sent, tracks, toggle: () => context.handleMicrophoneToggleChange() };
}
test('mute/unmute retains one capture and publication, but disables outgoing samples', async () => {
    const f = fixture(); await f.toggle(); const track = f.state.localAudioTrack;
    f.els.microphoneEnabled.checked = false; const muted = f.toggle();
    assert.equal(track.mediaStreamTrack.enabled, false); await muted;
    assert.equal(track.isMuted, true); assert.equal(track.stopped, false);
    f.els.microphoneEnabled.checked = true; await f.toggle();
    assert.equal(track.isMuted, false); assert.equal(f.sent.length, 1); assert.equal(f.tracks.length, 1);
    assert.equal(f.sent[0].options.stopMicTrackOnMute, false);
});
test('rapid off/on does not leave the native track disabled', async () => {
    const f = fixture(); await f.toggle();
    f.els.microphoneEnabled.checked = false; const off = f.toggle();
    f.els.microphoneEnabled.checked = true; const on = f.toggle(); await Promise.all([off, on]);
    assert.equal(f.state.localAudioTrack.mediaStreamTrack.enabled, true);
    assert.equal(f.sent.length, 1);
});
test('mute while capture permission is pending publishes only a muted track', async () => {
    const f = fixture(); const create = f.context.createLocalMicrophoneTrack; let release;
    f.context.createLocalMicrophoneTrack = () => new Promise(resolve => { release = async () => resolve(await create()); });
    const on = f.toggle(); await new Promise(setImmediate);
    f.els.microphoneEnabled.checked = false; const off = f.toggle(); await release(); await Promise.all([on, off]);
    assert.equal(f.sent[0].enabled, false); assert.equal(f.context.lastPosted.microphoneEnabled, false);
});
test('leaving during permission acquisition stops capture without publishing', async () => {
    const f = fixture(); const create = f.context.createLocalMicrophoneTrack; let release;
    f.context.createLocalMicrophoneTrack = () => new Promise(resolve => { release = async () => resolve(await create()); });
    const on = f.toggle(); await new Promise(setImmediate);
    f.state.intentionalDisconnect = true; f.state.roomConnection = null; await release(); await on;
    assert.equal(f.sent.length, 0); assert.equal(f.tracks[0].stopped, true);
});
test('capture failure does not poison the operation queue', async () => {
    const f = fixture(); const create = f.context.createLocalMicrophoneTrack;
    f.context.createLocalMicrophoneTrack = async () => { throw new Error('denied'); };
    await assert.rejects(f.toggle(), /denied/); f.context.createLocalMicrophoneTrack = create;
    await f.toggle(); assert.equal(f.sent.length, 1);
});
test('host permission revoke mutes an existing retained track', async () => {
    const f = fixture(); await f.toggle(); f.state.allowGuestMicrophone = false; await f.toggle();
    assert.equal(f.state.localAudioTrack.isMuted, true); assert.equal(f.els.microphoneEnabled.checked, false);
});
test('settings changed while muted are applied before unmuting', async () => {
    const f = fixture(); await f.toggle(); f.els.microphoneEnabled.checked = false; await f.toggle();
    vm.runInContext('microphoneCaptureSettingsDirty = true;', f.context);
    f.els.microphoneDevice.value = 'new-mic'; f.els.microphoneEnabled.checked = true; await f.toggle();
    assert.equal(f.state.localAudioTrack.restarted.deviceId, 'new-mic');
});
test('backup clones are silenced and a muted microphone cannot start a backup', () => {
    const f = fixture(); const clone = { enabled: true };
    f.state.localBackupRecording = { stream: { getAudioTracks: () => [clone] }, active: false, recorder: null };
    f.context.updateLocalBackupRecordingStatus = () => {};
    vm.runInContext(extract('stopLocalBackupRecording') + '\n' + extract('startLocalBackupRecording'), f.context);
    f.context.stopLocalBackupRecording(); assert.equal(clone.enabled, false);
    f.els.microphoneEnabled.checked = false; f.context.startLocalBackupRecording();
    assert.equal(f.state.localBackupRecording.recorder, null);
});

test('permission revealing a device label does not count as changing the device', () => {
    const f = fixture();
    vm.runInContext(extract('renderDeviceSelect'), f.context);
    const select = { value: 'mic', options: [{ textContent: 'Microphone 1' }], selectedIndex: 0,
        set innerHTML(value) { this.options = [{ textContent: 'iPhone microphone' }]; } };
    const result = f.context.renderDeviceSelect(select, [{ deviceId: 'mic', label: 'iPhone microphone' }], 'Microphone');
    assert.equal(result.changed, false);
});

test('device enumeration resolving the already captured device does not restart it', async () => {
    const f = fixture(); await f.toggle();
    f.state.localAudioTrack.mediaStreamTrack.getSettings = () => ({ deviceId: 'actual-mic' });
    f.context.handleMicrophoneDeviceChange = () => { throw new Error('unexpected restart'); };
    vm.runInContext(extract('announceAndApplyAutomaticDeviceChange'), f.context);
    await f.context.announceAndApplyAutomaticDeviceChange('microphone',
        { changed: true, hasDevices: true, nextValue: 'actual-mic' }, { applyActiveTracks: true });
});

test('leaving releases backup capture and changes call mode before waiting for network cleanup', () => {
    const body = extract('disconnectRoom');
    const stopBackup = body.indexOf('state.localBackupRecording?.stream?.getTracks');
    const stopMicrophone = body.indexOf('state.localAudioTrack.stop()');
    const playback = body.indexOf("setIOSRoomAudioMode('playback')");
    const disconnect = body.indexOf('await state.roomConnection.disconnect()');
    assert.ok(stopBackup >= 0 && stopBackup < playback);
    assert.ok(stopMicrophone >= 0 && stopMicrophone < playback);
    assert.ok(playback < disconnect);
});

test('duplicate activation during first capture cannot toggle the microphone back off', async () => {
    const f = fixture(); const button = f.els.microphoneEnabled;
    button.checked = false; button.setAttribute = () => {}; button.removeAttribute = () => {};
    let focuses = 0; button.focus = () => { focuses++; };
    f.context.document = { activeElement: button, body: {} };
    vm.runInContext('let microphoneUserTogglePending = false;\n' + extract('requestUserMicrophoneToggle'), f.context);
    let release; let calls = 0;
    f.context.handleMicrophoneToggleChange = () => { calls++; return new Promise(resolve => { release = resolve; }); };
    const first = f.context.requestUserMicrophoneToggle();
    f.context.document.activeElement = f.context.document.body;
    await f.context.requestUserMicrophoneToggle();
    assert.equal(button.checked, true); assert.equal(calls, 1);
    release(); await first; assert.equal(focuses, 1);
    const next = f.context.requestUserMicrophoneToggle();
    assert.equal(button.checked, false); release(); await next;
});

test('microphone completion does not steal focus from another control', async () => {
    const f = fixture(); const button = f.els.microphoneEnabled;
    button.setAttribute = () => {}; button.removeAttribute = () => {};
    button.focus = () => { throw new Error('focus stolen'); };
    f.context.document = { activeElement: button, body: {} };
    vm.runInContext('let microphoneUserTogglePending = false;\n' + extract('requestUserMicrophoneToggle'), f.context);
    f.context.handleMicrophoneToggleChange = async () => { f.context.document.activeElement = {}; };
    await f.context.requestUserMicrophoneToggle();
});
