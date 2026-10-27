const test = require('node:test');
const assert = require('node:assert/strict');
const { binding, matches } = require('../renderer/scripts/recording-navigation.cjs');
const { recordingFilename, nameCompletedRecording } = require('../studio/recording-filename');

test('localized defaults match all locale files and respect custom bindings', () => {
    for (const lang of ['tr', 'en', 'de', 'es', 'fr']) {
        const locale = require(`../locales/${lang}.json`).recording_navigation;
        assert.equal(binding('recordingWizardNext', lang), locale.next_shortcut);
        assert.equal(binding('recordingWizardBack', lang), locale.back_shortcut);
    }
    assert.equal(binding('recordingWizardNext', 'tr', { recordingWizardNext: '' }), null);
    assert.equal(binding('recordingWizardNext', 'tr', { recordingWizardNext: 'Ctrl+F8' }), 'Ctrl+F8');
});
test('navigation requires exact modifiers and rejects repeat', () => {
    const e = { key: 'r', code: 'KeyR', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false };
    assert.ok(matches(e, 'Alt+R'));
    assert.ok(!matches({ ...e, ctrlKey: true }, 'Alt+R'));
    assert.ok(!matches({ ...e, repeat: true }, 'Alt+R'));
    assert.ok(!matches({ ...e, altKey: false }, 'Alt+R'));
});
test('recording names preserve localized dates and safe readable time', () => {
    const name = recordingFilename(new Date(2026, 9, 24, 10, 25, 8), 'tr', 'Saat');
    assert.match(name, /24 Ekim 2026 Saat 10\.25\.08/);
    assert.ok(!/[<>:"/\\|?*%]/.test(name));
});
test('completed recording receives readable name without replacing existing files', async () => {
    const fs = require('fs'), path = require('path'), os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-name-test-'));
    try {
        const source = path.join(dir, '2026-old.mkv');
        fs.writeFileSync(source, 'original recording');
        fs.writeFileSync(path.join(dir, 'readable.mkv'), 'other recording');
        const result = await nameCompletedRecording(source, 'readable');
        assert.equal(path.basename(result), 'readable (2).mkv');
        assert.equal(fs.readFileSync(result, 'utf8'), 'original recording');
        assert.equal(fs.readFileSync(path.join(dir, 'readable.mkv'), 'utf8'), 'other recording');
        assert.equal(fs.existsSync(source), false);
        assert.equal(await nameCompletedRecording(result, 'readable (2)'), result);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
