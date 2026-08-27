(() => {
    const ui = {};
    let issues = [];
    let selectedIssueId = '';
    let reportIsStale = true;
    let hasRun = false;
    let allowBlockedRender = false;

    function editor() { return window.EvdDescriptionEditor; }
    function t(key, params = {}) {
        const value = window.i18nHelper?.t?.(key, params);
        return value && !value.startsWith('[') ? value : key;
    }
    function events() { return editor()?.state.project?.events || []; }
    function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }
    function wordCount(text) {
        const value = String(text || '').trim();
        return value ? value.split(/\s+/u).length : 0;
    }
    function addIssue(rule, severity, item, params = {}, relatedItem = null) {
        const start = Number(item?.start ?? relatedItem?.start ?? 0) || 0;
        const end = Number(item?.end ?? relatedItem?.end ?? start) || start;
        issues.push({
            id: `quality-${rule}-${item?.id || 'project'}-${relatedItem?.id || issues.length}`,
            rule,
            severity,
            eventId: item?.id || '',
            relatedEventId: relatedItem?.id || '',
            start,
            end,
            text: String(item?.text || ''),
            messageKey: `description_subtitle_editor.quality_issue_${rule}`,
            params
        });
    }
    function playedDuration(item) {
        return Math.max(0, Number(item.ttsDuration) || 0) / Math.max(0.5, Number(item.ttsPlaybackRate) || 1);
    }
    function overlaps(left, right) {
        return Number(left.start) < Number(right.end) - 0.001 && Number(right.start) < Number(left.end) - 0.001;
    }
    function runChecks({ announce = true } = {}) {
        issues = [];
        const project = editor()?.state.project;
        const list = [...events()].sort((left, right) => Number(left.start) - Number(right.start) || Number(left.end) - Number(right.end));
        const duration = Math.max(0, Number(project?.source?.duration) || 0);
        const readingSpeed = Math.max(60, Number(project?.settings?.readingSpeedWpm) || 160);
        const confidenceThreshold = clamp(project?.contentStudio?.settings?.confidenceThreshold ?? 0.4, 0, 1);
        const sceneTimes = Array.isArray(project?.analysis?.sceneTimes) ? project.analysis.sceneTimes.map(Number).filter(Number.isFinite) : [];

        if (!list.length) addIssue('project_empty', 'suggestion', null);
        for (const item of list) {
            const start = Number(item.start);
            const end = Number(item.end);
            const available = Math.max(0, end - start);
            const words = wordCount(item.text);
            if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || (duration && end > duration + 0.01)) {
                addIssue('invalid_time', 'blocker', item);
            }
            if (!String(item.text || '').trim()) addIssue('empty_text', 'blocker', item);
            if (item.status === 'draft') addIssue('draft_event', 'warning', item);
            if (item.status === 'review') addIssue('review_event', 'warning', item);
            if (item.type === 'note' && item.status !== 'approved') addIssue('unresolved_note', 'warning', item);
            if (item.type === 'description') {
                if (!item.ttsAudioPath) addIssue('missing_narration', 'warning', item);
                if (item.ttsAudioPath && playedDuration(item) > available + 0.02) {
                    addIssue('tts_too_long', 'blocker', item, {
                        audio: playedDuration(item).toFixed(2),
                        available: available.toFixed(2)
                    });
                } else if (!item.ttsAudioPath && words && available > 0) {
                    const estimated = (words / readingSpeed) * 60;
                    if (estimated > available) addIssue('text_may_not_fit', 'warning', item, {
                        reading: estimated.toFixed(2),
                        available: available.toFixed(2)
                    });
                }
                if (item.ttsAudioPath && item.ttsGeneratedText && item.ttsGeneratedText !== item.text) {
                    addIssue('narration_outdated', 'blocker', item);
                }
                if (sceneTimes.some(time => time > start + 0.15 && time < end - 0.15)) {
                    addIssue('crosses_scene_change', 'suggestion', item);
                }
            }
            const isContentStudio = Boolean(item.contentStudioCueId) || String(item.source || '').includes('content');
            if (isContentStudio && Number(item.contentStudioConfidence) < confidenceThreshold) {
                addIssue('low_ai_confidence', 'warning', item, {
                    confidence: Math.round(Number(item.contentStudioConfidence || 0) * 100),
                    threshold: Math.round(confidenceThreshold * 100)
                });
            }
            if (/\s{3,}/u.test(String(item.text || '')) || String(item.text || '').length > 600) {
                addIssue('text_review_suggested', 'suggestion', item);
            }
        }

        for (let leftIndex = 0; leftIndex < list.length; leftIndex += 1) {
            const left = list[leftIndex];
            for (let rightIndex = leftIndex + 1; rightIndex < list.length; rightIndex += 1) {
                const right = list[rightIndex];
                if (Number(right.start) >= Number(left.end) && !(left.type === 'description' && left.ttsAudioPath && Number(right.start) < Number(left.start) + playedDuration(left))) break;
                if (left.type === right.type && left.type !== 'note' && overlaps(left, right)) {
                    addIssue('event_overlap', 'warning', left, { other: editor().formatTime(right.start) }, right);
                }
                const description = left.type === 'description' ? left : (right.type === 'description' ? right : null);
                const subtitle = left.type === 'subtitle' ? left : (right.type === 'subtitle' ? right : null);
                if (description && subtitle && overlaps(description, subtitle)) {
                    addIssue('dialogue_overlap', 'warning', description, { other: editor().formatTime(subtitle.start) }, subtitle);
                }
                if (left.type === 'description' && right.type === 'description' && left.ttsAudioPath && right.ttsAudioPath) {
                    const leftAudioEnd = Number(left.start) + playedDuration(left);
                    if (leftAudioEnd > Number(right.start) + 0.001) {
                        addIssue('tts_overlap', 'blocker', left, { other: editor().formatTime(right.start) }, right);
                    }
                }
            }
        }

        const order = { blocker: 0, warning: 1, suggestion: 2 };
        issues.sort((left, right) => order[left.severity] - order[right.severity] || left.start - right.start || left.rule.localeCompare(right.rule));
        selectedIssueId = issues.some(issue => issue.id === selectedIssueId) ? selectedIssueId : (issues[0]?.id || '');
        reportIsStale = false;
        hasRun = true;
        render();
        if (announce) editor()?.setStatus?.('description_subtitle_editor.quality_completed', qualityCounts());
        return issues;
    }
    function qualityCounts() {
        return {
            total: issues.length,
            blockers: issues.filter(issue => issue.severity === 'blocker').length,
            warnings: issues.filter(issue => issue.severity === 'warning').length,
            suggestions: issues.filter(issue => issue.severity === 'suggestion').length
        };
    }
    function visibleIssues() {
        const filter = ui.filter?.value || 'all';
        return filter === 'all' ? issues : issues.filter(issue => issue.severity === filter);
    }
    function issueText(issue, index = 0) {
        return t('description_subtitle_editor.quality_issue_item', {
            index: index + 1,
            severity: t(`description_subtitle_editor.quality_severity_${issue.severity}`),
            time: editor().formatTime(issue.start),
            message: t(issue.messageKey, issue.params)
        });
    }
    function render() {
        if (!ui.list) return;
        const counts = qualityCounts();
        ui.summary.value = hasRun
            ? t('description_subtitle_editor.quality_summary', counts)
            : t('description_subtitle_editor.quality_not_run');
        ui.list.replaceChildren();
        const visible = visibleIssues();
        ui.list.setAttribute('aria-label', t('description_subtitle_editor.quality_list_label', { count: visible.length }));
        visible.forEach((issue, index) => {
            const row = document.createElement('div');
            row.id = `description-quality-${issue.id}`;
            row.className = `quality-issue quality-${issue.severity}`;
            row.dataset.issueId = issue.id;
            row.setAttribute('role', 'option');
            row.setAttribute('aria-selected', String(issue.id === selectedIssueId));
            row.textContent = issueText(issue, index);
            ui.list.appendChild(row);
        });
        if (selectedIssueId && visible.some(issue => issue.id === selectedIssueId)) ui.list.setAttribute('aria-activedescendant', `description-quality-${selectedIssueId}`);
        else ui.list.removeAttribute('aria-activedescendant');
        ui.go.disabled = !selectedIssueId;
        ui.exportTxt.disabled = !hasRun;
        ui.exportXlsx.disabled = !hasRun;
    }
    function selectIssue(issue) {
        if (!issue) return;
        selectedIssueId = issue.id;
        render();
        document.getElementById(`description-quality-${issue.id}`)?.scrollIntoView?.({ block: 'nearest' });
    }
    function goToIssue() {
        const issue = issues.find(entry => entry.id === selectedIssueId);
        if (!issue?.eventId) {
            editor()?.setStatus?.('description_subtitle_editor.quality_issue_has_no_event');
            return;
        }
        const item = events().find(entry => entry.id === issue.eventId);
        if (!item) return;
        const state = editor().state;
        state.selectedEventId = item.id;
        state.selectedEventIds = [item.id];
        state.project.workspace.selectedEventId = item.id;
        state.project.workspace.selectedEventIds = [item.id];
        editor().renderEvents();
        window.EvdDescriptionTimeline?.seekTo?.(item.start, false);
        requestAnimationFrame(() => {
            const list = document.getElementById('event-list');
            list?.focus();
            document.getElementById(`description-event-${item.id}`)?.scrollIntoView?.({ block: 'nearest' });
        });
        editor().setStatus('description_subtitle_editor.quality_navigated', { time: editor().formatTime(item.start) });
    }
    function reportRows() {
        return issues.map((issue, index) => ({
            number: index + 1,
            severity: t(`description_subtitle_editor.quality_severity_${issue.severity}`),
            rule: t(`description_subtitle_editor.quality_rule_${issue.rule}`),
            start: editor().formatTime(issue.start),
            end: editor().formatTime(issue.end),
            text: issue.text,
            message: t(issue.messageKey, issue.params)
        }));
    }
    async function exportReport(format) {
        if (reportIsStale) runChecks({ announce: false });
        const rows = reportRows();
        const counts = qualityCounts();
        const reportText = [
            t('description_subtitle_editor.quality_report_heading'),
            t('description_subtitle_editor.quality_summary', counts),
            '',
            ...rows.map(row => t('description_subtitle_editor.quality_report_line', row))
        ].join('\n');
        try {
            const result = await window.api.descriptionSubtitleEditorQualityExport({
                format,
                sourceName: editor().state.project.source.name,
                reportText,
                issues: rows,
                labels: {
                    sheetName: t('description_subtitle_editor.quality_sheet_name'),
                    headers: [
                        t('description_subtitle_editor.quality_column_no'),
                        t('description_subtitle_editor.quality_column_severity'),
                        t('description_subtitle_editor.quality_column_rule'),
                        t('description_subtitle_editor.quality_column_start'),
                        t('description_subtitle_editor.quality_column_end'),
                        t('description_subtitle_editor.quality_column_text'),
                        t('description_subtitle_editor.quality_column_message')
                    ]
                }
            });
            if (!result?.canceled) editor().setStatus('description_subtitle_editor.quality_exported', { name: result.filePath.split(/[\\/]/).pop() });
        } catch (error) {
            editor().setStatus('description_subtitle_editor.quality_export_failed', { error: error.message || String(error) });
        }
    }
    function handleListKeydown(event) {
        const visible = visibleIssues();
        if (!visible.length) return;
        let index = Math.max(0, visible.findIndex(issue => issue.id === selectedIssueId));
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) {
            event.preventDefault();
            if (event.key === 'ArrowDown') index = Math.min(visible.length - 1, index + 1);
            if (event.key === 'ArrowUp') index = Math.max(0, index - 1);
            if (event.key === 'PageDown') index = Math.min(visible.length - 1, index + 10);
            if (event.key === 'PageUp') index = Math.max(0, index - 10);
            if (event.key === 'Home') index = 0;
            if (event.key === 'End') index = visible.length - 1;
            selectIssue(visible[index]);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            goToIssue();
        }
    }
    function interceptBlockedRender(event) {
        if (event.target?.id !== 'render-described-video' || allowBlockedRender) return;
        runChecks({ announce: false });
        const blockers = issues.filter(issue => issue.severity === 'blocker').length;
        if (!blockers) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        ui.blockerMessage.textContent = t('description_subtitle_editor.quality_blocker_message', { count: blockers });
        ui.blockerDialog.showModal();
        requestAnimationFrame(() => ui.blockerMessage.focus());
    }
    function bind() {
        ui.run.addEventListener('click', () => runChecks());
        ui.filter.addEventListener('change', () => { selectedIssueId = visibleIssues()[0]?.id || ''; render(); });
        ui.list.addEventListener('keydown', handleListKeydown);
        ui.list.addEventListener('click', event => selectIssue(issues.find(issue => issue.id === event.target.closest?.('[data-issue-id]')?.dataset.issueId)));
        ui.list.addEventListener('dblclick', goToIssue);
        ui.go.addEventListener('click', goToIssue);
        ui.exportTxt.addEventListener('click', () => exportReport('txt'));
        ui.exportXlsx.addEventListener('click', () => exportReport('xlsx'));
        window.addEventListener('evd-description-events-changed', () => { reportIsStale = true; if (ui.panel.open || hasRun) runChecks({ announce: false }); });
        window.addEventListener('evd-description-source-loaded', () => { issues = []; selectedIssueId = ''; reportIsStale = true; hasRun = false; render(); });
        document.addEventListener('click', interceptBlockedRender, true);
        ui.blockerDialog.addEventListener('close', () => {
            if (ui.blockerDialog.returnValue !== 'continue') return;
            allowBlockedRender = true;
            document.getElementById('render-described-video')?.click();
            allowBlockedRender = false;
        });
    }
    async function init() {
        await window.i18nHelper?.init?.();
        Object.assign(ui, {
            panel: document.getElementById('quality-panel'),
            run: document.getElementById('run-quality-check'),
            filter: document.getElementById('quality-filter'),
            summary: document.getElementById('quality-summary'),
            list: document.getElementById('quality-issue-list'),
            go: document.getElementById('quality-go-to-event'),
            exportTxt: document.getElementById('quality-export-txt'),
            exportXlsx: document.getElementById('quality-export-xlsx'),
            blockerDialog: document.getElementById('quality-blocker-dialog'),
            blockerMessage: document.getElementById('quality-blocker-message')
        });
        bind(); render();
    }

    // Navigation is contextual to the issue list, so it intentionally does not occupy a global shortcut-manager entry.
    window.EvdDescriptionQuality = { runChecks, getIssues: () => [...issues] };
    document.addEventListener('DOMContentLoaded', init);
})();
