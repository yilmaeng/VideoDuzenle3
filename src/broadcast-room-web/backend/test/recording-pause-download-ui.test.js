const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = name => fs.readFileSync(path.resolve(__dirname, '../../frontend/public', name), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function dom() {
    const nodes = new Map(), handlers = {}, intervals = [], timers = new Map();
    let timerId = 0;
    const document = { documentElement: { lang: 'en' }, body: {}, hidden: false,
        querySelectorAll: () => [], querySelector: () => null,
        addEventListener: (type, fn) => { handlers[type] = fn; } };
    function make(tag) {
        return { tag, children: [], dataset: {}, attributes: {}, events: {}, value: '', checked: false, disabled: false, writes: 0,
            get textContent() { return this.content || ''; }, set textContent(value) { this.content = value; this.writes++; },
            append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; if (items[0]?.value) this.value = items[0].value; },
            setAttribute(k, v) { this.attributes[k] = v; }, getAttribute(k) { return this.attributes[k]; },
            removeAttribute(k) { delete this.attributes[k]; }, addEventListener(k, v) { this.events[k] = v; },
            focus() { document.activeElement = this; },
            querySelectorAll() { return ['start','pause','list','link'].map(a => node('temporary-recording-' + a))
                .concat(['mp4', 'm4a'].map(format => node('meeting-recording-copy-' + format))); }
        };
    }
    const node = id => {
        assert.ok(!['temporary-recording-stop', 'temporary-recording-resume'].includes(id), `Removed control requested: ${id}`);
        if (!nodes.has(id)) nodes.set(id, make()); return nodes.get(id);
    };
    document.getElementById = node; document.createElement = make;
    return { node, document, handlers, intervals, window: {}, setInterval: fn => { intervals.push(fn); return 1; }, clearInterval() {},
        setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) };
}

test('admin appends accessible pause/resume/M4A controls and preserves pending state', async () => {
    const f = dom(), calls = [];
    const row = { id: 'one', roomId: 'room', title: 'Meeting', status: 'active', available: true, createdAt: 1, expiresAt: 10000, canDelete: true };
    let resumeError = '';
    vm.runInNewContext(source('admin-recordings.js'), f);
    const context = { t: key => key, async request(route, body) {
        calls.push({ route, body });
        if (route.endsWith('/resume') && resumeError) throw new Error(resumeError);
        if (route.endsWith('/pause')) row.status = 'paused';
        if (route.endsWith('/resume')) row.status = 'active';
        return { enabled: true, recordings: [{ ...row }] };
    } };
    await f.window.EvdAdminRecordings.start(context);
    f.window.EvdAdminRecordings.setRooms([{ roomId: 'room', title: 'Meeting' }]);
    const children = f.node('recording-list').children[0].children;
    assert.equal(children.length, 12);
    assert.equal(children[8].getAttribute('href').endsWith('&view=1'), true);
    assert.equal(children[11].getAttribute('href').endsWith('&format=m4a'), true);
    assert.match(children[11].getAttribute('aria-label'), /Meeting/);
    assert.equal(children[11].getAttribute('target'), '_blank');
    await children[9].events.click();
    assert.ok(calls.some(c => c.route === '/recordings/one/pause'));
    assert.equal(children[9].disabled, true); assert.equal(children[10].disabled, false);
    for (const error of ['recording_not_ready', 'recording_processing_failed']) {
        resumeError = error; await children[10].events.click();
        assert.equal(f.node('recording-message').textContent, error);
        assert.equal(children[10].disabled, false);
    }
    resumeError = '';
    await children[10].events.click();
    assert.ok(calls.some(c => c.route === '/recordings/one/resume'));
    for (const status of ['starting','active','pausing','paused','assembling','ending','unknown','processing_failed']) {
        row.status = status; await f.window.EvdAdminRecordings.start(context);
        assert.equal(f.node('recording-start').disabled, status !== 'processing_failed', status);
        assert.equal(children[7].disabled, status !== 'processing_failed', status);
        assert.equal(children[2].disabled, ['assembling','ending'].includes(status), status);
    }
    const writes = f.node('recording-message').writes;
    await f.intervals.at(-1)(); await f.intervals.at(-1)();
    assert.equal(f.node('recording-message').writes, writes);
});

