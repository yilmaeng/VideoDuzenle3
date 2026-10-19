const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'renderer/scripts/speech-search.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function harness(inspection = { supported: true, ready: false }) {
    let document;
    class Element {
        constructor() { this.events = {}; this.children = []; this.attributes = {}; this.style = {}; this.value = ''; this.isConnected = true; }
        addEventListener(name, fn) { (this.events[name] ||= new Set()).add(fn); }
        removeEventListener(name, fn) { this.events[name]?.delete(fn); }
        emit(name, event = {}) { for (const fn of this.events[name] || []) fn(event); }
        setAttribute(name, value) { this.attributes[name] = value; }
        removeAttribute(name) { delete this.attributes[name]; }
        appendChild(child) { this.children.push(child); child.parent = this; }
        replaceChildren() { this.children = []; }
        contains(target) { return target === this || [...this.nodes?.values() || []].includes(target) || this.children.includes(target); }
        focus() { const changed = document.activeElement !== this; document.activeElement = this; if (changed) this.emit('focus'); }
        scrollIntoView() {}
        showModal() { this.open = true; }
        close() { this.open = false; this.emit('close'); }
        remove() { this.isConnected = false; }
        querySelector(selector) { this.nodes ||= new Map(); if (!this.nodes.has(selector)) this.nodes.set(selector, new Element()); return this.nodes.get(selector); }
        querySelectorAll(selector) {
            if (selector !== 'input[name="speech-search-model"]') return [];
            return ['base', 'small'].map(model => {
                const radio = this.querySelector(`#speech-search-model-${model}`);
                radio.value = `Xenova/whisper-${model}`;
                if (radio.checked === undefined) radio.checked = model === 'small';
                return radio;
            });
        }
    }
    document = { body: new Element(), activeElement: new Element(), createElement: () => new Element() };
    const timelineElement = new Element();
    document.getElementById = () => timelineElement;
    const window = new Element();
    const jobs = [], cancelled = [], callbacks = [], inspections = [];
    let unsubscribed = 0;
    window.api = {
        platform: 'win32',
        speechSearchCached: async () => null,
        speechSearchInspect: async params => { inspections.push(params); return typeof inspection === 'function' ? inspection(params) : inspection; },
        speechSearchAnalyze: params => { const job = { ...params, ...deferred() }; jobs.push(job); return job.promise; },
        speechSearchCancel: async id => { cancelled.push(id); },
        onSpeechSearchProgress: fn => { callbacks.push(fn); return () => { unsubscribed++; }; }
    };
    const locale = JSON.parse(fs.readFileSync(path.join(root, 'locales/en.json'), 'utf8'));
    window.i18nHelper = { t: (key, params = {}) => {
        let value = key.split('.').reduce((obj, part) => obj[part], locale);
        for (const [k, v] of Object.entries(params)) value = value.replaceAll(`{${k}}`, v);
        return value;
    }, translateDOM() {} };
    window.SpeechSearchCore = require('../renderer/scripts/speech-search-core');
    const Timeline = { sourceFile: 'a.mp4', segments: [{ start: 0, end: 20 }, { start: 0, end: 20 }, { start: 0, end: 20, sourceFile: 'b.mp4' }], getTotalDuration: () => 60 };
    const seeks = [], plays = [], pauses = [];
    const VideoPlayer = {
        video: new Element(), currentFilePath: 'a.mp4', time: 7, cursorPosition: 3,
        hasVideo: () => Timeline.segments.length > 0, getTimelineTime() { return this.time; },
        pause(options) { pauses.push(options); }, play() { plays.push(this.time); },
        seekToTimelineTime(time) { seeks.push(time); this.time = time; this.currentFilePath = time >= 40 ? 'b.mp4' : 'a.mp4'; },
        setCursorToCurrentTime() { this.cursorPosition = this.time; }
    };
    const intervals = new Map(); let interval = 0;
    vm.runInNewContext(code, { window, document, Timeline, VideoPlayer, Utils: { formatTime: value => String(value) },
        console, setTimeout, clearTimeout, setInterval: fn => { intervals.set(++interval, fn); return interval; }, clearInterval: id => intervals.delete(id) });
    const dialog = () => document.body.children.at(-1);
    const find = selector => dialog().querySelector(selector);
    const action = name => find(`[data-action="${name}"]`);
    const key = (target, key) => window.emit('keydown', { target, key, stopPropagation() {}, preventDefault() {} });
    return { window, document, Timeline, VideoPlayer, jobs, callbacks, cancelled, inspections, seeks, plays, pauses, intervals, dialog, find, action, key,
        get unsubscribed() { return unsubscribed; } };
}
const transcript = { transcripts: [{ sourcePath: 'a.mp4', words: [{ text: 'hello', start: 4, end: 5 }] }] };

