const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/public/web-host.js'), 'utf8');
const html = fs.readFileSync(path.resolve(__dirname, '../../frontend/public/join.html'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(role = 'host', clipboardFails = false) {
    const nodes = new Map(), handlers = {}, intervals = [], calls = [], timers = new Map();
    let timerId = 0, responseGate = null, requestError = '';
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
    const node = id => {
        assert.ok(ids.has(id), `UI requested nonexistent node: ${id}`);
        if (!nodes.has(id)) nodes.set(id, { id, hidden: false, disabledValue: false, disabledWrites: [], attributes: {}, attributeWrites: [], checked: false, value: '', content: '', writes: [], dataset: {}, events: {},
            get disabled() { return this.disabledValue; }, set disabled(value) {
                this.disabledValue = value; this.disabledWrites.push(value);
                if (value && document.activeElement === this) document.activeElement = document.body;
            },
            get textContent() { return this.content; }, set textContent(value) { this.content = value; this.writes.push(value); },
            addEventListener(type, fn) { this.events[type] = fn; },
            setAttribute(key, value) { this.attributes[key] = value; this.attributeWrites.push([key, value]); },
            getAttribute(key) { return this.attributes[key] ?? null; },
            querySelectorAll() { return ['temporary-recording-start', 'temporary-recording-pause', 'temporary-recording-list', 'temporary-recording-link', 'meeting-recording-copy-mp4', 'meeting-recording-copy-m4a'].map(node); },
            replaceChildren() {}, focus() { document.activeElement = this; } });
        return nodes.get(id);
    };
    const document = { hidden: false, activeElement: null, body: {}, getElementById: node,
        querySelectorAll: () => [], querySelector: () => null, addEventListener: (type, fn) => { handlers[type] = fn; } };
    const state = { webHost: role === 'host', participantRole: role, roomConnection: {}, room: { roomId: 'room' }, participants: [], participantIdentity: 'self', participantApiKey: 'key' };
    const rows = [], copied = [], clipboardGestures = [];
    let gesture = false;
    const consent = { key: 'meeting-one', confirmed: false };
    const fetch = async (url, options) => {
        calls.push({ url, options });
        const roomId = options.body ? JSON.parse(options.body).roomId : state.room.roomId;
        if (responseGate) await responseGate;
        if (requestError) return { ok: false, json: async () => ({ error: requestError }) };
        if (url.endsWith('/link') || url.endsWith('/meeting-link')) return { ok: true, json: async () => ({ link: { url: 'https://example.com/recordings?lang=en#private', expires: Date.now() + 60000 } }) };
        if (url.endsWith('/start')) { rows.splice(0, rows.length, { id: 'record', roomId, status: 'active', title: 'Room' }); consent.confirmed = true; }
        if (url.endsWith('/stop')) rows[0].status = 'complete';
        if (url.endsWith('/pause')) rows[0].status = 'paused';
        if (url.endsWith('/resume')) rows[0].status = 'active';
        return { ok: true, json: async () => ({ enabled: true, recordings: rows.map(row => ({ ...row })), recordingConsent: { [roomId]: { ...consent } } }) };
    };
    const window = {};
    const navigator = { clipboard: { async writeText(value) { clipboardGestures.push(gesture); if (clipboardFails) throw new Error('denied'); copied.push(value); } } };
    vm.runInNewContext(source, { document, window, fetch, navigator, setInterval: fn => { intervals.push(fn); },
        setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id), URL, console });
    window.EvdWebHost.init({ state: () => state, t: key => key, apply: async () => {} });
    const shortcut = () => handlers.keydown({ altKey: true, ctrlKey: true, code: 'KeyR', preventDefault() {}, stopImmediatePropagation() {} });
    const click = async id => {
        gesture = true;
        let result;
        try { result = node(id).events.click(); } finally { gesture = false; }
        await result; await tick();
    };
    return { node, calls, state, shortcut, document, intervals, consent, copied, clipboardGestures, rows, window, click,
        gate(value) { responseGate = value; },
        fail(value) { requestError = value; },
        async poll() { for (const callback of intervals) callback(); await tick(); },
        expireMessages() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } } };
}

