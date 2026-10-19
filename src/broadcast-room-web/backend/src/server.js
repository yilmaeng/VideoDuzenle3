const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { loadConfig } = require('./config');
const { RoomStore } = require('./store/room-store');
const { createBroadcastRoomRouter } = require('./routes/broadcast-room');
const { createMonitorAudioHub } = require('./monitor-audio-hub');
const { createAdminAuthRouter } = require('./routes/admin-auth');
const { ServerRecordings } = require('./services/server-recordings');
const { createMeetingRecordingAccess } = require('./routes/meeting-recording-access');

function createApp() {
    const config = loadConfig();
    const roomStore = new RoomStore({
        persistentRoomsFilePath: path.join(config.dataDir, 'persistent-rooms.json'),
        webinarRequestsFilePath: path.join(config.dataDir, 'webinar-requests.json')
    });
    const app = express();
    const broadcastRouter = createBroadcastRoomRouter({ config, roomStore });
    let recordings = null;
    try {
        recordings = new ServerRecordings({ config, roomStore, onRoomChanged: room => broadcastRouter.notifySettingsChanged(room) });
        recordings.startMonitor();
    } catch (_error) { console.error('server_recordings_initialization_failed'); }

    // Only the local reverse proxy is trusted. Admin cookie endpoints are
    // deliberately mounted before the legacy room API's permissive CORS.
    app.set('trust proxy', 'loopback');
    app.use(`${config.broadcastRoomApiBasePath}/meeting-access`, createMeetingRecordingAccess({ config, roomStore, broadcastRouter, recordings }));
    try {
        app.use(`${config.broadcastRoomApiBasePath}/admin-auth`, createAdminAuthRouter({ config, roomStore, recordings, broadcastRouter,
            onRoomChanged: room => broadcastRouter.notifySettingsChanged(room) }));
    } catch (_error) {
        // An unavailable account store must fail closed without stopping live rooms.
        console.error('admin_auth_initialization_failed');
        app.use(`${config.broadcastRoomApiBasePath}/admin-auth`, (_req, res) => {
            res.set('Cache-Control', 'no-store').status(503).json({ error: 'request_failed' });
        });
    }
    app.get(['/admin', '/admin/'], (_req, res) => {
        res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
        res.sendFile(path.join(config.frontendPublicDir, 'admin.html'));
    });

    app.use(cors({
        origin: true,
        credentials: true
    }));
    app.use(express.json({ limit: '1mb' }));

    app.get(`${config.broadcastRoomApiBasePath}/i18n/:lang`, (req, res, next) => {
        try {
            const lang = String(req.params.lang || 'tr').trim().toLowerCase();
            const safeLang = ['tr', 'en', 'de', 'es', 'fr'].includes(lang) ? lang : 'tr';
            const filePath = path.join(config.localeDir, `${safeLang}.json`);
            const content = fs.readFileSync(filePath, 'utf-8');
            res.type('application/json').send(content);
        } catch (error) {
            next(error);
        }
    });

    app.use(config.broadcastRoomApiBasePath, broadcastRouter);
    const monitorAudioHub = createMonitorAudioHub({
        config,
        roomStore
    });

    app.use(config.broadcastRoomBasePath, express.static(config.frontendPublicDir));
    app.get(`${config.broadcastRoomBasePath}/join/:inviteId`, (_req, res) => {
        res.sendFile(path.join(config.frontendPublicDir, 'join.html'));
    });
    app.get(config.broadcastRoomBasePath, (_req, res) => {
        res.sendFile(path.join(config.frontendPublicDir, 'join.html'));
    });

    app.use((error, _req, res, _next) => {
        console.error('broadcast-room-backend error:', error);
        res.status(500).json({
            success: false,
            error: error?.message || 'internal_error'
        });
    });

    return { app, config, monitorAudioHub, recordings };
}

if (require.main === module) {
    const { app, config, monitorAudioHub } = createApp();
    const server = http.createServer(app);
    monitorAudioHub.attach(server);
    server.listen(config.port, () => {
        console.log(`EVD broadcast room backend listening on port ${config.port}`);
    });
}

module.exports = {
    createApp
};
