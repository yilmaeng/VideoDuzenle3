const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const core = require('../renderer/scripts/speech-search-core.js');

const word = (text, start, end = start + 1) => ({ text, start, end });
function search(words, query, segments = [{ start: 0, end: 20 }], extra = {}) {
    return core.search({ transcripts: [{ sourcePath: 'a.mp4', words }],
        sourceFile: 'a.mp4', segments, query, ...extra });
}

test('CommonJS and browser UMD expose the same pure API', () => {
    assert.deepEqual(Object.keys(core), ['search']);
    const context = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/scripts/speech-search-core.js'), 'utf8'), context);
    assert.equal(typeof context.window.SpeechSearchCore.search, 'function');
    assert.equal(context.window.SpeechSearchCore.search().length, 0);
});

test('maps trimmed source timestamps using speed and accumulated edited duration', () => {
    assert.deepEqual(search([word('hello', 12, 14)], 'hello', [
        { sourceFile: 'b.mp4', start: 30, end: 34, speed: 2 },
        { start: 10, end: 20, speed: 0.5 }
    ]), [{ text: 'hello', start: 6, end: 10, sourcePath: 'a.mp4', sourceStart: 12, approximate: false }]);
});

test('preserves repeated/pasted occurrences and source-specific offsets', () => {
    const results = search([word('hello', 2)], 'hello', [
        { start: 0, end: 4 }, { sourceFile: 'b.mp4', start: 0, end: 4 },
        { start: 0, end: 4, speed: 2 }
    ], { transcripts: [
        { sourcePath: 'a.mp4', words: [word('hello', 2)] },
        { sourcePath: 'b.mp4', words: [word('hello', 1)] }
    ] });
    assert.deepEqual(results.map(hit => [hit.start, hit.end, hit.sourcePath]),
        [[2, 3, 'a.mp4'], [5, 6, 'b.mp4'], [9, 9.5, 'a.mp4']]);
});

test('deleted source intervals and partially cut words are excluded', () => {
    const segments = [{ start: 0, end: 1 }, { start: 3, end: 5 }];
    assert.deepEqual(search([word('removed', 1, 3)], 'removed', segments), []);
    assert.deepEqual(search([word('partial', 0.5, 1.5)], 'partial', segments), []);
    assert.deepEqual(search([word('hello', 0), word('world', 3)], 'hello world', segments), []);
});

test('even tiny deleted gaps cannot be bridged', () => {
    assert.deepEqual(search([word('hello', 0, 1), word('world', 1.01, 2)], 'hello world',
        [{ start: 0, end: 1 }, { start: 1.01, end: 3 }]), []);
});

test('phrases cross continuous timeline splits with independent speeds', () => {
    const results = search([word('hello', 1, 2), word('world', 2, 4)], 'hello world', [
        { start: 0, end: 2, speed: 2 }, { start: 2, end: 6, speed: 0.5 }
    ]);
    assert.equal(results.length, 1);
    assert.equal(results[0].start, 0.5);
    assert.equal(results[0].end, 5);
});

test('words crossing a continuous speed split map once', () => {
    const results = search([word('hello', 1, 3)], 'hello', [
        { start: 0, end: 2, speed: 2 }, { start: 2, end: 4 }
    ]);
    assert.equal(results.length, 1);
    assert.equal(results[0].start, 0.5);
    assert.equal(results[0].end, 2);
});

test('phrases never cross different clips or a repeated source restart', () => {
    const words = [word('hello', 0), word('world', 1)];
    assert.deepEqual(search(words, 'hello world', [
        { start: 0, end: 1 }, { start: 1, end: 2, sourceFile: 'b.mp4' }
    ], { transcripts: [{ sourcePath: 'a.mp4', words }, { sourcePath: 'b.mp4', words }] }), []);
    assert.deepEqual(search([word('world', 0), word('hello', 1)], 'hello world',
        [{ start: 0, end: 2 }, { start: 0, end: 2 }]), []);
});

