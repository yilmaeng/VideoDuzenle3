const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(anchor = 10, endpoint = 20) {
    const events = {};
    const ctx = { window: {}, console, setTimeout, clearTimeout,
        document: { getElementById: () => null },
        Timeline: { segments: [], timelineToSource: n => n },
        Utils: { clamp: (n,a,b) => Math.max(a,Math.min(b,n)), formatTime: String, formatTimeForSpeech: String },
        Accessibility: { t: key => key, announce() {}, announceError() {}, announcePlayState() {}, announceSelection() {} }
    };
    vm.createContext(ctx);
    for (const file of ['video-player.js', 'selection.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/scripts', file), 'utf8'), ctx);
    }
    const p = ctx.window.VideoPlayer, s = ctx.window.Selection;
    p.video = { currentTime: anchor, duration: 100, paused: true,
        addEventListener: (name, fn) => { events[name] = fn; },
        pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); }
    };
    p.hasVideo = () => true;
    p.getDuration = () => 100;
    p.getTimelineTime = () => p.video.currentTime;
    p.updateCursorDisplay = () => {};
    p.applyEffectivePlaybackVolume = () => {};
    p.syncSegmentProperties = () => {};
    p.skipDeletedSegments = () => {};
    p.updateTimeDisplay = () => s.updateExtended(p.getTimelineTime());
    p.seekToTimelineTime = n => { s.updateExtended(n); p.video.currentTime = n; };
    p.play = () => p.video.play();
    s.updateUI = () => {};
    p.setupEventListeners();
    s.toggleExtended();
    p.video.currentTime = endpoint; s.updateExtended(endpoint);
    p.cursorPosition = endpoint;
    return { p,s,events,range: JSON.stringify(s.getSelection()) };
}

for (const method of ['playSelection', 'playCutPreview']) {
    for (const reverse of [false, true]) {
        test(`${method}: ${reverse ? 'reverse' : 'forward'} selection and position survive completion`, async () => {
            const { p,s,events,range } = setup(reverse ? 20 : 10, reverse ? 10 : 20);
            const origin = p.getTimelineTime();
            await p[method]();
            p.updateTimeDisplay();
            events.timeupdate(); // Observe the initial seek before advancing playback.
            assert.equal(JSON.stringify(s.getSelection()), range);
            p.video.currentTime = method === 'playSelection' ? p.rangeEnd : p.cutPreviewEnd;
            events.timeupdate();
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(JSON.stringify(s.getSelection()), range);
            assert.equal(p.getTimelineTime(), origin);
            assert.equal(p.cursorPosition, origin);
            assert.notEqual(s.extendedAnchor, null);
            assert.equal(p.selectionPreviewState, null);
        });
    }
}

test('manual stop restores position, then ordinary navigation extends again', async () => {
    const { p,s,range } = setup();
    await p.playCutPreview(); p.video.currentTime = 7; p.updateTimeDisplay(); p.pause();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(p.getTimelineTime(), 20);
    assert.equal(JSON.stringify(s.getSelection()), range);
    p.seekToTimelineTime(25);
    assert.equal(s.getSelection().end, 25);
});

test('Escape during preview returns to the anchor rather than restoring the preview endpoint', async () => {
    const { p,s } = setup();
    await p.playCutPreview(); s.cancel();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(p.getTimelineTime(), 10);
    assert.equal(s.hasSelection(), false);
    assert.equal(s.extendedAnchor, null);
    assert.equal(p.selectionPreviewState, null);
});

test('tracking stays suspended during an asynchronous source restoration', async () => {
    const { p,s,range } = setup();
    await p.playSelection();
    let finish;
    p.seekToTimelineTime = target => new Promise(resolve => { finish = () => { p.video.currentTime = target; resolve(); }; });
    p.pause(); s.updateExtended(3);
    assert.equal(JSON.stringify(s.getSelection()), range);
    assert.ok(p.selectionPreviewState);
    finish(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(p.getTimelineTime(), 20);
    assert.equal(p.selectionPreviewState, null);
});
