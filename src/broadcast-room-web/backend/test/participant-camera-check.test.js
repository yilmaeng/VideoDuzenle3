const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
const desktop = fs.readFileSync(path.join(root, 'renderer/scripts/broadcast-room.js'), 'utf8');
const web = fs.readFileSync(path.join(root, 'broadcast-room-web/frontend/public/join.js'), 'utf8');

function loadFunction(source, name, context) {
    const match = new RegExp(`^( *)(?:async )?function ${name}\\(`, 'm').exec(source);
    assert.ok(match, name);
    const end = source.indexOf(`\n${match[1]}}`, match.index) + match[1].length + 2;
    return vm.runInNewContext(`(${source.slice(match.index, end)})`, context);
}

for (const platform of ['desktop', 'web']) {
    function fixture() {
        const native = { kind: 'video', readyState: 'live', enabled: true, muted: false };
        const camera = { track: { mediaStreamTrack: native }, publication: {} };
        const share = { share: true, track: { mediaStreamTrack: { ...native } } };
        const participants = ['self', 'guest'].map(id => ({ id, identity: id, cameraEnabled: true }));
        const state = {
            participants, roomState: { hostIdentity: 'self' }, participantIdentity: 'self',
            participantRole: 'host', webHost: true,
            localVideoTrack: camera.track, remoteParticipants: { guest: { videoTracks: [share, camera] } }
        };
        state.liveRoom = { localVideoTrack: camera.track, remoteParticipants: state.remoteParticipants };
        const context = {
            state, isLocalRoomHost: () => state.participantRole === 'host',
            getParticipantById: id => participants.find(item => item.id === id),
            isLiveShareSource: entry => entry.share, isShareTrack: entry => entry.share,
            getNativeVideoTrackFromLocalTrack: track => track?.mediaStreamTrack
        };
        const resolve = loadFunction(platform === 'desktop' ? desktop : web,
            platform === 'desktop' ? 'getParticipantCameraTestTrack' : 'getParticipantCameraFramingTrack', context);
        return { state, resolve, native, camera, participants };
    }
    test(`${platform}: own preview allowed, other participant requires host; screen share excluded`, () => {
        const f = fixture();
        assert.equal(f.resolve('guest'), f.native);
        f.state.participantRole = 'guest';
        assert.equal(f.resolve('guest'), null);
        assert.equal(f.resolve('self'), f.native);
        assert.equal(f.resolve('missing'), null);
    });
    test(`${platform}: disabled, muted, ended or departed camera is unavailable`, () => {
        const f = fixture();
        f.camera.publication.isMuted = true;
        assert.equal(f.resolve('guest'), null);
        f.camera.publication.isMuted = false;
        f.native.readyState = 'ended';
        assert.equal(f.resolve('guest'), null);
        f.native.readyState = 'live';
        f.participants[1].cameraEnabled = false;
        assert.equal(f.resolve('guest'), null);
        f.participants.pop();
        assert.equal(f.resolve('guest'), null);
    });
    if (platform === 'web') test('own live camera is available before the server snapshot catches up', () => {
        const f = fixture();
        f.participants[0].cameraEnabled = false;
        assert.equal(f.resolve('self'), f.native);
        f.participants.shift();
        assert.equal(f.resolve('self'), f.native);
        f.native.enabled = false;
        assert.equal(f.resolve('self'), null);
    });
    test(`${platform}: closing borrowed preview never stops meeting tracks`, async () => {
        let stops = 0;
        const cameraTest = { ownsStream: false, stream: { getTracks: () => [{ stop: () => stops++ }] } };
        const cleanup = loadFunction(platform === 'desktop' ? desktop : web,
            platform === 'desktop' ? 'cleanupHostCameraTestResources' : 'cleanupCameraFramingTest',
            { state: { cameraTest }, els: {}, clearTimeout });
        await cleanup();
        assert.equal(stops, 0);
        cameraTest.ownsStream = true;
        cameraTest.stream = { getTracks: () => [{ stop: () => stops++ }] };
        await cleanup();
        assert.equal(stops, 1);
    });
}

test('participant check strings exist in all active locales', () => {
    for (const locale of ['tr', 'en', 'de', 'es', 'fr']) {
        const strings = JSON.parse(fs.readFileSync(path.join(root, 'locales', `${locale}.json`))).broadcast_room;
        for (const key of ['camera_check_self', 'camera_check_participant', 'camera_check_title', 'camera_check_help', 'camera_check_unavailable']) assert.ok(strings[key], `${locale}: ${key}`);
    }
});
