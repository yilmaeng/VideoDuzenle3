const express = require('express');

// Reuse the desktop control/event path, but authorize every web request with
// the HttpOnly account session. Owner keys never reach the browser.
function createAdminMeetingRouter({ accounts, roomStore, broadcastRouter }) {
    const router = express.Router();
    router.get('/:id', (req, res) => {
        const room = roomStore.getRoom(req.params.id);
        if (!room || !accounts.roomAccess(req.account.id, room)) return res.status(404).json({ error: 'room_not_found' });
        res.json({ success: true, roomId: room.roomId, displayName: req.account.displayName || '' });
    });
    router.post('/:id/:action', (req, res, next) => {
        const room = roomStore.getRoom(req.params.id);
        if (!room || !accounts.roomAccess(req.account.id, room)) return res.status(404).json({ error: 'room_not_found' });
        const body = req.body || {};
        const action = req.params.action;
        if (req.temporaryManager && !['waiting-list', 'waiting-decision', 'all', 'volume', 'remove', 'participant'].includes(action)) return res.status(403).json({ error: 'session_required' });
        let target, data = { roomId: room.roomId };
        const participant = room.participants.find(item => item.identity === body.identity && item.connected !== false);
        if (['waiting-list', 'waiting-decision'].includes(action)) {
            target = action;
            data = { ...data, requestId: body.requestId, all: body.all, decision: body.decision };
        } else if (action === 'waiting-setting') {
            if (typeof body.waitingRoomEnabled !== 'boolean') return res.status(400).json({ error: 'waiting_setting_invalid' });
            target = 'room-settings'; data.waitingRoomEnabled = body.waitingRoomEnabled; data.waitingRoomDecision = body.waitingRoomDecision;
        } else if (action === 'join') {
            const name = req.account.displayName || (typeof body.displayName === 'string' ? body.displayName.trim() : '');
            if (!name || name.length > 120) return res.status(400).json({ error: 'meeting_name_required' });
            target = 'host-token'; data.hostDisplayName = name;
        } else if (action === 'all') {
            target = 'all-guest-controls';
            if (!['mute', 'camera-off'].includes(body.operation)) return res.status(400).json({ error: 'request_failed' });
            data[body.operation === 'mute' ? 'requestedMicrophoneEnabled' : 'requestedCameraEnabled'] = false;
        } else if (action === 'permissions') {
            target = 'room-settings';
            if (!['allowGuestMicrophone', 'allowGuestCamera', 'allowGuestScreenShare'].includes(body.key) || typeof body.value !== 'boolean') return res.status(400).json({ error: 'request_failed' });
            data[body.key] = body.value;
        } else if (action === 'end') {
            if (body.confirm !== true) return res.status(400).json({ error: 'request_failed' });
            target = `${encodeURIComponent(room.roomId)}/end-session`; data.hostIdentity = body.identity;
        } else {
            if (!participant || participant.role === 'host' || (req.temporaryManager && participant.role === 'co_host')) return res.status(404).json({ error: 'meeting_participant_missing' });
            data.identity = participant.identity;
            if (action === 'volume') {
                if (!Number.isFinite(body.value) || body.value < 0 || body.value > 200) return res.status(400).json({ error: 'request_failed' });
                target = 'room-settings'; data.participantVolumes = { ...room.settings.participantVolumes, [participant.identity]: Math.round(body.value) };
            } else if (action === 'remove' && body.confirm === true) target = 'participant-remove';
            else if (action === 'participant') {
                target = 'participant-controls';
                if (body.operation === 'mute') data.requestedMicrophoneEnabled = false;
                else if (body.operation === 'camera-off') data.requestedCameraEnabled = false;
                else if (body.operation === 'spotlight' && typeof body.value === 'boolean') data.spotlighted = body.value;
                else return res.status(400).json({ error: 'request_failed' });
            } else return res.status(400).json({ error: 'request_failed' });
        }
        req.authenticatedWebOwnerRoomId = room.roomId;
        accounts.auditAction(req.account.id, room.roomId, `meeting_${action}_requested`, body.identity || '');
        req.body = data;
        req.url = `/broadcast-room/${target}`;
        broadcastRouter(req, res, next);
    });
    return router;
}
module.exports = { createAdminMeetingRouter };
