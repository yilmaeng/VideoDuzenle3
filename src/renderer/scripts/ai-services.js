(() => {
    'use strict';
    const t = (key, args) => window.i18nHelper ? window.i18nHelper.t(`ai_services.${key}`, args) : window.t(`ai_services.${key}`, `ai_services.${key}`, args);
    const ipc = window.api?.aiServices ? null : require('electron').ipcRenderer;
    const call = (action, input) => ipc ? ipc.invoke(`ai-services-${action}`, input) : window.api.aiServices(action, input);
    let active;
    function pricingText(html) {
        const template = document.createElement('template');
        template.innerHTML = html;
        template.content.querySelectorAll('script,style,nav,header,footer,svg,img,iframe,noscript,button,[hidden],[aria-hidden="true"]').forEach(node => node.remove());
        const root = template.content.querySelector('main,article') || template.content;
        root.querySelectorAll('th,td').forEach(node => node.append(' | '));
        root.querySelectorAll('p,div,section,tr,h1,h2,h3,h4,li,br').forEach(node => node.append('\n'));
        return root.textContent.replace(/[\t ]+/g, ' ').replace(/\n\s*\n/g, '\n').trim().slice(0, 120000);
    }
    async function open(initialProvider) {
        if (active || document.querySelector('dialog[open]')) return;
        const previous = document.activeElement;
        const dialog = document.createElement('dialog'); active = dialog;
        dialog.id = 'ai-services-dialog'; dialog.setAttribute('aria-labelledby', 'ais-title');
        dialog.style.cssText = 'width:min(760px,94vw);max-height:90vh;overflow:auto;margin:auto';
        dialog.innerHTML = `<style>
            #ai-services-dialog section { margin-block: 1.2rem; }
            #ai-services-dialog label { display: block; margin-top: .7rem; }
            #ai-services-dialog select { display: block; width: 100%; margin-block: .4rem .8rem; }
            #ai-services-dialog button { display: block; margin-block: .6rem; }
            #ai-services-dialog textarea { background: var(--bg-secondary, #182b3d); color: inherit; border: 1px solid currentColor; padding: .5rem; }
            #ai-services-dialog p { margin-block: .6rem; }
            </style><h2 id="ais-title" data-i18n="ai_services.title"></h2>
            <p data-i18n="ai_services.scope"></p>
            <section><h3 data-i18n="ai_services.settings"></h3>
            <label for="ais-primary" data-i18n="ai_services.primary"></label><select id="ais-primary"></select>
            <label><input id="ais-fallback-enabled" type="checkbox"><span data-i18n="ai_services.fallback_enabled"></span></label>
            <label for="ais-fallback" data-i18n="ai_services.fallback"></label><select id="ais-fallback"></select>
            <p data-i18n="ai_services.fallback_help"></p>
            <button type="button" data-action="preferences" data-i18n="ai_services.save_preferences"></button></section>
            <section><h3 data-i18n="ai_services.credentials"></h3>
            <label for="ais-provider" data-i18n="ai_services.provider"></label><select id="ais-provider"></select>
            <p data-key-status></p>
            <label for="ais-key" data-i18n="ai_services.key"></label><input id="ais-key" type="password" autocomplete="off" spellcheck="false" style="width:100%">
            <label><input id="ais-show" type="checkbox"><span data-i18n="ai_services.show_key"></span></label>
            <p data-i18n="ai_services.key_help"></p>
            <button type="button" data-action="key-guide" data-i18n="api_key_guide.button"></button>
            <label for="ais-model" data-i18n="ai_services.model"></label><select id="ais-model"></select>
            <button type="button" data-action="refresh" data-i18n="ai_services.refresh"></button>
            <p data-i18n="ai_services.models_help"></p>
            <button type="button" data-action="save" data-i18n="ai_services.save_service"></button>
            </section><section><h3 data-i18n="ai_services.prices"></h3>
            <p data-i18n="ai_services.pricing_help"></p>
            <button type="button" data-action="prices" data-i18n="ai_services.fetch_prices"></button>
            <button type="button" data-action="website" data-i18n="ai_services.open_prices"></button>
            <label for="ais-pricing" data-i18n="ai_services.pricing_text"></label>
            <textarea id="ais-pricing" rows="9" aria-readonly="true" aria-multiline="true" class="readonly-textarea-simulated" style="width:100%"></textarea>
            </section><p role="status" aria-live="polite" aria-atomic="true" data-status></p>
            <button type="button" data-action="close" data-i18n="ai_services.close"></button>`;
        const field = id => dialog.querySelector(`#ais-${id}`), button = id => dialog.querySelector(`[data-action="${id}"]`);
        const say = message => { dialog.querySelector('[data-status]').textContent = ''; setTimeout(() => { if (dialog.isConnected) dialog.querySelector('[data-status]').textContent = message; }, 30); };
        let data, busy = false, closed = false;
        function controls(value) {
            busy = value;
            dialog.querySelectorAll('button,input,select').forEach(node => { node.disabled = value; });
            button('close').disabled = false;
            if (!value) field('fallback').disabled = !field('fallback-enabled').checked;
        }
        function options(select, rows, selected) {
            select.replaceChildren();
            for (const row of rows) {
                const option = document.createElement('option'); option.value = row.id;
                option.textContent = row.name ? t(`providers.${row.id}`) : row.label || row.id; option.disabled = row.selectable === false;
                select.append(option);
            }
            select.value = selected;
        }
        function renderModels(rows, selected) {
            const models = [...rows];
            if (selected && !models.some(m => m.id === selected)) models.unshift({ id: selected, label: `${selected} (${t('retained')})` });
            options(field('model'), models, selected || models.find(m => m.selectable !== false)?.id);
        }
        function renderProvider() {
            const provider = data.providers.find(p => p.id === field('provider').value);
            field('key').value = ''; field('show').checked = false; field('key').type = 'password';
            dialog.querySelector('[data-key-status]').textContent = t(provider.keyError ? 'errors.secure_storage' : provider.hasKey ? 'key_saved' : 'key_missing');
            renderModels(provider.models, provider.model);
            field('pricing').value = ''; // Never show another provider's prices after changing selection.
        }
        async function run(action, operation) {
            if (busy) return;
            controls(true); say(t('working'));
            try {
                const result = await operation();
                if (closed) return;
                if (!result.success) throw new Error(result.error || 'request');
                return result;
            } catch (error) { if (!closed) say(t(`errors.${['key_required','unauthorized','empty','model','key','same_provider','secure_storage','pricing','unsupported'].includes(error.message) ? error.message : 'request'}`)); }
            finally { if (!closed) { controls(false); button(action).focus(); } }
        }
        field('show').onchange = () => { field('key').type = field('show').checked ? 'text' : 'password'; };
        field('provider').onchange = renderProvider;
        button('key-guide').onclick = () => window.ApiKeyGuide.open(field('provider').value);
        field('fallback-enabled').onchange = () => { field('fallback').disabled = !field('fallback-enabled').checked; };
        for (const type of ['beforeinput', 'paste', 'cut', 'drop']) field('pricing').addEventListener(type, event => event.preventDefault());
        button('refresh').onclick = async () => {
            const selected = field('model').value;
            const result = await run('refresh', () => call('refresh', { provider: field('provider').value, apiKey: field('key').value }));
            if (result) { renderModels(result.models, selected); say(t('models_loaded', { count: result.models.length })); }
        };
        button('save').onclick = async () => {
            const result = await run('save', () => call('save-service', { provider: field('provider').value, apiKey: field('key').value, model: field('model').value }));
            if (result) { data = result; renderProvider(); say(t('saved')); }
        };
        button('preferences').onclick = async () => {
            const result = await run('preferences', () => call('save-settings', { primary: field('primary').value, fallback: field('fallback').value, fallbackEnabled: field('fallback-enabled').checked }));
            if (result) { data = result; say(t('saved')); }
        };
        button('prices').onclick = async () => {
            field('pricing').value = '';
            const result = await run('prices', () => call('pricing', { provider: field('provider').value }));
            if (result) {
                const content = pricingText(result.html);
                if (content.length < 100 || !/\$|USD|pricing|price|token|fiyat/i.test(content)) { say(t('errors.pricing')); return; }
                field('pricing').value = `${t('retrieved', { date: new Date(result.retrievedAt).toLocaleString() })}\n${result.url}\n${t('pricing_disclaimer')}\n\n${content}`;
                say(t('prices_loaded'));
            }
        };
        button('website').onclick = () => run('website', async () => {
            const result = await call('open-pricing', { provider: field('provider').value }); if (result.success) say(t('website_opened')); return result;
        });
        const close = () => { closed = true; field('key').value = ''; dialog.close(); dialog.remove(); active = null; window.removeEventListener('keydown', guard, true); previous?.focus(); };
        button('close').onclick = close;
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        // Native input/select editing (including Cmd+V) must not reach timeline shortcuts.
        function guard(event) { if (dialog.contains(event.target)) event.stopPropagation(); }
        window.addEventListener('keydown', guard, true);
        document.body.append(dialog);
        if (window.i18nHelper) window.i18nHelper.translateDOM(dialog);
        else dialog.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = window.t(el.dataset.i18n, el.dataset.i18n); });
        dialog.showModal(); controls(true); button('close').focus();
        try {
            const result = await call('status'); if (closed) return;
            if (!result.success) throw new Error(); data = result;
            options(field('primary'), data.providers, data.settings.primary); options(field('fallback'), data.providers, data.settings.fallback);
            options(field('provider'), data.providers, initialProvider || data.settings.primary);
            field('fallback-enabled').checked = data.settings.fallbackEnabled;
            renderProvider(); controls(false); field(initialProvider ? 'key' : 'primary').focus();
        } catch { if (!closed) say(t('errors.request')); }
    }
    async function request(params) {
        const response = await call('request', params);
        return response.success ? response : { ...response, error: response.message || t(`errors.${response.error || 'request'}`) };
    }
    window.AiServices = { open, request, pricingText };
    const notice = message => {
        if (window.Accessibility) window.Accessibility.announce(message);
        else if (window.announce) window.announce(message);
        else { const region = document.getElementById('ai-live-region'); if (region) region.textContent = message; }
    };
    if (ipc) ipc.on('ai-services-notice', (_event, message) => notice(message));
    else {
        window.api.onAiServicesOpen(provider => open(provider));
        window.api.onAiServicesNotice(notice);
    }
})();
