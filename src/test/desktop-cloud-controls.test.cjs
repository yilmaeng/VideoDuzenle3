const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { Readable } = require('node:stream');
const { createRequire } = require('node:module');
const { recordingName } = require('../shared/desktop-recording-name');
const { RoomAccountClient, accountMethod, downloadPath, isAccountSender } = require('../main/room-account-client');
const { recordingActions, PENDING_STATES } = require('../renderer/scripts/desktop-cloud-controls');
const root = path.resolve(__dirname, '../..');
const id = '4b730324-2dd8-4af0-b0c7-00f18f4f0a66';

test('recording allowlist is narrow and methods cannot be supplied by renderer', async () => {
    assert.equal(accountMethod('recordings'), 'GET');
    assert.equal(accountMethod('recordings/start'), 'POST');
    for (const action of ['pause', 'resume', 'stop', 'share']) assert.equal(accountMethod(`recordings/${id}/${action}`), 'POST');
    for (const endpoint of ['recordings/refresh', `recordings/${id}/delete`, `recordings/${id}/download`,
        `recordings/${id}/stop?x=1`, `recordings/${id}/stop/`, '../recordings', '/recordings', 'recordings/start#x',
        `recordings/${id}/../start`, 'https://example.com/recordings', 'recordings/not-a-uuid/pause', null]) {
        assert.equal(accountMethod(endpoint), null, String(endpoint));
    }
    let calls = 0;
    const client = new RoomAccountClient({ filePath: path.join(os.tmpdir(), `missing-${id}`),
        safeStorage: { isEncryptionAvailable: () => false }, request: async (endpoint, method, cookie) => {
            calls++; assert.equal(method, 'POST'); assert.equal(cookie, 'secret'); return { status: 403, payload: { error: 'room_owner_required' } };
        } });
    assert.equal((await client.call('recordings')).error, 'session_required');
    assert.equal(calls, 0);
    client.cookie = 'secret';
    assert.equal((await client.call(`recordings/${id}/pause`)).error, 'room_owner_required');
    assert.equal(calls, 1);
});

test('download path accepts UUID, MP4/M4A and supported language only', () => {
    assert.equal(downloadPath({ id, format: 'm4a', lang: 'de' }), `recordings/${id}/download?format=m4a&lang=de`);
    assert.equal(downloadPath({ id, format: 'mp4', lang: '&cookie=secret' }), `recordings/${id}/download?format=mp4&lang=tr`);
    for (const options of [{ id, format: 'mp3' }, { id: '../x', format: 'mp4' }, { id: `${id}?url=x`, format: 'm4a' }, {}]) assert.equal(downloadPath(options), null);
});

test('only the exact top-level broadcast renderer may use account IPC', () => {
    const frame = { url: pathToFileURL(path.join(root, 'src/renderer/dialogs/broadcast-room.html')).href };
    const event = { senderFrame: frame, sender: { mainFrame: frame } };
    assert.equal(isAccountSender(event), true);
    assert.equal(isAccountSender({ ...event, senderFrame: { ...frame } }), false);
    for (const url of ['https://evd.drenginyilmaz.net/', pathToFileURL(path.join(root, 'src/renderer/index.html')).href]) {
        frame.url = url; assert.equal(isAccountSender(event), false);
    }
});

