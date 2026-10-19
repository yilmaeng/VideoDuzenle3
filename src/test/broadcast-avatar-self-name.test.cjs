const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../broadcast-room-web/frontend/public/join.js'), 'utf8');
function extract(name, next) {
    const start = source.indexOf(`    function ${name}(`);
    const end = source.indexOf(next, start);
    assert(start >= 0 && end > start);
    return source.slice(start, end);
}
for (const [lang, selfLabel] of [['en', 'You'], ['tr', 'Siz'], ['de', 'Sie'], ['es', 'Tú'], ['fr', 'Vous']]) {
    const calls = [];
    const container = () => ({
        tile: { dataset: {}, classList: { toggle() {} }, querySelector: () => null, replaceChildren() {} },
        querySelector() { return this.tile; }
    });
    const context = {
        state: { lang, roomConnection: {}, participantIdentity: 'local' },
        els: { joinedDisplayName: { value: 'Engin Yılmaz' }, cameraEnabled: { checked: false }, remoteMediaList: container(), remoteVisualStage: container() },
        t: () => selfLabel,
        getNativeVideoTrackFromLocalTrack: () => null,
        getParticipantRole: () => 'guest',
        getParticipantAvatarUrl: () => '',
        appendParticipantAvatar: (_tile, options) => calls.push(options)
    };
    vm.createContext(context);
    vm.runInContext(extract('getParticipantInitials', '    function getParticipantAvatarHue') + extract('syncSelfParticipantTiles', '    async function renderRemoteParticipants'), context);
    vm.runInContext('syncSelfParticipantTiles()', context);
    assert.equal(calls.length, 2);
    for (const call of calls) {
        assert.equal(call.name, 'Engin Yılmaz');
        assert.equal(call.displayLabel, `Engin Yılmaz (${selfLabel})`);
        assert.equal(context.getParticipantInitials(call.name), 'EY');
    }
    vm.runInContext('syncSelfParticipantTiles()', context);
    assert.equal(calls.length, 2, 'Unchanged tiles must not be rebuilt');
    const element = () => ({ children: [], style: { setProperty() {} }, setAttribute() {}, appendChild(child) { this.children.push(child); } });
    context.document = { createElement: element };
    vm.runInContext(extract('getParticipantAvatarHue', '    function appendParticipantAvatar') + extract('appendParticipantAvatar', '    function renderLocalAvatarFallback'), context);
    const tile = element();
    context.appendParticipantAvatar(tile, calls[0]);
    assert.equal(tile.children[0].children[0].textContent, 'EY');
    assert.equal(tile.children[0].children[1].textContent, `Engin Yılmaz (${selfLabel})`);
    const remoteTile = element();
    context.appendParticipantAvatar(remoteTile, { identity: 'remote', name: 'Sevda Yılmaz' });
    assert.equal(remoteTile.children[0].children[0].textContent, 'SY');
    assert.equal(remoteTile.children[0].children[1].textContent, 'Sevda Yılmaz');
}
console.log('Self avatar names and initials pass in five locales, both participant views.');
