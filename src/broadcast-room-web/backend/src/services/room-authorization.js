const crypto = require('crypto');

function isRoomOwner(room, key) {
    const expected = String(room?.settings?.ownerKey || '').trim();
    const supplied = String(key || '').trim();
    if (!expected || !supplied) return false;
    const a = Buffer.from(expected), b = Buffer.from(supplied);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function publicRoomPayload(value) {
    if (Array.isArray(value)) return value.map(publicRoomPayload);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !['ownerKey', 'roomPasswordHash'].includes(key))
        .map(([key, item]) => [key, publicRoomPayload(item)]));
}

function createParticipantSessions() {
    const sessions = new Map();
    return {
        issue(roomId, identity) {
            const key = `${roomId}:${identity}`;
            if (!sessions.has(key)) sessions.set(key, crypto.randomBytes(32).toString('hex'));
            return sessions.get(key);
        },
        verify(room, identity, supplied) {
            if (!room?.participants?.some((item) => item.identity === identity && item.connected !== false)) return false;
            const expected = sessions.get(`${room.roomId}:${identity}`);
            return !!expected && isRoomOwner({ settings: { ownerKey: expected } }, supplied);
        },
        prune(roomStore) {
            for (const key of sessions.keys()) {
                const split = key.lastIndexOf(':');
                const room = roomStore.getRoom(key.slice(0, split));
                if (!room?.participants?.some((item) => item.identity === key.slice(split + 1))) sessions.delete(key);
            }
        }
    };
}

module.exports = { isRoomOwner, publicRoomPayload, createParticipantSessions };
