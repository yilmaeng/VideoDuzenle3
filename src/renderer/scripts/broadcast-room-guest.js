const { ipcRenderer } = require('electron');

const i18nState = {
    cache: {},
    currentLang: 'tr',
    async init() {
        this.currentLang = await ipcRenderer.invoke('i18n-get-language');
        this.cache = await ipcRenderer.invoke('i18n-get-all');
        document.documentElement.lang = this.currentLang;
        this.translateDom();
    },
    t(key, fallback, params = {}) {
        const value = key.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), this.cache);
        const template = typeof value === 'string' && value ? value : fallback;
        return Object.entries(params).reduce((result, [paramKey, paramValue]) => result.replaceAll(`{${paramKey}}`, String(paramValue)), template);
    },
    translateDom() {
        document.querySelectorAll('[data-i18n]').forEach((el) => {
            const key = el.getAttribute('data-i18n');
            const value = this.t(key, '');
            if (value) {
                el.textContent = value;
            }
        });
        document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
            const key = el.getAttribute('data-i18n-aria');
            const value = this.t(key, '');
            if (value) {
                el.setAttribute('aria-label', value);
            }
        });
        const titleEl = document.querySelector('title[data-i18n]');
        if (titleEl) {
            const value = this.t(titleEl.getAttribute('data-i18n'), '');
            if (value) {
                document.title = value;
            }
        }
    }
};

