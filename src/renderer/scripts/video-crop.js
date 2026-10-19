(() => {
    'use strict';
    const t = (key, args) => window.i18nHelper.t(`video_crop.${key}`, args);
    let current;
    async function open() {
        if (current || document.querySelector('dialog[open]') || !VideoPlayer.hasVideo()) return;
        if (App.hasChanges || Timeline.hasChanges ||
            (typeof CtaOverlayPreview !== 'undefined' && CtaOverlayPreview.getOverlayCount() > 0) ||
            (typeof Transitions !== 'undefined' && Transitions.getCount() > 0)) {
            Accessibility.announce(t('save_first')); return;
        }
        VideoPlayer.pause({ announce: false });
        const previous = document.activeElement, source = App.currentFilePath || VideoPlayer.currentFilePath;
        const dialog = document.createElement('dialog'); current = dialog;
        dialog.id = 'video-crop-dialog';
        dialog.setAttribute('aria-labelledby', 'crop-title');
        dialog.style.cssText = 'width:min(900px,94vw);max-width:94vw;max-height:90vh;overflow:auto;margin:auto';
        dialog.innerHTML = `<h2 id="crop-title" data-i18n="video_crop.title"></h2>
            <details><summary data-i18n="video_crop.help_title"></summary><p data-i18n="video_crop.help"></p></details>
            <button type="button" data-action="analyze" data-i18n="video_crop.analyze"></button>
            <label for="crop-report" data-i18n="video_crop.report"></label>
            <textarea id="crop-report" rows="4" aria-readonly="true" aria-multiline="true" style="width:100%"></textarea>
            <fieldset><legend data-i18n="video_crop.edges"></legend>
            <div class="crop-edge-grid">${['top', 'bottom', 'left', 'right'].map(k => `<div class="form-group"><label for="crop-${k}" data-i18n="video_crop.${k}"></label>
                <input id="crop-${k}" type="number" min="0" step="2" value="0" disabled></div>`).join('')}</div>
            </fieldset>
            <p data-size></p>
            <button type="button" data-action="reset" data-i18n="video_crop.reset" disabled></button>
            <canvas width="640" height="360" role="img" data-i18n-aria="video_crop.preview" style="display:block;max-width:100%;height:auto"></canvas>
            <button type="button" data-action="previous" data-i18n="video_crop.previous" disabled></button>
            <button type="button" data-action="next" data-i18n="video_crop.next" disabled></button>
            <p data-i18n="video_crop.ai_privacy"></p>
            <fieldset><legend data-i18n="video_crop.ai_goal"></legend>
                <input id="crop-goal-borders" type="radio" name="crop-goal" value="borders">
                <label for="crop-goal-borders" data-i18n="video_crop.goal_borders"></label>
                <input id="crop-goal-framing" type="radio" name="crop-goal" value="framing" checked>
                <label for="crop-goal-framing" data-i18n="video_crop.goal_framing"></label>
            </fieldset>
            <p data-i18n="video_crop.goal_help"></p>
            <fieldset id="crop-framing-options" disabled><legend data-i18n="video_crop.tightness"></legend>
                ${['careful', 'balanced', 'tight'].map((value, index) => `<input type="radio" name="crop-tightness" id="crop-tightness-${value}" value="${value}" ${index === 0 ? 'checked' : ''}><label for="crop-tightness-${value}" data-i18n="video_crop.tightness_${value}"></label>`).join('')}
                <div><input type="checkbox" id="crop-protect-hands" checked><label for="crop-protect-hands" data-i18n="video_crop.protect_hands"></label></div>
            </fieldset>
            <p data-i18n="video_crop.interior_gap_help"></p>
            <label for="crop-provider" data-i18n="video_crop.provider"></label>
            <select id="crop-provider"><option value="" data-i18n="ai_services.automatic"></option>${['gemini','openai','claude','deepseek','groq'].map(provider => `<option value="${provider}" data-i18n="ai_services.providers.${provider}"></option>`).join('')}</select>
            <label for="crop-request" data-i18n="video_crop.request_label"></label>
            <textarea id="crop-request" rows="3" maxlength="3000" style="width:100%"></textarea>
            <p data-i18n="video_crop.request_help"></p>
            <button type="button" data-action="ai" data-i18n="video_crop.ai" disabled></button>
            <label for="crop-advice" data-i18n="video_crop.advice"></label>
            <textarea id="crop-advice" rows="4" aria-readonly="true" aria-multiline="true" style="width:100%"></textarea>
            <button type="button" data-action="apply" data-i18n="video_crop.apply" disabled></button>
            <progress max="100" value="0" data-i18n-aria="video_crop.progress"></progress>
            <p role="status" aria-live="polite" aria-atomic="true" data-status></p>
            <button type="button" data-action="export" data-i18n="video_crop.export" disabled></button>
            <button type="button" data-action="close" data-i18n="video_crop.close"></button>`;
        const button = name => dialog.querySelector(`[data-action="${name}"]`);
        const field = key => dialog.querySelector(`#crop-${key}`);
        const edges = ['top', 'bottom', 'left', 'right'];
        const report = field('report'), advice = field('advice'), canvas = dialog.querySelector('canvas');
        let analysis, images = [], busy = false, frame = 0, suggestion, framingGeometry, previousSuggestion = null, operation = 0, lastProgress = -1, lastTone = -1;
        const say = message => { dialog.querySelector('[data-status]').textContent = message; };
        // Simulated read-only areas keep native caret navigation in JAWS and NVDA.
        for (const area of [report, advice]) {
            area.classList.add('readonly-textarea-simulated');
            for (const name of ['beforeinput', 'paste', 'cut', 'drop']) area.addEventListener(name, e => e.preventDefault());
        }
        const values = () => Object.fromEntries(edges.map(k => [k, Number(field(k).value)]));
        const valid = crop => analysis && edges.every(k => field(k).value !== '' && Number.isInteger(crop[k]) && crop[k] >= 0) &&
            crop.left % 2 === 0 && crop.top % 2 === 0 &&
            analysis.width - crop.left - crop.right >= 16 && analysis.height - crop.top - crop.bottom >= 16 &&
            (analysis.width - crop.left - crop.right) % 2 === 0 && (analysis.height - crop.top - crop.bottom) % 2 === 0;
        function controls() {
            edges.forEach(k => { field(k).disabled = busy || !analysis; });
            button('analyze').setAttribute('aria-disabled', String(busy));
            for (const key of ['reset', 'previous', 'next', 'ai']) button(key).disabled = busy || !analysis;
            button('apply').disabled = busy || !suggestion;
            button('export').disabled = busy || !valid(values()) || !edges.some(k => values()[k] > 0);
            field('provider').disabled = busy;
            field('request').disabled = busy;
            field('framing-options').disabled = busy || !field('goal-framing').checked;
            dialog.querySelectorAll('[name="crop-goal"]').forEach(input => { input.disabled = busy; });
        }
        function draw() {
            const crop = values(); controls();
            if (!analysis || !images[frame]) return;
            const width = analysis.width - crop.left - crop.right, height = analysis.height - crop.top - crop.bottom;
            const text = valid(crop) ? t('size', { width, height, time: analysis.frames[frame].time.toFixed(2) }) : t('errors.invalid');
            dialog.querySelector('[data-size]').textContent = text; canvas.setAttribute('aria-label', `${t('preview')} ${text}`);
            const ctx = canvas.getContext('2d');
            canvas.width = images[frame].naturalWidth; canvas.height = images[frame].naturalHeight;
            ctx.drawImage(images[frame], 0, 0, canvas.width, canvas.height);
            const x = crop.left * canvas.width / analysis.width, y = crop.top * canvas.height / analysis.height;
            const w = width * canvas.width / analysis.width, h = height * canvas.height / analysis.height;
            if (valid(crop)) {
                ctx.fillStyle = 'rgba(0,0,0,.65)';
                ctx.fillRect(0, 0, canvas.width, y); ctx.fillRect(0, y + h, canvas.width, canvas.height - y - h);
                ctx.fillRect(0, y, x, h); ctx.fillRect(x + w, y, canvas.width - x - w, h);
                ctx.strokeStyle = '#ffcf00'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
            }
        }
        function setCrop(crop) { edges.forEach(k => { field(k).value = crop[k]; }); draw(); }
        const details = crop => edges.map(k => `${t(k)}: ${crop[k]}`).join(', ');
        const unsub = window.api.onVideoCropProgress(data => {
            if (!busy) return;
            dialog.querySelector('progress').value = data.percent;
            const tone = Math.floor(data.percent / 2) * 2;
            if (tone > lastTone && tone > 0 && tone < 100) { lastTone = tone; Utils.playProgressTone?.(tone); }
            const bucket = Math.floor(data.percent / 10);
            if (bucket !== lastProgress) { lastProgress = bucket; say(t(data.stage, { percent: Math.floor(data.percent) })); }
        });
        function close() {
            operation++; window.api.videoCropClose(); unsub();
            window.removeEventListener('keydown', guard, true); current = null; dialog.remove();
            if (previous?.isConnected) previous.focus();
        }
        const guard = event => {
            if (!dialog.contains(event.target)) return;
            event.stopPropagation();
            if (event.key === 'Escape') { event.preventDefault(); close(); }
        };
        button('close').onclick = close;
        button('analyze').onclick = async () => {
            if (busy) return;
            const id = ++operation; busy = true; analysis = null; suggestion = null; framingGeometry = null; previousSuggestion = null; advice.value = ''; controls();
            say(t('analyzing', { percent: 0 })); lastProgress = -1; lastTone = -1;
            try {
                const result = await window.api.videoCropAnalyze(source);
                if (id !== operation) return;
                if (result.error) throw new Error(result.error);
                const loaded = await Promise.all(result.frames.map(f => new Promise((resolve, reject) => {
                    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('preview')); image.src = f.image;
                })));
                if (id !== operation) return;
                analysis = result; images = loaded; frame = 0;
                edges.forEach(k => { field(k).max = (k === 'top' || k === 'bottom' ? result.height : result.width) - 16; });
                report.value = `${t(result.uncertain ? 'uncertain' : 'result', { count: result.sampleCount })} ${details(result.crop)} ${t('sample_warning')}`;
                setCrop(result.crop); say('');
            } catch (e) {
                console.error('Video crop renderer analysis:', e);
                if (id === operation) say(t(e.message === 'preview' ? 'preview_error' : `errors.${['invalid','no_video','unsupported'].includes(e.message) ? e.message : 'processing'}`));
            }
            finally { if (id === operation) { busy = false; controls(); if (analysis) { report.focus(); report.setSelectionRange(0, 0); } else button('analyze').focus(); } }
        };
        edges.forEach(k => { field(k).oninput = () => { suggestion = null; advice.value = ''; draw(); }; });
        // These local choices use native radio navigation; the crop command is
        // already available in the keyboard manager.
        const clearAdvice = () => { suggestion = null; framingGeometry = null; advice.value = ''; controls(); };
        dialog.querySelectorAll('[name="crop-goal"]').forEach(input => { input.onchange = clearAdvice; });
        field('provider').onchange = clearAdvice;
        function updateFramingAdvice(announce = true) {
            if (!framingGeometry) { suggestion = null; advice.value = ''; controls(); return; }
            const tightness = dialog.querySelector('[name="crop-tightness"]:checked').value;
            const result = window.CropFraming.calculate(framingGeometry, analysis.width, analysis.height, tightness, field('protect-hands').checked);
            suggestion = result.crop;
            const lines = [t('scene_reason', { reason: framingGeometry.reason })];
            for (const edge of edges) if (result.confidence[edge] !== 'high') lines.push(t(`edge_${result.confidence[edge]}`, { edge: t(edge) }));
            if (framingGeometry.internalGap) lines.push(t('interior_gap_help'));
            lines.push(t('geometry_values', { mode: t(`tightness_${tightness}`) }));
            for (const edge of edges) lines.push(t('geometry_edge', { edge: t(edge), pixels: suggestion[edge], delta: suggestion[edge] - values()[edge] }));
            lines.push(t('ai_warning'));
            previousSuggestion = { goal: 'framing', crop: { ...suggestion }, reason: framingGeometry.reason };
            advice.value = lines.join('\n'); if (announce) say(advice.value); controls();
        }
        dialog.querySelectorAll('[name="crop-tightness"]').forEach(input => { input.onchange = updateFramingAdvice; });
        field('protect-hands').onchange = updateFramingAdvice;
        button('reset').onclick = () => { setCrop({ top: 0, bottom: 0, left: 0, right: 0 }); say(t('reset')); };
        button('previous').onclick = () => { frame = (frame - 1 + images.length) % images.length; draw(); };
        button('next').onclick = () => { frame = (frame + 1) % images.length; draw(); };
        button('ai').onclick = async () => {
            if (busy) return;
            if (!valid(values())) { say(t('errors.invalid')); return; }
            const id = ++operation; busy = true; suggestion = null; framingGeometry = null; controls(); say(t('ai_wait'));
            let stage = 'prepare', serviceError = '';
            try {
                const sheet = document.createElement('canvas');
                const cellWidth = images[0].naturalWidth, cellHeight = images[0].naturalHeight;
                sheet.width = cellWidth * 2;
                sheet.height = cellHeight * Math.ceil(images.length / 2);
                const ctx = sheet.getContext('2d');
                images.forEach((image, index) => ctx.drawImage(image, (index % 2) * cellWidth, Math.floor(index / 2) * cellHeight, cellWidth, cellHeight));
                let prompt = t(field('goal-framing').checked ? 'ai_edge_geometry_prompt' : 'ai_prompt', { width: analysis.width, height: analysis.height, crop: JSON.stringify(values()),
                    count: images.length, times: analysis.frames.map(f => f.time.toFixed(2)).join(', ') });
                if (!field('goal-framing').checked) prompt += '\n' + t('prompt_interior_gap');
                prompt += '\n' + t('request_prompt', { context: JSON.stringify({
                    userRequest: field('request').value.trim(), currentCrop: values(), previousSuggestion,
                    tightness: dialog.querySelector('[name="crop-tightness"]:checked').value,
                    protectHands: field('protect-hands').checked
                }) });
                const provider = field('provider').value;
                stage = 'service';
                const response = await window.AiServices.request({ provider: provider || undefined,
                    imageBase64: sheet.toDataURL('image/jpeg', .85).split(',')[1], prompt });
                if (id !== operation) return;
                if (!response.success) { serviceError = response.message || response.error || ''; throw new Error('ai'); }
                stage = 'format';
                const parsed = window.CropFraming.parseResponse(response.text);
                stage = 'geometry';
                if (field('goal-framing').checked) {
                    framingGeometry = window.CropFraming.validate(parsed, images.length);
                    stage = 'display';
                    updateFramingAdvice();
                    return;
                }
                if (typeof parsed.reason !== 'string' || parsed.reason.length > 5000 || !valid(parsed.crop)) throw new Error('ai');
                suggestion = parsed.crop;
                previousSuggestion = { goal: 'borders', crop: { ...suggestion }, reason: parsed.reason };
                advice.value = `${parsed.reason}\n${details(suggestion)}\n${t('ai_warning')}`;
                say(advice.value);
            } catch (e) {
                // Do not log images, prompts, credentials or the raw provider response.
                console.error('Video crop AI failure', { stage, provider: field('provider').value || 'default', frames: images.length, errorType: e.name });
                if (id === operation) {
                    suggestion = null; framingGeometry = null;
                    advice.value = t(e.message === 'key' ? 'errors.key' : `errors.ai_${stage}`);
                    if (stage === 'service' && serviceError) advice.value += '\n' + serviceError;
                    say(advice.value);
                }
            }
            finally { if (id === operation) { busy = false; controls(); button('ai').focus(); } }
        };
        button('apply').onclick = () => { if (suggestion) { setCrop(suggestion); if (framingGeometry) updateFramingAdvice(false); say(t('applied')); } };
        button('export').onclick = async () => {
            if (busy) return;
            const id = ++operation; busy = true; controls(); lastProgress = -1; lastTone = -1; say(t('exporting', { percent: 0 }));
            try {
                const result = await window.api.videoCropExport(values());
                if (id !== operation) return;
                if (result.error) say(t(`errors.${result.error}`));
                else { say(t('done', { path: result.output })); Utils.playSound('success'); }
            } catch { if (id === operation) say(t('errors.processing')); }
            finally { if (id === operation) { busy = false; controls(); button('export').focus(); } }
        };
        // The open command is configurable; native dialog controls retain their standard keys.
        document.body.appendChild(dialog); window.i18nHelper.translateDOM(dialog);
        window.addEventListener('keydown', guard, true);
        dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
        dialog.showModal(); button('analyze').focus();
    }
    window.VideoCrop = { open };
})();