test('download IPC streams privately, rejects redirects, cleans partial files and checks sender', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-cloud-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const destination = path.join(dir, 'recording.m4a');
    const handlers = new Map(), requests = [];
    let statusCode = 200, dialogs = 0, initialTimeout = 0, transferTimeout = 0, saveOptions;
    const announcements = [];
    const row = { id, title: 'Müzik / Toplantısı', createdAt: Date.UTC(2026, 9, 12, 10, 30), status: 'complete', available: true };
    const sourcePath = path.join(root, 'src/main/room-account-client.js');
    const context = vm.createContext({ Buffer, URL, setTimeout: fn => fn(), module: { exports: {} }, __dirname: path.dirname(sourcePath), require(name) {
        if (name === './i18n') return { currentLocale: 'en', getMergedResources: lang => require(`../locales/${lang}.json`), t: key => key };
        if (name === 'electron') return { ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
            app: { getPath: () => dir }, safeStorage: {}, BrowserWindow: { fromWebContents: () => ({}) },
            dialog: { showSaveDialog: async (_window, options) => { dialogs++; saveOptions = options; return { filePath: destination, canceled: false }; } } };
        if (name === 'https') return { get(url, options, callback) {
            requests.push({ url, options });
            const response = Readable.from([Buffer.from('AAC-packet-data')]); response.statusCode = statusCode;
            response.setTimeout = value => { transferTimeout = value; };
            queueMicrotask(() => callback(response));
            return { setTimeout(value) { initialTimeout = value; }, on() {} };
        } };
        return require(name);
    } });
    vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context);
    const api = context.module.exports;
    api.RoomAccountClient.prototype.call = async function (endpoint) { this.cookie = 'private-cookie'; return endpoint === 'recordings'
        ? { recordings: [row] } : { user: { id: 'owner' } }; };
    api.setupRoomAccountHandlers();
    const frame = { url: pathToFileURL(path.join(root, 'src/renderer/dialogs/broadcast-room.html')).href };
    const event = { senderFrame: frame, sender: { id: 1, mainFrame: frame, once() {}, send: (name, payload) => announcements.push({ name, payload }), isDestroyed: () => false } };
    await handlers.get('room-account-request')(event, 'session');
    const result = await handlers.get('room-account-download')(event, { id, format: 'm4a', lang: 'en', filename: 'untrusted-name.m4a' });
    assert.equal(result.success, true);
    assert.equal(initialTimeout, 30 * 60 * 1000);
    assert.equal(transferTimeout, 30000);
    assert(saveOptions.defaultPath.includes('Müzik - Toplantısı'));
    assert(saveOptions.defaultPath.includes('2026'));
    assert(saveOptions.defaultPath.endsWith('.m4a'));
    assert(!saveOptions.defaultPath.includes(id));
    assert(!saveOptions.defaultPath.includes('untrusted'));
    assert.equal(announcements[0].name, 'accessibility-dialog-announce');
    assert(announcements[0].payload.title && announcements[0].payload.message.includes(row.title) && announcements[0].payload.detail);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'AAC-packet-data');
    assert.equal(requests[0].options.headers.Cookie, '__Host-evd-admin=private-cookie');
    assert.equal(requests[0].url, `https://evd.drenginyilmaz.net/api/admin-auth/recordings/${id}/download?format=m4a&lang=en`);
    assert(!JSON.stringify(result).includes('cookie'));
    statusCode = 302;
    assert.equal((await handlers.get('room-account-download')(event, { id, format: 'mp4' })).error, 'request_failed');
    assert.equal(fs.readdirSync(dir).filter(name => name.endsWith('.part')).length, 0);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'AAC-packet-data');
    const before = dialogs;
    assert.equal((await handlers.get('room-account-download')({ ...event, senderFrame: { ...frame } }, { id, format: 'mp4' })).error, 'request_failed');
    assert.equal(dialogs, before);
});

test('recording states do not enable duplicate starts or unsafe transition actions', () => {
    for (const state of ['pausing', 'paused', 'assembling', 'unknown']) assert(PENDING_STATES.includes(state));
    assert.equal(recordingActions('active').pause, true);
    assert.equal(recordingActions('paused').resume, true);
    for (const status of ['ending', 'assembling', 'complete', 'failed', 'processing_failed', undefined]) {
        assert.deepEqual(recordingActions(status), { pause: false, resume: false, stop: false });
    }
});

