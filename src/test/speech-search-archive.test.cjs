const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSpeechSearchService } = require('../main/speech-search-service');
const { createArchive, importArchive, writeArchive, validateArchive, createProjectAnalysis, restoreProjectAnalysis } = require('../main/speech-search-archive');

function setup(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-transcript-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const source = path.join(dir, 'original.mp4');
    fs.writeFileSync(source, 'media bytes 123');
    const service = createSpeechSearchService({ cacheDir: path.join(dir, 'cache'), ffmpegPath: 'unused', platform: 'win32', arch: 'x64' });
    const result = { sourcePath: source, model: 'Xenova/whisper-small', duration: 20,
        words: [{ text: 'kulaklığım', start: 3.25, end: 3.9 }],
        segments: [{ text: 'kulaklığım', start: 3, end: 4 }], transcript: 'kulaklığım' };
    return { dir, source, service, result, file: path.join(dir, 'saved.evdtranscript') };
}

test('archive preserves word timings and binds relocated media by content, across backends', async t => {
    const { dir, source, service, result, file } = setup(t);
    await service.storeImported([result]);
    const text = await createArchive(service, [source]);
    assert.equal(text.includes(dir.replaceAll('\\', '\\\\')), false);
    await writeArchive(file, text, [source]);
    const renamed = path.join(dir, 'renamed video.mp4');
    fs.copyFileSync(source, renamed);
    const mac = createSpeechSearchService({ cacheDir: path.join(dir, 'mac-cache'), ffmpegPath: 'unused', platform: 'darwin', arch: 'arm64' });
    const imported = await importArchive(mac, file, [renamed]);
    assert.equal(imported.transcripts[0].sourcePath, renamed);
    assert.deepEqual(imported.transcripts[0].words, result.words);
    assert.deepEqual(mac.readCached({ sources: [renamed] }).transcripts[0].words, result.words);
    assert.equal(fs.readFileSync(source, 'utf8'), 'media bytes 123');
});

test('different content of equal size is rejected without changing existing cache', async t => {
    const { source, service, result, file } = setup(t);
    await service.storeImported([result]);
    await writeArchive(file, await createArchive(service, [source]), [source]);
    fs.writeFileSync(source, 'media bytes 456');
    await assert.rejects(importArchive(service, file, [source]), /mismatch/);
    assert.equal(service.readCached({ sources: [source] }), null);
});

test('all current sources must match before any imported cache is written', async t => {
    const { dir, source, service, result, file } = setup(t);
    await service.storeImported([result]);
    await writeArchive(file, await createArchive(service, [source]), [source]);
    const other = path.join(dir, 'other.mp4'); fs.writeFileSync(other, 'different');
    let writes = 0;
    const target = { storeImported: async () => writes++ };
    await assert.rejects(importArchive(target, file, [source, other]), /mismatch/);
    assert.equal(writes, 0);
});

test('missing cache, malformed data and unsupported schema cannot silently produce an archive', async t => {
    const { source, service, result, file } = setup(t);
    await assert.rejects(createArchive(service, [source]), /missing/);
    fs.writeFileSync(file, '{bad json');
    await assert.rejects(importArchive(service, file, [source]), /invalid/);
    await service.storeImported([result]);
    const data = JSON.parse(await createArchive(service, [source]));
    assert.throws(() => validateArchive({ ...data, version: 999 }), /invalid/);
    data.sources[0].analysis.words[0].end = 999;
    assert.throws(() => validateArchive(data), /invalid/);
    fs.writeFileSync(file, Buffer.alloc(32 * 1024 * 1024 + 1));
    await assert.rejects(importArchive(service, file, [source]), /invalid/);
});

test('export cannot overwrite source media and writes the requested file atomically', async t => {
    const { source, file } = setup(t);
    await assert.rejects(writeArchive(source, 'invalid', [source]), /invalid/);
    assert.equal(fs.readFileSync(source, 'utf8'), 'media bytes 123');
    await writeArchive(file, 'first', [source]);
    await writeArchive(file, 'second', [source]);
    assert.equal(fs.readFileSync(file, 'utf8'), 'second');
});

test('latest imported model is restored automatically without requiring an installed model', async t => {
    const { source, service, result } = setup(t);
    await service.storeImported([{ ...result, analyzedAt: '2026-01-01T00:00:00Z' }]);
    await service.storeImported([{ ...result, model: 'Xenova/whisper-base', importedAt: '2026-10-12T00:00:00Z' }]);
    assert.equal(service.readCached({ sources: [source] }).transcripts[0].model, 'Xenova/whisper-base');
    assert.equal(service.readCached({ sources: [source], model: 'Xenova/whisper-small' }).transcripts[0].model, 'Xenova/whisper-small');
});

test('project embeds available analysis and restores on a clean computer with relocated sources', async t => {
    const { dir, source, service, result } = setup(t);
    const other = path.join(dir, 'unanalysed.mp4'); fs.writeFileSync(other, 'other video');
    assert.equal(await createProjectAnalysis(service, [source, other]), null);
    await service.storeImported([result]);
    const project = JSON.parse(JSON.stringify({ speechAnalysis: await createProjectAnalysis(service, [source, other]) }));
    assert.equal(project.speechAnalysis.sources.length, 1);
    assert.equal(project.speechAnalysis.sources[0].sourcePath, source);
    const moved = path.join(dir, 'friend video.mp4'); fs.copyFileSync(source, moved);
    const fresh = createSpeechSearchService({ cacheDir: path.join(dir, 'clean-cache'), ffmpegPath: 'not-installed' });
    await restoreProjectAnalysis(fresh, project.speechAnalysis, [{ from: source, to: moved }, { from: other, to: other }]);
    assert.deepEqual(fresh.readCached({ sources: [moved, other], allowPartial: true }).transcripts[0].words, result.words);
    assert.equal(fresh.readCached({ sources: [moved, other] }), null);
    const savedAgain = await createProjectAnalysis(fresh, [moved, other]);
    assert.equal(savedAgain.sources[0].sourcePath, moved);
    assert.deepEqual(savedAgain.sources[0].analysis.words, result.words);
});

test('project restore rejects missing bindings and changed source content', async t => {
    const { source, service, result } = setup(t);
    await service.storeImported([result]);
    const data = await createProjectAnalysis(service, [source]);
    await assert.rejects(restoreProjectAnalysis(service, data, []), /mismatch/);
    fs.writeFileSync(source, 'modified video');
    await assert.rejects(restoreProjectAnalysis(service, data, [{ from: source, to: source }]), /mismatch/);
});