function t(key, fallback, params = {}) {
    return i18nState.t(key, fallback, params);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const state = {
    inviteUrl: '',
    roomId: '',
    joined: false,
    participants: [],
    displayName: '',
    audioDevices: {
        cameras: [],
        microphones: [],
        speakers: [],
        selectedCameraId: '',
        selectedMicrophoneId: '',
        selectedSpeakerId: '',
        microphoneVolume: 1,
        speakerVolume: 1
    },
    availableShareSources: [],
    selectedShareSourceId: '',
    activeShareStream: null,
    activeShareKind: '',
    activeShareLabel: '',
    activeShareIncludeAudio: false
};

const els = {
    statusLine: document.getElementById('status-line'),
    displayName: document.getElementById('guest-display-name'),
    inviteLink: document.getElementById('guest-invite-link'),
    cameraEnabled: document.getElementById('guest-camera-enabled'),
    cameraDevice: document.getElementById('guest-camera-device'),
    microphoneEnabled: document.getElementById('guest-microphone-enabled'),
    microphoneDevice: document.getElementById('guest-microphone-device'),
    speakerDevice: document.getElementById('guest-speaker-device'),
    microphoneVolume: document.getElementById('guest-microphone-volume'),
    microphoneVolumeValue: document.getElementById('guest-microphone-volume-value'),
    speakerVolume: document.getElementById('guest-speaker-volume'),
    speakerVolumeValue: document.getElementById('guest-speaker-volume-value'),
    shareSourceSelect: document.getElementById('guest-share-source-select'),
    shareAudioEnabled: document.getElementById('guest-share-audio-enabled'),
    shareAudioMode: document.getElementById('guest-share-audio-mode'),
    roomCode: document.getElementById('guest-room-code'),
    participants: document.getElementById('guest-participants'),
    btnJoinRoom: document.getElementById('btn-join-room'),
    btnCloseWindow: document.getElementById('btn-close-window'),
    btnStartShare: document.getElementById('btn-start-share'),
    btnStopShare: document.getElementById('btn-stop-share'),
    shareStatus: document.getElementById('guest-share-status'),
    liveRegion: document.getElementById('live-region')
};

function announce(message) {
    if (!els.liveRegion) {
        return;
    }
    els.liveRegion.textContent = '';
    requestAnimationFrame(() => {
        els.liveRegion.textContent = message;
    });
}

function setStatus(message) {
    if (els.statusLine) {
        els.statusLine.textContent = message;
    }
    announce(message);
}

function setShareStatus(message) {
    if (els.shareStatus) {
        els.shareStatus.textContent = message;
    }
}

function updateMediaActionButton(button, isEnabled, enabledLabelKey, enabledFallback, disabledLabelKey, disabledFallback) {
    if (!button) {
        return;
    }
    const enabled = Boolean(isEnabled);
    const label = enabled
        ? t(enabledLabelKey, enabledFallback)
        : t(disabledLabelKey, disabledFallback);
    button.checked = enabled;
    button.textContent = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
}

function updateGuestMediaActionButtons() {
    updateMediaActionButton(
        els.microphoneEnabled,
        typeof els.microphoneEnabled?.checked === 'boolean' ? els.microphoneEnabled.checked : true,
        'broadcast_room.guest_microphone_stop_button',
        'Sesimi kapat',
        'broadcast_room.guest_microphone_start_button',
        'Sesimi aç'
    );
    updateMediaActionButton(
        els.cameraEnabled,
        typeof els.cameraEnabled?.checked === 'boolean' ? els.cameraEnabled.checked : true,
        'broadcast_room.guest_camera_stop_button',
        'Videomu durdur',
        'broadcast_room.guest_camera_start_button',
        'Videomu başlat'
    );
}

function updateShareButtonState() {
    const hasActiveShare = !!state.activeShareKind;
    if (els.btnStartShare) {
        els.btnStartShare.hidden = hasActiveShare;
        els.btnStartShare.disabled = hasActiveShare;
    }
    if (els.btnStopShare) {
        els.btnStopShare.hidden = !hasActiveShare;
        els.btnStopShare.disabled = !hasActiveShare;
    }
    if (els.shareSourceSelect) {
        els.shareSourceSelect.disabled = hasActiveShare || !state.availableShareSources.length;
    }
    if (els.shareAudioEnabled) {
        els.shareAudioEnabled.disabled = hasActiveShare;
    }
    if (els.shareAudioMode) {
        els.shareAudioMode.disabled = hasActiveShare;
    }
}

function getGuestShareAudioMode() {
    const mode = String(els.shareAudioMode?.value || 'echo_safe').trim();
    return mode === 'high_quality' ? 'high_quality' : 'echo_safe';
}

function isGuestHighQualityShareAudioMode() {
    return getGuestShareAudioMode() === 'high_quality';
}

function buildGuestDisplayMediaConstraints(includeAudio) {
    const highQualityAudio = isGuestHighQualityShareAudioMode();
    return {
        selfBrowserSurface: 'exclude',
        systemAudio: 'include',
        windowAudio: 'window',
        surfaceSwitching: 'include',
        video: true,
        audio: includeAudio ? {
            channelCount: { ideal: 2 },
            sampleRate: 48000,
            echoCancellation: !highQualityAudio,
            noiseSuppression: !highQualityAudio,
            autoGainControl: false
        } : false
    };
}

function buildGuestDesktopAudioConstraints(sourceId) {
    const highQualityAudio = isGuestHighQualityShareAudioMode();
    return {
        mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId
        },
        optional: [
            { echoCancellation: !highQualityAudio },
            { googEchoCancellation: !highQualityAudio },
            { noiseSuppression: !highQualityAudio },
            { googNoiseSuppression: !highQualityAudio },
            { autoGainControl: false },
            { googAutoGainControl: false }
        ]
    };
}

function formatStatusLabel(enabled) {
    return enabled === false ? t('broadcast_room.status_off', 'Kapalı') : t('broadcast_room.status_on', 'Açık');
}

function getShareKindLabel(shareKind) {
    if (shareKind === 'window') {
        return t('broadcast_room.share_kind_window', 'Pencere paylaşımı');
    }
    if (shareKind === 'application') {
        return t('broadcast_room.share_kind_application', 'Uygulama paylaşımı');
    }
    return t('broadcast_room.share_kind_screen', 'Ekran paylaşımı');
}

function renderParticipants() {
    if (!state.participants.length) {
        els.participants.innerHTML = `<p>${escapeHtml(t('broadcast_room.no_participants', 'Henüz katılımcı bağlanmadı.'))}</p>`;
        return;
    }

    const items = state.participants.map((participant) => (
        `<li>${escapeHtml(t('broadcast_room.participant_item', '{name} - {role}. Kamera: {camera}. Mikrofon: {microphone}.', {
            name: participant.name,
            role: participant.role,
            camera: formatStatusLabel(participant.cameraEnabled),
            microphone: formatStatusLabel(participant.microphoneEnabled)
        }))}</li>`
    )).join('');

    els.participants.innerHTML = `<ul>${items}</ul>`;
}

