'use strict';

function createParticipantPresence({ roomStore, roomService, onChanged, now = Date.now }) {
    const absent = new Map();
    let busy = false;
    return async function reconcile() {
        if (busy) return;
        busy = true;
        try {
            for (const room of roomStore.rooms.values()) {
                const candidates = room.participants.filter(person => person.connected !== false
                    && (person.role === 'host' || now() - Number(person.updatedAt || person.joinedAt) > 120000));
                if (!room.active || !candidates.length) { absent.delete(room.roomId); continue; }
                let remote;
                try { remote = await roomService.listParticipants(room.roomId); }
                catch (error) {
                    if (error.code === 'not_found') remote = [];
                    else { absent.delete(room.roomId); continue; } // An API failure is not proof of absence.
                }
                if (!Array.isArray(remote) || roomStore.rooms.get(room.roomId) !== room) continue;
                const identities = new Set(remote.map(person => person.identity));
                const previous = absent.get(room.roomId) || new Map(), next = new Map();
                let changed = false;
                for (const person of candidates) {
                    const host = person.role === 'host';
                    if (!room.participants.includes(person) || identities.has(person.identity)
                        || (host ? remote.length > 0 || room.webHostJoinPending
                            : now() - Number(person.updatedAt || person.joinedAt) <= 120000)) continue;
                    // Host HTTP heartbeats may continue after WebRTC has gone.
                    // Use stable session identity, but never reap a nonempty room.
                    const key = host ? `host:${person.identity}:${person.joinedAt}` : person;
                    const since = previous.get(key) ?? now();
                    if (now() - since < (host ? 120000 : 60000)) { next.set(key, since); continue; }
                    room.participants = room.participants.filter(item => item !== person);
                    changed = true;
                }
                absent.set(room.roomId, next);
                if (changed) onChanged(room);
            }
            for (const id of absent.keys()) if (!roomStore.rooms.has(id)) absent.delete(id);
        } finally { busy = false; }
    };
}
module.exports = { createParticipantPresence };
