const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STALE_GUEST_PARTICIPANT_MS = 45000;

function randomId(prefix) {
    return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeRoomSlug(value, fallback = '') {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '')
        .replace(/-+/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '');
    return normalized || String(fallback || '').trim().toLowerCase();
}

function hashRoomPassword(password) {
    const normalized = String(password || '').trim();
    if (!normalized) {
        return '';
    }
    return crypto.createHash('sha256').update(normalized).digest('hex');
}

function createReadableWebinarKey() {
    return `WEB-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function createEmptyLiveCaption() {
    return {
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
    };
}

function createEmptyAccessibleShare() {
    return {
        active: false,
        title: '',
        fileName: '',
        kind: '',
        currentIndex: 0,
        items: [],
        updatedAt: 0
    };
}

function sanitizeConnectionQuality(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const sanitizeMedia = (media) => ({
        packetsLost: Number(media?.packetsLost || 0) || 0,
        packetsReceived: Number(media?.packetsReceived || 0) || 0,
        bytesReceived: Number(media?.bytesReceived || 0) || 0,
        jitter: Number(media?.jitter || 0) || 0,
        framesDecoded: Number(media?.framesDecoded || 0) || 0,
        framesDropped: Number(media?.framesDropped || 0) || 0,
        freezeCount: Number(media?.freezeCount || 0) || 0,
        totalFreezesDuration: Number(media?.totalFreezesDuration || 0) || 0,
        frameWidth: Number(media?.frameWidth || 0) || 0,
        frameHeight: Number(media?.frameHeight || 0) || 0,
        framesPerSecond: Number(media?.framesPerSecond || 0) || 0
    });
    return {
        updatedAt: Number(value.updatedAt || Date.now()) || Date.now(),
        lowBandwidthMode: value.lowBandwidthMode === true,
        severity: ['good', 'fair', 'poor'].includes(String(value.severity || '').trim())
            ? String(value.severity || '').trim()
            : '',
        connectionState: String(value.connectionState || '').trim().slice(0, 40),
        remoteParticipantCount: Number(value.remoteParticipantCount || 0) || 0,
        remoteVideoTrackCount: Number(value.remoteVideoTrackCount || 0) || 0,
        remoteAudioTrackCount: Number(value.remoteAudioTrackCount || 0) || 0,
        video: sanitizeMedia(value.video),
        audio: sanitizeMedia(value.audio)
    };
}

class RoomStore {
    constructor(options = {}) {
        this.rooms = new Map();
        this.inviteToRoom = new Map();
        this.persistentRoomsFilePath = String(options.persistentRoomsFilePath || '').trim();
        this.webinarRequestsFilePath = String(options.webinarRequestsFilePath || '').trim();
        this.webinarRequests = [];
        this.loadPersistentRooms();
        this.loadWebinarRequests();
    }

    ensurePersistentStorageDir() {
        if (!this.persistentRoomsFilePath) {
            return;
        }
        fs.mkdirSync(path.dirname(this.persistentRoomsFilePath), { recursive: true });
    }

    ensureWebinarRequestStorageDir() {
        if (!this.webinarRequestsFilePath) {
            return;
        }
        fs.mkdirSync(path.dirname(this.webinarRequestsFilePath), { recursive: true });
    }

    loadWebinarRequests() {
        if (!this.webinarRequestsFilePath) {
            return;
        }
        try {
            if (!fs.existsSync(this.webinarRequestsFilePath)) {
                return;
            }
            const payload = JSON.parse(fs.readFileSync(this.webinarRequestsFilePath, 'utf8'));
            const requests = Array.isArray(payload?.requests) ? payload.requests : [];
            this.webinarRequests = requests
                .map((item) => ({
                    requestId: String(item.requestId || '').trim(),
                    requesterName: String(item.requesterName || '').trim(),
                    requesterEmail: String(item.requesterEmail || '').trim(),
                    details: String(item.details || '').trim(),
                    status: ['pending', 'approved', 'rejected'].includes(String(item.status || '').trim())
                        ? String(item.status || '').trim()
                        : 'pending',
                    webinar: item.webinar && typeof item.webinar === 'object' ? {
                        webinarId: String(item.webinar.webinarId || '').trim(),
                        hostKey: String(item.webinar.hostKey || '').trim(),
                        title: String(item.webinar.title || '').trim(),
                        scheduledAt: item.webinar.scheduledAt || null,
                        durationMinutes: Math.max(15, Math.min(1440, Number(item.webinar.durationMinutes || 120) || 120)),
                        audienceLimit: Math.max(1, Math.min(1000, Number(item.webinar.audienceLimit || 150) || 150)),
                        panelistLimit: Math.max(1, Math.min(50, Number(item.webinar.panelistLimit || 20) || 20)),
                        persistent: item.webinar.persistent === true,
                        roomSlug: String(item.webinar.roomSlug || '').trim(),
                        password: String(item.webinar.password || '').trim(),
                        allowJoinWhenHostAbsent: item.webinar.allowJoinWhenHostAbsent === true,
                        restrictBeforeStart: item.webinar.restrictBeforeStart === true,
                        restrictAfterEnd: item.webinar.restrictAfterEnd === true,
                        createdAt: Number(item.webinar.createdAt || item.updatedAt || Date.now()) || Date.now(),
                        updatedAt: Number(item.webinar.updatedAt || item.updatedAt || Date.now()) || Date.now()
                    } : null,
                    createdAt: Number(item.createdAt || Date.now()) || Date.now(),
                    updatedAt: Number(item.updatedAt || item.createdAt || Date.now()) || Date.now()
                }))
                .filter((item) => item.requestId && item.requesterName && item.details);
        } catch (_error) {
            this.webinarRequests = [];
        }
    }

    saveWebinarRequests() {
        if (!this.webinarRequestsFilePath) {
            return;
        }
        this.ensureWebinarRequestStorageDir();
        fs.writeFileSync(this.webinarRequestsFilePath, JSON.stringify({ requests: this.webinarRequests }, null, 2), 'utf8');
    }

    loadPersistentRooms() {
        if (!this.persistentRoomsFilePath) {
            return;
        }
        try {
            if (!fs.existsSync(this.persistentRoomsFilePath)) {
                return;
            }
            const payload = JSON.parse(fs.readFileSync(this.persistentRoomsFilePath, 'utf8'));
            const rooms = Array.isArray(payload?.rooms) ? payload.rooms : [];
            rooms.forEach((item) => {
                const now = Date.now();
                const roomId = String(item.roomId || '').trim();
                const inviteId = String(item.inviteId || '').trim();
                if (!roomId || !inviteId) {
                    return;
                }
                const room = {
                    roomId,
                    inviteId,
                    title: String(item.title || '').trim(),
                    hostDisplayName: String(item.hostDisplayName || '').trim() || 'Host',
                    scheduledAt: item.scheduledAt || null,
                    active: true,
                    persistent: true,
                    createdAt: Number(item.createdAt || now) || now,
                    closedAt: null,
                    settings: {
                        roomTitle: String(item.settings?.roomTitle || item.title || '').trim(),
                        hostDisplayName: String(item.settings?.hostDisplayName || item.hostDisplayName || '').trim() || 'Host',
                        allowGuestScreenShare: item.settings?.allowGuestScreenShare !== false,
                        allowGuestCamera: item.settings?.allowGuestCamera !== false,
                        allowGuestMicrophone: item.settings?.allowGuestMicrophone !== false,
                        webinarMode: item.settings?.webinarMode === true,
                        hostRecordingActive: false,
                        hostShareActive: false,
                        hostShareLabel: '',
                        hostShareMonitorAudioEnabled: false,
                        persistentRoom: true,
                        ownerKey: String(item.settings?.ownerKey || '').trim(),
                        roomSlug: String(item.settings?.roomSlug || inviteId).trim(),
                        passwordConfigured: item.settings?.passwordConfigured === true,
                        roomPasswordHash: String(item.settings?.roomPasswordHash || '').trim(),
                        allowJoinWhenHostAbsent: item.settings?.allowJoinWhenHostAbsent === true,
                        requirePasswordWhenHostPresent: item.settings?.requirePasswordWhenHostPresent === true,
                        requirePasswordWhenHostAbsent: item.settings?.requirePasswordWhenHostAbsent === true,
                        updatedAt: Number(item.settings?.updatedAt || now) || now
                    },
                    participants: [],
                    sceneState: {
                        presetId: '',
                        presetLabel: '',
                        slots: [],
                        updatedAt: now
                    },
                    chatMessages: [],
                    liveCaption: createEmptyLiveCaption(),
                    accessibleShare: createEmptyAccessibleShare()
                };
                this.rooms.set(roomId, room);
                this.inviteToRoom.set(inviteId, roomId);
            });
        } catch (_error) {
            // Ignore malformed persisted room data and continue with an empty store.
        }
    }

    savePersistentRooms() {
        if (!this.persistentRoomsFilePath) {
            return;
        }
        this.ensurePersistentStorageDir();
        const rooms = Array.from(this.rooms.values())
            .filter((room) => room?.settings?.persistentRoom === true)
            .map((room) => ({
                roomId: room.roomId,
                inviteId: room.inviteId,
                title: room.title,
                hostDisplayName: room.hostDisplayName,
                scheduledAt: room.scheduledAt || null,
                createdAt: room.createdAt,
                settings: {
                    roomTitle: String(room.settings?.roomTitle || room.title || '').trim(),
                    hostDisplayName: String(room.settings?.hostDisplayName || room.hostDisplayName || '').trim() || 'Host',
                    allowGuestScreenShare: room.settings?.allowGuestScreenShare !== false,
                    allowGuestCamera: room.settings?.allowGuestCamera !== false,
                    allowGuestMicrophone: room.settings?.allowGuestMicrophone !== false,
                    webinarMode: room.settings?.webinarMode === true,
                    persistentRoom: true,
                    ownerKey: String(room.settings?.ownerKey || '').trim(),
                    roomSlug: String(room.settings?.roomSlug || room.inviteId || '').trim(),
                    passwordConfigured: room.settings?.passwordConfigured === true,
                    roomPasswordHash: String(room.settings?.roomPasswordHash || '').trim(),
                    allowJoinWhenHostAbsent: room.settings?.allowJoinWhenHostAbsent === true,
                    requirePasswordWhenHostPresent: room.settings?.requirePasswordWhenHostPresent === true,
                    requirePasswordWhenHostAbsent: room.settings?.requirePasswordWhenHostAbsent === true,
                    updatedAt: Number(room.settings?.updatedAt || Date.now()) || Date.now()
                }
            }));
        fs.writeFileSync(this.persistentRoomsFilePath, JSON.stringify({ rooms }, null, 2), 'utf8');
    }

    roomHasConnectedHost(room) {
        return Array.isArray(room?.participants)
            && room.participants.some((participant) => (
                String(participant.role || '').trim() === 'host'
                && participant.connected !== false
            ));
    }

    pruneStaleParticipants(room) {
        if (!room || !Array.isArray(room.participants)) {
            return false;
        }
        const now = Date.now();
        const beforeCount = room.participants.length;
        room.participants = room.participants.filter((participant) => {
            if (String(participant.role || '').trim() === 'host') {
                return true;
            }
            if (participant.connected === false) {
                return false;
            }
            const updatedAt = Number(participant.updatedAt || participant.joinedAt || 0) || 0;
            return !updatedAt || now - updatedAt <= STALE_GUEST_PARTICIPANT_MS;
        });
        return beforeCount !== room.participants.length;
    }

    createRoom({ hostDisplayName, title, scheduledAt, inviteBaseUrl, persistentRoom = false, roomSlug = '', password = '', allowJoinWhenHostAbsent = false, requirePasswordWhenHostPresent = false, requirePasswordWhenHostAbsent = false, webinarMode = false, ownerKey = '' }) {
        const normalizedPersistent = persistentRoom === true;
        const normalizedOwnerKey = String(ownerKey || '').trim();
        const normalizedSlug = normalizeRoomSlug(roomSlug, normalizedPersistent ? randomId('oda') : '');
        const existingPersistentRoom = normalizedPersistent
            ? this.getRoomByInviteId(normalizedSlug)
            : null;
        if (
            normalizedPersistent
            && existingPersistentRoom
            && String(existingPersistentRoom.settings?.ownerKey || '').trim()
            && normalizedOwnerKey
            && String(existingPersistentRoom.settings.ownerKey || '').trim() !== normalizedOwnerKey
        ) {
            return null;
        }
        const roomId = existingPersistentRoom?.roomId || (normalizedPersistent ? `persistent-${normalizedSlug}` : randomId('room'));
        const inviteId = existingPersistentRoom?.inviteId || (normalizedPersistent ? normalizedSlug : randomId('invite'));
        const now = Date.now();
        const normalizedTitle = String(title || '').trim();
        const normalizedHostDisplayName = String(hostDisplayName || '').trim() || 'Host';
        const nextPasswordHash = hashRoomPassword(password);
        const effectivePasswordHash = normalizedPersistent
            ? (nextPasswordHash || String(existingPersistentRoom?.settings?.roomPasswordHash || '').trim())
            : '';
        const room = existingPersistentRoom || {
            roomId,
            inviteId,
            title: normalizedTitle,
            hostDisplayName: normalizedHostDisplayName,
            scheduledAt: scheduledAt || null,
            active: true,
            persistent: normalizedPersistent,
            createdAt: now,
            closedAt: null,
            settings: {},
            participants: [],
            sceneState: {
                presetId: '',
                presetLabel: '',
                slots: [],
                updatedAt: now
            },
            chatMessages: [],
            liveCaption: createEmptyLiveCaption(),
            accessibleShare: createEmptyAccessibleShare()
        };

        room.title = normalizedTitle;
        room.hostDisplayName = normalizedHostDisplayName;
        room.scheduledAt = scheduledAt || null;
        room.active = true;
        room.closedAt = null;
        room.persistent = normalizedPersistent;
        room.settings = {
            ...room.settings,
            roomTitle: normalizedTitle,
            hostDisplayName: normalizedHostDisplayName,
            allowGuestScreenShare: room.settings?.allowGuestScreenShare !== false,
            allowGuestCamera: room.settings?.allowGuestCamera !== false,
            allowGuestMicrophone: room.settings?.allowGuestMicrophone !== false,
            webinarMode: webinarMode === true,
            hostRecordingActive: false,
            hostShareActive: false,
            hostShareLabel: '',
            hostShareMonitorAudioEnabled: false,
            sessionEndedAt: 0,
            persistentRoom: normalizedPersistent,
            ownerKey: normalizedPersistent ? (String(room.settings?.ownerKey || '').trim() || normalizedOwnerKey) : '',
            roomSlug: normalizedPersistent ? inviteId : '',
            passwordConfigured: normalizedPersistent ? !!effectivePasswordHash : false,
            roomPasswordHash: normalizedPersistent ? effectivePasswordHash : '',
            allowJoinWhenHostAbsent: normalizedPersistent ? allowJoinWhenHostAbsent === true : false,
            requirePasswordWhenHostPresent: normalizedPersistent ? requirePasswordWhenHostPresent === true : false,
            requirePasswordWhenHostAbsent: normalizedPersistent ? requirePasswordWhenHostAbsent === true : false,
            updatedAt: now
        };

        this.rooms.set(roomId, room);
        this.inviteToRoom.set(inviteId, roomId);
        if (normalizedPersistent) {
            this.savePersistentRooms();
        }

        return {
            ...room,
            hostConnected: this.roomHasConnectedHost(room),
            inviteUrl: `${inviteBaseUrl.replace(/\/+$/, '')}/join/${encodeURIComponent(inviteId)}`
        };
    }

    getRoom(roomId) {
        const room = this.rooms.get(String(roomId || '').trim()) || null;
        if (room) {
            this.pruneStaleParticipants(room);
        }
        return room;
    }

    getRoomByInviteId(inviteId) {
        const rawInviteId = String(inviteId || '').trim();
        const roomId = this.inviteToRoom.get(rawInviteId)
            || this.inviteToRoom.get(normalizeRoomSlug(rawInviteId, ''));
        if (!roomId) {
            return null;
        }
        return this.getRoom(roomId);
    }

    closeRoom(roomId) {
        const room = this.getRoom(roomId);
        if (!room) {
            return null;
        }
        if (room.settings?.persistentRoom === true) {
            room.participants = room.participants.filter((participant) => String(participant.role || '').trim() !== 'host');
            room.settings = {
                ...room.settings,
                hostRecordingActive: false,
                hostShareActive: false,
                hostShareLabel: '',
                hostShareMonitorAudioEnabled: false,
                youtubeWatchUrl: '',
                youtubeLiveActive: false,
                updatedAt: Date.now()
            };
            room.accessibleShare = createEmptyAccessibleShare();
            return room;
        }
        room.active = false;
        room.closedAt = Date.now();
        room.accessibleShare = createEmptyAccessibleShare();
        return room;
    }

    endRoomSessionForEveryone(roomId) {
        const room = this.getRoom(roomId);
        if (!room) {
            return null;
        }
        const now = Date.now();
        room.participants = [];
        room.chatMessages = [];
        room.accessibleShare = createEmptyAccessibleShare();
        room.liveCaption = {
            enabled: false,
            text: '',
            originalText: '',
            translatedText: '',
            alternateText: '',
            alternateLanguage: '',
            sourceLanguage: '',
            targetLanguage: '',
            mode: '',
            updatedAt: now
        };
        room.settings = {
            ...room.settings,
            hostRecordingActive: false,
            hostShareActive: false,
            hostShareLabel: '',
            hostShareMonitorAudioEnabled: false,
            youtubeWatchUrl: '',
            youtubeLiveActive: false,
            sessionEndedAt: now,
            updatedAt: now
        };
        if (room.settings?.persistentRoom !== true) {
            room.active = false;
            room.closedAt = now;
        }
        return room;
    }

    upsertParticipant(roomId, participant) {
        const room = this.getRoom(roomId);
        if (!room) {
            return null;
        }
        const identity = String(participant.identity || '').trim();
        if (!identity) {
            return room;
        }
        const existingParticipant = room.participants.find((item) => item.identity === identity) || null;
        const now = Date.now();
        const requestedDisplayName = String(participant.displayName || '').trim();
        const shouldApplyDisplayName = !existingParticipant
            || participant.displayNameChange === true
            || !String(existingParticipant?.displayName || '').trim();
        const nextParticipant = {
            identity,
            displayName: (shouldApplyDisplayName
                ? requestedDisplayName
                : String(existingParticipant?.displayName || '').trim()) || identity,
            role: String(participant.role || existingParticipant?.role || 'guest').trim() || 'guest',
            cameraEnabled: participant.cameraEnabled !== undefined
                ? participant.cameraEnabled === true
                : existingParticipant?.cameraEnabled !== false,
            microphoneEnabled: participant.microphoneEnabled !== undefined
                ? participant.microphoneEnabled === true
                : existingParticipant?.microphoneEnabled !== false,
            connected: participant.connected !== undefined
                ? participant.connected === true
                : existingParticipant?.connected !== false,
            shareEnabled: participant.shareEnabled !== undefined
                ? participant.shareEnabled === true
                : existingParticipant?.shareEnabled === true,
            shareAudioEnabled: participant.shareAudioEnabled !== undefined
                ? participant.shareAudioEnabled === true
                : existingParticipant?.shareAudioEnabled === true,
            shareSourceType: String(participant.shareSourceType || existingParticipant?.shareSourceType || '').trim(),
            shareStereoRequested: participant.shareStereoRequested !== undefined
                ? participant.shareStereoRequested === true
                : existingParticipant?.shareStereoRequested === true,
            preferredLanguage: String(participant.preferredLanguage || existingParticipant?.preferredLanguage || '').trim(),
            avatarUrl: participant.avatarUrl !== undefined
                ? String(participant.avatarUrl || '').trim()
                : String(existingParticipant?.avatarUrl || '').trim(),
            allowCamera: participant.allowCamera !== undefined
                ? participant.allowCamera === true
                : existingParticipant?.allowCamera !== false,
            allowMicrophone: participant.allowMicrophone !== undefined
                ? participant.allowMicrophone === true
                : existingParticipant?.allowMicrophone !== false,
            allowScreenShare: participant.allowScreenShare !== undefined
                ? participant.allowScreenShare === true
                : existingParticipant?.allowScreenShare !== false,
            requestedCameraEnabled: participant.requestedCameraEnabled !== undefined
                ? participant.requestedCameraEnabled === true
                : existingParticipant?.requestedCameraEnabled,
            requestedMicrophoneEnabled: participant.requestedMicrophoneEnabled !== undefined
                ? participant.requestedMicrophoneEnabled === true
                : existingParticipant?.requestedMicrophoneEnabled,
            handRaiseActive: participant.handRaiseActive !== undefined
                ? participant.handRaiseActive === true
                : existingParticipant?.handRaiseActive === true,
            handRaiseSeenAt: participant.handRaiseSeenAt !== undefined
                ? Number(participant.handRaiseSeenAt) || 0
                : Number(existingParticipant?.handRaiseSeenAt) || 0,
            handRaiseRequestedAt: participant.handRaiseRequestedAt !== undefined
                ? Number(participant.handRaiseRequestedAt) || 0
                : Number(existingParticipant?.handRaiseRequestedAt) || 0,
            connectionQuality: participant.connectionQuality !== undefined
                ? sanitizeConnectionQuality(participant.connectionQuality)
                : (existingParticipant?.connectionQuality || null),
            joinedAt: Number(existingParticipant?.joinedAt) || now,
            updatedAt: now
        };
        if (participant.cameraEnabled !== undefined
            && nextParticipant.requestedCameraEnabled !== undefined
            && nextParticipant.cameraEnabled === nextParticipant.requestedCameraEnabled) {
            nextParticipant.requestedCameraEnabled = undefined;
        }
        if (participant.microphoneEnabled !== undefined
            && nextParticipant.requestedMicrophoneEnabled !== undefined
            && nextParticipant.microphoneEnabled === nextParticipant.requestedMicrophoneEnabled) {
            nextParticipant.requestedMicrophoneEnabled = undefined;
        }
        const existingIndex = room.participants.findIndex((item) => item.identity === identity);
        if (existingIndex >= 0) {
            room.participants[existingIndex] = nextParticipant;
        } else {
            room.participants.push(nextParticipant);
        }
        return room;
    }

    removeParticipant(roomId, identity) {
        const room = this.getRoom(roomId);
        if (!room) {
            return null;
        }
        const normalizedIdentity = String(identity || '').trim();
        room.participants = room.participants.filter((item) => item.identity !== normalizedIdentity);
        return room;
    }

    updateSceneState(roomId, sceneState) {
        const room = this.getRoom(roomId);
        if (!room) {
            return null;
        }

        const slots = Array.isArray(sceneState?.slots) ? sceneState.slots : [];
        room.sceneState = {
            presetId: String(sceneState?.presetId || '').trim(),
            presetLabel: String(sceneState?.presetLabel || '').trim(),
            slots: slots.map((slot) => ({
                slotId: String(slot?.slotId || '').trim(),
                slotLabel: String(slot?.slotLabel || '').trim(),
                sourceId: String(slot?.sourceId || '').trim(),
                sourceLabel: String(slot?.sourceLabel || '').trim(),
                sourceType: String(slot?.sourceType || '').trim(),
                participantIdentity: String(slot?.participantIdentity || '').trim(),
                participantName: String(slot?.participantName || '').trim()
            })),
            updatedAt: Date.now()
        };

        return room;
    }

    updateRoomSettings(roomId, settings) {
        const room = this.getRoom(roomId);
        if (!room) {
            return null;
        }
        const currentOwnerKey = String(room.settings?.ownerKey || '').trim();
        const requestedOwnerKey = String(settings?.ownerKey || '').trim();
        if (
            room.settings?.persistentRoom === true
            && currentOwnerKey
            && requestedOwnerKey
            && currentOwnerKey !== requestedOwnerKey
        ) {
            return null;
        }
        const previousInviteId = String(room.inviteId || '').trim();
        const requestedSlug = settings?.roomSlug !== undefined
            ? normalizeRoomSlug(settings.roomSlug, previousInviteId)
            : String(room.settings?.roomSlug || room.inviteId || '').trim();
        const nextPasswordHash = settings?.password !== undefined
            ? (hashRoomPassword(settings.password) || String(room.settings?.roomPasswordHash || '').trim())
            : String(room.settings?.roomPasswordHash || '').trim();

        room.settings = {
            ...room.settings,
            roomTitle: settings?.roomTitle !== undefined
                ? String(settings.roomTitle || '').trim()
                : String(room.settings?.roomTitle || room.title || '').trim(),
            hostDisplayName: settings?.hostDisplayName !== undefined
                ? String(settings.hostDisplayName || '').trim()
                : String(room.settings?.hostDisplayName || room.hostDisplayName || '').trim(),
            allowGuestScreenShare: settings?.allowGuestScreenShare !== undefined
                ? settings.allowGuestScreenShare === true
                : room.settings?.allowGuestScreenShare !== false,
            allowGuestCamera: settings?.allowGuestCamera !== undefined
                ? settings.allowGuestCamera === true
                : room.settings?.allowGuestCamera !== false,
            allowGuestMicrophone: settings?.allowGuestMicrophone !== undefined
                ? settings.allowGuestMicrophone === true
                : room.settings?.allowGuestMicrophone !== false,
            webinarMode: settings?.webinarMode !== undefined
                ? settings.webinarMode === true
                : room.settings?.webinarMode === true,
            hostRecordingActive: settings?.hostRecordingActive !== undefined
                ? settings.hostRecordingActive === true
                : room.settings?.hostRecordingActive === true,
            hostShareActive: settings?.hostShareActive !== undefined
                ? settings.hostShareActive === true
                : room.settings?.hostShareActive === true,
            hostShareLabel: settings?.hostShareLabel !== undefined
                ? String(settings.hostShareLabel || '').trim()
                : String(room.settings?.hostShareLabel || '').trim(),
            hostShareMonitorAudioEnabled: settings?.hostShareMonitorAudioEnabled !== undefined
                ? settings.hostShareMonitorAudioEnabled === true
                : room.settings?.hostShareMonitorAudioEnabled === true,
            youtubeWatchUrl: settings?.youtubeWatchUrl !== undefined
                ? String(settings.youtubeWatchUrl || '').trim()
                : String(room.settings?.youtubeWatchUrl || '').trim(),
            youtubeLiveActive: settings?.youtubeLiveActive !== undefined
                ? settings.youtubeLiveActive === true
                : room.settings?.youtubeLiveActive === true,
            persistentRoom: settings?.persistentRoom !== undefined
                ? settings.persistentRoom === true
                : room.settings?.persistentRoom === true,
            ownerKey: room.settings?.persistentRoom === true || settings?.persistentRoom === true
                ? (currentOwnerKey || requestedOwnerKey)
                : '',
            roomSlug: requestedSlug,
            passwordConfigured: !!nextPasswordHash,
            roomPasswordHash: nextPasswordHash,
            allowJoinWhenHostAbsent: settings?.allowJoinWhenHostAbsent !== undefined
                ? settings.allowJoinWhenHostAbsent === true
                : room.settings?.allowJoinWhenHostAbsent === true,
            requirePasswordWhenHostPresent: settings?.requirePasswordWhenHostPresent !== undefined
                ? settings.requirePasswordWhenHostPresent === true
                : room.settings?.requirePasswordWhenHostPresent === true,
            requirePasswordWhenHostAbsent: settings?.requirePasswordWhenHostAbsent !== undefined
                ? settings.requirePasswordWhenHostAbsent === true
                : room.settings?.requirePasswordWhenHostAbsent === true,
            updatedAt: Date.now()
        };

        if (room.settings.roomTitle) {
            room.title = room.settings.roomTitle;
        }
        if (room.settings.hostDisplayName) {
            room.hostDisplayName = room.settings.hostDisplayName;
            room.participants = room.participants.map((participant) => (
                String(participant.role || '').trim() === 'host'
                    ? {
                        ...participant,
                        displayName: room.settings.hostDisplayName,
                        updatedAt: Date.now()
                    }
                    : participant
            ));
        }
        if (room.settings?.persistentRoom === true && requestedSlug && requestedSlug !== previousInviteId) {
            this.inviteToRoom.delete(previousInviteId);
            room.inviteId = requestedSlug;
            this.inviteToRoom.set(requestedSlug, room.roomId);
        }
        if (room.settings?.persistentRoom === true) {
            this.savePersistentRooms();
        }

        return room;
    }

    updateParticipantControls(roomId, identity, updates) {
        const room = this.getRoom(roomId);
        if (!room) {
            return null;
        }
        const normalizedIdentity = String(identity || '').trim();
        const participantIndex = room.participants.findIndex((item) => item.identity === normalizedIdentity);
        if (participantIndex < 0) {
            return null;
        }

        const participant = room.participants[participantIndex];
        const nextRole = updates?.role !== undefined
            ? String(updates.role || participant.role || 'guest').trim()
            : String(participant.role || 'guest').trim();
        const nextRequestedCameraEnabled = updates?.requestedCameraEnabled === null
            ? undefined
            : (updates?.requestedCameraEnabled !== undefined ? updates.requestedCameraEnabled === true : participant.requestedCameraEnabled);
        const nextRequestedMicrophoneEnabled = updates?.requestedMicrophoneEnabled === null
            ? undefined
            : (updates?.requestedMicrophoneEnabled !== undefined ? updates.requestedMicrophoneEnabled === true : participant.requestedMicrophoneEnabled);
        room.participants[participantIndex] = {
            ...participant,
            displayName: updates?.displayName !== undefined
                ? (String(updates.displayName || '').trim() || participant.displayName || normalizedIdentity)
                : participant.displayName,
            role: nextRole || 'guest',
            allowCamera: updates?.allowCamera !== undefined ? updates.allowCamera === true : participant.allowCamera !== false,
            allowMicrophone: updates?.allowMicrophone !== undefined ? updates.allowMicrophone === true : participant.allowMicrophone !== false,
            allowScreenShare: updates?.allowScreenShare !== undefined ? updates.allowScreenShare === true : participant.allowScreenShare !== false,
            requestedCameraEnabled: nextRequestedCameraEnabled,
            requestedMicrophoneEnabled: nextRequestedMicrophoneEnabled,
            handRaiseActive: updates?.handRaiseActive !== undefined ? updates.handRaiseActive === true : participant.handRaiseActive === true,
            handRaiseSeenAt: updates?.handRaiseSeenAt !== undefined ? Number(updates.handRaiseSeenAt) || 0 : Number(participant.handRaiseSeenAt) || 0,
            handRaiseRequestedAt: updates?.handRaiseActive === false ? 0 : (Number(participant.handRaiseRequestedAt) || 0),
            updatedAt: Date.now()
        };

        return room;
    }

    updateAllGuestControls(roomId, updates) {
        const room = this.getRoom(roomId);
        if (!room) {
            return null;
        }

        room.participants = room.participants.map((participant) => {
            if (!['guest', 'audience', 'panelist', 'co_host', 'sign_interpreter', 'live_interpreter'].includes(String(participant.role || '').trim())) {
                return participant;
            }
            const nextRequestedCameraEnabled = updates?.requestedCameraEnabled === null
                ? undefined
                : (updates?.requestedCameraEnabled !== undefined ? updates.requestedCameraEnabled === true : participant.requestedCameraEnabled);
            const nextRequestedMicrophoneEnabled = updates?.requestedMicrophoneEnabled === null
                ? undefined
                : (updates?.requestedMicrophoneEnabled !== undefined ? updates.requestedMicrophoneEnabled === true : participant.requestedMicrophoneEnabled);
            return {
                ...participant,
                allowCamera: updates?.allowCamera !== undefined ? updates.allowCamera === true : participant.allowCamera !== false,
                allowMicrophone: updates?.allowMicrophone !== undefined ? updates.allowMicrophone === true : participant.allowMicrophone !== false,
                allowScreenShare: updates?.allowScreenShare !== undefined ? updates.allowScreenShare === true : participant.allowScreenShare !== false,
                requestedCameraEnabled: nextRequestedCameraEnabled,
                requestedMicrophoneEnabled: nextRequestedMicrophoneEnabled,
                updatedAt: Date.now()
            };
        });

        return room;
    }

    updateHandRaise(roomId, identity, updates) {
        const room = this.getRoom(roomId);
        if (!room) {
            return null;
        }
        const normalizedIdentity = String(identity || '').trim();
        const participantIndex = room.participants.findIndex((item) => item.identity === normalizedIdentity);
        if (participantIndex < 0) {
            return null;
        }

        const participant = room.participants[participantIndex];
        const nextActive = updates?.handRaiseActive !== undefined
            ? updates.handRaiseActive === true
            : participant.handRaiseActive === true;
        const now = Date.now();

        room.participants[participantIndex] = {
            ...participant,
            handRaiseActive: nextActive,
            handRaiseRequestedAt: updates?.handRaiseActive === true
                ? now
                : (updates?.handRaiseActive === false ? 0 : Number(participant.handRaiseRequestedAt) || 0),
            handRaiseSeenAt: updates?.handRaiseSeenAt !== undefined
                ? Number(updates.handRaiseSeenAt) || 0
                : (updates?.handRaiseActive === true ? 0 : Number(participant.handRaiseSeenAt) || 0),
            updatedAt: now
        };

        return room;
    }

    addChatMessage(roomId, message) {
        const room = this.getRoom(roomId);
        if (!room) {
            return null;
        }

        const now = Date.now();
        const normalizedText = String(message?.text || '').trim();
        if (!normalizedText) {
            return null;
        }

        const nextMessage = {
            id: randomId('chat'),
            senderIdentity: String(message?.senderIdentity || '').trim(),
            senderName: String(message?.senderName || '').trim() || String(message?.senderIdentity || '').trim() || 'Katılımcı',
            senderRole: String(message?.senderRole || 'guest').trim() || 'guest',
            audience: String(message?.audience || 'all').trim() === 'host'
                ? 'host'
                : (String(message?.audience || 'all').trim() === 'participant' ? 'participant' : 'all'),
            recipientIdentity: String(message?.recipientIdentity || '').trim(),
            recipientName: String(message?.recipientName || '').trim(),
            text: normalizedText,
            createdAt: now
        };

        room.chatMessages = [...(Array.isArray(room.chatMessages) ? room.chatMessages : []), nextMessage].slice(-250);
        return {
            room,
            message: nextMessage
        };
    }

    updateLiveCaption(roomId, caption) {
        const room = this.getRoom(roomId);
        if (!room) {
            return null;
        }

        room.liveCaption = {
            enabled: caption?.enabled === true,
            text: String(caption?.text || '').trim(),
            originalText: String(caption?.originalText || '').trim(),
            translatedText: String(caption?.translatedText || '').trim(),
            alternateText: String(caption?.alternateText || '').trim(),
            alternateLanguage: String(caption?.alternateLanguage || '').trim(),
            sourceLanguage: String(caption?.sourceLanguage || '').trim(),
            targetLanguage: String(caption?.targetLanguage || '').trim(),
            scope: String(caption?.scope || '').trim(),
            mode: String(caption?.mode || '').trim(),
            updatedAt: Number(caption?.updatedAt || Date.now()) || Date.now()
        };
        return room;
    }

    updateAccessibleShare(roomId, share) {
        const room = this.getRoom(roomId);
        if (!room) {
            return null;
        }

        const items = Array.isArray(share?.items)
            ? share.items
                .map((item, index) => ({
                    index: Number(item?.index ?? index) || index,
                    label: String(item?.label || '').trim(),
                    text: String(item?.text || '').trim()
                }))
                .filter((item) => item.text)
                .slice(0, 200)
            : [];
        const currentIndex = Math.max(0, Math.min(Number(share?.currentIndex || 0) || 0, Math.max(0, items.length - 1)));
        room.accessibleShare = {
            active: share?.active === true && items.length > 0,
            title: String(share?.title || '').trim(),
            fileName: String(share?.fileName || '').trim(),
            kind: String(share?.kind || '').trim(),
            currentIndex,
            items,
            updatedAt: Number(share?.updatedAt || Date.now()) || Date.now()
        };
        return room;
    }

    getPersistentRooms(ownerKey = '') {
        const normalizedOwnerKey = String(ownerKey || '').trim();
        return Array.from(this.rooms.values())
            .filter((room) => room?.settings?.persistentRoom === true)
            .filter((room) => {
                const roomOwnerKey = String(room.settings?.ownerKey || '').trim();
                return normalizedOwnerKey && roomOwnerKey && roomOwnerKey === normalizedOwnerKey;
            })
            .map((room) => ({
                roomId: room.roomId,
                inviteId: room.inviteId,
                title: room.title,
                hostDisplayName: room.hostDisplayName,
                inviteUrl: '',
                hostConnected: this.roomHasConnectedHost(room),
                settings: room.settings
            }));
    }

    isPasswordRequired(room, { hostConnected = false } = {}) {
        if (!room?.settings?.passwordConfigured) {
            return false;
        }
        return hostConnected
            ? room.settings?.requirePasswordWhenHostPresent === true
            : room.settings?.requirePasswordWhenHostAbsent === true;
    }

    verifyRoomPassword(room, password) {
        if (!room?.settings?.passwordConfigured) {
            return true;
        }
        return String(room.settings.roomPasswordHash || '').trim() === hashRoomPassword(password);
    }

    createWebinarRequest({ requesterName, requesterEmail = '', details }) {
        const normalizedName = String(requesterName || '').trim();
        const normalizedEmail = String(requesterEmail || '').trim();
        const normalizedDetails = String(details || '').trim();
        if (!normalizedName || !normalizedDetails) {
            return null;
        }
        const now = Date.now();
        const request = {
            requestId: randomId('webinar-request'),
            requesterName: normalizedName.slice(0, 120),
            requesterEmail: normalizedEmail.slice(0, 180),
            details: normalizedDetails.slice(0, 4000),
            status: 'pending',
            createdAt: now,
            updatedAt: now
        };
        this.webinarRequests.unshift(request);
        this.webinarRequests = this.webinarRequests.slice(0, 500);
        this.saveWebinarRequests();
        return request;
    }

    getWebinarRequests({ includeClosed = true } = {}) {
        return [...this.webinarRequests]
            .filter((request) => includeClosed || String(request.status || 'pending') === 'pending')
            .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
    }

    updateWebinarRequest(requestId, updates = {}) {
        const normalizedId = String(requestId || '').trim();
        const index = this.webinarRequests.findIndex((request) => request.requestId === normalizedId);
        if (index < 0) {
            return null;
        }
        const current = this.webinarRequests[index];
        const nextStatus = ['pending', 'approved', 'rejected'].includes(String(updates.status || '').trim())
            ? String(updates.status || '').trim()
            : current.status;
        const next = {
            ...current,
            status: nextStatus,
            updatedAt: Date.now()
        };
        this.webinarRequests[index] = next;
        this.saveWebinarRequests();
        return next;
    }

    createWebinarFromRequest(requestId, options = {}) {
        const normalizedId = String(requestId || '').trim();
        const index = this.webinarRequests.findIndex((request) => request.requestId === normalizedId);
        if (index < 0) {
            return null;
        }
        const current = this.webinarRequests[index];
        const now = Date.now();
        const title = String(options.title || current.webinar?.title || current.requesterName || '').trim();
        if (!title) {
            return null;
        }
        const existingWebinar = current.webinar && typeof current.webinar === 'object' ? current.webinar : {};
        const webinarId = String(existingWebinar.webinarId || '').trim() || randomId('webinar');
        const roomSlug = normalizeRoomSlug(options.roomSlug, String(existingWebinar.roomSlug || webinarId).replace(/^webinar-/, 'webinar-'));
        const webinar = {
            webinarId,
            hostKey: String(existingWebinar.hostKey || '').trim() || createReadableWebinarKey(),
            title,
            scheduledAt: options.scheduledAt || existingWebinar.scheduledAt || null,
            durationMinutes: Math.max(15, Math.min(1440, Number(options.durationMinutes || existingWebinar.durationMinutes || 120) || 120)),
            audienceLimit: Math.max(1, Math.min(1000, Number(options.audienceLimit || existingWebinar.audienceLimit || 150) || 150)),
            panelistLimit: Math.max(1, Math.min(50, Number(options.panelistLimit || existingWebinar.panelistLimit || 20) || 20)),
            persistent: options.persistent === true,
            roomSlug,
            password: String(options.password || existingWebinar.password || '').trim(),
            allowJoinWhenHostAbsent: options.allowJoinWhenHostAbsent === true,
            restrictBeforeStart: options.restrictBeforeStart === true,
            restrictAfterEnd: options.restrictAfterEnd === true,
            createdAt: Number(existingWebinar.createdAt || now) || now,
            updatedAt: now
        };
        const next = {
            ...current,
            status: 'approved',
            webinar,
            updatedAt: now
        };
        this.webinarRequests[index] = next;
        this.saveWebinarRequests();
        return next;
    }

    getWebinarByHostKey(hostKey) {
        const normalizedKey = String(hostKey || '').trim();
        if (!normalizedKey) {
            return null;
        }
        return this.webinarRequests.find((request) => (
            request.webinar
            && String(request.webinar.hostKey || '').trim().toLowerCase() === normalizedKey.toLowerCase()
        )) || null;
    }

    openWebinarByHostKey(hostKey, { hostDisplayName, inviteBaseUrl } = {}) {
        const request = this.getWebinarByHostKey(hostKey);
        if (!request?.webinar) {
            return { error: 'webinar_host_key_invalid' };
        }
        const webinar = request.webinar;
        if (webinar.persistent !== true && webinar.scheduledAt) {
            const scheduledTime = new Date(webinar.scheduledAt).getTime();
            const durationMs = Math.max(15, Math.min(1440, Number(webinar.durationMinutes || 120) || 120)) * 60 * 1000;
            const now = Date.now();
            if (!Number.isNaN(scheduledTime) && webinar.restrictBeforeStart === true && now < scheduledTime) {
                return { error: 'webinar_not_started_yet', request };
            }
            if (!Number.isNaN(scheduledTime) && webinar.restrictAfterEnd === true && now > scheduledTime + durationMs) {
                return { error: 'webinar_expired', request };
            }
        }
        const room = this.createRoom({
            hostDisplayName,
            title: webinar.title,
            scheduledAt: webinar.scheduledAt,
            inviteBaseUrl,
            persistentRoom: webinar.persistent === true,
            roomSlug: webinar.persistent === true ? webinar.roomSlug : '',
            password: webinar.password,
            allowJoinWhenHostAbsent: webinar.allowJoinWhenHostAbsent === true,
            requirePasswordWhenHostPresent: !!webinar.password,
            requirePasswordWhenHostAbsent: !!webinar.password,
            webinarMode: true
        });
        const index = this.webinarRequests.findIndex((item) => item.requestId === request.requestId);
        if (index >= 0) {
            this.webinarRequests[index] = {
                ...this.webinarRequests[index],
                webinar: {
                    ...webinar,
                    roomId: room.roomId,
                    inviteId: room.inviteId,
                    lastOpenedAt: Date.now()
                },
                updatedAt: Date.now()
            };
            this.saveWebinarRequests();
        }
        return { request: this.webinarRequests[index] || request, room };
    }
}

module.exports = {
    RoomStore
};
