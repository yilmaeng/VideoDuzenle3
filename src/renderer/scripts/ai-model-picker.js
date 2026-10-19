(() => {
    'use strict';
    const states = new Map();
    const t = (key, params) => window.i18nHelper.t(`ai_models.${key}`, params);
    function render(select, models, selected) {
        const items = [...models];
        if (selected && !items.some(item => item.id === selected)) {
            items.unshift({ id: selected, label: `${selected} (${t('retained')})`, selectable: true });
        }
        select.replaceChildren();
        for (const item of items) {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = `${item.label}${item.label !== item.id ? ` [${item.id}]` : ''}${item.selectable ? '' : ` (${t('incompatible')})`}`;
            option.disabled = !item.selectable;
            select.appendChild(option);
        }
        select.value = selected;
    }
    function prepare(provider, data) {
        const select = document.getElementById(`${provider}-model-select`);
        const input = document.getElementById(`${provider}-api-key-input`);
        const button = document.getElementById(`${provider}-models-refresh`);
        const status = document.getElementById(`${provider}-models-status`);
        const dialog = document.getElementById(`${provider}-api-key-dialog`);
        if (!select || !button) return;
        states.get(provider)?.controller.abort();
        const controller = new AbortController();
        const state = { controller, busy: false };
        states.set(provider, state);
        const defaults = provider === 'gemini' ? ['gemini-2.5-flash', 'gemini-2.5-pro'] : ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o'];
        const selected = data.model || defaults[0];
        render(select, data.models?.length ? data.models : defaults.map(id => ({ id, label: id, selectable: true })), selected);
        button.removeAttribute('aria-disabled');
        status.textContent = '';
        // This is a dialog-local action reached by Tab, not a global command.
        button.addEventListener('click', async () => {
            if (state.busy) return;
            const key = input.value.trim();
            if (!key) { status.textContent = t('key_required'); return; }
            state.busy = true;
            button.setAttribute('aria-disabled', 'true');
            status.textContent = t('loading');
            try {
                const result = await window.api.refreshAiModels(provider, key);
                if (controller.signal.aborted || !dialog.open) return;
                if (input.value.trim() !== key) { status.textContent = ''; return; }
                if (!result.success) { status.textContent = t(result.error || 'failed'); return; }
                render(select, result.models, select.value);
                status.textContent = t('loaded', { count: result.models.length });
            } catch {
                if (!controller.signal.aborted && dialog.open) status.textContent = t('failed');
            } finally {
                if (!controller.signal.aborted) {
                    state.busy = false;
                    button.removeAttribute('aria-disabled');
                }
            }
        }, { signal: controller.signal });
        dialog.addEventListener('close', () => controller.abort(), { once: true, signal: controller.signal });
    }
    window.AiModelPicker = { prepare };
})();
