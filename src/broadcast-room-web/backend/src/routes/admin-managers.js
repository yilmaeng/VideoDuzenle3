const express = require('express');
function createAdminManagerRouter({ accounts, roomStore, config, mailer, strings }) {
    const router = express.Router();
    accounts.state.managerNotifications ||= [];
    let flushing = false;
    async function flushNotifications() {
        if (flushing || !mailer.ready) return;
        flushing = true;
        try {
            for (const item of accounts.state.managerNotifications.filter(item => !item.sentAt && (item.retryAt || 0) <= accounts.now()).slice(0, 20)) {
                const invitation = accounts.state.roomManagers.find(invite => invite.id === item.invitationId);
                const room = invitation && roomStore.getRoom(invitation.roomId);
                if (!room || invitation.revokedAt || (!invitation.acceptedAt && invitation.expires <= accounts.now())
                    || accounts.roomOwner(room) !== invitation.ownerId
                    || invitation.proof !== accounts.hash(`room:${room.roomId}:${room.settings.ownerKey}`)) {
                    item.sentAt = accounts.now(); item.cancelled = true; accounts.save(); continue;
                }
                const s = strings[item.lang] || strings.tr;
                const url = new URL('/admin', config.appBaseUrl); url.searchParams.set('lang', item.lang);
                const values = { room: room.title, url: url.href, access: s[invitation.recordings ? 'manager_recordings' : 'manager_no_recordings'] };
                const template = invitation.method === 'account' ? s.manager_account_email_body : s.manager_email_body;
                try {
                    await mailer.send({ email: invitation.email, subject: s.manager_email_subject,
                        text: template.replace(/\{(room|url|access)\}/g, (_match, key) => values[key]) });
                    item.sentAt = accounts.now();
                } catch (_error) { item.retryAt = accounts.now() + 5 * 60000; }
                accounts.save();
            }
        } finally { flushing = false; }
    }
    const notificationTimer = setInterval(() => flushNotifications().catch(() => {}), 60000);
    notificationTimer.unref();
    router.close = () => clearInterval(notificationTimer);
    router.flushNotifications = flushNotifications;
    const owned = (req, res) => {
        const room = roomStore.getRoom(req.params.id);
        if (!room || !accounts.ownsRoom(req.account.id, room)) { res.status(404).json({ error: 'room_not_found' }); return null; }
        return room;
    };
    router.get('/invitations', (req, res) => {
        const invitations = accounts.state.roomManagers.filter(item => item.email === req.account.email && !item.acceptedAt && !item.revokedAt && item.expires > accounts.now())
            .filter(item => { const room = roomStore.getRoom(item.roomId); return accounts.roomOwner(room) === item.ownerId && item.proof === accounts.hash(`room:${room.roomId}:${room.settings.ownerKey}`); })
            .map(item => ({ id: item.id, title: roomStore.getRoom(item.roomId).title, recordings: item.recordings, expires: item.expires }));
        res.json({ invitations });
    });
    router.post('/invitations/:invite/accept', (req, res) => {
        const invite = accounts.state.roomManagers.find(item => item.id === req.params.invite);
        accounts.acceptManager(req.account.id, req.params.invite, roomStore.getRoom(invite?.roomId));
        res.json({ success: true });
    });
    router.get('/:id', (req, res) => {
        if (!owned(req, res)) return;
        res.json({ managers: accounts.state.roomManagers.filter(item => item.roomId === req.params.id && item.ownerId === req.account.id && !item.revokedAt)
            .map(item => ({ id: item.id, email: item.email, recordings: item.recordings, status: item.acceptedAt ? 'manager_active' : item.expires <= accounts.now() ? 'manager_expired' : 'manager_pending' })) });
    });
    router.post('/:id/invite', async (req, res, next) => {
        let invitation;
        try {
            const room = owned(req, res); if (!room) return;
            if (typeof req.body.recordings !== 'boolean') return res.status(400).json({ error: 'request_failed' });
            if (req.body.method && !['email', 'account'].includes(req.body.method)) return res.status(400).json({ error: 'request_failed' });
            invitation = req.body.method === 'account'
                ? await accounts.assignPasswordManager(req.account.id, room, req.body.email, req.body.password || '', req.body.recordings)
                : accounts.inviteManager(req.account.id, room, req.body.email, req.body.recordings);
            const lang = Object.hasOwn(strings, req.body.lang) ? req.body.lang : 'tr';
            const notification = { invitationId: invitation.id, lang, sentAt: 0 };
            accounts.state.managerNotifications.push(notification); accounts.save();
            await flushNotifications();
            res.json({ success: true, notificationPending: !notification.sentAt });
        } catch (error) {
            next(error);
        }
    });
    router.post('/:id/revoke', (req, res) => {
        const room = owned(req, res); if (!room) return;
        if (req.body.confirm !== true) return res.status(400).json({ error: 'request_failed' });
        accounts.revokeManager(req.account.id, room, req.body.invitationId);
        res.json({ success: true });
    });
    router.use((error, _req, res, _next) => res.status(400).json({ error: ['email_invalid','manager_self','manager_exists','manager_invite_invalid','rate_limited','mail_unavailable','password_policy','manager_account_exists'].includes(error.message) ? error.message : 'request_failed' }));
    return router;
}
module.exports = { createAdminManagerRouter };
