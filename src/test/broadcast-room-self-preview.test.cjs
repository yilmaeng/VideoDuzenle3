const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.className = ''; this.classList = { toggle() {} }; }
    appendChild(child) { child.parent = this; this.children.push(child); }
    prepend(child) { child.parent = this; this.children.unshift(child); }
    replaceChildren() { this.children = []; }
    remove() { this.parent.children = this.parent.children.filter((child) => child !== this); }
    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }
    querySelectorAll(selector) {
        const selectors = selector.split(',').map(value => value.trim());
        return this.children.filter(child => selectors.some(value => value === 'video' ? child.tag === 'video'
            : value.startsWith('.') ? child.className.split(' ').includes(value.slice(1))
                : value.includes('data-self-participant') && child.dataset.selfParticipant));
    }
    get lastElementChild() { return this.children.at(-1); }
    setAttribute(key, value) { this[key] = value; }
    play() { return Promise.resolve(); }
    pause() {}
}
const state = { roomConnection: {}, participantIdentity: 'self' };
const els = { remoteMediaList: new Element('div'), remoteVisualStage: new Element('div'),
    cameraEnabled: { checked: false }, displayName: { value: 'Engin' } };
let avatarCount = 0;
const context = vm.createContext({ state, els, document: { createElement: (tag) => new Element(tag) },
    getNativeVideoTrackFromLocalTrack: (track) => track,
    getParticipantAvatarUrl: () => '',
    getParticipantRole: () => 'guest',
    t: (key, fallback, values) => values ? fallback.replace('{name}', values.name) : fallback,
    appendParticipantAvatar: (tile) => { avatarCount++; tile.appendChild(new Element('avatar')); },
    MediaStream: class { constructor(tracks) { this.tracks = tracks; } getVideoTracks() { return this.tracks; } } });
const js = fs.readFileSync(path.join(__dirname, '../broadcast-room-web/frontend/public/join.js'), 'utf8');
vm.runInContext(js.slice(js.indexOf('    function syncSelfParticipantTiles()'), js.indexOf('    async function renderRemoteParticipants()')), context);
context.syncSelfParticipantTiles();
assert.equal(avatarCount, 2);
context.syncSelfParticipantTiles();
assert.equal(avatarCount, 2, 'Unchanged self preview must not rebuild');
state.localVideoTrack = { id: 'camera-1', readyState: 'live' };
els.cameraEnabled.checked = true;
context.syncSelfParticipantTiles();
for (const container of [els.remoteMediaList, els.remoteVisualStage]) {
    const video = container.children[0].querySelector('video');
    assert(video.muted && video.defaultMuted);
    assert.equal(video.srcObject.getVideoTracks()[0], state.localVideoTrack);
}
els.cameraEnabled.checked = false;
context.syncSelfParticipantTiles();
assert.equal(avatarCount, 4);
state.roomConnection = null;
context.syncSelfParticipantTiles();
assert.equal(els.remoteMediaList.children.length, 0);
assert.equal(els.remoteVisualStage.children.length, 0);
console.log('PASS: self first, camera reuse, muted preview, stable avatar, camera off and departure');
