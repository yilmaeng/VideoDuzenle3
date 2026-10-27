'use strict';
const fs = require('fs');
const path = require('path');
const { createModelCatalog } = require('./ai-model-catalog');

const providers = Object.freeze({
    gemini: { name: 'Gemini', pricing: 'https://ai.google.dev/gemini-api/docs/pricing' },
    openai: { name: 'OpenAI', pricing: 'https://developers.openai.com/api/docs/pricing' },
    claude: { name: 'Claude (Anthropic)', pricing: 'https://platform.claude.com/docs/en/about-claude/pricing' },
    deepseek: { name: 'DeepSeek', pricing: 'https://api-docs.deepseek.com/quick_start/pricing/' },
    groq: { name: 'Groq', pricing: 'https://console.groq.com/docs/models' }
});
const validModel = value => typeof value === 'string' && /^[a-zA-Z0-9._:/-]{1,200}$/.test(value);
const errorCodes = new Set(['provider','key_required','key','model','same_provider','secure_storage','unauthorized','request','pricing','unsupported','input','refusal','empty','cancelled','timeout']);
const fail = (code, transient = false) => Object.assign(new Error(code), { code, transient });

function createService({ directory, secure, legacy, fetchImpl = (...args) => fetch(...args) }) {
    const file = path.join(directory, 'ai-services.json');
    const catalogs = Object.fromEntries(Object.keys(providers).map(id => [id, createModelCatalog(id, directory, fetchImpl)]));
    const assertProvider = id => { if (!Object.hasOwn(providers, id)) throw fail('provider'); };
    function read() {
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
    }
    function write(data) {
        fs.mkdirSync(directory, { recursive: true });
        const temp = `${file}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
        fs.renameSync(temp, file);
    }
    function settings() {
        const data = read();
        return { primary: Object.hasOwn(providers, data.primary) ? data.primary : 'gemini',
            fallback: Object.hasOwn(providers, data.fallback) ? data.fallback : 'openai', fallbackEnabled: data.fallbackEnabled === true };
    }
    function key(id) {
        assertProvider(id);
        if (legacy[id]) return legacy[id].getApiKey() || '';
        const value = read().services?.[id]?.key;
        if (!value) return '';
        if (!secure.isEncryptionAvailable()) throw fail('secure_storage');
        try { return secure.decryptString(Buffer.from(value, 'base64')); } catch { throw fail('secure_storage'); }
    }
    function model(id) {
        assertProvider(id);
        return legacy[id] ? legacy[id].getModel() : read().services?.[id]?.model || '';
    }
    function status() {
        return { settings: settings(), providers: Object.entries(providers).map(([id, info]) => {
            let stored = '', keyError = false;
            try { stored = key(id); } catch { keyError = true; }
            return { id, ...info, hasKey: !!stored, keyError, model: model(id), models: catalogs[id].cached(stored) };
        }) };
    }
    function saveService(id, input) {
        assertProvider(id);
        if (!validModel(input.model)) throw fail('model');
        if (typeof input.apiKey !== 'string' || input.apiKey.length > 8192 || /[\r\n]/.test(input.apiKey)) throw fail('key');
        const supplied = input.apiKey.trim();
        if (legacy[id]) {
            // Reuse existing credentials so live translation and older dialogs keep working.
            fs.mkdirSync(directory, { recursive: true });
            if (supplied) legacy[id].saveApiKey(supplied);
            legacy[id].saveModel(input.model);
        } else {
            const data = read(); data.services ||= {}; data.services[id] ||= {};
            if (supplied) {
                if (!secure.isEncryptionAvailable()) throw fail('secure_storage');
                data.services[id].key = secure.encryptString(supplied).toString('base64');
            }
            data.services[id].model = input.model; write(data);
        }
        return status();
    }
    function saveSettings(input) {
        assertProvider(input.primary); assertProvider(input.fallback);
        if (input.fallbackEnabled && input.primary === input.fallback) throw fail('same_provider');
        write({ ...read(), primary: input.primary, fallback: input.fallback, fallbackEnabled: input.fallbackEnabled === true });
        return status();
    }
    async function refresh(id, supplied) {
        assertProvider(id);
        return catalogs[id].refresh(supplied?.trim() || key(id));
    }
    async function pricing(id) {
        assertProvider(id);
        // No API key is ever sent to public pricing pages. Do not follow cross-origin redirects.
        const url = providers[id].pricing;
        const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
        if (!response.ok || !/text\/html/i.test(response.headers.get('content-type') || '')) throw fail('pricing');
        const chunks = []; let length = 0;
        for await (const chunk of response.body) {
            length += chunk.length;
            if (length > 4 * 1024 * 1024) throw fail('pricing');
            chunks.push(Buffer.from(chunk));
        }
        return { url, retrievedAt: new Date().toISOString(), html: Buffer.concat(chunks).toString('utf8') };
    }
    function images(input) {
        const entries = input ? (Array.isArray(input) ? input : [input]) : [];
        if (entries.length > 20) throw fail('input');
        return entries.map(entry => {
            const raw = typeof entry === 'string' ? entry : entry?.data;
            if (typeof raw !== 'string' || raw.length > 20 * 1024 * 1024) throw fail('input');
            const match = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s);
            const mime = match ? match[1] : entry?.mimeType || 'image/jpeg';
            const data = match ? match[2] : raw;
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) || !/^[A-Za-z0-9+/=\r\n]+$/.test(data)) throw fail('input');
            return { mime, data, url: `data:${mime};base64,${data}` };
        });
    }
    async function attempt(id, input, signal) {
        const credential = key(id), selected = model(id);
        if (!credential) throw fail('key_required');
        if (!validModel(selected)) throw fail('model');
        const picture = images(input.imageBase64);
        const known = catalogs[id].cached(credential).find(m => m.id === selected);
        if (known?.selectable === false || (picture.length && known?.inputModalities && !known.inputModalities.includes('image'))) throw fail('unsupported');
        const history = (Array.isArray(input.history) ? input.history : []).slice(-40).map(item => ({
            role: item.role === 'assistant' || item.role === 'model' ? 'assistant' : 'user', content: String(item.content || '').slice(0, 100000)
        }));
        const prompt = String(input.prompt || '').slice(0, 200000), system = String(input.systemInstruction || '').slice(0, 20000);
        let url, body, headers = { 'Content-Type': 'application/json' };
        if (id === 'gemini') {
            url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selected)}:generateContent`;
            headers['x-goog-api-key'] = credential;
            body = { contents: [...history.map(h => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] })),
                { role: 'user', parts: [...picture.map(p => ({ inlineData: { mimeType: p.mime, data: p.data } })), { text: prompt }] }],
                ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}) };
        } else if (id === 'claude') {
            url = 'https://api.anthropic.com/v1/messages'; headers['x-api-key'] = credential; headers['anthropic-version'] = '2023-06-01';
            body = { model: selected, max_tokens: 4096, ...(system ? { system } : {}), messages: [...history,
                { role: 'user', content: [...picture.map(p => ({ type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } })), { type: 'text', text: prompt }] }] };
        } else if (id === 'openai') {
            url = 'https://api.openai.com/v1/responses'; headers.Authorization = `Bearer ${credential}`;
            body = { model: selected, ...(system ? { instructions: system } : {}), input: [...history, { role: 'user', content: [
                { type: 'input_text', text: prompt }, ...picture.map(p => ({ type: 'input_image', image_url: p.url }))] }] };
        } else {
            url = id === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.deepseek.com/chat/completions';
            headers.Authorization = `Bearer ${credential}`;
            body = { model: selected, messages: [...(system ? [{ role: 'system', content: system }] : []), ...history,
                { role: 'user', content: picture.length ? [{ type: 'text', text: prompt }, ...picture.map(p => ({ type: 'image_url', image_url: { url: p.url } }))] : prompt }] };
        }
        const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), 90000);
        const started = Date.now();
        // Log metadata only: never credentials, prompts, images, or response text.
        console.info('[AI request] started', { provider: id, model: selected, images: picture.length });
        const onAbort = () => timeout.abort();
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
            if (signal?.aborted) throw fail('cancelled');
            const response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: timeout.signal });
            console.info('[AI request] response', { provider: id, status: response.status, elapsedMs: Date.now() - started });
            if (!response.ok) throw fail([401, 403].includes(response.status) ? 'unauthorized' : response.status === 400 ? 'unsupported' : 'request', response.status === 429 || response.status >= 500);
            const data = await response.json();
            let text;
            if (id === 'gemini') {
                if (data.promptFeedback?.blockReason || ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT'].includes(data.candidates?.[0]?.finishReason)) throw fail('refusal');
                text = data.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('');
            } else if (id === 'claude') {
                if (data.stop_reason === 'refusal') throw fail('refusal');
                text = data.content?.filter(p => p.type === 'text').map(p => p.text).join('\n');
            } else if (id === 'openai') {
                if (data.output?.some(o => o.content?.some(c => c.type === 'refusal'))) throw fail('refusal');
                text = data.output?.flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('\n');
            } else {
                if (data.choices?.[0]?.message?.refusal) throw fail('refusal');
                text = data.choices?.[0]?.message?.content;
            }
            if (typeof text !== 'string' || !text.trim()) throw fail('empty');
            return { success: true, text, provider: id, model: selected };
        } catch (error) {
            console.warn('[AI request] failed', { provider: id, elapsedMs: Date.now() - started, code: error.code || error.cause?.code || error.name });
            if (signal?.aborted) throw fail('cancelled');
            if (timeout.signal.aborted) throw fail('timeout', true);
            if (errorCodes.has(error.code) && typeof error.transient === 'boolean') throw error;
            throw fail('request', true);
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
    }
    async function request(input, { signal, notify = () => {} } = {}) {
        const config = settings(), first = input.provider || config.primary;
        assertProvider(first);
        try { return await attempt(first, input, signal); }
        catch (error) {
            if (!error.transient || signal?.aborted || input.provider || !config.fallbackEnabled || config.fallback === first) throw error;
            if (!key(config.fallback) || !model(config.fallback)) throw error;
            notify(config.fallback);
            return { ...await attempt(config.fallback, input, signal), usedFallback: true };
        }
    }
    return { status, settings, saveSettings, saveService, refresh, pricing, request };
}

