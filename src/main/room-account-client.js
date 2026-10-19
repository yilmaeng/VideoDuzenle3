const https = require('https');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { pipeline } = require('stream/promises');
const { randomUUID } = require('crypto');
const { recordingName } = require('../shared/desktop-recording-name');

const ORIGIN = 'https://evd.drenginyilmaz.net';
const COOKIE = '__Host-evd-admin';
const RECORDING_RESPONSE_TIMEOUT_MS = 30 * 60 * 1000;
const TRANSFER_IDLE_TIMEOUT_MS = 30000;
const PATHS = new Map([['session', 'GET'], ['password-login', 'POST'], ['password-change', 'POST'],
    ['logout', 'POST'], ['desktop/rooms', 'GET'], ['desktop/room', 'POST'], ['desktop/remember', 'POST']]);
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
function accountMethod(endpoint) {
    if (typeof endpoint !== 'string') return null;
    if (endpoint === 'recordings') return 'GET';
    if (endpoint === 'recordings/start' || new RegExp(`^recordings/${UUID}/(pause|resume|stop|share)$`, 'i').test(endpoint)) return 'POST';
    return PATHS.get(endpoint) || null;
}
function isAccountSender(event) {
    try {
        const actual = path.resolve(fileURLToPath(event.senderFrame.url));
        // Signed patches render generated local pages without modifying app.asar.
        // Only the main-process patch loader may register these exact paths.
        const original = global[Symbol.for('evd.patch.rendererPaths')]?.get(actual) || actual;
        return event.senderFrame === event.sender.mainFrame
            && original === path.resolve(__dirname, '../renderer/dialogs/broadcast-room.html');
    } catch (_) { return false; }
}
function downloadPath({ id, format, lang } = {}) {
    if (typeof id !== 'string' || !new RegExp(`^${UUID}$`, 'i').test(id) || !['mp4', 'm4a'].includes(format)) return null;
    return `recordings/${id}/download?format=${format}&lang=${['tr', 'en', 'de', 'es', 'fr'].includes(lang) ? lang : 'tr'}`;
}
async function streamRecording(endpoint, cookie, destination) {
    const temporary = `${destination}.${randomUUID()}.part`;
    try {
        const response = await new Promise((resolve, reject) => {
            const req = https.get(`${ORIGIN}/api/admin-auth/${endpoint}`, {
                headers: { Origin: ORIGIN, Cookie: `${COOKIE}=${cookie}` }
            }, resolve);
            // First-time M4A extraction can finish long after an ordinary API request.
            req.setTimeout(RECORDING_RESPONSE_TIMEOUT_MS, () => req.destroy(new Error('request_failed')));
            req.on('error', reject);
        });
        // Never follow redirects: account credentials must remain on this origin.
        if (response.statusCode !== 200) {
            response.resume();
            throw new Error(response.statusCode === 401 ? 'session_required' : 'request_failed');
        }
        response.setTimeout(TRANSFER_IDLE_TIMEOUT_MS, () => response.destroy(new Error('request_failed')));
        await pipeline(response, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
        await fs.promises.rename(temporary, destination);
        return { success: true };
    } finally { await fs.promises.rm(temporary, { force: true }); }
}

function requestAccount(endpoint, method, cookie, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body || {});
        const req = https.request(`${ORIGIN}/api/admin-auth/${endpoint}`, { method,
            headers: { Origin: ORIGIN, 'Content-Type': 'application/json',
                ...(cookie ? { Cookie: `${COOKIE}=${cookie}` } : {}),
                ...(method === 'POST' ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
            const chunks = []; let size = 0;
            res.on('data', chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) res.destroy(new Error('request_failed')); else chunks.push(chunk); });
            res.on('error', reject);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, payload: JSON.parse(Buffer.concat(chunks).toString('utf8')),
                    cookie: (res.headers['set-cookie'] || []).find(value => value.startsWith(`${COOKIE}=`))?.split(';')[0].slice(COOKIE.length + 1) }); }
                catch (_) { reject(new Error('request_failed')); }
            });
        });
        const recordingMutation = method === 'POST' && endpoint.startsWith('recordings/');
        req.setTimeout(recordingMutation ? RECORDING_RESPONSE_TIMEOUT_MS : 20000,
            () => req.destroy(new Error('request_failed')));
        req.on('error', reject);
        if (method === 'POST') req.write(data);
        req.end();
    });
}

