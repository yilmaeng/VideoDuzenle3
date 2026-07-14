const { WebSocketServer } = require('ws');

function safeSend(ws, data, options = {}) {
    if (!ws || ws.readyState !== ws.OPEN) {
        return false;
    }
    try {
        ws.send(data, options);
        return true;
    } catch (_error) {
        return false;
    }
}

function createMonitorAudioHub({ config, roomStore }) {
    const socketPath = `${String(config.broadcastRoomApiBasePath || '/api').replace(/\/+$/, '')}/broadcast-room/monitor-audio`;
    const wss = new WebSocketServer({ noServer: true });
    const clientsByRoom = new Map();
    let lastForwardLogAt = 0;

    function logMonitorEvent(event, details = {}) {
        try {
            console.log(JSON.stringify({
                scope: 'monitor-audio',
                event,
                at: new Date().toISOString(),
                ...details
            }));
        } catch (_error) {
            // Diagnostics must never interrupt room audio forwarding.
        }
    }

    function getRoomSet(roomId, channel = 'share') {
        const key = String(roomId || '').trim();
        const normalizedChannel = String(channel || 'share').trim() || 'share';
        const mapKey = `${key}:${normalizedChannel}`;
        if (!clientsByRoom.has(mapKey)) {
            clientsByRoom.set(mapKey, new Set());
        }
        return clientsByRoom.get(mapKey);
    }

    function removeClient(ws) {
        const roomId = String(ws.__roomId || '').trim();
        if (!roomId) {
            return;
        }
        const channel = String(ws.__channel || 'share').trim() || 'share';
        const mapKey = `${roomId}:${channel}`;
        const roomSet = clientsByRoom.get(mapKey);
        if (!roomSet) {
            return;
        }
        roomSet.delete(ws);
        if (roomSet.size === 0) {
            clientsByRoom.delete(mapKey);
        }
    }

    function attach(server) {
        server.on('upgrade', (request, socket, head) => {
            let requestUrl = null;
            try {
                requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
            } catch (_error) {
                socket.destroy();
                return;
            }
            if (requestUrl.pathname !== socketPath) {
                return;
            }

            const roomId = String(requestUrl.searchParams.get('roomId') || '').trim();
            const role = String(requestUrl.searchParams.get('role') || 'guest').trim() === 'host' ? 'host' : 'guest';
            const identity = String(requestUrl.searchParams.get('identity') || '').trim();
            const channel = String(requestUrl.searchParams.get('channel') || 'share').trim() || 'share';
            const room = roomStore.getRoom(roomId);
            if (!room || room.active === false) {
                logMonitorEvent('upgrade-rejected-room-inactive', { roomId, role, hasRoom: !!room });
                socket.destroy();
                return;
            }

            wss.handleUpgrade(request, socket, head, (ws) => {
                ws.__roomId = roomId;
                ws.__role = role;
                ws.__identity = identity;
                ws.__channel = channel;
                getRoomSet(roomId, channel).add(ws);
                const roomSet = getRoomSet(roomId, channel);
                logMonitorEvent('client-connected', {
                    roomId,
                    role,
                    identity,
                    channel,
                    roomClientCount: roomSet.size,
                    guestClientCount: Array.from(roomSet).filter((client) => client.__role !== 'host').length,
                    hostClientCount: Array.from(roomSet).filter((client) => client.__role === 'host').length
                });
                safeSend(ws, JSON.stringify({
                    type: 'ready',
                    sampleRate: channel === 'translation' ? 24000 : 48000,
                    channels: channel === 'translation' ? 1 : 2,
                    channel
                }));
                wss.emit('connection', ws, request);
            });
        });
    }

    wss.on('connection', (ws) => {
        ws.on('message', (data, isBinary) => {
            if (ws.__role !== 'host' || !isBinary) {
                return;
            }
            const mapKey = `${String(ws.__roomId || '').trim()}:${String(ws.__channel || 'share').trim() || 'share'}`;
            const roomSet = clientsByRoom.get(mapKey);
            if (!roomSet) {
                return;
            }
            let forwardedCount = 0;
            for (const peer of roomSet) {
                if (peer === ws || peer.__role === 'host') {
                    continue;
                }
                if (safeSend(peer, data, { binary: true })) {
                    forwardedCount += 1;
                }
            }
            const now = Date.now();
            if (!lastForwardLogAt || now - lastForwardLogAt > 3000) {
                lastForwardLogAt = now;
                logMonitorEvent('host-audio-forwarded', {
                    roomId: ws.__roomId || '',
                    channel: ws.__channel || 'share',
                    bytes: data?.length || data?.byteLength || 0,
                    forwardedCount,
                    roomClientCount: roomSet.size
                });
            }
        });
        ws.on('close', () => {
            logMonitorEvent('client-closed', {
                roomId: ws.__roomId || '',
                role: ws.__role || '',
                identity: ws.__identity || '',
                channel: ws.__channel || 'share'
            });
            removeClient(ws);
        });
        ws.on('error', () => {
            logMonitorEvent('client-error', {
                roomId: ws.__roomId || '',
                role: ws.__role || '',
                identity: ws.__identity || '',
                channel: ws.__channel || 'share'
            });
            removeClient(ws);
        });
    });

    const pingTimer = setInterval(() => {
        for (const roomSet of clientsByRoom.values()) {
            for (const ws of roomSet) {
                if (ws.readyState !== ws.OPEN) {
                    removeClient(ws);
                    continue;
                }
                try {
                    ws.ping();
                } catch (_error) {
                    removeClient(ws);
                }
            }
        }
    }, 30000);
    pingTimer.unref?.();

    return {
        attach
    };
}

module.exports = {
    createMonitorAudioHub
};
