const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSlideshowProgressRange: range } = require('../main/slideshow-progress');

const values = [];
const first = range(value => values.push(value), 0, 70);
for (const percent of [0, 1, 10, 50, 50, 40, 99]) first(percent);
assert.deepEqual(values, [0, 7, 35, 69]);
first(100);
assert.equal(values.at(-1), 70);
const concat = range(value => values.push(value), 70, 80);
for (const percent of [0, 25, 50, 99, 100]) concat(percent);
assert.deepEqual(values.slice(-5), [70, 72, 75, 79, 80]);
assert(values.every((value, index) => index === 0 || value >= values[index - 1]));
const shortPart = [];
range(value => shortPart.push(value), 0, 7)(100);
const longPart = range(value => shortPart.push(value), 7, 70);
longPart(0);
longPart(50);
longPart(100);
assert.deepEqual(shortPart, [7, 7, 38, 70]);

const source = fs.readFileSync(path.join(__dirname, '../main/slideshow-handler.js'), 'utf8');
const mixed = source.slice(source.indexOf('async function createMixedMediaSlideshowVideo'), source.indexOf('async function createSlideshowVideoBatched'));
assert(mixed.includes('onProgress: partProgress'));
assert(mixed.includes('onProgress: gapProgress'));
assert(mixed.includes('onProgress: concatProgress'));
assert(!mixed.includes('((index + 1) / Math.max(1, mediaTimings.length)) * 70'));
assert(mixed.indexOf('partProgress(100)') > mixed.indexOf('onProgress: partProgress'));
for (const lang of ['tr', 'en', 'de', 'es', 'fr']) {
    const locale = require(`../locales/${lang}.json`);
    assert(locale.runtime.slideshow_editor.batch_progress);
    assert(locale.runtime.slideshow_editor.merging_parts);
}
console.log('Slideshow progress tests passed.');
