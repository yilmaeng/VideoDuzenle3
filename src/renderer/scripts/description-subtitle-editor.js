(() => {
    const state = {
        project: null,
        projectPath: '',
        dirty: false,
        selectedEventId: '',
        selectedEventIds: [],
        pendingAction: null,
        sourceAvailable: false,
        preferences: {
            userKeymap: {},
            navigationStep: 1
        },
        saveInProgress: false,
        autoSaveTimer: null,
        eventFilter: 'all',
        playbackVolumePercent: 100,
        initialPayloadId: 0
    };

    const el = {};
    let statusRefreshTimer = null;

    function t(key, params = {}) {
        const value = window.i18nHelper?.t?.(key, params);
        return value && !value.startsWith('[') ? value : key;
    }

    function formatTime(seconds) {
        const value = Math.max(0, Number(seconds) || 0);
        const hours = Math.floor(value / 3600);
        const minutes = Math.floor((value % 3600) / 60);
        const wholeSeconds = Math.floor(value % 60);
        const milliseconds = Math.floor((value % 1) * 1000);
        return [hours, minutes, wholeSeconds].map(part => String(part).padStart(2, '0')).join(':')
            + `.${String(milliseconds).padStart(3, '0')}`;
    }

    function setStatus(key, params = {}, { forceRepeat = false } = {}) {
        const message = t(key, params);
        if (statusRefreshTimer) {
            clearTimeout(statusRefreshTimer);
            statusRefreshTimer = null;
        }
        if (forceRepeat && el.status.textContent === message) {
            el.status.textContent = '';
            statusRefreshTimer = window.setTimeout(() => {
                statusRefreshTimer = null;
                el.status.textContent = message;
            }, 30);
            return;
        }
        el.status.textContent = message;
    }

    function ensurePlaybackGain() {
        if (el.video?._descriptionGainNode) return true;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass || !el.video) return false;
        try {
            const context = new AudioContextClass();
            const source = context.createMediaElementSource(el.video);
            const gain = context.createGain();
            source.connect(gain);
            gain.connect(context.destination);
            el.video._descriptionGainContext = context;
            el.video._descriptionGainSource = source;
            el.video._descriptionGainNode = gain;
            el.video.volume = 1;
            return true;
        } catch (error) {
            console.warn('Description editor playback gain could not be initialized:', error);
            return false;
        }
    }

    function getPlaybackGainFactor() {
        return Math.max(0, Math.min(4, Number(state.playbackVolumePercent || 0) / 100));
    }

    function applyPlaybackGain() {
        const gainValue = getPlaybackGainFactor();
        if (ensurePlaybackGain()) {
            el.video.volume = 1;
            el.video._descriptionGainNode.gain.value = gainValue;
        } else if (el.video) {
            el.video.volume = Math.min(1, gainValue);
        }
    }

    function adjustPlaybackVolume(deltaPercent, announceChange = false) {
        if (!state.sourceAvailable) return;
        state.playbackVolumePercent = Math.max(0, Math.min(400,
            state.playbackVolumePercent + Number(deltaPercent || 0)));
        localStorage.setItem('evdPlaybackVolumePercent', String(state.playbackVolumePercent));
        applyPlaybackGain();
        if (announceChange) setStatus('runtime.keyboard.playback_volume', { percent: state.playbackVolumePercent });
    }

    function setDirty(dirty) {
        state.dirty = Boolean(dirty);
        el.dirtyIndicator.textContent = state.dirty
            ? t('description_subtitle_editor.unsaved_state')
            : (state.project ? t('description_subtitle_editor.saved_state') : '');
        const canSave = Boolean(state.project?.source?.path);
        el.saveProject.disabled = !canSave;
        el.saveProjectAs.disabled = !canSave;
    }

    function reviewNoteFor(eventId) {
        return (state.project?.reviewNotes || []).find(note => note.eventId === eventId) || null;
    }

    function getVisibleEvents() {
        const events = Array.isArray(state.project?.events) ? state.project.events : [];
        const isStandaloneReviewNote = item => item?.type === 'note';
        if (state.eventFilter === 'with-notes') {
            return events.filter(item => isStandaloneReviewNote(item) || reviewNoteFor(item.id));
        }
        if (state.eventFilter === 'unresolved-notes') {
            return events.filter(item => {
                if (isStandaloneReviewNote(item)) return item.status !== 'approved';
                const note = reviewNoteFor(item.id);
                return note && !note.resolved;
            });
        }
        if (state.eventFilter === 'without-notes') {
            return events.filter(item => !isStandaloneReviewNote(item) && !reviewNoteFor(item.id));
        }
        return events;
    }

    function renderEvents() {
        const allEvents = Array.isArray(state.project?.events) ? state.project.events : [];
        const events = getVisibleEvents();
        el.eventList.replaceChildren();
        el.eventSummary.textContent = state.eventFilter === 'all'
            ? t('description_subtitle_editor.event_count', { count: events.length })
            : t('description_subtitle_editor.filtered_event_count', { count: events.length, total: allEvents.length });
        el.eventList.setAttribute('aria-label', t('description_subtitle_editor.event_list_label', { count: events.length }));

        events.forEach((event, index) => {
            const item = document.createElement('div');
            item.className = 'event-item';
            item.id = `description-event-${event.id}`;
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', String(state.selectedEventIds.includes(event.id)));
            item.dataset.eventId = event.id;
            item.textContent = window.EvdDescriptionAuthoring?.formatEventItem?.(event, index)
                || t('description_subtitle_editor.event_item', {
                    index: index + 1,
                    start: formatTime(event.start),
                    end: formatTime(event.end),
                    text: event.text || t('description_subtitle_editor.event_without_text')
                });
            el.eventList.appendChild(item);
        });

        if (state.selectedEventId) {
            el.eventList.setAttribute('aria-activedescendant', `description-event-${state.selectedEventId}`);
        } else {
            el.eventList.removeAttribute('aria-activedescendant');
        }
        window.EvdDescriptionAuthoring?.updateControls?.();
    }

    function renderSource() {
        const source = state.project?.source;
        if (!source?.path) {
            el.sourceName.textContent = t('description_subtitle_editor.no_source');
            el.sourceDetails.textContent = '';
            el.video.removeAttribute('src');
            el.timeline.disabled = true;
            el.timeline.max = '0';
            return;
        }

        el.sourceName.textContent = source.name || source.path;
        el.sourceDetails.textContent = source.mediaType === 'audio'
            ? t('description_subtitle_editor.source_audio_details', { duration: formatTime(source.duration) })
            : t('description_subtitle_editor.source_details', {
                duration: formatTime(source.duration),
                width: source.width || 0,
                height: source.height || 0
            });
        el.timeline.disabled = false;
        el.timeline.max = String(Math.max(0, Number(source.duration) || 0));
    }

    async function loadVideoSource(source, { createNew = true, markDirty = true } = {}) {
        const sourcePath = source?.path || source;
        const fileInfo = {
            ...(source && typeof source === 'object' ? source : {}),
            ...await window.api.descriptionSubtitleEditorSourceInfo(sourcePath)
        };
        let project = createNew
            ? await window.api.descriptionSubtitleEditorNewProject(fileInfo)
            : state.project;
        project.source = { ...project.source, ...fileInfo };
        state.project = project;
        state.projectPath = createNew ? '' : state.projectPath;
        state.selectedEventId = project.workspace?.selectedEventId || '';
        state.selectedEventIds = Array.isArray(project.workspace?.selectedEventIds)
            ? project.workspace.selectedEventIds.filter(id => project.events.some(item => item.id === id))
            : (state.selectedEventId ? [state.selectedEventId] : []);

        const mediaUrl = await window.api.descriptionSubtitleEditorPathUrl(fileInfo.path);
        el.video.pause();
        el.video.muted = false;
        el.video.volume = 1;
        el.video.src = mediaUrl;
        el.video.load();
        state.sourceAvailable = true;
        applyPlaybackGain();
        renderSource();
        renderEvents();
        setDirty(markDirty);
        setStatus(fileInfo.mediaType === 'audio'
            ? 'description_subtitle_editor.audio_loaded'
            : 'description_subtitle_editor.video_loaded', { name: fileInfo.name });
        window.dispatchEvent(new CustomEvent('evd-description-source-loaded', { detail: { source: project.source } }));
    }

    function restoreSavedPlaybackPosition(savedPosition) {
        const savedTime = Math.max(0, Number(savedPosition) || 0);
        const applyPosition = () => {
            const duration = Number(el.video.duration) || Number(state.project?.source?.duration) || savedTime;
            el.video.currentTime = Math.min(savedTime, duration);
            el.timeline.value = String(el.video.currentTime);
            el.currentTime.textContent = formatTime(el.video.currentTime);
        };
        if (el.video.readyState >= 1) applyPosition();
        else el.video.addEventListener('loadedmetadata', applyPosition, { once: true });
    }

    async function chooseVideo() {
        const result = await window.api.descriptionSubtitleEditorChooseVideo();
        if (result?.canceled) return;
        const reconnectMissingSource = Boolean(state.projectPath && state.project && !state.sourceAvailable);
        await loadVideoSource(result.source, { createNew: !reconnectMissingSource, markDirty: true });
        document.getElementById('timeline-visual')?.focus();
    }

    async function openProject() {
        const result = await window.api.descriptionSubtitleEditorOpenProject();
        if (result?.canceled) return;
        state.project = result.project;
        state.projectPath = result.projectPath;
        state.selectedEventId = result.project.workspace?.selectedEventId || '';
        state.selectedEventIds = Array.isArray(result.project.workspace?.selectedEventIds)
            ? result.project.workspace.selectedEventIds.filter(id => result.project.events.some(item => item.id === id))
            : (state.selectedEventId ? [state.selectedEventId] : []);
        renderSource();
        renderEvents();

        try {
            const savedTime = Math.max(0, Number(result.project.workspace?.currentTime) || 0);
            await loadVideoSource(result.project.source, { createNew: false, markDirty: false });
            restoreSavedPlaybackPosition(savedTime);
            setStatus('description_subtitle_editor.project_opened', { name: result.project.source.name });
        } catch (error) {
            state.sourceAvailable = false;
            setDirty(false);
            setStatus('description_subtitle_editor.source_missing', { name: result.project.source.name || '' });
        }
    }

    async function loadProjectResult(result) {
        state.project = result.project;
        state.projectPath = result.projectPath;
        state.selectedEventId = result.project.workspace?.selectedEventId || '';
        state.selectedEventIds = Array.isArray(result.project.workspace?.selectedEventIds)
            ? result.project.workspace.selectedEventIds.filter(id => result.project.events.some(item => item.id === id))
            : (state.selectedEventId ? [state.selectedEventId] : []);
        renderSource();
        renderEvents();
        try {
            const savedTime = Math.max(0, Number(result.project.workspace?.currentTime) || 0);
            await loadVideoSource(result.project.source, { createNew: false, markDirty: false });
            restoreSavedPlaybackPosition(savedTime);
            setStatus('description_subtitle_editor.project_opened', { name: result.project.source.name });
        } catch (error) {
            state.sourceAvailable = false;
            setDirty(false);
            setStatus('description_subtitle_editor.source_missing', { name: result.project.source.name || '' });
        }
    }

    function prepareProjectForSave() {
        state.project.workspace = {
            ...(state.project.workspace || {}),
            currentTime: Number(el.video.currentTime) || 0,
            selectedEventId: state.selectedEventId || '',
            selectedEventIds: [...state.selectedEventIds]
        };
        return state.project;
    }

    async function saveProject(saveAs = false, { automatic = false } = {}) {
        if (!state.project?.source?.path) {
            setStatus('description_subtitle_editor.select_video_first');
            return false;
        }
        if (state.saveInProgress) return false;
        state.saveInProgress = true;
        try {
            const result = await window.api.descriptionSubtitleEditorSaveProject({
                project: prepareProjectForSave(),
                projectPath: state.projectPath,
                saveAs
            });
            if (result?.canceled) return false;
            state.project = result.project;
            state.projectPath = result.projectPath;
            setDirty(false);
            setStatus(automatic ? 'description_subtitle_editor.project_auto_saved' : 'description_subtitle_editor.project_saved', { name: result.projectPath.split(/[\\/]/).pop() });
            return true;
        } catch (error) {
            setStatus('description_subtitle_editor.operation_failed', { error: error.message || String(error) });
            return false;
        } finally {
            state.saveInProgress = false;
        }
    }

    function startAutoSave() {
        if (state.autoSaveTimer) clearInterval(state.autoSaveTimer);
        state.autoSaveTimer = setInterval(() => {
            if (state.dirty && state.projectPath && !state.saveInProgress) {
                saveProject(false, { automatic: true });
            }
        }, 3 * 60 * 1000);
    }

    async function closeEditor() {
        await window.api.descriptionSubtitleEditorConfirmClose();
    }

    function requestProtectedAction(action) {
        if (!state.dirty) {
            action();
            return;
        }
        state.pendingAction = action;
        el.closeTitle.textContent = t('description_subtitle_editor.unsaved_title');
        el.closeMessage.textContent = t('description_subtitle_editor.unsaved_message');
        if (!el.closeDialog.open) el.closeDialog.showModal();
        requestAnimationFrame(() => el.closeMessage.focus());
    }

    async function resolveCloseDialog(value) {
        if (value === 'cancel') {
            state.pendingAction = null;
            return;
        }
        if (value === 'save' && !(await saveProject(false))) return;
        const action = state.pendingAction;
        state.pendingAction = null;
        if (action) await action();
    }

    function handleEventListKeydown(event) {
        if (window.EvdDescriptionAuthoring?.handleEventListKeydown?.(event)) return;
        const events = state.project?.events || [];
        if (!events.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let index = Math.max(0, events.findIndex(item => item.id === state.selectedEventId));
        if (event.key === 'ArrowDown') index = Math.min(events.length - 1, index + 1);
        if (event.key === 'ArrowUp') index = Math.max(0, index - 1);
        if (event.key === 'Home') index = 0;
        if (event.key === 'End') index = events.length - 1;
        state.selectedEventId = events[index].id;
        state.project.workspace.selectedEventId = state.selectedEventId;
        renderEvents();
    }

    function bindEvents() {
        el.chooseVideo.addEventListener('click', () => requestProtectedAction(chooseVideo));
        el.openProject.addEventListener('click', () => requestProtectedAction(openProject));
        el.saveProject.addEventListener('click', () => saveProject(false));
        el.saveProjectAs.addEventListener('click', () => saveProject(true));
        el.closeEditor.addEventListener('click', () => requestProtectedAction(closeEditor));
        el.eventList.addEventListener('keydown', handleEventListKeydown);

        el.video.addEventListener('play', () => {
            ensurePlaybackGain();
            el.video._descriptionGainContext?.resume?.().catch?.(() => {});
            if (!el.video._descriptionMixPreviewActive) applyPlaybackGain();
        });

        el.video.addEventListener('loadedmetadata', () => {
            if (!state.project) return;
            state.project.source.duration = Number(el.video.duration) || state.project.source.duration || 0;
            state.project.source.width = el.video.videoWidth || state.project.source.width || 0;
            state.project.source.height = el.video.videoHeight || state.project.source.height || 0;
            el.timeline.max = String(state.project.source.duration);
            renderSource();
        });
        el.video.addEventListener('timeupdate', () => {
            if (state.project?.workspace) {
                state.project.workspace.currentTime = Number(el.video.currentTime) || 0;
            }
            // Updating a focused range control makes screen readers announce every playback tick.
            if (document.activeElement !== el.timeline) {
                el.timeline.value = String(el.video.currentTime || 0);
            }
            el.currentTime.textContent = formatTime(el.video.currentTime);
        });
        el.timeline.addEventListener('input', () => {
            el.video.currentTime = Number(el.timeline.value) || 0;
            el.currentTime.textContent = formatTime(el.video.currentTime);
        });

        el.closeDialog.addEventListener('close', () => resolveCloseDialog(el.closeDialog.returnValue));
        window.api.onDescriptionSubtitleEditorCloseRequested(() => requestProtectedAction(closeEditor));
        const handleInitialPayload = async payload => {
            if (payload?.requestId && state.initialPayloadId === payload.requestId) return;
            if (payload?.requestId) state.initialPayloadId = payload.requestId;
            if (payload?.userKeymap || payload?.navigationStep) {
                state.preferences = {
                    userKeymap: payload.userKeymap || {},
                    navigationStep: Number(payload.navigationStep) || 1
                };
                window.dispatchEvent(new CustomEvent('evd-description-preferences-updated', {
                    detail: state.preferences
                }));
            }
            const openPayload = async () => {
                try {
                    if (payload?.projectPath) {
                        const result = await window.api.descriptionSubtitleEditorLoadProjectPath(payload.projectPath);
                        await loadProjectResult(result);
                        return;
                    }
                    if (payload?.controlPackage) {
                        window.dispatchEvent(new CustomEvent('evd-description-control-package-open-requested', {
                            detail: payload.controlPackage
                        }));
                        return;
                    }
                    if (payload?.videoPath) {
                        await loadVideoSource(payload.videoPath, { createNew: true, markDirty: true });
                    }
                } catch (error) {
                    setStatus('description_subtitle_editor.operation_failed', { error: error.message || String(error) });
                }
            };
            if (!payload?.projectPath && !payload?.controlPackage && !payload?.videoPath) return;
            if (state.project) await requestProtectedAction(openPayload);
            else await openPayload();
        };
        window.api.onDescriptionSubtitleEditorInit(handleInitialPayload);
        window.api.descriptionSubtitleEditorGetInitialPayload()
            .then(handleInitialPayload)
            .catch(error => setStatus('description_subtitle_editor.operation_failed', { error: error.message || String(error) }));

        window.addEventListener('keydown', event => {
            const key = event.key.toLowerCase();
            if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && key === 's') {
                event.preventDefault();
                // Contextual editor shortcut; intentionally not added to the global shortcut manager.
                saveProject(false);
                return;
            }
            const modifier = window.api.platform === 'darwin' ? event.metaKey : event.ctrlKey;
            if (!modifier) return;
            if (key === 's') {
                event.preventDefault();
                saveProject(event.shiftKey);
            }
        });
    }

    async function init() {
        await window.i18nHelper?.init?.();
        const storedPlaybackVolumeValue = localStorage.getItem('evdPlaybackVolumePercent');
        const storedPlaybackVolume = Number(storedPlaybackVolumeValue);
        if (storedPlaybackVolumeValue !== null && Number.isFinite(storedPlaybackVolume)) {
            state.playbackVolumePercent = Math.max(0, Math.min(400, storedPlaybackVolume));
        }
        Object.assign(el, {
            chooseVideo: document.getElementById('choose-video'),
            openProject: document.getElementById('open-project'),
            saveProject: document.getElementById('save-project'),
            saveProjectAs: document.getElementById('save-project-as'),
            closeEditor: document.getElementById('close-editor'),
            sourceName: document.getElementById('source-name'),
            sourceDetails: document.getElementById('source-details'),
            video: document.getElementById('video-preview'),
            timeline: document.getElementById('timeline-position'),
            currentTime: document.getElementById('current-time'),
            eventList: document.getElementById('event-list'),
            eventHelp: document.getElementById('event-list-help'),
            eventSummary: document.getElementById('event-summary'),
            status: document.getElementById('status'),
            dirtyIndicator: document.getElementById('dirty-indicator'),
            closeDialog: document.getElementById('close-dialog'),
            closeTitle: document.getElementById('close-title'),
            closeMessage: document.getElementById('close-message')
        });
        bindEvents();
        startAutoSave();
        window.addEventListener('beforeunload', () => { if (state.autoSaveTimer) clearInterval(state.autoSaveTimer); });
        renderSource();
        renderEvents();
        setDirty(false);
        el.chooseVideo.focus();
    }

    window.EvdDescriptionEditor = { state, adjustPlaybackVolume, applyPlaybackGain, formatTime, getPlaybackGainFactor, getVisibleEvents, loadProjectResult, loadVideoSource, renderEvents, requestProtectedAction, reviewNoteFor, setDirty, setStatus };
    document.addEventListener('DOMContentLoaded', init);
})();




