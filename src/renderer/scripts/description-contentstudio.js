(() => {
    const ui = {};
    const state = { busy: false, keyConfigured: false, pollTimer: null, lastProgressStage: '', lastProgressBucket: -1, lastAnnouncedTerminal: '', focusOnCompletionProjectId: '', editingKey: false };

    function editor() { return window.EvdDescriptionEditor; }
    function t(key, params = {}) {
        const value = window.i18nHelper?.t?.(key, params);
        return value && !value.startsWith('[') ? value : key;
    }
    function setStatus(key, params = {}) { editor()?.setStatus?.(key, params); }
    function projectState(create = true) {
        const project = editor()?.state.project;
        if (!project) return null;
        if (!project.contentStudio && create) project.contentStudio = { projectId: '', status: '', cues: [], settings: {}, lastError: '' };
        return project.contentStudio || null;
    }

    function configuredSettings() {
        const custom = String(ui.instructions.value || '').trim();
        const recommended = ui.recommendedInstructions.checked
            ? t('description_subtitle_editor.contentstudio_default_instructions')
            : '';
        return {
            language: ui.language.value || 'tr',
            promptTemplateId: ui.template.value || 'accessibility',
            verbosityLevel: ui.verbosity.value || 'detailed',
            processingMode: ui.processingMode.value || 'standard',
            confidenceThreshold: Number(ui.confidence.value) / 100,
            temperature: Number(ui.temperature.value) / 100,
            captionsEnabled: ui.captions.checked,
            customInstructions: [recommended, custom].filter(Boolean).join('\n\n')
        };
    }

    function applyStoredSettings() {
        const settings = projectState(false)?.settings || {};
        const assign = (control, value) => {
            if (value === undefined || value === null) return;
            if (!control.options || [...control.options].some(option => option.value === String(value))) control.value = String(value);
        };
        assign(ui.language, settings.language);
        assign(ui.template, settings.promptTemplateId);
        assign(ui.verbosity, settings.verbosityLevel);
        assign(ui.processingMode, settings.processingMode);
        if (Number.isFinite(Number(settings.confidenceThreshold))) ui.confidence.value = String(Math.round(Number(settings.confidenceThreshold) * 100));
        if (Number.isFinite(Number(settings.temperature))) ui.temperature.value = String(Math.round(Number(settings.temperature) * 100));
        if (typeof settings.captionsEnabled === 'boolean') ui.captions.checked = settings.captionsEnabled;
        ui.instructions.value = String(settings.userInstructions || '');
        ui.recommendedInstructions.checked = settings.useRecommendedInstructions !== false;
        updateOutputs();
    }

    function updateOutputs() {
        ui.confidenceValue.textContent = `%${ui.confidence.value}`;
        ui.temperatureValue.textContent = `%${ui.temperature.value}`;
    }

    function render() {
        const data = projectState(false);
        const status = String(data?.status || '');
        const cueCount = Array.isArray(data?.cues) ? data.cues.length : 0;
        const checked = data?.lastCheckedAt ? new Date(data.lastCheckedAt).toLocaleTimeString() : t('description_subtitle_editor.contentstudio_not_checked');
        ui.projectStatus.value = data?.projectId
            ? t('description_subtitle_editor.contentstudio_project_summary', {
                id: data.projectId, status: t(`description_subtitle_editor.contentstudio_status_${status || 'queued'}`), count: cueCount, checked
            })
            : t('description_subtitle_editor.contentstudio_no_project');
        const completed = status === 'succeeded';
        ui.recover.disabled = state.busy || !state.keyConfigured || !editor()?.state.project?.source?.name;
        ui.refresh.disabled = state.busy || !data?.projectId;
        ui.importCues.disabled = state.busy || !completed || cueCount === 0;
        ui.exportButton.disabled = state.busy || !completed;
        ui.keyEntry.hidden = state.keyConfigured && !state.editingKey;
        ui.changeKey.hidden = !state.keyConfigured || state.editingKey;
        ui.start.disabled = state.busy || !state.keyConfigured || !editor()?.state.project?.source?.path;
        ui.testKey.disabled = state.busy || !state.keyConfigured;
        ui.saveKey.disabled = state.busy || !String(ui.apiKey.value || '').trim();
    }

    function setBusy(value) {
        state.busy = Boolean(value);
        render();
    }

    async function loadKeyStatus() {
        const result = await window.api.descriptionSubtitleContentStudioKeyStatus();
        state.keyConfigured = Boolean(result?.configured);
        if (!state.keyConfigured) state.editingKey = true;
        ui.keyStatus.textContent = state.keyConfigured
            ? t('description_subtitle_editor.contentstudio_key_ready')
            : t('description_subtitle_editor.contentstudio_key_missing');
        render();
    }

    async function saveKey() {
        const apiKey = String(ui.apiKey.value || '').trim();
        if (!apiKey) return;
        setBusy(true);
        try {
            await window.api.descriptionSubtitleContentStudioSaveKey({ apiKey });
            ui.apiKey.value = '';
            state.editingKey = false;
            await loadKeyStatus();
            setStatus('description_subtitle_editor.contentstudio_key_saved');
            await testAccount();
        } catch (error) {
            setStatus('description_subtitle_editor.contentstudio_key_save_failed', { error: error.message || String(error) });
        } finally { setBusy(false); }
    }

    async function testAccount() {
        setBusy(true);
        try {
            setStatus('description_subtitle_editor.contentstudio_testing_key');
            const result = await window.api.descriptionSubtitleContentStudioAccount();
            const scopes = Array.isArray(result?.me?.scopes) ? result.me.scopes.join(', ') : '';
            ui.account.value = t('description_subtitle_editor.contentstudio_account_summary', {
                plan: result?.me?.plan || '', credits: result?.credits?.balance ?? 0, scopes
            });
            setStatus('description_subtitle_editor.contentstudio_key_valid');
        } catch (error) {
            ui.account.value = '';
            setStatus('description_subtitle_editor.contentstudio_key_invalid', { error: error.message || String(error) });
        } finally { setBusy(false); }
    }

    function openStartConfirmation() {
        if (!editor()?.state.project?.source?.path) return;
        ui.confirmMessage.textContent = t('description_subtitle_editor.contentstudio_confirm_message', {
            name: editor().state.project.source.name || '',
            duration: Math.round(Number(editor().state.project.source.duration) || 0)
        });
        ui.confirmDialog.showModal();
        requestAnimationFrame(() => ui.confirmSubmit.focus());
    }

    async function startGeneration() {
        ui.confirmDialog.close();
        const project = editor().state.project;
        const settings = configuredSettings();
        setBusy(true);
        state.lastProgressStage = ''; state.lastProgressBucket = -1;
        ui.progress.hidden = false;
        ui.progress.removeAttribute('value');
        try {
            setStatus('description_subtitle_editor.contentstudio_preflight');
            const account = await window.api.descriptionSubtitleContentStudioAccount();
            if (Number(account?.credits?.balance) <= 0) {
                setStatus('description_subtitle_editor.contentstudio_no_credits');
                return;
            }
            const scopes = Array.isArray(account?.me?.scopes) ? account.me.scopes : [];
            if (!scopes.includes('projects:write')) {
                setStatus('description_subtitle_editor.contentstudio_write_scope_missing');
                return;
            }
            setStatus('description_subtitle_editor.contentstudio_upload_started');
            const result = await window.api.descriptionSubtitleContentStudioCreateProject({
                videoPath: project.source.path,
                name: project.source.name,
                duration: project.source.duration,
                ...settings
            });
            project.contentStudio = {
                ...(project.contentStudio || {}),
                projectId: result.id,
                status: result.status || 'queued',
                cues: [],
                settings: {
                    ...settings,
                    userInstructions: String(ui.instructions.value || '').trim(),
                    useRecommendedInstructions: ui.recommendedInstructions.checked
                },
                lastError: '',
                createdAt: new Date().toISOString(),
                lastCheckedAt: new Date().toISOString()
            };
            state.focusOnCompletionProjectId = result.id;
            editor().setDirty(true);
            setStatus('description_subtitle_editor.contentstudio_project_created', { id: result.id });
            render();
            startPolling();
        } catch (error) {
            setStatus('description_subtitle_editor.contentstudio_create_failed', { error: error.message || String(error) });
        } finally {
            ui.progress.hidden = true;
            setBusy(false);
        }
    }

    async function recoverProject() {
        const sourceName = editor()?.state.project?.source?.name;
        if (!sourceName) return;
        setBusy(true);
        try {
            setStatus('description_subtitle_editor.contentstudio_recovering');
            const found = await window.api.descriptionSubtitleContentStudioFindProject({ sourceName });
            if (!found?.id) {
                setStatus('description_subtitle_editor.contentstudio_recover_not_found');
                return;
            }
            const data = projectState();
            data.projectId = found.id;
            data.status = found.status || 'queued';
            data.lastError = found.error || '';
            data.lastCheckedAt = new Date().toISOString();
            state.focusOnCompletionProjectId = found.id;
            editor().setDirty(true);
            setStatus('description_subtitle_editor.contentstudio_recovered', { id: found.id });
            render();
        } catch (error) {
            setStatus('description_subtitle_editor.contentstudio_recover_failed', { error: error.message || String(error) });
        } finally {
            setBusy(false);
        }
        await refreshProject(true);
    }

    async function refreshProject(announce = true) {
        const data = projectState(false);
        if (!data?.projectId || state.busy) return;
        try {
            const job = await window.api.descriptionSubtitleContentStudioJob({ projectId: data.projectId });
            const previousStatus = data.status;
            data.status = job.status;
            data.lastError = job.error || '';
            data.lastCheckedAt = new Date().toISOString();
            if (job.status === 'succeeded') {
                const result = await window.api.descriptionSubtitleContentStudioDescriptions({ projectId: data.projectId });
                data.cues = Array.isArray(result?.cues) ? result.cues : [];
                stopPolling();
                if (announce || state.lastAnnouncedTerminal !== `${data.projectId}:succeeded`) {
                    state.lastAnnouncedTerminal = `${data.projectId}:succeeded`;
                    setStatus('description_subtitle_editor.contentstudio_completed', { count: data.cues.length });
                }
                if (state.focusOnCompletionProjectId === data.projectId) {
                    state.focusOnCompletionProjectId = '';
                    requestAnimationFrame(() => ui.importCues.focus());
                }
            } else if (job.status === 'failed') {
                stopPolling();
                if (announce || state.lastAnnouncedTerminal !== `${data.projectId}:failed`) {
                    state.lastAnnouncedTerminal = `${data.projectId}:failed`;
                    setStatus('description_subtitle_editor.contentstudio_failed', { error: job.error || '' });
                }
            } else if (announce || previousStatus !== job.status) {
                setStatus('description_subtitle_editor.contentstudio_still_processing', {
                    status: t(`description_subtitle_editor.contentstudio_status_${job.status}`)
                });
            }
            editor().setDirty(true);
            render();
        } catch (error) {
            if (announce) setStatus('description_subtitle_editor.contentstudio_status_check_failed', { error: error.message || String(error) });
        }
    }

    function startPolling() {
        stopPolling();
        refreshProject(false);
        state.pollTimer = setInterval(() => refreshProject(false), 15000);
    }

    function stopPolling() {
        if (state.pollTimer) clearInterval(state.pollTimer);
        state.pollTimer = null;
    }

    function importCues() {
        const data = projectState(false);
        if (!Array.isArray(data?.cues)) return;
        const events = editor().state.project.events;
        let imported = 0;
        let skipped = 0;
        data.cues.forEach((cue, index) => {
            if (events.some(item => item.contentStudioCueId === cue.id)) { skipped += 1; return; }
            const now = new Date().toISOString();
            events.push({
                id: `contentstudio-${cue.id || `${Date.now()}-${index}`}`,
                type: 'description',
                start: Math.max(0, Number(cue.startTime) || 0),
                end: Math.max(Number(cue.startTime) || 0, Number(cue.endTime) || 0),
                text: String(cue.text || ''),
                speaker: '', narrationNotes: '', narrationTone: '', narrationTempo: '',
                voice: '', ttsService: '', ttsSpeed: 1, ttsVolume: 100,
                originalVolume: Number(editor().state.project.settings.originalVolume ?? 0.9),
                ttsAudioPath: '', ttsDuration: 0, ttsPlaybackRate: 1,
                ttsGeneratedText: '', ttsGeneratedVoice: '', ttsGeneratedService: '',
                narrationSource: '', humanNarrationCandidateId: '',
                status: 'draft', source: 'contentstudio', contentStudioCueId: String(cue.id || ''),
                contentStudioConfidence: Number(cue.confidence) || 0,
                createdAt: now, updatedAt: now
            });
            imported += 1;
        });
        events.sort((left, right) => left.start - right.start || left.end - right.end);
        editor().setDirty(true);
        editor().renderEvents();
        window.dispatchEvent(new CustomEvent('evd-description-events-changed'));
        setStatus('description_subtitle_editor.contentstudio_cues_imported', { imported, skipped });
    }

    async function exportArtifact() {
        const data = projectState(false);
        if (!data?.projectId) return;
        setBusy(true);
        try {
            setStatus('description_subtitle_editor.contentstudio_export_started', { format: ui.exportFormat.value.toUpperCase() });
            const result = await window.api.descriptionSubtitleContentStudioExport({
                projectId: data.projectId,
                format: ui.exportFormat.value,
                quality: ui.exportQuality.value,
                includeCaptions: ui.exportCaptions.checked,
                sourceName: editor().state.project.source.name
            });
            if (!result?.canceled) setStatus('description_subtitle_editor.contentstudio_export_completed', { path: result.filePath });
        } catch (error) {
            setStatus('description_subtitle_editor.contentstudio_export_failed', { error: error.message || String(error) });
        } finally { setBusy(false); }
    }

    function bind() {
        ui.showKey.addEventListener('change', () => { ui.apiKey.type = ui.showKey.checked ? 'text' : 'password'; });
        ui.apiKey.addEventListener('input', render);
        ui.saveKey.addEventListener('click', saveKey);
        ui.changeKey.addEventListener('click', () => {
            state.editingKey = true;
            render();
            requestAnimationFrame(() => ui.apiKey.focus());
        });
        ui.testKey.addEventListener('click', testAccount);
        ui.start.addEventListener('click', openStartConfirmation);
        ui.confirmForm.addEventListener('submit', event => { event.preventDefault(); startGeneration(); });
        ui.confirmCancel.addEventListener('click', () => ui.confirmDialog.close());
        ui.recover.addEventListener('click', recoverProject);
        ui.refresh.addEventListener('click', () => refreshProject(true));
        ui.importCues.addEventListener('click', importCues);
        ui.exportButton.addEventListener('click', exportArtifact);
        ui.exportFormat.addEventListener('change', () => {
            const isSrt = ui.exportFormat.value === 'srt';
            ui.exportQuality.disabled = isSrt;
            ui.exportCaptions.disabled = isSrt;
        });
        ui.confidence.addEventListener('input', updateOutputs);
        ui.temperature.addEventListener('input', updateOutputs);
        window.addEventListener('evd-description-source-loaded', () => { applyStoredSettings(); render(); const status = projectState(false)?.status; if (status === 'queued' || status === 'processing') startPolling(); });
        window.api.onDescriptionSubtitleContentStudioProgress?.(payload => {
            if (!state.busy) return;
            const percent = Number(payload?.percent);
            if (Number.isFinite(percent)) ui.progress.value = Math.max(0, Math.min(100, percent));
            else ui.progress.removeAttribute('value');
            const stage = String(payload?.stage || 'uploading');
            const bucket = Number.isFinite(percent) ? Math.floor(percent / 10) : -1;
            if (stage !== state.lastProgressStage || bucket !== state.lastProgressBucket) {
                state.lastProgressStage = stage; state.lastProgressBucket = bucket;
                setStatus('description_subtitle_editor.contentstudio_progress', {
                    stage: t(`description_subtitle_editor.contentstudio_stage_${stage}`),
                    percent: Number.isFinite(percent) ? Math.round(percent) : 0
                });
            }
        });
        window.addEventListener('beforeunload', stopPolling);
        // Uploading and billing are deliberate panel actions, so no global shortcut is registered.
    }

    async function init() {
        await window.i18nHelper?.init?.();
        Object.assign(ui, {
            keyEntry: document.getElementById('contentstudio-key-entry'), apiKey: document.getElementById('contentstudio-api-key'), showKey: document.getElementById('contentstudio-show-key'),
            saveKey: document.getElementById('contentstudio-save-key'), changeKey: document.getElementById('contentstudio-change-key'), testKey: document.getElementById('contentstudio-test-key'),
            keyStatus: document.getElementById('contentstudio-key-status'), account: document.getElementById('contentstudio-account'),
            language: document.getElementById('contentstudio-language'), template: document.getElementById('contentstudio-template'),
            verbosity: document.getElementById('contentstudio-verbosity'), processingMode: document.getElementById('contentstudio-processing-mode'),
            confidence: document.getElementById('contentstudio-confidence'), confidenceValue: document.getElementById('contentstudio-confidence-value'),
            temperature: document.getElementById('contentstudio-temperature'), temperatureValue: document.getElementById('contentstudio-temperature-value'),
            captions: document.getElementById('contentstudio-captions'), recommendedInstructions: document.getElementById('contentstudio-recommended-instructions'),
            instructions: document.getElementById('contentstudio-instructions'), start: document.getElementById('contentstudio-start'),
            recover: document.getElementById('contentstudio-recover'), refresh: document.getElementById('contentstudio-refresh'), importCues: document.getElementById('contentstudio-import-cues'),
            projectStatus: document.getElementById('contentstudio-project-status'), progress: document.getElementById('contentstudio-progress'),
            exportFormat: document.getElementById('contentstudio-export-format'), exportQuality: document.getElementById('contentstudio-export-quality'),
            exportCaptions: document.getElementById('contentstudio-export-captions'), exportButton: document.getElementById('contentstudio-export'),
            confirmDialog: document.getElementById('contentstudio-confirm-dialog'), confirmForm: document.getElementById('contentstudio-confirm-form'),
            confirmMessage: document.getElementById('contentstudio-confirm-message'), confirmSubmit: document.getElementById('contentstudio-confirm-submit'),
            confirmCancel: document.getElementById('contentstudio-confirm-cancel')
        });
        bind();
        ui.exportFormat.dispatchEvent(new Event('change'));
        await loadKeyStatus();
        applyStoredSettings();
        render();
        const status = projectState(false)?.status;
        if (status === 'queued' || status === 'processing') startPolling();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