test('model selection resets transcripts, inspects readiness and stays locked until job settlement', async () => {
    const h = harness(({ model }) => ({ supported: true, ready: model.endsWith('base') }));
    await h.window.SpeechSearch.open();
    assert.equal(h.inspections[0].model, 'Xenova/whisper-small');
    assert.equal(h.find('#speech-search-model-small').checked, true);
    assert.match(h.find('[data-model-size]').textContent, /190 MB/);
    h.find('input[type="search"]').value = 'hello';
    h.action('analyze').emit('click');
    assert.equal(h.jobs[0].model, 'Xenova/whisper-small');
    assert.equal(h.find('#speech-search-model-base').disabled, true);
    h.jobs[0].resolve(transcript); await flush();
    assert.equal(h.find('[role="listbox"]').children.length, 2);
    const base = h.find('#speech-search-model-base'); base.checked = true; base.emit('change');
    assert.equal(h.find('[role="listbox"]').children.length, 0);
    assert.equal(h.action('analyze').disabled, true);
    await flush();
    assert.equal(h.inspections.at(-1).model, 'Xenova/whisper-base');
    assert.doesNotMatch(h.find('#speech-search-info').textContent, /download/);
    assert.equal(h.jobs.length, 1);
    h.key(h.find('input[type="search"]'), 'Enter');
    assert.equal(h.jobs[1].model, 'Xenova/whisper-base');
    h.action('cancel').emit('click');
    assert.equal(base.disabled, true);
    h.jobs[1].resolve(transcript); await flush();
    assert.equal(base.disabled, false);
    h.action('close').emit('click'); await flush();
});

test('stale model inspections cannot enable Analyze or overwrite selected-model consent', async () => {
    const requests = [];
    const h = harness(() => { const request = deferred(); requests.push(request); return request.promise; });
    const opening = h.window.SpeechSearch.open(); await flush();
    const base = h.find('#speech-search-model-base'); base.checked = true; base.emit('change');
    requests[0].resolve({ supported: true, ready: true }); await opening;
    assert.equal(h.action('analyze').disabled, true);
    requests[1].resolve({ supported: true, ready: false }); await flush();
    assert.match(h.find('#speech-search-info').textContent, /authorizes its download/);
    assert.equal(h.jobs.length, 0);
    h.action('close').emit('click'); await flush();
});

test('opening restores a portable cached transcript without downloading or analyzing', async () => {
    const h = harness({ supported: false, available: false });
    h.window.api.speechSearchCached = async () => ({ transcripts: transcript.transcripts.map(item => ({ ...item, model: 'Xenova/whisper-base' })) });
    await h.window.SpeechSearch.open();
    assert.equal(h.find('#speech-search-model-base').checked, true);
    const query = h.find('input[type="search"]'); query.value = 'hello';
    h.key(query, 'Enter'); await flush();
    assert.equal(h.jobs.length, 0);
    assert.equal(h.find('[role="listbox"]').children.length, 2);
    assert.equal(h.document.activeElement, h.find('[role="listbox"]'));
    h.action('close').emit('click'); await flush();
});

test('archive import opens ready-to-search UI, and failures stay visible without replacing text', async () => {
    const h = harness();
    let response = { transcripts: transcript.transcripts.map(item => ({ ...item, model: 'Xenova/whisper-small' })) };
    h.window.api.speechSearchTransfer = async (action, params) => {
        assert.equal(action, 'import');
        assert.deepEqual(Array.from(params.sources), ['a.mp4', 'b.mp4']);
        return response;
    };
    await h.window.SpeechSearch.transfer('import');
    const query = h.find('input[type="search"]');
    assert.equal(h.document.activeElement, query);
    assert.match(h.find('[data-status]').textContent, /imported/);
    query.value = 'hello'; h.key(query, 'Enter'); await flush();
    assert.equal(h.find('[role="listbox"]').children.length, 2);
    response = { error: 'mismatch' };
    await h.window.SpeechSearch.transfer('import');
    assert.match(h.find('[data-status]').textContent, /does not match/);
    assert.equal(h.find('[role="listbox"]').children.length, 2);
    assert.equal(h.jobs.length, 0);
    h.action('close').emit('click'); await flush();
});

test('inspect is read-only; consent is visible and announced; analysis sources are unique', async () => {
    const h = harness(); await h.window.SpeechSearch.open();
    assert.equal(h.jobs.length, 0);
    assert.match(h.find('#speech-search-info').textContent, /authorizes its download/);
    assert.match(h.find('[data-live]').textContent, /authorizes its download/);
    h.action('analyze').emit('click');
    assert.deepEqual(Array.from(h.jobs[0].sources), ['a.mp4', 'b.mp4']);
    assert.match(h.jobs[0].jobId, /^[a-zA-Z0-9_-]{1,100}$/);
    h.jobs[0].resolve(transcript); await flush();
    assert.match(h.find('[data-status]').textContent, /Analysis complete.*transcript is ready/);
    h.action('close').emit('click'); await flush();
});