test('locale handoff contains every new UI and shortcut key in five languages', () => {
    const locales = JSON.parse(fs.readFileSync(path.join(root, 'docs/desktop-cloud-locale-additions.json'), 'utf8'));
    assert.deepEqual(Object.keys(locales).sort(), ['de', 'en', 'es', 'fr', 'tr']);
    function flatten(value, prefix = '') { return Object.entries(value).flatMap(([key, item]) => typeof item === 'object'
        ? flatten(item, `${prefix}${key}.`) : [[`${prefix}${key}`, item]]); }
    const expected = flatten(locales.en).map(([key]) => key).sort();
    for (const locale of Object.values(locales)) {
        const entries = flatten(locale); assert.deepEqual(entries.map(([key]) => key).sort(), expected);
        for (const [key, value] of entries) assert.equal(typeof value === 'string' && value.length > 0, true, key);
    }
    assert(locales.tr.desktop_cloud.title.includes('kaydı'));
    assert(locales.tr.desktop_cloud.retention.includes('yedi gün'));
    const html = fs.readFileSync(path.join(root, 'src/renderer/dialogs/broadcast-room.html'), 'utf8');
    for (const match of html.matchAll(/data-i18n="(desktop_cloud\.[^"]+)"/g)) assert(expected.includes(match[1]), match[1]);
    assert.match(html, /<details id="desktop-cloud-recording"[^>]*hidden>/);
    assert(!/<details id="desktop-cloud-recording"[^>]*\bopen\b/.test(html));
});

test('desktop cohost waiting requests carry scoped identity and session credentials', async () => {
    const source = fs.readFileSync(path.join(root, 'src/renderer/scripts/broadcast-room.js'), 'utf8');
    const code = source.slice(source.indexOf('async function requestLiveBroadcastRoomApi('), source.indexOf('function getBroadcastRoomApiErrorMessage('));
    let sent;
    const context = vm.createContext({ roomAccount: { rooms: [], activeRoomId: '' },
        state: { roomState: { roomId: 'room', hostIdentity: 'cohost' } }, Headers,
        getLocalRoomRole: () => 'co_host', roomParticipantApiKeys: new Map([['room', 'scoped-session']]),
        getBroadcastRoomOwnerKey: () => '', getLiveBroadcastRoomApiUrl: value => value,
        fetch: async (_url, options) => { sent = options; return { ok: true, json: async () => ({ success: true, requests: [] }) }; }
    });
    vm.runInContext(code, context);
    await context.requestLiveBroadcastRoomApi('/broadcast-room/waiting-list', { method: 'POST', body: JSON.stringify({ roomId: 'room' }) });
    assert.equal(sent.headers.get('X-EVD-Participant-Identity'), 'cohost');
    assert.equal(sent.headers.get('X-EVD-Participant-Key'), 'scoped-session');
    assert.equal(sent.headers.has('X-EVD-Room-Owner-Key'), false);
});

test('renderer join gates token use on admission and owner bridge keeps waiting POST actions', async () => {
    const source = fs.readFileSync(path.join(root, 'src/renderer/scripts/broadcast-room.js'), 'utf8');
    const join = source.slice(source.indexOf('async function joinExistingRoomNatively('), source.indexOf('function getPersistentRoomContextActionButtons'));
    const calls = [];
    const context = vm.createContext({ desktopWaitingControls: { cancel() {}, waitForAdmission: async () => null },
        stopLiveRoomSync() {}, resetCurrentLiveRoomForSwitch: async () => {},
        requestLiveBroadcastRoomApi: async () => { calls.push('join'); return { waiting: { status: 'pending' } }; },
        connectHostToLiveKit: async () => calls.push('connect') });
    vm.runInContext(join, context);
    await context.joinExistingRoomNatively({ inviteId: 'invite', displayName: 'Guest' });
    assert.deepEqual(calls, ['join']);
    assert(source.includes("broadcastRoomGlobalAdmitAll: 'Alt+Ctrl+A'"));
    const cloudContext = source.slice(source.indexOf('desktopCloudControls = require('), source.indexOf('desktopCloudControls.update();', source.indexOf('desktopCloudControls = require(')));
    assert(!cloudContext.includes('roomAccount.rooms'));
    assert(cloudContext.includes("getLocalRoomRole() !== 'guest'"));
    assert(cloudContext.includes('!!roomAccount.user'));
    const bridgeCalls = [];
    const bridge = vm.createContext({ roomAccount: { rooms: [{ roomId: 'owned' }] }, state: { roomState: { roomId: 'owned' } },
        getLocalRoomRole: () => 'host', roomParticipantApiKeys: new Map(),
        roomAccountRequest: async (endpoint, body) => { bridgeCalls.push({ endpoint, body }); return {}; } });
    vm.runInContext(source.slice(source.indexOf('async function requestLiveBroadcastRoomApi('), source.indexOf('function getBroadcastRoomApiErrorMessage(')), bridge);
    for (const action of ['waiting-list', 'waiting-decision']) {
        await bridge.requestLiveBroadcastRoomApi(`/broadcast-room/${action}`, { method: 'POST', body: JSON.stringify({ roomId: 'owned', decision: 'approve', all: true }) });
        assert.equal(bridgeCalls.at(-1).body.action, action);
        assert.equal(bridgeCalls.at(-1).body.method, 'POST');
    }
});

