const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/public/join.js'), 'utf8');

function fixture() {
    const callbacks = [], frames = [], cancelled = new Set();
    const els = { statusLine: { textContent: '' }, liveRegion: { textContent: '' }, focusedLiveRegion: { textContent: '' } };
    const context = { els, state: {}, clearTimeout(id) { cancelled.add(id); },
        window: { setTimeout(fn, delay) { callbacks.push({ fn, delay }); return callbacks.length; } },
        requestAnimationFrame(fn) { frames.push(fn); } };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('    let statusRevision'), source.indexOf('    function setJoinResult')), context);
    return { ...context, callbacks, frames, cancelled, flush() { while (frames.length) frames.shift()(); } };
}

test('media success status expires at six seconds without touching persistent status fields', () => {
    const f = fixture();
    f.els.connectionStatus = { textContent: 'connected' };
    f.els.joinResult = { textContent: 'important hint' };
    f.setTransientStatus('microphone enabled'); f.flush();
    assert.equal(f.callbacks[0].delay, 6000);
    assert.equal(f.els.liveRegion.textContent, 'microphone enabled');
    f.callbacks[0].fn();
    assert.equal(f.els.statusLine.textContent, ''); assert.equal(f.els.liveRegion.textContent, '');
    assert.equal(f.els.focusedLiveRegion.textContent, '');
    assert.equal(f.els.connectionStatus.textContent, 'connected'); assert.equal(f.els.joinResult.textContent, 'important hint');
});

test('same-message repetitions reset expiry; already queued stale callbacks cannot clear new status', () => {
    const f = fixture(); f.setTransientStatus('video disabled'); f.flush();
    f.setTransientStatus('video disabled');
    assert.equal(f.els.liveRegion.textContent, ''); f.flush();
    assert.equal(f.els.liveRegion.textContent, 'video disabled');
    assert.ok(f.cancelled.has(1));
    f.callbacks[0].fn();
    assert.equal(f.els.statusLine.textContent, 'video disabled'); assert.equal(f.state.statusClearTimer, 2);
    f.callbacks[1].fn(); assert.equal(f.els.statusLine.textContent, '');
});

test('errors and persistent hints replace transient messages without being erased even with identical text', () => {
    const f = fixture(); f.setTransientStatus('permission needed');
    f.setStatus('permission needed'); f.flush(); f.callbacks[0].fn();
    assert.equal(f.els.statusLine.textContent, 'permission needed');
    assert.equal(f.els.liveRegion.textContent, 'permission needed');
    assert.equal(f.state.statusClearTimer, null);
    f.setTransientStatus('enabled'); f.setStatus('publish failed'); f.flush(); f.callbacks[1].fn();
    assert.equal(f.els.statusLine.textContent, 'publish failed');
});

test('expiry preserves newer independent announcement and rejects stale animation-frame messages', () => {
    const f = fixture(); f.setTransientStatus('enabled');
    f.announce('participant warning'); f.frames[1](); f.frames[0]();
    assert.equal(f.els.liveRegion.textContent, 'participant warning');
    f.callbacks[0].fn();
    assert.equal(f.els.statusLine.textContent, ''); assert.equal(f.els.liveRegion.textContent, 'participant warning');
    const delayed = fixture(); delayed.setTransientStatus('disabled'); delayed.callbacks[0].fn(); delayed.flush();
    assert.equal(delayed.els.liveRegion.textContent, '');
});

test('both media feedback paths use transient status and click completion preserves newer errors', () => {
    const media = source.slice(source.indexOf('    function announceLocalMediaToggleResult'), source.indexOf('    function setAudioTestStatus'));
    assert.equal((media.match(/setTransientStatus\(t\(key, fallback\)\)/g) || []).length, 2);
    for (const type of ['camera', 'microphone']) assert.ok(source.includes(`if (previousStatusRevision === statusRevision) announceLocalMediaToggleResult('${type}')`));
});
