const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createParticipantPresence } = require('../src/services/participant-presence');
const { RoomStore } = require('../src/store/room-store');

function fixture() {
    let time = 300000, remote = [], failure = false, changed = 0;
    const person = { identity: 'guest', role: 'guest', connected: true, updatedAt: 1 };
    const room = { roomId: 'room', active: true, participants: [person] };
    const roomStore = { rooms: new Map([['room', room]]) };
    const run = createParticipantPresence({ roomStore,
        roomService: { async listParticipants() { if (failure) throw new Error('network'); return remote; } },
        now: () => time, onChanged: () => changed++ });
    return { run, room, person, advance: () => time += 61000,
        remote: value => remote = value, fail: value => failure = value, changes: () => changed };
}
test('HTTP inactivity does not remove a connected guest when reading the room', () => {
    const room = { participants: [{ role: 'guest', connected: true, updatedAt: 1 }] };
    assert.equal(RoomStore.prototype.pruneStaleParticipants(room), false);
    assert.equal(room.participants.length, 1);
});
test('WebRTC presence retains inactive mobile guests', async () => {
    const f = fixture(); f.remote([{ identity: 'guest' }]);
    await f.run(); f.advance(); await f.run();
    assert.equal(f.room.participants.length, 1);
});
test('only consecutive authoritative absence removes a stale guest', async () => {
    const f = fixture(); await f.run(); assert.equal(f.room.participants.length, 1);
    f.advance(); await f.run(); assert.equal(f.room.participants.length, 0);
    assert.equal(f.changes(), 1);
});
test('network errors reset absence rather than expelling users', async () => {
    const f = fixture(); await f.run(); f.advance(); f.fail(true); await f.run();
    f.fail(false); await f.run(); assert.equal(f.room.participants.length, 1);
});
test('fresh heartbeat and replacement participant survive pending reconciliation', async () => {
    const f = fixture(); await f.run(); f.advance();
    f.room.participants = [{ ...f.person }]; await f.run();
    assert.equal(f.room.participants.length, 1);
    f.room.participants[0].updatedAt = 361000;
    await f.run(); assert.equal(f.room.participants.length, 1);
});

test('empty room clears stale host after two minutes, preserving permanent room', async () => {
    const f = fixture(); f.person.role = 'host'; f.person.joinedAt = 1;
    f.room.settings = { persistentRoom: true, ownerKey: 'unchanged' };
    await f.run(); f.advance(); await f.run();
    assert.equal(f.room.participants.length, 1);
    // HTTP updates recreate the participant but do not restore media presence.
    f.room.participants = [{...f.person, updatedAt:361000}];
    f.advance(); await f.run();
    assert.equal(f.room.participants.length, 0);
    assert.equal(f.room.active, true);
    assert.equal(f.room.settings.ownerKey, 'unchanged');
});

test('host remains while any real participant is present', async () => {
    const f = fixture(); f.person.role='host';
    await f.run(); f.advance(); f.remote([{identity:'someone'}]); await f.run();
    f.advance(); await f.run();
    assert.equal(f.room.participants.length,1);
    f.remote([]); await f.run(); f.advance(); await f.run();
    assert.equal(f.room.participants.length,1,'Empty-room grace restarts');
});

test('network failure, active host and new host session reset cleanup', async () => {
    const f=fixture(); f.person.role='host'; f.person.joinedAt=1;
    await f.run(); f.advance(); f.fail(true); await f.run();
    f.fail(false); f.advance(); await f.run();
    assert.equal(f.room.participants.length,1);
    f.remote([{identity:'guest'}]); f.advance(); await f.run();
    assert.equal(f.room.participants.length,1);
    f.remote([]); await f.run(); f.advance();
    f.room.participants=[{...f.person,joinedAt:500000}];
    await f.run(); f.advance(); await f.run();
    assert.equal(f.room.participants.length,1);
});