function uiFixture(filename) {
    const nodes = new Map(), timers = [];
    const document = { activeElement: null, getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, this.createElement(id)); return nodes.get(id);
    }, createElement(tag) {
        return { tag, dataset: {}, children: [], listeners: {}, hidden: false, disabled: false,
            addEventListener(type, fn) { this.listeners[type] = fn; }, removeEventListener(type) { delete this.listeners[type]; },
            append(child) { this.children.push(child); child.parent = this; }, replaceChildren() { this.children = []; }, setAttribute() {},
            remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); },
            focus() { document.activeElement = this; }, showModal() { this.open = true; },
            querySelector() { return this; }, querySelectorAll() { return this.children.flatMap(child => child.children); } };
    } };
    const context = vm.createContext({ module: { exports: {} }, require: createRequire(path.join(root, 'src/renderer/scripts', filename)), document, setInterval: () => 1, clearInterval() {},
        setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {}, Date });
    vm.runInContext(fs.readFileSync(path.join(root, 'src/renderer/scripts', filename), 'utf8'), context);
    return { api: context.module.exports, document, timers };
}

test('cloud UI stays collapsed, scopes rows and hides after account access is lost', async () => {
    const f = uiFixture('desktop-cloud-controls.js');
    let allowed = true;
    const controller = f.api.createDesktopCloudControls({ document: f.document, t: key => key, announce() {}, language: () => 'en',
        context: () => ({ roomId: 'owned', allowed }), download: async () => ({}), request: async () => ({ enabled: true,
            recordingConsent: { owned: { confirmed: false } },
            recordings: [{ id, roomId: 'owned', status: 'paused', available: false }, { id: 'other', roomId: 'other', status: 'complete' }] }) });
    controller.update();
    assert.equal(f.document.getElementById('desktop-cloud-recording').open, false);
    await controller.refresh();
    assert.equal(f.document.getElementById('desktop-cloud-recordings').children.length, 1);
    assert.equal(f.document.getElementById('desktop-cloud-start').disabled, false);
    allowed = false; controller.update();
    assert.equal(f.document.getElementById('desktop-cloud-recording').hidden, true);
    assert.equal(f.document.getElementById('desktop-cloud-recordings').children.length, 0);
    controller.dispose();
});