for (const role of ['host', 'co_host']) test(`${role} explicitly creates two format links and copies only on a separate gesture`, async () => {
    const f = fixture(role); await tick();
    f.window.EvdWebHost.render(); await f.poll();
    const linkCalls = () => f.calls.filter(call => /\/(link|meeting-link)$/.test(call.url));
    assert.equal(linkCalls().length, 0, 'render and polling must not mint grants');
    assert.equal(f.node('temporary-recording-link').hidden, false);
    assert.equal(f.node('meeting-recording-links').hidden, true);
    await f.click('temporary-recording-link');
    assert.equal(linkCalls().length, 1);
    const call = linkCalls()[0];
    assert.equal(call.url, role === 'host' ? '/api/admin-auth/recordings/meeting-link' : '/api/meeting-access/room/recording/link');
    assert.equal(call.options.method, 'POST');
    assert.equal(JSON.parse(call.options.body).roomId, 'room');
    if (role === 'co_host') assert.equal(call.options.headers['X-EVD-Participant-Key'], 'key');
    assert.equal(f.node('meeting-recording-links').hidden, false);
    assert.equal(f.copied.length, 0, 'creating links is not a clipboard gesture');
    for (const [format, id] of [['mp4', 'meeting-recording-link'], ['m4a', 'meeting-recording-audio-link']]) {
        const url = new URL(f.node(id).href);
        assert.equal(url.searchParams.get('format'), format);
        assert.equal(url.searchParams.get('lang'), 'en');
        assert.equal(url.hash, '#private');
        assert.equal(url.searchParams.has('token'), false);
        const before = f.calls.length;
        await f.click('meeting-recording-copy-' + format);
        assert.equal(f.calls.length, before);
        assert.equal(f.copied.at(-1), url.href);
        assert.equal(f.clipboardGestures.at(-1), true);
    }
    const before = f.calls.length;
    await f.click('temporary-recording-link');
    assert.equal(f.calls.length, before, 'reopening existing links should reuse the grant');
    assert.equal(f.copied.length, 2);
});
for (const format of ['mp4', 'm4a']) test(`${format} clipboard denial focuses the corresponding accessible link`, async () => {
    const f = fixture('co_host', true); await tick();
    await f.click('temporary-recording-link');
    await f.click('meeting-recording-copy-' + format);
    assert.equal(f.document.activeElement.id, format === 'mp4' ? 'meeting-recording-link' : 'meeting-recording-audio-link');
    assert.equal(f.node('meeting-recording-links').hidden, false);
    assert.equal(f.node('temporary-recording-message').textContent, 'admin_auth.recording_link_copy_failed');
    assert.equal(f.clipboardGestures[0], true);
});

test('account host confirms once per meeting; next meeting requires confirmation again', async () => {
    const f = fixture();
    await tick();
    assert.equal(f.node('temporary-recording-panel').hidden, false);
    await f.shortcut();
    assert.equal(f.document.activeElement.id, 'temporary-recording-consent');
    assert.equal(f.calls.filter(call => call.url.endsWith('/start')).length, 0);
    f.node('temporary-recording-consent').checked = true;
    await f.shortcut();
    assert.ok(f.calls.some(call => call.url === '/api/admin-auth/recordings/start'));
    assert.equal(f.node('temporary-recording-consent').checked, true);
    await f.shortcut();
    assert.ok(f.calls.some(call => call.url === '/api/admin-auth/recordings/record/stop'));
    assert.equal(f.node('temporary-recording-start').textContent, 'admin_auth.recording_start');
    assert.equal(f.node('temporary-recording-pause').getAttribute('aria-disabled'), 'true');
    await f.shortcut();
    assert.equal(f.calls.filter(call => call.url.endsWith('/start')).length, 2);
    await f.shortcut();
    f.consent.key = 'meeting-two'; f.consent.confirmed = false;
    await f.shortcut();
    assert.equal(f.calls.filter(call => call.url.endsWith('/start')).length, 2);
    assert.equal(f.node('temporary-recording-consent').checked, false);
    assert.equal(f.document.activeElement.id, 'temporary-recording-consent');
});

test('join markup exposes two persistent recording toggles, not separate stop/resume controls', () => {
    for (const id of ['temporary-recording-start', 'temporary-recording-pause', 'temporary-recording-link', 'meeting-recording-copy-mp4', 'meeting-recording-copy-m4a']) {
        assert.match(html, new RegExp(`<button[^>]*id="${id}"[^>]*data-i18n="admin_auth\\.[^"]+"`));
        assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1);
    }
    assert.doesNotMatch(html, /id="temporary-recording-(stop|resume)"/);
    for (const id of ['temporary-recording-start', 'temporary-recording-pause']) {
        const tag = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))[0];
        assert.doesNotMatch(tag, /\b(role|aria-pressed|disabled)=/);
    }
    for (const id of ['meeting-recording-link', 'meeting-recording-audio-link']) {
        assert.match(html, new RegExp(`<a[^>]*id="${id}"[^>]*target="_blank"[^>]*rel="noopener noreferrer"`));
    }
});

