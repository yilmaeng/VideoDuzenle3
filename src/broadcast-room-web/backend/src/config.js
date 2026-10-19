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
    const workspaceLocaleDir = path.resolve(projectRoot, 'src', 'locales');
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
        smtpHost: getOptionalEnv('ADMIN_SMTP_HOST'),
        smtpPort: getNumberEnv('ADMIN_SMTP_PORT', 587),
        smtpFrom: getOptionalEnv('ADMIN_SMTP_FROM'),
        smtpUser: getOptionalEnv('ADMIN_SMTP_USER'),
        smtpPassword: getOptionalEnv('ADMIN_SMTP_PASSWORD'),
        tokenTtlSeconds: getNumberEnv('TOKEN_TTL_SECONDS', 3600),
        recordingEnabled: getOptionalEnv('SERVER_RECORDING_ENABLED', 'false') === 'true',
        recordingFilesDir: getOptionalEnv('SERVER_RECORDING_FILES_DIR'),
        recordingFfmpeg: getOptionalEnv('SERVER_RECORDING_FFMPEG', 'ffmpeg'),
        recordingFfprobe: getOptionalEnv('SERVER_RECORDING_FFPROBE', 'ffprobe'),
        recordingEgressDir: getOptionalEnv('SERVER_RECORDING_EGRESS_DIR'),
        recordingS3: {
            endpoint: getOptionalEnv('SERVER_RECORDING_S3_ENDPOINT'),
            bucket: getOptionalEnv('SERVER_RECORDING_S3_BUCKET'),
            region: getOptionalEnv('SERVER_RECORDING_S3_REGION', 'us-east-1'),
            accessKey: getOptionalEnv('SERVER_RECORDING_S3_ACCESS_KEY'),
            secret: getOptionalEnv('SERVER_RECORDING_S3_SECRET')
        },
        recordingMaxConcurrent: Math.max(1, Math.min(10, getNumberEnv('SERVER_RECORDING_MAX_CONCURRENT', 1))),
        recordingMaxMinutes: Math.max(1, Math.min(1440, getNumberEnv('SERVER_RECORDING_MAX_MINUTES', 180))),
        recordingMinFreeBytes: Math.max(1, getNumberEnv('SERVER_RECORDING_MIN_FREE_GB', 5)) * 1024 ** 3,
        dataDir: path.resolve(getOptionalEnv('DATA_DIR', path.join(process.cwd(), 'data'))),
        frontendPublicDir,
        localeDir
    };
}

module.exports = {
    loadConfig
};
