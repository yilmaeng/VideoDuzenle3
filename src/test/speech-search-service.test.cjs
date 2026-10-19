const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { createSpeechSearchService } = require('../main/speech-search-service');
const { inspectNativeWhisper, ensureNativeWhisper, runWhisperChunk } = require('../main/description-whisper-native');

function setup(t, overrides = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-speech-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, 'original.wav');
    const ffmpeg = path.join(root, 'ffmpeg');
    fs.writeFileSync(source, 'original media');
    fs.writeFileSync(ffmpeg, 'executable');
    const calls = { decode: 0, whisper: 0, kill: 0 };
    const nativeWhisper = {
        inspectNativeWhisper: () => ({ runtimeReady: true, modelReady: true }),
        ensureNativeWhisper: async () => ({}),
        runWhisperChunk: async (_runtime, options) => {
            calls.whisper += 1;
            assert.equal(options.offset, 0);
            assert.notEqual(options.sourcePath, source);
            return { words: [{ text: 'hello', start: 0, end: 0.5 }], segments: [{ text: 'hello', start: 0, end: 0.5 }] };
        }
    };
    const spawnProcess = (_command, args) => {
        calls.decode += 1;
        assert.equal(args[args.indexOf('-i') + 1], source);
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => { calls.kill += 1; setImmediate(() => child.emit('close', null)); };
        setImmediate(() => {
            fs.writeFileSync(args.at(-1), Buffer.alloc(16000 * 4));
            child.emit('close', 0);
        });
        return child;
    };
    const config = { cacheDir: path.join(root, 'description-subtitle-cache'), ffmpegPath: ffmpeg,
        platform: 'win32', arch: 'x64', nativeWhisper, spawnProcess, ...overrides };
    return { root, source, calls, config, nativeWhisper, service: createSpeechSearchService(config) };
}

test('contract, shared model directory, completed cache reuse and source immutability', async t => {
    const { service, source, calls, config } = setup(t);
    assert.equal(service.inspect().supported, true);
    assert.equal(service.inspect().ready, true);
    assert.equal(service.inspect().modelCacheDir, path.join(config.cacheDir, 'whisper-models'));
    const original = fs.readFileSync(source);
    const progress = [];
    const result = await service.analyze({ sources: [source], onProgress: item => progress.push(item) });
    assert.equal(result.transcripts[0].words[0].text, 'hello');
    assert.equal(result.transcripts[0].sourcePath, source);
    assert.equal(result.transcripts[0].cacheHit, false);
    assert.ok(progress.every(item => ['model', 'extract', 'analyze', 'complete'].includes(item.stage)));
    assert.equal(progress.at(-1).stage, 'complete');
    const cached = await service.analyze({ sources: [source] });
    assert.equal(cached.transcripts[0].cacheHit, true);
    assert.equal(calls.decode, 1);
    assert.equal(calls.whisper, 1);
    assert.deepEqual(fs.readFileSync(source), original);
    assert.ok(fs.readdirSync(path.join(config.cacheDir, 'speech-search')).every(file => file.endsWith('.json')));
});

test('source and language changes invalidate cache; corrupt cache is repaired', async t => {
    const { service, source, calls, config } = setup(t);
    await service.analyze({ sources: [source] });
    fs.appendFileSync(source, ' changed');
    await service.analyze({ sources: [source] });
    await service.analyze({ sources: [source], language: 'tr' });
    assert.equal(calls.decode, 3);
    for (const file of fs.readdirSync(path.join(config.cacheDir, 'speech-search'))) {
        fs.writeFileSync(path.join(config.cacheDir, 'speech-search', file), '{');
    }
    await service.analyze({ sources: [source] });
    assert.equal(calls.decode, 4);
});

test('search defaults to small and never reuses a base transcript for small analysis', async t => {
    const { service, source, calls } = setup(t);
    assert.equal(service.inspect().model, 'Xenova/whisper-small');
    assert.equal(service.inspect({ model: 'Xenova/whisper-base' }).model, 'Xenova/whisper-base');
    await service.analyze({ sources: [source], model: 'Xenova/whisper-base' });
    const improved = await service.analyze({ sources: [source] });
    assert.equal(improved.transcripts[0].model, 'Xenova/whisper-small');
    assert.equal(calls.whisper, 2);
    const cached = await service.analyze({ sources: [source] });
    assert.equal(cached.transcripts[0].cacheHit, true);
    assert.equal(calls.whisper, 2);
});