for (const role of ['host', 'co_host']) test(`${role} pause/resume routes and paused shortcut preserve logical recording`, async () => {
    const f = dom(), calls = [];
    const state = { webHost: role === 'host', participantRole: role, roomConnection: {}, room: { roomId: 'room' }, participantIdentity: 'self', participantApiKey: 'secret', participants: [] };
    const row = { id: 'one', roomId: 'room', title: 'Meeting', status: 'active' };
    let resumeError = '';
    const fetch = async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/resume') && resumeError) return { ok: false, json: async () => ({ error: resumeError }) };
        if (url.endsWith('/pause')) row.status = 'paused';
        if (url.endsWith('/resume')) row.status = 'active';
        if (url.endsWith('/stop')) row.status = 'complete';
        if (role === 'host' && /\/(pause|resume|stop)$/.test(url)) return { ok: true, json: async () => ({ recording: { ...row } }) };
        return { ok: true, json: async () => ({ recordings: [{ ...row }], recordingConsent: { room: { key: 'same', confirmed: true } } }) };
    };
    vm.runInNewContext(source('web-host.js'), { ...f, fetch, navigator: {} });
    f.window.EvdWebHost.init({ state: () => state, t: key => key, apply: async () => {} });
    await tick(); await f.node('temporary-recording-list').events.click();
    const click = action => f.node('temporary-recording-' + action).events.click();
    const toggle = f.node('temporary-recording-start'), pause = f.node('temporary-recording-pause');
    assert.equal(toggle.textContent, 'admin_auth.recording_stop');
    assert.equal(pause.textContent, 'admin_auth.recording_pause');
    pause.focus();
    await click('pause');
    assert.equal(pause.disabled, false);
    assert.equal(pause.textContent, 'admin_auth.recording_resume');
    assert.equal(f.document.activeElement, pause);
    for (const error of ['recording_not_ready', 'recording_processing_failed', 'recording_not_found', 'recording_room_empty', 'unexpected_server_error']) {
        resumeError = error;
        await click('pause');
        assert.equal(f.node('temporary-recording-message').textContent, 'admin_auth.' + (error === 'unexpected_server_error' ? 'request_failed' : error));
        assert.equal(row.status, 'paused');
        assert.equal(pause.disabled, false);
        assert.equal(pause.textContent, 'admin_auth.recording_resume');
        assert.equal(toggle.disabled, false);
        assert.equal(toggle.textContent, 'admin_auth.recording_stop');
        assert.equal(f.document.activeElement, pause);
    }
    resumeError = '';
    await click('pause');
    assert.equal(row.status, 'active');
    assert.equal(pause.textContent, 'admin_auth.recording_pause');
    assert.equal(f.node('temporary-recording-pause'), pause);
    for (const action of ['pause','resume']) {
        const call = calls.find(c => c.url.endsWith('/' + action));
        assert.equal(call.url, role === 'host' ? `/api/admin-auth/recordings/one/${action}` : `/api/meeting-access/room/recording/${action}`);
        assert.equal(call.options.method, 'POST');
        assert.equal(JSON.parse(call.options.body).id, 'one');
        if (role === 'co_host') assert.equal(call.options.headers['X-EVD-Participant-Key'], 'secret');
    }
    await click('pause');
    await f.handlers.keydown({ altKey: true, ctrlKey: true, code: 'KeyR', preventDefault() {}, stopImmediatePropagation() {} });
    assert.ok(calls.some(c => c.url.endsWith('/stop')));
    assert.equal(calls.some(c => c.url.endsWith('/start')), false);
    assert.equal(toggle.textContent, 'admin_auth.recording_start');
    assert.equal(pause.disabled, false);
    assert.equal(pause.getAttribute('aria-disabled'), 'true');
    for (const status of ['assembling','ending']) {
        row.status = status; await click('list');
        const count = calls.length; await click('start'); await click('pause');
        assert.equal(calls.length, count);
        assert.equal(toggle.disabled, false);
        assert.equal(toggle.getAttribute('aria-disabled'), 'true');
        assert.equal(toggle.textContent, 'admin_auth.recording_stop');
        assert.equal(pause.disabled, false);
        assert.equal(pause.getAttribute('aria-disabled'), 'true');
    }
    const writes = f.node('temporary-recording-message').writes;
    await click('list'); await click('list');
    assert.equal(f.node('temporary-recording-message').writes, writes);
    row.status = 'processing_failed'; row.checkFailed = true;
    await click('list');
    assert.equal(f.node('temporary-recording-message').writes, writes, 'polling must not announce recording history');
    assert.equal(f.node('temporary-recording-start').disabled, false);
    assert.equal(toggle.textContent, 'admin_auth.recording_start');
    assert.equal(pause.disabled, false);
    assert.equal(pause.getAttribute('aria-disabled'), 'true');
    const failedWrites = f.node('temporary-recording-message').writes;
    await click('list'); await click('list');
    assert.equal(f.node('temporary-recording-message').writes, failedWrites);
});

test('shared downloads retain private POST token and expose two format actions', async () => {
    const f = dom();
    const fetch = async url => ({ ok: true, json: async () => url.startsWith('/api/i18n/') ? { admin_auth: {} } : { recordings: [{ id: 'one', title: 'Meeting', status: 'complete', available: true, expiresAt: 10000 }] } });
    vm.runInNewContext(source('recordings.js'), { ...f, fetch, navigator: { language: 'en' }, location: { hash: '#private', pathname: '/recordings', search: '' }, history: { replaceState() {} } });
    await tick();
    const form = f.node('recordings').children[0].children[1];
    assert.equal(form.method, 'post'); assert.equal(form.action, '/api/meeting-access/shared/download');
    const [mp4, m4a] = form.children.slice(-2);
    assert.equal(mp4.name, undefined); assert.equal(m4a.name, 'format'); assert.equal(m4a.value, 'm4a');
    assert.match(m4a.attributes['aria-label'], /Meeting/);
    assert.equal(form.children.find(n => n.name === 'token').value, 'private');
});

test('locale handoff supplies every new key in all five languages', () => {
    const additions = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../docs/recording-ui-locale-additions.json'), 'utf8'));
    for (const lang of ['tr','en','de','es','fr']) for (const key of ['pause','resume','download_m4a','pausing','paused','assembling','processing_failed']) {
        assert.ok(additions[lang].admin_auth['recording_' + key], `${lang}.${key}`);
    }
});