function renderRoomSnapshot() {
    els.inviteLink.value = state.inviteUrl || '';
    els.roomCode.textContent = state.roomId || t('broadcast_room.value_not_available', 'Hazır değil');
    renderParticipants();
}

function renderAudioDeviceSelectors() {
    const configs = [
        {
            element: els.cameraDevice,
            items: state.audioDevices.cameras,
            selected: state.audioDevices.selectedCameraId,
            fallback: t('broadcast_room.no_camera_devices', 'Kullanılabilir kamera bulunamadı')
        },
        {
            element: els.microphoneDevice,
            items: state.audioDevices.microphones,
            selected: state.audioDevices.selectedMicrophoneId,
            fallback: t('broadcast_room.no_microphone_devices', 'Kullanılabilir mikrofon bulunamadı')
        },
        {
            element: els.speakerDevice,
            items: state.audioDevices.speakers,
            selected: state.audioDevices.selectedSpeakerId,
            fallback: t('broadcast_room.no_speaker_devices', 'Kullanılabilir hoparlör bulunamadı')
        }
    ];

    configs.forEach((config) => {
        if (!config.element) {
            return;
        }
        const items = config.items.length ? config.items : [{ deviceId: '', label: config.fallback }];
        config.element.innerHTML = items.map((item) => (
            `<option value="${escapeHtml(item.deviceId)}">${escapeHtml(item.label)}</option>`
        )).join('');
        config.element.value = config.selected || items[0].deviceId;
        config.element.disabled = !config.items.length;
    });
    updateAudioLevelLabels();
}

function clampAudioLevelPercent(value, fallback = 100) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }
    return Math.max(0, Math.min(200, numeric));
}

function getGuestMicrophoneVolume() {
    return clampAudioLevelPercent(els.microphoneVolume?.value || state.audioDevices.microphoneVolume * 100) / 100;
}

function getGuestSpeakerVolume() {
    return clampAudioLevelPercent(els.speakerVolume?.value || state.audioDevices.speakerVolume * 100) / 100;
}

function updateAudioLevelLabels() {
    if (els.microphoneVolumeValue) {
        els.microphoneVolumeValue.textContent = `${Math.round(getGuestMicrophoneVolume() * 100)}%`;
    }
    if (els.speakerVolumeValue) {
        els.speakerVolumeValue.textContent = `${Math.round(getGuestSpeakerVolume() * 100)}%`;
    }
}

function renderShareSourceSelector() {
    if (!els.shareSourceSelect) {
        return;
    }

    const items = state.availableShareSources.length
        ? state.availableShareSources
        : [{ id: '', name: t('broadcast_room.no_share_sources', 'Kullanılabilir paylaşım kaynağı bulunamadı') }];

    els.shareSourceSelect.innerHTML = items.map((item) => (
        `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`
    )).join('');
    els.shareSourceSelect.disabled = !state.availableShareSources.length;
    const selectedId = state.selectedShareSourceId && state.availableShareSources.some((item) => item.id === state.selectedShareSourceId)
        ? state.selectedShareSourceId
        : (state.availableShareSources[0]?.id || '');
    state.selectedShareSourceId = selectedId;
    els.shareSourceSelect.value = selectedId;
    updateShareButtonState();
}

function applySnapshot(snapshot) {
    if (!snapshot) {
        return;
    }

    state.roomId = String(snapshot.roomState?.roomId || state.roomId || '');
    state.inviteUrl = String(snapshot.roomState?.inviteUrl || state.inviteUrl || '');
    state.participants = Array.isArray(snapshot.participants) ? snapshot.participants : [];

    const me = state.participants.find((participant) => participant.name === state.displayName && participant.role !== 'host');
    if (me) {
        if (els.cameraEnabled) {
            els.cameraEnabled.checked = me.cameraEnabled !== false;
        }
        if (els.microphoneEnabled) {
            els.microphoneEnabled.checked = me.microphoneEnabled !== false;
        }
        if (me.activeShare) {
            state.activeShareKind = me.activeShare.shareKind || '';
            state.activeShareLabel = me.activeShare.label || '';
            state.activeShareIncludeAudio = me.activeShare.includeAudio === true;
            setShareStatus(t('broadcast_room.status_share_active', 'Etkin paylaşım: {label}', {
                label: me.activeShare.label || getShareKindLabel(me.activeShare.shareKind)
            }));
        } else {
            state.activeShareKind = '';
            state.activeShareLabel = '';
            state.activeShareIncludeAudio = false;
            setShareStatus(t('broadcast_room.status_share_inactive', 'Şu anda etkin paylaşım yok.'));
        }
    }

    renderRoomSnapshot();
    updateShareButtonState();
}