test('inspection is read-only and offline analysis reports first-download requirement', async t => {
    const fixture = setup(t);
    fixture.nativeWhisper.inspectNativeWhisper = () => ({ runtimeReady: false, modelReady: false });
    assert.equal(fixture.service.inspect().downloadRequired, true);
    assert.equal(fs.existsSync(fixture.config.cacheDir), false);
    await assert.rejects(fixture.service.analyze({ sources: [fixture.source], allowDownload: false }), { code: 'SPEECH_SEARCH_DOWNLOAD_REQUIRED' });
    assert.equal(fixture.calls.decode, 0);
});

test('pre-abort and abort during transcription never cache partial results', async t => {
    const { service, source, config, nativeWhisper } = setup(t);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(service.analyze({ sources: [source], signal: controller.signal }), { name: 'AbortError' });
    const live = new AbortController();
    nativeWhisper.runWhisperChunk = async (_runtime, options) => {
        assert.equal(options.signal, live.signal);
        live.abort();
        return { words: [], segments: [] };
    };
    await assert.rejects(service.analyze({ sources: [source], signal: live.signal }), { name: 'AbortError' });
    assert.deepEqual(fs.readdirSync(path.join(config.cacheDir, 'speech-search')), []);
});

test('ffmpeg cancellation kills process and waits for close before cleanup', async t => {
    let started;
    const start = new Promise(resolve => { started = resolve; });
    let killed = false;
    const fixture = setup(t, { spawnProcess: () => {
        const child = new EventEmitter();
        child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.kill = () => { killed = true; setImmediate(() => child.emit('close', null)); };
        started();
        return child;
    } });
    const controller = new AbortController();
    const promise = fixture.service.analyze({ sources: [fixture.source], signal: controller.signal });
    await start;
    controller.abort();
    await assert.rejects(promise, { name: 'AbortError' });
    assert.equal(killed, true);
    assert.deepEqual(fs.readdirSync(path.join(fixture.config.cacheDir, 'speech-search')), []);
});

test('macOS uses isolated transformer worker and cancellation terminates it', async t => {
    let startWorker;
    const started = new Promise(resolve => { startWorker = resolve; });
    let terminated = false;
    class FakeWorker extends EventEmitter {
        constructor(_filename, options) {
            super();
            assert.equal(options.workerData.speechSearch, true);
            startWorker();
        }
        async terminate() { terminated = true; return 0; }
    }
    const fixture = setup(t, { platform: 'darwin', arch: 'arm64', WorkerClass: FakeWorker });
    assert.equal(fixture.service.inspect().backend, 'transformers');
    assert.equal(fixture.service.inspect().ready, false);
    const controller = new AbortController();
    const promise = fixture.service.analyze({ sources: [fixture.source], signal: controller.signal });
    await started;
    controller.abort();
    await assert.rejects(promise, { name: 'AbortError' });
    assert.equal(terminated, true);
});

test('native helper inspection and pre-abort remain optional for old callers', async t => {
    const { config } = setup(t);
    const state = inspectNativeWhisper({ modelCacheDir: path.join(config.cacheDir, 'whisper-models'), platform: 'win32', arch: 'x64' });
    assert.equal(state.ready, false);
    assert.equal(state.root, path.join(config.cacheDir, 'whisper-cpp'));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(ensureNativeWhisper({ signal: controller.signal }), { name: 'AbortError' });
    await assert.rejects(runWhisperChunk({}, { signal: controller.signal }), { name: 'AbortError' });
});

test('source modification during inference rejects rather than caching stale timing', async t => {
    const fixture = setup(t);
    fixture.nativeWhisper.runWhisperChunk = async () => {
        fs.appendFileSync(fixture.source, 'external edit');
        return { words: [], segments: [] };
    };
    await assert.rejects(fixture.service.analyze({ sources: [fixture.source] }), /speech_search_source_changed/);
    assert.deepEqual(fs.readdirSync(path.join(fixture.config.cacheDir, 'speech-search')), []);
});

test('native streamed model download abort removes partial files', async t => {
    if (process.platform !== 'win32' || process.arch !== 'x64') return t.skip('native Windows runtime');
    const fixture = setup(t);
    const modelCacheDir = path.join(fixture.config.cacheDir, 'whisper-models');
    const info = inspectNativeWhisper({ modelCacheDir });
    fs.mkdirSync(path.dirname(info.executable), { recursive: true });
    fs.writeFileSync(info.executable, 'existing runtime');
    const controller = new AbortController();
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });
    global.fetch = async (_url, options) => {
        assert.equal(options.signal, controller.signal);
        return new Response(new ReadableStream({
            start(stream) { stream.enqueue(new Uint8Array(128)); }
        }), { headers: { 'content-length': '1000000' } });
    };
    await assert.rejects(ensureNativeWhisper({ modelCacheDir, signal: controller.signal,
        onProgress: () => controller.abort() }), { name: 'AbortError' });
    assert.deepEqual(fs.readdirSync(path.dirname(info.modelPath)), []);
});

