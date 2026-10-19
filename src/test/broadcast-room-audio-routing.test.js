const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const web = fs.readFileSync(path.join(root, 'broadcast-room-web/frontend/public/join.js'), 'utf8');
const host = fs.readFileSync(path.join(root, 'renderer/scripts/broadcast-room.js'), 'utf8');
function extract(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const end = source.indexOf('\n    }', start);
    return source.slice(start, end + 6);
}

const state = { remoteAudioMixNodes: {} };
let volume = 1;
let translating = false;
const context = vm.createContext({
    state,
    getRemoteAudioMixKey: () => 'guest:audio',
    getRemoteAudioVolume: () => volume,
    shouldPlayTranslationAudio: () => translating,
    getNativeAudioTrackFromRemoteTrack: () => ({ kind: 'audio' }),
    MediaStream: class {},
    ensureRemoteAudioContext: () => ({
        destination: {},
        createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
        createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} })
    })
});
vm.runInContext(extract(web, 'syncRemoteAudioMixNode'), context);
const audio = {};
context.syncRemoteAudioMixNode({ sid: 'audio' }, 'guest', audio);
assert.equal(audio.muted, false);
assert.equal(audio.volume, 1);
assert.equal(Object.keys(state.remoteAudioMixNodes).length, 0);

// Translation must duck the original once, without a second native playback.
translating = true;
volume = 0.08;
context.syncRemoteAudioMixNode({ sid: 'audio' }, 'guest', audio);
assert.equal(audio.muted, true);
assert.equal(audio.volume, 0);
assert.equal(state.remoteAudioMixNodes['guest:audio'].gain.gain.value, 0.08);

translating = false;
volume = 1;
context.syncRemoteAudioMixNode({ sid: 'audio' }, 'guest', audio);
assert.equal(audio.muted, false);
assert.equal(audio.volume, 1);
assert.equal(Object.keys(state.remoteAudioMixNodes).length, 0);

volume = 1.6;
context.syncRemoteAudioMixNode({ sid: 'audio' }, 'guest', audio);
assert.equal(audio.muted, true);
assert.equal(state.remoteAudioMixNodes['guest:audio'].gain.gain.value, 1.6);

// Defaults do not override a user's explicit stored opt-out.
for (const source of [web, host]) {
    assert.match(source, /microphoneEchoCancellation: loadStoredBoolean\(MICROPHONE_ECHO_CANCELLATION_STORAGE_KEY, true\)/);
}
let stored = null;
const preferences = vm.createContext({ window: { localStorage: { getItem: () => stored } } });
vm.runInContext(extract(web, 'loadStoredBoolean'), preferences);
assert.equal(preferences.loadStoredBoolean('echo', true), true);
stored = 'false';
assert.equal(preferences.loadStoredBoolean('echo', true), false);
console.log('Broadcast audio routing and echo defaults: passed');
