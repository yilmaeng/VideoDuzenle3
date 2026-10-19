const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createModelCatalog } = require('../main/ai-model-catalog');
const response = data => ({ ok: true, json: async () => data });
function directory(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-models-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}
test('Gemini follows pagination, sends key only in header and retains specialized entries as disabled', async t => {
    const calls = [];
    const catalog = createModelCatalog('gemini', directory(t), async (url, options) => {
        calls.push({ url, options });
        return response(calls.length === 1 ? { models: [{ name: 'models/gemini-new', displayName: 'New', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'next/1' }
            : { models: [{ name: 'models/gemini-tts', supportedGenerationMethods: ['generateContent'] }] });
    });
    const result = await catalog.refresh('private-key');
    assert.equal(result.success, true);
    assert.equal(result.models.length, 2);
    assert.equal(result.models[0].selectable, true);
    assert.equal(result.models[1].selectable, false);
    assert.ok(calls[1].url.includes('next%2F1'));
    assert.ok(calls.every(call => !call.url.includes('private-key') && call.options.headers['x-goog-api-key'] === 'private-key'));
    assert.equal(catalog.cached('another-key').length, 0);
    assert.deepEqual(catalog.cached('private-key'), result.models);
});
test('OpenAI lists every returned model but does not offer audio/embedding models for vision', async t => {
    const catalog = createModelCatalog('openai', directory(t), async () => response({ data: [
        { id: 'gpt-4.1-mini' }, { id: 'gpt-realtime' }, { id: 'text-embedding-3-small' }, { id: 'gpt-4o-mini-tts' }
    ] }));
    const result = await catalog.refresh('key');
    assert.equal(result.models.length, 4);
    assert.deepEqual(result.models.filter(item => item.selectable).map(item => item.id), ['gpt-4.1-mini']);
});
test('failure, empty responses and missing keys do not overwrite the cached list', async t => {
    let mode = 'ok';
    const catalog = createModelCatalog('openai', directory(t), async () => mode === 'ok' ? response({ data: [{ id: 'gpt-4.1' }] })
        : mode === 'empty' ? response({ data: [] }) : { ok: false, status: 401 });
    await catalog.refresh('key');
    mode = 'empty'; assert.equal((await catalog.refresh('key')).error, 'empty');
    mode = 'error'; assert.equal((await catalog.refresh('key')).error, 'unauthorized');
    assert.equal((await catalog.refresh('')).error, 'key_required');
    assert.equal(catalog.cached('key')[0].id, 'gpt-4.1');
});
test('repeated pagination tokens fail safely', async t => {
    const catalog = createModelCatalog('gemini', directory(t), async () => response({ models: [], nextPageToken: 'same' }));
    assert.equal((await catalog.refresh('key')).success, false);
});

test('picker preserves selection, refresh-button focus, failed lists and ignores stale responses', async () => {
    class Element extends EventTarget {
        constructor() { super(); this.children = []; this.value = ''; this.textContent = ''; this.open = true; this.attrs = {}; }
        replaceChildren() { this.children = []; }
        appendChild(child) { this.children.push(child); }
        setAttribute(k, v) { this.attrs[k] = v; }
        removeAttribute(k) { delete this.attrs[k]; }
    }
    const elements = new Map();
    const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
    let resolve, requests = 0;
    const window = { api: { refreshAiModels: () => { requests++; return new Promise(r => { resolve = r; }); } },
        i18nHelper: { t: key => key } };
    const document = { getElementById: get, createElement: () => new Element(), activeElement: get('gemini-models-refresh') };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/scripts/ai-model-picker.js'), 'utf8'), { window, document, AbortController });
    window.AiModelPicker.prepare('gemini', { model: 'gemini-custom' });
    assert.equal(requests, 0);
    const select = get('gemini-model-select'), button = get('gemini-models-refresh');
    get('gemini-api-key-input').value = 'key';
    button.dispatchEvent(new Event('click'));
    resolve({ success: true, models: [{ id: 'gemini-new', label: 'New', selectable: true }] });
    await new Promise(setImmediate);
    assert.equal(select.value, 'gemini-custom');
    assert.equal(document.activeElement, button);
    assert.equal(select.children.length, 2);
    button.dispatchEvent(new Event('click')); resolve({ success: false, error: 'failed' });
    await new Promise(setImmediate);
    assert.equal(select.children.length, 2);
    button.dispatchEvent(new Event('click'));
    get('gemini-api-key-dialog').dispatchEvent(new Event('close'));
    window.AiModelPicker.prepare('gemini', { model: 'gemini-other' });
    resolve({ success: true, models: [{ id: 'stale', label: 'Stale', selectable: true }] });
    await new Promise(setImmediate);
    assert.equal(select.value, 'gemini-other');
    assert.ok(!select.children.some(item => item.value === 'stale'));
});
test('model picker labels exist in all active languages', () => {
    let expected;
    for (const lang of ['tr', 'en', 'de', 'es', 'fr']) {
        const values = require(`../locales/${lang}.json`).ai_models;
        expected ||= Object.keys(values).sort();
        assert.deepEqual(Object.keys(values).sort(), expected);
        assert.ok(Object.values(values).every(value => typeof value === 'string' && value.trim()));
    }
});
