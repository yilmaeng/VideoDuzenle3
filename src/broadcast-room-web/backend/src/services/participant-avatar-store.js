const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_AVATAR_BYTES = 1024 * 1024;
const STALE_AVATAR_AGE_MS = 24 * 60 * 60 * 1000;
const SUPPORTED_IMAGE_TYPES = new Map([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp']
]);

function stableKey(value) {
    return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex').slice(0, 32);
}

function hasExpectedImageSignature(buffer, mimeType) {
    if (mimeType === 'image/jpeg') {
        return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }
    if (mimeType === 'image/png') {
        return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (mimeType === 'image/webp') {
        return buffer.length >= 12
            && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
            && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    }
    return false;
}

function createParticipantAvatarStore({ dataDir }) {
    let rootDir = path.join(dataDir, 'session-avatars');
    try {
        fs.mkdirSync(rootDir, { recursive: true });
        fs.accessSync(rootDir, fs.constants.W_OK);
    } catch (_error) {
        rootDir = path.join(os.tmpdir(), 'evd-broadcast-room-session-avatars');
        fs.mkdirSync(rootDir, { recursive: true });
    }

    function getRoomDir(roomId) {
        return path.join(rootDir, stableKey(roomId));
    }

    function clearParticipantAvatar(roomId, identity) {
        const roomDir = getRoomDir(roomId);
        const participantKey = stableKey(identity);
        if (!fs.existsSync(roomDir)) return;
        for (const name of fs.readdirSync(roomDir)) {
            if (name.startsWith(`${participantKey}.`)) {
                fs.rmSync(path.join(roomDir, name), { force: true });
            }
        }
    }

    function saveParticipantAvatar(roomId, identity, dataUrl) {
        const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\r\n]+)$/i.exec(String(dataUrl || '').trim());
        if (!match) {
            throw new Error('participant_avatar_invalid');
        }
        const mimeType = match[1].toLowerCase();
        const extension = SUPPORTED_IMAGE_TYPES.get(mimeType);
        const buffer = Buffer.from(match[2], 'base64');
        if (!extension || !buffer.length || buffer.length > MAX_AVATAR_BYTES || !hasExpectedImageSignature(buffer, mimeType)) {
            throw new Error(buffer.length > MAX_AVATAR_BYTES ? 'participant_avatar_too_large' : 'participant_avatar_invalid');
        }
        clearParticipantAvatar(roomId, identity);
        const roomDir = getRoomDir(roomId);
        fs.mkdirSync(roomDir, { recursive: true });
        const fileName = `${stableKey(identity)}.${extension}`;
        fs.writeFileSync(path.join(roomDir, fileName), buffer);
        return `/api/broadcast-room/avatar/${encodeURIComponent(roomId)}/${encodeURIComponent(fileName)}?v=${Date.now()}`;
    }

    function resolveAvatarPath(roomId, fileName) {
        const safeName = path.basename(String(fileName || ''));
        if (!/^[a-f0-9]{32}\.(?:jpg|png|webp)$/i.test(safeName)) return '';
        const filePath = path.join(getRoomDir(roomId), safeName);
        return fs.existsSync(filePath) ? filePath : '';
    }

    function clearRoomAvatars(roomId) {
        fs.rmSync(getRoomDir(roomId), { recursive: true, force: true });
    }

    function cleanupStaleAvatars() {
        const cutoff = Date.now() - STALE_AVATAR_AGE_MS;
        for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const dirPath = path.join(rootDir, entry.name);
            try {
                if (fs.statSync(dirPath).mtimeMs < cutoff) {
                    fs.rmSync(dirPath, { recursive: true, force: true });
                }
            } catch (_error) {
                // A concurrent cleanup may already have removed this directory.
            }
        }
    }

    cleanupStaleAvatars();
    return {
        saveParticipantAvatar,
        clearParticipantAvatar,
        resolveAvatarPath,
        clearRoomAvatars
    };
}

module.exports = {
    createParticipantAvatarStore
};
