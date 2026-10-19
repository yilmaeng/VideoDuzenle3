const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../frontend/public/join.js'), 'utf8');
const helpers = source.slice(source.indexOf('    function participantActivityState('), source.indexOf('    async function renderRemoteParticipants('));

test('participant labels reflect publication mute state, not screen sharing or subscription', () => {
    const context = {};
    vm.createContext(context); vm.runInContext(helpers, context);
    const microphone = { source: 'microphone', isMuted: false };
    const camera = { source: 'camera', isMuted: true };
    const participant = { trackPublications: new Map([['mic', microphone], ['camera', camera],
        ['share', { source: 'screen_share', isMuted: false }], ['audio', { source: 'screen_share_audio', isMuted: false }]]) };
    assert.equal(context.participantDeviceState(participant, 'microphone'), true);
    assert.equal(context.participantDeviceState(participant, 'camera'), false);
    microphone.isMuted = true; camera.isMuted = false;
    assert.equal(context.participantDeviceState(participant, 'microphone'), false);
    assert.equal(context.participantDeviceState(participant, 'camera'), true);
    participant.trackPublications.delete('mic');
    assert.equal(context.participantDeviceState(participant, 'microphone'), false);
});

test('self and remote rows update only changed device text without rebuilding media', () => {
    let writes = 0;
    function tile(self) {
        let value = '';
        const status = { get textContent() { return value; }, set textContent(next) { writes++; value = next; } };
        return { dataset: self ? { selfParticipant: 'true' } : { participantIdentity: 'guest' }, querySelector: () => status, querySelectorAll: () => [], status };
    }
    const self = tile(true), guest = tile(false);
    const local = { name: 'Engin', isMicrophoneEnabled: true, isCameraEnabled: false };
    const remote = { name: 'Levent', isMicrophoneEnabled: false, isCameraEnabled: true };
    const context = { els: { remoteMediaList: { children: [self, guest] } },
        state: { roomConnection: { localParticipant: local, remoteParticipants: new Map([['guest', remote]]) } }, t: key => key };
    vm.createContext(context); vm.runInContext(helpers, context);
    context.syncParticipantDeviceLabels(); assert.equal(writes, 2);
    assert.match(self.status.textContent, /^Engin \(broadcast_room_join.you_label\),/);
    assert.match(guest.status.textContent, /^Levent,/);
    assert.match(self.status.textContent, /microphone_on.*camera_off/);
    assert.match(guest.status.textContent, /microphone_off.*camera_on/);
    context.syncParticipantDeviceLabels(); assert.equal(writes, 2);
    remote.isMicrophoneEnabled = true;
    context.syncParticipantDeviceLabels(); assert.equal(writes, 3);
});

test('device labels exist in all locales and mute events refresh stable rows', () => {
    for (const locale of ['tr', 'en', 'de', 'es', 'fr']) {
        const strings = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../locales', locale + '.json'), 'utf8')).broadcast_room_join;
        for (const key of ['participant_microphone_on', 'participant_microphone_off', 'participant_camera_on', 'participant_camera_off', 'participant_speaking', 'participant_hand_raised']) assert.ok(strings[key]);
    }
    assert.match(source, /\['TrackMuted', 'TrackUnmuted', 'LocalTrackPublished', 'LocalTrackUnpublished', 'TrackUnpublished'\]/);
});

test('opening prioritizes speakers then raised hands, moving existing tiles only', () => {
    const tiles = ['other', 'raised', 'self', 'speaker', 'last'].map(identity => ({ dataset: { participantIdentity: identity } }));
    let moves = 0;
    const container = { children: tiles, insertBefore(tile, before) {
        moves++;
        this.children.splice(this.children.indexOf(tile), 1);
        const index = before ? this.children.indexOf(before) : this.children.length;
        this.children.splice(index, 0, tile);
    } };
    const context = { els: { remoteMediaList: container }, state: {
        activeSpeakerIdentities: ['self', 'speaker'], participants: [{ identity: 'raised', handRaiseActive: true }]
    } };
    vm.createContext(context); vm.runInContext(helpers, context);
    context.prioritizeParticipantsOnOpen();
    assert.deepEqual(container.children.map(tile => tile.dataset.participantIdentity), ['self', 'speaker', 'raised', 'other', 'last']);
    const previousMoves = moves;
    context.prioritizeParticipantsOnOpen(); assert.equal(moves, previousMoves);
    assert.ok(container.children.every(tile => tiles.includes(tile)));
});

test('speech and hand labels update without reordering or live announcement', () => {
    let value = '', writes = 0;
    const status = { get textContent() { return value; }, set textContent(text) { value = text; writes++; } };
    const tile = { dataset: { participantIdentity: 'person' }, querySelector: () => status, querySelectorAll: () => [] };
    const state = { participants: [{ identity: 'person', handRaiseActive: true }], activeSpeakerIdentities: ['person'], roomConnection: {} };
    const context = { state, els: { remoteMediaList: { children: [tile] } }, t: key => key };
    vm.createContext(context); vm.runInContext(helpers, context);
    context.syncParticipantDeviceLabels();
    assert.match(value, /participant_speaking.*participant_hand_raised.*participant_microphone_off/);
    context.syncParticipantDeviceLabels(); assert.equal(writes, 1);
    state.activeSpeakerIdentities = []; state.participants[0].handRaiseActive = false;
    context.syncParticipantDeviceLabels();
    assert.doesNotMatch(value, /participant_speaking|participant_hand_raised/);
    assert.equal(writes, 2);
});