for (const role of ['host', 'co_host']) test(`${role} reuses focused start/stop and pause/resume nodes across transitions`, async () => {
    const f = fixture(role); await tick();
    const toggle = f.node('temporary-recording-start'), pause = f.node('temporary-recording-pause');
    assert.equal(toggle.textContent, 'admin_auth.recording_start');
    assert.equal(pause.getAttribute('aria-disabled'), 'true');
    f.node('temporary-recording-consent').checked = true;
    toggle.focus(); await f.click(toggle.id);
    assert.equal(toggle.textContent, 'admin_auth.recording_stop');
    assert.equal(f.document.activeElement, toggle);
    assert.equal(pause.disabled, false);
    assert.equal(pause.getAttribute('aria-disabled'), 'false');
    pause.focus(); await f.click(pause.id);
    assert.equal(pause.textContent, 'admin_auth.recording_resume');
    assert.equal(pause.disabled, false);
    assert.equal(toggle.disabled, false, 'paused recording can still be stopped');
    assert.equal(f.document.activeElement, pause);
    await f.click(pause.id);
    assert.equal(pause.textContent, 'admin_auth.recording_pause');
    assert.equal(f.document.activeElement, pause);
    for (const action of ['pause', 'resume']) {
        const call = f.calls.find(item => item.url.endsWith('/' + action));
        assert.equal(call.url, role === 'host' ? `/api/admin-auth/recordings/record/${action}` : `/api/meeting-access/room/recording/${action}`);
        assert.equal(JSON.parse(call.options.body).id, 'record');
    }
    await f.click(pause.id);
    toggle.focus(); await f.click(toggle.id);
    assert.equal(toggle.textContent, 'admin_auth.recording_start');
    assert.equal(pause.getAttribute('aria-disabled'), 'true');
    assert.equal(f.document.activeElement, toggle);
    assert.equal(f.node(toggle.id), toggle); assert.equal(f.node(pause.id), pause);
    assert.equal(f.calls.filter(call => call.url.endsWith('/start')).length, 1);
    assert.equal(f.calls.filter(call => call.url.endsWith('/stop')).length, 1);
});

test('pending states disable only invalid toggle actions and never repeat history in a live region', async () => {
    const f = fixture(); await tick();
    const toggle = f.node('temporary-recording-start'), pause = f.node('temporary-recording-pause');
    const message = f.node('temporary-recording-message'), initialWrites = message.writes.length;
    f.rows.push({ id: 'old', roomId: 'room', title: 'Old private history', status: 'complete' },
        { id: 'record', roomId: 'room', title: 'Current recording', status: 'active' });
    for (const status of ['starting', 'active', 'pausing', 'paused', 'unknown', 'ending', 'assembling', 'processing_failed', 'complete']) {
        f.rows[1].status = status;
        await f.poll(); await f.poll();
        const pending = !['processing_failed', 'complete'].includes(status);
        assert.equal(toggle.textContent, 'admin_auth.recording_' + (pending ? 'stop' : 'start'), status);
        assert.equal(toggle.disabled, false, status);
        assert.equal(toggle.getAttribute('aria-disabled'), String(['ending', 'assembling'].includes(status)), status);
        assert.equal(pause.textContent, 'admin_auth.recording_' + (status === 'paused' ? 'resume' : 'pause'), status);
        assert.equal(pause.disabled, false, status);
        assert.equal(pause.getAttribute('aria-disabled'), String(!['active', 'paused'].includes(status)), status);
        assert.equal(message.writes.length, initialWrites, 'poll must not announce history or duplicate the room notice');
        if (['ending', 'assembling'].includes(status)) {
            const count = f.calls.length;
            await f.click(toggle.id); await f.click(pause.id);
            assert.equal(f.calls.length, count);
        }
    }
});

