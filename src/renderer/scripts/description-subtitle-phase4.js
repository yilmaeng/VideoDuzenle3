(() => {
    const ui = {};
    let pendingImport = null;
    let pendingSplit = null;
    let searchCursor = -1;

    function editor() { return window.EvdDescriptionEditor; }
    function t(key, params = {}) {
        const value = window.i18nHelper?.t?.(key, params);
        return value && !value.startsWith('[') ? value : key;
    }
    function events() { return editor()?.state.project?.events || []; }
    function selectedEvents() {
        const ids = new Set(editor()?.state.selectedEventIds || []);
        return events().filter(item => ids.has(item.id));
    }
    function setSelection(items, primary = null) {
        const ids = items.map(item => item.id);
        const active = primary?.id || ids[ids.length - 1] || '';
        editor().state.selectedEventId = active;
        editor().state.selectedEventIds = ids;
        editor().state.project.workspace.selectedEventId = active;
        editor().state.project.workspace.selectedEventIds = [...ids];
        editor().renderEvents();
        window.EvdDescriptionTimeline?.refresh?.();
        requestAnimationFrame(() => {
            document.getElementById(`description-event-${active}`)?.scrollIntoView?.({ block: 'nearest' });
        });
    }
    function changed(statusKey, params = {}) {
        editor().state.project.events.sort((a, b) => a.start - b.start || a.end - b.end);
        editor().setDirty(true);
        editor().renderEvents();
        window.dispatchEvent(new CustomEvent('evd-description-events-changed'));
        editor().setStatus(statusKey, params);
        updateControls();
    }
    function updateControls() {
        const hasProject = Boolean(editor()?.state.project?.source?.path);
        const hasEvents = events().length > 0;
        ui.importButton.disabled = !hasProject;
        ui.exportButton.disabled = !hasEvents;
        ui.findButton.disabled = !hasEvents;
    }
    function eventId(prefix = 'event') {
        return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    async function chooseImport() {
        try {
            const result = await window.api.descriptionSubtitleEditorImportSubtitles({
                duration: editor().state.project?.source?.duration,
                fps: editor().state.project?.source?.fps,
                defaultDuration: 5
            });
            if (result?.canceled) return;
            if (result.format === 'doc') {
                editor().setStatus('description_subtitle_editor.legacy_doc_not_supported');
                return;
            }
            pendingImport = result;
            const warningText = (result.warnings || []).length
                ? ' ' + t('description_subtitle_editor.import_warning_count', { count: result.warnings.length })
                : '';
            ui.importSummary.textContent = t('description_subtitle_editor.import_summary', {
                name: result.fileName,
                count: result.cues.length,
                format: String(result.format || '').toUpperCase()
            }) + warningText;
            ui.importDialog.showModal();
            requestAnimationFrame(() => ui.importSummary.focus());
        } catch (error) {
            editor().setStatus('description_subtitle_editor.operation_failed', { error: error.message || String(error) });
        }
    }
    function applyImport(event) {
        event.preventDefault();
        if (!pendingImport) return;
        const mode = new FormData(ui.importForm).get('import-mode') || 'append';
        const type = ui.importType.value === 'description' ? 'description' : 'subtitle';
        const duration = Number(editor().state.project.source.duration) || 0;
        const now = new Date().toISOString();
        const imported = pendingImport.cues.map(cue => ({
            id: eventId('imported'), type,
            start: Math.max(0, Number(cue.start) || 0),
            end: duration ? Math.min(duration, Number(cue.end) || 0) : Math.max(0, Number(cue.end) || 0),
            text: String(cue.text || '').trim(), speaker: '', narrationNotes: String(cue.narrationNotes || ''), narrationTone: '', narrationTempo: '', voice: '',
            status: 'draft', source: `imported-${pendingImport.format}`, createdAt: now, updatedAt: now
        })).filter(item => item.text && item.end > item.start);
        editor().state.project.events = mode === 'replace' ? imported : [...events(), ...imported];
        if (mode === 'replace') editor().state.project.reviewNotes = [];
        editor().state.project.events.sort((a, b) => a.start - b.start || a.end - b.end);
        setSelection(imported.length ? [imported[0]] : [], imported[0]);
        const fileName = pendingImport.fileName;
        pendingImport = null;
        ui.importDialog.close();
        changed('description_subtitle_editor.import_completed', { count: imported.length, name: fileName });
        document.getElementById('event-list')?.focus();
    }

    function openExport() {
        hideExportFeedback();
        ui.exportSelected.disabled = selectedEvents().length === 0;
        ui.exportForm.elements['export-scope'].value = 'with-notes';
        ui.exportNotes.checked = true;
        ui.exportDialog.showModal();
        requestAnimationFrame(() => ui.exportFormat.focus());
    }
    function hideExportFeedback() {
        if (!ui.exportFeedback) return;
        ui.exportFeedback.hidden = true;
        ui.exportFeedback.textContent = '';
    }
    function showExportFeedback(key, params = {}) {
        ui.exportFeedback.textContent = t(key, params);
        ui.exportFeedback.hidden = false;
        requestAnimationFrame(() => ui.exportFeedback.focus());
    }
    async function exportEvents(event) {
        event.preventDefault();
        hideExportFeedback();
        const format = ui.exportFormat.value;
        const selectedTypes = new Set([
            ui.exportDescriptions.checked ? 'description' : '',
            ui.exportSubtitles.checked ? 'subtitle' : '',
            ui.exportNotes.checked ? 'note' : ''
        ].filter(Boolean));
        const scope = new FormData(ui.exportForm).get('export-scope');
        const noteMap = new Map((editor().state.project.reviewNotes || []).map(note => [note.eventId, note]));
        const reviewOnlyScope = scope === 'with-notes' || scope === 'unresolved-notes';
        const reportFormat = format === 'docx' || format === 'txt' || format === 'xlsx';
        let source = scope === 'selected' ? selectedEvents() : events();
        if (scope === 'with-notes') {
            source = events().filter(item => item.type === 'note' || (item.type === 'description' && noteMap.has(item.id)));
        }
        if (scope === 'unresolved-notes') {
            source = events().filter(item => {
                if (item.type === 'note') return item.status !== 'approved';
                const note = noteMap.get(item.id);
                return item.type === 'description' && note && !note.resolved;
            });
        }
        const outgoing = source
            .filter(item => selectedTypes.has(item.type) || (reviewOnlyScope && item.type === 'note'))
            .map(item => {
                if (reportFormat && item.type === 'note') {
                    return {
                        ...item,
                        text: t('description_subtitle_editor.standalone_review_note_no_description'),
                        reviewNoteText: item.text,
                        reviewNoteResolved: item.status === 'approved',
                        standaloneReviewNote: true
                    };
                }
                const note = noteMap.get(item.id);
                return { ...item, reviewNoteText: note?.text || '', reviewNoteResolved: Boolean(note?.resolved) };
            });
        if (!outgoing.length) {
            editor().setStatus('description_subtitle_editor.export_nothing_selected');
            showExportFeedback('description_subtitle_editor.export_nothing_selected');
            return;
        }
        try {
            const result = await window.api.descriptionSubtitleEditorExport({
                format,
                sourceName: editor().state.project.source.name,
                fileNameSuffix: reviewOnlyScope
                    ? t('description_subtitle_editor.review_export_filename_suffix')
                    : '',
                events: outgoing,
                labels: {
                    sheetName: t('description_subtitle_editor.xlsx_sheet_name'),
                    headers: [
                        t('description_subtitle_editor.xlsx_no'), t('description_subtitle_editor.xlsx_start'),
                        t('description_subtitle_editor.xlsx_end'), t('description_subtitle_editor.xlsx_duration'),
                        t('description_subtitle_editor.xlsx_type'), t('description_subtitle_editor.xlsx_text'),
                        t('description_subtitle_editor.xlsx_word_count'), t('description_subtitle_editor.xlsx_speaker'),
                        t('description_subtitle_editor.xlsx_narration_notes'), t('description_subtitle_editor.xlsx_tone'),
                        t('description_subtitle_editor.xlsx_tempo'), t('description_subtitle_editor.xlsx_voice'),
                        t('description_subtitle_editor.xlsx_status'),
                        t('description_subtitle_editor.xlsx_review_note'),
                        t('description_subtitle_editor.xlsx_review_status')
                    ],
                    types: {
                        description: t('description_subtitle_editor.event_type_description'),
                        subtitle: t('description_subtitle_editor.event_type_subtitle'),
                        note: t('description_subtitle_editor.event_type_note')
                    },
                    reviewResolved: t('description_subtitle_editor.review_note_status_resolved'),
                    reviewUnresolved: t('description_subtitle_editor.review_note_status_unresolved'),
                    descriptionText: t('description_subtitle_editor.review_export_description_text'),
                    timeRange: t('description_subtitle_editor.review_export_time_range'),
                    reviewNote: t('description_subtitle_editor.review_export_note'),
                    noteStatus: t('description_subtitle_editor.review_export_status'),
                    resolved: t('description_subtitle_editor.review_note_status_resolved'),
                    unresolved: t('description_subtitle_editor.review_note_status_unresolved'),
                    entryHeading: t('description_subtitle_editor.review_export_entry_heading'),
                    statuses: {
                        draft: t('description_subtitle_editor.event_status_draft'),
                        review: t('description_subtitle_editor.event_status_review'),
                        approved: t('description_subtitle_editor.event_status_approved')
                    }
                }
            });
            if (result?.canceled) return;
            ui.exportDialog.close();
            editor().setStatus('description_subtitle_editor.export_completed', { count: result.count, name: result.filePath.split(/[\\/]/).pop() });
        } catch (error) {
            const errorMessage = error.message || String(error);
            editor().setStatus('description_subtitle_editor.operation_failed', { error: errorMessage });
            showExportFeedback('description_subtitle_editor.operation_failed', { error: errorMessage });
        }
    }

    function openFind(focusReplace = false) {
        searchCursor = Math.max(-1, events().findIndex(item => item.id === editor().state.selectedEventId));
        ui.findDialog.showModal();
        requestAnimationFrame(() => (focusReplace ? ui.replaceText : ui.findText).focus());
    }
    function textMatches(value, query) {
        if (ui.caseSensitive.checked) return String(value).includes(query);
        return String(value).toLocaleLowerCase().includes(query.toLocaleLowerCase());
    }
    function findNext() {
        const query = ui.findText.value;
        if (!query) { ui.findResult.textContent = t('description_subtitle_editor.find_enter_text'); return; }
        const list = events();
        for (let step = 1; step <= list.length; step += 1) {
            const index = (searchCursor + step) % list.length;
            const item = list[index];
            if ([item.text, item.speaker, item.narrationNotes, item.narrationTone, item.narrationTempo].some(value => textMatches(value, query))) {
                searchCursor = index;
                setSelection([item], item);
                ui.findResult.textContent = t('description_subtitle_editor.find_match', { index: index + 1, count: list.length, text: item.text.slice(0, 120) });
                return;
            }
        }
        ui.findResult.textContent = t('description_subtitle_editor.find_no_match');
    }
    function replaceAll() {
        const query = ui.findText.value;
        if (!query) { ui.findResult.textContent = t('description_subtitle_editor.find_enter_text'); return; }
        const replacement = ui.replaceText.value;
        const flags = ui.caseSensitive.checked ? 'gu' : 'giu';
        const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
        let count = 0;
        const fields = ['text', 'speaker', 'narrationNotes', 'narrationTone', 'narrationTempo'];
        events().forEach(item => fields.forEach(field => {
            const before = String(item[field] || '');
            const matches = before.match(pattern);
            if (!matches) return;
            count += matches.length;
            item[field] = before.replace(pattern, replacement);
            if (field === 'text') { item.ttsAudioPath = ''; item.ttsDuration = 0; item.ttsGeneratedText = ''; }
            item.updatedAt = new Date().toISOString();
        }));
        if (count) changed('description_subtitle_editor.replace_completed', { count });
        ui.findResult.textContent = count
            ? t('description_subtitle_editor.replace_completed', { count })
            : t('description_subtitle_editor.find_no_match');
    }

    function openSplit() {
        const selection = selectedEvents();
        const item = selection.length === 1 ? selection[0] : null;
        const splitTime = Number(document.getElementById('video-preview')?.currentTime) || 0;
        if (!item || splitTime <= item.start + 0.001 || splitTime >= item.end - 0.001) {
            editor().setStatus('description_subtitle_editor.split_position_invalid');
            return;
        }
        const words = item.text.trim().split(/\s+/u);
        const ratio = (splitTime - item.start) / (item.end - item.start);
        const splitIndex = Math.max(1, Math.min(words.length - 1, Math.round(words.length * ratio)));
        pendingSplit = { item, splitTime };
        ui.splitFirst.value = words.slice(0, splitIndex).join(' ');
        ui.splitSecond.value = words.slice(splitIndex).join(' ');
        ui.splitSummary.textContent = t('description_subtitle_editor.split_summary', { time: editor().formatTime(splitTime) });
        ui.splitDialog.showModal();
        requestAnimationFrame(() => ui.splitSummary.focus());
    }
    function applySplit(event) {
        event.preventDefault();
        if (!pendingSplit || !ui.splitFirst.value.trim() || !ui.splitSecond.value.trim()) return;
        const { item, splitTime } = pendingSplit;
        const now = new Date().toISOString();
        const second = { ...item, id: eventId('split'), start: splitTime, text: ui.splitSecond.value.trim(), ttsAudioPath: '', ttsDuration: 0, ttsPlaybackRate: 1, ttsGeneratedText: '', createdAt: now, updatedAt: now };
        item.ttsAudioPath = ''; item.ttsDuration = 0; item.ttsPlaybackRate = 1; item.ttsGeneratedText = '';
        item.end = splitTime;
        item.text = ui.splitFirst.value.trim();
        item.updatedAt = now;
        events().push(second);
        pendingSplit = null;
        ui.splitDialog.close();
        setSelection([item, second], second);
        changed('description_subtitle_editor.split_completed');
        document.getElementById('event-list')?.focus();
    }
    function openMerge() {
        const selection = selectedEvents();
        if (selection.length < 2) { editor().setStatus('description_subtitle_editor.merge_requires_multiple'); return; }
        ui.mergeSummary.textContent = t('description_subtitle_editor.merge_summary', { count: selection.length });
        ui.mergeDialog.showModal();
        requestAnimationFrame(() => ui.mergeSummary.focus());
    }
    function applyMerge() {
        const selection = selectedEvents().sort((a, b) => a.start - b.start);
        if (selection.length < 2) return;
        const first = selection[0];
        const ids = new Set(selection.map(item => item.id));
        first.start = Math.min(...selection.map(item => item.start));
        first.end = Math.max(...selection.map(item => item.end));
        first.text = selection.map(item => item.text.trim()).filter(Boolean).join('\n');
        first.narrationNotes = selection.map(item => item.narrationNotes?.trim()).filter(Boolean).join('\n');
        first.ttsAudioPath = ''; first.ttsDuration = 0; first.ttsPlaybackRate = 1; first.ttsGeneratedText = '';
        first.updatedAt = new Date().toISOString();
        editor().state.project.events = events().filter(item => item.id === first.id || !ids.has(item.id));
        setSelection([first], first);
        changed('description_subtitle_editor.merge_completed', { count: selection.length });
        document.getElementById('event-list')?.focus();
    }

    function bind() {
        ui.importButton.addEventListener('click', chooseImport);
        ui.importForm.addEventListener('submit', applyImport);
        ui.importCancel.addEventListener('click', () => { pendingImport = null; ui.importDialog.close(); });
        ui.exportButton.addEventListener('click', openExport);
        ui.exportForm.addEventListener('submit', exportEvents);
        ui.exportForm.addEventListener('keydown', event => {
            if (event.key === 'Enter' && event.target === ui.exportFormat) {
                event.preventDefault();
                ui.exportForm.requestSubmit();
            }
        });
        ui.exportCancel.addEventListener('click', () => ui.exportDialog.close());
        ui.findButton.addEventListener('click', () => openFind(false));
        ui.findNext.addEventListener('click', findNext);
        ui.replaceAll.addEventListener('click', replaceAll);
        ui.findClose.addEventListener('click', () => ui.findDialog.close());
        ui.findForm.addEventListener('submit', event => { event.preventDefault(); findNext(); });
        ui.splitForm.addEventListener('submit', applySplit);
        ui.splitCancel.addEventListener('click', () => { pendingSplit = null; ui.splitDialog.close(); });
        ui.mergeDialog.addEventListener('close', () => { if (ui.mergeDialog.returnValue === 'confirm') applyMerge(); });
        window.addEventListener('evd-description-event-action', event => {
            if (event.detail?.action === 'split') openSplit();
            if (event.detail?.action === 'merge') openMerge();
        });
        window.addEventListener('evd-description-source-loaded', updateControls);
        window.addEventListener('evd-description-events-changed', updateControls);
        window.addEventListener('evd-accessibility-dialog-announce', event => {
            const detail = event.detail || {};
            editor()?.setStatus?.('description_subtitle_editor.native_dialog_announcement', {
                content: [detail.title, detail.message, detail.detail].filter(Boolean).join('. ')
            });
        });
        window.addEventListener('keydown', event => {
            if (window.EvdDescriptionTimeline?.matchesShortcut?.('importDescriptionSubtitles', event)) { event.preventDefault(); chooseImport(); }
            if (window.EvdDescriptionTimeline?.matchesShortcut?.('exportDescriptionEvents', event)) { event.preventDefault(); openExport(); }
            if (window.EvdDescriptionTimeline?.matchesShortcut?.('splitDescriptionEvent', event)) { event.preventDefault(); openSplit(); }
            if (window.EvdDescriptionTimeline?.matchesShortcut?.('mergeDescriptionEvents', event)) { event.preventDefault(); openMerge(); }
            if (window.EvdDescriptionTimeline?.matchesShortcut?.('findDescriptionText', event)) { event.preventDefault(); openFind(false); }
            if (window.EvdDescriptionTimeline?.matchesShortcut?.('replaceDescriptionText', event)) { event.preventDefault(); openFind(true); }
        });
    }
    async function init() {
        await window.i18nHelper?.init?.();
        Object.assign(ui, {
            importButton: document.getElementById('import-subtitles'), exportButton: document.getElementById('export-events'), findButton: document.getElementById('find-replace'),
            importDialog: document.getElementById('import-dialog'), importForm: document.getElementById('import-form'), importSummary: document.getElementById('import-summary'), importType: document.getElementById('import-event-type'), importCancel: document.getElementById('import-cancel'),
            exportDialog: document.getElementById('export-dialog'), exportForm: document.getElementById('export-form'), exportFormat: document.getElementById('export-format'), exportSelected: document.getElementById('export-selected-scope'), exportDescriptions: document.getElementById('export-descriptions'), exportSubtitles: document.getElementById('export-subtitles'), exportNotes: document.getElementById('export-notes'), exportFeedback: document.getElementById('export-feedback'), exportCancel: document.getElementById('export-cancel'),
            findDialog: document.getElementById('find-dialog'), findForm: document.getElementById('find-form'), findText: document.getElementById('find-text'), replaceText: document.getElementById('replace-text'), caseSensitive: document.getElementById('find-case-sensitive'), findResult: document.getElementById('find-result'), findNext: document.getElementById('find-next'), replaceAll: document.getElementById('replace-all'), findClose: document.getElementById('find-close'),
            splitDialog: document.getElementById('split-dialog'), splitForm: document.getElementById('split-form'), splitSummary: document.getElementById('split-summary'), splitFirst: document.getElementById('split-first-text'), splitSecond: document.getElementById('split-second-text'), splitCancel: document.getElementById('split-cancel'),
            mergeDialog: document.getElementById('merge-dialog'), mergeSummary: document.getElementById('merge-summary')
        });
        const exportShortcut = window.api?.platform === 'darwin' ? 'Command+Shift+E' : 'Ctrl+Shift+E';
        ui.exportButton.dataset.i18nParams = JSON.stringify({ shortcut: exportShortcut });
        ui.exportButton.textContent = t('description_subtitle_editor.export_events', { shortcut: exportShortcut });
        bind(); updateControls();
    }
    document.addEventListener('DOMContentLoaded', init);
})();
