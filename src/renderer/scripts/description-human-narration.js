(() => {
    const ui = {};
    const state = {
        selectedCandidateId: '',
        busy: false,
        lastProgressStage: '',
        lastProgressBucket: -1,
        autoSelectedFirstCandidate: false,
        candidateAudio: null,
        editingCandidateId: '',
        nextTrimMarker: 'start',
        manualSelectionPreview: false,
        manualBusy: false,
        manualMixPreviewTimer: null,
        manualAnnouncementToken: 0,
        manualSilenceAnalysisPromise: null,
        manualSpeechPreview: null,
        manualFocusAnnouncementTimer: null,
        manualAnnouncementClearTimer: null
    };

    function editor() { return window.EvdDescriptionEditor; }
    function t(key, params = {}) {
        const value = window.i18nHelper?.t?.(key, params);
        return value && !value.startsWith('[') ? value : key;
    }
    function descriptions() {
        return (editor()?.state.project?.events || []).filter(item => item.type === 'description');
    }
    function selectedDescription() {
        const id = editor()?.state.selectedEventId;
        return descriptions().find(item => item.id === id) || null;
    }
    function narration(create = true) {
        const project = editor()?.state.project;
        if (!project) return null;
        if (!project.humanNarration && create) {
            project.humanNarration = {
                sourcePath: '', sourceName: '', model: 'Xenova/whisper-base', transcript: '',
                candidates: [], unmatched: [], analyzedAt: ''
            };
        }
        return project.humanNarration || null;
    }
    function descriptionForCandidate(candidate) {
        return descriptions().find(item => item.id === candidate?.eventId) || null;
    }
    function allCandidates() {
        const order = new Map(descriptions().map((item, index) => [item.id, index]));
        return [...(narration(false)?.candidates || [])].sort((left, right) =>
            (order.get(left.eventId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.eventId) ?? Number.MAX_SAFE_INTEGER)
            || Number(left.takeNumber || 0) - Number(right.takeNumber || 0)
            || Number(left.sourceStart || 0) - Number(right.sourceStart || 0));
    }
    function selectedCandidate() {
        return (narration(false)?.candidates || []).find(candidate => candidate.id === state.selectedCandidateId) || null;
    }
    function formatTime(seconds) { return editor()?.formatTime?.(seconds) || String(seconds); }
    function setStatus(key, params = {}) { editor()?.setStatus?.(key, params); }

    function candidateLabel(candidate) {
        const item = descriptionForCandidate(candidate);
        const label = t('description_subtitle_editor.human_candidate_item', {
            description: item?.text || '',
            take: candidate.takeNumber,
            score: Math.round(Number(candidate.score || 0) * 100),
            start: formatTime(candidate.sourceStart),
            end: formatTime(candidate.sourceEnd),
            transcript: candidate.transcript,
            state: item?.humanNarrationCandidateId === candidate.id
                ? t('description_subtitle_editor.human_candidate_applied_state')
                : (candidate.recommended
                    ? t('description_subtitle_editor.human_candidate_recommended')
                    : (candidate.needsReview ? t('description_subtitle_editor.human_candidate_review') : ''))
        });
        return Number.isFinite(Number(candidate.trimStart)) && Number.isFinite(Number(candidate.trimEnd))
            ? `${label} ${t('description_subtitle_editor.human_candidate_trimmed_state', {
                start: formatTime(candidate.trimStart), end: formatTime(candidate.trimEnd)
            })}`
            : label;
    }

    function renderCandidateList() {
        const restoreListFocus = document.activeElement === ui.candidateList || ui.candidateList.contains(document.activeElement);
        const list = allCandidates();
        ui.candidateList.replaceChildren();
        if (!list.length) {
            ui.candidateList.textContent = t('description_subtitle_editor.human_no_candidates');
            ui.candidateList.removeAttribute('aria-activedescendant');
            state.selectedCandidateId = '';
        } else {
            if (!list.some(item => item.id === state.selectedCandidateId)) {
                state.selectedCandidateId = list[0].id;
            }
            list.forEach((candidate, index) => {
                const option = document.createElement('div');
                option.id = `human-narration-${candidate.id}`;
                option.className = 'event-list-item';
                option.setAttribute('role', 'option');
                option.dataset.candidateId = candidate.id;
                option.setAttribute('aria-selected', String(candidate.id === state.selectedCandidateId));
                option.setAttribute('aria-posinset', String(index + 1));
                option.setAttribute('aria-setsize', String(list.length));
                option.textContent = candidateLabel(candidate);
                ui.candidateList.appendChild(option);
            });
            ui.candidateList.setAttribute('aria-activedescendant', `human-narration-${state.selectedCandidateId}`);
        }
        const selected = selectedCandidate();
        ui.preview.disabled = !selected?.audioPath;
        ui.previewMix.disabled = !selected?.audioPath;
        ui.edit.disabled = !selected?.audioPath;
        ui.use.disabled = !selected?.audioPath;
        ui.useRecommended.disabled = !(narration(false)?.candidates || []).some(item => item.recommended) || state.busy;
        if (restoreListFocus) requestAnimationFrame(() => ui.candidateList.focus({ preventScroll: true }));
    }

    function renderUnmatched() {
        const items = narration(false)?.unmatched || [];
        ui.unmatched.replaceChildren();
        if (!items.length) {
            ui.unmatched.textContent = t('description_subtitle_editor.human_no_unmatched');
            return;
        }
        items.forEach((item, index) => {
            const row = document.createElement('div');
            row.setAttribute('role', 'listitem');
            row.textContent = t('description_subtitle_editor.human_unmatched_item', {
                index: index + 1,
                start: formatTime(item.start),
                end: formatTime(item.end),
                transcript: item.transcript
            });
            ui.unmatched.appendChild(row);
        });
    }

    function render() {
        const data = narration(false);
        ui.source.textContent = data?.sourceName
            ? t('description_subtitle_editor.human_source_selected', { name: data.sourceName })
            : t('description_subtitle_editor.human_source_none');
        if (data?.model && [...ui.model.options].some(option => option.value === data.model)) ui.model.value = data.model;
        // Keep the action reachable so users can hear why matching cannot start yet.
        // chooseAndAnalyze() announces the missing-description requirement.
        ui.analyze.disabled = state.busy;
        ui.manualOpen.disabled = state.busy || !descriptions().length;
        ui.clear.disabled = state.busy || !data?.sourcePath;
        renderCandidateList();
        renderUnmatched();
        if (ui.manualDialog?.open) renderManualMatcher();
    }

    function stopCandidateOnlyPreview() {
        if (!state.candidateAudio) return;
        state.candidateAudio.pause();
        state.candidateAudio.removeAttribute('src');
        state.candidateAudio = null;
    }

    async function previewCandidateOnly() {
        const candidate = selectedCandidate();
        if (!candidate?.audioPath) return;
        stopCandidateOnlyPreview();
        window.EvdDescriptionPhase5?.stopPreview?.();
        try {
            const audio = new Audio(await window.api.descriptionSubtitleEditorPathUrl(candidate.audioPath));
            state.candidateAudio = audio;
            audio.addEventListener('ended', () => { if (state.candidateAudio === audio) state.candidateAudio = null; }, { once: true });
            await audio.play();
        } catch (error) {
            setStatus('description_subtitle_editor.human_preview_failed', { error: error.message || String(error) });
        }
    }

    async function previewMixedCandidate({ announce = true } = {}) {
        const candidate = selectedCandidate();
        const item = descriptionForCandidate(candidate);
        if (!item || !candidate) return;
        stopCandidateOnlyPreview();
        const handled = await window.EvdDescriptionPhase5?.previewHumanCandidate?.(item, candidate, { announce });
        if (!handled) previewCandidateOnly();
    }

    function manualMatching(create = true) {
        const data = narration(create);
        if (!data) return null;
        if (!data.manualMatching && create) {
            data.manualMatching = {
                selectedEventId: '', sourcePosition: 0, markerStart: null, markerEnd: null, nextMarker: 'start'
            };
        }
        return data.manualMatching || null;
    }

    function manualDescription() {
        const id = manualMatching(false)?.selectedEventId;
        return descriptions().find(item => item.id === id) || null;
    }

    function manualSelectedDescriptions() {
        const manual = manualMatching(false);
        const selectedIds = new Set(Array.isArray(manual?.selectedEventIds) ? manual.selectedEventIds : []);
        const current = manualDescription();
        if (!selectedIds.size && current) selectedIds.add(current.id);
        return descriptions().filter(item => selectedIds.has(item.id));
    }

    function hasManualTime(value) {
        return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
    }

    function announceManualLive(message) {
        window.clearTimeout(state.manualAnnouncementClearTimer);
        const token = ++state.manualAnnouncementToken;
        if (ui.manualAnnouncer.textContent) ui.manualAnnouncer.textContent = '';
        window.requestAnimationFrame(() => {
            if (token !== state.manualAnnouncementToken) return;
            ui.manualAnnouncer.textContent = message;
            state.manualAnnouncementClearTimer = window.setTimeout(() => {
                if (ui.manualAnnouncer.textContent === message) ui.manualAnnouncer.textContent = '';
            }, 3000);
        });
    }

    function cancelManualLiveAnnouncement() {
        window.clearTimeout(state.manualFocusAnnouncementTimer);
        window.clearTimeout(state.manualAnnouncementClearTimer);
        state.manualFocusAnnouncementTimer = null;
        state.manualAnnouncementClearTimer = null;
        state.manualAnnouncementToken += 1;
    }

    function announceManualDescription() {
        const item = manualDescription();
        const items = descriptions();
        const message = item
            ? t('description_subtitle_editor.human_manual_timeline_description', {
                text: item.text || '',
                index: items.findIndex(entry => entry.id === item.id) + 1,
                total: items.length
            })
            : t('description_subtitle_editor.human_manual_no_description');
        // The main status region is outside the modal and can be inert to screen readers.
        // Recreate the text inside the dialog so D also repeats an identical description reliably.
        announceManualLive(message);
    }

    function restoreManualTimelineAccessibleName() {
        ui.manualTimeline.setAttribute('aria-label', t('description_subtitle_editor.human_manual_timeline_label'));
    }

    function suppressManualTimelineAccessibleName() {
        // JAWS can repeat an application surface's name for every editing keystroke.
        // Dynamic position and marker text live outside this stable focus surface.
        ui.manualTimeline.removeAttribute('aria-label');
    }

    function focusManualTimeline({ announce = true } = {}) {
        window.clearTimeout(state.manualFocusAnnouncementTimer);
        stopCandidateOnlyPreview();
        window.EvdDescriptionPhase5?.stopPreview?.();
        ui.manualTimeline.focus({ preventScroll: true });
        if (announce) state.manualFocusAnnouncementTimer = window.setTimeout(() => {
            state.manualFocusAnnouncementTimer = null;
            announceManualDescription();
        }, 40);
    }

    function appliedCandidateForDescription(item) {
        if (!item) return null;
        const candidates = narration(false)?.candidates || [];
        return candidates.find(candidate => candidate.id === item.humanNarrationCandidateId)
            || candidates.find(candidate => candidate.eventId === item.id) || null;
    }

    function manualDescriptionLabel(item, index) {
        const candidates = (narration(false)?.candidates || []).filter(candidate => candidate.eventId === item.id);
        const status = item.humanNarrationCandidateId
            ? t('description_subtitle_editor.human_manual_status_applied')
            : (candidates.length
                ? t('description_subtitle_editor.human_manual_status_candidates', { count: candidates.length })
                : t('description_subtitle_editor.human_manual_status_unmatched'));
        return t('description_subtitle_editor.human_manual_description_item', {
            text: item.text || '', index: index + 1, status
        });
    }

    function renderManualMatcher({ restoreFocus = false } = {}) {
        if (!ui.manualDialog?.open) return;
        const data = narration(false);
        const manual = manualMatching();
        const items = descriptions();
        const selected = manualDescription();
        ui.manualSource.textContent = data?.sourceName
            ? t('description_subtitle_editor.human_source_selected', { name: data.sourceName })
            : t('description_subtitle_editor.human_source_none');
        ui.manualCurrent.textContent = selected
            ? t('description_subtitle_editor.human_manual_current_description', {
                text: selected.text || '', index: items.findIndex(item => item.id === selected.id) + 1, total: items.length
            })
            : t('description_subtitle_editor.human_manual_no_description');
        const hadListFocus = restoreFocus || document.activeElement === ui.manualList;
        ui.manualList.replaceChildren();
        const validIds = new Set(items.map(item => item.id));
        const storedIds = Array.isArray(manual.selectedEventIds)
            ? manual.selectedEventIds.filter(id => validIds.has(id)) : [];
        const selectedIds = new Set(storedIds.length && (!selected || storedIds.includes(selected.id))
            ? storedIds : (selected ? [selected.id] : []));
        manual.selectedEventIds = [...selectedIds];
        items.forEach((item, index) => {
            const option = document.createElement('div');
            option.id = `human-manual-description-${item.id}`;
            option.className = 'event-list-item';
            option.dataset.eventId = item.id;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', String(selectedIds.has(item.id)));
            option.setAttribute('aria-posinset', String(index + 1));
            option.setAttribute('aria-setsize', String(items.length));
            option.textContent = manualDescriptionLabel(item, index);
            ui.manualList.appendChild(option);
        });
        if (selected) ui.manualList.setAttribute('aria-activedescendant', `human-manual-description-${selected.id}`);
        else ui.manualList.removeAttribute('aria-activedescendant');
        ui.manualAssign.disabled = state.manualBusy || !selected || !hasManualTime(manual.markerStart) || !hasManualTime(manual.markerEnd);
        ui.manualRemove.disabled = state.manualBusy || !selected?.humanNarrationCandidateId;
        const automaticCandidate = appliedCandidateForDescription(selected);
        ui.manualApproveCandidate.disabled = state.manualBusy || !automaticCandidate?.audioPath
            || selected?.humanNarrationCandidateId === automaticCandidate.id;
        ui.manualNext.disabled = !selected;
        const settings = editor()?.state.project?.settings || {};
        ui.manualSpeed.disabled = !selected;
        ui.manualVolume.disabled = !selected;
        ui.manualOriginalVolume.disabled = !selected;
        ui.manualSpeed.value = String(Math.round((Number(selected?.ttsPlaybackRate) || 1) * 100));
        ui.manualVolume.value = String(Math.round(Number(selected?.ttsVolume ?? settings.ttsVolume ?? 100)));
        ui.manualOriginalVolume.value = String(Math.round(Number(selected?.originalVolume ?? settings.originalVolume ?? 0.9) * 100));
        updateManualMixOutputs();
        updateManualPosition();
        if (hadListFocus) requestAnimationFrame(() => ui.manualList.focus({ preventScroll: true }));
    }

    function updateManualMixOutputs() {
        ui.manualSpeedValue.textContent = `%${ui.manualSpeed.value}`;
        ui.manualVolumeValue.textContent = `%${ui.manualVolume.value}`;
        ui.manualOriginalVolumeValue.textContent = `%${ui.manualOriginalVolume.value}`;
    }

    function scheduleManualMixPreview() {
        window.clearTimeout(state.manualMixPreviewTimer);
        const eventId = manualDescription()?.id;
        if (!eventId || !appliedCandidateForDescription(manualDescription())?.audioPath) return;
        state.manualMixPreviewTimer = window.setTimeout(() => {
            if (manualDescription()?.id === eventId) {
                previewManualDescription(true, { announceMissing: false, announcePreview: false });
            }
        }, 180);
    }

    function updateManualMixSetting(field, rawValue, { announce = false } = {}) {
        const selectedItems = manualSelectedDescriptions();
        if (!selectedItems.length) return;
        const minimum = field === 'ttsPlaybackRate' ? 50 : 0;
        const percent = Math.max(minimum, Math.min(200, Number(rawValue) || 0));
        if (field === 'ttsPlaybackRate') ui.manualSpeed.value = String(percent);
        else if (field === 'ttsVolume') ui.manualVolume.value = String(percent);
        else if (field === 'originalVolume') ui.manualOriginalVolume.value = String(percent);
        selectedItems.forEach(item => {
            if (field === 'ttsPlaybackRate') item.ttsPlaybackRate = percent / 100;
            else if (field === 'ttsVolume') item.ttsVolume = percent;
            else if (field === 'originalVolume') item.originalVolume = percent / 100;
            item.updatedAt = new Date().toISOString();
        });
        editor().setDirty(true);
        updateManualMixOutputs();
        if (announce) {
            const settingKey = field === 'ttsPlaybackRate'
                ? 'description_subtitle_editor.human_manual_playback_speed'
                : (field === 'ttsVolume'
                    ? 'description_subtitle_editor.human_manual_narration_volume'
                    : 'description_subtitle_editor.human_manual_original_volume');
            announceManualLive(t(selectedItems.length > 1
                ? 'description_subtitle_editor.human_manual_mix_changed_multiple'
                : 'description_subtitle_editor.human_manual_mix_changed', {
                setting: t(settingKey), value: percent, count: selectedItems.length
            }));
        }
        scheduleManualMixPreview();
    }

    function handleManualMixShortcut(event) {
        if (event.isComposing) return false;
        if (document.activeElement === ui.manualTimeline) suppressManualTimelineAccessibleName();
        const key = String(event.key || '').toLowerCase();
        const primaryModifier = window.api?.platform === 'darwin' ? event.metaKey : event.ctrlKey;
        if (primaryModifier && !event.altKey && !event.shiftKey
            && (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || key === 'j' || key === 'l')) {
            suppressManualTimelineAccessibleName();
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            jumpManualSpeech(event.key === 'ArrowRight' || key === 'l' ? 1 : -1);
            return true;
        }
        let field = '';
        let value = 0;
        if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'f') {
            field = 'ttsPlaybackRate'; value = Number(ui.manualSpeed.value) + 5;
        } else if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'a') {
            field = 'ttsPlaybackRate'; value = Number(ui.manualSpeed.value) - 5;
        } else if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && key === 'l') {
            field = 'ttsVolume'; value = Number(ui.manualVolume.value) + 10;
        } else if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && key === 'j') {
            field = 'ttsVolume'; value = Number(ui.manualVolume.value) - 10;
        } else if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.key === 'ArrowUp') {
            field = 'originalVolume'; value = Number(ui.manualOriginalVolume.value) + 10;
        } else if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.key === 'ArrowDown') {
            field = 'originalVolume'; value = Number(ui.manualOriginalVolume.value) - 10;
        } else if (!event.altKey && !event.ctrlKey && !event.metaKey && event.shiftKey && key === 'm') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            clearManualMarkers();
            return true;
        } else if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'd') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            announceManualDescription();
            return true;
        }
        if (!field) return false;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        // These modal-only editing shortcuts intentionally remain outside the global shortcut manager.
        updateManualMixSetting(field, value, { announce: true });
        return true;
    }

    function updateManualPosition() {
        if (!ui.manualAudio) return;
        const manual = manualMatching(false);
        if (!manual) return;
        const position = Number(ui.manualAudio.currentTime) || 0;
        const duration = Number(ui.manualAudio.duration) || 0;
        if (state.manualSpeechPreview && position >= state.manualSpeechPreview.end) {
            const start = state.manualSpeechPreview.start;
            state.manualSpeechPreview = null;
            ui.manualAudio.pause();
            ui.manualAudio.currentTime = start;
        }
        if (state.manualSelectionPreview && hasManualTime(manual.markerEnd) && position >= Number(manual.markerEnd)) {
            ui.manualAudio.pause();
            ui.manualAudio.currentTime = Number(manual.markerStart) || 0;
            state.manualSelectionPreview = false;
        }
        ui.manualPosition.textContent = t('description_subtitle_editor.human_manual_position', {
            position: formatTime(ui.manualAudio.currentTime || 0), duration: formatTime(duration)
        });
        const hasStart = hasManualTime(manual.markerStart);
        const hasEnd = hasManualTime(manual.markerEnd);
        const markerText = hasStart
            ? (hasEnd
                ? t('description_subtitle_editor.human_manual_markers_complete', {
                    start: formatTime(manual.markerStart), end: formatTime(manual.markerEnd),
                    duration: formatTime(Math.max(0, manual.markerEnd - manual.markerStart))
                })
                : t('description_subtitle_editor.human_manual_marker_start_only', { start: formatTime(manual.markerStart) }))
            : t('description_subtitle_editor.human_manual_markers_empty');
        if (ui.manualMarkers.textContent !== markerText) ui.manualMarkers.textContent = markerText;
    }

    async function ensureManualSpeechStarts({ announceProgress = false } = {}) {
        const data = narration(false);
        const manual = manualMatching();
        const sourcePath = data?.sourcePath;
        if (!sourcePath) return [];
        if (manual.silenceSourcePath === sourcePath && Array.isArray(manual.speechStarts)) {
            return manual.speechStarts;
        }
        if (state.manualSilenceAnalysisPromise) {
            if (announceProgress) announceManualLive(t('description_subtitle_editor.human_manual_silence_analyzing'));
            return state.manualSilenceAnalysisPromise;
        }
        if (announceProgress) announceManualLive(t('description_subtitle_editor.human_manual_silence_analyzing'));
        state.manualSilenceAnalysisPromise = (async () => {
            const result = await window.api.detectSilence({ inputPath: sourcePath, minDuration: 0.3, threshold: -38 });
            if (!result?.success) throw new Error(result?.error || 'silence_detection_failed');
            const duration = Number(ui.manualAudio.duration) || Number.POSITIVE_INFINITY;
            const starts = [0, ...(result.data || []).map(item => Number(item.end))]
                .filter(value => Number.isFinite(value) && value >= 0 && value < duration - 0.1)
                .sort((left, right) => left - right)
                .filter((value, index, values) => index === 0 || value - values[index - 1] >= 0.05);
            manual.speechStarts = starts;
            manual.silenceSourcePath = sourcePath;
            manual.silenceAnalyzedAt = new Date().toISOString();
            editor().setDirty(true);
            return starts;
        })().catch(error => {
            manual.speechStarts = [];
            manual.silenceSourcePath = sourcePath;
            if (announceProgress) announceManualLive(t('description_subtitle_editor.human_manual_silence_failed', {
                error: error.message || String(error)
            }));
            return [];
        }).finally(() => { state.manualSilenceAnalysisPromise = null; });
        return state.manualSilenceAnalysisPromise;
    }

    async function jumpManualSpeech(direction) {
        cancelManualLiveAnnouncement();
        const starts = await ensureManualSpeechStarts();
        if (!starts.length) return;
        const previewWhenPaused = ui.manualAudio.paused || Boolean(state.manualSpeechPreview);
        state.manualSpeechPreview = null;
        state.manualSelectionPreview = false;
        if (previewWhenPaused) ui.manualAudio.pause();
        const current = Number(ui.manualAudio.currentTime) || 0;
        const target = direction > 0
            ? starts.find(value => value > current + 0.15)
            : [...starts].reverse().find(value => value < current - 0.4);
        if (!Number.isFinite(target)) return;
        ui.manualAudio.currentTime = target;
        const manual = manualMatching();
        manual.sourcePosition = target;
        updateManualPosition();
        if (previewWhenPaused) {
            const duration = Number(ui.manualAudio.duration) || target + 1;
            state.manualSpeechPreview = { start: target, end: Math.min(duration, target + 1) };
            try { await ui.manualAudio.play(); }
            catch (_) { state.manualSpeechPreview = null; }
        }
    }

    function selectManualDescription(index, { focusList = false, autoPreview = false, extendSelection = false } = {}) {
        window.clearTimeout(state.manualMixPreviewTimer);
        const items = descriptions();
        if (!items.length) return;
        const safeIndex = Math.max(0, Math.min(items.length - 1, index));
        const item = items[safeIndex];
        const manual = manualMatching();
        const previousId = manual.selectedEventId;
        const changed = previousId !== item.id;
        manual.selectedEventId = item.id;
        if (extendSelection) {
            const anchorId = manual.selectionAnchorId || previousId || item.id;
            const anchorIndex = Math.max(0, items.findIndex(entry => entry.id === anchorId));
            const rangeStart = Math.min(anchorIndex, safeIndex);
            const rangeEnd = Math.max(anchorIndex, safeIndex);
            manual.selectedEventIds = items.slice(rangeStart, rangeEnd + 1).map(entry => entry.id);
        } else {
            manual.selectionAnchorId = item.id;
            manual.selectedEventIds = [item.id];
        }
        const selectedIds = [...manual.selectedEventIds];
        editor().state.selectedEventId = item.id;
        editor().state.selectedEventIds = selectedIds;
        editor().state.project.workspace.selectedEventId = item.id;
        editor().state.project.workspace.selectedEventIds = selectedIds;
        editor().renderEvents();
        renderManualMatcher({ restoreFocus: focusList });
        if (autoPreview && changed) {
            previewManualDescription(true, { announceMissing: false, announcePreview: false });
        }
    }

    async function loadManualSource(sourcePath, restorePosition = true) {
        if (!sourcePath) return false;
        ui.manualAudio.pause();
        ui.manualAudio.src = await window.api.descriptionSubtitleEditorPathUrl(sourcePath);
        ui.manualAudio.load();
        const manual = manualMatching();
        const prepare = () => {
            const duration = Number(ui.manualAudio.duration) || 0;
            ui.manualAudio.currentTime = restorePosition
                ? Math.max(0, Math.min(duration, Number(manual.sourcePosition) || 0)) : 0;
            updateManualPosition();
            focusManualTimeline();
            ensureManualSpeechStarts();
        };
        if (ui.manualAudio.readyState >= 1) prepare();
        else ui.manualAudio.addEventListener('loadedmetadata', prepare, { once: true });
        return true;
    }

    async function chooseManualSource({ restorePosition = false } = {}) {
        const chosen = await window.api.descriptionSubtitleEditorChooseNarration();
        if (chosen?.canceled) return false;
        const data = narration();
        const manual = manualMatching();
        data.sourcePath = chosen.sourcePath;
        data.sourceName = chosen.sourceName;
        manual.sourcePosition = 0;
        manual.markerStart = null;
        manual.markerEnd = null;
        manual.nextMarker = 'start';
        manual.speechStarts = [];
        manual.silenceSourcePath = '';
        manual.silenceAnalyzedAt = '';
        state.manualSilenceAnalysisPromise = null;
        editor().setDirty(true);
        render();
        if (ui.manualDialog.open) {
            renderManualMatcher();
            await loadManualSource(chosen.sourcePath, restorePosition);
        }
        setStatus('description_subtitle_editor.human_manual_source_ready', { name: chosen.sourceName });
        return true;
    }

    async function openManualMatcher() {
        const items = descriptions();
        if (!items.length) { setStatus('description_subtitle_editor.human_requires_descriptions'); return; }
        const data = narration();
        const manual = manualMatching();
        if (!items.some(item => item.id === manual.selectedEventId)) {
            manual.selectedEventId = items.find(item => !item.humanNarrationCandidateId)?.id || items[0].id;
        }
        if (!data.sourcePath) {
            const selected = await chooseManualSource();
            if (!selected) return;
        }
        ui.manualDialog.showModal();
        renderManualMatcher();
        try { await loadManualSource(data.sourcePath, true); }
        catch (error) { setStatus('description_subtitle_editor.human_manual_source_failed', { error: error.message || String(error) }); }
    }

    function closeManualMatcher() {
        window.clearTimeout(state.manualMixPreviewTimer);
        const manual = manualMatching(false);
        if (manual && ui.manualAudio) manual.sourcePosition = Number(ui.manualAudio.currentTime) || 0;
        ui.manualAudio.pause();
        ui.manualAudio.removeAttribute('src');
        state.manualSelectionPreview = false;
        state.manualSpeechPreview = null;
        if (ui.manualDialog.open) ui.manualDialog.close();
        editor().setDirty(true);
        ui.manualOpen.focus({ preventScroll: true });
    }

    async function toggleManualPlayback() {
        if (!ui.manualAudio.src) {
            const sourcePath = narration(false)?.sourcePath;
            if (sourcePath) await loadManualSource(sourcePath, true);
            if (!ui.manualAudio.src) {
                setStatus('description_subtitle_editor.human_manual_audio_not_ready');
                return;
            }
        }
        stopCandidateOnlyPreview();
        window.EvdDescriptionPhase5?.stopPreview?.();
        state.manualSelectionPreview = false;
        if (state.manualSpeechPreview) {
            const start = state.manualSpeechPreview.start;
            state.manualSpeechPreview = null;
            ui.manualAudio.pause();
            ui.manualAudio.currentTime = start;
        }
        if (!ui.manualAudio.paused) { ui.manualAudio.pause(); return; }
        try { await ui.manualAudio.play(); }
        catch (error) { setStatus('description_subtitle_editor.human_preview_failed', { error: error.message || String(error) }); }
    }

    function seekManualAudio(delta) {
        const duration = Number(ui.manualAudio.duration) || 0;
        ui.manualAudio.currentTime = Math.max(0, Math.min(duration, (Number(ui.manualAudio.currentTime) || 0) + delta));
        updateManualPosition();
    }

    function setManualMarker() {
        const manual = manualMatching();
        const current = Math.max(0, Number(ui.manualAudio.currentTime) || 0);
        if (manual.nextMarker !== 'end') {
            manual.markerStart = current;
            manual.markerEnd = null;
            manual.nextMarker = 'end';
            announceManualLive(t('description_subtitle_editor.human_manual_start_marker_announcement', {
                time: formatTime(current)
            }));
        } else if (current <= Number(manual.markerStart) + 0.049) {
            setStatus('description_subtitle_editor.human_trim_second_marker_invalid');
            return;
        } else {
            manual.markerEnd = current;
            manual.nextMarker = 'start';
            announceManualLive(t('description_subtitle_editor.human_manual_end_marker_announcement', {
                time: formatTime(current)
            }));
        }
        editor().setDirty(true);
        renderManualMatcher();
        if (document.activeElement !== ui.manualTimeline) focusManualTimeline({ announce: false });
    }

    function clearManualMarkers() {
        const manual = manualMatching();
        const hadMarkers = hasManualTime(manual.markerStart) || hasManualTime(manual.markerEnd);
        manual.markerStart = null;
        manual.markerEnd = null;
        manual.nextMarker = 'start';
        state.manualSelectionPreview = false;
        if (hadMarkers) editor().setDirty(true);
        renderManualMatcher();
        if (document.activeElement !== ui.manualTimeline) focusManualTimeline({ announce: false });
        announceManualLive(t(hadMarkers
            ? 'description_subtitle_editor.human_manual_markers_cleared'
            : 'description_subtitle_editor.human_manual_markers_already_empty'));
    }

    async function previewManualSelection() {
        const manual = manualMatching(false);
        if (!manual || !hasManualTime(manual.markerStart) || !hasManualTime(manual.markerEnd)) {
            setStatus('description_subtitle_editor.human_manual_markers_required');
            return;
        }
        state.manualSelectionPreview = true;
        ui.manualAudio.currentTime = Number(manual.markerStart);
        try { await ui.manualAudio.play(); }
        catch (error) { state.manualSelectionPreview = false; setStatus('description_subtitle_editor.human_preview_failed', { error: error.message || String(error) }); }
    }

    async function assignManualSelection() {
        const data = narration(false);
        const manual = manualMatching(false);
        const item = manualDescription();
        if (!data?.sourcePath || !manual || !item) return;
        const start = Number(manual.markerStart);
        const end = Number(manual.markerEnd);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.05) {
            setStatus('description_subtitle_editor.human_manual_markers_required');
            return;
        }
        state.manualBusy = true;
        renderManualMatcher();
        try {
            const result = await window.api.descriptionSubtitleEditorTrimNarrationCandidate({ sourcePath: data.sourcePath, start, end });
            const eventCandidates = (data.candidates || []).filter(candidate => candidate.eventId === item.id);
            const candidate = {
                id: `manual-candidate-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                eventId: item.id,
                takeNumber: eventCandidates.length + 1,
                sourceStart: start, sourceEnd: end, transcript: item.text || '', score: 1,
                needsReview: false, audioPath: result.audioPath, duration: Number(result.duration),
                recommended: false, manual: true, manualSourcePath: data.sourcePath,
                originalAudioPath: result.audioPath, originalDuration: Number(result.duration),
                trimStart: 0, trimEnd: Number(result.duration)
            };
            data.candidates ||= [];
            data.candidates.push(candidate);
            applyCandidate(item, candidate, false);
            manual.sourcePosition = end;
            manual.markerStart = null;
            manual.markerEnd = null;
            manual.nextMarker = 'start';
            editor().setDirty(true);
            editor().renderEvents();
            render();
            const items = descriptions();
            const currentIndex = items.findIndex(entry => entry.id === item.id);
            if (currentIndex < items.length - 1) selectManualDescription(currentIndex + 1);
            else renderManualMatcher();
            ui.manualAudio.currentTime = end;
            window.dispatchEvent(new CustomEvent('evd-description-events-changed'));
            setStatus('description_subtitle_editor.human_manual_assigned', {
                index: currentIndex + 1, take: candidate.takeNumber
            });
            focusManualTimeline();
        } catch (error) {
            setStatus('description_subtitle_editor.human_manual_assign_failed', { error: error.message || String(error) });
        } finally {
            state.manualBusy = false;
            renderManualMatcher();
        }
    }

    function advanceManualDescription() {
        const items = descriptions();
        const current = manualDescription();
        const index = Math.max(0, items.findIndex(item => item.id === current?.id));
        if (index < items.length - 1) selectManualDescription(index + 1);
        focusManualTimeline();
    }

    function approveManualCandidate() {
        const item = manualDescription();
        const candidate = appliedCandidateForDescription(item);
        if (!item || !candidate?.audioPath) {
            setStatus('description_subtitle_editor.human_manual_no_take');
            return;
        }
        if (!applyCandidate(item, candidate, false)) return;
        editor().setDirty(true);
        editor().renderEvents();
        window.dispatchEvent(new CustomEvent('evd-description-events-changed'));
        const items = descriptions();
        const currentIndex = items.findIndex(entry => entry.id === item.id);
        const orderedIndexes = [
            ...items.slice(currentIndex + 1).map((_, offset) => currentIndex + 1 + offset),
            ...items.slice(0, currentIndex).map((_, index) => index)
        ];
        const nextIndex = orderedIndexes.find(index => {
            const next = items[index];
            return !next.humanNarrationCandidateId && Boolean(appliedCandidateForDescription(next)?.audioPath);
        });
        render();
        if (Number.isInteger(nextIndex)) {
            selectManualDescription(nextIndex, { focusList: true, autoPreview: true });
            announceManualLive(t('description_subtitle_editor.human_manual_candidate_approved', { take: candidate.takeNumber }));
        } else {
            renderManualMatcher({ restoreFocus: true });
            announceManualLive(t('description_subtitle_editor.human_manual_candidate_approved_complete', { take: candidate.takeNumber }));
        }
    }

    function removeManualAssignment() {
        const data = narration(false);
        const item = manualDescription();
        const candidateId = String(item?.humanNarrationCandidateId || '');
        if (!data || !item || !candidateId) {
            setStatus('description_subtitle_editor.human_manual_nothing_to_remove');
            return;
        }
        const candidate = (data.candidates || []).find(entry => entry.id === candidateId);
        if (candidate?.manual) data.candidates = (data.candidates || []).filter(entry => entry.id !== candidateId);
        item.ttsService = editor()?.state.project?.settings?.ttsService || 'system';
        item.ttsAudioPath = '';
        item.ttsDuration = 0;
        item.ttsPlaybackRate = 1;
        item.ttsGeneratedText = '';
        item.ttsGeneratedVoice = '';
        item.ttsGeneratedService = '';
        item.humanNarrationCandidateId = '';
        item.narrationSource = '';
        item.updatedAt = new Date().toISOString();
        stopCandidateOnlyPreview();
        window.EvdDescriptionPhase5?.stopPreview?.();
        editor().setDirty(true);
        editor().renderEvents();
        render();
        window.dispatchEvent(new CustomEvent('evd-description-events-changed'));
        setStatus('description_subtitle_editor.human_manual_removed', { text: item.text || '' });
        if (document.activeElement === ui.manualList) ui.manualList.focus({ preventScroll: true });
        else focusManualTimeline({ announce: false });
    }

    function previewManualDescription(mixed = false, { announceMissing = true, announcePreview = true } = {}) {
        ui.manualAudio.pause();
        state.manualSelectionPreview = false;
        stopCandidateOnlyPreview();
        window.EvdDescriptionPhase5?.stopPreview?.();
        const item = manualDescription();
        const candidate = appliedCandidateForDescription(item);
        if (!candidate?.audioPath) {
            if (announceMissing) setStatus('description_subtitle_editor.human_manual_no_take');
            return;
        }
        state.selectedCandidateId = candidate.id;
        if (mixed) previewMixedCandidate({ announce: announcePreview });
        else previewCandidateOnly();
    }
    function trimBounds() {
        const duration = Number(ui.trimAudio.duration || selectedCandidate()?.originalDuration || selectedCandidate()?.duration || 0);
        const start = Math.max(0, Math.min(Math.max(0, duration - 0.05), Number(ui.trimStart.value) || 0));
        const endValue = Number(ui.trimEnd.value);
        const end = Math.max(start + 0.05, Math.min(duration, Number.isFinite(endValue) ? endValue : duration));
        return { start, end, duration };
    }

    function updateTrimPosition() {
        const bounds = trimBounds();
        if (!ui.trimAudio.paused && ui.trimAudio.currentTime >= bounds.end) {
            ui.trimAudio.pause();
            ui.trimAudio.currentTime = bounds.start;
        }
        ui.trimPosition.textContent = t('description_subtitle_editor.human_trim_position', {
            position: formatTime(ui.trimAudio.currentTime || 0),
            start: formatTime(bounds.start),
            end: formatTime(bounds.end),
            duration: formatTime(Math.max(0, bounds.end - bounds.start))
        });
    }

    function setTrimBoundary(kind, announce = true) {
        const current = Math.max(0, Number(ui.trimAudio.currentTime) || 0);
        if (kind === 'start') {
            const end = Number(ui.trimEnd.value) || Number(ui.trimAudio.duration) || current + 0.05;
            ui.trimStart.value = Math.min(current, Math.max(0, end - 0.05)).toFixed(3);
            if (announce) setStatus('description_subtitle_editor.human_trim_start_set', { time: formatTime(Number(ui.trimStart.value)) });
        } else {
            const start = Number(ui.trimStart.value) || 0;
            ui.trimEnd.value = Math.max(start + 0.05, current).toFixed(3);
            if (announce) setStatus('description_subtitle_editor.human_trim_end_set', { time: formatTime(Number(ui.trimEnd.value)) });
        }
        updateTrimPosition();
    }

    function setNextTrimMarker() {
        const current = Math.max(0, Number(ui.trimAudio.currentTime) || 0);
        if (state.nextTrimMarker === 'start') {
            const duration = Math.max(0.05, Number(ui.trimAudio.duration) || Number(selectedCandidate()?.originalDuration) || 0.05);
            const start = Math.max(0, Math.min(duration - 0.05, current));
            ui.trimStart.value = start.toFixed(3);
            if ((Number(ui.trimEnd.value) || 0) <= start) ui.trimEnd.value = duration.toFixed(3);
            updateTrimPosition();
            state.nextTrimMarker = 'end';
            setStatus('description_subtitle_editor.human_trim_first_marker_set', { time: formatTime(start) });
            return;
        }
        const start = Number(ui.trimStart.value) || 0;
        if (current <= start + 0.049) {
            setStatus('description_subtitle_editor.human_trim_second_marker_invalid');
            return;
        }
        setTrimBoundary('end', false);
        state.nextTrimMarker = 'start';
        setStatus('description_subtitle_editor.human_trim_second_marker_set', { time: formatTime(current) });
    }
    async function toggleTrimPlayback(fromStart = false) {
        const bounds = trimBounds();
        if (!ui.trimAudio.paused && !fromStart) { ui.trimAudio.pause(); return; }
        if (fromStart || ui.trimAudio.currentTime < bounds.start || ui.trimAudio.currentTime >= bounds.end) ui.trimAudio.currentTime = bounds.start;
        try { await ui.trimAudio.play(); }
        catch (error) { setStatus('description_subtitle_editor.human_preview_failed', { error: error.message || String(error) }); }
    }

    function seekTrimAudio(delta) {
        const duration = Number(ui.trimAudio.duration) || 0;
        ui.trimAudio.currentTime = Math.max(0, Math.min(duration, (Number(ui.trimAudio.currentTime) || 0) + delta));
        updateTrimPosition();
    }

    async function openCandidateEditor() {
        const candidate = selectedCandidate();
        if (!candidate?.audioPath) return;
        closeCandidateMenu(false);
        stopCandidateOnlyPreview();
        window.EvdDescriptionPhase5?.stopPreview?.();
        state.editingCandidateId = candidate.id;
        state.nextTrimMarker = 'start';
        const sourcePath = candidate.originalAudioPath || candidate.audioPath;
        candidate.originalAudioPath ||= sourcePath;
        ui.trimAudio.pause();
        ui.trimAudio.src = await window.api.descriptionSubtitleEditorPathUrl(sourcePath);
        ui.trimStart.value = Number(candidate.trimStart || 0).toFixed(3);
        ui.trimEnd.value = Number(candidate.trimEnd || candidate.originalDuration || candidate.duration || 0).toFixed(3);
        ui.trimDialog.showModal();
        const prepare = () => {
            const duration = Number(ui.trimAudio.duration) || Number(candidate.originalDuration) || Number(candidate.duration) || 0;
            candidate.originalDuration ||= duration;
            ui.trimStart.max = duration.toFixed(3);
            ui.trimEnd.max = duration.toFixed(3);
            if (!(Number(ui.trimEnd.value) > 0)) ui.trimEnd.value = duration.toFixed(3);
            ui.trimAudio.currentTime = Math.max(0, Number(ui.trimStart.value) || 0);
            updateTrimPosition();
            ui.trimTimeline.focus({ preventScroll: true });
        };
        if (ui.trimAudio.readyState >= 1) prepare();
        else ui.trimAudio.addEventListener('loadedmetadata', prepare, { once: true });
    }

    function closeCandidateEditor() {
        ui.trimAudio.pause();
        ui.trimAudio.removeAttribute('src');
        state.editingCandidateId = '';
        if (ui.trimDialog.open) ui.trimDialog.close();
        ui.candidateList.focus({ preventScroll: true });
    }

    async function saveCandidateTrim() {
        const candidate = (narration(false)?.candidates || []).find(item => item.id === state.editingCandidateId);
        if (!candidate) return;
        const bounds = trimBounds();
        if (bounds.end - bounds.start < 0.05) { setStatus('description_subtitle_editor.human_trim_invalid'); return; }
        ui.trimSave.disabled = true;
        try {
            const sourcePath = candidate.originalAudioPath || candidate.audioPath;
            const result = await window.api.descriptionSubtitleEditorTrimNarrationCandidate({ sourcePath, start: bounds.start, end: bounds.end });
            candidate.originalAudioPath = sourcePath;
            candidate.originalDuration = Number(result.sourceDuration) || bounds.duration;
            candidate.audioPath = result.audioPath;
            candidate.duration = Number(result.duration);
            candidate.trimStart = Number(result.trimStart);
            candidate.trimEnd = Number(result.trimEnd);
            const item = descriptionForCandidate(candidate);
            if (item?.humanNarrationCandidateId === candidate.id) applyCandidate(item, candidate, false);
            editor().setDirty(true);
            editor().renderEvents();
            window.dispatchEvent(new CustomEvent('evd-description-events-changed'));
            closeCandidateEditor();
            render();
            setStatus('description_subtitle_editor.human_trim_saved', { duration: formatTime(candidate.duration) });
        } catch (error) {
            setStatus('description_subtitle_editor.human_trim_failed', { error: error.message || String(error) });
        } finally { ui.trimSave.disabled = false; }
    }
    function applyCandidate(item, candidate, announce = true) {
        if (!item || !candidate?.audioPath) return false;
        item.ttsService = 'human';
        item.ttsAudioPath = candidate.audioPath;
        item.ttsDuration = Number(candidate.duration) || Math.max(0.05, candidate.sourceEnd - candidate.sourceStart);
        item.ttsPlaybackRate = 1;
        item.ttsGeneratedText = item.text;
        item.ttsGeneratedVoice = t('description_subtitle_editor.human_narration_service');
        item.ttsGeneratedService = 'human';
        item.humanNarrationCandidateId = candidate.id;
        item.narrationSource = 'human';
        item.updatedAt = new Date().toISOString();
        if (announce) setStatus('description_subtitle_editor.human_candidate_applied', { take: candidate.takeNumber });
        return true;
    }

    function useSelectedCandidate() {
        const candidate = selectedCandidate();
        const item = descriptionForCandidate(candidate);
        const queue = allCandidates();
        const currentIndex = queue.findIndex(entry => entry.id === candidate?.id);
        const nextCandidate = queue.slice(currentIndex + 1).find(entry => entry.eventId !== candidate?.eventId) || null;
        if (!applyCandidate(item, candidate)) return;
        editor().setDirty(true);
        editor().renderEvents();
        window.dispatchEvent(new CustomEvent('evd-description-events-changed'));
        render();
        if (nextCandidate) {
            const nextIndex = allCandidates().findIndex(entry => entry.id === nextCandidate.id);
            selectCandidateAt(nextIndex, false);
        }
    }

    function useRecommendedCandidates() {
        let count = 0;
        const data = narration(false);
        descriptions().forEach(item => {
            const candidate = data?.candidates?.find(entry => entry.eventId === item.id && entry.recommended);
            if (applyCandidate(item, candidate, false)) count += 1;
        });
        if (!count) return;
        editor().setDirty(true);
        editor().renderEvents();
        window.dispatchEvent(new CustomEvent('evd-description-events-changed'));
        setStatus('description_subtitle_editor.human_recommendations_applied', { count });
        render();
    }

    async function chooseAndAnalyze() {
        if (!descriptions().length) {
            setStatus('description_subtitle_editor.human_requires_descriptions');
            return;
        }
        state.busy = true;
        render();
        try {
            const chosen = await window.api.descriptionSubtitleEditorChooseNarration();
            if (chosen?.canceled) return;
            state.autoSelectedFirstCandidate = false;
            state.lastProgressStage = ''; state.lastProgressBucket = -1;
            setStatus('description_subtitle_editor.human_analysis_started', { name: chosen.sourceName });
            ui.progress.hidden = false;
            ui.progress.removeAttribute('value');
            const result = await window.api.descriptionSubtitleEditorAnalyzeNarration({
                sourcePath: chosen.sourcePath,
                model: ui.model.value,
                descriptions: descriptions().map(item => ({ id: item.id, text: item.text, start: item.start, end: item.end }))
            });
            editor().state.project.humanNarration = result;
            editor().state.project.settings.humanNarrationModel = ui.model.value;
            editor().setDirty(true);
            state.selectedCandidateId = '';
            setStatus('description_subtitle_editor.human_analysis_completed', {
                candidates: result.candidates.length,
                matched: new Set(result.candidates.map(candidate => candidate.eventId)).size,
                recommended: new Set(result.candidates.filter(candidate => candidate.recommended).map(candidate => candidate.eventId)).size,
                unmatched: result.unmatched.length
            });
        } catch (error) {
            setStatus('description_subtitle_editor.human_analysis_failed', { error: error.message || String(error) });
        } finally {
            state.busy = false;
            ui.progress.hidden = true;
            render();
        }
    }

    function clearAnalysis() {
        const project = editor()?.state.project;
        if (!project) return;
        delete project.humanNarration;
        state.selectedCandidateId = '';
        editor().setDirty(true);
        setStatus('description_subtitle_editor.human_analysis_cleared');
        render();
    }

    function selectCandidateAt(index, play = true) {
        const list = allCandidates();
        if (!list.length) return;
        index = Math.max(0, Math.min(list.length - 1, index));
        const nextCandidateId = list[index].id;
        if (state.selectedCandidateId && state.selectedCandidateId !== nextCandidateId) stopCandidateOnlyPreview();
        state.selectedCandidateId = nextCandidateId;
        const item = descriptionForCandidate(list[index]);
        if (item) {
            editor().state.selectedEventId = item.id;
            editor().state.selectedEventIds = [item.id];
            editor().state.project.workspace.selectedEventId = item.id;
            editor().state.project.workspace.selectedEventIds = [item.id];
            editor().renderEvents();
        }
        ui.candidateList.querySelectorAll('[data-candidate-id]').forEach(option => {
            option.setAttribute('aria-selected', String(option.dataset.candidateId === state.selectedCandidateId));
        });
        ui.candidateList.setAttribute('aria-activedescendant', `human-narration-${state.selectedCandidateId}`);
        ui.candidateList.focus({ preventScroll: true });
        if (play) previewCandidateOnly();
    }

    function moveSelection(direction) {
        const list = allCandidates();
        if (!list.length) return;
        let index = list.findIndex(item => item.id === state.selectedCandidateId);
        if (index < 0) index = 0;
        selectCandidateAt(index + direction, false);
    }

    function candidateMenuItems() {
        return Array.from(ui.actionMenu.querySelectorAll('[role="menuitem"]'));
    }

    function closeCandidateMenu(restoreFocus = true) {
        if (ui.actionMenu.hidden) return;
        ui.actionMenu.hidden = true;
        if (restoreFocus) ui.candidateList.focus({ preventScroll: true });
    }

    function openCandidateMenu(position = null) {
        if (!selectedCandidate()) return;
        const active = document.getElementById(`human-narration-${state.selectedCandidateId}`);
        const rect = active?.getBoundingClientRect() || ui.candidateList.getBoundingClientRect();
        ui.actionMenu.hidden = false;
        const left = Math.max(8, Math.min(Number(position?.x) || rect.left + 24, window.innerWidth - ui.actionMenu.offsetWidth - 8));
        const top = Math.max(8, Math.min(Number(position?.y) || rect.top + Math.min(rect.height, 42), window.innerHeight - ui.actionMenu.offsetHeight - 8));
        ui.actionMenu.style.left = `${left}px`;
        ui.actionMenu.style.top = `${top}px`;
        candidateMenuItems()[0]?.focus();
    }

    function activateCandidateAction(action) {
        closeCandidateMenu(false);
        ui.candidateList.focus({ preventScroll: true });
        if (action === 'preview') previewCandidateOnly();
        else if (action === 'mix') previewMixedCandidate();
        else if (action === 'edit') openCandidateEditor();
        else if (action === 'use') useSelectedCandidate();
    }

    function handleCandidateMenuKeydown(event) {
        const items = candidateMenuItems();
        const index = Math.max(0, items.indexOf(document.activeElement));
        if (event.key === 'Escape' || event.key === 'ArrowLeft') {
            event.preventDefault();
            closeCandidateMenu(true);
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            let next = index;
            if (event.key === 'ArrowDown') next = (index + 1) % items.length;
            if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = items.length - 1;
            items[next]?.focus();
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activateCandidateAction(document.activeElement?.dataset?.humanCandidateAction);
        }
    }
    function bind() {
        ui.analyze.addEventListener('click', chooseAndAnalyze);
        ui.manualOpen.addEventListener('click', openManualMatcher);
        ui.manualChangeSource.addEventListener('click', () => chooseManualSource());
        ui.manualPlay.addEventListener('click', toggleManualPlayback);
        ui.manualPreviousSpeech.addEventListener('click', () => jumpManualSpeech(-1));
        ui.manualNextSpeech.addEventListener('click', () => jumpManualSpeech(1));
        ui.manualMarker.addEventListener('click', setManualMarker);
        ui.manualClearMarkers.addEventListener('click', clearManualMarkers);
        ui.manualPreview.addEventListener('click', previewManualSelection);
        ui.manualAssign.addEventListener('click', assignManualSelection);
        ui.manualNext.addEventListener('click', advanceManualDescription);
        ui.manualRead.addEventListener('click', announceManualDescription);
        ui.manualRemove.addEventListener('click', removeManualAssignment);
        ui.manualApproveCandidate.addEventListener('click', approveManualCandidate);
        ui.manualClose.addEventListener('click', closeManualMatcher);
        ui.manualAudio.addEventListener('timeupdate', updateManualPosition);
        ui.manualSpeed.addEventListener('input', () => updateManualMixSetting('ttsPlaybackRate', ui.manualSpeed.value));
        ui.manualVolume.addEventListener('input', () => updateManualMixSetting('ttsVolume', ui.manualVolume.value));
        ui.manualOriginalVolume.addEventListener('input', () => updateManualMixSetting('originalVolume', ui.manualOriginalVolume.value));
        ui.manualDialog.addEventListener('cancel', event => { event.preventDefault(); closeManualMatcher(); });
        ui.manualDialog.addEventListener('keydown', event => {
            if (handleManualMixShortcut(event)) return;
            const key = String(event.key || '').toLowerCase();
            if (event.altKey && !event.ctrlKey && !event.metaKey && key === 't') {
                event.preventDefault();
                event.stopPropagation();
                focusManualTimeline();
            } else if (event.altKey && !event.ctrlKey && !event.metaKey && key === 'l') {
                event.preventDefault();
                event.stopPropagation();
                ui.manualList.focus({ preventScroll: true });
            }
        }, true);
        ui.manualTimeline.addEventListener('keydown', event => {
            event.stopPropagation();
            const key = String(event.key || '').toLowerCase();
            if (event.altKey && !event.ctrlKey && !event.metaKey && key === 'l') {
                event.preventDefault();
                ui.manualList.focus({ preventScroll: true });
                return;
            }
            if (event.key === ' ' && (event.shiftKey || event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                previewManualSelection();
                return;
            }
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            suppressManualTimelineAccessibleName();
            // These shortcuts are local to the modal audio workspace, so they are intentionally
            // excluded from the global shortcut manager.
            if (key === 'd') { event.preventDefault(); announceManualDescription(); }
            else if (event.key === 'Delete') { event.preventDefault(); removeManualAssignment(); }
            else if (key === 'k' || event.key === ' ') { event.preventDefault(); toggleManualPlayback(); }
            else if (key === 'j') { event.preventDefault(); seekManualAudio(event.shiftKey ? -0.1 : -1); }
            else if (key === 'l') { event.preventDefault(); seekManualAudio(event.shiftKey ? 0.1 : 1); }
            else if (key === 'm') { event.preventDefault(); setManualMarker(); }
            else if (event.key === 'Enter') { event.preventDefault(); assignManualSelection(); }
        });
        ui.manualTimeline.addEventListener('focus', restoreManualTimelineAccessibleName);
        ui.manualTimeline.addEventListener('blur', restoreManualTimelineAccessibleName);
        ui.manualList.addEventListener('click', event => {
            const option = event.target.closest?.('[data-event-id]');
            if (!option) return;
            selectManualDescription(descriptions().findIndex(item => item.id === option.dataset.eventId), {
                focusList: true, extendSelection: event.shiftKey
            });
        });
        ui.manualList.addEventListener('keydown', event => {
            event.stopPropagation();
            const items = descriptions();
            const current = manualDescription();
            const index = Math.max(0, items.findIndex(item => item.id === current?.id));
            const key = String(event.key || '').toLowerCase();
            const primaryModifier = window.api?.platform === 'darwin' ? event.metaKey : event.ctrlKey;
            if (event.altKey && !event.ctrlKey && !event.metaKey && key === 't') {
                event.preventDefault();
                focusManualTimeline();
            } else if (primaryModifier && !event.altKey && !event.shiftKey && key === 'a') {
                // Standard multi-selection remains local to this modal list and is not a shortcut-manager command.
                event.preventDefault();
                const manual = manualMatching();
                manual.selectedEventIds = items.map(item => item.id);
                manual.selectionAnchorId = current?.id || items[0]?.id || '';
                const selectedIds = [...manual.selectedEventIds];
                editor().state.selectedEventIds = selectedIds;
                editor().state.project.workspace.selectedEventIds = selectedIds;
                editor().renderEvents();
                renderManualMatcher({ restoreFocus: true });
                announceManualLive(t('description_subtitle_editor.human_manual_selection_count', { count: selectedIds.length }));
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                selectManualDescription(index + (event.key === 'ArrowDown' ? 1 : -1), {
                    focusList: true, autoPreview: true, extendSelection: event.shiftKey
                });
            } else if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                selectManualDescription(event.key === 'Home' ? 0 : items.length - 1, {
                    focusList: true, autoPreview: true, extendSelection: event.shiftKey
                });
            } else if (event.key === 'PageDown' || event.key === 'PageUp') {
                event.preventDefault();
                selectManualDescription(index + (event.key === 'PageDown' ? 5 : -5), {
                    focusList: true, autoPreview: true, extendSelection: event.shiftKey
                });
            } else if (event.altKey && !event.ctrlKey && !event.metaKey && event.key === 'Enter') {
                event.preventDefault();
                // This command is local to the manual matching list and intentionally excluded from the global shortcut manager.
                approveManualCandidate();
            } else if (event.key === ' ') {
                event.preventDefault();
                previewManualDescription(event.ctrlKey || event.metaKey);
            } else if (event.key === 'Delete') {
                event.preventDefault();
                removeManualAssignment();
            }
        });
        ui.preview.addEventListener('click', previewCandidateOnly);
        ui.previewMix.addEventListener('click', previewMixedCandidate);
        ui.edit.addEventListener('click', openCandidateEditor);
        ui.use.addEventListener('click', useSelectedCandidate);
        ui.useRecommended.addEventListener('click', useRecommendedCandidates);
        ui.clear.addEventListener('click', clearAnalysis);
        ui.trimAudio.addEventListener('timeupdate', updateTrimPosition);
        ui.trimPlay.addEventListener('click', () => toggleTrimPlayback(false));
        ui.trimPreview.addEventListener('click', () => toggleTrimPlayback(true));
        ui.trimSetMarker.addEventListener('click', setNextTrimMarker);
        ui.trimSave.addEventListener('click', saveCandidateTrim);
        ui.trimCancel.addEventListener('click', closeCandidateEditor);
        ui.trimStart.addEventListener('input', updateTrimPosition);
        ui.trimEnd.addEventListener('input', updateTrimPosition);
        ui.trimTimeline.addEventListener('keydown', event => {
            const key = String(event.key || '').toLowerCase();
            if (event.key === ' ' && (event.shiftKey || event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                toggleTrimPlayback(true);
                return;
            }
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            if (key === 'k' || event.key === ' ') { event.preventDefault(); toggleTrimPlayback(false); }
            else if (key === 'j') { event.preventDefault(); seekTrimAudio(event.shiftKey ? -0.1 : -1); }
            else if (key === 'l') { event.preventDefault(); seekTrimAudio(event.shiftKey ? 0.1 : 1); }
            else if (key === 'm') { event.preventDefault(); setNextTrimMarker(); }
            else if (event.key === 'Enter') { event.preventDefault(); saveCandidateTrim(); }
        });
        ui.trimDialog.addEventListener('cancel', event => { event.preventDefault(); closeCandidateEditor(); });
        ui.candidateList.addEventListener('click', event => {
            const option = event.target.closest?.('[data-candidate-id]');
            if (!option) return;
            const index = allCandidates().findIndex(item => item.id === option.dataset.candidateId);
            selectCandidateAt(index, false);
        });
        ui.candidateList.addEventListener('keydown', event => {
            if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === 'Enter') {
                event.preventDefault();
                openCandidateEditor();
            } else if (event.altKey && !event.ctrlKey && !event.metaKey && event.key === 'Enter') {
                event.preventDefault();
                // Contextual list command; intentionally not added to the global shortcut manager.
                useSelectedCandidate();
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                openCandidateMenu();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                moveSelection(event.key === 'ArrowDown' ? 1 : -1);
            } else if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                const list = allCandidates();
                selectCandidateAt(event.key === 'Home' ? 0 : list.length - 1, false);
            } else if (event.key === 'PageDown' || event.key === 'PageUp') {
                event.preventDefault();
                moveSelection(event.key === 'PageDown' ? 5 : -5);
            } else if (event.key === ' ') {
                event.preventDefault();
                if (event.ctrlKey || event.metaKey) previewMixedCandidate();
                else previewCandidateOnly();
            } else if (event.key === 'Enter') {
                event.preventDefault();
                useSelectedCandidate();
            }
        });
        ui.candidateList.addEventListener('contextmenu', event => {
            const option = event.target.closest?.('[data-candidate-id]');
            if (!option) return;
            event.preventDefault();
            const index = allCandidates().findIndex(item => item.id === option.dataset.candidateId);
            selectCandidateAt(index, false);
            openCandidateMenu({ x: event.clientX, y: event.clientY });
        });
        ui.actionMenu.addEventListener('keydown', handleCandidateMenuKeydown);
        ui.actionMenu.addEventListener('click', event => {
            const item = event.target.closest?.('[data-human-candidate-action]');
            if (item) activateCandidateAction(item.dataset.humanCandidateAction);
        });
        document.addEventListener('pointerdown', event => {
            if (!ui.actionMenu.hidden && !ui.actionMenu.contains(event.target)) closeCandidateMenu(false);
        });
        window.addEventListener('evd-description-selection-changed', render);
        window.addEventListener('evd-description-events-changed', render);
        window.addEventListener('evd-description-source-loaded', render);
        window.api.onDescriptionSubtitleHumanNarrationProgress?.(payload => {
            if (!state.busy) return;
            if (payload?.partial) {
                editor().state.project.humanNarration = payload.partial;
                const firstCandidate = payload.partial.candidates?.[0];
                if (!state.autoSelectedFirstCandidate && firstCandidate?.eventId) {
                    state.autoSelectedFirstCandidate = true;
                    editor().state.selectedEventId = firstCandidate.eventId;
                    editor().state.selectedEventIds = [firstCandidate.eventId];
                    editor().state.project.workspace.selectedEventId = firstCandidate.eventId;
                    editor().state.project.workspace.selectedEventIds = [firstCandidate.eventId];
                    editor().renderEvents();
                    window.dispatchEvent(new CustomEvent('evd-description-selection-changed', {
                        detail: { itemId: firstCandidate.eventId }
                    }));
                }
                render();
            }
            const percent = Number(payload?.percent);
            if (Number.isFinite(percent) && percent > 0) ui.progress.value = Math.max(0, Math.min(100, percent));
            else ui.progress.removeAttribute('value');
            const stage = String(payload?.stage || 'transcribing');
            const bucket = Number.isFinite(percent) ? Math.floor(percent / 25) : -1;
            if (stage !== state.lastProgressStage || (bucket >= 0 && bucket !== state.lastProgressBucket)) {
                state.lastProgressStage = stage; state.lastProgressBucket = bucket;
                setStatus('description_subtitle_editor.human_analysis_progress', {
                    stage: t(`description_subtitle_editor.human_stage_${stage}`),
                    percent: Number.isFinite(percent) ? Math.round(percent) : 0
                });
            }
        });
    }

    async function init() {
        await window.i18nHelper?.init?.();
        Object.assign(ui, {
            model: document.getElementById('human-narration-model'),
            analyze: document.getElementById('analyze-human-narration'),
            source: document.getElementById('human-narration-source'),
            progress: document.getElementById('human-narration-progress'),
            candidateList: document.getElementById('human-narration-candidates'),
            unmatched: document.getElementById('human-narration-unmatched'),
            preview: document.getElementById('preview-human-candidate'),
            previewMix: document.getElementById('preview-human-candidate-mix'),
            edit: document.getElementById('edit-human-candidate'),
            actionMenu: document.getElementById('human-candidate-action-menu'),
            trimDialog: document.getElementById('human-candidate-editor-dialog'),
            trimAudio: document.getElementById('human-candidate-editor-audio'),
            trimTimeline: document.getElementById('human-candidate-editor-timeline'),
            trimPosition: document.getElementById('human-candidate-editor-position'),
            trimStart: document.getElementById('human-candidate-trim-start'),
            trimEnd: document.getElementById('human-candidate-trim-end'),
            trimPlay: document.getElementById('human-candidate-editor-play'),
            trimSetMarker: document.getElementById('human-candidate-set-marker'),
            trimPreview: document.getElementById('human-candidate-preview-trim'),
            trimSave: document.getElementById('human-candidate-save-trim'),
            trimCancel: document.getElementById('human-candidate-cancel-trim'),
            use: document.getElementById('use-human-candidate'),
            useRecommended: document.getElementById('use-recommended-human-candidates'),
            clear: document.getElementById('clear-human-narration'),
            manualOpen: document.getElementById('open-manual-human-matcher'),
            manualDialog: document.getElementById('human-manual-match-dialog'),
            manualSource: document.getElementById('human-manual-source'),
            manualChangeSource: document.getElementById('human-manual-change-source'),
            manualAudio: document.getElementById('human-manual-audio'),
            manualCurrent: document.getElementById('human-manual-current-description'),
            manualAnnouncer: document.getElementById('human-manual-announcer'),
            manualTimeline: document.getElementById('human-manual-timeline'),
            manualPosition: document.getElementById('human-manual-position'),
            manualMarkers: document.getElementById('human-manual-markers'),
            manualPlay: document.getElementById('human-manual-play'),
            manualPreviousSpeech: document.getElementById('human-manual-previous-speech'),
            manualNextSpeech: document.getElementById('human-manual-next-speech'),
            manualMarker: document.getElementById('human-manual-marker'),
            manualClearMarkers: document.getElementById('human-manual-clear-markers'),
            manualPreview: document.getElementById('human-manual-preview'),
            manualAssign: document.getElementById('human-manual-assign'),
            manualNext: document.getElementById('human-manual-next'),
            manualRead: document.getElementById('human-manual-read'),
            manualRemove: document.getElementById('human-manual-remove'),
            manualApproveCandidate: document.getElementById('human-manual-approve-candidate'),
            manualList: document.getElementById('human-manual-description-list'),
            manualClose: document.getElementById('human-manual-close'),
            manualSpeed: document.getElementById('human-manual-speed'),
            manualSpeedValue: document.getElementById('human-manual-speed-value'),
            manualVolume: document.getElementById('human-manual-volume'),
            manualVolumeValue: document.getElementById('human-manual-volume-value'),
            manualOriginalVolume: document.getElementById('human-manual-original-volume'),
            manualOriginalVolumeValue: document.getElementById('human-manual-original-volume-value')
        });
        const remembered = editor()?.state.project?.settings?.humanNarrationModel;
        if (remembered && [...ui.model.options].some(option => option.value === remembered)) ui.model.value = remembered;
        bind();
        render();
    }

    document.addEventListener('DOMContentLoaded', init);
})();















