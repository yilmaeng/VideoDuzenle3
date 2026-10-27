const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(readyState) {
    const source = fs.readFileSync(path.join(__dirname, '../renderer/scripts/app.js'), 'utf8');
    const start = source.indexOf('    async restoreProjectPlaybackPosition(');
    const end = source.indexOf('\n    /**', start);
    const media = new EventTarget(); media.readyState = readyState;
    const calls = [];
    const player = { video: media, getDuration: () => 80,
        pause: () => calls.push('pause'),
        seekToTimelineTime: async p => { await Promise.resolve(); calls.push(p); },
        updateUI: () => calls.push('ui') };
    const app = vm.runInNewContext(`({${source.slice(start, end)}})`, { VideoPlayer: player, setTimeout, clearTimeout });
    app.t = key => key;
    return { app, player, media, calls };
}

test('project restore waits for metadata and restores playback and editing cursor', async () => {
    const { app, player, media, calls } = fixture(0);
    const pending = app.restoreProjectPlaybackPosition(23.5);
    assert.deepEqual(calls, []);
    media.readyState = 1;
    media.dispatchEvent(new Event('loadedmetadata'));
    await pending;
    assert.deepEqual(calls, ['pause', 23.5, 'ui']);
    assert.equal(player.cursorPosition, 23.5);
    assert.equal(player.playbackStartPosition, null);
});

test('already loaded media restores immediately and clamps stale positions', async () => {
    const { app, player } = fixture(1);
    await app.restoreProjectPlaybackPosition(120);
    assert.equal(player.cursorPosition, 80);
    await app.restoreProjectPlaybackPosition(-4);
    assert.equal(player.cursorPosition, 0);
});

test('media errors stop restoration instead of silently losing saved position', async () => {
    const { app, media, calls } = fixture(0);
    const pending = app.restoreProjectPlaybackPosition(23);
    media.dispatchEvent(new Event('error'));
    await assert.rejects(pending, /video_file_open_failed/);
    assert.deepEqual(calls, []);
});

test('technical frame prompt is not announced and overlay labels are provider-neutral', () => {
    const source = fs.readFileSync(path.join(__dirname, '../renderer/scripts/dialogs.js'), 'utf8');
    assert(!source.includes('Accessibility.announce(context)'));
    for (const locale of ['tr', 'en', 'de', 'es', 'fr']) {
        const data = JSON.parse(fs.readFileSync(path.join(__dirname, `../locales/${locale}.json`), 'utf8'));
        const visit = value => { for (const [key, item] of Object.entries(value)) {
            if (key === 'ai_suggest' && typeof item === 'string') assert(!item.includes('(Gemini)'));
            if (item && typeof item === 'object') visit(item);
        } };
        visit(data);
    }
});
