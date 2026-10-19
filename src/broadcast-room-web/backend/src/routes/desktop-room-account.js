const express = require('express');
const { publicRoomPayload } = require('../services/room-authorization');

function createDesktopRoomAccountRouter({ accounts, roomStore, broadcastRouter }) {
    const router = express.Router();
    const actions = new Set(['waiting-list', 'waiting-decision', 'host-token', 'room-settings', 'participant-controls', 'all-guest-controls',
        'scene-state', 'live-caption', 'translation-audio', 'accessible-share', 'participant-remove',
        'participant-state', 'participant-avatar', 'participant-role-token', 'chat-message', 'hand-raise', 'leave']);
    router.get('/rooms', (req, res) => {
        const rooms = [...roomStore.rooms.values()].filter(room => accounts.ownsRoom(req.account.id, room)
            && (room.active || room.settings.persistentRoom)).map(room => ({
                roomId: room.roomId, title: room.title, inviteId: room.inviteId,
                hostDisplayName: room.hostDisplayName, hostConnected: roomStore.roomHasConnectedHost(room),
                settings: publicRoomPayload(room.settings)
            }));
        res.json({ rooms });
    });
    router.post('/room', (req, res, next) => {
        const { roomId, action, data = {}, method = 'POST' } = req.body || {};
        const room = roomStore.getRoom(String(roomId || ''));
        if (!room || !accounts.ownsRoom(req.account.id, room)) return res.status(403).json({ error: 'room_owner_required' });
        const read = method === 'GET' && action === 'snapshot';
        if (!read && (method !== 'POST' || (!actions.has(action) && !['close', 'end-session'].includes(action)))) {
            return res.status(400).json({ error: 'request_failed' });
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ error: 'request_failed' });
        // Reuse native room controls without exporting a permanent room key.
        req.authenticatedWebOwnerRoomId = room.roomId;
        req.body = { ...data, roomId: room.roomId };
        delete req.body.ownerKey;
        req.method = read ? 'GET' : 'POST';
        req.url = `/broadcast-room/${read ? encodeURIComponent(room.roomId)
            : ['close', 'end-session'].includes(action) ? `${encodeURIComponent(room.roomId)}/${action}` : action}`;
        broadcastRouter(req, res, next);
    });
    return router;
}
module.exports = { createDesktopRoomAccountRouter };
