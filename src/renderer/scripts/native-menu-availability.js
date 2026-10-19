(() => {
    let pending = false;
    let previous = '';
    function update() {
        pending = false;
        if (typeof Timeline === 'undefined' || !window.api?.send) return;
        const el = document.activeElement;
        const text = !!el && (el.matches('textarea, input:not([type]), input[type=text], input[type=search], input[type=password], input[type=email], input[type=url], input[type=tel], input[type=number]') || el.isContentEditable);
        const selectedText = text && (typeof el.selectionStart === 'number'
            ? el.selectionEnd > el.selectionStart : !window.getSelection()?.isCollapsed);
        const activeTab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
        const state = {
            media: !!activeTab && Timeline.getTotalDuration() > 0,
            loaded: !!activeTab,
            selectionQueue: typeof App !== 'undefined' && App.verticalClipQueue.length > 0,
            selection: typeof Selection !== 'undefined' && (Selection.getSelection()?.duration || 0) > 0,
            undo: !!activeTab && Timeline.undoStack.length > 0,
            redo: !!activeTab && Timeline.redoStack.length > 0,
            undoAction: Timeline.undoStack.length ? Timeline.historyLabel(Timeline.undoStack[Timeline.undoStack.length-1], true) : '',
            redoAction: Timeline.redoStack.length ? Timeline.historyLabel(Timeline.redoStack[Timeline.redoStack.length-1], true) : '',
            paste: !!Timeline.clipboard?.segments?.length || (typeof TabManager !== 'undefined' && !!TabManager.clipboard?.length),
            markers: typeof Markers !== 'undefined' && Markers.markers.length >= 2,
            anyMarkers: typeof Markers !== 'undefined' && Markers.markers.length > 0,
            activeTransition: typeof Transitions !== 'undefined' && !!Transitions.activeTransition,
            transitions: typeof Transitions !== 'undefined' && Transitions.appliedTransitions.length > 0,
            text,
            writable: text && !el.disabled && !el.readOnly && el.getAttribute('aria-readonly') !== 'true',
            textSelection: !!selectedText,
            textContent: text && !!(el.value || el.textContent),
            textUndo: text && document.queryCommandEnabled('undo'),
            textRedo: text && document.queryCommandEnabled('redo')
        };
        const serialized = JSON.stringify(state);
        if (serialized !== previous) {
            previous = serialized;
            window.api.send('editor-menu-availability', state);
        }
    }
    function schedule() {
        if (pending) return;
        pending = true;
        queueMicrotask(update);
    }
    // Event-driven: no polling and no native menu rebuilds while navigating.
    for (const event of ['editor-menu-state-changed', 'selectionchange', 'focusin', 'focusout', 'input', 'keyup', 'pointerup']) {
        document.addEventListener(event, schedule, true);
    }
    window.addEventListener('focus', schedule);
    schedule();
})();
