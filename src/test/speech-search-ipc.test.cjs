const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerSpeechSearchIpc } = require('../main/speech-search-ipc');

function harness(service, dialogs) {
    const handlers = new Map();
    registerSpeechSearchIpc({ ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, service, dialogs });
    function window(id) {
        const sender = new EventEmitter();
        sender.id = id;
        sender.isDestroyed = () => false;
        sender.mainFrame = {};
        sender.sent = [];
        sender.send = (...args) => sender.sent.push(args);
        return { sender, senderFrame: sender.mainFrame };
    }
    return { handlers, window };
}

test('inspection does not start downloads or analysis', async () => {
    let analyses = 0;
    const h = harness({ inspect: () => ({ ready: false, supported: true }), analyze: () => analyses++ });
    assert.deepEqual(await h.handlers.get('speech-search-inspect')(h.window(1)), { ready: false, supported: true });
    assert.equal(analyses, 0);
});

test('cached analysis rejects invalid sources and untrusted frames without downloads', async () => {
    const requests = [];
    const h = harness({ readCached: params => { requests.push(params); return null; } });
    const handler = h.handlers.get('speech-search-cached');
    assert.equal(handler(h.window(1), { sources: ['a.mp4'] }), null);
    assert.equal(requests.length, 1);
    assert.throws(() => handler(h.window(1), { sources: [] }), /invalid_request/);
    const subframe = h.window(1); subframe.senderFrame = {};
    assert.throws(() => handler(subframe, { sources: ['a.mp4'] }), /invalid_sender/);
});

test('export without complete analysis explains why; cancelling import does not touch cache', async () => {
    let dialogsOpened = 0;
    const h = harness({ readCached: () => null }, { choose: async () => { dialogsOpened++; return null; } });
    assert.deepEqual(await h.handlers.get('speech-search-export')(h.window(1), { sources: ['a.mp4'] }), { error: 'missing' });
    assert.equal(dialogsOpened, 0);
    assert.deepEqual(await h.handlers.get('speech-search-import')(h.window(1), { sources: ['a.mp4'] }), { cancelled: true });
    assert.equal(dialogsOpened, 1);
});

test('inspection and analysis forward only base/small models and default to small', async () => {
    const inspected = [], analyzed = [];
    const h = harness({ inspect: params => { inspected.push(params.model); return {}; }, analyze: async params => { analyzed.push(params.model); return {}; } });
    const event = h.window(1);
    for (const model of [undefined, 'Xenova/whisper-base', 'Xenova/whisper-small']) {
        await h.handlers.get('speech-search-inspect')(event, { model });
        await h.handlers.get('speech-search-analyze')(event, { model, jobId: 'model', sources: ['a.mp4'] });
    }
    assert.deepEqual(inspected, ['Xenova/whisper-small', 'Xenova/whisper-base', 'Xenova/whisper-small']);
    assert.deepEqual(analyzed, inspected);
    for (const model of ['Xenova/whisper-tiny', 'small', '../model', '', null, {}, 1]) {
        assert.throws(() => h.handlers.get('speech-search-inspect')(event, { model }), /invalid_request/);
        await assert.rejects(h.handlers.get('speech-search-analyze')(event, { model, jobId: 'bad', sources: ['a.mp4'] }), /invalid_request/);
    }
    assert.equal(analyzed.length, 3);
});

test('analysis isolates progress/cancellation by window and releases the job', async () => {
    let request;
    const h = harness({ analyze: options => {
        request = options;
        options.onProgress({ stage: 'model', percent: 10 });
        return new Promise(resolve => options.signal.addEventListener('abort', () => resolve({ cancelled: true })));
    } });
    const owner = h.window(1);
    const other = h.window(2);
    const work = h.handlers.get('speech-search-analyze')(owner, { jobId: 'abc', sources: ['a.mp4', 'a.mp4'] });
    assert.deepEqual(request.sources, ['a.mp4']);
    assert.deepEqual(owner.sender.sent, [['speech-search-progress', { stage: 'model', percent: 10, jobId: 'abc' }]]);
    assert.equal(h.handlers.get('speech-search-cancel')(other, 'abc'), false);
    assert.equal(h.handlers.get('speech-search-cancel')(owner, 'old-job'), false);
    await assert.rejects(h.handlers.get('speech-search-analyze')(other, { jobId: 'b', sources: ['b.mp4'] }), /busy/);
    assert.equal(h.handlers.get('speech-search-cancel')(owner, 'abc'), true);
    await work;
    request.onProgress({ stage: 'analyze', percent: 99 });
    assert.equal(owner.sender.sent.length, 1, 'cancelled job cannot announce stale progress');
    assert.equal(owner.sender.listenerCount('destroyed'), 0);
    const next = h.handlers.get('speech-search-analyze')(other, { jobId: 'next', sources: ['b.mp4'] });
    other.sender.emit('did-start-loading');
    await next;
    assert.equal(request.signal.aborted, true);
});

test('subframes, invalid job IDs and invalid sources are rejected', async () => {
    const h = harness({ analyze: () => { throw new Error('must not analyze'); } });
    const event = h.window(1);
    await assert.rejects(h.handlers.get('speech-search-analyze')({ ...event, senderFrame: {} }, { jobId: 'a', sources: ['a'] }), /invalid_sender/);
    for (const params of [{}, { jobId: '../a', sources: ['a'] }, { jobId: 'a', sources: [] }, { jobId: 'a', sources: ['a\0b'] }]) {
        await assert.rejects(h.handlers.get('speech-search-analyze')(event, params), /invalid_request/);
    }
});

test('failed jobs do not leave the application permanently busy', async () => {
    let count = 0;
    const h = harness({ analyze: async () => { if (!count++) throw new Error('failure'); return { transcripts: [] }; } });
    const event = h.window(1);
    const params = { jobId: 'a', sources: ['a.mp4'] };
    await assert.rejects(h.handlers.get('speech-search-analyze')(event, params), /failure/);
    assert.deepEqual(await h.handlers.get('speech-search-analyze')(event, params), { transcripts: [] });
});
