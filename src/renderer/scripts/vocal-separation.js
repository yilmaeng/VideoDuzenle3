(() => {
    'use strict';
    const t = (key, args) => window.i18nHelper.t(`vocal_separation.${key}`, args);
    let current = null;
    async function open() {
        if (current || document.querySelector('dialog[open]')) return;
        VideoPlayer.pause({ announce: false });
        const previous = document.activeElement;
        const dialog = document.createElement('dialog');
        current = dialog;
        dialog.setAttribute('aria-labelledby', 'vocal-title');
        dialog.style.cssText = 'width:min(680px,90vw);max-height:85vh;overflow:auto';
        dialog.innerHTML = `
            <h2 id="vocal-title" data-i18n="vocal_separation.title"></h2>
            <p data-i18n="vocal_separation.help"></p>
            <label for="vocal-source" data-i18n="vocal_separation.source"></label>
            <input id="vocal-source" type="text" readonly style="width:100%">
            <button type="button" data-action="source" data-i18n="vocal_separation.choose"></button>
            <fieldset><legend data-i18n="vocal_separation.selection_scope"></legend>
                <input type="radio" name="vocal-scope" id="vocal-whole" value="whole" checked>
                <label for="vocal-whole" data-i18n="vocal_separation.selection_whole"></label>
                <input type="radio" name="vocal-scope" id="vocal-selected" value="selections">
                <label for="vocal-selected" data-i18n="vocal_separation.selection_only"></label>
            </fieldset>
            <p data-selection-info></p>
            <p data-i18n="vocal_separation.selection_help"></p>
            <fieldset><legend data-i18n="vocal_separation.output"></legend>
                <input type="radio" name="vocal-mode" id="vocal-instrumental" value="instrumental" checked>
                <label for="vocal-instrumental" data-i18n="vocal_separation.instrumental"></label>
                <input type="radio" name="vocal-mode" id="vocal-vocals" value="vocals">
                <label for="vocal-vocals" data-i18n="vocal_separation.vocals"></label>
                <input type="radio" name="vocal-mode" id="vocal-both" value="both">
                <label for="vocal-both" data-i18n="vocal_separation.both"></label>
            </fieldset>
            <fieldset><legend data-i18n="vocal_separation.format"></legend>
                <input type="radio" name="vocal-format" id="vocal-wav" value="wav" checked>
                <label for="vocal-wav" data-i18n="vocal_separation.wav"></label>
                <input type="radio" name="vocal-format" id="vocal-mp4" value="mp4">
                <label for="vocal-mp4" data-i18n="vocal_separation.mp4"></label>
            </fieldset>
            <div data-consent hidden><input type="checkbox" id="vocal-consent">
                <label for="vocal-consent" data-i18n="vocal_separation.consent"></label></div>
            <p data-status></p>
            <label for="vocal-progress" data-i18n="vocal_separation.progress"></label>
            <progress id="vocal-progress" max="100" value="0"></progress>
            <p data-eta></p><p data-live role="status" aria-live="polite" aria-atomic="true" class="sr-only"></p>
            <button type="button" data-action="run" data-i18n="vocal_separation.run" disabled></button>
            <button type="button" data-action="cancel" data-i18n="vocal_separation.cancel" disabled></button>
            <button type="button" data-action="close" data-i18n="vocal_separation.close"></button>`;
        const source = dialog.querySelector('#vocal-source');
        const progress = dialog.querySelector('progress');
        const status = dialog.querySelector('[data-status]');
        const live = dialog.querySelector('[data-live]');
        const eta = dialog.querySelector('[data-eta]');
        const consent = dialog.querySelector('#vocal-consent');
        const button = name => dialog.querySelector(`[data-action="${name}"]`);
        source.value = Timeline.sourceFile || VideoPlayer.currentFilePath || '';
        const selections = (window.App?.verticalClipQueue || []).map(row => ({ sourcePath: row.sourcePath, startTime: row.startTime, endTime: row.endTime }));
        const sameSource = value => {
            const normalize = v => window.api.platform === 'win32' ? String(v).replace(/\//g, '\\').toLowerCase() : String(v);
            return normalize(value) === normalize(source.value);
        };
        const selectedScope = () => dialog.querySelector('#vocal-selected').checked;
        const setFormat = () => { dialog.querySelector(/\.(mp4|mov|mkv|avi|webm|m4v)$/i.test(source.value) ? '#vocal-mp4' : '#vocal-wav').checked = true; };
        setFormat();
        let busy = false, ready = false, inspected = false, lastStage = '', lastAnnouncement = 0;
        const say = message => { status.textContent = message; live.textContent = message; };
        function controls() {
            const validSelections = selections.length > 0 && selections.every(row => sameSource(row.sourcePath));
            button('run').disabled = busy || !inspected || !source.value || (!ready && !consent.checked) || (selectedScope() && !validSelections);
            button('source').disabled = busy;
            button('cancel').disabled = !busy;
            dialog.querySelectorAll('input').forEach(input => { input.disabled = busy; });
            dialog.querySelector('[data-selection-info]').textContent = validSelections
                ? t('selection_count', { count: selections.length }) : t('selection_empty');
            if (selectedScope()) {
                dialog.querySelector('#vocal-instrumental').checked = true;
                dialog.querySelector('#vocal-vocals').disabled = true;
                dialog.querySelector('#vocal-both').disabled = true;
            }
        }
        dialog.querySelectorAll('[name="vocal-scope"]').forEach(input => { input.onchange = controls; });
        async function inspect() {
            try {
                const info = await window.api.vocalSeparationInspect();
                if (current !== dialog) return;
                ready = info.ready;
                inspected = true;
                dialog.querySelector('[data-consent]').hidden = ready;
                say(t(ready ? 'ready' : 'download_needed'));
                controls();
            } catch { say(t('errors.failed')); }
        }
        function close() {
            if (busy) { window.api.vocalSeparationCancel(); say(t('cancelling')); return; }
            unsubscribe();
            window.removeEventListener('keydown', guard, true);
            current = null;
            dialog.remove();
            if (previous?.isConnected) previous.focus();
        }
        const guard = event => {
            if (!dialog.contains(event.target)) return;
            event.stopPropagation();
            if (event.key === 'Escape') { event.preventDefault(); close(); }
        };
        const unsubscribe = window.api.onVocalSeparationProgress(data => {
            if (!busy) return;
            const stage = data.stage === 'separated' ? 'exporting' : data.stage;
            if (Number.isFinite(data.percent)) progress.value = Math.floor(data.percent);
            else progress.removeAttribute('value');
            const message = t(stage === 'preparing_selections' ? 'selection_prepare' : stage === 'assembling' ? 'selection_assemble' : `stages.${stage}`);
            status.textContent = message;
            eta.textContent = Number.isFinite(data.remainingSeconds)
                ? t('eta', { minutes: Math.max(1, Math.ceil(data.remainingSeconds / 60)) }) : t('eta_pending');
            if (lastStage !== stage || Date.now() - lastAnnouncement > 30000) {
                live.textContent = `${message} ${Number.isFinite(data.percent) ? t('percent', { percent: Math.floor(data.percent) }) : ''} ${eta.textContent}`;
                lastStage = stage; lastAnnouncement = Date.now();
            }
        });
        button('source').onclick = async () => {
            try {
                const file = await window.api.vocalSeparationSource();
                if (current !== dialog) return;
                if (file) { source.value = file; setFormat(); controls(); }
            } catch { if (current === dialog) say(t('errors.failed')); }
            finally { if (current === dialog) button('source').focus(); }
        };
        consent.onchange = controls;
        button('cancel').onclick = () => { window.api.vocalSeparationCancel(); say(t('cancelling')); button('cancel').disabled = true; };
        button('close').onclick = close;
        button('run').onclick = async () => {
            if (busy) return;
            if (selectedScope() && (Timeline.hasChanges || window.App?.hasChanges)) { say(t('selection_save_first')); return; }
            busy = true; controls(); lastStage = ''; progress.removeAttribute('value');
            button('cancel').focus();
            say(t('stages.loading'));
            try {
                const result = await window.api.vocalSeparationRun({ source: source.value,
                    scope: selectedScope() ? 'selections' : 'whole', selections: selectedScope() ? selections : undefined,
                    mode: dialog.querySelector('input[name="vocal-mode"]:checked').value,
                    format: dialog.querySelector('input[name="vocal-format"]:checked').value,
                    consent: consent.checked });
                eta.textContent = '';
                if (result.cancelled) say(t('cancelled'));
                else if (result.error) { say(t(result.error === 'selections' ? 'selection_error' : `errors.${result.error}`)); Utils.playSound('error'); }
                else {
                    progress.value = 100;
                    say(t('done', { directory: result.directory, minutes: Math.ceil(result.seconds / 60) }));
                    Utils.playSound('success');
                }
                const info = await window.api.vocalSeparationInspect();
                ready = info.ready;
                dialog.querySelector('[data-consent]').hidden = ready;
            } catch { say(t('errors.failed')); Utils.playSound('error'); }
            finally { busy = false; controls(); button('run').focus(); }
        };
        // Local controls use native keyboard behavior; only the open command is configurable.
        window.addEventListener('keydown', guard, true);
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        document.body.appendChild(dialog);
        window.i18nHelper.translateDOM(dialog);
        dialog.showModal();
        button('source').focus();
        await inspect();
    }
    window.VocalSeparation = { open };
})();
