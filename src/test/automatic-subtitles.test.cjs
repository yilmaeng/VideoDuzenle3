const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../renderer/scripts/automatic-subtitles-core');

test('word timing generates bounded readable cues, preserving Turkish and pauses', () => {
    const input = { words: [
        { start: 1, end: 1.4, text: 'Günaydın' }, { start: 1.4, end: 2, text: 'dünya.' },
        { start: 5, end: 5.6, text: 'Çay' }, { start: 5.6, end: 6.5, text: 'içelim.' }
    ] };
    const before = JSON.stringify(input);
    assert.equal(core.toSrt(input), '1\n00:00:01,000 --> 00:00:02,000\nGünaydın dünya.\n\n2\n00:00:05,000 --> 00:00:06,500\nÇay içelim.\n');
    assert.equal(JSON.stringify(input), before);
});
test('segment fallback rejects invalid times and clamps overlap', () => {
    const cues = core.cues({ segments: [
        { start: -1, end: 0, text: 'bad' }, { start: 1, end: 3, text: 'one' },
        { start: 2, end: 4, text: 'two' }, { start: 6, end: 6, text: 'bad' },
        { start: 8, end: 9, text: '' }
    ] });
    assert.deepEqual(cues, [{ start: 1, end: 2, text: 'one' }, { start: 2, end: 4, text: 'two' }]);
    assert.equal(core.toSrt({}), '');
});
test('long word streams split without dropping text', () => {
    const words = Array.from({length:100}, (_,i) => ({ start:i*0.5, end:i*0.5+0.4, text:`word${i}` }));
    const cues = core.cues({words});
    assert.equal(cues.map(x=>x.text).join(' '), words.map(x=>x.text).join(' '));
    assert.ok(cues.every(x=>x.end-x.start<=6 && x.text.length<=80));
});
test('all added labels have translations in every active locale', () => {
    const languages = ['tr','en','de','es','fr'];
    const locales = languages.map(lang => JSON.parse(fs.readFileSync(path.join(__dirname,`../locales/${lang}.json`),'utf8')));
    for (const ns of ['timeline_pointer','automatic_subtitles']) {
        for (const locale of locales) {
            assert.deepEqual(Object.keys(locale[ns]), Object.keys(locales[0][ns]));
            for (const value of Object.values(locale[ns])) assert.ok(typeof value === 'string' && value.length);
        }
    }
});
