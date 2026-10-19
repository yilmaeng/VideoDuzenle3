(() => {
    'use strict';
    let context, panel, list, message, enabled, disableDecision, allButton, timer, busy = false, settingDirty = false;
    const rows = new Map();
    const seenRequests = new Set();
    let polling = false, roomIdentity = '', revision = 0, pollFailed = false, liveRegion, disclosure, body;
    const announce = (value, force = false) => {
        if (message.textContent !== value) message.textContent = value;
        if (force || liveRegion.textContent !== value) liveRegion.textContent = value;
    };
    const t = key => context.t('waiting_room.' + key);
    function button(label, action) {
        const node = document.createElement('button'); node.type = 'button'; node.textContent = label;
        node.addEventListener('click', action); return node;
    }
    function labeledControl(parent, id, labelText, control) {
        const label = document.createElement('label'); label.htmlFor = id; label.textContent = labelText;
        control.id = id; parent.append(label, control); return control;
    }
    async function request(action, body = {}) {
        const state = context.state(), temporary = state.participantRole === 'co_host';
        const response = await fetch(`${temporary ? '/api/meeting-access' : '/api/admin-auth/meeting'}/${encodeURIComponent(state.room.roomId)}/${action}`, {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json',
                ...(temporary ? { 'X-EVD-Participant-Identity': state.participantIdentity, 'X-EVD-Participant-Key': state.participantApiKey } : {}) },
            body: JSON.stringify(body)
        });
        const result = await response.json();
        if (!response.ok || result.success === false) throw new Error(result.error);
        return result;
    }
    async function mutation(action, body) {
        if (busy) return;
        busy = true;
        revision += 1;
        try { await request(action, body); if (action === 'waiting-setting') settingDirty = false; announce(t('updated')); }
        catch (error) { announce(t(error.message === 'waiting_disable_decision_required' ? 'disable_required' : 'failed')); }
        finally { busy = false; await poll(); }
    }
    async function poll() {
        const state = context.state();
        const active = !!state.roomConnection && (state.participantRole === 'co_host' || (state.webHost && state.participantRole === 'host'));
        panel.hidden = !active;
        const nextIdentity = active ? state.room?.roomId || '' : '';
        if (roomIdentity !== nextIdentity) {
            roomIdentity = nextIdentity; revision += 1;
            rows.clear(); seenRequests.clear(); list.replaceChildren(); announce('');
            settingDirty = false; pollFailed = false; disableDecision.value = ''; allButton.disabled = true;
            body.hidden = true; disclosure.setAttribute('aria-expanded', 'false');
        }
        if (!active || busy || polling) return;
        polling = true;
        const currentIdentity = roomIdentity, currentRevision = revision;
        try {
            const result = await request('waiting-list');
            if (currentIdentity !== roomIdentity || currentIdentity !== context.state().room?.roomId || currentRevision !== revision || !context.state().roomConnection) return;
            pollFailed = false;
            if (!settingDirty) enabled.checked = result.waitingRoomEnabled;
            enabled.parentElement.hidden = state.participantRole === 'co_host';
            const ids = new Set(result.requests.map(item => item.requestId));
            for (const [id, row] of rows) if (!ids.has(id)) {
                if (row.contains(document.activeElement)) disclosure.focus();
                row.remove(); rows.delete(id);
            }
            const arrivals = [];
            for (const item of result.requests) {
                if (rows.has(item.requestId)) continue;
                if (!seenRequests.has(item.requestId)) arrivals.push(item.displayName);
                seenRequests.add(item.requestId);
                const row = document.createElement('li'), name = document.createElement('span');
                name.textContent = item.displayName; row.append(name);
                for (const decision of ['approve', 'reject']) row.append(button(`${t(decision)}: ${item.displayName}`, () => mutation('waiting-decision', { requestId: item.requestId, decision })));
                rows.set(item.requestId, row); list.append(row);
            }
            allButton.disabled = !rows.size;
            if (arrivals.length) announce(t('new_requests').replace('{count}', String(arrivals.length)).replace('{names}', arrivals.slice(0, 3).join(', ')), true);
        } catch (_error) {
            if (currentIdentity === roomIdentity && currentIdentity === context.state().room?.roomId && currentRevision === revision && !pollFailed) {
                pollFailed = true; announce(t('failed'));
            }
        } finally { polling = false; }
    }
    function init(value) {
        if (context) return;
        context = value;
        const host = document.getElementById('web-host-panel'); if (!host) return;
        panel = document.createElement('section'); panel.hidden = true;
        body = document.createElement('div'); body.id = 'waiting-room-controls'; body.hidden = true;
        disclosure = button('', () => {
            body.hidden = !body.hidden;
            disclosure.setAttribute('aria-expanded', String(!body.hidden));
        });
        disclosure.id = 'waiting-room-toggle'; disclosure.setAttribute('aria-expanded', 'false');
        disclosure.setAttribute('aria-controls', body.id); disclosure.setAttribute('aria-label', t('title'));
        const icon = document.createElement('span'); icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '\u231b';
        const label = document.createElement('span'); label.textContent = t('title'); disclosure.append(icon, label);
        panel.setAttribute('aria-labelledby', disclosure.id); panel.append(disclosure, body);
        const settings = document.createElement('div'); settings.dataset.settingControls = '';
        enabled = document.createElement('input'); enabled.type = 'checkbox';
        enabled.addEventListener('change', () => { settingDirty = true; });
        labeledControl(settings, 'host-waiting-enabled', t('enabled'), enabled);
        disableDecision = document.createElement('select');
        for (const [key, label] of [['', 'disable_choice'], ['admit', 'admit_all'], ['reject', 'reject_all']]) {
            const option = document.createElement('option'); option.value = key; option.textContent = t(label); disableDecision.append(option);
        }
        labeledControl(settings, 'host-waiting-disable', t('disable_label'), disableDecision);
        settings.append(button(t('apply'), () => mutation('waiting-setting', { waitingRoomEnabled: enabled.checked, waitingRoomDecision: disableDecision.value })));
        body.append(settings);
        allButton = button(t('admit_all'), () => mutation('waiting-decision', { all: true, decision: 'approve' }));
        allButton.setAttribute('aria-keyshortcuts', 'Alt+Control+A');
        body.append(allButton, button(t('reject_all'), () => mutation('waiting-decision', { all: true, decision: 'reject' })));
        list = document.createElement('ul'); list.setAttribute('aria-label', t('title')); body.append(list);
        message = document.createElement('p'); body.append(message);
        const personActions = document.getElementById('host-person-actions');
        if (personActions?.parentElement === host) personActions.after(panel); else host.append(panel);
        // Keep notifications available even while the manager controls are collapsed.
        liveRegion = document.createElement('p'); liveRegion.className = 'sr-only';
        liveRegion.setAttribute('role', 'status'); liveRegion.setAttribute('aria-atomic', 'true'); document.body.append(liveRegion);
        // Web-only counterpart of the desktop keyboard-manager action; parent registers the configurable desktop shortcut.
        document.addEventListener('keydown', event => {
            if (event.defaultPrevented || event.repeat || event.isComposing || event.metaKey || !event.altKey || !event.ctrlKey || event.shiftKey || event.code !== 'KeyA') return;
            const state = context.state();
            const authorized = !!state.roomConnection && (state.participantRole === 'co_host' || (state.webHost === true && state.participantRole === 'host'));
            const target = event.target || document.activeElement;
            const editing = target?.isContentEditable || target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
            const dialog = document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]:not([hidden])');
            if (!authorized || busy || roomIdentity !== state.room?.roomId || !rows.size || editing || dialog) return;
            // Invoke directly: a collapsed ancestor must not disable the global manager action.
            event.preventDefault(); mutation('waiting-decision', { all: true, decision: 'approve' });
        });
        timer = setInterval(poll, 2500); poll();
        window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    }
    async function wait({ payload, t: translate, request: fetchRoom, body, container }) {
        const tr = key => translate('waiting_room.' + key);
        const origin = document.activeElement;
        let joined = false;
        const section = document.createElement('section'), status = document.createElement('p');
        status.setAttribute('role', 'status'); status.tabIndex = -1;
        section.append(status); container.append(section); status.textContent = tr('pending'); status.focus();
        const credentials = { requestId: payload.waiting.requestId, secret: payload.waiting.secret };
        let cancelled = false, cancelling = false;
        async function call(action) {
            const response = await fetchRoom('/api/broadcast-room/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, waiting: credentials }) });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(tr('failed'));
            return result;
        }
        const cancel = button(tr('cancel'), async () => {
            cancel.disabled = true; cancelling = true;
            try { await call('waiting-cancel'); cancelled = true; }
            catch (_error) { status.textContent = tr('failed'); cancel.disabled = false; }
            finally { cancelling = false; }
        });
        section.append(cancel);
        try {
            while (!cancelled) {
                const result = await call('waiting-status');
                const current = result.waiting.status;
                if (cancelled) break;
                if (cancelling) { await new Promise(resolve => setTimeout(resolve, 300)); continue; }
                if (current === 'approved') {
                    cancel.disabled = true;
                    const admitted = await call('join-token');
                    if (!admitted.token) throw new Error(tr(admitted.waiting?.status || 'failed'));
                    joined = true;
                    return admitted;
                }
                if (current !== 'pending') throw new Error(tr(current));
                await new Promise(resolve => setTimeout(resolve, 1800));
            }
            throw new Error(tr('cancelled'));
        } finally {
            section.remove();
            if (!joined) setTimeout(() => { if (origin?.isConnected && !origin.disabled) origin.focus(); }, 0);
        }
    }
    window.EvdWaitingRoom = { init, wait };
})();