test('native Whisper abort kills the child and removes its output', async t => {
    const childProcess = require('child_process');
    const modulePath = require.resolve('../main/description-whisper-native');
    const savedModule = require.cache[modulePath];
    const originalSpawn = childProcess.spawn;
    let killed = false;
    let output;
    childProcess.spawn = (_exe, args) => {
        output = `${args[args.indexOf('-of') + 1]}.json`;
        fs.writeFileSync(output, '{}');
        const child = new EventEmitter();
        child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.kill = () => { killed = true; setImmediate(() => child.emit('close', null)); };
        return child;
    };
    delete require.cache[modulePath];
    const isolated = require(modulePath);
    childProcess.spawn = originalSpawn;
    require.cache[modulePath] = savedModule;
    t.after(() => { if (output) fs.rmSync(output, { force: true }); });
    const controller = new AbortController();
    const promise = isolated.runWhisperChunk({ executable: 'whisper.exe', modelPath: 'model.bin' },
        { duration: 1, offset: 0, sourcePath: 'analysis.wav', signal: controller.signal });
    controller.abort();
    await assert.rejects(promise, { name: 'AbortError' });
    assert.equal(killed, true);
    assert.equal(fs.existsSync(output), false);
});

test('chunked native timing is source-relative and concurrent jobs fail explicitly', async t => {
    const fixture = setup(t, { spawnProcess: (_exe, args) => {
        const child = new EventEmitter();
        child.stdout = new PassThrough(); child.stderr = new PassThrough();
        setImmediate(() => { fs.writeFileSync(args.at(-1), Buffer.alloc(61 * 16000 * 4)); child.emit('close', 0); });
        return child;
    } });
    let chunk = 0;
    fixture.nativeWhisper.runWhisperChunk = async () => {
        chunk += 1;
        return { words: chunk === 1
            ? [{ text: 'first', start: 0, end: 0.5 }, { text: 'boundary', start: 59.8, end: 60.4 }]
            : [{ text: 'boundary', start: 1.8, end: 2.4 }, { text: 'last', start: 2.5, end: 2.5 }], segments: [] };
    };
    const promise = fixture.service.analyze({ sources: [fixture.source] });
    await assert.rejects(fixture.service.analyze({ sources: [fixture.source] }), /speech_search_busy/);
    const result = await promise;
    assert.deepEqual(result.transcripts[0].words.map(word => word.start), [0, 59.8, 60.5]);
    assert.equal(result.transcripts[0].words.filter(word => word.text === 'boundary').length, 1);
    assert.ok(result.transcripts[0].words.every(word => word.end > word.start));
    assert.equal(result.transcripts[0].duration, 61);
});

test('bundled ffmpeg extracts analysis audio without modifying original', async t => {
    const fixture = setup(t);
    const wave = Buffer.alloc(44 + 16000 * 2);
    wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
    wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
    wave.writeUInt32LE(16000, 24); wave.writeUInt32LE(32000, 28);
    wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36);
    wave.writeUInt32LE(wave.length - 44, 40);
    fs.writeFileSync(fixture.source, wave);
    const service = createSpeechSearchService({ ...fixture.config,
        ffmpegPath: require('@ffmpeg-installer/ffmpeg').path,
        ffprobePath: require('@ffprobe-installer/ffprobe').path, spawnProcess: undefined });
    const result = await service.analyze({ sources: [fixture.source] });
    assert.equal(result.transcripts[0].duration, 1);
    assert.deepEqual(fs.readFileSync(fixture.source), wave);
});

test('returned paths preserve request spelling while canonical cache is shared', async t => {
    const fixture = setup(t);
    const alias = `${fixture.root}${path.sep}.${path.sep}original.wav`;
    const first = await fixture.service.analyze({ sources: [alias] });
    assert.equal(first.transcripts[0].sourcePath, alias);
    const second = await fixture.service.analyze({ sources: [fixture.source] });
    assert.equal(second.transcripts[0].sourcePath, fixture.source);
    assert.equal(second.transcripts[0].cacheHit, true);
    const third = await fixture.service.analyze({ sources: [alias] });
    assert.equal(third.transcripts[0].sourcePath, alias);
    assert.equal(third.transcripts[0].cacheHit, true);
    assert.equal(fixture.calls.decode, 1);
});
