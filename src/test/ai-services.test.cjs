const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { createService, providers } = require('../main/ai-services');
const { createModelCatalog } = require('../main/ai-model-catalog');
const ok = data => ({ ok: true, json: async () => data });
function fixture(t, fetchImpl) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-services-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const legacy = Object.fromEntries(['gemini', 'openai'].map(id => {
        let key = `${id}-fixture`, model = id === 'gemini' ? 'gemini-test' : 'gpt-test';
        return [id, { getApiKey: () => key, saveApiKey: v => { key = v; }, getModel: () => model, saveModel: v => { model = v; } }];
    }));
    const secure = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(`encrypted:${s}`), decryptString: b => b.toString().slice(10) };
    return { directory, legacy, secure, service: createService({ directory, legacy, secure, fetchImpl }) };
}
test('saved preferences and credentials are shared, new keys are encrypted and never returned', t => {
    const { service, directory, legacy, secure } = fixture(t);
    assert.equal(service.settings().fallbackEnabled, false);
    service.saveService('gemini', { apiKey: '', model: 'gemini-new' });
    assert.equal(legacy.gemini.getApiKey(), 'gemini-fixture');
    assert.equal(legacy.gemini.getModel(), 'gemini-new');
    service.saveService('claude', { apiKey: 'private-fixture', model: 'claude-test' });
    const raw = fs.readFileSync(path.join(directory, 'ai-services.json'), 'utf8');
    assert(!raw.includes('private-fixture')); assert(!JSON.stringify(service.status()).includes('private-fixture'));
    service.saveSettings({ primary: 'claude', fallback: 'openai', fallbackEnabled: true });
    assert.equal(createService({ directory, legacy, secure }).settings().primary, 'claude');
    assert.throws(() => service.saveSettings({ primary: 'claude', fallback: 'claude', fallbackEnabled: true }), /same_provider/);
    assert.throws(() => service.saveService('https://evil.test', { apiKey: 'x', model: 'x' }), /provider/);
    secure.isEncryptionAvailable = () => false;
    assert.throws(() => service.saveService('groq', { apiKey: 'private', model: 'qwen-test' }), /secure_storage/);
});
test('all five adapters preserve images, text and system instructions and use fixed credential hosts', async t => {
    const calls = [];
    const { service } = fixture(t, async (url, options) => {
        calls.push({ url, options });
        if (url.includes('googleapis')) return ok({ candidates: [{ content: { parts: [{ text: 'answer' }] } }] });
        if (url.includes('anthropic')) return ok({ content: [{ type: 'text', text: 'answer' }] });
        if (url.includes('openai.com')) return ok({ output: [{ content: [{ type: 'output_text', text: 'answer' }] }] });
        return ok({ choices: [{ message: { content: 'answer' } }] });
    });
    for (const provider of ['claude', 'deepseek', 'groq']) service.saveService(provider, { apiKey: `${provider}-fixture`, model: `${provider}-test` });
    for (const provider of Object.keys(providers)) {
        const result = await service.request({ provider, imageBase64: ['YQ==', { data: 'Yg==', mimeType: 'image/png' }], prompt: 'question', systemInstruction: 'instruction' });
        assert.equal(result.text, 'answer'); assert.equal(result.provider, provider);
        const call = calls.at(-1); assert.equal(call.options.redirect, 'error');
        for (const text of ['question', 'instruction', 'YQ==', 'Yg==', 'image/png']) assert(call.options.body.includes(text));
        assert(!call.options.body.includes('-fixture')); assert(!call.url.includes('-fixture'));
    }
});
test('fallback only after transient failure, does not change saved primary and announces once', async t => {
    let calls = 0, notices = [];
    const { service } = fixture(t, async () => ++calls === 1 ? { ok: false, status: 503 }
        : ok({ output: [{ content: [{ type: 'output_text', text: 'fallback' }] }] }));
    service.saveSettings({ primary: 'gemini', fallback: 'openai', fallbackEnabled: true });
    const result = await service.request({ prompt: 'hello' }, { notify: p => notices.push(p) });
    assert.equal(result.usedFallback, true); assert.equal(result.provider, 'openai');
    assert.equal(service.settings().primary, 'gemini'); assert.deepEqual(notices, ['openai']);
});
test('a transport timeout DOMException is a temporary error, not an untranslated numeric error', async t => {
    let calls = 0;
    const { service } = fixture(t, async () => {
        if (++calls === 1) throw new DOMException('timed out', 'AbortError');
        return ok({ output: [{ content: [{ type: 'output_text', text: 'recovered' }] }] });
    });
    service.saveSettings({ primary: 'gemini', fallback: 'openai', fallbackEnabled: true });
    assert.equal((await service.request({ prompt: 'hello' })).usedFallback, true);
    assert.equal(calls, 2);
});
for (const status of [400, 401, 403]) test(`HTTP ${status} does not trigger fallback`, async t => {
    let calls = 0;
    const { service } = fixture(t, async () => { calls++; return { ok: false, status }; });
    service.saveSettings({ primary: 'gemini', fallback: 'openai', fallbackEnabled: true });
    await assert.rejects(service.request({ prompt: 'hi' })); assert.equal(calls, 1);
});
test('refusal, explicit provider, cancellation and default settings never fall back', async t => {
    let calls = 0, refusal = true;
    const { service } = fixture(t, async () => { calls++; return refusal ? ok({ promptFeedback: { blockReason: 'SAFETY' } }) : { ok: false, status: 503 }; });
    service.saveSettings({ primary: 'gemini', fallback: 'openai', fallbackEnabled: true });
    await assert.rejects(service.request({ prompt: 'hi' }), /refusal/); assert.equal(calls, 1);
    refusal = false; await assert.rejects(service.request({ provider: 'gemini', prompt: 'hi' })); assert.equal(calls, 2);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(service.request({ prompt: 'hi' }, { signal: controller.signal }), /cancelled/); assert.equal(calls, 2);
    service.saveSettings({ primary: 'gemini', fallback: 'openai', fallbackEnabled: false });
    await assert.rejects(service.request({ prompt: 'hi' })); assert.equal(calls, 3);
});
test('Claude pagination and DeepSeek advertised modalities are retained', async t => {
    const { directory } = fixture(t); let count = 0;
    const claude = createModelCatalog('claude', directory, async (url, options) => {
        assert.equal(options.headers['anthropic-version'], '2023-06-01');
        assert.equal(options.headers['x-api-key'], 'fixture');
        if (++count === 2) assert(url.includes('after_id=claude-first'));
        return ok({ data: [{ id: count === 1 ? 'claude-first' : 'claude-second', type: 'model', display_name: 'Claude' }], has_more: count === 1, last_id: 'claude-first' });
    });
    assert.equal((await claude.refresh('fixture')).models.length, 2);
    const ds = createModelCatalog('deepseek', directory, async () => ok({ data: [{ id: 'deepseek-text', input_modalities: ['text'], output_modalities: ['text'] }] }));
    assert.deepEqual((await ds.refresh('fixture')).models[0].inputModalities, ['text']);
});
test('cancelling an in-flight request never sends it to the fallback service', async t => {
    let calls = 0;
    const controller = new AbortController();
    const { service } = fixture(t, async (_url, { signal }) => {
        calls++;
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    });
    service.saveSettings({ primary: 'gemini', fallback: 'openai', fallbackEnabled: true });
    const promise = service.request({ prompt: 'hello' }, { signal: controller.signal });
    controller.abort();
    await assert.rejects(promise, /cancelled/); assert.equal(calls, 1);
});
test('pricing pages larger than the bound are rejected', async t => {
    const { service } = fixture(t, async () => new Response('x'.repeat(4 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/html' } }));
    await assert.rejects(service.pricing('claude'), /pricing/);
});
test('unsupported advertised image input is not silently removed or sent elsewhere', async t => {
    let calls = 0;
    const { service } = fixture(t, async () => { calls++; return ok({ data: [{ id: 'text-only', input_modalities: ['text'], output_modalities: ['text'] }] }); });
    service.saveService('deepseek', { apiKey: 'fixture', model: 'text-only' });
    await service.refresh('deepseek');
    await assert.rejects(service.request({ provider: 'deepseek', prompt: 'x', imageBase64: 'YQ==' }), /unsupported/);
    assert.equal(calls, 1);
});
test('pricing fetch is fixed-origin, bounded and sends no credentials', async t => {
    const { service } = fixture(t, async (url, options) => {
        assert.equal(url, providers.claude.pricing); assert.equal(options.headers, undefined); assert.equal(options.redirect, 'error');
        return new Response('<main>USD $1 / token</main>', { headers: { 'content-type': 'text/html' } });
    });
    const result = await service.pricing('claude'); assert(result.html.includes('$1')); assert(result.retrievedAt);
    await assert.rejects(service.pricing('invalid'), /provider/);
});
test('all strings and embedded scripts parse in all affected views', () => {
    const flatten = (o, p = '') => Object.entries(o).flatMap(([k,v]) => typeof v === 'object' ? flatten(v, `${p}${k}.`) : [`${p}${k}`]).sort();
    const expected = flatten(require('../locales/tr.json').ai_services);
    for (const language of ['tr','en','de','es','fr']) assert.deepEqual(flatten(require(`../locales/${language}.json`).ai_services), expected);
    for (const name of ['text-overlay', 'slideshow-text-overlay', 'slideshow-ticker-overlay', 'slideshow-editor']) {
        const html = fs.readFileSync(path.join(__dirname, `../renderer/dialogs/${name}.html`), 'utf8');
        for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (match[1].trim()) new vm.Script(match[1], { filename: name });
    }
});
