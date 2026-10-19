const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { RoomStore } = require('../broadcast-room-web/backend/src/store/room-store');
const source = fs.readFileSync(path.join(__dirname, '../broadcast-room-web/frontend/public/join.js'), 'utf8');
function extract(start, end) {
    const offset = source.indexOf(start);
    assert(offset >= 0);
    const stop = source.indexOf(end, offset + start.length);
    assert(stop > offset);
    return source.slice(offset, stop);
}
class Element {
    constructor(tag) {
        this.tag = tag; this.children = []; this.dataset = {}; this.style = {};
        this.attributes = {}; this.mutations = 0; this.className = '';
        this.classList = {
            contains: (name) => this.className.split(' ').includes(name),
            add: (name) => this.classList.toggle(name, true),
            toggle: (name, value) => {
                const names = new Set(this.className.split(' ').filter(Boolean));
                if (value) names.add(name); else names.delete(name);
                this.className = [...names].join(' ');
            }
        };
    }
    appendChild(child) { child.remove(); this.children.push(child); child.parent = this; return child; }
    insertBefore(child, next) { child.remove(); const i = this.children.indexOf(next); this.children.splice(i < 0 ? this.children.length : i, 0, child); child.parent = this; }
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
    replaceWith(child) { const p = this.parent; p.insertBefore(child, this); this.remove(); }
    get lastElementChild() { return this.children.at(-1); }
    get nextSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] || null; }
    querySelectorAll(selector) { return this.children.flatMap((child) => [(selector === child.tag || (selector[0] === '.' && child.classList.contains(selector.slice(1)))) ? child : null, ...child.querySelectorAll(selector)]).filter(Boolean); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    setAttribute(name, value) { this.attributes[name] = value; this.mutations++; }
    getAttribute(name) { return this.attributes[name]; }
    set innerHTML(value) { this.html = value; this.mutations++; }
    get innerHTML() { return this.html; }
    addEventListener() {}
    play() { return Promise.resolve(); }
    pause() {}
}
function track(sid, source = 'camera') {
    const attached = new Set();
    return { sid, source, track: { attached, attach: (el) => attached.add(el), detach: (el) => { assert(el, 'Never detach every view'); attached.delete(el); } } };
}
async function run() {
    const state = { participants: [{ identity: 'a' }, { identity: 'b', role: 'sign_interpreter' }], remoteParticipants: {}, remoteAudioMixNodes: {}, activeSpeakerIdentities: [] };
    const els = { remoteMediaList: new Element('list'), remoteVisualStage: new Element('stage'), remoteAudioHost: new Element('host'), chatTarget: new Element('select'), chatPanel: new Element('panel'), btnToggleChatPanel: new Element('button') };
    const context = { state, els, document: { createElement: (tag) => new Element(tag) },
        t: (_key, fallback) => fallback, escapeHtml: (s) => s,
        getChatTargetOptions: () => [{ value: 'all', label: 'All' }],
        getParticipantRole: (id) => state.participants.find((p) => p.identity === id)?.role || 'guest',
        getParticipantAvatarUrl: () => '', getRemoteParticipantLabel: (p) => p.name,
        isShareTrack: (t) => t.source === 'screen', getTrackSourceLabel: (t) => t.source,
        bindRemoteVideoRecovery() {}, syncSelfParticipantTiles() {}, updateFocusedShareView() {},
        appendParticipantAvatar: (tile) => tile.appendChild(new Element('avatar')),
        getRemoteAudioMixKey: (id, sid) => `${id}:${sid}`, getRemoteAudioVolume: () => 1,
        syncRemoteAudioMixNode() {}, applySpeakerSelectionToElement: async () => {}
    };
    vm.createContext(context);
    for (const [start, end] of [
        ['    function getRemoteMediaRenderSignature(', '    function setFocusedAccessibleShareVisibility'],
        ['    function updateRemoteVisualActiveSpeakerState(', '    function clearFeaturedSpeakerTimer'],
        ['    function releaseParticipantTile(', '    function syncSelfParticipantTiles'],
        ['    async function renderRemoteParticipants(', '    function bindRemoteParticipantTrack'],
        ['    function renderChatTargetSelector(', '    function getSelectedChatTarget'],
        ['    function renderChatPanel(', '    function renderHostActivityPanel']
    ]) vm.runInContext(extract(start, end), context);
    const cameraA = track('ca'), cameraB = track('cb'), audioA = track('aa', 'microphone');
    state.remoteParticipants = { a: { identity: 'a', name: 'A', videoTracks: [cameraA], audioTracks: [audioA] }, b: { identity: 'b', name: 'B', videoTracks: [cameraB], audioTracks: [] } };
    await context.renderRemoteParticipants();
    const [a, b] = els.remoteVisualStage.children;
    const audio = els.remoteAudioHost.children[0];
    const listA = els.remoteMediaList.children[0];
    state.remoteParticipants.b.audioTracks.push(track('ab', 'microphone'));
    await context.renderRemoteParticipants();
    assert.equal(els.remoteVisualStage.children[0], a);
    assert.equal(els.remoteVisualStage.children[1], b);
    assert.equal(els.remoteMediaList.children[0], listA);
    assert.equal(els.remoteAudioHost.children[0], audio);
    state.activeSpeakerIdentities = ['a']; state.featuredSpeakerIdentity = 'a';
    context.updateRemoteVisualActiveSpeakerState();
    assert(a.classList.contains('is-speaking'));
    assert(!a.classList.contains('is-active-speaker'), 'Speech must not resize or reorder');
    state.participants[0].spotlighted = true;
    await context.renderRemoteParticipants();
    assert(a.classList.contains('is-active-speaker'));
    assert(b.classList.contains('is-sign-interpreter'));
    state.remoteParticipants.b.videoTracks = [];
    await context.renderRemoteParticipants();
    assert.equal(els.remoteVisualStage.children[0], a, 'Other camera changes preserve A');
    assert.equal(cameraB.track.attached.size, 0, 'Removed camera elements are detached individually');
    state.remoteParticipants.c = { identity: 'c', name: 'C', videoTracks: [], audioTracks: [] };
    await context.renderRemoteParticipants();
    assert.equal(els.remoteVisualStage.children[0], a, 'Newcomers append without rebuilding');
    delete state.remoteParticipants.b;
    await context.renderRemoteParticipants();
    assert.equal(els.remoteVisualStage.children[0], a);
    assert.equal(els.remoteAudioHost.children.length, 1);
    const replacementCamera = track('ca');
    state.remoteParticipants.a.videoTracks = [replacementCamera];
    await context.renderRemoteParticipants();
    assert.equal(cameraA.track.attached.size, 0, 'Resubscribing with the same SID releases old video');
    assert.equal(replacementCamera.track.attached.size, 2);
    assert.equal(els.remoteAudioHost.children[0], audio, 'Camera resubscription does not interrupt audio');
    state.roomConnection = {}; context.renderChatPanel();
    const mutations = els.chatTarget.mutations + els.btnToggleChatPanel.mutations;
    context.renderChatPanel(); context.renderChatPanel();
    assert.equal(els.chatTarget.mutations + els.btnToggleChatPanel.mutations, mutations, 'Unchanged chat controls must not mutate');

    const store = new RoomStore();
    store.pruneStaleParticipants = () => {};
    store.rooms.set('test', { participants: [{ identity: 'a' }, { identity: 'b' }] });
    store.updateParticipantControls('test', 'a', { spotlighted: true });
    store.upsertParticipant('test', { identity: 'a', microphoneEnabled: true });
    assert(store.getRoom('test').participants.find((p) => p.identity === 'a').spotlighted);
    store.upsertParticipant('test', { identity: 'b', spotlighted: true });
    assert(!store.getRoom('test').participants.find((p) => p.identity === 'b').spotlighted, 'Guests cannot self-spotlight');
    assert.equal(store.updateParticipantControls('test', 'missing', { spotlighted: true }), null);
    store.updateParticipantControls('test', 'b', { spotlighted: true });
    assert.equal(store.getRoom('test').participants.filter((p) => p.spotlighted).length, 1);
    store.updateParticipantControls('test', 'b', { spotlighted: false });
    assert.equal(store.getRoom('test').participants.filter((p) => p.spotlighted).length, 0);
    for (const lang of ['tr', 'en', 'de', 'es', 'fr']) {
        const strings = JSON.parse(fs.readFileSync(path.join(__dirname, `../locales/${lang}.json`), 'utf8')).broadcast_room;
        for (const key of ['participant_spotlight', 'participant_unspotlight', 'participant_spotlight_done', 'participant_unspotlight_done']) assert(strings[key]);
    }
    console.log('Stable meeting media, spotlight state and chat mutation tests passed.');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
