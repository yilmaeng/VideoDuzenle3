const crypto = require('crypto');

function createWaitingRoom({ now = Date.now, ttl = 15 * 60000, limit = 100, globalLimit = 5000 } = {}) {
    const requests = new Map();
    const fail = code => { const error = new Error(code); error.status = 409; throw error; };
    function prune() {
        for (const [id, item] of requests) {
            if (now() >= item.expiresAt && ['pending', 'approved'].includes(item.status)) item.status = 'expired';
            if (now() >= item.expiresAt + ttl) requests.delete(id);
        }
    }
    const publicItem = item => ({ requestId: item.requestId, displayName: item.displayName,
        status: item.status, createdAt: item.createdAt, expiresAt: item.expiresAt });
    function authorize(room, credentials) {
        prune();
        const item = requests.get(credentials?.requestId);
        const supplied = crypto.createHash('sha256').update(String(credentials?.secret || '')).digest();
        if (!item || item.room !== room || !crypto.timingSafeEqual(item.secretHash, supplied)) fail('waiting_credentials_invalid');
        if (!room.active && ['pending', 'approved'].includes(item.status)) item.status = 'cancelled';
        return item;
    }
    function list(room) {
        prune();
        return [...requests.values()].filter(item => item.room === room && item.status === 'pending').map(publicItem);
    }
    function decide(room, { requestId, all, decision }) {
        if (!['approve', 'reject'].includes(decision) || (all !== true && typeof requestId !== 'string')) fail('waiting_decision_invalid');
        prune();
        const selected = [...requests.values()].filter(item => item.room === room && item.status === 'pending' && (all === true || item.requestId === requestId));
        if (all !== true && !selected.length) fail('waiting_request_missing');
        selected.forEach(item => { item.status = decision === 'approve' ? 'approved' : 'rejected'; });
        return list(room);
    }
    return {
        list, decide,
        invalidate(room) {
            for (const item of requests.values()) {
                if (item.room === room && ['pending', 'approved'].includes(item.status)) item.status = 'cancelled';
            }
        },
        setting(room, enabled, decision) {
            if (enabled !== undefined && typeof enabled !== 'boolean') fail('waiting_setting_invalid');
            if (enabled === false && list(room).length) {
                if (!['admit', 'reject'].includes(decision)) fail('waiting_disable_decision_required');
                decide(room, { all: true, decision: decision === 'admit' ? 'approve' : 'reject' });
            }
        },
        enter(room, displayName, credentials) {
            // Supplied credentials must never fall through to ordinary joining after a setting change.
            if (credentials !== undefined) {
                const item = authorize(room, credentials);
                if (item.displayName !== displayName) fail('waiting_credentials_invalid');
                if (item.status !== 'approved') return { waiting: publicItem(item) };
                item.status = 'redeemed'; // Consume synchronously before token signing can yield.
                return null;
            }
            if (room.settings?.waitingRoomEnabled !== true) return null;
            prune();
            if (requests.size >= globalLimit || [...requests.values()].filter(item => item.room === room).length >= limit) fail('waiting_queue_full');
            const secret = crypto.randomBytes(32).toString('base64url');
            const item = { room, requestId: crypto.randomBytes(24).toString('base64url'), displayName,
                secretHash: crypto.createHash('sha256').update(secret).digest(), status: 'pending', createdAt: now(), expiresAt: now() + ttl };
            requests.set(item.requestId, item);
            return { waiting: { ...publicItem(item), secret } };
        },
        status(room, credentials) { return publicItem(authorize(room, credentials)); },
        cancel(room, credentials) {
            const item = authorize(room, credentials);
            if (['pending', 'approved'].includes(item.status)) item.status = 'cancelled';
            return publicItem(item);
        }
    };
}

module.exports = { createWaitingRoom };
