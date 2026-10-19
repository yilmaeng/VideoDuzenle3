(() => {
    'use strict';

    let current = null;
    let sequence = 0;
    let pendingJob = null;
    let playbackQueue = Promise.resolve();
    const t = (key, params) => window.i18nHelper.t(`speech_search.${key}`, params);
    const live = (s) => !!s && current === s && !s.closed;
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const resultLeadIn = result => Math.max(0, result.start - 1);
    const sourcePaths = () => [...new Set(Timeline.segments.map(segment => segment.sourceFile || Timeline.sourceFile).filter(Boolean))];

    function status(s, key, params, throttle = false) {
        if (!live(s)) return;
        const message = t(key, params);
        s.status.textContent = message;
        clearTimeout(s.announcement);
        const announce = () => {
            if (!live(s)) return;
            s.live.textContent = message;
            s.lastAnnouncement = Date.now();
        };
        const wait = throttle ? Math.max(0, 1500 - (Date.now() - s.lastAnnouncement)) : 0;
        if (wait) s.announcement = setTimeout(announce, wait);
        else announce();
    }

    function stopPreview(s) {
        const wasPreviewing = s.previewing;
        s.previewToken++;
        s.previewing = false;
        clearInterval(s.previewTimer);
        if (wasPreviewing && VideoPlayer.hasVideo()) VideoPlayer.pause({ announce: false });
        VideoPlayer.allowPlaybackWithOpenDialog = false;
    }

    async function waitForSource() {
        const deadline = Date.now() + 15000;
        while (VideoPlayer._isLoadingSource) {
            if (Date.now() > deadline) throw new Error('Speech search source load timeout');
            await delay(25);
        }
    }

    function seek(time, valid, after, onError) {
        // Serialize the player's asynchronous source changes; never seek source time directly.
        playbackQueue = playbackQueue.then(async () => {
            await waitForSource();
            if (!valid()) return;
            VideoPlayer.seekToTimelineTime(time);
            await waitForSource();
            let elapsed = 0;
            const target = Timeline.segments.find(segment => {
                elapsed += (segment.end - segment.start) / (segment.speed || 1);
                return time < elapsed;
            }) || Timeline.segments[Timeline.segments.length - 1];
            if (target && VideoPlayer.currentFilePath !== (target.sourceFile || Timeline.sourceFile)) {
                throw new Error('Speech search source did not load');
            }
            if (valid()) after?.();
        }).catch(onError);
        return playbackQueue;
    }

    function preview(s) {
        const result = s.results[s.selected];
        if (!result) return;
        stopPreview(s);
        const token = s.previewToken;
        const start = resultLeadIn(result);
        const end = Math.min(Timeline.getTotalDuration(), start + s.previewSeconds);
        const valid = () => live(s) && token === s.previewToken;
        seek(start, valid, () => {
            s.previewing = true;
            VideoPlayer.allowPlaybackWithOpenDialog = true;
            VideoPlayer.play();
            s.previewTimer = setInterval(() => {
                if (!valid() || (!VideoPlayer._isLoadingSource && VideoPlayer.getTimelineTime() >= end)) {
                    stopPreview(s);
                }
            }, 30);
        }, () => { stopPreview(s); status(s, 'preview_error'); });
    }

    function select(s, index, play = true) {
        if (!s.results.length) return;
        s.selected = Math.max(0, Math.min(index, s.results.length - 1));
        Array.from(s.list.children).forEach((item, i) => {
            item.setAttribute('aria-selected', String(i === s.selected));
            item.style.outline = i === s.selected ? '2px solid currentColor' : '';
            item.style.outlineOffset = '-2px';
        });
        const item = s.list.children[s.selected];
        s.list.setAttribute('aria-activedescendant', item.id);
        item.scrollIntoView({ block: 'nearest' });
        s.preview.disabled = false;
        s.accept.disabled = false;
        if (play) preview(s);
    }

    function search(s, focusResults = false) {
        clearTimeout(s.searchTimer);
        if (!live(s)) return;
        stopPreview(s);
        s.results = [];
        s.selected = -1;
        s.list.replaceChildren();
        s.list.removeAttribute('aria-activedescendant');
        s.preview.disabled = s.accept.disabled = true;
        if (!s.transcripts) return;
        try {
            const matches = window.SpeechSearchCore.search({
                transcripts: s.transcripts, segments: Timeline.segments,
                sourceFile: Timeline.sourceFile, query: s.query.value
            });
            const total = matches.length;
            s.results = matches.slice(0, 500);
            s.results.forEach((result, i) => {
                const item = document.createElement('li');
                item.id = `speech-search-result-${s.id}-${i}`;
                item.setAttribute('role', 'option');
                item.setAttribute('aria-selected', 'false');
                item.style.padding = '8px';
                item.style.cursor = 'pointer';
                item.textContent = t(result.approximate ? 'result_approximate' : 'result', {
                    text: result.text, time: Utils.formatTime(result.start)
                });
                item.addEventListener('click', () => { s.list.focus(); select(s, i); });
                item.addEventListener('dblclick', () => close(s, result));
                s.list.appendChild(item);
            });
            status(s, total > s.results.length ? 'results_limited' : s.query.value.trim() ? (s.results.length ? 'result_count' : 'no_results') : 'ready_hint', {
                count: s.results.length, shown: s.results.length, total
            });
            if (s.results.length) select(s, 0, false);
            if (focusResults) (s.results.length ? s.list : s.query).focus();
        } catch (error) {
            console.error('Speech search:', error);
            status(s, 'error');
        }
    }

    function cancelAnalysis(s, announce = true) {
        const jobId = s.jobId;
        s.cancelledJob = jobId;
        s.unsubscribe?.();
        s.unsubscribe = null;
        s.cancel.disabled = true;
        s.analyze.disabled = !!pendingJob || !s.supported;
        if (jobId) Promise.resolve().then(() => window.api.speechSearchCancel(jobId)).catch(error => console.warn('Speech search cancellation:', error));
        if (announce && jobId) status(s, 'cancelling');
    }

    function updateModelControls(s) {
        s.modelRadios.forEach(radio => { radio.disabled = !!pendingJob || !!s.jobId || !!s.transferring || !s.hasMedia; });
    }

    async function inspectModel(s, preferCached = false) {
        const token = ++s.inspectionToken;
        s.supported = false;
        s.analyze.disabled = true;
        s.info.textContent = t('checking');
        status(s, 'checking');
        try {
            const cached = await window.api.speechSearchCached({ sources: sourcePaths(), ...(preferCached ? {} : { model: s.model }) });
            if (!live(s) || token !== s.inspectionToken) return;
            if (cached?.transcripts?.length) {
                s.transcripts = cached.transcripts;
                if (preferCached) {
                    s.model = cached.transcripts[0].model;
                    s.modelRadios.forEach(radio => { radio.checked = radio.value === s.model; });
                }
            }
            const inspection = await window.api.speechSearchInspect({ model: s.model });
            if (!live(s) || token !== s.inspectionToken) return;
            s.supported = inspection?.supported === true && inspection.available !== false;
            s.analyze.disabled = !s.supported || !!pendingJob;
            s.info.textContent = t(inspection?.ready ? 'local_info' : 'download_consent');
            status(s, s.supported ? (inspection?.ready ? 'query_hint' : 'download_consent') : 'unsupported');
            if (s.supported && pendingJob) status(s, 'cancelling');
            if (s.transcripts) {
                s.progress.value = 100;
                s.info.textContent = t('local_info');
                search(s);
            }
        } catch (error) {
            if (live(s) && token === s.inspectionToken) status(s, 'error');
            console.error('Speech search inspect:', error);
        }
    }

    async function analyze(s, focusResults = false) {
        if (!live(s) || pendingJob || s.jobId || s.transferring || !s.supported) return;
        stopPreview(s);
        const sources = [...new Set(Timeline.segments.map(segment => segment.sourceFile || Timeline.sourceFile).filter(Boolean))];
        if (!sources.length) { status(s, 'no_media'); return; }
        const jobId = `speech-search-${Date.now()}-${++sequence}`;
        s.jobId = jobId;
        pendingJob = jobId;
        updateModelControls(s);
        s.cancelledJob = null;
        s.analyze.disabled = true;
        s.cancel.disabled = false;
        s.progress.value = 0;
        s.progressStage = null;
        s.progressBucket = -1;
        status(s, 'starting');
        try {
            s.unsubscribe = window.api.onSpeechSearchProgress(event => {
                if (!live(s) || s.jobId !== jobId || s.cancelledJob === jobId || event.jobId !== jobId) return;
                if (!['model', 'extract', 'analyze', 'complete'].includes(event.stage)) return;
                const percent = !event.indeterminate && Number.isFinite(event.percent) ? Math.round(Math.max(0, Math.min(100, event.percent))) : null;
                if (percent === null) s.progress.removeAttribute('value');
                else s.progress.value = percent;
                const params = { stage: t(`stages.${event.stage}`), percent };
                const key = percent === null ? 'progress_indeterminate' : 'progress';
                const bucket = percent === null ? -1 : Math.floor(percent / 10);
                if (s.progressStage !== event.stage || bucket > s.progressBucket) {
                    s.progressStage = event.stage;
                    s.progressBucket = bucket;
                    status(s, key, params, true);
                } else s.status.textContent = t(key, params);
            });
            const result = await window.api.speechSearchAnalyze({ jobId, sources, model: s.model });
            if (!live(s) || s.jobId !== jobId || s.cancelledJob === jobId) return;
            if (!Array.isArray(result?.transcripts)) throw new Error('Invalid speech search response');
            s.transcripts = result.transcripts;
            s.progress.value = 100;
            s.info.textContent = t('local_info');
            search(s, focusResults);
        } catch (error) {
            if (live(s) && s.jobId === jobId && s.cancelledJob !== jobId) {
                console.error('Speech search analysis:', error);
                status(s, String(error?.message || error).includes('speech_search_busy') ? 'busy' : 'error');
            }
        } finally {
            if (pendingJob === jobId) pendingJob = null;
            if (current && current !== s) updateModelControls(current);
            if (current && current !== s && current.supported && !current.jobId) {
                current.analyze.disabled = false;
                status(current, 'cancelled');
            }
            if (live(s) && s.jobId === jobId) {
                s.jobId = null;
                updateModelControls(s);
                s.unsubscribe?.();
                s.unsubscribe = null;
                s.cancel.disabled = true;
                s.analyze.disabled = false;
                if (s.cancelledJob === jobId) {
                    status(s, 'cancelled');
                    s.cancelledJob = null;
                }
            }
        }
    }

    function close(s, result) {
        if (!live(s)) return;
        stopPreview(s);
        cancelAnalysis(s, false);
        clearTimeout(s.announcement);
        clearTimeout(s.searchTimer);
        s.closed = true;
        current = null;
        VideoPlayer.video?.removeEventListener('play', s.playGuard, true);
        window.removeEventListener('keydown', s.keyGuard, true);
        s.dialog.close();
        s.dialog.remove();
        const targetTime = result ? resultLeadIn(result) : s.position;
        if (s.hasMedia) seek(targetTime, () => !current, () => {
            if (result) {
                VideoPlayer.setCursorToCurrentTime();
                VideoPlayer.playbackStartPosition = targetTime;
                const timeline = document.getElementById('timeline-section');
                if (timeline) { timeline.tabIndex = -1; timeline.focus(); }
                else VideoPlayer.video?.focus();
            } else if (s.previousFocus?.isConnected) s.previousFocus.focus();
        }, error => console.error('Speech search restore:', error));
        else s.previousFocus?.focus();
    }

    async function open() {
        if (current) { current.query.focus(); return; }
        await playbackQueue;
        if (current) { current.query.focus(); return; }
        const s = {
            id: ++sequence, previousFocus: document.activeElement,
            hasMedia: typeof Timeline !== 'undefined' && Timeline.segments.length > 0 && VideoPlayer.hasVideo(),
            position: VideoPlayer.getTimelineTime(), previewToken: 0, previewSeconds: 10,
            results: [], selected: -1, lastAnnouncement: 0, supported: false,
            model: 'Xenova/whisper-small', inspectionToken: 0
        };
        current = s;
        if (s.hasMedia) VideoPlayer.pause();
        const dialog = document.createElement('dialog');
        s.dialog = dialog;
        dialog.id = 'speech-search-dialog';
        dialog.setAttribute('aria-labelledby', 'speech-search-title');
        dialog.setAttribute('aria-describedby', 'speech-search-info');
        dialog.style.cssText = 'width:min(680px,90vw);max-height:85vh;overflow:auto';
        dialog.innerHTML = `
            <h2 id="speech-search-title" data-i18n="speech_search.title"></h2>
            <p id="speech-search-info"></p>
            <fieldset aria-describedby="speech-search-model-help"><legend data-i18n="speech_search.model_choice"></legend>
            <input type="radio" name="speech-search-model" id="speech-search-model-base" value="Xenova/whisper-base">
            <label for="speech-search-model-base" data-i18n="speech_search.model_base"></label>
            <input type="radio" name="speech-search-model" id="speech-search-model-small" value="Xenova/whisper-small" checked>
            <label for="speech-search-model-small" data-i18n="speech_search.model_small"></label></fieldset>
            <p id="speech-search-model-help" data-i18n="speech_search.model_help"></p>
            <p data-model-size></p>
            <div class="form-group"><label for="speech-search-query" data-i18n="speech_search.query"></label>
            <input id="speech-search-query" type="search" autocomplete="off"></div>
            <div class="dialog-buttons"><button type="button" data-action="analyze" data-i18n="speech_search.analyze" disabled></button>
            <button type="button" data-action="cancel" data-i18n="speech_search.cancel_analysis" disabled></button></div>
            <label for="speech-search-progress" data-i18n="speech_search.progress_label"></label>
            <progress id="speech-search-progress" max="100" value="0"></progress>
            <p data-status></p><p data-live role="status" aria-live="polite" aria-atomic="true" class="sr-only"></p>
            <fieldset><legend data-i18n="speech_search.preview_length"></legend>
            <input type="radio" name="speech-search-length" id="speech-search-five" value="5">
            <label for="speech-search-five" data-i18n="speech_search.five_seconds"></label>
            <input type="radio" name="speech-search-length" id="speech-search-ten" value="10" checked>
            <label for="speech-search-ten" data-i18n="speech_search.ten_seconds"></label></fieldset>
            <h3 id="speech-search-results-label" data-i18n="speech_search.results"></h3>
            <p id="speech-search-help" data-i18n="speech_search.navigation_help"></p>
            <p data-i18n="speech_search.shortcut_hint"></p>
            <ul role="listbox" tabindex="0" aria-labelledby="speech-search-results-label" aria-describedby="speech-search-help"
                style="max-height:240px;overflow:auto;list-style:none;padding:0"></ul>
            <div class="dialog-buttons"><button type="button" data-action="preview" data-i18n="speech_search.preview" disabled></button>
            <button type="button" data-action="stop" data-i18n="speech_search.stop_preview"></button>
            <button type="button" data-action="accept" data-i18n="speech_search.go_to_result" disabled></button>
            <button type="button" data-action="close" data-i18n="speech_search.close"></button></div>`;
        for (const name of ['analyze', 'cancel', 'preview', 'accept']) s[name] = dialog.querySelector(`[data-action="${name}"]`);
        s.query = dialog.querySelector('input[type="search"]');
        s.list = dialog.querySelector('[role="listbox"]');
        s.info = dialog.querySelector('#speech-search-info');
        s.progress = dialog.querySelector('progress');
        s.status = dialog.querySelector('[data-status]');
        s.live = dialog.querySelector('[data-live]');
        s.modelRadios = Array.from(dialog.querySelectorAll('input[name="speech-search-model"]'));
        updateModelControls(s);
        window.i18nHelper.translateDOM(dialog);
        dialog.querySelector('[data-model-size]').textContent = t(window.api.platform === 'win32' ? 'model_size_windows' : 'model_size_other');
        // Dialog-local native radios provide keyboard selection; no separate global model shortcuts.
        s.modelRadios.forEach(radio => radio.addEventListener('change', () => {
            if (!radio.checked || pendingJob || s.jobId || s.transferring || !s.hasMedia || radio.value === s.model) return;
            s.model = radio.value;
            s.transcripts = null;
            s.progress.value = 0;
            search(s);
            void inspectModel(s);
        }));
        s.info.textContent = t('local_info');
        s.query.addEventListener('input', () => {
            stopPreview(s);
            clearTimeout(s.searchTimer);
            s.searchTimer = setTimeout(() => search(s), 200);
        });
        s.analyze.addEventListener('click', () => analyze(s));
        s.cancel.addEventListener('click', () => { cancelAnalysis(s); s.query.focus(); });
        s.preview.addEventListener('click', () => preview(s));
        s.accept.addEventListener('click', () => close(s, s.results[s.selected]));
        dialog.querySelector('[data-action="stop"]').addEventListener('click', () => stopPreview(s));
        dialog.querySelector('[data-action="close"]').addEventListener('click', () => close(s));
        dialog.querySelectorAll('input[name="speech-search-length"]').forEach(radio => radio.addEventListener('change', () => {
            s.previewSeconds = Number(radio.value);
            if (s.previewing) preview(s);
        }));
        // These dialog-local actions are not global shortcuts; integration owns the open command.
        s.keyGuard = event => {
            if (!live(s) || !dialog.contains(event.target)) return;
            event.stopPropagation();
            if (event.key === 'Escape') { event.preventDefault(); close(s); }
            else if (event.target === s.query && event.key === 'Enter') {
                event.preventDefault();
                if (s.transferring) return;
                if (!s.transcripts) analyze(s, true);
                else search(s, true);
            }
            else if (event.target === s.list) {
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    const index = event.key === 'Home' ? 0 : event.key === 'End' ? s.results.length - 1 : s.selected + (event.key === 'ArrowDown' ? 1 : -1);
                    select(s, index);
                } else if (event.key === 'Enter' && s.results[s.selected]) {
                    event.preventDefault(); close(s, s.results[s.selected]);
                } else if (event.key === ' ') {
                    event.preventDefault(); preview(s);
                }
            }
        };
        // Run before Keyboard's document capture handler, especially its global Escape action.
        window.addEventListener('keydown', s.keyGuard, true);
        s.list.addEventListener('focus', () => { if (s.results.length) preview(s); });
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(s); });
        dialog.addEventListener('close', () => close(s));
        // Source switches reset the gate on pause. Re-enable before the player's play guard.
        s.playGuard = () => { if (live(s) && s.previewing) VideoPlayer.allowPlaybackWithOpenDialog = true; };
        VideoPlayer.video?.addEventListener('play', s.playGuard, true);
        document.body.appendChild(dialog);
        dialog.showModal();
        s.query.focus();
        if (!s.hasMedia) { status(s, 'no_media'); return; }
        await inspectModel(s, true);
    }

    async function transfer(action) {
        if (!['export', 'import'].includes(action) || !sourcePaths().length) return;
        await open();
        const s = current;
        if (!live(s) || s.jobId || s.transferring) return;
        stopPreview(s);
        s.transferring = true;
        s.analyze.disabled = true;
        updateModelControls(s);
        status(s, 'archive.checking_file');
        try {
            const result = await window.api.speechSearchTransfer(action, { sources: sourcePaths() });
            if (!live(s)) return;
            if (result.cancelled) { status(s, 'archive.cancelled'); return; }
            if (result.error) { status(s, `archive.errors.${result.error}`); return; }
            if (action === 'import') {
                s.transcripts = result.transcripts;
                s.model = result.transcripts[0].model;
                s.modelRadios.forEach(radio => { radio.checked = radio.value === s.model; });
                s.progress.value = 100;
                s.info.textContent = t('local_info');
                search(s);
                status(s, 'archive.imported');
            } else status(s, 'archive.exported', { path: result.path });
        } catch (error) {
            console.error('Speech analysis transfer:', error);
            if (live(s)) status(s, 'archive.errors.failed');
        } finally {
            s.transferring = false;
            if (live(s)) {
                updateModelControls(s);
                s.analyze.disabled = !s.supported || !!pendingJob;
                s.query.focus();
            }
        }
    }

    window.SpeechSearch = { open, transfer };
})();
