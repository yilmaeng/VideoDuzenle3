(() => {
    const ui = {};
    const preview = { token: 0, timers: [], audios: [], context: null };

    function editor() { return window.EvdDescriptionEditor; }
    function t(key, params = {}) {
        const value = window.i18nHelper?.t?.(key, params);
        return value && !value.startsWith('[') ? value : key;
    }
    function events() { return editor()?.state.project?.events || []; }
    function defaults() { return editor()?.state.project?.settings || {}; }
    function descriptions() { return events().filter(item => item.type === 'description'); }
    function renderableAudioEvents() {
        return events().filter(item => (item.type === 'description' || item.type === 'subtitle') && item.ttsAudioPath);
    }
    function selectedDescriptions() {
        const ids = new Set(editor()?.state.selectedEventIds || []);
        return descriptions().filter(item => ids.has(item.id));
    }
    function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }
    function fitInfo(item) {
        const available = Math.max(0, Number(item.end) - Number(item.start));
        const duration = Math.max(0, Number(item.ttsDuration) || 0);
        const rate = Math.max(0.5, Number(item.ttsPlaybackRate) || 1);
        const played = duration / rate;
        return { available, duration, rate, played, fits: duration > 0 && played <= available + 0.02 };
    }
    function setStatus(key, params = {}) { editor()?.setStatus?.(key, params); }
    function updateOutputs() {
        [['defaultTtsSpeed','defaultTtsSpeedValue'],['defaultTtsVolume','defaultTtsVolumeValue'],['defaultOriginalVolume','defaultOriginalVolumeValue'],['defaultMaxSpeed','defaultMaxSpeedValue'],['eventTtsSpeed','eventTtsSpeedValue'],['eventTtsVolume','eventTtsVolumeValue'],['eventOriginalVolume','eventOriginalVolumeValue']]
            .forEach(([input, output]) => { if (ui[input] && ui[output]) ui[output].textContent = `%${ui[input].value}`; });
        const item = events().find(entry => entry.id === editor()?.state.selectedEventId);
        if (!ui.eventFit) return;
        if (!item?.ttsDuration) ui.eventFit.textContent = t('description_subtitle_editor.tts_not_generated');
        else {
            const info = fitInfo(item);
            ui.eventFit.textContent = t(info.fits ? 'description_subtitle_editor.tts_fits' : 'description_subtitle_editor.tts_too_long', {
                duration: info.duration.toFixed(2), available: info.available.toFixed(2), speed: Math.round(info.rate * 100)
            });
        }
    }
    function updateButtons() {
        if (!ui.synthesizeSelected) return;
        ui.synthesizeSelected.disabled = selectedDescriptions().length === 0;
        ui.synthesizeAll.disabled = descriptions().length === 0;
        ui.renderVideo.disabled = renderableAudioEvents().length === 0;
    }

    async function loadVoices() {
        const service = ui.defaultService.value || 'system';
        const selectedDefault = defaults().defaultVoice || '';
        const selectedEventVoice = ui.eventVoice.value || '';
        ui.defaultVoice.replaceChildren(new Option(t('description_subtitle_editor.tts_default_voice'), ''));
        ui.eventVoice.replaceChildren(new Option(t('description_subtitle_editor.tts_default_voice'), ''));
        if (service === 'human') return;
        try {
            const result = await window.api.descriptionSubtitleEditorTtsVoices({ service });
            for (const voice of result?.voices || []) {
                const id = typeof voice === 'string' ? voice : String(voice.id || '');
                const name = typeof voice === 'string' ? voice : String(voice.name || voice.id || '');
                if (!id) continue;
                ui.defaultVoice.add(new Option(name, id)); ui.eventVoice.add(new Option(name, id));
            }
        } catch (error) { setStatus('description_subtitle_editor.tts_voice_load_failed', { error: error.message || String(error) }); }
        if ([...ui.defaultVoice.options].some(option => option.value === selectedDefault)) ui.defaultVoice.value = selectedDefault;
        if ([...ui.eventVoice.options].some(option => option.value === selectedEventVoice)) ui.eventVoice.value = selectedEventVoice;
    }
    function applyDefaultsToUi() {
        const settings = defaults();
        ui.defaultService.value = settings.ttsService || 'system';
        ui.defaultTtsSpeed.value = String(Math.round(Number(settings.ttsSpeed || 1) * 100));
        ui.defaultTtsVolume.value = String(Math.round(Number(settings.ttsVolume ?? 100)));
        ui.defaultOriginalVolume.value = String(Math.round(Number(settings.originalVolume ?? 0.9) * 100));
        ui.defaultAutoFit.checked = settings.autoFitTts !== false;
        ui.defaultMaxSpeed.value = String(Math.round(Number(settings.maxAutoSpeed || 1.35) * 100));
        updateOutputs(); loadVoices();
    }
    function updateDefault(setting, value, eventField, transform = Number) {
        const oldValue = defaults()[setting];
        defaults()[setting] = transform(value);
        descriptions().forEach(item => {
            const current = item[eventField];
            if (current === undefined || current === null || Math.abs(Number(current) - Number(oldValue)) < 0.0001) {
                item[eventField] = defaults()[setting];
                if (eventField === 'ttsSpeed') { item.ttsAudioPath = ''; item.ttsDuration = 0; item.ttsGeneratedText = ''; }
            }
        });
        editor().setDirty(true); editor().renderEvents(); updateOutputs();
    }

    async function synthesizeItem(item) {
        const service = item.ttsService || defaults().ttsService || 'system';
        if (service === 'human') {
            if (!item.ttsAudioPath || !item.humanNarrationCandidateId) throw new Error(t('description_subtitle_editor.human_candidate_required'));
            item.ttsPlaybackRate = 1;
            item.ttsGeneratedText = item.text;
            item.ttsGeneratedService = 'human';
            return;
        }
        const voice = item.voice || defaults().defaultVoice || '';
        const speed = Number(item.ttsSpeed || defaults().ttsSpeed || 1);
        const result = await window.api.descriptionSubtitleEditorSynthesize({ text: item.text, service, voice, speed });
        if (!result?.success) throw new Error(result?.error || 'tts_failed');
        item.ttsAudioPath = result.audioPath;
        item.ttsDuration = Number(result.duration) || 0;
        item.ttsGeneratedText = item.text;
        item.ttsGeneratedVoice = voice;
        item.ttsGeneratedService = service;
        const available = Math.max(0.05, item.end - item.start);
        const neededRate = item.ttsDuration / available;
        item.ttsPlaybackRate = defaults().autoFitTts === false ? 1 : clamp(Math.max(1, neededRate), 1, Number(defaults().maxAutoSpeed || 1.35));
        item.updatedAt = new Date().toISOString();
    }
    async function synthesizeItems(items) {
        if (!items.length) return;
        ui.synthesizeSelected.disabled = true; ui.synthesizeAll.disabled = true;
        let completed = 0;
        try {
            for (const item of items) {
                setStatus('description_subtitle_editor.tts_synthesizing', { current: completed + 1, count: items.length });
                await synthesizeItem(item); completed += 1;
            }
            editor().setDirty(true); editor().renderEvents();
            window.dispatchEvent(new CustomEvent('evd-description-events-changed'));
            setStatus('description_subtitle_editor.tts_synthesis_completed', { count: completed });
            updateOutputs();
            const selected = selectedDescriptions()[0]; if (selected) playMixedPreview(selected);
        } catch (error) { setStatus('description_subtitle_editor.tts_synthesis_failed', { error: error.message || String(error) }); }
        finally { updateButtons(); }
    }

    function stopPreview() {
        preview.token += 1;
        preview.timers.forEach(clearTimeout); preview.timers = [];
        preview.audios.forEach(audio => { audio.pause(); audio.removeAttribute('src'); }); preview.audios = [];
        ui.video.pause();
        ui.video._descriptionMixPreviewActive = false;
        ui.video.volume = 1;
        if (ui.video._descriptionGainNode) {
            ui.video._descriptionGainNode.gain.value = editor()?.getPlaybackGainFactor?.() ?? 1;
        }
    }
    async function attachGain(media, gainValue) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) { media.volume = clamp(gainValue, 0, 1); return; }
        if (!preview.context || preview.context.state === 'closed') preview.context = new AudioContextClass();
        if (preview.context.state === 'suspended') await preview.context.resume();
        const source = preview.context.createMediaElementSource(media);
        const gain = preview.context.createGain(); gain.gain.value = clamp(gainValue, 0, 2);
        source.connect(gain); gain.connect(preview.context.destination); media.volume = 1;
    }
    function mediaReady(media) {
        if (media.readyState >= 1) return Promise.resolve();
        return new Promise((resolve, reject) => {
            media.addEventListener('loadedmetadata', resolve, { once: true });
            media.addEventListener('error', () => reject(new Error('media_load_failed')), { once: true }); media.load();
        });
    }
    async function seek(media, time) {
        await mediaReady(media); media.currentTime = Math.max(0, time);
        await new Promise(resolve => { media.addEventListener('seeked', resolve, { once: true }); setTimeout(resolve, 500); });
    }
    async function playMixedPreview(item, audioOverride = null, { announce = true } = {}) {
        const previewItem = audioOverride ? {
            ...item,
            ttsAudioPath: audioOverride.audioPath,
            ttsDuration: Number(audioOverride.duration) || Math.max(0.05, audioOverride.sourceEnd - audioOverride.sourceStart),
            ttsPlaybackRate: Number(item.ttsPlaybackRate) || 1
        } : item;
        if (!previewItem?.ttsAudioPath) return false;
        stopPreview(); const token = preview.token;
        const previewStart = Math.max(0, item.start - 1);
        const itemInfo = fitInfo(previewItem);
        let previewEnd = Math.max(previewItem.end, previewItem.start + itemInfo.played) + 0.75;
        const previewDescriptions = descriptions().map(candidate => candidate.id === item.id ? previewItem : candidate);
        const candidates = previewDescriptions.filter(candidate => candidate.ttsAudioPath && candidate.start <= previewEnd && (candidate.start + fitInfo(candidate).played) >= previewStart);
        try {
            await seek(ui.video, previewStart);
            if (token !== preview.token) return true;
            if (!ui.video._descriptionGainSource) {
                if (!preview.context || preview.context.state === 'closed') preview.context = new (window.AudioContext || window.webkitAudioContext)();
                ui.video._descriptionGainSource = preview.context.createMediaElementSource(ui.video);
                ui.video._descriptionGainNode = preview.context.createGain();
                ui.video._descriptionGainSource.connect(ui.video._descriptionGainNode);
                ui.video._descriptionGainNode.connect(preview.context.destination);
            }
            ui.video.volume = 1;
            ui.video._descriptionMixPreviewActive = true;
            const originalGain = Number(previewItem.originalVolume ?? defaults().originalVolume ?? 0.9);
            const playerGain = editor()?.getPlaybackGainFactor?.() ?? 1;
            ui.video._descriptionGainNode.gain.value = clamp(originalGain * playerGain, 0, 4);
            await ui.video.play();
            for (const candidate of candidates) {
                const audio = new Audio(await window.api.descriptionSubtitleEditorPathUrl(candidate.ttsAudioPath));
                preview.audios.push(audio); await mediaReady(audio);
                audio.playbackRate = clamp(Number(candidate.ttsPlaybackRate) || 1, 0.5, 2);
                await attachGain(audio, Number(candidate.ttsVolume ?? defaults().ttsVolume ?? 100) / 100);
                const candidateEnd = candidate.start + fitInfo(candidate).played;
                previewEnd = Math.max(previewEnd, candidateEnd + 0.75);
                const elapsed = Math.max(0, previewStart - candidate.start);
                audio.currentTime = Math.min(Math.max(0, audio.duration - 0.01), elapsed * audio.playbackRate);
                const delay = Math.max(0, candidate.start - previewStart) * 1000;
                preview.timers.push(setTimeout(() => { if (token === preview.token) audio.play().catch(() => {}); }, delay));
            }
            const monitor = () => {
                if (token !== preview.token) return;
                if (ui.video.currentTime >= previewEnd || ui.video.paused) stopPreview(); else requestAnimationFrame(monitor);
            }; requestAnimationFrame(monitor);
            if (announce) {
                setStatus(candidates.length > 1 ? 'description_subtitle_editor.tts_overlap_preview' : 'description_subtitle_editor.tts_mix_preview', { count: candidates.length });
            }
            return true;
        } catch (error) { stopPreview(); setStatus('description_subtitle_editor.tts_preview_failed', { error: error.message || String(error) }); return true; }
    }

    async function renderVideo() {
        const ready = renderableAudioEvents();
        if (!ready.length) { setStatus('description_subtitle_editor.render_requires_tts'); return; }
        try {
            setStatus('description_subtitle_editor.render_preparing');
            const result = await window.api.descriptionSubtitleEditorRenderVideo({ videoPath: editor().state.project.source.path, events: ready });
            if (!result?.canceled) setStatus('description_subtitle_editor.render_completed', { name: result.filePath.split(/[\/]/).pop() });
        } catch (error) { setStatus('description_subtitle_editor.render_failed', { error: error.message || String(error) }); }
    }

    function bind() {
        ui.defaultService.addEventListener('change', async () => { const old=defaults().ttsService || 'system'; defaults().ttsService=ui.defaultService.value; descriptions().forEach(item=>{if(!item.ttsService||item.ttsService===old){item.ttsService=defaults().ttsService;item.ttsAudioPath='';item.ttsDuration=0;item.humanNarrationCandidateId='';item.narrationSource='';}}); editor().setDirty(true); await loadVoices(); });
        ui.defaultVoice.addEventListener('change', () => { const old=defaults().defaultVoice || ''; defaults().defaultVoice=ui.defaultVoice.value; descriptions().forEach(item=>{if(!item.voice||item.voice===old){item.voice=defaults().defaultVoice;item.ttsAudioPath='';item.ttsDuration=0;}}); editor().setDirty(true); });
        ui.defaultTtsSpeed.addEventListener('input', () => updateDefault('ttsSpeed', ui.defaultTtsSpeed.value, 'ttsSpeed', value => Number(value) / 100));
        ui.defaultTtsVolume.addEventListener('input', () => updateDefault('ttsVolume', ui.defaultTtsVolume.value, 'ttsVolume'));
        ui.defaultOriginalVolume.addEventListener('input', () => updateDefault('originalVolume', ui.defaultOriginalVolume.value, 'originalVolume', value => Number(value) / 100));
        ui.defaultMaxSpeed.addEventListener('input', () => { defaults().maxAutoSpeed = Number(ui.defaultMaxSpeed.value) / 100; editor().setDirty(true); updateOutputs(); });
        ui.defaultAutoFit.addEventListener('change', () => { defaults().autoFitTts = ui.defaultAutoFit.checked; editor().setDirty(true); });
        ui.synthesizeSelected.addEventListener('click', () => synthesizeItems(selectedDescriptions()));
        ui.synthesizeAll.addEventListener('click', () => synthesizeItems(descriptions()));
        ui.renderVideo.addEventListener('click', renderVideo);
        [ui.eventTtsSpeed, ui.eventTtsVolume, ui.eventOriginalVolume].forEach(control => control.addEventListener('input', updateOutputs));
        window.addEventListener('evd-description-tts-form-updated', updateOutputs);
        window.addEventListener('evd-description-events-changed', updateButtons);
        window.addEventListener('evd-description-source-loaded', () => {
            applyDefaultsToUi();
            updateButtons();
        });
        window.addEventListener('keydown', event => {
            if (window.EvdDescriptionTimeline?.matchesShortcut?.('synthesizeSelectedDescriptions', event)) { event.preventDefault(); synthesizeItems(selectedDescriptions()); }
            if (window.EvdDescriptionTimeline?.matchesShortcut?.('synthesizeAllDescriptions', event)) { event.preventDefault(); synthesizeItems(descriptions()); }
            if (window.EvdDescriptionTimeline?.matchesShortcut?.('renderDescribedVideo', event)) { event.preventDefault(); renderVideo(); }
        });
        window.addEventListener('evd-description-preview-request', event => {
            updateButtons();
            const item = event.detail?.selection?.[0];
            if (item?.type === 'description' && item.ttsAudioPath) { event.preventDefault(); playMixedPreview(item); }
        });
    }
    async function init() {
        await window.i18nHelper?.init?.();
        Object.assign(ui, {
            video: document.getElementById('video-preview'), defaultService: document.getElementById('default-tts-service'), defaultVoice: document.getElementById('default-tts-voice'), defaultTtsSpeed: document.getElementById('default-tts-speed'), defaultTtsSpeedValue: document.getElementById('default-tts-speed-value'), defaultTtsVolume: document.getElementById('default-tts-volume'), defaultTtsVolumeValue: document.getElementById('default-tts-volume-value'), defaultOriginalVolume: document.getElementById('default-original-volume'), defaultOriginalVolumeValue: document.getElementById('default-original-volume-value'), defaultAutoFit: document.getElementById('default-auto-fit'), defaultMaxSpeed: document.getElementById('default-max-auto-speed'), defaultMaxSpeedValue: document.getElementById('default-max-auto-speed-value'), synthesizeSelected: document.getElementById('synthesize-selected'), synthesizeAll: document.getElementById('synthesize-all'), renderVideo: document.getElementById('render-described-video'), eventVoice: document.getElementById('event-tts-voice'), eventTtsSpeed: document.getElementById('event-tts-speed'), eventTtsSpeedValue: document.getElementById('event-tts-speed-value'), eventTtsVolume: document.getElementById('event-tts-volume'), eventTtsVolumeValue: document.getElementById('event-tts-volume-value'), eventOriginalVolume: document.getElementById('event-original-volume'), eventOriginalVolumeValue: document.getElementById('event-original-volume-value'), eventFit: document.getElementById('event-tts-fit')
        });
        const originalFormat = window.EvdDescriptionAuthoring?.formatEventItem;
        if (originalFormat) window.EvdDescriptionAuthoring.formatEventItem = (item, index) => {
            const base = originalFormat(item, index);
            if (item.type !== 'description') return base;
            if (!item.ttsDuration) return base + ' ' + t('description_subtitle_editor.tts_item_missing');
            const info = fitInfo(item);
            return base + ' ' + t(info.fits ? 'description_subtitle_editor.tts_item_ready' : 'description_subtitle_editor.tts_item_warning', { duration: info.duration.toFixed(2), speed: Math.round(info.rate * 100) });
        };
        bind(); updateButtons(); updateOutputs(); editor()?.renderEvents?.();
    }
    window.EvdDescriptionPhase5 = {
        previewHumanCandidate: (item, candidate, options) => playMixedPreview(item, candidate, options),
        playMixedPreview,
        stopPreview,
        synthesizeItems
    };
    document.addEventListener('DOMContentLoaded', init);
})();