test('phrases span adjacent ASR segments with conservative approximate timestamps', () => {
    const results = search([], 'brave new', undefined, { transcripts: [{ sourcePath: 'a.mp4',
        segments: [word('hello brave', 2, 4), word('new world', 4, 6)] }] });
    assert.deepEqual(results, [{ text: 'brave new', start: 2, end: 6,
        sourcePath: 'a.mp4', sourceStart: 2, approximate: true }]);
});

test('word timestamps take precedence over duplicated segment text', () => {
    const results = search([], 'hello', undefined, { transcripts: [{ sourcePath: 'a.mp4',
        words: [word('hello', 3, 3.5)], segments: [word('hello world', 0, 5)] }] });
    assert.equal(results.length, 1);
    assert.equal(results[0].start, 3);
    assert.equal(results[0].approximate, false);
});

test('segment-only phrases cannot bridge deleted source gaps', () => {
    const transcripts = [{ sourcePath: 'a.mp4', segments: [word('hello', 0), word('world', 3)] }];
    assert.deepEqual(search([], 'hello world', [{ start: 0, end: 1 }, { start: 3, end: 4 }],
        { transcripts }), []);
    assert.deepEqual(search([], 'hello', [{ start: 0.5, end: 1 }], { transcripts }), []);
});

test('malformed timing interrupts phrases rather than silently dropping a word', () => {
    assert.deepEqual(search([word('hello', 0), word('missing', NaN), word('world', 2)], 'hello world'), []);
    assert.deepEqual(search([word('hello', 0), word('brave', 3), word('world', 2)], 'hello brave world'), []);
});

test('ASR fallback and overlapping source copies retain distinct occurrences', () => {
    const results = search([], 'hello world', [
        { start: 0, end: 5 }, { start: 1, end: 6, speed: 2 }
    ], { transcripts: [{ sourcePath: 'a.mp4', words: [word('bad', NaN)],
        segments: [word('hello', 1, 2), word('world', 2, 3)] }] });
    assert.deepEqual(results.map(hit => [hit.start, hit.end, hit.approximate]), [[1, 3, true], [5, 6, true]]);
});

test('word phrases span ASR segment boundaries using exact word bounds', () => {
    const results = search([], 'hello world', undefined, { transcripts: [{ sourcePath: 'a.mp4',
        words: [word('hello', 1.25, 1.75), word('world', 2.25, 2.75)],
        segments: [word('hello', 1, 2), word('world', 2, 3)] }] });
    assert.equal(results[0].start, 1.25);
    assert.equal(results[0].end, 2.75);
    assert.equal(results[0].approximate, false);
});

test('Turkish case, decomposed dotted I, punctuation and apostrophes normalize', () => {
    const results = search([word('\u0130STANBUL\u2019DA,', 1), word('I\u015eIK!', 2)],
        'I\u0307stanbulda... \u0131\u015f\u0131k');
    assert.equal(results.length, 1);
    assert.equal(results[0].approximate, false);
    assert.equal(search([word('k\u0131r', 1)], 'kir')[0].approximate, false);
});

test('English capital I and all dotted/dotless I variants match exactly both ways', () => {
    for (const [source, query] of [['I', 'i'], ['IN', 'in'], ['ISTANBUL', 'istanbul'],
        ['I LIKE IT', 'i like it'], ['\u0130', '\u0131'], ['KIR', 'kir'],
        ['I\u015eIK', 'i\u015fik'], ['I\u0307', 'i']]) {
        for (const [text, term] of [[source, query], [query, source]]) {
            const results = search([word(text, 1)], term);
            assert.equal(results.length, 1, `${text} / ${term}`);
            assert.equal(results[0].approximate, false);
            assert.equal(results[0].text, text.normalize('NFC'));
        }
    }
});