test('busy toggle suppresses duplicate requests and restores controls after completion', async () => {
    const f = fixture(); await tick();
    f.node('temporary-recording-consent').checked = true;
    let release;
    f.gate(new Promise(resolve => { release = resolve; }));
    const toggle = f.node('temporary-recording-start'); toggle.focus();
    const first = f.node('temporary-recording-start').events.click();
    assert.equal(toggle.disabled, false);
    assert.equal(f.node('temporary-recording-pause').disabled, false);
    assert.equal(toggle.getAttribute('aria-disabled'), 'true');
    assert.equal(f.node('temporary-recording-pause').getAttribute('aria-disabled'), 'true');
    assert.equal(f.document.activeElement, toggle);
    await f.node('temporary-recording-start').events.click();
    await f.node('temporary-recording-pause').events.click();
    assert.equal(f.calls.filter(call => call.url.endsWith('/start')).length, 1);
    f.gate(null); release(); await first;
    assert.equal(f.node('temporary-recording-start').disabled, false);
    assert.equal(f.node('temporary-recording-pause').disabled, false);
    assert.equal(toggle.getAttribute('aria-disabled'), 'false');
    assert.equal(f.node('temporary-recording-pause').getAttribute('aria-disabled'), 'false');
    assert.equal(f.document.activeElement, toggle);
});

for (const action of ['start', 'pause']) for (const failed of [false, true]) for (const moved of [false, true]) {
    test(`${action} ${failed ? 'failure' : 'success'} ${moved ? 'does not steal moved focus' : 'retains originating focus'}`, async () => {
        const f = fixture(); await tick();
        f.node('temporary-recording-consent').checked = true;
        if (action === 'pause') {
            f.rows.push({ id: 'record', roomId: 'room', status: 'active' }); await f.poll();
        }
        let release;
        f.gate(new Promise(resolve => { release = resolve; }));
        if (failed) f.fail('recording_not_ready');
        const button = f.node('temporary-recording-' + action); button.focus();
        const work = button.events.click();
        assert.equal(button.disabled, false);
        assert.equal(button.getAttribute('aria-disabled'), 'true');
        assert.equal(f.document.activeElement, button);
        const count = f.calls.length;
        await button.events.click();
        assert.equal(f.calls.length, count, 'ARIA-disabled native click must be guarded');
        const destination = moved ? f.node('temporary-recording-consent') : button;
        if (moved) destination.focus();
        f.gate(null); release(); await work;
        assert.equal(f.document.activeElement, destination);
        assert.equal(button.disabledWrites.includes(true), false);
        assert.equal(button.getAttribute('aria-disabled'), 'false');
        assert.equal(f.node(button.id), button);
        if (failed) assert.equal(f.node('temporary-recording-message').textContent, 'admin_auth.recording_not_ready');
    });
}

test('first touch activation establishes recording focus instead of retaining old microphone focus', async () => {
    const f = fixture(); await tick();
    const oldFocus = {}; f.document.activeElement = oldFocus;
    f.node('temporary-recording-consent').checked = true;
    await f.click('temporary-recording-start');
    assert.equal(f.document.activeElement, f.node('temporary-recording-start'));
    assert.equal(f.node('temporary-recording-start').textContent, 'admin_auth.recording_stop');
});

test('unchanged rendering does not rewrite recording button text or ARIA state', async () => {
    const f = fixture(); await tick();
    const controls = ['temporary-recording-start', 'temporary-recording-pause'].map(f.node);
    const counts = controls.map(control => [control.writes.length, control.attributeWrites.length]);
    for (let i = 0; i < 3; i++) { f.window.EvdWebHost.render(); await f.poll(); }
    controls.forEach((control, index) => {
        assert.deepEqual([control.writes.length, control.attributeWrites.length], counts[index]);
        assert.equal(control.disabledWrites.includes(true), false);
        assert.equal(control.getAttribute('role'), null);
        assert.equal(control.getAttribute('aria-pressed'), null);
    });
    const count = f.calls.length;
    await f.node('temporary-recording-pause').events.click();
    assert.equal(f.calls.length, count, 'idle pause remains focusable but cannot activate');
});

for (const role of ['host', 'co_host']) test(`${role} background poll preserves focus and never disables usable recording controls`, async () => {
    const f = fixture(role); await tick();
    f.rows.push({ id: 'record', roomId: 'room', status: 'active' });
    await f.poll();
    const controls = ['temporary-recording-start', 'temporary-recording-pause', 'temporary-recording-link'].map(f.node);
    for (const focused of controls) {
        let release;
        f.gate(new Promise(resolve => { release = resolve; }));
        for (const control of controls) control.disabledWrites.length = 0;
        focused.focus();
        await f.poll();
        f.window.EvdWebHost.render();
        assert.equal(f.document.activeElement, focused);
        for (const control of controls) {
            assert.equal(control.disabled, false);
            assert.equal(control.disabledWrites.includes(true), false, control.id);
        }
        f.gate(null); release(); await tick();
        assert.equal(f.document.activeElement, focused);
        for (const control of controls) assert.equal(control.disabledWrites.includes(true), false, control.id);
    }
});

