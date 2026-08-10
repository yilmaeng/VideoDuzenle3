(() => {
    const authoringState = {
        editingEventId: '',
        pendingDeleteIds: [],
        selectionAnchorId: ''
    };
    const el = {};

    function editor() {
        return window.EvdDescriptionEditor;
    }

    function timeline() {
        return window.EvdDescriptionTimeline;
    }

    function t(key, params = {}) {
        const value = window.i18nHelper?.t?.(key, params);
        return value && !value.startsWith('[') ? value : key;
    }

    function events() {
        if (!editor()?.state.project) return [];
        if (!Array.isArray(editor().state.project.events)) editor().state.project.events = [];
        return editor().state.project.events;
    }

    function wordCount(text) {
        const normalized = String(text || '').trim();
        return normalized ? normalized.split(/\s+/u).length : 0;
    }

    function typeLabel(type) {
        return t(`description_subtitle_editor.event_type_${type || 'description'}`);
    }

    function statusLabel(status) {
        return t(`description_subtitle_editor.event_status_${status || 'draft'}`);
    }

    function formatEventItem(item, index) {
        return t('description_subtitle_editor.event_item_detailed', {
            index: index + 1,
            type: typeLabel(item.type),
            start: editor().formatTime(item.start),
            end: editor().formatTime(item.end),
            words: wordCount(item.text),
            status: statusLabel(item.status),
            text: item.text || t('description_subtitle_editor.event_without_text')
        });
    }

    function visibleEvents() {
        return editor()?.getVisibleEvents?.() || events();
    }

    function selectedEventIds() {
        const state = editor()?.state;
        if (!state) return [];
        if (!Array.isArray(state.selectedEventIds)) {
            state.selectedEventIds = state.selectedEventId ? [state.selectedEventId] : [];
        }
        return state.selectedEventIds;
    }

    function selectedEvent() {
        return events().find(item => item.id === editor()?.state.selectedEventId) || null;
    }

    function selectedEvents() {
        const ids = new Set(selectedEventIds());
        return events().filter(item => ids.has(item.id));
    }

    function applySelection(ids, primaryId) {
        const validIds = [...new Set(ids)].filter(id => events().some(item => item.id === id));
        const primary = events().some(item => item.id === primaryId)
            ? primaryId
            : (validIds[validIds.length - 1] || '');
        editor().state.selectedEventId = primary;
        editor().state.selectedEventIds = validIds;
        editor().state.project.workspace.selectedEventId = primary;
        editor().state.project.workspace.selectedEventIds = [...validIds];
        editor().renderEvents();
        timeline()?.refresh?.();
    }

    function updateControls() {
        if (!el.add) return;
        const hasSource = Boolean(editor()?.state.sourceAvailable);
        const hasPair = Boolean(timeline()?.getActiveMarkerPair?.());
        const hasSelected = selectedEvents().length > 0;
        el.add.disabled = !hasSource || !hasPair;
        el.addReviewNote.disabled = !hasSource || !hasPair;
        el.edit.disabled = !hasSelected;
        el.preview.disabled = !hasSelected;
        el.delete.disabled = !hasSelected;
    }

    function parseTimecode(value) {
        const parts = String(value || '').trim().replace(',', '.').split(':').map(Number);
        if (!parts.length || parts.length > 3 || parts.some(part => !Number.isFinite(part) || part < 0)) return null;
        if (parts.length === 1) return parts[0];
        if (parts.length === 2) return (parts[0] * 60) + parts[1];
        return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    }

    function updateMetrics() {
        const start = parseTimecode(el.start.value);
        const end = parseTimecode(el.end.value);
        const words = wordCount(el.text.value);
        if (start === null || end === null || end <= start) {
            el.metrics.textContent = t('description_subtitle_editor.event_metrics_invalid');
            return;
        }
        const available = end - start;
        const configuredWpm = Math.max(60, Number(editor().state.project?.settings?.readingSpeedWpm) || 160);
        const estimated = words ? (words / configuredWpm) * 60 : 0;
        if (!words) {
            el.metrics.textContent = t('description_subtitle_editor.event_metrics_empty', {
                duration: available.toFixed(1)
            });
            return;
        }
        if (estimated <= available) {
            el.metrics.textContent = t('description_subtitle_editor.event_metrics_fits', {
                words,
                duration: available.toFixed(1),
                reading: estimated.toFixed(1),
                wpm: configuredWpm
            });
            return;
        }
        const requiredWpm = Math.ceil((words / available) * 60);
        el.metrics.textContent = t(requiredWpm <= 240
            ? 'description_subtitle_editor.event_metrics_speed_needed'
            : 'description_subtitle_editor.event_metrics_too_long', {
            words,
            duration: available.toFixed(1),
            reading: estimated.toFixed(1),
            wpm: requiredWpm
        });
    }

    function fillForm(item, isNew = false) {
        authoringState.editingEventId = item?.id || '';
        el.dialogTitle.textContent = t(isNew && item?.type === 'note'
            ? 'description_subtitle_editor.standalone_review_note_title'
            : (isNew ? 'description_subtitle_editor.new_event_title' : 'description_subtitle_editor.edit_event_title'));
        el.type.value = item?.type || 'description';
        el.statusSelect.value = item?.status || 'draft';
        el.start.value = editor().formatTime(item?.start || 0);
        el.end.value = editor().formatTime(item?.end || 0);
        el.text.value = item?.text || '';
        el.speaker.value = item?.speaker || '';
        el.notes.value = item?.narrationNotes || '';
        el.tone.value = item?.narrationTone || '';
        el.tempo.value = item?.narrationTempo || '';
        const defaults = editor().state.project?.settings || {};
        el.ttsVoice.value = item?.voice ?? defaults.defaultVoice ?? '';
        el.ttsSpeed.value = String(Math.round(Number(item?.ttsSpeed ?? defaults.ttsSpeed ?? 1) * 100));
        el.ttsVolume.value = String(Math.round(Number(item?.ttsVolume ?? defaults.ttsVolume ?? 100)));
        el.originalVolume.value = String(Math.round(Number(item?.originalVolume ?? defaults.originalVolume ?? 0.9) * 100));
        window.dispatchEvent(new CustomEvent('evd-description-tts-form-updated', { detail: { item } }));
        el.deleteInDialog.hidden = !item;
        updateMetrics();
    }

    function openCreateDialog(type = 'description') {
        const pair = timeline()?.getActiveMarkerPair?.();
        if (!pair) {
            editor().setStatus('description_subtitle_editor.marker_pair_required');
            return;
        }
        const eventType = ['description', 'subtitle', 'note'].includes(type) ? type : 'description';
        fillForm({ start: pair.start, end: pair.end, type: eventType, status: 'draft' }, true);
        authoringState.editingEventId = '';
        el.deleteInDialog.hidden = true;
        if (!el.dialog.open) el.dialog.showModal();
        requestAnimationFrame(() => el.text.focus());
    }

    function openEditDialog(item = selectedEvent()) {
        if (!item) {
            editor().setStatus('description_subtitle_editor.select_event_first');
            return;
        }
        fillForm(item);
        if (!el.dialog.open) el.dialog.showModal();
        requestAnimationFrame(() => el.text.focus());
    }

    function focusSelectedEvent() {
        const list = el.list;
        list.focus();
        const active = document.getElementById('description-event-' + editor().state.selectedEventId);
        active?.scrollIntoView?.({ block: 'nearest' });
    }

    function closeEventDialog() {
        if (el.dialog.open) el.dialog.close();
        focusSelectedEvent();
    }

    function focusNavigationTarget(target) {
        closeEventActionMenu(false);
        if (target === 'playback') {
            timeline()?.focusPlaybackSurface?.();
            return;
        }
        focusSelectedEvent();
    }

    function saveEvent(event, options = {}) {
        event.preventDefault();
        const start = parseTimecode(el.start.value);
        const end = parseTimecode(el.end.value);
        const text = el.text.value.trim();
        const sourceDuration = Math.max(0, Number(editor().state.project?.source?.duration) || 0);
        if (start === null || end === null || end <= start || (sourceDuration && end > sourceDuration + 0.01)) {
            editor().setStatus('description_subtitle_editor.invalid_event_range');
            el.start.focus();
            return;
        }
        if (!text) {
            editor().setStatus('description_subtitle_editor.event_text_required');
            el.text.focus();
            return;
        }

        const now = new Date().toISOString();
        const previous = events().find(item => item.id === authoringState.editingEventId);
        const item = {
            id: previous?.id || `event-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            type: el.type.value,
            start,
            end,
            text,
            speaker: el.speaker.value.trim(),
            narrationNotes: el.notes.value.trim(),
            narrationTone: el.tone.value.trim(),
            narrationTempo: el.tempo.value.trim(),
            voice: el.ttsVoice.value,
            ttsService: previous?.ttsService || editor().state.project?.settings?.ttsService || 'system',
            ttsSpeed: Number(el.ttsSpeed.value) / 100,
            ttsVolume: Number(el.ttsVolume.value),
            originalVolume: Number(el.originalVolume.value) / 100,
            ttsAudioPath: previous?.ttsAudioPath || '',
            ttsDuration: Number(previous?.ttsDuration) || 0,
            ttsPlaybackRate: Number(previous?.ttsPlaybackRate) || 1,
            ttsGeneratedText: previous?.ttsGeneratedText || '',
            ttsGeneratedVoice: previous?.ttsGeneratedVoice || '',
            ttsGeneratedService: previous?.ttsGeneratedService || '',
            narrationSource: previous?.narrationSource || '',
            humanNarrationCandidateId: previous?.humanNarrationCandidateId || '',
            contentStudioCueId: previous?.contentStudioCueId || '',
            contentStudioConfidence: Number(previous?.contentStudioConfidence) || 0,
            status: el.statusSelect.value,
            source: previous?.source || 'manual',
            createdAt: previous?.createdAt || now,
            updatedAt: now
        };
        const synthesisSettingsChanged = Boolean(previous) && (
            previous.text !== item.text
            || previous.voice !== item.voice
            || previous.ttsService !== item.ttsService
            || Number(previous.ttsSpeed || 1) !== item.ttsSpeed
        );
        const shouldResynthesize = Boolean(
            options.resynthesizeExisting
            && previous?.ttsAudioPath
            && previous.ttsService !== 'human'
            && previous.ttsGeneratedService !== 'human'
            && item.type === 'description'
            && synthesisSettingsChanged
        );
        if (previous && synthesisSettingsChanged) {
            item.ttsAudioPath = ''; item.ttsDuration = 0; item.ttsPlaybackRate = 1; item.ttsGeneratedText = ''; item.humanNarrationCandidateId = ''; item.narrationSource = '';
        }
        if (previous) Object.assign(previous, item);
        else events().push(item);
        events().sort((left, right) => left.start - right.start || left.end - right.end);
        editor().state.selectedEventId = item.id;
        editor().state.selectedEventIds = [item.id];
        editor().state.project.workspace.selectedEventId = item.id;
        editor().state.project.workspace.selectedEventIds = [item.id];
        authoringState.selectionAnchorId = item.id;
        editor().setDirty(true);
        editor().renderEvents();
        window.dispatchEvent(new CustomEvent('evd-description-events-changed'));
        editor().setStatus(previous
            ? 'description_subtitle_editor.event_updated'
            : 'description_subtitle_editor.event_added', {
            type: typeLabel(item.type),
            start: editor().formatTime(item.start),
            end: editor().formatTime(item.end)
        });
        el.dialog.close();
        requestAnimationFrame(() => timeline()?.focusPlaybackSurface?.());
        if (shouldResynthesize) {
            // Ctrl+Enter is an explicit save-and-refresh action for an existing synthesized event.
            void window.EvdDescriptionPhase5?.synthesizeItems?.([item]);
        }
    }

    function previewEvent(item = null, announce = true) {
        const selection = item ? [item] : selectedEvents();
        if (!selection.length) {
            editor().setStatus('description_subtitle_editor.select_event_first');
            return;
        }
        const start = Math.min(...selection.map(entry => entry.start));
        const end = Math.max(...selection.map(entry => entry.end));
        const request = new CustomEvent('evd-description-preview-request', { cancelable: true, detail: { selection, announce } });
        if (!window.dispatchEvent(request)) return;
        timeline()?.previewRange?.(start, end, announce ? {
            statusKey: selection.length > 1
                ? 'description_subtitle_editor.events_previewing'
                : 'description_subtitle_editor.event_previewing',
            finishKey: 'description_subtitle_editor.event_preview_finished'
        } : {});
    }

    function selectEvent(item, preview = false, options = {}) {
        if (!item) return;
        const list = events();
        const currentIds = selectedEventIds();
        if (options.extend) {
            const anchorId = authoringState.selectionAnchorId || editor().state.selectedEventId || item.id;
            const anchorIndex = Math.max(0, list.findIndex(entry => entry.id === anchorId));
            const itemIndex = Math.max(0, list.findIndex(entry => entry.id === item.id));
            const from = Math.min(anchorIndex, itemIndex);
            const to = Math.max(anchorIndex, itemIndex);
            applySelection(list.slice(from, to + 1).map(entry => entry.id), item.id);
            editor().setStatus('description_subtitle_editor.events_selected', {
                count: selectedEvents().length
            });
        } else if (options.toggle) {
            const nextIds = currentIds.includes(item.id)
                ? currentIds.filter(id => id !== item.id)
                : [...currentIds, item.id];
            applySelection(nextIds.length ? nextIds : [item.id], item.id);
            authoringState.selectionAnchorId = item.id;
            editor().setStatus('description_subtitle_editor.events_selected', {
                count: selectedEvents().length
            });
        } else {
            applySelection([item.id], item.id);
            authoringState.selectionAnchorId = item.id;
        }
        window.dispatchEvent(new CustomEvent('evd-description-selection-changed', { detail: { itemId: item.id } }));
        if (preview) previewEvent(item, false);
    }

    function selectAllEvents() {
        const list = visibleEvents();
        if (!list.length) return;
        applySelection(list.map(item => item.id), editor().state.selectedEventId || list[0].id);
        authoringState.selectionAnchorId = list[0].id;
        editor().setStatus('description_subtitle_editor.events_selected', { count: list.length });
    }

    function requestDelete(item = null) {
        const selection = item ? [item] : selectedEvents();
        if (!selection.length) {
            editor().setStatus('description_subtitle_editor.select_event_first');
            return;
        }
        authoringState.pendingDeleteIds = selection.map(entry => entry.id);
        el.deleteMessage.textContent = selection.length > 1
            ? t('description_subtitle_editor.delete_events_confirm', { count: selection.length })
            : t('description_subtitle_editor.delete_event_confirm', {
                type: typeLabel(selection[0].type),
                start: editor().formatTime(selection[0].start),
                end: editor().formatTime(selection[0].end),
                text: selection[0].text.slice(0, 120)
            });
        if (!el.deleteDialog.open) el.deleteDialog.showModal();
        requestAnimationFrame(() => el.deleteMessage.focus());
    }

    function deletePendingEvent() {
        const ids = new Set(authoringState.pendingDeleteIds);
        if (!ids.size) return;
        const firstIndex = events().findIndex(item => ids.has(item.id));
        const deletedCount = ids.size;
        editor().state.project.events = events().filter(item => !ids.has(item.id));
        editor().state.project.reviewNotes = (editor().state.project.reviewNotes || []).filter(note => !ids.has(note.eventId));
        const remaining = editor().state.project.events;
        const next = remaining[Math.min(Math.max(0, firstIndex), remaining.length - 1)] || null;
        applySelection(next ? [next.id] : [], next?.id || '');
        authoringState.pendingDeleteIds = [];
        editor().setDirty(true);
        window.dispatchEvent(new CustomEvent('evd-description-events-changed'));
        editor().setStatus(deletedCount > 1
            ? 'description_subtitle_editor.events_deleted'
            : 'description_subtitle_editor.event_deleted', { count: deletedCount });
        focusSelectedEvent();
    }

    function shiftSelectedEvents(requestedDelta) {
        const selection = selectedEvents();
        if (!selection.length) {
            editor().setStatus('description_subtitle_editor.select_event_first');
            return;
        }
        const minimumStart = Math.min(...selection.map(item => item.start));
        const maximumEnd = Math.max(...selection.map(item => item.end));
        const sourceDuration = Math.max(0, Number(editor().state.project?.source?.duration) || 0);
        const minimumDelta = -minimumStart;
        const maximumDelta = sourceDuration ? sourceDuration - maximumEnd : requestedDelta;
        const actualDelta = Math.max(minimumDelta, Math.min(Number(requestedDelta) || 0, maximumDelta));
        if (Math.abs(actualDelta) < 0.0005) {
            editor().setStatus('description_subtitle_editor.event_shift_boundary');
            return;
        }
        const ids = selectedEventIds();
        const primaryId = editor().state.selectedEventId;
        selection.forEach(item => {
            item.start = Math.max(0, Math.round((item.start + actualDelta) * 1000) / 1000);
            item.end = Math.max(item.start, Math.round((item.end + actualDelta) * 1000) / 1000);
            item.updatedAt = new Date().toISOString();
        });
        events().sort((left, right) => left.start - right.start || left.end - right.end);
        applySelection(ids, primaryId);
        editor().setDirty(true);
        window.dispatchEvent(new CustomEvent('evd-description-events-changed'));
        editor().setStatus('description_subtitle_editor.events_shifted', {
            count: selection.length,
            amount: Math.round(Math.abs(actualDelta) * 1000),
            direction: t(actualDelta < 0
                ? 'description_subtitle_editor.shift_direction_earlier'
                : 'description_subtitle_editor.shift_direction_later')
        });
        previewEvent(null, false);
    }

    function eventActionMenuItems() {
        return Array.from(el.actionMenu.querySelectorAll('[role="menuitem"]'));
    }

    function closeEventActionMenu(restoreFocus = true) {
        if (el.actionMenu.hidden) return;
        el.actionMenu.hidden = true;
        if (restoreFocus) focusSelectedEvent();
    }

    function openEventActionMenu(position = null) {
        if (!selectedEvent()) return;
        const activeElement = document.getElementById('description-event-' + editor().state.selectedEventId);
        const rect = activeElement?.getBoundingClientRect() || el.list.getBoundingClientRect();
        el.actionMenu.hidden = false;
        const requestedLeft = Number(position?.x) || rect.left + 24;
        const requestedTop = Number(position?.y) || rect.top + Math.min(rect.height, 42);
        const left = Math.max(8, Math.min(requestedLeft, window.innerWidth - el.actionMenu.offsetWidth - 8));
        const top = Math.max(8, Math.min(requestedTop, window.innerHeight - el.actionMenu.offsetHeight - 8));
        el.actionMenu.style.left = `${left}px`;
        el.actionMenu.style.top = `${top}px`;
        eventActionMenuItems()[0]?.focus();
    }

    function activateEventMenuAction(action) {
        closeEventActionMenu(false);
        if (action === 'edit') openEditDialog();
        else if (action === 'preview') {
            focusSelectedEvent();
            previewEvent();
        } else if (action === 'shift-earlier') {
            focusSelectedEvent();
            shiftSelectedEvents(-0.01);
        } else if (action === 'shift-later') {
            focusSelectedEvent();
            shiftSelectedEvents(0.01);
        } else if (action === 'delete') requestDelete();
        else window.dispatchEvent(new CustomEvent('evd-description-event-action', { detail: { action } }));
    }

    function handleEventActionMenuKeydown(event) {
        const items = eventActionMenuItems();
        const index = Math.max(0, items.indexOf(document.activeElement));
        if (event.key === 'Escape' || event.key === 'ArrowLeft') {
            event.preventDefault();
            closeEventActionMenu(true);
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            let next = index;
            if (event.key === 'ArrowDown') next = (index + 1) % items.length;
            if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = items.length - 1;
            items[next]?.focus();
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activateEventMenuAction(document.activeElement?.dataset?.eventAction);
        }
    }
    function handleEventListKeydown(event) {
        const list = visibleEvents();
        if (!list.length) return false;
        const modifier = window.api.platform === 'darwin' ? event.metaKey : event.ctrlKey;
        if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            selectAllEvents();
            return true;
        }
        if (modifier && !event.altKey && !event.shiftKey && event.key === ' ') {
            event.preventDefault();
            const current = selectedEvent() || list[0];
            selectEvent(current, false, { toggle: true });
            return true;
        }
        const timingActions = [
            ['moveDescriptionEarlierLarge', -0.1],
            ['moveDescriptionLaterLarge', 0.1],
            ['moveDescriptionEarlierSecond', -1],
            ['moveDescriptionLaterSecond', 1],
            ['moveDescriptionEarlier', -0.01],
            ['moveDescriptionLater', 0.01],
            ['moveDescriptionEarlierFine', -0.001],
            ['moveDescriptionLaterFine', 0.001]
        ];
        const timingMatch = timingActions.find(([action]) => timeline()?.matchesShortcut?.(action, event));
        if (timingMatch) {
            event.preventDefault();
            shiftSelectedEvents(timingMatch[1]);
            return true;
        }
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            openEventActionMenu();
            return true;
        }
        const navigationKeys = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'];
        if (navigationKeys.includes(event.key)) {
            event.preventDefault();
            let index = list.findIndex(item => item.id === editor().state.selectedEventId);
            if (index < 0) index = 0;
            if (event.key === 'ArrowDown') index = Math.min(list.length - 1, index + 1);
            if (event.key === 'ArrowUp') index = Math.max(0, index - 1);
            if (event.key === 'PageDown') index = Math.min(list.length - 1, index + 10);
            if (event.key === 'PageUp') index = Math.max(0, index - 10);
            if (event.key === 'Home') index = 0;
            if (event.key === 'End') index = list.length - 1;
            selectEvent(list[index], true, { extend: event.shiftKey });
            return true;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            openEditDialog();
            return true;
        }
        if (event.key === ' ' || event.key.toLowerCase() === 'p') {
            event.preventDefault();
            previewEvent();
            return true;
        }
        if (event.key === 'Delete') {
            event.preventDefault();
            requestDelete();
            return true;
        }
        return false;
    }

    function bind() {
        el.add.addEventListener('click', () => openCreateDialog());
        el.addReviewNote.addEventListener('click', () => openCreateDialog('note'));
        el.edit.addEventListener('click', () => openEditDialog());
        el.preview.addEventListener('click', () => previewEvent());
        el.delete.addEventListener('click', () => requestDelete());
        el.form.addEventListener('submit', saveEvent);
        el.cancel.addEventListener('click', closeEventDialog);
        el.deleteInDialog.addEventListener('click', () => {
            const item = events().find(entry => entry.id === authoringState.editingEventId);
            el.dialog.close();
            requestAnimationFrame(() => requestDelete(item));
        });
        [el.start, el.end, el.text].forEach(control => control.addEventListener('input', updateMetrics));
        [el.ttsVoice, el.ttsSpeed, el.ttsVolume, el.originalVolume].forEach(control => control.addEventListener('input', () => window.dispatchEvent(new CustomEvent('evd-description-tts-form-updated'))));
        el.form.addEventListener('keydown', event => {
            const modifier = window.api.platform === 'darwin' ? event.metaKey : event.ctrlKey;
            if (modifier && event.key === 'Enter') saveEvent(event, { resynthesizeExisting: true });
        });
        el.dialog.addEventListener('cancel', event => {
            event.preventDefault();
            closeEventDialog();
        });
        el.deleteDialog.addEventListener('close', () => {
            if (el.deleteDialog.returnValue === 'confirm') deletePendingEvent();
            else {
                authoringState.pendingDeleteIds = [];
                focusSelectedEvent();
            }
        });
        el.list.addEventListener('click', event => {
            const itemElement = event.target.closest?.('[data-event-id]');
            if (!itemElement) return;
            const item = events().find(entry => entry.id === itemElement.dataset.eventId);
            selectEvent(item, false, {
                extend: event.shiftKey,
                toggle: event.ctrlKey || event.metaKey
            });
        });
        el.list.addEventListener('dblclick', event => {
            const itemElement = event.target.closest?.('[data-event-id]');
            const item = events().find(entry => entry.id === itemElement?.dataset.eventId);
            if (item) openEditDialog(item);
        });
        el.list.addEventListener('contextmenu', event => {
            const itemElement = event.target.closest?.('[data-event-id]');
            const item = events().find(entry => entry.id === itemElement?.dataset.eventId);
            if (!item) return;
            event.preventDefault();
            if (!selectedEventIds().includes(item.id)) selectEvent(item, false);
            openEventActionMenu({ x: event.clientX, y: event.clientY });
        });
        el.actionMenu.addEventListener('keydown', handleEventActionMenuKeydown);
        el.actionMenu.addEventListener('click', event => {
            const item = event.target.closest?.('[data-event-action]');
            if (item) activateEventMenuAction(item.dataset.eventAction);
        });
        document.addEventListener('pointerdown', event => {
            if (!el.actionMenu.hidden && !el.actionMenu.contains(event.target)) closeEventActionMenu(false);
        });
        el.list.addEventListener('focus', () => {
            if (!selectedEvent() && events().length) selectEvent(events()[0], false);
        });
        window.addEventListener('evd-description-create-event-requested', event => {
            openCreateDialog(event.detail?.type || 'description');
        });
        window.addEventListener('evd-description-focus-requested', event => {
            focusNavigationTarget(event.detail?.target || 'list');
        });
        window.addEventListener('evd-description-markers-changed', updateControls);
        window.addEventListener('evd-description-source-loaded', updateControls);
    }

    async function init() {
        await window.i18nHelper?.init?.();
        Object.assign(el, {
            add: document.getElementById('add-event-from-markers'),
            addReviewNote: document.getElementById('add-review-note-from-markers'),
            edit: document.getElementById('edit-selected-event'),
            preview: document.getElementById('preview-selected-event'),
            delete: document.getElementById('delete-selected-event'),
            list: document.getElementById('event-list'),
            listHelp: document.getElementById('event-list-help'),
            actionMenu: document.getElementById('event-action-menu'),
            dialog: document.getElementById('event-dialog'),
            dialogTitle: document.getElementById('event-dialog-title'),
            dialogHelp: document.getElementById('event-dialog-help'),
            form: document.getElementById('event-form'),
            type: document.getElementById('event-type'),
            statusSelect: document.getElementById('event-status'),
            start: document.getElementById('event-start'),
            end: document.getElementById('event-end'),
            text: document.getElementById('event-text'),
            speaker: document.getElementById('event-speaker'),
            metrics: document.getElementById('event-metrics'),
            notes: document.getElementById('event-narration-notes'),
            tone: document.getElementById('event-narration-tone'),
            tempo: document.getElementById('event-narration-tempo'),
            ttsVoice: document.getElementById('event-tts-voice'),
            ttsSpeed: document.getElementById('event-tts-speed'),
            ttsVolume: document.getElementById('event-tts-volume'),
            originalVolume: document.getElementById('event-original-volume'),
            deleteInDialog: document.getElementById('delete-event-in-dialog'),
            cancel: document.getElementById('cancel-event'),
            deleteDialog: document.getElementById('delete-event-dialog'),
            deleteMessage: document.getElementById('delete-event-message')
        });
        const saveShortcut = window.api?.platform === 'darwin' ? 'Command+Enter' : 'Ctrl+Enter';
        el.add.dataset.i18nParams = JSON.stringify({ shortcut: saveShortcut });
        el.addReviewNote.dataset.i18nParams = JSON.stringify({ shortcut: 'A' });
        el.dialogHelp.dataset.i18nParams = JSON.stringify({ shortcut: saveShortcut });
        el.listHelp.dataset.i18nParams = JSON.stringify({ shortcut: saveShortcut });
        el.add.textContent = t('description_subtitle_editor.add_event_from_markers', { shortcut: saveShortcut });
        el.addReviewNote.textContent = t('description_subtitle_editor.add_standalone_review_note_from_markers', { shortcut: 'A' });
        el.dialogHelp.textContent = t('description_subtitle_editor.event_dialog_help', { shortcut: saveShortcut });
        el.listHelp.textContent = t('description_subtitle_editor.event_list_help', { shortcut: saveShortcut });
        bind();
        updateControls();
    }

    window.EvdDescriptionAuthoring = {
        focusSelectedEvent,
        formatEventItem,
        handleEventListKeydown,
        selectEvent,
        selectedEvent,
        selectedEvents,
        updateControls
    };
    document.addEventListener('DOMContentLoaded', init);
})();