function updateSelectedAudioDevice(type, value) {
    const map = {
        camera: 'selectedCameraId',
        microphone: 'selectedMicrophoneId',
        speaker: 'selectedSpeakerId'
    };
    state.audioDevices[map[type]] = String(value || '');

    const sourceLists = {
        camera: state.audioDevices.cameras,
        microphone: state.audioDevices.microphones,
        speaker: state.audioDevices.speakers
    };
    const selected = sourceLists[type].find((item) => item.deviceId === value);
    const keyMap = {
        camera: 'broadcast_room.status_guest_camera_device_selected',
        microphone: 'broadcast_room.status_guest_microphone_device_selected',
        speaker: 'broadcast_room.status_guest_speaker_device_selected'
    };
    const fallbackMap = {
        camera: 'Seçili kamera değiştirildi: {name}',
        microphone: 'Seçili mikrofon değiştirildi: {name}',
        speaker: 'Seçili hoparlör değiştirildi: {name}'
    };

    setStatus(t(keyMap[type], fallbackMap[type], {
        name: selected?.label || t('broadcast_room.unknown_device', 'Bilinmeyen aygıt')
    }));
}

function buildGuestShareSourcePool({ screens = [], windows = [] }) {
    const sources = [];

    screens.forEach((screen, index) => {
        sources.push({
            id: String(screen.id || ''),
            shareKind: 'screen',
            name: screen.name || t('broadcast_room.default_source_local_screen', 'Yerel ekran paylaşımı') || t('broadcast_room.share_source_fallback_screen', 'Ekran {index}', { index: String(index + 1) })
        });
    });

    windows.forEach((windowItem, index) => {
        const normalizedName = String(windowItem.name || '').trim();
        const lowerName = normalizedName.toLowerCase();
        const looksLikeApp = lowerName && !lowerName.includes(' - ') && !lowerName.includes('/') && !lowerName.includes('\\');
        sources.push({
            id: String(windowItem.id || ''),
            shareKind: looksLikeApp ? 'application' : 'window',
            name: normalizedName || t('broadcast_room.share_source_fallback_window', 'Pencere {index}', { index: String(index + 1) })
        });
    });

    return sources.filter((item) => item.id);
}

async function refreshShareSources() {
    let screens = [];
    let windows = [];

    try {
        const result = await ipcRenderer.invoke('get-desktop-sources', {
            types: ['screen'],
            fetchWindowIcons: false,
            thumbnailSize: { width: 0, height: 0 }
        });
        if (result?.success && Array.isArray(result.sources)) {
            screens = result.sources;
        }
    } catch (error) {
        console.error('Broadcast room guest screen sources error:', error);
    }

    try {
        const result = await ipcRenderer.invoke('get-desktop-sources', {
            types: ['window'],
            fetchWindowIcons: false,
            thumbnailSize: { width: 0, height: 0 }
        });
        if (result?.success && Array.isArray(result.sources)) {
            windows = result.sources;
        }
    } catch (error) {
        console.error('Broadcast room guest window sources error:', error);
    }

    state.availableShareSources = buildGuestShareSourcePool({ screens, windows });
    renderShareSourceSelector();
}

