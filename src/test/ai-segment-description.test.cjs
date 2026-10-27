const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepareSegment, parseLayerSuggestion } = require('../renderer/scripts/ai-segment-description.js');

test('browser loads the helper without Node globals before dialogs', () => {
    const vm = require('node:vm');
    const context = { window: {} };
    const script = fs.readFileSync(path.join(__dirname, '../renderer/scripts/ai-segment-description.js'), 'utf8');
    vm.runInNewContext(script, context);
    assert.equal(typeof context.window.AiSegmentDescription.prepareSegment, 'function');
    assert.equal(typeof context.window.AiSegmentDescription.parseLayerSuggestion, 'function');
    const html = fs.readFileSync(path.join(__dirname, '../renderer/index.html'), 'utf8');
    assert(html.indexOf('scripts/ai-segment-description.js') < html.indexOf('scripts/dialogs.js'));
    const dialogs = fs.readFileSync(path.join(__dirname, '../renderer/scripts/dialogs.js'), 'utf8');
    assert(!dialogs.includes("require(require('url')"));
});

test('description samples are chronological, bounded and omit the exclusive end', async () => {
    const calls = [];
    const result = await prepareSegment({ start: 5, end: 205, videoPath: 'video.mp4',
        context: 'frames', extractFrame: async frame => { calls.push(frame); return 'image'; } });
    assert.equal(result.imageBase64.length, 20);
    assert.equal(calls[0].time, 5);
    assert.equal(calls.at(-1).time, 195);
    assert.match(result.context, /5.000, 15.000/);
});

test('edited timeline samples map cuts, source changes and speed to source media', async () => {
    const calls = [];
    await prepareSegment({ start: 0, end: 6, videoPath: 'first.mp4', context: 'frames',
        segments: [{ start: 8, end: 12, speed: 2 }, { start: 20, end: 24, sourceFile: 'second.mp4' }],
        extractFrame: async frame => { calls.push(frame); return 'image'; } });
    assert.deepEqual(calls, [{ videoPath: 'first.mp4', time: 8 },
        { videoPath: 'second.mp4', time: 20 }, { videoPath: 'second.mp4', time: 22 }]);
});

test('invalid range and failed extraction do not produce a partial description', async () => {
    await assert.rejects(prepareSegment({ start: 5, end: 5 }), RangeError);
    await assert.rejects(prepareSegment({ start: 0, end: 2, extractFrame: async () => { throw new Error('capture'); } }), /capture/);
});

test('layer coordinates are validated before applying a suggestion', () => {
    const suggestion = { x: 10, y: 20, width: 100, height: 80, position: 'corner', reason: 'space' };
    assert.deepEqual(parseLayerSuggestion('```json\n' + JSON.stringify(suggestion) + '\n```', { width: 200, height: 200 }), suggestion);
    for (const change of [{ x: -1 }, { width: 500 }, { height: 0 }, { x: '10' }]) {
        assert.throws(() => parseLayerSuggestion(JSON.stringify({ ...suggestion, ...change }), { width: 200, height: 200 }));
    }
});

test('description and follow-up routes have no provider or credential override', () => {
    const source = fs.readFileSync(path.join(__dirname, '../renderer/scripts/dialogs.js'), 'utf8');
    const section = source.slice(source.indexOf('async showAIDescriptionForSegment'), source.indexOf('setupGeminiApiKeyEventListeners() {'));
    assert(!/getGeminiApiData|geminiVisionRequest|geminiDescribeSelection|currentAiApiKey|provider:/.test(section));
    assert.equal((section.match(/window\.AiServices\.request/g) || []).length, 2);
    for (const locale of ['tr', 'en', 'de', 'es', 'fr']) {
        const data = JSON.parse(fs.readFileSync(path.join(__dirname, `../locales/${locale}.json`), 'utf8'));
        assert(data.ai_connection.visual_samples);
        assert(data.ai_connection.layer_prompt);
    }
});