test('query Enter analyzes then searches cached text; duplicate results preview and commit in timeline time', async () => {
    const h = harness({ supported: true, ready: true }); await h.window.SpeechSearch.open();
    assert.doesNotMatch(h.find('#speech-search-info').textContent, /download/);
    const query = h.find('input[type="search"]'); query.value = 'hello';
    h.key(query, 'Enter'); h.jobs[0].resolve(transcript); await flush();
    const list = h.find('[role="listbox"]');
    assert.equal(h.document.activeElement, list);
    assert.equal(list.children.length, 2); assert.equal(h.plays.at(-1), 3);
    assert.equal(list.children[0].textContent, 'hello. 4');
    h.key(list, 'ArrowDown'); await flush();
    assert.equal(h.plays.at(-1), 23);
    h.key(list, ' '); await flush(); assert.equal(h.plays.at(-1), 23);
    assert.equal(h.jobs.length, 1);
    h.key(list, 'Enter'); await flush();
    assert.equal(h.seeks.at(-1), 23); assert.equal(h.VideoPlayer.cursorPosition, 23);
    assert.equal(h.document.activeElement, h.document.getElementById('timeline-section'));
    assert.equal(h.Timeline.segments.length, 3);
});

test('typing stops an active preview silently without repeatedly pausing or moving focus', async () => {
    const h = harness(); await h.window.SpeechSearch.open();
    const query = h.find('input[type="search"]'); query.value = 'hello';
    const initialPauses = h.pauses.length;
    query.emit('input'); query.emit('input');
    await new Promise(resolve => setTimeout(resolve, 230));
    assert.equal(h.pauses.length, initialPauses);
    h.key(query, 'Enter'); h.jobs[0].resolve(transcript); await flush();
    query.focus(); query.emit('input'); query.emit('input');
    assert.equal(h.pauses.length, initialPauses + 1);
    assert.equal(h.pauses.at(-1).announce, false);
    await new Promise(resolve => setTimeout(resolve, 230));
    assert.equal(h.pauses.length, initialPauses + 1);
    assert.equal(h.document.activeElement, query);
    h.action('close').emit('click'); await flush();
});

test('Enter keeps focus on the query when analysis or cached search has no matches', async () => {
    const h = harness(); await h.window.SpeechSearch.open();
    const query = h.find('input[type="search"]'); query.value = 'missing';
    h.key(query, 'Enter'); h.jobs[0].resolve(transcript); await flush();
    assert.equal(h.document.activeElement, query);
    assert.equal(h.find('[role="listbox"]').children.length, 0);
    query.value = 'hello'; h.key(query, 'Enter'); await flush();
    assert.equal(h.document.activeElement, h.find('[role="listbox"]'));
    query.focus(); query.value = 'missing'; h.key(query, 'Enter'); await flush();
    assert.equal(h.document.activeElement, query);
    assert.equal(h.jobs.length, 1);
    h.action('close').emit('click'); await flush();
});

test('cancel waits for settlement; closed jobs cannot populate reopened dialogs', async () => {
    const h = harness(); await h.window.SpeechSearch.open(); h.action('analyze').emit('click');
    const first = h.jobs[0]; h.action('cancel').emit('click');
    assert.equal(h.action('analyze').disabled, true);
    h.action('analyze').emit('click'); assert.equal(h.jobs.length, 1);
    first.resolve(transcript); await flush();
    assert.equal(h.action('analyze').disabled, false);
    assert.match(h.find('[data-status]').textContent, /cancelled/);
    h.action('analyze').emit('click'); const stale = h.jobs[1];
    h.key(h.find('input[type="search"]'), 'Escape'); await flush();
    assert.equal(h.seeks.at(-1), 7);
    await h.window.SpeechSearch.open(); stale.resolve(transcript); await flush();
    assert.equal(h.find('[role="listbox"]').children.length, 0);
    assert.ok(h.unsubscribed >= 2);
    h.action('close').emit('click'); await flush();
});

test('Enter clamps the lead-in at zero while Escape restores the original position', async () => {
    for (const key of ['Enter', 'Escape']) {
        const h = harness(); await h.window.SpeechSearch.open();
        h.find('input[type="search"]').value = 'hello';
        h.action('analyze').emit('click');
        h.jobs[0].resolve({ transcripts: [{ sourcePath: 'a.mp4', words: [{ text: 'hello', start: 0.2, end: 0.5 }] }] });
        await flush();
        const list = h.find('[role="listbox"]'); list.focus(); await flush();
        assert.equal(h.plays.at(-1), 0);
        h.key(list, key); await flush();
        assert.equal(h.seeks.at(-1), key === 'Enter' ? 0 : 7);
        assert.equal(h.VideoPlayer.cursorPosition, key === 'Enter' ? 0 : 3);
    }
});