async function joinRoom() {
    const displayName = String(els.displayName?.value || '').trim();
    if (!displayName) {
        setStatus(t('broadcast_room.status_guest_name_required', 'Lütfen görünen adınızı yazın.'));
        els.displayName?.focus();
        return;
    }

    if (!state.inviteUrl) {
        setStatus(t('broadcast_room.status_join_missing_room', 'Katılmak için geçerli bir davet bağlantısı bulunamadı.'));
        return;
    }

    const result = await ipcRenderer.invoke('broadcast-room-join-prototype-room', {
        inviteUrl: state.inviteUrl,
        displayName,
        cameraEnabled: !!els.cameraEnabled?.checked,
        microphoneEnabled: !!els.microphoneEnabled?.checked
    });

    if (!result?.success) {
        setStatus(t('broadcast_room.status_guest_join_failed', 'Odaya katılım başarısız oldu: {error}', {
            error: result?.error || 'unknown_error'
        }));
        return;
    }

    state.displayName = displayName;
    state.joined = true;
    applySnapshot(result.snapshot);
    setStatus(t('broadcast_room.status_guest_joined_room', '{name} olarak odaya katıldınız.', { name: displayName }));
}

async function updateOwnMediaState(options = {}) {
    if (!state.joined) {
        return;
    }

    const result = await ipcRenderer.invoke('broadcast-room-update-prototype-media-state', options);
    if (!result?.success) {
        setStatus(t('broadcast_room.status_media_state_update_failed', 'Medya durumu güncellenemedi: {error}', {
            error: result?.error || 'unknown_error'
        }));
        return;
    }
    applySnapshot(result.snapshot);
}

function detectShareKind(track) {
    const displaySurface = String(track?.getSettings?.().displaySurface || '').toLowerCase();
    if (displaySurface === 'window') {
        return 'window';
    }
    if (displaySurface === 'browser') {
        return 'application';
    }
    return 'screen';
}

async function notifyShareState(options = {}) {
    const result = await ipcRenderer.invoke('broadcast-room-update-prototype-share-state', options);
    if (!result?.success) {
        setStatus(t('broadcast_room.status_share_update_failed', 'Paylaşım durumu güncellenemedi: {error}', {
            error: result?.error || 'unknown_error'
        }));
        return false;
    }
    applySnapshot(result.snapshot);
    return true;
}

async function stopShare({ announceStop = true } = {}) {
    if (state.activeShareStream) {
        state.activeShareStream.getTracks().forEach((track) => track.stop());
        state.activeShareStream = null;
    }

    if (!state.joined) {
        state.activeShareKind = '';
        state.activeShareLabel = '';
        state.activeShareIncludeAudio = false;
        setShareStatus(t('broadcast_room.status_share_inactive', 'Şu anda etkin paylaşım yok.'));
        updateShareButtonState();
        return;
    }

    const updated = await notifyShareState({ clearShare: true });
    if (updated && announceStop) {
        setStatus(t('broadcast_room.status_share_stopped', '{kind} durduruldu.', {
            kind: getShareKindLabel(state.activeShareKind)
        }));
    }
    state.activeShareKind = '';
    state.activeShareLabel = '';
    state.activeShareIncludeAudio = false;
    setShareStatus(t('broadcast_room.status_share_inactive', 'Şu anda etkin paylaşım yok.'));
    updateShareButtonState();
}

