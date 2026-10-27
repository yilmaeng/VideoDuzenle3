const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
    const source = fs.readFileSync(path.join(__dirname, '../renderer/scripts/description-subtitle-phase5.js'), 'utf8');
    const body = source.slice(source.indexOf('    function handleAudioShortcut('), source.indexOf('    function bind()'));
    const items = [{ id: 'one', ttsAudioPath: 'one.wav' }, { id: 'two', ttsAudioPath: 'two.wav' }];
    const previews = [], statuses = [];
    const app = { state: { selectedEventId: 'one' }, setDirty(value) { this.dirty = value; } };
    const context = { window: { EvdDescriptionTimeline: { matchesShortcut: (key, event) => key === event.action } },
        events: () => items, defaults: () => ({ ttsVolume: 80, originalVolume: 0.9 }), editor: () => app,
        clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
        setStatus: (...args) => statuses.push(args), playMixedPreview: item => previews.push(item.id) };
    vm.runInNewContext(body + '\nthis.run = handleAudioShortcut;', context);
    const run = action => context.run({ action, preventDefault() {}, stopPropagation() {} });
    return { run, items, previews, statuses, app };
}

test('audio keys adjust only the focused event and replay with the new values', () => {
    const { run, items, previews, app } = fixture();
    assert(run('descriptionVoiceUp'));
    assert.equal(items[0].ttsVolume, 85);
    run('descriptionOriginalDown');
    assert.equal(items[0].originalVolume, 0.85);
    run('descriptionRateUp');
    assert.equal(items[0].ttsPlaybackRate, 1.05);
    run('descriptionRateReset');
    assert.equal(items[0].ttsPlaybackRate, 1);
    assert.deepEqual(items[1], { id: 'two', ttsAudioPath: 'two.wav' });
    assert.equal(previews.length, 4);
    assert.equal(app.dirty, true);
});

test('bounds and missing audio are handled without synthesis', () => {
    const { run, items, previews } = fixture();
    items[0].ttsVolume = 200;
    run('descriptionVoiceUp');
    assert.equal(items[0].ttsVolume, 200);
    items[0].ttsPlaybackRate = 0.5;
    run('descriptionRateDown');
    assert.equal(items[0].ttsPlaybackRate, 0.5);
    items[0].ttsAudioPath = '';
    run('descriptionOriginalUp');
    assert.equal(previews.length, 2);
    assert.equal(run('unrelated'), false);
});

test('all seven shortcut labels and help exist in every locale', () => {
    for (const locale of ['tr', 'en', 'de', 'es', 'fr']) {
        const data = JSON.parse(fs.readFileSync(path.join(__dirname, `../locales/${locale}.json`), 'utf8'));
        for (const key of ['descriptionVoiceUp','descriptionVoiceDown','descriptionOriginalUp','descriptionOriginalDown','descriptionRateUp','descriptionRateDown','descriptionRateReset']) {
            assert(data.dialog.keyboard_manager.actions[key]);
        }
        assert(data.description_subtitle_editor.audio_shortcuts_help);
    }
});