test('two stable recording controls follow actual states without replacing focused nodes', async () => {
    const f = uiFixture('desktop-cloud-controls.js'), calls = [];
    let row = { id, roomId: 'owned', status: 'active', title: 'Meeting', createdAt: Date.now(), available: false };
    const controller = f.api.createDesktopCloudControls({ document: f.document, t: key => key, announce() {}, language: () => 'en',
        context: () => ({ roomId: 'owned', allowed: true }), download: async () => ({}), request: async endpoint => {
            calls.push(endpoint);
            if (endpoint.endsWith('/pause')) row.status = 'pausing';
            if (endpoint.endsWith('/resume')) row.status = 'starting';
            if (endpoint.endsWith('/stop')) row.status = 'ending';
            return { enabled: true, recordingConsent: { owned: { confirmed: true } }, recordings: [{ ...row }] };
        } });
    await controller.refresh();
    const start = f.document.getElementById('desktop-cloud-start'), pause = f.document.getElementById('desktop-cloud-pause');
    const item = f.document.getElementById('desktop-cloud-recordings').children[0];
    assert.equal(item.children.length, 3, 'Rows contain a label and two download controls, not recording actions');
    assert.equal(start.textContent, 'desktop_cloud.stop'); assert.equal(pause.textContent, 'desktop_cloud.pause');
    pause.focus(); await pause.listeners.click();
    assert(calls.includes(`recordings/${id}/pause`)); assert.equal(pause.disabled, true); assert.equal(start.disabled, true);
    assert.equal(f.document.activeElement, pause);
    row.status = 'paused'; await controller.refresh();
    assert.equal(pause.textContent, 'desktop_cloud.resume'); assert.equal(start.textContent, 'desktop_cloud.stop');
    assert.equal(pause.disabled, false); await pause.listeners.click();
    assert(calls.includes(`recordings/${id}/resume`));
    for (const state of ['starting', 'pausing', 'ending', 'assembling', 'unknown']) {
        row.status = state; await controller.refresh();
        assert.equal(start.disabled, true, state); assert.equal(pause.disabled, true, state);
        assert.equal(f.document.getElementById('desktop-cloud-recordings').children[0], item);
        assert.equal(f.document.activeElement, pause);
    }
    row.status = 'active'; await controller.refresh(); await start.listeners.click();
    assert(calls.includes(`recordings/${id}/stop`));
    row.status = 'complete'; row.available = true; await controller.refresh();
    assert.equal(start.textContent, 'desktop_cloud.start'); assert.equal(start.disabled, false); assert.equal(pause.disabled, true);
    assert.equal(f.document.getElementById('desktop-cloud-recordings').children[0], item);
    controller.dispose();
});

test('recording notices announce actual transitions and expire without poll resurrection or stale timer clears', () => {
    const callbacks = [], writes = [];
    let value = '';
    const element = { get textContent() { return value; }, set textContent(next) { value = next; writes.push(next); } };
    const context = vm.createContext({ module: { exports: {} }, clearTimeout() {}, setTimeout(fn, ms) {
        assert.equal(ms, 6000); callbacks.push(fn); return callbacks.length;
    } });
    vm.runInContext(fs.readFileSync(path.join(root, 'src/renderer/scripts/desktop-recording-notice.js'), 'utf8'), context);
    const controller = context.module.exports.createRecordingNoticeController(element, key => key);
    for (const state of ['idle', 'starting', 'unknown', 'starting']) controller.update('room', state);
    assert.equal(value, '');
    controller.update('room', 'active'); assert.equal(value, 'admin_auth.recording_notice_active');
    const startedTimer = callbacks.at(-1);
    controller.update('room', 'pausing'); assert.equal(value, 'admin_auth.recording_notice_active');
    controller.update('room', 'paused'); assert.equal(value, 'admin_auth.recording_notice_paused');
    startedTimer(); assert.equal(value, 'admin_auth.recording_notice_paused');
    callbacks.at(-1)(); assert.equal(value, '');
    const before = writes.length;
    for (const state of ['paused', 'unknown', 'paused']) controller.update('room', state);
    assert.equal(writes.length, before);
    controller.update('room', 'starting'); controller.update('room', 'active');
    assert.equal(value, 'admin_auth.recording_notice_resumed');
    controller.update('room', 'ending'); assert.equal(value, 'admin_auth.recording_notice_resumed');
    controller.update('room', 'assembling'); assert.equal(value, 'admin_auth.recording_notice_stopped');
    callbacks.at(-1)(); controller.update('room', 'complete'); controller.update('room', 'idle');
    assert.equal(value, '');
    controller.dispose();
    const transient = context.module.exports.createTransientStatus(element);
    transient.show('error'); callbacks.at(-1)(); const previous = writes.length;
    transient.show('error'); assert.equal(writes.length, previous);
    transient.dispose();
});

