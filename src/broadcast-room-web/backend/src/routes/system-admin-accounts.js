const express = require('express');
const crypto = require('crypto');

function createSystemAdminAccounts({ config, roomStore, accounts, authorize }) {
    const router = express.Router();
    router.use((req, res, next) => {
        res.set('Cache-Control', 'no-store');
        if (!authorize(req, res)) return;
        if (!accounts()) return res.status(503).json({ error: 'request_failed' });
        const store = accounts(); store.prune();
        store.limit(`provision:${req.ip}`, 60, 15 * 60000); store.save();
        next();
    });
    router.post('/list', (_req, res) => {
        const store = accounts();
        res.json({ success: true, rooms: [...roomStore.rooms.values()].filter(room => room.active || room.settings.persistentRoom).map(room => ({
            roomId: room.roomId, title: room.title,
            ownerEmail: store.state.users.find(user => user.id === store.roomOwner(room))?.email || ''
        })) });
    });
    router.post('/account', async (req, res, next) => {
        try { res.json({ success: true, user: await accounts().provision(req.body.email, req.body.password, req.body.reset === true) }); }
        catch (error) { next(error); }
    });
    router.post('/assign', (req, res, next) => {
        try {
            const room = roomStore.getRoom(String(req.body.roomId || ''));
            if (!room) throw new Error('room_not_found');
            if (room.participants.some(person => person.connected !== false)) throw new Error('room_busy');
            const user = accounts().assignRoom(req.body.email, room, req.body.transfer === true);
            if (room.settings.persistentRoom) roomStore.savePersistentRooms();
            res.json({ success: true, user, roomId: room.roomId });
        } catch (error) { next(error); }
    });
    router.post('/create', (req, res, next) => {
        let created;
        try {
            const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
            if (!title || title.length > 120) throw new Error('room_title_invalid');
            const email = String(req.body.email || '').trim().toLowerCase();
            if (!accounts().state.users.some(user => user.email === email)) throw new Error('account_missing');
            const ownerKey = crypto.randomBytes(32).toString('hex');
            created = roomStore.createRoom({ title, hostDisplayName: title, persistentRoom: true, ownerKey,
                inviteBaseUrl: `${config.appBaseUrl}${config.broadcastRoomBasePath}` });
            const room = roomStore.getRoom(created.roomId);
            accounts().assignRoom(email, room);
            res.status(201).json({ success: true, roomId: room.roomId });
        } catch (error) {
            if (created) roomStore.deleteIdleRoom(created.roomId);
            next(error);
        }
    });
    router.use((error, _req, res, _next) => {
        const known = ['email_invalid', 'password_policy', 'account_exists', 'account_missing', 'owner_transfer_confirmation', 'room_not_found', 'room_busy', 'room_title_invalid', 'rate_limited'];
        res.status(error.message === 'rate_limited' ? 429 : 400).json({ success: false, error: known.includes(error.message) ? error.message : 'request_failed' });
    });
    return router;
}
module.exports = { createSystemAdminAccounts };
