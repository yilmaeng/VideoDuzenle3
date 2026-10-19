const { recordingName } = require('../../shared/desktop-recording-name');
const { createTransientStatus } = require('./desktop-recording-notice');
const RECORDING_STATES = ['starting', 'active', 'pausing', 'paused', 'ending', 'assembling', 'unknown', 'complete', 'processing_failed', 'failed'];
const PENDING_STATES = ['starting', 'active', 'pausing', 'paused', 'ending', 'assembling', 'unknown'];

function recordingActions(status) {
    return { pause: status === 'active', resume: status === 'paused',
        stop: ['active', 'paused'].includes(status) };
}

function createDesktopCloudControls({ document, t, context, request, download, announce, language }) {
    const panel = document.getElementById('desktop-cloud-recording');
    const list = document.getElementById('desktop-cloud-recordings');
    const status = document.getElementById('desktop-cloud-status');
    const start = document.getElementById('desktop-cloud-start');
    const pause = document.getElementById('desktop-cloud-pause');
    const refreshButton = document.getElementById('desktop-cloud-refresh');
    let roomId = '', accountKey = '', rows = [], granted = false, enabled = false, busy = false, refreshing = false, generation = 0;
    const tr = (key, params) => t(`desktop_cloud.${key}`, '', params);
    const transient = createTransientStatus(status);
    const rowNodes = new Map();
    let messageSequence = 0, health = '';
    function message(key) { transient.show(tr(key), ++messageSequence); }
    function setText(element, value) { if (element.textContent !== value) element.textContent = value; }
    function button(key, action) {
        const el = document.createElement('button');
        el.type = 'button'; el.textContent = tr(key);
        el.addEventListener('click', action); return el;
    }
    function currentRecording() { return rows.find(row => PENDING_STATES.includes(row.status)); }
    function render() {
        const current = currentRecording();
        const stable = current && ['active', 'paused'].includes(current.status);
        const ambiguous = rows.filter(row => PENDING_STATES.includes(row.status)).length > 1;
        setText(start, current ? stable ? tr('stop') : tr(`states.${current.status}`) : tr('start'));
        setText(pause, tr(current?.status === 'paused' ? 'resume' : 'pause'));
        start.disabled = busy || !granted || !enabled || ambiguous || (!!current && !stable);
        pause.disabled = busy || !granted || !enabled || ambiguous || !stable;
        refreshButton.disabled = busy || refreshing;
        const liveIds = new Set(rows.map(row => row.id));
        for (const [id, nodes] of rowNodes) {
            if (!liveIds.has(id)) { nodes.item.remove(); rowNodes.delete(id); }
        }
        for (const row of rows) {
            let nodes = rowNodes.get(row.id);
            if (!nodes) {
                const item = document.createElement('li'), label = document.createElement('span');
                item.append(label);
                nodes = { item, label, downloads: {} };
                for (const format of ['mp4', 'm4a']) {
                    const el = button(`download_${format}`, () => save(row.id, format));
                    el.dataset.cloudAction = `${row.id}:${format}`;
                    nodes.downloads[format] = el; item.append(el);
                }
                rowNodes.set(row.id, nodes); list.append(item);
            }
            const state = RECORDING_STATES.includes(row.status) ? row.status : 'unknown';
            const name = recordingName(row, language(), (key, params) => t(key, '', params));
            setText(nodes.label, tr('recording_label', { id: name, status: tr(`states.${state}`) }));
            for (const format of ['mp4', 'm4a']) {
                const el = nodes.downloads[format];
                el.disabled = busy || row.available !== true || state !== 'complete';
                const accessibleName = tr('named_action', { action: tr(`download_${format}`), id: name });
                if (el.dataset.accessibleName !== accessibleName) {
                    el.dataset.accessibleName = accessibleName;
                    el.setAttribute('aria-label', accessibleName);
                }
            }
        }
    }
    function update() {
        const next = context();
        const id = next.allowed ? next.roomId : '';
        const key = next.allowed ? String(next.accountKey || '') : '';
        if (id !== roomId || key !== accountKey) {
            roomId = id; accountKey = key; generation++; rows = []; enabled = false; granted = false;
            panel.open = false; transient.reset(); health = ''; render();
        }
        panel.hidden = !id || !granted;
    }
    async function refresh() {
        update();
        if (!roomId || refreshing) return;
        const current = generation;
        refreshing = true;
        try {
            const result = await request('recordings');
            update();
            if (current !== generation) return;
            // Server roomAccess is independent of the desktop owner proxy. An own
            // consent entry grants visibility, including delegated room managers.
            granted = Object.prototype.hasOwnProperty.call(result.recordingConsent || {}, roomId);
            enabled = granted && result.enabled === true;
            rows = granted ? (result.recordings || []).filter(row => row.roomId === roomId) : [];
            panel.hidden = !granted;
            if (!granted) panel.open = false;
            const nextHealth = enabled ? 'ready' : 'unavailable';
            if (nextHealth !== health && !enabled) message('unavailable');
            health = nextHealth;
            return result;
        } catch (_) {
            if (current === generation) {
                granted = false; enabled = false; rows = []; panel.hidden = true; panel.open = false;
                if (health !== 'error') message('error');
                health = 'error';
            }
        }
        finally { refreshing = false; render(); }
    }
    function consent() {
        const dialog = document.getElementById('desktop-cloud-consent');
        return new Promise(resolve => {
            dialog.returnValue = '';
            dialog.addEventListener('close', () => {
                start.focus();
                resolve(dialog.returnValue === 'confirm');
            }, { once: true });
            dialog.showModal();
            document.getElementById('desktop-cloud-consent-message').focus();
            announce(tr('consent_message'));
        });
    }
    async function run(action, id) {
        update();
        if (busy || !roomId || !granted) return;
        const current = generation, target = roomId;
        busy = true; render();
        try {
            const result = await refresh();
            if (!result || current !== generation || !granted) return;
            let confirm = false;
            if (action === 'start') {
                if (!enabled || rows.some(row => PENDING_STATES.includes(row.status))) return;
                if (!result.recordingConsent?.[target]?.confirmed) {
                    confirm = await consent();
                    if (!confirm) return;
                }
            } else if (!recordingActions(rows.find(row => row.id === id)?.status)[action]) return;
            update();
            if (current !== generation || !granted) return;
            await request(action === 'start' ? 'recordings/start' : `recordings/${id}/${action}`, action === 'start' ? { roomId: target, confirm } : {});
        } catch (_) { if (current === generation) message('error'); }
        finally { busy = false; await refresh(); render(); }
    }
    async function save(id, format) {
        update();
        if (busy || !roomId || !granted) return;
        const current = generation;
        busy = true; render(); message('downloading');
        try {
            const refreshed = await refresh();
            if (!refreshed || current !== generation || !granted
                || !rows.some(row => row.id === id && row.available === true && row.status === 'complete')) return;
            const result = await download({ id, format, lang: language() });
            if (current === generation) message(result?.error ? 'error' : result?.canceled ? 'canceled' : 'saved');
        } catch (_) { if (current === generation) message('error'); }
        finally { busy = false; render(); }
    }
    // Consent/start and per-recording downloads are deliberately panel-only. They
    // need explicit context; custom shortcuts focus this panel instead.
    start.addEventListener('click', () => {
        if (start.disabled) return;
        const current = currentRecording();
        return run(current ? 'stop' : 'start', current?.id);
    });
    pause.addEventListener('click', () => {
        if (pause.disabled) return;
        const current = currentRecording();
        return run(current?.status === 'paused' ? 'resume' : 'pause', current?.id);
    });
    refreshButton.addEventListener('click', refresh);
    panel.addEventListener('toggle', () => { if (panel.open) refresh(); });
    // Poll eligible account sessions even while collapsed to discover grants and
    // revoke stale access without ever routing through the owner proxy.
    const timer = setInterval(refresh, 5000);
    return { update, refresh, focus() { update(); if (!panel.hidden) { panel.open = true; panel.querySelector('summary').focus(); } },
        dispose() { clearInterval(timer); transient.dispose(); generation++; } };
}
module.exports = { createDesktopCloudControls, recordingActions, RECORDING_STATES, PENDING_STATES };