class RoomAccountClient {
    constructor({ filePath, safeStorage, request = requestAccount }) {
        Object.assign(this, { filePath, safeStorage, request, cookie: '', remembered: false, loaded: false });
    }
    secureStorageAvailable() {
        return this.safeStorage.isEncryptionAvailable()
            && this.safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
    }
    load() {
        if (this.loaded) return;
        this.loaded = true;
        if (!fs.existsSync(this.filePath)) return;
        try {
            if (!this.secureStorageAvailable()) return;
            this.cookie = this.safeStorage.decryptString(fs.readFileSync(this.filePath));
            if (!/^[A-Za-z0-9_-]{43}$/.test(this.cookie)) throw new Error('invalid_token');
            this.remembered = true;
        } catch (_) { this.cookie = ''; this.remembered = false; }
    }
    forget() {
        this.cookie = ''; this.remembered = false;
        fs.rmSync(this.filePath, { force: true });
    }
    async call(endpoint, body = {}) {
        const method = accountMethod(endpoint);
        if (!method || JSON.stringify(body).length > 1024 * 1024) return { error: 'request_failed' };
        this.load();
        if (endpoint.startsWith('recordings') && !this.cookie) return { error: 'session_required' };
        if (endpoint === 'session' && !this.cookie) return { user: null, remembered: false };
        if (endpoint === 'desktop/remember' && (!this.secureStorageAvailable() || body.confirm !== true)) {
            return { error: 'secure_storage_unavailable' };
        }
        let response;
        try { response = await this.request(endpoint, method, this.cookie, body); }
        catch (_) {
            if (endpoint === 'logout') { this.forget(); return { success: true, remoteLogoutFailed: true }; }
            return { error: 'request_failed' };
        }
        if (endpoint === 'logout') this.forget();
        if (response.status === 401 && endpoint !== 'password-login') this.forget();
        if (response.status >= 400) return { error: response.payload.error || 'request_failed' };
        if (response.cookie !== undefined) {
            // A new login never silently inherits another account's remembered grant.
            this.forget(); this.cookie = response.cookie;
        }
        if (endpoint === 'session' && !response.payload.user) this.forget();
        if (endpoint === 'desktop/remember') {
            try {
                const encrypted = this.safeStorage.encryptString(this.cookie);
                fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
                fs.writeFileSync(`${this.filePath}.tmp`, encrypted, { mode: 0o600 });
                fs.renameSync(`${this.filePath}.tmp`, this.filePath);
                this.remembered = true;
            } catch (_) { return { error: 'secure_storage_unavailable' }; }
        }
        return { ...response.payload, remembered: this.remembered };
    }
}

function setupRoomAccountHandlers() {
    const { ipcMain, app, safeStorage, dialog, BrowserWindow } = require('electron');
    const clients = new Map();
    ipcMain.handle('room-account-request', async (event, endpoint, body) => {
        if (!isAccountSender(event)) {
            return { error: 'request_failed' };
        }
        if (!clients.has(event.sender.id)) {
            clients.set(event.sender.id, new RoomAccountClient({ filePath: path.join(app.getPath('userData'), 'room-account-device.enc'), safeStorage }));
            const id = event.sender.id;
            event.sender.once('destroyed', () => clients.delete(id));
        }
        try { return await clients.get(event.sender.id).call(endpoint, body); }
        catch (_) { return { error: 'request_failed' }; }
    });
    const downloads = new Set();
    ipcMain.handle('room-account-download', async (event, options) => {
        if (!isAccountSender(event)) return { error: 'request_failed' };
        const endpoint = downloadPath(options);
        const client = clients.get(event.sender.id);
        if (!endpoint) return { error: 'request_failed' };
        if (!client?.cookie) return { error: 'session_required' };
        if (downloads.has(event.sender.id)) return { error: 'request_failed' };
        const id = event.sender.id;
        downloads.add(id);
        try {
            const session = await client.call('session');
            if (session.error || !session.user) return { error: 'session_required' };
            const cookie = client.cookie;
            const recordings = await client.call('recordings');
            const row = recordings.recordings?.find(recording => recording.id === options.id);
            if (recordings.error || !row || row.available !== true || row.status !== 'complete') return { error: 'request_failed' };
            const i18n = require('./i18n');
            const lang = ['tr', 'en', 'de', 'es', 'fr'].includes(options.lang) ? options.lang : i18n.currentLocale;
            const resources = i18n.getMergedResources(lang);
            const translate = (key, params = {}) => {
                const template = key.split('.').reduce((value, part) => value?.[part], resources);
                return typeof template === 'string' ? template.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match) : i18n.t(key, params);
            };
            const filename = `${recordingName(row, lang, translate, { filename: true })}.${options.format}`;
            const title = translate(`desktop_cloud.download_${options.format}`);
            event.sender.send('accessibility-dialog-announce', { title,
                message: recordingName(row, lang, translate), detail: translate('desktop_cloud.retention') });
            await new Promise(resolve => setTimeout(resolve, 420));
            if (event.sender.isDestroyed() || client.cookie !== cookie) return { error: 'session_required' };
            const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
                title, defaultPath: filename
            });
            if (result.canceled || !result.filePath) return { canceled: true };
            if (event.sender.isDestroyed() || client.cookie !== cookie) return { error: 'session_required' };
            return await streamRecording(endpoint, cookie, result.filePath);
        } catch (error) {
            if (error.message === 'session_required') client.forget();
            return { error: error.message === 'session_required' ? error.message : 'request_failed' };
        } finally { downloads.delete(id); }
    });
}
module.exports = { RoomAccountClient, setupRoomAccountHandlers, accountMethod, downloadPath, isAccountSender };
