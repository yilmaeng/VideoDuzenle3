const express = require('express');
const crypto = require('crypto');
const { isRoomOwner } = require('../services/room-authorization');

function createAdminRoomRouter({ config, accounts, roomStore, onRoomChanged = () => {} }) {
    const router = express.Router();
    const inviteBaseUrl = `${config.appBaseUrl}${config.broadcastRoomBasePath}`;
    const failure = (res, error, status = 400) => res.status(status).json({ error });
    const owned = (req, res) => {
        const room = roomStore.getRoom(req.params.id);
        if (!room || !accounts.ownsRoom(req.account.id, room)) {
            failure(res, 'room_not_found', 404); return null;
        }
        return room;
    };
    function payload(room) {
        const s = room.settings;
        // Explicit allowlist: never expose owner keys, password hashes, chats or other accounts.
        return { roomId: room.roomId, title: room.title, persistent: s.persistentRoom === true,
            inviteId: room.inviteId, inviteUrl: `${inviteBaseUrl}/join/${encodeURIComponent(room.inviteId)}`,
            active: room.active, hostConnected: roomStore.roomHasConnectedHost(room),
            passwordEnabled: s.passwordConfigured && (s.requirePasswordWhenHostPresent || s.requirePasswordWhenHostAbsent),
            allowJoinWhenHostAbsent: s.allowJoinWhenHostAbsent === true,
            waitingRoomEnabled: s.waitingRoomEnabled === true,
            allowGuestMicrophone: s.allowGuestMicrophone !== false, allowGuestCamera: s.allowGuestCamera !== false,
            allowGuestScreenShare: s.allowGuestScreenShare !== false };
    }
    function settings(body, room) {
        if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 120) throw new Error('room_title_invalid');
        const result = { roomTitle: body.title.trim() };
        if (body.waitingRoomEnabled !== undefined && typeof body.waitingRoomEnabled !== 'boolean') throw new Error('waiting_setting_invalid');
        result.waitingRoomEnabled = body.waitingRoomEnabled ?? (room?.settings?.waitingRoomEnabled === true);
        result.waitingRoomDecision = body.waitingRoomDecision;
        for (const key of ['allowJoinWhenHostAbsent', 'allowGuestMicrophone', 'allowGuestCamera', 'allowGuestScreenShare', 'passwordEnabled']) {
            if (typeof body[key] !== 'boolean') throw new Error('room_settings_invalid');
            if (key !== 'passwordEnabled') result[key] = body[key];
        }
        if (body.password !== undefined && (typeof body.password !== 'string' || body.password.length > 128)) throw new Error('room_password_required');
        const password = (body.password || '').trim();
        if (body.passwordEnabled && !password && !room?.settings?.passwordConfigured) throw new Error('room_password_required');
        if (body.passwordEnabled && password) result.password = password;
        result.requirePasswordWhenHostPresent = body.passwordEnabled;
        result.requirePasswordWhenHostAbsent = body.passwordEnabled;
        return result;
    }
    router.get('/', (req, res) => res.json({ rooms: Array.from(roomStore.rooms.values())
        .filter(room => accounts.roomAccess(req.account.id, room) && (room.active || room.settings.persistentRoom))
        .map(room => ({ ...payload(room), accessRole: accounts.roomAccess(req.account.id, room).role })) }));
    router.post('/link', (req, res) => {
        accounts.prune();
        accounts.limit(`link:${req.account.id}`, 10, 15 * 60000); accounts.save();
        const room = roomStore.getRoomByInviteId(String(req.body.inviteId || '').trim());
        if (!room || !isRoomOwner(room, req.body.ownerKey)) return failure(res, 'room_link_invalid');
        try { accounts.bindRoom(req.account.id, room); }
        catch (_error) { return failure(res, 'room_link_invalid'); }
        res.json({ room: payload(room) });
    });
    router.post('/', (req, res) => {
        const updates = settings(req.body);
        if (typeof req.body.persistent !== 'boolean') return failure(res, 'room_settings_invalid');
        const count = Array.from(roomStore.rooms.values()).filter(room => accounts.ownsRoom(req.account.id, room)).length;
        if (count >= 100) return failure(res, 'room_limit');
        const ownerKey = crypto.randomBytes(32).toString('hex');
        let created;
        try {
            created = roomStore.createRoom({ title: updates.roomTitle, hostDisplayName: updates.roomTitle,
                persistentRoom: req.body.persistent, ownerKey, inviteBaseUrl });
            const room = roomStore.updateRoomSettings(created.roomId, { ...updates, ownerKey });
            accounts.bindRoom(req.account.id, room);
            res.status(201).json({ room: payload(room) });
        } catch (error) {
            if (created) roomStore.deleteIdleRoom(created.roomId);
            throw error;
        }
    });
    router.post('/:id/settings', (req, res) => {
        const room = owned(req, res); if (!room) return;
        const updates = settings(req.body, room);
        const updated = roomStore.updateRoomSettings(room.roomId, { ...updates, ownerKey: room.settings.ownerKey });
        onRoomChanged(updated);
        res.json({ room: payload(updated) });
    });
    router.post('/:id/delete', (req, res) => {
        const room = owned(req, res); if (!room) return;
        if (req.body.confirm !== true) return failure(res, 'room_delete_confirmation');
        if (!roomStore.deleteIdleRoom(room.roomId)) return failure(res, 'room_busy', 409);
        // Recording data is independent and is never removed here.
        res.json({ success: true });
    });
    router.use((error, _req, res, _next) => failure(res,
        ['waiting_setting_invalid', 'waiting_disable_decision_required', 'room_title_invalid', 'room_settings_invalid', 'room_password_required', 'rate_limited'].includes(error.message) ? error.message : 'request_failed'));
    return router;
}
module.exports = { createAdminRoomRouter };