test('indeterminate progress, job filtering, no-media and unavailable guards', async () => {
    const h = harness(); await h.window.SpeechSearch.open(); h.action('analyze').emit('click');
    const initial = h.find('[data-status]').textContent;
    h.callbacks[0]({ jobId: 'other', stage: 'extract', percent: 40 });
    assert.equal(h.find('[data-status]').textContent, initial);
    h.callbacks[0]({ jobId: h.jobs[0].jobId, stage: 'extract', percent: null });
    assert.equal(h.find('progress').attributes.value, undefined);
    assert.equal(h.find('[data-status]').textContent, 'Preparing audio');
    h.callbacks[0]({ jobId: h.jobs[0].jobId, stage: 'extract', percent: 0, indeterminate: true });
    assert.equal(h.find('[data-status]').textContent, 'Preparing audio');
    assert.equal(h.find('progress').attributes.value, undefined);
    h.jobs[0].reject(new Error('speech_search_busy')); await flush();
    assert.match(h.find('[data-status]').textContent, /another window/);
    h.action('close').emit('click'); await flush();
    const unavailable = harness({ supported: true, available: false });
    await unavailable.window.SpeechSearch.open(); assert.equal(unavailable.action('analyze').disabled, true);
    unavailable.action('close').emit('click'); await flush();
    const empty = harness(); empty.Timeline.segments = []; await empty.window.SpeechSearch.open();
    assert.match(empty.find('[data-status]').textContent, /Open media/);
    empty.action('close').emit('click');
});

test('locale key parity and script ordering', () => {
    const keys = obj => Object.entries(obj).flatMap(([key, value]) => typeof value === 'object' ? keys(value).map(child => `${key}.${child}`) : [key]).sort();
    let expected;
    for (const lang of ['tr', 'en', 'de', 'es', 'fr']) {
        const locale = JSON.parse(fs.readFileSync(path.join(root, `locales/${lang}.json`), 'utf8'));
        expected ||= keys(locale.speech_search);
        assert.deepEqual(keys(locale.speech_search), expected);
        assert.ok(locale.speech_search.category); assert.ok(locale.dialog.keyboard_manager.actions.speechSearch);
        assert.ok(locale.dialog.keyboard_manager.actions.speechSearchExport);
        assert.ok(locale.dialog.keyboard_manager.actions.speechSearchImport);
        assert.ok(locale.speech_search.result.startsWith('{text}'));
        assert.ok(locale.speech_search.result_approximate.startsWith('{text}'));
    }
    const html = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
    assert.ok(html.indexOf('scripts/speech-search-core.js') < html.indexOf('scripts/speech-search.js'));
});

test('result rendering is capped and input searches are debounced', async () => {
    const h = harness();
    let searches = 0;
    h.window.SpeechSearchCore = { search: () => {
        searches++;
        return Array.from({ length: 30000 }, (_, i) => ({ start: i, end: i + 1, text: 'hello' }));
    } };
    await h.window.SpeechSearch.open();
    const query = h.find('input[type="search"]'); query.value = 'hello';
    h.action('analyze').emit('click'); h.jobs[0].resolve(transcript); await flush();
    assert.equal(h.find('[role="listbox"]').children.length, 500);
    assert.match(h.find('[data-status]').textContent, /500 of 30000/);
    query.emit('input'); query.emit('input'); query.emit('input');
    assert.equal(searches, 1);
    await new Promise(resolve => setTimeout(resolve, 230));
    assert.equal(searches, 2);
    h.action('close').emit('click'); await flush();
});

test('rapid selections wait for the source and only play the newest preview', async () => {
    const h = harness(); await h.window.SpeechSearch.open();
    h.find('input[type="search"]').value = 'hello';
    h.action('analyze').emit('click'); h.jobs[0].resolve(transcript); await flush();
    h.VideoPlayer._isLoadingSource = true;
    const list = h.find('[role="listbox"]');
    list.focus(); h.key(list, 'End');
    await flush(); assert.equal(h.plays.length, 0);
    h.VideoPlayer._isLoadingSource = false;
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.deepEqual(h.plays, [23]);
    h.VideoPlayer.time = 32;
    for (const tick of h.intervals.values()) tick();
    assert.equal(h.intervals.size, 1);
    h.VideoPlayer.time = 33;
    for (const tick of h.intervals.values()) tick();
    assert.equal(h.intervals.size, 0);
    h.action('close').emit('click'); await flush();
});