async function startShare() {
    if (!state.joined) {
        setStatus(t('broadcast_room.status_share_before_join', 'Paylaşım başlatmadan önce odaya katılın.'));
        return;
    }

    try {
        const wantsAudio = !!els.shareAudioEnabled?.checked;
        let stream;
        let shareKind = '';
        let label = '';
        let includeAudio = false;

        const canFallbackToDesktopSource = () => {
            const selectedSourceId = String(state.selectedShareSourceId || els.shareSourceSelect?.value || '').trim();
            return !!selectedSourceId;
        };

        const shouldFallbackFromDisplayMedia = (error) => {
            const name = String(error?.name || '').toLowerCase();
            const message = String(error?.message || '').toLowerCase();
            return name.includes('notsupported')
                || name.includes('notfound')
                || message.includes('not supported')
                || message.includes('not implemented')
                || message.includes('requested device not found');
        };

        const startShareWithDesktopSource = async () => {
            const selectedSourceId = String(state.selectedShareSourceId || els.shareSourceSelect?.value || '').trim();
            if (!selectedSourceId) {
                setStatus(t('broadcast_room.status_share_source_missing', 'Önce paylaşılacak bir kaynak seçin.'));
                return null;
            }

            const selectedSource = state.availableShareSources.find((item) => item.id === selectedSourceId);
            if (!selectedSource) {
                setStatus(t('broadcast_room.status_share_source_missing', 'Önce paylaşılacak bir kaynak seçin.'));
                return null;
            }

            let localStream;
            try {
                localStream = await navigator.mediaDevices.getUserMedia({
                    audio: wantsAudio ? buildGuestDesktopAudioConstraints(selectedSourceId) : false,
                    video: {
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            chromeMediaSourceId: selectedSourceId,
                            minWidth: 1280,
                            maxWidth: 1920,
                            minHeight: 720,
                            maxHeight: 1080
                        }
                    }
                });
            } catch (primaryError) {
                if (!wantsAudio) {
                    throw primaryError;
                }
                localStream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: {
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            chromeMediaSourceId: selectedSourceId,
                            minWidth: 1280,
                            maxWidth: 1920,
                            minHeight: 720,
                            maxHeight: 1080
                        }
                    }
                });
            }

            return {
                stream: localStream,
                shareKind: selectedSource.shareKind || 'screen',
                label: String(selectedSource.name || getShareKindLabel(selectedSource.shareKind || 'screen')).trim(),
                includeAudio: localStream.getAudioTracks().length > 0
            };
        };

        if (navigator.mediaDevices?.getDisplayMedia) {
            try {
                const displayStream = await navigator.mediaDevices.getDisplayMedia(buildGuestDisplayMediaConstraints(wantsAudio));
                const videoTrack = displayStream.getVideoTracks()[0];
                stream = displayStream;
                shareKind = detectShareKind(videoTrack);
                label = String(videoTrack?.label || getShareKindLabel(shareKind)).trim();
                includeAudio = displayStream.getAudioTracks().length > 0;
            } catch (primaryError) {
                if (primaryError?.name === 'NotAllowedError') {
                    throw primaryError;
                }
                if (shouldFallbackFromDisplayMedia(primaryError) && canFallbackToDesktopSource()) {
                    const fallbackResult = await startShareWithDesktopSource();
                    if (!fallbackResult) {
                        return;
                    }
                    stream = fallbackResult.stream;
                    shareKind = fallbackResult.shareKind;
                    label = fallbackResult.label;
                    includeAudio = fallbackResult.includeAudio;
                } else if (wantsAudio && !shouldFallbackFromDisplayMedia(primaryError)) {
                    const displayStream = await navigator.mediaDevices.getDisplayMedia({
                        video: true,
                        audio: false
                    });
                    const videoTrack = displayStream.getVideoTracks()[0];
                    stream = displayStream;
                    shareKind = detectShareKind(videoTrack);
                    label = String(videoTrack?.label || getShareKindLabel(shareKind)).trim();
                    includeAudio = false;
                } else {
                    throw primaryError;
                }
            }
        } else {
            const fallbackResult = await startShareWithDesktopSource();
            if (!fallbackResult) {
                return;
            }
            stream = fallbackResult.stream;
            shareKind = fallbackResult.shareKind;
            label = fallbackResult.label;
            includeAudio = fallbackResult.includeAudio;
        }

        const videoTrack = stream.getVideoTracks()[0];

        videoTrack?.addEventListener('ended', () => {
            stopShare({ announceStop: true }).catch((error) => {
                console.error('Broadcast room guest share auto-stop error:', error);
            });
        }, { once: true });

        state.activeShareStream = stream;
        state.activeShareKind = shareKind;
        state.activeShareLabel = label;
        state.activeShareIncludeAudio = includeAudio;
        updateShareButtonState();

        const updated = await notifyShareState({
            shareKind,
            label,
            includeAudio
        });

        if (!updated) {
            stream.getTracks().forEach((track) => track.stop());
            state.activeShareStream = null;
            return;
        }

        setShareStatus(t('broadcast_room.status_share_active', 'Etkin paylaşım: {label}', { label }));
        if (wantsAudio && !includeAudio) {
            setStatus(t('broadcast_room.status_share_audio_unavailable', 'Paylaşım başladı ancak bu kaynak için ses alınamadı.'));
        } else if (includeAudio) {
            setStatus(t('broadcast_room.status_share_started_with_audio', '{kind} başladı. Kaynak sesi dahil ediliyor.', {
                kind: getShareKindLabel(shareKind)
            }));
        } else {
            setStatus(t('broadcast_room.status_share_started', '{kind} başladı.', {
                kind: getShareKindLabel(shareKind)
            }));
        }
    } catch (error) {
        const message = error?.name === 'NotAllowedError'
            ? t('broadcast_room.status_share_cancelled', 'Paylaşım seçimi iptal edildi.')
            : t('broadcast_room.status_share_failed', 'Paylaşım başlatılamadı: {error}', {
                error: error.message
            });
        setStatus(message);
    }
}

