(function () {
    const ASSET_VERSION = '20260819a';
    const LOCAL_BACKUP_DB_NAME = 'evd-local-backup-recordings';
    const LOCAL_BACKUP_DB_VERSION = 1;
    const LOCAL_BACKUP_CHUNK_STORE = 'chunks';
    const PARTICIPANT_PRESENCE_AUTO_ANNOUNCE_STORAGE_KEY = 'evd.broadcastRoomJoin.participantPresenceAutoAnnounce';
    const MICROPHONE_ECHO_CANCELLATION_STORAGE_KEY = 'evd.broadcastRoomJoin.microphoneEchoCancellation';
    const MICROPHONE_NOISE_SUPPRESSION_STORAGE_KEY = 'evd.broadcastRoomJoin.microphoneNoiseSuppression';
    const MICROPHONE_AUTO_GAIN_CONTROL_STORAGE_KEY = 'evd.broadcastRoomJoin.microphoneAutoGainControl';
    let localBackupDbPromise = null;

    function loadStoredBoolean(key, fallback = true) {
        try {
            const value = window.localStorage.getItem(key);
            if (value === 'true') return true;
            if (value === 'false') return false;
        } catch (_error) {
            // Ignore storage failures and use the default.
        }
        return fallback;
    }

    function saveStoredBoolean(key, value) {
        try {
            window.localStorage.setItem(key, value ? 'true' : 'false');
        } catch (_error) {
            // Ignore storage failures.
        }
    }

    const state = {
        lang: (navigator.language || 'tr').toLowerCase().startsWith('tr') ? 'tr' : 'en',
        locale: {},
        inviteId: '',
        room: null,
        token: '',
        participantIdentity: '',
        participantRole: 'guest',
        canPublishMedia: true,
        roleRefreshInProgress: false,
        intentionalDisconnect: false,
        reconnectInProgress: false,
        reconnectAttempts: 0,
        reconnectTimer: null,
        roomConnection: null,
        localVideoTrack: null,
        localAudioTrack: null,
        screenShareVideoTrack: null,
        screenShareAudioTrack: null,
        screenShareStream: null,
        screenShareSourceType: '',
        allowGuestScreenShare: true,
        allowGuestCamera: true,
        allowGuestMicrophone: true,
        ownAllowScreenShare: true,
        ownAllowCamera: true,
        ownAllowMicrophone: true,
        ownPermissionAnnouncementsBootstrapped: false,
        allowJoinWhenHostAbsent: false,
        requirePasswordNow: false,
        passwordConfigured: false,
        hostConnected: false,
        livekitUrl: '',
        lastJoinError: '',
        remoteParticipants: {},
        participants: [],
        audioChannel: 'original',
        chatMessages: [],
        chatSelectedIndex: -1,
        chatAutoAnnounce: true,
        participantPresenceAutoAnnounce: loadStoredBoolean(PARTICIPANT_PRESENCE_AUTO_ANNOUNCE_STORAGE_KEY, true),
        participantPresenceSnapshotInitialized: false,
        participantPresenceKeys: [],
        liveCaption: {
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
        liveCaptionPanelExpanded: false,
        liveCaptionViewEnabled: false,
        joinDevicePanelExpanded: false,
        chatPanelExpanded: false,
        hostActivityPanelExpanded: false,
        moreInfoPanelExpanded: false,
        participantsPanelExpanded: false,
        liveCaptionPreferredLanguage: (navigator.language || 'tr').toLowerCase().startsWith('tr') ? 'tr' : 'en',
        liveCaptionAutoAnnounce: false,
        lastPreferredLanguageStateSignature: '',
        lastLiveCaptionAnnouncementKey: '',
        accessibleShareAutoAnnounce: true,
        lastAccessibleShareKey: '',
        lastAnnouncedChatId: '',
        lastRemoteShareAnnouncementKey: '',
        lastRemoteShareAudioDiagnosticKey: '',
        participantListRenderSignature: '',
        remoteMediaRenderSignature: '',
        focusedShareKey: '',
        focusedShareDismissedKey: '',
        lowBandwidthMode: false,
        qualityStatsTimer: null,
        lastQualityStatsSentAt: 0,
        lastQualityReport: null,
        remoteVideoRecoveryTimers: {},
        localBackupRecording: {
            active: false,
            stopRequested: false,
            sessionId: '',
            recorder: null,
            stream: null,
            mimeType: '',
            mediaKind: 'audio',
            sequence: 0,
            queuedChunks: 0,
            uploadedChunks: 0,
            failedChunks: 0,
            uploading: false,
            pendingStores: new Set(),
            pendingUploads: new Set(),
            deferredChunks: [],
            startedAt: 0,
            stoppedAt: 0
        },
        handRaiseActive: false,
        lastHandRaiseSeenAt: 0,
        roomStatusTimer: null,
        roomStatusPollIntervalMs: 0,
        participantHeartbeatTimer: null,
        roomEventSource: null,
        roomEventSourceRoomId: '',
        roomEventSourceConnected: false,
        lastSceneAnnouncementKey: '',
        lastHostActivityKey: '',
        activeSpeakerIdentities: [],
        hostRecordingActive: false,
        lastParticipantHeartbeatAt: 0,
        leaveBeaconSent: false,
        hostShareMonitorAudioEnabled: false,
        mediaStabilizerTimer: null,
        deviceRefreshInProgress: false,
        monitorAudioSocket: null,
        monitorAudioContext: null,
        monitorAudioScheduledTime: 0,
        monitorAudioChunkCount: 0,
        translationAudioSocket: null,
        translationAudioContext: null,
        translationAudioScheduledTime: 0,
        lastTranslationAudioSequence: 0,
        lastTranslationAudioSequenceByTarget: {},
        lastTranslationAudioReceivedAtByTarget: {},
        remoteAudioContext: null,
        remoteAudioMixNodes: {},
        audioTest: {
            microphoneStream: null,
            microphoneAudio: null,
            microphoneStopTimer: null
        },
        cameraTest: {
            session: null,
            active: false,
            stream: null,
            ownsStream: false,
            detector: null,
            timer: null,
            statusRefreshTimer: null,
            pendingSignature: '',
            pendingCount: 0,
            lastAnnouncedSignature: '',
            lastAnnouncementAt: 0,
            lastMessage: '',
            lastDetailedMessage: '',
            canvas: null
        },
        devices: {
            cameras: [],
            microphones: [],
            speakers: []
        },
        microphoneVolume: 1,
        speakerVolume: 1,
        microphoneEchoCancellation: loadStoredBoolean(MICROPHONE_ECHO_CANCELLATION_STORAGE_KEY, false),
        microphoneNoiseSuppression: loadStoredBoolean(MICROPHONE_NOISE_SUPPRESSION_STORAGE_KEY, false),
        microphoneAutoGainControl: loadStoredBoolean(MICROPHONE_AUTO_GAIN_CONTROL_STORAGE_KEY, false),
        avatarDataUrl: '',
        avatarUrl: '',
        avatarFileName: ''
    };

    const els = {
        joinStatusSection: document.getElementById('screen-share-section'),
        joinIntro: document.getElementById('join-intro'),
        statusLine: document.getElementById('status-line'),
        roomInfoSection: document.getElementById('room-info-section'),
        roomTitle: document.getElementById('room-title'),
        roomHost: document.getElementById('room-host'),
        roomTitleMore: document.getElementById('room-title-more'),
        roomHostMore: document.getElementById('room-host-more'),
        btnRequestPermissions: document.getElementById('btn-request-permissions'),
        joinForm: document.getElementById('join-form'),
        displayNameGroup: document.getElementById('display-name-group'),
        displayName: document.getElementById('display-name'),
        roomPasswordGroup: document.getElementById('room-password-group'),
        roomPassword: document.getElementById('room-password'),
        cameraEnabled: document.getElementById('camera-enabled'),
        microphoneEnabled: document.getElementById('microphone-enabled'),
        btnToggleJoinDevicePanel: document.getElementById('btn-toggle-join-device-panel'),
        joinDevicePanel: document.getElementById('join-device-panel'),
        cameraDevice: document.getElementById('camera-device'),
        microphoneDevice: document.getElementById('microphone-device'),
        speakerDevice: document.getElementById('speaker-device'),
        microphoneVolume: document.getElementById('microphone-volume'),
        microphoneVolumeValue: document.getElementById('microphone-volume-value'),
        microphoneEchoCancellation: document.getElementById('microphone-echo-cancellation'),
        microphoneNoiseSuppression: document.getElementById('microphone-noise-suppression'),
        microphoneAutoGainControl: document.getElementById('microphone-auto-gain-control'),
        speakerVolume: document.getElementById('speaker-volume'),
        speakerVolumeValue: document.getElementById('speaker-volume-value'),
        btnTestSpeaker: document.getElementById('btn-test-speaker'),
        btnTestMicrophone: document.getElementById('btn-test-microphone'),
        audioTestStatus: document.getElementById('audio-test-status'),
        btnTestCameraFraming: document.getElementById('btn-test-camera-framing'),
        cameraFramingDialog: document.getElementById('camera-framing-dialog'),
        cameraFramingTitle: document.getElementById('camera-framing-title'),
        cameraFramingPreview: document.getElementById('camera-framing-preview'),
        cameraFramingStatus: document.getElementById('camera-framing-status'),
        btnReadCameraFramingStatus: document.getElementById('btn-read-camera-framing-status'),
        btnCloseCameraFraming: document.getElementById('btn-close-camera-framing'),
        participantAvatarFile: document.getElementById('participant-avatar-file'),
        btnRemoveParticipantAvatar: document.getElementById('btn-remove-participant-avatar'),
        participantAvatarStatus: document.getElementById('participant-avatar-status'),
        screenShareCard: document.getElementById('screen-share-card'),
        screenShareStatus: document.getElementById('screen-share-status'),
        screenShareAudioMode: document.getElementById('screen-share-audio-mode'),
        btnStartScreenShare: document.getElementById('btn-start-screen-share'),
        btnStopScreenShare: document.getElementById('btn-stop-screen-share'),
        btnJoinRoom: document.getElementById('btn-join-room'),
        btnLeaveRoom: document.getElementById('btn-leave-room'),
        btnReturnFocusedShare: document.getElementById('btn-return-focused-share'),
        joinResultGroup: document.getElementById('join-result-group'),
        connectionStatusGroup: document.getElementById('connection-status-group'),
        joinResult: document.getElementById('join-result'),
        connectionStatus: document.getElementById('connection-status'),
        postJoinSection: document.getElementById('post-join-section'),
        joinedDisplayName: document.getElementById('joined-display-name'),
        btnUpdateDisplayName: document.getElementById('btn-update-display-name'),
        btnToggleMoreInfoPanel: document.getElementById('btn-toggle-more-info-panel'),
        moreInfoPanel: document.getElementById('more-info-panel'),
        btnToggleParticipantsPanel: document.getElementById('btn-toggle-participants-panel'),
        participantsPanel: document.getElementById('participants-panel'),
        scenePositionStatus: document.getElementById('scene-position-status'),
        btnToggleHostActivityPanel: document.getElementById('btn-toggle-host-activity-panel'),
        hostActivityPanel: document.getElementById('host-activity-panel'),
        hostActivityStatus: document.getElementById('host-activity-status'),
        roomSummaryStatus: document.getElementById('room-summary-status'),
        localBackupRecordingGroup: document.getElementById('local-backup-recording-group'),
        localBackupRecordingStatus: document.getElementById('local-backup-recording-status'),
        localPreview: document.getElementById('local-preview'),
        remoteMediaList: document.getElementById('remote-media-list'),
        remoteVisualStage: document.getElementById('remote-visual-stage'),
        remoteAudioHost: document.getElementById('remote-audio-host'),
        lowBandwidthMode: document.getElementById('low-bandwidth-mode'),
        focusedShareView: document.getElementById('focused-share-view'),
        focusedShareTitle: document.getElementById('focused-share-title'),
        focusedShareVideo: document.getElementById('focused-share-video'),
        btnCloseFocusedShare: document.getElementById('btn-close-focused-share'),
        btnToggleFocusedAccessibleShare: document.getElementById('btn-toggle-focused-accessible-share'),
        focusedAccessibleSharePanel: document.getElementById('focused-accessible-share-panel'),
        focusedAccessibleShareText: document.getElementById('focused-accessible-share-text'),
        focusedAccessibleShareStatus: document.getElementById('focused-accessible-share-status'),
        focusedAccessibleShareAutoAnnounceGroup: document.getElementById('focused-accessible-share-auto-announce-group'),
        focusedAccessibleShareAutoAnnounce: document.getElementById('focused-accessible-share-auto-announce'),
        focusedLiveRegion: document.getElementById('focused-live-region'),
        audioChannelGroup: document.getElementById('audio-channel-group'),
        audioChannelSelect: document.getElementById('audio-channel-select'),
        accessibleShareGroup: document.getElementById('accessible-share-group'),
        accessibleShareText: document.getElementById('accessible-share-text'),
        accessibleShareStatus: document.getElementById('accessible-share-status'),
        accessibleShareAutoAnnounceGroup: document.getElementById('accessible-share-auto-announce-group'),
        accessibleShareAutoAnnounce: document.getElementById('accessible-share-auto-announce'),
        btnToggleLiveCaptionPanel: document.getElementById('btn-toggle-live-caption-panel'),
        liveCaptionPanel: document.getElementById('live-caption-panel'),
        liveCaptionPanelStatus: document.getElementById('live-caption-panel-status'),
        btnToggleLiveCaptionView: document.getElementById('btn-toggle-live-caption-view'),
        liveCaptionPreferredLanguage: document.getElementById('live-caption-preferred-language'),
        liveCaptionAudioModeStatus: document.getElementById('live-caption-audio-mode-status'),
        liveCaptionAutoAnnounce: document.getElementById('live-caption-auto-announce'),
        liveCaptionAutoAnnounceLabel: document.getElementById('live-caption-auto-announce-label'),
        liveCaptionText: document.getElementById('live-caption-text'),
        handRaiseStatusGroup: document.getElementById('hand-raise-status-group'),
        handRaiseStatus: document.getElementById('hand-raise-status'),
        btnToggleChatPanel: document.getElementById('btn-toggle-chat-panel'),
        chatPanel: document.getElementById('chat-panel'),
        chatMessageList: document.getElementById('chat-message-list'),
        chatCompose: document.getElementById('chat-compose'),
        chatTarget: document.getElementById('chat-target'),
        btnChatSendAll: document.getElementById('btn-chat-send-all'),
        btnChatSendHost: document.getElementById('btn-chat-send-host'),
        chatAutoAnnounce: document.getElementById('chat-auto-announce'),
        participantPresenceAutoAnnounce: document.getElementById('participant-presence-auto-announce'),
        btnHandRaise: document.getElementById('btn-hand-raise'),
        liveRegion: document.getElementById('live-region'),
        chatLiveRegion: document.getElementById('chat-live-region'),
        chatSelectedDetail: document.getElementById('chat-selected-detail')
    };

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderTextWithClickableLinks(value) {
        const text = String(value || '');
        const urlPattern = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
        let cursor = 0;
        let html = '';
        for (const match of text.matchAll(urlPattern)) {
            const url = match[0];
            const index = match.index || 0;
            html += escapeHtml(text.slice(cursor, index));
            const href = url.toLowerCase().startsWith('www.') ? `https://${url}` : url;
            html += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
            cursor = index + url.length;
        }
        html += escapeHtml(text.slice(cursor));
        return html.replace(/\n/g, '<br>');
    }
    let joinInProgress = false;

    function t(key, fallback, params = {}) {
        const value = key.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), state.locale);
        const template = typeof value === 'string' && value ? value : fallback;
        return Object.entries(params).reduce((result, [paramKey, paramValue]) => result.replaceAll(`{${paramKey}}`, String(paramValue)), template);
    }

    function getLocalizedDefaultRoomTitle(rawTitle) {
        const title = String(rawTitle || '').trim();
        if (!title) {
            return t('broadcast_room_join.room_title_fallback', 'Adsız oda');
        }
        const defaultTitles = new Set([
            'EVD Yayın Odası',
            'EVD Broadcast Room',
            'EVD Sala de emisión',
            'EVD Salle de diffusion',
            'EVD Übertragungsraum'
        ]);
        if (defaultTitles.has(title)) {
            return t('broadcast_room.default_room_title', 'EVD Yayın Odası');
        }
        return title;
    }

    function getLocalizedSceneSlotLabel(slot = {}) {
        const slotId = String(slot?.slotId || '').trim();
        const rawLabel = String(slot?.slotLabel || '').trim();
        const keyMap = {
            main: ['broadcast_room.slot_main', 'Ana alan'],
            left: ['broadcast_room.slot_left', 'Sol alan'],
            right: ['broadcast_room.slot_right', 'Sağ alan'],
            'top-left': ['broadcast_room.slot_top_left', 'Sol üst'],
            'top-center': ['broadcast_room.slot_top_center', 'Üst orta'],
            'top-right': ['broadcast_room.slot_top_right', 'Sağ üst'],
            'bottom-left': ['broadcast_room.slot_bottom_left', 'Sol alt'],
            'bottom-center': ['broadcast_room.slot_bottom_center', 'Alt orta'],
            'bottom-right': ['broadcast_room.slot_bottom_right', 'Sağ alt'],
            'sign-interpreter': ['broadcast_room.slot_sign_interpreter_overlay', 'Sağ alt işaret dili tercümanı']
        };
        const rawMap = {
            'Ana alan': ['broadcast_room.slot_main', 'Ana alan'],
            'Main area': ['broadcast_room.slot_main', 'Ana alan'],
            'Sol alan': ['broadcast_room.slot_left', 'Sol alan'],
            'Left area': ['broadcast_room.slot_left', 'Sol alan'],
            'Sağ alan': ['broadcast_room.slot_right', 'Sağ alan'],
            'Right area': ['broadcast_room.slot_right', 'Sağ alan'],
            'Sol üst': ['broadcast_room.slot_top_left', 'Sol üst'],
            'Top left': ['broadcast_room.slot_top_left', 'Sol üst'],
            'Sağ üst': ['broadcast_room.slot_top_right', 'Sağ üst'],
            'Top right': ['broadcast_room.slot_top_right', 'Sağ üst'],
            'Üst orta': ['broadcast_room.slot_top_center', 'Üst orta'],
            'Top center': ['broadcast_room.slot_top_center', 'Üst orta'],
            'Sol alt': ['broadcast_room.slot_bottom_left', 'Sol alt'],
            'Bottom left': ['broadcast_room.slot_bottom_left', 'Sol alt'],
            'Alt orta': ['broadcast_room.slot_bottom_center', 'Alt orta'],
            'Bottom center': ['broadcast_room.slot_bottom_center', 'Alt orta'],
            'Sağ alt': ['broadcast_room.slot_bottom_right', 'Sağ alt'],
            'Bottom right': ['broadcast_room.slot_bottom_right', 'Sağ alt'],
            'Sağ üst küçük alan': ['broadcast_room.slot_top_right_small', 'Sağ üst küçük alan'],
            'Top right small area': ['broadcast_room.slot_top_right_small', 'Sağ üst küçük alan'],
            'Sol alt küçük alan': ['broadcast_room.slot_bottom_left_small', 'Sol alt küçük alan'],
            'Bottom left small area': ['broadcast_room.slot_bottom_left_small', 'Sol alt küçük alan'],
            'Alt orta küçük alan': ['broadcast_room.slot_bottom_center_small', 'Alt orta küçük alan'],
            'Bottom center small area': ['broadcast_room.slot_bottom_center_small', 'Alt orta küçük alan'],
            'Alt orta sol küçük alan': ['broadcast_room.slot_bottom_center_left_small', 'Alt orta sol küçük alan'],
            'Bottom center-left small area': ['broadcast_room.slot_bottom_center_left_small', 'Alt orta sol küçük alan'],
            'Alt orta sağ küçük alan': ['broadcast_room.slot_bottom_center_right_small', 'Alt orta sağ küçük alan'],
            'Bottom center-right small area': ['broadcast_room.slot_bottom_center_right_small', 'Alt orta sağ küçük alan'],
            'Sağ alt küçük alan': ['broadcast_room.slot_bottom_right_small', 'Sağ alt küçük alan'],
            'Bottom right small area': ['broadcast_room.slot_bottom_right_small', 'Sağ alt küçük alan'],
            'Sağ alt işaret dili tercümanı': ['broadcast_room.slot_sign_interpreter_overlay', 'Sağ alt işaret dili tercümanı'],
            'Lower-right sign language interpreter': ['broadcast_room.slot_sign_interpreter_overlay', 'Sağ alt işaret dili tercümanı']
        };
        const entry = rawMap[rawLabel] || keyMap[slotId];
        if (entry) {
            return t(entry[0], entry[1]);
        }
        return rawLabel || t('broadcast_room_join.scene_slot_unknown', 'bilinmeyen alan');
    }

    function setShortcutAccessibleLabel(el, label) {
        if (!el || !label) {
            return;
        }
        el.setAttribute('aria-label', label);
        el.setAttribute('title', label);
    }

    function playRoomTone(type = 'join') {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            return;
        }
        try {
            const audioContext = new AudioContextClass();
            const frequencies = type === 'leave' ? [440, 330] : [660, 880];
            let startTime = audioContext.currentTime + 0.02;
            frequencies.forEach((frequency) => {
                const oscillator = audioContext.createOscillator();
                const gain = audioContext.createGain();
                oscillator.type = 'sine';
                oscillator.frequency.value = frequency;
                gain.gain.setValueAtTime(0.0001, startTime);
                gain.gain.exponentialRampToValueAtTime(0.06, startTime + 0.015);
                gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.14);
                oscillator.connect(gain);
                gain.connect(audioContext.destination);
                oscillator.start(startTime);
                oscillator.stop(startTime + 0.16);
                startTime += 0.16;
            });
            window.setTimeout(() => {
                try { audioContext.close(); } catch (_error) {}
            }, 700);
        } catch (_error) {
            // Notification tones are best-effort only.
        }
    }

    function detachMediaSessionHandlers() {
        try {
            if (!navigator.mediaSession || typeof navigator.mediaSession.setActionHandler !== 'function') {
                return;
            }
            navigator.mediaSession.setActionHandler('togglemicrophone', null);
        } catch (_error) {
            // ignore unsupported action handlers
        }
    }

    function attachMediaSessionHandlers() {
        try {
            if (!navigator.mediaSession || typeof navigator.mediaSession.setActionHandler !== 'function') {
                return;
            }
            navigator.mediaSession.setActionHandler('togglemicrophone', () => {
                toggleGuestMicrophoneShortcut().catch(() => {});
            });
        } catch (_error) {
            // Best effort only; unsupported browsers will ignore this.
        }
    }

    function announce(message) {
        const targets = [els.liveRegion, els.focusedLiveRegion].filter(Boolean);
        if (!targets.length) return;
        targets.forEach((target) => {
            target.textContent = '';
        });
        requestAnimationFrame(() => {
            targets.forEach((target) => {
                target.textContent = message;
            });
        });
    }

    function setStatus(message) {
        if (els.statusLine) {
            els.statusLine.textContent = message;
        }
        announce(message);
    }

    function setJoinResult(message) {
        if (els.joinResult) {
            els.joinResult.textContent = message;
        }
        if (els.joinResultGroup) {
            els.joinResultGroup.hidden = !String(message || '').trim();
        }
    }

    function formatErrorMessage(error) {
        const message = error?.message || error?.toString?.() || String(error || 'unknown_error');
        state.lastJoinError = String(message || 'unknown_error');
        return state.lastJoinError;
    }

    function setConnectionStatus(message) {
        if (els.connectionStatus) {
            els.connectionStatus.textContent = message;
        }
        if (els.connectionStatusGroup) {
            const normalized = String(message || '').trim();
            const hideBecauseWaiting = !normalized
                || normalized === t('broadcast_room_join.connection_waiting', 'Canlı oda bağlantısı henüz kurulmadı.');
            els.connectionStatusGroup.hidden = hideBecauseWaiting;
        }
    }

    function setScenePositionStatus(message) {
        if (els.scenePositionStatus) {
            els.scenePositionStatus.textContent = message;
        }
    }

    function setHostActivityStatus(message) {
        if (els.hostActivityStatus) {
            els.hostActivityStatus.textContent = message;
        }
    }

    function setRoomSummaryStatus(message) {
        if (els.roomSummaryStatus) {
            els.roomSummaryStatus.textContent = message;
        }
    }

    function setLocalBackupRecordingStatus(message) {
        const normalized = String(message || '').trim();
        if (els.localBackupRecordingStatus) {
            els.localBackupRecordingStatus.textContent = normalized;
        }
        if (els.localBackupRecordingGroup) {
            els.localBackupRecordingGroup.hidden = !normalized;
            els.localBackupRecordingGroup.setAttribute('aria-hidden', normalized ? 'false' : 'true');
        }
    }

    function setFieldText(el, value) {
        if (!el) {
            return;
        }
        if ('value' in el) {
            el.value = value;
            return;
        }
        el.textContent = value;
    }

    function updateDocumentTitle(roomTitle = '') {
        const baseTitle = t('broadcast_room_join.window_title', 'EVD Yayın Odası Katılımı');
        const normalizedTitle = String(roomTitle || '').trim();
        document.title = normalizedTitle
            ? t('broadcast_room_join.window_title_with_room', '{room} - EVD Yayın Odası', { room: normalizedTitle })
            : baseTitle;
    }

    function setRoomInfo({ title = '', host = '' } = {}) {
        const roomTitle = title || t('broadcast_room_join.room_title_fallback', 'Adsız oda');
        const hostName = host || t('broadcast_room_join.host_fallback', 'Host');
        [els.roomTitle, els.roomTitleMore].forEach((target) => {
            if (target) target.textContent = roomTitle;
        });
        [els.roomHost, els.roomHostMore].forEach((target) => {
            if (target) target.textContent = hostName;
        });
        updateDocumentTitle(roomTitle);
    }

    function updateJoinViewState() {
        const joined = !!state.roomConnection;
        if (els.joinStatusSection) {
            els.joinStatusSection.hidden = joined;
            els.joinStatusSection.setAttribute('aria-hidden', joined ? 'true' : 'false');
        }
        if (els.roomInfoSection) {
            els.roomInfoSection.hidden = joined;
            els.roomInfoSection.setAttribute('aria-hidden', joined ? 'true' : 'false');
        }
        if (els.joinIntro) {
            els.joinIntro.hidden = joined;
            els.joinIntro.setAttribute('aria-hidden', joined ? 'true' : 'false');
        }
        if (els.displayNameGroup) {
            els.displayNameGroup.hidden = joined;
            els.displayNameGroup.setAttribute('aria-hidden', joined ? 'true' : 'false');
        }
        if (els.displayName) {
            els.displayName.disabled = joined;
        }
        if (els.btnToggleJoinDevicePanel) {
            els.btnToggleJoinDevicePanel.hidden = false;
            els.btnToggleJoinDevicePanel.setAttribute('aria-hidden', 'false');
        }
        if (els.joinDevicePanel) {
            els.joinDevicePanel.hidden = !state.joinDevicePanelExpanded;
            els.joinDevicePanel.setAttribute('aria-hidden', state.joinDevicePanelExpanded ? 'false' : 'true');
        }
        if (els.screenShareCard) {
            els.screenShareCard.hidden = !joined;
        }
        if (els.postJoinSection) {
            els.postJoinSection.hidden = !joined;
        }
        if (els.joinedDisplayName && joined && !String(els.joinedDisplayName.value || '').trim()) {
            const nextName = String(els.displayName?.value || '').trim();
            els.joinedDisplayName.value = nextName;
        }
        if (!joined && !joinInProgress && !state.lastJoinError) {
            if (els.joinResultGroup) {
                els.joinResultGroup.hidden = true;
            }
            if (els.connectionStatusGroup) {
                els.connectionStatusGroup.hidden = true;
            }
        }
    }

    function updateRoomPasswordVisibility() {
        if (!els.roomPasswordGroup) {
            return;
        }
        const passwordRequired = state.requirePasswordNow === true && !state.roomConnection;
        els.roomPasswordGroup.hidden = !passwordRequired;
        els.roomPasswordGroup.setAttribute('aria-hidden', passwordRequired ? 'false' : 'true');
        if (!passwordRequired && els.roomPassword) {
            els.roomPassword.value = '';
        }
        if (els.roomPassword) {
            els.roomPassword.disabled = !passwordRequired;
            els.roomPassword.tabIndex = passwordRequired ? 0 : -1;
        }
    }

    function announceChatMessage(message) {
        if (!els.chatLiveRegion) {
            return;
        }
        els.chatLiveRegion.textContent = '';
        requestAnimationFrame(() => {
            els.chatLiveRegion.textContent = message;
        });
    }

    function setScreenShareStatus(message) {
        if (els.screenShareStatus) {
            els.screenShareStatus.textContent = message;
        }
    }

    function setHandRaiseStatus(message) {
        if (els.handRaiseStatus) {
            els.handRaiseStatus.textContent = message;
        }
    }

    function getOwnParticipant() {
        return (Array.isArray(state.participants) ? state.participants : []).find((participant) => (
            String(participant.identity || '').trim() === String(state.participantIdentity || '').trim()
        )) || null;
    }

    function describeChatMessage(message) {
        const audienceType = String(message?.audience || 'all').trim();
        const audienceKey = audienceType === 'host'
            ? t('broadcast_room_join.chat_audience_host', 'Yöneticiye')
            : (audienceType === 'participant'
                ? t('broadcast_room_join.chat_audience_direct', 'Size özel')
                : t('broadcast_room_join.chat_audience_all', 'Herkese'));
        return t('broadcast_room_join.chat_message_option', '{sender} - {audience}: {text}', {
            sender: String(message?.senderName || message?.senderIdentity || '').trim() || t('broadcast_room_join.host_fallback', 'Host'),
            audience: audienceKey,
            text: String(message?.text || '').trim() || t('broadcast_room_join.chat_empty_message', 'Boş mesaj')
        });
    }

    function getVisibleChatMessages() {
        return (Array.isArray(state.chatMessages) ? state.chatMessages : []).filter((message) => {
            const audience = String(message?.audience || 'all').trim();
            if (audience === 'all') {
                return true;
            }
            if (audience === 'host') {
                return String(message?.senderIdentity || '').trim() === String(state.participantIdentity || '').trim();
            }
            if (audience === 'participant') {
                return String(message?.recipientIdentity || '').trim() === String(state.participantIdentity || '').trim();
            }
            return false;
        });
    }

    function getParticipantPresenceItems(participants = state.participants) {
        const ownIdentity = String(state.participantIdentity || '').trim();
        return (Array.isArray(participants) ? participants : [])
            .filter((participant) => participant && participant.connected !== false)
            .map((participant) => {
                const identity = String(participant.identity || '').trim();
                return {
                    key: identity,
                    name: String(participant.displayName || identity).trim() || t('broadcast_room_join.participant_fallback', 'Katılımcı')
                };
            })
            .filter((item) => item.key && item.key !== ownIdentity)
            .sort((left, right) => left.key.localeCompare(right.key));
    }

    function syncParticipantPresenceAnnouncements(nextParticipants, { announce = true } = {}) {
        const nextItems = getParticipantPresenceItems(nextParticipants);
        if (!state.participantPresenceSnapshotInitialized) {
            state.participantPresenceSnapshotInitialized = true;
            state.participantPresenceKeys = nextItems;
            return;
        }

        const previousMap = new Map((state.participantPresenceKeys || []).map((item) => [item.key, item]));
        const nextMap = new Map(nextItems.map((item) => [item.key, item]));
        const joined = nextItems.filter((item) => !previousMap.has(item.key));
        const left = (state.participantPresenceKeys || []).filter((item) => !nextMap.has(item.key));
        state.participantPresenceKeys = nextItems;

        if (!announce || !state.participantPresenceAutoAnnounce) {
            return;
        }
        if (joined.length > 0) {
            announceMessage(t('broadcast_room_join.participant_joined_announcement', '{name} odaya katıldı.', {
                name: joined.map((item) => item.name).join(', ')
            }));
        } else if (left.length > 0) {
            announceMessage(t('broadcast_room_join.participant_left_announcement', '{name} odadan ayrıldı.', {
                name: left.map((item) => item.name).join(', ')
            }));
        }
    }

    function getChatTargetOptions() {
        const options = [{
            value: 'all',
            label: t('broadcast_room_join.chat_target_all', 'Herkes')
        }];
        const ownIdentity = String(state.participantIdentity || '').trim();
        const participants = Array.isArray(state.participants) ? state.participants : [];
        participants
            .filter((participant) => {
                const identity = String(participant.identity || '').trim();
                return identity && identity !== ownIdentity && participant.connected !== false;
            })
            .forEach((participant) => {
                const identity = String(participant.identity || '').trim();
                const name = String(participant.displayName || identity).trim();
                options.push({
                    value: `participant:${identity}`,
                    label: t('broadcast_room_join.chat_target_participant', '{name} kişisine özel', { name }),
                    recipientIdentity: identity,
                    recipientName: name
                });
            });
        return options;
    }

    function renderChatTargetSelector() {
        if (!els.chatTarget) {
            return;
        }
        const previousValue = String(els.chatTarget.value || 'all');
        const options = getChatTargetOptions();
        els.chatTarget.innerHTML = options.map((option) => (
            `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`
        )).join('');
        els.chatTarget.value = options.some((option) => option.value === previousValue) ? previousValue : 'all';
    }

    function getSelectedChatTarget() {
        const value = String(els.chatTarget?.value || 'all').trim();
        if (!value || value === 'all') {
            return { audience: 'all', recipientIdentity: '', recipientName: '' };
        }
        const option = getChatTargetOptions().find((item) => item.value === value);
        if (option?.recipientIdentity) {
            return {
                audience: 'participant',
                recipientIdentity: option.recipientIdentity,
                recipientName: option.recipientName || ''
            };
        }
        return { audience: 'all', recipientIdentity: '', recipientName: '' };
    }

    function renderChatMessageList({ announceSelection = false } = {}) {
        if (!els.chatMessageList) {
            return;
        }

        const messages = getVisibleChatMessages();
        if (!messages.length) {
            els.chatMessageList.innerHTML = `<option value="">${escapeHtml(t('broadcast_room_join.chat_no_messages', 'Henüz mesaj yok.'))}</option>`;
            els.chatMessageList.disabled = true;
            state.chatSelectedIndex = -1;
            renderSelectedChatMessageDetail();
            return;
        }

        els.chatMessageList.disabled = false;
        els.chatMessageList.innerHTML = messages.map((message, index) => (
            `<option value="${escapeHtml(String(message.id || `chat-${index}`))}">${escapeHtml(describeChatMessage(message))}</option>`
        )).join('');

        const boundedIndex = Math.max(0, Math.min(state.chatSelectedIndex, messages.length - 1));
        state.chatSelectedIndex = boundedIndex;
        els.chatMessageList.selectedIndex = boundedIndex;
        renderSelectedChatMessageDetail();

        if (announceSelection) {
            announceChatMessage(describeChatMessage(messages[boundedIndex]));
        }
    }

    function renderChatPanel() {
        if (els.chatPanel) {
            els.chatPanel.hidden = !state.chatPanelExpanded;
        }
        if (els.btnToggleChatPanel) {
            els.btnToggleChatPanel.setAttribute('aria-expanded', state.chatPanelExpanded ? 'true' : 'false');
        }
        renderChatTargetSelector();
    }

    function renderHostActivityPanel() {
        if (els.hostActivityPanel) {
            els.hostActivityPanel.hidden = !state.hostActivityPanelExpanded;
        }
        if (els.btnToggleHostActivityPanel) {
            els.btnToggleHostActivityPanel.setAttribute('aria-expanded', state.hostActivityPanelExpanded ? 'true' : 'false');
        }
    }

    function renderJoinDevicePanel() {
        if (els.joinDevicePanel) {
            els.joinDevicePanel.hidden = !state.joinDevicePanelExpanded;
            els.joinDevicePanel.setAttribute('aria-hidden', state.joinDevicePanelExpanded ? 'false' : 'true');
        }
        if (els.btnToggleJoinDevicePanel) {
            els.btnToggleJoinDevicePanel.setAttribute('aria-expanded', state.joinDevicePanelExpanded ? 'true' : 'false');
        }
        updateAudioLevelLabels();
    }

    function updateMediaActionButton(button, isEnabled, buttonLabelKey, buttonFallback) {
        if (!button) {
            return;
        }
        const enabled = Boolean(isEnabled);
        const label = t(buttonLabelKey, buttonFallback);
        button.checked = enabled;
        if (button.getAttribute('data-i18n') !== buttonLabelKey) {
            button.setAttribute('data-i18n', buttonLabelKey);
        }
        if (button.textContent !== label) {
            button.textContent = label;
        }
        // Keep the accessible name stable; expose the binary media state natively.
        if (button.hasAttribute('aria-label')) {
            button.removeAttribute('aria-label');
        }
        const pressedValue = enabled ? 'true' : 'false';
        if (button.getAttribute('aria-pressed') !== pressedValue) {
            button.setAttribute('aria-pressed', pressedValue);
        }
    }

    function updateJoinMediaToggleButtons() {
        updateMediaActionButton(
            els.microphoneEnabled,
            typeof els.microphoneEnabled?.checked === 'boolean' ? els.microphoneEnabled.checked : true,
            'broadcast_room_join.microphone_toggle',
            'Mikrofon (Ctrl+D)'
        );
        updateMediaActionButton(
            els.cameraEnabled,
            typeof els.cameraEnabled?.checked === 'boolean' ? els.cameraEnabled.checked : true,
            'broadcast_room_join.camera_toggle',
            'Video (Ctrl+E)'
        );
    }

    function announceLocalMediaToggleResult(type) {
        if (!state.roomConnection) {
            return;
        }
        const isCamera = type === 'camera';
        const enabled = isCamera
            ? Boolean(els.cameraEnabled?.checked) && !!state.localVideoTrack
            : Boolean(els.microphoneEnabled?.checked) && !!state.localAudioTrack;
        const key = isCamera
            ? (enabled ? 'broadcast_room.status_camera_enabled_self' : 'broadcast_room.status_camera_disabled_self')
            : (enabled ? 'broadcast_room.status_microphone_enabled_self' : 'broadcast_room.status_microphone_disabled_self');
        const fallback = isCamera
            ? (enabled ? 'Videonuz açıldı.' : 'Videonuz kapatıldı.')
            : (enabled ? 'Sesiniz açıldı.' : 'Sesiniz kapatıldı.');
        setStatus(t(key, fallback));
    }

    function setAudioTestStatus(message) {
        if (els.audioTestStatus) {
            els.audioTestStatus.textContent = message;
        }
        setStatus(message);
    }

    function createBeepWaveBlob({ durationSeconds = 0.45, frequency = 880, volume = 0.35 } = {}) {
        const sampleRate = 44100;
        const sampleCount = Math.max(1, Math.floor(sampleRate * durationSeconds));
        const buffer = new ArrayBuffer(44 + sampleCount * 2);
        const view = new DataView(buffer);
        const writeString = (offset, value) => {
            for (let index = 0; index < value.length; index += 1) {
                view.setUint8(offset + index, value.charCodeAt(index));
            }
        };
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + sampleCount * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, sampleCount * 2, true);
        for (let index = 0; index < sampleCount; index += 1) {
            const envelope = Math.min(1, index / 600, (sampleCount - index) / 1200);
            const sample = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * volume * envelope;
            view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 32767, true);
        }
        return new Blob([buffer], { type: 'audio/wav' });
    }

    async function testSpeaker() {
        const audio = new Audio(URL.createObjectURL(createBeepWaveBlob()));
        audio.volume = getSpeakerVolume();
        await applySpeakerSelectionToElement(audio);
        audio.addEventListener('ended', () => URL.revokeObjectURL(audio.src), { once: true });
        await audio.play();
        setAudioTestStatus(t('broadcast_room_join.speaker_test_played', 'Hoparlör test sesi çalındı.'));
    }

    function stopMicrophoneTest({ announceStatus = true } = {}) {
        if (state.audioTest.microphoneStopTimer) {
            clearTimeout(state.audioTest.microphoneStopTimer);
            state.audioTest.microphoneStopTimer = null;
        }
        if (state.audioTest.microphoneAudio) {
            try { state.audioTest.microphoneAudio.pause(); } catch (_error) {}
            state.audioTest.microphoneAudio.srcObject = null;
            state.audioTest.microphoneAudio = null;
        }
        if (state.audioTest.microphoneStream) {
            state.audioTest.microphoneStream.getTracks().forEach((track) => {
                try { track.stop(); } catch (_error) {}
            });
            state.audioTest.microphoneStream = null;
        }
        if (els.btnTestMicrophone) {
            const label = t('broadcast_room_join.test_microphone_button', 'Mikrofonu test et');
            els.btnTestMicrophone.textContent = label;
            els.btnTestMicrophone.setAttribute('aria-label', label);
        }
        if (announceStatus) {
            setAudioTestStatus(t('broadcast_room_join.microphone_test_stopped', 'Mikrofon testi durduruldu.'));
        }
    }

    async function toggleMicrophoneTest() {
        if (state.audioTest.microphoneStream) {
            stopMicrophoneTest();
            return;
        }
        const deviceId = String(els.microphoneDevice?.value || '').trim();
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: buildAudioCaptureOptions(deviceId ? { exact: deviceId } : undefined)
        });
        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.srcObject = stream;
        audio.volume = getSpeakerVolume();
        await applySpeakerSelectionToElement(audio);
        state.audioTest.microphoneStream = stream;
        state.audioTest.microphoneAudio = audio;
        if (els.btnTestMicrophone) {
            const label = t('broadcast_room_join.stop_microphone_test_button', 'Mikrofon testini durdur');
            els.btnTestMicrophone.textContent = label;
            els.btnTestMicrophone.setAttribute('aria-label', label);
        }
        setAudioTestStatus(t('broadcast_room_join.microphone_test_started', 'Mikrofon testi başladı. Kendi sesinizi birkaç saniye duyacaksınız.'));
        state.audioTest.microphoneStopTimer = window.setTimeout(() => stopMicrophoneTest(), 6000);
        await audio.play().catch(() => {});
    }

    function setCameraFramingStatus(message, { forceRepeat = false } = {}) {
        if (!els.cameraFramingStatus) return;
        clearTimeout(state.cameraTest.statusRefreshTimer);
        state.cameraTest.statusRefreshTimer = null;
        const normalizedMessage = String(message || '').trim();
        if (forceRepeat && els.cameraFramingStatus.textContent === normalizedMessage) {
            els.cameraFramingStatus.textContent = '';
            state.cameraTest.statusRefreshTimer = window.setTimeout(() => {
                state.cameraTest.statusRefreshTimer = null;
                els.cameraFramingStatus.textContent = normalizedMessage;
            }, 30);
            return;
        }
        els.cameraFramingStatus.textContent = normalizedMessage;
    }

    function getCameraFramingBrightness(video) {
        if (!video?.videoWidth || !video?.videoHeight) return 128;
        if (!state.cameraTest.canvas) {
            state.cameraTest.canvas = document.createElement('canvas');
            state.cameraTest.canvas.width = 64;
            state.cameraTest.canvas.height = 36;
        }
        const context = state.cameraTest.canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return 128;
        context.drawImage(video, 0, 0, 64, 36);
        const pixels = context.getImageData(0, 0, 64, 36).data;
        let total = 0;
        for (let index = 0; index < pixels.length; index += 4) {
            total += (pixels[index] * 0.2126) + (pixels[index + 1] * 0.7152) + (pixels[index + 2] * 0.0722);
        }
        return total / Math.max(1, pixels.length / 4);
    }

    function getCameraFramingBrightnessResult(brightness) {
        if (brightness < 55) {
            return { signature: 'brightness-low', message: t('broadcast_room.camera_test_brightness_low', 'Işık düşük. Yüzünüzü aydınlatın.') };
        }
        if (brightness > 210) {
            return { signature: 'brightness-high', message: t('broadcast_room.camera_test_brightness_high', 'Işık çok yüksek. Doğrudan ışığı azaltın.') };
        }
        return { signature: 'brightness-normal', message: t('broadcast_room.camera_test_brightness_normal', 'Işık düzeyi uygun.') };
    }

    function buildCameraFramingAnalysis(result, video) {
        const brightnessResult = getCameraFramingBrightnessResult(getCameraFramingBrightness(video));
        const detections = Array.isArray(result?.detections) ? result.detections : [];
        if (!detections.length) {
            const guidance = t('broadcast_room.camera_test_no_face', 'Yüz algılanmadı. Kameraya dönün veya kameraya yaklaşın.');
            const message = t('broadcast_room.camera_test_guidance_with_brightness', '{guidance} {brightness}', {
                guidance,
                brightness: brightnessResult.message
            });
            return { signature: `no-face:${brightnessResult.signature}`, message, detailedMessage: message };
        }

        const ordered = [...detections].sort((left, right) => {
            const leftBox = left?.boundingBox || {};
            const rightBox = right?.boundingBox || {};
            return (Number(rightBox.width || 0) * Number(rightBox.height || 0))
                - (Number(leftBox.width || 0) * Number(leftBox.height || 0));
        });
        const detection = ordered[0];
        const box = detection?.boundingBox || {};
        const frameWidth = Math.max(1, Number(video.videoWidth) || 1);
        const frameHeight = Math.max(1, Number(video.videoHeight) || 1);
        const centerX = (Number(box.originX || 0) + (Number(box.width || 0) / 2)) / frameWidth;
        const centerY = (Number(box.originY || 0) + (Number(box.height || 0) / 2)) / frameHeight;
        const faceSize = Math.max(Number(box.width || 0) / frameWidth, Number(box.height || 0) / frameHeight);
        const guidanceParts = [];
        const signatureParts = [];

        if (ordered.length > 1) {
            signatureParts.push('multiple');
            guidanceParts.push(t('broadcast_room.camera_test_multiple_faces', 'Kadrajda birden fazla yüz algılandı.'));
        }
        if (centerX < 0.38) {
            signatureParts.push('move-left');
            guidanceParts.push(t('broadcast_room.camera_test_move_left', 'Biraz sola doğru hareket edin.'));
        } else if (centerX > 0.62) {
            signatureParts.push('move-right');
            guidanceParts.push(t('broadcast_room.camera_test_move_right', 'Biraz sağa doğru hareket edin.'));
        }
        if (centerY < 0.34) {
            signatureParts.push('move-down');
            guidanceParts.push(t('broadcast_room.camera_test_move_down', 'Biraz aşağı doğru hareket edin.'));
        } else if (centerY > 0.66) {
            signatureParts.push('move-up');
            guidanceParts.push(t('broadcast_room.camera_test_move_up', 'Biraz yukarı doğru hareket edin.'));
        }
        if (faceSize < 0.2) {
            signatureParts.push('closer');
            guidanceParts.push(t('broadcast_room.camera_test_move_closer', 'Kameraya biraz yaklaşın.'));
        } else if (faceSize > 0.58) {
            signatureParts.push('farther');
            guidanceParts.push(t('broadcast_room.camera_test_move_farther', 'Kameradan biraz uzaklaşın.'));
        }

        const keypoints = Array.isArray(detection?.keypoints) ? detection.keypoints : [];
        if (keypoints.length >= 3) {
            const eyeCenterX = (Number(keypoints[0]?.x || 0) + Number(keypoints[1]?.x || 0)) / 2;
            const eyeDistance = Math.abs(Number(keypoints[0]?.x || 0) - Number(keypoints[1]?.x || 0));
            const noseOffset = eyeDistance > 0.001 ? (Number(keypoints[2]?.x || 0) - eyeCenterX) / eyeDistance : 0;
            if (noseOffset > 0.18) {
                signatureParts.push('turn-right');
                guidanceParts.push(t('broadcast_room.camera_test_turn_right', 'Başınızı biraz sağa çevirin.'));
            } else if (noseOffset < -0.18) {
                signatureParts.push('turn-left');
                guidanceParts.push(t('broadcast_room.camera_test_turn_left', 'Başınızı biraz sola çevirin.'));
            }
        }

        if (!guidanceParts.length) {
            signatureParts.push('centered');
            guidanceParts.push(t('broadcast_room.camera_test_centered', 'Yüzünüz ortada ve kameraya uygun uzaklıkta.'));
        }
        const guidance = guidanceParts.join(' ');
        const message = t('broadcast_room.camera_test_guidance_with_brightness', '{guidance} {brightness}', {
            guidance,
            brightness: brightnessResult.message
        });
        return {
            signature: `${signatureParts.join(',')}:${brightnessResult.signature}`,
            message,
            detailedMessage: t('broadcast_room.camera_test_detailed_status', 'Yatay konum yüzde {horizontal}, dikey konum yüzde {vertical}, kadrajdaki yüz büyüklüğü yüzde {size}. {guidance} {brightness}', {
                horizontal: Math.round(centerX * 100),
                vertical: Math.round(centerY * 100),
                size: Math.round(faceSize * 100),
                guidance,
                brightness: brightnessResult.message
            })
        };
    }

    function waitForCameraFramingPreview() {
        if (els.cameraFramingPreview?.readyState >= 2 && els.cameraFramingPreview.videoWidth > 0) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const timeout = window.setTimeout(() => {
                cleanup();
                reject(new Error('camera_preview_timeout'));
            }, 8000);
            const cleanup = () => {
                clearTimeout(timeout);
                els.cameraFramingPreview?.removeEventListener('loadeddata', onReady);
                els.cameraFramingPreview?.removeEventListener('error', onError);
            };
            const onReady = () => {
                cleanup();
                resolve();
            };
            const onError = () => {
                cleanup();
                reject(new Error('camera_preview_failed'));
            };
            els.cameraFramingPreview?.addEventListener('loadeddata', onReady, { once: true });
            els.cameraFramingPreview?.addEventListener('error', onError, { once: true });
        });
    }

    function scheduleCameraFramingAnalysis(delay = 1000) {
        if (!state.cameraTest.active) return;
        clearTimeout(state.cameraTest.timer);
        state.cameraTest.timer = window.setTimeout(runCameraFramingAnalysis, delay);
    }

    async function runCameraFramingAnalysis() {
        if (!state.cameraTest.active || !state.cameraTest.detector || !els.cameraFramingPreview) return;
        if (document.hidden) {
            scheduleCameraFramingAnalysis(1500);
            return;
        }
        try {
            const result = state.cameraTest.detector.detectForVideo(els.cameraFramingPreview, performance.now());
            const analysis = buildCameraFramingAnalysis(result, els.cameraFramingPreview);
            state.cameraTest.lastMessage = analysis.message;
            state.cameraTest.lastDetailedMessage = analysis.detailedMessage;
            if (analysis.signature === state.cameraTest.pendingSignature) {
                state.cameraTest.pendingCount += 1;
            } else {
                state.cameraTest.pendingSignature = analysis.signature;
                state.cameraTest.pendingCount = 1;
            }
            const canAnnounce = state.cameraTest.pendingCount >= 2
                && analysis.signature !== state.cameraTest.lastAnnouncedSignature
                && Date.now() - state.cameraTest.lastAnnouncementAt >= 1500;
            if (canAnnounce) {
                state.cameraTest.lastAnnouncedSignature = analysis.signature;
                state.cameraTest.lastAnnouncementAt = Date.now();
                setCameraFramingStatus(analysis.message);
            }
        } catch (error) {
            console.warn('Camera framing analysis failed:', error);
        } finally {
            scheduleCameraFramingAnalysis();
        }
    }

    function cleanupCameraFramingTest() {
        state.cameraTest.session = null;
        state.cameraTest.active = false;
        clearTimeout(state.cameraTest.timer);
        clearTimeout(state.cameraTest.statusRefreshTimer);
        state.cameraTest.timer = null;
        state.cameraTest.statusRefreshTimer = null;
        if (state.cameraTest.detector) {
            try { state.cameraTest.detector.close(); } catch (_error) {}
            state.cameraTest.detector = null;
        }
        if (els.cameraFramingPreview) {
            try { els.cameraFramingPreview.pause(); } catch (_error) {}
            els.cameraFramingPreview.srcObject = null;
        }
        if (state.cameraTest.ownsStream && state.cameraTest.stream) {
            state.cameraTest.stream.getTracks().forEach((track) => {
                try { track.stop(); } catch (_error) {}
            });
        }
        state.cameraTest.stream = null;
        state.cameraTest.ownsStream = false;
        state.cameraTest.pendingSignature = '';
        state.cameraTest.pendingCount = 0;
    }

    function stopCameraFramingTest({ restoreFocus = true, announceStatus = true } = {}) {
        cleanupCameraFramingTest();
        if (els.cameraFramingDialog?.open) els.cameraFramingDialog.close();
        if (announceStatus) setStatus(t('broadcast_room.camera_test_stopped', 'Kamera ve kadraj testi kapatıldı.'));
        if (restoreFocus) els.btnTestCameraFraming?.focus?.();
    }

    async function startCameraFramingTest() {
        if (!els.cameraFramingDialog || !els.cameraFramingPreview) return;
        cleanupCameraFramingTest();
        const session = {};
        let previewStarted = false;
        state.cameraTest.session = session;
        if (!els.cameraFramingDialog.open) els.cameraFramingDialog.showModal();
        els.cameraFramingTitle?.focus?.();
        state.cameraTest.lastMessage = '';
        state.cameraTest.lastDetailedMessage = '';
        setCameraFramingStatus(t('broadcast_room.camera_test_starting', 'Kamera ve çevrimdışı kadraj yardımı hazırlanıyor...'));
        try {
            const nativeTrack = getNativeVideoTrackFromLocalTrack(state.localVideoTrack);
            let stream = null;
            let ownsStream = false;
            if (nativeTrack?.kind === 'video' && nativeTrack.readyState !== 'ended') {
                stream = new MediaStream([nativeTrack]);
            } else {
                const deviceId = String(els.cameraDevice?.value || '').trim();
                stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        deviceId: deviceId ? { exact: deviceId } : undefined,
                        width: { ideal: 640, max: 1280 },
                        height: { ideal: 360, max: 720 },
                        frameRate: { ideal: 12, max: 15 }
                    },
                    audio: false
                });
                ownsStream = true;
            }
            if (state.cameraTest.session !== session) {
                if (ownsStream) stream?.getTracks().forEach((track) => track.stop());
                return;
            }
            state.cameraTest.stream = stream;
            state.cameraTest.ownsStream = ownsStream;
            els.cameraFramingPreview.srcObject = state.cameraTest.stream;
            await els.cameraFramingPreview.play();
            await waitForCameraFramingPreview();
            previewStarted = true;
            if (state.cameraTest.session !== session) return;

            const visionTasks = await import(`/yayinodasi/camera-framing/vision_bundle.mjs?v=${ASSET_VERSION}`);
            const vision = await visionTasks.FilesetResolver.forVisionTasks('/yayinodasi/camera-framing');
            const detector = await visionTasks.FaceDetector.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: '/yayinodasi/camera-framing/blaze_face_short_range.tflite',
                    delegate: 'CPU'
                },
                runningMode: 'VIDEO',
                minDetectionConfidence: 0.55,
                minSuppressionThreshold: 0.3
            });
            if (state.cameraTest.session !== session) {
                try { detector.close(); } catch (_error) {}
                return;
            }
            state.cameraTest.detector = detector;
            state.cameraTest.active = true;
            state.cameraTest.lastAnnouncedSignature = '';
            state.cameraTest.lastAnnouncementAt = 0;
            setCameraFramingStatus(t('broadcast_room.camera_test_active', 'Kamera açık. Kadraj yardımı yüzünüzü inceliyor.'));
            scheduleCameraFramingAnalysis(0);
        } catch (error) {
            if (state.cameraTest.session !== session) return;
            if (!previewStarted) {
                cleanupCameraFramingTest();
            } else {
                // Face analysis is optional. Keep a working camera preview visible
                // until the user closes the test, even if the analysis model fails.
                state.cameraTest.active = true;
            }
            const statusKey = previewStarted
                ? 'broadcast_room.camera_analysis_failed_preview_continues'
                : 'broadcast_room.camera_test_failed';
            const statusFallback = previewStarted
                ? 'Kamera önizlemesi açık kalacak, ancak kadraj analizi başlatılamadı: {error}'
                : 'Kamera testi başlatılamadı: {error}';
            setCameraFramingStatus(t(statusKey, statusFallback, {
                error: formatErrorMessage(error)
            }));
        }
    }

    function readCameraFramingStatus() {
        const message = state.cameraTest.lastDetailedMessage
            || state.cameraTest.lastMessage
            || t('broadcast_room.camera_test_starting', 'Kamera ve çevrimdışı kadraj yardımı hazırlanıyor...');
        setCameraFramingStatus(message, { forceRepeat: true });
    }

    function renderMoreInfoPanel() {
        if (els.moreInfoPanel) {
            els.moreInfoPanel.hidden = !state.moreInfoPanelExpanded;
        }
        if (els.btnToggleMoreInfoPanel) {
            els.btnToggleMoreInfoPanel.setAttribute('aria-expanded', state.moreInfoPanelExpanded ? 'true' : 'false');
        }
        if (state.moreInfoPanelExpanded) {
            syncLocalCameraPreview();
        }
    }

    function updateHandRaiseStatusVisibility() {
        if (!els.handRaiseStatusGroup) {
            return;
        }
        const connectedParticipants = (Array.isArray(state.participants) ? state.participants : [])
            .filter((participant) => participant && participant.connected !== false);
        const microphoneActive = Boolean(els.microphoneEnabled?.checked) && !!state.localAudioTrack;
        const shouldShow = Boolean(state.handRaiseActive)
            || Number(state.lastHandRaiseSeenAt || 0) > 0
            || (!microphoneActive && connectedParticipants.length > 2);
        els.handRaiseStatusGroup.hidden = !shouldShow;
        els.handRaiseStatusGroup.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    }

    function renderParticipantsPanel() {
        if (els.participantsPanel) {
            els.participantsPanel.hidden = !state.participantsPanelExpanded;
        }
        if (els.btnToggleParticipantsPanel) {
            els.btnToggleParticipantsPanel.setAttribute('aria-expanded', state.participantsPanelExpanded ? 'true' : 'false');
        }
    }

    function renderSelectedChatMessageDetail() {
        if (!els.chatSelectedDetail) {
            return;
        }
        const messages = getVisibleChatMessages();
        const message = state.chatSelectedIndex >= 0 ? messages[state.chatSelectedIndex] : null;
        if (!message) {
            els.chatSelectedDetail.innerHTML = escapeHtml(t('broadcast_room_join.chat_selected_detail_empty', 'Seçili mesaj yok.'));
            return;
        }
        const label = describeChatMessage(message);
        const text = String(message?.text || '').trim() || t('broadcast_room_join.chat_empty_message', 'Boş mesaj');
        els.chatSelectedDetail.innerHTML = `
            <p>${escapeHtml(label)}</p>
            <p>${renderTextWithClickableLinks(text)}</p>
        `;
    }

    function updateHandRaiseButtonUi() {
        if (!els.btnHandRaise) {
            return;
        }
        const microphoneActive = Boolean(els.microphoneEnabled?.checked) && !!state.localAudioTrack;
        els.btnHandRaise.hidden = microphoneActive;
        const key = state.handRaiseActive
            ? 'broadcast_room_join.hand_raise_cancel'
            : 'broadcast_room_join.hand_raise_request';
        const fallback = state.handRaiseActive ? 'Söz İstemeyi Geri Al' : 'Söz İste';
        const label = t(key, fallback);
        els.btnHandRaise.textContent = label;
        setShortcutAccessibleLabel(els.btnHandRaise, label);
        updateHandRaiseStatusVisibility();
    }

    function updateHandRaiseStateFromParticipants({ announce = true } = {}) {
        const ownParticipant = getOwnParticipant();
        if (!ownParticipant) {
            setHandRaiseStatus(t('broadcast_room_join.hand_raise_waiting', 'Söz isteği için önce odaya katılın.'));
            updateHandRaiseStatusVisibility();
            return;
        }

        const nextActive = ownParticipant.handRaiseActive === true;
        const nextSeenAt = Number(ownParticipant.handRaiseSeenAt || 0);
        const wasActive = state.handRaiseActive;
        const previousSeenAt = state.lastHandRaiseSeenAt;
        state.handRaiseActive = nextActive;
        state.lastHandRaiseSeenAt = nextSeenAt;
        updateHandRaiseButtonUi();

        if (nextActive) {
            if (nextSeenAt > 0) {
                setHandRaiseStatus(t('broadcast_room_join.hand_raise_seen', 'Söz isteğiniz yönetici tarafından görüldü.'));
                if (announce && nextSeenAt !== previousSeenAt) {
                    announceMessage(t('broadcast_room_join.hand_raise_seen', 'Söz isteğiniz yönetici tarafından görüldü.'));
                }
            } else {
                setHandRaiseStatus(t('broadcast_room_join.hand_raise_sent', 'Söz isteğiniz gönderildi.'));
            }
            updateHandRaiseStatusVisibility();
            return;
        }

        setHandRaiseStatus(t('broadcast_room_join.hand_raise_idle', 'Şu anda aktif bir söz isteğiniz yok.'));
        updateHandRaiseStatusVisibility();
        if (announce && wasActive && !nextActive) {
            announceMessage(t('broadcast_room_join.hand_raise_cancelled', 'Söz isteğiniz geri alındı.'));
        }
    }

    function announceNewChatMessages() {
        if (!state.chatAutoAnnounce) {
            return;
        }
        const messages = getVisibleChatMessages();
        if (!messages.length) {
            return;
        }
        const latestMessage = messages[messages.length - 1];
        const latestId = String(latestMessage?.id || '').trim();
        if (!latestId || latestId === state.lastAnnouncedChatId) {
            return;
        }
        state.lastAnnouncedChatId = latestId;
        announceChatMessage(describeChatMessage(latestMessage));
    }

    function renderParticipantList() {
        renderRoomSummary();
        updateAudioChannelVisibility();
        updateHandRaiseStatusVisibility();
        if (!els.participantList) {
            return;
        }
        const signature = JSON.stringify((Array.isArray(state.participants) ? state.participants : []).map((participant) => ({
            identity: String(participant.identity || '').trim(),
            displayName: String(participant.displayName || '').trim(),
            role: String(participant.role || '').trim(),
            cameraEnabled: participant.cameraEnabled !== false,
            microphoneEnabled: participant.microphoneEnabled !== false,
            shareEnabled: participant.shareEnabled === true
        })));
        if (signature === state.participantListRenderSignature) {
            return;
        }
        state.participantListRenderSignature = signature;
        if (!Array.isArray(state.participants) || state.participants.length === 0) {
            els.participantList.innerHTML = `<p>${t('broadcast_room_join.no_participants', 'Henüz katılımcı görünmüyor.')}</p>`;
            return;
        }
        els.participantList.innerHTML = `<ul>${state.participants.map((participant) => (
            `<li>${participant.displayName || participant.identity} - ${participant.role || 'guest'}. ${t('broadcast_room_join.participant_list_item', 'Kamera: {camera}. Mikrofon: {microphone}. Paylaşım: {share}.', {
                camera: participant.cameraEnabled !== false ? t('broadcast_room_join.status_on', 'açık') : t('broadcast_room_join.status_off', 'kapalı'),
                microphone: participant.microphoneEnabled !== false ? t('broadcast_room_join.status_on', 'açık') : t('broadcast_room_join.status_off', 'kapalı'),
                share: participant.shareEnabled === true ? t('broadcast_room_join.status_on', 'açık') : t('broadcast_room_join.status_off', 'kapalı')
            })}</li>`
        )).join('')}</ul>`;
    }

    function renderRoomSummary() {
        const participants = (Array.isArray(state.participants) ? state.participants : [])
            .filter((participant) => participant && participant.connected !== false);
        const total = participants.length;
        setRoomSummaryStatus(t('broadcast_room_join.room_summary_text', 'Odada {total} kişi var.', {
            total
        }));
    }

    function isScreenShareActive() {
        return !!state.screenShareVideoTrack || !!state.screenShareAudioTrack;
    }

    function updateScreenShareControls() {
        const connected = Boolean(state.roomConnection);
        const allowed = state.canPublishMedia !== false && state.allowGuestScreenShare !== false && state.ownAllowScreenShare !== false;
        const active = isScreenShareActive();
        const labelKey = active ? 'broadcast_room_join.screen_share_stop' : 'broadcast_room_join.screen_share_start';
        const labelFallback = active ? 'Paylaşımı Durdur (Ctrl+Shift+E)' : 'Paylaşımı Başlat (Ctrl+Shift+E)';
        const label = t(labelKey, labelFallback);

        if (els.btnStartScreenShare) {
            els.btnStartScreenShare.textContent = label;
            els.btnStartScreenShare.disabled = !connected || (!allowed && !active) || joinInProgress;
            els.btnStartScreenShare.setAttribute('aria-label', label);
            els.btnStartScreenShare.setAttribute('title', label);
        }
        if (els.btnStopScreenShare) {
            els.btnStopScreenShare.hidden = true;
            els.btnStopScreenShare.disabled = true;
        }
        if (!connected) {
            setScreenShareStatus(t('broadcast_room_join.screen_share_waiting_connection', 'Ekran paylaşımı için önce odaya katılın.'));
            return;
        }
        if (state.canPublishMedia === false) {
            setScreenShareStatus(t('broadcast_room_join.webinar_audience_media_disabled', 'Webinar izleyicisi olarak katıldınız. Kamera, mikrofon ve ekran paylaşımı host onayıyla açılır.'));
            return;
        }
        if (!allowed) {
            setScreenShareStatus(t('broadcast_room_join.screen_share_not_allowed', 'Host şu anda konuk ekran paylaşımına izin vermiyor.'));
            return;
        }
        if (active) {
            setScreenShareStatus(t('broadcast_room_join.screen_share_active', 'Ekran paylaşımı şu anda açık.'));
            return;
        }
        setScreenShareStatus(t('broadcast_room_join.screen_share_ready', 'Ekran paylaşımı başlatılmaya hazır.'));
    }

    function updateMediaPermissionControls() {
        if (els.cameraEnabled) {
            els.cameraEnabled.disabled = state.canPublishMedia === false || state.allowGuestCamera === false || state.ownAllowCamera === false;
        }
        if (els.microphoneEnabled) {
            els.microphoneEnabled.disabled = state.canPublishMedia === false || state.allowGuestMicrophone === false || state.ownAllowMicrophone === false;
        }
    }

    function wait(ms) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    function getCurrentConnectionQualityPayload() {
        return state.lastQualityReport
            ? {
                ...state.lastQualityReport,
                lowBandwidthMode: state.lowBandwidthMode === true
            }
            : {
                lowBandwidthMode: state.lowBandwidthMode === true,
                updatedAt: Date.now()
            };
    }

    async function postParticipantState(payload = {}) {
        if (!state.roomConnection || !state.room?.roomId || !state.participantIdentity) {
            return;
        }

        try {
            await fetch('/api/broadcast-room/participant-state', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(buildParticipantStatePayload(payload))
            });
        } catch (_error) {
            // Best-effort state sync only.
        }
    }

    function buildParticipantStatePayload(payload = {}) {
        const displayName = String(
            els.joinedDisplayName?.value
            || getOwnParticipant()?.displayName
            || els.displayName?.value
            || ''
        ).trim();
        return {
            roomId: state.room.roomId,
            identity: state.participantIdentity,
            displayName,
            role: state.participantRole || 'guest',
            preferredLanguage: String(state.liveCaptionPreferredLanguage || 'tr'),
            ...payload
        };
    }

    async function updateOwnDisplayName() {
        if (!state.room?.roomId || !state.participantIdentity) {
            return;
        }
        const nextName = String(els.joinedDisplayName?.value || '').trim();
        if (!nextName) {
            setStatus(t('broadcast_room_join.display_name_required', 'Lütfen görünen adınızı yazın.'));
            els.joinedDisplayName?.focus?.();
            return;
        }
        const response = await fetch('/api/broadcast-room/participant-state', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(buildParticipantStatePayload({
                displayName: nextName,
                displayNameChange: true,
                connected: true
            }))
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) {
            throw new Error(payload.error || 'unknown_error');
        }
        if (els.displayName) {
            els.displayName.value = nextName;
        }
        if (els.joinedDisplayName) {
            els.joinedDisplayName.value = nextName;
        }
        state.participants = Array.isArray(payload.participants) ? payload.participants : state.participants;
        syncParticipantPresenceAnnouncements(state.participants, { announce: false });
        state.chatMessages = Array.isArray(payload.chatMessages) ? payload.chatMessages : state.chatMessages;
        renderParticipantList();
        renderChatTargetSelector();
        setStatus(t('broadcast_room_join.display_name_updated', 'Görünen adınız güncellendi: {name}', {
            name: nextName
        }));
    }

    function syncPreferredLanguageParticipantState({ force = false } = {}) {
        if (!state.room?.roomId || !state.participantIdentity) {
            return;
        }
        const signature = [
            state.room.roomId,
            state.participantIdentity,
            state.liveCaptionPreferredLanguage || 'tr',
            state.liveCaptionViewEnabled ? '1' : '0'
        ].join('|');
        if (!force && signature === state.lastPreferredLanguageStateSignature) {
            return;
        }
        state.lastPreferredLanguageStateSignature = signature;
        postParticipantState({
            preferredLanguage: state.liveCaptionPreferredLanguage || 'tr'
        });
    }

    function sendLeaveBeacon() {
        closeRoomEventSource();
        if (!state.room?.roomId || !state.participantIdentity || state.leaveBeaconSent) {
            return;
        }
        state.leaveBeaconSent = true;
        const body = JSON.stringify({
            roomId: state.room.roomId,
            identity: state.participantIdentity
        });
        if (navigator.sendBeacon) {
            const blob = new Blob([body], { type: 'application/json' });
            navigator.sendBeacon('/api/broadcast-room/leave', blob);
            return;
        }
        fetch('/api/broadcast-room/leave', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body,
            keepalive: true
        }).catch(() => {});
    }

    async function notifyLeave() {
        if (!state.room?.roomId || !state.participantIdentity) {
            return;
        }
        if (state.leaveBeaconSent) {
            return;
        }

        state.leaveBeaconSent = true;
        try {
            await fetch('/api/broadcast-room/leave', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    roomId: state.room.roomId,
                    identity: state.participantIdentity
                })
            });
        } catch (_error) {
            // Best-effort leave notification only.
        }
    }

    async function sendParticipantHeartbeat({ force = false } = {}) {
        if (!state.room?.roomId || !state.participantIdentity) {
            return;
        }
        const now = Date.now();
        if (!force && now - Number(state.lastParticipantHeartbeatAt || 0) < 10000) {
            return;
        }
        state.lastParticipantHeartbeatAt = now;
        await postParticipantState({
            cameraEnabled: Boolean(els.cameraEnabled?.checked) && !!state.localVideoTrack,
            microphoneEnabled: Boolean(els.microphoneEnabled?.checked) && !!state.localAudioTrack,
            shareEnabled: isScreenShareActive(),
            shareAudioEnabled: !!state.screenShareAudioTrack,
            shareSourceType: state.screenShareSourceType,
            shareStereoRequested: !!state.screenShareAudioTrack,
            connected: true,
            connectionQuality: getCurrentConnectionQualityPayload()
        });
    }

    async function postChatMessage(audience = '') {
        const text = String(els.chatCompose?.value || '').trim();
        if (!text) {
            setStatus(t('broadcast_room_join.chat_empty_composer', 'Gönderilecek mesaj boş olamaz.'));
            return;
        }
        if (!state.room?.roomId || !state.participantIdentity) {
            setStatus(t('broadcast_room_join.chat_send_requires_join', 'Mesaj göndermek için önce odaya katılın.'));
            return;
        }

        const selectedTarget = audience ? { audience, recipientIdentity: '', recipientName: '' } : getSelectedChatTarget();
        const response = await fetch('/api/broadcast-room/chat-message', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                roomId: state.room.roomId,
                senderIdentity: state.participantIdentity,
                senderName: String(els.displayName?.value || '').trim() || state.participantIdentity,
                senderRole: 'guest',
                audience: selectedTarget.audience,
                recipientIdentity: selectedTarget.recipientIdentity,
                recipientName: selectedTarget.recipientName,
                text
            })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
            throw new Error(payload?.error || 'chat_send_failed');
        }

        state.chatMessages = Array.isArray(payload.chatMessages) ? payload.chatMessages : state.chatMessages;
        renderChatMessageList();
        els.chatCompose.value = '';
        setStatus(selectedTarget.audience === 'host'
            ? t('broadcast_room_join.chat_sent_host', 'Mesajınız yöneticiye gönderildi.')
            : (selectedTarget.audience === 'participant'
                ? t('broadcast_room_join.chat_sent_participant', '{name} için özel mesaj gönderildi.', {
                    name: selectedTarget.recipientName || t('broadcast_room_join.host_fallback', 'Host')
                })
                : t('broadcast_room_join.chat_sent_all', 'Mesajınız herkese gönderildi.')));
    }

    async function setHandRaiseActive(nextActive) {
        if (!state.room?.roomId || !state.participantIdentity) {
            setStatus(t('broadcast_room_join.hand_raise_requires_join', 'Söz istemek için önce odaya katılın.'));
            return;
        }

        const response = await fetch('/api/broadcast-room/hand-raise', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                roomId: state.room.roomId,
                identity: state.participantIdentity,
                handRaiseActive: nextActive
            })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
            throw new Error(payload?.error || 'hand_raise_failed');
        }

        state.participants = Array.isArray(payload.participants) ? payload.participants : state.participants;
        updateHandRaiseStateFromParticipants({ announce: false });
        renderParticipantList();
        setStatus(nextActive
            ? t('broadcast_room_join.hand_raise_sent', 'Söz isteğiniz gönderildi.')
            : t('broadcast_room_join.hand_raise_cancelled', 'Söz isteğiniz geri alındı.'));
    }

    function translateDom() {
        document.querySelectorAll('[data-i18n]').forEach((el) => {
            const key = el.getAttribute('data-i18n');
            const value = t(key, '');
            if (value) {
                el.textContent = value;
            }
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
            const key = el.getAttribute('data-i18n-placeholder');
            const value = t(key, '');
            if (value) {
                el.setAttribute('placeholder', value);
            }
        });
        document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
            const key = el.getAttribute('data-i18n-aria');
            const value = t(key, '');
            if (value) {
                el.setAttribute('aria-label', value);
            }
        });
        const titleEl = document.querySelector('title[data-i18n]');
        if (titleEl) {
            const value = t(titleEl.getAttribute('data-i18n'), '');
            if (value) {
                document.title = value;
            }
        }
    }

    function getInviteIdFromPath() {
        const parts = window.location.pathname.split('/').filter(Boolean);
        return decodeURIComponent(parts[parts.length - 1] || '');
    }

    async function loadLocale() {
        const response = await fetch(`/api/i18n/${encodeURIComponent(state.lang)}?v=${encodeURIComponent(ASSET_VERSION)}`);
        if (!response.ok) {
            throw new Error('locale_load_failed');
        }
        state.locale = await response.json();
        translateDom();
    }

    async function loadInviteInfo() {
        setStatus(t('broadcast_room_join.invite_status_loading', 'Davet bilgisi yükleniyor...'));
        const response = await fetch(`/api/broadcast-room/invite/${encodeURIComponent(state.inviteId)}`);
        if (!response.ok) {
            setStatus(t('broadcast_room_join.invite_status_invalid', 'Davet bağlantısı geçersiz veya oda kapalı.'));
            throw new Error('invite_not_found');
        }
        const payload = await response.json();
        state.room = payload;
        state.hostConnected = payload.hostConnected !== false;
        state.allowJoinWhenHostAbsent = payload.joinPolicy?.allowJoinWhenHostAbsent === true;
        state.passwordConfigured = payload.joinPolicy?.passwordConfigured === true;
        state.requirePasswordNow = payload.joinPolicy?.requirePasswordNow === true;
        setRoomInfo({
            title: getLocalizedDefaultRoomTitle(payload.title),
            host: payload.hostDisplayName || t('broadcast_room_join.host_fallback', 'Host')
        });
        updateRoomPasswordVisibility();
        setScenePositionStatus(t('broadcast_room_join.scene_position_waiting', 'Yayın konumu bilgisi bekleniyor.'));
        setHostActivityStatus(t('broadcast_room_join.host_activity_idle', 'Host şu anda kayıt veya yerel paylaşım başlatmadı.'));
        await applyRoomSettingsFromPayload(payload, { announce: false });
        state.participants = Array.isArray(payload.participants) ? payload.participants : [];
        state.chatMessages = Array.isArray(payload.chatMessages) ? payload.chatMessages : [];
        renderParticipantList();
        renderChatTargetSelector();
        renderChatMessageList();
        updateAccessibleShareFromPayload(payload, { announce: false });
        updateLiveCaptionFromPayload(payload, { announce: false });
        connectRoomEventSource();
        const visibleMessages = getVisibleChatMessages();
        state.lastAnnouncedChatId = String(visibleMessages[visibleMessages.length - 1]?.id || '').trim();
        updateScenePositionFromPayload(payload, { announce: false });
        updateHostActivityFromPayload(payload, { announce: false });
        updateHandRaiseStateFromParticipants({ announce: false });
    }

    function describeScenePosition(slots = []) {
        if (!Array.isArray(slots) || slots.length === 0) {
            return t('broadcast_room_join.scene_position_not_visible', 'Şu anda yayında görünmüyorsunuz.');
        }
        if (slots.length === 1) {
            return t('broadcast_room_join.scene_position_single', 'Şu anda yayında {slot} alanındasınız.', {
                slot: getLocalizedSceneSlotLabel(slots[0])
            });
        }
        return t('broadcast_room_join.scene_position_multiple', 'Şu anda yayında şu alanlardasınız: {slots}.', {
            slots: slots.map((slot) => getLocalizedSceneSlotLabel(slot)).join(', ')
        });
    }

    function describeHostActivity(settings = {}) {
        const parts = [];
        if (settings.hostRecordingActive === true) {
            parts.push(t('broadcast_room_join.host_activity_recording', 'Host şu anda kayıt alıyor.'));
        }
        if (settings.hostShareActive === true) {
            parts.push(t('broadcast_room_join.host_activity_sharing', 'Host şu anda paylaşım yapıyor: {name}', {
                name: String(settings.hostShareLabel || '').trim() || t('broadcast_room_join.host_activity_share_unknown', 'yerel paylaşım')
            }));
        }
        if (!parts.length) {
            return t('broadcast_room_join.host_activity_idle', 'Host şu anda kayıt veya yerel paylaşım başlatmadı.');
        }
        return parts.join(' ');
    }

    function getHostActivityDisplayName(payload = {}) {
        return String(
            payload?.settings?.hostDisplayName
            || payload?.hostDisplayName
            || state.room?.hostDisplayName
            || ''
        ).trim() || t('broadcast_room_join.host_fallback', 'Host');
    }

    function buildHostActivityAnnouncement(payload = {}, previousState = {}, nextState = {}) {
        const name = getHostActivityDisplayName(payload);
        const recordingStarted = previousState.recording !== true && nextState.recording === true;
        const sharingStarted = previousState.sharing !== true && nextState.sharing === true;
        const recordingStopped = previousState.recording === true && nextState.recording !== true;
        const sharingStopped = previousState.sharing === true && nextState.sharing !== true;

        if (recordingStarted && sharingStarted) {
            return t('broadcast_room_join.host_activity_recording_and_share_started_by', '{name} kayıt ve paylaşım başlattı.', { name });
        }
        if (sharingStarted) {
            return t('broadcast_room_join.host_activity_share_started_by', '{name} paylaşım başlattı.', { name });
        }
        if (recordingStarted) {
            return t('broadcast_room_join.host_activity_recording_started_by', '{name} kayıt başlattı.', { name });
        }
        if (recordingStopped && sharingStopped) {
            return t('broadcast_room_join.host_activity_recording_and_share_stopped_by', '{name} kaydı ve paylaşımı durdurdu.', { name });
        }
        if (sharingStopped) {
            return t('broadcast_room_join.host_activity_share_stopped_by', '{name} paylaşımı durdurdu.', { name });
        }
        if (recordingStopped) {
            return t('broadcast_room_join.host_activity_recording_stopped_by', '{name} kaydı durdurdu.', { name });
        }
        return '';
    }

    function updateHostActivityFromPayload(payload = {}, { announce = true } = {}) {
        const settings = payload?.settings || {};
        const nextMessage = describeHostActivity(settings);
        setHostActivityStatus(nextMessage);

        const nextState = {
            recording: settings.hostRecordingActive === true,
            sharing: settings.hostShareActive === true,
            label: String(settings.hostShareLabel || '')
        };
        const nextKey = JSON.stringify(nextState);

        if (announce && state.lastHostActivityKey && state.lastHostActivityKey !== nextKey) {
            let previousState = {};
            try {
                previousState = JSON.parse(state.lastHostActivityKey) || {};
            } catch (_error) {
                previousState = {};
            }
            const announcement = buildHostActivityAnnouncement(payload, previousState, nextState);
            if (announcement) {
                announceMessage(announcement);
            }
        }
        state.lastHostActivityKey = nextKey;
    }

    function updateScenePositionFromPayload(payload = {}, { announce = true } = {}) {
        const sceneState = payload?.sceneState || {};
        const slots = Array.isArray(sceneState.slots) ? sceneState.slots : [];
        const ownSlots = slots.filter((slot) => String(slot?.participantIdentity || '').trim() === String(state.participantIdentity || '').trim());
        const nextMessage = describeScenePosition(ownSlots);
        setScenePositionStatus(nextMessage);

        const nextKey = JSON.stringify({
            presetId: sceneState.presetId || '',
            ownSlots: ownSlots.map((slot) => ({
                slotId: slot.slotId || '',
                slotLabel: slot.slotLabel || '',
                sourceLabel: slot.sourceLabel || ''
            }))
        });

        if (announce && state.lastSceneAnnouncementKey && state.lastSceneAnnouncementKey !== nextKey) {
            announceMessage(nextMessage);
        }
        state.lastSceneAnnouncementKey = nextKey;
    }

    function announceRemoteShareChanges(payload = {}) {
        const participants = Array.isArray(payload?.participants) ? payload.participants : [];
        const activeShares = participants
            .filter((participant) => String(participant.identity || '').trim() !== String(state.participantIdentity || '').trim())
            .filter((participant) => participant.shareEnabled === true)
            .map((participant) => ({
                id: String(participant.identity || '').trim(),
                name: String(participant.displayName || participant.identity || '').trim() || t('broadcast_room_join.host_fallback', 'Host')
            }));
        const nextKey = activeShares.map((item) => item.id).sort().join('|');
        if (!state.lastRemoteShareAnnouncementKey) {
            state.lastRemoteShareAnnouncementKey = nextKey;
            return;
        }
        if (state.lastRemoteShareAnnouncementKey === nextKey) {
            return;
        }
        const previousIds = new Set(String(state.lastRemoteShareAnnouncementKey || '').split('|').filter(Boolean));
        const nextIds = new Set(nextKey.split('|').filter(Boolean));
        const started = activeShares.find((item) => !previousIds.has(item.id)) || null;
        if (started) {
            announceMessage(t('broadcast_room_join.remote_share_started', '{name} ekran paylaşımı başlattı.', {
                name: started.name
            }));
        } else if (previousIds.size > nextIds.size) {
            announceMessage(t('broadcast_room_join.remote_share_stopped', 'Karşı taraf ekran paylaşımını durdurdu.'));
        }
        state.lastRemoteShareAnnouncementKey = nextKey;
    }

    function getAccessibleShareAnnouncementText(label, text) {
        const normalizedLabel = String(label || '').trim();
        const normalizedText = String(text || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .join('\n');
        if (normalizedLabel && normalizedText) {
            return `${normalizedLabel}: ${normalizedText}`;
        }
        return normalizedLabel || normalizedText;
    }

    function updateAccessibleShareFromPayload(payload = {}, { announce = true } = {}) {
        const share = payload?.accessibleShare || {};
        const items = Array.isArray(share.items) ? share.items : [];
        const currentIndex = Math.max(0, Math.min(Number(share.currentIndex || 0) || 0, Math.max(0, items.length - 1)));
        const currentItem = share.active === true ? items[currentIndex] : null;
        const title = String(share.title || share.fileName || '').trim();
        const label = String(currentItem?.label || '').trim();
        const text = String(currentItem?.text || '').trim();
        const displayText = text
            ? [
                title ? t('broadcast_room_join.accessible_share_document_title', 'Belge: {title}', { title }) : '',
                label ? t('broadcast_room_join.accessible_share_item_title', 'Bölüm: {label}', { label }) : '',
                text
            ].filter(Boolean).join('\n\n')
            : '';

        if (els.accessibleShareText) {
            els.accessibleShareText.value = displayText;
        }
        if (els.focusedAccessibleShareText) {
            els.focusedAccessibleShareText.value = displayText;
        }
        if (els.btnToggleFocusedAccessibleShare) {
            els.btnToggleFocusedAccessibleShare.hidden = !displayText;
            els.btnToggleFocusedAccessibleShare.disabled = !displayText;
            if (!displayText) {
                els.btnToggleFocusedAccessibleShare.setAttribute('aria-expanded', 'false');
                setFocusedAccessibleShareVisibility(false);
            }
        }
        if (els.accessibleShareGroup) {
            els.accessibleShareGroup.hidden = !displayText;
            els.accessibleShareGroup.setAttribute('aria-hidden', displayText ? 'false' : 'true');
        }
        const statusText = displayText
            ? t('broadcast_room_join.accessible_share_available', 'Erişilebilir paylaşım metni güncellendi: {name}', {
                name: label || title || t('broadcast_room_join.accessible_share_fallback_name', 'paylaşılan içerik')
            })
            : '';
        if (els.accessibleShareStatus) {
            els.accessibleShareStatus.textContent = statusText;
        }
        if (els.focusedAccessibleShareStatus) {
            els.focusedAccessibleShareStatus.textContent = statusText;
        }
        if (els.accessibleShareAutoAnnounceGroup) {
            const shouldShowAccessibleShareToggle = !!displayText;
            els.accessibleShareAutoAnnounceGroup.hidden = !shouldShowAccessibleShareToggle;
            els.accessibleShareAutoAnnounceGroup.setAttribute('aria-hidden', shouldShowAccessibleShareToggle ? 'false' : 'true');
        }
        if (els.focusedAccessibleShareAutoAnnounceGroup) {
            const shouldShowFocusedToggle = !!displayText;
            els.focusedAccessibleShareAutoAnnounceGroup.hidden = !shouldShowFocusedToggle;
            els.focusedAccessibleShareAutoAnnounceGroup.setAttribute('aria-hidden', shouldShowFocusedToggle ? 'false' : 'true');
        }
        if (els.focusedAccessibleShareAutoAnnounce) {
            els.focusedAccessibleShareAutoAnnounce.checked = state.accessibleShareAutoAnnounce === true;
        }

        const nextKey = JSON.stringify({
            active: share.active === true,
            updatedAt: Number(share.updatedAt || 0) || 0,
            currentIndex,
            title,
            label
        });
        if (announce && displayText && state.accessibleShareAutoAnnounce && state.lastAccessibleShareKey && state.lastAccessibleShareKey !== nextKey) {
            const announcementText = getAccessibleShareAnnouncementText(label, text);
            if (announcementText) {
                announceMessage(announcementText);
            }
        }
        state.lastAccessibleShareKey = nextKey;
    }

    function isTranslatedCaptionMode(mode = state.liveCaption.mode) {
        return ['translated_captions', 'voice_translation'].includes(String(mode || '').trim());
    }

    function isVoiceTranslationMode(mode = state.liveCaption.mode) {
        return String(mode || '').trim() === 'voice_translation';
    }

    function isPersonalTranslationScope() {
        return String(state.liveCaption?.scope || '').trim() === 'personal';
    }

    function isLiveCaptionAvailable() {
        return state.liveCaption?.enabled === true
            && ['captions_only', 'translated_captions', 'voice_translation'].includes(String(state.liveCaption?.mode || '').trim());
    }

    function shouldShowAudioChannelControl() {
        return hasLiveInterpreter() || (state.liveCaption?.enabled === true && isVoiceTranslationMode());
    }

    function updateAudioChannelVisibility() {
        const shouldShow = shouldShowAudioChannelControl();
        if (els.audioChannelGroup) {
            els.audioChannelGroup.hidden = !shouldShow;
            els.audioChannelGroup.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
        }
        if (els.audioChannelSelect) {
            els.audioChannelSelect.disabled = !shouldShow;
            if (!shouldShow && state.audioChannel !== 'original') {
                state.audioChannel = 'original';
                els.audioChannelSelect.value = 'original';
                renderRemoteParticipants().catch(() => {});
            }
        }
    }

    function getLiveCaptionModeLabel(mode = state.liveCaption.mode) {
        if (isVoiceTranslationMode(mode)) {
            return t('broadcast_room_join.live_caption_mode_voice_translation', 'Sesli çeviri');
        }
        return isTranslatedCaptionMode(mode)
            ? t('broadcast_room_join.live_caption_mode_translation', 'Yazılı çeviri')
            : t('broadcast_room_join.live_caption_mode_caption', 'Otomatik altyazı');
    }

    function getNormalizedLanguageCode(value) {
        return String(value || '').trim().toLowerCase().split(/[-_]/)[0];
    }

    function getPersonalLiveCaptionText() {
        const originalText = String(state.liveCaption?.originalText || state.liveCaption?.text || '').trim();
        if (!isTranslatedCaptionMode()) {
            return originalText || String(state.liveCaption?.text || '').trim();
        }

        const preferredLanguage = getNormalizedLanguageCode(state.liveCaptionPreferredLanguage);
        const sourceLanguage = getNormalizedLanguageCode(state.liveCaption?.sourceLanguage);
        const targetLanguage = getNormalizedLanguageCode(state.liveCaption?.targetLanguage);
        const alternateLanguage = getNormalizedLanguageCode(state.liveCaption?.alternateLanguage);
        const translatedText = String(state.liveCaption?.translatedText || state.liveCaption?.text || '').trim();
        const alternateText = String(state.liveCaption?.alternateText || '').trim();
        if (preferredLanguage && targetLanguage && preferredLanguage === targetLanguage && translatedText) {
            return translatedText;
        }
        if (preferredLanguage && alternateLanguage && preferredLanguage === alternateLanguage && alternateText) {
            return alternateText;
        }
        if (preferredLanguage && sourceLanguage && preferredLanguage === sourceLanguage && originalText) {
            return originalText;
        }
        if (preferredLanguage && targetLanguage && preferredLanguage !== targetLanguage && sourceLanguage === 'auto' && originalText) {
            return originalText;
        }
        return translatedText || originalText || String(state.liveCaption?.text || '').trim();
    }

    function getLiveCaptionDisplayText() {
        const text = getPersonalLiveCaptionText();
        if (!isLiveCaptionAvailable()) {
            return t('broadcast_room_join.live_caption_unavailable', 'Host bu oturumda canlı altyazı veya yazılı çeviriyi etkinleştirmedi.');
        }
        if (!state.liveCaptionViewEnabled) {
            return t('broadcast_room_join.live_caption_view_disabled', 'Bu oturum için altyazı/çeviri görüntüleme kapalı.');
        }
        return text || t('broadcast_room_join.live_caption_waiting', 'Canlı altyazı/çeviri bekleniyor.');
    }

    function renderLiveCaptionPanel() {
        const available = isLiveCaptionAvailable();
        const modeLabel = getLiveCaptionModeLabel();
        if (els.btnToggleLiveCaptionPanel) {
            els.btnToggleLiveCaptionPanel.disabled = !available;
            els.btnToggleLiveCaptionPanel.setAttribute('aria-expanded', state.liveCaptionPanelExpanded && available ? 'true' : 'false');
            els.btnToggleLiveCaptionPanel.textContent = available
                ? t('broadcast_room_join.live_caption_panel_button_with_mode', 'Altyazı/çeviri paneli: {mode}', { mode: modeLabel })
                : t('broadcast_room_join.live_caption_panel_button', 'Altyazı/çeviri paneli');
        }
        if (!available) {
            state.liveCaptionPanelExpanded = false;
            state.liveCaptionViewEnabled = false;
            state.liveCaptionAutoAnnounce = false;
            state.lastLiveCaptionAnnouncementKey = '';
        }
        if (els.liveCaptionPanel) {
            els.liveCaptionPanel.hidden = !available || !state.liveCaptionPanelExpanded;
        }
        if (els.liveCaptionPanelStatus) {
            els.liveCaptionPanelStatus.textContent = available
                ? t('broadcast_room_join.live_caption_available', 'Host bu oturumda {mode} akışını etkinleştirdi.', { mode: modeLabel })
                : t('broadcast_room_join.live_caption_unavailable', 'Host bu oturumda canlı altyazı veya yazılı çeviriyi etkinleştirmedi.');
        }
        if (els.btnToggleLiveCaptionView) {
            els.btnToggleLiveCaptionView.disabled = !available;
            const key = state.liveCaptionViewEnabled
                ? 'broadcast_room_join.live_caption_session_disable'
                : 'broadcast_room_join.live_caption_session_enable';
            const fallback = state.liveCaptionViewEnabled
                ? 'Bu oturumda çeviri/altyazıyı kapat'
                : 'Bu oturumda çeviri/altyazıyı etkinleştir';
            els.btnToggleLiveCaptionView.textContent = t(key, fallback);
        }
        if (els.liveCaptionAutoAnnounce) {
            els.liveCaptionAutoAnnounce.disabled = !available || !state.liveCaptionViewEnabled;
            els.liveCaptionAutoAnnounce.checked = state.liveCaptionAutoAnnounce === true;
        }
        if (els.liveCaptionPreferredLanguage) {
            els.liveCaptionPreferredLanguage.disabled = !available || !state.liveCaptionViewEnabled || !isTranslatedCaptionMode();
            els.liveCaptionPreferredLanguage.value = state.liveCaptionPreferredLanguage || 'tr';
        }
        if (els.liveCaptionAudioModeStatus) {
            const showAudioMode = available && state.liveCaptionViewEnabled && isVoiceTranslationMode();
            els.liveCaptionAudioModeStatus.hidden = !showAudioMode;
            els.liveCaptionAudioModeStatus.textContent = showAudioMode
                ? t('broadcast_room_join.live_caption_voice_audio_mode_status', 'Sesli çeviri açık: çeviri sesi önde, özgün konuşma altta duyulur.')
                : '';
        }
        if (els.liveCaptionAutoAnnounceLabel) {
            els.liveCaptionAutoAnnounceLabel.textContent = isTranslatedCaptionMode()
                ? t('broadcast_room_join.live_caption_auto_announce_personal', 'Kişisel çeviriyi otomatik seslendir')
                : t('broadcast_room_join.live_caption_auto_announce_caption', 'Altyazıyı otomatik seslendir');
        }
        if (els.liveCaptionText) {
            els.liveCaptionText.value = getLiveCaptionDisplayText();
        }
        updateRemoteAudioElementVolumes();
    }

    function normalizeLiveCaptionAnnouncementText(text) {
        return String(text || '')
            .trim()
            .replace(/^(yeni\s+(altyazı|çeviri|kişisel\s+çeviri)\s*:\s*)/i, '')
            .replace(/^(new\s+(caption|translation|personal\s+translation)\s*:\s*)/i, '')
            .trim();
    }

    function announceLiveCaptionIfNeeded(previousCaption = {}, { announce = true } = {}) {
        if (!announce || !state.liveCaptionAutoAnnounce || !state.liveCaptionViewEnabled || !isLiveCaptionAvailable()) {
            return;
        }
        const text = normalizeLiveCaptionAnnouncementText(getPersonalLiveCaptionText());
        if (!text) {
            return;
        }
        const key = JSON.stringify({
            mode: String(state.liveCaption?.mode || ''),
            preferredLanguage: String(state.liveCaptionPreferredLanguage || ''),
            text
        });
        const previousText = normalizeLiveCaptionAnnouncementText(previousCaption?.text || previousCaption?.translatedText || previousCaption?.originalText || '');
        if (key === state.lastLiveCaptionAnnouncementKey || previousText === text) {
            return;
        }
        state.lastLiveCaptionAnnouncementKey = key;
        announceMessage(text);
    }

    function updateLiveCaptionFromPayload(payload = {}, { announce = true } = {}) {
        const caption = payload?.liveCaption || {};
        const previousCaption = { ...state.liveCaption };
        state.liveCaption = {
            enabled: caption.enabled === true,
            text: String(caption.text || '').trim(),
            originalText: String(caption.originalText || '').trim(),
            translatedText: String(caption.translatedText || '').trim(),
            alternateText: String(caption.alternateText || '').trim(),
            alternateLanguage: String(caption.alternateLanguage || '').trim(),
            sourceLanguage: String(caption.sourceLanguage || '').trim(),
            targetLanguage: String(caption.targetLanguage || '').trim(),
            scope: String(caption.scope || '').trim(),
            mode: String(caption.mode || '').trim(),
            updatedAt: Number(caption.updatedAt || 0) || 0
        };
        const translationAudioSessionChanged = previousCaption.mode !== state.liveCaption.mode
            || previousCaption.scope !== state.liveCaption.scope
            || previousCaption.targetLanguage !== state.liveCaption.targetLanguage
            || previousCaption.enabled !== state.liveCaption.enabled;
        if (previousCaption.mode && previousCaption.mode !== state.liveCaption.mode) {
            state.liveCaptionAutoAnnounce = false;
            state.lastLiveCaptionAnnouncementKey = '';
        }
        if (translationAudioSessionChanged) {
            resetTranslationAudioPlaybackState({ closeContext: false });
        }
        renderLiveCaptionPanel();
        updateAudioChannelVisibility();
        if (
            translationAudioSessionChanged
        ) {
            refreshRemoteAudioPlaybackGraph();
        }
        connectTranslationAudioSocket();
        announceLiveCaptionIfNeeded(previousCaption, { announce });
    }

    function closeRoomEventSource() {
        if (state.roomEventSource) {
            try {
                state.roomEventSource.close();
            } catch (_error) {}
        }
        state.roomEventSource = null;
        state.roomEventSourceRoomId = '';
        state.roomEventSourceConnected = false;
    }

    function connectRoomEventSource() {
        const roomId = String(state.room?.roomId || '').trim();
        if (!roomId || typeof EventSource === 'undefined') {
            return;
        }
        if (state.roomEventSource && state.roomEventSourceRoomId === roomId) {
            return;
        }
        closeRoomEventSource();
        try {
            const eventSource = new EventSource(`/api/broadcast-room/${encodeURIComponent(roomId)}/events`);
            state.roomEventSource = eventSource;
            state.roomEventSourceRoomId = roomId;
            eventSource.addEventListener('open', () => {
                state.roomEventSourceConnected = true;
                if (state.roomConnection) {
                    startRoomStatusPolling(30000);
                }
            });
            eventSource.addEventListener('liveCaption', (event) => {
                try {
                    const payload = JSON.parse(event.data || '{}');
                    updateLiveCaptionFromPayload(payload, { announce: true });
                } catch (_error) {
                    // Polling remains as a fallback if an event payload is malformed.
                }
            });
            eventSource.addEventListener('translationAudio', (event) => {
                try {
                    const payload = JSON.parse(event.data || '{}');
                    playTranslationAudioPayload(payload);
                } catch (_error) {
                    // Translation audio is best-effort; text captions remain available.
                }
            });
            eventSource.addEventListener('chatMessage', (event) => {
                try {
                    const payload = JSON.parse(event.data || '{}');
                    const previousLatestId = String(getVisibleChatMessages().at(-1)?.id || '').trim();
                    state.chatMessages = Array.isArray(payload.chatMessages) ? payload.chatMessages : state.chatMessages;
                    state.participants = Array.isArray(payload.participants) ? payload.participants : state.participants;
                    const messages = getVisibleChatMessages();
                    const latestId = String(messages.at(-1)?.id || '').trim();
                    if (latestId && latestId !== previousLatestId) {
                        state.chatPanelExpanded = true;
                        state.chatSelectedIndex = Math.max(0, messages.length - 1);
                    }
                    renderChatPanel();
                    renderChatMessageList();
                    renderParticipantList();
                    announceNewChatMessages();
                    if (latestId && latestId !== previousLatestId && document.activeElement !== els.chatCompose) {
                        els.chatMessageList?.focus?.();
                    }
                } catch (_error) {
                    // Periodic polling remains as a fallback if a chat event payload is malformed.
                }
            });
            eventSource.addEventListener('roomSettings', async (event) => {
                try {
                    const payload = JSON.parse(event.data || '{}');
                    await applyRoomSettingsFromPayload(payload, { announce: true });
                    await applyOwnParticipantControlsFromPayload(payload);
                    updateHostActivityFromPayload(payload, { announce: true });
                    updateScenePositionFromPayload(payload, { announce: false });
                    updateAccessibleShareFromPayload(payload, { announce: true });
                    updateLiveCaptionFromPayload(payload, { announce: true });
                } catch (_error) {
                    // Periodic polling remains as a fallback if settings events fail.
                }
            });
            eventSource.addEventListener('roomEnded', () => {
                const message = t('broadcast_room_join.room_ended_for_everyone', 'Host toplantıyı herkes için sonlandırdı. Odadan çıkarıldınız.');
                disconnectRoom({ announceStatus: false }).finally(() => {
                    setStatus(message);
                });
            });
            eventSource.addEventListener('participantRemoved', (event) => {
                try {
                    const payload = JSON.parse(event.data || '{}');
                    if (String(payload.identity || '').trim() !== String(state.participantIdentity || '').trim()) {
                        return;
                    }
                } catch (_error) {
                    return;
                }
                const message = t('broadcast_room_join.removed_from_room', 'Host sizi odadan çıkardı.');
                disconnectRoom({ announceStatus: false }).finally(() => {
                    setStatus(message);
                });
            });
            eventSource.addEventListener('error', () => {
                state.roomEventSourceConnected = false;
                if (state.roomConnection) {
                    startRoomStatusPolling(5000);
                }
            });
        } catch (_error) {
            closeRoomEventSource();
        }
    }

    function getFocusedShareTrackState() {
        const participants = Object.values(state.remoteParticipants || {});
        for (const participantState of participants) {
            const shareTrack = (Array.isArray(participantState.videoTracks) ? participantState.videoTracks : [])
                .find((trackState) => isShareTrack(trackState) && trackState?.track);
            if (shareTrack) {
                return {
                    key: `${participantState.identity || ''}:${shareTrack.sid || ''}`,
                    participantState,
                    trackState: shareTrack
                };
            }
        }
        return null;
    }

    function getRemoteMediaRenderSignature(participants) {
        return JSON.stringify((Array.isArray(participants) ? participants : [])
            .map((participantState) => ({
                identity: String(participantState.identity || '').trim(),
                name: String(participantState.name || '').trim(),
                role: getParticipantRole(participantState.identity),
                avatarUrl: getParticipantAvatarUrl(participantState.identity),
                audioChannel: state.audioChannel,
                videoTracks: (Array.isArray(participantState.videoTracks) ? participantState.videoTracks : [])
                    .map((trackState) => ({
                        sid: String(trackState.sid || '').trim(),
                        source: String(trackState.source || '').trim(),
                        share: isShareTrack(trackState)
                    }))
                    .sort((left, right) => String(left.sid || '').localeCompare(String(right.sid || ''))),
                audioTracks: (Array.isArray(participantState.audioTracks) ? participantState.audioTracks : [])
                    .map((trackState) => ({
                        sid: String(trackState.sid || '').trim(),
                        source: String(trackState.source || '').trim()
                    }))
                    .sort((left, right) => String(left.sid || '').localeCompare(String(right.sid || '')))
            }))
            .sort((left, right) => String(left.identity || '').localeCompare(String(right.identity || ''))));
    }

    function setFocusedAccessibleShareVisibility(isVisible) {
        if (els.focusedAccessibleSharePanel) {
            els.focusedAccessibleSharePanel.classList.toggle('sr-only', !isVisible);
        }
        if (els.focusedAccessibleShareAutoAnnounce) {
            els.focusedAccessibleShareAutoAnnounce.checked = state.accessibleShareAutoAnnounce === true;
        }
        if (els.btnToggleFocusedAccessibleShare) {
            els.btnToggleFocusedAccessibleShare.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
            els.btnToggleFocusedAccessibleShare.textContent = isVisible
                ? t('broadcast_room_join.focused_share_hide_accessible_text', 'Erişilebilir metni gizle')
                : t('broadcast_room_join.focused_share_show_accessible_text', 'Erişilebilir metni göster');
        }
    }

    function updateFocusedShareReturnButton(focusedShare = getFocusedShareTrackState()) {
        if (!els.btnReturnFocusedShare) {
            return;
        }
        const shareAvailable = !!focusedShare;
        const focusedViewOpen = !!els.focusedShareView && !els.focusedShareView.hidden;
        const dismissedKey = String(state.focusedShareDismissedKey || '');
        const shouldShow = shareAvailable && !focusedViewOpen && focusedShare?.key !== dismissedKey;
        els.btnReturnFocusedShare.hidden = !shouldShow;
        els.btnReturnFocusedShare.disabled = !shouldShow;
        if (shareAvailable) {
            const participantName = getRemoteParticipantLabel(focusedShare.participantState);
            const sourceLabel = getTrackSourceLabel(focusedShare.trackState);
            els.btnReturnFocusedShare.setAttribute('aria-label', t('broadcast_room_join.focused_share_return_aria', '{name} paylaşımını tekrar büyük görünümde aç', {
                name: `${participantName} - ${sourceLabel}`
            }));
        } else {
            els.btnReturnFocusedShare.removeAttribute('aria-label');
        }
    }

    function closeFocusedShareView({ dismiss = true, announceClose = false } = {}) {
        if (dismiss && state.focusedShareKey) {
            state.focusedShareDismissedKey = state.focusedShareKey;
        }
        state.focusedShareKey = '';
        if (els.focusedShareVideo) {
            try {
                els.focusedShareVideo.pause();
            } catch (_error) {
                // ignore pause errors
            }
            els.focusedShareVideo.removeAttribute('src');
            els.focusedShareVideo.srcObject = null;
        }
        if (els.focusedShareView) {
            els.focusedShareView.hidden = true;
            els.focusedShareView.setAttribute('aria-hidden', 'true');
        }
        setFocusedAccessibleShareVisibility(false);
        if (els.btnToggleFocusedAccessibleShare) {
            els.btnToggleFocusedAccessibleShare.setAttribute('aria-expanded', 'false');
        }
        updateFocusedShareReturnButton();
        if (announceClose) {
            announceMessage(t('broadcast_room_join.focused_share_closed', 'Paylaşım büyük görünümünden çıkıldı.'));
        }
    }

    function openFocusedShareView(focusedShare, { announceReturn = false } = {}) {
        if (!focusedShare || !els.focusedShareView || !els.focusedShareVideo) {
            return;
        }
        const participantName = getRemoteParticipantLabel(focusedShare.participantState);
        const sourceLabel = getTrackSourceLabel(focusedShare.trackState);
        const title = t('broadcast_room_join.focused_share_title_with_name', '{name} ekran paylaşımı', {
            name: participantName
        });
        if (els.focusedShareTitle) {
            els.focusedShareTitle.textContent = title;
        }
        els.focusedShareVideo.setAttribute('aria-label', t('broadcast_room_join.focused_share_video_aria', '{name} büyük ekran paylaşımı', {
            name: `${participantName} - ${sourceLabel}`
        }));
        focusedShare.trackState.track.attach(els.focusedShareVideo);
        const playPromise = els.focusedShareVideo.play?.();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});
        }
        els.focusedShareView.hidden = false;
        els.focusedShareView.setAttribute('aria-hidden', 'false');
        setFocusedAccessibleShareVisibility(false);
        state.focusedShareKey = focusedShare.key;
        updateFocusedShareReturnButton(focusedShare);
        els.btnCloseFocusedShare?.focus?.();
        if (announceReturn) {
            announceMessage(t('broadcast_room_join.focused_share_returned', 'Paylaşım büyük görünümüne geri dönüldü.'));
        }
    }

    function updateFocusedShareView() {
        const focusedShare = getFocusedShareTrackState();
        if (!focusedShare) {
            state.focusedShareDismissedKey = '';
            closeFocusedShareView({ dismiss: false });
            return;
        }
        if (focusedShare.key === state.focusedShareDismissedKey) {
            updateFocusedShareReturnButton(focusedShare);
            return;
        }
        if (!els.focusedShareView?.hidden && state.focusedShareKey === focusedShare.key) {
            updateFocusedShareReturnButton(focusedShare);
            return;
        }
        openFocusedShareView(focusedShare);
    }

    async function applyRoomSettingsFromPayload(payload = {}, { announce = true } = {}) {
        const previousOwnDisplayName = String(getOwnParticipant()?.displayName || '').trim();
        state.participants = Array.isArray(payload.participants) ? payload.participants : state.participants;
        syncParticipantPresenceAnnouncements(state.participants, { announce });
        const nextOwnDisplayName = String(getOwnParticipant()?.displayName || '').trim();
        const ownDisplayNameChangedByHost = previousOwnDisplayName
            && nextOwnDisplayName
            && previousOwnDisplayName !== nextOwnDisplayName;
        if (ownDisplayNameChangedByHost) {
            if (els.displayName) {
                els.displayName.value = nextOwnDisplayName;
            }
            if (els.joinedDisplayName) {
                els.joinedDisplayName.value = nextOwnDisplayName;
            }
            const displayNameMessage = t('broadcast_room_join.display_name_changed_by_host', 'Host görünen adınızı değiştirdi: {name}', {
                name: nextOwnDisplayName
            });
            setStatus(displayNameMessage);
            announceMessage(displayNameMessage);
        }
        state.chatMessages = Array.isArray(payload.chatMessages) ? payload.chatMessages : state.chatMessages;
        const nextAllowGuestScreenShare = payload?.settings?.allowGuestScreenShare !== false;
        const nextAllowGuestCamera = payload?.settings?.allowGuestCamera !== false;
        const nextAllowGuestMicrophone = payload?.settings?.allowGuestMicrophone !== false;
        const permissionChanged = state.allowGuestScreenShare !== nextAllowGuestScreenShare;
        const cameraPermissionChanged = state.allowGuestCamera !== nextAllowGuestCamera;
        const microphonePermissionChanged = state.allowGuestMicrophone !== nextAllowGuestMicrophone;
        state.allowGuestScreenShare = nextAllowGuestScreenShare;
        state.allowGuestCamera = nextAllowGuestCamera;
        state.allowGuestMicrophone = nextAllowGuestMicrophone;
        state.hostConnected = payload?.hostConnected !== false;
        state.allowJoinWhenHostAbsent = payload?.joinPolicy?.allowJoinWhenHostAbsent === true;
        state.passwordConfigured = payload?.joinPolicy?.passwordConfigured === true;
        state.requirePasswordNow = payload?.joinPolicy?.requirePasswordNow === true;
        state.hostShareMonitorAudioEnabled = payload?.settings?.hostShareMonitorAudioEnabled === true;
        state.hostRecordingActive = payload?.settings?.hostRecordingActive === true;
        updateRoomPasswordVisibility();
        updateMediaPermissionControls();
        updateScreenShareControls();
        renderParticipantList();
        renderChatTargetSelector();
        renderChatMessageList();
        connectMonitorAudioSocket();
        syncLocalBackupRecordingWithHostState();

        if (permissionChanged && !nextAllowGuestScreenShare && isScreenShareActive()) {
            await stopScreenShare({
                announceStatus: false,
                statusMessage: t('broadcast_room_join.screen_share_stopped_by_host', 'Host ekran paylaşımını kapattı. Paylaşımınız durduruldu.')
            });
        }

        if (permissionChanged && announce) {
            announceMessage(
                nextAllowGuestScreenShare
                    ? t('broadcast_room_join.screen_share_permission_opened', 'Host konuk ekran paylaşımını açtı.')
                    : t('broadcast_room_join.screen_share_permission_closed', 'Host konuk ekran paylaşımını kapattı.')
            );
        }
        if (cameraPermissionChanged && !nextAllowGuestCamera && Boolean(els.cameraEnabled?.checked)) {
            els.cameraEnabled.checked = false;
            await handleCameraToggleChange();
            setStatus(t('broadcast_room_join.camera_permission_closed', 'Host kamera izninizi kapattı. Kamera durduruldu.'));
        }
        if (microphonePermissionChanged && !nextAllowGuestMicrophone && Boolean(els.microphoneEnabled?.checked)) {
            els.microphoneEnabled.checked = false;
            await handleMicrophoneToggleChange();
            setStatus(t('broadcast_room_join.microphone_permission_closed', 'Host mikrofon izninizi kapattı. Mikrofon durduruldu.'));
        }
    }

    function roleCanPublishMedia(role) {
        return !['audience', 'viewer'].includes(String(role || 'guest').trim());
    }

    function getParticipantRole(identity) {
        const participant = state.participants.find((item) => String(item.identity || '').trim() === String(identity || '').trim());
        return String(participant?.role || '').trim();
    }

    function hasLiveInterpreter() {
        return state.participants.some((participant) => String(participant.role || '').trim() === 'live_interpreter');
    }

    function clampAudioLevelPercent(value, fallback = 100) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return fallback;
        }
        return Math.max(0, Math.min(200, numeric));
    }

    function getMicrophoneVolume() {
        return clampAudioLevelPercent(els.microphoneVolume?.value || state.microphoneVolume * 100) / 100;
    }

    function getSpeakerVolume() {
        return clampAudioLevelPercent(els.speakerVolume?.value || state.speakerVolume * 100) / 100;
    }

    function updateAudioLevelLabels() {
        const microphonePercent = Math.round(getMicrophoneVolume() * 100);
        const speakerPercent = Math.round(getSpeakerVolume() * 100);
        if (els.microphoneVolumeValue) {
            els.microphoneVolumeValue.textContent = `${microphonePercent}%`;
        }
        if (els.speakerVolumeValue) {
            els.speakerVolumeValue.textContent = `${speakerPercent}%`;
        }
    }

    async function applyMicrophoneVolumeToTrack(track = state.localAudioTrack) {
        const mediaTrack = getNativeAudioTrackFromLocalTrack(track);
        if (!mediaTrack || typeof mediaTrack.applyConstraints !== 'function') {
            return false;
        }
        const supportedConstraints = navigator.mediaDevices?.getSupportedConstraints?.() || {};
        if (supportedConstraints.volume !== true) {
            return false;
        }
        try {
            await mediaTrack.applyConstraints({ volume: getMicrophoneVolume() });
            return true;
        } catch (_error) {
            return false;
        }
    }

    function getRemoteAudioVolume(participantIdentity) {
        const role = getParticipantRole(participantIdentity);
        const isInterpreter = role === 'live_interpreter';
        const channel = String(state.audioChannel || 'original');
        if (shouldPlayTranslationAudio()) {
            return 0.08 * getSpeakerVolume();
        }
        if (!hasLiveInterpreter() || channel === 'original') {
            return 1 * getSpeakerVolume();
        }
        if (channel === 'interpreter_only') {
            return (isInterpreter ? 1 : 0) * getSpeakerVolume();
        }
        if (channel === 'interpreter_overlay') {
            return (isInterpreter ? 1 : 0.2) * getSpeakerVolume();
        }
        return 1 * getSpeakerVolume();
    }

    function getRemoteAudioMixKey(participantIdentity, trackSid) {
        return `${String(participantIdentity || '').trim()}:${String(trackSid || '').trim()}`;
    }

    function getNativeAudioTrackFromRemoteTrack(track) {
        return track?.mediaStreamTrack || track?._mediaStreamTrack || null;
    }

    function getNativeAudioTrackFromLocalTrack(track) {
        return track?.mediaStreamTrack || track?._mediaStreamTrack || track || null;
    }

    function getNativeVideoTrackFromLocalTrack(track) {
        return track?.mediaStreamTrack || track?._mediaStreamTrack || track || null;
    }

    function getSupportedLocalBackupMimeType({ includeVideo = false } = {}) {
        if (typeof MediaRecorder === 'undefined') {
            return '';
        }
        const candidates = includeVideo
            ? [
                'video/webm;codecs=vp9,opus',
                'video/webm;codecs=vp8,opus',
                'video/webm',
                'video/mp4'
            ]
            : [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/ogg;codecs=opus',
                'audio/mp4'
            ];
        return candidates.find((mimeType) => {
            try {
                return MediaRecorder.isTypeSupported?.(mimeType);
            } catch (_error) {
                return false;
            }
        }) || '';
    }

    function createLocalBackupSessionId() {
        const random = Math.random().toString(36).slice(2, 10);
        return `${String(state.participantIdentity || 'guest').replace(/[^a-z0-9_-]/gi, '-')}-${Date.now()}-${random}`;
    }

    function openLocalBackupDb() {
        if (!window.indexedDB) {
            return Promise.reject(new Error('indexeddb_unavailable'));
        }
        if (localBackupDbPromise) {
            return localBackupDbPromise;
        }
        localBackupDbPromise = new Promise((resolve, reject) => {
            const request = window.indexedDB.open(LOCAL_BACKUP_DB_NAME, LOCAL_BACKUP_DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(LOCAL_BACKUP_CHUNK_STORE)) {
                    const store = db.createObjectStore(LOCAL_BACKUP_CHUNK_STORE, { keyPath: 'key' });
                    store.createIndex('sessionId', 'sessionId', { unique: false });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('indexeddb_open_failed'));
            request.onblocked = () => reject(new Error('indexeddb_blocked'));
        }).catch((error) => {
            localBackupDbPromise = null;
            throw error;
        });
        return localBackupDbPromise;
    }

    function runLocalBackupStoreTransaction(mode, callback) {
        return openLocalBackupDb().then((db) => new Promise((resolve, reject) => {
            const transaction = db.transaction(LOCAL_BACKUP_CHUNK_STORE, mode);
            const store = transaction.objectStore(LOCAL_BACKUP_CHUNK_STORE);
            let result;
            transaction.oncomplete = () => resolve(result);
            transaction.onerror = () => reject(transaction.error || new Error('indexeddb_transaction_failed'));
            transaction.onabort = () => reject(transaction.error || new Error('indexeddb_transaction_aborted'));
            try {
                result = callback(store);
            } catch (error) {
                transaction.abort();
                reject(error);
            }
        }));
    }

    function getLocalBackupMemoryChunks(sessionId) {
        return (state.localBackupRecording.deferredChunks || [])
            .filter((chunk) => chunk?.sessionId === sessionId);
    }

    async function saveLocalBackupChunkRecord(record) {
        const backup = state.localBackupRecording;
        try {
            await runLocalBackupStoreTransaction('readwrite', (store) => {
                store.put(record);
            });
        } catch (_error) {
            backup.deferredChunks.push(record);
        }
        backup.queuedChunks += 1;
        updateLocalBackupRecordingStatus();
    }

    async function getStoredLocalBackupChunkRecords(sessionId) {
        const memoryChunks = getLocalBackupMemoryChunks(sessionId);
        try {
            const dbChunks = await runLocalBackupStoreTransaction('readonly', (store) => new Promise((resolve, reject) => {
                const request = store.index('sessionId').getAll(sessionId);
                request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
                request.onerror = () => reject(request.error || new Error('indexeddb_read_failed'));
            }));
            return dbChunks.concat(memoryChunks).sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
        } catch (_error) {
            return memoryChunks.sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
        }
    }

    async function removeStoredLocalBackupChunkRecord(record) {
        const backup = state.localBackupRecording;
        backup.deferredChunks = (backup.deferredChunks || []).filter((chunk) => chunk?.key !== record?.key);
        try {
            await runLocalBackupStoreTransaction('readwrite', (store) => {
                store.delete(record.key);
            });
        } catch (_error) {
            // Memory fallback has already been cleaned.
        }
    }

    async function queueLocalBackupChunk(blob, { final = false } = {}) {
        const backup = state.localBackupRecording;
        if (!blob || !blob.size || !state.room?.roomId || !state.participantIdentity || !backup.sessionId) {
            return;
        }
        const sequence = backup.sequence + 1;
        backup.sequence = sequence;
        const record = {
            key: `${backup.sessionId}-${String(sequence).padStart(6, '0')}`,
            roomId: state.room.roomId,
            identity: state.participantIdentity,
            displayName: String(els.displayName?.value || '').trim(),
            sessionId: backup.sessionId,
            sequence,
            mimeType: backup.mimeType || blob.type || '',
            mediaKind: backup.mediaKind || 'audio',
            startedAt: backup.startedAt || Date.now(),
            final: final ? '1' : '0',
            blob
        };
        const storePromise = saveLocalBackupChunkRecord(record).catch(() => {
            backup.failedChunks += 1;
            updateLocalBackupRecordingStatus();
        });
        backup.pendingStores.add(storePromise);
        try {
            await storePromise;
        } finally {
            backup.pendingStores.delete(storePromise);
        }
    }

    function updateLocalBackupRecordingStatus() {
        const backup = state.localBackupRecording;
        if (!backup.active && !backup.stopRequested && !backup.sessionId) {
            setLocalBackupRecordingStatus('');
            return;
        }
        if (backup.active) {
            setLocalBackupRecordingStatus(t('broadcast_room_join.local_backup_recording_active', 'Yerel yedek kayıt alınıyor. Tür: {kind}. Saklanan parça: {count}. Yükleme kayıt bitince başlayacak.', {
                kind: backup.mediaKind === 'video'
                    ? t('broadcast_room_join.local_backup_recording_kind_video', 'ses ve görüntü')
                    : t('broadcast_room_join.local_backup_recording_kind_audio', 'yalnız ses'),
                count: backup.queuedChunks
            }));
            return;
        }
        if (backup.stopRequested || backup.uploading || backup.pendingUploads.size > 0) {
            const remaining = Math.max(0, backup.queuedChunks - backup.uploadedChunks - backup.failedChunks);
            setLocalBackupRecordingStatus(t('broadcast_room_join.local_backup_recording_uploading', 'Yerel yedek kayıt yükleniyor. Kalan parça: {count}.', {
                count: remaining
            }));
            return;
        }
        if (backup.sessionId) {
            setLocalBackupRecordingStatus(backup.failedChunks > 0
                ? t('broadcast_room_join.local_backup_recording_completed_with_errors', 'Yerel yedek kayıt tamamlandı, ancak {count} parça yüklenemedi.', {
                    count: backup.failedChunks
                })
                : t('broadcast_room_join.local_backup_recording_completed', 'Yerel yedek kayıt yüklendi.'));
        }
    }

    async function uploadStoredLocalBackupChunk(record) {
        const backup = state.localBackupRecording;
        const blob = record?.blob;
        if (!blob || !blob.size || !record?.roomId || !record?.identity || !record?.sessionId) {
            return;
        }
        const uploadPromise = (async () => {
            const params = new URLSearchParams({
                roomId: String(record.roomId || ''),
                identity: String(record.identity || ''),
                displayName: String(record.displayName || ''),
                sessionId: String(record.sessionId || ''),
                sequence: String(record.sequence || ''),
                mimeType: String(record.mimeType || blob.type || ''),
                mediaKind: String(record.mediaKind || 'audio'),
                startedAt: String(record.startedAt || Date.now()),
                final: record.final === '1' ? '1' : '0'
            });
            const response = await fetch(`/api/broadcast-room/local-recording-chunk?${params.toString()}`, {
                method: 'POST',
                headers: {
                    'Content-Type': record.mimeType || blob.type || 'application/octet-stream'
                },
                body: blob
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || `upload_failed_${response.status}`);
            }
            backup.uploadedChunks += 1;
            await removeStoredLocalBackupChunkRecord(record);
        })();
        backup.pendingUploads.add(uploadPromise);
        updateLocalBackupRecordingStatus();
        try {
            await uploadPromise;
        } catch (_error) {
            backup.failedChunks += 1;
        } finally {
            backup.pendingUploads.delete(uploadPromise);
            updateLocalBackupRecordingStatus();
        }
    }

    async function uploadQueuedLocalBackupChunks(sessionId) {
        const backup = state.localBackupRecording;
        await Promise.allSettled(Array.from(backup.pendingStores || []));
        const chunks = await getStoredLocalBackupChunkRecords(sessionId);
        backup.uploading = true;
        updateLocalBackupRecordingStatus();
        for (const chunk of chunks) {
            await uploadStoredLocalBackupChunk(chunk);
        }
        backup.uploading = false;
        updateLocalBackupRecordingStatus();
    }

    async function finalizeLocalBackupRecording() {
        const backup = state.localBackupRecording;
        const completedSessionId = backup.sessionId;
        backup.active = false;
        backup.stopRequested = true;
        backup.stoppedAt = Date.now();
        if (backup.stream) {
            backup.stream.getTracks().forEach((track) => {
                try { track.stop(); } catch (_error) {}
            });
        }
        backup.stream = null;
        backup.recorder = null;
        updateLocalBackupRecordingStatus();
        await uploadQueuedLocalBackupChunks(completedSessionId);
        if (completedSessionId && state.room?.roomId && state.participantIdentity) {
            try {
                await fetch('/api/broadcast-room/local-recording-complete', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        roomId: state.room.roomId,
                        identity: state.participantIdentity,
                        sessionId: completedSessionId,
                        stoppedAt: backup.stoppedAt
                    })
                });
            } catch (_error) {
                backup.failedChunks += 1;
            }
        }
        backup.stopRequested = false;
        updateLocalBackupRecordingStatus();
        if (state.hostRecordingActive === true && state.roomConnection && state.localAudioTrack) {
            startLocalBackupRecording();
        }
    }

    function stopLocalBackupRecording() {
        const backup = state.localBackupRecording;
        if (!backup.active && !backup.recorder) {
            updateLocalBackupRecordingStatus();
            return;
        }
        backup.stopRequested = true;
        updateLocalBackupRecordingStatus();
        try {
            if (backup.recorder?.state === 'recording') {
                backup.recorder.requestData?.();
                backup.recorder.stop();
                return;
            }
        } catch (_error) {
            // Fall through to cleanup.
        }
        finalizeLocalBackupRecording().catch(() => {});
    }

    function startLocalBackupRecording() {
        const backup = state.localBackupRecording;
        if (backup.active || backup.recorder) {
            return;
        }
        if (!state.roomConnection || !state.room?.roomId || !state.participantIdentity) {
            return;
        }
        if (typeof MediaRecorder === 'undefined') {
            setLocalBackupRecordingStatus(t('broadcast_room_join.local_backup_recording_unsupported', 'Bu tarayıcı yerel yedek kaydı desteklemiyor.'));
            return;
        }
        const nativeAudioTrack = getNativeAudioTrackFromLocalTrack(state.localAudioTrack);
        if (!nativeAudioTrack || nativeAudioTrack.readyState !== 'live') {
            setLocalBackupRecordingStatus(t('broadcast_room_join.local_backup_recording_waiting_microphone', 'Yerel yedek kayıt için mikrofon bekleniyor.'));
            return;
        }
        const nativeVideoTrack = getNativeVideoTrackFromLocalTrack(state.localVideoTrack);
        const includeVideo = Boolean(els.cameraEnabled?.checked) && !!nativeVideoTrack && nativeVideoTrack.readyState === 'live';
        const mediaKind = includeVideo ? 'video' : 'audio';
        const mimeType = getSupportedLocalBackupMimeType({ includeVideo });
        try {
            const backupAudioTrack = typeof nativeAudioTrack.clone === 'function' ? nativeAudioTrack.clone() : nativeAudioTrack;
            const tracks = [backupAudioTrack];
            if (includeVideo) {
                tracks.unshift(typeof nativeVideoTrack.clone === 'function' ? nativeVideoTrack.clone() : nativeVideoTrack);
            }
            const stream = new MediaStream(tracks);
            const options = mimeType
                ? { mimeType, audioBitsPerSecond: 128000, videoBitsPerSecond: includeVideo ? 1800000 : undefined }
                : { audioBitsPerSecond: 128000, videoBitsPerSecond: includeVideo ? 1800000 : undefined };
            const recorder = new MediaRecorder(stream, options);
            backup.active = true;
            backup.stopRequested = false;
            backup.sessionId = createLocalBackupSessionId();
            backup.recorder = recorder;
            backup.stream = stream;
            backup.mimeType = recorder.mimeType || mimeType || (includeVideo ? 'video/webm' : 'audio/webm');
            backup.mediaKind = mediaKind;
            backup.sequence = 0;
            backup.queuedChunks = 0;
            backup.uploadedChunks = 0;
            backup.failedChunks = 0;
            backup.uploading = false;
            backup.pendingStores = new Set();
            backup.pendingUploads = new Set();
            backup.deferredChunks = [];
            backup.startedAt = Date.now();
            backup.stoppedAt = 0;
            recorder.addEventListener('dataavailable', (event) => {
                if (event.data && event.data.size > 0) {
                    queueLocalBackupChunk(event.data).catch(() => {});
                }
            });
            recorder.addEventListener('stop', () => {
                finalizeLocalBackupRecording().catch(() => {});
            });
            recorder.addEventListener('error', () => {
                backup.failedChunks += 1;
                stopLocalBackupRecording();
            });
            recorder.start(5000);
            updateLocalBackupRecordingStatus();
        } catch (error) {
            setLocalBackupRecordingStatus(t('broadcast_room_join.local_backup_recording_failed', 'Yerel yedek kayıt başlatılamadı: {error}', {
                error: formatErrorMessage(error)
            }));
        }
    }

    function syncLocalBackupRecordingWithHostState() {
        if (state.hostRecordingActive === true) {
            startLocalBackupRecording();
        } else {
            stopLocalBackupRecording();
        }
    }

    function ensureRemoteAudioContext() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            return null;
        }
        if (!state.remoteAudioContext || state.remoteAudioContext.state === 'closed') {
            state.remoteAudioContext = new AudioContextClass();
        }
        state.remoteAudioContext.resume?.().catch?.(() => {});
        return state.remoteAudioContext;
    }

    function clearRemoteAudioMixNodes() {
        Object.values(state.remoteAudioMixNodes || {}).forEach((entry) => {
            try { entry.source?.disconnect(); } catch (_error) {}
            try { entry.gain?.disconnect(); } catch (_error) {}
        });
        state.remoteAudioMixNodes = {};
    }

    function closeRemoteAudioContext() {
        clearRemoteAudioMixNodes();
        if (state.remoteAudioContext) {
            try { state.remoteAudioContext.close(); } catch (_error) {}
        }
        state.remoteAudioContext = null;
    }

    function syncRemoteAudioMixNode(trackState, participantIdentity, audioEl) {
        const key = getRemoteAudioMixKey(participantIdentity, trackState?.sid);
        const useOverlayMix = shouldPlayTranslationAudio();
        const volume = getRemoteAudioVolume(participantIdentity);
        if (!useOverlayMix) {
            if (state.remoteAudioMixNodes[key]) {
                try { state.remoteAudioMixNodes[key].source?.disconnect(); } catch (_error) {}
                try { state.remoteAudioMixNodes[key].gain?.disconnect(); } catch (_error) {}
                delete state.remoteAudioMixNodes[key];
            }
            audioEl.muted = false;
            audioEl.volume = volume;
            return;
        }
        const audioContext = ensureRemoteAudioContext();
        const nativeTrack = getNativeAudioTrackFromRemoteTrack(trackState?.track);
        if (!audioContext || !nativeTrack) {
            audioEl.muted = false;
            audioEl.volume = volume;
            return;
        }
        audioEl.muted = true;
        audioEl.volume = 0;
        if (!state.remoteAudioMixNodes[key]) {
            try {
                const stream = new MediaStream([nativeTrack]);
                const source = audioContext.createMediaStreamSource(stream);
                const gain = audioContext.createGain();
                source.connect(gain);
                gain.connect(audioContext.destination);
                state.remoteAudioMixNodes[key] = { source, gain };
            } catch (_error) {
                audioEl.muted = false;
                audioEl.volume = volume;
                return;
            }
        }
        try {
            state.remoteAudioMixNodes[key].gain.gain.value = volume;
        } catch (_error) {}
    }

    function updateRemoteAudioElementVolumes() {
        if (!els.remoteAudioHost) {
            return;
        }
        const audioElements = Array.from(els.remoteAudioHost.querySelectorAll('audio[data-participant-identity]'));
        audioElements.forEach((audio) => {
            const participantIdentity = audio.dataset.participantIdentity || '';
            audio.volume = getRemoteAudioVolume(participantIdentity);
            const key = getRemoteAudioMixKey(participantIdentity, audio.dataset.trackSid || '');
            const mixEntry = state.remoteAudioMixNodes?.[key] || null;
            if (mixEntry && shouldPlayTranslationAudio()) {
                audio.muted = true;
                audio.volume = 0;
                try {
                    mixEntry.gain.gain.value = getRemoteAudioVolume(participantIdentity);
                } catch (_error) {}
            } else if (!shouldPlayTranslationAudio()) {
                if (mixEntry) {
                    try { mixEntry.source?.disconnect(); } catch (_error) {}
                    try { mixEntry.gain?.disconnect(); } catch (_error) {}
                    delete state.remoteAudioMixNodes[key];
                }
                audio.muted = false;
                audio.volume = getRemoteAudioVolume(participantIdentity);
            }
        });
    }

    function refreshRemoteAudioPlaybackGraph() {
        state.remoteMediaRenderSignature = '';
        renderRemoteParticipants().catch(() => {});
    }

    async function reconnectWithParticipantRole(nextRole) {
        if (!state.room?.roomId || !state.participantIdentity || state.roleRefreshInProgress) {
            return;
        }
        state.roleRefreshInProgress = true;
        try {
            const response = await fetch('/api/broadcast-room/participant-role-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    roomId: state.room.roomId,
                    identity: state.participantIdentity
                })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.success) {
                throw new Error(payload.error || 'participant_role_token_failed');
            }

            stopRoomStatusPolling();
            stopParticipantHeartbeat();
            state.hostRecordingActive = false;
            stopLocalBackupRecording();
            await stopScreenShare({ announceStatus: false, notifyState: false });
            if (state.roomConnection) {
                try {
                    state.roomConnection.disconnect();
                } catch (_error) {
                    // ignore old connection shutdown errors
                }
            }
            if (state.localVideoTrack) {
                try {
                    state.localVideoTrack.stop();
                } catch (_error) {}
            }
            if (state.localAudioTrack) {
                try {
                    state.localAudioTrack.stop();
                } catch (_error) {}
            }
            state.roomConnection = null;
            state.localVideoTrack = null;
            state.localAudioTrack = null;
            state.remoteParticipants = {};
            state.token = String(payload.token || '');
            state.participantRole = String(payload.participantRole || nextRole || 'guest').trim() || 'guest';
            state.canPublishMedia = roleCanPublishMedia(state.participantRole);
            if (!state.canPublishMedia) {
                if (els.cameraEnabled) {
                    els.cameraEnabled.checked = false;
                }
                if (els.microphoneEnabled) {
                    els.microphoneEnabled.checked = false;
                }
            }
            clearLocalPreview();
            updateMediaPermissionControls();
            updateScreenShareControls();
            await connectToLiveKit({
                ...payload,
                token: state.token,
                livekitUrl: payload.livekitUrl || state.livekitUrl
            });
            const message = state.participantRole === 'sign_interpreter'
                ? t('broadcast_room_join.role_sign_interpreter_enabled', 'Host sizi işaret dili tercümanı yaptı. Kameranızı açabilirsiniz.')
                : (state.participantRole === 'live_interpreter'
                    ? t('broadcast_room_join.role_live_interpreter_enabled', 'Host sizi canlı çevirmen yaptı. Mikrofonunuzu açabilirsiniz.')
                    : (state.participantRole === 'co_host'
                        ? t('broadcast_room_join.role_co_host_enabled', 'Host sizi ortak host yaptı. Kamera, mikrofon ve ekran paylaşımı izinleriniz yenilendi.')
                : (state.canPublishMedia
                    ? t('broadcast_room_join.role_panelist_enabled', 'Host sizi panelist yaptı. Kamera ve mikrofonu açabilirsiniz.')
                    : t('broadcast_room_join.role_audience_enabled', 'Host sizi izleyiciye çevirdi. Kamera, mikrofon ve ekran paylaşımı kapatıldı.'))));
            setStatus(message);
            announceMessage(message);
        } finally {
            state.roleRefreshInProgress = false;
        }
    }

    async function applyOwnParticipantControlsFromPayload(payload = {}) {
        const participants = Array.isArray(payload?.participants) ? payload.participants : [];
        state.participants = participants;
        state.chatMessages = Array.isArray(payload?.chatMessages) ? payload.chatMessages : state.chatMessages;
        renderParticipantList();
        renderChatTargetSelector();
        renderChatMessageList();
        renderRemoteParticipants().catch(() => {});
        const ownParticipant = participants.find((participant) => String(participant.identity || '').trim() === String(state.participantIdentity || '').trim()) || null;
        announceNewChatMessages();
        updateHandRaiseStateFromParticipants({ announce: true });
        if (!ownParticipant) {
            await disconnectRoom({ preserveJoinResult: true }).catch(() => {});
            setJoinResult(t('broadcast_room_join.removed_from_room', 'Host sizi odadan çıkardı.'));
            setConnectionStatus(t('broadcast_room_join.connection_removed', 'Oda bağlantısı host tarafından kapatıldı.'));
            setStatus(t('broadcast_room_join.removed_from_room', 'Host sizi odadan çıkardı.'));
            return;
        }

        const nextRole = String(ownParticipant.role || 'guest').trim() || 'guest';
        if (nextRole !== state.participantRole) {
            await reconnectWithParticipantRole(nextRole);
            return;
        }

        const previousOwnAllowCamera = state.ownAllowCamera;
        const previousOwnAllowMicrophone = state.ownAllowMicrophone;
        const previousOwnAllowScreenShare = state.ownAllowScreenShare;
        state.ownAllowCamera = ownParticipant.allowCamera !== false;
        state.ownAllowMicrophone = ownParticipant.allowMicrophone !== false;
        state.ownAllowScreenShare = ownParticipant.allowScreenShare !== false;
        const shouldAnnouncePermissionChanges = state.ownPermissionAnnouncementsBootstrapped === true;
        if (shouldAnnouncePermissionChanges && previousOwnAllowCamera !== state.ownAllowCamera) {
            announceMessage(state.ownAllowCamera
                ? t('broadcast_room_join.camera_permission_opened', 'Host kamera izninizi açtı.')
                : t('broadcast_room_join.camera_permission_closed', 'Host kamera izninizi kapattı. Kamera durduruldu.'));
        }
        if (shouldAnnouncePermissionChanges && previousOwnAllowMicrophone !== state.ownAllowMicrophone) {
            announceMessage(state.ownAllowMicrophone
                ? t('broadcast_room_join.microphone_permission_opened', 'Host mikrofon izninizi açtı.')
                : t('broadcast_room_join.microphone_permission_closed', 'Host mikrofon izninizi kapattı. Mikrofon durduruldu.'));
        }
        if (shouldAnnouncePermissionChanges && previousOwnAllowScreenShare !== state.ownAllowScreenShare) {
            announceMessage(state.ownAllowScreenShare
                ? t('broadcast_room_join.screen_share_permission_opened', 'Host konuk ekran paylaşımını açtı.')
                : t('broadcast_room_join.screen_share_permission_closed', 'Host konuk ekran paylaşımını kapattı.'));
        }
        state.ownPermissionAnnouncementsBootstrapped = true;
        announceRemoteShareChanges(payload);
        updateMediaPermissionControls();
        updateScreenShareControls();

        const shouldEnableCamera = ownParticipant.requestedCameraEnabled === true && ownParticipant.allowCamera !== false;
        const shouldDisableCamera = ownParticipant.requestedCameraEnabled === false;
        const shouldEnableMicrophone = ownParticipant.requestedMicrophoneEnabled === true && ownParticipant.allowMicrophone !== false;
        const shouldDisableMicrophone = ownParticipant.requestedMicrophoneEnabled === false;

        if (shouldDisableCamera && Boolean(els.cameraEnabled?.checked)) {
            els.cameraEnabled.checked = false;
            await handleCameraToggleChange();
            setStatus(t('broadcast_room_join.camera_forced_off', 'Host kameranızı kapattı.'));
        } else if (shouldEnableCamera && !Boolean(els.cameraEnabled?.checked)) {
            els.cameraEnabled.checked = true;
            try {
                await handleCameraToggleChange();
                setStatus(t('broadcast_room_join.camera_forced_on', 'Host kameranızı açmanızı istedi, kamera başlatıldı.'));
            } catch (_error) {
                setStatus(t('broadcast_room_join.camera_forced_on_failed', 'Host kameranızı açmanızı istedi ancak kamera başlatılamadı.'));
            }
        }

        if (shouldDisableMicrophone && Boolean(els.microphoneEnabled?.checked)) {
            els.microphoneEnabled.checked = false;
            await handleMicrophoneToggleChange();
            setStatus(t('broadcast_room_join.microphone_forced_off', 'Host mikrofonunuzu kapattı.'));
        } else if (shouldEnableMicrophone && !Boolean(els.microphoneEnabled?.checked)) {
            els.microphoneEnabled.checked = true;
            try {
                await handleMicrophoneToggleChange();
                setStatus(t('broadcast_room_join.microphone_forced_on', 'Host mikrofonunuzu açmanızı istedi, mikrofon başlatıldı.'));
            } catch (_error) {
                setStatus(t('broadcast_room_join.microphone_forced_on_failed', 'Host mikrofonunuzu açmanızı istedi ancak mikrofon başlatılamadı.'));
            }
        }
    }

    function announceMessage(message) {
        announce(message);
    }

    async function pollRoomStatus() {
        if (!state.room?.roomId) {
            return;
        }
        try {
            const response = await fetch(`/api/broadcast-room/${encodeURIComponent(state.room.roomId)}`);
            if (!response.ok) {
                return;
            }
            const payload = await response.json().catch(() => ({}));
            await applyRoomSettingsFromPayload(payload, { announce: true });
            await applyOwnParticipantControlsFromPayload(payload);
            updateScenePositionFromPayload(payload, { announce: true });
            updateHostActivityFromPayload(payload, { announce: true });
            updateAccessibleShareFromPayload(payload, { announce: true });
            updateLiveCaptionFromPayload(payload, { announce: true });
        } catch (_error) {
            // best effort only
        }
    }

    function startRoomStatusPolling(intervalMs = state.roomEventSourceConnected ? 30000 : 5000) {
        const normalizedInterval = Math.max(5000, Number(intervalMs || 0) || 30000);
        if (state.roomStatusTimer && state.roomStatusPollIntervalMs === normalizedInterval) {
            return;
        }
        stopRoomStatusPolling();
        state.roomStatusPollIntervalMs = normalizedInterval;
        state.roomStatusTimer = window.setInterval(() => {
            pollRoomStatus().catch(() => {});
        }, normalizedInterval);
    }

    function stopRoomStatusPolling() {
        if (state.roomStatusTimer) {
            clearInterval(state.roomStatusTimer);
            state.roomStatusTimer = null;
        }
        state.roomStatusPollIntervalMs = 0;
    }

    function startParticipantHeartbeat() {
        stopParticipantHeartbeat();
        state.participantHeartbeatTimer = window.setInterval(() => {
            sendParticipantHeartbeat().catch(() => {});
        }, 15000);
    }

    function stopParticipantHeartbeat() {
        if (state.participantHeartbeatTimer) {
            clearInterval(state.participantHeartbeatTimer);
            state.participantHeartbeatTimer = null;
        }
    }

    async function refreshDevices({ announceChanges = false, applyActiveTracks = false } = {}) {
        if (!navigator.mediaDevices?.enumerateDevices) {
            renderDeviceSelect(els.cameraDevice, [], t('broadcast_room_join.device_list_unavailable', 'Aygıt listesi şu anda alınamıyor.'));
            renderDeviceSelect(els.microphoneDevice, [], t('broadcast_room_join.device_list_unavailable', 'Aygıt listesi şu anda alınamıyor.'));
            renderDeviceSelect(els.speakerDevice, [], t('broadcast_room_join.device_list_unavailable', 'Aygıt listesi şu anda alınamıyor.'));
            return;
        }
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            state.devices.cameras = devices.filter((device) => device.kind === 'videoinput');
            state.devices.microphones = devices.filter((device) => device.kind === 'audioinput');
            state.devices.speakers = devices.filter((device) => device.kind === 'audiooutput');
            const cameraChange = renderDeviceSelect(els.cameraDevice, state.devices.cameras, t('broadcast_room.no_camera_devices', 'Kullanılabilir kamera bulunamadı'));
            const microphoneChange = renderDeviceSelect(els.microphoneDevice, state.devices.microphones, t('broadcast_room.no_microphone_devices', 'Kullanılabilir mikrofon bulunamadı'));
            renderDeviceSelect(els.speakerDevice, state.devices.speakers, t('broadcast_room.no_speaker_devices', 'Kullanılabilir hoparlör bulunamadı'));
            if (announceChanges) {
                await announceAndApplyAutomaticDeviceChange('camera', cameraChange, { applyActiveTracks });
                await announceAndApplyAutomaticDeviceChange('microphone', microphoneChange, { applyActiveTracks });
            }
            updateAudioLevelLabels();
        } catch (error) {
            renderDeviceSelect(els.cameraDevice, [], t('broadcast_room_join.device_list_unavailable', 'Aygıt listesi şu anda alınamıyor.'));
            renderDeviceSelect(els.microphoneDevice, [], t('broadcast_room_join.device_list_unavailable', 'Aygıt listesi şu anda alınamıyor.'));
            renderDeviceSelect(els.speakerDevice, [], t('broadcast_room_join.device_list_unavailable', 'Aygıt listesi şu anda alınamıyor.'));
            updateAudioLevelLabels();
            setStatus(t('broadcast_room_join.device_list_refresh_failed', 'Aygıt listesi alınamadı: {error}', {
                error: formatErrorMessage(error)
            }));
        }
    }

    async function handleDeviceListChanged() {
        if (state.deviceRefreshInProgress) {
            return;
        }
        state.deviceRefreshInProgress = true;
        try {
            await refreshDevices({ announceChanges: true, applyActiveTracks: true });
        } finally {
            state.deviceRefreshInProgress = false;
        }
    }

    async function requestInitialMediaPermissions() {
        if (!navigator.mediaDevices?.getUserMedia) {
            setStatus(t('broadcast_room_join.permission_api_unavailable', 'Tarayıcı kamera ve mikrofon izin istemini desteklemiyor.'));
            return;
        }

        setStatus(t('broadcast_room_join.permission_requesting', 'Kamera ve mikrofon izni isteniyor...'));
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            try {
                stream.getTracks().forEach((track) => track.stop());
            } catch (_error) {
                // ignore stop failures
            }
            await refreshDevices();
            setStatus(t('broadcast_room_join.permission_granted', 'Kamera ve mikrofon izni verildi.'));
        } catch (error) {
            const errorName = String(error?.name || '').trim();
            if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
                setStatus(t('broadcast_room_join.permission_denied', 'Kamera veya mikrofon izni verilmedi. Tarayıcı site izinlerinden izin verip sayfayı yenileyin.'));
                return;
            }
            if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
                setStatus(t('broadcast_room_join.permission_device_busy', 'Kamera veya mikrofon şu anda başka bir uygulama tarafından kullanılıyor olabilir. OBS, EVD veya başka görüşme uygulamalarını kapatıp tekrar deneyin.'));
                return;
            }
            setStatus(t('broadcast_room_join.permission_request_failed', 'Kamera ve mikrofon izni alınamadı: {error}', {
                error: formatErrorMessage(error)
            }));
        }
    }

    function renderDeviceSelect(selectEl, devices, fallbackLabel) {
        if (!selectEl) return { changed: false, previousValue: '', nextValue: '', nextLabel: '', hasDevices: false };
        const previousValue = String(selectEl.value || '').trim();
        const previousLabel = selectEl.options?.[selectEl.selectedIndex]?.textContent || '';
        const items = devices.length
            ? devices
            : [{ deviceId: '', label: fallbackLabel }];
        selectEl.innerHTML = items.map((item, index) => {
            const label = item.label || `${fallbackLabel} ${index + 1}`;
            return `<option value="${String(item.deviceId || '')}">${String(label)}</option>`;
        }).join('');
        if (previousValue && items.some((item) => String(item.deviceId || '') === previousValue)) {
            selectEl.value = previousValue;
        }
        selectEl.disabled = !devices.length;
        const nextValue = String(selectEl.value || '').trim();
        const nextLabel = selectEl.options?.[selectEl.selectedIndex]?.textContent || fallbackLabel;
        return {
            changed: Boolean(previousValue) && (previousValue !== nextValue || (previousLabel && previousLabel !== nextLabel)),
            previousValue,
            nextValue,
            previousLabel,
            nextLabel,
            hasDevices: devices.length > 0
        };
    }

    async function announceAndApplyAutomaticDeviceChange(kind, change, { applyActiveTracks = false } = {}) {
        if (!change?.changed) {
            return;
        }
        const isCamera = kind === 'camera';
        if (!change.hasDevices) {
            setStatus(t(
                isCamera ? 'broadcast_room_join.camera_device_lost' : 'broadcast_room_join.microphone_device_lost',
                isCamera ? 'Seçili kamera bağlantısı kesildi. Kullanılabilir başka kamera bulunamadı.' : 'Seçili mikrofon bağlantısı kesildi. Kullanılabilir başka mikrofon bulunamadı.'
            ));
            if (applyActiveTracks) {
                await postCurrentMediaState().catch(() => {});
            }
            return;
        }

        const message = t(
            isCamera ? 'broadcast_room_join.camera_device_auto_changed' : 'broadcast_room_join.microphone_device_auto_changed',
            isCamera ? 'Kamera otomatik değiştirildi: {name}' : 'Mikrofon otomatik değiştirildi: {name}',
            { name: change.nextLabel }
        );
        if (!applyActiveTracks || !state.roomConnection) {
            setStatus(message);
            return;
        }
        if (isCamera && Boolean(els.cameraEnabled?.checked)) {
            await handleCameraDeviceChange({ statusMessage: message });
        } else if (!isCamera && Boolean(els.microphoneEnabled?.checked)) {
            await handleMicrophoneDeviceChange({ statusMessage: message });
        } else {
            setStatus(message);
        }
    }


    function updateButtons() {
        const connected = Boolean(state.roomConnection);
        if (els.btnJoinRoom) {
            els.btnJoinRoom.disabled = connected || joinInProgress;
            els.btnJoinRoom.hidden = connected;
        }
        if (els.btnLeaveRoom) {
            els.btnLeaveRoom.disabled = !connected || joinInProgress;
            els.btnLeaveRoom.hidden = !connected;
        }
        if (els.btnChatSendAll) {
            els.btnChatSendAll.disabled = !connected || joinInProgress;
        }
        if (els.btnChatSendHost) {
            els.btnChatSendHost.disabled = !connected || joinInProgress;
        }
        if (els.btnHandRaise) {
            els.btnHandRaise.disabled = !connected || joinInProgress;
        }
        updateHandRaiseButtonUi();
        updateScreenShareControls();
        updateJoinMediaToggleButtons();
    }

    function isEditableShortcutTarget(target) {
        const tagName = String(target?.tagName || '').toUpperCase();
        return tagName === 'INPUT'
            || tagName === 'TEXTAREA'
            || tagName === 'SELECT'
            || target?.isContentEditable === true;
    }

    async function toggleGuestCameraShortcut() {
        if (!els.cameraEnabled || els.cameraEnabled.disabled) {
            return;
        }
        els.cameraEnabled.checked = !els.cameraEnabled.checked;
        await handleCameraToggleChange();
        announceLocalMediaToggleResult('camera');
    }

    async function toggleGuestMicrophoneShortcut() {
        if (!els.microphoneEnabled || els.microphoneEnabled.disabled) {
            return;
        }
        els.microphoneEnabled.checked = !els.microphoneEnabled.checked;
        await handleMicrophoneToggleChange();
        announceLocalMediaToggleResult('microphone');
    }

    function focusScreenShareSection() {
        els.btnStartScreenShare?.focus();
        if (els.screenShareSection?.scrollIntoView) {
            els.screenShareSection.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        setStatus(t('broadcast_room_join.screen_share_section_focused', 'Ekran paylaşımı bölümü odaklandı.'));
    }

    async function handleGuestShareShortcut() {
        if (isScreenShareActive()) {
            await stopScreenShare();
            return;
        }
        focusScreenShareSection();
    }

    function clearLocalPreview() {
        if (!els.localPreview) return;
        try {
            state.localVideoTrack?.detach?.(els.localPreview);
        } catch (_error) {
            // Clearing srcObject below is sufficient for older LiveKit clients.
        }
        try { els.localPreview.pause(); } catch (_error) {}
        els.localPreview.srcObject = null;
    }

    function syncLocalCameraPreview() {
        if (!els.localPreview) return;
        const cameraEnabled = Boolean(els.cameraEnabled?.checked);
        const localTrack = state.localVideoTrack;
        const nativeTrack = getNativeVideoTrackFromLocalTrack(localTrack);
        const cameraActive = cameraEnabled
            && !!localTrack
            && (!nativeTrack || nativeTrack.readyState === 'live');
        if (!cameraActive) {
            clearLocalPreview();
            return;
        }

        els.localPreview.muted = true;
        els.localPreview.defaultMuted = true;
        els.localPreview.autoplay = true;
        els.localPreview.playsInline = true;
        const attachedTrack = els.localPreview.srcObject?.getVideoTracks?.()[0] || null;
        if (!attachedTrack || (nativeTrack && attachedTrack.id !== nativeTrack.id)) {
            try {
                localTrack.attach(els.localPreview);
            } catch (_error) {
                if (nativeTrack) {
                    els.localPreview.srcObject = new MediaStream([nativeTrack]);
                }
            }
        }
        const playPromise = els.localPreview.play?.();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});
        }
    }

    function getParticipantRecord(identity) {
        const key = String(identity || '').trim();
        return (Array.isArray(state.participants) ? state.participants : [])
            .find((item) => String(item?.identity || '').trim() === key) || null;
    }

    function getParticipantAvatarUrl(identity) {
        if (String(identity || '').trim() === String(state.participantIdentity || '').trim()) {
            return String(state.avatarUrl || state.avatarDataUrl || '').trim();
        }
        return String(getParticipantRecord(identity)?.avatarUrl || '').trim();
    }

    function getParticipantInitials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join('').toLocaleUpperCase(state.lang || 'tr');
        return `${Array.from(parts[0])[0] || ''}${Array.from(parts.at(-1))[0] || ''}`.toLocaleUpperCase(state.lang || 'tr');
    }

    function getParticipantAvatarHue(identity, name) {
        const value = `${String(identity || '')}|${String(name || '')}`;
        let hash = 0;
        for (const character of value) hash = ((hash * 31) + character.codePointAt(0)) >>> 0;
        return hash % 360;
    }

    function appendParticipantAvatar(container, { identity = '', name = '' } = {}) {
        const card = document.createElement('div');
        card.className = 'participant-avatar-card';
        const avatarUrl = getParticipantAvatarUrl(identity);
        if (avatarUrl) {
            const image = document.createElement('img');
            image.className = 'participant-avatar-image';
            image.src = avatarUrl;
            image.alt = t('broadcast_room_join.participant_avatar_alt', '{name} profil fotoğrafı', { name });
            image.addEventListener('error', () => image.remove(), { once: true });
            card.appendChild(image);
        } else {
            const initials = document.createElement('span');
            initials.className = 'participant-avatar-initials';
            initials.setAttribute('aria-hidden', 'true');
            initials.textContent = getParticipantInitials(name);
            initials.style.setProperty('--participant-avatar-hue', String(getParticipantAvatarHue(identity, name)));
            card.appendChild(initials);
        }
        const label = document.createElement('span');
        label.className = 'participant-avatar-name';
        label.textContent = name;
        card.appendChild(label);
        container.appendChild(card);
    }

    function renderLocalAvatarFallback() {
        const holder = document.getElementById('local-avatar-fallback');
        if (!holder || !els.localPreview) return;
        const nativeTrack = getNativeVideoTrackFromLocalTrack(state.localVideoTrack);
        const cameraActive = !!state.localVideoTrack
            && Boolean(els.cameraEnabled?.checked)
            && (!nativeTrack || nativeTrack.readyState === 'live');
        if (cameraActive) {
            syncLocalCameraPreview();
        }
        els.localPreview.hidden = !cameraActive;
        holder.hidden = cameraActive;
        if (!cameraActive) {
            holder.innerHTML = '';
            appendParticipantAvatar(holder, {
                identity: state.participantIdentity,
                name: String(els.joinedDisplayName?.value || els.displayName?.value || t('broadcast_room_join.you_label', 'Siz')).trim()
            });
        }
    }

    async function resizeAvatarFile(file) {
        if (!file || !/^image\/(?:jpeg|png|webp)$/i.test(file.type || '')) {
            throw new Error('participant_avatar_invalid');
        }
        const sourceUrl = URL.createObjectURL(file);
        try {
            const image = new Image();
            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = reject;
                image.src = sourceUrl;
            });
            const maxSide = 512;
            const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/jpeg', 0.86);
        } finally {
            URL.revokeObjectURL(sourceUrl);
        }
    }

    async function syncParticipantAvatar({ clear = false } = {}) {
        if (!state.room?.roomId || !state.participantIdentity) return;
        const response = await fetch('/api/broadcast-room/participant-avatar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                roomId: state.room.roomId,
                identity: state.participantIdentity,
                dataUrl: clear ? '' : state.avatarDataUrl,
                clear
            })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) throw new Error(payload.error || 'participant_avatar_failed');
        state.avatarUrl = String(payload.avatarUrl || '');
        state.participants = Array.isArray(payload.participants) ? payload.participants : state.participants;
        renderLocalAvatarFallback();
        await renderRemoteParticipants();
    }

    async function handleParticipantAvatarSelection() {
        const file = els.participantAvatarFile?.files?.[0] || null;
        if (!file) return;
        try {
            state.avatarDataUrl = await resizeAvatarFile(file);
            state.avatarFileName = file.name || '';
            if (els.participantAvatarStatus) {
                els.participantAvatarStatus.textContent = t('broadcast_room_join.participant_avatar_selected', 'Seçili fotoğraf: {name}.', { name: state.avatarFileName });
            }
            if (state.roomConnection) await syncParticipantAvatar();
            renderLocalAvatarFallback();
        } catch (error) {
            setStatus(t('broadcast_room_join.participant_avatar_failed', 'Fotoğraf hazırlanamadı: {error}', { error: formatErrorMessage(error) }));
        }
    }

    async function removeParticipantAvatar() {
        state.avatarDataUrl = '';
        state.avatarUrl = '';
        state.avatarFileName = '';
        if (els.participantAvatarFile) els.participantAvatarFile.value = '';
        if (state.roomConnection) await syncParticipantAvatar({ clear: true }).catch(() => {});
        if (els.participantAvatarStatus) {
            els.participantAvatarStatus.textContent = t('broadcast_room_join.participant_avatar_empty', 'Fotoğraf seçilmedi. Kamera kapalıyken adınız gösterilir.');
        }
        renderLocalAvatarFallback();
    }

    function getRemoteParticipantLabel(participantState) {
        return String(participantState?.name || participantState?.identity || '').trim()
            || t('broadcast_room_join.host_fallback', 'Host');
    }

    function getParticipantDisplayNameByIdentity(identity) {
        const normalizedIdentity = String(identity || '').trim();
        if (!normalizedIdentity) {
            return '';
        }
        if (normalizedIdentity === String(state.participantIdentity || '').trim()) {
            return String(els.displayName?.value || '').trim()
                || t('broadcast_room_join.you_label', 'Siz');
        }
        const participant = (Array.isArray(state.participants) ? state.participants : [])
            .find((item) => String(item?.identity || '').trim() === normalizedIdentity);
        if (participant) {
            return String(participant.displayName || participant.identity || '').trim();
        }
        const remoteParticipant = state.remoteParticipants?.[normalizedIdentity];
        if (remoteParticipant) {
            return getRemoteParticipantLabel(remoteParticipant);
        }
        return normalizedIdentity;
    }

    function announceCurrentSpeaker() {
        if (!state.roomConnection) {
            setStatus(t('broadcast_room_join.current_speaker_not_connected', 'Konuşanı öğrenmek için önce odaya katılın.'));
            return;
        }
        const speakers = (Array.isArray(state.activeSpeakerIdentities) ? state.activeSpeakerIdentities : [])
            .map((identity) => getParticipantDisplayNameByIdentity(identity))
            .filter(Boolean);
        if (!speakers.length) {
            setStatus(t('broadcast_room_join.current_speaker_none', 'Şu anda konuşan algılanmadı.'));
            return;
        }
        const message = speakers.length === 1
            ? t('broadcast_room_join.current_speaker_one', 'Şu anda konuşan: {name}', { name: speakers[0] })
            : t('broadcast_room_join.current_speaker_many', 'Şu anda konuşanlar: {names}', { names: speakers.join(', ') });
        setStatus(message);
    }

    function getTrackDescriptorText(trackStateOrSource) {
        if (trackStateOrSource && typeof trackStateOrSource === 'object') {
            return [
                trackStateOrSource.source,
                trackStateOrSource.name,
                trackStateOrSource.kind
            ]
                .filter(Boolean)
                .map((value) => String(value).trim())
                .join(' ');
        }
        return String(trackStateOrSource || '').trim();
    }

    function isShareTrack(trackStateOrSource) {
        const value = getTrackDescriptorText(trackStateOrSource).toLowerCase();
        return value.includes('screen')
            || value.includes('screenshare')
            || value.includes('screen_share')
            || value.includes('guest-screen')
            || value.includes('share');
    }

    function getTrackSourceLabel(trackStateOrSource) {
        const value = getTrackDescriptorText(trackStateOrSource).toLowerCase();
        if (value.includes('screen') && value.includes('audio')) {
            return t('broadcast_room_join.track_source_screen_audio', 'Paylaşım sesi');
        }
        if (value.includes('guest-screen-audio')) {
            return t('broadcast_room_join.track_source_screen_audio', 'Paylaşım sesi');
        }
        if (value.includes('screen')) {
            return t('broadcast_room_join.track_source_screen', 'Ekran veya sahne paylaşımı');
        }
        if (value.includes('share') && value.includes('audio')) {
            return t('broadcast_room_join.track_source_screen_audio', 'Paylaşım sesi');
        }
        if (value.includes('share')) {
            return t('broadcast_room_join.track_source_screen', 'Ekran veya sahne paylaşımı');
        }
        if (value.includes('camera')) {
            return t('broadcast_room_join.track_source_camera', 'Kamera');
        }
        if (value.includes('microphone')) {
            return t('broadcast_room_join.track_source_microphone', 'Mikrofon');
        }
        return t('broadcast_room_join.track_source_extra', 'Ek medya');
    }

    function isMobileBrowser() {
        const ua = String(navigator.userAgent || '');
        return /iPhone|iPad|iPod|Android|Mobile/i.test(ua)
            || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua));
    }

    function buildVideoCaptureOptions(deviceId) {
        if (state.lowBandwidthMode) {
            return {
                deviceId: deviceId || undefined,
                width: { ideal: 640, max: 960 },
                height: { ideal: 360, max: 540 },
                frameRate: { ideal: 15, max: 20 }
            };
        }
        if (isMobileBrowser()) {
            return {
                deviceId: deviceId || undefined,
                width: { ideal: 640, max: 960 },
                height: { ideal: 360, max: 540 },
                frameRate: { ideal: 15, max: 20 }
            };
        }
        return {
            deviceId: deviceId || undefined,
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 30 }
        };
    }

    function getLiveKitVideoQuality(name) {
        const client = window.LivekitClient || {};
        const qualityMap = client.VideoQuality || {};
        const normalized = String(name || '').trim().toUpperCase();
        return qualityMap[normalized] !== undefined ? qualityMap[normalized] : String(name || '').trim().toLowerCase();
    }

    function getPreferredRemoteVideoQuality(participantIdentity, trackStateOrPublication) {
        if (!state.lowBandwidthMode) {
            return getLiveKitVideoQuality('HIGH');
        }
        const role = getParticipantRole(participantIdentity);
        if (role === 'sign_interpreter' || isShareTrack(trackStateOrPublication)) {
            return getLiveKitVideoQuality('MEDIUM');
        }
        return getLiveKitVideoQuality('LOW');
    }

    function applyPublicationVideoQuality(publication, participantIdentity = '') {
        if (!publication) {
            return;
        }
        const quality = getPreferredRemoteVideoQuality(participantIdentity, publication);
        try {
            if (typeof publication.setVideoQuality === 'function') {
                publication.setVideoQuality(quality);
            }
        } catch (_error) {
            // Older LiveKit builds may not expose receiver quality controls.
        }
    }

    function applyRemoteVideoQualityPreferences() {
        const room = state.roomConnection;
        if (!room?.remoteParticipants) {
            return;
        }
        try {
            room.remoteParticipants.forEach((participant) => {
                participant?.trackPublications?.forEach((publication) => {
                    const kind = String(publication?.kind || publication?.track?.kind || '').trim();
                    if (kind === 'video') {
                        applyPublicationVideoQuality(publication, participant?.identity || '');
                    }
                });
            });
        } catch (_error) {
            // Quality controls are best effort; playback should continue even if unavailable.
        }
    }

    function buildAudioCaptureOptions(deviceId) {
        return {
            deviceId: deviceId || undefined,
            channelCount: { ideal: 2 },
            sampleRate: 48000,
            volume: getMicrophoneVolume(),
            echoCancellation: state.microphoneEchoCancellation,
            noiseSuppression: state.microphoneNoiseSuppression,
            autoGainControl: state.microphoneAutoGainControl
        };
    }

    async function handleMicrophoneProcessingChange() {
        state.microphoneEchoCancellation = Boolean(els.microphoneEchoCancellation?.checked);
        state.microphoneNoiseSuppression = Boolean(els.microphoneNoiseSuppression?.checked);
        state.microphoneAutoGainControl = Boolean(els.microphoneAutoGainControl?.checked);
        saveStoredBoolean(MICROPHONE_ECHO_CANCELLATION_STORAGE_KEY, state.microphoneEchoCancellation);
        saveStoredBoolean(MICROPHONE_NOISE_SUPPRESSION_STORAGE_KEY, state.microphoneNoiseSuppression);
        saveStoredBoolean(MICROPHONE_AUTO_GAIN_CONTROL_STORAGE_KEY, state.microphoneAutoGainControl);

        const message = t('broadcast_room_join.microphone_processing_updated', 'Mikrofon sinyal işleme ayarları güncellendi.');
        if (state.audioTest.microphoneStream) {
            stopMicrophoneTest({ announceStatus: false });
        }
        await handleMicrophoneDeviceChange({ statusMessage: message });
    }

    function getScreenShareAudioMode() {
        const mode = String(els.screenShareAudioMode?.value || 'echo_safe').trim();
        return mode === 'high_quality' ? 'high_quality' : 'echo_safe';
    }

    function isHighQualityShareAudioMode() {
        return getScreenShareAudioMode() === 'high_quality';
    }

    function buildScreenShareConstraints(includeAudio) {
        const highQualityAudio = isHighQualityShareAudioMode();
        return {
            selfBrowserSurface: 'exclude',
            systemAudio: 'include',
            windowAudio: 'window',
            surfaceSwitching: 'include',
            video: {
                frameRate: { ideal: 30, max: 60 },
                width: { ideal: 1920, max: 3840 },
                height: { ideal: 1080, max: 2160 }
            },
            audio: includeAudio ? {
                channelCount: { ideal: 2 },
                sampleRate: 48000,
                echoCancellation: !highQualityAudio,
                noiseSuppression: !highQualityAudio,
                autoGainControl: false
            } : false
        };
    }

    async function applyBestEffortStereoToTrack(track) {
        if (!track || typeof track.applyConstraints !== 'function') {
            return;
        }
        try {
            await track.applyConstraints({
                channelCount: 2,
                sampleRate: 48000,
                echoCancellation: !isHighQualityShareAudioMode(),
                noiseSuppression: !isHighQualityShareAudioMode(),
                autoGainControl: false
            });
        } catch (_error) {
            // Best effort only.
        }
    }

    function getTrackSettingsForDiagnostics(track) {
        const nativeTrack = track?.mediaStreamTrack || track?._mediaStreamTrack || null;
        if (!nativeTrack || typeof nativeTrack.getSettings !== 'function') {
            return {};
        }
        try {
            return nativeTrack.getSettings() || {};
        } catch (_error) {
            return {};
        }
    }

    function getStatsReceiverFromTrackState(trackState) {
        return trackState?.publication?.receiver
            || trackState?.track?.receiver
            || trackState?.track?._receiver
            || null;
    }

    function updateQualityAggregateFromReport(aggregate, report) {
        if (!report || typeof report.forEach !== 'function') {
            return;
        }
        report.forEach((stat) => {
            const type = String(stat?.type || '').trim();
            const kind = String(stat?.kind || stat?.mediaType || '').trim();
            if (type === 'inbound-rtp') {
                if (kind === 'video') {
                    aggregate.video.packetsLost += Number(stat.packetsLost || 0);
                    aggregate.video.packetsReceived += Number(stat.packetsReceived || 0);
                    aggregate.video.bytesReceived += Number(stat.bytesReceived || 0);
                    aggregate.video.framesDecoded += Number(stat.framesDecoded || 0);
                    aggregate.video.framesDropped += Number(stat.framesDropped || 0);
                    aggregate.video.freezeCount += Number(stat.freezeCount || 0);
                    aggregate.video.totalFreezesDuration += Number(stat.totalFreezesDuration || 0);
                    aggregate.video.jitter = Math.max(aggregate.video.jitter, Number(stat.jitter || 0));
                    aggregate.video.frameWidth = Math.max(aggregate.video.frameWidth, Number(stat.frameWidth || 0));
                    aggregate.video.frameHeight = Math.max(aggregate.video.frameHeight, Number(stat.frameHeight || 0));
                    aggregate.video.framesPerSecond = Math.max(aggregate.video.framesPerSecond, Number(stat.framesPerSecond || 0));
                } else if (kind === 'audio') {
                    aggregate.audio.packetsLost += Number(stat.packetsLost || 0);
                    aggregate.audio.packetsReceived += Number(stat.packetsReceived || 0);
                    aggregate.audio.bytesReceived += Number(stat.bytesReceived || 0);
                    aggregate.audio.jitter = Math.max(aggregate.audio.jitter, Number(stat.jitter || 0));
                }
            }
        });
    }

    function getQualitySeverity(aggregate) {
        const videoTotal = aggregate.video.packetsReceived + aggregate.video.packetsLost;
        const audioTotal = aggregate.audio.packetsReceived + aggregate.audio.packetsLost;
        const videoLoss = videoTotal > 0 ? aggregate.video.packetsLost / videoTotal : 0;
        const audioLoss = audioTotal > 0 ? aggregate.audio.packetsLost / audioTotal : 0;
        const jitter = Math.max(aggregate.video.jitter, aggregate.audio.jitter);
        if (videoLoss >= 0.08 || audioLoss >= 0.08 || jitter >= 0.12 || aggregate.video.freezeCount >= 3) {
            return 'poor';
        }
        if (videoLoss >= 0.03 || audioLoss >= 0.03 || jitter >= 0.06 || aggregate.video.freezeCount >= 1) {
            return 'fair';
        }
        return 'good';
    }

    async function collectConnectionQualityReport() {
        const participants = Object.values(state.remoteParticipants || {});
        const aggregate = {
            updatedAt: Date.now(),
            lowBandwidthMode: state.lowBandwidthMode === true,
            connectionState: String(state.roomConnection?.state || state.roomConnection?.connectionState || '').trim(),
            remoteParticipantCount: participants.length,
            remoteVideoTrackCount: 0,
            remoteAudioTrackCount: 0,
            video: {
                packetsLost: 0,
                packetsReceived: 0,
                bytesReceived: 0,
                framesDecoded: 0,
                framesDropped: 0,
                freezeCount: 0,
                totalFreezesDuration: 0,
                jitter: 0,
                frameWidth: 0,
                frameHeight: 0,
                framesPerSecond: 0
            },
            audio: {
                packetsLost: 0,
                packetsReceived: 0,
                bytesReceived: 0,
                jitter: 0
            }
        };

        for (const participantState of participants) {
            const videoTracks = Array.isArray(participantState.videoTracks) ? participantState.videoTracks : [];
            const audioTracks = Array.isArray(participantState.audioTracks) ? participantState.audioTracks : [];
            aggregate.remoteVideoTrackCount += videoTracks.length;
            aggregate.remoteAudioTrackCount += audioTracks.length;
            for (const trackState of [...videoTracks, ...audioTracks]) {
                const receiver = getStatsReceiverFromTrackState(trackState);
                if (!receiver || typeof receiver.getStats !== 'function') {
                    continue;
                }
                try {
                    updateQualityAggregateFromReport(aggregate, await receiver.getStats());
                } catch (_error) {
                    // Some browsers hide receiver stats; keep the rest of the report.
                }
            }
        }

        aggregate.severity = getQualitySeverity(aggregate);
        return aggregate;
    }

    async function sendConnectionQualityReport({ force = false } = {}) {
        if (!state.roomConnection || !state.room?.roomId || !state.participantIdentity) {
            return;
        }
        const now = Date.now();
        if (!force && now - Number(state.lastQualityStatsSentAt || 0) < 9000) {
            return;
        }
        state.lastQualityStatsSentAt = now;
        try {
            state.lastQualityReport = await collectConnectionQualityReport();
            await postParticipantState({
                cameraEnabled: Boolean(els.cameraEnabled?.checked) && !!state.localVideoTrack,
                microphoneEnabled: Boolean(els.microphoneEnabled?.checked) && !!state.localAudioTrack,
                shareEnabled: isScreenShareActive(),
                shareAudioEnabled: !!state.screenShareAudioTrack,
                shareSourceType: state.screenShareSourceType,
                shareStereoRequested: !!state.screenShareAudioTrack,
                connected: true,
                connectionQuality: getCurrentConnectionQualityPayload()
            });
        } catch (_error) {
            // Diagnostics should never interrupt the meeting.
        }
    }

    function startConnectionQualityDiagnostics() {
        stopConnectionQualityDiagnostics();
        const intervalMs = isMobileBrowser() ? 30000 : 15000;
        state.qualityStatsTimer = window.setInterval(() => {
            sendConnectionQualityReport().catch(() => {});
        }, intervalMs);
        sendConnectionQualityReport({ force: true }).catch(() => {});
    }

    function stopConnectionQualityDiagnostics() {
        if (state.qualityStatsTimer) {
            clearInterval(state.qualityStatsTimer);
            state.qualityStatsTimer = null;
        }
        state.lastQualityStatsSentAt = 0;
    }

    function scheduleRemoteVideoRecovery(video, trackState, key) {
        const recoveryKey = String(key || trackState?.sid || '').trim();
        if (!recoveryKey || state.remoteVideoRecoveryTimers[recoveryKey]) {
            return;
        }
        state.remoteVideoRecoveryTimers[recoveryKey] = window.setTimeout(() => {
            delete state.remoteVideoRecoveryTimers[recoveryKey];
            if (!document.body.contains(video) || !trackState?.track) {
                return;
            }
            try {
                trackState.track.detach(video);
            } catch (_error) {
                // Best effort recovery.
            }
            try {
                trackState.track.attach(video);
                const playPromise = video.play?.();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch(() => {});
                }
            } catch (_error) {
                // Keep the existing element even if recovery is unsupported.
            }
            sendConnectionQualityReport({ force: true }).catch(() => {});
        }, 1800);
    }

    function bindRemoteVideoRecovery(video, trackState, key) {
        if (!video || !trackState?.track) {
            return;
        }
        const schedule = () => scheduleRemoteVideoRecovery(video, trackState, key);
        video.addEventListener('stalled', schedule);
        video.addEventListener('waiting', schedule);
        video.addEventListener('suspend', schedule);
        video.addEventListener('error', schedule);
    }

    function isScreenShareAudioTrack(trackState) {
        const descriptor = getTrackDescriptorText(trackState).toLowerCase();
        return descriptor.includes('screen_share_audio')
            || descriptor.includes('screenshareaudio')
            || descriptor.includes('share audio')
            || (descriptor.includes('share') && descriptor.includes('audio'))
            || (descriptor.includes('screen') && descriptor.includes('audio'));
    }

    function announceRemoteShareAudioDiagnostics(trackState, participantState) {
        if (!trackState || !isScreenShareAudioTrack(trackState)) {
            return;
        }
        const diagnosticKey = String(trackState.sid || '');
        if (!diagnosticKey || state.lastRemoteShareAudioDiagnosticKey === diagnosticKey) {
            return;
        }
        state.lastRemoteShareAudioDiagnosticKey = diagnosticKey;
        const settings = getTrackSettingsForDiagnostics(trackState.track);
        const channelCount = Number(settings?.channelCount || 0);
        const sampleRate = Number(settings?.sampleRate || 0);
        setStatus(t(
            'broadcast_room_join.remote_share_audio_diagnostics',
            '{name} paylaşım sesi alındı. Kanal: {channelCount}, örnekleme: {sampleRate} Hz. Stereo testi için mümkünse iki kulaklı bir çıkış kullanın.',
            {
                name: getRemoteParticipantLabel(participantState),
                channelCount: channelCount > 0 ? String(channelCount) : t('broadcast_room_join.value_not_available', 'Hazır değil'),
                sampleRate: sampleRate > 0 ? String(sampleRate) : t('broadcast_room_join.value_not_available', 'Hazır değil')
            }
        ));
    }

    function detectScreenShareSourceType(videoTrack) {
        const displaySurface = String(videoTrack?.getSettings?.().displaySurface || '').trim().toLowerCase();
        if (displaySurface === 'window') {
            return 'window';
        }
        if (displaySurface === 'browser') {
            return 'browser';
        }
        if (displaySurface === 'monitor') {
            return 'screen';
        }
        return 'screen';
    }

    async function applySpeakerSelectionToElement(mediaEl, { reportError = true } = {}) {
        const selectedSpeakerId = String(els.speakerDevice?.value || '').trim();
        if (!mediaEl || !selectedSpeakerId || typeof mediaEl.setSinkId !== 'function') {
            return true;
        }
        try {
            await mediaEl.setSinkId(selectedSpeakerId);
            return true;
        } catch (error) {
            if (reportError) {
                setStatus(t('broadcast_room_join.speaker_apply_failed', 'Seçili hoparlör uygulanamadı: {error}', {
                    error: formatErrorMessage(error)
                }));
            }
            return false;
        }
    }

    async function applySpeakerSelectionToRemoteAudioElements() {
        const audioElements = Array.from(els.remoteAudioHost?.querySelectorAll?.('audio') || []);
        let reportedError = false;
        for (const audio of audioElements) {
            const applied = await applySpeakerSelectionToElement(audio, { reportError: !reportedError });
            if (!applied) {
                reportedError = true;
            }
        }
    }

    function closeMonitorAudioSocket() {
        const socket = state.monitorAudioSocket;
        state.monitorAudioSocket = null;
        if (socket) {
            try {
                socket.onopen = null;
                socket.onmessage = null;
                socket.onclose = null;
                socket.onerror = null;
                socket.close();
            } catch (_error) {}
        }
        if (state.monitorAudioContext) {
            try { state.monitorAudioContext.close(); } catch (_error) {}
        }
        state.monitorAudioContext = null;
        state.monitorAudioScheduledTime = 0;
        state.monitorAudioChunkCount = 0;
    }

    function ensureMonitorAudioContext() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            return null;
        }
        if (!state.monitorAudioContext) {
            state.monitorAudioContext = new AudioContextClass({ sampleRate: 48000 });
            state.monitorAudioScheduledTime = 0;
        }
        state.monitorAudioContext.resume?.().catch?.(() => {});
        return state.monitorAudioContext;
    }

    function playMonitorAudioChunk(arrayBuffer) {
        const audioContext = ensureMonitorAudioContext();
        if (!audioContext || !arrayBuffer || arrayBuffer.byteLength < 4) {
            return;
        }
        const sampleView = new Int16Array(arrayBuffer);
        const frameCount = Math.floor(sampleView.length / 2);
        if (frameCount <= 0) {
            return;
        }
        const audioBuffer = audioContext.createBuffer(2, frameCount, 48000);
        const left = audioBuffer.getChannelData(0);
        const right = audioBuffer.getChannelData(1);
        for (let frame = 0; frame < frameCount; frame += 1) {
            left[frame] = sampleView[frame * 2] / 32768;
            right[frame] = sampleView[frame * 2 + 1] / 32768;
        }
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        const gain = audioContext.createGain();
        gain.gain.value = getSpeakerVolume();
        source.connect(gain);
        gain.connect(audioContext.destination);
        const currentTime = audioContext.currentTime;
        if (!state.monitorAudioScheduledTime || state.monitorAudioScheduledTime < currentTime + 0.08 || state.monitorAudioScheduledTime > currentTime + 1.5) {
            state.monitorAudioScheduledTime = currentTime + 0.16;
        }
        source.start(state.monitorAudioScheduledTime);
        state.monitorAudioScheduledTime += audioBuffer.duration;
        state.monitorAudioChunkCount += 1;
    }

    function parsePcmSampleRate(mimeType) {
        const match = String(mimeType || '').match(/rate=(\d+)/i);
        return match ? Math.max(8000, Number(match[1] || 24000)) : 24000;
    }

    function base64ToArrayBuffer(base64) {
        const binary = window.atob(String(base64 || ''));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes.buffer;
    }

    function ensureTranslationAudioContext() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            return null;
        }
        if (!state.translationAudioContext || state.translationAudioContext.state === 'closed') {
            state.translationAudioContext = new AudioContextClass();
            state.translationAudioScheduledTime = 0;
        }
        state.translationAudioContext.resume?.().catch?.(() => {});
        return state.translationAudioContext;
    }

    function closeTranslationAudioSocket({ closeContext = false } = {}) {
        const socket = state.translationAudioSocket;
        state.translationAudioSocket = null;
        if (socket) {
            try {
                socket.onopen = null;
                socket.onmessage = null;
                socket.onclose = null;
                socket.onerror = null;
                socket.close();
            } catch (_error) {}
        }
        if (closeContext && state.translationAudioContext) {
            try { state.translationAudioContext.close(); } catch (_error) {}
            state.translationAudioContext = null;
            state.translationAudioScheduledTime = 0;
        }
    }

    function resetTranslationAudioPlaybackState({ closeContext = false } = {}) {
        state.lastTranslationAudioSequence = 0;
        state.lastTranslationAudioSequenceByTarget = {};
        state.lastTranslationAudioReceivedAtByTarget = {};
        state.translationAudioScheduledTime = 0;
        if (closeContext && state.translationAudioContext) {
            try { state.translationAudioContext.close(); } catch (_error) {}
            state.translationAudioContext = null;
        }
    }

    function shouldPlayTranslationAudio(payload = {}) {
        if (!state.liveCaptionViewEnabled || !isVoiceTranslationMode()) {
            return false;
        }
        const targetLanguage = getNormalizedLanguageCode(payload.targetLanguage || state.liveCaption?.targetLanguage);
        const sourceLanguage = getNormalizedLanguageCode(payload.sourceLanguage || state.liveCaption?.sourceLanguage);
        const preferredLanguage = getNormalizedLanguageCode(state.liveCaptionPreferredLanguage);
        if (!targetLanguage || !preferredLanguage || targetLanguage !== preferredLanguage) {
            return false;
        }
        if (sourceLanguage && sourceLanguage !== 'auto' && sourceLanguage === preferredLanguage) {
            return false;
        }
        if (sourceLanguage && sourceLanguage !== 'auto' && sourceLanguage === targetLanguage) {
            return false;
        }
        return true;
    }

    function playTranslationAudioBuffer(arrayBuffer, payload = {}) {
        const audioContext = ensureTranslationAudioContext();
        if (!audioContext || !arrayBuffer || arrayBuffer.byteLength < 2) {
            return;
        }
        const pcm = new Int16Array(arrayBuffer);
        if (!pcm.length) {
            return;
        }
        const sampleRate = parsePcmSampleRate(payload.mimeType);
        const audioBuffer = audioContext.createBuffer(1, pcm.length, sampleRate);
        const channel = audioBuffer.getChannelData(0);
        for (let index = 0; index < pcm.length; index += 1) {
            channel[index] = Math.max(-1, Math.min(1, pcm[index] / 32768));
        }
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        const gain = audioContext.createGain();
        gain.gain.value = getSpeakerVolume();
        source.connect(gain);
        gain.connect(audioContext.destination);
        const currentTime = audioContext.currentTime;
        if (!state.translationAudioScheduledTime || state.translationAudioScheduledTime < currentTime + 0.04 || state.translationAudioScheduledTime > currentTime + 1.5) {
            state.translationAudioScheduledTime = currentTime + 0.08;
        }
        source.start(state.translationAudioScheduledTime);
        state.translationAudioScheduledTime += audioBuffer.duration;
    }

    function playTranslationAudioPayload(payload = {}) {
        if (!shouldPlayTranslationAudio(payload)) {
            return;
        }
        if (!shouldAcceptTranslationAudioSequence(payload)) {
            return;
        }
        const audioBase64 = String(payload.audioBase64 || '').trim();
        if (!audioBase64) {
            return;
        }
        playTranslationAudioBuffer(base64ToArrayBuffer(audioBase64), payload);
    }

    function shouldAcceptTranslationAudioSequence(payload = {}) {
        const sequence = Number(payload.sequence || 0) || 0;
        if (!sequence) {
            return true;
        }
        const targetLanguage = getNormalizedLanguageCode(payload.targetLanguage || state.liveCaption?.targetLanguage) || 'default';
        const lastSequenceByTarget = state.lastTranslationAudioSequenceByTarget || {};
        const lastReceivedAtByTarget = state.lastTranslationAudioReceivedAtByTarget || {};
        const lastSequence = Number(lastSequenceByTarget[targetLanguage] || 0) || 0;
        const lastReceivedAt = Number(lastReceivedAtByTarget[targetLanguage] || 0) || 0;
        const now = Date.now();
        if (lastSequence && sequence <= lastSequence) {
            const looksLikeRestartedSession = now - lastReceivedAt > 2500;
            if (!looksLikeRestartedSession) {
                return false;
            }
            state.translationAudioScheduledTime = 0;
        }
        lastSequenceByTarget[targetLanguage] = sequence;
        lastReceivedAtByTarget[targetLanguage] = now;
        state.lastTranslationAudioSequenceByTarget = lastSequenceByTarget;
        state.lastTranslationAudioReceivedAtByTarget = lastReceivedAtByTarget;
        state.lastTranslationAudioSequence = Math.max(Number(state.lastTranslationAudioSequence || 0) || 0, sequence);
        return true;
    }

    function connectTranslationAudioSocket() {
        if (!shouldPlayTranslationAudio() || typeof WebSocket === 'undefined') {
            closeTranslationAudioSocket();
            return;
        }
        if (!state.room?.roomId || !state.participantIdentity) {
            return;
        }
        if (isPersonalTranslationScope()) {
            closeTranslationAudioSocket({ closeContext: false });
            return;
        }
        if (state.translationAudioSocket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.translationAudioSocket.readyState)) {
            return;
        }
        closeTranslationAudioSocket();
        const url = new URL('/api/broadcast-room/monitor-audio', window.location.origin);
        url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        url.searchParams.set('roomId', state.room.roomId);
        url.searchParams.set('role', 'guest');
        url.searchParams.set('identity', state.participantIdentity);
        url.searchParams.set('channel', 'translation');
        const socket = new WebSocket(url.toString());
        socket.binaryType = 'arraybuffer';
        state.translationAudioSocket = socket;
        socket.onmessage = (event) => {
            if (typeof event.data === 'string') {
                return;
            }
            if (event.data instanceof Blob) {
                event.data.arrayBuffer().then((buffer) => {
                    if (shouldPlayTranslationAudio()) {
                        playTranslationAudioBuffer(buffer, {
                            targetLanguage: state.liveCaption?.targetLanguage,
                            sourceLanguage: state.liveCaption?.sourceLanguage,
                            mimeType: 'audio/pcm;rate=24000'
                        });
                    }
                }).catch(() => {});
                return;
            }
            if (shouldPlayTranslationAudio()) {
                playTranslationAudioBuffer(event.data, {
                    targetLanguage: state.liveCaption?.targetLanguage,
                    sourceLanguage: state.liveCaption?.sourceLanguage,
                    mimeType: 'audio/pcm;rate=24000'
                });
            }
        };
        socket.onclose = () => {
            if (state.translationAudioSocket === socket) {
                state.translationAudioSocket = null;
            }
        };
        socket.onerror = () => {
            if (state.translationAudioSocket === socket) {
                state.translationAudioSocket = null;
            }
        };
    }

    function isMonitorAudioEnabledByQuery() {
        const searchParams = new URLSearchParams(window.location.search || '');
        const monitorAudioValue = Array.from(searchParams.entries())
            .find(([key]) => String(key || '').trim().toLowerCase() === 'monitoraudio')?.[1] || '';
        return ['1', 'true', 'yes', 'on'].includes(String(monitorAudioValue).trim().toLowerCase());
    }

    function connectMonitorAudioSocket() {
        const monitorAudioEnabled = isMonitorAudioEnabledByQuery() || state.hostShareMonitorAudioEnabled === true;
        if (!monitorAudioEnabled) {
            closeMonitorAudioSocket();
            console.debug?.('[EVD monitor audio] disabled');
            return;
        }
        if (!state.room?.roomId || !state.participantIdentity || typeof WebSocket === 'undefined') {
            console.debug?.('[EVD monitor audio] not ready', {
                hasRoomId: !!state.room?.roomId,
                hasIdentity: !!state.participantIdentity,
                hasWebSocket: typeof WebSocket !== 'undefined'
            });
            return;
        }
        if (state.monitorAudioSocket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.monitorAudioSocket.readyState)) {
            return;
        }
        const url = new URL('/api/broadcast-room/monitor-audio', window.location.origin);
        url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        url.searchParams.set('roomId', state.room.roomId);
        url.searchParams.set('role', 'guest');
        url.searchParams.set('identity', state.participantIdentity);
        url.searchParams.set('channel', 'share');
        const socket = new WebSocket(url.toString());
        socket.binaryType = 'arraybuffer';
        state.monitorAudioSocket = socket;
        socket.onopen = () => {
            console.debug?.('[EVD monitor audio] socket open');
        };
        socket.onmessage = (event) => {
            if (typeof event.data === 'string') {
                console.debug?.('[EVD monitor audio] control message', event.data);
                return;
            }
            if (event.data instanceof Blob) {
                event.data.arrayBuffer().then((buffer) => {
                    console.debug?.('[EVD monitor audio] blob chunk', buffer.byteLength);
                    playMonitorAudioChunk(buffer);
                }).catch(() => {});
                return;
            }
            console.debug?.('[EVD monitor audio] chunk', event.data?.byteLength || 0);
            playMonitorAudioChunk(event.data);
        };
        socket.onclose = () => {
            if (state.monitorAudioSocket === socket) {
                state.monitorAudioSocket = null;
            }
            console.debug?.('[EVD monitor audio] socket close');
        };
        socket.onerror = () => {
            console.debug?.('[EVD monitor audio] socket error');
        };
    }

    function ensureRemoteParticipantState(participant) {
        const identity = String(participant?.identity || '').trim();
        if (!identity) {
            return null;
        }
        if (!state.remoteParticipants[identity]) {
            state.remoteParticipants[identity] = {
                identity,
                name: String(participant?.name || participant?.identity || '').trim(),
                videoTracks: [],
                audioTracks: []
            };
        } else if (participant?.name) {
            state.remoteParticipants[identity].name = String(participant.name || '').trim();
        }
        return state.remoteParticipants[identity];
    }

    function updateRemoteVisualActiveSpeakerState() {
        if (!els.remoteVisualStage) {
            return;
        }
        const activeIdentities = new Set(
            (Array.isArray(state.activeSpeakerIdentities) ? state.activeSpeakerIdentities : [])
                .map((identity) => String(identity || '').trim())
                .filter(Boolean)
        );
        els.remoteVisualStage.querySelectorAll('.remote-visual-tile').forEach((tile) => {
            const identity = String(tile.dataset.participantIdentity || '').trim();
            tile.classList.toggle('is-speaking', activeIdentities.has(identity));
        });
    }

    function appendRemoteVisualTile(participantState, cameraTrackState = null) {
        if (!els.remoteVisualStage) {
            return;
        }
        const tile = document.createElement('div');
        tile.className = 'remote-visual-tile';
        tile.dataset.participantIdentity = String(participantState.identity || '');

        if (cameraTrackState?.track) {
            const video = document.createElement('video');
            video.className = 'remote-visual-video';
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true;
            video.defaultMuted = true;
            cameraTrackState.track.attach(video);
            bindRemoteVideoRecovery(
                video,
                cameraTrackState,
                `visual:${participantState.identity || ''}:${cameraTrackState.sid || ''}`
            );
            const playPromise = video.play?.();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch(() => {});
            }
            tile.appendChild(video);

            const name = document.createElement('div');
            name.className = 'remote-visual-name';
            name.textContent = getRemoteParticipantLabel(participantState);
            tile.appendChild(name);
        } else {
            appendParticipantAvatar(tile, {
                identity: participantState.identity,
                name: getRemoteParticipantLabel(participantState)
            });
        }
        els.remoteVisualStage.appendChild(tile);
    }

    async function renderRemoteParticipants() {
        if (!els.remoteMediaList) {
            return;
        }

        const participants = Object.values(state.remoteParticipants || {});
        const signature = getRemoteMediaRenderSignature(participants);
        if (signature === state.remoteMediaRenderSignature) {
            updateFocusedShareView();
            return;
        }
        state.remoteMediaRenderSignature = signature;

        if (els.remoteAudioHost) {
            clearRemoteAudioMixNodes();
            els.remoteAudioHost.innerHTML = '';
        }

        if (!participants.length) {
            els.remoteMediaList.innerHTML = `<p>${t('broadcast_room_join.no_remote_media', 'Henüz başka bir katılımcı bağlanmadı.')}</p>`;
            if (els.remoteVisualStage) {
                els.remoteVisualStage.innerHTML = '';
                els.remoteVisualStage.hidden = true;
            }
            updateFocusedShareView();
            return;
        }

        els.remoteMediaList.innerHTML = '';
        if (els.remoteVisualStage) {
            els.remoteVisualStage.innerHTML = '';
            els.remoteVisualStage.hidden = false;
        }
        for (const participantState of participants) {
            const wrapper = document.createElement('section');
            wrapper.style.marginBottom = '16px';
            wrapper.style.display = 'flex';
            wrapper.style.flexDirection = 'column';
            wrapper.style.gap = '10px';
            wrapper.style.padding = '12px';
            wrapper.style.border = '1px solid #3f3f3f';
            wrapper.style.borderRadius = '12px';
            wrapper.style.background = '#111';

            const title = document.createElement('h3');
            title.textContent = getRemoteParticipantLabel(participantState);
            title.style.marginTop = '0';
            wrapper.appendChild(title);

            const videoTracks = Array.isArray(participantState.videoTracks)
                ? [...participantState.videoTracks].sort((left, right) => {
                    const leftShare = isShareTrack(left);
                    const rightShare = isShareTrack(right);
                    if (leftShare !== rightShare) {
                        return leftShare ? -1 : 1;
                    }
                    return String(left?.sid || '').localeCompare(String(right?.sid || ''));
                })
                : [];
            const cameraTrackState = videoTracks.find((trackState) => !isShareTrack(trackState)) || null;

            if (videoTracks.length > 0) {
                videoTracks.forEach((trackState, index) => {
                    const shareTrack = isShareTrack(trackState);
                    const trackLabel = document.createElement('p');
                    trackLabel.textContent = getTrackSourceLabel(trackState);
                    wrapper.appendChild(trackLabel);

                    const video = document.createElement('video');
                    video.autoplay = true;
                    video.playsInline = true;
                    video.style.width = '100%';
                    video.style.maxHeight = shareTrack && index === 0 ? '520px' : '260px';
                    video.style.minHeight = shareTrack && index === 0 ? '420px' : '220px';
                    video.style.objectFit = shareTrack ? 'contain' : 'cover';
                    video.style.background = '#111';
                    video.muted = true;
                    video.defaultMuted = true;
                    video.setAttribute('aria-label', t('broadcast_room_join.remote_participant_video_aria', '{name} video önizlemesi', {
                        name: `${getRemoteParticipantLabel(participantState)} - ${getTrackSourceLabel(trackState)}`
                    }));
                    const videoKey = `${participantState.identity || ''}:${trackState.sid || ''}`;
                    trackState.track.detach();
                    trackState.track.attach(video);
                    bindRemoteVideoRecovery(video, trackState, videoKey);
                    if (typeof video.play === 'function') {
                        const playPromise = video.play();
                        if (playPromise && typeof playPromise.catch === 'function') {
                            playPromise.catch(() => {});
                        }
                    }
                    wrapper.appendChild(video);

                    if (shareTrack) {
                        const focusButton = document.createElement('button');
                        focusButton.type = 'button';
                        focusButton.textContent = t('broadcast_room_join.focused_share_open', 'Büyük görünümde aç');
                        focusButton.setAttribute('aria-label', t('broadcast_room_join.focused_share_open_aria', '{name} paylaşımını büyük görünümde aç', {
                            name: `${getRemoteParticipantLabel(participantState)} - ${getTrackSourceLabel(trackState)}`
                        }));
                        focusButton.addEventListener('click', () => {
                            state.focusedShareDismissedKey = '';
                            openFocusedShareView({
                                key: `${participantState.identity || ''}:${trackState.sid || ''}`,
                                participantState,
                                trackState
                            });
                        });
                        wrapper.appendChild(focusButton);
                    }
                });
            } else {
                appendParticipantAvatar(wrapper, {
                    identity: participantState.identity,
                    name: getRemoteParticipantLabel(participantState)
                });
            }
            appendRemoteVisualTile(participantState, cameraTrackState);

            const audioStatus = document.createElement('p');
            audioStatus.textContent = Array.isArray(participantState.audioTracks) && participantState.audioTracks.length > 0
                ? t('broadcast_room_join.remote_media_audio_active', 'Ses akışı hazır.')
                : t('broadcast_room_join.remote_media_audio_missing', 'Ses akışı henüz gelmedi.');
            wrapper.appendChild(audioStatus);

            if (Array.isArray(participantState.audioTracks) && els.remoteAudioHost) {
                for (const trackState of participantState.audioTracks) {
                    const audio = document.createElement('audio');
                    audio.autoplay = true;
                    audio.dataset.participantIdentity = String(participantState.identity || '');
                    audio.dataset.trackSid = String(trackState.sid || '');
                    audio.volume = getRemoteAudioVolume(participantState.identity);
                    trackState.track.detach();
                    trackState.track.attach(audio);
                    syncRemoteAudioMixNode(trackState, participantState.identity, audio);
                    const playPromise = audio.play?.();
                    if (playPromise && typeof playPromise.catch === 'function') {
                        playPromise.catch(() => {});
                    }
                    // Track changes can rebuild media without a user gesture on iOS.
                    // Fall back to Safari's active output silently in that background path.
                    await applySpeakerSelectionToElement(audio, { reportError: false });
                    els.remoteAudioHost.appendChild(audio);
                }
            }

            els.remoteMediaList.appendChild(wrapper);
        }
        updateRemoteVisualActiveSpeakerState();
        updateFocusedShareView();
    }

    function bindRemoteParticipantTrack(track, participant, publication = null) {
        const participantState = ensureRemoteParticipantState(participant);
        if (!participantState || !track) {
            return;
        }
        const targetList = track.kind === 'video' ? participantState.videoTracks : participantState.audioTracks;
        const source = publication?.source || publication?.trackInfo?.source || track?.source || '';
        const sid = String(publication?.trackSid || track.sid || `${track.kind}-${Date.now()}`);
        const existingIndex = targetList.findIndex((item) => item.sid === sid);
        const nextState = {
            sid,
            source,
            name: String(publication?.name || publication?.trackName || track?.name || '').trim(),
            kind: String(track.kind || '').trim(),
            track,
            publication
        };
        if (track.kind === 'video') {
            if (existingIndex >= 0) participantState.videoTracks[existingIndex] = nextState;
            else participantState.videoTracks.push(nextState);
            applyPublicationVideoQuality(publication, participantState.identity);
        } else if (track.kind === 'audio') {
            if (existingIndex >= 0) participantState.audioTracks[existingIndex] = nextState;
            else participantState.audioTracks.push(nextState);
            announceRemoteShareAudioDiagnostics(nextState, participantState);
        }
        renderRemoteParticipants().catch(() => {});
    }

    function unbindRemoteParticipantTrack(track, participant, publication = null) {
        const identity = String(participant?.identity || '').trim();
        const participantState = identity ? state.remoteParticipants[identity] : null;
        if (!participantState || !track) {
            return;
        }
        const sid = String(publication?.trackSid || track.sid || '');
        const removedFocusedShare = state.focusedShareKey
            && state.focusedShareKey === `${identity}:${sid}`;
        if (track.kind === 'video') {
            participantState.videoTracks = participantState.videoTracks.filter((item) => {
                const itemSid = String(item?.sid || '');
                if (sid && itemSid === sid) {
                    return false;
                }
                return item?.track !== track;
            });
        } else if (track.kind === 'audio') {
            participantState.audioTracks = participantState.audioTracks.filter((item) => {
                const itemSid = String(item?.sid || '');
                if (sid && itemSid === sid) {
                    return false;
                }
                return item?.track !== track;
            });
        }
        // Keep camera-off participants in the media list so their avatar/name
        // remains visible until an actual participant disconnect event arrives.
        if (removedFocusedShare || !getFocusedShareTrackState()) {
            state.focusedShareDismissedKey = '';
            closeFocusedShareView({ dismiss: false });
        }
        renderRemoteParticipants().catch(() => {});
    }

    async function stopScreenShare(options = {}) {
        const {
            announceStatus = true,
            statusMessage = '',
            notifyState = true
        } = options;

        const room = state.roomConnection;

        if (room && state.screenShareVideoTrack) {
            try {
                await room.localParticipant.unpublishTrack(state.screenShareVideoTrack);
            } catch (_error) {
                // ignore unpublish failures
            }
        }
        if (room && state.screenShareAudioTrack) {
            try {
                await room.localParticipant.unpublishTrack(state.screenShareAudioTrack);
            } catch (_error) {
                // ignore unpublish failures
            }
        }

        const tracksToStop = [
            state.screenShareVideoTrack,
            state.screenShareAudioTrack,
            ...(state.screenShareStream ? state.screenShareStream.getTracks() : [])
        ].filter(Boolean);
        const uniqueTracks = Array.from(new Set(tracksToStop));
        uniqueTracks.forEach((track) => {
            try {
                track.onended = null;
                track.stop();
            } catch (_error) {
                // ignore stop failures
            }
        });

        state.screenShareVideoTrack = null;
        state.screenShareAudioTrack = null;
        state.screenShareStream = null;
        state.screenShareSourceType = '';

        if (notifyState && state.roomConnection) {
            await postParticipantState({
                cameraEnabled: Boolean(els.cameraEnabled?.checked) && !!state.localVideoTrack,
                microphoneEnabled: Boolean(els.microphoneEnabled?.checked) && !!state.localAudioTrack,
                shareEnabled: false,
                shareAudioEnabled: false,
                shareSourceType: '',
                shareStereoRequested: false,
                connected: true
            });
        }

        updateScreenShareControls();
        if (statusMessage) {
            setStatus(statusMessage);
        } else if (announceStatus) {
            setStatus(t('broadcast_room_join.screen_share_stopped', 'Ekran paylaşımı durduruldu.'));
        }
    }

    async function startScreenShare() {
        if (!state.roomConnection) {
            setStatus(t('broadcast_room_join.screen_share_waiting_connection', 'Ekran paylaşımı için önce odaya katılın.'));
            return;
        }
        if (state.canPublishMedia === false) {
            setStatus(t('broadcast_room_join.webinar_audience_media_disabled', 'Webinar izleyicisi olarak katıldınız. Kamera, mikrofon ve ekran paylaşımı host onayıyla açılır.'));
            return;
        }
        if (state.allowGuestScreenShare === false) {
            setStatus(t('broadcast_room_join.screen_share_not_allowed', 'Host şu anda konuk ekran paylaşımına izin vermiyor.'));
            return;
        }
        if (!navigator.mediaDevices?.getDisplayMedia) {
            setStatus(t('broadcast_room_join.screen_share_unsupported', 'Bu tarayıcı ekran paylaşımını desteklemiyor.'));
            return;
        }
        if (isScreenShareActive()) {
            setStatus(t('broadcast_room_join.screen_share_active', 'Ekran paylaşımı şu anda açık.'));
            return;
        }

        const includeAudio = true;
        setStatus(includeAudio
            ? t('broadcast_room_join.screen_share_requesting_with_audio', 'Ekran paylaşımı seçimi bekleniyor... Tarayıcı bu seçimde paylaşım sesi sunarsa dahil edilmeye çalışılacak.')
            : t('broadcast_room_join.screen_share_requesting', 'Ekran paylaşımı seçimi bekleniyor...'));

        try {
            const shareStream = await navigator.mediaDevices.getDisplayMedia(buildScreenShareConstraints(includeAudio));
            const videoTrack = shareStream.getVideoTracks()[0] || null;
            const audioTrack = shareStream.getAudioTracks()[0] || null;
            if (!videoTrack) {
                throw new Error('screen_share_video_missing');
            }

            await applyBestEffortStereoToTrack(audioTrack);

            const client = window.LivekitClient;
            await state.roomConnection.localParticipant.publishTrack(videoTrack, {
                name: `guest-screen-${Date.now()}`,
                source: client.Track.Source.ScreenShare
            });
            if (audioTrack) {
                await state.roomConnection.localParticipant.publishTrack(audioTrack, {
                    name: `guest-screen-audio-${Date.now()}`,
                    source: client.Track.Source.ScreenShareAudio
                });
            }

            state.screenShareStream = shareStream;
            state.screenShareVideoTrack = videoTrack;
            state.screenShareAudioTrack = audioTrack;
            state.screenShareSourceType = detectScreenShareSourceType(videoTrack);

            const stopHandler = () => {
                stopScreenShare({
                    announceStatus: false,
                    statusMessage: t('broadcast_room_join.screen_share_stopped', 'Ekran paylaşımı durduruldu.')
                }).catch(() => {});
            };
            videoTrack.onended = stopHandler;
            if (audioTrack) {
                audioTrack.onended = stopHandler;
            }

            await postParticipantState({
                cameraEnabled: Boolean(els.cameraEnabled?.checked) && !!state.localVideoTrack,
                microphoneEnabled: Boolean(els.microphoneEnabled?.checked) && !!state.localAudioTrack,
                shareEnabled: true,
                shareAudioEnabled: !!audioTrack,
                shareSourceType: state.screenShareSourceType,
                shareStereoRequested: true,
                connected: true
            });

            updateScreenShareControls();
            if (audioTrack) {
                const message = t('broadcast_room_join.screen_share_started_with_audio', 'Ekran paylaşımı başladı. Kaynak sesi dahil ediliyor ve stereo korunmaya çalışılıyor.');
                setScreenShareStatus(message);
                setStatus(message);
            } else if (includeAudio) {
                const message = t('broadcast_room_join.screen_share_started_without_audio_despite_request', 'Ekran paylaşımı başladı, ancak bu tarayıcı veya seçilen paylaşım türü kaynak sesini vermedi. Tüm ekran paylaşımı veya tarayıcının ses seçeneği olan bir paylaşım türünü deneyin.');
                setScreenShareStatus(message);
                setStatus(message);
            } else {
                const message = t('broadcast_room_join.screen_share_started', 'Ekran paylaşımı başladı.');
                setScreenShareStatus(message);
                setStatus(message);
            }
        } catch (error) {
            const errorName = String(error?.name || '').trim();
            if (errorName === 'NotAllowedError') {
                setStatus(t('broadcast_room_join.screen_share_denied', 'Ekran paylaşımı izni verilmedi veya seçim iptal edildi.'));
                return;
            }
            setStatus(t('broadcast_room_join.screen_share_failed', 'Ekran paylaşımı başlatılamadı: {error}', {
                error: formatErrorMessage(error)
            }));
        } finally {
            updateScreenShareControls();
        }
    }

    async function disconnectRoom({ announceStatus = true } = {}) {
        state.intentionalDisconnect = true;
        state.reconnectInProgress = false;
        state.reconnectAttempts = 0;
        if (state.reconnectTimer) {
            clearTimeout(state.reconnectTimer);
            state.reconnectTimer = null;
        }
        if (state.mediaStabilizerTimer) {
            clearTimeout(state.mediaStabilizerTimer);
            state.mediaStabilizerTimer = null;
        }
        stopRoomStatusPolling();
        stopParticipantHeartbeat();
        stopConnectionQualityDiagnostics();
        state.hostRecordingActive = false;
        stopLocalBackupRecording();
        closeRoomEventSource();
        closeMonitorAudioSocket();
        closeTranslationAudioSocket({ closeContext: true });
        closeRemoteAudioContext();
        closeFocusedShareView({ dismiss: false });
        await stopScreenShare({ announceStatus: false, notifyState: false });
        await notifyLeave();
        if (state.roomConnection) {
            try {
                state.roomConnection.disconnect();
            } catch (_error) {
                // ignore disconnect errors
            }
        }
        if (state.localVideoTrack) {
            try {
                state.localVideoTrack.stop();
            } catch (_error) {
                // ignore stop errors
            }
        }
        if (state.localAudioTrack) {
            try {
                state.localAudioTrack.stop();
            } catch (_error) {
                // ignore stop errors
            }
        }
        state.roomConnection = null;
        state.localVideoTrack = null;
        state.localAudioTrack = null;
        state.participantRole = 'guest';
        state.canPublishMedia = true;
        state.lastParticipantHeartbeatAt = 0;
        state.lastQualityReport = null;
        state.leaveBeaconSent = false;
        Object.values(state.remoteVideoRecoveryTimers || {}).forEach((timer) => clearTimeout(timer));
        state.remoteVideoRecoveryTimers = {};
        state.remoteParticipants = {};
        state.activeSpeakerIdentities = [];
        state.participantListRenderSignature = '';
        state.remoteMediaRenderSignature = '';
        state.focusedShareKey = '';
        state.focusedShareDismissedKey = '';
        state.chatPanelExpanded = false;
        state.hostActivityPanelExpanded = false;
        state.moreInfoPanelExpanded = false;
        state.participantsPanelExpanded = false;
        state.handRaiseActive = false;
        state.lastHandRaiseSeenAt = 0;
        state.lastSceneAnnouncementKey = '';
        clearLocalPreview();
        if (els.remoteAudioHost) {
            els.remoteAudioHost.innerHTML = '';
        }
        await renderRemoteParticipants();
        detachMediaSessionHandlers();
        updateHandRaiseButtonUi();
        setHandRaiseStatus(t('broadcast_room_join.hand_raise_waiting', 'Söz isteği için önce odaya katılın.'));
        setScenePositionStatus(t('broadcast_room_join.scene_position_waiting', 'Yayın konumu bilgisi bekleniyor.'));
        setConnectionStatus(t('broadcast_room_join.connection_disconnected', 'Oda bağlantısı kapandı.'));
        if (announceStatus) {
            playRoomTone('leave');
            setStatus(t('broadcast_room_join.leave_success', 'Odadan ayrıldınız.'));
        }
        updateJoinViewState();
        renderChatPanel();
        renderJoinDevicePanel();
        renderHostActivityPanel();
        renderMoreInfoPanel();
        renderParticipantsPanel();
        updateButtons();
        updateScreenShareControls();
    }

    function scheduleUnexpectedRoomReconnect() {
        if (state.intentionalDisconnect || state.roleRefreshInProgress || state.reconnectTimer || !state.room?.roomId || !state.participantIdentity) {
            return;
        }
        const delays = [750, 2000, 5000, 10000, 15000];
        if (state.reconnectAttempts >= delays.length) {
            setConnectionStatus(t('broadcast_room_join.connection_failed', 'Canlı oda bağlantısı kurulamadı.'));
            return;
        }
        const delay = delays[state.reconnectAttempts];
        state.reconnectTimer = window.setTimeout(() => {
            state.reconnectTimer = null;
            recoverUnexpectedRoomDisconnect().catch(() => {});
        }, delay);
    }

    async function recoverUnexpectedRoomDisconnect() {
        if (state.intentionalDisconnect || state.roleRefreshInProgress || state.reconnectInProgress || !state.room?.roomId || !state.participantIdentity) {
            return;
        }
        state.reconnectInProgress = true;
        state.reconnectAttempts += 1;
        setConnectionStatus(t('broadcast_room.status_live_media_reconnecting', 'Canlı oda medya bağlantısı yeniden bağlanıyor.'));
        try {
            const response = await fetch('/api/broadcast-room/participant-role-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    roomId: state.room.roomId,
                    identity: state.participantIdentity
                })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload.success === false) {
                if (response.status === 404 || payload.error === 'room_or_participant_not_found') {
                    await disconnectRoom({ announceStatus: false });
                    setJoinResult(t('broadcast_room_join.removed_from_room', 'Host sizi odadan çıkardı.'));
                    setConnectionStatus(t('broadcast_room_join.connection_removed', 'Oda bağlantısı host tarafından kapatıldı.'));
                    return;
                }
                throw new Error(payload.error || `http_${response.status}`);
            }

            state.token = String(payload.token || '');
            state.livekitUrl = String(payload.livekitUrl || state.livekitUrl || '');
            state.participantRole = String(payload.participantRole || state.participantRole || 'guest');
            state.canPublishMedia = roleCanPublishMedia(state.participantRole);
            state.intentionalDisconnect = false;
            await connectToLiveKit({
                ...payload,
                token: state.token,
                livekitUrl: state.livekitUrl
            });
            state.reconnectAttempts = 0;
            setConnectionStatus(t('broadcast_room.status_live_media_reconnected', 'Canlı oda medya bağlantısı yeniden kuruldu.'));
        } catch (_error) {
            scheduleUnexpectedRoomReconnect();
        } finally {
            state.reconnectInProgress = false;
        }
    }

    async function stabilizeJoinedMedia() {
        if (!state.roomConnection) {
            return;
        }

        const client = window.LivekitClient;
        const cameraEnabled = state.canPublishMedia !== false && Boolean(els.cameraEnabled?.checked);
        const microphoneEnabled = state.canPublishMedia !== false && Boolean(els.microphoneEnabled?.checked);

        if (cameraEnabled && !state.localVideoTrack) {
            try {
                state.localVideoTrack = await client.createLocalVideoTrack(buildVideoCaptureOptions(String(els.cameraDevice?.value || '').trim()));
                await state.roomConnection.localParticipant.publishTrack(state.localVideoTrack);
                syncLocalCameraPreview();
            } catch (_error) {
                // keep last visible error path unchanged; this is only a quiet retry
            }
        }

        if (microphoneEnabled && !state.localAudioTrack) {
            try {
                state.localAudioTrack = await client.createLocalAudioTrack(buildAudioCaptureOptions(String(els.microphoneDevice?.value || '').trim()));
                await applyMicrophoneVolumeToTrack(state.localAudioTrack);
                await state.roomConnection.localParticipant.publishTrack(state.localAudioTrack);
            } catch (_error) {
                // quiet retry
            }
        }

        await postParticipantState({
            cameraEnabled: cameraEnabled && !!state.localVideoTrack,
            microphoneEnabled: microphoneEnabled && !!state.localAudioTrack,
            shareEnabled: isScreenShareActive(),
            shareAudioEnabled: !!state.screenShareAudioTrack,
            shareSourceType: state.screenShareSourceType,
            shareStereoRequested: !!state.screenShareAudioTrack,
            connected: true
        });
        updateHandRaiseButtonUi();
    }

    async function connectToLiveKit(payload) {
        const client = window.LivekitClient;
        if (!client?.Room) {
            throw new Error(t('broadcast_room_join.livekit_unavailable', 'LiveKit istemcisi yüklenemedi.'));
        }

        state.intentionalDisconnect = false;
        setJoinResult(t('broadcast_room_join.join_step_connecting', 'Canlı odaya bağlanılıyor...'));
        setConnectionStatus(t('broadcast_room_join.connection_connecting', 'Canlı oda bağlantısı kuruluyor...'));
        const room = new client.Room({
            adaptiveStream: true,
            dynacast: true
        });

        room.on(client.RoomEvent.Disconnected, () => {
            if (state.roleRefreshInProgress || state.intentionalDisconnect) {
                return;
            }
            if (state.roomConnection === room) {
                state.roomConnection = null;
            }
            closeMonitorAudioSocket();
            closeTranslationAudioSocket({ closeContext: true });
            closeRemoteAudioContext();
            if (state.localVideoTrack) {
                try { state.localVideoTrack.stop(); } catch (_error) {}
                state.localVideoTrack = null;
            }
            if (state.localAudioTrack) {
                try { state.localAudioTrack.stop(); } catch (_error) {}
                state.localAudioTrack = null;
            }
            state.remoteParticipants = {};
            state.remoteMediaRenderSignature = '';
            renderRemoteParticipants().catch(() => {});
            scheduleUnexpectedRoomReconnect();
        });
        if (client.RoomEvent.Reconnecting) {
            room.on(client.RoomEvent.Reconnecting, () => {
                setConnectionStatus(t('broadcast_room.status_live_media_reconnecting', 'Canlı oda medya bağlantısı yeniden bağlanıyor.'));
            });
        }
        if (client.RoomEvent.Reconnected) {
            room.on(client.RoomEvent.Reconnected, () => {
                state.reconnectAttempts = 0;
                setConnectionStatus(t('broadcast_room.status_live_media_reconnected', 'Canlı oda medya bağlantısı yeniden kuruldu.'));
            });
        }
        room.on(client.RoomEvent.ParticipantConnected, (participant) => {
            ensureRemoteParticipantState(participant);
            renderRemoteParticipants().catch(() => {});
        });
        room.on(client.RoomEvent.ParticipantDisconnected, (participant) => {
            const identity = String(participant?.identity || '').trim();
            delete state.remoteParticipants[identity];
            if (state.focusedShareKey && state.focusedShareKey.startsWith(`${identity}:`)) {
                state.focusedShareDismissedKey = '';
                closeFocusedShareView({ dismiss: false });
            }
            renderRemoteParticipants().catch(() => {});
        });
        room.on(client.RoomEvent.TrackSubscribed, (track, publication, participant) => {
            bindRemoteParticipantTrack(track, participant, publication);
        });
        room.on(client.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
            unbindRemoteParticipantTrack(track, participant, publication);
        });
        room.on(client.RoomEvent.ActiveSpeakersChanged, (speakers) => {
            state.activeSpeakerIdentities = (Array.isArray(speakers) ? speakers : [])
                .map((speaker) => String(speaker?.identity || '').trim())
                .filter(Boolean);
            updateRemoteVisualActiveSpeakerState();
        });

        await room.connect(payload.livekitUrl, payload.token);
        state.roomConnection = room;
        connectMonitorAudioSocket();
        startConnectionQualityDiagnostics();
        updateJoinViewState();
        setJoinResult(t('broadcast_room_join.join_step_connected', 'Canlı oda bağlantısı kuruldu. Medya hazırlanıyor...'));
        state.remoteParticipants = {};
        state.remoteMediaRenderSignature = '';
        room.remoteParticipants.forEach((participant) => {
            const participantState = ensureRemoteParticipantState(participant);
            if (!participantState) {
                return;
            }
            participant.trackPublications.forEach((publication) => {
                if (publication.track) {
                    bindRemoteParticipantTrack(publication.track, participant, publication);
                }
            });
        });
        applyRemoteVideoQualityPreferences();
        await renderRemoteParticipants();

        const cameraEnabled = state.canPublishMedia !== false && Boolean(els.cameraEnabled?.checked);
        const microphoneEnabled = state.canPublishMedia !== false && Boolean(els.microphoneEnabled?.checked);
        const cameraDeviceId = String(els.cameraDevice?.value || '').trim();
        const microphoneDeviceId = String(els.microphoneDevice?.value || '').trim();
        let mediaWarning = '';

        if (cameraEnabled) {
            try {
                state.localVideoTrack = await client.createLocalVideoTrack(buildVideoCaptureOptions(cameraDeviceId));
                await room.localParticipant.publishTrack(state.localVideoTrack);
                syncLocalCameraPreview();
            } catch (error) {
                mediaWarning = t('broadcast_room_join.camera_publish_failed', 'Kamera açılamadı: {error}', {
                    error: formatErrorMessage(error)
                });
            }
        } else {
            clearLocalPreview();
        }

        if (microphoneEnabled) {
            try {
                state.localAudioTrack = await client.createLocalAudioTrack(buildAudioCaptureOptions(microphoneDeviceId));
                await applyMicrophoneVolumeToTrack(state.localAudioTrack);
                await room.localParticipant.publishTrack(state.localAudioTrack);
            } catch (error) {
                const micWarning = t('broadcast_room_join.microphone_publish_failed', 'Mikrofon açılamadı: {error}', {
                    error: formatErrorMessage(error)
                });
                mediaWarning = mediaWarning ? `${mediaWarning} ${micWarning}` : micWarning;
            }
        }

        await postParticipantState({
            cameraEnabled: cameraEnabled && !!state.localVideoTrack,
            microphoneEnabled: microphoneEnabled && !!state.localAudioTrack,
            shareEnabled: isScreenShareActive(),
            shareAudioEnabled: !!state.screenShareAudioTrack,
            shareSourceType: state.screenShareSourceType,
            shareStereoRequested: !!state.screenShareAudioTrack,
            connected: true
        });
        await pollRoomStatus();
        startRoomStatusPolling(state.roomEventSourceConnected ? 30000 : 5000);
        startParticipantHeartbeat();
        setConnectionStatus(t('broadcast_room_join.connection_connected', 'Canlı oda bağlantısı kuruldu.'));
        playRoomTone('join');
        attachMediaSessionHandlers();
        syncLocalBackupRecordingWithHostState();
        updateHandRaiseButtonUi();
        if (mediaWarning) {
            setJoinResult(t('broadcast_room_join.join_success_with_media_warning', 'Odaya katıldınız, ancak bazı medya aygıtları açılamadı. {warning}', {
                warning: mediaWarning
            }));
            setStatus(t('broadcast_room_join.join_success_with_media_warning', 'Odaya katıldınız, ancak bazı medya aygıtları açılamadı. {warning}', {
                warning: mediaWarning
            }));
        }
        if (state.mediaStabilizerTimer) {
            clearTimeout(state.mediaStabilizerTimer);
        }
        state.mediaStabilizerTimer = window.setTimeout(() => {
            stabilizeJoinedMedia().catch(() => {});
        }, 1200);
        updateButtons();
    }

    async function handleCameraToggleChange() {
        if (!state.roomConnection) {
            return;
        }
        if (state.canPublishMedia === false) {
            if (els.cameraEnabled) {
                els.cameraEnabled.checked = false;
            }
            updateJoinMediaToggleButtons();
            setStatus(t('broadcast_room_join.webinar_audience_media_disabled', 'Webinar izleyicisi olarak katıldınız. Kamera, mikrofon ve ekran paylaşımı host onayıyla açılır.'));
            return;
        }
        if ((state.allowGuestCamera === false || state.ownAllowCamera === false) && Boolean(els.cameraEnabled?.checked)) {
            els.cameraEnabled.checked = false;
            updateJoinMediaToggleButtons();
            setStatus(t('broadcast_room_join.camera_permission_blocked', 'Host şu anda kamera açmanıza izin vermiyor.'));
            return;
        }

        const enabled = Boolean(els.cameraEnabled?.checked);
        const client = window.LivekitClient;
        if (enabled && !state.localVideoTrack) {
            state.localVideoTrack = await client.createLocalVideoTrack(buildVideoCaptureOptions(String(els.cameraDevice?.value || '').trim()));
            await state.roomConnection.localParticipant.publishTrack(state.localVideoTrack);
            syncLocalCameraPreview();
            if (state.hostRecordingActive === true) {
                stopLocalBackupRecording();
            }
        } else if (!enabled && state.localVideoTrack) {
            await state.roomConnection.localParticipant.unpublishTrack(state.localVideoTrack);
            state.localVideoTrack.stop();
            state.localVideoTrack = null;
            clearLocalPreview();
            if (state.hostRecordingActive === true) {
                stopLocalBackupRecording();
            }
        }

        updateJoinMediaToggleButtons();
        renderLocalAvatarFallback();
        await postParticipantState({
            cameraEnabled: enabled,
            microphoneEnabled: Boolean(els.microphoneEnabled?.checked),
            shareEnabled: isScreenShareActive(),
            shareAudioEnabled: !!state.screenShareAudioTrack,
            shareSourceType: state.screenShareSourceType,
            shareStereoRequested: !!state.screenShareAudioTrack,
            connected: true
        });
    }

    async function handleMicrophoneToggleChange() {
        if (!state.roomConnection) {
            return;
        }
        if (state.canPublishMedia === false) {
            if (els.microphoneEnabled) {
                els.microphoneEnabled.checked = false;
            }
            updateJoinMediaToggleButtons();
            setStatus(t('broadcast_room_join.webinar_audience_media_disabled', 'Webinar izleyicisi olarak katıldınız. Kamera, mikrofon ve ekran paylaşımı host onayıyla açılır.'));
            return;
        }
        if ((state.allowGuestMicrophone === false || state.ownAllowMicrophone === false) && Boolean(els.microphoneEnabled?.checked)) {
            els.microphoneEnabled.checked = false;
            updateJoinMediaToggleButtons();
            setStatus(t('broadcast_room_join.microphone_permission_blocked', 'Host şu anda mikrofon açmanıza izin vermiyor.'));
            return;
        }

        const enabled = Boolean(els.microphoneEnabled?.checked);
        const client = window.LivekitClient;
        if (enabled && !state.localAudioTrack) {
            state.localAudioTrack = await client.createLocalAudioTrack(buildAudioCaptureOptions(String(els.microphoneDevice?.value || '').trim()));
            await applyMicrophoneVolumeToTrack(state.localAudioTrack);
            await state.roomConnection.localParticipant.publishTrack(state.localAudioTrack);
            syncLocalBackupRecordingWithHostState();
        } else if (!enabled && state.localAudioTrack) {
            stopLocalBackupRecording();
            await state.roomConnection.localParticipant.unpublishTrack(state.localAudioTrack);
            state.localAudioTrack.stop();
            state.localAudioTrack = null;
        }

        updateJoinMediaToggleButtons();
        await postParticipantState({
            cameraEnabled: Boolean(els.cameraEnabled?.checked),
            microphoneEnabled: enabled,
            shareEnabled: isScreenShareActive(),
            shareAudioEnabled: !!state.screenShareAudioTrack,
            shareSourceType: state.screenShareSourceType,
            shareStereoRequested: !!state.screenShareAudioTrack,
            connected: true
        });
    }

    async function postCurrentMediaState() {
        await postParticipantState({
            cameraEnabled: Boolean(els.cameraEnabled?.checked) && !!state.localVideoTrack,
            microphoneEnabled: Boolean(els.microphoneEnabled?.checked) && !!state.localAudioTrack,
            shareEnabled: isScreenShareActive(),
            shareAudioEnabled: !!state.screenShareAudioTrack,
            shareSourceType: state.screenShareSourceType,
            shareStereoRequested: !!state.screenShareAudioTrack,
            connected: true,
            connectionQuality: getCurrentConnectionQualityPayload()
        });
    }

    async function handleLowBandwidthModeChange() {
        state.lowBandwidthMode = !!els.lowBandwidthMode?.checked;
        applyRemoteVideoQualityPreferences();
        await sendConnectionQualityReport({ force: true }).catch(() => {});
        if (state.roomConnection && Boolean(els.cameraEnabled?.checked) && state.localVideoTrack) {
            await handleCameraDeviceChange({
                statusMessage: state.lowBandwidthMode
                    ? t('broadcast_room_join.low_bandwidth_mode_enabled', 'Düşük bant genişliği modu açıldı. Kamera daha hafif kaliteyle yenilendi.')
                    : t('broadcast_room_join.low_bandwidth_mode_disabled', 'Düşük bant genişliği modu kapatıldı. Kamera normal kaliteyle yenilendi.')
            });
            return;
        }
        setStatus(state.lowBandwidthMode
            ? t('broadcast_room_join.low_bandwidth_mode_enabled', 'Düşük bant genişliği modu açıldı. Kamera daha hafif kaliteyle yenilendi.')
            : t('broadcast_room_join.low_bandwidth_mode_disabled', 'Düşük bant genişliği modu kapatıldı. Kamera normal kaliteyle yenilendi.'));
    }

    function getSelectedDeviceLabel(selectEl, fallbackKey, fallbackText) {
        return selectEl?.options?.[selectEl.selectedIndex]?.textContent
            || t(fallbackKey, fallbackText);
    }

    async function handleCameraDeviceChange({ statusMessage = '' } = {}) {
        const label = getSelectedDeviceLabel(els.cameraDevice, 'broadcast_room_join.track_source_camera', 'Kamera');
        if (!state.roomConnection || !Boolean(els.cameraEnabled?.checked)) {
            setStatus(statusMessage || t('broadcast_room.status_guest_camera_device_selected', 'Seçili kamera değiştirildi: {name}', {
                name: label
            }));
            return;
        }
        if (state.canPublishMedia === false || state.allowGuestCamera === false || state.ownAllowCamera === false) {
            setStatus(t('broadcast_room_join.camera_permission_blocked', 'Host şu anda kamera açmanıza izin vermiyor.'));
            return;
        }

        const client = window.LivekitClient;
        const previousTrack = state.localVideoTrack;
        let nextTrack = null;
        try {
            nextTrack = await client.createLocalVideoTrack(buildVideoCaptureOptions(String(els.cameraDevice?.value || '').trim()));
            if (previousTrack) {
                try { await state.roomConnection.localParticipant.unpublishTrack(previousTrack); } catch (_error) {}
                try { previousTrack.stop(); } catch (_error) {}
            }
            state.localVideoTrack = null;
            clearLocalPreview();
            await state.roomConnection.localParticipant.publishTrack(nextTrack);
            state.localVideoTrack = nextTrack;
            syncLocalCameraPreview();
            if (state.hostRecordingActive === true) {
                stopLocalBackupRecording();
            }
            await postCurrentMediaState();
            setStatus(statusMessage || t('broadcast_room.status_guest_camera_device_selected', 'Seçili kamera değiştirildi: {name}', {
                name: label
            }));
        } catch (error) {
            if (nextTrack) {
                try { nextTrack.stop(); } catch (_error) {}
            }
            setStatus(t('broadcast_room_join.camera_publish_failed', 'Kamera açılamadı: {error}', {
                error: formatErrorMessage(error)
            }));
            state.localVideoTrack = null;
            clearLocalPreview();
            await postCurrentMediaState().catch(() => {});
        }
    }

    async function handleMicrophoneDeviceChange({ statusMessage = '' } = {}) {
        const label = getSelectedDeviceLabel(els.microphoneDevice, 'broadcast_room_join.track_source_microphone', 'Mikrofon');
        if (!state.roomConnection || !Boolean(els.microphoneEnabled?.checked)) {
            setStatus(statusMessage || t('broadcast_room.status_guest_microphone_device_selected', 'Seçili mikrofon değiştirildi: {name}', {
                name: label
            }));
            return;
        }
        if (state.canPublishMedia === false || state.allowGuestMicrophone === false || state.ownAllowMicrophone === false) {
            setStatus(t('broadcast_room_join.microphone_permission_blocked', 'Host şu anda mikrofon açmanıza izin vermiyor.'));
            return;
        }

        const client = window.LivekitClient;
        const previousTrack = state.localAudioTrack;
        let nextTrack = null;
        try {
            nextTrack = await client.createLocalAudioTrack(buildAudioCaptureOptions(String(els.microphoneDevice?.value || '').trim()));
            await applyMicrophoneVolumeToTrack(nextTrack);
            if (previousTrack) {
                stopLocalBackupRecording();
                try { await state.roomConnection.localParticipant.unpublishTrack(previousTrack); } catch (_error) {}
                try { previousTrack.stop(); } catch (_error) {}
            }
            state.localAudioTrack = null;
            await state.roomConnection.localParticipant.publishTrack(nextTrack);
            state.localAudioTrack = nextTrack;
            syncLocalBackupRecordingWithHostState();
            await postCurrentMediaState();
            setStatus(statusMessage || t('broadcast_room.status_guest_microphone_device_selected', 'Seçili mikrofon değiştirildi: {name}', {
                name: label
            }));
        } catch (error) {
            if (nextTrack) {
                try { nextTrack.stop(); } catch (_error) {}
            }
            setStatus(t('broadcast_room_join.microphone_publish_failed', 'Mikrofon açılamadı: {error}', {
                error: formatErrorMessage(error)
            }));
            state.localAudioTrack = null;
            await postCurrentMediaState().catch(() => {});
        }
    }

    async function joinRoom() {
        const displayName = String(els.displayName.value || '').trim();
        const roomPassword = String(els.roomPassword?.value || '');
        if (!displayName) {
            setStatus(t('broadcast_room_join.display_name_required', 'Lütfen görünen adınızı yazın.'));
            return;
        }

        joinInProgress = true;
        updateButtons();
        setJoinResult(t('broadcast_room_join.join_in_progress', 'Katılım bilgisi hazırlanıyor...'));
        setConnectionStatus(t('broadcast_room_join.connection_connecting', 'Canlı oda bağlantısı kuruluyor...'));

        try {
            const response = await fetch('/api/broadcast-room/join-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    inviteId: state.inviteId,
                    displayName,
                    password: roomPassword,
                    cameraEnabled: Boolean(els.cameraEnabled?.checked),
                    microphoneEnabled: Boolean(els.microphoneEnabled?.checked)
                })
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.success) {
                throw new Error(payload.error || 'unknown_error');
            }

            state.token = payload.token || '';
            state.participantIdentity = payload.participantIdentity || '';
            state.participantRole = String(payload.participantRole || 'guest').trim() || 'guest';
            state.canPublishMedia = roleCanPublishMedia(state.participantRole);
            if (!state.canPublishMedia) {
                if (els.cameraEnabled) {
                    els.cameraEnabled.checked = false;
                }
                if (els.microphoneEnabled) {
                    els.microphoneEnabled.checked = false;
                }
            }
            state.livekitUrl = payload.livekitUrl || '';
            state.allowGuestScreenShare = payload.allowGuestScreenShare !== false;
            state.hostConnected = payload.hostConnected !== false;
            state.allowJoinWhenHostAbsent = payload.settings?.allowJoinWhenHostAbsent === true;
            state.passwordConfigured = payload.settings?.passwordConfigured === true;
            state.requirePasswordNow = false;
            updateRoomPasswordVisibility();
            state.participants = Array.isArray(payload.participants) ? payload.participants : state.participants;
            state.chatMessages = Array.isArray(payload.chatMessages) ? payload.chatMessages : state.chatMessages;
            if (els.participantIdentity) {
                els.participantIdentity.textContent = state.participantIdentity || '-';
            }
            renderParticipantList();
            renderChatMessageList();
            const visibleMessages = getVisibleChatMessages();
            state.lastAnnouncedChatId = String(visibleMessages[visibleMessages.length - 1]?.id || '').trim();
            updateHandRaiseStateFromParticipants({ announce: false });
            setJoinResult(t('broadcast_room_join.join_step_token_ready', 'Katılım bilgisi alındı. Canlı oda bağlantısı kuruluyor...'));
            await connectToLiveKit(payload);
            if (state.avatarDataUrl) {
                await syncParticipantAvatar();
            }
            renderLocalAvatarFallback();
            const joinResultText = String(els.joinResult?.textContent || '').trim();
            if (!joinResultText || joinResultText === t('broadcast_room_join.join_step_connected', 'Canlı oda bağlantısı kuruldu. Medya hazırlanıyor...') || joinResultText === t('broadcast_room_join.join_step_token_ready', 'Katılım bilgisi alındı. Canlı oda bağlantısı kuruluyor...')) {
                setJoinResult(t('broadcast_room_join.join_success', 'Katılım tamamlandı. Oda bağlantısı kuruldu.'));
                const mediaHint = t('broadcast_room_join.guest_join_media_off_hint', 'Mikrofonunuz ve videonuz kapalı. Açmak için Ctrl+D ile mikrofonu, Ctrl+E ile videoyu kullanabilirsiniz.');
                setStatus(mediaHint);
                announceMessage(mediaHint);
                els.microphoneEnabled?.focus?.();
            }
        } catch (error) {
            const rawError = formatErrorMessage(error);
            const message = rawError === 'host_not_connected'
                ? t('broadcast_room_join.host_not_connected', 'Host şu anda bağlı değil. Bu oda host olmadan katılıma açık değil.')
                : (rawError === 'room_password_invalid'
                    ? t('broadcast_room_join.room_password_invalid', 'Oda parolası yanlış veya eksik.')
                    : t('broadcast_room_join.join_failed', 'Katılım jetonu alınamadı: {error}', {
                        error: rawError
                    }));
            setJoinResult(message);
            setConnectionStatus(t('broadcast_room_join.connection_failed', 'Canlı oda bağlantısı kurulamadı.'));
            setStatus(message);
        } finally {
            joinInProgress = false;
            updateButtons();
        }
    }

    function bindEvents() {
        els.participantAvatarFile?.addEventListener('change', () => {
            handleParticipantAvatarSelection().catch(() => {});
        });
        els.btnRemoveParticipantAvatar?.addEventListener('click', () => {
            removeParticipantAvatar().catch(() => {});
        });
        [els.displayName, els.joinedDisplayName].filter(Boolean).forEach((input) => {
            input.addEventListener('click', () => {
                if (document.activeElement === input) {
                    return;
                }
                // VoiceOver's virtual cursor and Safari's keyboard focus can diverge.
                // Keep this synchronous with the trusted activation so iOS may open the keyboard.
                try {
                    input.focus({ preventScroll: true });
                } catch (_error) {
                    input.focus();
                }
            });
        });
        els.btnUpdateDisplayName?.addEventListener('click', () => {
            updateOwnDisplayName().catch((error) => {
                setStatus(t('broadcast_room_join.display_name_update_failed', 'Görünen adınız güncellenemedi: {error}', {
                    error: formatErrorMessage(error)
                }));
            });
        });
        els.joinedDisplayName?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                updateOwnDisplayName().catch((error) => {
                    setStatus(t('broadcast_room_join.display_name_update_failed', 'Görünen adınız güncellenemedi: {error}', {
                        error: formatErrorMessage(error)
                    }));
                });
            }
        });
        els.joinForm?.addEventListener('submit', (event) => {
            event.preventDefault();
            if (state.roomConnection || joinInProgress) {
                return;
            }
            joinRoom().catch((error) => {
                const message = t('broadcast_room_join.join_failed', 'Katılım jetonu alınamadı: {error}', {
                    error: formatErrorMessage(error)
                });
                setJoinResult(message);
                setConnectionStatus(t('broadcast_room_join.connection_failed', 'Canlı oda bağlantısı kurulamadı.'));
                setStatus(message);
            });
        });
        els.btnLeaveRoom?.addEventListener('click', () => {
            disconnectRoom().catch((error) => {
                setStatus(t('broadcast_room_join.leave_failed', 'Odadan ayrılırken hata oluştu: {error}', {
                    error: error.message
                }));
            });
        });
        els.btnStartScreenShare?.addEventListener('click', () => {
            const action = isScreenShareActive() ? stopScreenShare() : startScreenShare();
            action.catch((error) => {
                const key = isScreenShareActive() ? 'broadcast_room_join.screen_share_failed' : 'broadcast_room_join.screen_share_failed';
                setStatus(t(key, 'Ekran paylaşımı başlatılamadı: {error}', {
                    error: formatErrorMessage(error)
                }));
            });
        });
        els.btnStopScreenShare?.addEventListener('click', () => {
            stopScreenShare().catch((error) => {
                setStatus(t('broadcast_room_join.screen_share_failed', 'Ekran paylaşımı başlatılamadı: {error}', {
                    error: formatErrorMessage(error)
                }));
            });
        });
        els.cameraEnabled?.addEventListener('click', () => {
            els.cameraEnabled.checked = !Boolean(els.cameraEnabled.checked);
            updateJoinMediaToggleButtons();
            handleCameraToggleChange()
                .then(() => announceLocalMediaToggleResult('camera'))
                .catch((error) => {
                    els.cameraEnabled.checked = !Boolean(els.cameraEnabled.checked);
                    updateJoinMediaToggleButtons();
                    setStatus(t('broadcast_room_join.camera_publish_failed', 'Kamera açılamadı: {error}', {
                        error: formatErrorMessage(error)
                    }));
                });
        });
        els.microphoneEnabled?.addEventListener('click', () => {
            els.microphoneEnabled.checked = !Boolean(els.microphoneEnabled.checked);
            updateJoinMediaToggleButtons();
            handleMicrophoneToggleChange()
                .then(() => announceLocalMediaToggleResult('microphone'))
                .catch((error) => {
                    els.microphoneEnabled.checked = !Boolean(els.microphoneEnabled.checked);
                    updateJoinMediaToggleButtons();
                    setStatus(t('broadcast_room_join.microphone_publish_failed', 'Mikrofon açılamadı: {error}', {
                        error: formatErrorMessage(error)
                    }));
                });
        });
        els.speakerDevice?.addEventListener('change', () => {
            applySpeakerSelectionToRemoteAudioElements().catch((error) => {
                setStatus(t('broadcast_room_join.speaker_apply_failed', 'Seçili hoparlör uygulanamadı: {error}', {
                    error: formatErrorMessage(error)
                }));
            });
        });
        els.microphoneVolume?.addEventListener('input', () => {
            state.microphoneVolume = getMicrophoneVolume();
            updateAudioLevelLabels();
            applyMicrophoneVolumeToTrack().catch(() => {});
        });
        [
            els.microphoneEchoCancellation,
            els.microphoneNoiseSuppression,
            els.microphoneAutoGainControl
        ].filter(Boolean).forEach((control) => {
            control.addEventListener('change', () => {
                handleMicrophoneProcessingChange().catch((error) => {
                    setStatus(t('broadcast_room_join.microphone_processing_failed', 'Mikrofon sinyal işleme ayarları uygulanamadı: {error}', {
                        error: formatErrorMessage(error)
                    }));
                });
            });
        });
        els.speakerVolume?.addEventListener('input', () => {
            state.speakerVolume = getSpeakerVolume();
            updateAudioLevelLabels();
            updateRemoteAudioElementVolumes();
        });
        els.btnTestSpeaker?.addEventListener('click', () => {
            testSpeaker().catch((error) => {
                setAudioTestStatus(t('broadcast_room_join.speaker_test_failed', 'Hoparlör testi başlatılamadı: {error}', {
                    error: formatErrorMessage(error)
                }));
            });
        });
        els.btnTestMicrophone?.addEventListener('click', () => {
            toggleMicrophoneTest().catch((error) => {
                stopMicrophoneTest({ announceStatus: false });
                setAudioTestStatus(t('broadcast_room_join.microphone_test_failed', 'Mikrofon testi başlatılamadı: {error}', {
                    error: formatErrorMessage(error)
                }));
            });
        });
        // Deliberately button-only: camera analysis must never start implicitly or via a global shortcut.
        els.btnTestCameraFraming?.addEventListener('click', () => {
            startCameraFramingTest();
        });
        els.btnReadCameraFramingStatus?.addEventListener('click', readCameraFramingStatus);
        els.btnCloseCameraFraming?.addEventListener('click', () => {
            stopCameraFramingTest();
        });
        els.cameraFramingDialog?.addEventListener('cancel', (event) => {
            event.preventDefault();
            stopCameraFramingTest();
        });
        els.cameraDevice?.addEventListener('change', () => {
            handleCameraDeviceChange().catch((error) => {
                setStatus(t('broadcast_room_join.camera_publish_failed', 'Kamera açılamadı: {error}', {
                    error: formatErrorMessage(error)
                }));
            });
        });
        els.microphoneDevice?.addEventListener('change', () => {
            handleMicrophoneDeviceChange().catch((error) => {
                setStatus(t('broadcast_room_join.microphone_publish_failed', 'Mikrofon açılamadı: {error}', {
                    error: formatErrorMessage(error)
                }));
            });
        });
        els.audioChannelSelect?.addEventListener('change', () => {
            state.audioChannel = String(els.audioChannelSelect.value || 'original');
            renderRemoteParticipants().catch(() => {});
            const label = els.audioChannelSelect.options[els.audioChannelSelect.selectedIndex]?.textContent || state.audioChannel;
            setStatus(t('broadcast_room_join.audio_channel_changed', 'Ses kanalı seçildi: {channel}', {
                channel: label
            }));
        });
        els.lowBandwidthMode?.addEventListener('change', () => {
            handleLowBandwidthModeChange().catch((error) => {
                setStatus(t('broadcast_room_join.low_bandwidth_mode_failed', 'Düşük bant genişliği modu güncellenemedi: {error}', {
                    error: formatErrorMessage(error)
                }));
            });
        });
        if (navigator.mediaDevices?.addEventListener) {
            navigator.mediaDevices.addEventListener('devicechange', () => {
                handleDeviceListChanged().catch((error) => {
                    setStatus(t('broadcast_room_join.device_list_refresh_failed', 'Aygıt listesi alınamadı: {error}', {
                        error: formatErrorMessage(error)
                    }));
                });
            });
        }
        els.btnRequestPermissions?.addEventListener('click', () => {
            requestInitialMediaPermissions().catch((error) => {
                setStatus(t('broadcast_room_join.permission_request_failed', 'Kamera ve mikrofon izni alınamadı: {error}', {
                    error: formatErrorMessage(error)
                }));
            });
        });
        els.btnChatSendAll?.addEventListener('click', () => {
            postChatMessage().catch((error) => {
                setStatus(t('broadcast_room_join.chat_send_failed', 'Mesaj gönderilemedi: {error}', {
                    error: formatErrorMessage(error)
                }));
            });
        });
        els.btnChatSendHost?.addEventListener('click', () => {
            postChatMessage('host').catch((error) => {
                setStatus(t('broadcast_room_join.chat_send_failed', 'Mesaj gönderilemedi: {error}', {
                    error: formatErrorMessage(error)
                }));
            });
        });
        els.btnToggleChatPanel?.addEventListener('click', () => {
            state.chatPanelExpanded = !state.chatPanelExpanded;
            renderChatPanel();
        });
        els.btnToggleJoinDevicePanel?.addEventListener('click', () => {
            state.joinDevicePanelExpanded = !state.joinDevicePanelExpanded;
            renderJoinDevicePanel();
            if (state.joinDevicePanelExpanded) {
                els.microphoneDevice?.focus?.();
            }
        });
        els.btnToggleHostActivityPanel?.addEventListener('click', () => {
            state.hostActivityPanelExpanded = !state.hostActivityPanelExpanded;
            renderHostActivityPanel();
        });
        els.btnToggleMoreInfoPanel?.addEventListener('click', () => {
            state.moreInfoPanelExpanded = !state.moreInfoPanelExpanded;
            renderMoreInfoPanel();
        });
        els.btnToggleParticipantsPanel?.addEventListener('click', () => {
            state.participantsPanelExpanded = !state.participantsPanelExpanded;
            renderParticipantsPanel();
        });
        els.btnHandRaise?.addEventListener('click', () => {
            setHandRaiseActive(!state.handRaiseActive).catch((error) => {
                setStatus(t('broadcast_room_join.hand_raise_failed', 'Söz isteği güncellenemedi: {error}', {
                    error: formatErrorMessage(error)
                }));
            });
        });
        els.chatAutoAnnounce?.addEventListener('change', () => {
            state.chatAutoAnnounce = !!els.chatAutoAnnounce.checked;
            setStatus(state.chatAutoAnnounce
                ? t('broadcast_room_join.chat_auto_announce_enabled', 'Yeni mesajlar artık otomatik duyurulacak.')
                : t('broadcast_room_join.chat_auto_announce_disabled', 'Yeni mesajlar artık otomatik duyurulmayacak.'));
        });
        els.participantPresenceAutoAnnounce?.addEventListener('change', () => {
            state.participantPresenceAutoAnnounce = !!els.participantPresenceAutoAnnounce.checked;
            saveStoredBoolean(PARTICIPANT_PRESENCE_AUTO_ANNOUNCE_STORAGE_KEY, state.participantPresenceAutoAnnounce);
            setStatus(state.participantPresenceAutoAnnounce
                ? t('broadcast_room_join.participant_presence_auto_announce_enabled', 'Katılımcı giriş ve çıkışları artık otomatik duyurulacak.')
                : t('broadcast_room_join.participant_presence_auto_announce_disabled', 'Katılımcı giriş ve çıkışları artık otomatik duyurulmayacak.'));
        });
        els.accessibleShareAutoAnnounce?.addEventListener('change', () => {
            state.accessibleShareAutoAnnounce = !!els.accessibleShareAutoAnnounce.checked;
            if (els.focusedAccessibleShareAutoAnnounce) {
                els.focusedAccessibleShareAutoAnnounce.checked = state.accessibleShareAutoAnnounce;
            }
            setStatus(state.accessibleShareAutoAnnounce
                ? t('broadcast_room_join.accessible_share_auto_announce_enabled', 'Erişilebilir paylaşım metni artık otomatik okunacak.')
                : t('broadcast_room_join.accessible_share_auto_announce_disabled', 'Erişilebilir paylaşım metni artık otomatik okunmayacak.'));
        });
        els.focusedAccessibleShareAutoAnnounce?.addEventListener('change', () => {
            state.accessibleShareAutoAnnounce = !!els.focusedAccessibleShareAutoAnnounce.checked;
            if (els.accessibleShareAutoAnnounce) {
                els.accessibleShareAutoAnnounce.checked = state.accessibleShareAutoAnnounce;
            }
            setStatus(state.accessibleShareAutoAnnounce
                ? t('broadcast_room_join.accessible_share_auto_announce_enabled', 'Erişilebilir paylaşım metni artık otomatik okunacak.')
                : t('broadcast_room_join.accessible_share_auto_announce_disabled', 'Erişilebilir paylaşım metni artık otomatik okunmayacak.'));
        });
        els.btnToggleLiveCaptionPanel?.addEventListener('click', () => {
            if (!isLiveCaptionAvailable()) {
                renderLiveCaptionPanel();
                return;
            }
            state.liveCaptionPanelExpanded = !state.liveCaptionPanelExpanded;
            renderLiveCaptionPanel();
            if (state.liveCaptionPanelExpanded) {
                syncPreferredLanguageParticipantState({ force: true });
                els.btnToggleLiveCaptionView?.focus?.();
            }
        });
        els.btnToggleLiveCaptionView?.addEventListener('click', () => {
            if (!isLiveCaptionAvailable()) {
                renderLiveCaptionPanel();
                return;
            }
            state.liveCaptionViewEnabled = !state.liveCaptionViewEnabled;
            state.lastLiveCaptionAnnouncementKey = '';
            resetTranslationAudioPlaybackState({ closeContext: false });
            if (!state.liveCaptionViewEnabled) {
                state.liveCaptionAutoAnnounce = false;
            }
            renderLiveCaptionPanel();
            syncPreferredLanguageParticipantState({ force: true });
            connectTranslationAudioSocket();
            refreshRemoteAudioPlaybackGraph();
            setStatus(state.liveCaptionViewEnabled
                ? t('broadcast_room_join.live_caption_view_enabled', 'Bu oturum için altyazı/çeviri görüntüleme açıldı.')
                : t('broadcast_room_join.live_caption_view_disabled_status', 'Bu oturum için altyazı/çeviri görüntüleme kapatıldı.'));
        });
        els.liveCaptionPreferredLanguage?.addEventListener('change', () => {
            state.liveCaptionPreferredLanguage = String(els.liveCaptionPreferredLanguage.value || 'tr');
            state.lastLiveCaptionAnnouncementKey = '';
            resetTranslationAudioPlaybackState({ closeContext: false });
            renderLiveCaptionPanel();
            connectTranslationAudioSocket();
            refreshRemoteAudioPlaybackGraph();
            const label = els.liveCaptionPreferredLanguage.options[els.liveCaptionPreferredLanguage.selectedIndex]?.textContent
                || state.liveCaptionPreferredLanguage;
            setStatus(t('broadcast_room_join.live_caption_preferred_language_changed', 'Kişisel çeviri dili seçildi: {language}', {
                language: label
            }));
            syncPreferredLanguageParticipantState({ force: true });
        });
        els.liveCaptionAutoAnnounce?.addEventListener('change', () => {
            state.liveCaptionAutoAnnounce = !!els.liveCaptionAutoAnnounce.checked;
            state.lastLiveCaptionAnnouncementKey = '';
            renderLiveCaptionPanel();
            setStatus(state.liveCaptionAutoAnnounce
                ? t('broadcast_room_join.live_caption_auto_announce_enabled', 'Yeni altyazı/çeviri artık otomatik seslendirilecek.')
                : t('broadcast_room_join.live_caption_auto_announce_disabled', 'Yeni altyazı/çeviri artık otomatik seslendirilmeyecek.'));
        });
        els.btnCloseFocusedShare?.addEventListener('click', () => {
            closeFocusedShareView({ dismiss: true, announceClose: true });
        });
        els.btnReturnFocusedShare?.addEventListener('click', () => {
            const focusedShare = getFocusedShareTrackState();
            if (!focusedShare) {
                updateFocusedShareReturnButton(null);
                return;
            }
            state.focusedShareDismissedKey = '';
            openFocusedShareView(focusedShare, { announceReturn: true });
        });
        els.btnToggleFocusedAccessibleShare?.addEventListener('click', () => {
            const nextVisible = els.btnToggleFocusedAccessibleShare.getAttribute('aria-expanded') !== 'true';
            setFocusedAccessibleShareVisibility(nextVisible);
            if (nextVisible) {
                els.focusedAccessibleShareText?.focus?.();
            }
        });
        els.chatCompose?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                postChatMessage().catch((error) => {
                    setStatus(t('broadcast_room_join.chat_send_failed', 'Mesaj gönderilemedi: {error}', {
                        error: formatErrorMessage(error)
                    }));
                });
            }
        });
        els.chatMessageList?.addEventListener('change', () => {
            state.chatSelectedIndex = Number(els.chatMessageList.selectedIndex || 0);
            renderSelectedChatMessageDetail();
            const messages = getVisibleChatMessages();
            if (messages[state.chatSelectedIndex]) {
                announceChatMessage(describeChatMessage(messages[state.chatSelectedIndex]));
            }
        });
        // Guest meeting shortcuts and quality toggles are intentionally local
        // to the join page and are not exposed through the desktop keyboard manager.
        window.addEventListener('keydown', (event) => {
            const key = String(event.key || '').toLowerCase();
            if (event.key === 'Escape' && els.focusedShareView && !els.focusedShareView.hidden) {
                event.preventDefault();
                closeFocusedShareView({ dismiss: true, announceClose: true });
                return;
            }
            if (event.metaKey || event.altKey) {
                return;
            }
            if (event.ctrlKey && event.shiftKey && key === 's' && !isEditableShortcutTarget(event.target)) {
                event.preventDefault();
                announceCurrentSpeaker();
                return;
            }
            if (event.ctrlKey && event.shiftKey && key === 'e') {
                event.preventDefault();
                handleGuestShareShortcut().catch((error) => {
                    setStatus(t('broadcast_room_join.screen_share_failed', 'Ekran paylaşımı başlatılamadı: {error}', {
                        error: formatErrorMessage(error)
                    }));
                });
                return;
            }
            if (event.ctrlKey && event.shiftKey && key === 'h') {
                event.preventDefault();
                disconnectRoom().catch((error) => {
                    setStatus(t('broadcast_room_join.leave_failed', 'Odadan ayrılırken hata oluştu: {error}', {
                        error: formatErrorMessage(error)
                    }));
                });
                return;
            }
            if (event.ctrlKey && key === 'd') {
                event.preventDefault();
                toggleGuestMicrophoneShortcut().catch((error) => {
                    setStatus(t('broadcast_room_join.join_failed', 'Katılım jetonu alınamadı: {error}', {
                        error: formatErrorMessage(error)
                    }));
                });
                return;
            }
            if (event.ctrlKey && key === 'e') {
                event.preventDefault();
                toggleGuestCameraShortcut().catch((error) => {
                    setStatus(t('broadcast_room_join.join_failed', 'Katılım jetonu alınamadı: {error}', {
                        error: formatErrorMessage(error)
                    }));
                });
            }
        });
        window.addEventListener('pagehide', () => {
            cleanupCameraFramingTest();
            sendLeaveBeacon();
        });
        window.addEventListener('beforeunload', () => {
            cleanupCameraFramingTest();
            sendLeaveBeacon();
            disconnectRoom({ announceStatus: false }).catch(() => {});
        });
        window.addEventListener('error', (event) => {
            const message = t('broadcast_room_join.join_failed', 'Katılım jetonu alınamadı: {error}', {
                error: formatErrorMessage(event?.error?.message || event?.message || 'unknown_error')
            });
            setJoinResult(message);
            setConnectionStatus(t('broadcast_room_join.connection_failed', 'Canlı oda bağlantısı kurulamadı.'));
        });
        window.addEventListener('unhandledrejection', (event) => {
            const reason = formatErrorMessage(event?.reason?.message || event?.reason || 'unknown_error');
            const message = t('broadcast_room_join.join_failed', 'Katılım jetonu alınamadı: {error}', {
                error: reason
            });
            setJoinResult(message);
            setConnectionStatus(t('broadcast_room_join.connection_failed', 'Canlı oda bağlantısı kurulamadı.'));
        });
    }

    async function init() {
        state.inviteId = getInviteIdFromPath();
        await loadLocale();
        if (els.cameraEnabled) {
            els.cameraEnabled.checked = false;
        }
        if (els.microphoneEnabled) {
            els.microphoneEnabled.checked = false;
        }
        if (els.microphoneEchoCancellation) {
            els.microphoneEchoCancellation.checked = state.microphoneEchoCancellation;
        }
        if (els.microphoneNoiseSuppression) {
            els.microphoneNoiseSuppression.checked = state.microphoneNoiseSuppression;
        }
        if (els.microphoneAutoGainControl) {
            els.microphoneAutoGainControl.checked = state.microphoneAutoGainControl;
        }
        updateJoinMediaToggleButtons();
        bindEvents();
        setJoinResult('');
        setConnectionStatus('');
        setHandRaiseStatus(t('broadcast_room_join.hand_raise_waiting', 'Söz isteği için önce odaya katılın.'));
        setLocalBackupRecordingStatus('');
        if (els.participantIdentity) {
            els.participantIdentity.textContent = '-';
        }
        renderParticipantList();
        renderChatMessageList();
        renderChatPanel();
        renderJoinDevicePanel();
        renderHostActivityPanel();
        renderMoreInfoPanel();
        renderParticipantsPanel();
        renderLiveCaptionPanel();
        updateAudioChannelVisibility();
        updateHandRaiseButtonUi();
        updateMediaPermissionControls();
        updateScreenShareControls();
        updateJoinViewState();
        await loadInviteInfo();
        await refreshDevices();
        updateJoinMediaToggleButtons();
        updateButtons();
        if (els.chatAutoAnnounce) {
            els.chatAutoAnnounce.checked = true;
        }
        if (els.participantPresenceAutoAnnounce) {
            els.participantPresenceAutoAnnounce.checked = state.participantPresenceAutoAnnounce;
        }
        if (els.lowBandwidthMode) {
            els.lowBandwidthMode.checked = state.lowBandwidthMode;
        }
        setStatus(t('broadcast_room_join.ready_status', 'Katılım sayfası hazır.'));
    }

    init().catch((error) => {
        setStatus(t('broadcast_room_join.init_failed', 'Katılım sayfası başlatılamadı: {error}', {
            error: error.message
        }));
    });
}());
