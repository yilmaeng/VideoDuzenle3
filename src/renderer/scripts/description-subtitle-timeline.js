(() => {
    const timeline = {
        waveform: null,
        scenes: [],
        zoom: 1,
        sourcePath: '',
        analysisKind: '',
        drawPending: false,
        playbackStart: null,
        playRange: null,
        scrubTimer: null,
        navigationStep: 1,
        userKeymap: {}
    };
    const el = {};

    function editor() {
        return window.EvdDescriptionEditor;
    }

    function t(key, params = {}) {
        const value = window.i18nHelper?.t?.(key, params);
        return value && !value.startsWith('[') ? value : key;
    }

    function duration() {
        return Math.max(0, Number(el.video?.duration) || Number(editor()?.state.project?.source?.duration) || 0);
    }

    function visibleRange() {
        const total = duration();
        if (!total) return { start: 0, end: 0, duration: 0 };
        const visibleDuration = total / Math.max(1, timeline.zoom);
        const center = Number(el.video.currentTime) || 0;
        const start = Math.max(0, Math.min(total - visibleDuration, center - (visibleDuration / 2)));
        return { start, end: start + visibleDuration, duration: visibleDuration };
    }

    function niceTick(rawStep) {
        const power = Math.pow(10, Math.floor(Math.log10(Math.max(0.001, rawStep))));
        const normalized = rawStep / power;
        const multiple = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
        return multiple * power;
    }

    function canvasSize() {
        const rect = el.visual.getBoundingClientRect();
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        const width = Math.max(320, Math.round(rect.width * ratio));
        const height = Math.round(190 * ratio);
        if (el.canvas.width !== width || el.canvas.height !== height) {
            el.canvas.width = width;
            el.canvas.height = height;
        }
        return { width, height, ratio };
    }

    function timeToX(time, range, width) {
        return range.duration > 0 ? ((time - range.start) / range.duration) * width : 0;
    }

    function drawRuler(context, range, width, ratio) {
        const rulerHeight = 28 * ratio;
        context.fillStyle = '#0d1b22';
        context.fillRect(0, 0, width, rulerHeight);
        context.strokeStyle = '#536d7a';
        context.fillStyle = '#d8e2e7';
        context.font = `${11 * ratio}px sans-serif`;
        const step = niceTick(range.duration / 8);
        const first = Math.ceil(range.start / step) * step;
        for (let time = first; time <= range.end + 0.0001; time += step) {
            const x = timeToX(time, range, width);
            context.beginPath();
            context.moveTo(x, 0);
            context.lineTo(x, rulerHeight);
            context.stroke();
            context.fillText(editor().formatTime(time).replace(/^00:/, ''), x + (3 * ratio), 17 * ratio);
        }
    }

    function drawWaveform(context, range, width, ratio) {
        const top = 34 * ratio;
        const height = 92 * ratio;
        const center = top + (height / 2);
        context.strokeStyle = '#7bdff2';
        context.lineWidth = Math.max(1, ratio);
        context.beginPath();
        if (!timeline.waveform?.peaks?.length) {
            context.moveTo(0, center);
            context.lineTo(width, center);
            context.stroke();
            return;
        }
        const peaks = timeline.waveform.peaks;
        const rate = Number(timeline.waveform.peaksPerSecond) || 50;
        for (let x = 0; x < width; x += Math.max(1, Math.floor(ratio))) {
            const startTime = range.start + ((x / width) * range.duration);
            const endTime = range.start + (((x + Math.max(1, ratio)) / width) * range.duration);
            const startIndex = Math.max(0, Math.floor(startTime * rate));
            const endIndex = Math.min(peaks.length, Math.max(startIndex + 1, Math.ceil(endTime * rate)));
            let peak = 0;
            for (let index = startIndex; index < endIndex; index += 1) peak = Math.max(peak, peaks[index] || 0);
            const amplitude = Math.max(1, peak * (height / 2));
            context.moveTo(x, center - amplitude);
            context.lineTo(x, center + amplitude);
        }
        context.stroke();
    }

    function drawScenes(context, range, width, height, ratio) {
        context.strokeStyle = '#e46b68';
        context.lineWidth = Math.max(1, ratio);
        for (const time of timeline.scenes) {
            if (time < range.start || time > range.end) continue;
            const x = timeToX(time, range, width);
            context.beginPath();
            context.moveTo(x, 28 * ratio);
            context.lineTo(x, height);
            context.stroke();
        }
    }

    function markers() {
        if (!editor()?.state.project) return [];
        if (!Array.isArray(editor().state.project.markers)) editor().state.project.markers = [];
        return editor().state.project.markers;
    }

    function drawMarkers(context, range, width, height, ratio) {
        context.strokeStyle = '#7ee787';
        context.fillStyle = '#b7f5c2';
        context.lineWidth = Math.max(2, ratio);
        context.font = `${11 * ratio}px sans-serif`;
        markers().forEach((marker, index) => {
            if (marker.time < range.start || marker.time > range.end) return;
            const x = timeToX(marker.time, range, width);
            context.beginPath();
            context.moveTo(x, 28 * ratio);
            context.lineTo(x, height);
            context.stroke();
            context.fillText(String(index + 1), x + (3 * ratio), 43 * ratio);
        });
    }

    function eventColor(type) {
        if (type === 'subtitle') return '#4ea699';
        if (type === 'note') return '#d97c95';
        return '#f3b33d';
    }

    function drawEvents(context, range, width, ratio) {
        const events = editor()?.state.project?.events || [];
        const selectedIds = new Set(editor()?.state.selectedEventIds || []);
        const top = 139 * ratio;
        const height = 30 * ratio;
        for (const event of events) {
            if (event.end < range.start || event.start > range.end) continue;
            const x1 = Math.max(0, timeToX(event.start, range, width));
            const x2 = Math.min(width, timeToX(Math.max(event.end, event.start + 0.04), range, width));
            context.fillStyle = eventColor(event.type);
            const eventWidth = Math.max(3 * ratio, x2 - x1);
            context.fillRect(x1, top, eventWidth, height);
            if (selectedIds.has(event.id)) {
                context.strokeStyle = '#ffffff';
                context.lineWidth = Math.max(2, 2 * ratio);
                context.strokeRect(x1, top, eventWidth, height);
            }
        }
    }

    function updateAccessibleSummary(range) {
        const sceneCount = timeline.scenes.length;
        el.summary.textContent = timeline.waveform
            ? t('description_subtitle_editor.waveform_ready_summary', {
                points: timeline.waveform.peaks.length,
                scenes: sceneCount,
                markers: markers().length
            })
            : t('description_subtitle_editor.waveform_waiting');

    }

    function drawTimeline(updateAccessibility = false) {
        timeline.drawPending = false;
        const { width, height, ratio } = canvasSize();
        const context = el.canvas.getContext('2d');
        const range = visibleRange();
        context.clearRect(0, 0, width, height);
        context.fillStyle = '#071015';
        context.fillRect(0, 0, width, height);
        drawRuler(context, range, width, ratio);
        drawWaveform(context, range, width, ratio);
        drawScenes(context, range, width, height, ratio);
        drawMarkers(context, range, width, height, ratio);
        drawEvents(context, range, width, ratio);

        const current = Number(el.video.currentTime) || 0;
        if (current >= range.start && current <= range.end && range.duration > 0) {
            const x = timeToX(current, range, width);
            context.strokeStyle = '#ffffff';
            context.lineWidth = 2 * ratio;
            context.beginPath();
            context.moveTo(x, 0);
            context.lineTo(x, height);
            context.stroke();
        }
        el.window.textContent = t('description_subtitle_editor.visible_range', {
            start: editor().formatTime(range.start),
            end: editor().formatTime(range.end),
            zoom: timeline.zoom
        });
        if (updateAccessibility) updateAccessibleSummary(range);
    }

    function scheduleDraw(updateAccessibility = false) {
        if (updateAccessibility) timeline.updateAccessibility = true;
        if (timeline.drawPending) return;
        timeline.drawPending = true;
        requestAnimationFrame(() => {
            const shouldUpdate = timeline.updateAccessibility;
            timeline.updateAccessibility = false;
            drawTimeline(shouldUpdate);
        });
    }

    function setAnalysisActive(kind = '') {
        timeline.analysisKind = kind;
        const active = Boolean(kind);
        el.progress.hidden = !active;
        el.cancel.hidden = !active;
        el.analyzeScenes.disabled = active || !timeline.sourcePath || editor()?.state.project?.source?.mediaType === 'audio';
        el.zoomIn.disabled = !timeline.waveform;
        el.zoomOut.disabled = !timeline.waveform;
        el.zoom.disabled = !timeline.waveform;
        if (!active) el.progress.value = 0;
    }

    async function generateWaveform() {
        if (!timeline.sourcePath) return;
        setAnalysisActive('waveform');
        editor().setStatus('description_subtitle_editor.waveform_analyzing');
        try {
            const result = await window.api.descriptionSubtitleEditorGenerateWaveform({
                filePath: timeline.sourcePath,
                duration: duration()
            });
            if (timeline.sourcePath !== editor().state.project?.source?.path) return;
            timeline.waveform = result;
            editor().state.project.analysis = {
                ...(editor().state.project.analysis || {}),
                fingerprint: result.fingerprint,
                waveformReady: true,
                sceneTimes: timeline.scenes
            };
            editor().setStatus(result.cached
                ? 'description_subtitle_editor.waveform_loaded_cache'
                : 'description_subtitle_editor.waveform_ready');
            scheduleDraw(true);
        } catch (error) {
            if (!String(error.message || error).includes('analysis_cancelled')) {
                editor().setStatus('description_subtitle_editor.waveform_failed', { error: error.message || String(error) });
            }
        } finally {
            setAnalysisActive('');
        }
    }

    async function analyzeScenes() {
        if (!timeline.sourcePath || editor()?.state.project?.source?.mediaType === 'audio') return;
        setAnalysisActive('scenes');
        editor().setStatus('description_subtitle_editor.scenes_analyzing');
        try {
            const result = await window.api.descriptionSubtitleEditorDetectScenes({
                filePath: timeline.sourcePath,
                duration: duration()
            });
            timeline.scenes = result.scenes || [];
            editor().state.project.analysis = {
                ...(editor().state.project.analysis || {}),
                fingerprint: result.fingerprint,
                sceneTimes: timeline.scenes
            };
            editor().setDirty(true);
            editor().setStatus('description_subtitle_editor.scenes_ready', { count: timeline.scenes.length });
            scheduleDraw(true);
        } catch (error) {
            if (!String(error.message || error).includes('analysis_cancelled')) {
                editor().setStatus('description_subtitle_editor.scenes_failed', { error: error.message || String(error) });
            }
        } finally {
            setAnalysisActive('');
        }
    }

    function changeZoom(value) {
        timeline.zoom = Math.max(1, Math.min(32, Number(value) || 1));
        el.zoom.value = String(timeline.zoom);
        if (editor().state.project?.workspace) editor().state.project.workspace.zoom = timeline.zoom;
        scheduleDraw(true);
        editor().setStatus('description_subtitle_editor.zoom_changed', { zoom: timeline.zoom });
    }

    function seekTo(time, announce = false) {
        const next = Math.max(0, Math.min(duration(), Number(time) || 0));
        el.video.currentTime = next;
        if (announce) editor().setStatus('description_subtitle_editor.position_changed', { time: editor().formatTime(next) });
        scheduleDraw(false);
    }

    const SHORTCUTS = {
        togglePlay: 'Space',
        playSelection: 'Shift+Space',
        pauseAt: 'K',
        pauseAndSet: 'Enter',
        playbackVolumeUp: 'ArrowUp',
        playbackVolumeDown: 'ArrowDown',
        scrubRight: 'ArrowRight',
        scrubLeft: 'ArrowLeft',
        scrubRight30: 'Mod+ArrowRight',
        scrubLeft30: 'Mod+ArrowLeft',
        scrubRight5m: 'Mod+Alt+ArrowRight',
        scrubLeft5m: 'Mod+Alt+ArrowLeft',
        seekF5: 'PageDown',
        seekB5: 'PageUp',
        goToStart: ['Mod+ArrowUp', 'Ctrl+Home'],
        goToEnd: ['Mod+ArrowDown', 'Ctrl+End'],
        goToMiddle: ['Mod+Shift+Delete', 'Ctrl+Shift+Backspace'],
        goToBeforeEnd: 'Shift+Delete',
        goToTime: 'Mod+G',
        markerNext: 'Alt+ArrowRight',
        markerPrev: 'Alt+ArrowLeft',
        sensIncr: 'Alt+ArrowDown',
        sensDecr: 'Alt+ArrowUp',
        addMarker: 'M',
        createDescriptionEvent: 'Mod+Enter',
        createDescriptionEventQuick: 'D',
        createSubtitleEventQuick: 'S',
        createReviewNoteQuick: 'A',
        editDescriptionReviewNote: 'Alt+N',
        importDescriptionSubtitles: null,
        exportDescriptionEvents: 'Mod+Shift+E',
        splitDescriptionEvent: null,
        mergeDescriptionEvents: null,
        synthesizeSelectedDescriptions: null,
        synthesizeAllDescriptions: null,
        renderDescribedVideo: null,
        findDescriptionText: 'Mod+F',
        replaceDescriptionText: 'Mod+H',
        focusDescriptionEventList: 'Alt+L',
        focusDescriptionPlayback: 'Alt+T',
        moveDescriptionEarlier: 'Alt+ArrowLeft',
        moveDescriptionLater: 'Alt+ArrowRight',
        moveDescriptionEarlierLarge: 'Alt+Shift+ArrowLeft',
        moveDescriptionLaterLarge: 'Alt+Shift+ArrowRight',
        moveDescriptionEarlierFine: 'G',
        moveDescriptionLaterFine: 'H',
        moveDescriptionEarlierSecond: 'Ctrl+J',
        moveDescriptionLaterSecond: 'Ctrl+L',
        deleteMarker: null,
        clearAllMarkers: null,
        announceCurrentTime: 'Mod+B'
    };

    function matchesBinding(event, binding) {
        if (!binding) return false;
        const parts = binding.split('+').map(part => part.trim().toLowerCase());
        const key = parts[parts.length - 1];
        const isMac = window.api.platform === 'darwin';
        const required = {
            ctrl: parts.includes('ctrl') || (!isMac && parts.includes('mod')),
            meta: parts.includes('meta') || parts.includes('cmd') || (isMac && parts.includes('mod')),
            alt: parts.includes('alt') || parts.includes('option'),
            shift: parts.includes('shift')
        };
        if (event.ctrlKey !== required.ctrl || event.metaKey !== required.meta
            || event.altKey !== required.alt || event.shiftKey !== required.shift) return false;
        if (key === 'space') return event.key === ' ';
        if (/^[a-z]$/.test(key)) return event.code === `Key${key.toUpperCase()}` || event.key.toLowerCase() === key;
        if (/^[0-9]$/.test(key)) return event.code === `Digit${key}` || event.key === key;
        return event.key.toLowerCase() === key;
    }

    function shortcutMatches(action, event) {
        const configured = Object.prototype.hasOwnProperty.call(timeline.userKeymap, action)
            ? timeline.userKeymap[action] : SHORTCUTS[action];
        const bindings = Array.isArray(configured) ? configured : [configured];
        return bindings.some(binding => matchesBinding(event, binding));
    }

    function isEditingControl(target) {
        if (!target) return false;
        if (target.closest?.('dialog[open], [role="listbox"], [role="option"]')) return true;
        if (target.isContentEditable) return true;
        return ['TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY'].includes(target.tagName)
            || (target.tagName === 'INPUT' && target.type !== 'range');
    }

    function isTimelinePlaybackSurface(target) {
        return Boolean(el.visual && (target === el.visual || el.visual.contains(target)));
    }

    function announcePosition(key = 'description_subtitle_editor.position_changed') {
        editor().setStatus(key, { time: editor().formatTime(el.video.currentTime) });
    }

    function togglePlayback(returnToStart = true) {
        if (!timeline.sourcePath) return;
        if (!el.video.paused) {
            el.video.pause();
            if (returnToStart && timeline.playbackStart !== null) seekTo(timeline.playbackStart, false);
            timeline.playbackStart = null;
            timeline.playRange = null;
            return;
        }
        timeline.playbackStart = Number(el.video.currentTime) || 0;
        timeline.playRange = null;
        el.video.play().catch(() => {});
    }

    function pauseAtCurrentPosition(toggleWhenPaused = false) {
        if (!el.video.paused) {
            el.video.pause();
            timeline.playbackStart = null;
            timeline.playRange = null;
            announcePosition();
            return;
        }
        if (toggleWhenPaused) {
            timeline.playbackStart = Number(el.video.currentTime) || 0;
            el.video.play().catch(() => {});
        } else {
            announcePosition();
        }
    }

    function scrubBy(seconds) {
        // Match a classic media player: seeking never changes the current play/pause state.
        const wasPlaying = !el.video.paused;
        clearTimeout(timeline.scrubTimer);
        seekTo((Number(el.video.currentTime) || 0) + seconds, false);
        if (wasPlaying) el.video.play().catch(() => {});
    }

    function setNavigationStep(next) {
        timeline.navigationStep = Math.max(0.01, Math.min(10, Number(next) || 1));

        editor().setStatus('description_subtitle_editor.navigation_step_changed', {
            step: timeline.navigationStep
        });
    }

    function addMarker() {
        const time = Number(el.video.currentTime) || 0;
        if (markers().some(marker => Math.abs(marker.time - time) < 0.1)) {
            editor().setStatus('description_subtitle_editor.marker_exists', { time: editor().formatTime(time) });
            return;
        }
        const marker = {
            id: `marker-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time,
            label: ''
        };
        markers().push(marker);
        markers().sort((a, b) => a.time - b.time);
        editor().setDirty(true);
        editor().setStatus('description_subtitle_editor.marker_added', {
            index: markers().indexOf(marker) + 1,
            time: editor().formatTime(time),
            count: markers().length
        });
        scheduleDraw(true);
        window.dispatchEvent(new CustomEvent('evd-description-markers-changed'));
    }

    function removeCurrentMarker() {
        const list = markers();
        let index = -1;
        let distance = Infinity;
        list.forEach((marker, markerIndex) => {
            const difference = Math.abs(marker.time - el.video.currentTime);
            if (difference < distance) {
                distance = difference;
                index = markerIndex;
            }
        });
        if (index < 0 || distance > 0.5) {
            editor().setStatus('description_subtitle_editor.marker_not_here');
            return;
        }
        const [removed] = list.splice(index, 1);
        editor().setDirty(true);
        editor().setStatus('description_subtitle_editor.marker_removed', {
            time: editor().formatTime(removed.time),
            count: list.length
        });
        scheduleDraw(true);
        window.dispatchEvent(new CustomEvent('evd-description-markers-changed'));
    }

    function goToMarker(direction) {
        const current = Number(el.video.currentTime) || 0;
        const list = markers();
        const marker = direction > 0
            ? list.find(item => item.time > current + 0.1)
            : [...list].reverse().find(item => item.time < current - 0.1);
        if (!marker) {
            editor().setStatus(direction > 0
                ? 'description_subtitle_editor.no_next_marker'
                : 'description_subtitle_editor.no_previous_marker');
            return;
        }
        seekTo(marker.time, false);
        editor().setStatus(direction > 0
            ? 'description_subtitle_editor.next_marker'
            : 'description_subtitle_editor.previous_marker', {
            index: list.indexOf(marker) + 1,
            time: editor().formatTime(marker.time)
        });
    }

    function getActiveMarkerPair() {
        const list = markers();
        if (list.length < 2) return null;
        const current = Number(el.video.currentTime) || 0;
        let endIndex = list.findIndex(marker => marker.time > current + 0.05);
        if (endIndex <= 0) endIndex = current >= list[list.length - 1].time ? list.length - 1 : 1;
        return {
            start: list[endIndex - 1].time,
            end: list[endIndex].time,
            startMarker: list[endIndex - 1],
            endMarker: list[endIndex]
        };
    }

    function previewRange(start, end, options = {}) {
        const rangeStart = Math.max(0, Number(start) || 0);
        const rangeEnd = Math.min(duration(), Math.max(rangeStart, Number(end) || rangeStart));
        if (rangeEnd <= rangeStart) return false;
        el.video.pause();
        clearTimeout(timeline.scrubTimer);
        seekTo(rangeStart, false);
        timeline.playbackStart = rangeStart;
        timeline.playRange = {
            start: rangeStart,
            end: rangeEnd,
            finishKey: String(options.finishKey || '')
        };
        el.video.play().catch(() => {});
        if (options.statusKey) {
            editor().setStatus(options.statusKey, {
                start: editor().formatTime(rangeStart),
                end: editor().formatTime(rangeEnd)
            });
        }
        return true;
    }

    function playMarkerRange() {
        const pair = getActiveMarkerPair();
        if (!pair) {
            editor().setStatus('description_subtitle_editor.marker_pair_required');
            return;
        }
        previewRange(pair.start, pair.end, {
            statusKey: 'description_subtitle_editor.marker_range_playing',
            finishKey: 'description_subtitle_editor.marker_range_finished'
        });
    }
    function showGotoDialog() {
        el.gotoInput.value = editor().formatTime(el.video.currentTime);
        if (!el.gotoDialog.open) el.gotoDialog.showModal();
        requestAnimationFrame(() => {
            el.gotoInput.focus();
            el.gotoInput.select();
        });
    }

    function parseTimecode(value) {
        const parts = String(value || '').trim().replace(',', '.').split(':').map(Number);
        if (!parts.length || parts.some(part => !Number.isFinite(part) || part < 0)) return null;
        if (parts.length === 1) return parts[0];
        if (parts.length === 2) return (parts[0] * 60) + parts[1];
        if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
        return null;
    }

    function handleTimelineKeys(event) {
        // The manual narration dialog owns its own transport and marker shortcuts.
        if (event.target?.closest?.('#human-manual-match-dialog[open]')) return;
        if (!editor()?.state.sourceAvailable) return;
        const focusTarget = shortcutMatches('focusDescriptionEventList', event)
            ? 'list'
            : (shortcutMatches('focusDescriptionPlayback', event) ? 'playback' : '');
        const focusNavigationBlocked = event.target?.closest?.('dialog[open]')
            || event.target?.isContentEditable
            || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName);
        if (focusTarget && !focusNavigationBlocked) {
            event.preventDefault();
            event.stopImmediatePropagation();
            window.dispatchEvent(new CustomEvent('evd-description-focus-requested', {
                detail: { target: focusTarget }
            }));
            return;
        }
        // Playback, seeking and marker commands belong to the focused timeline only.
        // Keeping this listener global made Enter on details/summary controls toggle video playback.
        if (!isTimelinePlaybackSurface(event.target)) return;
        if (isEditingControl(event.target)) return;
        let handled = true;
        if (shortcutMatches('announceCurrentTime', event)) announcePosition('description_subtitle_editor.current_position');
        else if (shortcutMatches('togglePlay', event)) togglePlayback(false);
        else if (shortcutMatches('playSelection', event)) playMarkerRange();
        else if (shortcutMatches('pauseAt', event)) pauseAtCurrentPosition(false);
        else if (shortcutMatches('pauseAndSet', event)) pauseAtCurrentPosition(true);
        else if (shortcutMatches('playbackVolumeUp', event)) editor().adjustPlaybackVolume(5, false);
        else if (shortcutMatches('playbackVolumeDown', event)) editor().adjustPlaybackVolume(-5, false);
        else if (shortcutMatches('scrubRight', event)) scrubBy(timeline.navigationStep);
        else if (shortcutMatches('scrubLeft', event)) scrubBy(-timeline.navigationStep);
        else if (shortcutMatches('scrubRight30', event)) scrubBy(30);
        else if (shortcutMatches('scrubLeft30', event)) scrubBy(-30);
        else if (shortcutMatches('scrubRight5m', event)) scrubBy(300);
        else if (shortcutMatches('scrubLeft5m', event)) scrubBy(-300);
        else if (shortcutMatches('seekF5', event)) scrubBy(5);
        else if (shortcutMatches('seekB5', event)) scrubBy(-5);
        else if (shortcutMatches('goToStart', event)) seekTo(0, true);
        else if (shortcutMatches('goToEnd', event)) seekTo(duration(), true);
        else if (shortcutMatches('goToMiddle', event)) seekTo(duration() / 2, true);
        else if (shortcutMatches('goToBeforeEnd', event)) seekTo(Math.max(0, duration() - 30), true);
        else if (shortcutMatches('goToTime', event)) showGotoDialog();
        else if (shortcutMatches('markerNext', event)) goToMarker(1);
        else if (shortcutMatches('markerPrev', event)) goToMarker(-1);
        else if (shortcutMatches('sensIncr', event)) setNavigationStep(Math.min(10, timeline.navigationStep * 2));
        else if (shortcutMatches('sensDecr', event)) setNavigationStep(Math.max(0.01, timeline.navigationStep / 2));
        else if (shortcutMatches('addMarker', event)) addMarker();
        else if (shortcutMatches('createDescriptionEvent', event)) {
            window.dispatchEvent(new CustomEvent('evd-description-create-event-requested'));
        }
        else if (shortcutMatches('createDescriptionEventQuick', event)) {
            window.dispatchEvent(new CustomEvent('evd-description-create-event-requested', { detail: { type: 'description' } }));
        }
        else if (shortcutMatches('createSubtitleEventQuick', event)) {
            window.dispatchEvent(new CustomEvent('evd-description-create-event-requested', { detail: { type: 'subtitle' } }));
        }
        else if (shortcutMatches('createReviewNoteQuick', event)) {
            window.dispatchEvent(new CustomEvent('evd-description-create-event-requested', { detail: { type: 'note' } }));
        }
        else if (shortcutMatches('deleteMarker', event)) removeCurrentMarker();
        else if (shortcutMatches('clearAllMarkers', event)) {
            markers().splice(0);
            editor().setDirty(true);
            editor().setStatus('description_subtitle_editor.markers_cleared');
            scheduleDraw(true);
            window.dispatchEvent(new CustomEvent('evd-description-markers-changed'));
        } else handled = false;

        if (handled) {
            // The surface is announced on focus; suppress its name during repeated editing keys.
            el.visual.removeAttribute('aria-label');
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }
    function bind() {
        const restoreAccessibleName = () => {
            el.visual.setAttribute('aria-label', t('description_subtitle_editor.timeline_keyboard_surface_name'));
        };
        restoreAccessibleName();
        el.visual.addEventListener('focus', restoreAccessibleName);
        el.visual.addEventListener('blur', restoreAccessibleName);
        window.addEventListener('evd-description-preferences-updated', event => {
            timeline.userKeymap = event.detail?.userKeymap || {};
            timeline.navigationStep = Math.max(0.01, Number(event.detail?.navigationStep) || 1);
        });
        window.addEventListener('evd-description-events-changed', () => scheduleDraw(false));
        window.addEventListener('evd-description-source-loaded', event => {
            timeline.userKeymap = editor().state.preferences?.userKeymap || timeline.userKeymap;
            timeline.navigationStep = Math.max(0.01,
                Number(editor().state.preferences?.navigationStep) || timeline.navigationStep);
            timeline.sourcePath = event.detail?.source?.path || '';
            timeline.waveform = null;
            timeline.scenes = Array.isArray(editor().state.project?.analysis?.sceneTimes)
                ? editor().state.project.analysis.sceneTimes : [];
            timeline.zoom = Math.max(1, Number(editor().state.project?.workspace?.zoom) || 1);
            el.zoom.value = String(timeline.zoom);
            setAnalysisActive('');
            scheduleDraw(true);
            generateWaveform();
            requestAnimationFrame(() => el.visual.focus());
        });
        window.api.onDescriptionSubtitleAnalysisProgress(payload => {
            if (!timeline.analysisKind || payload?.kind !== timeline.analysisKind) return;
            el.progress.value = Number(payload.percent) || 0;
        });
        el.video.addEventListener('timeupdate', () => {
            if (timeline.playRange && el.video.currentTime >= timeline.playRange.end - 0.01) {
                const completedRange = timeline.playRange;
                el.video.pause();
                timeline.playRange = null;
                timeline.playbackStart = null;
                seekTo(completedRange.start, false);
                if (completedRange.finishKey) {
                    editor().setStatus(completedRange.finishKey);
                }
            }
            scheduleDraw(false);
        });
        el.video.addEventListener('loadedmetadata', () => {
            timeline.sourcePath = editor()?.state.project?.source?.path || timeline.sourcePath;
            scheduleDraw(true);
        });
        document.addEventListener('keydown', handleTimelineKeys, true);
        el.visual.addEventListener('click', event => {
            const rect = el.visual.getBoundingClientRect();
            const range = visibleRange();
            seekTo(range.start + (((event.clientX - rect.left) / rect.width) * range.duration), true);
            el.visual.focus();
        });
        el.zoom.addEventListener('change', () => changeZoom(el.zoom.value));
        el.zoomIn.addEventListener('click', () => changeZoom(Math.min(32, timeline.zoom * 2)));
        el.zoomOut.addEventListener('click', () => changeZoom(Math.max(1, timeline.zoom / 2)));
        el.analyzeScenes.addEventListener('click', analyzeScenes);
        el.gotoForm.addEventListener('submit', event => {
            event.preventDefault();
            const target = parseTimecode(el.gotoInput.value);
            if (target === null) {
                editor().setStatus('description_subtitle_editor.invalid_timecode');
                return;
            }
            el.gotoDialog.close();
            seekTo(target, true);
            el.visual.focus();
        });
        el.gotoCancel.addEventListener('click', () => {
            el.gotoDialog.close();
            el.visual.focus();
        });

        el.cancel.addEventListener('click', async () => {
            await window.api.descriptionSubtitleEditorCancelAnalysis();
            editor().setStatus('description_subtitle_editor.analysis_cancelled');
            setAnalysisActive('');
        });
        const resizeObserver = new ResizeObserver(() => scheduleDraw(false));
        resizeObserver.observe(el.visual);
        window.addEventListener('beforeunload', () => {
            resizeObserver.disconnect();
            window.api.descriptionSubtitleEditorCancelAnalysis();
        });
    }

    function init() {
        timeline.userKeymap = editor()?.state.preferences?.userKeymap || {};
        timeline.navigationStep = Math.max(0.01,
            Number(editor()?.state.preferences?.navigationStep) || 1);
        Object.assign(el, {
            video: document.getElementById('video-preview'),
            visual: document.getElementById('timeline-visual'),
            canvas: document.getElementById('waveform-canvas'),
            zoom: document.getElementById('timeline-zoom'),
            zoomIn: document.getElementById('zoom-in'),
            zoomOut: document.getElementById('zoom-out'),
            analyzeScenes: document.getElementById('analyze-scenes'),
            cancel: document.getElementById('cancel-analysis'),
            progress: document.getElementById('analysis-progress'),
            summary: document.getElementById('waveform-summary'),
            window: document.getElementById('timeline-window'),
            gotoDialog: document.getElementById('goto-time-dialog'),
            gotoForm: document.getElementById('goto-time-form'),
            gotoInput: document.getElementById('goto-time-input'),
            gotoCancel: document.getElementById('goto-time-cancel')
        });
        bind();
        setAnalysisActive('');
        scheduleDraw(true);
    }

    function focusPlaybackSurface() {
        el.visual?.focus();
    }

    window.EvdDescriptionTimeline = {
        focusPlaybackSurface,
        matchesShortcut: shortcutMatches,
        getActiveMarkerPair,
        previewRange,
        refresh: () => scheduleDraw(false),
        seekTo
    };
    document.addEventListener('DOMContentLoaded', init);
})();
