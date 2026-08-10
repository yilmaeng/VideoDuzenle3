(() => {
    const ui = {};
    let packageData = null;
    let pendingControlPackage = null;

    function editor() { return window.EvdDescriptionEditor; }
    function authoring() { return window.EvdDescriptionAuthoring; }
    function t(key, params = {}) {
        const value = window.i18nHelper?.t?.(key, params);
        return value && !value.startsWith('[') ? value : key;
    }
    function allEvents() { return editor()?.state.project?.events || []; }
    function reviewNotes() {
        if (!editor()?.state.project) return [];
        if (!Array.isArray(editor().state.project.reviewNotes)) editor().state.project.reviewNotes = [];
        return editor().state.project.reviewNotes;
    }
    function selectedDescription() {
        const item = authoring()?.selectedEvent?.();
        return item?.type === 'description' ? item : null;
    }
    function noteFor(eventId) { return reviewNotes().find(note => note.eventId === eventId) || null; }

    function addOption(select, value, label) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
    }
    function selectedPackageItem(kind) {
        const select = kind === 'scripts' ? ui.packageScript : kind === 'media' ? ui.packageMedia : ui.packageProject;
        return (packageData?.[kind] || []).find(item => item.path === select.value) || null;
    }
    function warningLabel(warning) {
        const key = 'description_subtitle_editor.docx_warning_' + String(warning?.code || 'unknown');
        return t(key, { index: warning?.index || '', detail: warning?.detail || warning?.sourceLine || '' });
    }
    function updatePackagePreview() {
        const script = selectedPackageItem('scripts');
        if (!script) {
            ui.packagePreview.value = t('description_subtitle_editor.control_package_no_script_preview');
            return;
        }
        const cues = Array.isArray(script.cues) ? script.cues : [];
        const warnings = Array.isArray(script.warnings) ? script.warnings : [];
        const lines = [
            t('description_subtitle_editor.control_package_preview_summary', {
                name: script.name,
                format: String(script.format || '').toUpperCase(),
                count: cues.length,
                warnings: warnings.length,
                confidence: Math.round((Number(script.confidence) || 0) * 100)
            })
        ];
        warnings.forEach(warning => lines.push(t('description_subtitle_editor.control_package_warning_line', {
            warning: warningLabel(warning)
        })));
        cues.slice(0, 200).forEach((cue, index) => lines.push(t('description_subtitle_editor.control_package_cue_line', {
            index: index + 1,
            start: editor().formatTime(cue.start),
            end: editor().formatTime(cue.end),
            text: cue.narrationNotes ? t('description_subtitle_editor.control_package_cue_with_note', { note: cue.narrationNotes, text: cue.text }) : cue.text
        })));
        if (cues.length > 200) lines.push(t('description_subtitle_editor.control_package_preview_limited', { count: cues.length - 200 }));
        ui.packagePreview.value = lines.join('\n');
        ui.packagePreview.scrollTop = 0;
    }
    function populatePackageDialog(data, options = {}) {
        packageData = data;
        [ui.packageProject, ui.packageMedia, ui.packageScript].forEach(select => select.replaceChildren());
        addOption(ui.packageProject, '', t('description_subtitle_editor.control_package_no_project'));
        data.projects.forEach(item => addOption(ui.packageProject, item.path, item.name));
        addOption(ui.packageMedia, '', t('description_subtitle_editor.control_package_choose_media'));
        data.media.forEach(item => addOption(ui.packageMedia, item.path, item.name + ' - ' + t('description_subtitle_editor.media_type_' + item.mediaType)));
        addOption(ui.packageScript, '', t('description_subtitle_editor.control_package_no_script'));
        data.scripts.forEach(item => addOption(ui.packageScript, item.path, item.name + ' - ' + String(item.format || '').toUpperCase()));
        if (data.projects.length === 1) ui.packageProject.value = data.projects[0].path;
        else {
            if (data.media.length === 1) ui.packageMedia.value = data.media[0].path;
            if (data.scripts.length === 1) ui.packageScript.value = data.scripts[0].path;
        }
        const usingProject = Boolean(ui.packageProject.value);
        ui.packageMedia.disabled = usingProject;
        ui.packageScript.disabled = usingProject;
        updatePackagePreview();
        if (options.show !== false) {
            ui.packageDialog.showModal();
            requestAnimationFrame(() => (data.projects.length ? ui.packageProject : ui.packageMedia).focus());
        }
    }
    async function chooseControlPackage() {
        try {
            const result = await window.api.descriptionSubtitleEditorChooseControlPackage();
            if (result?.canceled) return;
            if (!result.media.length && !result.projects.length) {
                editor().setStatus('description_subtitle_editor.control_package_media_missing');
                return;
            }
            await openControlPackageData(result);
        } catch (error) {
            editor().setStatus('description_subtitle_editor.operation_failed', { error: error.message || String(error) });
        }
    }
    async function loadPackageProject(projectItem) {
        const result = await window.api.descriptionSubtitleEditorLoadProjectPath(projectItem.path);
        await editor().loadProjectResult(result);
        if (ui.packageDialog.open) ui.packageDialog.close();
        editor().setStatus('description_subtitle_editor.control_package_project_opened', { name: projectItem.name });
        requestAnimationFrame(() => window.EvdDescriptionTimeline?.focusPlaybackSurface?.());
    }
    async function openControlPackageData(data) {
        if (!ui.packageDialog) {
            pendingControlPackage = data;
            return;
        }
        try {
            if (data.projects?.length === 1) await loadPackageProject(data.projects[0]);
            else if (!data.projects?.length && data.media?.length === 1 && (data.scripts?.length || 0) <= 1) {
                populatePackageDialog(data, { show: false });
                await openSelectedPackage({ preventDefault() {} });
            } else populatePackageDialog(data);
        } catch (error) {
            editor().setStatus('description_subtitle_editor.operation_failed', { error: error.message || String(error) });
        }
    }
    window.addEventListener('evd-description-control-package-open-requested', event => {
        openControlPackageData(event.detail || {});
    });
    function makeImportedEvents(cues, format) {
        const duration = Number(editor().state.project?.source?.duration) || 0;
        const now = new Date().toISOString();
        return (cues || []).map((cue, index) => ({
            id: `package-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
            type: 'description',
            start: Math.max(0, Number(cue.start) || 0),
            end: duration ? Math.min(duration, Number(cue.end) || 0) : Math.max(0, Number(cue.end) || 0),
            text: String(cue.text || '').trim(),
            speaker: '', narrationNotes: String(cue.narrationNotes || ''), narrationTone: '', narrationTempo: '', voice: '',
            status: 'draft', source: 'imported-' + format, createdAt: now, updatedAt: now
        })).filter(item => item.text && item.end > item.start);
    }
    async function openSelectedPackage(event) {
        event.preventDefault();
        const projectItem = selectedPackageItem('projects');
        try {
            if (projectItem) {
                await loadPackageProject(projectItem);
                return;
            }
            const media = selectedPackageItem('media');
            if (!media) {
                editor().setStatus('description_subtitle_editor.control_package_media_required');
                ui.packageMedia.focus();
                return;
            }
            const script = selectedPackageItem('scripts');
            if (script?.format === 'doc') {
                editor().setStatus('description_subtitle_editor.legacy_doc_not_supported');
                ui.packageScript.focus();
                return;
            }
            await editor().loadVideoSource(media, { createNew: true, markDirty: true });
            const imported = makeImportedEvents(script?.cues || [], script?.format || '');
            if (imported.length) {
                editor().state.project.events = imported;
                editor().state.selectedEventId = imported[0].id;
                editor().state.selectedEventIds = [imported[0].id];
                editor().state.project.workspace.selectedEventId = imported[0].id;
                editor().state.project.workspace.selectedEventIds = [imported[0].id];
                editor().renderEvents();
                window.dispatchEvent(new CustomEvent('evd-description-events-changed'));
            }
            if (ui.packageDialog.open) ui.packageDialog.close();
            editor().setDirty(true);
            editor().setStatus('description_subtitle_editor.control_package_opened', {
                media: media.name, count: imported.length
            });
            requestAnimationFrame(() => window.EvdDescriptionTimeline?.focusPlaybackSurface?.());
        } catch (error) {
            editor().setStatus('description_subtitle_editor.operation_failed', { error: error.message || String(error) });
        }
    }

    function nearestVisibleDescription(time) {
        const visible = editor().getVisibleEvents().filter(item => item.type === 'description');
        const candidates = visible.length ? visible : editor().getVisibleEvents();
        if (!candidates.length) return null;
        const containing = candidates.filter(item => item.start <= time + 0.001 && item.end >= time - 0.001);
        if (containing.length) return containing.sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
        return [...candidates].sort((a, b) => {
            const distanceA = time < a.start ? a.start - time : time - a.end;
            const distanceB = time < b.start ? b.start - time : time - b.end;
            return distanceA - distanceB || a.start - b.start;
        })[0];
    }
    function syncListToPlayback() {
        const time = Number(document.getElementById('video-preview')?.currentTime) || 0;
        const item = nearestVisibleDescription(time);
        if (!item) return;
        authoring()?.selectEvent?.(item, false);
        authoring()?.focusSelectedEvent?.();
        editor().setStatus('description_subtitle_editor.position_event_selected', {
            time: editor().formatTime(time),
            text: String(item.text || '').slice(0, 160)
        });
    }

    function openReviewNoteDialog() {
        const item = selectedDescription();
        if (!item) {
            editor().setStatus('description_subtitle_editor.select_description_for_review_note');
            return;
        }
        const note = noteFor(item.id);
        ui.reviewEvent.textContent = t('description_subtitle_editor.review_note_event_summary', {
            start: editor().formatTime(item.start),
            end: editor().formatTime(item.end),
            text: item.text
        });
        ui.reviewText.value = note?.text || '';
        ui.reviewResolved.checked = Boolean(note?.resolved);
        ui.reviewDelete.hidden = !note;
        if (!ui.reviewDialog.open) ui.reviewDialog.showModal();
        requestAnimationFrame(() => ui.reviewText.focus());
    }
    function saveReviewNote(event) {
        event.preventDefault();
        const item = selectedDescription();
        if (!item) return;
        const text = ui.reviewText.value.trim();
        const existing = noteFor(item.id);
        if (!text) {
            if (existing) editor().state.project.reviewNotes = reviewNotes().filter(note => note.id !== existing.id);
        } else {
            const now = new Date().toISOString();
            const note = {
                id: existing?.id || `review-note-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                eventId: item.id,
                text,
                resolved: ui.reviewResolved.checked,
                createdAt: existing?.createdAt || now,
                updatedAt: now
            };
            if (existing) Object.assign(existing, note);
            else reviewNotes().push(note);
        }
        editor().setDirty(true);
        keepSelectionVisible();
        editor().renderEvents();
        ui.reviewDialog.close();
        requestAnimationFrame(() => window.EvdDescriptionTimeline?.focusPlaybackSurface?.());
        editor().setStatus(text ? 'description_subtitle_editor.review_note_saved' : 'description_subtitle_editor.review_note_removed');
        window.dispatchEvent(new CustomEvent('evd-description-review-notes-changed'));
    }
    function deleteReviewNote() {
        const item = selectedDescription();
        if (!item) return;
        editor().state.project.reviewNotes = reviewNotes().filter(note => note.eventId !== item.id);
        editor().setDirty(true);
        keepSelectionVisible();
        editor().renderEvents();
        ui.reviewDialog.close();
        authoring()?.focusSelectedEvent?.();
        editor().setStatus('description_subtitle_editor.review_note_removed');
        window.dispatchEvent(new CustomEvent('evd-description-review-notes-changed'));
    }
    function keepSelectionVisible() {
        const visible = editor().getVisibleEvents();
        if (!visible.some(item => item.id === editor().state.selectedEventId)) {
            editor().state.selectedEventId = visible[0]?.id || '';
            editor().state.selectedEventIds = visible[0] ? [visible[0].id] : [];
        }
        return visible;
    }
    function applyFilter() {
        editor().state.eventFilter = ui.eventFilter.value;
        const visible = keepSelectionVisible();
        editor().renderEvents();
        editor().setStatus('description_subtitle_editor.event_filter_applied', { count: visible.length });
    }
    function decorateEventFormatter() {
        const base = authoring()?.formatEventItem;
        if (!base || base._reviewDecorated) return;
        const wrapped = (item, index) => {
            const value = base(item, index);
            const note = noteFor(item.id);
            if (item.type === 'note') {
                return value + ' ' + t(item.status === 'approved'
                    ? 'description_subtitle_editor.event_review_note_resolved_indicator'
                    : 'description_subtitle_editor.event_review_note_indicator');
            }
            if (!note) return value;
            return value + ' ' + t(note.resolved
                ? 'description_subtitle_editor.event_review_note_resolved_indicator'
                : 'description_subtitle_editor.event_review_note_indicator');
        };
        wrapped._reviewDecorated = true;
        authoring().formatEventItem = wrapped;
    }
    function bind() {
        ui.openPackage.addEventListener('click', () => editor().requestProtectedAction(chooseControlPackage));
        ui.packageForm.addEventListener('submit', openSelectedPackage);
        ui.packageCancel.addEventListener('click', () => ui.packageDialog.close());
        ui.packageScript.addEventListener('change', updatePackagePreview);
        ui.packageProject.addEventListener('change', () => {
            const usingProject = Boolean(ui.packageProject.value);
            ui.packageMedia.disabled = usingProject;
            ui.packageScript.disabled = usingProject;
            updatePackagePreview();
        });
        ui.eventFilter.addEventListener('change', applyFilter);
        ui.reviewForm.addEventListener('submit', saveReviewNote);
        ui.reviewCancel.addEventListener('click', () => ui.reviewDialog.close());
        ui.reviewDelete.addEventListener('click', deleteReviewNote);
        ui.reviewForm.addEventListener('keydown', event => {
            const modifier = window.api.platform === 'darwin' ? event.metaKey : event.ctrlKey;
            if (modifier && event.key === 'Enter') saveReviewNote(event);
        });
        window.addEventListener('evd-description-review-note-requested', openReviewNoteDialog);
        window.addEventListener('evd-description-focus-requested', event => {
            if (event.detail?.target === 'list') requestAnimationFrame(syncListToPlayback);
        });
        window.addEventListener('keydown', event => {
            if (event.target?.closest?.('dialog[open]') || ['INPUT','TEXTAREA','SELECT'].includes(event.target?.tagName)) return;
            if (window.EvdDescriptionTimeline?.matchesShortcut?.('editDescriptionReviewNote', event)) {
                event.preventDefault();
                openReviewNoteDialog();
            }
        });
    }
    async function init() {
        await window.i18nHelper?.init?.();
        Object.assign(ui, {
            openPackage: document.getElementById('open-control-package'),
            packageDialog: document.getElementById('control-package-dialog'),
            packageForm: document.getElementById('control-package-form'),
            packageProject: document.getElementById('control-package-project'),
            packageMedia: document.getElementById('control-package-media'),
            packageScript: document.getElementById('control-package-script'),
            packagePreview: document.getElementById('control-package-preview'),
            packageCancel: document.getElementById('control-package-cancel'),
            eventFilter: document.getElementById('event-filter'),
            reviewDialog: document.getElementById('review-note-dialog'),
            reviewForm: document.getElementById('review-note-form'),
            reviewEvent: document.getElementById('review-note-event'),
            reviewText: document.getElementById('review-note-text'),
            reviewResolved: document.getElementById('review-note-resolved'),
            reviewDelete: document.getElementById('review-note-delete'),
            reviewCancel: document.getElementById('review-note-cancel')
        });
        decorateEventFormatter();
        bind();
        editor().renderEvents();
        if (pendingControlPackage) {
            const data = pendingControlPackage;
            pendingControlPackage = null;
            await openControlPackageData(data);
        }
    }
    document.addEventListener('DOMContentLoaded', init);
})();