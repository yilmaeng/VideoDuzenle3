'use strict';
// Maintenance-only: stop the service first to preserve the store's single writer.
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const root = process.argv[2];
process.chdir(root);
process.loadEnvFile('.env');
const req = createRequire(path.join(root, 'package.json'));
const config = req('./src/config').loadConfig();
const { AdminAccountStore } = req('./src/services/admin-account-store');
const { RoomStore } = req('./src/store/room-store');
const accounts = new AdminAccountStore(path.join(config.dataDir, 'admin-accounts.json'));
const roomStore = new RoomStore({ persistentRoomsFilePath: path.join(config.dataDir, 'persistent-rooms.json'),
    webinarRequestsFilePath: path.join(config.dataDir, 'webinar-requests.json') });
const strings = Object.fromEntries(['tr', 'en', 'de', 'es', 'fr'].map(lang => [lang,
    JSON.parse(fs.readFileSync(path.join(config.localeDir, `${lang}.json`), 'utf8')).admin_auth]));
const realMailer = req('./src/services/admin-mailer').createAdminMailer(config);
const mailer = { ready: realMailer.ready, async send(message) {
    try { await realMailer.send(message); console.log(JSON.stringify({ accepted: true })); }
    catch (error) {
        console.log(JSON.stringify({ accepted: false, code: error.code || 'SEND_FAILED',
            responseCode: error.responseCode || null,
            response: String(error.response || '').replace(/[\w.+-]+@[\w.-]+/g, '[address]').slice(0, 1000) }));
        throw error;
    }
} };
const pending = accounts.state.managerNotifications.filter(item => !item.sentAt);
pending.forEach(item => { item.retryAt = 0; });
const router = req('./src/routes/admin-managers').createAdminManagerRouter({ accounts, roomStore, config, mailer, strings });
router.flushNotifications().then(() => {
    console.log(JSON.stringify({ attempted: pending.length, sent: pending.filter(item => item.sentAt && !item.cancelled).length,
        cancelled: pending.filter(item => item.cancelled).length, pending: pending.filter(item => !item.sentAt).length }));
}).catch(() => { console.error('notification_retry_failed'); process.exitCode = 1; }).finally(() => router.close());
