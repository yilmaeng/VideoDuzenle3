const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { buildIdentity, createJoinToken } = require('../services/token-service');

const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOCAL_RECORDING_RETENTION_MS = 72 * 60 * 60 * 1000;

function createBroadcastRoomRouter({ config, roomStore }) {
    const router = express.Router();
    const inviteBaseUrl = `${config.appBaseUrl}${config.broadcastRoomBasePath}`;
    const adminSessions = new Map();
    const roomEventClients = new Map();

    function isAdminSecretConfigured() {
        return String(config.webinarAdminSecret || '').trim().length > 0;
    }

    function cleanupAdminSessions() {
        const now = Date.now();
        for (const [token, session] of adminSessions.entries()) {
            if (!session || Number(session.expiresAt || 0) <= now) {
                adminSessions.delete(token);
            }
        }
    }

    function safeSecretEquals(left, right) {
        const leftBuffer = Buffer.from(String(left || ''), 'utf8');
        const rightBuffer = Buffer.from(String(right || ''), 'utf8');
        if (leftBuffer.length !== rightBuffer.length) {
            return false;
        }
        return crypto.timingSafeEqual(leftBuffer, rightBuffer);
    }

    function createAdminSession() {
        cleanupAdminSessions();
        const adminToken = crypto.randomBytes(32).toString('base64url');
        const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
        adminSessions.set(adminToken, { expiresAt });
        return { adminToken, expiresAt };
    }

    function getValidAdminSession(adminToken) {
        cleanupAdminSessions();
        const token = String(adminToken || '').trim();
        if (!token) {
            return null;
        }
        const session = adminSessions.get(token);
        if (!session || Number(session.expiresAt || 0) <= Date.now()) {
            adminSessions.delete(token);
            return null;
        }
        return session;
    }

    function getRoomOwnerKey(req) {
        return String(req.get('X-EVD-Room-Owner-Key') || req.body?.ownerKey || req.query?.ownerKey || '').trim();
    }

    function verifyRoomOwnerRequest(req, room) {
        const expectedOwnerKey = String(room?.settings?.ownerKey || '').trim();
        return !expectedOwnerKey || getRoomOwnerKey(req) === expectedOwnerKey;
    }

    function requireAdminSession(req, res) {
        const adminToken = String(req.body?.adminToken || req.query?.adminToken || '').trim();
        if (!getValidAdminSession(adminToken)) {
            res.status(403).json({ success: false, error: 'admin_session_required' });
            return false;
        }
        return true;
    }

    function sendServerEvent(res, eventName, payload = {}) {
        try {
            res.write(`event: ${eventName}\n`);
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch (_error) {
            // Connection cleanup is handled by the request close event.
        }
    }

    function addRoomEventClient(roomId, res) {
        const key = String(roomId || '').trim();
        if (!key) {
            return () => {};
        }
        if (!roomEventClients.has(key)) {
            roomEventClients.set(key, new Set());
        }
        const clients = roomEventClients.get(key);
        clients.add(res);
        return () => {
            clients.delete(res);
            if (!clients.size) {
                roomEventClients.delete(key);
            }
        };
    }

    function broadcastRoomEvent(roomId, eventName, payload = {}) {
        const clients = roomEventClients.get(String(roomId || '').trim());
        if (!clients || !clients.size) {
            return;
        }
        for (const res of clients) {
            sendServerEvent(res, eventName, payload);
        }
    }

    function buildRoomResponse(room) {
        const hostConnected = roomStore.roomHasConnectedHost(room);
        return {
            success: true,
            roomId: room.roomId,
            inviteId: room.inviteId,
            title: room.title,
            active: room.active,
            createdAt: room.createdAt,
            scheduledAt: room.scheduledAt,
            hostDisplayName: room.hostDisplayName,
            hostConnected,
            inviteUrl: `${inviteBaseUrl.replace(/\/+$/, '')}/join/${encodeURIComponent(room.inviteId)}`,
            participants: room.participants,
            sceneState: room.sceneState,
            settings: {
                ...room.settings,
                roomPasswordHash: undefined
            },
            joinPolicy: {
                persistentRoom: room.settings?.persistentRoom === true,
                allowJoinWhenHostAbsent: room.settings?.allowJoinWhenHostAbsent === true,
                passwordConfigured: room.settings?.passwordConfigured === true,
                requirePasswordNow: roomStore.isPasswordRequired(room, { hostConnected })
            },
            chatMessages: room.chatMessages,
            liveCaption: room.liveCaption || {
                enabled: false,
                text: '',
                originalText: '',
                translatedText: '',
                alternateText: '',
                alternateLanguage: '',
                sourceLanguage: '',
                targetLanguage: '',
                scope: '',
                mode: '',
                updatedAt: 0
            },
            accessibleShare: room.accessibleShare || {
                active: false,
                title: '',
                fileName: '',
                kind: '',
                currentIndex: 0,
                items: [],
                updatedAt: 0
            }
        };
    }

    function sanitizePathSegment(value, fallback = 'item') {
        const safe = String(value || '')
            .trim()
            .replace(/[^a-z0-9_-]+/gi, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 120);
        return safe || fallback;
    }

    function getLocalRecordingSessionDir({ roomId, identity, sessionId }) {
        return path.join(
            config.dataDir,
            'local-recordings',
            sanitizePathSegment(roomId, 'room'),
            sanitizePathSegment(identity, 'participant'),
            sanitizePathSegment(sessionId, 'session')
        );
    }

    function getLocalRecordingRoomDir(roomId) {
        return path.join(
            config.dataDir,
            'local-recordings',
            sanitizePathSegment(roomId, 'room')
        );
    }

    function removeDirectorySafe(targetPath, expectedParentPath) {
        const resolvedTarget = path.resolve(targetPath);
        const resolvedParent = path.resolve(expectedParentPath);
        if (!(resolvedTarget === resolvedParent || resolvedTarget.startsWith(`${resolvedParent}${path.sep}`))) {
            throw new Error('unsafe_local_recording_cleanup_path');
        }
        if (fs.existsSync(resolvedTarget)) {
            fs.rmSync(resolvedTarget, { recursive: true, force: true });
        }
    }

    function readLocalRecordingManifest(sessionDir) {
        const manifestPath = path.join(sessionDir, 'manifest.json');
        try {
            return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (_error) {
            return null;
        }
    }

    function writeLocalRecordingManifest(sessionDir, manifest) {
        fs.mkdirSync(sessionDir, { recursive: true });
        fs.writeFileSync(path.join(sessionDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }

    function summarizeLocalRecordingManifest(manifest, sessionDir) {
        const chunks = Array.isArray(manifest?.chunks) ? manifest.chunks : [];
        const totalBytes = chunks.reduce((sum, chunk) => sum + Math.max(0, Number(chunk?.bytes || 0)), 0);
        return {
            roomId: String(manifest?.roomId || ''),
            identity: String(manifest?.identity || ''),
            displayName: String(manifest?.displayName || manifest?.identity || ''),
            sessionId: String(manifest?.sessionId || ''),
            kind: String(manifest?.kind || ''),
            mediaKind: String(manifest?.mediaKind || ''),
            mimeType: String(manifest?.mimeType || ''),
            startedAt: Number(manifest?.startedAt || 0) || 0,
            stoppedAt: Number(manifest?.stoppedAt || 0) || 0,
            updatedAt: Number(manifest?.updatedAt || 0) || 0,
            completed: manifest?.completed === true,
            chunkCount: chunks.length,
            totalBytes
        };
    }

    function cleanupExpiredLocalRecordings() {
        const rootDir = path.join(config.dataDir, 'local-recordings');
        if (!fs.existsSync(rootDir)) {
            return 0;
        }
        const now = Date.now();
        let removed = 0;
        for (const roomEntry of fs.readdirSync(rootDir, { withFileTypes: true })) {
            if (!roomEntry.isDirectory()) {
                continue;
            }
            const roomDir = path.join(rootDir, roomEntry.name);
            for (const identityEntry of fs.readdirSync(roomDir, { withFileTypes: true })) {
                if (!identityEntry.isDirectory()) {
                    continue;
                }
                const participantDir = path.join(roomDir, identityEntry.name);
                for (const sessionEntry of fs.readdirSync(participantDir, { withFileTypes: true })) {
                    if (!sessionEntry.isDirectory()) {
                        continue;
                    }
                    const sessionDir = path.join(participantDir, sessionEntry.name);
                    const manifest = readLocalRecordingManifest(sessionDir);
                    const referenceTime = Number(manifest?.stoppedAt || manifest?.updatedAt || manifest?.startedAt || 0);
                    if (manifest?.completed === true && referenceTime > 0 && now - referenceTime >= LOCAL_RECORDING_RETENTION_MS) {
                        removeDirectorySafe(sessionDir, participantDir);
                        removed += 1;
                    }
                }
                try {
                    if (fs.existsSync(participantDir) && fs.readdirSync(participantDir).length === 0) {
                        fs.rmdirSync(participantDir);
                    }
                } catch (_error) {}
            }
            try {
                if (fs.existsSync(roomDir) && fs.readdirSync(roomDir).length === 0) {
                    fs.rmdirSync(roomDir);
                }
            } catch (_error) {}
        }
        return removed;
    }

    function clearLocalRecordingsForRoom(roomId) {
        cleanupExpiredLocalRecordings();
        const roomDir = getLocalRecordingRoomDir(roomId);
        const rootDir = path.join(config.dataDir, 'local-recordings');
        if (!fs.existsSync(roomDir)) {
            return 0;
        }
        let removed = 0;
        for (const identityEntry of fs.readdirSync(roomDir, { withFileTypes: true })) {
            if (!identityEntry.isDirectory()) {
                continue;
            }
            const participantDir = path.join(roomDir, identityEntry.name);
            for (const sessionEntry of fs.readdirSync(participantDir, { withFileTypes: true })) {
                if (!sessionEntry.isDirectory()) {
                    continue;
                }
                removeDirectorySafe(path.join(participantDir, sessionEntry.name), participantDir);
                removed += 1;
            }
        }
        removeDirectorySafe(roomDir, rootDir);
        return removed;
    }

    router.get('/health', (_req, res) => {
        res.json({
            success: true,
            service: 'evd-broadcast-room-backend'
        });
    });

    router.get('/broadcast-room/local-recordings', (req, res) => {
        try {
            cleanupExpiredLocalRecordings();
            const roomId = String(req.query?.roomId || '').trim();
            if (!roomId) {
                res.status(400).json({ success: false, error: 'local_recordings_room_missing' });
                return;
            }
            const room = roomStore.getRoom(roomId);
            if (!room) {
                res.status(404).json({ success: false, error: 'room_not_found' });
                return;
            }
            if (!verifyRoomOwnerRequest(req, room)) {
                res.status(403).json({ success: false, error: 'room_owner_key_required' });
                return;
            }
            const roomDir = getLocalRecordingRoomDir(roomId);
            if (!fs.existsSync(roomDir)) {
                res.json({ success: true, roomId, recordings: [] });
                return;
            }
            const recordings = [];
            for (const identityEntry of fs.readdirSync(roomDir, { withFileTypes: true })) {
                if (!identityEntry.isDirectory()) {
                    continue;
                }
                const participantDir = path.join(roomDir, identityEntry.name);
                for (const sessionEntry of fs.readdirSync(participantDir, { withFileTypes: true })) {
                    if (!sessionEntry.isDirectory()) {
                        continue;
                    }
                    const sessionDir = path.join(participantDir, sessionEntry.name);
                    const manifest = readLocalRecordingManifest(sessionDir);
                    if (manifest) {
                        recordings.push(summarizeLocalRecordingManifest(manifest, sessionDir));
                    }
                }
            }
            recordings.sort((left, right) => Number(right.updatedAt || right.startedAt || 0) - Number(left.updatedAt || left.startedAt || 0));
            res.json({ success: true, roomId, recordings });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error?.message || 'local_recordings_list_failed'
            });
        }
    });

    router.delete('/broadcast-room/local-recordings', (req, res) => {
        try {
            const roomId = String(req.query?.roomId || req.body?.roomId || '').trim();
            if (!roomId) {
                res.status(400).json({ success: false, error: 'local_recordings_room_missing' });
                return;
            }
            const room = roomStore.getRoom(roomId);
            if (!room) {
                res.status(404).json({ success: false, error: 'room_not_found' });
                return;
            }
            if (!verifyRoomOwnerRequest(req, room)) {
                res.status(403).json({ success: false, error: 'room_owner_key_required' });
                return;
            }
            const removed = clearLocalRecordingsForRoom(roomId);
            res.json({
                success: true,
                roomId,
                removed
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error?.message || 'local_recordings_clear_failed'
            });
        }
    });

    router.get('/broadcast-room/local-recording-download', (req, res) => {
        try {
            cleanupExpiredLocalRecordings();
            const roomId = String(req.query?.roomId || '').trim();
            const identity = String(req.query?.identity || '').trim();
            const sessionId = String(req.query?.sessionId || '').trim();
            if (!roomId || !identity || !sessionId) {
                res.status(400).json({ success: false, error: 'local_recording_download_missing_fields' });
                return;
            }
            const room = roomStore.getRoom(roomId);
            if (!room) {
                res.status(404).json({ success: false, error: 'room_not_found' });
                return;
            }
            if (!verifyRoomOwnerRequest(req, room)) {
                res.status(403).json({ success: false, error: 'room_owner_key_required' });
                return;
            }
            const sessionDir = getLocalRecordingSessionDir({ roomId, identity, sessionId });
            const manifest = readLocalRecordingManifest(sessionDir);
            if (!manifest) {
                res.status(404).json({ success: false, error: 'local_recording_session_not_found' });
                return;
            }
            const chunks = Array.isArray(manifest.chunks)
                ? manifest.chunks
                    .slice()
                    .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0))
                : [];
            if (!chunks.length) {
                res.status(404).json({ success: false, error: 'local_recording_chunks_not_found' });
                return;
            }
            const resolvedSessionDir = path.resolve(sessionDir);
            const chunkPaths = chunks.map((chunk) => path.resolve(sessionDir, String(chunk.fileName || '')));
            if (chunkPaths.some((chunkPath) => !(chunkPath === resolvedSessionDir || chunkPath.startsWith(`${resolvedSessionDir}${path.sep}`)) || !fs.existsSync(chunkPath))) {
                res.status(404).json({ success: false, error: 'local_recording_chunk_file_missing' });
                return;
            }
            const totalBytes = chunks.reduce((sum, chunk) => sum + Math.max(0, Number(chunk.bytes || 0)), 0);
            const mimeType = String(manifest.mimeType || 'application/octet-stream');
            const extension = mimeType.includes('ogg')
                ? 'ogg'
                : (mimeType.includes('mp4') ? 'mp4' : 'webm');
            res.setHeader('Content-Type', mimeType);
            if (totalBytes > 0) {
                res.setHeader('Content-Length', String(totalBytes));
            }
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="local-recording-${sanitizePathSegment(identity, 'participant')}-${sanitizePathSegment(sessionId, 'session')}.${extension}"`
            );

            let index = 0;
            const streamNextChunk = () => {
                if (index >= chunkPaths.length) {
                    res.end();
                    return;
                }
                const stream = fs.createReadStream(chunkPaths[index]);
                index += 1;
                stream.on('error', (error) => {
                    if (!res.headersSent) {
                        res.status(500).json({ success: false, error: error?.message || 'local_recording_download_failed' });
                    } else {
                        res.destroy(error);
                    }
                });
                stream.on('end', streamNextChunk);
                stream.pipe(res, { end: false });
            };
            streamNextChunk();
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error?.message || 'local_recording_download_failed'
            });
        }
    });

    router.post('/broadcast-room/local-recording-chunk', express.raw({
        type: '*/*',
        limit: '25mb'
    }), (req, res) => {
        try {
            cleanupExpiredLocalRecordings();
            const roomId = String(req.query?.roomId || '').trim();
            const identity = String(req.query?.identity || '').trim();
            const sessionId = String(req.query?.sessionId || '').trim();
            const sequence = Number.parseInt(String(req.query?.sequence || '0'), 10);
            if (!roomId || !identity || !sessionId || !Number.isFinite(sequence) || sequence <= 0) {
                res.status(400).json({ success: false, error: 'local_recording_chunk_missing_fields' });
                return;
            }
            const room = roomStore.getRoom(roomId);
            const participant = Array.isArray(room?.participants)
                ? room.participants.find((item) => String(item.identity || '').trim() === identity)
                : null;
            if (!room) {
                res.status(404).json({ success: false, error: 'room_not_found' });
                return;
            }
            if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
                res.status(400).json({ success: false, error: 'local_recording_chunk_empty' });
                return;
            }

            const sessionDir = getLocalRecordingSessionDir({ roomId, identity, sessionId });
            fs.mkdirSync(sessionDir, { recursive: true });
            const mimeType = String(req.query?.mimeType || req.get('content-type') || 'application/octet-stream').trim();
            const mediaKind = String(req.query?.mediaKind || '').trim() === 'video' ? 'video' : 'audio';
            const extension = mimeType.includes('ogg')
                ? 'ogg'
                : (mimeType.includes('mp4') ? 'mp4' : 'webm');
            const chunkName = `chunk-${String(sequence).padStart(6, '0')}.${extension}`;
            const chunkPath = path.join(sessionDir, chunkName);
            fs.writeFileSync(chunkPath, req.body);

            const now = Date.now();
            const manifest = readLocalRecordingManifest(sessionDir) || {
                roomId,
                identity,
                displayName: String(req.query?.displayName || participant?.displayName || identity).trim() || identity,
                sessionId,
                kind: mediaKind === 'video' ? 'guest_local_video_backup' : 'guest_local_audio_backup',
                mediaKind,
                mimeType,
                startedAt: Number(req.query?.startedAt || now) || now,
                chunks: [],
                completed: false,
                createdAt: now,
                updatedAt: now
            };
            const existingIndex = manifest.chunks.findIndex((chunk) => Number(chunk.sequence || 0) === sequence);
            const chunkInfo = {
                sequence,
                fileName: chunkName,
                bytes: req.body.length,
                uploadedAt: now
            };
            if (existingIndex >= 0) {
                manifest.chunks[existingIndex] = chunkInfo;
            } else {
                manifest.chunks.push(chunkInfo);
            }
            manifest.chunks.sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
            manifest.mimeType = mimeType || manifest.mimeType;
            manifest.mediaKind = mediaKind;
            manifest.kind = mediaKind === 'video' ? 'guest_local_video_backup' : 'guest_local_audio_backup';
            manifest.completed = String(req.query?.final || '') === '1' || manifest.completed === true;
            manifest.updatedAt = now;
            writeLocalRecordingManifest(sessionDir, manifest);

            res.json({
                success: true,
                roomId,
                identity,
                sessionId,
                sequence,
                chunkCount: manifest.chunks.length
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error?.message || 'local_recording_chunk_failed'
            });
        }
    });

    router.post('/broadcast-room/local-recording-complete', (req, res) => {
        try {
            cleanupExpiredLocalRecordings();
            const roomId = String(req.body?.roomId || '').trim();
            const identity = String(req.body?.identity || '').trim();
            const sessionId = String(req.body?.sessionId || '').trim();
            if (!roomId || !identity || !sessionId) {
                res.status(400).json({ success: false, error: 'local_recording_complete_missing_fields' });
                return;
            }
            const sessionDir = getLocalRecordingSessionDir({ roomId, identity, sessionId });
            const manifest = readLocalRecordingManifest(sessionDir);
            if (!manifest) {
                res.status(404).json({ success: false, error: 'local_recording_session_not_found' });
                return;
            }
            manifest.completed = true;
            manifest.stoppedAt = Number(req.body?.stoppedAt || Date.now()) || Date.now();
            manifest.updatedAt = Date.now();
            writeLocalRecordingManifest(sessionDir, manifest);
            res.json({
                success: true,
                roomId,
                identity,
                sessionId,
                chunkCount: Array.isArray(manifest.chunks) ? manifest.chunks.length : 0
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error?.message || 'local_recording_complete_failed'
            });
        }
    });

    router.get('/broadcast-room/admin-status', (_req, res) => {
        res.json({
            success: true,
            enabled: isAdminSecretConfigured()
        });
    });

    router.get('/broadcast-room/:roomId/events', (req, res) => {
        const roomId = String(req.params?.roomId || '').trim();
        const room = roomStore.getRoom(roomId);
        if (!room || !room.active) {
            res.status(404).json({ success: false, error: 'room_not_found' });
            return;
        }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        if (typeof res.flushHeaders === 'function') {
            res.flushHeaders();
        }

        const cleanup = addRoomEventClient(roomId, res);
        sendServerEvent(res, 'ready', {
            roomId,
            now: Date.now()
        });
        sendServerEvent(res, 'liveCaption', {
            roomId,
            liveCaption: room.liveCaption || {
                enabled: false,
                text: '',
                originalText: '',
                translatedText: '',
                alternateText: '',
                alternateLanguage: '',
                sourceLanguage: '',
                targetLanguage: '',
                scope: '',
                mode: '',
                updatedAt: 0
            }
        });

        const keepAliveTimer = setInterval(() => {
            sendServerEvent(res, 'ping', {
                now: Date.now()
            });
        }, 25000);

        req.on('close', () => {
            clearInterval(keepAliveTimer);
            cleanup();
        });
    });

    router.post('/broadcast-room/admin-login', (req, res) => {
        if (!isAdminSecretConfigured()) {
            res.status(503).json({ success: false, error: 'admin_secret_not_configured' });
            return;
        }
        const adminSecret = String(req.body?.adminSecret || '').trim();
        if (!adminSecret || !safeSecretEquals(adminSecret, config.webinarAdminSecret)) {
            res.status(403).json({ success: false, error: 'admin_secret_invalid' });
            return;
        }
        res.json({
            success: true,
            ...createAdminSession()
        });
    });

    router.post('/broadcast-room/admin-session', (req, res) => {
        const session = getValidAdminSession(req.body?.adminToken);
        res.json({
            success: true,
            authenticated: !!session,
            expiresAt: Number(session?.expiresAt || 0)
        });
    });

    router.post('/broadcast-room/admin-logout', (req, res) => {
        const adminToken = String(req.body?.adminToken || '').trim();
        if (adminToken) {
            adminSessions.delete(adminToken);
        }
        res.json({ success: true });
    });

    router.post('/broadcast-room/webinar-requests', (req, res) => {
        const request = roomStore.createWebinarRequest({
            requesterName: req.body?.requesterName,
            requesterEmail: req.body?.requesterEmail,
            details: req.body?.details
        });
        if (!request) {
            res.status(400).json({ success: false, error: 'webinar_request_missing_fields' });
            return;
        }
        res.json({
            success: true,
            request
        });
    });

    router.post('/broadcast-room/admin/webinar-requests', (req, res) => {
        if (!requireAdminSession(req, res)) {
            return;
        }
        res.json({
            success: true,
            requests: roomStore.getWebinarRequests({ includeClosed: req.body?.includeClosed !== false })
        });
    });

    router.post('/broadcast-room/admin/webinar-request-status', (req, res) => {
        if (!requireAdminSession(req, res)) {
            return;
        }
        const request = roomStore.updateWebinarRequest(req.body?.requestId, {
            status: req.body?.status
        });
        if (!request) {
            res.status(404).json({ success: false, error: 'webinar_request_not_found' });
            return;
        }
        res.json({
            success: true,
            request,
            requests: roomStore.getWebinarRequests({ includeClosed: true })
        });
    });

    router.post('/broadcast-room/admin/create-webinar-from-request', (req, res) => {
        if (!requireAdminSession(req, res)) {
            return;
        }
        const request = roomStore.createWebinarFromRequest(req.body?.requestId, {
            title: req.body?.title,
            scheduledAt: req.body?.scheduledAt,
            durationMinutes: req.body?.durationMinutes,
            audienceLimit: req.body?.audienceLimit,
            panelistLimit: req.body?.panelistLimit,
            persistent: req.body?.persistent === true,
            roomSlug: req.body?.roomSlug,
            password: req.body?.password,
            allowJoinWhenHostAbsent: req.body?.allowJoinWhenHostAbsent === true,
            restrictBeforeStart: req.body?.restrictBeforeStart === true,
            restrictAfterEnd: req.body?.restrictAfterEnd === true
        });
        if (!request) {
            res.status(404).json({ success: false, error: 'webinar_request_not_found' });
            return;
        }
        res.json({
            success: true,
            request,
            webinar: request.webinar,
            requests: roomStore.getWebinarRequests({ includeClosed: true })
        });
    });

    router.post('/broadcast-room/open-webinar', (req, res) => {
        const hostDisplayName = String(req.body?.hostDisplayName || '').trim() || 'Host';
        const opened = roomStore.openWebinarByHostKey(req.body?.webinarHostKey, {
            hostDisplayName,
            inviteBaseUrl
        });
        if (!opened?.room) {
            res.status(403).json({ success: false, error: opened?.error || 'webinar_host_key_invalid' });
            return;
        }
        res.json({
            success: true,
            roomId: opened.room.roomId,
            inviteId: opened.room.inviteId,
            inviteUrl: opened.room.inviteUrl,
            webinar: opened.request?.webinar || null,
            joinPolicy: {
                persistentRoom: opened.room.settings?.persistentRoom === true,
                allowJoinWhenHostAbsent: opened.room.settings?.allowJoinWhenHostAbsent === true,
                passwordConfigured: opened.room.settings?.passwordConfigured === true,
                requirePasswordNow: roomStore.isPasswordRequired(opened.room, { hostConnected: roomStore.roomHasConnectedHost(opened.room) })
            }
        });
    });

    router.post('/broadcast-room/create', (req, res) => {
        const hostDisplayName = String(req.body?.hostDisplayName || '').trim() || 'Host';
        const title = String(req.body?.title || '').trim();
        const scheduledAt = req.body?.scheduledAt || null;
        const room = roomStore.createRoom({
            hostDisplayName,
            title,
            scheduledAt,
            inviteBaseUrl,
            persistentRoom: req.body?.persistentRoom === true,
            ownerKey: getRoomOwnerKey(req),
            roomSlug: req.body?.roomSlug,
            password: req.body?.password,
            allowJoinWhenHostAbsent: req.body?.allowJoinWhenHostAbsent === true,
            requirePasswordWhenHostPresent: req.body?.requirePasswordWhenHostPresent === true,
            requirePasswordWhenHostAbsent: req.body?.requirePasswordWhenHostAbsent === true,
            webinarMode: req.body?.webinarMode === true
        });

        if (!room) {
            res.status(409).json({ success: false, error: 'persistent_room_slug_already_used' });
            return;
        }

        res.json({
            success: true,
            roomId: room.roomId,
            inviteId: room.inviteId,
            inviteUrl: room.inviteUrl,
            joinPolicy: {
                persistentRoom: room.settings?.persistentRoom === true,
                allowJoinWhenHostAbsent: room.settings?.allowJoinWhenHostAbsent === true,
                passwordConfigured: room.settings?.passwordConfigured === true,
                requirePasswordNow: roomStore.isPasswordRequired(room, { hostConnected: roomStore.roomHasConnectedHost(room) })
            }
        });
    });

    router.post('/broadcast-room/host-token', async (req, res, next) => {
        try {
            const roomId = String(req.body?.roomId || '').trim();
            const hostDisplayName = String(req.body?.hostDisplayName || '').trim() || 'Host';
            const room = roomStore.getRoom(roomId);

            if (!room || !room.active) {
                res.status(404).json({ success: false, error: 'room_not_found' });
                return;
            }
            room.settings = {
                ...room.settings,
                sessionEndedAt: 0,
                updatedAt: Date.now()
            };

            const identity = buildIdentity('host', hostDisplayName);
            const token = await createJoinToken(config, {
                roomName: room.roomId,
                identity,
                displayName: hostDisplayName,
                role: 'host'
            });

            room.participants = Array.isArray(room.participants)
                ? room.participants.filter((participant) => String(participant.role || '').trim() !== 'host')
                : [];
            roomStore.upsertParticipant(room.roomId, {
                identity,
                displayName: hostDisplayName,
                role: 'host'
            });

            res.json({
                success: true,
                roomId: room.roomId,
                participantIdentity: identity,
                token,
                livekitUrl: config.livekitUrl,
                allowGuestScreenShare: room.settings?.allowGuestScreenShare !== false,
                participants: room.participants,
                chatMessages: room.chatMessages,
                liveCaption: room.liveCaption || {
                    enabled: false,
                    text: '',
                    originalText: '',
                    translatedText: '',
                    alternateText: '',
                    alternateLanguage: '',
                    sourceLanguage: '',
                    targetLanguage: '',
                    scope: '',
                    mode: '',
                    updatedAt: 0
                },
                accessibleShare: room.accessibleShare || {
                    active: false,
                    title: '',
                    fileName: '',
                    kind: '',
                    currentIndex: 0,
                    items: [],
                    updatedAt: 0
                },
                sceneState: room.sceneState,
                settings: {
                    ...room.settings,
                    roomPasswordHash: undefined
                },
                hostConnected: true,
                inviteId: room.inviteId,
                inviteUrl: `${inviteBaseUrl.replace(/\/+$/, '')}/join/${encodeURIComponent(room.inviteId)}`
            });
        } catch (error) {
            next(error);
        }
    });

    router.post('/broadcast-room/join-token', async (req, res, next) => {
        try {
            const inviteId = String(req.body?.inviteId || '').trim();
            const displayName = String(req.body?.displayName || '').trim();
            const password = String(req.body?.password || '').trim();
            const room = roomStore.getRoomByInviteId(inviteId);
            const webinarMode = room?.settings?.webinarMode === true;
            const participantRole = webinarMode ? 'audience' : 'guest';
            const cameraEnabled = !webinarMode && req.body?.cameraEnabled === true;
            const microphoneEnabled = !webinarMode && req.body?.microphoneEnabled === true;
            if (!displayName) {
                res.status(400).json({ success: false, error: 'display_name_required' });
                return;
            }

            if (!room || !room.active) {
                res.status(404).json({ success: false, error: 'invite_not_found' });
                return;
            }
            const hostConnected = roomStore.roomHasConnectedHost(room);
            if (!hostConnected && room.settings?.allowJoinWhenHostAbsent !== true) {
                res.status(403).json({ success: false, error: 'host_not_connected' });
                return;
            }
            if (roomStore.isPasswordRequired(room, { hostConnected }) && !roomStore.verifyRoomPassword(room, password)) {
                res.status(403).json({ success: false, error: 'room_password_invalid' });
                return;
            }

            const identity = buildIdentity(participantRole, displayName);
            const token = await createJoinToken(config, {
                roomName: room.roomId,
                identity,
                displayName,
                role: participantRole
            });

            roomStore.upsertParticipant(room.roomId, {
                identity,
                displayName,
                role: participantRole,
                cameraEnabled,
                microphoneEnabled,
                allowCamera: !webinarMode,
                allowMicrophone: !webinarMode,
                allowScreenShare: !webinarMode && room.settings?.allowGuestScreenShare !== false,
                connected: true
            });

            res.json({
                success: true,
                roomId: room.roomId,
                participantIdentity: identity,
                participantRole,
                token,
                livekitUrl: config.livekitUrl,
                allowGuestScreenShare: room.settings?.allowGuestScreenShare !== false,
                participants: room.participants,
                chatMessages: room.chatMessages,
                liveCaption: room.liveCaption || {
                    enabled: false,
                    text: '',
                    originalText: '',
                    translatedText: '',
                    alternateText: '',
                    alternateLanguage: '',
                    sourceLanguage: '',
                    targetLanguage: '',
                    scope: '',
                    mode: '',
                    updatedAt: 0
                },
                accessibleShare: room.accessibleShare || {
                    active: false,
                    title: '',
                    fileName: '',
                    kind: '',
                    currentIndex: 0,
                    items: [],
                    updatedAt: 0
                },
                sceneState: room.sceneState,
                settings: {
                    ...room.settings,
                    roomPasswordHash: undefined
                },
                hostConnected,
                inviteId: room.inviteId,
                inviteUrl: `${inviteBaseUrl.replace(/\/+$/, '')}/join/${encodeURIComponent(room.inviteId)}`
            });
        } catch (error) {
            next(error);
        }
    });

    router.post('/broadcast-room/participant-state', (req, res) => {
        const roomId = String(req.body?.roomId || '').trim();
        const identity = String(req.body?.identity || '').trim();
        if (!roomId || !identity) {
            res.status(400).json({ success: false, error: 'participant_state_missing' });
            return;
        }

        const currentRoom = roomStore.getRoom(roomId);
        if (req.body?.connected === true
            && currentRoom?.settings?.sessionEndedAt
            && String(req.body?.role || '').trim() !== 'host') {
            res.status(409).json({ success: false, error: 'room_session_ended' });
            return;
        }

        const room = req.body?.connected === false
            ? roomStore.removeParticipant(roomId, identity)
            : roomStore.upsertParticipant(roomId, {
                identity,
                displayName: req.body?.displayName,
                displayNameChange: req.body?.displayNameChange === true,
                role: req.body?.role,
                cameraEnabled: req.body?.cameraEnabled,
                microphoneEnabled: req.body?.microphoneEnabled,
                shareEnabled: req.body?.shareEnabled,
                shareAudioEnabled: req.body?.shareAudioEnabled,
                shareSourceType: req.body?.shareSourceType,
                shareStereoRequested: req.body?.shareStereoRequested,
                preferredLanguage: req.body?.preferredLanguage,
                connectionQuality: req.body?.connectionQuality,
                connected: req.body?.connected
            });

        if (!room) {
            res.status(404).json({ success: false, error: 'room_not_found' });
            return;
        }

        broadcastRoomEvent(room.roomId, 'liveCaption', {
            roomId: room.roomId,
            liveCaption: room.liveCaption
        });
        broadcastRoomEvent(room.roomId, 'roomSettings', buildRoomResponse(room));

        res.json({
            success: true,
            roomId: room.roomId,
            participants: room.participants,
            sceneState: room.sceneState,
            settings: room.settings,
            chatMessages: room.chatMessages
        });
    });

    router.post('/broadcast-room/room-settings', (req, res) => {
        const roomId = String(req.body?.roomId || '').trim();
        if (!roomId) {
            res.status(400).json({ success: false, error: 'room_id_required' });
            return;
        }

        const room = roomStore.updateRoomSettings(roomId, {
            ownerKey: getRoomOwnerKey(req),
            roomTitle: req.body?.roomTitle,
            hostDisplayName: req.body?.hostDisplayName,
            allowGuestScreenShare: req.body?.allowGuestScreenShare,
            allowGuestCamera: req.body?.allowGuestCamera,
            allowGuestMicrophone: req.body?.allowGuestMicrophone,
            webinarMode: req.body?.webinarMode,
            persistentRoom: req.body?.persistentRoom,
            roomSlug: req.body?.roomSlug,
            password: req.body?.password,
            allowJoinWhenHostAbsent: req.body?.allowJoinWhenHostAbsent,
            requirePasswordWhenHostPresent: req.body?.requirePasswordWhenHostPresent,
            requirePasswordWhenHostAbsent: req.body?.requirePasswordWhenHostAbsent,
            hostRecordingActive: req.body?.hostRecordingActive,
            hostShareActive: req.body?.hostShareActive,
            hostShareLabel: req.body?.hostShareLabel,
            hostShareMonitorAudioEnabled: req.body?.hostShareMonitorAudioEnabled
        });

        if (!room) {
            res.status(404).json({ success: false, error: 'room_not_found' });
            return;
        }

        broadcastRoomEvent(room.roomId, 'roomSettings', buildRoomResponse(room));

        res.json({
            success: true,
            roomId: room.roomId,
            inviteId: room.inviteId,
            inviteUrl: `${inviteBaseUrl.replace(/\/+$/, '')}/join/${encodeURIComponent(room.inviteId)}`,
            settings: {
                ...room.settings,
                roomPasswordHash: undefined
            },
            chatMessages: room.chatMessages
        });
    });

    router.get('/broadcast-room/persistent-rooms', (req, res) => {
        const rooms = roomStore.getPersistentRooms(getRoomOwnerKey(req)).map((room) => ({
            ...room,
            inviteUrl: `${inviteBaseUrl.replace(/\/+$/, '')}/join/${encodeURIComponent(room.inviteId)}`,
            settings: {
                ...room.settings,
                roomPasswordHash: undefined
            }
        }));
        res.json({
            success: true,
            rooms
        });
    });

    router.post('/broadcast-room/participant-controls', (req, res) => {
        const roomId = String(req.body?.roomId || '').trim();
        const identity = String(req.body?.identity || '').trim();
        if (!roomId || !identity) {
            res.status(400).json({ success: false, error: 'participant_control_missing' });
            return;
        }

        const room = roomStore.updateParticipantControls(roomId, identity, {
            role: req.body?.role,
            allowCamera: req.body?.allowCamera,
            allowMicrophone: req.body?.allowMicrophone,
            allowScreenShare: req.body?.allowScreenShare,
            requestedCameraEnabled: req.body?.requestedCameraEnabled,
            requestedMicrophoneEnabled: req.body?.requestedMicrophoneEnabled,
            displayName: req.body?.displayName,
            handRaiseActive: req.body?.handRaiseActive,
            handRaiseSeenAt: req.body?.handRaiseSeenAt
        });

        if (!room) {
            res.status(404).json({ success: false, error: 'room_or_participant_not_found' });
            return;
        }

        broadcastRoomEvent(room.roomId, 'roomSettings', buildRoomResponse(room));

        res.json({
            success: true,
            roomId: room.roomId,
            participants: room.participants,
            settings: room.settings,
            sceneState: room.sceneState,
            chatMessages: room.chatMessages
        });
    });

    router.post('/broadcast-room/participant-role-token', async (req, res, next) => {
        try {
            const roomId = String(req.body?.roomId || '').trim();
            const identity = String(req.body?.identity || '').trim();
            if (!roomId || !identity) {
                res.status(400).json({ success: false, error: 'participant_role_token_missing' });
                return;
            }

            const room = roomStore.getRoom(roomId);
            const participant = Array.isArray(room?.participants)
                ? room.participants.find((item) => String(item.identity || '').trim() === identity)
                : null;
            if (!room || !participant || !room.active) {
                res.status(404).json({ success: false, error: 'room_or_participant_not_found' });
                return;
            }

            const role = String(participant.role || 'guest').trim() || 'guest';
            const displayName = String(participant.displayName || identity).trim() || identity;
            const token = await createJoinToken(config, {
                roomName: room.roomId,
                identity,
                displayName,
                role
            });

            res.json({
                success: true,
                roomId: room.roomId,
                participantIdentity: identity,
                participantRole: role,
                token,
                livekitUrl: config.livekitUrl
            });
        } catch (error) {
            next(error);
        }
    });

    router.post('/broadcast-room/all-guest-controls', (req, res) => {
        const roomId = String(req.body?.roomId || '').trim();
        if (!roomId) {
            res.status(400).json({ success: false, error: 'room_id_required' });
            return;
        }

        const room = roomStore.updateAllGuestControls(roomId, {
            allowCamera: req.body?.allowCamera,
            allowMicrophone: req.body?.allowMicrophone,
            allowScreenShare: req.body?.allowScreenShare,
            requestedCameraEnabled: req.body?.requestedCameraEnabled,
            requestedMicrophoneEnabled: req.body?.requestedMicrophoneEnabled
        });

        if (!room) {
            res.status(404).json({ success: false, error: 'room_not_found' });
            return;
        }

        res.json({
            success: true,
            roomId: room.roomId,
            participants: room.participants,
            settings: room.settings,
            chatMessages: room.chatMessages
        });
    });

    router.post('/broadcast-room/scene-state', (req, res) => {
        const roomId = String(req.body?.roomId || '').trim();
        if (!roomId) {
            res.status(400).json({ success: false, error: 'room_id_required' });
            return;
        }

        const room = roomStore.updateSceneState(roomId, {
            presetId: req.body?.presetId,
            presetLabel: req.body?.presetLabel,
            slots: req.body?.slots
        });

        if (!room) {
            res.status(404).json({ success: false, error: 'room_not_found' });
            return;
        }

        res.json({
            success: true,
            roomId: room.roomId,
            sceneState: room.sceneState,
            chatMessages: room.chatMessages
        });
    });

    router.post('/broadcast-room/chat-message', (req, res) => {
        const roomId = String(req.body?.roomId || '').trim();
        const senderIdentity = String(req.body?.senderIdentity || '').trim();
        const senderName = String(req.body?.senderName || '').trim();
        const text = String(req.body?.text || '').trim();
        const audience = String(req.body?.audience || 'all').trim();
        const senderRole = String(req.body?.senderRole || 'guest').trim() || 'guest';
        if (!roomId || !senderIdentity || !text) {
            res.status(400).json({ success: false, error: 'chat_message_missing' });
            return;
        }
        if (audience === 'participant' && !String(req.body?.recipientIdentity || '').trim()) {
            res.status(400).json({ success: false, error: 'chat_message_recipient_missing' });
            return;
        }

        const result = roomStore.addChatMessage(roomId, {
            senderIdentity,
            senderName,
            senderRole,
            audience,
            recipientIdentity: String(req.body?.recipientIdentity || '').trim(),
            recipientName: String(req.body?.recipientName || '').trim(),
            text
        });

        if (!result?.room || !result?.message) {
            res.status(404).json({ success: false, error: 'room_not_found' });
            return;
        }

        broadcastRoomEvent(result.room.roomId, 'chatMessage', {
            roomId: result.room.roomId,
            message: result.message,
            chatMessages: result.room.chatMessages,
            participants: result.room.participants,
            settings: result.room.settings,
            sceneState: result.room.sceneState
        });

        res.json({
            success: true,
            roomId: result.room.roomId,
            message: result.message,
            chatMessages: result.room.chatMessages,
            participants: result.room.participants,
            settings: result.room.settings,
            sceneState: result.room.sceneState
        });
    });

    router.post('/broadcast-room/live-caption', (req, res) => {
        const roomId = String(req.body?.roomId || '').trim();
        if (!roomId) {
            res.status(400).json({ success: false, error: 'room_id_required' });
            return;
        }

        const room = roomStore.updateLiveCaption(roomId, {
            enabled: req.body?.enabled,
            text: req.body?.text,
            originalText: req.body?.originalText,
            translatedText: req.body?.translatedText,
            alternateText: req.body?.alternateText,
            alternateLanguage: req.body?.alternateLanguage,
            sourceLanguage: req.body?.sourceLanguage,
            targetLanguage: req.body?.targetLanguage,
            scope: req.body?.scope,
            mode: req.body?.mode,
            updatedAt: req.body?.updatedAt
        });

        if (!room) {
            res.status(404).json({ success: false, error: 'room_not_found' });
            return;
        }

        res.json({
            success: true,
            roomId: room.roomId,
            liveCaption: room.liveCaption
        });
    });

    router.post('/broadcast-room/translation-audio', (req, res) => {
        const roomId = String(req.body?.roomId || '').trim();
        const audioBase64 = String(req.body?.audioBase64 || '').trim();
        if (!roomId || !audioBase64) {
            res.status(400).json({ success: false, error: 'translation_audio_missing' });
            return;
        }
        const room = roomStore.getRoom(roomId);
        if (!room || !room.active) {
            res.status(404).json({ success: false, error: 'room_not_found' });
            return;
        }
        const payload = {
            roomId,
            sourceLanguage: String(req.body?.sourceLanguage || '').trim(),
            targetLanguage: String(req.body?.targetLanguage || '').trim(),
            mimeType: String(req.body?.mimeType || 'audio/pcm;rate=24000').trim(),
            audioBase64,
            sequence: Number(req.body?.sequence || 0) || Date.now(),
            updatedAt: Date.now()
        };
        console.log(JSON.stringify({
            scope: 'translation-audio',
            event: 'audio-broadcast',
            at: new Date().toISOString(),
            roomId,
            sourceLanguage: payload.sourceLanguage,
            targetLanguage: payload.targetLanguage,
            mimeType: payload.mimeType,
            bytes: Math.floor((audioBase64.length * 3) / 4),
            sequence: payload.sequence
        }));
        broadcastRoomEvent(roomId, 'translationAudio', payload);
        res.json({
            success: true,
            roomId
        });
    });

    router.post('/broadcast-room/accessible-share', (req, res) => {
        const roomId = String(req.body?.roomId || '').trim();
        if (!roomId) {
            res.status(400).json({ success: false, error: 'room_id_required' });
            return;
        }

        const room = roomStore.updateAccessibleShare(roomId, {
            active: req.body?.active,
            title: req.body?.title,
            fileName: req.body?.fileName,
            kind: req.body?.kind,
            currentIndex: req.body?.currentIndex,
            items: req.body?.items,
            updatedAt: req.body?.updatedAt
        });

        if (!room) {
            res.status(404).json({ success: false, error: 'room_not_found' });
            return;
        }

        res.json({
            success: true,
            roomId: room.roomId,
            accessibleShare: room.accessibleShare
        });
    });

    router.post('/broadcast-room/hand-raise', (req, res) => {
        const roomId = String(req.body?.roomId || '').trim();
        const identity = String(req.body?.identity || '').trim();
        if (!roomId || !identity) {
            res.status(400).json({ success: false, error: 'hand_raise_missing' });
            return;
        }

        const room = roomStore.updateHandRaise(roomId, identity, {
            handRaiseActive: req.body?.handRaiseActive,
            handRaiseSeenAt: req.body?.handRaiseSeenAt
        });

        if (!room) {
            res.status(404).json({ success: false, error: 'room_or_participant_not_found' });
            return;
        }

        res.json({
            success: true,
            roomId: room.roomId,
            participants: room.participants,
            settings: room.settings,
            chatMessages: room.chatMessages,
            sceneState: room.sceneState
        });
    });

    router.post('/broadcast-room/leave', (req, res) => {
        const roomId = String(req.body?.roomId || '').trim();
        const identity = String(req.body?.identity || '').trim();
        if (!roomId || !identity) {
            res.status(400).json({ success: false, error: 'participant_state_missing' });
            return;
        }

        const room = roomStore.removeParticipant(roomId, identity);
        if (!room) {
            res.status(404).json({ success: false, error: 'room_not_found' });
            return;
        }
        broadcastRoomEvent(room.roomId, 'participantRemoved', {
            roomId: room.roomId,
            identity
        });

        res.json({
            success: true,
            roomId: room.roomId,
            participants: room.participants,
            chatMessages: room.chatMessages,
            sceneState: room.sceneState,
            settings: room.settings
        });
    });

    router.get('/broadcast-room/invite/:inviteId', (req, res) => {
        const room = roomStore.getRoomByInviteId(req.params.inviteId);
        if (!room || !room.active) {
            res.status(404).json({ success: false, error: 'invite_not_found' });
            return;
        }
        res.json(buildRoomResponse(room));
    });

    router.get('/broadcast-room/:roomId', (req, res) => {
        const room = roomStore.getRoom(req.params.roomId);
        if (!room) {
            res.status(404).json({ success: false, error: 'room_not_found' });
            return;
        }
        res.json(buildRoomResponse(room));
    });

    router.post('/broadcast-room/:roomId/close', (req, res) => {
        const room = roomStore.closeRoom(req.params.roomId);
        if (!room) {
            res.status(404).json({ success: false, error: 'room_not_found' });
            return;
        }
        res.json({
            success: true,
            roomId: room.roomId,
            active: room.active,
            closedAt: room.closedAt,
            hostConnected: roomStore.roomHasConnectedHost(room)
        });
    });

    router.post('/broadcast-room/:roomId/end-session', (req, res) => {
        const currentRoom = roomStore.getRoom(req.params.roomId);
        if (!currentRoom) {
            res.status(404).json({ success: false, error: 'room_not_found' });
            return;
        }
        const hostIdentity = String(req.body?.hostIdentity || '').trim();
        const isHost = hostIdentity && Array.isArray(currentRoom.participants)
            && currentRoom.participants.some((participant) => (
                String(participant.identity || '').trim() === hostIdentity
                && String(participant.role || '').trim() === 'host'
                && participant.connected !== false
            ));
        if (!isHost) {
            res.status(403).json({ success: false, error: 'host_session_required' });
            return;
        }
        const room = roomStore.endRoomSessionForEveryone(req.params.roomId);
        if (!room) {
            res.status(404).json({ success: false, error: 'room_not_found' });
            return;
        }
        broadcastRoomEvent(room.roomId, 'roomEnded', {
            roomId: room.roomId,
            active: room.active,
            persistentRoom: room.settings?.persistentRoom === true,
            endedAt: Date.now(),
            reason: 'host_ended_for_everyone'
        });
        res.json({
            success: true,
            roomId: room.roomId,
            active: room.active,
            closedAt: room.closedAt,
            persistentRoom: room.settings?.persistentRoom === true,
            hostConnected: roomStore.roomHasConnectedHost(room),
            chatMessages: room.chatMessages,
            participants: room.participants
        });
    });

    return router;
}

module.exports = {
    createBroadcastRoomRouter
};
