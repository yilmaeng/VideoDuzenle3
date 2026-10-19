const express = require('express');
const { createAdminMeetingRouter } = require('./admin-meeting');
const { PENDING } = require('../services/server-recordings');

function createMeetingRecordingAccess({ config, roomStore, broadcastRouter, recordings }) {
    const router = express.Router();
    router.use((req, res, next) => {
        res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        if (req.method !== 'POST') return res.status(403).json({ error: 'session_required' });
        next();
    });
    router.use(express.json({ limit: '4kb' }), express.urlencoded({ extended: false, limit: '4kb' }));
    const asyncRoute = work => (req, res, next) => Promise.resolve().then(() => work(req, res)).catch(next);
    router.post('/shared/list', (req, res, next) => {
        try {
            const shared = recordings.shared(req.body.token);
            res.json({ expires: shared.grant.expires, recordings: shared.rows.map(row => recordings.public(row)) });
        } catch (error) { next(error); }
    });
    router.post('/shared/download', asyncRoute(async (req, res) => {
            const { rows } = recordings.shared(req.body.token);
            const row = rows.find(item => item.id === req.body.id);
            if (!row) throw new Error('recording_not_found');
            if (req.body.format && !['mp4', 'm4a'].includes(req.body.format)) throw new Error('recording_not_found');
            const authorized = () => { try { return recordings.shared(req.body.token).rows.some(item => item.id === row.id); } catch (_) { return false; } };
            const file = req.body.format === 'm4a' ? await recordings.audioDownload(row.id, row.userId, req.body.lang, authorized)
                : recordings.download(row.id, row.userId, req.body.lang);
            res.download(file.path, file.name, { dotfiles: 'deny', headers: { 'Cache-Control': 'no-store' } }, error => { if (error && !res.headersSent) res.status(409).json({ error: 'recording_not_ready' }); });
    }));
    // Only the two bearer-authorized shared routes above accept absent/null Origin.
    // Native noreferrer form submissions may omit it; cookies confer no shared access.
    // All moderation routes still require both same-origin and manager authorization.
    router.use((req, res, next) => {
        if (req.get('Origin') !== new URL(config.appBaseUrl).origin) return res.status(403).json({ error: 'session_required' });
        next();
    });
    router.use('/:id', (req, res, next) => {
        const room = roomStore.getRoom(req.params.id);
        const identity = String(req.get('X-EVD-Participant-Identity') || '');
        const key = String(req.get('X-EVD-Participant-Key') || '');
        const authorize = () => broadcastRouter.isTemporaryManager(room?.roomId, identity, key);
        if (!authorize()) return res.status(403).json({ error: 'session_required' });
        req.account = { id: identity }; req.temporaryManager = true; req.managerRoom = room; req.authorizeManager = authorize;
        next();
    });
    router.post('/:id/recording/:action', asyncRoute(async (req, res) => {
        if (!recordings) throw new Error('recording_unavailable');
        const room = req.managerRoom;
        const meetingId = recordings.meetingId(room);
        const ownerId = broadcastRouter.accounts?.roomOwner(room) || `room:${room.roomId}`;
        const action = req.params.action;
        const authorize = () => req.authorizeManager() && room.recordingMeetingId === meetingId;
        if (['start', 'stop', 'pause', 'resume', 'link'].includes(action)) broadcastRouter.accounts?.auditAction(req.account.id, room.roomId, `temporary_recording_${action}_requested`);
        if (action === 'start') {
            if (req.body.confirm !== true && !recordings.consent(room, `participant:${req.account.id}`).confirmed) throw new Error('recording_confirmation');
            const recording = await recordings.start(room, ownerId, authorize);
            if (PENDING.has(recording.status)) recordings.consent(room, `participant:${req.account.id}`, true);
        } else if (['stop', 'pause', 'resume'].includes(action)) {
            const row = recordings.state.recordings.find(item => item.id === req.body.id && item.roomId === room.roomId && item.meetingId === meetingId);
            if (!row) throw new Error('recording_not_found');
            await recordings[action](row.id, row.userId, authorize);
        } else if (action === 'link') {
            const link = recordings.share(room.roomId, meetingId, req.account.id);
            return res.json({ link });
        } else if (action !== 'list') throw new Error('request_failed');
        res.json({ enabled: recordings.ready, recordingConsent: { [room.roomId]: recordings.consent(room, `participant:${req.account.id}`) }, recordings: recordings.state.recordings
            .filter(row => row.status !== 'deleted' && row.roomId === room.roomId && row.meetingId === meetingId).map(row => recordings.public(row)) });
    }));
    const accounts = {
        roomAccess: (identity, room) => room?.active && room.participants.some(item => item.identity === identity && item.role === 'co_host' && item.connected !== false),
        auditAction: (...args) => broadcastRouter.accounts?.auditAction(...args)
    };
    router.use('/', createAdminMeetingRouter({ accounts, roomStore, broadcastRouter }));
    router.use((error, _req, res, _next) => {
        const known = ['recording_unavailable', 'recording_link_invalid', 'recording_not_found', 'recording_not_ready', 'recording_processing_failed', 'recording_room_empty', 'recording_already_running', 'recording_capacity', 'recording_disk_full', 'recording_confirmation', 'rate_limited'];
        res.status(400).json({ error: known.includes(error.message) ? error.message : 'request_failed' });
    });
    return router;
}
module.exports = { createMeetingRecordingAccess };