function applyInitOptions(options = {}) {
    state.inviteUrl = String(options.inviteUrl || '');
    state.roomId = String(options.roomId || '');
    const suggestedName = String(options.suggestedDisplayName || '').trim();
    if (suggestedName) {
        state.displayName = suggestedName;
    }

    els.inviteLink.value = state.inviteUrl;
    els.displayName.value = state.displayName;
    renderRoomSnapshot();

    if (state.roomId) {
        ipcRenderer.invoke('broadcast-room-get-prototype-room-snapshot', state.roomId)
            .then((result) => {
                if (result?.success && result.snapshot) {
                    applySnapshot(result.snapshot);
                }
            })
            .catch((error) => {
                console.error('Broadcast room guest snapshot error:', error);
            });
    }
}

async function refreshAudioDevices() {
    let cameras = [];
    let microphones = [];
    let speakers = [];

    try {
        if (navigator.mediaDevices?.enumerateDevices) {
            const devices = await navigator.mediaDevices.enumerateDevices();
            cameras = devices.filter((device) => device.kind === 'videoinput');
            microphones = devices.filter((device) => device.kind === 'audioinput');
            speakers = devices.filter((device) => device.kind === 'audiooutput');
        }
    } catch (error) {
        console.error('Broadcast room guest media devices error:', error);
    }

    state.audioDevices.cameras = cameras.map((device, index) => ({
        deviceId: device.deviceId || `camera-${index + 1}`,
        label: device.label || t('broadcast_room.default_camera_option', 'Kamera {index}', { index: String(index + 1) })
    }));
    state.audioDevices.microphones = microphones.map((device, index) => ({
        deviceId: device.deviceId || `microphone-${index + 1}`,
        label: device.label || t('broadcast_room.default_microphone_option', 'Mikrofon {index}', { index: String(index + 1) })
    }));
    state.audioDevices.speakers = speakers.map((device, index) => ({
        deviceId: device.deviceId || `speaker-${index + 1}`,
        label: device.label || t('broadcast_room.default_speaker_option', 'Hoparlör {index}', { index: String(index + 1) })
    }));

    state.audioDevices.selectedCameraId = state.audioDevices.selectedCameraId || state.audioDevices.cameras[0]?.deviceId || '';
    state.audioDevices.selectedMicrophoneId = state.audioDevices.selectedMicrophoneId || state.audioDevices.microphones[0]?.deviceId || '';
    state.audioDevices.selectedSpeakerId = state.audioDevices.selectedSpeakerId || state.audioDevices.speakers[0]?.deviceId || '';
    renderAudioDeviceSelectors();
}

