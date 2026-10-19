(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    let context, snapshot = {}, participants = [], busy = false, confirmation = null, origin = null;
    let volumeQueue = Promise.resolve();
    let recordingRows = [], recordingBusy = false, linkIdentity = '';
    let recordingMutation = false, recordingRequest = Promise.resolve();
    let recordingConsentKey = '';
    let savedRecordingLink = null;
    let recordingMessageTimer = null, recordingRoomKey = '';
    function recordingMessage(value) {
        clearTimeout(recordingMessageTimer);
        text($('temporary-recording-message'), value);
        if (value) recordingMessageTimer = setTimeout(() => text($('temporary-recording-message'), ''), 6000);
    }
    function renderRecordingControls() {
        const current = recordingRows.find(pendingRecording);
        const ending = current && ['ending', 'assembling'].includes(current.status);
        const toggle = $('temporary-recording-start'), pause = $('temporary-recording-pause');
        text(toggle, t(current ? 'recording_stop' : 'recording_start'));
        setRecordingDisabled(toggle, recordingMutation || !!ending);
        text(pause, t(current?.status === 'paused' ? 'recording_resume' : 'recording_pause'));
        setRecordingDisabled(pause, recordingMutation || !['active', 'paused'].includes(current?.status));
        $('temporary-recording-link').disabled = recordingMutation;
    }
    function setRecordingDisabled(button, disabled) {
        // Keep native buttons focusable while work is pending; disabling them can drop VoiceOver focus.
        const value = String(disabled);
        if (button.getAttribute('aria-disabled') !== value) button.setAttribute('aria-disabled', value);
    }
    function recordingToggle(button) {
        return button === $('temporary-recording-start') || button === $('temporary-recording-pause');
    }
    const pendingRecording = row => ['starting','active','pausing','paused','assembling','ending','unknown'].includes(row.status);
    function syncRecordingConsent(result, roomId) {
        const consent = result.recordingConsent?.[roomId];
        if (!consent) return;
        const key = `${roomId}:${consent.key}`;
        if (recordingConsentKey && key !== recordingConsentKey) {
            savedRecordingLink = null;
            linkIdentity = '';
            $('meeting-recording-links').hidden = true;
        }
        if ((recordingConsentKey && key !== recordingConsentKey) || consent.confirmed) $('temporary-recording-consent').checked = consent.confirmed;
        recordingConsentKey = key;
    }
    const temporary = () => context.state().participantRole === 'co_host';
    const recordingAllowed = () => !!context?.state().roomConnection && (temporary() || (context.state().webHost && context.state().participantRole === 'host'));
    const t = key => context.t('admin_auth.' + key);
    const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
    function selected() { return participants.find(item => item.identity === $('host-participant').value); }
    function render() {
        if (!context) return;
        const state = context.state();
        const active = ((state.webHost === true && state.participantRole === 'host') || temporary()) && !!state.roomConnection;
        $('web-host-toggle').hidden = !active;
        if (!active) { $('web-host-panel').hidden = true; $('web-host-toggle').setAttribute('aria-expanded', 'false'); }
        participants = (state.participants || []).filter(item => item.connected !== false && item.role !== 'host' && (!temporary() || item.role !== 'co_host'));
        $('host-end').hidden = temporary();
        $('host-check-camera').hidden = temporary();
        for (const checkbox of document.querySelectorAll('[data-host-permission]')) checkbox.closest('label').hidden = temporary();
        $('temporary-recording-panel').hidden = !active;
        $('temporary-recording-link').hidden = !active;
        const nextRoomKey = active ? `${state.room.roomId}:${state.participantIdentity}` : '';
        if (recordingRoomKey !== nextRoomKey) {
            recordingRoomKey = nextRoomKey; recordingRows = []; savedRecordingLink = null;
            recordingConsentKey = ''; linkIdentity = ''; $('meeting-recording-links').hidden = true;
            recordingMessage('');
            if (active) recordingAction('list');
        }
        const select = $('host-participant'), previous = select.value;
        const signature = JSON.stringify(participants.map(item => [item.identity, item.displayName]));
        if (select.dataset.signature !== signature) {
            select.replaceChildren(...participants.map(item => {
                const option = document.createElement('option'); option.value = item.identity; option.textContent = item.displayName || item.identity; return option;
            }));
            if (participants.some(item => item.identity === previous)) select.value = previous;
            select.dataset.signature = signature;
        }
        const participant = selected();
        $('host-person-actions').disabled = busy || !active || !participant;
        for (const node of document.querySelectorAll('[data-host-all], [data-host-permission], #host-end')) node.disabled = busy || !active;
        text($('host-spotlight'), t(participant?.spotlighted ? 'meeting_unspotlight' : 'meeting_spotlight'));
        for (const checkbox of document.querySelectorAll('[data-host-permission]')) checkbox.checked = snapshot.settings?.[checkbox.dataset.hostPermission] !== false;
        // Do not overwrite an in-progress volume gesture when an older server event arrives.
        if (document.activeElement !== $('host-volume')) $('host-volume').value = snapshot.settings?.participantVolumes?.[participant?.identity] ?? 100;
        text($('host-volume-value'), $('host-volume').value + '%');
        renderRecordingControls();
    }
    async function request(action, body) {
        const state = context.state();
        const base = temporary() ? '/api/meeting-access' : '/api/admin-auth/meeting';
        const response = await fetch(`${base}/${encodeURIComponent(state.room.roomId)}/${action}`, {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json',
                ...(temporary() ? { 'X-EVD-Participant-Identity': state.participantIdentity, 'X-EVD-Participant-Key': state.participantApiKey } : {}) }, body: JSON.stringify(body)
        });
        const result = await response.json();
        if (!response.ok || result.success === false) throw new Error(result.error || 'request_failed');
        if (action !== 'end') { snapshot = { ...snapshot, ...result }; await context.apply(result); }
        return result;
    }
    function errorMessage(error) {
        return t(['session_required', 'room_not_found', 'meeting_host_present', 'meeting_participant_missing'].includes(error.message) ? error.message : 'request_failed');
    }
    async function act(action, body) {
        if (busy) return;
        const control = document.activeElement;
        busy = true; text($('host-message'), ''); render();
        try { await volumeQueue; await request(action, body); text($('host-message'), t('meeting_applied')); }
        catch (error) { text($('host-message'), errorMessage(error)); }
        finally {
            busy = false; render();
            if (document.activeElement === document.body && control?.isConnected) {
                (control.disabled || control.closest('fieldset')?.disabled ? $('host-participant') : control).focus();
            }
        }
    }
    function ask(action, body, message) {
        origin = document.activeElement; confirmation = { action, body };
        text($('host-confirm-message'), message); $('host-confirm').showModal(); $('host-confirm-cancel').focus();
    }
    function closeConfirmation() {
        $('host-confirm').close(); confirmation = null;
        if (origin?.isConnected && !origin.disabled) origin.focus();
    }
    function formatLink(url, format) {
        const result = new URL(url); result.searchParams.set('format', format); return result.href;
    }
    async function copyRecordingLink(url, format = 'mp4') {
        try {
            await navigator.clipboard.writeText(url);
            recordingMessage(t('recording_link_copied'));
        } catch (_) {
            recordingMessage(t('recording_link_copy_failed'));
            $(format === 'm4a' ? 'meeting-recording-audio-link' : 'meeting-recording-link').focus();
        }
    }
    async function recordingAction(action, copyLink = true) {
        if (!recordingAllowed()) return;
        const control = ['start', 'stop'].includes(action) ? $('temporary-recording-start')
            : ['pause', 'resume'].includes(action) ? $('temporary-recording-pause') : null;
        if (control?.getAttribute('aria-disabled') === 'true') return;
        if (recordingBusy) {
            if (action === 'list' || recordingMutation) return;
            const queuedKey = recordingRoomKey;
            await recordingRequest;
            if (queuedKey !== recordingRoomKey) return;
            return recordingAction(action, copyLink);
        }
        const linkKey = `${context.state().room.roomId}:${context.state().participantIdentity}`;
        if (action === 'link' && copyLink && savedRecordingLink?.key === linkKey
            && savedRecordingLink.expires > Date.now()) {
            $('meeting-recording-links').hidden = false;
            $('meeting-recording-link').focus();
            return true;
        }
        recordingBusy = true;
        recordingMutation = action !== 'list';
        let finishRequest;
        recordingRequest = new Promise(resolve => { finishRequest = resolve; });
        const state = context.state();
        const targetKey = recordingRoomKey;
        if (action !== 'list') {
            renderRecordingControls();
            for (const button of $('temporary-recording-panel').querySelectorAll('button')) {
                if (!recordingToggle(button)) button.disabled = true;
            }
        }
        try {
            const current = recordingRows.find(pendingRecording);
            if (action === 'start' && !$('temporary-recording-consent').checked) throw new Error('recording_confirmation');
            if (action === 'start' && current) return;
            if (action === 'stop' && (!current || ['assembling', 'ending'].includes(current.status))) return;
            if (action === 'pause' && current?.status !== 'active') return;
            if (action === 'resume' && current?.status !== 'paused') return;
            const isTemporary = temporary();
            const url = isTemporary ? `/api/meeting-access/${encodeURIComponent(state.room.roomId)}/recording/${action}`
                : `/api/admin-auth/recordings${action === 'list' ? '' : action === 'link' ? '/meeting-link' : action === 'start' ? '/start' : `/${encodeURIComponent(current.id)}/${action}`}`;
            const get = !isTemporary && action === 'list';
            const response = await fetch(url, {
                method: get ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
                headers: { 'Content-Type': 'application/json', ...(isTemporary ? { 'X-EVD-Participant-Identity': state.participantIdentity, 'X-EVD-Participant-Key': state.participantApiKey } : {}) },
                ...(!get ? { body: JSON.stringify({ roomId: state.room.roomId, confirm: $('temporary-recording-consent').checked, id: current?.id }) } : {})
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            if (targetKey !== recordingRoomKey || !recordingAllowed()) return false;
            if (result.link) {
                savedRecordingLink = { ...result.link, key: linkKey };
                const link = $('meeting-recording-link'); link.href = formatLink(result.link.url, 'mp4');
                const audio = $('meeting-recording-audio-link'); audio.href = formatLink(result.link.url, 'm4a');
                $('meeting-recording-links').hidden = false;
                text(link, t('recording_share_mp4')); text(audio, t('recording_share_m4a'));
                text($('meeting-recording-link-hint'), t('recording_share_hint'));
                if (copyLink) link.focus();
                return true;
            }
            if (result.recordings) recordingRows = result.recordings.filter(row => row.roomId === state.room.roomId);
            if (result.recording) recordingRows = recordingRows.filter(row => row.id !== result.recording.id).concat(result.recording);
            syncRecordingConsent(result, state.room.roomId);
            // The room's single live notice announces confirmed transitions. Never
            // read the entire recording history on each poll or duplicate that notice.
            if (result.enabled === false && action !== 'list') recordingMessage(t('recording_unavailable'));
            return true;
        } catch (error) {
            const key = ['recording_unavailable','recording_confirmation','recording_already_running','recording_capacity','recording_disk_full','recording_not_ready','recording_processing_failed','recording_not_found','recording_room_empty','room_not_found','session_required','rate_limited'].includes(error.message) ? error.message : 'request_failed';
            if (action !== 'list' && targetKey === recordingRoomKey) recordingMessage(t(key));
            return false;
        } finally {
            recordingBusy = false;
            recordingMutation = false;
            finishRequest();
            if (action !== 'list') for (const button of $('temporary-recording-panel').querySelectorAll('button')) {
                if (!recordingToggle(button)) button.disabled = false;
            }
            renderRecordingControls();
        }
    }
    window.EvdWebHost = {
        init(value) {
            context = value;
            // Web-only shortcut; desktop keyboard manager is not used by this page.
            document.addEventListener('keydown', async event => {
                if (!event.altKey || !event.ctrlKey || event.shiftKey || event.metaKey || event.code !== 'KeyR' || !recordingAllowed()) return;
                if (document.querySelector('dialog[open]')) return;
                event.preventDefault(); event.stopImmediatePropagation();
                if (event.repeat || recordingMutation) return;
                const shortcutRoomKey = recordingRoomKey;
                if (recordingBusy) await recordingRequest;
                if (shortcutRoomKey !== recordingRoomKey) return;
                if (!await recordingAction('list')) return;
                if (shortcutRoomKey !== recordingRoomKey || !recordingAllowed()) return;
                if (recordingRows.some(pendingRecording)) await recordingAction('stop');
                else if ($('temporary-recording-consent').checked) await recordingAction('start');
                else {
                    $('web-host-panel').hidden = false; $('web-host-toggle').setAttribute('aria-expanded', 'true');
                    recordingMessage(t('recording_confirmation'));
                    $('temporary-recording-consent').focus();
                }
            }, true);
            setInterval(() => { if (!document.hidden && recordingAllowed()) recordingAction('list'); }, 5000);
            // Pause/resume use native buttons, avoiding additional assistive-technology shortcut conflicts.
            for (const id of ['temporary-recording-start', 'temporary-recording-pause']) $(id).addEventListener('click', () => {
                const button = $(id);
                if (button.getAttribute('aria-disabled') === 'true') return;
                // Safari touch activation does not always move DOM focus from the join microphone button.
                // Establish focus only in this user gesture, never after an asynchronous response.
                button.focus({ preventScroll: true });
                return recordingAction(id === 'temporary-recording-start'
                    ? (recordingRows.some(pendingRecording) ? 'stop' : 'start')
                    : (recordingRows.find(pendingRecording)?.status === 'paused' ? 'resume' : 'pause'));
            });
            for (const action of ['list', 'link']) $('temporary-recording-' + action).addEventListener('click', () => recordingAction(action));
            for (const format of ['mp4', 'm4a']) $('meeting-recording-copy-' + format).addEventListener('click', () => {
                const key = `${context.state().room?.roomId}:${context.state().participantIdentity}`;
                if (recordingAllowed() && savedRecordingLink?.key === key && savedRecordingLink.expires > Date.now())
                    copyRecordingLink(formatLink(savedRecordingLink.url, format), format);
            });
            $('web-host-toggle').addEventListener('click', () => {
                const open = $('web-host-panel').hidden; $('web-host-panel').hidden = !open;
                $('web-host-toggle').setAttribute('aria-expanded', String(open));
                if (open) $('host-participant').focus();
            });
            $('host-participant').addEventListener('change', render);
            $('host-check-camera').addEventListener('click', () => {
                const participant = selected();
                if (participant) context.checkCamera(participant.identity);
            });
            $('host-participant').addEventListener('keydown', event => {
                if (event.key === 'ArrowRight' && !event.altKey && !event.ctrlKey) { event.preventDefault(); $('host-mute').focus(); }
            });
            $('host-person-actions').addEventListener('keydown', event => {
                if (event.key === 'Escape') { event.preventDefault(); $('host-participant').focus(); }
            });
            for (const button of document.querySelectorAll('[data-host-all]')) button.addEventListener('click', () => act('all', { operation: button.dataset.hostAll }));
            for (const checkbox of document.querySelectorAll('[data-host-permission]')) checkbox.addEventListener('change', () => act('permissions', { key: checkbox.dataset.hostPermission, value: checkbox.checked }));
            for (const button of document.querySelectorAll('[data-host-person]')) button.addEventListener('click', () => {
                const participant = selected(); if (!participant) return;
                act('participant', { identity: participant.identity, operation: button.dataset.hostPerson,
                    ...(button.dataset.hostPerson === 'spotlight' ? { value: !participant.spotlighted } : {}) });
            });
            $('host-volume').addEventListener('input', () => {
                const participant = selected(); if (!participant) return;
                const value = Number($('host-volume').value), identity = participant.identity;
                text($('host-volume-value'), value + '%');
                // Serialize changes so a delayed older response cannot replace the latest value.
                volumeQueue = volumeQueue.then(() => request('volume', { identity, value })).catch(error => text($('host-message'), errorMessage(error)));
            });
            $('host-volume').addEventListener('keydown', event => {
                if (event.key === 'Enter') { event.preventDefault(); $('host-participant').focus(); }
            });
            $('host-remove').addEventListener('click', () => {
                const participant = selected(); if (participant) ask('remove', { identity: participant.identity, confirm: true }, `${t('meeting_remove_confirm')} ${participant.displayName || participant.identity}`);
            });
            $('host-end').addEventListener('click', () => ask('end', { identity: context.state().participantIdentity, confirm: true }, t('meeting_end_confirm')));
            $('host-confirm-cancel').addEventListener('click', closeConfirmation);
            $('host-confirm').addEventListener('cancel', event => { event.preventDefault(); closeConfirmation(); });
            $('host-confirm-ok').addEventListener('click', () => { const choice = confirmation; closeConfirmation(); if (choice) act(choice.action, choice.body); });
            render();
        },
        update(value) { snapshot = { ...snapshot, ...value }; render(); },
        render
    };
    // Other controls retain native Tab/arrow navigation.
})();