test('30k tokens with 3k cuts stay bounded and return all exact/fuzzy/phrase hits', t => {
    const words = Array.from({ length: 30000 }, (_, i) => word('repeatedneedle', i));
    const segments = Array.from({ length: 3000 }, (_, i) => ({ start: i * 10, end: i * 10 + 8, speed: 2 }));
    segments.push({ start: 0, end: 8, speed: 2 });
    for (const [query, count, approximate] of [
        ['repeatedneedle', 24008, false],
        ['repeatedneedlf', 24008, true],
        ['repeatedneedle repeatedneedle', 21007, false]
    ]) {
        const start = performance.now();
        const results = search(words, query, segments);
        const elapsed = performance.now() - start;
        t.diagnostic(`${query}: ${results.length} hits in ${elapsed.toFixed(1)}ms`);
        // Broad CI guard, not a claim about the renderer's frame-time budget.
        assert.ok(elapsed < 5000, `Search exceeded 5s: ${elapsed.toFixed(1)}ms`);
        assert.equal(results.length, count);
        assert.ok(results.every(hit => hit.approximate === approximate));
        assert.equal(results[0].start, 0);
        assert.equal(results.at(-1).end, 12004);
        assert.equal(results.at(-1).sourceStart, query.includes(' ') ? 6 : 7);
        assert.ok(results.every(hit => hit.sourceStart % 10 < 8));
    }
});

test('30k continuous speed splits map high result counts without quadratic scans', t => {
    const words = Array.from({ length: 30000 }, (_, i) => word('hello', i));
    const segments = words.map((item, i) => ({ start: item.start, end: item.end, speed: i % 2 ? 2 : 1 }));
    const start = performance.now();
    const results = search(words, 'hello', segments);
    const elapsed = performance.now() - start;
    t.diagnostic(`Continuous splits: ${results.length} hits in ${elapsed.toFixed(1)}ms`);
    assert.ok(elapsed < 5000, `Search exceeded 5s: ${elapsed.toFixed(1)}ms`);
    assert.equal(results.length, 30000);
    assert.equal(results.at(-1).start, 22499.5);
    assert.equal(results.at(-1).end, 22500);
});

test('exact text is ranked before earlier fuzzy text, then timeline order', () => {
    const results = search([word('merhapa', 1), word('merhaba', 4), word('merhaba', 8)], 'merhaba');
    assert.deepEqual(results.map(hit => [hit.start, hit.approximate]), [[4, false], [8, false], [1, true]]);
});

test('exact segment text outranks fuzzy word text despite coarse timing', () => {
    const results = search([], 'merhaba', undefined, { transcripts: [
        { sourcePath: 'a.mp4', words: [word('merhapa', 1)] },
        { sourcePath: 'a.mp4', segments: [word('merhaba', 8)] }
    ] });
    assert.deepEqual(results.map(hit => hit.start), [8, 1]);
});

test('recognized Turkish inflections match query prefixes and keep original text/timing', () => {
    for (const [query, text] of [
        ['bilgisayar', 'bilgisayarda'], ['bilgisayar', 'bilgisayar\u0131n'],
        ['bilgisayar', 'bilgisayarlar\u0131m\u0131zdan'],
        ['kulakl\u0131k', 'kulakl\u0131\u011f\u0131m'], ['kitap', 'kitab\u0131m'],
        ['kanat', 'kanad\u0131'], ['a\u011fa\u00e7', 'a\u011fac\u0131n'],
        ['araba', 'arabaya'], ['araba', 'arabas\u0131'],
        ['\u00e7ay', '\u00e7aydan'], ['ev', 'evler'],
        ['Ankara', 'Ankara\u2019da']
    ]) {
        assert.deepEqual(search([word(text, 2, 3.5)], query), [{
            text, start: 2, end: 3.5, sourcePath: 'a.mp4', sourceStart: 2, approximate: true
        }], `${query} / ${text}`);
    }
});

