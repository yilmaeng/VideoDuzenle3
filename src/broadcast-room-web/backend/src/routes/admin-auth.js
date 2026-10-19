const express = require('express');
const fs = require('fs');
const path = require('path');
const { AdminAccountStore } = require('../services/admin-account-store');
const { createAdminMailer } = require('../services/admin-mailer');
const { createAdminRoomRouter } = require('./admin-rooms');
const { createAdminRecordingRouter } = require('./admin-recordings');
const { createAdminMeetingRouter } = require('./admin-meeting');
const { createAdminManagerRouter } = require('./admin-managers');
const { createDesktopRoomAccountRouter } = require('./desktop-room-account');
const COOKIE = '__Host-evd-admin';

function createAdminAuthRouter({ config, store, mailer, roomStore, onRoomChanged, recordings, broadcastRouter }) {
    const router = express.Router();
    const origin = new URL(config.appBaseUrl).origin;
    store ||= new AdminAccountStore(path.join(config.dataDir, 'admin-accounts.json'));
    if (broadcastRouter) broadcastRouter.accounts = store;
    mailer ||= createAdminMailer(config);
    const strings = Object.fromEntries(['tr', 'en', 'de', 'es', 'fr'].map(lang => [lang,
        JSON.parse(fs.readFileSync(path.join(config.localeDir, `${lang}.json`), 'utf8')).admin_auth]));
    const cookie = req => String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
    router.use((_req, res, next) => {
        res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
        next();
    });
    router.use((req, res, next) => {
        if (req.method !== 'GET' && req.get('Origin') !== origin) return res.status(403).json({ error: 'origin_invalid' });
        next();
    });
    router.use('/desktop/room', express.json({ limit: '1mb' }));
    router.use(express.json({ limit: '4kb' }));
    router.get('/config', (_req, res) => res.json({ emailEnabled: mailer.ready }));
    router.get('/session', (req, res) => res.json({ user: store.session(cookie(req)) }));
    const setSession = (res, result, remember = false) => {
        res.cookie(COOKIE, result.session, { secure: true, httpOnly: true, sameSite: 'lax', path: '/',
            ...(remember ? { maxAge: result.expires - Date.now() } : {}) });
        res.json({ user: result.user });
    };
    router.post('/password-login', async (req, res) => {
        try { setSession(res, await store.passwordLogin({ ...req.body, ip: req.ip }), req.body.remember === true); }
        catch (error) { res.status(error.message === 'rate_limited' ? 429 : 401).json({ error: error.message === 'rate_limited' ? 'rate_limited' : 'credentials_invalid' }); }
    });
    router.post('/password-change', async (req, res) => {
        const user = store.session(cookie(req));
        if (!user) return res.status(401).json({ error: 'session_required' });
        try {
            store.prune(); store.limit(`password-change:${user.id}`, 5, 15 * 60000); store.save();
            const result = await store.changePassword(user.id, req.body.password);
            setSession(res, result);
        } catch (error) { res.status(400).json({ error: ['password_policy', 'rate_limited'].includes(error.message) ? error.message : 'request_failed' }); }
    });
    router.post('/request', async (req, res) => {
        if (!mailer.ready) return res.status(503).json({ error: 'mail_unavailable' });
        let challenge;
        try {
            challenge = store.request(req.body.email, req.ip);
            const lang = Object.hasOwn(strings, req.body.lang) ? req.body.lang : 'tr';
            const link = new URL('/admin', origin);
            link.searchParams.set('lang', lang);
            link.hash = new URLSearchParams({ id: challenge.id, token: challenge.token }).toString();
            const text = strings[lang].email_body.replace('{code}', challenge.code).replace('{link}', link.href);
            await mailer.send({ email: challenge.email, subject: strings[lang].email_subject, text });
            res.json({ success: true, challengeId: challenge.id });
        } catch (error) {
            if (challenge) store.cancel(challenge.id);
            const known = ['email_invalid', 'rate_limited'].includes(error.message);
            res.status(error.message === 'rate_limited' ? 429 : known ? 400 : 503).json({ error: known ? error.message : 'mail_unavailable' });
        }
    });
    router.post('/verify', (req, res) => {
        try {
            const remember = req.body.remember === true;
            const result = store.verify({ ...req.body, remember, ip: req.ip });
            res.cookie(COOKIE, result.session, { secure: true, httpOnly: true, sameSite: 'lax', path: '/',
                ...(remember ? { maxAge: result.expires - Date.now() } : {}) });
            res.json({ user: result.user });
        } catch (error) {
            res.status(error.message === 'rate_limited' ? 429 : 400).json({ error: error.message === 'rate_limited' ? 'rate_limited' : 'verification_invalid' });
        }
    });
    router.post('/logout', (req, res) => {
        store.logout(cookie(req));
        res.clearCookie(COOKIE, { secure: true, httpOnly: true, sameSite: 'lax', path: '/' });
        res.json({ success: true });
    });
    const requireAccount = (req, res, next) => {
        req.account = store.session(cookie(req));
        if (!req.account) return res.status(401).json({ error: 'session_required' });
        if (req.account.passwordChangeRequired) return res.status(403).json({ error: 'password_change_required' });
        next();
    };
    router.post('/profile', requireAccount, (req, res) => {
        try { res.json({ user: store.updateProfile(req.account.id, req.body.displayName) }); }
        catch (_error) { res.status(400).json({ error: 'display_name_invalid' }); }
    });
    if (roomStore) {
        router.post('/desktop/remember', requireAccount, (req, res) => {
            if (req.body.confirm !== true) return res.status(400).json({ error: 'request_failed' });
            store.rememberDesktop(cookie(req));
            res.json({ success: true });
        });
        if (broadcastRouter) router.use('/desktop', requireAccount, createDesktopRoomAccountRouter({ accounts: store, roomStore, broadcastRouter }));
        router.use('/managers', requireAccount, createAdminManagerRouter({ accounts: store, roomStore, config, mailer, strings }));
        if (broadcastRouter) router.use('/meeting', requireAccount, createAdminMeetingRouter({ accounts: store, roomStore, broadcastRouter }));
        router.use('/rooms', requireAccount, createAdminRoomRouter({ config, accounts: store, roomStore, onRoomChanged }));
        router.use('/recordings', requireAccount, createAdminRecordingRouter({ recordings, accounts: store, roomStore }));
    }
    router.use((_error, _req, res, _next) => res.status(400).json({ error: 'request_failed' }));
    return router;
}
module.exports = { createAdminAuthRouter };
