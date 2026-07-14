const path = require('path');
const fs = require('fs');

function requireEnv(name) {
    const value = String(process.env[name] || '').trim();
    if (!value) {
        throw new Error(`missing_env_${name}`);
    }
    return value;
}

function getOptionalEnv(name, fallback = '') {
    const value = String(process.env[name] || '').trim();
    return value || fallback;
}

function getNumberEnv(name, fallback) {
    const raw = String(process.env[name] || '').trim();
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getExistingPath(candidates = []) {
    for (const candidate of candidates) {
        if (!candidate) continue;
        try {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        } catch (_error) {
            // ignore lookup failures and continue
        }
    }
    return candidates[0] || '';
}

function loadConfig() {
    const backendRoot = path.resolve(__dirname, '..');
    const projectRoot = path.resolve(backendRoot, '..', '..', '..');
    const embeddedPublicDir = path.resolve(backendRoot, 'public');
    const workspacePublicDir = path.resolve(backendRoot, '..', 'frontend', 'public');
    const embeddedLocaleDir = path.resolve(backendRoot, 'locales');
    const workspaceLocaleDir = path.resolve(projectRoot, 'locales');
    const frontendPublicDir = getOptionalEnv('FRONTEND_PUBLIC_DIR')
        ? path.resolve(getOptionalEnv('FRONTEND_PUBLIC_DIR'))
        : getExistingPath([embeddedPublicDir, workspacePublicDir]);
    const localeDir = getOptionalEnv('LOCALE_DIR')
        ? path.resolve(getOptionalEnv('LOCALE_DIR'))
        : getExistingPath([embeddedLocaleDir, workspaceLocaleDir]);

    return {
        port: getNumberEnv('PORT', 4100),
        appBaseUrl: requireEnv('APP_BASE_URL').replace(/\/+$/, ''),
        broadcastRoomBasePath: getOptionalEnv('BROADCAST_ROOM_BASE_PATH', '/yayinodasi'),
        broadcastRoomApiBasePath: getOptionalEnv('BROADCAST_ROOM_API_BASE_PATH', '/api'),
        livekitUrl: requireEnv('LIVEKIT_URL'),
        livekitApiKey: requireEnv('LIVEKIT_API_KEY'),
        livekitApiSecret: requireEnv('LIVEKIT_API_SECRET'),
        webinarAdminSecret: getOptionalEnv('WEBINAR_ADMIN_SECRET'),
        tokenTtlSeconds: getNumberEnv('TOKEN_TTL_SECONDS', 3600),
        dataDir: path.resolve(process.cwd(), 'data'),
        frontendPublicDir,
        localeDir
    };
}

module.exports = {
    loadConfig
};
