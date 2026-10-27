/* Pointer controls reuse editor commands; their keyboard bindings remain unchanged. */
(() => {
    'use strict';
    function init() {
        const visual = document.getElementById('timeline-visual');
        if (!visual) return;
        const timelineSection=document.getElementById('timeline-section');
        timelineSection?.addEventListener('focus',()=>{
            VideoPlayer.updateDurationDisplay();
        });
        const t = key => window.i18nHelper.t(`timeline_pointer.${key}`);
        const toolbar = document.createElement('div');
        toolbar.className = 'timeline-pointer-tools';
        const actions = {
            play: () => VideoPlayer.togglePlay(),
            preview: () => VideoPlayer.playSelection(),
            cutPreview: () => VideoPlayer.playCutPreview(),
            cut: () => App.cut(), copy: () => App.copy(), paste: () => App.paste(),
            delete: () => App.delete(), undo: () => App.undo(), redo: () => App.redo(),
            queue: () => App.addSelectionToVerticalQueue(), clear: () => Selection.clear()
        };
        for (const [name, action] of Object.entries(actions)) {
            const button = document.createElement('button');
            button.type = 'button';
            // Pointer duplicates remain discoverable with a virtual cursor; the
            // editor menus and keyboard commands provide their keyboard equivalents.
            button.tabIndex = -1;
            button.dataset.i18n = `timeline_pointer.${name}`;
            button.textContent = t(name);
            button.dataset.action = name;
            button.addEventListener('click', action);
            toolbar.append(button);
        }
        const zoomLabel = document.createElement('label');
        zoomLabel.htmlFor = 'timeline-pointer-zoom';
        zoomLabel.dataset.i18n = 'timeline_pointer.zoom';
        zoomLabel.textContent = t('zoom');
        const zoom = document.createElement('input');
        zoom.id = zoomLabel.htmlFor; zoom.type = 'range'; zoom.min = '1'; zoom.max = '20'; zoom.value = '1';
        zoom.tabIndex = -1;
        const hint = document.createElement('p');
        hint.dataset.i18n = 'timeline_pointer.hint'; hint.textContent = t('hint');
        const position = document.createElement('output');
        position.setAttribute('aria-hidden', 'true');
        toolbar.append(zoomLabel, zoom, position);
        const viewport = document.createElement('div');
        viewport.className = 'timeline-pointer-viewport';
        // Chromium can automatically add scroll containers to sequential focus.
        viewport.tabIndex = -1;
        visual.before(toolbar, hint, viewport); viewport.append(visual);
        zoom.addEventListener('input', () => { visual.style.width = `${Number(zoom.value) * 100}%`; });
        const timeAt = x => {
            const rect = visual.getBoundingClientRect();
            return Math.max(0, Math.min(1, (x - rect.left) / Math.max(1, rect.width))) * Timeline.getTotalDuration();
        };
        const seek = time => {
            VideoPlayer.cursorPosition = time;
            VideoPlayer.seekToTimelineTime(time);
            VideoPlayer.updateCursorDisplay();
        };
        let drag = null;
        visual.addEventListener('pointerdown', event => {
            if (event.button !== 0 || !VideoPlayer.video || !VideoPlayer.hasVideo() || drag) return;
            event.preventDefault();
            const anchor = timeAt(event.clientX);
            drag = { id: event.pointerId, x: event.clientX, anchor, moved: false,
                selection: Selection.getSelection(), position: VideoPlayer.getTimelineTime() };
            VideoPlayer.pause({ announce: false });
            Selection.clear(true);
            visual.setPointerCapture(event.pointerId);
        });
        visual.addEventListener('pointermove', event => {
            const end = timeAt(event.clientX);
            position.textContent = Utils.formatTime(end);
            if (!drag || drag.id !== event.pointerId) return;
            if (Math.abs(event.clientX - drag.x) >= 4) drag.moved = true;
            if (drag.moved) Selection.setSelectionSilent(Math.min(drag.anchor, end), Math.max(drag.anchor, end));
        });
        function finish(event, cancelled) {
            if (!drag || drag.id !== event.pointerId) return;
            const state = drag; drag = null;
            if (visual.hasPointerCapture(event.pointerId)) visual.releasePointerCapture(event.pointerId);
            if (cancelled) {
                if (state.selection) Selection.setSelectionSilent(state.selection.start, state.selection.end);
                else Selection.clear(true);
                seek(state.position);
            } else {
                const end = timeAt(event.clientX);
                if (state.moved && Math.abs(end - state.anchor) > 0.001) {
                    Selection.setSelection(Math.min(state.anchor, end), Math.max(state.anchor, end));
                } else Selection.clear(true);
                seek(state.moved ? end : state.anchor);
            }
            update();
        }
        visual.addEventListener('pointerup', e => finish(e, false));
        visual.addEventListener('pointercancel', e => finish(e, true));
        visual.addEventListener('lostpointercapture', e => finish(e, true));
        function update() {
            const media = !!VideoPlayer.video && VideoPlayer.hasVideo();
            const selected = Selection.hasSelection();
            for (const button of toolbar.querySelectorAll('button')) {
                const action = button.dataset.action;
                button.disabled = !media || (['preview','cutPreview','cut','copy','delete','queue','clear'].includes(action) && !selected)
                    || (action === 'undo' && !Timeline.undoStack.length)
                    || (action === 'redo' && !Timeline.redoStack.length)
                    || (action === 'paste' && !Timeline.clipboard);
            }
            zoom.disabled = !media;
        }
        document.addEventListener('editor-menu-state-changed', update);
        update();
    }
    document.addEventListener('DOMContentLoaded', init);
})();
