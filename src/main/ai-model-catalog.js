'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function selectable(provider, model) {
    if (provider === 'claude') return model.type === 'model' && model.lifecycle !== 'retired';
    if (provider === 'deepseek') return !model.output_modalities || model.output_modalities.includes('text');
    if (provider === 'groq') return model.active !== false && !/(whisper|tts|guard|orpheus)/i.test(model.id);
    if (provider === 'gemini') return model.supportedGenerationMethods?.includes('generateContent')
        && !/(?:tts|image|robotics)/i.test(model.name);
    // The models endpoint does not expose input modalities. Keep specialized
    // audio/realtime/image endpoints out of the Responses vision preference.
    return /^(gpt-|o[134](?:-|$))/.test(model.id)
        && !/(audio|realtime|transcribe|tts|image|codex|search|instruct|gpt-3\.5)/i.test(model.id);
}

function createModelCatalog(provider, directory, fetchImpl = (...args) => fetch(...args)) {
    if (!['gemini', 'openai', 'claude', 'deepseek', 'groq'].includes(provider)) throw new Error('provider');
    const file = key => path.join(directory, `${provider}-models-${crypto.createHash('sha256').update(key).digest('hex')}.json`);
    function cached(key) {
        if (!key) return [];
        try {
            const data = JSON.parse(fs.readFileSync(file(key), 'utf8'));
            return Array.isArray(data) ? data.filter(item => typeof item.id === 'string' && typeof item.label === 'string' && typeof item.selectable === 'boolean') : [];
        } catch { return []; }
    }
    async function refresh(key) {
        if (typeof key !== 'string' || !key.trim()) return { success: false, error: 'key_required' };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
            const found = new Map();
            let token = '';
            const tokens = new Set();
            for (let page = 0; page < 50; page++) {
                const url = provider === 'gemini'
                    ? `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`
                    : provider === 'claude' ? `https://api.anthropic.com/v1/models?limit=1000${token ? `&after_id=${encodeURIComponent(token)}` : ''}`
                    : provider === 'deepseek' ? 'https://api.deepseek.com/models'
                    : provider === 'groq' ? 'https://api.groq.com/openai/v1/models' : 'https://api.openai.com/v1/models';
                const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error',
                    headers: provider === 'gemini' ? { 'x-goog-api-key': key } : provider === 'claude'
                        ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { Authorization: `Bearer ${key}` } });
                if (!response.ok) return { success: false, error: [401, 403].includes(response.status) ? 'unauthorized' : 'failed' };
                const data = await response.json();
                const rows = provider === 'gemini' ? data.models : data.data;
                if (!Array.isArray(rows)) throw new Error('invalid_response');
                for (const row of rows) {
                    const id = provider === 'gemini' ? String(row.name || '').replace(/^models\//, '') : row.id;
                    if (typeof id !== 'string' || !/^[a-zA-Z0-9._:/-]{1,200}$/.test(id)) continue;
                    found.set(id, { id, label: String(row.displayName || row.display_name || row.name || id).slice(0, 250), selectable: !!selectable(provider, row),
                        inputModalities: Array.isArray(row.input_modalities) ? row.input_modalities.filter(v => ['text', 'image'].includes(v)) : null });
                }
                token = provider === 'gemini' ? data.nextPageToken : provider === 'claude' && data.has_more ? data.last_id : '';
                if (provider === 'claude' && data.has_more && !token) throw new Error('pagination');
                if (!token) break;
                if (typeof token !== 'string' || tokens.has(token) || page === 49) throw new Error('pagination');
                tokens.add(token);
            }
            const models = [...found.values()].sort((a, b) => Number(b.selectable) - Number(a.selectable) || a.id.localeCompare(b.id));
            if (!models.length) return { success: false, error: 'empty' };
            await fs.promises.mkdir(directory, { recursive: true });
            const target = file(key), temp = `${target}.${crypto.randomUUID()}.tmp`;
            try {
                await fs.promises.writeFile(temp, JSON.stringify(models), 'utf8');
                await fs.promises.rename(temp, target);
            } finally { await fs.promises.rm(temp, { force: true }); }
            return { success: true, models };
        } catch { return { success: false, error: 'failed' }; }
        finally { clearTimeout(timer); }
    }
    return { cached, refresh };
}
module.exports = { createModelCatalog, selectable };
