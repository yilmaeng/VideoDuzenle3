const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { tickerOutputPath } = require('../main/ticker-output-path');

test('ticker output is next to source, keeps Unicode, and avoids existing files', t => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-ticker-path-'));
    t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
    const source = path.join(folder, 'Örnek.mov');
    const first = tickerOutputPath(source, 'akan yazı');
    assert.equal(first, path.join(folder, 'Örnek_akan yazı.mp4'));
    fs.writeFileSync(first, 'keep');
    assert.equal(tickerOutputPath(source, 'akan yazı'), path.join(folder, 'Örnek_akan yazı (2).mp4'));
    assert.equal(fs.readFileSync(first, 'utf8'), 'keep');
});

test('output messages and filename suffixes exist in all locales', () => {
    for (const locale of ['tr','en','de','es','fr']) {
        const data = JSON.parse(fs.readFileSync(path.join(__dirname, `../locales/${locale}.json`), 'utf8'));
        assert(data.ticker_output.suffix);
        assert(data.ticker_output.saved.includes('{path}'));
    }
});