test('suffix matching is bounded and does not mean arbitrary substring or derivation', () => {
    for (const [query, text] of [
        ['\u00e7ay', '\u00e7aylak'], ['\u00e7ay', '\u00e7aylaklar'],
        ['ev', 'evren'], ['a', 'ada'], ['tek', 'te\u011fi'],
        ['bilgisayar', 'bilgisayarc\u0131l\u0131k'],
        ['bilgisayar', 'xxbilgisayarda'], ['kulakl\u0131k', 'kulakl\u0131\u011flar'],
        ['bilgisayarda', 'bilgisayar'], ['123', '123lar'],
        ['a'.repeat(65), 'a'.repeat(65) + 'lardan'],
        ['bilgisayar', 'bilgisayarlarlarlarlar']
    ]) assert.deepEqual(search([word(text, 1)], query), [], `${query} / ${text}`);
    // Short words cannot use fuzzy edits even when a long phrase has a budget.
    assert.deepEqual(search([word('\u00e7ax', 0), word('bilgisayarda', 1)], '\u00e7ay bilgisayar'), []);
});

test('exact then suffix then fuzzy ranking is independent of earlier timestamps', () => {
    const results = search([
        word('bilgisayax', 0), word('bilgisayarda', 2),
        word('bilgisayar\u0131n', 4), word('bilgisayar', 6)
    ], 'bilgisayar');
    assert.deepEqual(results.map(hit => [hit.start, hit.approximate]),
        [[6, false], [2, true], [4, true], [0, true]]);
});

test('phrases support multiple inflected words without spending fuzzy edit budget', () => {
    const results = search([
        word('bilgisayarda', 1), word('kulakl\u0131\u011f\u0131m', 2), word('\u00e7aydan', 3)
    ], 'bilgisayar kulakl\u0131k \u00e7ay', [
        { start: 0, end: 2, speed: 2 }, { start: 2, end: 5 }
    ]);
    assert.deepEqual(results, [{ text: 'bilgisayarda kulakl\u0131\u011f\u0131m \u00e7aydan',
        start: 0.5, end: 3, sourcePath: 'a.mp4', sourceStart: 1, approximate: true }]);
    assert.deepEqual(search([word('bilgisayarda', 0), word('kulakl\u0131\u011f\u0131m', 3)],
        'bilgisayar kulakl\u0131k', [{ start: 0, end: 1 }, { start: 3, end: 4 }]), []);
    assert.deepEqual(search([word('bilgisayarda', 0), word('extra', 1), word('kulakl\u0131\u011f\u0131m', 2)],
        'bilgisayar kulakl\u0131k'), []);
});

test('mixed suffix/fuzzy phrases rank below suffix-only and retain total fuzzy budget', () => {
    const results = search([
        word('bilgisayarda merhapa', 0), word('bilgisayarda merhaba', 3),
        word('bilgisayar merhaba', 6)
    ], 'bilgisayar merhaba');
    assert.deepEqual(results.map(hit => [hit.start, hit.approximate]), [[6, false], [3, true], [0, true]]);
    assert.equal(search([word('bilgisayarda xxrhaba', 0)], 'bilgisayar merhaba').length, 1);
    assert.deepEqual(search([word('bilgisayarda xxxhaba', 0)], 'bilgisayar merhaba'), []);
    assert.deepEqual(search([word('bilgisayarda merhapa dunxx', 0)], 'bilgisayar merhaba dunya'), []);
});

test('ASR errors use only the existing generic fuzzy budget, not transcription corrections', () => {
    assert.deepEqual(search([word('kulaklum', 0)], 'kulakl\u0131k'), []);
    assert.deepEqual(search([word('bilgisayd\u0131', 0)], 'bilgisayara'), []);
});

