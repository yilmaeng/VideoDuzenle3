const { AccessToken } = require('livekit-server-sdk');

function buildIdentity(prefix, displayName) {
    const normalized = String(displayName || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 40) || prefix;
    return `${prefix}-${normalized}-${Date.now().toString(36)}`;
}

async function createJoinToken(config, { roomName, identity, displayName, role }) {
    const normalizedRole = String(role || 'guest').trim() || 'guest';
    const canPublish = !['audience', 'viewer'].includes(normalizedRole);
    const accessToken = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
        identity,
        name: displayName,
        ttl: `${config.tokenTtlSeconds}s`,
        metadata: JSON.stringify({
            role: normalizedRole
        })
    });

    accessToken.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish,
        canSubscribe: true,
        canPublishData: true
    });

    if (normalizedRole === 'host') {
        accessToken.addGrant({
            roomAdmin: true,
            roomRecord: true
        });
    }

    return await accessToken.toJwt();
}

module.exports = {
    buildIdentity,
    createJoinToken
};