let singleton;
function getService() {
    if (!singleton) {
        const gemini = require('./gemini-handler'), openai = require('./openai-handler');
        singleton = createService({ directory: path.join(require('os').homedir(), '.korcul-video-editor'), secure: require('electron').safeStorage,
            legacy: { gemini: { ...gemini, getModel: gemini.getAiModel, saveModel: gemini.saveAiModel },
                openai: { ...openai, getModel: openai.getVisionModel, saveModel: openai.saveAiModel } } });
    }
    return singleton;
}
function register({ ipcMain, i18n }) {
    const jobs = new Map();
    for (const action of ['status', 'save-service', 'save-settings', 'refresh', 'pricing', 'open-pricing', 'request', 'cancel']) {
        const channel = `ai-services-${action}`; ipcMain.removeHandler(channel);
        ipcMain.handle(channel, async (event, input = {}) => {
            if (event.senderFrame && event.senderFrame !== event.sender.mainFrame) return { success: false, error: 'request' };
            const service = getService();
            try {
                if (action === 'status') return { success: true, ...service.status() };
                if (action === 'save-service') return { success: true, ...service.saveService(input.provider, input) };
                if (action === 'save-settings') return { success: true, ...service.saveSettings(input) };
                if (action === 'refresh') return await service.refresh(input.provider, input.apiKey);
                if (action === 'pricing') return { success: true, ...await service.pricing(input.provider) };
                if (action === 'open-pricing') {
                    if (!Object.hasOwn(providers, input.provider)) throw fail('provider');
                    await require('electron').shell.openExternal(providers[input.provider].pricing); return { success: true };
                }
                if (action === 'cancel') { jobs.get(event.sender.id)?.abort(); return { success: true }; }
                jobs.get(event.sender.id)?.abort();
                const controller = new AbortController(); jobs.set(event.sender.id, controller);
                const destroyed = () => controller.abort(); event.sender.once('destroyed', destroyed);
                try {
                    return await service.request(input, { signal: controller.signal, notify: provider => {
                        if (!event.sender.isDestroyed()) event.sender.send('ai-services-notice', i18n.t('ai_services.fallback_notice', { provider: providers[provider].name }));
                    } });
                } finally {
                    event.sender.removeListener('destroyed', destroyed);
                    if (jobs.get(event.sender.id) === controller) jobs.delete(event.sender.id);
                }
            } catch (error) { const code = errorCodes.has(error.code) ? error.code : 'request'; return { success: false, error: code, message: i18n.t(code === 'timeout' ? 'ai_connection.timeout' : `ai_services.errors.${code}`) }; }
        });
    }
}
module.exports = { providers, createService, getService, register };
