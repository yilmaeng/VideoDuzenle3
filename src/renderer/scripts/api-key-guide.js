(() => {
    'use strict';
    const links = Object.freeze({
        gemini: ['https://aistudio.google.com/api-keys', 'https://ai.google.dev/gemini-api/docs/api-key'],
        openai: ['https://platform.openai.com/api-keys', 'https://developers.openai.com/api/docs/quickstart'],
        claude: ['https://platform.claude.com/settings/keys', 'https://platform.claude.com/docs/en/api/overview'],
        deepseek: ['https://platform.deepseek.com/api_keys', 'https://api-docs.deepseek.com/'],
        groq: ['https://console.groq.com/keys', 'https://console.groq.com/docs/quickstart'],
        elevenlabs: ['https://elevenlabs.io/app/developers/api-keys', 'https://elevenlabs.io/docs/eleven-api/quickstart']
    });
    const t = (key, args) => window.i18nHelper ? window.i18nHelper.t(`api_key_guide.${key}`, args) : window.t(`api_key_guide.${key}`, `api_key_guide.${key}`, args);
    let active;
    function open(provider) {
        if (!Object.hasOwn(links, provider) || active) return;
        const origin = document.activeElement;
        const dialog = document.createElement('dialog'); active = dialog;
        dialog.id = 'api-key-guide';
        dialog.setAttribute('aria-labelledby', 'akg-title');
        dialog.setAttribute('aria-describedby', 'akg-intro');
        dialog.style.cssText = 'width:min(720px,94vw);max-height:90vh;overflow:auto;margin:auto';
        dialog.innerHTML = `<h2 id="akg-title"></h2><p id="akg-intro"></p>
            <label for="akg-steps"></label><textarea id="akg-steps" rows="15" aria-readonly="true" aria-multiline="true" class="readonly-textarea-simulated" style="width:100%;box-sizing:border-box;background:var(--bg-secondary);color:inherit"></textarea>
            <p><a data-link="0" target="_blank" rel="noopener noreferrer"></a></p>
            <p><a data-link="1" target="_blank" rel="noopener noreferrer"></a></p>
            <p role="status" aria-live="polite" aria-atomic="true"></p><button type="button"></button>`;
        dialog.querySelector('h2').textContent = t('title', { provider: t(`providers.${provider}`) });
        dialog.querySelector('#akg-intro').textContent = t('intro');
        dialog.querySelector('label').textContent = t('steps_label');
        const area = dialog.querySelector('textarea');
        area.value = `${t(`steps.${provider}`)}\n\n${t('finish')}\n\n${t('security')}`;
        for (const type of ['beforeinput', 'paste', 'cut', 'drop']) area.addEventListener(type, event => event.preventDefault());
        for (const anchor of dialog.querySelectorAll('a')) {
            const index = Number(anchor.dataset.link);
            anchor.href = links[provider][index];
            anchor.textContent = t(index ? 'documentation' : 'open_keys', { provider: t(`providers.${provider}`) });
            anchor.onclick = async event => {
                event.preventDefault();
                const status = dialog.querySelector('[role="status"]');
                try {
                    const result = window.api?.openExternalUrl ? await window.api.openExternalUrl(links[provider][index]) : await require('electron').shell.openExternal(links[provider][index]);
                    if (result?.success === false) throw new Error('open_failed');
                    status.textContent = t('opened');
                } catch { status.textContent = t('open_failed'); }
            };
        }
        const close = () => { dialog.close(); dialog.remove(); active = null; if (origin?.isConnected) origin.focus(); };
        dialog.querySelector('button').textContent = t('close');
        dialog.querySelector('button').onclick = close;
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        dialog.addEventListener('keydown', event => event.stopPropagation());
        document.body.append(dialog); dialog.showModal(); area.focus(); area.setSelectionRange(0, 0);
    }
    // Contextual setup help is reached with Tab from the existing API settings command;
    // no separate global shortcut is needed for this infrequent, provider-specific action.
    document.addEventListener('click', event => {
        const button = event.target.closest('[data-api-key-guide]');
        if (button) open(button.dataset.apiKeyGuide);
    });
    window.ApiKeyGuide = { open };
})();
