function createTransientStatus(element) {
    let timer, version = 0, lastKey;
    function clear() {
        clearTimeout(timer); version++;
        if (element.textContent) element.textContent = '';
    }
    return {
        show(text, key = text) {
            if (key === lastKey) return;
            lastKey = key; clear();
            if (!text) return;
            element.textContent = text;
            const current = version;
            timer = setTimeout(() => {
                if (current === version && element.textContent === text) element.textContent = '';
            }, 6000);
            timer?.unref?.();
        },
        reset() { clear(); lastKey = undefined; },
        dispose: clear
    };
}

function createRecordingNoticeController(element, translate) {
    const transient = createTransientStatus(element);
    let roomId, confirmed = 'stopped', sequence = 0;
    return {
        update(nextRoomId, status) {
            if (nextRoomId !== roomId) { roomId = nextRoomId; confirmed = 'stopped'; transient.reset(); }
            let next, key;
            if (status === 'active') { next = 'active'; key = confirmed === 'paused' ? 'resumed' : 'started'; }
            else if (status === 'paused') { next = 'paused'; key = 'paused'; }
            else if (['idle', 'assembling', 'complete'].includes(status)) { next = 'stopped'; key = 'stopped'; }
            // Transitional and unknown states are not evidence that capture changed.
            if (!next || next === confirmed) return;
            confirmed = next;
            transient.show(translate(`admin_auth.recording_notice_${key === 'started' ? 'active' : key}`), ++sequence);
        },
        dispose() { transient.dispose(); }
    };
}
module.exports = { createTransientStatus, createRecordingNoticeController };
