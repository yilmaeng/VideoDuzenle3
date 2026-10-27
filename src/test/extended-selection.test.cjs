const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
    const messages = [], timers = new Map();
    let time = 10, serial = 0;
    const player = {
        hasVideo: () => true, getTimelineTime: () => time, getDuration: () => 100,
        video: { paused: true }, pause: () => {}, seekToTimelineTime: value => { time = value; }
    };
    const context = { window: {}, VideoPlayer: player,
        Utils: { clamp: (n, a, b) => Math.max(a, Math.min(b, n)), formatTime: String, formatTimeForSpeech: String },
        Accessibility: { t: (key, fallback, params) => `${key}:${JSON.stringify(params)}`,
            announce: text => messages.push(text), announceSelection: () => messages.push('clear') },
        setTimeout: fn => { timers.set(++serial, fn); return serial; },
        clearTimeout: id => timers.delete(id)
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/scripts/selection.js'), 'utf8'), context);
    const selection = context.window.Selection;
    selection.updateUI = () => {};
    return { selection, player, messages, timers, move(value) { time = value; selection.updateExtended(value); } };
}

test('F8 anchors the cursor and extends in both directions without markers or speech', () => {
    const s = setup();
    s.selection.toggleExtended();
    assert.equal(s.selection.hasSelection(), false);
    s.move(20);
    assert.equal(s.selection.getSelection().start, 10);
    assert.equal(s.selection.getSelection().end, 20);
    s.move(4);
    assert.equal(s.selection.getSelection().start, 4);
    assert.equal(s.selection.getSelection().end, 10);
    assert.equal(s.messages.length, 1);
    s.move(10);
    assert.equal(s.selection.hasSelection(), false);
});

test('Escape cancels and restores the original anchor, not the selected left edge', () => {
    const s = setup();
    s.selection.toggleExtended(); s.move(4); s.selection.cancel();
    assert.equal(s.player.getTimelineTime(), 10);
    assert.equal(s.player.cursorPosition, 10);
    assert.equal(s.selection.extendedAnchor, null);
    assert.equal(s.selection.hasSelection(), false);
});

test('F8 again freezes the selection; successful consuming operations clear the mode', () => {
    const s = setup();
    s.selection.toggleExtended(); s.move(25); s.selection.toggleExtended(); s.move(40);
    assert.equal(s.selection.getSelection().end, 25);
    s.selection.toggleExtended(); s.move(50); s.selection.clear(true); s.move(60);
    assert.equal(s.selection.extendedAnchor, null);
    assert.equal(s.selection.hasSelection(), false);
});

test('fine navigation is silent; coarse navigation announces once and cancellation clears pending speech', () => {
    const s = setup();
    s.selection.toggleExtended(); s.selection.navigationIntent(false); s.move(11);
    assert.equal(s.timers.size, 0);
    assert.equal(s.messages.length, 1);
    s.selection.navigationIntent(true); s.move(16);
    [...s.timers.values()][0]();
    assert.equal(s.messages.length, 2);
    s.selection.navigationIntent(true); s.selection.clear(true);
    assert.equal(s.timers.size, 0);
});

test('loading a saved selection terminates the transient selection mode', () => {
    const s = setup();
    s.selection.toggleExtended(); s.selection.setSelectionSilent(2, 8); s.move(40);
    assert.equal(s.selection.extendedAnchor, null);
    assert.equal(s.selection.getSelection().end, 8);
});

test('Space stops at the selected endpoint instead of returning to playback start', () => {
    const context = { window: {}, Selection: { extendedAnchor: 10 } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/scripts/video-player.js'), 'utf8'), context);
    const player = context.window.VideoPlayer;
    player.isPlaying = true;
    player.playbackStartPosition = 10;
    let pauses = 0;
    player.pause = () => { pauses++; };
    player.seekToTimelineTime = () => assert.fail('must not rewind the extended selection');
    player.togglePlay();
    assert.equal(pauses, 1);
    assert.equal(player.playbackStartPosition, null);
});
