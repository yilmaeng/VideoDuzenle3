(() => {
    'use strict';
    let active = false;
    const t = (key, args) => window.i18nHelper.t(`automatic_subtitles.${key}`, args);
    async function open() {
        if (active || !VideoPlayer.hasVideo()) return;
        const choice = await Dialogs.showAccessibleChoice({ title: t('title'), message: t('choose'),
            buttons: [t('file'), t('generate'), window.i18nHelper.t('dialog.cancel')], cancelValue: 2 });
        if (choice === 0) {
            const result = await window.api.openFileDialog({ title: t('file'),
                filters: [{ name: t('file'), extensions: ['srt','vtt','ass','ssa'] }], properties: ['openFile'] });
            if (!result.canceled && result.filePaths?.[0]) await App.insertSubtitle(result.filePaths[0]);
        } else if (choice === 1) await generate();
    }
    async function generate() {
        if (active || !VideoPlayer.hasVideo() || !App.currentFilePath) return;
        active = true;
        const source = App.currentFilePath;
        const previousFocus = document.activeElement;
        VideoPlayer.pause({ announce: false });
        const dialog = document.createElement('dialog');
        dialog.setAttribute('aria-labelledby', 'automatic-subtitles-title');
        dialog.style.cssText = 'width:min(650px,90vw);max-height:85vh;overflow:auto';
        dialog.innerHTML = `<h2 id="automatic-subtitles-title" data-i18n="automatic_subtitles.generate"></h2>
            <p data-i18n="automatic_subtitles.info"></p>
            <p data-info></p><p data-size></p>
            <fieldset><legend data-i18n="speech_search.model_choice"></legend>
            <input type="radio" name="automatic-subtitles-model" id="automatic-subtitles-small" value="Xenova/whisper-small" checked>
            <label for="automatic-subtitles-small" data-i18n="speech_search.model_small"></label>
            <input type="radio" name="automatic-subtitles-model" id="automatic-subtitles-base" value="Xenova/whisper-base">
            <label for="automatic-subtitles-base" data-i18n="speech_search.model_base"></label></fieldset>
            <label for="automatic-subtitles-progress" data-i18n="speech_search.progress_label"></label>
            <progress id="automatic-subtitles-progress" max="100" value="0"></progress>
            <p data-status role="status" aria-live="polite"></p>
            <button type="button" data-start data-i18n="automatic_subtitles.start" disabled></button>
            <button type="button" data-close data-i18n="dialog.cancel"></button>`;
        document.body.append(dialog); window.i18nHelper.translateDOM(dialog);
        const models = [...dialog.querySelectorAll('input[name="automatic-subtitles-model"]')];
        const modelValue = () => models.find(radio => radio.checked).value;
        const start = dialog.querySelector('[data-start]');
        const status = dialog.querySelector('[data-status]'), progress = dialog.querySelector('progress');
        const info = dialog.querySelector('[data-info]');
        dialog.querySelector('[data-size]').textContent = window.i18nHelper.t(`speech_search.${window.api.platform === 'win32' ? 'model_size_windows' : 'model_size_other'}`);
        let job = null, closed = false, inspection = 0, unsubscribe = null;
        const close = () => {
            if (closed) return;
            closed = true; inspection++;
            if (job) window.api.speechSearchCancel(job).catch(console.warn);
            unsubscribe?.(); dialog.close(); dialog.remove(); active = false;
            if (previousFocus?.isConnected) previousFocus.focus();
        };
        dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
        dialog.addEventListener('close', close);
        dialog.querySelector('[data-close]').addEventListener('click', close);
        async function inspect() {
            const token = ++inspection; start.disabled = true;
            try {
                const result = await window.api.speechSearchInspect({ model: modelValue() });
                if (closed || token !== inspection) return;
                info.textContent = window.i18nHelper.t(`speech_search.${result.ready ? 'local_info' : 'download_consent'}`);
                start.disabled = !(result.supported && result.available !== false);
                if (start.disabled) status.textContent = window.i18nHelper.t('speech_search.unsupported');
            } catch (error) { if (!closed) status.textContent = t('error', { error: String(error.message || error) }); }
        }
        models.forEach(radio => radio.addEventListener('change', inspect));
        start.addEventListener('click', async () => {
            if (job || closed) return;
            start.disabled = true; models.forEach(radio => { radio.disabled = true; });
            job = `auto-subtitle-${Date.now()}`;
            let last = '';
            unsubscribe = window.api.onSpeechSearchProgress(event => {
                if (closed || event.jobId !== job || !['model','extract','analyze','complete'].includes(event.stage)) return;
                const percent = Number.isFinite(event.percent) && !event.indeterminate ? Math.max(0, Math.min(100, event.percent)) : null;
                if (percent === null) progress.removeAttribute('value'); else progress.value = percent;
                const key = `${event.stage}:${percent === null ? -1 : Math.floor(percent/10)}`;
                if (key !== last) {
                    last = key;
                    status.textContent = window.i18nHelper.t(`speech_search.${percent === null ? 'progress_indeterminate' : 'progress'}`, {
                        stage: window.i18nHelper.t(`speech_search.stages.${event.stage}`), percent: Math.round(percent || 0) });
                }
            });
            try {
                status.textContent = window.i18nHelper.t('speech_search.starting');
                const result = await window.api.speechSearchAnalyze({ sources: [source], model: modelValue(), jobId: job });
                if (closed) return;
                const content = window.AutomaticSubtitlesCore.toSrt(result.transcripts?.[0] || {});
                if (!content) { status.textContent = t('empty'); return; }
                progress.value = 100; status.textContent = t('ready');
                const save = await window.api.showSaveDialog({ title: t('save'), sourceFilePath: source,
                    defaultPath: source.replace(/\.[^./\\]+$/, '') + '_subtitles.srt',
                    filters: [{ name: t('file'), extensions: ['srt'] }] });
                if (closed || save.canceled || !save.filePath) return;
                const written = await window.api.saveFileContent({ filePath: save.filePath, content });
                if (!written?.success) throw new Error(written?.error || t('save'));
                if (closed) return;
                if (App.currentFilePath !== source) throw new Error(t('source_changed'));
                job = null; close();
                await App.insertSubtitle(save.filePath);
            } catch (error) {
                if (!closed) status.textContent = t('error', { error: String(error.message || error) });
            } finally {
                unsubscribe?.(); unsubscribe = null; job = null;
                if (!closed) { models.forEach(radio => { radio.disabled = false; }); start.disabled = false; }
            }
        });
        dialog.showModal(); models[0].focus(); await inspect();
    }
    window.AutomaticSubtitles = { open, generate };
})();