test('delegated manager visibility requires an own server consent entry and revokes on failure', async () => {
    const f = uiFixture('desktop-cloud-controls.js');
    let consent = {}, allowed = true, error = false, calls = 0;
    const controller = f.api.createDesktopCloudControls({ document: f.document, t: key => key, announce() {}, language: () => 'en',
        context: () => ({ roomId: 'delegated', accountKey: 'manager', allowed }), download: async () => ({}), request: async () => {
            calls++; if (error) throw new Error('offline');
            return { enabled: true, recordingConsent: consent, recordings: [] };
        } });
    const panel = f.document.getElementById('desktop-cloud-recording');
    controller.update(); assert.equal(panel.hidden, true);
    await controller.refresh(); assert.equal(panel.hidden, true);
    consent = Object.create({ delegated: { confirmed: true } });
    await controller.refresh(); assert.equal(panel.hidden, true, 'Inherited keys are not grants');
    consent = { delegated: { confirmed: false } };
    await controller.refresh(); assert.equal(panel.hidden, false); assert.equal(panel.open, false);
    assert.equal(f.document.getElementById('desktop-cloud-start').disabled, false);
    consent = {}; await controller.refresh(); assert.equal(panel.hidden, true);
    consent = { delegated: { confirmed: true } }; await controller.refresh();
    error = true; await controller.refresh(); assert.equal(panel.hidden, true);
    allowed = false; const before = calls; await controller.refresh(); assert.equal(calls, before);
    controller.dispose();
});