function bindEvents() {
    els.btnJoinRoom?.addEventListener('click', () => joinRoom().catch((error) => {
        console.error('Broadcast room guest join error:', error);
        setStatus(t('broadcast_room.status_guest_join_failed', 'Odaya katılım başarısız oldu: {error}', {
            error: error.message
        }));
    }));
    els.btnCloseWindow?.addEventListener('click', () => window.close());
    els.cameraEnabled?.addEventListener('click', () => {
        els.cameraEnabled.checked = !Boolean(els.cameraEnabled.checked);
        updateGuestMediaActionButtons();
        updateOwnMediaState({ cameraEnabled: !!els.cameraEnabled.checked }).catch((error) => {
            els.cameraEnabled.checked = !Boolean(els.cameraEnabled.checked);
            updateGuestMediaActionButtons();
            setStatus(t('broadcast_room.status_media_state_update_failed', 'Medya durumu güncellenemedi: {error}', {
                error: error.message
            }));
        });
    });
    els.microphoneEnabled?.addEventListener('click', () => {
        els.microphoneEnabled.checked = !Boolean(els.microphoneEnabled.checked);
        updateGuestMediaActionButtons();
        updateOwnMediaState({ microphoneEnabled: !!els.microphoneEnabled.checked }).catch((error) => {
            els.microphoneEnabled.checked = !Boolean(els.microphoneEnabled.checked);
            updateGuestMediaActionButtons();
            setStatus(t('broadcast_room.status_media_state_update_failed', 'Medya durumu güncellenemedi: {error}', {
                error: error.message
            }));
        });
    });
    els.cameraDevice?.addEventListener('change', () => updateSelectedAudioDevice('camera', els.cameraDevice.value));
    els.microphoneDevice?.addEventListener('change', () => updateSelectedAudioDevice('microphone', els.microphoneDevice.value));
    els.speakerDevice?.addEventListener('change', () => updateSelectedAudioDevice('speaker', els.speakerDevice.value));
    els.microphoneVolume?.addEventListener('input', () => {
        state.audioDevices.microphoneVolume = getGuestMicrophoneVolume();
        updateAudioLevelLabels();
    });
    els.speakerVolume?.addEventListener('input', () => {
        state.audioDevices.speakerVolume = getGuestSpeakerVolume();
        updateAudioLevelLabels();
    });
    els.shareSourceSelect?.addEventListener('change', () => {
        state.selectedShareSourceId = String(els.shareSourceSelect.value || '');
    });
    els.btnStartShare?.addEventListener('click', () => startShare().catch((error) => {
        console.error('Broadcast room guest share start error:', error);
        setStatus(t('broadcast_room.status_share_failed', 'Paylaşım başlatılamadı: {error}', {
            error: error.message
        }));
    }));
    els.btnStopShare?.addEventListener('click', () => stopShare({ announceStop: true }).catch((error) => {
        console.error('Broadcast room guest share stop error:', error);
        setStatus(t('broadcast_room.status_share_failed', 'Paylaşım başlatılamadı: {error}', {
            error: error.message
        }));
    }));

    els.displayName?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            els.btnJoinRoom?.click();
        }
    });

    window.addEventListener('beforeunload', () => {
        if (state.activeShareStream) {
            state.activeShareStream.getTracks().forEach((track) => track.stop());
        }
    });

    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            window.close();
        }
    });
}

async function init() {
    await i18nState.init();
    bindEvents();
    updateGuestMediaActionButtons();
    renderRoomSnapshot();
    await refreshAudioDevices();
    await refreshShareSources();
    renderShareSourceSelector();
    setShareStatus(t('broadcast_room.status_share_inactive', 'Şu anda etkin paylaşım yok.'));
    updateShareButtonState();
    setStatus(t('broadcast_room.status_guest_window_ready', 'Konuk katılım penceresi hazır.'));

    if (navigator.mediaDevices?.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', () => {
            refreshAudioDevices().catch((error) => {
                console.error('Broadcast room guest devicechange refresh error:', error);
            });
            refreshShareSources().catch((error) => {
                console.error('Broadcast room guest share source refresh error:', error);
            });
        });
    }
}

ipcRenderer.on('broadcast-room-guest-init', (_event, options) => {
    applyInitOptions(options || {});
});

ipcRenderer.on('broadcast-room-room-state', (_event, snapshot) => {
    applySnapshot(snapshot);
    if (state.joined) {
        setStatus(t('broadcast_room.status_guest_room_updated', 'Oda bilgisi güncellendi. Toplam {count} katılımcı var.', {
            count: String(state.participants.length)
        }));
    }
});

ipcRenderer.on('broadcast-room-room-closed', () => {
    state.joined = false;
    state.participants = [];
    renderRoomSnapshot();
    setShareStatus(t('broadcast_room.status_share_inactive', 'Şu anda etkin paylaşım yok.'));
    state.activeShareKind = '';
    state.activeShareLabel = '';
    state.activeShareIncludeAudio = false;
    updateShareButtonState();
    setStatus(t('broadcast_room.status_guest_room_closed', 'Host odayı kapattı. Bu test oturumu sona erdi.'));
});

init().catch((error) => {
    console.error('Broadcast room guest init error:', error);
    setStatus(t('broadcast_room.status_shell_failed', 'Yayın Odası başlatılamadı: {error}', {
        error: error.message
    }));
});
