const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { isRoomOwner, publicRoomPayload, createParticipantSessions } = require('../broadcast-room-web/backend/src/services/room-authorization');
const { RoomStore } = require('../broadcast-room-web/backend/src/store/room-store');
const room = { roomId: 'room', settings: { ownerKey: 'owner-secret', roomPasswordHash: 'hash' }, participants: [
    { identity: 'a', displayName: 'Alice', role: 'guest', connected: true },
    { identity: 'b', displayName: 'Bob', role: 'guest', connected: true }
] };
assert(!isRoomOwner({}, ''));
assert(!isRoomOwner(room, ''));
assert(!isRoomOwner(room, 'wrong'));
assert(isRoomOwner(room, 'owner-secret'));
assert.deepEqual(publicRoomPayload({ rooms: [room] }).rooms[0].settings, {});
assert.equal(room.settings.ownerKey, 'owner-secret', 'Sanitization must not modify stored keys');
const sessions = createParticipantSessions();
const roomStore = { getRoom: (id) => id === 'room' ? room : null };
let middleware;
const context = { router: { use: (...args) => { if (args.length === 1) middleware = args[0]; },
    isTemporaryManager: (roomId, identity, key) => roomId === room.roomId
        && room.participants.some(item => item.identity === identity && item.role === 'co_host')
        && sessions.verify(room, identity, key) }, participantSessions: sessions,
    createSystemAdminAccounts: () => () => {}, config: {}, requireAdminSession() {},
    roomStore, publicRoomPayload,
    verifyRoomOwnerRequest: (req, target) => isRoomOwner(target, req.get('X-EVD-Room-Owner-Key')) };
vm.createContext(context);
const source = fs.readFileSync(path.join(__dirname, '../broadcast-room-web/backend/src/routes/broadcast-room.js'), 'utf8');
vm.runInContext(source.slice(source.indexOf('    const ownerActions ='), source.indexOf('    const livekitServiceUrl =')), context);
function request(action, body = {}, headers = {}, responsePayload) {
    const req = { method: 'POST', path: `/broadcast-room/${action}`, body: { roomId: 'room', ...body }, get: (name) => headers[name] || '' };
    const result = { allowed: false, status: 200 };
    const res = { set() { return this; }, status(code) { result.status = code; return this; }, json(payload) { result.payload = payload; return this; } };
    middleware(req, res, () => { result.allowed = true; if (responsePayload) res.json(responsePayload); });
    return { ...result, body: req.body };
}
const joined = request('join-token', {}, {}, { roomId: 'room', participantIdentity: 'a', token: 'join-token', settings: room.settings });
const key = joined.payload.participantApiKey;
assert(key && key.length === 64);
assert(!('ownerKey' in joined.payload.settings));
const own = { 'X-EVD-Participant-Key': key };
for (const action of ['participant-state', 'participant-avatar', 'participant-role-token', 'hand-raise', 'leave']) {
    assert(request(action, { identity: 'a' }, own).allowed, action);
    assert.equal(request(action, { identity: 'b' }, own).status, 403, action);
    assert.equal(request(action, { identity: 'a' }).status, 403, action);
}
assert(request('leave', { identity: 'a', participantApiKey: key }).allowed, 'Beacon uses body credential');
for (const action of ['waiting-list', 'waiting-decision', 'host-token', 'participant-controls', 'all-guest-controls', 'participant-remove', 'room-settings', 'scene-state', 'live-caption', 'translation-audio', 'accessible-share', 'room/end-session', 'room/close']) {
    assert.equal(request(action, { identity: 'a' }, own).status, 403, action);
    assert(request(action, {}, { 'X-EVD-Room-Owner-Key': 'owner-secret' }).allowed, action);
}
const chat = request('chat-message', { senderIdentity: 'a', senderRole: 'host', senderName: 'Forged' }, own);
assert(chat.allowed);
assert.equal(chat.body.senderName, 'Alice'); assert.equal(chat.body.senderRole, 'guest');
assert.equal(request('chat-message', { senderIdentity: 'b' }, own).status, 403);
room.participants[0].connected = false;
assert.equal(request('participant-state', { identity: 'a' }, own).status, 403);
room.participants = [];
sessions.prune(roomStore);
room.participants.push({ identity: 'a', connected: true });
assert(!sessions.verify(room, 'a', key), 'Removed credentials must not return with reused identity');
assert.equal(request('%GG/close').status, 400);
const store = new RoomStore();
const temp = store.createRoom({ hostDisplayName: 'Host', inviteBaseUrl: '', ownerKey: 'local-owner' });
assert.equal(temp.settings.ownerKey, 'local-owner', 'Temporary rooms also need owner protection');
assert.equal(store.updateRoomSettings(temp.roomId, { roomTitle: 'Forged' }), null);
assert(store.updateRoomSettings(temp.roomId, { ownerKey: 'local-owner', roomTitle: 'Valid' }));
console.log('Room authorization: self actions, impersonation denial, owner actions, key redaction, revocation and temporary rooms passed.');