test('recording names use localized date, time and title while filenames are safe', () => {
    const row = { title: 'Çalışma: / <oda> \\ ? * |', createdAt: Date.UTC(2026, 9, 12, 10, 30) };
    for (const lang of ['tr', 'en', 'de', 'es', 'fr']) {
        const strings = require(`../locales/${lang}.json`);
        const translate = (key, params = {}) => key.split('.').reduce((value, part) => value[part], strings)
            .replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
        const name = recordingName(row, lang, translate);
        assert(name.includes(row.title)); assert(name.includes('2026')); assert(/\d{2}:\d{2}/.test(name));
        const filename = recordingName(row, lang, translate, { filename: true });
        assert(!/[<>:"/\\|?*\x00-\x1f]/.test(filename)); assert(filename.includes('Çalışma'));
        assert(!filename.includes('undefined')); assert(filename.length <= 180);
    }
    assert.equal(recordingName({}, 'en', () => 'CON', { filename: true }), '_CON');
});

test('waiting live regions suppress repeated errors/counts and recover once', async () => {
    const f = uiFixture('desktop-waiting-controls.js');
    let failed = true, rows = [];
    const writes = element => {
        let value = '', count = 0;
        Object.defineProperty(element, 'textContent', { get: () => value, set: next => { value = next; count++; } });
        return () => count;
    };
    const statusWrites = writes(f.document.getElementById('desktop-waiting-status'));
    const guestWrites = writes(f.document.getElementById('desktop-waiting-guest-status'));
    const controller = f.api.createDesktopWaitingControls({ document: f.document,
        t: (key, fallback, params) => `${key}:${params?.count ?? ''}`, announce() {},
        context: () => ({ roomId: 'owned', allowed: true }), request: async () => {
            if (failed) throw new Error('offline'); return { requests: rows, waiting: { status: 'pending' } };
        } });
    await controller.refresh(); await controller.refresh(); assert.equal(statusWrites(), 1);
    failed = false; await controller.refresh(); await controller.refresh(); assert.equal(statusWrites(), 2);
    rows = [{ requestId: 'a', displayName: 'Alice' }]; await controller.refresh(); assert.equal(statusWrites(), 3);
    rows = [{ requestId: 'b', displayName: 'Bob' }]; await controller.refresh(); assert.equal(statusWrites(), 3);
    failed = true;
    const pending = controller.waitForAdmission('invite', { requestId: 'guest', secret: 'private' });
    assert.equal(guestWrites(), 1);
    await f.timers.shift()(); await f.timers.shift()(); assert.equal(guestWrites(), 2);
    failed = false; await f.timers.shift()(); await f.timers.shift()(); assert.equal(guestWrites(), 3);
    controller.cancel(); await pending; controller.dispose();
});

test('closed waiting panel announces only unseen request IDs, not polls or busy renders', async () => {
    const f = uiFixture('desktop-waiting-controls.js'), announcements = [];
    let rows = [], roomId = 'owned';
    const controller = f.api.createDesktopWaitingControls({ document: f.document,
        t: (key, fallback, params) => `${key}:${params?.count ?? ''}:${params?.names ?? ''}`,
        announce: text => announcements.push(text), context: () => ({ roomId, allowed: true }),
        request: async () => ({ requests: rows }) });
    const panel = f.document.getElementById('desktop-waiting-queue'); panel.open = false;
    await controller.refresh(); assert.equal(announcements.length, 0);
    rows = [{ requestId: 'a', displayName: 'Alice' }];
    await controller.refresh(); await controller.refresh();
    assert.deepEqual(announcements, ['waiting_room.new_requests:1:Alice']);
    rows = [{ requestId: 'a', displayName: 'Alice renamed' }]; await controller.refresh();
    await controller.admitAll();
    assert.equal(announcements.filter(text => text.includes('waiting_room.new_requests')).length, 1);
    rows = []; await controller.refresh();
    rows = [{ requestId: 'a', displayName: 'Alice' }, { requestId: 'b', displayName: 'Bob' }, { requestId: 'c', displayName: 'Carol' }];
    await controller.refresh();
    assert.equal(announcements.at(-1), 'waiting_room.new_requests:2:Bob, Carol');
    assert.equal(panel.open, false);
    roomId = 'other'; rows = [{ requestId: 'd', displayName: 'Dana' }]; await controller.refresh();
    assert.equal(announcements.at(-1), 'waiting_room.new_requests:1:Dana');
    for (const lang of ['tr', 'en', 'de', 'es', 'fr']) {
        const template = require(`../locales/${lang}.json`).waiting_room.new_requests;
        assert(template.includes('{count}') && template.includes('{names}'));
    }
    controller.dispose();
});

test('disabling waiting room restores origin focus after modal cancel', async () => {
    const f = uiFixture('desktop-waiting-controls.js');
    const controller = f.api.createDesktopWaitingControls({ document: f.document, t: key => key, announce() {},
        context: () => ({ roomId: 'owned', allowed: true }), request: async () => ({ requests: [{ requestId: 'a' }] }) });
    const origin = f.document.getElementById('desktop-waiting-enabled'); origin.focus();
    const pending = controller.disableDecision(origin);
    await new Promise(resolve => setImmediate(resolve));
    const dialog = f.document.getElementById('desktop-waiting-disable-dialog');
    assert.equal(dialog.open, true);
    assert.equal(f.document.activeElement, f.document.getElementById('desktop-waiting-disable-message'));
    dialog.returnValue = 'cancel'; dialog.listeners.close();
    assert.equal(await pending, 'cancel'); assert.equal(f.document.activeElement, origin);
    controller.dispose();
});

test('waiting UI sends named decisions and keeps guest credentials only in status/cancel requests', async () => {
    const f = uiFixture('desktop-waiting-controls.js'), calls = [];
    let guestStatus = 'pending';
    const controller = f.api.createDesktopWaitingControls({ document: f.document, t: (key, fallback, params) => `${key}:${params?.name || ''}`, announce() {},
        context: () => ({ roomId: 'owned', allowed: true }), request: async (url, options) => {
            calls.push({ url, body: JSON.parse(options.body) });
            return url.endsWith('waiting-status') ? { waiting: { status: guestStatus } }
                : { requests: [{ requestId: 'req', displayName: 'Alice', status: 'pending' }] };
        } });
    await controller.refresh();
    assert(f.document.getElementById('desktop-waiting-list').children[0].children[0].textContent.includes('Alice'));
    await controller.admitAll();
    assert.equal(calls.at(-1).body.all, true); assert.equal(calls.at(-1).body.decision, 'approve');
    const waiting = controller.waitForAdmission('invite', { requestId: 'req', secret: 'private', expiresAt: Date.now() + 60000 });
    await f.timers.shift()();
    assert.equal(calls.at(-1).url, '/broadcast-room/waiting-status');
    assert.equal(calls.at(-1).body.waiting.secret, 'private');
    guestStatus = 'approved'; await f.timers.shift()();
    assert.equal((await waiting).secret, 'private');
    const canceled = controller.waitForAdmission('invite', { requestId: 'req2', secret: 'private2' });
    controller.cancel(); assert.equal(await canceled, null);
    assert.equal(calls.at(-1).url, '/broadcast-room/waiting-cancel');
    controller.dispose();
});
