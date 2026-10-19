const express = require('express');
const { PENDING } = require('../services/server-recordings');
function createAdminRecordingRouter({ recordings, accounts, roomStore }) {
    const router = express.Router();
    const run = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
    const pending = row => PENDING.has(row.status);
    function access(userId, row) {
        const room = roomStore.getRoom(row.roomId);
        return room ? accounts.roomAccess(userId, room) : row.userId === userId ? { role: 'owner', recordings: true } : null;
    }
    function list(userId) {
        return (recordings?.state.recordings || []).filter(row => { const permission = access(userId, row); return row.status !== 'deleted' && permission && (permission.recordings || pending(row)); })
            .map(row => ({ ...recordings.public(row), canDelete: access(userId, row).role === 'owner', available: access(userId, row).recordings && recordings.public(row).available }));
    }
    function authorizedRow(req, needsDownload = false) {
        const row = recordings.state.recordings.find(item => item.id === req.params.id);
        const permission = row && access(req.account.id, row);
        if (!permission || (needsDownload && !permission.recordings)) throw new Error('recording_not_found');
        return row;
    }
    function recordingConsent(userId) {
        return Object.fromEntries(Array.from(roomStore.rooms.values()).filter(room => accounts.roomAccess(userId, room))
            .map(room => [room.roomId, recordings?.consent(room, `account:${userId}`)]));
    }
    router.get('/', (req, res) => res.json({ enabled: recordings?.ready === true, recordings: list(req.account.id), recordingConsent: recordingConsent(req.account.id) }));
    router.use((_req, res, next) => recordings ? next() : res.status(503).json({ error: 'recording_unavailable' }));
    router.post('/meeting-link', (req, res, next) => {
        try {
            const room = roomStore.getRoom(String(req.body.roomId || ''));
            const permission = room && accounts.roomAccess(req.account.id, room);
            if (!permission?.recordings) throw new Error('recording_not_found');
            // Link creation must not invent or rotate the current meeting identity.
            if (!room.recordingMeetingId) throw new Error('recording_not_ready');
            const link = recordings.share(room.roomId, room.recordingMeetingId, req.account.id);
            accounts.auditAction(req.account.id, room.roomId, 'recording_link_created', link.id);
            res.json({ link });
        } catch (error) { next(error); }
    });
    router.post('/:id/share', (req, res, next) => {
        try {
            const row = authorizedRow(req, true);
            const room = roomStore.getRoom(row.roomId);
            if (room ? !accounts.ownsRoom(req.account.id, room) : row.userId !== req.account.id) throw new Error('recording_not_found');
            if (!row.meetingId) throw new Error('recording_not_found');
            accounts.auditAction(req.account.id, row.roomId, 'recording_link_created', row.id);
            res.json({ link: recordings.share(row.roomId, row.meetingId, req.account.id) });
        } catch (error) { next(error); }
    });
    router.post('/:id/revoke-links', (req, res, next) => {
        try {
            const row = authorizedRow(req, true);
            const room = roomStore.getRoom(row.roomId);
            if (req.body.confirm !== true || (room ? !accounts.ownsRoom(req.account.id, room) : row.userId !== req.account.id)) throw new Error('recording_not_found');
            for (const grant of recordings.state.downloadGrants) if (grant.roomId === row.roomId && grant.meetingId === row.meetingId) grant.revoked = true;
            recordings.save();
            accounts.auditAction(req.account.id, row.roomId, 'recording_links_revoked', row.id);
            res.json({ success: true });
        } catch (error) { next(error); }
    });
    router.post('/refresh', run(async (req, res) => {
        await recordings.serial(async () => {
            for (const row of recordings.state.recordings.filter(item => pending(item) && access(req.account.id, item))) await recordings.reconcile(row);
        });
        res.json({ recordings: list(req.account.id), recordingConsent: recordingConsent(req.account.id) });
    }));
    router.post('/start', run(async (req, res) => {
        const room = roomStore.getRoom(String(req.body.roomId || ''));
        const permission = room && accounts.roomAccess(req.account.id, room);
        if (!permission) return res.status(404).json({ error: 'room_not_found' });
        if (req.body.confirm !== true && !recordings.consent(room, `account:${req.account.id}`).confirmed) return res.status(400).json({ error: 'recording_confirmation' });
        accounts.auditAction(req.account.id, room.roomId, 'recording_start_requested');
        const recording = await recordings.start(room, permission.ownerId, () => !!accounts.roomAccess(req.account.id, room));
        if (pending(recording)) recordings.consent(room, `account:${req.account.id}`, true);
        res.json({ recording: { ...recording, available: false }, recordingConsent: recordingConsent(req.account.id) });
    }));
    router.post('/:id/delete', run(async (req, res) => {
        const row = authorizedRow(req, true);
        const canDelete = () => {
            const room = roomStore.getRoom(row.roomId);
            return room ? accounts.ownsRoom(req.account.id, room) : row.userId === req.account.id;
        };
        if (!canDelete()) throw new Error('recording_not_found');
        if (req.body.confirm !== true) throw new Error('recording_delete_confirmation');
        const recording = await recordings.remove(row.id, row.userId, canDelete);
        accounts.auditAction(req.account.id, row.roomId, 'recording_deleted', row.id);
        res.json({ recording });
    }));
    router.post('/:id/stop', run(async (req, res) => {
        const row = authorizedRow(req);
        accounts.auditAction(req.account.id, row.roomId, 'recording_stop_requested', row.id);
        const recording = await recordings.stop(row.id, row.userId, () => !!access(req.account.id, row));
        res.json({ recording: { ...recording, available: !!access(req.account.id, row)?.recordings && recording.available } });
    }));
    for (const action of ['pause', 'resume']) router.post(`/:id/${action}`, run(async (req, res) => {
        const row = authorizedRow(req);
        const recording = await recordings[action](row.id, row.userId, () => !!access(req.account.id, row));
        accounts.auditAction(req.account.id, row.roomId, `recording_${action}_requested`, row.id);
        res.json({ recording: { ...recording, available: !!access(req.account.id, row)?.recordings && recording.available } });
    }));
    router.get('/:id/download', run(async (req, res) => {
            const row = authorizedRow(req, true);
            if (req.query.format && !['mp4', 'm4a'].includes(req.query.format)) throw new Error('recording_not_found');
            const file = req.query.format === 'm4a'
                ? await recordings.audioDownload(row.id, row.userId, req.query.lang, () => !!access(req.account.id, row)?.recordings)
                : recordings.download(row.id, row.userId, req.query.lang);
            accounts.auditAction(req.account.id, row.roomId, 'recording_download_requested', row.id);
            if (req.query.view === '1') {
                // Preserve authorization and byte-range serving for Safari's native media viewer.
                res.attachment(file.name);
                res.set({ 'Content-Disposition': res.get('Content-Disposition').replace(/^attachment/, 'inline'), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
                return res.sendFile(file.path, { dotfiles: 'deny' }, error => {
                    if (error && !res.headersSent) res.status(409).json({ error: 'recording_not_ready' });
                });
            }
            res.download(file.path, file.name, { dotfiles: 'deny', headers: { 'Cache-Control': 'no-store' } }, error => {
                if (error && !res.headersSent) res.status(409).json({ error: 'recording_not_ready' });
            });
    }));
    router.use((error, _req, res, _next) => {
        const known = ['rate_limited','recording_processing_failed','recording_delete_running','recording_delete_confirmation','recording_unavailable','recording_not_found','recording_not_ready','recording_room_empty','recording_already_running','recording_capacity','recording_disk_full'];
        res.status(error.message === 'recording_not_found' ? 404 : 409).json({ error: known.includes(error.message) ? error.message : 'request_failed' });
    });
    return router;
}
module.exports = { createAdminRecordingRouter };
