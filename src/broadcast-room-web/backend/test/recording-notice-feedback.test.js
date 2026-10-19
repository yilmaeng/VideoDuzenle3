const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
    const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/public/join.js'), 'utf8');
    const start = source.indexOf('    let serverRecordingNoticeRoom');
    const end = source.indexOf('    function updateHostActivityFromPayload', start);
    assert.ok(start >= 0 && end > start);
    const messages = [], elements = new Map(), timers = new Map();
    let timerId = 0;
    const make = () => ({ dataset: {}, attributes: {}, hidden: false, value: '',
        get textContent() { return this.value; }, set textContent(value) { this.value = value; if (this.id === 'server-recording-notice' && value) messages.push(value); },
        setAttribute(key, value) { this.attributes[key] = value; }, after(element) { elements.set(element.id, element); }
    });
    const notice = make(); notice.id = 'server-recording-notice'; elements.set(notice.id, notice);
    const context = { state: { room: { roomId: 'one' } }, document: { getElementById: id => elements.get(id), createElement: make },
        t: key => key, setTimeout(fn, delay) { assert.equal(delay, 6000); const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } };
    vm.createContext(context); vm.runInContext(source.slice(start, end), context);
    return { context, notice, messages, elements, timers,
        update(status) { context.updateServerRecordingNotice({ roomId: context.state.room.roomId, settings: { serverRecordingStatus: status } }); },
        expire() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); }
    };
}

test('notices follow confirmed start/pause/resume/stop once and expire without poll resurrection', () => {
    const f = fixture();
    for (const status of ['idle', 'starting', 'unknown']) f.update(status);
    assert.deepEqual(f.messages, []);
    f.update('active'); f.update('active');
    assert.deepEqual(f.messages, ['admin_auth.recording_notice_active']);
    f.expire(); assert.equal(f.notice.textContent, ''); f.update('active'); assert.equal(f.notice.textContent, '');
    assert.equal(f.elements.get('server-recording-indicator').textContent, 'admin_auth.recording_active');
    f.update('pausing'); f.update('unknown');
    assert.equal(f.messages.length, 1);
    f.update('paused'); f.update('paused');
    assert.equal(f.messages.at(-1), 'admin_auth.recording_notice_paused');
    f.expire(); f.update('paused'); assert.equal(f.notice.textContent, '');
    assert.equal(f.elements.get('server-recording-indicator').textContent, 'admin_auth.recording_paused');
    f.update('starting'); f.update('unknown'); assert.equal(f.messages.length, 2);
    f.update('active'); assert.equal(f.messages.at(-1), 'admin_auth.recording_notice_resumed');
    f.update('ending'); f.update('unknown'); assert.equal(f.messages.length, 3);
    f.update('assembling'); f.update('assembling'); f.update('idle'); f.update('complete');
    assert.deepEqual(f.messages, ['admin_auth.recording_notice_active', 'admin_auth.recording_notice_paused', 'admin_auth.recording_notice_resumed', 'admin_auth.recording_notice_stopped']);
    f.expire(); f.update('idle'); assert.equal(f.notice.textContent, '');
    assert.equal(f.elements.get('server-recording-indicator').hidden, true);
});

test('missing or unknown state never ends recording; room changes clear old messages and timers', () => {
    const f = fixture(); f.update('active');
    f.context.updateServerRecordingNotice({ settings: {} }); f.update('unknown'); f.update('failed');
    assert.equal(f.messages.length, 1); assert.equal(f.elements.get('server-recording-indicator').hidden, false);
    f.context.state.room.roomId = 'two'; f.context.updateServerRecordingNotice({ settings: {} });
    assert.equal(f.notice.textContent, ''); assert.equal(f.timers.size, 0); assert.equal(f.elements.get('server-recording-indicator').hidden, true);
    f.update('idle'); assert.equal(f.messages.length, 1);
    f.update('active'); assert.equal(f.messages.at(-1), 'admin_auth.recording_notice_active');
});

test('late joining an active recording warns once across invite, connect and polling', () => {
    const f = fixture();
    f.update('active'); // The invite snapshot can already show the participant warning.
    f.expire();
    f.update('active'); // The connection snapshot shares the same state latch.
    f.update('active');
    assert.deepEqual(f.messages, ['admin_auth.recording_notice_active']);
    assert.equal(f.notice.textContent, '');
    const late = fixture(); late.update('idle'); late.update('active');
    assert.deepEqual(late.messages, ['admin_auth.recording_notice_active']);
    const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/public/join.js'), 'utf8');
    const connect = source.slice(source.indexOf('    async function connectToLiveKit('), source.indexOf('    async function handleCameraToggleChange('));
    assert.match(connect, /state\.roomConnection = room;\s*\/\/[^\n]*\n\s*updateServerRecordingNotice\(payload\)/);
    assert.doesNotMatch(connect, /announce(?:Message)?\(t\('admin_auth\.recording_notice_/);
});

test('paused to assembly announces stopped once, never again on final idle', () => {
    const f = fixture();
    f.update('active'); f.update('paused'); f.update('ending'); f.update('unknown');
    assert.equal(f.messages.filter(text => text.endsWith('_stopped')).length, 0);
    f.update('assembling'); f.expire(); f.update('assembling'); f.update('idle'); f.update('idle');
    assert.equal(f.messages.filter(text => text.endsWith('_stopped')).length, 1);
    assert.equal(f.notice.textContent, '');
});

test('notice locale handoff includes pause and resume in all languages', () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../docs/recording-notice-feedback-locale-additions.json'), 'utf8'));
    for (const language of ['tr', 'en', 'de', 'es', 'fr']) {
        assert.ok(manifest[language].admin_auth.recording_notice_paused);
        assert.ok(manifest[language].admin_auth.recording_notice_resumed);
        const actual = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../locales', language + '.json'), 'utf8')).admin_auth;
        for (const [key, value] of Object.entries(manifest[language].admin_auth)) assert.equal(actual[key], value);
        for (const key of ['recording_share', 'recording_copy_mp4', 'recording_copy_m4a']) assert.ok(actual[key]);
    }
});
