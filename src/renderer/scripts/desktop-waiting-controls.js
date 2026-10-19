function createDesktopWaitingControls({ document, t, context, request, announce }) {
    const panel = document.getElementById('desktop-waiting-queue');
    const list = document.getElementById('desktop-waiting-list');
    const status = document.getElementById('desktop-waiting-status');
    const allButton = document.getElementById('desktop-waiting-admit-all');
    const tr = (key, params) => t(`desktop_cloud.${key}`, '', params);
    let roomId = '', rows = [], busy = false, polling = false, generation = 0;
    let cancelGuest = null;
    const seenRequestIds = new Set();
    function setStatusText(element, text) {
        if (element.textContent !== text) element.textContent = text;
    }
    function update() {
        const next = context();
        const id = next.allowed ? next.roomId : '';
        panel.hidden = !id;
        if (id !== roomId) {
            roomId = id; generation++; rows = []; seenRequestIds.clear(); list.replaceChildren();
        }
        allButton.disabled = busy || !rows.length;
    }
    async function call(action, data = {}) {
        return request(`/broadcast-room/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId, ...data }) });
    }
    function receiveRequests(requests) {
        rows = Array.isArray(requests) ? requests : [];
        const arrivals = [];
        for (const row of rows) {
            if (typeof row.requestId !== 'string' || !row.requestId || seenRequestIds.has(row.requestId)) continue;
            seenRequestIds.add(row.requestId);
            arrivals.push(row);
        }
        // Global announcements remain audible when the details panel is closed.
        // Track IDs across polls/removals; rendering and busy changes never announce arrivals.
        return arrivals.length ? t('waiting_room.new_requests', '', {
            count: arrivals.length, names: arrivals.map(row => row.displayName).filter(Boolean).join(', ')
        }) : '';
    }
    function render() {
        allButton.disabled = busy || !rows.length;
        setStatusText(status, tr('waiting_count', { count: rows.length }));
        const signature = JSON.stringify([rows, busy]);
        if (list.dataset.signature === signature) return;
        list.dataset.signature = signature;
        const focus = document.activeElement?.dataset?.waitingAction;
        list.replaceChildren();
        for (const row of rows) {
            const item = document.createElement('li');
            for (const decision of ['approve', 'reject']) {
                const button = document.createElement('button');
                button.type = 'button'; button.disabled = busy;
                button.textContent = tr(decision, { name: row.displayName });
                button.dataset.waitingAction = `${row.requestId}:${decision}`;
                button.addEventListener('click', () => decide({ requestId: row.requestId, decision }));
                item.append(button);
            }
            list.append(item);
        }
        if (focus) ([...list.querySelectorAll('button')].find(el => el.dataset.waitingAction === focus && !el.disabled) || panel.querySelector('summary')).focus();
    }
    async function refresh() {
        update();
        if (!roomId || polling || busy) return;
        const current = generation; polling = true;
        try {
            const result = await call('waiting-list'); update();
            if (current !== generation) return;
            const arrivalMessage = receiveRequests(result.requests);
            render();
            if (arrivalMessage) announce(arrivalMessage);
        } catch (_) { if (current === generation) setStatusText(status, tr('error')); }
        finally { polling = false; }
    }
    async function decide(data) {
        update();
        if (!roomId || busy) return;
        const current = generation; busy = true; render();
        try {
            const result = await call('waiting-decision', data); update();
            if (current === generation) {
                const arrivalMessage = receiveRequests(result.requests);
                announce([tr('waiting_updated'), arrivalMessage].filter(Boolean).join(' '));
            }
        } catch (_) { if (current === generation) announce(tr('error')); }
        finally { busy = false; render(); }
    }
    async function disableDecision(origin = document.activeElement) {
        update();
        if (!roomId) return 'reject';
        const result = await call('waiting-list');
        if (!result.requests?.length) return 'reject';
        const dialog = document.getElementById('desktop-waiting-disable-dialog');
        return new Promise(resolve => {
            dialog.returnValue = '';
            dialog.addEventListener('close', () => {
                origin?.focus();
                resolve(dialog.returnValue);
            }, { once: true });
            dialog.showModal(); document.getElementById('desktop-waiting-disable-message').focus();
            announce(tr('waiting_disable_message'));
        });
    }
    function cancel() { cancelGuest?.(); }
    async function waitForAdmission(inviteId, waiting) {
        cancel();
        const box = document.getElementById('desktop-waiting-guest');
        const message = document.getElementById('desktop-waiting-guest-status');
        const cancelButton = document.getElementById('desktop-waiting-cancel');
        const credentials = { requestId: waiting.requestId, secret: waiting.secret };
        const guestCall = action => request(`/broadcast-room/${action}`, { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteId, waiting: credentials }) });
        return new Promise(resolve => {
            let finished = false, timer;
            function finish(result) {
                if (finished) return; finished = true; clearTimeout(timer); box.hidden = true;
                cancelButton.removeEventListener('click', onCancel);
                if (cancelGuest === onCancel) cancelGuest = null;
                if (!result) document.getElementById('btn-join-existing-room')?.focus();
                resolve(result);
            }
            function onCancel() { guestCall('waiting-cancel').catch(() => {}); finish(null); }
            async function poll() {
                if (Date.now() >= Number(waiting.expiresAt || Infinity)) { announce(tr('waiting_ended')); finish(null); return; }
                try {
                    const result = await guestCall('waiting-status');
                    if (finished) return;
                    if (result.waiting?.status === 'approved') { finish(credentials); return; }
                    if (result.waiting?.status !== 'pending') {
                        announce(tr('waiting_ended')); finish(null); return;
                    }
                    setStatusText(message, tr('waiting_pending'));
                } catch (_) { if (!finished) setStatusText(message, tr('waiting_retry')); }
                if (!finished) timer = setTimeout(poll, 2000);
            }
            cancelGuest = onCancel; cancelButton.addEventListener('click', onCancel);
            box.hidden = false; setStatusText(message, tr('waiting_pending')); announce(message.textContent);
            cancelButton.focus(); timer = setTimeout(poll, 2000);
        });
    }
    allButton.addEventListener('click', () => decide({ all: true, decision: 'approve' }));
    const timer = setInterval(refresh, 3000);
    return { update, refresh, disableDecision, waitForAdmission, cancel,
        admitAll: () => decide({ all: true, decision: 'approve' }),
        dispose() { clearInterval(timer); cancel(); generation++; } };
}
module.exports = { createDesktopWaitingControls };
