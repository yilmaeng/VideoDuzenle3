const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { sourceSaveOptions } = require('../main/source-save-dialog');
test('audio, video and relative Save As names start beside the source', () => {
    const source = path.resolve('fixtures', 'Media', 'concert.mp4');
    for (const ext of ['mp3', 'wav', 'mp4', 'mov']) {
        assert.equal(sourceSaveOptions({ filters: [{ extensions: [ext] }] }, source).defaultPath,
            path.join(path.dirname(source), `concert_saved.${ext}`));
    }
    assert.equal(sourceSaveOptions({ defaultPath: 'result.mp4' }, source).defaultPath,
        path.join(path.dirname(source), 'result.mp4'));
});
test('explicit output destinations are preserved and per-selection source overrides active tab', () => {
    const target = path.resolve('another', 'export.mp4');
    assert.equal(sourceSaveOptions({ defaultPath: target }, path.resolve('source.mp4')).defaultPath, target);
    const source = path.resolve('queue', 'clip.mp4');
    const options = sourceSaveOptions({ sourceFilePath: source, defaultPath: 'selection.mp4' }, path.resolve('other.mp4'));
    assert.equal(options.defaultPath, path.join(path.dirname(source), 'selection.mp4'));
    assert.equal('sourceFilePath' in options, false);
    assert.deepEqual(sourceSaveOptions({ defaultPath: 'new.mp4' }, null), { defaultPath: 'new.mp4' });
});
