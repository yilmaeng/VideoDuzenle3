const { ipcRenderer, shell, desktopCapturer, clipboard } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const SCENE_BACKGROUND_PROFILE_STORAGE_KEY = 'evdSceneBackgroundProfiles';
const recordingI18n = {
    currentLang: 'tr',
    cache: {},
    async init() {
        try {
            this.currentLang = await ipcRenderer.invoke('i18n-get-language');
            this.cache = await ipcRenderer.invoke('i18n-get-all');
            document.documentElement.lang = this.currentLang;
            this.translateDOM();
            ipcRenderer.on('language-changed', async (_event, lang) => {
                this.currentLang = lang;
                this.cache = await ipcRenderer.invoke('i18n-get-all');
                document.documentElement.lang = this.currentLang;
                this.translateDOM();
                if (typeof window.updateManualPresetLabel === 'function') {
                    window.updateManualPresetLabel();
                }
                if (typeof window.updateObsStatsSummary === 'function') {
                    window.updateObsStatsSummary();
                }
            });
        } catch (error) {
            console.error('Recording wizard i18n init failed:', error);
        }
    },
    t(key, fallback, params = {}) {
        const value = key.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), this.cache);
        const template = (typeof value === 'string' && value) ? value : fallback;
        return Object.entries(params).reduce((result, [paramKey, paramValue]) => result.replaceAll(`{${paramKey}}`, String(paramValue)), template);
    },
    translateDOM() {
        document.querySelectorAll('[data-i18n]').forEach((el) => {
            const key = el.getAttribute('data-i18n');
            const translation = this.t(key, '');
            if (translation) el.textContent = translation;
        });
        document.querySelectorAll('[data-i18n-html]').forEach((el) => {
            const key = el.getAttribute('data-i18n-html');
            const translation = this.t(key, '');
            if (translation) el.innerHTML = translation;
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
            const key = el.getAttribute('data-i18n-placeholder');
            const translation = this.t(key, '');
            if (translation) el.placeholder = translation;
        });
        document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
            const key = el.getAttribute('data-i18n-aria');
            const translation = this.t(key, '');
            if (translation) el.setAttribute('aria-label', translation);
        });
        const titleEl = document.querySelector('title[data-i18n]');
        if (titleEl) {
            const translation = this.t(titleEl.getAttribute('data-i18n'), '');
            if (translation) document.title = translation;
        }
    }
};
function t(key, fallback, params = {}) {
    return recordingI18n.t(key, fallback, params);
}
function isTurkishUi() {
    return (recordingI18n.currentLang || 'tr').toLowerCase().startsWith('tr');
}
function getSpeechLocale() {
    return isTurkishUi() ? 'tr-TR' : 'en-US';
}

const AUDIO_BALANCE_PRESETS = {
    manual: null,
    balanced: {
        micVolume: 260,
        systemVolume: 85
    },
    remote_focus: {
        micVolume: 225,
        systemVolume: 110
    }
};

let pendingLaunchOptions = {};
let recordingWizardReady = false;
let interviewQuickStartAttempted = false;
let recordingTimelineInterval = null;
let obsStatsInterval = null;
let recordingAudioKeepAlive = null;

async function startRecordingAudioKeepAlive() {
    if (recordingAudioKeepAlive || state.mode === 'broadcast' || !els.systemAudioEnable?.checked) {
        return false;
    }

    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return false;

        const context = new AudioContextClass({ latencyHint: 'playback' });
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(997, context.currentTime);
        gain.gain.setValueAtTime(1e-7, context.currentTime);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        if (context.state === 'suspended') {
            await context.resume();
        }

        recordingAudioKeepAlive = { context, oscillator, gain };
        logRecordingWizard('recording_audio_keepalive_started', {
            sampleRate: context.sampleRate,
            state: context.state
        });
        await delay(350);
        return true;
    } catch (error) {
        console.warn('[RecordingWizard] Audio keep-alive could not be started:', error);
        logRecordingWizard('recording_audio_keepalive_failed', {
            error: error?.message || String(error)
        });
        return false;
    }
}

async function stopRecordingAudioKeepAlive(reason = 'recording_stopped') {
    const keepAlive = recordingAudioKeepAlive;
    recordingAudioKeepAlive = null;
    if (!keepAlive) return;

    try {
        keepAlive.gain.gain.setValueAtTime(0, keepAlive.context.currentTime);
        keepAlive.oscillator.stop();
    } catch (error) { }
    try {
        await keepAlive.context.close();
    } catch (error) { }
    logRecordingWizard('recording_audio_keepalive_stopped', { reason });
}

ipcRenderer.on('recording-wizard-init', (_event, options) => {
    pendingLaunchOptions = options || {};
    if (recordingWizardReady) {
        applyLaunchProfile();
    }
});

ipcRenderer.on('live-broadcast-emergency-stopped', () => {
    try {
        if (typeof state !== 'undefined') {
            state.recordingActive = false;
            state.streamingActive = false;
            state.recordingPaused = false;
            state.sessionActionInProgress = false;
        }
        if (typeof resetYouTubeChatState === 'function') {
            resetYouTubeChatState();
        }
        if (typeof updateBroadcastUi === 'function') {
            updateBroadcastUi();
        }
        if (els?.recordingStatus) {
            els.recordingStatus.textContent = t('recording_wizard.broadcast.stopped', 'Canli yayin durduruldu.');
        }
    } catch (error) {
        console.warn('Emergency live broadcast UI sync failed:', error.message);
    }
});

function logRecordingWizard(eventName, details = {}) {
    try {
        ipcRenderer.send('recording-wizard-log', {
            event: eventName,
            stepIndex: typeof state !== 'undefined' ? state.stepIndex : null,
            launchProfile: typeof state !== 'undefined' ? state.launchProfile : null,
            obsFound: typeof state !== 'undefined' ? state.obsFound : null,
            obsConnected: typeof state !== 'undefined' ? state.obsConnected : null,
            relativeMs: typeof state !== 'undefined' && state.recordingDebugStartedAt
                ? Math.round(performance.now() - state.recordingDebugStartedAt)
                : null,
            ...details
        });
    } catch (error) {
        console.warn('recording-wizard-log send failed:', error.message);
    }
}

function clearRecordingTimelineLogger() {
    if (recordingTimelineInterval) {
        clearInterval(recordingTimelineInterval);
        recordingTimelineInterval = null;
    }
}

function clearObsStatsPolling() {
    if (obsStatsInterval) {
        clearInterval(obsStatsInterval);
        obsStatsInterval = null;
    }
}

function startRecordingTimelineLogger(reason = 'recording_started') {
    clearRecordingTimelineLogger();
    state.recordingDebugStartedAt = performance.now();
    logRecordingWizard('recording_timeline_started', { reason });

    let sampleCount = 0;
    recordingTimelineInterval = setInterval(async () => {
        sampleCount += 1;
        try {
            const status = await ipcRenderer.invoke('obs-get-recording-status');
            logRecordingWizard('recording_timeline_sample', {
                sampleCount,
                success: !!status?.success,
                outputActive: status?.outputActive ?? null,
                outputPaused: status?.outputPaused ?? null,
                outputTimecode: status?.outputTimecode ?? null,
                outputDuration: status?.outputDuration ?? null
            });
        } catch (error) {
            logRecordingWizard('recording_timeline_sample_failed', {
                sampleCount,
                error: error.message || String(error)
            });
        }

        if (sampleCount >= 40) {
            clearRecordingTimelineLogger();
            logRecordingWizard('recording_timeline_finished', { reason: 'sample_limit_reached' });
        }
    }, 250);
}

async function waitForRecordingTimelineReady({ minOutputDurationMs = 250, timeoutMs = 2500, pollMs = 100 } = {}) {
    const startedAt = Date.now();
    let attempts = 0;

    while (Date.now() - startedAt < timeoutMs) {
        attempts += 1;
        try {
            const status = await ipcRenderer.invoke('obs-get-recording-status');
            const outputDuration = Number(status?.outputDuration || 0);
            const outputActive = !!status?.outputActive;
            logRecordingWizard('recording_timeline_ready_check', {
                attempts,
                outputActive,
                outputDuration
            });
            if (outputActive && outputDuration >= minOutputDurationMs) {
                logRecordingWizard('recording_timeline_ready_reached', {
                    attempts,
                    outputDuration
                });
                return true;
            }
        } catch (error) {
            logRecordingWizard('recording_timeline_ready_check_failed', {
                attempts,
                error: error.message || String(error)
            });
        }

        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    logRecordingWizard('recording_timeline_ready_timeout', {
        attempts,
        timeoutMs,
        minOutputDurationMs
    });
    return false;
}

async function waitForStreamingOutputReady({ minOutputDurationMs = 250, timeoutMs = 5000, pollMs = 250 } = {}) {
    const startedAt = Date.now();
    let attempts = 0;

    while (Date.now() - startedAt < timeoutMs) {
        attempts += 1;
        try {
            const status = await ipcRenderer.invoke('obs-get-streaming-status');
            const outputDuration = Number(status?.outputDuration || 0);
            const outputBytes = Number(status?.outputBytes || 0);
            const outputTotalFrames = Number(status?.outputTotalFrames || 0);
            const outputActive = !!status?.outputActive;
            logRecordingWizard('broadcast_output_ready_check', {
                attempts,
                outputActive,
                outputDuration,
                outputBytes,
                outputTotalFrames
            });
            if (outputActive && (outputDuration >= minOutputDurationMs || outputBytes > 0 || outputTotalFrames > 0)) {
                logRecordingWizard('broadcast_output_ready_reached', {
                    attempts,
                    outputDuration,
                    outputBytes,
                    outputTotalFrames
                });
                return true;
            }
        } catch (error) {
            logRecordingWizard('broadcast_output_ready_check_failed', {
                attempts,
                error: error.message || String(error)
            });
        }

        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    logRecordingWizard('broadcast_output_ready_timeout', {
        attempts,
        timeoutMs,
        minOutputDurationMs
    });
    return false;
}

function getNormalizedScreenSourceName(name, index, dimensions = null) {
    const rawName = String(name || '').trim();
    const fallbackLabel = dimensions
        ? t('recording_wizard.sources.screen_dimensions', 'Screen {index} ({width}x{height})', {
            index: index + 1,
            width: dimensions.width,
            height: dimensions.height
        })
        : t('recording_wizard.sources.screen_label', 'Screen {index}', { index: index + 1 });

    if (!rawName) {
        return fallbackLabel;
    }

    const normalized = rawName.toLowerCase();
    if (
        /^entire screen(?:\s+\d+)?$/.test(normalized) ||
        /^tüm ekran(?:\s+\d+)?$/.test(normalized) ||
        /^tum ekran(?:\s+\d+)?$/.test(normalized)
    ) {
        return fallbackLabel;
    }

    return rawName;
}
function getSelectedOptionText(selectEl) {
    if (!selectEl || selectEl.selectedIndex < 0) return null;
    const option = selectEl.options[selectEl.selectedIndex];
    if (!option || option.value === 'none') return null;
    return option.textContent || option.innerText || option.value || null;
}

function buildAiSuggestionPrompt(currentPreset, currentScale, selectedBgColorText, selectedPanelFillText) {
    const bgLine = selectedBgColorText
        ? (isTurkishUi()
            ? `Kullanici kamera cercevesi/arka plani olarak "${selectedBgColorText}" secti.`
            : `The user selected "${selectedBgColorText}" for the camera frame/background.`)
        : '';
    const panelFillLine = selectedPanelFillText
        ? (isTurkishUi()
            ? `Kullanici yan yana bosluk dolgusu olarak "${selectedPanelFillText}" secti. Siyah bosluk veya letterbox alanlari bununla yeterince kapanmis mi kontrol et.`
            : `The user selected "${selectedPanelFillText}" as the side-by-side gap fill. Check whether it adequately covers black bars or letterbox areas.`)
        : (isTurkishUi()
            ? 'Yan yana duzende siyah bosluk, letterbox veya doldurulmamis panel alani goruyorsan bunu belirt ve uygun bir bosluk dolgusu oner.'
            : 'If you see black bars, letterboxing, or unfilled panel space in a side-by-side layout, mention it and recommend an appropriate gap fill.');
    if (isTurkishUi()) {
        return [
            'Sen bir video duzenleme yardimcisisin. Gorselde ekran kaydi ve kamera overlayi icin en iyi yerlesimi oner.',
            `Kullanicinin sectigi duzen: ${currentPreset}. (Kameranin su anki olcegi: %${currentScale})`,
            'Eger secilen duzende onemli icerik kesiliyorsa veya kamera yuzu cok kucuk ya da cok buyukse, oranlari degistir.',
            bgLine,
            panelFillLine,
            'JSON formatinda cevap ver:',
            '{',
            '  "camera": { "x": 1400, "y": 800, "scalePercent": 25 },',
            '  "preset": "br",',
            '  "suggested_split": "60-40",',
            '  "panelFillColor": "none",',
            '  "reason": "kisa aciklama"',
            '}'
        ].filter(Boolean).join('\n');
    }
    return [
        'You are a video production assistant. Recommend the best layout for a screen recording and camera overlay in this image.',
        `The selected layout is ${currentPreset}. (Current camera scale: ${currentScale}%)`,
        'If important content is obscured or the camera face is too small or too large, adjust the proportions.',
        bgLine,
        panelFillLine,
        'Respond in JSON format:',
        '{',
        '  "camera": { "x": 1400, "y": 800, "scalePercent": 25 },',
        '  "preset": "br",',
        '  "suggested_split": "60-40",',
        '  "panelFillColor": "none",',
        '  "reason": "short explanation"',
        '}'
    ].filter(Boolean).join('\n');
}
function buildAiDescriptionPrompt(currentPreset, currentScale, selectedBgColorText, selectedPanelFillText) {
    const bgLine = selectedBgColorText
        ? (isTurkishUi()
            ? `- Kullanici kamera cercevesi/arka plani olarak "${selectedBgColorText}" secti. Cerceve gorunuyorsa estetik ve profesyonel durup durmadigini degerlendir.`
            : `- The user selected "${selectedBgColorText}" for the camera frame/background. If the frame is visible, evaluate whether it looks aesthetic and professional.`)
        : '';
    const panelFillLine = selectedPanelFillText
        ? (isTurkishUi()
            ? `- Kullanici yan yana bosluk dolgusu olarak "${selectedPanelFillText}" secti. Kenarlarda siyah bosluk kalip kalmadigini ve bu dolgunun yeterli olup olmadigini degerlendir.`
            : `- The user selected "${selectedPanelFillText}" as the side-by-side gap fill. Evaluate whether any black gaps remain at the edges and whether this fill is sufficient.`)
        : (isTurkishUi()
            ? '- Ozellikle yan yana duzenlerde kenarlarda siyah bosluk, letterbox veya doldurulmamis alan var mi kontrol et.'
            : '- Especially in side-by-side layouts, check whether there are black gaps, letterboxing, or unfilled areas at the edges.');
    if (isTurkishUi()) {
        return [
            'Kisa ve erisilebilir bir betimleme yap:',
            '- Ekranda ne gorunuyor?',
            '- Yuz gorunuyor mu? Yuz kadraj icinde mi?',
            `- Kullanici "${currentPreset}" duzeninde kamerayi %${currentScale} oraninda ayarladi. Kamera ana icerigi cok mu kapatiyor veya yuz fazla mi kucuk/buyuk kalmis, orantiyi degerlendir.`,
            '- Metinler okunakli mi? (varsa)',
            bgLine,
            panelFillLine,
            '- One cikan problem varsa belirt (siyah ekran, asiri parlaklik, kapali yuz, vs.)',
            'Maksimum 4-5 kisa cumle.'
        ].filter(Boolean).join('\n');
    }
    return [
        'Create a short accessible description:',
        '- What is visible on the screen?',
        '- Is a face visible, and is it framed correctly?',
        `- The user set the camera to ${currentScale}% in the "${currentPreset}" layout. Evaluate whether the camera covers too much content or whether the face is too small or too large.`,
        '- Are the texts readable, if any?',
        bgLine,
        panelFillLine,
        '- Mention any notable issue (black screen, overexposure, covered face, etc.)',
        'Maximum 4-5 short sentences.'
    ].filter(Boolean).join('\n');
}

function buildAiFollowupPrompt(question, currentPreset, currentScale, currentPosition, suggestion) {
    const suggestionSummary = suggestion
        ? JSON.stringify({
            preset: suggestion.preset || currentPreset,
            camera: suggestion.camera || {},
            reason: suggestion.reason || ''
        })
        : '{}';
    const positionLine = currentPosition
        ? (isTurkishUi()
            ? `Mevcut kamera konumu: X ${currentPosition.x}, Y ${currentPosition.y}.`
            : `Current camera position: X ${currentPosition.x}, Y ${currentPosition.y}.`)
        : '';

    if (isTurkishUi()) {
        return [
            'Sen bir video duzenleme yardimcisisin.',
            'Ayni ekran goruntusune tekrar bak ve kullanicinin ek sorusunu yanitla.',
            'Onceki oneriyi sadece gecmis baglam olarak kullan. Eger onceki oneri ile su anki goruntu celisiyorsa, su anki goruntuye ve guncel ayarlara oncelik ver.',
            `Mevcut duzen: ${currentPreset}. Kamera olcegi: %${currentScale}.`,
            positionLine,
            `Onceki oneri ozeti: ${suggestionSummary}`,
            `Kullanicinin ek sorusu: ${question}`,
            'Kisa, net ve uygulanabilir bir yanit ver. Gerekirse belirli bir konum, olcek veya neden oner.'
        ].filter(Boolean).join('\n');
    }

    return [
        'You are a video production assistant.',
        'Look at the current screen preview again and answer the user follow-up question.',
        'Use the previous suggestion only as background context. If it conflicts with the current image, prioritize the current image and the current settings.',
        `Current layout: ${currentPreset}. Camera scale: ${currentScale}%.`,
        positionLine,
        `Previous suggestion summary: ${suggestionSummary}`,
        `User follow-up question: ${question}`,
        'Give a short, clear, actionable answer. If helpful, mention a specific position, scale, or reason.'
    ].filter(Boolean).join('\n');
}

function resetAiFollowupUi() {
    state.aiSuggestionPreviewBase64 = null;
    state.aiSuggestionResponseText = '';
    if (els.aiFollowupQuestion) {
        els.aiFollowupQuestion.value = '';
    }
    if (els.aiFollowupPanel) {
        els.aiFollowupPanel.style.display = 'none';
    }
    if (els.aiFollowupStatus) {
        els.aiFollowupStatus.textContent = t('recording_wizard.ai.followup_waiting', 'A follow-up question can be asked after an AI suggestion is created.');
    }
    if (els.btnAiFollowup) {
        els.btnAiFollowup.disabled = false;
    }
}
const jsStatus = document.getElementById('js-status');
if (jsStatus) jsStatus.textContent = t('recording_wizard.status.script_loaded', 'Wizard script loaded.');
window.__kveWizardLoaded = true;

const state = {
    stepIndex: 0,
    mode: 'record',
    obsFound: false,
    obsConnected: false,
    autoObsReady: false,
    sceneName: 'KVE Kayıt',
    screenSources: [],
    windowSources: [],
    obsMonitors: [],
    captureMode: 'screen',
    screenIndex: 0,
    windowTitle: '',
    selectedWindows: [],
    activeWindowIndex: 0,
    activeWindowInputName: null,
    windowItems: [],
    broadcastPlatform: 'youtube',
    youtubeStreamMethod: 'manual',
    youtubeApiMode: 'instant',
    youtubeConnected: false,
    youtubeClientConfigured: false,
    youtubeAccounts: [],
    youtubeActiveAccountId: '',
    youtubeChannelTitle: '',
    youtubePlaylists: [],
    youtubeSelectedPlaylistId: '',
    youtubeBroadcastDescription: '',
    youtubePrivacyStatus: 'private',
    youtubeScheduledAt: '',
    youtubeSelectedBroadcastId: '',
    youtubeBroadcasts: [],
    youtubePreparedBroadcastId: '',
    youtubePreparedBroadcastTitle: '',
    youtubePreparedWatchUrl: '',
    youtubeModerators: [],
    youtubeChatWatchUrl: '',
    youtubeChatWatchMode: false,
    youtubeLiveChatId: '',
    youtubeChatMessages: [],
    youtubeChatSelectedIndex: -1,
    youtubeChatNextPageToken: '',
    youtubeChatPollingIntervalMs: 5000,
    youtubeChatPollingTimer: null,
    youtubeChatPanelOpen: false,
    youtubeChatAutoRead: false,
    youtubeChatBackgroundNotification: false,
    youtubeChatBackgroundFlash: false,
    youtubeChatBackgroundSound: false,
    youtubeChatVisualVisible: true,
    youtubeChatBans: {},
    youtubeChatBanEntries: [],
    lastYouTubeChatShortcutSlot: null,
    lastYouTubeChatShortcutAt: 0,
    broadcastTitle: '',
    broadcastServer: '',
    broadcastStreamKey: '',
    streamingActive: false,
    cameraEnabled: false,
    cameraDeviceId: null,
    micDeviceId: null,
    systemAudioEnabled: false,
    systemAudioMode: 'system',
    systemAudioWindowTarget: '',
    lastBroadcastError: '',
    hasCameraDevices: false,
    micInputName: null,
    systemInputName: null,
    screenItemId: null,
    cameraItemId: null,
    cameraInputName: null,
    screenInputName: null,
    sceneBackground: {
        type: 'none',
        sourcePath: '',
        preparedPath: '',
        width: 0,
        height: 0,
        duration: 0,
        fitMode: 'cover',
        dimPercent: 0,
        logoPath: '',
        logoPosition: 'top-right',
        logoSize: 'medium'
    },
    videoSettings: { baseWidth: 1920, baseHeight: 1080 },
    aiSuggestion: null,
    aiSuggestionPreviewBase64: null,
    aiSuggestionResponseText: '',
    manualLayoutBasePreset: null,
    recordingFormat: 'mp4', // Default format
    recordingActive: false,
    recordingPaused: false,
    sessionActionInProgress: false,
    lastOutputPath: null,
    recordingFormat: 'mp4',
    videoQualityPreset: 'current',
    audioBalancePreset: 'manual',
    minimizeOnRecordingStart: false,
    launchProfile: 'default',
    interviewQuickStartCompleted: false,
    liveEffectsEnabled: false,
    liveEffectsProfiles: [],
    liveEffectsProfileId: null,
    liveEffectsOverlayOpen: false,
    activeLiveEffectSlotId: null,
    liveEffectsPlayers: {},
    liveEffectsLastFocusEl: null,
    recordingDebugStartedAt: 0,
    latestObsStats: null
};

const recordingCameraTest = {
    active: false,
    detector: null,
    timer: null,
    statusRefreshTimer: null,
    inFlight: false,
    pendingSignature: '',
    pendingCount: 0,
    frameFailureCount: 0,
    lastAnnouncedSignature: '',
    lastAnnouncementAt: 0,
    lastMessage: '',
    lastDetailedMessage: '',
    canvas: null
};

let pendingChatNotificationQueue = [];
let chatNotificationQueueRunning = false;

const els = {
    steps: Array.from(document.querySelectorAll('.step-content')),
    liveRegion: document.getElementById('live-region'),
    chatLiveRegion: document.getElementById('chat-live-region'),
    btnNext: document.getElementById('btn-next'),
    btnBack: document.getElementById('btn-back'),
    btnCancel: document.getElementById('btn-cancel'),

    modeRecord: document.getElementById('mode-record'),
    modeBroadcast: document.getElementById('mode-broadcast'),
    formatRadios: Array.from(document.querySelectorAll('input[name="format"]')),
    videoQualityPreset: document.getElementById('video-quality-preset'),
    liveEffectsEnable: document.getElementById('live-effects-enable'),
    liveEffectsProfile: document.getElementById('live-effects-profile'),
    btnOpenLiveEffectsPanel: document.getElementById('btn-open-live-effects-panel'),
    btnRefreshLiveEffects: document.getElementById('btn-refresh-live-effects'),
    liveEffectsHint: document.getElementById('live-effects-hint'),
    liveEffectsEnableStep6: document.getElementById('live-effects-enable-step6'),
    liveEffectsProfileStep6: document.getElementById('live-effects-profile-step6'),
    btnOpenLiveEffectsPanelStep6: document.getElementById('btn-open-live-effects-panel-step6'),
    btnRefreshLiveEffectsStep6: document.getElementById('btn-refresh-live-effects-step6'),
    liveEffectsHintStep6: document.getElementById('live-effects-hint-step6'),
    interviewQuickstartActions: document.getElementById('interview-quickstart-actions'),
    btnInterviewQuickstart: document.getElementById('btn-interview-quickstart'),
    interviewQuickstartHint: document.getElementById('interview-quickstart-hint'),

    obsDetectStatus: document.getElementById('obs-detect-status'),
    btnOpenObsSite: document.getElementById('btn-open-obs-site'),
    btnRecheckObs: document.getElementById('btn-recheck-obs'),
    obsHost: document.getElementById('obs-host'),
    obsPort: document.getElementById('obs-port'),
    obsPassword: document.getElementById('obs-password'),
    togglePassword: document.getElementById('toggle-password'),
    btnTestConnection: document.getElementById('btn-test-connection'),
    btnToggleHelp: document.getElementById('btn-toggle-help'),
    btnOpenWsDocs: document.getElementById('btn-open-ws-docs'),
    obsConnStatus: document.getElementById('obs-conn-status'),
    obsHelp: document.getElementById('obs-help'),

    captureScreen: document.getElementById('capture-screen'),
    captureWindow: document.getElementById('capture-window'),
    screenSelect: document.getElementById('screen-select'),
    windowSelect: document.getElementById('window-select'),
    btnAddWindow: document.getElementById('btn-add-window'),
    selectedWindowPanel: document.getElementById('selected-window-panel'),
    selectedWindowList: document.getElementById('selected-window-list'),
    btnRemoveWindow: document.getElementById('btn-remove-window'),
    btnSetActiveWindow: document.getElementById('btn-set-active-window'),
    sourceStatus: document.getElementById('source-status'),
    btnRefreshSources: document.getElementById('btn-refresh-sources'),
    cameraEnable: document.getElementById('camera-enable'),
    cameraSelect: document.getElementById('camera-select'),
    cameraStatus: document.getElementById('camera-status'),
    btnCameraPermission: document.getElementById('btn-camera-permission'),
    btnRefreshDevices: document.getElementById('btn-refresh-devices'),
    systemAudioEnable: document.getElementById('system-audio-enable'),
    systemAudioModeRadios: Array.from(document.querySelectorAll('input[name="system-audio-mode"]')),
    systemAudioModeGroup: document.getElementById('system-audio-mode-group'),
    systemAudioWindowTargetGroup: document.getElementById('system-audio-window-target-group'),
    systemAudioWindowTarget: document.getElementById('system-audio-window-target'),
    micSelect: document.getElementById('mic-select'),
    liveMicSelect: document.getElementById('live-mic-select'),
    broadcastErrorPanel: document.getElementById('broadcast-error-panel'),
    broadcastErrorSummary: document.getElementById('broadcast-error-summary'),

    layoutPresetRadios: Array.from(document.querySelectorAll('input[name="layout-preset"]')),
    manualPresetLabel: document.getElementById('manual-preset-label'),
    camX: document.getElementById('cam-x'),
    camY: document.getElementById('cam-y'),
    camScale: document.getElementById('cam-scale'),
    btnTestRecordingCamera: document.getElementById('btn-test-recording-camera'),
    recordingCameraTestDialog: document.getElementById('recording-camera-test-dialog'),
    recordingCameraTestTitle: document.getElementById('recording-camera-test-title'),
    recordingCameraTestPreview: document.getElementById('recording-camera-test-preview'),
    recordingCameraTestStatus: document.getElementById('recording-camera-test-status'),
    btnReadRecordingCameraTestStatus: document.getElementById('btn-read-recording-camera-test-status'),
    btnCloseRecordingCameraTest: document.getElementById('btn-close-recording-camera-test'),
    btnApplyPreset: document.getElementById('btn-apply-preset'),
    camPanelFillColor: document.getElementById('cam-panel-fill-color'),
    btnSelectSceneBackground: document.getElementById('btn-select-scene-background-recording'),
    btnClearSceneBackground: document.getElementById('btn-clear-scene-background-recording'),
    sceneBackgroundFitMode: document.getElementById('scene-background-fit-mode-recording'),
    sceneBackgroundDimPercent: document.getElementById('scene-background-dim-percent-recording'),
    sceneBackgroundDimValue: document.getElementById('scene-background-dim-value-recording'),
    btnSelectSceneLogo: document.getElementById('btn-select-scene-logo-recording'),
    btnClearSceneLogo: document.getElementById('btn-clear-scene-logo-recording'),
    sceneLogoPosition: document.getElementById('scene-logo-position-recording'),
    sceneLogoSize: document.getElementById('scene-logo-size-recording'),
    sceneBackgroundProfileName: document.getElementById('scene-background-profile-name-recording'),
    sceneBackgroundProfileList: document.getElementById('scene-background-profile-list-recording'),
    btnSaveSceneBackgroundProfile: document.getElementById('btn-save-scene-background-profile-recording'),
    btnApplySceneBackgroundProfile: document.getElementById('btn-apply-scene-background-profile-recording'),
    btnDeleteSceneBackgroundProfile: document.getElementById('btn-delete-scene-background-profile-recording'),
    sceneBackgroundStatus: document.getElementById('scene-background-status-recording'),
    btnAiSuggest: document.getElementById('btn-ai-suggest'),
    btnApplyAi: document.getElementById('btn-apply-ai'),
    aiStatus: document.getElementById('ai-status'),
    aiFollowupPanel: document.getElementById('ai-followup-panel'),
    aiFollowupQuestion: document.getElementById('ai-followup-question'),
    btnAiFollowup: document.getElementById('btn-ai-followup'),
    aiFollowupStatus: document.getElementById('ai-followup-status'),
    btnAiDescribe: document.getElementById('btn-ai-describe'),
    aiDescribeStatus: document.getElementById('ai-describe-status'),

    micVolume: document.getElementById('mic-volume'),
    micVolumeValue: document.getElementById('mic-volume-value'),
    audioBalancePreset: document.getElementById('audio-balance-preset'),
    systemVolume: document.getElementById('system-volume'),
    systemVolumeValue: document.getElementById('system-volume-value'),
    monitorEnable: document.getElementById('monitor-enable'),
    interviewQuickstartNote: document.getElementById('interview-quickstart-note'),
    liveSettingsPanel: document.getElementById('live-settings-panel'),

    recordingStatus: document.getElementById('recording-status'),
    recordingShortcutsText: document.getElementById('recording-shortcuts-text'),
    broadcastSettingsPanel: document.getElementById('broadcast-settings-panel'),
    broadcastPlatform: document.getElementById('broadcast-platform'),
    youtubeStreamMethodPanel: document.getElementById('youtube-stream-method-panel'),
    youtubeStreamMethod: document.getElementById('youtube-stream-method'),
    youtubeApiPanel: document.getElementById('youtube-api-panel'),
    youtubeOauthSetup: document.getElementById('youtube-oauth-setup'),
    youtubeClientId: document.getElementById('youtube-client-id'),
    youtubeClientSecret: document.getElementById('youtube-client-secret'),
    youtubeShowClientSecret: document.getElementById('youtube-show-client-secret'),
    btnYoutubeSaveClient: document.getElementById('youtube-save-client'),
    btnYoutubeConnect: document.getElementById('btn-youtube-connect'),
    btnYoutubeDisconnect: document.getElementById('btn-youtube-disconnect'),
    youtubeAuthStatus: document.getElementById('youtube-auth-status'),
    youtubeAccountSelect: document.getElementById('youtube-account-select'),
    youtubeChatWatchFields: document.getElementById('youtube-chat-watch-fields'),
    youtubeChatWatchUrl: document.getElementById('youtube-chat-watch-url'),
    btnYoutubeChatWatchConnect: document.getElementById('btn-youtube-chat-watch-connect'),
    btnYoutubeChatWatchClear: document.getElementById('btn-youtube-chat-watch-clear'),
    youtubeApiModeRadios: Array.from(document.querySelectorAll('input[name="youtube-api-mode"]')),
    youtubeCreateFields: document.getElementById('youtube-create-fields'),
    youtubeLiveTitle: document.getElementById('youtube-live-title'),
    youtubeLiveDescription: document.getElementById('youtube-live-description'),
    youtubeLiveVisibility: document.getElementById('youtube-live-visibility'),
    youtubePlaylistSelect: document.getElementById('youtube-playlist-select'),
    btnYoutubeRefreshPlaylists: document.getElementById('btn-youtube-refresh-playlists'),
    youtubePlannedFields: document.getElementById('youtube-planned-fields'),
    youtubeLiveScheduledAt: document.getElementById('youtube-live-scheduled-at'),
    youtubeExistingFields: document.getElementById('youtube-existing-fields'),
    youtubeExistingBroadcasts: document.getElementById('youtube-existing-broadcasts'),
    btnYoutubeRefreshBroadcasts: document.getElementById('btn-youtube-refresh-broadcasts'),
    youtubeBroadcastStatus: document.getElementById('youtube-broadcast-status'),
    youtubeWatchLinkPanel: document.getElementById('youtube-watch-link-panel'),
    youtubeWatchLink: document.getElementById('youtube-watch-link'),
    btnYoutubeOpenWatchLink: document.getElementById('btn-youtube-open-watch-link'),
    btnYoutubeCopyWatchLink: document.getElementById('btn-youtube-copy-watch-link'),
    broadcastManualFields: document.getElementById('broadcast-manual-fields'),
    broadcastTitle: document.getElementById('broadcast-title'),
    broadcastServer: document.getElementById('broadcast-server'),
    broadcastStreamKey: document.getElementById('broadcast-stream-key'),
    broadcastShowKey: document.getElementById('broadcast-show-key'),
    btnStartRecord: document.getElementById('btn-toggle-record'), // Updated to toggle button
    btnPauseRecord: document.getElementById('btn-pause-record'),
    btnStopRecord: null, // Removed in HTML
    recordingOutput: document.getElementById('recording-output'),
    obsStatsSummary: document.getElementById('obs-stats-summary'),
    globalShortcutsInfo: document.getElementById('global-shortcuts-info'),
    minimizeOnRecordingStart: document.getElementById('minimize-on-recording-start'),
    btnOpenFolder: document.getElementById('btn-open-folder'),
    btnCopyPath: document.getElementById('btn-copy-path'),
    btnFinishAdd: document.getElementById('btn-finish-add'),
    btnSwitchToRecording: document.getElementById('btn-switch-to-recording'),
    youtubeWatchLinkSummaryPanel: document.getElementById('youtube-watch-link-summary-panel'),
    youtubeWatchLinkSummary: document.getElementById('youtube-watch-link-summary'),
    youtubeModeratorPanel: document.getElementById('youtube-moderator-panel'),
    youtubeModeratorInput: document.getElementById('youtube-moderator-input'),
    btnYoutubeAddModerator: document.getElementById('btn-youtube-add-moderator'),
    btnYoutubeRefreshModerators: document.getElementById('btn-youtube-refresh-moderators'),
    youtubeModeratorList: document.getElementById('youtube-moderator-list'),
    btnYoutubeRemoveModerator: document.getElementById('btn-youtube-remove-moderator'),
    youtubeModeratorSummary: document.getElementById('youtube-moderator-summary'),
    youtubeChatPanel: document.getElementById('youtube-chat-panel'),
    youtubeChatStatus: document.getElementById('youtube-chat-status'),
    btnToggleChatPanel: document.getElementById('btn-toggle-chat-panel'),
    youtubeChatVisibleToggle: document.getElementById('youtube-chat-visible-toggle'),
    youtubeChatAutoReadToggle: document.getElementById('youtube-chat-auto-read-toggle'),
    youtubeChatBackgroundNotificationToggle: document.getElementById('youtube-chat-background-notification-toggle'),
    youtubeChatBackgroundFlashToggle: document.getElementById('youtube-chat-background-flash-toggle'),
    youtubeChatBackgroundSoundToggle: document.getElementById('youtube-chat-background-sound-toggle'),
    youtubeChatVisualPanel: document.getElementById('youtube-chat-visual-panel'),
    youtubeChatList: document.getElementById('youtube-chat-list'),
    youtubeChatComposer: document.getElementById('youtube-chat-composer'),
    btnYoutubeChatSend: document.getElementById('btn-youtube-chat-send'),
    btnCloseYouTubeChatPanel: document.getElementById('btn-close-youtube-chat-panel'),
    youtubeChatMenuDialog: document.getElementById('youtube-chat-menu-dialog'),
    youtubeChatMenuSummary: document.getElementById('youtube-chat-menu-summary'),
    youtubeChatMenuPermissionHint: document.getElementById('youtube-chat-menu-permission-hint'),
    btnChatCopyMessage: document.getElementById('btn-chat-copy-message'),
    btnChatCopyAuthor: document.getElementById('btn-chat-copy-author'),
    btnChatCopyChannel: document.getElementById('btn-chat-copy-channel'),
    btnChatMentionAuthor: document.getElementById('btn-chat-mention-author'),
    btnChatDeleteMessage: document.getElementById('btn-chat-delete-message'),
    btnChatTimeout5m: document.getElementById('btn-chat-timeout-5m'),
    btnChatTimeout10m: document.getElementById('btn-chat-timeout-10m'),
    btnChatBanUser: document.getElementById('btn-chat-ban-user'),
    btnChatUnbanUser: document.getElementById('btn-chat-unban-user'),
    btnChatCloseMenu: document.getElementById('btn-chat-close-menu'),
    youtubeChatBanList: document.getElementById('youtube-chat-ban-list'),
    btnChatUnbanSelected: document.getElementById('btn-chat-unban-selected'),
    liveEffectsSessionSummary: document.getElementById('live-effects-session-summary'),
    btnToggleLiveEffectsOverlay: document.getElementById('btn-toggle-live-effects-overlay'),
    liveEffectsOverlay: document.getElementById('live-effects-overlay'),
    liveEffectsOverlayPanel: document.getElementById('live-effects-overlay-panel'),
    btnCloseLiveEffectsOverlay: document.getElementById('btn-close-live-effects-overlay'),
    liveEffectsActiveStatus: document.getElementById('live-effects-active-status'),
    liveEffectsVideoPreviewPanel: document.getElementById('live-effects-video-preview-panel'),
    liveEffectsVideoPreview: document.getElementById('live-effects-video-preview'),
    liveEffectsMediaHost: document.getElementById('live-effects-media-host'),
    liveEffectsSlotGrid: document.getElementById('live-effects-slot-grid'),
    liveWindowSelect: document.getElementById('live-window-select'),
    btnApplyLiveWindow: document.getElementById('btn-apply-live-window'),
    liveAudioBalancePreset: document.getElementById('live-audio-balance-preset'),
    windowSwitcherDialog: document.getElementById('window-switcher-dialog'),
    windowSwitcherList: document.getElementById('window-switcher-list'),
    windowSwitcherActivate: document.getElementById('window-switcher-activate'),
    windowSwitcherCancel: document.getElementById('window-switcher-cancel'),
    broadcastWarning: document.getElementById('broadcast-warning')
    , obsOpenDialog: document.getElementById('obs-open-dialog')
    , obsOpenYes: document.getElementById('obs-open-yes')
    , obsOpenNo: document.getElementById('obs-open-no')
};

function updateAudioVolumeLabels() {
    if (els.micVolumeValue && els.micVolume) {
        els.micVolumeValue.textContent = `%${els.micVolume.value}`;
    }
    if (els.systemVolumeValue && els.systemVolume) {
        els.systemVolumeValue.textContent = `%${els.systemVolume.value}`;
    }
}

function syncLiveAudioControlsFromMain() {
    const liveMicVolume = document.getElementById('live-mic-volume');
    const liveSystemVolume = document.getElementById('live-system-volume');
    if (liveMicVolume && els.micVolume) {
        liveMicVolume.value = els.micVolume.value;
    }
    if (liveSystemVolume && els.systemVolume) {
        liveSystemVolume.value = els.systemVolume.value;
    }
    if (els.liveAudioBalancePreset) {
        els.liveAudioBalancePreset.value = state.audioBalancePreset || 'manual';
    }
}

function applyAudioBalancePresetSelection(presetId, { announceChange = false } = {}) {
    const normalizedPreset = AUDIO_BALANCE_PRESETS[presetId] ? presetId : 'manual';
    state.audioBalancePreset = normalizedPreset;
    if (els.audioBalancePreset && els.audioBalancePreset.value !== normalizedPreset) {
        els.audioBalancePreset.value = normalizedPreset;
    }

    const presetValues = AUDIO_BALANCE_PRESETS[normalizedPreset];
    if (presetValues) {
        if (els.micVolume) {
            els.micVolume.value = String(presetValues.micVolume);
        }
        if (els.systemVolume) {
            els.systemVolume.value = String(presetValues.systemVolume);
        }
        updateAudioVolumeLabels();
        syncLiveAudioControlsFromMain();
        if (state.micInputName) {
            ipcRenderer.invoke('obs-set-input-volume', {
                inputName: state.micInputName,
                volumePercent: parseInt(els.micVolume.value, 10)
            }).catch(() => {});
        }
        if (state.systemInputName) {
            ipcRenderer.invoke('obs-set-input-volume', {
                inputName: state.systemInputName,
                volumePercent: parseInt(els.systemVolume.value, 10)
            }).catch(() => {});
        }
    }

    if (!announceChange) {
        return;
    }

    const messageKey = normalizedPreset === 'balanced'
        ? 'recording_wizard.step5.audio_balance_balanced_selected'
        : normalizedPreset === 'remote_focus'
            ? 'recording_wizard.step5.audio_balance_remote_focus_selected'
            : 'recording_wizard.step5.audio_balance_manual_selected';
    const fallback = normalizedPreset === 'balanced'
        ? 'Dengeli görüşme ön ayarı seçildi. Host mikrofonu biraz geriye, sistem veya konuk sesi biraz öne alınacak.'
        : normalizedPreset === 'remote_focus'
            ? 'Konuk sesi önde ön ayarı seçildi. Uzak konuşmacı sesi daha belirgin olacak şekilde denge kurulacak.'
            : 'Ses dengeleme ön ayarı kapatıldı. Mevcut elle ayarlar korunuyor.';
    announce(t(messageKey, fallback));
}

function announce(message) {
    if (!els.liveRegion) return;
    els.liveRegion.textContent = '';
    setTimeout(() => {
        els.liveRegion.textContent = message;
    }, 50);
}

function announceDialogForAccessibility(payload = {}) {
    const message = [payload.title, payload.message, payload.detail]
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join('. ');
    if (!message) return;
    announce(message);
}

window.addEventListener('evd-accessibility-dialog-announce', (event) => {
    announceDialogForAccessibility(event.detail);
});

function announceChatMessage(message) {
    if (!message || !els.chatLiveRegion) return;
    const region = els.chatLiveRegion;
    region.replaceChildren();
    setTimeout(() => {
        const item = document.createElement('div');
        item.textContent = message;
        region.replaceChildren(item);
    }, 80);
    setTimeout(() => {
        if (region.firstChild && region.firstChild.textContent === message) {
            region.replaceChildren();
        }
    }, 2500);
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getChatMessageSortValue(message) {
    const raw = String(message?.publishedAt || '').trim();
    if (!raw) return 0;

    if (/^\d+$/.test(raw)) {
        const numeric = Number(raw);
        if (Number.isFinite(numeric)) {
            return raw.length > 13 ? Math.floor(numeric / 1000) : numeric;
        }
    }

    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
}

async function showChatBackgroundNotification(message, author) {
    try {
        const fullMessage = String(message || '').trim();
        const normalizedAuthor = String(author || '').trim() || '-';
        const maxTitleLength = 96;
        const shouldSplitMessage = fullMessage.length > maxTitleLength;
        const title = shouldSplitMessage
            ? `${fullMessage.slice(0, maxTitleLength - 1).trimEnd()}…`
            : (fullMessage || 'YouTube');
        const remainingMessage = shouldSplitMessage
            ? fullMessage.slice(maxTitleLength - 1).trim()
            : '';
        const body = remainingMessage
            ? `${remainingMessage}\n${normalizedAuthor}`
            : normalizedAuthor;

        const response = await ipcRenderer.invoke('show-native-notification', {
            title,
            body,
            silent: true
        });
        console.log('Chat background notification response:', response);
        return !!(response && response.success);
    } catch (error) {
        console.warn('Background notification failed:', error);
        return false;
    }
}

async function flushChatNotificationQueue() {
    if (chatNotificationQueueRunning) {
        return;
    }

    chatNotificationQueueRunning = true;
    try {
        while (pendingChatNotificationQueue.length > 0) {
            const item = pendingChatNotificationQueue[pendingChatNotificationQueue.length - 1];
            pendingChatNotificationQueue = [];
            if (!item) {
                continue;
            }

            await showChatBackgroundNotification(
                normalizeChatMessageText(item),
                item?.authorDisplayName || '-'
            );
        }
    } finally {
        chatNotificationQueueRunning = false;
    }
}

function notifyBackgroundChatMessages(messages = []) {
    const queue = Array.isArray(messages)
        ? messages
            .filter((item) => normalizeChatMessageText(item))
            .sort((a, b) => getChatMessageSortValue(a) - getChatMessageSortValue(b))
        : [];

    if (queue.length === 0) {
        return;
    }

    pendingChatNotificationQueue = [queue[queue.length - 1]];

    flushChatNotificationQueue().catch((error) => {
        console.warn('Background chat notification queue failed:', error);
    });
}

async function isWizardWindowFocused() {
    try {
        const response = await ipcRenderer.invoke('window-is-focused');
        return !!(response && response.success && response.focused);
    } catch (error) {
        console.warn('window focus detection failed:', error);
        return document.hasFocus();
    }
}

function updateBroadcastErrorSummary() {
    if (!els.broadcastErrorPanel || !els.broadcastErrorSummary) {
        return;
    }

    const shouldShow = state.mode === 'broadcast' && !!String(state.lastBroadcastError || '').trim();
    els.broadcastErrorPanel.style.display = shouldShow ? 'block' : 'none';
    setFieldText(els.broadcastErrorSummary, shouldShow ? state.lastBroadcastError : '');
}

function getPreferredDeviceId(devices = [], currentId = null) {
    if (!Array.isArray(devices) || devices.length === 0) {
        return 'default';
    }

    if (currentId && devices.some((device) => device.deviceId === currentId)) {
        return currentId;
    }

    const realDevices = devices.filter((device) => device.deviceId && !['default', 'communications'].includes(device.deviceId));
    if (realDevices.length === 0) {
        return devices[0].deviceId || 'default';
    }

    const scoreDevice = (device) => {
        const text = `${device.label || ''} ${device.deviceId || ''}`.toLowerCase();
        let score = 0;

        if (/\bmicrophone\b|\bmic\b|mikrofon/.test(text)) score += 6;
        if (/headset|kulaklik|kulaklık|headphone/.test(text)) score += 4;

        // Avoid internal capture / loopback style devices unless nothing better exists.
        if (/stereo mix|stereo karisim|stereo karışım|what u hear|wave out mix|mixage stereo|mezcla estereo/.test(text)) score -= 8;
        if (/virtual|vb-audio|cable|loopback|monitor/.test(text)) score -= 4;

        return score;
    };

    const preferred = [...realDevices].sort((a, b) => scoreDevice(b) - scoreDevice(a))[0];
    return preferred?.deviceId || realDevices[0].deviceId || devices[0].deviceId || 'default';
}

function syncLiveMicSelectOptions() {
    if (!els.liveMicSelect || !els.micSelect) {
        return;
    }

    const previousValue = state.micDeviceId || els.micSelect.value || '';
    els.liveMicSelect.innerHTML = '';
    Array.from(els.micSelect.options).forEach((option) => {
        const cloned = option.cloneNode(true);
        els.liveMicSelect.appendChild(cloned);
    });

    if (els.liveMicSelect.options.length > 0) {
        const hasMatch = Array.from(els.liveMicSelect.options).some((option) => option.value === previousValue);
        els.liveMicSelect.value = hasMatch ? previousValue : els.liveMicSelect.options[0].value;
    }

    els.liveMicSelect.disabled = els.liveMicSelect.options.length === 0;
}

function describeRecordingSceneBackgroundFile(info = {}) {
    const sizeText = info.width && info.height ? `${info.width}x${info.height}` : '-';
    if (info.type === 'video' && info.duration) {
        return t('recording_wizard.step4.scene_background_video_info', 'Video arka plan: {size}, süre {duration} sn.', {
            size: sizeText,
            duration: Math.round(info.duration)
        });
    }
    return t('recording_wizard.step4.scene_background_image_info', 'Görsel arka plan: {size}.', { size: sizeText });
}

function renderRecordingSceneBackgroundStatus() {
    const background = state.sceneBackground || {};
    if (els.sceneBackgroundFitMode) els.sceneBackgroundFitMode.value = background.fitMode || 'cover';
    if (els.sceneBackgroundDimPercent) els.sceneBackgroundDimPercent.value = String(background.dimPercent || 0);
    if (els.sceneBackgroundDimValue) els.sceneBackgroundDimValue.textContent = `%${background.dimPercent || 0}`;
    if (els.sceneLogoPosition) els.sceneLogoPosition.value = background.logoPosition || 'top-right';
    if (els.sceneLogoSize) els.sceneLogoSize.value = background.logoSize || 'medium';
    if (!els.sceneBackgroundStatus) return;
    if (!background.sourcePath) {
        els.sceneBackgroundStatus.textContent = background.logoPath
            ? t('recording_wizard.step4.scene_logo_selected_without_background', 'Arka plan seçilmedi. Seçili logo: {name}.', { name: path.basename(background.logoPath) })
            : t('recording_wizard.step4.scene_background_empty', 'Arka plan seçilmedi.');
        return;
    }
    els.sceneBackgroundStatus.textContent = t('recording_wizard.step4.scene_background_selected', 'Seçili arka plan: {name}. {info}', {
        name: path.basename(background.sourcePath),
        info: `${describeRecordingSceneBackgroundFile(background)} ${background.logoPath ? t('recording_wizard.step4.scene_logo_selected_suffix', 'Logo: {name}.', { name: path.basename(background.logoPath) }) : ''}`
    });
}

function createRecordingSceneBackgroundProfileSnapshot() {
    const background = state.sceneBackground || {};
    return {
        type: background.type || 'none',
        sourcePath: background.sourcePath || '',
        preparedPath: background.preparedPath || '',
        width: Number(background.width || 0),
        height: Number(background.height || 0),
        duration: Number(background.duration || 0),
        fitMode: background.fitMode || 'cover',
        dimPercent: Math.max(0, Math.min(80, Math.round(Number(background.dimPercent || 0)))),
        logoPath: background.logoPath || '',
        logoPosition: background.logoPosition || 'top-right',
        logoSize: background.logoSize || 'medium'
    };
}

function createDefaultRecordingSceneBackgroundProfileBackground() {
    return {
        type: 'none',
        sourcePath: '',
        preparedPath: '',
        width: 0,
        height: 0,
        duration: 0,
        fitMode: 'cover',
        dimPercent: 0,
        logoPath: '',
        logoPosition: 'top-right',
        logoSize: 'medium'
    };
}

function loadRecordingSceneBackgroundProfiles() {
    try {
        const raw = window.localStorage.getItem(SCENE_BACKGROUND_PROFILE_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((profile) => profile && typeof profile === 'object')
            .map((profile, index) => ({
                id: String(profile.id || `scene-background-profile-${index + 1}`),
                name: String(profile.name || '').trim() || t('recording_wizard.step4.scene_background_profile_default_name', 'Arka plan profili'),
                background: {
                    ...createDefaultRecordingSceneBackgroundProfileBackground(),
                    ...(profile.background || {})
                }
            }));
    } catch (_error) {
        return [];
    }
}

function saveRecordingSceneBackgroundProfiles(profiles) {
    window.localStorage.setItem(SCENE_BACKGROUND_PROFILE_STORAGE_KEY, JSON.stringify(Array.isArray(profiles) ? profiles : []));
}

function renderRecordingSceneBackgroundProfiles(selectedId = '') {
    if (!els.sceneBackgroundProfileList) return;
    const profiles = loadRecordingSceneBackgroundProfiles();
    els.sceneBackgroundProfileList.innerHTML = '';
    if (!profiles.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = t('recording_wizard.step4.scene_background_profile_empty', 'Kayıtlı profil yok');
        els.sceneBackgroundProfileList.appendChild(option);
        els.sceneBackgroundProfileList.disabled = true;
        if (els.btnApplySceneBackgroundProfile) els.btnApplySceneBackgroundProfile.disabled = true;
        if (els.btnDeleteSceneBackgroundProfile) els.btnDeleteSceneBackgroundProfile.disabled = true;
        return;
    }
    els.sceneBackgroundProfileList.disabled = false;
    profiles.forEach((profile) => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name;
        option.selected = profile.id === selectedId;
        els.sceneBackgroundProfileList.appendChild(option);
    });
    if (els.btnApplySceneBackgroundProfile) els.btnApplySceneBackgroundProfile.disabled = false;
    if (els.btnDeleteSceneBackgroundProfile) els.btnDeleteSceneBackgroundProfile.disabled = false;
}

async function prepareRecordingSceneBackgroundPathIfNeeded(filePath, info) {
    if (!info?.needsNormalize) {
        return filePath;
    }

    const warning = info.type === 'video' && info.longVideoWarning
        ? t('recording_wizard.step4.scene_background_long_video_warning', 'Video 30 saniyeden uzun. Arka plan videosu döngülü oynatılacağı için kısa bir video daha iyi performans verir.')
        : '';
    const message = [
        t('recording_wizard.step4.scene_background_size_warning', 'Seçilen dosya 1920x1080 önerisine uymuyor. Geçerli boyut: {width}x{height}.', {
            width: info.width || 0,
            height: info.height || 0
        }),
        warning,
        t('recording_wizard.step4.scene_background_convert_question', 'EVD dosyayı 1920x1080 arka plan kopyasına dönüştürsün mü?')
    ].filter(Boolean).join('\n\n');

    const response = await ipcRenderer.invoke('show-message-box', {
        type: 'question',
        title: t('recording_wizard.step4.scene_background_convert_title', 'Arka plan boyutu uyumsuz'),
        message,
        buttons: [
            t('recording_wizard.step4.scene_background_convert_button', 'Dönüştür'),
            t('recording_wizard.step4.scene_background_use_original_button', 'Özgün dosyayı kullan'),
            t('recording_wizard.step4.scene_background_cancel_button', 'İptal')
        ],
        defaultId: 0,
        cancelId: 2,
        noLink: true
    });

    if (response.response === 2) return '';
    if (response.response === 1) return filePath;

    if (els.sceneBackgroundStatus) {
        els.sceneBackgroundStatus.textContent = t('recording_wizard.step4.scene_background_converting', 'Arka plan 1920x1080 olarak hazırlanıyor...');
    }
    const prepared = await ipcRenderer.invoke('prepare-scene-background-file', {
        filePath,
        type: info.type
    });
    if (!prepared?.success || !prepared.path) {
        throw new Error(prepared?.error || 'background_prepare_failed');
    }
    return prepared.path;
}

async function applyRecordingSceneBackgroundToObs() {
    const background = state.sceneBackground || {};
    const sourcePath = background.preparedPath || background.sourcePath || '';
    const response = await ipcRenderer.invoke('obs-set-scene-background', {
        sceneName: state.sceneName,
        type: background.type || 'none',
        sourcePath,
        fitMode: background.fitMode || 'cover',
        dimPercent: background.dimPercent || 0,
        logoPath: background.logoPath || '',
        logoPosition: background.logoPosition || 'top-right',
        logoSize: background.logoSize || 'medium'
    });
    if (!response?.success) {
        throw new Error(response?.error || 'background_apply_failed');
    }
    return response;
}

async function selectRecordingSceneBackgroundFile() {
    const result = await ipcRenderer.invoke('open-file-dialog', {
        title: t('recording_wizard.step4.scene_background_file_dialog_title', 'Arka plan dosyası seç'),
        properties: ['openFile'],
        filters: [
            { name: t('recording_wizard.step4.scene_background_files_filter', 'Arka plan dosyaları'), extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'mp4', 'webm', 'mov', 'm4v', 'mkv'] }
        ]
    });
    if (result.canceled || !result.filePaths?.[0]) return;

    const filePath = result.filePaths[0];
    const info = await ipcRenderer.invoke('inspect-scene-background-file', filePath);
    if (!info?.success) {
        throw new Error(info?.error || 'background_inspect_failed');
    }
    const preparedPath = await prepareRecordingSceneBackgroundPathIfNeeded(filePath, info);
    if (!preparedPath) {
        if (els.sceneBackgroundStatus) {
            els.sceneBackgroundStatus.textContent = t('recording_wizard.step4.scene_background_cancelled', 'Arka plan seçimi iptal edildi.');
        }
        return;
    }

    state.sceneBackground = {
        ...state.sceneBackground,
        type: info.type,
        sourcePath: filePath,
        preparedPath,
        width: info.width || 0,
        height: info.height || 0,
        duration: info.duration || 0
    };
    renderRecordingSceneBackgroundStatus();

    try {
        await applyRecordingSceneBackgroundToObs();
        showShortcutTooltip(t('recording_wizard.step4.scene_background_applied', 'Sahne arka planı uygulandı.'));
    } catch (_error) {
        showShortcutTooltip(t('recording_wizard.step4.scene_background_saved_pending_obs', 'Arka plan seçildi. OBS bağlantısı hazır olduğunda sahneye uygulanacak.'));
    }
}

async function clearRecordingSceneBackground() {
    state.sceneBackground = {
        ...state.sceneBackground,
        type: 'none',
        sourcePath: '',
        preparedPath: '',
        width: 0,
        height: 0,
        duration: 0
    };
    renderRecordingSceneBackgroundStatus();
    await applyRecordingSceneBackgroundToObs().catch(() => {});
    showShortcutTooltip(t('recording_wizard.step4.scene_background_cleared', 'Sahne arka planı kaldırıldı.'));
}

async function selectRecordingSceneLogoFile() {
    const result = await ipcRenderer.invoke('open-file-dialog', {
        title: t('recording_wizard.step4.scene_logo_file_dialog_title', 'Logo dosyası seç'),
        properties: ['openFile'],
        filters: [
            { name: t('recording_wizard.step4.scene_logo_files_filter', 'Logo dosyaları'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }
        ]
    });
    if (result.canceled || !result.filePaths?.[0]) return;
    state.sceneBackground.logoPath = result.filePaths[0];
    renderRecordingSceneBackgroundStatus();
    await applyRecordingSceneBackgroundToObs().catch(() => {});
    showShortcutTooltip(t('recording_wizard.step4.scene_logo_selected', 'Logo seçildi: {name}', { name: path.basename(state.sceneBackground.logoPath) }));
}

async function clearRecordingSceneLogo() {
    state.sceneBackground.logoPath = '';
    renderRecordingSceneBackgroundStatus();
    await applyRecordingSceneBackgroundToObs().catch(() => {});
    showShortcutTooltip(t('recording_wizard.step4.scene_logo_cleared', 'Logo kaldırıldı.'));
}

async function updateRecordingSceneBackgroundPersonalization() {
    state.sceneBackground.fitMode = String(els.sceneBackgroundFitMode?.value || 'cover');
    state.sceneBackground.dimPercent = Math.max(0, Math.min(80, Math.round(Number(els.sceneBackgroundDimPercent?.value || 0))));
    state.sceneBackground.logoPosition = String(els.sceneLogoPosition?.value || 'top-right');
    state.sceneBackground.logoSize = String(els.sceneLogoSize?.value || 'medium');
    renderRecordingSceneBackgroundStatus();
    await applyRecordingSceneBackgroundToObs().catch(() => {});
}

async function saveCurrentRecordingSceneBackgroundProfile() {
    const profileName = String(els.sceneBackgroundProfileName?.value || '').trim()
        || t('recording_wizard.step4.scene_background_profile_default_name', 'Arka plan profili');
    const profiles = loadRecordingSceneBackgroundProfiles();
    const selectedId = els.sceneBackgroundProfileList?.value || '';
    const existingIndex = profiles.findIndex((profile) => profile.id === selectedId);
    const nextProfile = {
        id: existingIndex >= 0 ? profiles[existingIndex].id : `scene-background-profile-${Date.now()}`,
        name: profileName,
        background: createRecordingSceneBackgroundProfileSnapshot()
    };
    if (existingIndex >= 0) {
        profiles[existingIndex] = nextProfile;
    } else {
        profiles.push(nextProfile);
    }
    saveRecordingSceneBackgroundProfiles(profiles);
    renderRecordingSceneBackgroundProfiles(nextProfile.id);
    if (els.sceneBackgroundProfileName) els.sceneBackgroundProfileName.value = nextProfile.name;
    showShortcutTooltip(t('recording_wizard.step4.scene_background_profile_saved', 'Arka plan profili kaydedildi: {name}', { name: nextProfile.name }));
}

async function applySelectedRecordingSceneBackgroundProfile() {
    const selectedId = els.sceneBackgroundProfileList?.value || '';
    const profile = loadRecordingSceneBackgroundProfiles().find((item) => item.id === selectedId);
    if (!profile) {
        showShortcutTooltip(t('recording_wizard.step4.scene_background_profile_select_required', 'Önce bir arka plan profili seçin.'));
        return;
    }
    state.sceneBackground = {
        ...state.sceneBackground,
        ...profile.background
    };
    if (els.sceneBackgroundProfileName) els.sceneBackgroundProfileName.value = profile.name;
    renderRecordingSceneBackgroundStatus();
    await applyRecordingSceneBackgroundToObs().catch(() => {});
    showShortcutTooltip(t('recording_wizard.step4.scene_background_profile_applied', 'Arka plan profili uygulandı: {name}', { name: profile.name }));
}

async function deleteSelectedRecordingSceneBackgroundProfile() {
    const selectedId = els.sceneBackgroundProfileList?.value || '';
    const profiles = loadRecordingSceneBackgroundProfiles();
    const profile = profiles.find((item) => item.id === selectedId);
    if (!profile) {
        showShortcutTooltip(t('recording_wizard.step4.scene_background_profile_select_required', 'Önce bir arka plan profili seçin.'));
        return;
    }
    saveRecordingSceneBackgroundProfiles(profiles.filter((item) => item.id !== selectedId));
    renderRecordingSceneBackgroundProfiles();
    if (els.sceneBackgroundProfileName) els.sceneBackgroundProfileName.value = '';
    showShortcutTooltip(t('recording_wizard.step4.scene_background_profile_deleted', 'Arka plan profili silindi: {name}', { name: profile.name }));
}

async function syncRecordingWizardSession(forceClear = false) {
    try {
        if (forceClear || !(state.mode === 'broadcast' && state.recordingActive && state.streamingActive)) {
            await ipcRenderer.invoke('recording-wizard-set-active-session', null);
            return;
        }

        await ipcRenderer.invoke('recording-wizard-set-active-session', {
            active: true,
            launchProfile: state.launchProfile,
            mode: state.mode,
            stepIndex: 5,
            sceneName: state.sceneName,
            captureMode: state.captureMode,
            screenIndex: state.screenIndex,
            windowTitle: state.windowTitle,
            selectedWindows: state.selectedWindows,
            activeWindowIndex: state.activeWindowIndex,
            activeWindowInputName: state.activeWindowInputName,
            windowItems: state.windowItems,
            youtubePreparedBroadcastId: state.youtubePreparedBroadcastId,
            youtubePreparedBroadcastTitle: state.youtubePreparedBroadcastTitle,
            youtubePreparedWatchUrl: state.youtubePreparedWatchUrl,
            youtubeModerators: state.youtubeModerators,
            youtubeLiveChatId: state.youtubeLiveChatId,
            youtubeChatMessages: state.youtubeChatMessages.slice(-50),
            youtubeChatSelectedIndex: state.youtubeChatSelectedIndex,
            youtubeChatPanelOpen: state.youtubeChatPanelOpen,
            youtubeChatAutoRead: state.youtubeChatAutoRead,
            youtubeChatBackgroundNotification: state.youtubeChatBackgroundNotification,
            youtubeChatBackgroundFlash: state.youtubeChatBackgroundFlash,
            youtubeChatBackgroundSound: state.youtubeChatBackgroundSound,
            youtubeChatVisualVisible: state.youtubeChatVisualVisible,
            youtubeChatBanEntries: state.youtubeChatBanEntries,
            broadcastPlatform: state.broadcastPlatform,
            youtubeStreamMethod: state.youtubeStreamMethod,
            youtubeApiMode: state.youtubeApiMode,
            youtubeConnected: state.youtubeConnected,
            youtubeActiveAccountId: state.youtubeActiveAccountId,
            youtubeChannelTitle: state.youtubeChannelTitle,
            youtubeSelectedPlaylistId: state.youtubeSelectedPlaylistId,
            youtubeSelectedBroadcastId: state.youtubeSelectedBroadcastId,
            broadcastTitle: state.broadcastTitle,
            broadcastServer: state.broadcastServer,
            broadcastStreamKey: state.broadcastStreamKey,
            cameraEnabled: state.cameraEnabled,
            cameraDeviceId: state.cameraDeviceId,
            micDeviceId: state.micDeviceId,
            systemAudioEnabled: state.systemAudioEnabled,
            systemAudioMode: state.systemAudioMode,
            systemAudioWindowTarget: state.systemAudioWindowTarget,
            micInputName: state.micInputName,
            systemInputName: state.systemInputName,
            screenItemId: state.screenItemId,
            cameraItemId: state.cameraItemId,
            cameraInputName: state.cameraInputName,
            screenInputName: state.screenInputName,
            videoSettings: state.videoSettings,
            recordingActive: state.recordingActive,
            streamingActive: state.streamingActive
        });
    } catch (error) {
        console.warn('recording session sync failed:', error.message);
    }
}

function restoreRecordingWizardSession(session) {
    if (!session || !session.active) {
        return false;
    }

    pendingLaunchOptions = {
        ...(pendingLaunchOptions || {}),
        launchProfile: session.launchProfile || pendingLaunchOptions.launchProfile || 'broadcast'
    };

    Object.assign(state, {
        mode: session.mode || 'broadcast',
        launchProfile: session.launchProfile || state.launchProfile,
        sceneName: session.sceneName || state.sceneName,
        captureMode: session.captureMode || state.captureMode,
        screenIndex: Number.isFinite(session.screenIndex) ? session.screenIndex : state.screenIndex,
        windowTitle: session.windowTitle || state.windowTitle,
        selectedWindows: Array.isArray(session.selectedWindows) ? session.selectedWindows : [],
        activeWindowIndex: Number.isFinite(session.activeWindowIndex) ? session.activeWindowIndex : 0,
        activeWindowInputName: session.activeWindowInputName || null,
        windowItems: Array.isArray(session.windowItems) ? session.windowItems : [],
        youtubePreparedBroadcastId: session.youtubePreparedBroadcastId || '',
        youtubePreparedBroadcastTitle: session.youtubePreparedBroadcastTitle || '',
        youtubePreparedWatchUrl: session.youtubePreparedWatchUrl || '',
        youtubeModerators: Array.isArray(session.youtubeModerators) ? session.youtubeModerators : [],
        youtubeLiveChatId: session.youtubeLiveChatId || '',
        youtubeChatMessages: Array.isArray(session.youtubeChatMessages) ? session.youtubeChatMessages : [],
        youtubeChatSelectedIndex: Number.isFinite(session.youtubeChatSelectedIndex) ? session.youtubeChatSelectedIndex : -1,
        youtubeChatPanelOpen: !!session.youtubeChatPanelOpen,
        youtubeChatAutoRead: !!session.youtubeChatAutoRead,
        youtubeChatBackgroundNotification: !!(session.youtubeChatBackgroundNotification ?? session.youtubeChatSoundAlert),
        youtubeChatBackgroundFlash: !!session.youtubeChatBackgroundFlash,
        youtubeChatBackgroundSound: false,
        youtubeChatVisualVisible: session.youtubeChatVisualVisible !== false,
        youtubeChatBanEntries: Array.isArray(session.youtubeChatBanEntries) ? session.youtubeChatBanEntries : [],
        broadcastPlatform: session.broadcastPlatform || state.broadcastPlatform,
        youtubeStreamMethod: session.youtubeStreamMethod || state.youtubeStreamMethod,
        youtubeApiMode: session.youtubeApiMode || state.youtubeApiMode,
        youtubeConnected: !!session.youtubeConnected,
        youtubeActiveAccountId: session.youtubeActiveAccountId || state.youtubeActiveAccountId,
        youtubeChannelTitle: session.youtubeChannelTitle || state.youtubeChannelTitle,
        youtubeSelectedPlaylistId: session.youtubeSelectedPlaylistId || state.youtubeSelectedPlaylistId,
        youtubeSelectedBroadcastId: session.youtubeSelectedBroadcastId || state.youtubeSelectedBroadcastId,
        broadcastTitle: session.broadcastTitle || state.broadcastTitle,
        broadcastServer: session.broadcastServer || state.broadcastServer,
        broadcastStreamKey: session.broadcastStreamKey || state.broadcastStreamKey,
        cameraEnabled: !!session.cameraEnabled,
        cameraDeviceId: session.cameraDeviceId || state.cameraDeviceId,
        micDeviceId: session.micDeviceId || state.micDeviceId,
        systemAudioEnabled: session.systemAudioEnabled !== false,
        systemAudioMode: session.systemAudioMode || state.systemAudioMode,
        systemAudioWindowTarget: session.systemAudioWindowTarget || state.systemAudioWindowTarget,
        micInputName: session.micInputName || null,
        systemInputName: session.systemInputName || null,
        screenItemId: session.screenItemId || null,
        cameraItemId: session.cameraItemId || null,
        cameraInputName: session.cameraInputName || null,
        screenInputName: session.screenInputName || null,
        videoSettings: session.videoSettings || state.videoSettings,
        recordingActive: !!session.recordingActive,
        streamingActive: !!session.streamingActive,
        recordingPaused: false,
        sessionActionInProgress: false
    });

    if (els.modeBroadcast) els.modeBroadcast.checked = true;
    if (els.modeRecord) els.modeRecord.checked = false;
    if (els.broadcastPlatform) els.broadcastPlatform.value = state.broadcastPlatform;
    if (els.youtubeStreamMethod) els.youtubeStreamMethod.value = state.youtubeStreamMethod;
    if (els.broadcastTitle) els.broadcastTitle.value = state.broadcastTitle || '';
    if (els.broadcastServer) els.broadcastServer.value = state.broadcastServer || '';
    if (els.broadcastStreamKey) els.broadcastStreamKey.value = state.broadcastStreamKey || '';
    if (els.cameraEnable) els.cameraEnable.checked = state.cameraEnabled;
    if (els.systemAudioEnable) els.systemAudioEnable.checked = state.systemAudioEnabled;
    syncSystemAudioWindowTargetOptions();
    syncSystemAudioModeUi();
    if (els.youtubeChatVisibleToggle) els.youtubeChatVisibleToggle.checked = state.youtubeChatVisualVisible;
    if (els.youtubeChatAutoReadToggle) els.youtubeChatAutoReadToggle.checked = state.youtubeChatAutoRead;
    if (els.micSelect && state.micDeviceId && Array.from(els.micSelect.options).some((option) => option.value === state.micDeviceId)) {
        els.micSelect.value = state.micDeviceId;
    }
    syncLiveMicSelectOptions();
    if (els.liveMicSelect && state.micDeviceId && Array.from(els.liveMicSelect.options).some((option) => option.value === state.micDeviceId)) {
        els.liveMicSelect.value = state.micDeviceId;
    }

    syncSelectedWindowControls();
    updateBroadcastMethodUi();
    updatePreparedYouTubeWatchLink();
    updateSourceVisibility();
    updateYouTubeChatVisualVisibility();
    renderYouTubeChatList({ preserveSelection: false });
    updateBroadcastUi();
    if (state.youtubeChatMessages.length > 0 && state.youtubeChatSelectedIndex >= 0) {
        setSelectedChatIndex(state.youtubeChatSelectedIndex, { announceSelection: false });
    }
    showStep(5);
    updateYouTubeChatStatus('recording_wizard.chat.session_restored', 'Etkin canlı yayın sihirbazı geri yüklendi.');
    return true;
}

function formatBroadcastStartFailure(result = {}) {
    const details = [];
    const rawError = String(result?.error || '').trim();
    const status = result?.status || {};
    const service = result?.service || {};
    const serviceSettings = service?.streamServiceSettings || {};
    const server = serviceSettings.server || state.broadcastServer || '';
    const hasStreamKey = !!(serviceSettings.key || state.broadcastStreamKey);

    if (rawError) {
        details.push(rawError);
    }

    if (!server) {
        details.push(t('recording_wizard.broadcast.failure_missing_server', 'Yayın sunucusu ayarlı görünmüyor.'));
    }

    if (!hasStreamKey) {
        details.push(t('recording_wizard.broadcast.failure_missing_stream_key', 'Yayın anahtarı boş görünüyor.'));
    }

    if (status?.outputReconnecting) {
        details.push(t('recording_wizard.broadcast.failure_reconnecting', 'OBS sunucuya bağlanmaya çalıştı ama bağlantı kuramadı. İnternetinizi, yayın anahtarını ve sunucu adresini kontrol edin.'));
    } else if (rawError && /StartStream/i.test(rawError)) {
        details.push(t('recording_wizard.broadcast.failure_obs_rejected', 'OBS yayını başlatma isteğini kabul etmedi. OBS yayın ayarlarını ve servis bilgisini kontrol edin.'));
    }

    if (status && Object.keys(status).length > 0) {
        const statusBits = [];
        if (status.outputActive !== undefined) {
            statusBits.push(`outputActive=${status.outputActive}`);
        }
        if (status.outputReconnecting !== undefined) {
            statusBits.push(`outputReconnecting=${status.outputReconnecting}`);
        }
        if (status.outputSkippedFrames !== undefined) {
            statusBits.push(`skippedFrames=${status.outputSkippedFrames}`);
        }
        if (status.outputCongestion !== undefined) {
            statusBits.push(`networkCongestion=${status.outputCongestion}`);
        }
        if (statusBits.length > 0) {
            details.push(t('recording_wizard.broadcast.failure_status_details', 'OBS durum bilgisi: {details}', {
                details: statusBits.join(', ')
            }));
        }
    }

    if (server) {
        details.push(t('recording_wizard.broadcast.failure_server_details', 'Sunucu: {server}', { server }));
    }

    const uniqueDetails = [...new Set(details.filter(Boolean))];
    return uniqueDetails.join(' ');
}

function setRecordingFormatSelection(format) {
    state.recordingFormat = format;
    if (!els.formatRadios) return;
    els.formatRadios.forEach((radio) => {
        radio.checked = radio.value === format;
    });
}

function setVideoQualityPresetSelection(preset) {
    state.videoQualityPreset = preset || 'current';
    if (els.videoQualityPreset) {
        els.videoQualityPreset.value = state.videoQualityPreset;
    }
}

function getLayoutReferenceSize() {
    const useOutputSize = state.videoQualityPreset && state.videoQualityPreset !== 'current';
    const width = useOutputSize
        ? (state.videoSettings?.outputWidth || state.videoSettings?.baseWidth || 1920)
        : (state.videoSettings?.baseWidth || 1920);
    const height = useOutputSize
        ? (state.videoSettings?.outputHeight || state.videoSettings?.baseHeight || 1080)
        : (state.videoSettings?.baseHeight || 1080);

    return {
        baseWidth: Math.max(1, width),
        baseHeight: Math.max(1, height)
    };
}

function setCaptureModeSelection(mode) {
    state.captureMode = mode;
    if (els.captureScreen) els.captureScreen.checked = mode === 'screen';
    if (els.captureWindow) els.captureWindow.checked = mode === 'window';
}

function formatPercentValue(value, digits = 1) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '-';
    return `${numeric.toFixed(digits)}%`;
}

function formatMsValue(value, digits = 1) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '-';
    return `${numeric.toFixed(digits)} ms`;
}

function formatFpsValue(value, digits = 1) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '-';
    return numeric.toFixed(digits);
}

function updateObsStatsSummary() {
    if (!els.obsStatsSummary) return;

    if (!state.obsConnected) {
        setFieldText(els.obsStatsSummary, t(
            'recording_wizard.step6.obs_stats_disconnected',
            'OBS baglantisi kurulunca yayin istatistikleri burada gorunecek.'
        ));
        return;
    }

    const stats = state.latestObsStats;
    if (!stats) {
        setFieldText(els.obsStatsSummary, t(
            'recording_wizard.step6.obs_stats_waiting',
            'OBS yayin istatistikleri aliniyor...'
        ));
        return;
    }

    if (stats.error) {
        setFieldText(els.obsStatsSummary, t(
            'recording_wizard.step6.obs_stats_error',
            'OBS istatistikleri alinamadi: {error}',
            { error: stats.error }
        ));
        return;
    }

    const statusText = stats.outputActive
        ? t('recording_wizard.step6.obs_stats_live', 'Yayin durumu: Canli')
        : t('recording_wizard.step6.obs_stats_idle', 'Yayin durumu: Beklemede');
    const fpsText = t('recording_wizard.step6.obs_stats_fps', 'FPS: {fps}', {
        fps: formatFpsValue(stats.activeFps)
    });
    const renderText = t('recording_wizard.step6.obs_stats_render', 'Render gecikmesi: {percent} ({frames})', {
        percent: formatPercentValue(stats.renderSkippedPercent),
        frames: Number.isFinite(stats.renderSkippedFrames) ? stats.renderSkippedFrames : '-'
    });
    const encoderText = t('recording_wizard.step6.obs_stats_encoder', 'Encoder gecikmesi: {percent} ({frames})', {
        percent: formatPercentValue(stats.outputSkippedPercent),
        frames: Number.isFinite(stats.outputSkippedFrames) ? stats.outputSkippedFrames : '-'
    });
    const networkText = t('recording_wizard.step6.obs_stats_network', 'Ag tikanikligi: {percent}', {
        percent: formatPercentValue(stats.outputCongestion, 2)
    });
    const frameTimeText = t('recording_wizard.step6.obs_stats_frame_time', 'Ortalama kare suresi: {time}', {
        time: formatMsValue(stats.averageFrameRenderTime)
    });

    setFieldText(els.obsStatsSummary, [
        statusText,
        fpsText,
        renderText,
        encoderText,
        networkText,
        frameTimeText
    ].join('\n'));
}

async function refreshObsStats() {
    if (!state.obsConnected) {
        state.latestObsStats = null;
        updateObsStatsSummary();
        return;
    }

    try {
        const [statsResponse, streamResponse] = await Promise.all([
            ipcRenderer.invoke('obs-get-stats'),
            ipcRenderer.invoke('obs-get-streaming-status')
        ]);

        const stats = statsResponse && statsResponse.success ? statsResponse : {};
        const stream = streamResponse && streamResponse.success ? streamResponse : {};
        const renderTotalFrames = Number(stats.renderTotalFrames || 0);
        const renderSkippedFrames = Number(stats.renderSkippedFrames || 0);
        const outputTotalFrames = Number(stream.outputTotalFrames || 0);
        const outputSkippedFrames = Number(stream.outputSkippedFrames || 0);

        state.latestObsStats = {
            outputActive: !!stream.outputActive,
            activeFps: Number(stats.activeFps || 0),
            averageFrameRenderTime: Number(stats.averageFrameRenderTime || 0),
            renderSkippedFrames,
            renderSkippedPercent: renderTotalFrames > 0 ? (renderSkippedFrames / renderTotalFrames) * 100 : 0,
            outputSkippedFrames,
            outputSkippedPercent: outputTotalFrames > 0 ? (outputSkippedFrames / outputTotalFrames) * 100 : 0,
            outputCongestion: Number(stream.outputCongestion || 0) * 100
        };
    } catch (error) {
        state.latestObsStats = {
            error: error.message || String(error)
        };
    }

    updateObsStatsSummary();
}

function syncObsStatsPolling() {
    clearObsStatsPolling();
    const isStepSixVisible = state.stepIndex === (els.steps.length - 1);
    if (!isStepSixVisible) {
        return;
    }

    updateObsStatsSummary();
    if (!state.obsConnected) {
        return;
    }

    refreshObsStats();
    obsStatsInterval = setInterval(() => {
        refreshObsStats();
    }, 2000);
}

function getSelectedLiveEffectsProfile() {
    return state.liveEffectsProfiles.find((profile) => profile.id === state.liveEffectsProfileId) || null;
}

function setFieldText(el, value) {
    if (!el) return;
    if ('value' in el) {
        el.value = value;
    } else {
        el.textContent = value;
    }
}

function normalizeChatMessageText(message) {
    return String(message?.text || '').replace(/\s+/g, ' ').trim();
}

function buildChatListLabel(message, reverseIndex = null) {
    if (!message) return '';
    const roleParts = [];
    if (message.isChatOwner) roleParts.push(t('recording_wizard.chat.role_owner', 'Yayin sahibi'));
    if (message.isChatModerator) roleParts.push(t('recording_wizard.chat.role_moderator', 'Moderatör'));
    if (message.isChatSponsor) roleParts.push(t('recording_wizard.chat.role_member', 'Üye'));
    const roleText = roleParts.length > 0 ? `, ${roleParts.join(', ')}` : '';
    const text = normalizeChatMessageText(message) || t('recording_wizard.chat.empty_message', 'Bos mesaj');
    return `${text} - ${message.authorDisplayName || '-'}${roleText}`;
}

function getSelectedChatMessage() {
    if (!Array.isArray(state.youtubeChatMessages) || state.youtubeChatMessages.length === 0) {
        return null;
    }
    const index = Math.max(0, Math.min(state.youtubeChatSelectedIndex, state.youtubeChatMessages.length - 1));
    return state.youtubeChatMessages[index] || null;
}

function getActiveYouTubeChannelId() {
    const activeAccountId = String(state.youtubeActiveAccountId || '').trim();
    if (!activeAccountId) return '';
    const activeAccount = (state.youtubeAccounts || []).find((account) => account.id === activeAccountId);
    return String(activeAccount?.channelId || '').trim();
}

function getYouTubeChatOwnerChannelId() {
    const ownerMessage = (state.youtubeChatMessages || []).find((message) => message?.isChatOwner && message?.authorChannelId);
    return String(ownerMessage?.authorChannelId || '').trim();
}

function getActiveYouTubeChatRoleSnapshot() {
    const activeChannelId = getActiveYouTubeChannelId();
    if (!activeChannelId) {
        return {
            isOwner: false,
            isModerator: false
        };
    }

    const ownMessages = (state.youtubeChatMessages || []).filter((message) => {
        return String(message?.authorChannelId || '').trim() === activeChannelId;
    });

    return {
        isOwner: ownMessages.some((message) => message?.isChatOwner === true),
        isModerator: ownMessages.some((message) => message?.isChatModerator === true)
    };
}

function canCurrentAccountModerateYouTubeChat() {
    if (!state.youtubeConnected || !state.youtubeLiveChatId) {
        return false;
    }

    const activeChannelId = getActiveYouTubeChannelId();
    if (!activeChannelId) {
        return false;
    }

    const ownerChannelId = getYouTubeChatOwnerChannelId();
    if (ownerChannelId && ownerChannelId === activeChannelId) {
        return true;
    }

    const activeRoleSnapshot = getActiveYouTubeChatRoleSnapshot();
    if (activeRoleSnapshot.isOwner || activeRoleSnapshot.isModerator) {
        return true;
    }

    return (state.youtubeModerators || []).some((item) => {
        const moderatorChannelId = String(item?.channelId || item?.id || '').trim();
        return moderatorChannelId && moderatorChannelId === activeChannelId;
    });
}

function setChatActionAvailability(button, enabled, disabledReason = '') {
    if (!button) return;
    button.disabled = !enabled;
    if (disabledReason) {
        button.title = disabledReason;
        button.setAttribute('aria-label', `${button.textContent || ''} - ${disabledReason}`.trim());
    } else {
        button.removeAttribute('title');
        button.removeAttribute('aria-label');
    }
}

function updateYouTubeChatVisualVisibility() {
    if (els.youtubeChatVisualPanel) {
        els.youtubeChatVisualPanel.style.display = state.youtubeChatPanelOpen ? 'block' : 'none';
    }
    if (els.btnToggleChatPanel) {
        const key = state.youtubeChatPanelOpen ? 'recording_wizard.chat.hide_panel' : 'recording_wizard.chat.open_panel';
        const fallback = state.youtubeChatPanelOpen ? 'Sohbeti Gizle' : 'Sohbeti Aç';
        els.btnToggleChatPanel.textContent = t(key, fallback);
        els.btnToggleChatPanel.setAttribute('aria-label', t(key, fallback));
    }
    const canWriteToChat = !!state.youtubeConnected && !!state.youtubeLiveChatId;
    if (els.youtubeChatComposer) {
        els.youtubeChatComposer.disabled = !canWriteToChat;
    }
    if (els.btnYoutubeChatSend) {
        els.btnYoutubeChatSend.disabled = !canWriteToChat;
    }
}

function getYouTubeChatStreamMessages(maxMessages = 6) {
    return (Array.isArray(state.youtubeChatMessages) ? state.youtubeChatMessages : [])
        .slice(-maxMessages)
        .map((message) => ({
            authorDisplayName: message.authorDisplayName || '-',
            text: normalizeChatMessageText(message)
        }));
}

async function syncYouTubeChatStreamOverlay() {
    if (state.mode !== 'broadcast') {
        return;
    }

    if (!state.recordingActive || !state.streamingActive) {
        await ipcRenderer.invoke('obs-hide-live-chat-overlay', {
            sceneName: state.sceneName
        });
        return;
    }

    await ipcRenderer.invoke('obs-update-live-chat-overlay', {
        sceneName: state.sceneName,
        visible: state.youtubeChatVisualVisible,
        messages: getYouTubeChatStreamMessages()
    });
}

function updateYouTubeChatStatus(messageKey = '', fallback = '', params = {}, options = {}) {
    if (!els.youtubeChatStatus) return;
    const nextText = messageKey ? t(messageKey, fallback, params) : fallback;
    const shouldAnnounce = options.announce !== false;
    if (!shouldAnnounce) {
        els.youtubeChatStatus.textContent = nextText;
        return;
    }
    els.youtubeChatStatus.textContent = '';
    setTimeout(() => {
        if (els.youtubeChatStatus) {
            els.youtubeChatStatus.textContent = nextText;
        }
    }, 30);
}

function getYouTubeChatApiErrorText(response = {}) {
    const rawError = String(response.error || '').trim();
    const errorCode = String(response.errorCode || response.reason || '').trim().toLowerCase();

    if (errorCode === 'quotaexceeded' || errorCode === 'dailylimitexceeded' || errorCode === 'dailylimitexceeded402') {
        return rawError || 'YouTube API günlük kotası aşıldı.';
    }
    if (errorCode === 'ratelimitexceeded' || errorCode === 'userratelimitexceeded') {
        return rawError || 'YouTube API hız sınırı aşıldı.';
    }
    return rawError || t('recording_wizard.unknown_error', 'Unknown error');
}

function getYouTubeChatErrorRetryDelay(response = {}) {
    const errorCode = String(response.errorCode || response.reason || '').trim().toLowerCase();
    if (errorCode === 'quotaexceeded' || errorCode === 'dailylimitexceeded' || errorCode === 'dailylimitexceeded402') {
        return 300000;
    }
    if (errorCode === 'ratelimitexceeded' || errorCode === 'userratelimitexceeded') {
        return 60000;
    }
    return 5000;
}

function renderYouTubeChatList({ preserveSelection = true, announceSelection = false } = {}) {
    if (!els.youtubeChatList) return;

    const previousMessageId = preserveSelection ? getSelectedChatMessage()?.id || '' : '';
    els.youtubeChatList.innerHTML = '';

    state.youtubeChatMessages.forEach((message, index) => {
        const option = document.createElement('option');
        option.value = message.id || `chat-${index}`;
        option.textContent = buildChatListLabel(message, state.youtubeChatMessages.length - index);
        els.youtubeChatList.appendChild(option);
    });

    if (state.youtubeChatMessages.length === 0) {
        state.youtubeChatSelectedIndex = -1;
        return;
    }

    let nextIndex = state.youtubeChatSelectedIndex;
    if (previousMessageId) {
        const matchedIndex = state.youtubeChatMessages.findIndex((message) => message.id === previousMessageId);
        if (matchedIndex >= 0) {
            nextIndex = matchedIndex;
        }
    }

    nextIndex = Math.max(0, Math.min(nextIndex, state.youtubeChatMessages.length - 1));
    state.youtubeChatSelectedIndex = nextIndex;
    els.youtubeChatList.selectedIndex = nextIndex;

    if (announceSelection) {
        const selected = getSelectedChatMessage();
        if (selected) {
            announceChatMessage(t('recording_wizard.chat.selection_changed', '{message} - {author}', {
                message: normalizeChatMessageText(selected),
                author: selected.authorDisplayName || '-'
            }));
        }
    }
}

function setSelectedChatIndex(index, { announceSelection = false, focusList = false } = {}) {
    if (!Array.isArray(state.youtubeChatMessages) || state.youtubeChatMessages.length === 0) {
        return;
    }

    const boundedIndex = Math.max(0, Math.min(index, state.youtubeChatMessages.length - 1));
    state.youtubeChatSelectedIndex = boundedIndex;

    if (els.youtubeChatList) {
        els.youtubeChatList.selectedIndex = boundedIndex;
        if (focusList) {
            els.youtubeChatList.focus();
        }
    }

    if (announceSelection) {
        const selected = getSelectedChatMessage();
        if (selected) {
            announceChatMessage(t('recording_wizard.chat.selection_changed', '{message} - {author}', {
                message: normalizeChatMessageText(selected),
                author: selected.authorDisplayName || '-'
            }));
        }
    }
}

function stopYouTubeChatPolling() {
    if (state.youtubeChatPollingTimer) {
        clearTimeout(state.youtubeChatPollingTimer);
        state.youtubeChatPollingTimer = null;
    }
}

function scheduleYouTubeChatPoll(delayMs = null) {
    stopYouTubeChatPolling();
    if (!state.youtubeLiveChatId || state.mode !== 'broadcast' || (!state.recordingActive && !isYouTubeChatWatchLaunchProfile())) {
        return;
    }

    const nextDelay = Number.isFinite(delayMs) ? delayMs : state.youtubeChatPollingIntervalMs;
    state.youtubeChatPollingTimer = setTimeout(() => {
        pollYouTubeChatMessages().catch((error) => {
            console.error('YouTube chat poll failed:', error);
        });
    }, Math.max(1000, nextDelay));
}

async function ensureYouTubeChatSessionLoaded() {
    if (isYouTubeChatWatchLaunchProfile()) {
        if (!state.youtubeChatWatchUrl) {
            updateYouTubeChatStatus('recording_wizard.chat.status_idle', 'Canlı sohbet bekleniyor.');
            logRecordingWizard('youtube_chat_watch_session_missing_url');
            return false;
        }

        logRecordingWizard('youtube_chat_watch_session_request_started', {
            youtubeConnected: !!state.youtubeConnected
        });
        const response = await ipcRenderer.invoke('youtube-get-live-chat-session-from-url', {
            url: state.youtubeChatWatchUrl
        });

          if (!response.success) {
            const errorText = getYouTubeChatWatchErrorText(response);
              logRecordingWizard('youtube_chat_watch_session_request_failed', {
                  error: response.error || null,
                  errorCode: response.errorCode || null,
                  statusCode: response.statusCode || null
              });
              updateYouTubeChatStatus('recording_wizard.chat.status_error', 'Canlı sohbet alınamadı: {error}', {
                  error: errorText
              });
              announce(t('recording_wizard.chat.status_error', 'Canlı sohbet alınamadı: {error}', {
                  error: errorText
              }));
              showShortcutTooltip(t('recording_wizard.chat.status_error', 'Canlı sohbet alınamadı: {error}', {
                  error: errorText
              }), { speak: false });
              return false;
          }

        state.youtubeLiveChatId = response.liveChatId || '';
        logRecordingWizard('youtube_chat_watch_session_request_succeeded', {
            youtubeLiveChatId: state.youtubeLiveChatId || null,
            isPublicSession: String(state.youtubeLiveChatId || '').startsWith('public:')
        });
        if (response.broadcast?.title) {
            state.youtubePreparedBroadcastTitle = response.broadcast.title;
        }
        if (response.broadcast?.watchUrl) {
            state.youtubePreparedWatchUrl = response.broadcast.watchUrl;
        }
        updatePreparedYouTubeWatchLink();
        updateYouTubeChatStatus('recording_wizard.chat.status_connected', 'Canlı sohbet bağlandı.');
        return !!state.youtubeLiveChatId;
    }

    if (!isYouTubeApiMode() || !state.youtubePreparedBroadcastId) {
        return false;
    }

    const response = await ipcRenderer.invoke('youtube-get-live-chat-session', {
        broadcastId: state.youtubePreparedBroadcastId
    });

    if (!response.success) {
        updateYouTubeChatStatus('recording_wizard.chat.status_error', 'Canlı sohbet alınamadı: {error}', {
            error: response.error || t('recording_wizard.unknown_error', 'Unknown error')
        });
        return false;
    }

    state.youtubeLiveChatId = response.liveChatId || '';
    if (!state.youtubePreparedBroadcastTitle && response.broadcast?.title) {
        state.youtubePreparedBroadcastTitle = response.broadcast.title;
    }
    updateYouTubeChatStatus('recording_wizard.chat.status_connected', 'Canlı sohbet bağlandı.');
    return !!state.youtubeLiveChatId;
}

async function pollYouTubeChatMessages({ initial = false } = {}) {
    if (!state.youtubeLiveChatId) {
        const loaded = await ensureYouTubeChatSessionLoaded();
        if (!loaded) return;
    }

    const response = await ipcRenderer.invoke('youtube-list-live-chat-messages', {
        liveChatId: state.youtubeLiveChatId,
        pageToken: state.youtubeChatNextPageToken
    });

    if (!response.success) {
        const errorText = getYouTubeChatApiErrorText(response);
        const retryDelay = getYouTubeChatErrorRetryDelay(response);
        logRecordingWizard('youtube_chat_poll_failed', {
            liveChatId: state.youtubeLiveChatId || null,
            pageToken: state.youtubeChatNextPageToken || null,
            error: response.error || null,
            errorCode: response.errorCode || null,
            reason: response.reason || null,
            statusCode: response.statusCode || null,
            retryDelay
        });
        updateYouTubeChatStatus('recording_wizard.chat.status_error', 'Canlı sohbet alınamadı: {error}', {
            error: errorText
        });
        showShortcutTooltip(t('recording_wizard.chat.status_error', 'Canlı sohbet alınamadı: {error}', {
            error: errorText
        }), { speak: false });
        scheduleYouTubeChatPoll(retryDelay);
        return;
    }

    state.youtubeChatNextPageToken = response.nextPageToken || state.youtubeChatNextPageToken;
    state.youtubeChatPollingIntervalMs = Number(response.pollingIntervalMillis || 5000);

    const incoming = Array.isArray(response.messages) ? response.messages : [];
    if (incoming.length === 0) {
        if (initial && state.youtubeChatMessages.length === 0) {
            updateYouTubeChatStatus('recording_wizard.chat.status_empty', 'Henüz sohbet mesajı yok.');
        }
        scheduleYouTubeChatPoll();
        return;
    }

    const existingIds = new Set(state.youtubeChatMessages.map((message) => message.id));
    const newMessages = incoming.filter((message) => message.id && !existingIds.has(message.id));
    if (newMessages.length > 0) {
        state.youtubeChatMessages = [...state.youtubeChatMessages, ...newMessages].slice(-200);
        renderYouTubeChatList({ preserveSelection: true });
        await syncYouTubeChatStreamOverlay();
        await syncRecordingWizardSession();
        if (state.youtubeChatSelectedIndex < 0) {
            setSelectedChatIndex(Math.max(0, state.youtubeChatMessages.length - 1));
        }
        const latest = newMessages[newMessages.length - 1];
        const autoReadText = t('recording_wizard.chat.auto_read_message', '{message} - {author}', {
            message: normalizeChatMessageText(latest),
            author: latest.authorDisplayName || '-'
        });
        const windowFocused = await isWizardWindowFocused();
        console.log('YouTube chat new messages received:', {
            count: newMessages.length,
            windowFocused,
            backgroundNotificationEnabled: !!state.youtubeChatBackgroundNotification
        });
        if (state.youtubeChatAutoRead && windowFocused) {
            announceChatMessage(autoReadText);
        }
        if (state.youtubeChatBackgroundNotification && !windowFocused) {
            notifyBackgroundChatMessages(newMessages);
        }
        if (state.youtubeChatBackgroundFlash && !windowFocused) {
            ipcRenderer.invoke('flash-window-attention', { durationMs: 6000 }).catch(() => { });
        }
        if (state.youtubeChatBackgroundSound && !windowFocused) {
            playAccessBeep('chime').catch(() => { });
        }
        updateYouTubeChatStatus('recording_wizard.chat.status_updated', '{count} yeni mesaj alındı.', {
            count: newMessages.length
        }, {
            announce: false
        });
    } else if (initial && state.youtubeChatMessages.length === 0) {
        state.youtubeChatMessages = incoming.slice(-200);
        renderYouTubeChatList({ preserveSelection: false });
        await syncYouTubeChatStreamOverlay();
        await syncRecordingWizardSession();
        if (state.youtubeChatMessages.length > 0) {
            setSelectedChatIndex(state.youtubeChatMessages.length - 1);
        }
        updateYouTubeChatStatus('recording_wizard.chat.status_loaded', 'Canlı sohbet mesajları yüklendi.');
    }

    scheduleYouTubeChatPoll();
}

function resetYouTubeChatState() {
    stopYouTubeChatPolling();
    state.youtubeLiveChatId = '';
    state.youtubeChatMessages = [];
    state.youtubeChatSelectedIndex = -1;
    state.youtubeChatNextPageToken = '';
    state.youtubeChatBans = {};
    state.youtubeChatBanEntries = [];
    state.youtubeChatPanelOpen = false;
    renderYouTubeChatList({ preserveSelection: false });
    renderYouTubeChatBanList();
    updateYouTubeChatVisualVisibility();
    updateYouTubeChatStatus('recording_wizard.chat.status_idle', 'Canlı sohbet bekleniyor.');
    ipcRenderer.invoke('obs-remove-live-chat-overlay', {
        sceneName: state.sceneName
    }).catch(() => { });
    syncRecordingWizardSession().catch(() => { });
}

function formatYouTubeChatBanEntry(entry = {}) {
    const author = String(entry.authorDisplayName || '').trim() || '-';
    const channelId = String(entry.channelId || '').trim();
    const type = entry.type === 'permanent'
        ? t('recording_wizard.chat.ban_type_permanent', 'Kalıcı yasak')
        : t('recording_wizard.chat.ban_type_temporary', '{minutes} dk susturma', {
            minutes: Math.max(1, Math.round(Number(entry.banDurationSeconds || 0) / 60))
        });
    return channelId ? `${author} - ${type} (${channelId})` : `${author} - ${type}`;
}

function renderYouTubeChatBanList() {
    if (!els.youtubeChatBanList) return;
    els.youtubeChatBanList.innerHTML = '';
    const entries = Array.isArray(state.youtubeChatBanEntries) ? state.youtubeChatBanEntries : [];
    entries.forEach((entry, index) => {
        const option = document.createElement('option');
        option.value = entry.banId || `ban-${index}`;
        option.textContent = formatYouTubeChatBanEntry(entry);
        els.youtubeChatBanList.appendChild(option);
    });
    els.youtubeChatBanList.disabled = entries.length === 0;
    if (entries.length > 0) {
        els.youtubeChatBanList.selectedIndex = 0;
    }
    if (els.btnChatUnbanSelected) {
        els.btnChatUnbanSelected.disabled = entries.length === 0;
    }
}

function openYouTubeChatPanel({ focusList = false } = {}) {
    state.youtubeChatPanelOpen = true;
    updateYouTubeChatVisualVisibility();
    syncRecordingWizardSession().catch(() => { });
    if (focusList && els.youtubeChatList) {
        els.youtubeChatList.focus();
    }
}

function closeYouTubeChatPanel({ restoreFocus = false } = {}) {
    state.youtubeChatPanelOpen = false;
    updateYouTubeChatVisualVisibility();
    syncRecordingWizardSession().catch(() => { });
    if (restoreFocus && els.btnStartRecord) {
        els.btnStartRecord.focus();
    }
}

async function sendYouTubeChatMessage() {
    if (!state.youtubeConnected) {
        showShortcutTooltip(t('recording_wizard.chat.auth_required', 'Mesaj göndermek için önce bir YouTube hesabı bağlayın.'));
        return;
    }
    if (!state.youtubeLiveChatId) {
        showShortcutTooltip(t('recording_wizard.chat.send_unavailable', 'Canlı sohbet bağlantısı hazır değil.'));
        return;
    }

    const text = String(els.youtubeChatComposer?.value || '');
    if (!text.trim()) {
        showShortcutTooltip(t('recording_wizard.chat.empty_composer', 'Gönderilecek mesaj boş olamaz.'));
        return;
    }

    const response = await ipcRenderer.invoke('youtube-send-live-chat-message', {
        liveChatId: state.youtubeLiveChatId,
        text
    });

    if (!response.success) {
        showShortcutTooltip(t('recording_wizard.chat.send_failed', 'Mesaj gönderilemedi: {error}', {
            error: response.error || t('recording_wizard.unknown_error', 'Unknown error')
        }));
        return;
    }

    els.youtubeChatComposer.value = '';
    const sentMessage = response.message || null;
    if (sentMessage?.id && !state.youtubeChatMessages.some((message) => message.id === sentMessage.id)) {
        state.youtubeChatMessages = [...state.youtubeChatMessages, sentMessage].slice(-200);
        renderYouTubeChatList({ preserveSelection: false });
        setSelectedChatIndex(state.youtubeChatMessages.length - 1);
        await syncYouTubeChatStreamOverlay();
        await syncRecordingWizardSession();
        if (state.youtubeChatAutoRead) {
            announceChatMessage(t('recording_wizard.chat.auto_read_message', '{message} - {author}', {
                message: normalizeChatMessageText(sentMessage),
                author: sentMessage.authorDisplayName || '-'
            }));
        }
    }
    scheduleYouTubeChatPoll(1000);
}

function openYouTubeChatMenu() {
    const message = getSelectedChatMessage();
    if (!message || !els.youtubeChatMenuDialog) {
        showShortcutTooltip(t('recording_wizard.chat.menu_no_message', 'Önce bir sohbet mesajı seçin.'));
        return;
    }

    if (els.youtubeChatMenuSummary) {
        els.youtubeChatMenuSummary.textContent = t('recording_wizard.chat.menu_summary', '{message} - {author}', {
            message: normalizeChatMessageText(message),
            author: message.authorDisplayName || '-'
        });
    }
    const hasModerationAccess = canCurrentAccountModerateYouTubeChat();
    const moderationDisabledReason = t(
        'recording_wizard.chat.moderation_unavailable',
        'Moderasyon işlemleri yalnızca moderatörler veya yayın sahibi için kullanılabilir.'
    );
    const canModerateUser = hasModerationAccess && !!message?.authorChannelId && !!state.youtubeConnected && !!state.youtubeLiveChatId;
    const knownBanId = message?.authorChannelId ? state.youtubeChatBans[message.authorChannelId] || '' : '';
    setChatActionAvailability(
        els.btnChatDeleteMessage,
        hasModerationAccess && !!message.canDelete,
        hasModerationAccess ? '' : moderationDisabledReason
    );
    setChatActionAvailability(
        els.btnChatTimeout5m,
        canModerateUser,
        hasModerationAccess ? '' : moderationDisabledReason
    );
    setChatActionAvailability(
        els.btnChatTimeout10m,
        canModerateUser,
        hasModerationAccess ? '' : moderationDisabledReason
    );
    setChatActionAvailability(
        els.btnChatBanUser,
        canModerateUser,
        hasModerationAccess ? '' : moderationDisabledReason
    );
    setChatActionAvailability(
        els.btnChatUnbanUser,
        hasModerationAccess && !!knownBanId,
        hasModerationAccess ? '' : moderationDisabledReason
    );
    if (els.youtubeChatMenuPermissionHint) {
        els.youtubeChatMenuPermissionHint.style.display = hasModerationAccess ? 'none' : 'block';
    }
    els.youtubeChatMenuDialog.showModal();
    const firstEnabledButton = [
        els.btnChatCopyMessage,
        els.btnChatCopyAuthor,
        els.btnChatCopyChannel,
        els.btnChatMentionAuthor,
        els.btnChatDeleteMessage,
        els.btnChatTimeout5m,
        els.btnChatTimeout10m,
        els.btnChatBanUser,
        els.btnChatUnbanUser,
        els.btnChatCloseMenu
    ].find((button) => button && !button.disabled);
    firstEnabledButton?.focus();
}

function closeYouTubeChatMenu() {
    if (els.youtubeChatMenuDialog?.open) {
        els.youtubeChatMenuDialog.close();
    }
    if (els.youtubeChatList) {
        els.youtubeChatList.focus();
    }
}

async function deleteSelectedYouTubeChatMessage() {
    if (!state.youtubeConnected) {
        showShortcutTooltip(t('recording_wizard.chat.auth_required', 'Mesaj göndermek için önce bir YouTube hesabı bağlayın.'));
        return;
    }
    const message = getSelectedChatMessage();
    if (!message?.id) {
        return;
    }

    const response = await ipcRenderer.invoke('youtube-delete-live-chat-message', {
        messageId: message.id
    });

    if (!response.success) {
        showShortcutTooltip(t('recording_wizard.chat.delete_failed', 'Mesaj silinemedi: {error}', {
            error: response.error || t('recording_wizard.unknown_error', 'Unknown error')
        }));
        return;
    }

    state.youtubeChatMessages = state.youtubeChatMessages.filter((item) => item.id !== message.id);
    renderYouTubeChatList({ preserveSelection: false });
    await syncYouTubeChatStreamOverlay();
    await syncRecordingWizardSession();
    if (state.youtubeChatMessages.length > 0) {
        setSelectedChatIndex(Math.max(0, Math.min(state.youtubeChatSelectedIndex, state.youtubeChatMessages.length - 1)));
    }
    closeYouTubeChatMenu();
    showShortcutTooltip(t('recording_wizard.chat.delete_success', 'Mesaj silindi.'));
}

async function moderateSelectedYouTubeChatUser({ durationSeconds = null, permanent = false } = {}) {
    if (!state.youtubeConnected) {
        showShortcutTooltip(t('recording_wizard.chat.auth_required', 'Mesaj göndermek için önce bir YouTube hesabı bağlayın.'));
        return;
    }
    if (!state.youtubeLiveChatId) {
        showShortcutTooltip(t('recording_wizard.chat.send_unavailable', 'Canlı sohbet bağlantısı hazır değil.'));
        return;
    }
    const message = getSelectedChatMessage();
    if (!message?.authorChannelId) {
        showShortcutTooltip(t('recording_wizard.chat.moderation_target_missing', 'Bu kullanıcı için moderasyon bilgisi bulunamadı.'));
        return;
    }

    const response = await ipcRenderer.invoke('youtube-ban-live-chat-user', {
        liveChatId: state.youtubeLiveChatId,
        channelId: message.authorChannelId,
        durationSeconds: permanent ? null : durationSeconds
    });

    if (!response.success) {
        showShortcutTooltip(t('recording_wizard.chat.ban_failed', 'Kullanıcı işlemi başarısız oldu: {error}', {
            error: response.error || t('recording_wizard.unknown_error', 'Unknown error')
        }));
        return;
    }

    if (response.ban?.id) {
        state.youtubeChatBans[message.authorChannelId] = response.ban.id;
        state.youtubeChatBanEntries = [
            {
                banId: response.ban.id,
                channelId: message.authorChannelId,
                authorDisplayName: message.authorDisplayName || '',
                type: response.ban.type || (permanent ? 'permanent' : 'temporary'),
                banDurationSeconds: Number(response.ban.banDurationSeconds || durationSeconds || 0)
            },
            ...state.youtubeChatBanEntries.filter((entry) => entry.channelId !== message.authorChannelId)
        ];
        renderYouTubeChatBanList();
    }
    closeYouTubeChatMenu();
    const successKey = permanent
        ? 'recording_wizard.chat.ban_success'
        : (durationSeconds === 300
            ? 'recording_wizard.chat.timeout_5m_success'
            : 'recording_wizard.chat.timeout_10m_success');
    const fallback = permanent
        ? 'Kullanıcı yasaklandı.'
        : (durationSeconds === 300 ? 'Kullanıcı 5 dakika susturuldu.' : 'Kullanıcı 10 dakika susturuldu.');
    showShortcutTooltip(t(successKey, fallback));
}

async function unbanSelectedYouTubeChatUser() {
    if (!state.youtubeConnected) {
        showShortcutTooltip(t('recording_wizard.chat.auth_required', 'Mesaj göndermek için önce bir YouTube hesabı bağlayın.'));
        return;
    }
    const message = getSelectedChatMessage();
    const channelId = message?.authorChannelId || '';
    const banId = channelId ? state.youtubeChatBans[channelId] || '' : '';
    if (!banId) {
        showShortcutTooltip(t('recording_wizard.chat.unban_missing', 'Bu kullanıcı için kaldırılacak bilinen bir yasak bulunamadı.'));
        return;
    }

    const response = await ipcRenderer.invoke('youtube-unban-live-chat-user', {
        banId
    });

    if (!response.success) {
        showShortcutTooltip(t('recording_wizard.chat.unban_failed', 'Yasak kaldırılamadı: {error}', {
            error: response.error || t('recording_wizard.unknown_error', 'Unknown error')
        }));
        return;
    }

    delete state.youtubeChatBans[channelId];
    state.youtubeChatBanEntries = state.youtubeChatBanEntries.filter((entry) => entry.channelId !== channelId);
    renderYouTubeChatBanList();
    closeYouTubeChatMenu();
    showShortcutTooltip(t('recording_wizard.chat.unban_success', 'Kullanıcının yasağı kaldırıldı.'));
}

async function unbanSelectedYouTubeChatBanEntry() {
    const selectedBanId = String(els.youtubeChatBanList?.value || '').trim();
    if (!selectedBanId) {
        showShortcutTooltip(t('recording_wizard.chat.unban_missing', 'Bu kullanıcı için kaldırılacak bilinen bir yasak bulunamadı.'));
        return;
    }

    const entry = state.youtubeChatBanEntries.find((item) => item.banId === selectedBanId);
    if (!entry) {
        showShortcutTooltip(t('recording_wizard.chat.unban_missing', 'Bu kullanıcı için kaldırılacak bilinen bir yasak bulunamadı.'));
        return;
    }

    const response = await ipcRenderer.invoke('youtube-unban-live-chat-user', {
        banId: selectedBanId
    });

    if (!response.success) {
        showShortcutTooltip(t('recording_wizard.chat.unban_failed', 'Yasak kaldırılamadı: {error}', {
            error: response.error || t('recording_wizard.unknown_error', 'Unknown error')
        }));
        return;
    }

    delete state.youtubeChatBans[entry.channelId];
    state.youtubeChatBanEntries = state.youtubeChatBanEntries.filter((item) => item.banId !== selectedBanId);
    renderYouTubeChatBanList();
    showShortcutTooltip(t('recording_wizard.chat.unban_success', 'Kullanıcının yasağı kaldırıldı.'));
}

function getSessionLiveEffectsProfile() {
    if (!state.liveEffectsEnabled) return null;
    return getSelectedLiveEffectsProfile();
}

function getLiveEffectSlotByShortcut(shortcutKey) {
    const profile = getSessionLiveEffectsProfile();
    if (!profile || !Array.isArray(profile.slots)) return null;
    return profile.slots.find((slot) => String(slot.shortcutKey || '').toLowerCase() === String(shortcutKey || '').toLowerCase()) || null;
}

function getActiveLiveEffectSlot() {
    const profile = getSessionLiveEffectsProfile();
    if (!profile || !Array.isArray(profile.slots)) return null;
    if (!state.activeLiveEffectSlotId) return null;
    return profile.slots.find((slot) => slot.id === state.activeLiveEffectSlotId) || null;
}

function getLiveEffectSlotById(slotId) {
    const profile = getSessionLiveEffectsProfile();
    if (!profile || !Array.isArray(profile.slots) || !slotId) return null;
    return profile.slots.find((slot) => slot.id === slotId) || null;
}

function getConfiguredLiveEffectSlot(kind) {
    const profile = getSessionLiveEffectsProfile();
    if (!profile) return null;
    const slotId = kind === 'intro' ? profile.introSlotId : profile.outroSlotId;
    return getLiveEffectSlotById(slotId);
}

function getLiveEffectVisualKind(slot) {
    if (!slot) return null;
    if (slot.type === 'video' && slot.sourcePath) return 'video';
    if (slot.imagePath) return 'image';
    return null;
}

async function syncLiveEffectVisual(slot, options = {}) {
    if (!state.obsConnected) return;
    const { visible = true, restart = true } = options;
    const visualKind = getLiveEffectVisualKind(slot);

    logRecordingWizard('live_effect_video_visual_sync_requested', {
        slotId: slot?.id || null,
        slotType: slot?.type || null,
        visualKind,
        visible,
        restart
    });

    if (!slot) {
        await ipcRenderer.invoke('obs-hide-live-effect-video', { sceneName: state.sceneName });
        await ipcRenderer.invoke('obs-hide-live-effect-image', { sceneName: state.sceneName });
        await ipcRenderer.invoke('obs-hide-live-effect-audio', { sceneName: state.sceneName });
        logRecordingWizard('live_effect_video_visual_hidden', {
            sceneName: state.sceneName
        });
        return;
    }

    if (!visualKind) {
        await ipcRenderer.invoke('obs-hide-live-effect-video', { sceneName: state.sceneName });
        await ipcRenderer.invoke('obs-hide-live-effect-image', { sceneName: state.sceneName });
    } else {
        const response = visualKind === 'video'
            ? await ipcRenderer.invoke('obs-show-live-effect-video', {
                sceneName: state.sceneName,
                sourcePath: slot.sourcePath,
                volumePercent: slot.volumePercent || 100,
                loop: false,
                visible,
                restart
            })
            : await ipcRenderer.invoke('obs-show-live-effect-image', {
                sceneName: state.sceneName,
                sourcePath: slot.imagePath,
                visible
            });

        if (!response || !response.success) {
            console.warn(`obs-show-live-effect-${visualKind || 'visual'} failed:`, response && response.error);
            logRecordingWizard('live_effect_video_visual_sync_failed', {
                slotId: slot.id,
                visualKind,
                error: response && response.error ? response.error : 'unknown'
            });
            return;
        }
        logRecordingWizard('live_effect_video_visual_synced', {
            slotId: slot.id,
            sceneItemId: response.sceneItemId || null,
            inputName: response.inputName || null
        });
    }

    if (slot.sourcePath && visualKind !== 'video') {
        const audioResponse = await ipcRenderer.invoke('obs-show-live-effect-audio', {
            sceneName: state.sceneName,
            sourcePath: slot.sourcePath,
            volumePercent: slot.volumePercent || 100,
            loop: false,
            restart
        });
        if (!audioResponse || !audioResponse.success) {
            console.warn('obs-show-live-effect-audio failed:', audioResponse && audioResponse.error);
        }
    } else {
        await ipcRenderer.invoke('obs-hide-live-effect-audio', { sceneName: state.sceneName });
    }
}

function formatLiveEffectTime(seconds) {
    const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    const minutes = Math.floor(safe / 60);
    const remainingSeconds = Math.floor(safe % 60);
    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function stopLiveEffectsAudio(slotId, { resetPosition = true } = {}) {
    const playerState = state.liveEffectsPlayers[slotId];
    if (!playerState || !playerState.audio) return;

    playerState.audio.pause();
    if (resetPosition) {
        try {
            playerState.audio.currentTime = 0;
        } catch (error) {
            console.warn('Live effect reset failed:', error.message);
        }
    }

    const visualSlot = slotId ? getLiveEffectSlotById(slotId) : null;
    if (playerState.mediaType === 'video' || getLiveEffectVisualKind(visualSlot)) {
        syncLiveEffectVisual(null).catch((error) => {
            console.warn('Could not hide live effect visual:', error.message);
        });
    }
    ipcRenderer.invoke('obs-hide-live-effect-audio', { sceneName: state.sceneName }).catch(() => {});
}

function attachLiveEffectsMediaElement(playerState, { preferPreview = false } = {}) {
    if (!playerState || !playerState.audio) return;

    const shouldPreview = preferPreview
        && playerState.mediaType === 'video'
        && els.liveEffectsVideoPreviewPanel
        && els.liveEffectsVideoPreview;

    if (shouldPreview) {
        els.liveEffectsVideoPreviewPanel.hidden = false;
        if (playerState.audio !== els.liveEffectsVideoPreview) {
            els.liveEffectsVideoPreview.replaceWith(playerState.audio);
            els.liveEffectsVideoPreview = playerState.audio;
            els.liveEffectsVideoPreview.id = 'live-effects-video-preview';
            els.liveEffectsVideoPreview.setAttribute('playsinline', 'true');
        }
        return;
    }

    if (els.liveEffectsVideoPreviewPanel) {
        els.liveEffectsVideoPreviewPanel.hidden = true;
    }
    if (els.liveEffectsMediaHost && playerState.audio.parentElement !== els.liveEffectsMediaHost) {
        els.liveEffectsMediaHost.appendChild(playerState.audio);
    }
}

function stopAllLiveEffectsAudio() {
    Object.keys(state.liveEffectsPlayers).forEach((slotId) => {
        stopLiveEffectsAudio(slotId, { resetPosition: true });
        attachLiveEffectsMediaElement(state.liveEffectsPlayers[slotId], { preferPreview: false });
    });
    if (els.liveEffectsVideoPreviewPanel) {
        els.liveEffectsVideoPreviewPanel.hidden = true;
    }
}

function destroyLiveEffectsPlayer(slotId) {
    const playerState = state.liveEffectsPlayers[slotId];
    if (!playerState || !playerState.audio) return;

    try {
        playerState.audio.pause();
    } catch (error) {
        console.warn('Live effect destroy pause failed:', error.message);
    }

    try {
        playerState.audio.removeAttribute('src');
        playerState.audio.load();
    } catch (error) {
        console.warn('Live effect destroy reset failed:', error.message);
    }

    if (playerState.audio.parentElement) {
        playerState.audio.parentElement.removeChild(playerState.audio);
    }

    delete state.liveEffectsPlayers[slotId];
}

async function resetLiveEffectsSession({ removeObsVideo = true } = {}) {
    logRecordingWizard('live_effect_session_reset_requested', {
        removeObsVideo,
        playerCount: Object.keys(state.liveEffectsPlayers || {}).length,
        activeLiveEffectSlotId: state.activeLiveEffectSlotId || null
    });

    stopAllLiveEffectsAudio();
    Object.keys(state.liveEffectsPlayers).forEach((slotId) => {
        destroyLiveEffectsPlayer(slotId);
    });
    state.liveEffectsPlayers = {};
    state.activeLiveEffectSlotId = null;

    if (els.liveEffectsVideoPreviewPanel) {
        els.liveEffectsVideoPreviewPanel.hidden = true;
    }

    if (!state.obsConnected) return;

    try {
        if (removeObsVideo) {
            await ipcRenderer.invoke('obs-remove-live-effect-video', { sceneName: state.sceneName });
            await ipcRenderer.invoke('obs-remove-live-effect-image', { sceneName: state.sceneName });
            await ipcRenderer.invoke('obs-remove-live-effect-audio', { sceneName: state.sceneName });
            logRecordingWizard('live_effect_session_reset_obs_video_removed', {
                sceneName: state.sceneName || null
            });
        } else {
            await ipcRenderer.invoke('obs-hide-live-effect-video', { sceneName: state.sceneName });
            await ipcRenderer.invoke('obs-hide-live-effect-image', { sceneName: state.sceneName });
            await ipcRenderer.invoke('obs-hide-live-effect-audio', { sceneName: state.sceneName });
            logRecordingWizard('live_effect_session_reset_obs_video_hidden', {
                sceneName: state.sceneName || null
            });
        }
    } catch (error) {
        console.warn('Live effect visual reset failed:', error.message);
        logRecordingWizard('live_effect_session_reset_obs_video_failed', {
            sceneName: state.sceneName || null,
            removeObsVideo,
            error: error.message || String(error)
        });
    }
}

function getOrCreateLiveEffectsPlayer(slot) {
    const existing = state.liveEffectsPlayers[slot.id];
    const slotType = slot.type === 'video' ? 'video' : 'audio';
    if (existing && existing.sourcePath === slot.sourcePath && existing.mediaType === slotType) {
        return existing;
    }

    if (existing) {
        destroyLiveEffectsPlayer(slot.id);
    }

    const audio = document.createElement(slotType === 'video' ? 'video' : 'audio');
    audio.src = pathToFileURL(slot.sourcePath).href;
    audio.preload = 'auto';
    audio.controls = false;
    audio.playsInline = true;
    audio.loop = !!existing?.loopEnabled;
    audio.volume = Math.max(0, Math.min((slot.volumePercent || 100) / 100, 1));

    const nextState = {
        audio,
        sourcePath: slot.sourcePath,
        mediaType: slotType,
        loopEnabled: !!existing?.loopEnabled
    };

    audio.addEventListener('ended', () => {
        logRecordingWizard('live_effect_media_ended', {
            slotId: slot.id,
            mediaType: nextState.mediaType
        });
        if (!audio.loop) {
            if (nextState.mediaType === 'video' || slot.imagePath) {
                syncLiveEffectVisual(null).catch((error) => {
                    console.warn('Could not hide ended live effect visual:', error.message);
                });
            }
            updateLiveEffectsOverlay();
            updateLiveEffectsActiveStatus(t(
                'recording_wizard.step6.live_effects_finished',
                'Secili efekt tamamlandi.'
            ));
        }
    });
    audio.addEventListener('playing', () => {
        logRecordingWizard('live_effect_media_playing', {
            slotId: slot.id,
            mediaType: nextState.mediaType,
            currentTime: Number(audio.currentTime || 0).toFixed(3)
        });
    });
    audio.addEventListener('pause', () => {
        logRecordingWizard('live_effect_media_paused', {
            slotId: slot.id,
            mediaType: nextState.mediaType,
            currentTime: Number(audio.currentTime || 0).toFixed(3)
        });
    });
    audio.addEventListener('waiting', () => {
        logRecordingWizard('live_effect_media_waiting', {
            slotId: slot.id,
            mediaType: nextState.mediaType,
            currentTime: Number(audio.currentTime || 0).toFixed(3)
        });
    });
    audio.addEventListener('stalled', () => {
        logRecordingWizard('live_effect_media_stalled', {
            slotId: slot.id,
            mediaType: nextState.mediaType,
            currentTime: Number(audio.currentTime || 0).toFixed(3)
        });
    });
    audio.addEventListener('error', () => {
        logRecordingWizard('live_effect_media_error', {
            slotId: slot.id,
            mediaType: nextState.mediaType,
            code: audio.error ? audio.error.code : null
        });
    });

    state.liveEffectsPlayers[slot.id] = nextState;
    attachLiveEffectsMediaElement(nextState, { preferPreview: false });
    return nextState;
}

function getLiveEffectsSlotDisplayName(slot) {
    if (!slot) {
        return t('recording_wizard.step6.live_effects_no_active_slot', 'Secili efekt yok.');
    }
    return slot.name || t('recording_wizard.step6.live_effects_slot_fallback', 'Adsiz efekt');
}

function updateLiveEffectsActiveStatus(messageOverride = '') {
    if (!els.liveEffectsActiveStatus) return;

    if (messageOverride) {
        setFieldText(els.liveEffectsActiveStatus, messageOverride);
        return;
    }

    const slot = getActiveLiveEffectSlot();
    if (!slot) {
        setFieldText(els.liveEffectsActiveStatus, t(
            'recording_wizard.step6.live_effects_no_active_slot',
            'Secili efekt yok.'
        ));
        return;
    }

    const playerState = state.liveEffectsPlayers[slot.id];
    const audio = playerState && playerState.audio ? playerState.audio : null;
    const isPlaying = !!audio && !audio.paused && !audio.ended;
    const isLooping = !!playerState && !!playerState.loopEnabled;
    const currentTime = audio ? formatLiveEffectTime(audio.currentTime) : '0:00';
    const duration = audio && Number.isFinite(audio.duration) ? formatLiveEffectTime(audio.duration) : '--:--';
    const mediaTypeLabel = slot.type === 'video'
        ? t('recording_wizard.step6.live_effects_type_video', 'Video')
        : t('recording_wizard.step6.live_effects_type_audio', 'Ses');

    setFieldText(els.liveEffectsActiveStatus, t(
        'recording_wizard.step6.live_effects_active_status_text',
        'Secili efekt: {name}\nTur: {type}\nDurum: {status}\nDongu: {loop}\nSes seviyesi: %{volume}\nKonum: {current}/{duration}',
        {
            name: getLiveEffectsSlotDisplayName(slot),
            type: mediaTypeLabel,
            status: isPlaying
                ? t('recording_wizard.step6.live_effects_status_playing', 'Caliyor')
                : t('recording_wizard.step6.live_effects_status_paused', 'Beklemede'),
            loop: isLooping
                ? t('recording_wizard.step6.live_effects_loop_on', 'Acik')
                : t('recording_wizard.step6.live_effects_loop_off', 'Kapali'),
            volume: slot.volumePercent || 100,
            current: currentTime,
            duration
        }
    ));
}

function renderLiveEffectsOverlay() {
    if (!els.liveEffectsSlotGrid) return;

    const profile = getSessionLiveEffectsProfile();
    els.liveEffectsSlotGrid.innerHTML = '';
    if (els.liveEffectsVideoPreviewPanel) {
        els.liveEffectsVideoPreviewPanel.hidden = true;
    }

    if (!profile || !Array.isArray(profile.slots) || profile.slots.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = t('recording_wizard.step6.live_effects_no_profiles', 'Bu oturum icin hazir efekt slotu bulunamadi.');
        els.liveEffectsSlotGrid.appendChild(empty);
        return;
    }

    profile.slots.forEach((slot, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'live-effects-slot';
        button.dataset.slotId = slot.id;
        if (slot.id === state.activeLiveEffectSlotId) {
            button.classList.add('active');
        }

        const playerState = state.liveEffectsPlayers[slot.id];
        if (playerState && playerState.audio && !playerState.audio.paused && !playerState.audio.ended) {
            button.classList.add('playing');
        }

        const shortcut = slot.shortcutKey || '-';
        const sourceName = slot.sourcePath
            ? slot.sourcePath.split(/[\\/]/).pop()
            : t('recording_wizard.step6.live_effects_slot_empty', 'Dosya secilmedi');
        const typeName = slot.type === 'video'
            ? t('recording_wizard.step6.live_effects_type_video', 'Video')
            : t('recording_wizard.step6.live_effects_type_audio', 'Ses');
        const stateLabel = playerState && playerState.audio && !playerState.audio.paused && !playerState.audio.ended
            ? t('recording_wizard.step6.live_effects_status_playing', 'Caliyor')
            : t('recording_wizard.step6.live_effects_status_idle', 'Hazir');

        button.setAttribute('aria-pressed', slot.id === state.activeLiveEffectSlotId ? 'true' : 'false');
        button.setAttribute('aria-label', t(
            'recording_wizard.step6.live_effects_slot_aria',
            'Slot {index}, kisayol {shortcut}, {name}, durum {status}',
            {
                index: index + 1,
                shortcut,
                name: getLiveEffectsSlotDisplayName(slot),
                status: stateLabel
            }
        ));
        button.innerHTML = `
            <strong>${shortcut} - ${getLiveEffectsSlotDisplayName(slot)}</strong>
            <span class="live-effects-slot-meta">${sourceName}</span>
            <span class="live-effects-slot-meta">${typeName}</span>
            <span class="live-effects-slot-meta">${t('recording_wizard.step6.live_effects_volume_short', 'Ses')}: %${slot.volumePercent || 100}</span>
        `;
        button.addEventListener('click', async () => {
            await playLiveEffectSlot(slot, { announceSelection: true });
        });
        els.liveEffectsSlotGrid.appendChild(button);
    });
}

function updateLiveEffectsOverlay() {
    renderLiveEffectsOverlay();
    updateLiveEffectsActiveStatus();
    const activeSlot = getActiveLiveEffectSlot();
    if (activeSlot) {
        const playerState = state.liveEffectsPlayers[activeSlot.id];
        attachLiveEffectsMediaElement(playerState, { preferPreview: state.liveEffectsOverlayOpen });
    }
}

function openLiveEffectsOverlay() {
    const profile = getSessionLiveEffectsProfile();
    if (!profile) {
        showLiveEffectsTooltip(t(
            'recording_wizard.step6.live_effects_not_ready',
            'Canli efekt katmani icin once bu oturumda bir profil secip etkinlestirin.'
        ));
        return false;
    }

    if (!state.activeLiveEffectSlotId && Array.isArray(profile.slots)) {
        const firstUsableSlot = profile.slots.find((slot) => !!slot.sourcePath) || profile.slots[0];
        state.activeLiveEffectSlotId = firstUsableSlot ? firstUsableSlot.id : null;
    }

    state.liveEffectsOverlayOpen = true;
    state.liveEffectsLastFocusEl = document.activeElement;
    updateLiveEffectsOverlay();
    if (els.liveEffectsOverlay) {
        els.liveEffectsOverlay.classList.add('open');
        els.liveEffectsOverlay.setAttribute('aria-hidden', 'false');
    }
    if (els.liveEffectsOverlayPanel) {
        setTimeout(() => els.liveEffectsOverlayPanel.focus(), 10);
    }
    announce(t('recording_wizard.step6.live_effects_overlay_opened', 'Canli efekt katmani acildi.'));
    return true;
}

function closeLiveEffectsOverlay({ announceClose = true } = {}) {
    state.liveEffectsOverlayOpen = false;
    if (els.liveEffectsOverlay) {
        els.liveEffectsOverlay.classList.remove('open');
        els.liveEffectsOverlay.setAttribute('aria-hidden', 'true');
    }
    const activeSlot = getActiveLiveEffectSlot();
    if (activeSlot) {
        const playerState = state.liveEffectsPlayers[activeSlot.id];
        attachLiveEffectsMediaElement(playerState, { preferPreview: false });
    } else if (els.liveEffectsVideoPreviewPanel) {
        els.liveEffectsVideoPreviewPanel.hidden = true;
    }
    if (announceClose) {
        announce(t('recording_wizard.step6.live_effects_overlay_closed', 'Canli efekt katmani kapatildi.'));
    }
    if (state.liveEffectsLastFocusEl && typeof state.liveEffectsLastFocusEl.focus === 'function') {
        state.liveEffectsLastFocusEl.focus();
    }
}

function toggleLiveEffectsOverlay() {
    if (state.liveEffectsOverlayOpen) {
        closeLiveEffectsOverlay();
        return;
    }
    openLiveEffectsOverlay();
}

function waitForLiveEffectCompletion(audio) {
    return new Promise((resolve) => {
        if (!audio || audio.loop) {
            resolve();
            return;
        }
        if (audio.ended) {
            resolve();
            return;
        }
        const onEnded = () => {
            audio.removeEventListener('ended', onEnded);
            audio.removeEventListener('error', onEnded);
            resolve();
        };
        audio.addEventListener('ended', onEnded, { once: true });
        audio.addEventListener('error', onEnded, { once: true });
    });
}

async function playLiveEffectSlot(slot, { announceSelection = false, waitForCompletion = false, forceLoop = null } = {}) {
    if (!slot) return false;
    logRecordingWizard('live_effect_play_requested', {
        slotId: slot.id,
        slotType: slot.type || null,
        sourcePath: slot.sourcePath || null,
        announceSelection,
        waitForCompletion,
        forceLoop
    });
    state.activeLiveEffectSlotId = slot.id;

    if (!slot.sourcePath) {
        updateLiveEffectsOverlay();
        showLiveEffectsTooltip(t(
            'recording_wizard.step6.live_effects_slot_missing_file',
            'Secili slot icin bir ses dosyasi tanimlanmamis.'
        ));
        return false;
    }

    const playerState = getOrCreateLiveEffectsPlayer(slot);
    const audio = playerState.audio;
    audio.loop = forceLoop === null ? !!playerState.loopEnabled : !!forceLoop;
    audio.volume = Math.max(0, Math.min((slot.volumePercent || 100) / 100, 1));

    try {
        audio.currentTime = 0;
    } catch (error) {
        console.warn('Live effects seek reset failed:', error.message);
        logRecordingWizard('live_effect_seek_reset_failed', {
            slotId: slot.id,
            error: error.message || String(error)
        });
    }

    try {
        await syncLiveEffectVisual(slot);
        logRecordingWizard('live_effect_audio_play_starting', {
            slotId: slot.id,
            slotType: slot.type || null
        });
        await audio.play();
        attachLiveEffectsMediaElement(playerState, { preferPreview: state.liveEffectsOverlayOpen });
        updateLiveEffectsOverlay();
        if (announceSelection) {
            showLiveEffectsTooltip(t(
                'recording_wizard.step6.live_effects_slot_started',
                '{name} caliyor.',
                { name: getLiveEffectsSlotDisplayName(slot) }
            ));
        }
        if (waitForCompletion) {
            await waitForLiveEffectCompletion(audio);
            logRecordingWizard('live_effect_wait_for_completion_done', {
                slotId: slot.id,
                slotType: slot.type || null
            });
        }
        return true;
    } catch (error) {
        console.error('Live effect play failed:', error);
        logRecordingWizard('live_effect_play_failed', {
            slotId: slot.id,
            slotType: slot.type || null,
            error: error.message || String(error)
        });
        showLiveEffectsTooltip(t(
            'recording_wizard.step6.live_effects_play_failed',
            'Efekt calinamadi: {error}',
            { error: error.message || error }
        ));
        return false;
    }
}

async function toggleLiveEffectPause() {
    const slot = getActiveLiveEffectSlot();
    if (!slot) {
        showLiveEffectsTooltip(t('recording_wizard.step6.live_effects_no_active_slot', 'Secili efekt yok.'));
        return;
    }

    const playerState = getOrCreateLiveEffectsPlayer(slot);
    const audio = playerState.audio;

    if (audio.paused || audio.ended) {
        const visualKind = getLiveEffectVisualKind(slot);
        if (visualKind === 'video') {
            const visualResumeResponse = await ipcRenderer.invoke('obs-resume-live-effect-video', {
                sceneName: state.sceneName
            });
            if (!visualResumeResponse?.success) {
                console.warn('obs-resume-live-effect-video failed:', visualResumeResponse?.error);
            }
        } else if (visualKind === 'image') {
            await syncLiveEffectVisual(slot, { visible: true, restart: false });
        }
        await audio.play();
        showLiveEffectsTooltip(t('recording_wizard.step6.live_effects_resumed', '{name} devam ediyor.', {
            name: getLiveEffectsSlotDisplayName(slot)
        }));
    } else {
        audio.pause();
        const visualKind = getLiveEffectVisualKind(slot);
        if (visualKind === 'video') {
            const visualPauseResponse = await ipcRenderer.invoke('obs-pause-live-effect-video', {
                sceneName: state.sceneName
            });
            if (!visualPauseResponse?.success) {
                console.warn('obs-pause-live-effect-video failed:', visualPauseResponse?.error);
            }
        } else if (visualKind === 'image') {
            const visualHideResponse = await ipcRenderer.invoke('obs-hide-live-effect-image', {
                sceneName: state.sceneName
            });
            if (!visualHideResponse?.success) {
                console.warn('obs-hide-live-effect-image failed:', visualHideResponse?.error);
            }
        }
        showLiveEffectsTooltip(t('recording_wizard.step6.live_effects_paused', '{name} duraklatildi.', {
            name: getLiveEffectsSlotDisplayName(slot)
        }));
    }

    updateLiveEffectsOverlay();
}

function stopActiveLiveEffect() {
    const slot = getActiveLiveEffectSlot();
    if (!slot) {
        showLiveEffectsTooltip(t('recording_wizard.step6.live_effects_no_active_slot', 'Secili efekt yok.'));
        return;
    }
    stopLiveEffectsAudio(slot.id, { resetPosition: true });
    updateLiveEffectsOverlay();
    showLiveEffectsTooltip(t('recording_wizard.step6.live_effects_stopped', '{name} durduruldu.', {
        name: getLiveEffectsSlotDisplayName(slot)
    }));
}

async function toggleActiveLiveEffectLoop() {
    const slot = getActiveLiveEffectSlot();
    if (!slot) {
        showLiveEffectsTooltip(t('recording_wizard.step6.live_effects_no_active_slot', 'Secili efekt yok.'));
        return;
    }

    const playerState = getOrCreateLiveEffectsPlayer(slot);
    playerState.loopEnabled = !playerState.loopEnabled;
    playerState.audio.loop = playerState.loopEnabled;

    if (playerState.audio.paused || playerState.audio.ended) {
        try {
            await playerState.audio.play();
        } catch (error) {
            console.error('Loop play failed:', error);
        }
    }

    updateLiveEffectsOverlay();
    showLiveEffectsTooltip(playerState.loopEnabled
        ? t('recording_wizard.step6.live_effects_loop_enabled', '{name} icin dongu acildi.', {
            name: getLiveEffectsSlotDisplayName(slot)
        })
        : t('recording_wizard.step6.live_effects_loop_disabled', '{name} icin dongu kapatildi.', {
            name: getLiveEffectsSlotDisplayName(slot)
        }));
}

function seekActiveLiveEffect(deltaSeconds) {
    const slot = getActiveLiveEffectSlot();
    if (!slot) {
        showLiveEffectsTooltip(t('recording_wizard.step6.live_effects_no_active_slot', 'Secili efekt yok.'));
        return;
    }

    const playerState = getOrCreateLiveEffectsPlayer(slot);
    const audio = playerState.audio;
    const nextTime = Math.max(0, Math.min(
        Number.isFinite(audio.duration) ? audio.duration : Number.MAX_SAFE_INTEGER,
        (audio.currentTime || 0) + deltaSeconds
    ));
    audio.currentTime = nextTime;
    updateLiveEffectsOverlay();
    showLiveEffectsTooltip(t('recording_wizard.step6.live_effects_seeked', '{name} konumu {time}.', {
        name: getLiveEffectsSlotDisplayName(slot),
        time: formatLiveEffectTime(nextTime)
    }));
}

function changeActiveLiveEffectVolume(delta) {
    const slot = getActiveLiveEffectSlot();
    if (!slot) {
        showLiveEffectsTooltip(t('recording_wizard.step6.live_effects_no_active_slot', 'Secili efekt yok.'));
        return;
    }

    slot.volumePercent = Math.max(0, Math.min(200, (slot.volumePercent || 100) + delta));
    const playerState = state.liveEffectsPlayers[slot.id];
    if (playerState && playerState.audio) {
        playerState.audio.volume = Math.max(0, Math.min(slot.volumePercent / 100, 1));
    }
    updateLiveEffectsOverlay();
    showLiveEffectsTooltip(t('recording_wizard.step6.live_effects_volume_changed', '{name} ses seviyesi yuzde {volume}.', {
        name: getLiveEffectsSlotDisplayName(slot),
        volume: slot.volumePercent
    }));
}

function handleLiveEffectsOverlayKeydown(event) {
    if (!state.liveEffectsOverlayOpen) return false;

    const key = event.key;
    const lowerKey = key.toLowerCase();

    if (event.altKey || event.ctrlKey || event.metaKey) {
        return false;
    }

    if (/^[0-9]$/.test(key)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const slot = getLiveEffectSlotByShortcut(key);
        playLiveEffectSlot(slot, { announceSelection: true });
        return true;
    }

    switch (lowerKey) {
        case 'escape':
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            closeLiveEffectsOverlay();
            return true;
        case 's':
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            stopActiveLiveEffect();
            return true;
        case 'p':
        case 'k':
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            toggleLiveEffectPause();
            return true;
        case 'r':
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            toggleActiveLiveEffectLoop();
            return true;
        case 'j':
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            seekActiveLiveEffect(-5);
            return true;
        case 'l':
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            seekActiveLiveEffect(5);
            return true;
        case 'arrowup':
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            changeActiveLiveEffectVolume(5);
            return true;
        case 'arrowdown':
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            changeActiveLiveEffectVolume(-5);
            return true;
        default:
            return false;
    }
}

function renderLiveEffectsProfileOptions() {
    const selects = [els.liveEffectsProfile, els.liveEffectsProfileStep6].filter(Boolean);
    if (selects.length === 0) return;

    selects.forEach((selectEl) => {
        selectEl.innerHTML = '';
    });

    if (!Array.isArray(state.liveEffectsProfiles) || state.liveEffectsProfiles.length === 0) {
        selects.forEach((selectEl) => {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = t('recording_wizard.step1.live_effects_no_profiles', 'Kayitli efekt profili bulunamadi.');
            selectEl.appendChild(option);
            selectEl.disabled = true;
        });
        return;
    }

    state.liveEffectsProfiles.forEach((profile) => {
        selects.forEach((selectEl) => {
            const option = document.createElement('option');
            option.value = profile.id;
            option.textContent = profile.name || t('live_effects_panel.default_profile_name', 'Yeni Profil');
            option.selected = profile.id === state.liveEffectsProfileId;
            selectEl.appendChild(option);
        });
    });

    selects.forEach((selectEl) => {
        selectEl.disabled = !state.liveEffectsEnabled;
    });
}

function updateLiveEffectsSummary() {
    if (!els.liveEffectsSessionSummary) return;

    if (!state.liveEffectsEnabled) {
        setFieldText(els.liveEffectsSessionSummary, t(
            'recording_wizard.step6.live_effects_summary_disabled',
            'Bu oturum icin canli efekt profili etkin degil.'
        ));
        return;
    }

    const selectedProfile = getSelectedLiveEffectsProfile();
    const profileName = selectedProfile
        ? selectedProfile.name
        : t('recording_wizard.step1.live_effects_no_profiles', 'Kayitli efekt profili bulunamadi.');

    const summaryText = t(
        'recording_wizard.step6.live_effects_summary_selected',
        'Bu oturumda canli efekt profili kullanilacak: {profile}',
        { profile: profileName }
    );
    const shortcutText = t(
        'recording_wizard.step6.live_effects_help',
        'Kisayollar: Alt+Ctrl+Bosluk katmani ac/kapat, 1-0 slot cal, S durdur, P veya K duraklat/devam, R dongu ac/kapat, Yukari/Asagi ses seviyesi, J/L geri/ileri sar, Escape katmani kapatir.'
    );

    setFieldText(els.liveEffectsSessionSummary, `${summaryText}\n${shortcutText}`);
}

function updateLiveEffectsUi() {
    if (els.liveEffectsEnable) {
        els.liveEffectsEnable.checked = !!state.liveEffectsEnabled;
    }
    if (els.liveEffectsEnableStep6) {
        els.liveEffectsEnableStep6.checked = !!state.liveEffectsEnabled;
    }

    renderLiveEffectsProfileOptions();

    if (els.liveEffectsProfile) {
        els.liveEffectsProfile.disabled = !state.liveEffectsEnabled || state.liveEffectsProfiles.length === 0;
    }
    if (els.liveEffectsProfileStep6) {
        els.liveEffectsProfileStep6.disabled = !state.liveEffectsEnabled || state.liveEffectsProfiles.length === 0;
    }

    const liveEffectsHintText = state.liveEffectsEnabled
        ? t(
            'recording_wizard.step1.live_effects_hint_enabled',
            'Secili profil bu oturuma baglanir. Profil ayarlarini istediginiz zaman efekt panelinden guncelleyebilirsiniz.'
        )
        : t(
            'recording_wizard.step1.live_effects_hint_disabled',
            'Bu ozellik kapaliyken kayit normal sekilde devam eder. Acarsaniz oturum icin bir efekt profili baglanir.'
        );
    if (els.liveEffectsHint) {
        els.liveEffectsHint.textContent = liveEffectsHintText;
    }
    if (els.liveEffectsHintStep6) {
        els.liveEffectsHintStep6.textContent = liveEffectsHintText;
    }

    updateLiveEffectsSummary();
}

async function loadLiveEffectsProfiles({ announceResult = false } = {}) {
    if (els.liveEffectsHint) {
        els.liveEffectsHint.textContent = t(
            'recording_wizard.step1.live_effects_loading',
            'Efekt profilleri yukleniyor...'
        );
    }
    if (els.liveEffectsHintStep6) {
        els.liveEffectsHintStep6.textContent = t(
            'recording_wizard.step1.live_effects_loading',
            'Efekt profilleri yukleniyor...'
        );
    }

    const response = await ipcRenderer.invoke('live-effects-get-state');
    if (!response || !response.success) {
        throw new Error((response && response.error) || 'live-effects-get-state failed');
    }

    state.liveEffectsProfiles = Array.isArray(response.state && response.state.profiles)
        ? response.state.profiles
        : [];

    if (!state.liveEffectsProfileId || !state.liveEffectsProfiles.some((profile) => profile.id === state.liveEffectsProfileId)) {
        state.liveEffectsProfileId = response.state ? response.state.activeProfileId : null;
    }

    stopAllLiveEffectsAudio();
    state.liveEffectsPlayers = {};
    state.activeLiveEffectSlotId = null;
    updateLiveEffectsUi();

    if (announceResult) {
        announce(t('recording_wizard.step1.live_effects_profiles_refreshed', 'Efekt profilleri yenilendi.'));
    }
}

function openLiveEffectsPanelFromWizard() {
    ipcRenderer.send('open-live-effects-panel');
    announce(t('recording_wizard.step1.live_effects_panel_opened', 'Canli efekt paneli acildi.'));
}

function setInterviewWindowFallback() {
    const firstWindow = state.windowSources[0];
    if (!firstWindow) return false;

    setCaptureModeSelection('window');
    if (els.windowSelect) {
        els.windowSelect.value = firstWindow._obs ? firstWindow.id : firstWindow.name;
    }
    state.windowTitle = (firstWindow._obs ? firstWindow.id : firstWindow.name) || '';
    state.selectedWindows = [{
        id: firstWindow.id || firstWindow.name,
        name: firstWindow.name || t('recording_wizard.step3.window_list_fallback', 'Adsiz pencere'),
        sourceValue: (firstWindow._obs ? firstWindow.id : firstWindow.name) || firstWindow.id || firstWindow.name,
        inputName: null,
        sceneItemId: null
    }];
    state.activeWindowIndex = 0;
    syncSelectedWindowControls();
    return true;
}

function isBroadcastLaunchProfile(launchProfile = state.launchProfile) {
    return String(launchProfile || '').startsWith('broadcast');
}

function isOfflinePresetLaunchProfile(launchProfile = state.launchProfile) {
    return String(launchProfile || '').startsWith('offline-');
}

function isYouTubeChatWatchLaunchProfile(launchProfile = state.launchProfile) {
    return String(launchProfile || '') === 'broadcast-chat-watch';
}

function getBroadcastMeetingAppName(launchProfile = state.launchProfile) {
    switch (launchProfile) {
        case 'broadcast-zoom':
        case 'offline-zoom':
            return 'Zoom';
        case 'broadcast-meet':
        case 'offline-meet':
            return 'Google Meet';
        case 'broadcast-teams':
        case 'offline-teams':
            return 'Microsoft Teams';
        default:
            return '';
    }
}

function getBroadcastMeetingWindowMatchers(launchProfile = state.launchProfile) {
    switch (launchProfile) {
        case 'broadcast-zoom':
        case 'offline-zoom':
            return [
                { term: 'zoom meeting', score: 180 },
                { term: 'meeting controls', score: 170 },
                { term: 'toplanti denetimleri', score: 170 },
                { term: 'in meeting', score: 160 },
                { term: 'zoom workplace', score: 80 },
                { term: 'zoom', score: 60 }
            ];
        case 'broadcast-meet':
        case 'offline-meet':
            return [
                { term: 'meet.google.com', score: 180 },
                { term: 'google meet', score: 160 },
                { term: 'meet -', score: 120 },
                { term: 'meeting', score: 90 },
                { term: 'meet -', score: 100 },
                { term: ' meet ', score: 70 }
            ];
        case 'broadcast-teams':
        case 'offline-teams':
            return [
                { term: 'meeting', score: 170 },
                { term: 'call', score: 160 },
                { term: 'meeting | microsoft teams', score: 220 },
                { term: 'call | microsoft teams', score: 210 },
                { term: 'meet | microsoft teams', score: 180 },
                { term: 'microsoft teams', score: 120 },
                { term: ' teams ', score: 90 },
                { term: 'teams', score: 80 }
            ];
        default:
            return [];
    }
}

function findPreferredWindowSourceForLaunchProfile(launchProfile = state.launchProfile) {
    const matchers = getBroadcastMeetingWindowMatchers(launchProfile);
    if (matchers.length === 0 || !Array.isArray(state.windowSources) || state.windowSources.length === 0) {
        return null;
    }

    let bestMatch = null;
    let bestScore = 0;
    state.windowSources.forEach((source) => {
        const haystack = ` ${String(source.name || '').trim().toLowerCase()} ${String(source.id || '').trim().toLowerCase()} `;
        let score = 0;
        matchers.forEach(({ term, score: matcherScore }) => {
            if (haystack.includes(term)) {
                score = Math.max(score, matcherScore);
            }
        });
        if (launchProfile === 'broadcast-zoom' || launchProfile === 'offline-zoom') {
            if (haystack.includes('home') || haystack.includes('anasayfa')) {
                score -= 80;
            }
            if (haystack.includes('workspace') || haystack.includes('workplace')) {
                score -= 20;
            }
        }
        if (launchProfile === 'broadcast-teams' || launchProfile === 'offline-teams') {
            if (haystack.includes('calendar') || haystack.includes('takvim') || haystack.includes('chat')) {
                score -= 60;
            }
            if (haystack.includes('activity') || haystack.includes('etkinlik') || haystack.includes('teams and channels')) {
                score -= 60;
            }
        }
        if (launchProfile === 'broadcast-meet' || launchProfile === 'offline-meet') {
            if (haystack.includes('gmail') || haystack.includes('calendar') || haystack.includes('takvim')) {
                score -= 70;
            }
            if (haystack.includes('google chrome') || haystack.includes('microsoft edge')) {
                score += 10;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestMatch = source;
        }
    });

    return bestScore > 0 ? bestMatch : null;
}

function ensureBroadcastMeetingWindowSelection(launchProfile = state.launchProfile) {
    if (!getBroadcastMeetingAppName(launchProfile)) return null;
    if (state.captureMode === 'window' && Array.isArray(state.selectedWindows) && state.selectedWindows.length > 0) {
        return state.selectedWindows[0];
    }

    const matchedWindow = findPreferredWindowSourceForLaunchProfile(launchProfile);
    if (!matchedWindow) return null;

    selectWindowSourceForCapture(matchedWindow);
    return matchedWindow;
}

function selectWindowSourceForCapture(windowSource) {
    if (!windowSource) return false;

    const sourceValue = getWindowSourceValue(windowSource) || windowSource.id || windowSource.name || '';
    setCaptureModeSelection('window');
    if (els.windowSelect) {
        els.windowSelect.value = sourceValue;
    }
    state.windowTitle = sourceValue;
    state.selectedWindows = [{
        id: windowSource.id || windowSource.name,
        name: windowSource.name || t('recording_wizard.step3.window_list_fallback', 'Adsiz pencere'),
        sourceValue,
        inputName: null,
        sceneItemId: null
    }];
    state.activeWindowIndex = 0;
    syncSelectedWindowControls();
    return true;
}

function isOwnAppWindowSourceName(windowName) {
    const normalizedName = String(windowName || '').trim().toLowerCase();
    if (!normalizedName) return false;

    return [
        'korculvideoeditor',
        'erişilebilir video kayıt sihirbazı',
        'erisilebilir video kayit sihirbazi',
        'erişilebilir kayıt sihirbazı',
        'erisilebilir kayit sihirbazi',
        'accessible recording wizard'
    ].some((term) => normalizedName.includes(term));
}

function isQuickStartLaunchProfile() {
    return state.launchProfile === 'interview' || isBroadcastLaunchProfile() || isOfflinePresetLaunchProfile();
}

function isBroadcastQuickStartProfile() {
    return isBroadcastLaunchProfile();
}

function getSuggestedQuickStartStep() {
    if (isYouTubeChatWatchLaunchProfile()) {
        return 5;
    }

    if (!isQuickStartLaunchProfile() || state.interviewQuickStartCompleted) {
        return 0;
    }

    if (!state.obsFound || !state.obsConnected) {
        return 1;
    }

    if (isBroadcastQuickStartProfile()) {
        return 2;
    }

    return 0;
}

function showLiveEffectsTooltip(message) {
    showShortcutTooltip(message, { speak: false });
}

function applyLaunchProfile() {
    const launchProfile = pendingLaunchOptions && pendingLaunchOptions.launchProfile
        ? pendingLaunchOptions.launchProfile
        : 'default';

    state.launchProfile = launchProfile;

    if (!(launchProfile === 'interview' || isBroadcastLaunchProfile(launchProfile) || isOfflinePresetLaunchProfile(launchProfile))) {
        state.interviewQuickStartCompleted = false;
        if (els.interviewQuickstartNote) els.interviewQuickstartNote.style.display = 'none';
        if (els.interviewQuickstartActions) els.interviewQuickstartActions.style.display = 'none';
        if (els.interviewQuickstartHint) els.interviewQuickstartHint.style.display = 'none';
        updateLiveEffectsUi();
        updateSourceVisibility();
        updateNextState();
        return;
    }

    const isBroadcastProfile = isBroadcastLaunchProfile(launchProfile);
    const isOfflinePresetProfile = isOfflinePresetLaunchProfile(launchProfile);
    const isChatWatchProfile = isYouTubeChatWatchLaunchProfile(launchProfile);
    const meetingAppName = getBroadcastMeetingAppName(launchProfile);

    state.mode = isBroadcastProfile ? 'broadcast' : 'record';
    state.youtubeChatWatchMode = isChatWatchProfile;
    if (isChatWatchProfile) {
        state.broadcastPlatform = 'youtube';
        state.youtubeStreamMethod = 'api';
    }
    state.interviewQuickStartCompleted = false;
    if (els.modeRecord) els.modeRecord.checked = !isBroadcastProfile;
    if (els.modeBroadcast) els.modeBroadcast.checked = isBroadcastProfile;
    if (els.broadcastPlatform) els.broadcastPlatform.value = state.broadcastPlatform;
    if (els.youtubeStreamMethod) els.youtubeStreamMethod.value = state.youtubeStreamMethod;
    if (els.interviewQuickstartActions) {
        els.interviewQuickstartActions.style.display = launchProfile === 'interview' ? 'flex' : 'none';
    }
    if (els.interviewQuickstartHint) {
        els.interviewQuickstartHint.style.display = launchProfile === 'interview' ? 'block' : 'none';
    }

    setRecordingFormatSelection((isBroadcastProfile || isOfflinePresetProfile) ? 'mp4' : 'mkv');
    setVideoQualityPresetSelection(state.videoQualityPreset || 'current');

    state.cameraEnabled = (isBroadcastProfile || isOfflinePresetProfile) && !isChatWatchProfile && !!state.hasCameraDevices;
    if (els.cameraEnable) els.cameraEnable.checked = state.cameraEnabled;

    state.systemAudioEnabled = !isChatWatchProfile;
    state.systemAudioMode = meetingAppName ? 'window' : 'system';
    state.systemAudioWindowTarget = '';
    if (els.systemAudioEnable) els.systemAudioEnable.checked = state.systemAudioEnabled;
    if (els.systemVolume) els.systemVolume.disabled = !state.systemAudioEnabled;
    syncSystemAudioModeUi();

    state.selectedWindows = [];
    state.activeWindowIndex = 0;

    let statusKey = (isBroadcastProfile || isOfflinePresetProfile)
        ? (state.cameraEnabled
            ? (isBroadcastProfile ? 'recording_wizard.status.broadcast_defaults_loaded' : 'recording_wizard.status.offline_defaults_loaded')
            : (isBroadcastProfile ? 'recording_wizard.status.broadcast_defaults_loaded_no_camera' : 'recording_wizard.status.offline_defaults_loaded_no_camera'))
        : 'recording_wizard.status.interview_defaults_loaded';
    let statusFallback = (isBroadcastProfile || isOfflinePresetProfile)
        ? (state.cameraEnabled
            ? (isBroadcastProfile
                ? 'Canlı yayın ön ayarı yüklendi. Varsayılan olarak tam ekran, kamera, mikrofon, sistem sesi, MP4 ve canlı yayın modu seçildi. İsterseniz değiştirebilirsiniz.'
                : 'Çevrim dışı önayar yüklendi. Varsayılan olarak tam ekran, kamera, mikrofon, sistem sesi, MP4 ve çevrim dışı kayıt modu seçildi. İsterseniz değiştirebilirsiniz.')
            : (isBroadcastProfile
                ? 'Canlı yayın ön ayarı yüklendi. Varsayılan olarak tam ekran, mikrofon, sistem sesi, MP4 ve canlı yayın modu seçildi. İsterseniz değiştirebilirsiniz.'
                : 'Çevrim dışı önayar yüklendi. Varsayılan olarak tam ekran, mikrofon, sistem sesi, MP4 ve çevrim dışı kayıt modu seçildi. İsterseniz değiştirebilirsiniz.'))
        : 'Röportaj kaydı ön ayarı yüklendi. Varsayılan olarak tam ekran, mikrofon, sistem sesi ve MKV seçildi. İsterseniz değiştirebilirsiniz.';

    if (isChatWatchProfile) {
        state.captureMode = 'screen';
        state.selectedWindows = [];
        state.activeWindowIndex = 0;
        statusKey = 'recording_wizard.status.youtube_chat_watch_loaded';
        statusFallback = 'YouTube sohbet izleme modu açıldı. Bir yayın bağlantısı yapıştırıp sohbeti bağlayabilirsiniz.';
    } else if (meetingAppName) {
        setCaptureModeSelection('window');
        const matchedWindow = ensureBroadcastMeetingWindowSelection(launchProfile);
        if (matchedWindow) {
            statusKey = state.cameraEnabled
                ? (isBroadcastProfile ? 'recording_wizard.status.broadcast_meeting_defaults_loaded' : 'recording_wizard.status.offline_meeting_defaults_loaded')
                : (isBroadcastProfile ? 'recording_wizard.status.broadcast_meeting_defaults_loaded_no_camera' : 'recording_wizard.status.offline_meeting_defaults_loaded_no_camera');
            statusFallback = state.cameraEnabled
                ? (isBroadcastProfile
                    ? 'Canlı yayın ön ayarı yüklendi. {app} toplantı penceresi seçildi. Kamera, mikrofon, sistem sesi, MP4 ve canlı yayın modu hazır. İsterseniz değiştirebilirsiniz.'
                    : 'Çevrim dışı önayar yüklendi. {app} toplantı penceresi seçildi. Kamera, mikrofon, sistem sesi, MP4 ve çevrim dışı kayıt modu hazır. İsterseniz değiştirebilirsiniz.')
                : (isBroadcastProfile
                    ? 'Canlı yayın ön ayarı yüklendi. {app} toplantı penceresi seçildi. Mikrofon, sistem sesi, MP4 ve canlı yayın modu hazır. İsterseniz değiştirebilirsiniz.'
                    : 'Çevrim dışı önayar yüklendi. {app} toplantı penceresi seçildi. Mikrofon, sistem sesi, MP4 ve çevrim dışı kayıt modu hazır. İsterseniz değiştirebilirsiniz.');
        } else {
            state.selectedWindows = [];
            state.activeWindowIndex = 0;
            state.windowTitle = els.windowSelect ? (els.windowSelect.value || '') : '';
            syncSelectedWindowControls();
            statusKey = isBroadcastProfile
                ? 'recording_wizard.status.broadcast_meeting_window_missing'
                : 'recording_wizard.status.offline_meeting_window_missing';
            statusFallback = isBroadcastProfile
                ? 'Canlı yayın ön ayarı yüklendi ancak {app} toplantı penceresi bulunamadı. Güvenlik için tam ekran seçilmedi. Lütfen pencere listesinden doğru toplantı penceresini ekleyin.'
                : 'Çevrim dışı önayar yüklendi ancak {app} toplantı penceresi bulunamadı. Güvenlik için tam ekran seçilmedi. Lütfen pencere listesinden doğru toplantı penceresini ekleyin.';
        }
    } else if (state.screenSources.length > 0) {
        setCaptureModeSelection('screen');
        if (els.screenSelect) els.screenSelect.value = '0';
        state.screenIndex = 0;
    } else if (setInterviewWindowFallback()) {
        statusKey = isBroadcastProfile
            ? 'recording_wizard.status.broadcast_window_fallback'
            : 'recording_wizard.status.interview_window_fallback';
        statusFallback = isBroadcastProfile
            ? 'Canlı yayın ön ayarı yüklendi. Ekran bulunamadığı için ilk pencere seçildi. İsterseniz değiştirebilirsiniz.'
            : 'Röportaj kaydı ön ayarı yüklendi. Ekran bulunamadığı için ilk pencere seçildi. İsterseniz değiştirebilirsiniz.';
    }

    syncSelectedWindowControls();
    updateBroadcastUi();
    updateSourceVisibility();
    updateLiveEffectsUi();
    updateNextState();

    if (recordingWizardReady && Array.isArray(els.steps) && els.steps.length > 0) {
        if (isChatWatchProfile) {
            showStep(5);
        } else {
            const suggestedStep = getSuggestedQuickStartStep();
            if (suggestedStep > state.stepIndex) {
                showStep(suggestedStep);
            }
        }
    }

    const statusText = t(statusKey, statusFallback, meetingAppName ? { app: meetingAppName } : {});
    if (els.sourceStatus) els.sourceStatus.textContent = statusText;
    if (jsStatus) jsStatus.textContent = statusText;
    announce(statusText);
}

async function tryInterviewQuickStart() {
    if (isYouTubeChatWatchLaunchProfile()) {
        return false;
    }
    logRecordingWizard('interview_quickstart_attempt', {
        attemptedBefore: interviewQuickStartAttempted,
        screenCount: state.screenSources.length,
        windowCount: state.windowSources.length
    });
    if (!isQuickStartLaunchProfile() || interviewQuickStartAttempted) return false;
    interviewQuickStartAttempted = true;

    if (!state.obsFound || !state.obsConnected) {
        logRecordingWizard('interview_quickstart_blocked_connection');
        interviewQuickStartAttempted = false;
        return false;
    }

    if (!state.screenSources.length && !state.windowSources.length) {
        logRecordingWizard('interview_quickstart_blocked_sources');
        interviewQuickStartAttempted = false;
        return false;
    }

    const preparingText = t(
        'recording_wizard.status.interview_quickstart_preparing',
        'Röportaj kaydı için varsayılan kaynaklar hazırlanıyor...'
    );
    if (els.sourceStatus) els.sourceStatus.textContent = preparingText;
    if (jsStatus) jsStatus.textContent = preparingText;
    announce(preparingText);

    try {
        const meetingAppName = getBroadcastMeetingAppName();
        ensureBroadcastMeetingWindowSelection();
        if (meetingAppName && (state.captureMode !== 'window' || state.selectedWindows.length === 0)) {
            const missingWindowText = t(
                'recording_wizard.status.broadcast_meeting_quickstart_blocked',
                '{app} toplantı penceresi otomatik bulunamadığı için hızlı başlangıç tamamlanmadı. Lütfen pencere listesinden doğru toplantı penceresini seçip yeniden deneyin.',
                { app: meetingAppName }
            );
            if (els.sourceStatus) els.sourceStatus.textContent = missingWindowText;
            if (jsStatus) jsStatus.textContent = missingWindowText;
            announce(missingWindowText);
            interviewQuickStartAttempted = false;
            return false;
        }

        const result = await setupObsSources();
        if (!result.success) {
            logRecordingWizard('interview_quickstart_setup_failed', {
                error: result.error || 'unknown_setup_error'
            });
            throw new Error(result.error || t('recording_wizard.unknown_error', 'Unknown error'));
        }

        await applySelectedPreset('fullscreen');
        logRecordingWizard('interview_quickstart_success', {
            screenItemId: state.screenItemId,
            cameraItemId: state.cameraItemId,
            systemInputName: state.systemInputName,
            micInputName: state.micInputName
        });

        state.interviewQuickStartCompleted = true;
        if (els.interviewQuickstartNote) {
            els.interviewQuickstartNote.style.display = 'block';
            els.interviewQuickstartNote.textContent = isBroadcastQuickStartProfile()
                ? t(
                    'recording_wizard.step6.broadcast_quickstart_note',
                    'Canlı yayın ön ayarıyla doğrudan bu adıma geldiniz. Yayın ayarlarını değiştirmek isterseniz Geri düğmesini, oturum sırasında küçük değişiklikler için Canlı Ayarlar bölümünü kullanın.'
                )
                : t(
                    'recording_wizard.step6.interview_quickstart_note',
                    'Röportaj kaydı ön ayarıyla doğrudan bu adıma geldiniz. Ayarları değiştirmek isterseniz Geri düğmesini, kayıt sırasında küçük değişiklikler için Canlı Ayarlar bölümünü kullanın.'
                );
        }
        if (els.liveSettingsPanel) {
            els.liveSettingsPanel.open = true;
        }

        const liveSystemAudioCheck = document.getElementById('live-system-audio-check');
        if (liveSystemAudioCheck) {
            liveSystemAudioCheck.checked = !!state.systemInputName;
        }

        const readyText = t(
            isBroadcastQuickStartProfile()
                ? 'recording_wizard.status.broadcast_quickstart_ready'
                : 'recording_wizard.status.interview_quickstart_ready',
            isBroadcastQuickStartProfile()
                ? 'Canlı yayın ön ayarı hazır. İsterseniz yayını hemen başlatabilir veya Geri ile ayarları değiştirebilirsiniz.'
                : 'Röportaj kaydı hazır. İsterseniz kaydı hemen başlatabilir veya Geri ile ayarları değiştirebilirsiniz.'
        );
        if (els.recordingStatus) els.recordingStatus.textContent = readyText;
        if (els.sourceStatus) els.sourceStatus.textContent = readyText;
        if (jsStatus) jsStatus.textContent = readyText;

        showStep(els.steps.length - 1);
        announce(readyText);
        return true;
    } catch (error) {
        interviewQuickStartAttempted = false;
        state.interviewQuickStartCompleted = false;
        logRecordingWizard('interview_quickstart_exception', {
            error: error.message
        });
        const fallbackText = t(
            isBroadcastQuickStartProfile()
                ? 'recording_wizard.status.broadcast_quickstart_failed'
                : 'recording_wizard.status.interview_quickstart_failed',
            isBroadcastQuickStartProfile()
                ? 'Canlı yayın hızlı başlangıcı tamamlanamadı: {error}. Ayarları adım adım gözden geçirebilirsiniz.'
                : 'Röportaj hızlı başlangıcı tamamlanamadı: {error}. Ayarları adım adım gözden geçirebilirsiniz.',
            { error: error.message }
        );
        if (els.sourceStatus) els.sourceStatus.textContent = fallbackText;
        if (jsStatus) jsStatus.textContent = fallbackText;
        announce(fallbackText);
        return false;
    }
}

function advanceInterviewProfileIfNeeded() {
    if (!isQuickStartLaunchProfile() || state.interviewQuickStartCompleted) return;
    if (isYouTubeChatWatchLaunchProfile()) return;

    if (state.obsFound && !state.obsConnected) {
        logRecordingWizard('interview_profile_needs_connection');
        showStep(1);
        const connectText = t(
            isBroadcastQuickStartProfile()
                ? 'recording_wizard.status.broadcast_connection_required'
                : 'recording_wizard.status.interview_connection_required',
            isBroadcastQuickStartProfile()
                ? 'OBS bulundu ancak baglanti henuz kurulmadigi icin canli yayin hizli baslangici yapilamadi. Bu adimda Baglantiyi test et diyerek devam edebilirsiniz.'
                : 'OBS bulundu ancak baglanti henuz kurulmadigi icin hizli baslangic yapilamadi. Bu adimda Baglantiyi test et diyerek devam edebilirsiniz.'
        );
        if (els.obsConnStatus) {
            els.obsConnStatus.textContent = connectText;
        }
        if (jsStatus) {
            jsStatus.textContent = connectText;
        }
        announce(connectText);
        return;
    }

    if (!state.obsFound) {
        logRecordingWizard('interview_profile_obs_not_found');
        showStep(1);
    }
}

async function continueQuickStartAfterObsReady(reason = 'obs_connection_ready') {
    if (!isQuickStartLaunchProfile() || isYouTubeChatWatchLaunchProfile() || state.interviewQuickStartCompleted) {
        return;
    }

    const currentStep = Number.isFinite(state.stepIndex) ? state.stepIndex : 0;
    const suggestedStep = getSuggestedQuickStartStep();
    logRecordingWizard('interview_quickstart_post_connect_check', {
        reason,
        currentStep,
        suggestedStep,
        obsFound: !!state.obsFound,
        obsConnected: !!state.obsConnected
    });

    if (!state.obsFound || !state.obsConnected) {
        advanceInterviewProfileIfNeeded();
        return;
    }

    if (suggestedStep > currentStep) {
        showStep(suggestedStep);
    }

    if (currentStep <= 1 || suggestedStep >= 2) {
        const success = await tryInterviewQuickStart();
        if (!success) {
            advanceInterviewProfileIfNeeded();
        }
    }
}

async function handleInterviewQuickstartClick() {
    logRecordingWizard('interview_quickstart_button_clicked');
    const success = await tryInterviewQuickStart();
    if (!success) {
        logRecordingWizard('interview_quickstart_button_noop');
        advanceInterviewProfileIfNeeded();
    }
}

function getDefaultBroadcastServer(platform) {
    if (platform === 'youtube') {
        return 'rtmps://a.rtmps.youtube.com/live2';
    }
    return '';
}

function normalizeBroadcastServerUrl(url) {
    return String(url || '')
        .trim()
        .toLowerCase()
        .replace(/\/+$/, '');
}

function getYouTubeCommonServerLabel(serverUrl) {
    const normalized = normalizeBroadcastServerUrl(serverUrl);
    const serverMap = new Map([
        ['rtmps://a.rtmps.youtube.com/live2', 'Primary YouTube ingest server'],
        ['rtmps://a.rtmps.youtube.com:443/live2', 'Primary YouTube ingest server'],
        ['rtmps://b.rtmps.youtube.com/live2?backup=1', 'Backup YouTube ingest server'],
        ['rtmps://b.rtmps.youtube.com:443/live2?backup=1', 'Backup YouTube ingest server']
    ]);
    return serverMap.get(normalized) || null;
}

function isYouTubeApiMode() {
    return state.broadcastPlatform === 'youtube' && state.youtubeStreamMethod === 'api';
}

function isYouTubePlanningOnlyMode() {
    return isYouTubeApiMode() && state.youtubeApiMode === 'planned';
}

function toLocalDateTimeInputValue(date) {
    const localDate = date instanceof Date ? date : new Date(date);
    const year = localDate.getFullYear();
    const month = String(localDate.getMonth() + 1).padStart(2, '0');
    const day = String(localDate.getDate()).padStart(2, '0');
    const hours = String(localDate.getHours()).padStart(2, '0');
    const minutes = String(localDate.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function localInputToIso(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function formatBroadcastOptionLabel(item) {
    if (!item) return '';
    const scheduledText = item.scheduledStartTime
        ? new Date(item.scheduledStartTime).toLocaleString()
        : t('recording_wizard.broadcast.youtube_schedule_unknown', 'Saat belirtilmedi');
    return `${item.title || t('recording_wizard.broadcast.youtube_untitled', 'Adsiz yayin')} | ${scheduledText} | ${item.privacyStatus || '-'} | ${item.lifeCycleStatus || '-'}`;
}

function updateYouTubeBroadcastModeUi() {
    if (isYouTubeChatWatchLaunchProfile()) {
        if (els.youtubeCreateFields) {
            els.youtubeCreateFields.style.display = 'none';
        }
        if (els.youtubePlannedFields) {
            els.youtubePlannedFields.style.display = 'none';
        }
        if (els.youtubeExistingFields) {
            els.youtubeExistingFields.style.display = 'none';
        }
        return;
    }

    const apiMode = state.youtubeApiMode || 'instant';
    const createVisible = apiMode !== 'existing';
    const plannedVisible = apiMode === 'planned';
    const existingVisible = apiMode === 'existing';

    if (els.youtubeCreateFields) {
        els.youtubeCreateFields.style.display = createVisible ? 'block' : 'none';
    }
    if (els.youtubePlannedFields) {
        els.youtubePlannedFields.style.display = plannedVisible ? 'block' : 'none';
    }
    if (els.youtubeExistingFields) {
        els.youtubeExistingFields.style.display = existingVisible ? 'block' : 'none';
    }
}

function updateBroadcastMethodUi() {
    const isYouTube = state.broadcastPlatform === 'youtube';
    const apiMode = isYouTube && state.youtubeStreamMethod === 'api';
    const isChatWatchMode = isYouTubeChatWatchLaunchProfile();

    if (els.youtubeStreamMethodPanel) {
        els.youtubeStreamMethodPanel.style.display = isYouTube && !isChatWatchMode ? 'block' : 'none';
    }
    if (els.youtubeApiPanel) {
        els.youtubeApiPanel.style.display = apiMode ? 'block' : 'none';
    }
    if (els.youtubeChatWatchFields) {
        els.youtubeChatWatchFields.style.display = apiMode && isChatWatchMode ? 'block' : 'none';
    }
    if (els.broadcastManualFields) {
        els.broadcastManualFields.style.display = apiMode || isChatWatchMode ? 'none' : 'block';
    }
    if (els.youtubeApiModeRadios.length > 0) {
        els.youtubeApiModeRadios.forEach((radio) => {
            radio.disabled = isChatWatchMode;
        });
    }

    updateYouTubeBroadcastModeUi();
}

function clearPreparedYouTubeBroadcast() {
    state.youtubePreparedBroadcastId = '';
    state.youtubePreparedBroadcastTitle = '';
    state.youtubePreparedWatchUrl = '';
    state.youtubeModerators = [];
    state.youtubeChatWatchUrl = '';
    state.youtubeLiveChatId = '';
    state.youtubeChatNextPageToken = '';
    ipcRenderer.invoke('youtube-clear-active-live-broadcast').catch(() => { });
    updatePreparedYouTubeWatchLink();
    updateBroadcastUi();
}

function getYouTubeModeratorErrorText(response = {}) {
    const errorCode = String(response?.errorCode || '').trim().toLowerCase();
    if (errorCode === 'youtube_channel_email_not_supported') {
        return t(
            'recording_wizard.broadcast.youtube_moderator_email_not_supported',
            'E-posta adresi kullanılamaz. Kanal bağlantısı, @kullanıcı adı veya kanal kimliği girin.'
        );
    }
    return response?.error || t('recording_wizard.unknown_error', 'Unknown error');
}

function formatYouTubeBroadcastSetupError(response = {}) {
    const code = String(response.code || response.reason || '').trim().toLowerCase();
    const errorText = String(response.error || '').trim();
    const normalizedError = errorText.toLowerCase();

    if (code === 'invalidtitle' || normalizedError.includes('title is invalid')) {
        return t(
            'recording_wizard.broadcast.youtube_create_failed_invalid_title',
            'Yayın başlığı YouTube için uygun değil. Başlığı biraz kısaltıp özel karakterleri sadeleştirerek tekrar deneyin.'
        );
    }

    if (
        code === 'invalidscheduledstarttime'
        || code === 'invalidvalue'
        || normalizedError.includes('scheduled start time')
        || normalizedError.includes('start time')
        || normalizedError.includes('must be in the future')
        || normalizedError.includes('cannot be in the past')
    ) {
        return t(
            'recording_wizard.broadcast.youtube_create_failed_invalid_schedule',
            'Planlanan yayın zamanı geçersiz görünüyor. Lütfen gelecekte bir tarih ve saat seçip tekrar deneyin.'
        );
    }

    if (code === 'quotaexceeded' || code === 'dailylimitexceeded' || normalizedError.includes('quota')) {
        return t(
            'recording_wizard.broadcast.youtube_create_failed_quota',
            'YouTube API kullanım sınırına ulaşıldı. Bir süre sonra tekrar deneyin.'
        );
    }

    if (code === 'livestreamingnotenabled' || normalizedError.includes('live streaming is not enabled')) {
        return t(
            'recording_wizard.broadcast.youtube_create_failed_live_not_enabled',
            'Bu YouTube kanalında canlı yayın özelliği etkin görünmüyor. Kanal ayarlarını kontrol edin.'
        );
    }

    if (code === 'forbidden' || normalizedError.includes('forbidden') || normalizedError.includes('permission')) {
        return t(
            'recording_wizard.broadcast.youtube_create_failed_forbidden',
            'YouTube hesabı bu işlem için izin vermedi. Hesap yetkilerini ve kanal durumunu kontrol edin.'
        );
    }

    if (normalizedError.includes('broadcast') && normalizedError.includes('not found')) {
        return t(
            'recording_wizard.broadcast.youtube_broadcast_not_found',
            'Seçilen YouTube yayını bulunamadı. Listeyi yenileyip tekrar seçin.'
        );
    }

    return errorText || t('recording_wizard.broadcast.youtube_create_failed', 'YouTube yayını oluşturulamadı.');
}

function formatYouTubeModeratorSummaryLine(item = {}) {
    const displayName = String(item.displayName || '').trim();
    const channelId = String(item.channelId || '').trim();
    if (displayName && channelId) {
        return `${displayName} (${channelId})`;
    }
    return displayName || channelId || t('recording_wizard.broadcast.youtube_moderator_unknown', 'Bilinmeyen moderatör');
}

function populateYouTubeModeratorList() {
    if (!els.youtubeModeratorList) {
        return;
    }

    const previousValue = String(els.youtubeModeratorList.value || '').trim();
    els.youtubeModeratorList.innerHTML = '';

    const moderators = Array.isArray(state.youtubeModerators) ? state.youtubeModerators : [];
    if (moderators.length === 0) {
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = t('recording_wizard.broadcast.youtube_moderator_empty', 'Henüz moderatör eklenmedi.');
        emptyOption.disabled = true;
        emptyOption.selected = true;
        els.youtubeModeratorList.appendChild(emptyOption);
        return;
    }

    moderators.forEach((item) => {
        const option = document.createElement('option');
        option.value = String(item.id || item.channelId || '').trim();
        option.textContent = formatYouTubeModeratorSummaryLine(item);
        els.youtubeModeratorList.appendChild(option);
    });

    const restoredValue = moderators.some((item) => String(item.id || item.channelId || '').trim() === previousValue)
        ? previousValue
        : String(moderators[0]?.id || moderators[0]?.channelId || '').trim();
    els.youtubeModeratorList.value = restoredValue;
}

function updateYouTubeModeratorUi() {
    const visible = state.mode === 'broadcast'
        && state.broadcastPlatform === 'youtube'
        && isYouTubeApiMode()
        && !isYouTubeChatWatchLaunchProfile()
        && !!(state.youtubePreparedBroadcastId || (state.youtubeApiMode === 'existing' && state.youtubeSelectedBroadcastId));
    if (els.youtubeModeratorPanel) {
        els.youtubeModeratorPanel.style.display = visible ? 'block' : 'none';
    }
    if (!visible) {
        return;
    }

    const canManage = !!state.youtubeConnected && !!state.youtubeLiveChatId;
    if (els.youtubeModeratorInput) {
        els.youtubeModeratorInput.disabled = !canManage;
    }
    if (els.btnYoutubeAddModerator) {
        els.btnYoutubeAddModerator.disabled = !canManage;
    }
    if (els.btnYoutubeRefreshModerators) {
        els.btnYoutubeRefreshModerators.disabled = !canManage;
    }
    populateYouTubeModeratorList();
    if (els.youtubeModeratorList) {
        els.youtubeModeratorList.disabled = !canManage || (state.youtubeModerators || []).length === 0;
    }
    if (els.btnYoutubeRemoveModerator) {
        els.btnYoutubeRemoveModerator.disabled = !canManage || (state.youtubeModerators || []).length === 0;
    }
    if (els.youtubeModeratorSummary) {
        const lines = (state.youtubeModerators || []).map(formatYouTubeModeratorSummaryLine);
        els.youtubeModeratorSummary.value = canManage
            ? (lines.length > 0
                ? lines.join('\n')
                : t('recording_wizard.broadcast.youtube_moderator_empty', 'Henüz moderatör eklenmedi.'))
            : t('recording_wizard.broadcast.youtube_moderator_unavailable', 'Moderatör eklemek için önce YouTube hesabını bağlayın ve yayını hazırlayın.');
    }
}

async function refreshYouTubeModerators(options = {}) {
    if (!state.youtubeConnected || !state.youtubeLiveChatId) {
        if (!state.youtubeLiveChatId && state.youtubeConnected && isYouTubeApiMode() && state.youtubeApiMode === 'existing' && state.youtubeSelectedBroadcastId) {
            try {
                await prepareYouTubeBroadcastFromApi();
            } catch (error) {
                if (!options.silent) {
                    syncYoutubeStatusText('recording_wizard.broadcast.youtube_moderator_need_prepared', 'Önce yayını hazırlayın veya planlayın.');
                }
            }
        }
    }

    if (!state.youtubeConnected || !state.youtubeLiveChatId) {
        state.youtubeModerators = [];
        updateYouTubeModeratorUi();
        logRecordingWizard('youtube_moderator_list_skipped', {
            youtubeConnected: !!state.youtubeConnected,
            hasLiveChatId: !!state.youtubeLiveChatId,
            preparedBroadcastId: state.youtubePreparedBroadcastId || null
        });
        return;
    }

    logRecordingWizard('youtube_moderator_list_requested', {
        liveChatId: state.youtubeLiveChatId || null,
        preparedBroadcastId: state.youtubePreparedBroadcastId || null
    });
    const response = await ipcRenderer.invoke('youtube-list-live-chat-moderators', {
        liveChatId: state.youtubeLiveChatId
    });

    if (!response.success) {
        state.youtubeModerators = [];
        updateYouTubeModeratorUi();
        logRecordingWizard('youtube_moderator_list_failed', {
            liveChatId: state.youtubeLiveChatId || null,
            preparedBroadcastId: state.youtubePreparedBroadcastId || null,
            error: response.error || null
        });
        if (!options.silent) {
            syncYoutubeStatusText('recording_wizard.broadcast.youtube_moderator_list_failed', 'Moderatör listesi alınamadı: {error}', {
                error: response.error || t('recording_wizard.unknown_error', 'Unknown error')
            });
            showShortcutTooltip(t('recording_wizard.broadcast.youtube_moderator_list_failed', 'Moderatör listesi alınamadı: {error}', {
                error: response.error || t('recording_wizard.unknown_error', 'Unknown error')
            }));
        }
        return;
    }

    state.youtubeModerators = Array.isArray(response.moderators) ? response.moderators : [];
    updateYouTubeModeratorUi();
    logRecordingWizard('youtube_moderator_list_succeeded', {
        liveChatId: state.youtubeLiveChatId || null,
        preparedBroadcastId: state.youtubePreparedBroadcastId || null,
        moderatorCount: state.youtubeModerators.length
    });
    if (!options.silent) {
        syncYoutubeStatusText('recording_wizard.broadcast.youtube_moderator_list_loaded', 'Moderatör listesi güncellendi.');
        announce(t('recording_wizard.broadcast.youtube_moderator_list_loaded', 'Moderatör listesi güncellendi.'));
    }
}

async function addYouTubeModerator() {
    if (!state.youtubeConnected) {
        syncYoutubeStatusText('recording_wizard.broadcast.youtube_auth_required', 'Öncelikle YouTube hesabınızı bağlayın.');
        showShortcutTooltip(t('recording_wizard.broadcast.youtube_auth_required', 'Öncelikle YouTube hesabınızı bağlayın.'));
        return;
    }
    if (!state.youtubeLiveChatId) {
        if (isYouTubeApiMode() && state.youtubeApiMode === 'existing' && state.youtubeSelectedBroadcastId) {
            try {
                await prepareYouTubeBroadcastFromApi();
            } catch (error) {
                syncYoutubeStatusText('recording_wizard.broadcast.youtube_moderator_need_prepared', 'Önce yayını hazırlayın veya planlayın.');
                showShortcutTooltip(t('recording_wizard.broadcast.youtube_moderator_need_prepared', 'Önce yayını hazırlayın veya planlayın.'));
                logRecordingWizard('youtube_moderator_add_blocked_missing_chat', {
                    preparedBroadcastId: state.youtubePreparedBroadcastId || null,
                    youtubeConnected: !!state.youtubeConnected,
                    autoPrepareFailed: true,
                    error: error?.message || String(error)
                });
                return;
            }
        }
        if (!state.youtubeLiveChatId) {
            syncYoutubeStatusText('recording_wizard.broadcast.youtube_moderator_need_prepared', 'Önce yayını hazırlayın veya planlayın.');
            showShortcutTooltip(t('recording_wizard.broadcast.youtube_moderator_need_prepared', 'Önce yayını hazırlayın veya planlayın.'));
            logRecordingWizard('youtube_moderator_add_blocked_missing_chat', {
                preparedBroadcastId: state.youtubePreparedBroadcastId || null,
                youtubeConnected: !!state.youtubeConnected
            });
            return;
        }
    }
    const moderatorValue = String(els.youtubeModeratorInput?.value || '').trim();
    if (!moderatorValue) {
        syncYoutubeStatusText('recording_wizard.broadcast.youtube_moderator_required', 'Moderatör kanal bağlantısını veya kimliğini girin.');
        showShortcutTooltip(t('recording_wizard.broadcast.youtube_moderator_required', 'Moderatör kanal bağlantısını veya kimliğini girin.'));
        return;
    }

    syncYoutubeStatusText('recording_wizard.broadcast.youtube_moderator_adding', 'Moderatör ekleniyor...');
    logRecordingWizard('youtube_moderator_add_requested', {
        preparedBroadcastId: state.youtubePreparedBroadcastId || null,
        liveChatId: state.youtubeLiveChatId || null,
        moderator: moderatorValue
    });
    const response = await ipcRenderer.invoke('youtube-add-live-chat-moderator', {
        liveChatId: state.youtubeLiveChatId,
        moderator: moderatorValue
    });

    if (!response.success) {
        logRecordingWizard('youtube_moderator_add_failed', {
            preparedBroadcastId: state.youtubePreparedBroadcastId || null,
            liveChatId: state.youtubeLiveChatId || null,
            moderator: moderatorValue,
            error: response.error || null,
            errorCode: response.errorCode || null
        });
        syncYoutubeStatusText('recording_wizard.broadcast.youtube_moderator_add_failed', 'Moderatör eklenemedi: {error}', {
            error: getYouTubeModeratorErrorText(response)
        });
        showShortcutTooltip(t('recording_wizard.broadcast.youtube_moderator_add_failed', 'Moderatör eklenemedi: {error}', {
            error: getYouTubeModeratorErrorText(response)
        }));
        return;
    }

    if (els.youtubeModeratorInput) {
        els.youtubeModeratorInput.value = '';
    }
    await refreshYouTubeModerators({ silent: true });
    const moderatorName = response.moderator?.displayName || response.moderator?.channelId || t('recording_wizard.broadcast.youtube_moderator_unknown', 'Bilinmeyen moderatör');
    logRecordingWizard('youtube_moderator_add_succeeded', {
        preparedBroadcastId: state.youtubePreparedBroadcastId || null,
        liveChatId: state.youtubeLiveChatId || null,
        moderatorName,
        moderatorChannelId: response.moderator?.channelId || null
    });
    syncYoutubeStatusText('recording_wizard.broadcast.youtube_moderator_added', 'Moderatör eklendi: {name}', {
        name: moderatorName
    });
    announce(t('recording_wizard.broadcast.youtube_moderator_added', 'Moderatör eklendi: {name}', {
        name: moderatorName
    }));
}

async function removeYouTubeModerator() {
    if (!state.youtubeConnected) {
        syncYoutubeStatusText('recording_wizard.broadcast.youtube_auth_required', 'Öncelikle YouTube hesabınızı bağlayın.');
        showShortcutTooltip(t('recording_wizard.broadcast.youtube_auth_required', 'Öncelikle YouTube hesabınızı bağlayın.'));
        return;
    }
    if (!state.youtubeLiveChatId) {
        syncYoutubeStatusText('recording_wizard.broadcast.youtube_moderator_need_prepared', 'Önce yayını hazırlayın veya planlayın.');
        showShortcutTooltip(t('recording_wizard.broadcast.youtube_moderator_need_prepared', 'Önce yayını hazırlayın veya planlayın.'));
        return;
    }

    const moderatorId = String(els.youtubeModeratorList?.value || '').trim();
    const moderator = (state.youtubeModerators || []).find((item) => String(item?.id || item?.channelId || '').trim() === moderatorId) || null;
    if (!moderatorId || !moderator) {
        syncYoutubeStatusText('recording_wizard.broadcast.youtube_moderator_remove_required', 'Kaldırmak için listeden bir moderatör seçin.');
        showShortcutTooltip(t('recording_wizard.broadcast.youtube_moderator_remove_required', 'Kaldırmak için listeden bir moderatör seçin.'));
        return;
    }

    const moderatorName = moderator.displayName || moderator.channelId || t('recording_wizard.broadcast.youtube_moderator_unknown', 'Bilinmeyen moderatör');
    syncYoutubeStatusText('recording_wizard.broadcast.youtube_moderator_removing', 'Moderatör kaldırılıyor...');
    logRecordingWizard('youtube_moderator_remove_requested', {
        preparedBroadcastId: state.youtubePreparedBroadcastId || null,
        liveChatId: state.youtubeLiveChatId || null,
        moderatorId,
        moderatorName
    });

    const response = await ipcRenderer.invoke('youtube-remove-live-chat-moderator', {
        moderatorId
    });

    if (!response.success) {
        logRecordingWizard('youtube_moderator_remove_failed', {
            preparedBroadcastId: state.youtubePreparedBroadcastId || null,
            liveChatId: state.youtubeLiveChatId || null,
            moderatorId,
            moderatorName,
            error: response.error || null,
            errorCode: response.errorCode || null
        });
        syncYoutubeStatusText('recording_wizard.broadcast.youtube_moderator_remove_failed', 'Moderatör kaldırılamadı: {error}', {
            error: getYouTubeModeratorErrorText(response)
        });
        showShortcutTooltip(t('recording_wizard.broadcast.youtube_moderator_remove_failed', 'Moderatör kaldırılamadı: {error}', {
            error: getYouTubeModeratorErrorText(response)
        }));
        return;
    }

    await refreshYouTubeModerators({ silent: true });
    logRecordingWizard('youtube_moderator_remove_succeeded', {
        preparedBroadcastId: state.youtubePreparedBroadcastId || null,
        liveChatId: state.youtubeLiveChatId || null,
        moderatorId,
        moderatorName
    });
    syncYoutubeStatusText('recording_wizard.broadcast.youtube_moderator_removed', 'Moderatör kaldırıldı: {name}', {
        name: moderatorName
    });
    announce(t('recording_wizard.broadcast.youtube_moderator_removed', 'Moderatör kaldırıldı: {name}', {
        name: moderatorName
    }));
}

function updatePreparedYouTubeWatchLink() {
    if (els.youtubeWatchLinkPanel) {
        els.youtubeWatchLinkPanel.style.display = state.youtubePreparedWatchUrl ? 'block' : 'none';
    }
    if (els.youtubeWatchLink) {
        els.youtubeWatchLink.value = state.youtubePreparedWatchUrl || '';
    }
    if (els.youtubeChatWatchUrl) {
        els.youtubeChatWatchUrl.value = state.youtubeChatWatchUrl || '';
    }
    if (els.btnYoutubeOpenWatchLink) {
        els.btnYoutubeOpenWatchLink.disabled = !state.youtubePreparedWatchUrl;
    }
    if (els.btnYoutubeCopyWatchLink) {
        els.btnYoutubeCopyWatchLink.disabled = !state.youtubePreparedWatchUrl;
    }

    if (els.youtubeWatchLinkSummaryPanel) {
        els.youtubeWatchLinkSummaryPanel.style.display = state.youtubePreparedWatchUrl ? 'block' : 'none';
    }
    if (els.youtubeWatchLinkSummary) {
        els.youtubeWatchLinkSummary.value = state.youtubePreparedWatchUrl || '';
    }

    if (els.recordingOutput && state.mode === 'broadcast') {
        if (state.youtubePreparedWatchUrl) {
            els.recordingOutput.style.display = 'block';
            els.recordingOutput.textContent = t(
                'recording_wizard.broadcast.watch_link_output',
                'Canli yayin baglantisi: {url}',
                { url: state.youtubePreparedWatchUrl }
            );
        } else {
            els.recordingOutput.style.display = 'none';
        }
    }
    updateYouTubeModeratorUi();
    updateBroadcastErrorSummary();
}

async function ensureSelectedYouTubeBroadcastPrepared(options = {}) {
    if (!isYouTubeApiMode() || state.youtubeApiMode !== 'existing') {
        return false;
    }
    if (!state.youtubeConnected || !state.youtubeSelectedBroadcastId) {
        return false;
    }

    const alreadyPreparedForSelection = state.youtubePreparedBroadcastId
        && state.youtubePreparedBroadcastId === state.youtubeSelectedBroadcastId
        && !!state.youtubePreparedWatchUrl;
    if (alreadyPreparedForSelection) {
        return true;
    }

    try {
        await prepareYouTubeBroadcastFromApi();
        return true;
    } catch (error) {
        if (!options.silent) {
            syncYoutubeStatusText('recording_wizard.broadcast.youtube_prepare_failed', 'Seçilen YouTube yayını hazırlanamadı.');
        }
        return false;
    }
}

function syncYoutubeStatusText(messageKey = 'recording_wizard.broadcast.youtube_broadcast_waiting', fallback = 'YouTube yayin secimi bekleniyor.', params = {}) {
    if (!els.youtubeBroadcastStatus) return;
    els.youtubeBroadcastStatus.textContent = t(messageKey, fallback, params);
}

function updateYouTubeAuthUi() {
    if (els.youtubeOauthSetup) els.youtubeOauthSetup.hidden = state.youtubeClientConfigured;
    if (els.btnYoutubeConnect) els.btnYoutubeConnect.disabled = !state.youtubeClientConfigured;
    if (!els.youtubeAuthStatus) return;
    if (state.youtubeConnected) {
        els.youtubeAuthStatus.textContent = t('recording_wizard.broadcast.youtube_auth_connected', 'YouTube hesabi bagli: {channel}', {
            channel: state.youtubeChannelTitle || t('recording_wizard.broadcast.youtube_channel_unknown', 'Kanal')
        });
    } else if (isYouTubeChatWatchLaunchProfile()) {
        els.youtubeAuthStatus.textContent = t(
            'recording_wizard.broadcast.youtube_auth_optional_chat_watch',
            'YouTube hesabı bağlı değil. URL ile izleme yapabilirsiniz; ancak mesaj gönderme ve moderasyon için hesap bağlamanız gerekir.'
        );
    } else {
        els.youtubeAuthStatus.textContent = t('recording_wizard.broadcast.youtube_auth_waiting', 'YouTube hesabi bagli degil.');
    }

    if (els.btnYoutubeDisconnect) {
        els.btnYoutubeDisconnect.disabled = !state.youtubeActiveAccountId;
    }
}

function populateYouTubeAccountList() {
    if (!els.youtubeAccountSelect) return;

    els.youtubeAccountSelect.innerHTML = '';
    const accounts = state.youtubeAccounts || [];

    if (accounts.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = t('recording_wizard.broadcast.youtube_account_none', 'Bagli YouTube hesabi yok.');
        els.youtubeAccountSelect.appendChild(option);
        els.youtubeAccountSelect.disabled = true;
        return;
    }

    accounts.forEach((account) => {
        const option = document.createElement('option');
        option.value = account.id;
        option.textContent = account.title || t('recording_wizard.broadcast.youtube_channel_unknown', 'Kanal');
        els.youtubeAccountSelect.appendChild(option);
    });

    const selectedAccountId = state.youtubeActiveAccountId && accounts.some((account) => account.id === state.youtubeActiveAccountId)
        ? state.youtubeActiveAccountId
        : accounts[0].id;
    state.youtubeActiveAccountId = selectedAccountId;
    els.youtubeAccountSelect.value = selectedAccountId;
    els.youtubeAccountSelect.disabled = false;
}

function formatPlaylistOptionLabel(item) {
    const title = item.title || t('recording_wizard.broadcast.youtube_playlist_untitled', 'Adsiz oynatma listesi');
    const itemCount = Number(item.itemCount || 0);
    return `${title} (${itemCount})`;
}

function populateYouTubePlaylistList() {
    if (!els.youtubePlaylistSelect) return;

    els.youtubePlaylistSelect.innerHTML = '';
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = t('recording_wizard.broadcast.youtube_playlist_none', 'Oynatma listesi secmeyin');
    els.youtubePlaylistSelect.appendChild(emptyOption);

    const playlists = state.youtubePlaylists || [];
    playlists.forEach((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = formatPlaylistOptionLabel(item);
        els.youtubePlaylistSelect.appendChild(option);
    });

    const selectedPlaylistId = state.youtubeSelectedPlaylistId && playlists.some((item) => item.id === state.youtubeSelectedPlaylistId)
        ? state.youtubeSelectedPlaylistId
        : '';
    state.youtubeSelectedPlaylistId = selectedPlaylistId;
    els.youtubePlaylistSelect.value = selectedPlaylistId;
    els.youtubePlaylistSelect.disabled = !state.youtubeActiveAccountId;
}

function populateYouTubeBroadcastList() {
    if (!els.youtubeExistingBroadcasts) return;
    els.youtubeExistingBroadcasts.innerHTML = '';

    const broadcasts = state.youtubeBroadcasts || [];
    if (broadcasts.length === 0) {
        state.youtubeSelectedBroadcastId = '';
        const option = document.createElement('option');
        option.value = '';
        option.textContent = t('recording_wizard.broadcast.youtube_no_broadcasts', 'Planli YouTube yayini bulunamadi.');
        els.youtubeExistingBroadcasts.appendChild(option);
        return;
    }

    broadcasts.forEach((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = formatBroadcastOptionLabel(item);
        els.youtubeExistingBroadcasts.appendChild(option);
    });

    const selectedId = state.youtubeSelectedBroadcastId && broadcasts.some((item) => item.id === state.youtubeSelectedBroadcastId)
        ? state.youtubeSelectedBroadcastId
        : broadcasts[0].id;
    state.youtubeSelectedBroadcastId = selectedId;
    els.youtubeExistingBroadcasts.value = selectedId;
}

async function loadYouTubeAuthState() {
    const response = await ipcRenderer.invoke('youtube-get-auth-state');
    if (!response.success) {
        state.youtubeClientConfigured = false;
        state.youtubeAccounts = [];
        state.youtubeActiveAccountId = '';
        state.youtubePlaylists = [];
        populateYouTubeAccountList();
        populateYouTubePlaylistList();
        updateYouTubeAuthUi();
        return;
    }

    state.youtubeConnected = !!response.connected;
    state.youtubeClientConfigured = Boolean(String(response.clientId || '').trim());
    state.youtubeAccounts = Array.isArray(response.accounts) ? response.accounts : [];
    state.youtubeActiveAccountId = response.activeAccountId || '';
    state.youtubeChannelTitle = response.channel?.title || '';

    populateYouTubeAccountList();
    populateYouTubePlaylistList();
    updateYouTubeAuthUi();
    updatePreparedYouTubeWatchLink();
    updateYouTubeModeratorUi();
}

async function refreshYouTubePlaylists(options = {}) {
    if (!isYouTubeApiMode() || !state.youtubeConnected || !state.youtubeActiveAccountId) {
        state.youtubePlaylists = [];
        populateYouTubePlaylistList();
        return;
    }

    const response = await ipcRenderer.invoke('youtube-list-playlists');
    if (!response.success) {
        state.youtubePlaylists = [];
        populateYouTubePlaylistList();
        if (!options.silent) {
            syncYoutubeStatusText('recording_wizard.broadcast.youtube_loading_failed', 'YouTube yayin listesi alinamadi: {error}', {
                error: response.error || t('recording_wizard.unknown_error', 'Unknown error')
            });
        }
        return;
    }

    state.youtubePlaylists = response.playlists || [];
    populateYouTubePlaylistList();
}

async function refreshYouTubeBroadcasts(options = {}) {
    if (!isYouTubeApiMode() || !state.youtubeConnected || !state.youtubeActiveAccountId) {
        state.youtubeBroadcasts = [];
        populateYouTubeBroadcastList();
        return;
    }

    syncYoutubeStatusText('recording_wizard.broadcast.youtube_loading_broadcasts', 'Planli YouTube yayinlari getiriliyor...');
    const response = await ipcRenderer.invoke('youtube-list-planned-broadcasts');

    if (!response.success) {
        state.youtubeBroadcasts = [];
        populateYouTubeBroadcastList();
        syncYoutubeStatusText('recording_wizard.broadcast.youtube_loading_failed', 'YouTube yayin listesi alinamadi: {error}', {
            error: response.error || t('recording_wizard.unknown_error', 'Unknown error')
        });
        if (!options.silent) {
            announce(t('recording_wizard.broadcast.youtube_loading_failed_announce', 'YouTube yayin listesi alinamadi.'));
        }
        return;
    }

    state.youtubeBroadcasts = response.broadcasts || [];
    if (!state.youtubeSelectedBroadcastId && state.youtubeBroadcasts[0]) {
        state.youtubeSelectedBroadcastId = state.youtubeBroadcasts[0].id;
    }
    populateYouTubeBroadcastList();

    if (state.youtubeBroadcasts.length > 0) {
        syncYoutubeStatusText('recording_wizard.broadcast.youtube_broadcasts_loaded', 'YouTube planli yayin listesi hazir.');
    } else {
        syncYoutubeStatusText('recording_wizard.broadcast.youtube_no_broadcasts', 'Planli YouTube yayini bulunamadi.');
    }
}

// One-time OAuth setup intentionally has no shortcut-manager action.
async function saveYouTubeClientConfig() {
    const clientId = String(els.youtubeClientId?.value || '').trim();
    const clientSecret = String(els.youtubeClientSecret?.value || '').trim();
    if (!clientId) {
        syncYoutubeStatusText('youtube_oauth_setup.client_id_required', 'YouTube OAuth Client ID gereklidir.');
        els.youtubeClientId?.focus();
        return;
    }
    const response = await ipcRenderer.invoke('youtube-save-client-config', { clientId, clientSecret });
    if (!response?.success) {
        syncYoutubeStatusText('youtube_oauth_setup.save_failed', 'YouTube OAuth bilgileri kaydedilemedi: {error}', { error: response?.error || 'unknown_error' });
        return;
    }
    if (els.youtubeClientSecret) els.youtubeClientSecret.value = '';
    await loadYouTubeAuthState();
    syncYoutubeStatusText('youtube_oauth_setup.saved', 'YouTube OAuth bilgileri kaydedildi. Şimdi YouTube hesabınızı bağlayabilirsiniz.');
    announce(t('youtube_oauth_setup.saved', 'YouTube OAuth bilgileri kaydedildi. Şimdi YouTube hesabınızı bağlayabilirsiniz.'));
    els.btnYoutubeConnect?.focus();
}

async function connectYouTubeAccount() {
    syncYoutubeStatusText('recording_wizard.broadcast.youtube_auth_connecting', 'YouTube baglantisi aciliyor...');
    const response = await ipcRenderer.invoke('youtube-connect-account');
    if (!response.success) {
        updateYouTubeAuthUi();
        syncYoutubeStatusText('recording_wizard.broadcast.youtube_auth_failed', 'YouTube hesabi baglanamadi: {error}', {
            error: response.error || t('recording_wizard.unknown_error', 'Unknown error')
        });
        throw new Error(response.error || t('recording_wizard.broadcast.youtube_auth_failed_generic', 'YouTube hesabi baglanamadi.'));
    }

    await loadYouTubeAuthState();
    syncYoutubeStatusText('recording_wizard.broadcast.youtube_auth_connected_short', 'YouTube hesabi baglandi.');
    await refreshYouTubePlaylists({ silent: true });
    await refreshYouTubeBroadcasts({ silent: true });
}

async function connectYouTubeChatWatch() {
    state.youtubeChatWatchUrl = String(els.youtubeChatWatchUrl?.value || '').trim();
    logRecordingWizard('youtube_chat_watch_connect_requested', {
        urlPresent: !!state.youtubeChatWatchUrl,
        youtubeConnected: !!state.youtubeConnected
    });
    if (!state.youtubeChatWatchUrl) {
        syncYoutubeStatusText('recording_wizard.broadcast.youtube_chat_watch_url_required', 'Önce bir YouTube canlı yayın bağlantısı girin.');
        logRecordingWizard('youtube_chat_watch_connect_blocked_missing_url');
        return;
    }

    resetYouTubeChatState();
    state.youtubePreparedBroadcastTitle = '';
    state.youtubePreparedWatchUrl = '';
    updatePreparedYouTubeWatchLink();
    syncYoutubeStatusText(
        state.youtubeConnected
            ? 'recording_wizard.broadcast.youtube_chat_watch_loading'
            : 'recording_wizard.broadcast.youtube_chat_watch_loading_public',
        state.youtubeConnected
            ? 'Canlı sohbet bağlantısı hazırlanıyor...'
            : 'Canlı sohbet bağlantısı hesap olmadan okunabilir modda hazırlanıyor...'
    );

    const loaded = await ensureYouTubeChatSessionLoaded();
    if (!loaded) {
        logRecordingWizard('youtube_chat_watch_connect_failed_to_load_session', {
            youtubeLiveChatId: state.youtubeLiveChatId || null
        });
        return;
    }

    logRecordingWizard('youtube_chat_watch_connect_session_loaded', {
        youtubeLiveChatId: state.youtubeLiveChatId || null,
        watchUrl: state.youtubePreparedWatchUrl || state.youtubeChatWatchUrl || null
    });
    await pollYouTubeChatMessages({ initial: true });
    openYouTubeChatPanel({ focusList: true });
    logRecordingWizard('youtube_chat_watch_connect_succeeded', {
        youtubeLiveChatId: state.youtubeLiveChatId || null,
        messageCount: Array.isArray(state.youtubeChatMessages) ? state.youtubeChatMessages.length : 0
    });
    syncYoutubeStatusText(
        state.youtubeConnected
            ? 'recording_wizard.broadcast.youtube_chat_watch_ready'
            : 'recording_wizard.broadcast.youtube_chat_watch_ready_public',
        state.youtubeConnected
            ? 'YouTube sohbeti bağlandı. Mesajları şimdi takip edebilirsiniz.'
            : 'YouTube sohbeti okuma modunda bağlandı. Mesajları takip edebilirsiniz; yazma ve moderasyon için hesap bağlamanız gerekir.'
    );
}

function getYouTubeChatWatchErrorText(response = {}) {
    switch (response.errorCode) {
        case 'invalid_youtube_url':
            return t('recording_wizard.broadcast.youtube_chat_watch_invalid_url', 'Girilen bağlantıdan geçerli bir YouTube video kimliği alınamadı.');
        case 'youtube_video_not_found':
            return t('recording_wizard.broadcast.youtube_chat_watch_video_not_found', 'Belirtilen YouTube videosu bulunamadı.');
        case 'youtube_video_not_live':
            return t('recording_wizard.broadcast.youtube_chat_watch_video_not_live', 'Bu bağlantı şu anda canlı bir YouTube yayınına ait görünmüyor.');
        case 'youtube_live_chat_disabled':
            return t('recording_wizard.broadcast.youtube_chat_watch_live_chat_disabled', 'Bu canlı yayında sohbet kapalı veya herkese açık değil.');
        case 'youtube_live_chat_broadcast_ended':
            return t('recording_wizard.broadcast.youtube_chat_watch_broadcast_ended', 'Bu YouTube yayını sona ermiş görünüyor.');
        case 'youtube_live_chat_not_found':
            return t('recording_wizard.broadcast.youtube_chat_watch_live_chat_not_found', 'Bu bağlantıda etkin bir canlı sohbet bulunamadı.');
        default:
            return response.error || t('recording_wizard.unknown_error', 'Unknown error');
    }
}

async function disconnectYouTubeAccount() {
    const response = await ipcRenderer.invoke('youtube-disconnect-account', {
        accountId: state.youtubeActiveAccountId
    });
    if (!response.success) {
        throw new Error(response.error || t('recording_wizard.broadcast.youtube_disconnect_failed', 'YouTube baglantisi kaldirilamadi.'));
    }
    clearPreparedYouTubeBroadcast();
    await loadYouTubeAuthState();
    state.youtubePlaylists = [];
    state.youtubeBroadcasts = [];
    state.youtubeSelectedBroadcastId = '';
    state.youtubeSelectedPlaylistId = '';
    populateYouTubePlaylistList();
    populateYouTubeBroadcastList();
    syncYoutubeStatusText('recording_wizard.broadcast.youtube_disconnected', 'YouTube baglantisi kaldirildi.');
}

async function prepareYouTubeBroadcastFromApi() {
    if (!state.youtubeConnected || !state.youtubeActiveAccountId) {
        throw new Error(t('recording_wizard.broadcast.youtube_auth_required', 'Oncelikle YouTube hesabinizi baglayin.'));
    }

    let response = null;
    let preparedBroadcast = null;
    let ingestion = null;

    if (state.youtubeApiMode === 'existing') {
        if (!state.youtubeSelectedBroadcastId) {
            throw new Error(t('recording_wizard.broadcast.youtube_existing_required', 'Lutfen planli bir YouTube yayini secin.'));
        }
        logRecordingWizard('youtube_prepare_existing_requested', {
            broadcastId: state.youtubeSelectedBroadcastId,
            playlistId: state.youtubeSelectedPlaylistId || null
        });
        response = await ipcRenderer.invoke('youtube-prepare-existing-broadcast', {
            broadcastId: state.youtubeSelectedBroadcastId,
            playlistId: state.youtubeSelectedPlaylistId
        });
        if (!response.success) {
            const formattedPrepareError = formatYouTubeBroadcastSetupError(response);
            logRecordingWizard('youtube_prepare_existing_failed', {
                broadcastId: state.youtubeSelectedBroadcastId,
                error: response.error || null,
                formattedError: formattedPrepareError || null,
                code: response.code || null,
                reason: response.reason || null,
                statusCode: response.statusCode || null
            });
            throw new Error(formattedPrepareError);
        }
        preparedBroadcast = response.broadcast;
        ingestion = response.ingestion;
    } else {
        const createTitle = (els.youtubeLiveTitle ? els.youtubeLiveTitle.value : '').trim();
        if (!createTitle) {
            throw new Error(t('recording_wizard.broadcast.youtube_title_required', 'YouTube yayin basligi gerekli.'));
        }
        const description = (els.youtubeLiveDescription ? els.youtubeLiveDescription.value : '').trim();
        const privacyStatus = els.youtubeLiveVisibility ? els.youtubeLiveVisibility.value : 'private';
        const scheduledStartTime = state.youtubeApiMode === 'planned'
            ? localInputToIso(els.youtubeLiveScheduledAt ? els.youtubeLiveScheduledAt.value : '')
            : new Date().toISOString();

        if (state.youtubeApiMode === 'planned' && !scheduledStartTime) {
            throw new Error(t('recording_wizard.broadcast.youtube_schedule_required', 'Planli yayin icin baslangic zamani gerekli.'));
        }

        logRecordingWizard('youtube_create_requested', {
            title: createTitle,
            privacyStatus,
            scheduledStartTime,
            playlistId: state.youtubeSelectedPlaylistId || null,
            madeForKids: false,
            youtubeApiMode: state.youtubeApiMode || null
        });
        response = await ipcRenderer.invoke('youtube-create-broadcast', {
            title: createTitle,
            description,
            privacyStatus,
            scheduledStartTime,
            madeForKids: false,
            playlistId: state.youtubeSelectedPlaylistId,
            enableAutoStart: true,
            enableAutoStop: true
        });
        if (!response.success) {
            const formattedCreateError = formatYouTubeBroadcastSetupError(response);
            logRecordingWizard('youtube_create_failed', {
                title: createTitle,
                error: response.error || null,
                formattedError: formattedCreateError || null,
                code: response.code || null,
                reason: response.reason || null,
                statusCode: response.statusCode || null
            });
            throw new Error(formattedCreateError);
        }
        logRecordingWizard('youtube_create_succeeded', {
            broadcastId: response.broadcast?.id || null,
            watchUrl: response.broadcast?.watchUrl || null,
            playlistAssigned: !!state.youtubeSelectedPlaylistId
        });
        preparedBroadcast = response.broadcast;
        ingestion = response.ingestion;
    }

    state.youtubePreparedBroadcastId = preparedBroadcast?.id || '';
    state.youtubePreparedBroadcastTitle = preparedBroadcast?.title || '';
    state.youtubePreparedWatchUrl = preparedBroadcast?.watchUrl || '';
    state.broadcastServer = ingestion?.server || state.broadcastServer;
    state.broadcastStreamKey = ingestion?.streamKey || state.broadcastStreamKey;

    if (els.broadcastServer) els.broadcastServer.value = state.broadcastServer;
    if (els.broadcastStreamKey) els.broadcastStreamKey.value = state.broadcastStreamKey;

    if (state.youtubePreparedBroadcastId) {
        const liveChatResponse = await ipcRenderer.invoke('youtube-get-live-chat-session', {
            broadcastId: state.youtubePreparedBroadcastId
        });
        if (liveChatResponse.success) {
            state.youtubeLiveChatId = liveChatResponse.liveChatId || state.youtubeLiveChatId;
            logRecordingWizard('youtube_live_chat_session_loaded', {
                preparedBroadcastId: state.youtubePreparedBroadcastId || null,
                liveChatId: state.youtubeLiveChatId || null
            });
        } else {
            logRecordingWizard('youtube_live_chat_session_failed', {
                preparedBroadcastId: state.youtubePreparedBroadcastId || null,
                error: liveChatResponse.error || null
            });
        }
    }

    updatePreparedYouTubeWatchLink();

    await saveBroadcastConfig();
    await refreshYouTubeModerators({ silent: true });
    syncYoutubeStatusText('recording_wizard.broadcast.youtube_prepared', 'YouTube yayini hazirlandi: {title}', {
        title: state.youtubePreparedBroadcastTitle || t('recording_wizard.broadcast.youtube_untitled', 'Adsiz yayin')
    });
}

async function saveBroadcastConfig() {
    state.broadcastPlatform = els.broadcastPlatform ? els.broadcastPlatform.value : state.broadcastPlatform;
    state.youtubeStreamMethod = els.youtubeStreamMethod ? els.youtubeStreamMethod.value : state.youtubeStreamMethod;
    state.youtubeApiMode = (els.youtubeApiModeRadios.find((radio) => radio.checked) || {}).value || state.youtubeApiMode;
    state.youtubeBroadcastDescription = els.youtubeLiveDescription ? els.youtubeLiveDescription.value.trim() : state.youtubeBroadcastDescription;
    state.youtubePrivacyStatus = els.youtubeLiveVisibility ? els.youtubeLiveVisibility.value : state.youtubePrivacyStatus;
    state.youtubeScheduledAt = els.youtubeLiveScheduledAt ? els.youtubeLiveScheduledAt.value : state.youtubeScheduledAt;
    state.youtubeSelectedBroadcastId = els.youtubeExistingBroadcasts ? els.youtubeExistingBroadcasts.value : state.youtubeSelectedBroadcastId;
    state.youtubeActiveAccountId = els.youtubeAccountSelect ? els.youtubeAccountSelect.value : state.youtubeActiveAccountId;
    state.youtubeSelectedPlaylistId = els.youtubePlaylistSelect ? els.youtubePlaylistSelect.value : state.youtubeSelectedPlaylistId;
    state.broadcastTitle = els.broadcastTitle ? els.broadcastTitle.value.trim() : state.broadcastTitle;
    state.broadcastServer = els.broadcastServer ? els.broadcastServer.value.trim() : state.broadcastServer;
    state.broadcastStreamKey = els.broadcastStreamKey ? els.broadcastStreamKey.value.trim() : state.broadcastStreamKey;

    const host = els.obsHost ? els.obsHost.value.trim() : '127.0.0.1';
    const port = els.obsPort ? parseInt(els.obsPort.value, 10) : 4455;
    const password = els.obsPassword ? els.obsPassword.value : '';

      await ipcRenderer.invoke('obs-save-config', {
        host,
        port,
        password,
        broadcastPlatform: state.broadcastPlatform,
        youtubeStreamMethod: state.youtubeStreamMethod,
        youtubeApiMode: state.youtubeApiMode,
        youtubeLiveTitle: els.youtubeLiveTitle ? els.youtubeLiveTitle.value.trim() : '',
        youtubeBroadcastDescription: state.youtubeBroadcastDescription,
        youtubePrivacyStatus: state.youtubePrivacyStatus,
          youtubeScheduledAt: state.youtubeScheduledAt,
          youtubeSelectedBroadcastId: state.youtubeSelectedBroadcastId,
          youtubeActiveAccountId: state.youtubeActiveAccountId,
          youtubeSelectedPlaylistId: state.youtubeSelectedPlaylistId,
          youtubePreparedBroadcastId: state.youtubePreparedBroadcastId,
          youtubePreparedBroadcastTitle: state.youtubePreparedBroadcastTitle,
          youtubePreparedWatchUrl: state.youtubePreparedWatchUrl,
          youtubeLiveChatId: state.youtubeLiveChatId,
          youtubeModerators: state.youtubeModerators,
          broadcastTitle: state.broadcastTitle,
          broadcastServer: state.broadcastServer,
          broadcastStreamKey: state.broadcastStreamKey
      });
}

async function applyBroadcastSettings() {
    state.broadcastPlatform = els.broadcastPlatform ? els.broadcastPlatform.value : state.broadcastPlatform;
    state.broadcastTitle = els.broadcastTitle ? els.broadcastTitle.value.trim() : state.broadcastTitle;
    state.broadcastServer = els.broadcastServer ? els.broadcastServer.value.trim() : state.broadcastServer;
    state.broadcastStreamKey = els.broadcastStreamKey ? els.broadcastStreamKey.value.trim() : state.broadcastStreamKey;

    if (!state.broadcastServer) {
        throw new Error(t('recording_wizard.broadcast.server_required', 'Yayin sunucusu gerekli.'));
    }
    if (!state.broadcastStreamKey) {
        throw new Error(t('recording_wizard.broadcast.stream_key_required', 'Yayin anahtari gerekli.'));
    }

    let streamServiceType = 'rtmp_custom';
    let streamServiceSettings = {
        bwtest: false,
        server: state.broadcastServer,
        key: state.broadcastStreamKey
    };

    const result = await ipcRenderer.invoke('obs-set-stream-service-settings', {
        streamServiceType,
        streamServiceSettings
    });

    if (!result.success) {
        throw new Error(result.error || t('recording_wizard.broadcast.settings_apply_failed', 'Yayin ayarlari OBS tarafina uygulanamadi.'));
    }

    await saveBroadcastConfig();
}

function getWindowSourceValue(source) {
    if (!source) return '';
    return source._obs ? (source.id || '') : (source.name || '');
}

function findWindowSourceByValue(value) {
    const normalizedValue = String(value || '').trim().toLowerCase();
    if (!normalizedValue) return null;
    return state.windowSources.find((source) => {
        const sourceValue = getWindowSourceValue(source).trim().toLowerCase();
        const sourceName = String(source.name || '').trim().toLowerCase();
        return sourceValue === normalizedValue || sourceName === normalizedValue;
    }) || null;
}

function getActiveWindow() {
    return state.selectedWindows[0] || null;
}

function getWindowSelectionValue(windowItem, fallbackIndex = 0) {
    if (!windowItem) {
        return String(fallbackIndex);
    }
    return windowItem.sourceValue || windowItem.id || windowItem.name || String(fallbackIndex);
}

function getAudioWindowTarget() {
    if (!Array.isArray(state.selectedWindows) || state.selectedWindows.length === 0) {
        return null;
    }
    return state.selectedWindows.find((windowItem, index) => getWindowSelectionValue(windowItem, index) === state.systemAudioWindowTarget) || state.selectedWindows[0];
}

function syncSystemAudioModeUi() {
    const hasSelectedWindows = state.captureMode === 'window' && Array.isArray(state.selectedWindows) && state.selectedWindows.length > 0;
    if (state.systemAudioMode === 'window' && !hasSelectedWindows) {
        state.systemAudioMode = 'system';
    }
    const isWindowMode = state.systemAudioMode === 'window';
    if (els.systemAudioModeRadios.length > 0) {
        els.systemAudioModeRadios.forEach((radio) => {
            radio.checked = radio.value === state.systemAudioMode;
            radio.disabled = !state.systemAudioEnabled || (radio.value === 'window' && !hasSelectedWindows);
        });
    }
    if (els.systemAudioModeGroup) {
        els.systemAudioModeGroup.style.display = state.systemAudioEnabled ? 'block' : 'none';
    }
    if (els.systemAudioWindowTargetGroup) {
        els.systemAudioWindowTargetGroup.style.display = state.systemAudioEnabled && isWindowMode && hasSelectedWindows ? 'block' : 'none';
    }
    if (els.systemAudioWindowTarget) {
        els.systemAudioWindowTarget.disabled = !(state.systemAudioEnabled && isWindowMode && hasSelectedWindows);
    }
}

function syncSystemAudioWindowTargetOptions() {
    if (!els.systemAudioWindowTarget) {
        return;
    }

    els.systemAudioWindowTarget.innerHTML = '';
    if (!Array.isArray(state.selectedWindows) || state.selectedWindows.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = t('recording_wizard.step3.system_audio_window_target_empty', 'Önce sesi alınacak pencereyi listeye ekleyin.');
        els.systemAudioWindowTarget.appendChild(option);
        state.systemAudioWindowTarget = '';
        syncSystemAudioModeUi();
        return;
    }

    state.selectedWindows.forEach((windowItem, index) => {
        const option = document.createElement('option');
        option.value = getWindowSelectionValue(windowItem, index);
        option.textContent = windowItem.name || t('recording_wizard.step3.window_list_fallback', 'Adsiz pencere');
        els.systemAudioWindowTarget.appendChild(option);
    });

    const preferredValue = state.selectedWindows.some((windowItem, index) => getWindowSelectionValue(windowItem, index) === state.systemAudioWindowTarget)
        ? state.systemAudioWindowTarget
        : getWindowSelectionValue(state.selectedWindows[0], 0);
    state.systemAudioWindowTarget = preferredValue;
    els.systemAudioWindowTarget.value = preferredValue;
    syncSystemAudioModeUi();
}

function buildActiveWindowAnnouncement(windowItem) {
    const name = windowItem && windowItem.name
        ? windowItem.name
        : t('recording_wizard.step3.window_list_fallback', 'Adsiz pencere');
    return t('recording_wizard.step6.active_window_announcement', 'Aktif pencere {name}', { name });
}

function syncSelectedWindowControls() {
    if (els.selectedWindowList) {
        els.selectedWindowList.innerHTML = '';
        if (state.selectedWindows.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = t('recording_wizard.step3.no_selected_windows', '(Henuz pencere eklenmedi)');
            els.selectedWindowList.appendChild(option);
        } else {
            state.selectedWindows.forEach((windowItem, index) => {
                const option = document.createElement('option');
                option.value = windowItem.id || windowItem.name || String(index);
                option.textContent = `${index === 0 ? '[Aktif] ' : ''}${windowItem.name || t('recording_wizard.step3.window_list_fallback', 'Adsiz pencere')}`;
                els.selectedWindowList.appendChild(option);
            });
            els.selectedWindowList.selectedIndex = Math.max(0, Math.min(state.activeWindowIndex, state.selectedWindows.length - 1));
        }
    }

    if (els.liveWindowSelect) {
        els.liveWindowSelect.innerHTML = '';
        if (state.selectedWindows.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = t('recording_wizard.step6.no_live_windows', 'Kayit icin secili pencere yok');
            els.liveWindowSelect.appendChild(option);
            els.liveWindowSelect.disabled = true;
        } else {
            state.selectedWindows.forEach((windowItem, index) => {
                const option = document.createElement('option');
                option.value = windowItem.id || windowItem.name || String(index);
                option.textContent = windowItem.name || t('recording_wizard.step3.window_list_fallback', 'Adsiz pencere');
                if (index === 0) option.selected = true;
                els.liveWindowSelect.appendChild(option);
            });
            els.liveWindowSelect.disabled = state.captureMode !== 'window';
        }
    }

    if (els.windowSwitcherList) {
        els.windowSwitcherList.innerHTML = '';
        if (state.selectedWindows.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = t('recording_wizard.step6.window_list_empty', 'Kayit icin secili pencere listesi bos.');
            els.windowSwitcherList.appendChild(option);
            els.windowSwitcherList.disabled = true;
        } else {
            state.selectedWindows.forEach((windowItem, index) => {
                const option = document.createElement('option');
                option.value = windowItem.id || windowItem.name || String(index);
                option.textContent = `${index === 0 ? '[Aktif] ' : ''}${windowItem.name || t('recording_wizard.step3.window_list_fallback', 'Adsiz pencere')}`;
                els.windowSwitcherList.appendChild(option);
            });
            els.windowSwitcherList.selectedIndex = 0;
            els.windowSwitcherList.disabled = false;
        }
    }

    if (els.btnRemoveWindow) {
        els.btnRemoveWindow.disabled = state.selectedWindows.length === 0;
    }
    if (els.btnSetActiveWindow) {
        els.btnSetActiveWindow.disabled = state.selectedWindows.length < 2;
    }
    if (els.btnApplyLiveWindow) {
        els.btnApplyLiveWindow.disabled = state.captureMode !== 'window' || state.selectedWindows.length === 0;
    }
    syncSystemAudioWindowTargetOptions();
}

function addSelectedWindowToList() {
    const selectedSource = findWindowSourceByValue(els.windowSelect ? els.windowSelect.value : '');
    if (!selectedSource) {
        announce(t('recording_wizard.step3.window_not_selected', 'Once listeden bir pencere secin.'));
        return;
    }

    const existingIndex = state.selectedWindows.findIndex((windowItem) => {
        return (windowItem.id && windowItem.id === selectedSource.id)
            || windowItem.name === selectedSource.name;
    });

    if (existingIndex !== -1) {
        state.activeWindowIndex = existingIndex;
        if (els.selectedWindowList) els.selectedWindowList.selectedIndex = existingIndex;
        announce(t('recording_wizard.step3.window_already_added', 'Bu pencere zaten listede.'));
        syncSelectedWindowControls();
        updateNextState();
        return;
    }

    state.selectedWindows.push({
        id: selectedSource.id,
        name: selectedSource.name,
        sourceValue: getWindowSourceValue(selectedSource),
        inputName: null,
        sceneItemId: null
    });

    if (state.selectedWindows.length === 1) {
        state.activeWindowIndex = 0;
        state.windowTitle = state.selectedWindows[0].sourceValue;
    }

    syncSelectedWindowControls();
    updateNextState();
    announce(t('recording_wizard.step3.window_added', 'Pencere listeye eklendi.'));
}

async function hideInactiveWindowItems(activeInputName) {
    if (state.captureMode !== 'window') return;
    const tasks = state.selectedWindows
        .filter((windowItem) => windowItem.sceneItemId && windowItem.inputName && windowItem.inputName !== activeInputName)
        .map((windowItem) => ipcRenderer.invoke('obs-set-transform', {
            sceneName: state.sceneName,
            sceneItemId: windowItem.sceneItemId,
            transform: {
                positionX: -(state.videoSettings.baseWidth || 1920) * 2,
                positionY: -(state.videoSettings.baseHeight || 1080) * 2,
                boundsType: 'OBS_BOUNDS_SCALE_INNER',
                boundsWidth: state.videoSettings.baseWidth || 1920,
                boundsHeight: state.videoSettings.baseHeight || 1080
            }
        }));

    if (tasks.length > 0) {
        await Promise.all(tasks);
    }
}

async function activateSelectedWindow(index, options = {}) {
    const { announceChange = true } = options;
    if (state.captureMode !== 'window' || state.selectedWindows.length === 0) return false;
    if (index < 0 || index >= state.selectedWindows.length) return false;

    const [selectedWindow] = state.selectedWindows.splice(index, 1);
    state.selectedWindows.unshift(selectedWindow);
    state.activeWindowIndex = 0;
    state.windowTitle = selectedWindow.sourceValue || selectedWindow.id || selectedWindow.name || '';
    state.screenItemId = selectedWindow.sceneItemId || null;
    state.screenInputName = selectedWindow.inputName || null;
    state.activeWindowInputName = selectedWindow.inputName || null;

    syncSelectedWindowControls();

    if (state.screenItemId) {
        await hideInactiveWindowItems(state.screenInputName);
        await applySelectedPreset(null, { preserveManualTransform: true });
    }

    if (announceChange) {
        const message = buildActiveWindowAnnouncement(selectedWindow);
        showShortcutTooltip(message);
    }
    return true;
}

async function removeSelectedWindowFromList() {
    if (!els.selectedWindowList || state.selectedWindows.length === 0) return;
    const removeIndex = Math.max(0, els.selectedWindowList.selectedIndex);
    const [removedWindow] = state.selectedWindows.splice(removeIndex, 1);
    const removedWasActive = removeIndex === 0;
    state.activeWindowIndex = 0;

    if (state.selectedWindows.length === 0) {
        state.windowTitle = '';
        state.screenItemId = null;
        state.screenInputName = null;
        state.activeWindowInputName = null;
    } else if (removedWasActive && state.captureMode === 'window' && state.selectedWindows[0].sceneItemId) {
        await activateSelectedWindow(0, { announceChange: true });
    }

    syncSelectedWindowControls();
    updateNextState();
    announce(t('recording_wizard.step3.window_removed', '{name} listeden cikarildi.', {
        name: removedWindow && removedWindow.name ? removedWindow.name : t('recording_wizard.step3.window_list_fallback', 'Pencere')
    }));
}

function openWindowSwitcherDialog() {
    if (!els.windowSwitcherDialog || !els.windowSwitcherList) return;
    syncSelectedWindowControls();
    if (state.selectedWindows.length === 0) {
        showShortcutTooltip(t('recording_wizard.step6.window_list_empty', 'Kayit icin secili pencere listesi bos.'));
        return;
    }
    els.windowSwitcherDialog.showModal();
    setTimeout(() => {
        els.windowSwitcherList.focus();
        els.windowSwitcherList.selectedIndex = 0;
    }, 30);
}

function closeWindowSwitcherDialog() {
    if (els.windowSwitcherDialog && els.windowSwitcherDialog.open) {
        els.windowSwitcherDialog.close();
    }
}

async function activateWindowFromSwitcher() {
    if (!els.windowSwitcherList || state.selectedWindows.length === 0) return;
    const selectedIndex = els.windowSwitcherList.selectedIndex;
    if (selectedIndex < 0) return;
    closeWindowSwitcherDialog();
    await activateSelectedWindow(selectedIndex, { announceChange: true });
}

function showStep(index) {
    const maxStep = els.steps.length - 1;
    if (index < 0) index = 0;
    if (index > maxStep) index = maxStep;
    state.stepIndex = index;
    els.steps.forEach((step, i) => {
        const isActive = i === index;
        step.classList.toggle('active', isActive);
        if (!isActive) step.style.display = 'none';
        else step.style.display = 'flex';
    });
    const atStart = index === 0;
    const atEnd = index === maxStep;
    els.btnBack.disabled = atStart;
    if (els.btnBack) {
        els.btnBack.style.display = atStart ? 'none' : 'inline-block';
    }
    // Fix #7: Show "Bitti" on last step, hide Next
    if (atEnd) {
        if (typeof window.registerRecordingShortcuts === 'function') window.registerRecordingShortcuts();
        els.btnNext.style.display = 'none';
        if (!els.btnFinish) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'btn-finish';
            btn.textContent = t('recording_wizard.finish_close', 'Finish - Close Wizard');
            btn.addEventListener('click', () => {
                announce(t('recording_wizard.status.closing_wizard', 'Closing wizard.'));
                try { ipcRenderer.send('close-dialog-window'); } catch (e) { window.close(); }
            });
            els.btnNext.parentNode.insertBefore(btn, els.btnNext);
            els.btnFinish = btn;
        }
        els.btnFinish.style.display = 'inline-block';
    } else {
        if (typeof window.unregisterRecordingShortcuts === 'function') window.unregisterRecordingShortcuts();
        els.btnNext.style.display = 'inline-block';
        if (els.btnFinish) els.btnFinish.style.display = 'none';
    }
    updateNextState();
    updateBroadcastUi();
    updateLiveEffectsSummary();
    syncObsStatsPolling();
    focusFirstInput();
    const step = els.steps[state.stepIndex];
    if (step) {
        step.style.display = 'flex';
        const label = step.getAttribute('aria-label') || t('recording_wizard.step_fallback', 'Step {step}', { step: state.stepIndex + 1 });
        announce(t('recording_wizard.status.step_opened', '{label} opened.', { label }));
    }
}

function focusFirstInput() {
    const step = els.steps[state.stepIndex];
    if (!step) return;
    const focusable = step.querySelector('input, select, button, textarea');
    if (focusable) focusable.focus();
}

function updateNextState() {
    let enabled = true;
    if (state.stepIndex === 0) {
        enabled = !!state.mode;
    } else if (state.stepIndex === 1) {
        enabled = isYouTubeChatWatchLaunchProfile() ? true : (state.obsFound && state.obsConnected);
    } else if (state.stepIndex === 2) {
        if (isYouTubeChatWatchLaunchProfile()) {
            enabled = true;
            els.btnNext.disabled = !enabled;
            return;
        }
        const hasScreens = state.screenSources.length > 0;
        const hasWindows = state.selectedWindows.length > 0;
        const captureOk = state.captureMode === 'screen'
            ? (hasScreens ? els.screenSelect.value !== '' : true)
            : hasWindows;
        enabled = captureOk && !!els.micSelect.value;
    }
    els.btnNext.disabled = !enabled;
}

// Extracted from init() so handlers are registered BEFORE any long async operations.
// This prevents the failsafe script from overriding navigation when autoConnectIfPossible() is slow.
let _navHandlersRegistered = false;
function _registerNavigationHandlers() {
    if (_navHandlersRegistered) return;
    _navHandlersRegistered = true;

    let isNavigating = false;
    const handleNextClick = async (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();

        if (isNavigating) return;
        isNavigating = true;

        if (els.sourceStatus && state.stepIndex === 2) {
            els.sourceStatus.textContent = t('recording_wizard.status.sources_preparing', 'Preparing sources...');
            announce(t('recording_wizard.status.sources_preparing_wait', 'Preparing sources, please wait...'));
        }
        try {
            await onNext();
        } catch (err) {
            console.error('onNext error:', err);
            if (err && err.message) {
                announce(t('recording_wizard.status.operation_error', 'An error occurred during the operation: {error}', { error: err.message }));
            }
        } finally {
            setTimeout(() => { isNavigating = false; }, 800);
        }
    };

    els.btnNext.addEventListener('click', handleNextClick);
    els.btnNext.onclick = handleNextClick;
    window.__kveNext = handleNextClick;
    window.__kveForceNext = (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        showStep(state.stepIndex + 1);
    };
    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'btn-next') {
            handleNextClick(e);
        }
    });
    els.btnBack.addEventListener('click', onBack);
    window.__kveBack = (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        onBack();
    };
    els.btnCancel.addEventListener('click', () => {
        try {
            ipcRenderer.send('close-dialog-window');
        } catch (e) {
            window.close();
        }
    });

    console.log('Navigation handlers registered successfully.');
}

async function init() {
    await recordingI18n.init();
    updateManualPresetLabel();
    updateAudioVolumeLabels();
    renderRecordingSceneBackgroundStatus();
    renderRecordingSceneBackgroundProfiles();
    applyAudioBalancePresetSelection(state.audioBalancePreset, { announceChange: false });
    syncLiveAudioControlsFromMain();
    const config = await ipcRenderer.invoke('obs-get-config');
    const preferredYoutubeAccountId = config?.youtubeActiveAccountId || '';
    if (config) {
        els.obsHost.value = config.host || '127.0.0.1';
        els.obsPort.value = config.port || 4455;
        els.obsPassword.value = config.password || '';
        state.broadcastPlatform = config.broadcastPlatform || 'youtube';
        state.youtubeStreamMethod = config.youtubeStreamMethod || 'manual';
        state.youtubeApiMode = config.youtubeApiMode || 'instant';
        state.youtubeBroadcastDescription = config.youtubeBroadcastDescription || '';
        state.youtubePrivacyStatus = config.youtubePrivacyStatus || 'private';
        state.youtubeScheduledAt = config.youtubeScheduledAt || '';
        state.youtubeSelectedBroadcastId = config.youtubeSelectedBroadcastId || '';
        state.youtubeActiveAccountId = config.youtubeActiveAccountId || '';
        state.youtubeSelectedPlaylistId = config.youtubeSelectedPlaylistId || '';
        state.youtubePreparedBroadcastId = config.youtubePreparedBroadcastId || '';
        state.youtubePreparedBroadcastTitle = config.youtubePreparedBroadcastTitle || '';
        state.youtubePreparedWatchUrl = config.youtubePreparedWatchUrl || '';
        state.youtubeLiveChatId = config.youtubeLiveChatId || '';
        state.youtubeModerators = Array.isArray(config.youtubeModerators) ? config.youtubeModerators : [];
        state.broadcastTitle = config.broadcastTitle || '';
        state.broadcastServer = config.broadcastServer || '';
        state.broadcastStreamKey = config.broadcastStreamKey || '';
    }
    if (els.broadcastPlatform) els.broadcastPlatform.value = state.broadcastPlatform;
    if (els.youtubeStreamMethod) els.youtubeStreamMethod.value = state.youtubeStreamMethod;
    if (els.youtubeApiModeRadios.length > 0) {
        const selectedRadio = els.youtubeApiModeRadios.find((radio) => radio.value === state.youtubeApiMode) || els.youtubeApiModeRadios[0];
        if (selectedRadio) selectedRadio.checked = true;
    }
    if (els.youtubeLiveTitle) els.youtubeLiveTitle.value = config?.youtubeLiveTitle || '';
    if (els.youtubeLiveDescription) els.youtubeLiveDescription.value = state.youtubeBroadcastDescription;
    if (els.youtubeLiveVisibility) els.youtubeLiveVisibility.value = state.youtubePrivacyStatus;
    if (els.youtubeLiveScheduledAt) {
        els.youtubeLiveScheduledAt.value = state.youtubeScheduledAt || toLocalDateTimeInputValue(new Date(Date.now() + 60 * 60 * 1000));
    }
    if (els.broadcastTitle) els.broadcastTitle.value = state.broadcastTitle;
    if (els.broadcastServer) els.broadcastServer.value = state.broadcastServer || getDefaultBroadcastServer(state.broadcastPlatform);
    if (els.broadcastStreamKey) els.broadcastStreamKey.value = state.broadcastStreamKey;
    if (els.youtubeChatVisibleToggle) {
        els.youtubeChatVisibleToggle.checked = state.youtubeChatVisualVisible;
    }
    if (els.youtubeChatAutoReadToggle) {
        els.youtubeChatAutoReadToggle.checked = state.youtubeChatAutoRead;
    }
    if (els.youtubeChatBackgroundNotificationToggle) {
        els.youtubeChatBackgroundNotificationToggle.checked = state.youtubeChatBackgroundNotification;
    }
    if (els.youtubeChatBackgroundFlashToggle) {
        els.youtubeChatBackgroundFlashToggle.checked = state.youtubeChatBackgroundFlash;
    }
    if (els.youtubeChatBackgroundSoundToggle) {
        els.youtubeChatBackgroundSoundToggle.checked = state.youtubeChatBackgroundSound;
    }
    updateBroadcastMethodUi();
    updateYouTubeChatVisualVisibility();
    renderYouTubeChatList({ preserveSelection: false });
    await loadYouTubeAuthState();
    if (
        preferredYoutubeAccountId
        && preferredYoutubeAccountId !== state.youtubeActiveAccountId
        && state.youtubeAccounts.some((account) => account.id === preferredYoutubeAccountId)
    ) {
        const switchResponse = await ipcRenderer.invoke('youtube-set-active-account', {
            accountId: preferredYoutubeAccountId
        });
        if (switchResponse?.success) {
            await loadYouTubeAuthState();
        }
    }
      if (isYouTubeApiMode() && state.youtubeConnected) {
          await refreshYouTubePlaylists({ silent: true });
          await refreshYouTubeBroadcasts({ silent: true });
          if (state.youtubeApiMode === 'existing' && state.youtubeSelectedBroadcastId) {
              await ensureSelectedYouTubeBroadcastPrepared({ silent: true });
          }
          if (state.youtubePreparedBroadcastId && state.youtubeLiveChatId) {
              updatePreparedYouTubeWatchLink();
              updateYouTubeModeratorUi();
              await refreshYouTubeModerators({ silent: true });
          }
      } else {
        populateYouTubePlaylistList();
        populateYouTubeBroadcastList();
    }

    await detectOBS();
    try {
        await refreshSources();
    } catch (e) {
        console.error('refreshSources error:', e);
        els.obsDetectStatus.textContent = t('recording_wizard.status.source_list_unavailable', 'Screen/window list could not be retrieved. There may be a permission or system limitation.');
    }
    try {
        await refreshDevices();
    } catch (e) {
        console.error('refreshDevices error:', e);
    }
    syncLiveMicSelectOptions();
    try {
        await loadLiveEffectsProfiles();
    } catch (e) {
        console.error('loadLiveEffectsProfiles error:', e);
        if (els.liveEffectsHint) {
            els.liveEffectsHint.textContent = `${t('recording_wizard.status.error', 'Hata')}: ${e.message}`;
        }
        if (els.liveEffectsHintStep6) {
            els.liveEffectsHintStep6.textContent = `${t('recording_wizard.status.error', 'Hata')}: ${e.message}`;
        }
    }
    setCaptureModeSelection('screen');
    state.mode = els.modeBroadcast && els.modeBroadcast.checked ? 'broadcast' : 'record';
    recordingWizardReady = true;
    applyLaunchProfile();
    if (els.interviewQuickstartNote) {
        els.interviewQuickstartNote.style.display = 'none';
    }

    // CRITICAL: Register navigation handlers BEFORE autoConnectIfPossible()
    // autoConnectIfPossible() can take 4-30 seconds. If handlers aren't registered
    // before that, the failsafe script may override navigation with buggy logic.
    _registerNavigationHandlers();

    await autoConnectIfPossible();
    if (pendingLaunchOptions?.restoreSession?.active && restoreRecordingWizardSession(pendingLaunchOptions.restoreSession)) {
        await ensureYouTubeChatSessionLoaded();
        await pollYouTubeChatMessages({ initial: true });
        await syncRecordingWizardSession();
        return;
    }
    await tryInterviewQuickStart();
    advanceInterviewProfileIfNeeded();

    // Auto-skip disabled based on user feedback to prevent confusion
    /* if (state.obsConnected && state.obsFound) {
        console.log('OBS already connected, skipping to step 2 (source selection)');
        showStep(2);
    } */

    // Mode selection step disabled for now; record mode fixed.

    els.btnOpenObsSite.addEventListener('click', () => {
        shell.openExternal('https://obsproject.com/download');
    });
    els.btnOpenWsDocs.addEventListener('click', () => {
        shell.openExternal('https://obsproject.com/docs/obs-websocket.html');
    });
    els.btnRecheckObs.addEventListener('click', detectOBS);
    if (els.btnInterviewQuickstart) {
        els.btnInterviewQuickstart.addEventListener('click', handleInterviewQuickstartClick);
    }

    els.togglePassword.addEventListener('change', () => {
        els.obsPassword.type = els.togglePassword.checked ? 'text' : 'password';
    });

    els.btnToggleHelp.addEventListener('click', () => {
        const isVisible = els.obsHelp.style.display !== 'none';
        els.obsHelp.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) {
            announce(els.obsHelp.innerText);
        }
    });

    els.btnTestConnection.addEventListener('click', testConnection);

    // Mode radio handlers
    if (els.modeRecord) {
        els.modeRecord.addEventListener('change', () => {
            state.mode = 'record';
            resetYouTubeChatState();
            updateNextState();
            updateBroadcastUi();
        });
    }
    if (els.modeBroadcast) {
        els.modeBroadcast.addEventListener('change', () => {
            state.mode = 'broadcast';
            updateNextState();
            updateBroadcastUi();
        });
    }

    if (els.formatRadios) {
        els.formatRadios.forEach(r => {
            r.addEventListener('change', () => {
                if (r.checked) state.recordingFormat = r.value;
            });
        });
    }

    if (els.videoQualityPreset) {
        els.videoQualityPreset.addEventListener('change', () => {
            state.videoQualityPreset = els.videoQualityPreset.value || 'current';
        });
    }

    if (els.liveEffectsEnable) {
        els.liveEffectsEnable.addEventListener('change', () => {
            state.liveEffectsEnabled = !!els.liveEffectsEnable.checked;
            if (!state.liveEffectsProfileId && state.liveEffectsProfiles.length > 0) {
                state.liveEffectsProfileId = state.liveEffectsProfiles[0].id;
            }
            if (!state.liveEffectsEnabled) {
                closeLiveEffectsOverlay({ announceClose: false });
                resetLiveEffectsSession().catch(() => {});
            }
            updateLiveEffectsUi();
        });
    }
    if (els.liveEffectsEnableStep6) {
        els.liveEffectsEnableStep6.addEventListener('change', () => {
            state.liveEffectsEnabled = !!els.liveEffectsEnableStep6.checked;
            if (!state.liveEffectsProfileId && state.liveEffectsProfiles.length > 0) {
                state.liveEffectsProfileId = state.liveEffectsProfiles[0].id;
            }
            if (!state.liveEffectsEnabled) {
                closeLiveEffectsOverlay({ announceClose: false });
                resetLiveEffectsSession().catch(() => {});
            }
            updateLiveEffectsUi();
        });
    }
    if (els.liveEffectsProfile) {
        els.liveEffectsProfile.addEventListener('change', () => {
            state.liveEffectsProfileId = els.liveEffectsProfile.value || null;
            resetLiveEffectsSession().catch(() => {});
            updateLiveEffectsOverlay();
            updateLiveEffectsSummary();
        });
    }
    if (els.liveEffectsProfileStep6) {
        els.liveEffectsProfileStep6.addEventListener('change', () => {
            state.liveEffectsProfileId = els.liveEffectsProfileStep6.value || null;
            resetLiveEffectsSession().catch(() => {});
            updateLiveEffectsOverlay();
            updateLiveEffectsSummary();
            updateLiveEffectsUi();
        });
    }
    if (els.btnOpenLiveEffectsPanel) {
        els.btnOpenLiveEffectsPanel.addEventListener('click', () => {
            openLiveEffectsPanelFromWizard();
        });
    }
    if (els.btnOpenLiveEffectsPanelStep6) {
        els.btnOpenLiveEffectsPanelStep6.addEventListener('click', () => {
            openLiveEffectsPanelFromWizard();
        });
    }
    if (els.btnRefreshLiveEffects) {
        els.btnRefreshLiveEffects.addEventListener('click', async () => {
            try {
                await loadLiveEffectsProfiles({ announceResult: true });
            } catch (error) {
                announce(`${t('recording_wizard.status.error', 'Hata')}: ${error.message}`);
            }
        });
    }
    if (els.btnRefreshLiveEffectsStep6) {
        els.btnRefreshLiveEffectsStep6.addEventListener('click', async () => {
            try {
                await loadLiveEffectsProfiles({ announceResult: true });
            } catch (error) {
                announce(`${t('recording_wizard.status.error', 'Hata')}: ${error.message}`);
            }
        });
    }
    if (els.btnToggleLiveEffectsOverlay) {
        els.btnToggleLiveEffectsOverlay.addEventListener('click', () => {
            toggleLiveEffectsOverlay();
        });
    }
    if (els.btnCloseLiveEffectsOverlay) {
        els.btnCloseLiveEffectsOverlay.addEventListener('click', () => {
            closeLiveEffectsOverlay();
        });
    }
    if (els.liveEffectsOverlay) {
        els.liveEffectsOverlay.addEventListener('click', (event) => {
            if (event.target === els.liveEffectsOverlay) {
                closeLiveEffectsOverlay();
            }
        });
    }
    if (els.minimizeOnRecordingStart) {
        els.minimizeOnRecordingStart.addEventListener('change', () => {
            state.minimizeOnRecordingStart = els.minimizeOnRecordingStart.checked;
        });
    }

    els.captureScreen.addEventListener('change', () => {
        state.captureMode = 'screen';
        updateSourceVisibility();
        updateNextState();
    });
    els.captureWindow.addEventListener('change', () => {
        state.captureMode = 'window';
        if (state.windowSources.length === 0) {
            if (state.windowSources.length === 0) announce(t('recording_wizard.sources.window_list_empty', 'The window list is empty.'));
        }
        updateSourceVisibility();
        updateNextState();
    });

    els.screenSelect.addEventListener('change', () => {
        state.screenIndex = parseInt(els.screenSelect.value, 10) || 0;
        updateNextState();
    });
    els.windowSelect.addEventListener('change', () => {
        state.windowTitle = els.windowSelect.value || '';
        updateNextState();
    });
    if (els.btnAddWindow) {
        els.btnAddWindow.addEventListener('click', addSelectedWindowToList);
    }
    if (els.btnRemoveWindow) {
        els.btnRemoveWindow.addEventListener('click', async () => {
            await removeSelectedWindowFromList();
        });
    }
    if (els.btnSetActiveWindow) {
        els.btnSetActiveWindow.addEventListener('click', async () => {
            if (!els.selectedWindowList) return;
            const selectedIndex = els.selectedWindowList.selectedIndex;
            if (selectedIndex < 0) return;
            await activateSelectedWindow(selectedIndex, { announceChange: true });
        });
    }
    if (els.selectedWindowList) {
        els.selectedWindowList.addEventListener('dblclick', async () => {
            const selectedIndex = els.selectedWindowList.selectedIndex;
            if (selectedIndex >= 0) {
                await activateSelectedWindow(selectedIndex, { announceChange: true });
            }
        });
    }

    els.cameraEnable.addEventListener('change', () => {
        state.cameraEnabled = els.cameraEnable.checked;
        if (state.cameraEnabled && !state.hasCameraDevices) {
            els.cameraEnable.checked = false;
            state.cameraEnabled = false;
            if (els.cameraStatus) {
                els.cameraStatus.style.display = 'block';
                els.cameraStatus.textContent = t('recording_wizard.camera.not_found', 'No camera was found. Please grant camera permissions or connect a device.');
            }
            announce(t('recording_wizard.camera.overlay_unavailable', 'No camera was found. The camera overlay could not be enabled.'));
        }
    });
    els.systemAudioEnable.addEventListener('change', () => {
        state.systemAudioEnabled = els.systemAudioEnable.checked;
        els.systemVolume.disabled = !state.systemAudioEnabled;
        syncSystemAudioModeUi();
    });
    if (els.systemAudioModeRadios.length > 0) {
        els.systemAudioModeRadios.forEach((radio) => {
            radio.addEventListener('change', () => {
                if (!radio.checked) {
                    return;
                }
                state.systemAudioMode = radio.value === 'window' ? 'window' : 'system';
                if (state.systemAudioMode === 'window' && !state.systemAudioWindowTarget) {
                    const firstWindow = getAudioWindowTarget();
                    state.systemAudioWindowTarget = firstWindow ? getWindowSelectionValue(firstWindow, 0) : '';
                }
                syncSystemAudioModeUi();
            });
        });
    }
    if (els.systemAudioWindowTarget) {
        els.systemAudioWindowTarget.addEventListener('change', () => {
            state.systemAudioWindowTarget = els.systemAudioWindowTarget.value || '';
        });
    }
    if (els.systemAudioEnable) {
        syncSystemAudioModeUi();
    }
    els.cameraSelect.addEventListener('change', () => {
        state.cameraDeviceId = els.cameraSelect.value || null;
    });
    els.micSelect.addEventListener('change', () => {
        state.micDeviceId = els.micSelect.value || null;
        if (els.liveMicSelect) {
            els.liveMicSelect.value = state.micDeviceId || '';
        }
        updateNextState();
    });
    if (els.broadcastPlatform) {
        els.broadcastPlatform.addEventListener('change', async () => {
            state.broadcastPlatform = els.broadcastPlatform.value;
            if (els.broadcastPlatform.value === 'youtube' && (!els.broadcastServer.value || els.broadcastServer.value === getDefaultBroadcastServer('generic'))) {
                els.broadcastServer.value = getDefaultBroadcastServer('youtube');
            }
            updateBroadcastMethodUi();
            await saveBroadcastConfig().catch(() => { });
            if (isYouTubeApiMode() && state.youtubeConnected) {
                await refreshYouTubePlaylists({ silent: true });
                await refreshYouTubeBroadcasts({ silent: true });
            }
        });
    }
    if (els.youtubeStreamMethod) {
        els.youtubeStreamMethod.addEventListener('change', async () => {
            state.youtubeStreamMethod = els.youtubeStreamMethod.value;
            clearPreparedYouTubeBroadcast();
            updateBroadcastMethodUi();
            await saveBroadcastConfig().catch(() => { });
            if (isYouTubeApiMode() && state.youtubeConnected) {
                await refreshYouTubePlaylists({ silent: true });
                await refreshYouTubeBroadcasts({ silent: true });
            }
        });
    }
    if (els.youtubeApiModeRadios.length > 0) {
        els.youtubeApiModeRadios.forEach((radio) => {
            radio.addEventListener('change', async () => {
                if (!radio.checked) return;
                state.youtubeApiMode = radio.value;
                clearPreparedYouTubeBroadcast();
                updateYouTubeBroadcastModeUi();
                await saveBroadcastConfig().catch(() => { });
                if (state.youtubeApiMode === 'existing' && state.youtubeConnected) {
                    await refreshYouTubeBroadcasts({ silent: true });
                }
            });
        });
    }
    if (els.youtubeShowClientSecret) {
        els.youtubeShowClientSecret.addEventListener('change', () => {
            if (els.youtubeClientSecret) els.youtubeClientSecret.type = els.youtubeShowClientSecret.checked ? 'text' : 'password';
        });
    }
    els.youtubeOauthSetup?.addEventListener('click', (event) => {
        const link = event.target?.closest?.('a[href]');
        if (!link) return;
        event.preventDefault();
        shell.openExternal(link.href).catch((error) => console.warn('YouTube OAuth guide link could not be opened:', error));
    });
    if (els.btnYoutubeSaveClient) {
        els.btnYoutubeSaveClient.addEventListener('click', () => saveYouTubeClientConfig().catch((error) => {
            syncYoutubeStatusText('youtube_oauth_setup.save_failed', 'YouTube OAuth bilgileri kaydedilemedi: {error}', { error: error.message || error });
        }));
    }
    if (els.btnYoutubeConnect) {
        els.btnYoutubeConnect.addEventListener('click', async () => {
            try {
                await connectYouTubeAccount();
                announce(t('recording_wizard.broadcast.youtube_auth_connected_short', 'YouTube hesabi baglandi.'));
            } catch (error) {
                announce(t('recording_wizard.broadcast.youtube_auth_failed_generic', 'YouTube hesabi baglanamadi.'));
            }
        });
    }
    if (els.btnYoutubeDisconnect) {
        els.btnYoutubeDisconnect.addEventListener('click', async () => {
            try {
                await disconnectYouTubeAccount();
                announce(t('recording_wizard.broadcast.youtube_disconnected', 'YouTube baglantisi kaldirildi.'));
            } catch (error) {
                syncYoutubeStatusText('recording_wizard.broadcast.youtube_disconnect_failed', 'YouTube baglantisi kaldirilamadi: {error}', {
                    error: error.message || error
                });
            }
        });
    }
    if (els.btnYoutubeChatWatchConnect) {
        els.btnYoutubeChatWatchConnect.addEventListener('click', async () => {
            await connectYouTubeChatWatch();
        });
    }
    if (els.btnYoutubeChatWatchClear) {
        els.btnYoutubeChatWatchClear.addEventListener('click', () => {
            state.youtubeChatWatchUrl = '';
            if (els.youtubeChatWatchUrl) {
                els.youtubeChatWatchUrl.value = '';
            }
            clearPreparedYouTubeBroadcast();
            resetYouTubeChatState();
            syncYoutubeStatusText('recording_wizard.broadcast.youtube_chat_watch_cleared', 'YouTube sohbet bağlantısı temizlendi.');
        });
    }
    if (els.btnYoutubeRefreshBroadcasts) {
        els.btnYoutubeRefreshBroadcasts.addEventListener('click', async () => {
            await refreshYouTubeBroadcasts();
        });
    }
    if (els.btnYoutubeRefreshPlaylists) {
        els.btnYoutubeRefreshPlaylists.addEventListener('click', async () => {
            await refreshYouTubePlaylists();
        });
    }
    if (els.btnYoutubeOpenWatchLink) {
        els.btnYoutubeOpenWatchLink.addEventListener('click', () => {
            if (!state.youtubePreparedWatchUrl) return;
            shell.openExternal(state.youtubePreparedWatchUrl);
        });
    }
    if (els.btnYoutubeCopyWatchLink) {
        els.btnYoutubeCopyWatchLink.addEventListener('click', () => {
            if (!state.youtubePreparedWatchUrl) return;
            clipboard.writeText(state.youtubePreparedWatchUrl);
            announce(t('recording_wizard.broadcast.youtube_watch_link_copied', 'YouTube baglantisi panoya kopyalandi.'));
        });
    }
    if (els.btnYoutubeAddModerator) {
        els.btnYoutubeAddModerator.addEventListener('click', async () => {
            await addYouTubeModerator();
        });
    }
    if (els.btnYoutubeRefreshModerators) {
        els.btnYoutubeRefreshModerators.addEventListener('click', async () => {
            await refreshYouTubeModerators();
        });
    }
    if (els.btnYoutubeRemoveModerator) {
        els.btnYoutubeRemoveModerator.addEventListener('click', async () => {
            await removeYouTubeModerator();
        });
    }
    if (els.btnToggleChatPanel) {
        els.btnToggleChatPanel.addEventListener('click', () => {
            if (state.youtubeChatPanelOpen) {
                closeYouTubeChatPanel({ restoreFocus: true });
            } else {
                openYouTubeChatPanel({ focusList: true });
            }
        });
    }
    if (els.youtubeChatVisibleToggle) {
        els.youtubeChatVisibleToggle.addEventListener('change', async () => {
            state.youtubeChatVisualVisible = !!els.youtubeChatVisibleToggle.checked;
            updateYouTubeChatVisualVisibility();
            await syncYouTubeChatStreamOverlay();
            await syncRecordingWizardSession();
        });
    }
    if (els.youtubeChatAutoReadToggle) {
        els.youtubeChatAutoReadToggle.addEventListener('change', () => {
            state.youtubeChatAutoRead = !!els.youtubeChatAutoReadToggle.checked;
            syncRecordingWizardSession().catch(() => { });
            announce(state.youtubeChatAutoRead
                ? t('recording_wizard.chat.auto_read_enabled', 'Yeni mesajları ekran okuyucuya otomatik duyurma açıldı.')
                : t('recording_wizard.chat.auto_read_disabled', 'Yeni mesajları ekran okuyucuya otomatik duyurma kapatıldı.'));
        });
    }
    if (els.youtubeChatBackgroundNotificationToggle) {
        els.youtubeChatBackgroundNotificationToggle.addEventListener('change', async () => {
            const shouldEnable = !!els.youtubeChatBackgroundNotificationToggle.checked;
            state.youtubeChatBackgroundNotification = shouldEnable;
            syncRecordingWizardSession().catch(() => { });
            announce(state.youtubeChatBackgroundNotification
                ? t('recording_wizard.chat.background_notification_enabled', 'Arka planda yeni mesaj için sistem bildirimi açıldı.')
                : t('recording_wizard.chat.background_notification_disabled', 'Arka planda yeni mesaj için sistem bildirimi kapatıldı.'));
        });
    }
    if (els.youtubeChatBackgroundFlashToggle) {
        els.youtubeChatBackgroundFlashToggle.addEventListener('change', () => {
            state.youtubeChatBackgroundFlash = !!els.youtubeChatBackgroundFlashToggle.checked;
            syncRecordingWizardSession().catch(() => { });
            announce(state.youtubeChatBackgroundFlash
                ? t('recording_wizard.chat.background_flash_enabled', 'Arka planda yeni mesaj için görev çubuğu uyarısı açıldı.')
                : t('recording_wizard.chat.background_flash_disabled', 'Arka planda yeni mesaj için görev çubuğu uyarısı kapatıldı.'));
        });
    }
    if (els.youtubeChatBackgroundSoundToggle) {
        els.youtubeChatBackgroundSoundToggle.addEventListener('change', () => {
            state.youtubeChatBackgroundSound = !!els.youtubeChatBackgroundSoundToggle.checked;
            syncRecordingWizardSession().catch(() => { });
            announce(state.youtubeChatBackgroundSound
                ? t('recording_wizard.chat.background_sound_enabled', 'Arka planda yeni mesaj için sesli uyarı açıldı.')
                : t('recording_wizard.chat.background_sound_disabled', 'Arka planda yeni mesaj için sesli uyarı kapatıldı.'));
        });
    }
    if (els.youtubeChatList) {
        els.youtubeChatList.addEventListener('change', () => {
            setSelectedChatIndex(els.youtubeChatList.selectedIndex, { announceSelection: true });
        });
        els.youtubeChatList.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedChatIndex(state.youtubeChatSelectedIndex - 1, { announceSelection: true, focusList: true });
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelectedChatIndex(state.youtubeChatSelectedIndex + 1, { announceSelection: true, focusList: true });
            } else if (event.key === 'ArrowRight' || event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                event.preventDefault();
                openYouTubeChatMenu();
            }
        });
    }
    if (els.youtubeChatComposer) {
        els.youtubeChatComposer.addEventListener('keydown', async (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                await sendYouTubeChatMessage();
            }
        });
    }
    if (els.btnYoutubeChatSend) {
        els.btnYoutubeChatSend.addEventListener('click', async () => {
            await sendYouTubeChatMessage();
        });
    }
    if (els.btnCloseYouTubeChatPanel) {
        els.btnCloseYouTubeChatPanel.addEventListener('click', () => {
            closeYouTubeChatPanel({ restoreFocus: true });
        });
    }
    if (els.liveMicSelect) {
        els.liveMicSelect.addEventListener('change', async () => {
            const nextMicDeviceId = els.liveMicSelect.value || null;
            state.micDeviceId = nextMicDeviceId;
            if (els.micSelect) {
                els.micSelect.value = nextMicDeviceId || '';
            }
            updateNextState();
            if (!state.recordingActive || !state.micInputName) {
                return;
            }

            const selectedOption = els.liveMicSelect.options[els.liveMicSelect.selectedIndex];
            const response = await ipcRenderer.invoke('obs-set-microphone-device', {
                inputName: state.micInputName,
                deviceId: nextMicDeviceId,
                deviceLabel: selectedOption ? selectedOption.textContent : ''
            });

            if (!response?.success) {
                showShortcutTooltip(t('recording_wizard.step6.live_mic_change_failed', 'Mikrofon değiştirilemedi: {error}', {
                    error: response?.error || t('recording_wizard.unknown_error', 'Unknown error')
                }));
                return;
            }

            await syncRecordingWizardSession();
            announce(t('recording_wizard.step6.live_mic_changed', 'Mikrofon değiştirildi.'));
        });
    }
    if (els.btnChatCopyMessage) {
        els.btnChatCopyMessage.addEventListener('click', () => {
            const message = getSelectedChatMessage();
            if (!message) return;
            clipboard.writeText(normalizeChatMessageText(message));
            closeYouTubeChatMenu();
            showShortcutTooltip(t('recording_wizard.chat.copy_message_success', 'Mesaj panoya kopyalandı.'));
        });
    }
    if (els.btnChatCopyAuthor) {
        els.btnChatCopyAuthor.addEventListener('click', () => {
            const message = getSelectedChatMessage();
            if (!message) return;
            clipboard.writeText(message.authorDisplayName || '');
            closeYouTubeChatMenu();
            showShortcutTooltip(t('recording_wizard.chat.copy_author_success', 'Yazar adı panoya kopyalandı.'));
        });
    }
    if (els.btnChatCopyChannel) {
        els.btnChatCopyChannel.addEventListener('click', () => {
            const message = getSelectedChatMessage();
            if (!message) return;
            clipboard.writeText(message.authorChannelId || '');
            closeYouTubeChatMenu();
            showShortcutTooltip(t('recording_wizard.chat.copy_channel_success', 'Kanal kimliği panoya kopyalandı.'));
        });
    }
    if (els.btnChatMentionAuthor) {
        els.btnChatMentionAuthor.addEventListener('click', () => {
            const message = getSelectedChatMessage();
            if (!message || !els.youtubeChatComposer) return;
            els.youtubeChatComposer.value = `${els.youtubeChatComposer.value || ''}@${message.authorDisplayName || ''} `;
            closeYouTubeChatMenu();
            els.youtubeChatComposer.focus();
            showShortcutTooltip(t('recording_wizard.chat.mention_success', 'Yazar yazma alanına eklendi.'));
        });
    }
    if (els.btnChatDeleteMessage) {
        els.btnChatDeleteMessage.addEventListener('click', async () => {
            await deleteSelectedYouTubeChatMessage();
        });
    }
    if (els.btnChatTimeout5m) {
        els.btnChatTimeout5m.addEventListener('click', async () => {
            await moderateSelectedYouTubeChatUser({ durationSeconds: 300 });
        });
    }
    if (els.btnChatTimeout10m) {
        els.btnChatTimeout10m.addEventListener('click', async () => {
            await moderateSelectedYouTubeChatUser({ durationSeconds: 600 });
        });
    }
    if (els.btnChatBanUser) {
        els.btnChatBanUser.addEventListener('click', async () => {
            await moderateSelectedYouTubeChatUser({ permanent: true });
        });
    }
    if (els.btnChatUnbanUser) {
        els.btnChatUnbanUser.addEventListener('click', async () => {
            await unbanSelectedYouTubeChatUser();
        });
    }
    if (els.btnChatUnbanSelected) {
        els.btnChatUnbanSelected.addEventListener('click', async () => {
            await unbanSelectedYouTubeChatBanEntry();
        });
    }
    if (els.btnChatCloseMenu) {
        els.btnChatCloseMenu.addEventListener('click', () => {
            closeYouTubeChatMenu();
        });
    }
    if (els.youtubeChatMenuDialog) {
        els.youtubeChatMenuDialog.addEventListener('keydown', (event) => {
            const menuButtons = [
                els.btnChatCopyMessage,
                els.btnChatCopyAuthor,
                els.btnChatCopyChannel,
                els.btnChatMentionAuthor,
                els.btnChatDeleteMessage,
                els.btnChatTimeout5m,
                els.btnChatTimeout10m,
                els.btnChatBanUser,
                els.btnChatUnbanUser,
                els.btnChatCloseMenu
            ].filter((button) => button && !button.disabled);

            if (menuButtons.length === 0) {
                return;
            }

            const currentIndex = menuButtons.indexOf(document.activeElement);
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % menuButtons.length : 0;
                menuButtons[nextIndex].focus();
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                const nextIndex = currentIndex >= 0 ? (currentIndex - 1 + menuButtons.length) % menuButtons.length : menuButtons.length - 1;
                menuButtons[nextIndex].focus();
            } else if (event.key === 'Home') {
                event.preventDefault();
                menuButtons[0].focus();
            } else if (event.key === 'End') {
                event.preventDefault();
                menuButtons[menuButtons.length - 1].focus();
            } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                closeYouTubeChatMenu();
            }
        });
    }
    if (els.youtubeAccountSelect) {
        els.youtubeAccountSelect.addEventListener('change', async () => {
            const accountId = els.youtubeAccountSelect.value || '';
            if (!accountId || accountId === state.youtubeActiveAccountId) {
                return;
            }

            const response = await ipcRenderer.invoke('youtube-set-active-account', { accountId });
            if (!response.success) {
                syncYoutubeStatusText('recording_wizard.broadcast.youtube_loading_failed', 'YouTube yayin listesi alinamadi: {error}', {
                    error: response.error || t('recording_wizard.unknown_error', 'Unknown error')
                });
                return;
            }

            state.youtubeSelectedBroadcastId = '';
            clearPreparedYouTubeBroadcast();
            await loadYouTubeAuthState();
            await saveBroadcastConfig();
            syncYoutubeStatusText('recording_wizard.broadcast.youtube_account_selected', 'Etkin YouTube hesabi degisti: {channel}', {
                channel: state.youtubeChannelTitle || t('recording_wizard.broadcast.youtube_channel_unknown', 'Kanal')
            });
            await refreshYouTubePlaylists({ silent: true });
            await refreshYouTubeBroadcasts({ silent: true });
        });
    }
    if (els.youtubeExistingBroadcasts) {
        els.youtubeExistingBroadcasts.addEventListener('change', async () => {
            state.youtubeSelectedBroadcastId = els.youtubeExistingBroadcasts.value || '';
            clearPreparedYouTubeBroadcast();
            await saveBroadcastConfig().catch(() => { });
            if (state.youtubeSelectedBroadcastId) {
                await ensureSelectedYouTubeBroadcastPrepared({ silent: true });
            }
        });
    }
    if (els.youtubePlaylistSelect) {
        els.youtubePlaylistSelect.addEventListener('change', () => {
            state.youtubeSelectedPlaylistId = els.youtubePlaylistSelect.value || '';
            clearPreparedYouTubeBroadcast();
            saveBroadcastConfig().catch(() => { });
        });
    }
    if (els.youtubeLiveTitle) {
        els.youtubeLiveTitle.addEventListener('change', () => {
            clearPreparedYouTubeBroadcast();
            saveBroadcastConfig().catch(() => { });
        });
    }
    if (els.youtubeLiveDescription) {
        els.youtubeLiveDescription.addEventListener('change', () => {
            state.youtubeBroadcastDescription = els.youtubeLiveDescription.value.trim();
            clearPreparedYouTubeBroadcast();
            saveBroadcastConfig().catch(() => { });
        });
    }
    if (els.youtubeLiveVisibility) {
        els.youtubeLiveVisibility.addEventListener('change', () => {
            state.youtubePrivacyStatus = els.youtubeLiveVisibility.value;
            clearPreparedYouTubeBroadcast();
            saveBroadcastConfig().catch(() => { });
        });
    }
    if (els.youtubeLiveScheduledAt) {
        els.youtubeLiveScheduledAt.addEventListener('change', () => {
            state.youtubeScheduledAt = els.youtubeLiveScheduledAt.value;
            clearPreparedYouTubeBroadcast();
            saveBroadcastConfig().catch(() => { });
        });
    }
    if (els.broadcastTitle) {
        els.broadcastTitle.addEventListener('change', () => {
            state.broadcastTitle = els.broadcastTitle.value.trim();
            saveBroadcastConfig().catch(() => { });
        });
    }
    if (els.broadcastServer) {
        els.broadcastServer.addEventListener('change', () => {
            state.broadcastServer = els.broadcastServer.value.trim();
            saveBroadcastConfig().catch(() => { });
        });
    }
    if (els.broadcastStreamKey) {
        els.broadcastStreamKey.addEventListener('change', () => {
            state.broadcastStreamKey = els.broadcastStreamKey.value.trim();
            saveBroadcastConfig().catch(() => { });
        });
    }
    if (els.broadcastShowKey) {
        els.broadcastShowKey.addEventListener('change', () => {
            els.broadcastStreamKey.type = els.broadcastShowKey.checked ? 'text' : 'password';
        });
    }

    els.btnApplyPreset.addEventListener('click', () => applySelectedPreset());
    // Camera framing is an occasional setup check, so it remains a focused wizard
    // button rather than occupying a configurable or global keyboard shortcut.
    els.btnTestRecordingCamera?.addEventListener('click', () => startRecordingCameraTest());
    els.btnReadRecordingCameraTestStatus?.addEventListener('click', readRecordingCameraTestStatus);
    els.btnCloseRecordingCameraTest?.addEventListener('click', () => stopRecordingCameraTest());
    els.recordingCameraTestDialog?.addEventListener('cancel', (event) => {
        event.preventDefault();
        stopRecordingCameraTest();
    });
    els.btnAiSuggest.addEventListener('click', requestAiSuggestion);
    els.btnApplyAi.addEventListener('click', applyAiSuggestion);
    if (els.btnSelectSceneBackground) {
        els.btnSelectSceneBackground.addEventListener('click', () => {
            selectRecordingSceneBackgroundFile().catch((error) => {
                showShortcutTooltip(t('recording_wizard.step4.scene_background_failed', 'Arka plan ayarlanamadı: {error}', {
                    error: error?.message || error || 'unknown_error'
                }));
            });
        });
    }
    if (els.btnClearSceneBackground) {
        els.btnClearSceneBackground.addEventListener('click', () => {
            clearRecordingSceneBackground().catch((error) => {
                showShortcutTooltip(t('recording_wizard.step4.scene_background_failed', 'Arka plan ayarlanamadı: {error}', {
                    error: error?.message || error || 'unknown_error'
                }));
            });
        });
    }
    els.sceneBackgroundFitMode?.addEventListener('change', () => updateRecordingSceneBackgroundPersonalization());
    els.sceneBackgroundDimPercent?.addEventListener('input', () => updateRecordingSceneBackgroundPersonalization());
    els.sceneLogoPosition?.addEventListener('change', () => updateRecordingSceneBackgroundPersonalization());
    els.sceneLogoSize?.addEventListener('change', () => updateRecordingSceneBackgroundPersonalization());
    if (els.btnSelectSceneLogo) {
        els.btnSelectSceneLogo.addEventListener('click', () => {
            selectRecordingSceneLogoFile().catch((error) => {
                showShortcutTooltip(t('recording_wizard.step4.scene_background_failed', 'Arka plan ayarlanamadı: {error}', {
                    error: error?.message || error || 'unknown_error'
                }));
            });
        });
    }
    if (els.btnClearSceneLogo) {
        els.btnClearSceneLogo.addEventListener('click', () => {
            clearRecordingSceneLogo().catch((error) => {
                showShortcutTooltip(t('recording_wizard.step4.scene_background_failed', 'Arka plan ayarlanamadı: {error}', {
                    error: error?.message || error || 'unknown_error'
                }));
            });
        });
    }
    els.sceneBackgroundProfileList?.addEventListener('change', () => {
        const profile = loadRecordingSceneBackgroundProfiles().find((item) => item.id === els.sceneBackgroundProfileList.value);
        if (els.sceneBackgroundProfileName) els.sceneBackgroundProfileName.value = profile?.name || '';
    });
    els.btnSaveSceneBackgroundProfile?.addEventListener('click', () => {
        saveCurrentRecordingSceneBackgroundProfile().catch((error) => {
            showShortcutTooltip(t('recording_wizard.step4.scene_background_profile_failed', 'Arka plan profili işlenemedi: {error}', { error: error?.message || error || 'unknown_error' }));
        });
    });
    els.btnApplySceneBackgroundProfile?.addEventListener('click', () => {
        applySelectedRecordingSceneBackgroundProfile().catch((error) => {
            showShortcutTooltip(t('recording_wizard.step4.scene_background_profile_failed', 'Arka plan profili işlenemedi: {error}', { error: error?.message || error || 'unknown_error' }));
        });
    });
    els.btnDeleteSceneBackgroundProfile?.addEventListener('click', () => {
        deleteSelectedRecordingSceneBackgroundProfile().catch((error) => {
            showShortcutTooltip(t('recording_wizard.step4.scene_background_profile_failed', 'Arka plan profili işlenemedi: {error}', { error: error?.message || error || 'unknown_error' }));
        });
    });
    if (els.aiFollowupQuestion) {
        els.aiFollowupQuestion.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && event.ctrlKey) {
                event.preventDefault();
                requestAiFollowup();
            }
        });
    }
    if (els.btnAiDescribe) els.btnAiDescribe.addEventListener('click', requestAiDescription);
    els.btnCameraPermission.addEventListener('click', requestCameraPermission);
    els.btnRefreshDevices.addEventListener('click', () => refreshDevices());
    els.btnRefreshSources.addEventListener('click', () => refreshSources());
    if (els.btnApplyLiveWindow) {
        els.btnApplyLiveWindow.addEventListener('click', async () => {
            const selectedValue = els.liveWindowSelect ? els.liveWindowSelect.value : '';
            const selectedIndex = state.selectedWindows.findIndex((windowItem) => (windowItem.id || windowItem.name) === selectedValue);
            if (selectedIndex >= 0) {
                await activateSelectedWindow(selectedIndex, { announceChange: true });
            }
        });
    }
    if (els.windowSwitcherActivate) {
        els.windowSwitcherActivate.addEventListener('click', async () => {
            await activateWindowFromSwitcher();
        });
    }
    if (els.windowSwitcherCancel) {
        els.windowSwitcherCancel.addEventListener('click', () => {
            closeWindowSwitcherDialog();
        });
    }
    if (els.windowSwitcherList) {
        els.windowSwitcherList.addEventListener('dblclick', async () => {
            await activateWindowFromSwitcher();
        });
        els.windowSwitcherList.addEventListener('keydown', async (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                await activateWindowFromSwitcher();
            }
        });
    }

    const handleCameraPositionInput = () => {
        markManualPresetSelected();
        applyCameraTransformFromInputs().catch((error) => {
            console.error('Camera transform apply error:', error);
        });
    };

    const handleCameraScaleInput = () => {
        markManualPresetSelected();
        const preset = getEffectivePreset();
        const scalePercent = parseInt(els.camScale.value, 10) || 25;
        const scale = Math.max(0.05, Math.min(2, scalePercent / 100));

        if (state.videoSettings) {
            const { baseWidth, baseHeight } = getLayoutReferenceSize();
            const margin = 20;

            if (['br', 'bl', 'tr', 'tl'].includes(preset)) {
                if (preset === 'br') {
                    els.camX.value = Math.round(baseWidth - baseWidth * scale - margin);
                    els.camY.value = Math.round(baseHeight - baseHeight * scale - margin);
                } else if (preset === 'bl') {
                    els.camX.value = margin;
                    els.camY.value = Math.round(baseHeight - baseHeight * scale - margin);
                } else if (preset === 'tr') {
                    els.camX.value = Math.round(baseWidth - baseWidth * scale - margin);
                    els.camY.value = margin;
                } else if (preset === 'tl') {
                    els.camX.value = margin;
                    els.camY.value = margin;
                }
            } else if (['side-l', 'side-r', 'side-l-slide', 'side-r-slide'].includes(preset)) {
                const camW = Math.round(baseWidth * (scalePercent / 100));
                // Eğer ekran soldaysa (kamera sağda), kamera konumu: Toplam Genişlik - Kamera Genişliği
                // Eğer ekran sağdaysa (kamera solda), kamera konumu: 0
                const isScreenLeft = (preset === 'side-l' || preset === 'side-l-slide');
                els.camX.value = isScreenLeft ? (baseWidth - camW) : 0;

                // Ayrıca, ana applyCameraTransformFromInputs çağrısından ÖNCE, 
                // ekranın da genişliğinin güncellenmesi gerekir! Çünkü yan yana düzende ikisi birbirine bağlı.
                // Bu yüzden tam yeniden yapılandırmayı tetiklemek için doğrudan applySelectedPreset'i çağırabiliriz
                // ancak bu sefer, ölçeğe müdahale etmemesi için manuel değerleri ezmesini engelleyecek bir mantığa ihtiyacımız var.
                // Bu nedenle, applyCameraTransformFromInputs içinde ekranın yeniden ayarlanması zor.
                // Ama ilk etapta sadece kameranın X konumu kaydırılsa dahi düzgün görünecektir.
            }
        }

        handleCameraPositionInput();
    };

    els.camX.addEventListener('input', handleCameraPositionInput);
    els.camX.addEventListener('change', handleCameraPositionInput);
    els.camY.addEventListener('input', handleCameraPositionInput);
    els.camY.addEventListener('change', handleCameraPositionInput);
    els.camScale.addEventListener('input', handleCameraScaleInput);
    els.camScale.addEventListener('change', handleCameraScaleInput);

    const camBgColorEl = document.getElementById('cam-bg-color');
    if (camBgColorEl) {
        camBgColorEl.addEventListener('change', async (e) => {
            await applyCameraTransformFromInputs();
            const val = e.target.value;
            let pDesc = "";
            switch (val) {
                case 'none':
                    pDesc = "Çerçeve kaldırıldı. Arka plan rengi yansıtılmıyor, kamera olduğu gibi görünecek.";
                    break;
                case 'black':
                    pDesc = "Siyah çerçeve seçildi. Odak noktası oluşturmak için mükemmel bir klasiktir. İzleyicinin gözünü yormaz, temiz ve çok profesyonel durur.";
                    break;
                case 'white':
                    pDesc = "Beyaz çerçeve seçildi. Modern ve aydınlık bir görünüm verir. Koyu renk bir arka plan (karanlık bir ekran görüntüsü vs.) üstünde harika bir kontrast sağlar.";
                    break;
                case 'charcoal':
                    pDesc = "Füme / Koyu Gri çerçeve seçildi. Modern, elit ve minimalist bir his verir. YouTube ve teknik içerik videolarında sıklıkla tercih edilen profesyonel bir arka plandır.";
                    break;
                case 'purple':
                    pDesc = "Mor (Yayıncı Estetiği) çerçeve seçildi. Teknolojik, yenilikçi ve oyuncu (Gaming) havası verir. Ekranın dikkat çekiciliğini artırır, neon estetiğine yakın modern bir tarzdır.";
                    break;
                case 'turquoise':
                    pDesc = "Turkuaz çerçeve seçildi. Ferah, dinamik ve arkadaş canlısı bir ton. Eğitim videoları veya samimi sunumlar için izleyiciyi rahatlatan bir atmosfere sahiptir.";
                    break;
                case 'green':
                    pDesc = "Yeşil çerçeve (Chroma Key) seçildi. Bu, yeşil perde mantığıyla aynıdır. Eğer kaydı aldıktan sonra gelişmiş video düzenleyicilerde sadece bu yeşil alanı silmek ve kamerayı videoya tam oturtmak isterseniz idealdir.";
                    break;
                case 'blue':
                    pDesc = "Mavi çerçeve seçildi. Kurumsal ve enerjik bir hava katar. Genellikle profesyonel toplantı programlarında (Zoom, Teams) sık rastlanan bir tondur.";
                    break;
                case 'blur':
                    pDesc = "Bulanık (Buzlu cam) zemin seçildi. Kameranın çevresi buzlu cam gibi görünür. Şık, göz yormayan ve odak bozucuları yok eden modern bir stildir.";
                    break;
            }
            if (pDesc) {
                announce(pDesc);
            }
        });
    }
    if (els.camPanelFillColor) {
        els.camPanelFillColor.addEventListener('change', async () => {
            await updateCameraBackground();
        });
    }

    if (els.audioBalancePreset) {
        els.audioBalancePreset.addEventListener('change', () => {
            applyAudioBalancePresetSelection(els.audioBalancePreset.value, { announceChange: true });
        });
    }
    if (els.liveAudioBalancePreset) {
        els.liveAudioBalancePreset.addEventListener('change', () => {
            applyAudioBalancePresetSelection(els.liveAudioBalancePreset.value, { announceChange: true });
        });
    }

    els.micVolume.addEventListener('input', () => {
        els.micVolumeValue.textContent = `%${els.micVolume.value}`;
        syncLiveAudioControlsFromMain();
        if (state.micInputName) {
            ipcRenderer.invoke('obs-set-input-volume', {
                inputName: state.micInputName,
                volumePercent: parseInt(els.micVolume.value, 10)
            });
        }
    });
    els.systemVolume.addEventListener('input', () => {
        els.systemVolumeValue.textContent = `%${els.systemVolume.value}`;
        syncLiveAudioControlsFromMain();
        if (state.systemInputName) {
            ipcRenderer.invoke('obs-set-input-volume', {
                inputName: state.systemInputName,
                volumePercent: parseInt(els.systemVolume.value, 10)
            });
        }
    });
    els.monitorEnable.addEventListener('change', async () => {
        const monitorType = els.monitorEnable.checked
            ? 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT'
            : 'OBS_MONITORING_TYPE_NONE';

        let typeStr = els.monitorEnable.checked ? 'açıldı' : 'kapalı';
        let items = [];

        if (state.micInputName) {
            await ipcRenderer.invoke('obs-set-input-monitoring', { inputName: state.micInputName, monitorType });
            items.push(t('recording_wizard.monitoring.microphone', 'Microphone'));
        }

        if (state.systemAudioEnabled && state.systemInputName) {
            await ipcRenderer.invoke('obs-set-input-monitoring', { inputName: state.systemInputName, monitorType });
            items.push(t('recording_wizard.monitoring.system_audio', 'System Audio'));
        }

        if (items.length > 0) {
            typeStr = els.monitorEnable.checked
                ? t('recording_wizard.monitoring.enabled', 'enabled')
                : t('recording_wizard.monitoring.disabled', 'disabled');
            announce(t('recording_wizard.monitoring.updated', 'Audio monitoring {state}: {items}', {
                state: typeStr,
                items: items.join(isTurkishUi() ? ' ve ' : ' and ')
            }));
        } else {
            announce(t('recording_wizard.monitoring.no_source', 'No audio source was available for monitoring.'));
            els.monitorEnable.checked = false;
        }
    });

    // Stop button is now part of toggle
    // els.btnStopRecord.addEventListener('click', stopRecording);
    els.btnOpenFolder.addEventListener('click', async () => {
        if (state.lastOutputPath) {
            const path = require('path');
            const { spawn } = require('child_process');
            const normalizedOutputPath = process.platform === 'win32'
                ? path.win32.normalize(state.lastOutputPath)
                : state.lastOutputPath;
            const folder = path.dirname(normalizedOutputPath);
            try {
                if (process.platform === 'win32') {
                    spawn('explorer.exe', ['/select,', normalizedOutputPath], {
                        detached: true,
                        stdio: 'ignore'
                    }).unref();
                    announce(t('recording_wizard.recording.file_revealed', 'The file is being shown in its folder.'));
                } else {
                    await shell.openPath(folder);
                    announce(t('recording_wizard.recording.folder_opened', 'Recording folder opened.'));
                }
            } catch (e) {
                shell.showItemInFolder(state.lastOutputPath);
                announce(t('recording_wizard.recording.file_revealed', 'The file is being shown in its folder.'));
            }
        }
    });
    els.btnCopyPath.addEventListener('click', () => {
        if (state.lastOutputPath) clipboard.writeText(state.lastOutputPath);
    });
    // New Feature: Finish and Add to Project
    if (els.btnFinishAdd) {
        els.btnFinishAdd.addEventListener('click', () => {
            if (state.lastOutputPath) {
                announce(t('recording_wizard.recording.adding_to_project', 'Adding the file to the project and closing the wizard.'));
                ipcRenderer.send('recording-finished-add-to-project', state.lastOutputPath);
            }
        });
    }
    if (els.btnSwitchToRecording) {
        els.btnSwitchToRecording.addEventListener('click', () => {
            state.mode = 'record';
            els.modeRecord.checked = true;
            updateBroadcastUi();
        });
    }

    // Navigation handlers are now registered in _registerNavigationHandlers()
    // which is called BEFORE autoConnectIfPossible() to prevent race conditions.

    document.addEventListener('keydown', (e) => {
        if (handleLiveEffectsOverlayKeydown(e)) return;
        if (state.stepIndex !== 5) return;
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        const active = document.activeElement;
        const isTextEntry = active && (
            active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            active.tagName === 'SELECT' ||
            active.isContentEditable
        );
        if (isTextEntry) return;
        const key = e.key.toLowerCase();
        if (key === 'r') {
            if (state.recordingActive) stopRecording();
            else startRecording();
        }
        if (key === 'p') togglePause();
        if (key === 's' && state.recordingActive) stopRecording();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            const active = document.activeElement;
            if (active && active.id === 'btn-next' && !els.btnNext.disabled) {
                // handleNextClick is registered via _registerNavigationHandlers() and available as window.__kveNext
                if (window.__kveNext) window.__kveNext(e);
            }
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (state.liveEffectsOverlayOpen) {
                e.preventDefault();
                closeLiveEffectsOverlay();
                return;
            }
            if (els.youtubeChatMenuDialog?.open) {
                e.preventDefault();
                closeYouTubeChatMenu();
                return;
            }
            if (state.recordingActive && state.mode === 'broadcast') {
                e.preventDefault();
                if (state.youtubeChatPanelOpen) {
                    closeYouTubeChatPanel({ restoreFocus: true });
                }
                return;
            }
            const activeInsideChat = !!(els.youtubeChatVisualPanel && els.youtubeChatVisualPanel.contains(document.activeElement));
            if (state.youtubeChatPanelOpen && activeInsideChat) {
                e.preventDefault();
                closeYouTubeChatPanel({ restoreFocus: true });
                return;
            }
            announce(t('recording_wizard.status.cancelling', 'Cancelling...'));
            try {
                ipcRenderer.send('close-dialog-window');
            } catch (err) {
                window.close();
            }
        }
    });

    // removed debug listeners

    document.addEventListener('keydown', (e) => {
        if (state.stepIndex !== 3) return;
        if (!state.cameraItemId) return;

        // Fix #3: Don't block arrow keys if user is navigating form controls (radios, inputs)
        const active = document.activeElement;
        const isFormCtrl = active && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA' || active.tagName === 'BUTTON');
        if (isFormCtrl) return;

        const step = e.shiftKey ? 10 : e.ctrlKey ? 50 : 1;
        let moved = false;
        if (e.key === 'ArrowLeft') { els.camX.value = (parseInt(els.camX.value, 10) || 0) - step; moved = true; }
        if (e.key === 'ArrowRight') { els.camX.value = (parseInt(els.camX.value, 10) || 0) + step; moved = true; }
        if (e.key === 'ArrowUp') { els.camY.value = (parseInt(els.camY.value, 10) || 0) - step; moved = true; }
        if (e.key === 'ArrowDown') { els.camY.value = (parseInt(els.camY.value, 10) || 0) + step; moved = true; }
        if (moved) {
            e.preventDefault();
            applyCameraTransformFromInputs();
        }
    });

    syncSelectedWindowControls();
    updateSourceVisibility();
    updateNextState();
    if (state.interviewQuickStartCompleted) {
        logRecordingWizard('interview_quickstart_preserved_final_step');
        showStep(els.steps.length - 1);
    } else {
        showStep(getSuggestedQuickStartStep());
    }
}

async function detectOBS() {
    if (isYouTubeChatWatchLaunchProfile()) {
        state.obsFound = false;
        state.obsConnected = false;
        state.latestObsStats = null;
        if (els.obsDetectStatus) {
            els.obsDetectStatus.textContent = t(
                'recording_wizard.obs.not_required_chat_watch',
                'YouTube sohbet izleme modunda OBS gerekli değildir.'
            );
        }
        if (els.obsConnStatus) {
            els.obsConnStatus.textContent = t(
                'recording_wizard.obs.connection_not_required_chat_watch',
                'Bu modda OBS bağlantısı kurulmadan devam edebilirsiniz.'
            );
        }
        updateNextState();
        return;
    }

    els.obsDetectStatus.textContent = t('recording_wizard.obs.checking', 'Checking OBS Studio...');
    const result = await ipcRenderer.invoke('obs-detect');
    state.obsFound = result && result.found;
    if (state.obsFound) {
        els.obsDetectStatus.textContent = t('recording_wizard.obs.found', 'OBS Studio found: {path}', {
            path: result.path || t('recording_wizard.obs.found_short', 'Found')
        });
        announce(t('recording_wizard.obs.found_announce', 'OBS Studio found.'));
    } else {
        els.obsDetectStatus.textContent = t('recording_wizard.obs.not_found', 'OBS Studio was not found. OBS Studio must be installed for this feature.');
        announce(t('recording_wizard.obs.not_found_announce', 'OBS Studio was not found.'));

        // Show detailed warning for new users
        setTimeout(async () => {
            const msg = t('recording_wizard.obs.install_prompt', 'OBS Studio is required for the recording feature, but it is not installed on this computer.\n\nPlease download and install OBS Studio, then enable the WebSocket server from the Tools menu.\n\nAfter that, reopen the wizard and continue.\n\nWould you like to open the OBS download page now?');
            const shouldOpenObsDownload = await window.api.showConfirm({
                title: t('recording_wizard.obs.install_prompt_title', 'OBS Studio gerekli'),
                message: msg
            });
            if (shouldOpenObsDownload) {
                shell.openExternal('https://obsproject.com/download');
                try { ipcRenderer.send('close-dialog-window'); } catch (e) { window.close(); }
            }
        }, 800);
    }
    updateNextState();
}

async function testConnection() {
    logRecordingWizard('obs_test_connection_started', {
        host: els.obsHost.value.trim(),
        port: parseInt(els.obsPort.value, 10)
    });
    els.obsConnStatus.textContent = t('recording_wizard.obs.testing_connection', 'Testing connection...');
    const host = els.obsHost.value.trim();
    const port = parseInt(els.obsPort.value, 10);
    const password = els.obsPassword.value;

    const result = await ipcRenderer.invoke('obs-test-connection', { host, port, password });
    if (result.success) {
        state.obsConnected = true;
        state.latestObsStats = null;
        logRecordingWizard('obs_test_connection_success');
        state.autoObsReady = true;
        els.obsConnStatus.textContent = t('recording_wizard.obs.connection_success', 'Connection successful. OBS is ready.');
        announce(t('recording_wizard.obs.connection_success_announce', 'OBS connection successful.'));
        await ipcRenderer.invoke('obs-save-config', { host, port, password });
        try {
            await refreshSources();
        } catch (e) {
            console.error('Connection success but refreshSources failed:', e);
        }
        const videoSettings = await ipcRenderer.invoke('obs-get-video-settings');
        if (videoSettings && videoSettings.success) {
            state.videoSettings = {
                ...state.videoSettings,
                ...videoSettings
            };
        }
    } else {
        state.obsConnected = false;
        state.latestObsStats = null;
        logRecordingWizard('obs_test_connection_failed', {
            error: result.error || 'unknown_error'
        });
        els.obsConnStatus.textContent = t('recording_wizard.obs.connection_failed', 'Connection failed: {error}', {
            error: result.error || t('recording_wizard.unknown_error', 'Unknown error')
        });
        announce(t('recording_wizard.obs.connection_failed_announce', 'OBS connection failed.'));
    }
    syncObsStatsPolling();
    updateNextState();
    await continueQuickStartAfterObsReady('manual_test_connection');
}

async function autoConnectIfPossible() {
    if (isYouTubeChatWatchLaunchProfile()) {
        state.obsConnected = false;
        state.latestObsStats = null;
        syncObsStatsPolling();
        updateNextState();
        return;
    }

    logRecordingWizard('obs_auto_connect_attempt');
    if (!state.obsFound) return;
    const host = els.obsHost.value.trim();
    const port = parseInt(els.obsPort.value, 10);
    const password = els.obsPassword.value;
    const result = await ipcRenderer.invoke('obs-test-connection', { host, port, password });
    if (result.success) {
        state.obsConnected = true;
        state.latestObsStats = null;
        logRecordingWizard('obs_auto_connect_success');
        state.autoObsReady = true;
        els.obsConnStatus.textContent = t('recording_wizard.obs.connection_auto_success', 'Connection successful (automatic). OBS is ready.');
        announce(t('recording_wizard.obs.connection_auto_success_announce', 'OBS connection verified automatically.'));
        await refreshSources();
        const videoSettings = await ipcRenderer.invoke('obs-get-video-settings');
        if (videoSettings && videoSettings.success) {
            state.videoSettings = {
                ...state.videoSettings,
                ...videoSettings
            };
        }
        updateNextState();
        syncObsStatsPolling();
        await continueQuickStartAfterObsReady('auto_connect_success');
    } else {
        logRecordingWizard('obs_auto_connect_failed', {
            error: result.error || 'unknown_error'
        });
        // Fix for "Repeatedly asking to open OBS": Check if error is Auth related
        const err = (result.error || '').toLowerCase();
        if (err.includes('authentication') || err.includes('password') || err.includes('4009')) {
            els.obsConnStatus.textContent = t('recording_wizard.obs.password_incorrect', 'Connection failed: incorrect password. Please enter the password in Step 2.');
            announce(t('recording_wizard.obs.password_incorrect_announce', 'OBS connection error: incorrect password.'));
            state.obsConnected = false;
            state.latestObsStats = null;
            syncObsStatsPolling();
            updateNextState();
            return; // Do NOT prompt to open OBS
        }

        els.obsConnStatus.textContent = t('recording_wizard.obs.connection_unavailable', 'OBS connection could not be established. OBS may be closed.');

        // Only verify logic if not retrying
        const shouldOpen = await openObsPrompt();
        if (shouldOpen) {
            const launch = await ipcRenderer.invoke('obs-launch');
            if (launch && !launch.success) {
                els.obsConnStatus.textContent = t('recording_wizard.obs.launch_failed', 'OBS could not be opened: {error}', {
                    error: launch.error || t('recording_wizard.unknown_error', 'Unknown error')
                });
                return;
            }

            els.obsConnStatus.textContent = t('recording_wizard.obs.started_waiting', 'OBS was started. Waiting for connection...');
            announce(t('recording_wizard.obs.starting_wait', 'Starting OBS, please wait...'));

            // Retry loop: Try every 2 seconds, up to 15 times (30 seconds)
            let attempts = 0;
            const maxAttempts = 15;

            const tryConnect = async () => {
                attempts++;
                els.obsConnStatus.textContent = t('recording_wizard.obs.retrying', 'Trying to connect... ({attempt}/{max})', {
                    attempt: attempts,
                    max: maxAttempts
                });

                const host = els.obsHost.value.trim();
                const port = parseInt(els.obsPort.value, 10);
                const password = els.obsPassword.value;
                const result = await ipcRenderer.invoke('obs-test-connection', { host, port, password });

                if (result.success) {
                    state.obsConnected = true;
                    state.latestObsStats = null;
                    state.autoObsReady = true;
                    els.obsConnStatus.textContent = t('recording_wizard.obs.connection_success', 'Connection successful. OBS is ready.');
                    announce(t('recording_wizard.obs.connection_ready_announce', 'OBS connection established and ready.'));
                    await ipcRenderer.invoke('obs-save-config', { host, port, password });
                    try { await refreshSources(); } catch (e) { }

                    const videoSettings = await ipcRenderer.invoke('obs-get-video-settings');
                    if (videoSettings && videoSettings.success) {
                        state.videoSettings = {
                            ...state.videoSettings,
                            ...videoSettings
                        };
                    }
                    updateNextState();
                    syncObsStatsPolling();
                    await continueQuickStartAfterObsReady('obs_launch_retry_success');
                } else {
                    if (attempts < maxAttempts) {
                        setTimeout(tryConnect, 2000);
                    } else {
                        els.obsConnStatus.textContent = t('recording_wizard.obs.timeout', 'OBS opened but the connection timed out. Please press "Test Connection".');
                        announce(t('recording_wizard.obs.timeout_announce', 'Connection timed out.'));
                    }
                }
            };

            setTimeout(tryConnect, 4000); // First try after 4s
        }
    }
}

function openObsPrompt() {
    return new Promise((resolve) => {
        const dialog = els.obsOpenDialog;
        if (!dialog || typeof dialog.showModal !== 'function') {
            window.api.showConfirm({
                title: t('recording_wizard.obs.open_prompt_title', 'OBS bağlantısı kurulamadı'),
                message: t('recording_wizard.obs.open_prompt', 'OBS connection could not be established. OBS may be closed. Would you like me to open OBS now?')
            }).then(resolve).catch(() => resolve(false));
            return;
        }

        const onYes = () => {
            cleanup();
            dialog.close('yes');
            resolve(true);
        };
        const onNo = () => {
            cleanup();
            dialog.close('no');
            resolve(false);
        };
        const onCancel = () => {
            cleanup();
            resolve(false);
        };
        const cleanup = () => {
            els.obsOpenYes.removeEventListener('click', onYes);
            els.obsOpenNo.removeEventListener('click', onNo);
            dialog.removeEventListener('cancel', onCancel);
        };

        els.obsOpenYes.addEventListener('click', onYes);
        els.obsOpenNo.addEventListener('click', onNo);
        dialog.addEventListener('cancel', onCancel);
        dialog.showModal();
        els.obsOpenYes.focus();
        announce(t('recording_wizard.obs.open_prompt_opened', 'OBS open confirmation dialog opened.'));
    });
}

async function refreshSources() {
    if (els.sourceStatus) els.sourceStatus.textContent = t('recording_wizard.status.sources_preparing', 'Preparing sources...');

    // Use IPC to get sources from Main process to avoid renderer crashes
    let screenSources = [];
    let windowSources = [];

    try {
        const resultScreen = await ipcRenderer.invoke('get-desktop-sources', { types: ['screen'], fetchWindowIcons: false, thumbnailSize: { width: 0, height: 0 } });
        if (resultScreen.success) screenSources = resultScreen.sources;

        if (resultScreen.success) screenSources = resultScreen.sources;

        // Try getting windows from OBS directly first (more reliable name/id)
        if (state.obsConnected) {
            try {
                const obsWins = await ipcRenderer.invoke('obs-get-windows');
                if (obsWins.success && Array.isArray(obsWins.windows) && obsWins.windows.length > 0) {
                    windowSources = obsWins.windows
                        .filter((w) => !isOwnAppWindowSourceName(w && w.name))
                        .map(w => ({
                            name: w.name, // e.g. "Belge1 - Word" or full string
                            id: w.id,     // full ID string for OBS input settings
                            _obs: true
                        }));
                    console.log(`Loaded ${windowSources.length} windows from OBS directly.`);
                }
            } catch (e) {
                console.error('OBS window list fetch error:', e);
            }
        }

        // Her halükarda Electron desktopCapturer ile detaylı listeyi de çekip OBS listesiyle birleştiriyoruz
        // Çünkü OBS'in BitBlt bazlı listesi Chrome/Edge gibi donanım hızlandırmalı tarayıcıları gizleyebilir.
        try {
            const resultWindow = await ipcRenderer.invoke('get-desktop-sources', { types: ['window'], fetchWindowIcons: false, thumbnailSize: { width: 0, height: 0 } });
            if (resultWindow.success && resultWindow.sources) {
                const existingNames = new Set(windowSources.map(w => w.name.trim().toLowerCase()));
                resultWindow.sources.forEach(s => {
                    const normalizedName = String(s.name || '').trim().toLowerCase();
                    if (!normalizedName || isOwnAppWindowSourceName(normalizedName) || existingNames.has(normalizedName)) {
                        return;
                    }
                    if (!existingNames.has(normalizedName)) {
                        windowSources.push({
                            name: s.name,
                            id: s.id || s.name, // Electron desktopCapturer ID'si veya başlığı
                            _obs: false
                        });
                        existingNames.add(normalizedName);
                    }
                });
                console.log(`Merged ${resultWindow.sources.length} windows from Electron desktopCapturer. Total: ${windowSources.length}`);
            }
        } catch (innerErr) {
            console.error('Electron desktopCapturer window fetch error:', innerErr);
        }

        // Windows tarafinda bazı pencereler ancak native enumeration ile görünür olabiliyor.
        try {
            const resultNative = await ipcRenderer.invoke('get-native-window-sources');
            if (resultNative.success && Array.isArray(resultNative.sources) && resultNative.sources.length > 0) {
                const existingNames = new Set(windowSources.map(w => String(w.name || '').trim().toLowerCase()).filter(Boolean));
                resultNative.sources.forEach((source) => {
                    const normalizedName = String(source.name || '').trim().toLowerCase();
                    if (!normalizedName || isOwnAppWindowSourceName(normalizedName) || existingNames.has(normalizedName)) {
                        return;
                    }
                    windowSources.push({
                        name: source.name,
                        id: source.id || source.name,
                        _native: true
                    });
                    existingNames.add(normalizedName);
                });
                console.log(`Merged ${resultNative.sources.length} windows from native enumeration. Total: ${windowSources.length}`);
            }
        } catch (nativeErr) {
            console.error('Native window enumeration fetch error:', nativeErr);
        }
    } catch (e) {
        console.error('Sources IPC error:', e);
        if (els.sourceStatus) els.sourceStatus.textContent = t('recording_wizard.sources.fetch_error', 'An error occurred while fetching the source list.');
    }

    state.screenSources = screenSources || [];
    state.windowSources = windowSources || [];
    state.selectedWindows = state.selectedWindows.map((windowItem) => {
        const refreshed = findWindowSourceByValue(windowItem.sourceValue || windowItem.id || windowItem.name);
        return refreshed ? {
            ...windowItem,
            id: refreshed.id,
            name: refreshed.name,
            sourceValue: getWindowSourceValue(refreshed)
        } : windowItem;
    });

    els.screenSelect.innerHTML = '';
    if (state.screenSources.length > 0) {
        state.screenSources.forEach((s, idx) => {
            const option = document.createElement('option');
            option.value = String(idx);
            option.textContent = getNormalizedScreenSourceName(s.name, idx);
            els.screenSelect.appendChild(option);
        });
    } else {
        const opt = document.createElement('option');
        opt.textContent = t('recording_wizard.sources.no_screen_option', '(No screen found - list is empty)');
        els.screenSelect.appendChild(opt);

        let filled = false;
        try {
            const { screen } = require('electron');
            const displays = screen.getAllDisplays();
            displays.forEach((d, idx) => {
                const option = document.createElement('option');
                option.value = String(idx);
                option.textContent = t('recording_wizard.sources.screen_dimensions', 'Screen {index} ({width}x{height})', {
                    index: idx + 1,
                    width: d.size.width,
                    height: d.size.height
                });
                els.screenSelect.appendChild(option);
            });
            if (displays.length > 0) {
                state.screenSources = displays.map((d, idx) => ({ name: t('recording_wizard.sources.screen_label', 'Screen {index}', { index: idx + 1 }), _display: d }));
                filled = true;
            }
        } catch (e) { }

        if (!filled) {
            const obsList = await ipcRenderer.invoke('obs-get-monitors');
            if (obsList && obsList.success && Array.isArray(obsList.monitors)) {
                state.obsMonitors = obsList.monitors;
                obsList.monitors.forEach((m, idx) => {
                    const option = document.createElement('option');
                    option.value = String(m.monitorIndex ?? idx);
                    const name = getNormalizedScreenSourceName(
                        m.monitorName || t('recording_wizard.sources.obs_screen_label', 'OBS Screen {index}', { index: idx + 1 }),
                        idx
                    );
                    option.textContent = name;
                    els.screenSelect.appendChild(option);
                });
                if (obsList.monitors.length > 0) {
                    state.screenSources = obsList.monitors.map((m, idx) => ({
                        name: getNormalizedScreenSourceName(
                            m.monitorName || t('recording_wizard.sources.obs_screen_label', 'OBS Screen {index}', { index: idx + 1 }),
                            idx
                        ),
                        _obs: m
                    }));
                }
            }
        }
    }

    els.windowSelect.innerHTML = '';
    if (state.windowSources.length > 0) {
        state.windowSources.forEach((s) => {
            const option = document.createElement('option');
            // Use ID if from OBS (exact match), otherwise Name
            option.value = s._obs ? s.id : s.name;
            option.textContent = s.name || t('recording_wizard.sources.window_label', 'Window');
            els.windowSelect.appendChild(option);
        });
    } else {
        const option = document.createElement('option');
        option.value = "";
        option.textContent = t('recording_wizard.sources.no_window_option', '(No window found or listed)');
        els.windowSelect.appendChild(option);
    }
    syncSelectedWindowControls();

    // Auto-select first available source
    if (state.screenSources.length > 0) {
        els.screenSelect.value = '0';
        state.screenIndex = 0;
        els.captureScreen.checked = true;
        state.captureMode = 'screen';
    } else if (state.windowSources.length > 0) {
        // If no screens but windows exist, default to window
        els.captureWindow.checked = true;
        state.captureMode = 'window';
    } else {
        // Both empty? Fallback to screen just to show something
        els.captureScreen.checked = true;
        state.captureMode = 'screen';
    }
    if (els.sourceStatus) {
        if (state.screenSources.length === 0 && state.windowSources.length === 0) {
            els.sourceStatus.textContent = t('recording_wizard.sources.empty', 'The screen/window list is empty. Nothing could be retrieved on this system.');
        } else {
            els.sourceStatus.textContent = t('recording_wizard.sources.summary', 'Source list refreshed. Screens: {screens}, windows found: {windows}.', {
                screens: state.screenSources.length,
                windows: state.windowSources.length
            });
        }
    }
    updateSourceVisibility();
    updateNextState();
}

async function refreshDevices() {
    let devices = [];
    try {
        devices = await navigator.mediaDevices.enumerateDevices();
    } catch (e) {
        console.warn('Device enumeration failed:', e);
    }

    const cams = devices.filter(d => d.kind === 'videoinput');
    const mics = devices.filter(d => d.kind === 'audioinput');
    state.hasCameraDevices = cams.length > 0;

    els.cameraSelect.innerHTML = '';
    if (cams.length === 0) {
        const opt = document.createElement('option');
        opt.value = 'default';
        opt.textContent = t('recording_wizard.sources.default_camera', 'Default Camera');
        els.cameraSelect.appendChild(opt);
        els.cameraEnable.disabled = false;
        if (els.cameraStatus) {
            els.cameraStatus.style.display = 'block';
            els.cameraStatus.textContent = t('recording_wizard.camera.permission_or_device', 'No camera was found. Grant permission or connect a device and scan again.');
        }
        announce(t('recording_wizard.camera.not_found_short', 'No camera was found.'));
    } else {
        if (els.cameraStatus) els.cameraStatus.style.display = 'none';
        cams.forEach((d, i) => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.textContent = d.label || t('recording_wizard.sources.camera_label', 'Camera {index}', { index: i + 1 });
            els.cameraSelect.appendChild(opt);
        });
    }

    els.micSelect.innerHTML = '';
    if (mics.length === 0) {
        const opt = document.createElement('option');
        opt.value = 'default';
        opt.textContent = t('recording_wizard.sources.default_mic', 'Default Microphone');
        els.micSelect.appendChild(opt);
    } else {
        mics.forEach((d, i) => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.textContent = d.label || t('recording_wizard.sources.mic_label', 'Microphone {index}', { index: i + 1 });
            els.micSelect.appendChild(opt);
        });
    }

    const preferredCameraId = getPreferredDeviceId(cams, state.cameraDeviceId);
    const preferredMicId = getPreferredDeviceId(mics, state.micDeviceId);

    if (els.cameraSelect.options.length > 0) {
        els.cameraSelect.value = preferredCameraId;
    }
    if (els.micSelect.options.length > 0) {
        els.micSelect.value = preferredMicId;
    }

    state.cameraDeviceId = els.cameraSelect.value || null;
    state.micDeviceId = els.micSelect.value || null;
    syncLiveMicSelectOptions();
    syncSystemAudioWindowTargetOptions();
    syncSystemAudioModeUi();

    // Mikrofonlar bulunamadıysa kullanıcıyı bilgilendir
    const micCount = mics.length;
    const camCount = cams.length;
    announce(t('recording_wizard.sources.devices_summary', '{cameraCount} cameras and {micCount} microphones found.{micHint}', {
        cameraCount: camCount,
        micCount,
        micHint: micCount === 0 ? ` ${t('recording_wizard.mic.permission_hint', 'No microphone was found. Use the microphone permission button.')}` : ''
    }));
}

async function requestCameraPermission() {
    try {
        // Hem video hem ses izni iste — harici kamera mikrofonlarının
        // görünebilmesi için audio izni de gerekli
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        stream.getTracks().forEach(t => t.stop());
        announce(t('recording_wizard.permissions.camera_mic_granted', 'Camera and microphone permissions were granted.'));
        await refreshDevices();
    } catch (e) {
        // Video+audio birlikte başarısız olduysa, ayrı ayrı dene
        try {
            const vStream = await navigator.mediaDevices.getUserMedia({ video: true });
            vStream.getTracks().forEach(t => t.stop());
            announce(t('recording_wizard.permissions.camera_granted', 'Camera permission was granted.'));
        } catch (ve) {
            if (els.cameraStatus) {
                els.cameraStatus.style.display = 'block';
                els.cameraStatus.textContent = t('recording_wizard.permissions.camera_denied_status', 'Camera permission could not be granted. Check the application permissions.');
            }
            announce(t('recording_wizard.permissions.camera_denied', 'Camera permission could not be granted.'));
        }
        try {
            const aStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            aStream.getTracks().forEach(t => t.stop());
            announce(t('recording_wizard.permissions.mic_granted', 'Microphone permission was granted.'));
        } catch (ae) {
            announce(t('recording_wizard.permissions.mic_denied', 'Microphone permission could not be granted.'));
        }
        await refreshDevices();
    }
}

/**
 * Sadece mikrofon izni iste ve cihaz listesini yenile
 */
async function requestMicPermission() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        announce(t('recording_wizard.permissions.mic_granted_refreshing', 'Microphone permission was granted. Refreshing the device list...'));
        await refreshDevices();
    } catch (e) {
        announce(t('recording_wizard.permissions.mic_denied_check', 'Microphone permission could not be granted. Please check the application permissions.'));
    }
}
window.requestMicPermission = requestMicPermission;

async function onNext() {
    const currentStep = state.stepIndex;
    console.log('onNext: currentStep =', currentStep);

    // Skip logic disabled
    /* if (currentStep === 0 && state.obsConnected) {
        showStep(2); // Jump to Step 3 (Source Selection)
        updateBroadcastUi();
        return;
    } */

    // Step 2: Source setup
    if (currentStep === 2) {
        if (isYouTubeChatWatchLaunchProfile()) {
            showStep(5);
            updateBroadcastUi();
            return;
        }
        try {
            console.log('onNext: Step 2 - setupObsSources çağrılıyor...');
            const result = await setupObsSources();
            console.log('onNext: setupObsSources bitti, sonuç:', JSON.stringify(result));

            if (!result.success) {
                const errorDetail = result.error || t('recording_wizard.unknown_error', 'Unknown error');
                const showMsg = t('recording_wizard.sources.setup_error', 'Source setup error: {error}', { error: errorDetail });
                console.error('onNext Step 2 FAILED:', showMsg);
                announce(showMsg);
                if (els.sourceStatus) els.sourceStatus.textContent = showMsg;
                return;
            }
        } catch (e) {
            console.error('onNext Step 2 EXCEPTION:', e);
            announce(t('recording_wizard.sources.setup_unexpected', 'Unexpected source setup error: {error}', { error: e.message }));
            if (els.sourceStatus) els.sourceStatus.textContent = t('recording_wizard.runtime.error_prefix', 'Error: {error}', { error: e.message });
            return;
        }

        if (!state.screenItemId) {
            announce(t('recording_wizard.sources.screen_id_missing', 'Source setup warning: the screen source ID could not be retrieved. Continuing anyway.'));
            console.warn('screenItemId is null, proceeding anyway');
        }
    }

    // Step 3: Auto-apply preset when leaving layout step
    if (currentStep === 3) {
        try {
            const selectedPreset = getSelectedPreset();
            const effectivePreset = getEffectivePreset(selectedPreset);
            const shouldReapplyPreset = selectedPreset !== 'manual' && effectivePreset !== state.lastPreset;

            if (shouldReapplyPreset) {
                await applySelectedPreset();
            } else if (state.cameraItemId) {
                await applyCameraTransformFromInputs();
                await updateCameraBackground();
            }

            announce(t('recording_wizard.layout.applied_continue', 'Layout applied. Moving to audio settings.'));
        } catch (e) {
            console.error('Preset apply error:', e);
        }
    }

    showStep(currentStep + 1);
    updateBroadcastUi();
}

function updateSourceVisibility() {
    try {
        const screenGroup = els.screenSelect ? els.screenSelect.closest('.form-group') : null;
        const windowGroup = els.windowSelect ? els.windowSelect.closest('.form-group') : null;

        // Debug visibility
        if (state.stepIndex === 2 && els.sourceStatus) {
            console.log(`Visibility update: mode=${state.captureMode}, screenGroup=${!!screenGroup}, windowGroup=${!!windowGroup}`);
        }

        if (screenGroup) {
            screenGroup.style.display = state.captureMode === 'screen' ? 'block' : 'none';
        }
        if (windowGroup) {
            windowGroup.style.display = state.captureMode === 'window' ? 'block' : 'none';
        }
        if (els.selectedWindowPanel) {
            els.selectedWindowPanel.style.display = state.captureMode === 'window' ? 'block' : 'none';
        }
        if (els.liveWindowSelect) {
            els.liveWindowSelect.disabled = state.captureMode !== 'window' || state.selectedWindows.length === 0;
        }
        if (els.btnApplyLiveWindow) {
            els.btnApplyLiveWindow.disabled = state.captureMode !== 'window' || state.selectedWindows.length === 0;
        }
        syncSystemAudioModeUi();
    } catch (e) {
        console.error('updateSourceVisibility error:', e);
        if (els.sourceStatus) els.sourceStatus.textContent = t('recording_wizard.sources.visibility_error', 'Visibility error: {error}', { error: e.message });
    }
}

function onBack() {
    if (state.stepIndex > 0) {
        showStep(state.stepIndex - 1);
    }
}

async function setupObsSources() {
    if (state.videoQualityPreset && state.videoQualityPreset !== 'current') {
        try {
            await ipcRenderer.invoke('obs-apply-video-quality-preset', {
                preset: state.videoQualityPreset,
                mode: state.mode
            });
        } catch (e) {
            console.warn('Video quality preset apply failed:', e);
        }
    }

    // Set recording format first
    if (state.recordingFormat) {
        try {
            console.log('Setting recording format:', state.recordingFormat);
            await ipcRenderer.invoke('obs-set-recording-format', { format: state.recordingFormat });
        } catch (e) {
            console.error('Format set error:', e);
        }
    }

    // Fallback: window list empty or selection missing -> screen capture
    if (state.captureMode === 'window' && state.selectedWindows.length === 0) {
        state.captureMode = 'screen';
    }
    const includeCamera = els.cameraEnable.checked;
    const audioTargetWindow = getAudioWindowTarget();
    if (els.systemAudioEnable.checked && state.systemAudioMode === 'window' && !audioTargetWindow) {
        return {
            success: false,
            error: t('recording_wizard.step3.system_audio_window_target_required', 'Pencere sesi seçildiyse önce sesi alınacak pencereyi belirleyin.')
        };
    }

    // Seçili cihaz label'larını al — OBS device matching için kullanılacak
    const selectedCamOption = els.cameraSelect.options[els.cameraSelect.selectedIndex];
    const selectedMicOption = els.micSelect.options[els.micSelect.selectedIndex];

    const params = {
        sceneName: state.sceneName,
        captureMode: state.captureMode,
        screenIndex: parseInt(els.screenSelect.value, 10) || 0,
        windowTitle: els.windowSelect.value || '',
        windowTitles: state.selectedWindows.map((windowItem) => windowItem.sourceValue || windowItem.id || windowItem.name).filter(Boolean),
        includeCamera,
        includeMic: true,
        includeSystemAudio: els.systemAudioEnable.checked,
        systemAudioMode: state.systemAudioMode,
        systemAudioWindowTarget: audioTargetWindow ? getWindowSelectionValue(audioTargetWindow, 0) : '',
        cameraDeviceId: els.cameraSelect.value || null,
        micDeviceId: els.micSelect.value || null,
        // Label'ları da gönder — OBS cihaz eşleştirmesinde kullanılacak
        cameraLabel: selectedCamOption ? selectedCamOption.textContent : '',
        micLabel: selectedMicOption ? selectedMicOption.textContent : ''
    };

    console.log('OBS Setup Params:', JSON.stringify({
        ...params,
        cameraLabel: params.cameraLabel,
        micLabel: params.micLabel
    }));

    const result = await ipcRenderer.invoke('obs-setup-sources', params);
    if (!result.success) {
        return { success: false, error: result.error };
    }

    state.screenItemId = result.screenItemId;
    state.screenInputName = result.screenInputName || (state.captureMode === 'window' ? 'KVE Pencere 1' : 'KVE Ekran');
    state.cameraItemId = result.cameraItemId;
    state.cameraInputName = result.cameraInputName || null;
    state.micInputName = result.micInputName;
    state.systemInputName = result.systemInputName;
    state.windowItems = Array.isArray(result.windowItems) ? result.windowItems : [];
    if (params.includeSystemAudio && params.systemAudioMode === 'window' && result.systemAudioModeApplied === 'system') {
        state.systemAudioMode = 'system';
        syncSystemAudioModeUi();
        showShortcutTooltip(t(
            'recording_wizard.step3.system_audio_window_fallback',
            'Seçili pencere sesi kullanılamadı. Bu nedenle tüm sistem sesi kullanılacak.'
        ));
    }

    if (state.captureMode === 'window') {
        state.selectedWindows = state.selectedWindows.map((windowItem) => {
            const match = state.windowItems.find((obsWindowItem) => {
                return obsWindowItem.id === windowItem.id
                    || obsWindowItem.windowId === windowItem.sourceValue
                    || obsWindowItem.name === windowItem.name;
            });
            return match ? {
                ...windowItem,
                id: match.id || windowItem.id,
                name: match.name || windowItem.name,
                sourceValue: match.windowId || windowItem.sourceValue,
                inputName: match.inputName,
                sceneItemId: match.sceneItemId
            } : windowItem;
        });
        state.activeWindowInputName = state.screenInputName;
        await activateSelectedWindow(0, { announceChange: false });
    } else {
        state.activeWindowInputName = null;
        state.windowItems = [];
        state.selectedWindows = state.selectedWindows.map((windowItem) => ({
            ...windowItem,
            inputName: null,
            sceneItemId: null
        }));
    }
    syncSelectedWindowControls();

    if (state.systemInputName) {
        els.systemVolume.disabled = false;
    }

    // Kaynak oluşturulduktan sonra, kullanıcının ayarladığı ses düzeylerini uygula
    // (Step 5'teki slider değerleri)
    if (state.micInputName) {
        const micVol = parseInt(els.micVolume.value, 10) || 100;
        await ipcRenderer.invoke('obs-set-input-volume', {
            inputName: state.micInputName,
            volumePercent: micVol
        });
        console.log(`Applied mic volume: ${micVol}%`);
    }
    if (state.systemInputName && !els.systemVolume.disabled) {
        const sysVol = parseInt(els.systemVolume.value, 10) || 100;
        if (sysVol !== 100) {
            await ipcRenderer.invoke('obs-set-input-volume', {
                inputName: state.systemInputName,
                volumePercent: sysVol
            });
            console.log(`Applied system volume: ${sysVol}%`);
        }
    }

    if (state.sceneBackground?.sourcePath) {
        await applyRecordingSceneBackgroundToObs().catch((error) => {
            console.warn('Scene background apply failed:', error.message || error);
        });
    }

    // Debug: log OBS source state
    try {
        const debugInfo = await ipcRenderer.invoke('obs-debug-sources', { sceneName: state.sceneName });
        console.log('=== OBS DEBUG (renderer) ===');
        console.log(JSON.stringify(debugInfo, null, 2));
        console.log('=== END OBS DEBUG ===');
    } catch (e) {
        console.warn('Debug sources call failed:', e);
    }

    return { success: true };
}

function getSelectedPreset() {
    const radio = els.layoutPresetRadios.find(r => r.checked);
    return radio ? radio.value : 'fullscreen';
}
function setSelectedPreset(preset) {
    const radio = els.layoutPresetRadios.find((item) => item.value === preset);
    if (radio) {
        radio.checked = true;
    }
}
function getEffectivePreset(selectedPreset = getSelectedPreset()) {
    if (selectedPreset === 'manual') {
        return state.manualLayoutBasePreset || state.lastPreset || 'fullscreen';
    }
    return selectedPreset;
}
function markManualPresetSelected(basePreset = null) {
    const resolvedBasePreset = basePreset || getEffectivePreset();
    state.manualLayoutBasePreset = resolvedBasePreset === 'manual'
        ? (state.lastPreset || 'fullscreen')
        : resolvedBasePreset;
    setSelectedPreset('manual');
    updateManualPresetLabel();
}
function updateManualPresetLabel() {
    if (!els.manualPresetLabel) return;
    const { baseWidth, baseHeight } = getLayoutReferenceSize();
    const x = parseInt(els.camX?.value, 10) || 0;
    const y = parseInt(els.camY?.value, 10) || 0;
    const xPercent = Math.round((x / baseWidth) * 100);
    const yPercent = Math.round((y / baseHeight) * 100);
    els.manualPresetLabel.textContent = t(
        'recording_wizard.layout.manual_dynamic',
        'Manual (Custom, X {xPercent}%, Y {yPercent}%)',
        { xPercent, yPercent }
    );
}
function getManualPresetPositionPercents() {
    const { baseWidth, baseHeight } = getLayoutReferenceSize();
    const x = parseInt(els.camX?.value, 10) || 0;
    const y = parseInt(els.camY?.value, 10) || 0;
    return {
        xPercent: Math.round((x / baseWidth) * 100),
        yPercent: Math.round((y / baseHeight) * 100)
    };
}
function getPresetLabel(preset) {
    return t(`recording_wizard.layout.${preset}`, preset);
}
function getPresetAnnouncement(preset) {
    if (preset === 'manual') {
        const { xPercent, yPercent } = getManualPresetPositionPercents();
        return t(
            'recording_wizard.layout_desc.manual_applied',
            'Manual layout applied. X {xPercent}%, Y {yPercent}%.',
            { xPercent, yPercent }
        );
    }
    if (preset === 'fullscreen') {
        return state.cameraItemId
            ? t('recording_wizard.layout_desc.fullscreen_with_camera', 'Tam ekran ayarlandı. Kamera küçük pencere olarak korunuyor.')
            : t('recording_wizard.layout_desc.fullscreen_no_camera', 'Tam ekran ayarlandı.');
    }
    if (!state.cameraItemId && ['camera-only', 'br', 'bl', 'tr', 'tl', 'side-l', 'side-r', 'side-l-slide', 'side-r-slide'].includes(preset)) {
        return t('recording_wizard.layout_desc.camera_missing_for_preset', 'Seçili düzen uygulandı, ancak kamera kaynağı bulunamadığı için yalnızca ekran gösteriliyor.');
    }
    return t(`recording_wizard.layout_desc.${preset}`, getPresetLabel(preset));
}

async function applySelectedPreset(forcedPresetName = null, options = {}) {
    if (forcedPresetName && typeof forcedPresetName === 'object') {
        options = forcedPresetName;
        forcedPresetName = null;
    }
    if (forcedPresetName && typeof forcedPresetName !== 'string') {
        forcedPresetName = null;
    }
    const preserveManualTransform = !!(options && options.preserveManualTransform);
    const requestedPresetName = forcedPresetName || getSelectedPreset();
    const presetName = getEffectivePreset(requestedPresetName);
    const keepManualSelection = requestedPresetName === 'manual';
    if (jsStatus) jsStatus.textContent = t('recording_wizard.layout.applying_status', 'Applying preset... ID: {id}', { id: state.screenItemId });
    console.log(`Applying preset. ScreenID: ${state.screenItemId}, CameraID: ${state.cameraItemId}`);

    if (!state.screenItemId) {
        announce(t('recording_wizard.sources.screen_not_ready', 'Warning: the screen source has not been created yet.'));
        if (els.aiStatus) els.aiStatus.textContent = t('recording_wizard.sources.screen_not_found', 'Screen source was not found.');
        if (jsStatus) jsStatus.textContent = t('recording_wizard.sources.screen_id_error', 'Error: screen ID is missing.');
        return;
    }
    if (state.captureMode === 'window') {
        await hideInactiveWindowItems(state.screenInputName);
    }
    announce(t('recording_wizard.layout.applying_announce', 'Applying layout: {layout}', {
        layout: getPresetLabel(keepManualSelection ? 'manual' : presetName)
    }));
    const preset = presetName;
    const { baseWidth, baseHeight } = getLayoutReferenceSize();
    const margin = 20;
    let x = 0;
    let y = 0;

    // Eğer kullanıcı aynı düzende kaldıysa (sadece ölçek değiştirip Uygula'ya bastıysa) mevcut ölçeğini koru.
    // Başka bir düzene ilk defa geçiyorsa varsayılan %25 olarak sıfırla.
    let isSamePreset = (state.lastPreset === preset);
    state.lastPreset = preset;
    if (!keepManualSelection) {
        state.manualLayoutBasePreset = preset;
    }
    let cornerScale = isSamePreset ? Math.max(0.05, Math.min(2, (parseInt(els.camScale.value, 10) || 25) / 100)) : 0.25;
    const shouldPreserveManualTransform = (preserveManualTransform || keepManualSelection) && isSamePreset && !!state.cameraItemId;

    let scale = 0.25;

    if (preset === 'br') {
        scale = cornerScale;
        x = baseWidth - baseWidth * scale - margin;
        y = baseHeight - baseHeight * scale - margin;
    } else if (preset === 'bl') {
        scale = cornerScale;
        x = margin;
        y = baseHeight - baseHeight * scale - margin;
    } else if (preset === 'tr') {
        scale = cornerScale;
        x = baseWidth - baseWidth * scale - margin;
        y = margin;
    } else if (preset === 'tl') {
        scale = cornerScale;
        x = margin;
        y = margin;
    } else if (preset === 'side-l') {
        scale = 0.5;
        x = baseWidth * 0.5 + margin;
        y = margin;
    } else if (preset === 'side-r') {
        scale = 0.5;
        x = margin;
        y = margin;
    } else {
        scale = cornerScale;
        x = baseWidth - baseWidth * scale - margin;
        y = baseHeight - baseHeight * scale - margin;
    }

    // Apply screen layout first
    // Camera-only mode: hide screen, show only camera fullscreen
    if (preset === 'camera-only') {
        // Move screen source offscreen (hide it)
        await ipcRenderer.invoke('obs-set-transform', {
            sceneName: state.sceneName,
            sceneItemId: state.screenItemId,
            transform: {
                positionX: -baseWidth * 2,
                positionY: -baseHeight * 2,
                boundsType: 'OBS_BOUNDS_SCALE_INNER',
                boundsWidth: baseWidth,
                boundsHeight: baseHeight
            }
        });

        if (state.cameraItemId) {
            // Make camera fill the entire canvas
            await ipcRenderer.invoke('obs-set-transform', {
                sceneName: state.sceneName,
                sceneItemId: state.cameraItemId,
                transform: {
                    positionX: 0,
                    positionY: 0,
                    boundsType: 'OBS_BOUNDS_SCALE_OUTER',
                    boundsWidth: baseWidth,
                    boundsHeight: baseHeight
                }
            });
            els.camX.value = 0;
            els.camY.value = 0;
            els.camScale.value = 100;
            updateManualPresetLabel();
            announce(getPresetAnnouncement(keepManualSelection ? 'manual' : 'camera-only'));
        } else {
            announce(t('recording_wizard.camera.source_missing', 'No camera source was found. Enable the camera in source selection first.'));
        }
        if (keepManualSelection) {
            setSelectedPreset('manual');
        }
        await updateCameraBackground();
        return;
    }

    // Side-by-side modes
    if (preset === 'side-l' || preset === 'side-r' || preset === 'side-l-slide' || preset === 'side-r-slide') {
        if (shouldPreserveManualTransform) {
            await applyCameraTransformFromInputs();
            if (keepManualSelection) {
                setSelectedPreset('manual');
            }
            announce(getPresetAnnouncement(keepManualSelection ? 'manual' : preset) || t('recording_wizard.layout.side_by_side_applied', 'Side-by-side layout applied.'));
            await updateCameraBackground();
            return;
        }

        // Side-by-side mode (split screen)
        // Default 50-50
        let splitRatio = 0.5;
        if (preset.includes('slide')) splitRatio = 0.65; // 65% for main content

        const isScreenLeft = (preset === 'side-l' || preset === 'side-l-slide');

        let screenW = Math.round(baseWidth * (preset.includes('slide') ? splitRatio : 0.5));
        let camW = baseWidth - screenW;

        // If slide mode and screen is right (side-r-slide), screenW matches the ratio
        // Actually: side-l-slide -> Screen Left (Big), Cam Right (Small)
        // side-r-slide -> Cam Left (Small), Screen Right (Big)
        if (preset === 'side-r-slide') {
            // Swap widths logic: Camera is Small (Left), Screen is Big (Right)
            // camW should be small (35%), screenW big (65%)
            camW = Math.round(baseWidth * (1 - splitRatio));
            screenW = baseWidth - camW;
        }

        const halfH = baseHeight;

        // Screen Position
        const screenX = isScreenLeft ? 0 : camW; // If screen is left, x=0. If screen is right, x=camW.

        // Camera Position
        const camX = isScreenLeft ? screenW : 0; // If screen left, cam starts after screen. If screen right, cam starts at 0.

        // Screen Source Transform
        await ipcRenderer.invoke('obs-set-transform', {
            sceneName: state.sceneName,
            sceneItemId: state.screenItemId,
            transform: {
                positionX: screenX,
                positionY: 0,
                boundsType: 'OBS_BOUNDS_SCALE_INNER', // Fit entire content (keep aspect ratio)
                boundsWidth: screenW,
                boundsHeight: halfH
            }
        });

        if (state.cameraItemId) {
            await ipcRenderer.invoke('obs-set-transform', {
                sceneName: state.sceneName,
                sceneItemId: state.cameraItemId,
                transform: {
                    positionX: camX,
                    positionY: 0,
                    scaleX: 1,
                    scaleY: 1,
                    boundsType: 'OBS_BOUNDS_SCALE_INNER', // Fit inside the side panel without zoom-cropping
                    boundsWidth: camW,
                    boundsHeight: halfH
                }
            });
        }
        els.camX.value = Math.round(camX);
        els.camY.value = 0;
        // Ölçek değerini kamera genişliği oranına göre doğru göster (35% veya 50%)
        els.camScale.value = Math.round((camW / baseWidth) * 100);
        updateManualPresetLabel();
        if (keepManualSelection) {
            setSelectedPreset('manual');
        }
        announce(getPresetAnnouncement(keepManualSelection ? 'manual' : preset) || t('recording_wizard.layout.side_by_side_applied', 'Side-by-side layout applied.'));
        await updateCameraBackground();
        return;
    }

    // Fullscreen presets: stretch screen, small camera
    await ipcRenderer.invoke('obs-set-transform', {
        sceneName: state.sceneName,
        sceneItemId: state.screenItemId,
        transform: {
            positionX: 0,
            positionY: 0,
            boundsType: 'OBS_BOUNDS_SCALE_INNER', // Fit entire content
            boundsWidth: baseWidth,
            boundsHeight: baseHeight
        }
    });

    if (state.cameraItemId) {
        if (!shouldPreserveManualTransform) {
            els.camX.value = Math.round(x);
            els.camY.value = Math.round(y);
            els.camScale.value = Math.round(scale * 100);
        }
        updateManualPresetLabel();
        await applyCameraTransformFromInputs();
        if (keepManualSelection) {
            setSelectedPreset('manual');
        }
        announce(getPresetAnnouncement(keepManualSelection ? 'manual' : preset) || t('recording_wizard.layout.applied', 'Layout updated.'));
    } else {
        announce(getPresetAnnouncement(keepManualSelection ? 'manual' : preset) || t('recording_wizard.layout.applied', 'Layout updated.'));
    }
    await updateCameraBackground();
}

async function updateCameraBackground() {
    if (!state.cameraItemId) return;
    const preset = getEffectivePreset();
    const panelFillColorName = els.camPanelFillColor ? els.camPanelFillColor.value : 'none';
    const shouldApplyPanelFill = ['side-l', 'side-r', 'side-l-slide', 'side-r-slide'].includes(preset);
    await ipcRenderer.invoke('obs-set-camera-panel-fill', {
        sceneName: state.sceneName,
        cameraItemId: state.cameraItemId,
        colorName: shouldApplyPanelFill ? panelFillColorName : 'none'
    });
    const bgColorEl = document.getElementById('cam-bg-color');
    const colorName = bgColorEl ? bgColorEl.value : 'none';
    await ipcRenderer.invoke('obs-set-camera-background', {
        sceneName: state.sceneName,
        cameraItemId: state.cameraItemId,
        colorName
    });
}

async function applyCameraTransformFromInputs() {
    if (!state.cameraItemId) return;
    const preset = getEffectivePreset();
    const x = parseInt(els.camX.value, 10) || 0;
    const y = parseInt(els.camY.value, 10) || 0;
    const scalePercent = parseInt(els.camScale.value, 10) || 25;
    const scale = Math.max(0.05, Math.min(2, scalePercent / 100));

    let transform = {
        positionX: x,
        positionY: y,
        scaleX: scale,
        scaleY: scale,
        boundsType: 'OBS_BOUNDS_NONE' // Reset bounds to ensure scaling works (in case switching from Side-by-Side)
    };

    if (['side-l', 'side-r', 'side-l-slide', 'side-r-slide'].includes(preset) && state.videoSettings) {
    const { baseWidth, baseHeight } = getLayoutReferenceSize();
        const camW = Math.round(baseWidth * (scalePercent / 100));
        const screenW = baseWidth - camW;
        const isScreenLeft = (preset === 'side-l' || preset === 'side-l-slide');

        // Update screen source
        await ipcRenderer.invoke('obs-set-transform', {
            sceneName: state.sceneName,
            sceneItemId: state.screenItemId,
            transform: {
                positionX: isScreenLeft ? 0 : camW,
                positionY: 0,
                boundsType: 'OBS_BOUNDS_SCALE_INNER',
                boundsWidth: screenW,
                boundsHeight: baseHeight
            }
        });

        // Update camera transform
        transform = {
            positionX: isScreenLeft ? screenW : 0,
            positionY: 0,
            scaleX: 1,
            scaleY: 1,
            boundsType: 'OBS_BOUNDS_SCALE_INNER',
            boundsWidth: camW,
            boundsHeight: baseHeight
        };
        // sync input X value logic for correct feedback
        if (els.camX.value != transform.positionX) els.camX.value = transform.positionX;
    }

    await ipcRenderer.invoke('obs-set-transform', {
        sceneName: state.sceneName,
        sceneItemId: state.cameraItemId,
        transform
    });

    const bgColorEl = document.getElementById('cam-bg-color');
    const colorName = bgColorEl ? bgColorEl.value : 'none';

    // update background shape to match new transform
    await ipcRenderer.invoke('obs-set-camera-background', {
        sceneName: state.sceneName,
        cameraItemId: state.cameraItemId,
        colorName
    });
    updateManualPresetLabel();
}

async function requestAiSuggestion() {
    els.aiStatus.textContent = t('recording_wizard.ai.suggestion_preparing', 'Preparing AI suggestion...');
    announce(t('recording_wizard.ai.suggestion_preparing_announce', 'Preparing AI suggestion.'));
    resetAiFollowupUi();

    if (!state.screenItemId && state.obsConnected) {
        announce(t('recording_wizard.sources.obs_source_not_ready', 'Warning: the OBS source has not been created yet.'));
    }

    els.btnApplyAi.disabled = true;
    const gemini = await ipcRenderer.invoke('get-gemini-api-data');
    if (!gemini || !gemini.apiKey) {
        els.aiStatus.textContent = t('recording_wizard.ai.gemini_key_missing', 'Gemini API key was not found.');
        announce(t('recording_wizard.ai.gemini_key_missing', 'Gemini API key was not found.'));
        return;
    }

    let base64 = await getObsPreviewBase64();

    if (!base64) {
        const source = state.captureMode === 'window'
            ? state.windowSources.find(s => s.name === els.windowSelect.value)
            : state.screenSources[state.screenIndex];
        const fallbackSource = state.screenSources[state.screenIndex] || state.screenSources[0];
        const previewSource = (source && source.thumbnail) ? source : fallbackSource;
        if (!previewSource || !previewSource.thumbnail) {
            els.aiStatus.textContent = t('recording_wizard.ai.preview_unavailable', 'Preview could not be captured. OBS screenshot or desktop sources were not accessible.');
            announce(t('recording_wizard.ai.preview_failed', 'Preview could not be captured.'));
            return;
        }
        const dataUrl = previewSource.thumbnail.toDataURL();
        base64 = dataUrl.split(',')[1];
    }

    const currentPreset = getPresetLabel(getSelectedPreset());
    const currentScale = els.camScale ? els.camScale.value : 25;
    const selectedBgColorText = getSelectedOptionText(document.getElementById('cam-bg-color'));
    const selectedPanelFillText = getSelectedOptionText(els.camPanelFillColor);
    const prompt = buildAiSuggestionPrompt(currentPreset, currentScale, selectedBgColorText, selectedPanelFillText);

    const resp = await ipcRenderer.invoke('gemini-vision-request', {
        apiKey: gemini.apiKey,
        model: gemini.model || 'gemini-2.5-flash',
        imageBase64: base64,
        prompt,
        history: [],
        systemInstruction: t('runtime.dialogs.ai_system_instruction_json', 'Respond only in {lang}. If JSON output is requested, keep all JSON keys and schema exactly as requested while writing any free text values in {lang}.', {
            lang: isTurkishUi() ? 'Turkish' : 'English'
        })
    });

    if (!resp || !resp.success) {
        els.aiStatus.textContent = t('recording_wizard.ai.request_failed', 'AI error: {error}', {
            error: resp?.error || t('recording_wizard.unknown_error', 'Unknown error')
        });
        announce(t('recording_wizard.ai.request_failed_announce', 'An AI error occurred.'));
        return;
    }

    let text = resp.text || '';
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    try {
        const json = JSON.parse(text);
        state.aiSuggestion = json;
        state.aiSuggestionPreviewBase64 = base64;
        state.aiSuggestionResponseText = resp.text || '';
        els.aiStatus.textContent = t('recording_wizard.ai.suggestion_ready', 'AI suggestion is ready: {reason}', {
            reason: json.reason || t('recording_wizard.ai.suggestion_created', 'Suggestion created.')
        });
        announce(t('recording_wizard.ai.suggestion_ready_announce', 'AI suggestion is ready. {reason}', {
            reason: json.reason || ''
        }).trim());
        els.btnApplyAi.disabled = false;
        if (els.aiFollowupPanel) {
            els.aiFollowupPanel.style.display = 'block';
        }
        if (els.aiFollowupStatus) {
            els.aiFollowupStatus.textContent = t('recording_wizard.ai.followup_ready', 'You can ask a follow-up question for more detail.');
        }
    } catch (e) {
        state.aiSuggestion = null;
        state.aiSuggestionPreviewBase64 = null;
        state.aiSuggestionResponseText = '';
        els.aiStatus.textContent = t('recording_wizard.ai.response_unparsed', 'AI response could not be parsed: {text}', { text });
        announce(t('recording_wizard.ai.response_unparsed_announce', 'The AI response could not be understood.'));
    }
}

async function requestAiFollowup() {
    const question = els.aiFollowupQuestion ? els.aiFollowupQuestion.value.trim() : '';
    if (!question) {
        if (els.aiFollowupStatus) {
            els.aiFollowupStatus.textContent = t('recording_wizard.ai.followup_missing_question', 'Please type a follow-up question first.');
        }
        announce(t('recording_wizard.ai.followup_missing_question', 'Please type a follow-up question first.'));
        return;
    }

    if (!state.aiSuggestionPreviewBase64) {
        if (els.aiFollowupStatus) {
            els.aiFollowupStatus.textContent = t('recording_wizard.ai.followup_missing_context', 'Create an AI suggestion first so the follow-up question has context.');
        }
        announce(t('recording_wizard.ai.followup_missing_context', 'Create an AI suggestion first so the follow-up question has context.'));
        return;
    }

    const gemini = await ipcRenderer.invoke('get-gemini-api-data');
    if (!gemini || !gemini.apiKey) {
        if (els.aiFollowupStatus) {
            els.aiFollowupStatus.textContent = t('recording_wizard.ai.gemini_key_missing', 'Gemini API key was not found.');
        }
        announce(t('recording_wizard.ai.gemini_key_missing', 'Gemini API key was not found.'));
        return;
    }

    if (els.btnAiFollowup) {
        els.btnAiFollowup.disabled = true;
    }
    if (els.aiFollowupStatus) {
        els.aiFollowupStatus.textContent = t('recording_wizard.ai.followup_preparing', 'Preparing the follow-up answer...');
    }
    announce(t('recording_wizard.ai.followup_preparing_announce', 'Preparing the follow-up answer.'));

    await new Promise((resolve) => setTimeout(resolve, 250));

    let followupPreviewBase64 = await getObsPreviewBase64();
    if (!followupPreviewBase64) {
        followupPreviewBase64 = state.aiSuggestionPreviewBase64;
    }
    if (!followupPreviewBase64) {
        if (els.aiFollowupStatus) {
            els.aiFollowupStatus.textContent = t('recording_wizard.ai.followup_missing_context', 'Create an AI suggestion first so the follow-up question has context.');
        }
        announce(t('recording_wizard.ai.preview_failed', 'Preview could not be captured.'));
        if (els.btnAiFollowup) {
            els.btnAiFollowup.disabled = false;
        }
        return;
    }

    const currentPreset = getPresetLabel(getSelectedPreset());
    const currentScale = els.camScale ? els.camScale.value : 25;
    const currentPosition = {
        x: parseInt(els.camX?.value, 10) || 0,
        y: parseInt(els.camY?.value, 10) || 0
    };
    const prompt = buildAiFollowupPrompt(question, currentPreset, currentScale, currentPosition, state.aiSuggestion);

    const resp = await ipcRenderer.invoke('gemini-vision-request', {
        apiKey: gemini.apiKey,
        model: gemini.model || 'gemini-2.5-flash',
        imageBase64: followupPreviewBase64,
        prompt,
        history: state.aiSuggestionResponseText ? [
            { role: 'model', content: state.aiSuggestionResponseText }
        ] : [],
        systemInstruction: t('runtime.dialogs.ai_system_instruction', 'Respond only in {lang}. Keep the same response language in follow-up answers.', {
            lang: isTurkishUi() ? 'Turkish' : 'English'
        })
    });

    if (!resp || !resp.success) {
        if (els.aiFollowupStatus) {
            els.aiFollowupStatus.textContent = t('recording_wizard.ai.followup_failed', 'The follow-up answer could not be received: {error}', {
                error: resp?.error || t('recording_wizard.unknown_error', 'Unknown error')
            });
        }
        announce(t('recording_wizard.ai.request_failed_announce', 'An AI error occurred.'));
        if (els.btnAiFollowup) {
            els.btnAiFollowup.disabled = false;
        }
        return;
    }

    const answer = (resp.text || '').trim();
    if (answer) {
        state.aiSuggestionResponseText = answer;
    }
    state.aiSuggestionPreviewBase64 = followupPreviewBase64;
    if (els.aiFollowupStatus) {
        els.aiFollowupStatus.textContent = answer || t('recording_wizard.ai.description_missing', 'Description could not be generated.');
    }
    announce(t('recording_wizard.ai.followup_ready_announce', 'The follow-up answer is ready. {answer}', {
        answer: answer || ''
    }).trim());
    if (els.btnAiFollowup) {
        els.btnAiFollowup.disabled = false;
    }
}

async function requestAiDescription() {
    if (els.aiDescribeStatus) els.aiDescribeStatus.textContent = t('recording_wizard.ai.description_preparing', 'Preparing description...');
    announce(t('recording_wizard.ai.description_preparing', 'Preparing description...'));

    if (!state.screenItemId && state.obsConnected) {
        announce(t('recording_wizard.ai.description_obs_fallback', 'Warning: the OBS source has not been created yet. The description may be generated from the desktop preview.'));
    }

    const gemini = await ipcRenderer.invoke('get-gemini-api-data');
    if (!gemini || !gemini.apiKey) {
        if (els.aiDescribeStatus) els.aiDescribeStatus.textContent = t('recording_wizard.ai.gemini_key_missing', 'Gemini API key was not found.');
        announce(t('recording_wizard.ai.gemini_key_missing', 'Gemini API key was not found.'));
        return;
    }

    let base64 = await getObsPreviewBase64();

    if (!base64) {
        if (els.aiDescribeStatus) els.aiDescribeStatus.textContent = t('recording_wizard.ai.preview_obs_unavailable', 'Preview could not be captured. OBS screenshot was not accessible.');
        announce(t('recording_wizard.ai.preview_failed', 'Preview could not be captured.'));
        return;
    }

    const bgColorElement = document.getElementById('cam-bg-color');
    const selectedBgColorText = getSelectedOptionText(bgColorElement);
    const selectedPanelFillText = getSelectedOptionText(els.camPanelFillColor);

    const currentPresetDesc = getPresetLabel(getSelectedPreset());
    const currentScaleDesc = els.camScale ? els.camScale.value : 25;
    const prompt = buildAiDescriptionPrompt(currentPresetDesc, currentScaleDesc, selectedBgColorText, selectedPanelFillText);

    const resp = await ipcRenderer.invoke('gemini-vision-request', {
        apiKey: gemini.apiKey,
        model: gemini.model || 'gemini-2.5-flash',
        imageBase64: base64,
        prompt,
        history: [],
        systemInstruction: t('runtime.dialogs.ai_system_instruction', 'Respond only in {lang}. Keep the same response language in follow-up answers.', {
            lang: isTurkishUi() ? 'Turkish' : 'English'
        })
    });

    if (!resp || !resp.success) {
        if (els.aiDescribeStatus) els.aiDescribeStatus.textContent = t('recording_wizard.ai.request_failed', 'AI error: {error}', {
            error: resp?.error || t('recording_wizard.unknown_error', 'Unknown error')
        });
        announce(t('recording_wizard.ai.request_failed_announce', 'An AI error occurred.'));
        return;
    }

    const text = (resp.text || '').trim();
    if (els.aiDescribeStatus) {
        els.aiDescribeStatus.textContent = text || t('recording_wizard.ai.description_missing', 'Description could not be generated.');
    }
    if (text) {
        announce(text);
    } else {
        announce(t('recording_wizard.ai.description_missing', 'Description could not be generated.'));
    }
}

async function getObsPreviewBase64() {
    if (state.sceneName) {
        try {
            await ipcRenderer.invoke('obs-ensure-scene', { sceneName: state.sceneName });
        } catch (e) { }
    }
    // Prefer scene screenshot (all layers)
    if (state.sceneName) {
        const sceneShot = await ipcRenderer.invoke('obs-get-source-screenshot', {
            sourceName: state.sceneName,
            width: 1280,
            height: 720,
            format: 'png'
        });
        if (sceneShot && sceneShot.success && sceneShot.imageData) {
            const imageData = sceneShot.imageData;
            return imageData.includes('base64,') ? imageData.split('base64,')[1] : imageData;
        }
    }

    if (state.screenInputName) {
        const shot = await ipcRenderer.invoke('obs-get-source-screenshot', {
            sourceName: state.screenInputName,
            width: 1280,
            height: 720,
            format: 'png'
        });
        if (shot && shot.success && shot.imageData) {
            const imageData = shot.imageData;
            return imageData.includes('base64,') ? imageData.split('base64,')[1] : imageData;
        }
    }
    return null;
}

function setRecordingCameraTestStatus(message, { forceRepeat = false } = {}) {
    if (!els.recordingCameraTestStatus) return;
    clearTimeout(recordingCameraTest.statusRefreshTimer);
    recordingCameraTest.statusRefreshTimer = null;
    const normalizedMessage = String(message || '').trim();
    if (forceRepeat && els.recordingCameraTestStatus.textContent === normalizedMessage) {
        els.recordingCameraTestStatus.textContent = '';
        recordingCameraTest.statusRefreshTimer = window.setTimeout(() => {
            recordingCameraTest.statusRefreshTimer = null;
            els.recordingCameraTestStatus.textContent = normalizedMessage;
        }, 30);
        return;
    }
    els.recordingCameraTestStatus.textContent = normalizedMessage;
}

function getRecordingCameraBrightness(image) {
    if (!image?.naturalWidth || !image?.naturalHeight) return 128;
    if (!recordingCameraTest.canvas) {
        recordingCameraTest.canvas = document.createElement('canvas');
        recordingCameraTest.canvas.width = 64;
        recordingCameraTest.canvas.height = 36;
    }
    const context = recordingCameraTest.canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return 128;
    context.drawImage(image, 0, 0, 64, 36);
    const pixels = context.getImageData(0, 0, 64, 36).data;
    let total = 0;
    for (let index = 0; index < pixels.length; index += 4) {
        total += (pixels[index] * 0.2126) + (pixels[index + 1] * 0.7152) + (pixels[index + 2] * 0.0722);
    }
    return total / Math.max(1, pixels.length / 4);
}

function getRecordingCameraBrightnessResult(brightness) {
    if (brightness < 55) {
        return { signature: 'brightness-low', message: t('broadcast_room.camera_test_brightness_low', 'Işık düşük. Yüzünüzü aydınlatın.') };
    }
    if (brightness > 210) {
        return { signature: 'brightness-high', message: t('broadcast_room.camera_test_brightness_high', 'Işık çok yüksek. Doğrudan ışığı azaltın.') };
    }
    return { signature: 'brightness-normal', message: t('broadcast_room.camera_test_brightness_normal', 'Işık düzeyi uygun.') };
}

function buildRecordingCameraTestAnalysis(result, image) {
    const brightnessResult = getRecordingCameraBrightnessResult(getRecordingCameraBrightness(image));
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
    const frameWidth = Math.max(1, Number(image.naturalWidth) || 1);
    const frameHeight = Math.max(1, Number(image.naturalHeight) || 1);
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

function waitForRecordingCameraImage(image, source) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            image.onload = null;
            image.onerror = null;
        };
        image.onload = () => {
            cleanup();
            resolve();
        };
        image.onerror = () => {
            cleanup();
            reject(new Error('camera_preview_failed'));
        };
        image.src = source;
    });
}

function scheduleRecordingCameraTest(delay = 700) {
    if (!recordingCameraTest.active) return;
    clearTimeout(recordingCameraTest.timer);
    recordingCameraTest.timer = window.setTimeout(runRecordingCameraTestFrame, delay);
}

async function runRecordingCameraTestFrame() {
    if (!recordingCameraTest.active || recordingCameraTest.inFlight || !recordingCameraTest.detector) return;
    recordingCameraTest.inFlight = true;
    try {
        const sourceName = state.cameraInputName || (state.cameraItemId ? 'KVE Kamera' : '');
        const shot = await ipcRenderer.invoke('obs-get-source-screenshot', {
            sourceName,
            width: 640,
            height: 360,
            format: 'png'
        });
        if (!shot?.success || !shot.imageData) {
            throw new Error(shot?.error || 'camera_preview_unavailable');
        }
        const imageSource = String(shot.imageData).startsWith('data:')
            ? shot.imageData
            : `data:image/png;base64,${shot.imageData}`;
        await waitForRecordingCameraImage(els.recordingCameraTestPreview, imageSource);
        const result = recordingCameraTest.detector.detect(els.recordingCameraTestPreview);
        recordingCameraTest.frameFailureCount = 0;
        const analysis = buildRecordingCameraTestAnalysis(result, els.recordingCameraTestPreview);
        recordingCameraTest.lastMessage = analysis.message;
        recordingCameraTest.lastDetailedMessage = analysis.detailedMessage;
        if (analysis.signature === recordingCameraTest.pendingSignature) {
            recordingCameraTest.pendingCount += 1;
        } else {
            recordingCameraTest.pendingSignature = analysis.signature;
            recordingCameraTest.pendingCount = 1;
        }
        const canAnnounce = recordingCameraTest.pendingCount >= 2
            && analysis.signature !== recordingCameraTest.lastAnnouncedSignature
            && Date.now() - recordingCameraTest.lastAnnouncementAt >= 1200;
        if (canAnnounce) {
            recordingCameraTest.lastAnnouncedSignature = analysis.signature;
            recordingCameraTest.lastAnnouncementAt = Date.now();
            setRecordingCameraTestStatus(analysis.message);
        }
    } catch (error) {
        console.warn('Recording camera framing analysis failed:', error);
        recordingCameraTest.frameFailureCount += 1;
        if (recordingCameraTest.frameFailureCount === 3) {
            setRecordingCameraTestStatus(t('broadcast_room.camera_test_failed', 'Kamera testi başlatılamadı: {error}', {
                error: error?.message || error || 'camera_preview_unavailable'
            }));
        }
    } finally {
        recordingCameraTest.inFlight = false;
        scheduleRecordingCameraTest();
    }
}

function cleanupRecordingCameraTest() {
    recordingCameraTest.active = false;
    clearTimeout(recordingCameraTest.timer);
    clearTimeout(recordingCameraTest.statusRefreshTimer);
    recordingCameraTest.timer = null;
    recordingCameraTest.statusRefreshTimer = null;
    recordingCameraTest.inFlight = false;
    if (recordingCameraTest.detector) {
        try { recordingCameraTest.detector.close(); } catch (_error) {}
        recordingCameraTest.detector = null;
    }
    recordingCameraTest.pendingSignature = '';
    recordingCameraTest.pendingCount = 0;
    recordingCameraTest.frameFailureCount = 0;
    if (els.recordingCameraTestPreview) {
        els.recordingCameraTestPreview.removeAttribute('src');
    }
}

function stopRecordingCameraTest({ restoreFocus = true, announceStatus = true } = {}) {
    cleanupRecordingCameraTest();
    if (els.recordingCameraTestDialog?.open) {
        els.recordingCameraTestDialog.close();
    }
    if (announceStatus) {
        announce(t('broadcast_room.camera_test_stopped', 'Kamera ve kadraj testi kapatıldı.'));
    }
    if (restoreFocus) els.btnTestRecordingCamera?.focus();
}

async function startRecordingCameraTest() {
    const sourceName = state.cameraInputName || (state.cameraItemId ? 'KVE Kamera' : '');
    if (!state.cameraItemId || !sourceName) {
        announce(t('recording_wizard.step4.camera_test_source_required', 'Kamera testi için önce Kaynak Seçimi adımında kamera overlayini etkinleştirin ve kamera kaynağını hazırlayın.'));
        return;
    }
    if (!els.recordingCameraTestDialog?.open) els.recordingCameraTestDialog.showModal();
    els.recordingCameraTestTitle?.focus();
    cleanupRecordingCameraTest();
    recordingCameraTest.lastMessage = '';
    recordingCameraTest.lastDetailedMessage = '';
    setRecordingCameraTestStatus(t('broadcast_room.camera_test_starting', 'Kamera ve çevrimdışı kadraj yardımı hazırlanıyor...'));
    try {
        const assets = await ipcRenderer.invoke('virtual-background-assets-ensure');
        if (!assets?.success || !assets.baseUrl) throw new Error('camera_test_assets_unavailable');
        const visionTasks = require('@mediapipe/tasks-vision');
        const vision = await visionTasks.FilesetResolver.forVisionTasks(assets.baseUrl);
        recordingCameraTest.detector = await visionTasks.FaceDetector.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `${assets.baseUrl}/blaze_face_short_range.tflite`,
                delegate: 'CPU'
            },
            runningMode: 'IMAGE',
            minDetectionConfidence: 0.55,
            minSuppressionThreshold: 0.3
        });
        recordingCameraTest.active = true;
        recordingCameraTest.lastAnnouncedSignature = '';
        recordingCameraTest.lastAnnouncementAt = 0;
        setRecordingCameraTestStatus(t('broadcast_room.camera_test_active', 'Kamera açık. Kadraj yardımı yüzünüzü inceliyor.'));
        scheduleRecordingCameraTest(0);
    } catch (error) {
        cleanupRecordingCameraTest();
        setRecordingCameraTestStatus(t('broadcast_room.camera_test_failed', 'Kamera testi başlatılamadı: {error}', {
            error: error?.message || error || 'unknown_error'
        }));
    }
}

function readRecordingCameraTestStatus() {
    const message = recordingCameraTest.lastDetailedMessage
        || recordingCameraTest.lastMessage
        || t('broadcast_room.camera_test_starting', 'Kamera ve çevrimdışı kadraj yardımı hazırlanıyor...');
    setRecordingCameraTestStatus(message, { forceRepeat: true });
}

async function applyAiSuggestion() {
    if (!state.aiSuggestion || !state.cameraItemId) return;
    const cam = state.aiSuggestion.camera || {};
    if (cam.x !== undefined) els.camX.value = Math.round(cam.x);
    if (cam.y !== undefined) els.camY.value = Math.round(cam.y);
    if (cam.scalePercent !== undefined) els.camScale.value = Math.round(cam.scalePercent);
    if (els.camPanelFillColor && typeof state.aiSuggestion.panelFillColor === 'string') {
        const supportedValues = Array.from(els.camPanelFillColor.options).map((option) => option.value);
        if (supportedValues.includes(state.aiSuggestion.panelFillColor)) {
            els.camPanelFillColor.value = state.aiSuggestion.panelFillColor;
        }
    }
    await applyCameraTransformFromInputs();
    announce(t('recording_wizard.ai.suggestion_applied', 'AI suggestion applied.'));
}

function updateBroadcastUi() {
    const isBroadcast = state.mode === 'broadcast';
    const isChatWatchMode = isYouTubeChatWatchLaunchProfile();
    const sessionActive = !!state.recordingActive;
    const isPlanningOnlyMode = isBroadcast && isYouTubePlanningOnlyMode();
    const planningPrepared = isPlanningOnlyMode && !!state.youtubePreparedBroadcastId;
    updateBroadcastMethodUi();
    if (els.broadcastSettingsPanel) {
        els.broadcastSettingsPanel.style.display = isBroadcast ? 'block' : 'none';
    }
    if (els.broadcastWarning) {
        els.broadcastWarning.style.display = 'none';
    }
    if (els.youtubeChatPanel) {
        els.youtubeChatPanel.style.display = isBroadcast ? 'block' : 'none';
    }
    const obsStatsGroup = els.obsStatsSummary ? els.obsStatsSummary.closest('.form-group') : null;
    if (obsStatsGroup) {
        obsStatsGroup.style.display = isChatWatchMode ? 'none' : 'block';
    }
    if (els.liveSettingsPanel) {
        els.liveSettingsPanel.style.display = isChatWatchMode ? 'none' : 'block';
    }
    updateYouTubeModeratorUi();
    if (els.btnSwitchToRecording) {
        els.btnSwitchToRecording.style.display = 'none';
    }
    if (els.btnPauseRecord) {
        const pauseUnavailableForFormat = !isBroadcast && state.recordingFormat !== 'mp4';
        els.btnPauseRecord.disabled = isBroadcast || !sessionActive || pauseUnavailableForFormat;
        els.btnPauseRecord.style.display = isBroadcast ? 'none' : 'inline-block';
    }
    if (els.btnStartRecord) {
        if (isChatWatchMode) {
            els.btnStartRecord.style.display = 'none';
            els.btnStartRecord.disabled = true;
        } else {
            els.btnStartRecord.style.display = 'inline-block';
            const startKey = isBroadcast
                ? (
                    sessionActive
                        ? 'recording_wizard.broadcast.stop_button'
                        : (isPlanningOnlyMode
                            ? (planningPrepared
                                ? 'recording_wizard.broadcast.plan_button_ready'
                                : 'recording_wizard.broadcast.plan_button')
                            : 'recording_wizard.broadcast.start_button')
                )
                : (sessionActive ? 'recording_wizard.recording.stop_button' : 'recording_wizard.recording.start_button');
            const fallback = isBroadcast
                ? (
                    sessionActive
                        ? 'Canli Yayini Durdur (R)'
                        : (isPlanningOnlyMode
                            ? (planningPrepared ? 'Yayin Planlandi' : 'Yayini Planla (R)')
                            : 'Canli Yayini Baslat (R)')
                )
                : (sessionActive ? 'Stop Recording (S)' : 'Start Recording (R)');
            els.btnStartRecord.textContent = t(startKey, fallback);
            els.btnStartRecord.setAttribute('aria-label', t(startKey, fallback));
            els.btnStartRecord.classList.toggle('recording-active', sessionActive);
            els.btnStartRecord.disabled = state.sessionActionInProgress || (planningPrepared && !sessionActive);
        }
    }

    if (els.recordingShortcutsText) {
        const shortcutKey = isChatWatchMode
            ? 'recording_wizard.step6.broadcast_chat_watch_shortcuts_html'
            : (isBroadcast
                ? (isPlanningOnlyMode
                    ? 'recording_wizard.step6.broadcast_plan_shortcuts_html'
                    : 'recording_wizard.step6.broadcast_shortcuts_html')
                : 'recording_wizard.step6.shortcuts_html');
        const shortcutFallback = isChatWatchMode
            ? 'Bu ekrandayken kisayollar: <span class="kbd">Alt+Ctrl+C</span> sohbeti ac/kapat, <span class="kbd">Yukari/Asagi</span> mesajlar arasinda gezin, <span class="kbd">Tab</span> mesaj yazma alanina gec.'
            : (isBroadcast
                ? (isPlanningOnlyMode
                    ? 'Bu ekrandayken (Odaktayken) Kisayollar: <span class="kbd">R</span> yayini planla.'
                    : 'Bu ekrandayken (Odaktayken) Kisayollar: <span class="kbd">R</span> baslat/durdur, <span class="kbd">S</span> durdur.')
                : 'Bu ekrandayken (Odaktayken) Kisayollar: <span class="kbd">R</span> baslat/durdur, <span class="kbd">P</span> duraklat/devam, <span class="kbd">S</span> durdur.');
        els.recordingShortcutsText.innerHTML = t(shortcutKey, shortcutFallback);
    }

    if (els.globalShortcutsInfo) {
        const globalShortcutInfoText = buildGlobalShortcutsInfoText(isBroadcast);
        els.globalShortcutsInfo.value = globalShortcutInfoText;
        els.globalShortcutsInfo.setAttribute('aria-label', globalShortcutInfoText);
    }

    if (els.recordingOutput) {
        els.recordingOutput.style.display = isBroadcast
            ? (state.youtubePreparedWatchUrl ? 'block' : 'none')
            : 'block';
        if (isBroadcast && state.youtubePreparedWatchUrl) {
            els.recordingOutput.textContent = t(
                'recording_wizard.broadcast.watch_link_output',
                'Canli yayin baglantisi: {url}',
                { url: state.youtubePreparedWatchUrl }
            );
        } else if (!isBroadcast && !state.lastOutputPath) {
            els.recordingOutput.textContent = t('recording_wizard.step6.output_default', 'Cikti yolu: -');
        }
    }
    updateBroadcastErrorSummary();
    if (els.btnOpenFolder) {
        els.btnOpenFolder.style.display = isBroadcast ? 'none' : 'inline-block';
        if (isBroadcast) {
            els.btnOpenFolder.disabled = true;
        }
    }
    if (els.btnCopyPath) {
        els.btnCopyPath.style.display = isBroadcast ? 'none' : 'inline-block';
        if (isBroadcast) {
            els.btnCopyPath.disabled = true;
        }
    }
    if (els.btnFinishAdd && isBroadcast) {
        els.btnFinishAdd.style.display = 'none';
        els.btnFinishAdd.disabled = true;
    }
    updateYouTubeChatVisualVisibility();

    if (!sessionActive) {
        els.recordingStatus.textContent = isBroadcast
            ? (planningPrepared
                ? t('recording_wizard.broadcast.planned_ready', 'Planli yayin hazir. Baglantiyi kullanabilirsiniz.')
                : t('recording_wizard.broadcast.ready', 'Canli yayin icin hazir.'))
            : t('recording_wizard.recording.ready', 'Ready.');
    }
}

async function minimizeAppForRecordingStartIfNeeded() {
    if (!state.minimizeOnRecordingStart) {
        return;
    }

    logRecordingWizard('minimize_on_recording_start_requested', {
        mode: state.mode,
        captureMode: state.captureMode
    });
    try {
        const result = await ipcRenderer.invoke('recording-wizard-minimize-app-windows');
        if (!result?.success) {
            throw new Error(result?.error || 'minimize_failed');
        }
        await delay(600);
    } catch (error) {
        console.warn('[RecordingWizard] app minimize before start failed:', error);
        logRecordingWizard('minimize_on_recording_start_failed', {
            error: error?.message || String(error)
        });
        showShortcutTooltip(t(
            'recording_wizard.step6.minimize_on_start_failed',
            'EVD penceresi küçültülemedi, kayıt yine de başlatılıyor.'
        ));
    }
}

async function startRecording() {
    if (state.sessionActionInProgress) return;
    if (state.mode === 'broadcast') {
        if (state.recordingActive) return;
        state.sessionActionInProgress = true;
        try {
            if (isYouTubePlanningOnlyMode()) {
                logRecordingWizard('broadcast_plan_requested', {
                    broadcastPlatform: state.broadcastPlatform || null,
                    youtubeStreamMethod: state.youtubeStreamMethod || null,
                    youtubeApiMode: state.youtubeApiMode || null,
                    youtubeConnected: !!state.youtubeConnected
                });
                state.lastOutputPath = null;
                state.lastBroadcastError = '';
                updateBroadcastErrorSummary();
                state.recordingPaused = false;
                els.recordingStatus.textContent = t('recording_wizard.broadcast.planning', 'Planli YouTube yayini hazirlaniyor...');
                updateBroadcastUi();
                await prepareYouTubeBroadcastFromApi();
                logRecordingWizard('broadcast_plan_prepared', {
                    broadcastId: state.youtubePreparedBroadcastId || null,
                    watchUrl: state.youtubePreparedWatchUrl || null,
                    hasServer: !!state.broadcastServer,
                    hasStreamKey: !!state.broadcastStreamKey
                });
                els.recordingStatus.textContent = t('recording_wizard.broadcast.planned_ready', 'Planli yayin hazir. Baglantiyi kullanabilirsiniz.');
                if (state.youtubePreparedWatchUrl) {
                    clipboard.writeText(state.youtubePreparedWatchUrl);
                    announce(t('recording_wizard.broadcast.youtube_watch_link_copied', 'YouTube baglantisi panoya kopyalandi.'));
                }
                showShortcutTooltip(t('recording_wizard.broadcast.plan_success', 'YouTube yayini planlandi.'));
                return;
            }

            logRecordingWizard('broadcast_start_requested', {
                broadcastPlatform: state.broadcastPlatform || null,
                youtubeStreamMethod: state.youtubeStreamMethod || null,
                youtubeApiMode: state.youtubeApiMode || null,
                youtubeConnected: !!state.youtubeConnected
            });
            const introSlot = getConfiguredLiveEffectSlot('intro');
            logRecordingWizard('broadcast_intro_slot_resolved', {
                hasIntroSlot: !!introSlot,
                introSlotId: introSlot?.id || null,
                introSlotType: introSlot?.type || null
            });
            await resetLiveEffectsSession({ removeObsVideo: !(introSlot && introSlot.type === 'video') });
            state.lastOutputPath = null;
            state.lastBroadcastError = '';
            updateBroadcastErrorSummary();
            state.recordingPaused = false;
            els.recordingStatus.textContent = t('recording_wizard.broadcast.connecting', 'Canli yayin baglantisi kuruluyor...');
            updateBroadcastUi();
            if (isYouTubeApiMode()) {
                await prepareYouTubeBroadcastFromApi();
                logRecordingWizard('broadcast_youtube_prepared', {
                    broadcastId: state.youtubePreparedBroadcastId || null,
                    watchUrl: state.youtubePreparedWatchUrl || null,
                    hasServer: !!state.broadcastServer,
                    hasStreamKey: !!state.broadcastStreamKey
                });
            }
            await applyBroadcastSettings();
            logRecordingWizard('broadcast_settings_applied', {
                broadcastPlatform: state.broadcastPlatform || null,
                hasServer: !!state.broadcastServer,
                hasStreamKey: !!state.broadcastStreamKey
            });
            await minimizeAppForRecordingStartIfNeeded();
            const result = await ipcRenderer.invoke('obs-start-streaming');
            logRecordingWizard('broadcast_obs_start_result', {
                success: !!result?.success,
                error: result?.error || null,
                outputActive: result?.status?.outputActive ?? null,
                outputReconnecting: result?.status?.outputReconnecting ?? null
            });
            if (!result.success) {
                throw new Error(formatBroadcastStartFailure(result) || result.error || t('recording_wizard.broadcast.start_failed_generic', 'Canli yayin baslatilamadi.'));
            }
            if (isYouTubeApiMode() && state.youtubePreparedBroadcastId) {
                await ipcRenderer.invoke('youtube-save-active-live-broadcast', {
                    broadcastId: state.youtubePreparedBroadcastId,
                    title: state.youtubePreparedBroadcastTitle || '',
                    watchUrl: state.youtubePreparedWatchUrl || '',
                    source: 'recording-wizard'
                }).catch(() => { });
                const liveResponse = await ipcRenderer.invoke('youtube-transition-broadcast-live', {
                    broadcastId: state.youtubePreparedBroadcastId
                });
                logRecordingWizard('broadcast_youtube_transition_result', {
                    success: !!liveResponse?.success,
                    error: liveResponse?.error || null,
                    lifeCycleStatus: liveResponse?.broadcast?.lifeCycleStatus || null,
                    watchUrl: state.youtubePreparedWatchUrl || null
                });
                if (!liveResponse.success) {
                    console.warn('YouTube live transition failed:', liveResponse.error);
                    const transitionError = formatYouTubeBroadcastSetupError(liveResponse);
                    syncYoutubeStatusText('recording_wizard.broadcast.youtube_live_transition_failed', 'Yayin OBS tarafinda basladi ancak YouTube yayina gecis adimi tamamlanamadi: {error}', {
                        error: transitionError || t('recording_wizard.unknown_error', 'Unknown error')
                    });
                    showShortcutTooltip(t('recording_wizard.broadcast.youtube_live_transition_failed', 'Yayin OBS tarafinda basladi ancak YouTube yayina gecis adimi tamamlanamadi: {error}', {
                        error: transitionError || t('recording_wizard.unknown_error', 'Unknown error')
                    }));
                } else {
                    syncYoutubeStatusText('recording_wizard.broadcast.youtube_live_transition_ok', 'YouTube yayini canli duruma gecti: {title}', {
                        title: state.youtubePreparedBroadcastTitle || t('recording_wizard.broadcast.youtube_untitled', 'Adsiz yayin')
                    });
                }
            }
            state.recordingActive = true;
            state.streamingActive = true;
            state.lastBroadcastError = '';
            updateBroadcastErrorSummary();
            await ensureYouTubeChatSessionLoaded();
            await pollYouTubeChatMessages({ initial: true });
            await syncRecordingWizardSession();
            els.recordingStatus.textContent = t('recording_wizard.broadcast.in_progress', 'Canli yayin devam ediyor...');
            updateBroadcastUi();
            if (state.youtubePreparedWatchUrl) {
                clipboard.writeText(state.youtubePreparedWatchUrl);
                announce(t('recording_wizard.broadcast.youtube_watch_link_copied', 'YouTube baglantisi panoya kopyalandi.'));
            }
            if (introSlot && introSlot.sourcePath) {
                await waitForStreamingOutputReady();
                logRecordingWizard('broadcast_intro_slot_playing', {
                    introSlotId: introSlot.id,
                    introSlotType: introSlot.type || null
                });
                await playLiveEffectSlot(introSlot, {
                    announceSelection: false,
                    forceLoop: false,
                    waitForCompletion: false
                });
            }
            showShortcutTooltip(t('recording_wizard.broadcast.started', 'Canli yayin basladi.'));
        } catch (error) {
            const isPlanningOnlyMode = isYouTubePlanningOnlyMode();
            const detailedMessage = isPlanningOnlyMode
                ? t('recording_wizard.broadcast.plan_failed', 'Yayin planlanamadi: {error}', {
                    error: error.message || error
                })
                : t('recording_wizard.broadcast.start_failed', 'Canli yayin baslatilamadi: {error}', {
                    error: error.message || error
                });
            logRecordingWizard(isPlanningOnlyMode ? 'broadcast_plan_failed' : 'broadcast_start_failed', {
                error: error?.message || String(error)
            });
            state.lastBroadcastError = error?.message || String(error);
            updateBroadcastErrorSummary();
            els.recordingStatus.textContent = detailedMessage;
            showShortcutTooltip(detailedMessage);
        } finally {
            state.sessionActionInProgress = false;
            if (!(state.mode === 'broadcast' && !state.recordingActive && els.recordingStatus && /planlanamadi|baslatilamadi|could not|konnte nicht|no se pudo|n a pas pu/i.test(els.recordingStatus.textContent || ''))) {
                updateBroadcastUi();
            } else if (els.btnStartRecord) {
                els.btnStartRecord.disabled = false;
            }
        }
        return;
    }
    if (state.recordingActive) return;
    state.sessionActionInProgress = true;
    try {
        await ipcRenderer.invoke('obs-remove-live-chat-overlay', {
            sceneName: state.sceneName
        }).catch(() => { });
        state.youtubeChatPanelOpen = false;
        updateYouTubeChatVisualVisibility();
        logRecordingWizard('recording_start_requested', {
            recordingFormat: state.recordingFormat || 'mp4',
            liveEffectsEnabled: !!state.liveEffectsEnabled,
            liveEffectsProfileId: state.liveEffectsProfileId || null
        });
        console.log('[RecordingWizard] Starting recording with format:', state.recordingFormat || 'mp4');
        await ipcRenderer.invoke('obs-set-recording-format', { format: state.recordingFormat || 'mp4' });

        const introSlot = getConfiguredLiveEffectSlot('intro');
        logRecordingWizard('recording_intro_slot_resolved', {
            hasIntroSlot: !!introSlot,
            introSlotId: introSlot?.id || null,
            introSlotType: introSlot?.type || null
        });
        await resetLiveEffectsSession({ removeObsVideo: !(introSlot && introSlot.type === 'video') });
        if (introSlot && introSlot.sourcePath && introSlot.type === 'video') {
            await syncLiveEffectVisual(introSlot, { visible: false, restart: false });
        }

        await startRecordingAudioKeepAlive();
        await minimizeAppForRecordingStartIfNeeded();
        const result = await ipcRenderer.invoke('obs-start-recording');
        logRecordingWizard('recording_start_result', {
            success: !!result?.success,
            outputActive: result?.outputActive ?? null,
            outputPath: result?.outputPath ?? null,
            error: result?.error ?? null
        });
        if (!result.success) {
            console.error('[RecordingWizard] obs-start-recording failed:', result.error);
            els.recordingStatus.textContent = t('recording_wizard.recording.start_failed', 'Error: {error}', { error: result.error });
            announce(t('recording_wizard.recording.start_failed_announce', 'Recording could not be started: {error}', { error: result.error }));
            els.btnStartRecord.disabled = false;
            await stopRecordingAudioKeepAlive('recording_start_failed');
            return;
        }
        state.recordingActive = true;
        state.recordingPaused = false;
        startRecordingTimelineLogger('recording_started');
        els.recordingStatus.textContent = t('recording_wizard.recording.in_progress', 'Recording is in progress...');

        // Update Toggle Button
        if (els.btnStartRecord) {
            els.btnStartRecord.textContent = t('recording_wizard.recording.stop_button', 'Stop Recording (S)');
            els.btnStartRecord.classList.add('recording-active');
            els.btnStartRecord.setAttribute('aria-label', t('recording_wizard.recording.stop_button', 'Stop Recording (S)'));
        }

        if (els.btnPauseRecord) els.btnPauseRecord.disabled = state.recordingFormat !== 'mp4';

        // Sync Live Settings Checkbox
        const liveChk = document.getElementById('live-system-audio-check');
        if (liveChk) {
            liveChk.checked = !!state.systemInputName; // If source exists, assume enabled initially (unmuted)
        }

        if (introSlot && introSlot.sourcePath) {
            await waitForRecordingTimelineReady();
            logRecordingWizard('recording_intro_slot_playing', {
                introSlotId: introSlot.id,
                introSlotType: introSlot.type || null
            });
            await playLiveEffectSlot(introSlot, {
                announceSelection: false,
                forceLoop: false,
                waitForCompletion: false
            });
        }

        announce(t('recording_wizard.recording.started', 'Recording started.'));
    } catch (error) {
        console.error('[RecordingWizard] startRecording exception:', error);
        logRecordingWizard('recording_start_exception', {
            error: error.message || String(error)
        });
        els.recordingStatus.textContent = t('recording_wizard.recording.start_failed', 'Error: {error}', {
            error: error.message || error
        });
        announce(t('recording_wizard.recording.start_failed_announce', 'Recording could not be started: {error}', {
            error: error.message || error
        }));
        if (els.btnStartRecord) {
            els.btnStartRecord.disabled = false;
        }
        await stopRecordingAudioKeepAlive('recording_start_exception');
    } finally {
        state.sessionActionInProgress = false;
    }
}

async function togglePause() {
    if (state.sessionActionInProgress) return;
    if (!state.recordingActive) return;
    if (state.mode === 'broadcast') {
        showShortcutTooltip(t('recording_wizard.broadcast.pause_unavailable', 'Canli yayin sirasinda duraklatma kullanilamaz.'));
        return;
    }
    state.sessionActionInProgress = true;
    try {
        if (!state.recordingPaused) {
            const result = await ipcRenderer.invoke('obs-pause-recording');
            if (result.success) {
                state.recordingPaused = true;
                els.recordingStatus.textContent = t('recording_wizard.recording.paused', 'Recording paused.');
                showShortcutTooltip(t('recording_wizard.recording.paused', 'Recording paused.'));
            } else {
                console.error('Pause failed:', result.error);
                showShortcutTooltip(t('recording_wizard.recording.pause_failed', 'Could not pause: {error}', {
                    error: result.error || t('recording_wizard.unknown_error', 'Unknown error')
                }));
            }
        } else {
            const result = await ipcRenderer.invoke('obs-resume-recording');
            if (result.success) {
                state.recordingPaused = false;
                els.recordingStatus.textContent = t('recording_wizard.recording.resumed', 'Recording resumed.');
                playAccessBeep('start');
            } else {
                console.error('Resume failed:', result.error);
                showShortcutTooltip(t('recording_wizard.recording.resume_failed', 'Could not resume: {error}', {
                    error: result.error || t('recording_wizard.unknown_error', 'Unknown error')
                }));
            }
        }
    } finally {
        state.sessionActionInProgress = false;
    }
}

async function stopRecording() {
    if (state.sessionActionInProgress) return;
    if (!state.recordingActive) return;
    state.sessionActionInProgress = true;
    try {
        logRecordingWizard('recording_stop_requested', {
            liveEffectsEnabled: !!state.liveEffectsEnabled,
            activeLiveEffectSlotId: state.activeLiveEffectSlotId || null
        });
        if (state.mode === 'broadcast') {
            const outroSlot = getConfiguredLiveEffectSlot('outro');
            logRecordingWizard('broadcast_outro_slot_resolved', {
                hasOutroSlot: !!outroSlot,
                outroSlotId: outroSlot?.id || null,
                outroSlotType: outroSlot?.type || null
            });
            if (outroSlot && outroSlot.sourcePath) {
                els.recordingStatus.textContent = t(
                    'recording_wizard.recording.outro_playing',
                    'Bitis efekti caliyor, kayit tamamlaninca otomatik duracak...'
                );
                await playLiveEffectSlot(outroSlot, {
                    announceSelection: false,
                    forceLoop: false,
                    waitForCompletion: true
                });
            }
            const result = await ipcRenderer.invoke('obs-stop-streaming');
            if (!result.success) {
                els.recordingStatus.textContent = t('recording_wizard.broadcast.stop_failed', 'Canli yayin durdurulamadi: {error}', { error: result.error });
                showShortcutTooltip(t('recording_wizard.broadcast.stop_failed_short', 'Canli yayin durdurulamadi.'));
                return;
            }
            if (isYouTubeApiMode() && state.youtubePreparedBroadcastId) {
                const completeResponse = await ipcRenderer.invoke('youtube-complete-broadcast', {
                    broadcastId: state.youtubePreparedBroadcastId
                });
                if (!completeResponse.success) {
                    console.warn('YouTube complete transition failed:', completeResponse.error);
                    const completeError = formatYouTubeBroadcastSetupError(completeResponse);
                    syncYoutubeStatusText('recording_wizard.broadcast.stop_failed', 'Canli yayin durdurulamadi: {error}', { error: completeError });
                    showShortcutTooltip(t('recording_wizard.broadcast.stop_failed', 'Canli yayin durdurulamadi: {error}', { error: completeError }));
                }
            }
            state.recordingActive = false;
            state.recordingPaused = false;
            state.streamingActive = false;
            resetYouTubeChatState();
            await resetLiveEffectsSession();
            clearPreparedYouTubeBroadcast();
            await syncRecordingWizardSession(true);
            els.recordingStatus.textContent = t('recording_wizard.broadcast.stopped', 'Canli yayin durduruldu.');
            updateBroadcastUi();
            showShortcutTooltip(t('recording_wizard.broadcast.stopped', 'Canli yayin durduruldu.'));
            return;
        }

        const outroSlot = getConfiguredLiveEffectSlot('outro');
        logRecordingWizard('recording_outro_slot_resolved', {
            hasOutroSlot: !!outroSlot,
            outroSlotId: outroSlot?.id || null,
            outroSlotType: outroSlot?.type || null
        });
        if (outroSlot && outroSlot.sourcePath) {
            els.recordingStatus.textContent = t(
                'recording_wizard.recording.outro_playing',
                'Bitis efekti caliyor, kayit tamamlaninca otomatik duracak...'
            );
            await playLiveEffectSlot(outroSlot, {
                announceSelection: false,
                forceLoop: false,
                waitForCompletion: true
            });
        }

        const result = await ipcRenderer.invoke('obs-stop-recording');
        logRecordingWizard('recording_stop_result', {
            success: !!result?.success,
            outputPath: result?.outputPath ?? null,
            error: result?.error ?? null
        });
        if (!result.success) {
            els.recordingStatus.textContent = t('recording_wizard.recording.stop_failed', 'Could not stop recording: {error}', { error: result.error });
            showShortcutTooltip(t('recording_wizard.recording.stop_failed_short', 'Stopping the recording failed: {error}', { error: result.error }));
            return;
        }
        state.recordingActive = false;
        state.recordingPaused = false;
        state.lastOutputPath = result.outputPath || null;
        await stopRecordingAudioKeepAlive('recording_stopped');
        await resetLiveEffectsSession();

        if (els.btnStartRecord) {
            els.btnStartRecord.textContent = t('recording_wizard.recording.start_button', 'Start Recording (R)');
            els.btnStartRecord.classList.remove('recording-active');
            els.btnStartRecord.setAttribute('aria-label', t('recording_wizard.recording.start_button', 'Start Recording (R)'));
        }

        if (els.btnPauseRecord) els.btnPauseRecord.disabled = true;
        if (els.btnStopRecord) els.btnStopRecord.disabled = true;

        if (state.lastOutputPath) {
            els.recordingOutput.textContent = t('recording_wizard.recording.output_path', 'Output path: {path}', { path: state.lastOutputPath });
            els.btnOpenFolder.disabled = false;
            els.btnCopyPath.disabled = false;

            const showFinishButton = () => {
                if (els.btnFinishAdd) {
                    els.btnFinishAdd.style.display = 'inline-block';
                    els.btnFinishAdd.disabled = false;
                }
            };

            if (state.lastOutputPath.endsWith('.mkv') && state.recordingFormat === 'mp4') {
                els.recordingStatus.textContent = t('recording_wizard.recording.remuxing', 'Recording stopped, converting to MP4...');
                showShortcutTooltip(t('recording_wizard.recording.remuxing_tooltip', 'Recording stopped. Converting to MP4.'));

                try {
                    const remuxResult = await ipcRenderer.invoke('ffmpeg-remux', {
                        inputPath: state.lastOutputPath,
                        targetFormat: 'mp4'
                    });

                    if (remuxResult.success && remuxResult.outputPath) {
                        state.lastOutputPath = remuxResult.outputPath;
                        els.recordingStatus.textContent = t('recording_wizard.recording.remux_done', 'Conversion completed.');
                        els.recordingOutput.textContent = t('recording_wizard.recording.output_path', 'Output path: {path}', { path: state.lastOutputPath });
                        setTimeout(() => announce(t('recording_wizard.recording.remux_done_announce', 'MP4 conversion completed.')), 3500);
                    } else {
                        els.recordingStatus.textContent = t('recording_wizard.recording.remux_failed', 'Conversion failed.');
                        setTimeout(() => announce(t('recording_wizard.recording.remux_failed_announce', 'Conversion failed, the MKV file was kept.')), 3500);
                    }
                } catch (e) {
                    console.error('Remux error:', e);
                    els.recordingStatus.textContent = t('recording_wizard.recording.remux_error', 'Conversion error.');
                }
                showFinishButton();
            } else {
                showFinishButton();
            }
        } else {
            els.recordingStatus.textContent = t('recording_wizard.recording.stopped', 'Recording stopped.');
            showShortcutTooltip(t('recording_wizard.recording.stopped', 'Recording stopped.'));
        }
    } finally {
        clearRecordingTimelineLogger();
        state.sessionActionInProgress = false;
    }
}

init().catch((e) => {
    console.error('Init failed:', e);
    if (els.obsDetectStatus) {
        els.obsDetectStatus.textContent = t('recording_wizard.status.init_failed', 'Wizard could not be started: {error}', {
            error: e.message || e
        });
    }
});

// Failsafe: ensure global hooks exist even if init fails
window.__kveNext = window.__kveNext || ((e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    showStep(state.stepIndex + 1);
});
window.__kveForceNext = window.__kveForceNext || ((e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    showStep(state.stepIndex + 1);
});
window.__kveBack = window.__kveBack || ((e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    onBack();
});

// Export functions to window for direct HTML access (Failsafe)
window.applySelectedPreset = applySelectedPreset;
window.updateManualPresetLabel = updateManualPresetLabel;
window.updateObsStatsSummary = updateObsStatsSummary;
window.startRecording = startRecording;
window.stopRecording = stopRecording;
window.togglePause = togglePause;
window.toggleRecording = async () => {
    if (state.recordingActive) await stopRecording();
    else await startRecording();
};
window.requestAiSuggestion = requestAiSuggestion;
window.requestAiFollowup = requestAiFollowup;
window.applyAiSuggestion = applyAiSuggestion;
window.requestAiDescription = requestAiDescription;
window.refreshSources = refreshSources;
window.refreshDevices = refreshDevices;
window.requestCameraPermission = requestCameraPermission;

window.addEventListener('beforeunload', () => {
    cleanupRecordingCameraTest();
    clearRecordingTimelineLogger();
    clearObsStatsPolling();
    stopYouTubeChatPolling();
    if (!state.recordingActive || state.mode !== 'broadcast') {
        ipcRenderer.invoke('recording-wizard-set-active-session', null).catch(() => { });
    }
});

// Live Settings Functions for direct HTML access
window.applyLiveLayout = () => {
    const radios = document.querySelectorAll('input[name="live-layout"]');
    const selected = Array.from(radios).find(r => r.checked);
    if (selected) {
        const val = selected.value;
        console.log('Live layout selected:', val);
        setSelectedPreset(val);
        announce(t('recording_wizard.layout.applying_announce', 'Applying layout: {layout}', {
            layout: getPresetLabel(val)
        }));
        applySelectedPreset(val);
    } else {
        console.warn('No live layout selected');
        announce(t('recording_wizard.step6.live_selection_failed', 'Selection could not be completed.'));
    }
};

window.applyLiveWindow = async () => {
    const selectedValue = els.liveWindowSelect ? els.liveWindowSelect.value : '';
    const selectedIndex = state.selectedWindows.findIndex((windowItem) => (windowItem.id || windowItem.name) === selectedValue);
    if (selectedIndex < 0) {
        announce(t('recording_wizard.step6.live_window_selection_failed', 'Aktif pencere secilemedi.'));
        return;
    }
    await activateSelectedWindow(selectedIndex, { announceChange: true });
};

window.toggleLiveSystemAudio = async (chk) => {
    const enabled = chk.checked;
    // Sync with main checkbox if exists
    if (els.systemAudioEnable) els.systemAudioEnable.checked = enabled;

    if (state.systemInputName) {
        await ipcRenderer.invoke('obs-set-input-mute', {
            inputName: state.systemInputName,
            muted: !enabled
        });
        announce(enabled
            ? t('recording_wizard.step6.system_audio_enabled', 'System audio enabled.')
            : t('recording_wizard.step6.system_audio_disabled', 'System audio disabled.'));
    } else {
        announce(t('recording_wizard.step6.system_audio_missing', 'There is no system audio source. It may not have been selected during setup.'));
        chk.checked = false; // Revert check
    }
};

window.setLiveVolume = async (sourceType, val) => {
    const volPercent = parseInt(val, 10);
    let sourceName = null;

    if (sourceType === 'mic') {
        sourceName = state.micInputName;
        if (els.micVolume) {
            els.micVolume.value = String(volPercent);
        }
    }
    if (sourceType === 'system') {
        sourceName = state.systemInputName;
        if (els.systemVolume) {
            els.systemVolume.value = String(volPercent);
        }
    }
    updateAudioVolumeLabels();
    syncLiveAudioControlsFromMain();

    if (sourceName) {
        state.lastVolPercent = volPercent; // Store for debounce if needed
        await ipcRenderer.invoke('obs-set-input-volume', { inputName: sourceName, volumePercent: volPercent });
    }
};

/* Global Shortcuts Logic */
function playAccessBeep(type) {
    return new Promise((resolve) => {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            let durationSeconds = 0.1;

            osc.connect(gain);
            gain.connect(ctx.destination);

            if (type === 'start') {
                osc.frequency.setValueAtTime(800, ctx.currentTime);
                osc.type = 'sine';
                gain.gain.setValueAtTime(0.1, ctx.currentTime);
                durationSeconds = 0.15;
            } else if (type === 'stop') {
                osc.frequency.setValueAtTime(300, ctx.currentTime);
                osc.type = 'sine';
                gain.gain.setValueAtTime(0.1, ctx.currentTime);
                durationSeconds = 0.3;
            } else if (type === 'chime') {
                osc.frequency.setValueAtTime(1200, ctx.currentTime);
                osc.type = 'triangle';
                gain.gain.setValueAtTime(0.05, ctx.currentTime);
                durationSeconds = 0.1;
            }

            osc.onended = () => {
                try {
                    ctx.close().catch(() => {});
                } catch (error) { }
                resolve();
            };

            osc.start();
            osc.stop(ctx.currentTime + durationSeconds);
        } catch (e) {
            resolve();
        }
    });
}

const RECORDING_GLOBAL_SHORTCUT_ACTIONS = {
    recordingGlobalStartStop: 'Alt+Ctrl+R',
    recordingGlobalPauseResume: 'Alt+Ctrl+P',
    recordingGlobalToggleSystemAudio: 'Alt+Ctrl+H',
    recordingGlobalToggleMicrophone: 'Alt+Ctrl+M',
    recordingGlobalOpenChat: 'Alt+Ctrl+C',
    recordingGlobalToggleLiveEffects: 'Alt+Ctrl+Space',
    recordingGlobalFullscreenCamera: 'Alt+Ctrl+K',
    recordingGlobalRestoreLayout: 'Alt+Ctrl+J',
    recordingGlobalHideScreen: 'Alt+Ctrl+L',
    recordingGlobalPreviousWindow: 'Alt+Ctrl+U',
    recordingGlobalNextWindow: 'Alt+Ctrl+O',
    recordingGlobalWindowList: 'Alt+Ctrl+I'
};

function getStoredUserKeymap() {
    try {
        const rawSettings = localStorage.getItem('korculVideoEditorSettings');
        if (!rawSettings) return {};
        const parsed = JSON.parse(rawSettings);
        return parsed && typeof parsed.userKeymap === 'object' && parsed.userKeymap !== null
            ? parsed.userKeymap
            : {};
    } catch (error) {
        console.warn('recording shortcut settings could not be read:', error.message);
        return {};
    }
}

function getRecordingGlobalShortcutBinding(actionId) {
    const userKeymap = getStoredUserKeymap();
    if (userKeymap[actionId] !== undefined) {
        return userKeymap[actionId] || null;
    }
    return RECORDING_GLOBAL_SHORTCUT_ACTIONS[actionId] || null;
}

function normalizeGlobalShortcutAccelerator(accelerator) {
    if (!accelerator) return null;
    return accelerator
        .replace(/\bCommandOrControl\b/g, 'Control')
        .replace(/\bCmdOrCtrl\b/g, 'Control')
        .replace(/\bCtrl\b/g, 'Control')
        .replace(/\bCmd\b/g, 'Command')
        .replace(/\bOption\b/g, 'Alt')
        .replace(/\bMeta\b/g, 'Super');
}

function formatGlobalShortcutForDisplay(accelerator) {
    if (!accelerator) return '';
    return accelerator
        .replace(/\bCommandOrControl\b/g, 'Ctrl')
        .replace(/\bControl\b/g, 'Ctrl')
        .replace(/\bCommand\b/g, 'Cmd')
        .replace(/\bSuper\b/g, 'Meta');
}

function getRecordingGlobalShortcutBindings() {
    return Object.entries(RECORDING_GLOBAL_SHORTCUT_ACTIONS).reduce((acc, [actionId]) => {
        acc[actionId] = getRecordingGlobalShortcutBinding(actionId);
        return acc;
    }, {});
}

function getRecordingGlobalShortcutActionMap() {
    const bindings = getRecordingGlobalShortcutBindings();
    return Object.entries(bindings).reduce((acc, [actionId, binding]) => {
        const normalized = normalizeGlobalShortcutAccelerator(binding);
        if (normalized) {
            acc[normalized] = actionId;
        }
        return acc;
    }, {});
}

function getRecordingGlobalShortcutLabel(actionId) {
    const labelKey = `dialog.keyboard_manager.actions.${actionId}`;
    const fallbackMap = {
        recordingGlobalStartStop: 'Start or Stop Recording or Broadcast',
        recordingGlobalPauseResume: 'Pause or Resume Recording',
        recordingGlobalToggleSystemAudio: 'Toggle System Audio',
        recordingGlobalToggleMicrophone: 'Toggle Microphone',
        recordingGlobalOpenChat: 'Toggle Live Chat',
        recordingGlobalToggleLiveEffects: 'Toggle Live Effects Layer',
        recordingGlobalFullscreenCamera: 'Make Camera Fullscreen',
        recordingGlobalRestoreLayout: 'Restore Previous Layout',
        recordingGlobalHideScreen: 'Hide or Restore Screen',
        recordingGlobalPreviousWindow: 'Previous Window',
        recordingGlobalNextWindow: 'Next Window',
        recordingGlobalWindowList: 'Open Window List'
    };
    return t(labelKey, fallbackMap[actionId] || actionId);
}

function buildGlobalShortcutsInfoText(isBroadcast) {
    const orderedActionIds = isBroadcast
        ? [
            'recordingGlobalStartStop',
            'recordingGlobalToggleMicrophone',
            'recordingGlobalToggleSystemAudio',
            'recordingGlobalOpenChat',
            'recordingGlobalToggleLiveEffects',
            'recordingGlobalFullscreenCamera',
            'recordingGlobalRestoreLayout',
            'recordingGlobalHideScreen',
            'recordingGlobalPreviousWindow',
            'recordingGlobalNextWindow',
            'recordingGlobalWindowList'
        ]
        : [
            'recordingGlobalStartStop',
            'recordingGlobalPauseResume',
            'recordingGlobalToggleMicrophone',
            'recordingGlobalToggleSystemAudio',
            'recordingGlobalOpenChat',
            'recordingGlobalToggleLiveEffects',
            'recordingGlobalFullscreenCamera',
            'recordingGlobalRestoreLayout',
            'recordingGlobalHideScreen',
            'recordingGlobalPreviousWindow',
            'recordingGlobalNextWindow',
            'recordingGlobalWindowList'
        ];

    const lines = orderedActionIds
        .map((actionId) => {
            const binding = getRecordingGlobalShortcutBinding(actionId);
            if (!binding) return null;
            return `${formatGlobalShortcutForDisplay(binding)}: ${getRecordingGlobalShortcutLabel(actionId)}`;
        })
        .filter(Boolean);

    if (lines.length === 0) {
        return t(
            'recording_wizard.shortcuts.no_global_shortcuts',
            'No global recording shortcuts are currently assigned.'
        );
    }

    return lines.join('\n');
}

window.registerRecordingShortcuts = function () {
    const actionBindings = Object.entries(getRecordingGlobalShortcutBindings())
        .map(([actionId, binding]) => ({
            actionId,
            accelerator: normalizeGlobalShortcutAccelerator(binding)
        }))
        .filter((entry) => !!entry.accelerator);

    const mergedBindings = new Map();
    actionBindings.forEach(({ actionId, accelerator }) => {
        const existing = mergedBindings.get(accelerator) || {
            accelerator,
            focusWindowOnTrigger: false
        };
        if (actionId === 'recordingGlobalToggleLiveEffects') {
            existing.focusWindowOnTrigger = true;
        }
        mergedBindings.set(accelerator, existing);
    });

    mergedBindings.forEach((registration) => {
        ipcRenderer.invoke('register-global-shortcut', registration);
    });
};

window.unregisterRecordingShortcuts = function () {
    ipcRenderer.invoke('unregister-all-global-shortcuts');
};

window.addEventListener('beforeunload', () => {
    clearRecordingTimelineLogger();
    stopYouTubeChatPolling();
    resetLiveEffectsSession().catch(() => {});
    window.unregisterRecordingShortcuts();
});

function showShortcutTooltip(message, { speak = true } = {}) {
    let tooltip = document.getElementById('shortcut-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'shortcut-tooltip';
        tooltip.setAttribute('role', 'alert');
        tooltip.setAttribute('aria-live', 'assertive');
        Object.assign(tooltip.style, {
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            color: '#fff',
            padding: '12px 24px',
            borderRadius: '8px',
            zIndex: '999999',
            fontSize: '16px',
            pointerEvents: 'none',
            opacity: '0',
            transition: 'opacity 0.2s',
            boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
            border: '1px solid #444'
        });
        document.body.appendChild(tooltip);
    }

    // Değişikliğin NVDA tarafından algılanması için önce içeriği temizleyip sonra yazıyoruz
    tooltip.textContent = '';
    setTimeout(() => {
        tooltip.textContent = message;
        tooltip.style.opacity = '1';
    }, 50);

    if (speak) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(message);
        u.lang = getSpeechLocale();
        u.rate = 1.3;
        window.speechSynthesis.speak(u);
    }

    if (tooltip._timeout) clearTimeout(tooltip._timeout);
    tooltip._timeout = setTimeout(() => {
        tooltip.style.opacity = '0';
    }, 3000);
}

ipcRenderer.on('global-shortcut-triggered', async (event, accelerator) => {
    const actionId = getRecordingGlobalShortcutActionMap()[accelerator] || getRecordingGlobalShortcutActionMap()[normalizeGlobalShortcutAccelerator(accelerator)];
    switch (actionId) {
        case 'recordingGlobalStartStop':
            if (state.recordingActive) {
                stopRecording();
            } else {
                await playAccessBeep('start');
                await new Promise((resolve) => setTimeout(resolve, 50));
                startRecording();
                // Sadece ses, mesaj yok (kullanıcı talebi)
            }
            break;
        case 'recordingGlobalPauseResume':
            if (!state.recordingActive) {
                showShortcutTooltip(t('recording_wizard.shortcuts.pause_without_recording', 'Recording has not started yet, so it cannot be paused.'));
                break;
            }
            if (state.mode === 'broadcast') {
                showShortcutTooltip(t('recording_wizard.broadcast.pause_unavailable', 'Canli yayin sirasinda duraklatma kullanilamaz.'));
                break;
            }
            // `togglePause` fonksiyonu tüm devam et/duraklat ve sesli bildirimleri ele alacak
            await togglePause();
            break;
        case 'recordingGlobalToggleMicrophone':
            if (state.micInputName) {
                state.isMicMuted = !state.isMicMuted;
                await ipcRenderer.invoke('obs-set-input-mute', { inputName: state.micInputName, muted: state.isMicMuted });
                if (state.isMicMuted) {
                    showShortcutTooltip(t('recording_wizard.shortcuts.mic_muted', 'Microphone muted.'));
                } else {
                    playAccessBeep('chime');
                }
            } else {
                showShortcutTooltip(t('recording_wizard.shortcuts.mic_missing', 'The microphone was not detected or included.'));
            }
            break;
        case 'recordingGlobalToggleSystemAudio':
            if (state.systemInputName) {
                state.isSystemMuted = !state.isSystemMuted;
                await ipcRenderer.invoke('obs-set-input-mute', { inputName: state.systemInputName, muted: state.isSystemMuted });
                if (state.isSystemMuted) {
                    showShortcutTooltip(t('recording_wizard.shortcuts.system_muted', 'System audio muted.'));
                } else {
                    playAccessBeep('chime');
                }
            } else {
                showShortcutTooltip(t('recording_wizard.shortcuts.system_missing', 'System audio was not selected as a source.'));
            }
            break;
        case 'recordingGlobalOpenChat':
            if (state.mode !== 'broadcast') {
                showShortcutTooltip(t('recording_wizard.chat.open_unavailable', 'Canlı sohbet yalnızca yayın modunda kullanılabilir.'), { speak: false });
                break;
            }
            if (state.youtubeChatPanelOpen) {
                closeYouTubeChatPanel({ restoreFocus: true });
                announce(t('recording_wizard.chat.closed', 'Canlı sohbet kapatıldı.'));
            } else {
                openYouTubeChatPanel({ focusList: true });
                announce(t('recording_wizard.chat.opened', 'Canlı sohbet açıldı.'));
            }
            break;
        case 'recordingGlobalToggleLiveEffects':
            toggleLiveEffectsOverlay();
            break;
        case 'recordingGlobalFullscreenCamera':
            if (!state.screenItemId) {
                showShortcutTooltip(t('recording_wizard.shortcuts.screen_missing_action', 'There is no screen source, so this action cannot be completed.'));
                break;
            }
            if (!state.cameraItemId) {
                showShortcutTooltip(t('recording_wizard.shortcuts.camera_missing', 'The camera source was not found.'));
                break;
            }
            state.lastPresetBeforeFullscreenCam = state.lastPresetBeforeFullscreenCam || getSelectedPreset();
            await applySelectedPreset('camera-only');
            showShortcutTooltip(t('recording_wizard.shortcuts.camera_fullscreen', 'Camera switched to fullscreen.'));
            break;
        case 'recordingGlobalRestoreLayout': {
            if (!state.screenItemId) {
                showShortcutTooltip(t('recording_wizard.shortcuts.screen_missing_restore', 'This action cannot be completed because the screen source could not be detected.'));
                break;
            }
            const restorePreset = state.lastPresetBeforeFullscreenCam || getSelectedPreset();
            await applySelectedPreset(restorePreset, { preserveManualTransform: true });
            showShortcutTooltip(t('recording_wizard.shortcuts.layout_restored', 'Returned to the previous layout.'));
            state.lastPresetBeforeFullscreenCam = null;
            break;
        }
        case 'recordingGlobalHideScreen':
            if (!state.screenItemId) {
                showShortcutTooltip(t('recording_wizard.shortcuts.screen_missing', 'The screen source could not be detected.'));
                break;
            }
            state.isScreenBlurred = !state.isScreenBlurred;
            if (state.isScreenBlurred) {
                await ipcRenderer.invoke('obs-set-transform', {
                    sceneName: state.sceneName,
                    sceneItemId: state.screenItemId,
                    transform: {
                        positionX: -9999,
                        positionY: -9999
                    }
                });
                showShortcutTooltip(t('recording_wizard.shortcuts.screen_hidden', 'The screen was hidden.'));
            } else {
                await applySelectedPreset(getSelectedPreset(), { preserveManualTransform: true });
                showShortcutTooltip(t('recording_wizard.shortcuts.screen_restored', 'The screen was restored.'));
            }
            break;
        case 'recordingGlobalPreviousWindow':
            if (state.captureMode !== 'window' || state.selectedWindows.length < 2) {
                showShortcutTooltip(t('recording_wizard.shortcuts.window_switch_unavailable', 'Pencere degistirmek icin en az iki pencere secmelisiniz.'));
                break;
            }
            await activateSelectedWindow(state.selectedWindows.length - 1, { announceChange: true });
            break;
        case 'recordingGlobalNextWindow':
            if (state.captureMode !== 'window' || state.selectedWindows.length < 2) {
                showShortcutTooltip(t('recording_wizard.shortcuts.window_switch_unavailable', 'Pencere degistirmek icin en az iki pencere secmelisiniz.'));
                break;
            }
            await activateSelectedWindow(1, { announceChange: true });
            break;
        case 'recordingGlobalWindowList':
            openWindowSwitcherDialog();
            break;
    }
});

// Local chat navigation shortcuts remain as in-window fallbacks.
// The open-chat action is also exposed through the global shortcut system.
// Intentionally not added to the keyboard manager: Alt+digit double-press is
// a chat-specific gesture, not a user-configurable global command.
document.addEventListener('keydown', (event) => {
    if (state.stepIndex !== 5 || state.mode !== 'broadcast') return;

    if (event.ctrlKey && event.altKey && !event.shiftKey && (event.key === 'c' || event.key === 'C')) {
        event.preventDefault();
        if (state.youtubeChatPanelOpen) {
            closeYouTubeChatPanel({ restoreFocus: true });
        } else {
            openYouTubeChatPanel({ focusList: true });
        }
        return;
    }

    if (event.altKey && !event.shiftKey && !event.metaKey) {
        const slotMap = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '0': 10 };
        const slot = slotMap[event.key];
        if (slot) {
            event.preventDefault();
            const targetIndex = state.youtubeChatMessages.length - slot;
            if (targetIndex >= 0) {
                const now = Date.now();
                const isDoublePress = state.lastYouTubeChatShortcutSlot === slot && (now - state.lastYouTubeChatShortcutAt) <= 700;
                state.lastYouTubeChatShortcutSlot = slot;
                state.lastYouTubeChatShortcutAt = now;
                openYouTubeChatPanel({ focusList: true });
                setSelectedChatIndex(targetIndex, { announceSelection: true, focusList: true });
                if (isDoublePress) {
                    const message = state.youtubeChatMessages[targetIndex];
                    if (message) {
                        clipboard.writeText(normalizeChatMessageText(message));
                        announce(t('recording_wizard.chat.copy_recent_success', 'Seçili sohbet mesajı panoya kopyalandı.'));
                    }
                }
            } else {
                showShortcutTooltip(t('recording_wizard.chat.recent_slot_unavailable', 'Bu konumda bir mesaj yok.'));
            }
            return;
        }
    }

    if (event.key === 'Escape') {
        if (state.recordingActive && state.mode === 'broadcast') {
            event.preventDefault();
            if (els.youtubeChatMenuDialog?.open) {
                closeYouTubeChatMenu();
            } else if (state.youtubeChatPanelOpen) {
                closeYouTubeChatPanel({ restoreFocus: true });
            }
            return;
        }
        if (els.youtubeChatMenuDialog?.open) {
            event.preventDefault();
            closeYouTubeChatMenu();
            return;
        }
        const activeInsideChat = !!(els.youtubeChatVisualPanel && els.youtubeChatVisualPanel.contains(document.activeElement));
        if (state.youtubeChatPanelOpen && activeInsideChat) {
            event.preventDefault();
            closeYouTubeChatPanel({ restoreFocus: true });
        }
    }
});
