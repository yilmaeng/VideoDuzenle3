const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { openRemembered } = require('../main/remembered-open-dialog');

test('slideshow photo, video, audio, karaoke and project pickers share folder memory', () => {
    const source = fs.readFileSync(path.join(__dirname, '../main/slideshow-handler.js'), 'utf8');
    assert.equal((source.match(/await openSlideshowFileDialog\(/g) || []).length, 5);
    assert(!source.includes('dialog.showOpenDialog('));
    assert(source.includes('openRemembered(dialog, owner, options, i18n.store)'));
});

test('different file filters and windows reuse the same last input folder', async () => {
    let saved = process.cwd();
    const store = { get: () => saved, set: (_key, value) => { saved = value; } };
    const folders = [path.join(process.cwd(), 'src'), path.join(process.cwd(), 'src/main')];
    for (const [index, extension] of ['png', 'mp4', 'mp3', 'srt'].entries()) {
        const previous = saved;
        const folder = folders[index % folders.length];
        const owner = { index };
        const filters = [{ name: extension, extensions: [extension] }];
        await openRemembered({ showOpenDialog: async (actualOwner, options) => {
            assert.equal(actualOwner, owner);
            assert.equal(options.defaultPath, previous);
            assert.deepEqual(options.filters, filters);
            return { canceled: false, filePaths: [path.join(folder, `sample.${extension}`)] };
        } }, owner, { filters, properties: ['openFile'] }, store);
        assert.equal(saved, folder);
    }
});

test('last selected directory is reused, including across helper calls', async () => {
    let saved;
    const store = { get: () => saved, set: (_key, value) => { saved = value; } };
    const folder = process.cwd();
    await openRemembered({ showOpenDialog: async () => ({ canceled: false, filePaths: [path.join(folder, 'test.mp4')] }) }, null, {}, store);
    assert.equal(saved, folder);
    await openRemembered({ showOpenDialog: async (_owner, options) => {
        assert.equal(options.defaultPath, folder);
        return { canceled: true, filePaths: [] };
    } }, null, {}, store);
    assert.equal(saved, folder);
});

test('explicit paths are retained and missing remembered folders are ignored', async () => {
    const store = { get: () => path.join(process.cwd(), 'nonexistent-open-dialog-test-folder'), set: () => assert.fail('cancel must not save') };
    for (const options of [{}, { defaultPath: process.cwd() }]) {
        await openRemembered({ showOpenDialog: async (_owner, actual) => {
            assert.equal(actual.defaultPath, options.defaultPath);
            return { canceled: true, filePaths: [] };
        } }, null, options, store);
    }
});
