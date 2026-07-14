const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { loadConfig } = require('./config');
const { RoomStore } = require('./store/room-store');
const { createBroadcastRoomRouter } = require('./routes/broadcast-room');
const { createMonitorAudioHub } = require('./monitor-audio-hub');

function createApp() {
    const config = loadConfig();
    const roomStore = new RoomStore({
        persistentRoomsFilePath: path.join(config.dataDir, 'persistent-rooms.json'),
        webinarRequestsFilePath: path.join(config.dataDir, 'webinar-requests.json')
    });
    const app = express();

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

    app.use(config.broadcastRoomApiBasePath, createBroadcastRoomRouter({
        config,
        roomStore
    }));
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

    return { app, config, monitorAudioHub };
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