test('exact coarse text outranks suffix word text and suffixed ASR segments stay coarse', () => {
    const results = search([], 'bilgisayar', undefined, { transcripts: [
        { sourcePath: 'a.mp4', words: [word('bilgisayarda', 1)] },
        { sourcePath: 'a.mp4', segments: [word('bilgisayar', 8, 10)] }
    ] });
    assert.deepEqual(results.map(hit => [hit.start, hit.end, hit.approximate]),
        [[8, 10, true], [1, 2, true]]);
    assert.deepEqual(search([], 'bilgisayar kulakl\u0131k', undefined, { transcripts: [
        { sourcePath: 'a.mp4', segments: [word('bilgisayarda', 1, 3), word('kulakl\u0131\u011f\u0131m', 3, 5)] }
    ] }), [{ text: 'bilgisayarda kulakl\u0131\u011f\u0131m', start: 1, end: 5,
        sourcePath: 'a.mp4', sourceStart: 1, approximate: true }]);
});

test('30k suffixed tokens with 3k cuts remain bounded', t => {
    const words = Array.from({ length: 30000 }, (_, i) => word('kulakl\u0131\u011f\u0131m', i));
    const segments = Array.from({ length: 3000 }, (_, i) => ({ start: i * 10, end: i * 10 + 8 }));
    const start = performance.now();
    const results = search(words, 'kulakl\u0131k kulakl\u0131k', segments);
    const elapsed = performance.now() - start;
    t.diagnostic(`Suffixed phrases: ${results.length} hits in ${elapsed.toFixed(1)}ms`);
    assert.ok(elapsed < 5000, `Search exceeded 5s: ${elapsed.toFixed(1)}ms`);
    assert.equal(results.length, 21000);
    assert.ok(results.every(hit => hit.approximate));
});

test('fuzzy matching is bounded, whole-token, and cannot skip words', () => {
    assert.deepEqual(search([word('cart', 0)], 'cat'), []);
    assert.deepEqual(search([word('xxrhaba', 0)], 'merhaba'), []);
    assert.deepEqual(search([word('hello', 0), word('extra', 1), word('world', 2)], 'hello world'), []);
    assert.deepEqual(search([word('concatenate', 0)], 'cat'), []);
    assert.equal(search([word('abcdefghijklmn', 0)], 'abcxefghijklmz').length, 1);
    assert.deepEqual(search([word('a'.repeat(299) + 'b', 0)], 'a'.repeat(300)), []);
    assert.equal(search([word('a'.repeat(300), 0)], 'a'.repeat(300)).length, 1);
});

test('overlapping phrase occurrences are preserved', () => {
    assert.equal(search([word('go', 0), word('go', 1), word('go', 2)], 'go go').length, 2);
});

test('empty/invalid input and empty timeline do not fall back to source time', () => {
    assert.deepEqual(core.search(), []);
    for (const query of ['', '!?', null, 42]) assert.deepEqual(search([word('hello', 1)], query), []);
    assert.deepEqual(search([word('hello', 1)], 'hello', []), []);
    assert.deepEqual(search([word('hello', 1)], 'hello', null), []);
    assert.deepEqual(search([word('hello', 1)], 'hello', undefined, { transcripts: null }), []);
    assert.deepEqual(search([word('hello', NaN), word('hello', 2, 1)], 'hello'), []);
    assert.deepEqual(search([word('hello', 1)], 'hello', [{ start: 0, end: 5, speed: -1 }]), []);
});

test('unknown sources occupy edited time and zero speed follows Timeline fallback', () => {
    const results = search([word('hello', 1)], 'hello', [
        { start: 0, end: 3, sourceFile: 'untranscribed.mp4' },
        { start: 0, end: 2, speed: 0 }
    ]);
    assert.equal(results[0].start, 4);
});

test('input is not mutated, including frozen transcript and EDL objects', () => {
    function freeze(value) {
        if (value && typeof value === 'object') {
            Object.values(value).forEach(freeze);
            Object.freeze(value);
        }
        return value;
    }
    const input = freeze({ transcripts: [{ sourcePath: 'a', words: [word('hello', 1)] }],
        sourceFile: 'a', segments: [{ start: 0, end: 4 }], query: 'hello' });
    const before = JSON.stringify(input);
    assert.equal(core.search(input).length, 1);
    assert.equal(JSON.stringify(input), before);
});