for (const role of ['host', 'co_host']) test(`${role} pause click during a list poll waits and executes once after refresh`, async () => {
    const f = fixture(role); await tick();
    f.rows.push({ id: 'record', roomId: 'room', status: 'active' }); await f.poll();
    let release;
    f.gate(new Promise(resolve => { release = resolve; }));
    await f.poll();
    const pause = f.node('temporary-recording-pause'); pause.focus();
    const count = f.calls.length;
    const action = pause.events.click();
    await tick();
    assert.equal(f.calls.length, count, 'mutation must await outstanding list');
    assert.equal(pause.disabled, false);
    assert.equal(f.document.activeElement, pause);
    f.gate(null); release(); await action;
    assert.equal(f.calls.filter(call => call.url.endsWith('/pause')).length, 1);
    assert.equal(pause.textContent, 'admin_auth.recording_resume');
    assert.equal(pause.disabled, false);
    assert.equal(f.document.activeElement, pause);
});

for (const gesture of ['button', 'shortcut']) test(`${gesture} queued during a poll cannot mutate a different room`, async () => {
    const f = fixture(); await tick();
    f.node('temporary-recording-consent').checked = true;
    let release;
    f.gate(new Promise(resolve => { release = resolve; }));
    await f.poll();
    const action = gesture === 'button' ? f.node('temporary-recording-start').events.click() : f.shortcut();
    await tick();
    f.state.room = { roomId: 'other-room' };
    f.window.EvdWebHost.render();
    f.gate(null); release(); await action; await tick();
    assert.equal(f.calls.some(call => /\/(start|stop|pause|resume)$/.test(call.url)), false,
        'an old-room gesture must be discarded, not applied to the newly joined room');
    assert.equal(f.node('temporary-recording-start').textContent, 'admin_auth.recording_start');
});

test('meeting transition invalidates generated links without auto-creating replacements', async () => {
    const f = fixture('co_host'); await tick(); await f.click('temporary-recording-link');
    f.consent.key = 'next-meeting'; f.consent.confirmed = false;
    await f.poll();
    assert.equal(f.node('meeting-recording-links').hidden, true);
    const count = f.calls.length;
    await f.click('meeting-recording-copy-mp4'); await f.click('meeting-recording-copy-m4a');
    assert.equal(f.copied.length, 0); assert.equal(f.calls.length, count);
    assert.equal(f.calls.filter(call => call.url.endsWith('/link')).length, 1);
    await f.click('temporary-recording-link');
    assert.equal(f.calls.filter(call => call.url.endsWith('/link')).length, 2);
});

test('explicit copy feedback expires and polling does not restore old announcements', async () => {
    const f = fixture(); await tick();
    await f.click('temporary-recording-link'); await f.click('meeting-recording-copy-mp4');
    assert.equal(f.node('temporary-recording-message').textContent, 'admin_auth.recording_link_copied');
    f.expireMessages();
    assert.equal(f.node('temporary-recording-message').textContent, '');
    const count = f.node('temporary-recording-message').writes.length;
    await f.poll();
    assert.equal(f.node('temporary-recording-message').writes.length, count);
});

test('guest shortcut cannot trigger any recording request', async () => {
    const f = fixture('guest'); await f.shortcut();
    assert.equal(f.node('web-host-toggle').hidden, true);
    assert.equal(f.node('web-host-panel').hidden, true);
    assert.equal(f.node('temporary-recording-panel').hidden, true);
    assert.equal(f.calls.length, 0);
});

test('new labels and filename templates are translated in all active locales', () => {
    for (const lang of ['tr','en','de','es','fr']) {
        const strings = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../locales', lang + '.json'), 'utf8')).admin_auth;
        for (const key of ['recording_delete','recording_delete_confirmation','recording_delete_running','recording_deleted','recording_consent_meeting_hint','recording_notice_active','manager_method','manager_password_hint','manager_account_email_body','manager_assignment_hint','recording_start_shortcut','recording_stop_shortcut','recording_filename']) assert.ok(strings[key], `${lang}.${key}`);
    }
});
