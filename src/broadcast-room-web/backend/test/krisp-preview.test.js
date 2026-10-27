const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../frontend/public/krisp-preview.js'), 'utf8');

function harness({ supported = true, failure = false } = {}) {
    const control = { checked: false, disabled: false };
    const music = { checked: false };
    const messages = [];
    let loads = 0, starts = 0, stops = 0;
    const processor = {
        setEnabled: async () => { if (failure) throw new Error('authorization'); },
        isEnabled: () => true,
        destroy: async () => {}
    };
    const root = { 'LiveKit Noise Filter': {
        isKrispNoiseFilterSupported: () => supported,
        KrispNoiseFilter: options => {
            assert.equal(options.useBVC, true);
            return processor;
        }
    }};
    const context = {
        window: root, console: { warn() {} }, setTimeout, clearTimeout,
        document: {
            createElement: () => ({ remove() {} }),
            head: { appendChild: s => { loads++; s.onload(); } }
        }
    };
    vm.runInNewContext(source, context);
    const apply = root.createEvdKrispPreview({ control, music, announce: m => messages.push(m), translate: k => k });
    const track = {
        mediaStreamTrack: { readyState: 'live' },
        setProcessor: async () => { starts++; },
        stopProcessor: async () => { stops++; }
    };
    return { apply, track, control, music, messages, stats: () => ({ loads, starts, stops }) };
}

test('explicitly unchecked control performs no downloads, capture or processing', async () => {
    const h = harness();
    await h.apply(h.track);
    assert.deepEqual(h.stats(), { loads: 0, starts: 0, stops: 0 });
});
test('BVC activation is idempotent and music mode removes it', async () => {
    const h = harness();
    h.control.checked = true;
    await h.apply(h.track);
    await h.apply(h.track);
    assert.equal(h.stats().starts, 1);
    h.music.checked = true;
    await h.apply(h.track);
    assert.equal(h.stats().stops, 1);
    assert.equal(h.control.disabled, true);
});
test('unsupported device and authorization failure leave normal audio available', async () => {
    for (const options of [{ supported: false }, { failure: true }]) {
        const h = harness(options);
        h.control.checked = true;
        await h.apply(h.track);
        assert.equal(h.control.checked, false);
        assert.equal(h.track.mediaStreamTrack.readyState, 'live');
        assert.equal(h.messages.at(-1), 'krisp_preview.failed');
    }
});
test('a replacement microphone track gets a new processor', async () => {
    const h = harness();
    h.control.checked = true;
    await h.apply(h.track);
    await h.apply({ ...h.track });
    assert.equal(h.stats().starts, 2);
    assert.equal(h.stats().loads, 1);
});
test('all active locales contain the preview labels', () => {
    for (const locale of ['tr', 'en', 'de', 'es', 'fr']) {
        const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../locales', `${locale}.json`), 'utf8'));
        for (const key of ['label', 'hint', 'loading', 'ready', 'failed']) assert.ok(data.krisp_preview[key]);
    }
});
