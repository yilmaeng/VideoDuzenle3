const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const { detectOBS } = require('./obs-detect');
const { spawn } = require('child_process');
const ffmpegHandler = require('../main/ffmpeg-handler');

const CONFIG_DIR = path.join(os.homedir(), '.korcul-video-editor');
const CONFIG_FILE = path.join(CONFIG_DIR, 'obs-config.json');
const LIVE_EFFECT_CACHE_DIR = path.join(CONFIG_DIR, 'live-effects-cache');
const LIVE_EFFECT_VIDEO_INPUT = 'KVE Canli Efekt Video';
const LIVE_EFFECT_IMAGE_INPUT = 'KVE Canli Efekt Gorsel';
const LIVE_CHAT_TEXT_INPUT = 'KVE Canli Sohbet';
const LIVE_CHAT_BG_INPUT = 'KVE Canli Sohbet Arka Plan';

function ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

function ensureLiveEffectCacheDir() {
    ensureConfigDir();
    if (!fs.existsSync(LIVE_EFFECT_CACHE_DIR)) {
        fs.mkdirSync(LIVE_EFFECT_CACHE_DIR, { recursive: true });
    }
}

function sanitizeCacheStem(value = '') {
    return String(value || '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 80);
}

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error('OBS config read error:', e);
    }
    return {
        host: '127.0.0.1',
        port: 4455,
        password: ''
    };
}

function saveConfig(config) {
    try {
        ensureConfigDir();
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        return { success: true };
    } catch (e) {
        console.error('OBS config save error:', e);
        return { success: false, error: e.message };
    }
}

function getDefaultRecordingDir() {
    try {
        if (app && app.isReady()) {
            return path.join(app.getPath('videos'), 'EVD Videolar');
        }
    } catch (e) {
        console.warn('[OBS] app.getPath("videos") kullanilamadi:', e.message);
    }

    return path.join(os.homedir(), 'Videos', 'EVD Videolar');
}

function safeRequireObs() {
    try {
        const mod = require('obs-websocket-js');
        if (mod.OBSWebSocket) return mod;
        return { OBSWebSocket: mod };
    } catch (e) {
        const err = new Error('OBS WebSocket istemcisi yüklenemedi. Lütfen bağımlılıkları yükleyin: obs-websocket-js');
        err.original = e;
        throw err;
    }
}

const VIDEO_QUALITY_PRESETS = {
    current: null,
    hd_1080: {
        outputWidth: 1920,
        outputHeight: 1080,
        fpsNumerator: 30,
        fpsDenominator: 1,
        streamVideoBitrate: 6000,
        streamAudioBitrate: 160
    },
    balanced_720: {
        outputWidth: 1280,
        outputHeight: 720,
        fpsNumerator: 30,
        fpsDenominator: 1,
        streamVideoBitrate: 4000,
        streamAudioBitrate: 160
    },
    compact_540: {
        outputWidth: 960,
        outputHeight: 540,
        fpsNumerator: 24,
        fpsDenominator: 1,
        streamVideoBitrate: 2500,
        streamAudioBitrate: 128
    }
};

class OBSController {
    constructor() {
        this.client = null;
        this.connected = false;
        this.lastRecordingPath = null;
        this.sceneItems = {};
        this.activeLiveEffectVideoInputName = null;
        this.activeLiveEffectImageInputName = null;
        this.liveEffectSuppressionState = null;
        this.config = loadConfig();
    }

    detectOBS() {
        return detectOBS();
    }

    launchOBS() {
        const info = detectOBS();
        if (!info.found || !info.path) {
            return { success: false, error: 'OBS bulunamadı.' };
        }
        try {
            const cwd = path.dirname(info.path);
            const args = info.bundled ? ['--portable'] : [];

            if (process.platform === 'darwin') {
                // On macOS, 'open' handles the launch, cwd might not be needed but good practice
                spawn('open', ['-a', info.path, '--args', ...args], { detached: true, stdio: 'ignore' }).unref();
            } else {
                // Windows and Linux need generic spawn with cwd
                spawn(info.path, args, { detached: true, stdio: 'ignore', cwd }).unref();
            }
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    getConfig() {
        return this.config || loadConfig();
    }

    saveConfig(config) {
        this.config = { ...this.getConfig(), ...config };
        return saveConfig(this.config);
    }

    _getClient() {
        if (!this.client) {
            const { OBSWebSocket } = safeRequireObs();
            this.client = new OBSWebSocket();

            // Best-effort event wiring for recording path
            if (this.client.on) {
                this.client.on('RecordStateChanged', (data) => {
                    if (data && data.outputPath) {
                        this.lastRecordingPath = data.outputPath;
                    }
                });
                this.client.on('RecordingStopped', (data) => {
                    if (data && data.outputPath) {
                        this.lastRecordingPath = data.outputPath;
                    }
                });
            }
        }
        return this.client;
    }

    async getWindowList() {
        // Create a temp input to query available windows
        const tempInputName = 'KVE_Temp_Window_Probe';
        const sceneName = 'KVE Kayıt';

        try {
            await this.ensureScene(sceneName);

            // 1. Create temp input (hidden)
            // Use try-catch to handle if it already exists
            try {
                await this._call('CreateInput', {
                    sceneName,
                    inputName: tempInputName,
                    inputKind: 'window_capture',
                    sceneItemEnabled: false
                });
            } catch (e) {
                // Ignore if exists
            }

            // 2. Query properties
            const props = await this._call('GetInputPropertiesListPropertyItems', {
                inputName: tempInputName,
                propertyName: 'window'
            });

            // 3. Remove temp input
            try {
                await this._removeInput(tempInputName);
            } catch (e) { }

            if (props && props.propertyItems) {
                return props.propertyItems.map(item => ({
                    name: item.itemName, // "Belge1 - Word:..."
                    id: item.itemValue   // Internal ID
                }));
            }
            return [];
        } catch (e) {
            console.error('getWindowList failed:', e.message);
            // Fallback: empty list
            try { await this._removeInput(tempInputName); } catch (_) { }
            return [];
        }
    }

    async _getPropertyItemsForInputKinds({ sceneName = 'KVE Kayıt', inputKinds, propertyName, tempInputName = 'KVE Temp Input Probe' }) {
        const kinds = Array.isArray(inputKinds) ? inputKinds.filter(Boolean) : [inputKinds].filter(Boolean);
        for (const inputKind of kinds) {
            let tempCreated = false;
            try {
                await this.ensureScene(sceneName, { activate: false });
                try {
                    await this._removeInput(tempInputName);
                } catch (e) { }
                await this._call('CreateInput', {
                    sceneName,
                    inputName: tempInputName,
                    inputKind,
                    inputSettings: {},
                    sceneItemEnabled: false
                });
                tempCreated = true;
                const props = await this._call('GetInputPropertiesListPropertyItems', {
                    inputName: tempInputName,
                    propertyName
                });
                if (props && Array.isArray(props.propertyItems) && props.propertyItems.length > 0) {
                    return {
                        inputKind,
                        propertyItems: props.propertyItems
                    };
                }
            } catch (error) {
                console.warn(`Input property probe failed for kind "${inputKind}" and property "${propertyName}":`, error.message);
            } finally {
                if (tempCreated) {
                    try {
                        await this._removeInput(tempInputName);
                    } catch (e) { }
                }
            }
        }
        return null;
    }

    async _createWindowAudioCapture(sceneName, targetWindowValue) {
        const candidateKinds = process.platform === 'win32'
            ? ['wasapi_process_output_capture', 'application_audio_capture']
            : [];
        if (candidateKinds.length === 0 || !targetWindowValue) {
            return null;
        }

        const probe = await this._getPropertyItemsForInputKinds({
            sceneName,
            inputKinds: candidateKinds,
            propertyName: 'window',
            tempInputName: 'KVE Temp Window Audio Probe'
        });
        if (!probe || !Array.isArray(probe.propertyItems) || probe.propertyItems.length === 0) {
            return null;
        }

        const matchedItem = probe.propertyItems.find((item) => {
            const itemValue = item.itemValue || item.value || '';
            return itemValue === targetWindowValue;
        }) || probe.propertyItems.find((item) => {
            const itemValue = String(item.itemValue || item.value || '').toLowerCase();
            return itemValue.includes(String(targetWindowValue).toLowerCase());
        });

        if (!matchedItem) {
            return null;
        }

        const windowValue = matchedItem.itemValue || matchedItem.value;
        const inputName = 'KVE Pencere Sesi';
        const result = await this._ensureInput(sceneName, inputName, probe.inputKind, {
            window: windowValue
        }, true);

        return result ? {
            ...result,
            inputKind: probe.inputKind,
            window: windowValue
        } : null;
    }

    async _call(requestType, requestData) {
        const obs = this._getClient();
        if (!obs) throw new Error('OBS istemcisi oluşturulamadı');
        if (typeof obs.call === 'function') {
            return obs.call(requestType, requestData || {});
        }
        if (typeof obs.send === 'function') {
            return obs.send(requestType, requestData || {});
        }
        throw new Error('OBS WebSocket API uyumsuz.');
    }

    async connect({ host, port, password }) {
        const obs = this._getClient();
        const address = `ws://${host}:${port}`;

        // Try connect signatures (v4 and v5)
        try {
            await obs.connect(address, password || undefined);
        } catch (err1) {
            try {
                await obs.connect({ address, password: password || undefined });
            } catch (err2) {
                throw err1;
            }
        }

        this.connected = true;
        this.saveConfig({ host, port, password: password || '' });

        const version = await this._call('GetVersion');

        // Bağlantı kurulduğunda kayıt yolunu otomatik ayarla
        try {
            await this.setRecordingPath();
        } catch (pathErr) {
            console.warn('[OBS] Kayıt yolu otomatik ayarlanamadı:', pathErr.message);
        }

        return {
            version,
            address
        };
    }

    async ensureScene(sceneName, { activate = true } = {}) {
        if (!sceneName) throw new Error('Scene name missing');
        const scenes = await this._call('GetSceneList');
        const exists = (scenes.scenes || scenes).some(s => s.sceneName === sceneName || s.name === sceneName);
        if (!exists) {
            try {
                await this._call('CreateScene', { sceneName });
            } catch (e) {
                // v4 fallback
                await this._call('CreateScene', { 'scene-name': sceneName });
            }
        }

        if (activate) {
            try {
                await this._call('SetCurrentProgramScene', { sceneName });
            } catch (e) {
                try {
                    await this._call('SetCurrentScene', { 'scene-name': sceneName });
                } catch (e2) { }
            }
        }

        return { sceneName };
    }

    _platformInputKinds() {
        if (process.platform === 'win32') {
            return {
                screen: 'monitor_capture',
                window: 'window_capture',
                camera: 'dshow_input',
                mic: 'wasapi_input_capture',
                system: 'wasapi_output_capture'
            };
        }
        if (process.platform === 'darwin') {
            return {
                screen: 'screen_capture',
                window: 'window_capture',
                camera: 'av_capture_input',
                mic: 'coreaudio_input_capture',
                system: 'coreaudio_output_capture'
            };
        }
        return {
            screen: 'xcomposite_input',
            window: 'xcomposite_input',
            camera: 'v4l2_input',
            mic: 'pulse_input_capture',
            system: 'pulse_output_capture'
        };
    }

    async _getMonitorInfo(index) {
        try {
            const list = await this._call('GetMonitorList');
            const monitors = list.monitors || list;
            if (!Array.isArray(monitors)) return null;
            let m = null;
            if (typeof index === 'number') {
                m = monitors.find(mon => mon.monitorIndex === index) || monitors[index];
            }
            if (!m) m = monitors[0];
            if (!m) return null;
            return {
                monitorIndex: m.monitorIndex ?? m.index ?? 0,
                monitorName: m.monitorName || m.name || null
            };
        } catch (e) {
            return null;
        }
    }

    async getMonitorList() {
        const list = await this._call('GetMonitorList');
        return list.monitors || list;
    }

    async _removeInput(inputName) {
        try {
            await this._call('RemoveInput', { inputName });
        } catch (e) {
            // Might not exist or v4
            try {
                await this._call('RemoveInput', { 'inputName': inputName });
            } catch (e2) { /* ignore */ }
        }
    }

    async _findSceneItemsBySourceName(sourceName) {
        const matches = [];
        try {
            const sceneList = await this._call('GetSceneList');
            const scenes = sceneList.scenes || [];
            for (const scene of scenes) {
                const sceneName = scene.sceneName || scene.name;
                if (!sceneName) continue;
                try {
                    const sceneItems = await this._call('GetSceneItemList', { sceneName });
                    const items = sceneItems.sceneItems || sceneItems.items || [];
                    for (const item of items) {
                        if (item.sourceName === sourceName || item.inputName === sourceName) {
                            matches.push({
                                sceneName,
                                sceneItemId: item.sceneItemId,
                                sourceName: item.sourceName || item.inputName || sourceName
                            });
                        }
                    }
                } catch (error) { }
            }
        } catch (error) { }
        return matches;
    }

    async _removeInputsByPrefix(prefix) {
        if (!prefix) return;
        try {
            const inputList = await this._call('GetInputList');
            const inputs = inputList.inputs || inputList || [];
            for (const input of inputs) {
                const inputName = input.inputName || input.name;
                if (inputName && inputName.startsWith(prefix)) {
                    await this._removeInput(inputName);
                }
            }
        } catch (error) {
            console.warn(`Could not remove inputs by prefix "${prefix}":`, error.message);
        }
    }

    async _resolveWindowCaptureValue(inputName, requestedWindowTitle) {
        const normalize = (str) => (str || '').toLowerCase().replace(/\s+/g, ' ').trim();

        try {
            const props = await this._call('GetInputPropertiesListPropertyItems', {
                inputName,
                propertyName: 'window'
            });
            const windows = props.propertyItems || [];
            const requestedTitle = normalize(requestedWindowTitle);
            const candidates = windows.filter((item) => item.itemEnabled !== false && (item.itemValue || item.value));

            let match = candidates.find((item) => item.itemValue === requestedWindowTitle || item.itemName === requestedWindowTitle);
            if (!match && requestedTitle) {
                match = candidates.find((item) => {
                    const candidateValue = normalize(item.itemValue || item.value);
                    const candidateName = normalize(item.itemName || item.name);
                    return candidateValue.includes(requestedTitle)
                        || requestedTitle.includes(candidateValue)
                        || candidateName.includes(requestedTitle)
                        || requestedTitle.includes(candidateName);
                });
            }
            if (!match && requestedTitle) {
                const requestedWords = requestedTitle.split(' ').filter((word) => word.length > 3);
                if (requestedWords.length > 0) {
                    match = candidates.find((item) => {
                        const haystack = `${normalize(item.itemValue || item.value)} ${normalize(item.itemName || item.name)}`;
                        return requestedWords.some((word) => haystack.includes(word));
                    });
                }
            }
            if (!match && candidates.length > 0) {
                match = candidates[0];
            }
            if (!match) return requestedWindowTitle;

            const resolvedWindowId = match.itemValue || match.value;
            await this._call('SetInputSettings', {
                inputName,
                inputSettings: {
                    window: resolvedWindowId,
                    method: 2,
                    priority: 2,
                    cursor: true,
                    client_area: true
                },
                overlay: true
            });
            return resolvedWindowId;
        } catch (error) {
            console.error(`Window resolution failed for "${inputName}":`, error.message);
            return requestedWindowTitle;
        }
    }

    async _getMonitorId(monitorIndex) {
        // Try to get the correct monitor_id string from OBS
        // Method 1: Create a temporary monitor_capture, read its settings, then remove it
        const tempName = '__kve_temp_monitor_probe_' + Date.now();
        try {
            // First, try GetInputDefaultSettings to see what OBS uses
            let defaults = {};
            try {
                const defResult = await this._call('GetInputDefaultSettings', { inputKind: 'monitor_capture' });
                defaults = defResult.defaultInputSettings || defResult || {};
                console.log('monitor_capture defaults:', JSON.stringify(defaults));
            } catch (e) {
                console.log('GetInputDefaultSettings failed:', e.message);
            }

            // If defaults has monitor_id, use it (it's the primary monitor)
            if (defaults.monitor_id) {
                return { monitor: monitorIndex, monitor_id: defaults.monitor_id };
            }

            // Method 2: Create temp input with just monitor index, read back its full settings
            try {
                await this._call('CreateInput', {
                    sceneName: 'KVE Kayıt',
                    inputName: tempName,
                    inputKind: 'monitor_capture',
                    inputSettings: { monitor: monitorIndex },
                    sceneItemEnabled: false
                });

                // Read back what OBS resolved
                const resolved = await this._call('GetInputSettings', { inputName: tempName });
                const resolvedSettings = resolved.inputSettings || {};
                console.log('Resolved monitor settings:', JSON.stringify(resolvedSettings));

                // Clean up temp
                await this._removeInput(tempName);

                if (resolvedSettings.monitor_id) {
                    return { monitor: monitorIndex, monitor_id: resolvedSettings.monitor_id };
                }
            } catch (e) {
                // Clean up temp if it was created
                try { await this._removeInput(tempName); } catch (e2) { }
                console.log('Temp monitor probe failed:', e.message);
            }

            // Fallback: just use index
            return { monitor: monitorIndex };
        } catch (e) {
            return { monitor: monitorIndex };
        }
    }

    async _ensureInput(sceneName, inputName, inputKind, inputSettings, forceRecreate = false) {
        const inputList = await this._call('GetInputList');
        const inputs = inputList.inputs || inputList;
        const exists = inputs.find(i => i.inputName === inputName || i.name === inputName);

        if (exists && forceRecreate) {
            // Remove existing input to force fresh creation with correct settings
            try {
                const staleSceneItems = await this._findSceneItemsBySourceName(inputName);
                if (staleSceneItems.length > 0) {
                    for (const staleItem of staleSceneItems) {
                        try {
                            await this._call('RemoveSceneItem', {
                                sceneName: staleItem.sceneName,
                                sceneItemId: staleItem.sceneItemId
                            });
                        } catch (removeSceneItemError) { }
                    }
                }
            } catch (staleLookupError) { }
            await this._removeInput(inputName);
            // Small delay to let OBS process the removal
            await new Promise(r => setTimeout(r, 300));
        }

        const shouldCreate = !exists || forceRecreate;

        if (shouldCreate) {
            try {
                console.log(`Creating input "${inputName}" kind="${inputKind}" settings=`, JSON.stringify(inputSettings));
                await this._call('CreateInput', {
                    sceneName,
                    inputName,
                    inputKind,
                    inputSettings: inputSettings || {},
                    sceneItemEnabled: true
                });
            } catch (e) {
                console.error(`CreateInput failed for "${inputName}":`, e.message);
                // v4 fallback
                try {
                    await this._call('CreateInput', {
                        'sceneName': sceneName,
                        'inputName': inputName,
                        'inputKind': inputKind,
                        'inputSettings': inputSettings || {},
                        'sceneItemEnabled': true
                    });
                } catch (e2) {
                    console.error(`CreateInput v4 fallback also failed:`, e2.message);
                }
            }
        } else {
            // Update settings if input already exists
            if (inputSettings && Object.keys(inputSettings).length > 0) {
                try {
                    console.log(`Updating input "${inputName}" settings=`, JSON.stringify(inputSettings));
                    await this._call('SetInputSettings', {
                        inputName,
                        inputSettings: inputSettings || {},
                        overlay: true
                    });
                } catch (e) {
                    try {
                        await this._call('SetInputSettings', {
                            'inputName': inputName,
                            'inputSettings': inputSettings || {},
                            'overlay': true
                        });
                    } catch (e2) { }
                }
            }
        }

        // Wait a moment for OBS to initialize the source
        await new Promise(r => setTimeout(r, 200));

        const findSceneItem = async () => {
            const sceneItems = await this._call('GetSceneItemList', { sceneName });
            const items = sceneItems.sceneItems || sceneItems.items || [];
            return items.find(i => i.sourceName === inputName || i.inputName === inputName) || null;
        };

        let item = await findSceneItem();
        if (!item) {
            // OBS can occasionally lag behind CreateInput/SetInputSettings for media sources.
            await new Promise(r => setTimeout(r, 250));
            item = await findSceneItem();
        }

        if (!item) {
            try {
                await this._call('CreateSceneItem', {
                    sceneName,
                    sourceName: inputName,
                    sceneItemEnabled: true
                });
                await new Promise(r => setTimeout(r, 200));
                item = await findSceneItem();
            } catch (attachError) { }
        }

        if (!item && !forceRecreate) {
            try {
                await this._removeInput(inputName);
                await new Promise(r => setTimeout(r, 250));
                return await this._ensureInput(sceneName, inputName, inputKind, inputSettings, true);
            } catch (recreateError) { }
        }

        if (!item) {
            console.warn(`Scene item not found for "${inputName}" after create/update`);
            return { inputName, sceneItemId: null };
        }

        if (!this.sceneItems[sceneName]) this.sceneItems[sceneName] = {};
        this.sceneItems[sceneName][inputName] = item.sceneItemId;
        return { inputName, sceneItemId: item.sceneItemId };
    }

    async _ensureInputWithKinds(sceneName, inputName, inputKinds, inputSettings, forceRecreate = false) {
        const kinds = Array.isArray(inputKinds) ? inputKinds.filter(Boolean) : [inputKinds].filter(Boolean);
        let lastResult = null;
        for (const kind of kinds) {
            const result = await this._ensureInput(sceneName, inputName, kind, inputSettings, forceRecreate);
            lastResult = { ...result, inputKind: kind };
            if (result && result.sceneItemId) {
                return lastResult;
            }
        }
        return lastResult || { inputName, sceneItemId: null, inputKind: kinds[0] || null };
    }

    async _setSceneItemEnabled({ sceneName, sceneItemId, enabled }) {
        if (!sceneName || !sceneItemId) return;
        try {
            await this._call('SetSceneItemEnabled', {
                sceneName,
                sceneItemId,
                sceneItemEnabled: !!enabled
            });
        } catch (error) {
            try {
                await this._call('SetSceneItemEnabled', {
                    'sceneName': sceneName,
                    'sceneItemId': sceneItemId,
                    'sceneItemEnabled': !!enabled
                });
            } catch (fallbackError) { }
        }
    }

    async _setSceneItemIndex({ sceneName, sceneItemId, sceneItemIndex }) {
        if (!sceneName || !sceneItemId || !Number.isFinite(sceneItemIndex)) return;
        try {
            await this._call('SetSceneItemIndex', {
                sceneName,
                sceneItemId,
                sceneItemIndex
            });
        } catch (error) {
            try {
                await this._call('SetSceneItemIndex', {
                    'sceneName': sceneName,
                    'sceneItemId': sceneItemId,
                    'sceneItemIndex': sceneItemIndex
                });
            } catch (fallbackError) { }
        }
    }

    _buildLiveChatOverlayText(messages = [], maxMessages = 6) {
        return (Array.isArray(messages) ? messages : [])
            .slice(-maxMessages)
            .map((message) => {
                const author = String(message.authorDisplayName || message.author || '-').trim();
                const text = String(message.text || message.message || '')
                    .replace(/\r\n/g, '\n')
                    .replace(/\r/g, '\n')
                    .replace(/\n+/g, ' ')
                    .trim();
                return `${author}: ${text || '-'}`;
            })
            .join('\n\n');
    }

    async setRecordingFormat(format) {
        // format: 'mp4' or 'mkv'
        if (!format) return;
        console.log(`Setting OBS recording format to: ${format}`);
        try {
            // Try updating Simple Output settings
            await this._call('SetProfileParameter', {
                parameterCategory: 'SimpleOutput',
                parameterName: 'RecFormat',
                parameterValue: format
            });
            // Try updating Advanced Output settings (Standard mode)
            await this._call('SetProfileParameter', {
                parameterCategory: 'AdvOut',
                parameterName: 'RecFormat',
                parameterValue: format
            });
            // Try updating Advanced Output settings (FFmpeg mode extension)
            await this._call('SetProfileParameter', {
                parameterCategory: 'AdvOut',
                parameterName: 'FFExtension',
                parameterValue: format
            });
        } catch (e) {
            console.error('SetRecordingFormat failed (might not be supported on this OBS version/profile):', e.message);
        }
    }

    async getStreamServiceSettings() {
        try {
            return await this._call('GetStreamServiceSettings');
        } catch (error) {
            return {
                streamServiceType: 'rtmp_custom',
                streamServiceSettings: {}
            };
        }
    }

    async setStreamServiceSettings({ streamServiceType, streamServiceSettings }) {
        if (!streamServiceType) throw new Error('streamServiceType required');
        const normalizedSettings = {};
        for (const [key, value] of Object.entries(streamServiceSettings || {})) {
            if (value !== undefined && value !== null && value !== '') {
                normalizedSettings[key] = value;
            }
        }
        await this._call('SetStreamServiceSettings', {
            streamServiceType,
            streamServiceSettings: normalizedSettings
        });
        return {
            streamServiceType,
            streamServiceSettings: normalizedSettings
        };
    }

    async startStreaming() {
        await this._call('StartStream');
        let lastStatus = {};

        for (let attempt = 0; attempt < 5; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            try {
                lastStatus = await this.getStreamingStatus();
                console.log(`[OBS] Streaming status attempt ${attempt + 1}: ${JSON.stringify(lastStatus)}`);
            } catch (error) {
                lastStatus = {};
                console.warn(`[OBS] Streaming status attempt ${attempt + 1} failed: ${error.message}`);
            }

            if (lastStatus.outputActive) {
                return { started: true, status: lastStatus };
            }
        }

        const reconnecting = !!lastStatus.outputReconnecting;
        const reason = reconnecting
            ? 'OBS yayini baslatmaya calisti ancak sunucu baglantisi kurulamadı.'
            : 'OBS yayini aktiflestiremedi.';
        const detail = lastStatus && Object.keys(lastStatus).length > 0
            ? ` ${JSON.stringify(lastStatus)}`
            : '';
        throw new Error(`${reason}${detail}`);
    }

    async stopStreaming() {
        await this._call('StopStream');
        return { stopped: true };
    }

    async getStreamingStatus() {
        const status = await this._call('GetStreamStatus');
        return status || {};
    }

    async getStats() {
        try {
            const stats = await this._call('GetStats');
            return stats || {};
        } catch (error) {
            console.warn('[OBS] GetStats failed:', error.message);
            return {};
        }
    }

    async applyVideoQualityPreset({ preset, mode } = {}) {
        const config = VIDEO_QUALITY_PRESETS[preset];
        if (!preset || preset === 'current' || !config) {
            return {
                applied: false,
                preset: preset || 'current'
            };
        }

        const currentSettings = await this.getVideoSettings();
        const nextSettings = {
            ...currentSettings,
            outputWidth: config.outputWidth,
            outputHeight: config.outputHeight,
            fpsNumerator: config.fpsNumerator,
            fpsDenominator: config.fpsDenominator
        };

        try {
            await this._call('SetVideoSettings', nextSettings);
        } catch (error) {
            console.warn('[OBS] SetVideoSettings failed for quality preset:', error.message);
        }

        if (mode === 'broadcast') {
            try {
                await this._call('SetProfileParameter', {
                    parameterCategory: 'SimpleOutput',
                    parameterName: 'VBitrate',
                    parameterValue: String(config.streamVideoBitrate)
                });
                await this._call('SetProfileParameter', {
                    parameterCategory: 'SimpleOutput',
                    parameterName: 'ABitrate',
                    parameterValue: String(config.streamAudioBitrate)
                });
            } catch (error) {
                console.warn('[OBS] Stream bitrate preset apply failed:', error.message);
            }
        }

        return {
            applied: true,
            preset,
            settings: nextSettings
        };
    }

    /**
     * Kayıt çıktı yolunu kullanıcının video klasörüne ayarla.
     */
    async setRecordingPath(customPath) {
        let recordingDir;

        if (customPath) {
            recordingDir = customPath;
        } else {
            recordingDir = getDefaultRecordingDir();
        }

        try {
            if (!fs.existsSync(recordingDir)) {
                fs.mkdirSync(recordingDir, { recursive: true });
            }
        } catch (mkdirErr) {
            console.error('[OBS] Kayit klasoru olusturulamadi:', mkdirErr.message);
            recordingDir = path.join(os.homedir(), 'Videos');
            if (!fs.existsSync(recordingDir)) {
                fs.mkdirSync(recordingDir, { recursive: true });
            }
        }

        console.log(`[OBS] Kayıt yolu ayarlanıyor: ${recordingDir}`);

        try {
            // SimpleOutput mode
            await this._call('SetProfileParameter', {
                parameterCategory: 'SimpleOutput',
                parameterName: 'FilePath',
                parameterValue: recordingDir
            });
            // AdvOut Standard mode
            await this._call('SetProfileParameter', {
                parameterCategory: 'AdvOut',
                parameterName: 'RecFilePath',
                parameterValue: recordingDir
            });
            // AdvOut FFmpeg mode
            await this._call('SetProfileParameter', {
                parameterCategory: 'AdvOut',
                parameterName: 'FFFilePath',
                parameterValue: recordingDir
            });

            console.log(`[OBS] Kayıt yolu başarıyla ayarlandı: ${recordingDir}`);
            return { success: true, recordingDir };
        } catch (e) {
            console.error('[OBS] Kayıt yolu ayarlanamadı:', e.message);
            return { success: false, error: e.message, recordingDir };
        }
    }

    async setupSources(params) {
        const {
            sceneName = 'KVE Kayıt',
            captureMode = 'screen',
            screenIndex = 0,
            windowTitle,
            windowTitles = [],
            includeCamera = false,
            includeMic = true,
            includeSystemAudio = false,
            systemAudioMode = 'system',
            systemAudioWindowTarget = '',
            cameraDeviceId,
            micDeviceId,
            systemDeviceId
        } = params || {};

        await this.ensureScene(sceneName);
        const kinds = this._platformInputKinds();

        console.log('========== SCREEN SOURCE SETUP START ==========');
        console.log(`captureMode=${captureMode}, screenIndex=${screenIndex}`);
        let screenResult = { inputName: captureMode === 'window' ? 'KVE Pencere 1' : 'KVE Ekran', sceneItemId: null };
        let windowResults = [];

        if (captureMode === 'window') {
            const requestedWindows = (Array.isArray(windowTitles) && windowTitles.length > 0
                ? windowTitles
                : [windowTitle]).filter(Boolean);

            if (requestedWindows.length === 0) {
                throw new Error('No window selected for capture.');
            }

            console.log('Step 1: Removing old sources...');
            try { await this._removeInput('KVE Ekran'); } catch (e) { console.log('  KVE Ekran removal:', e.message || 'not found'); }
            await this._removeInputsByPrefix('KVE Pencere');
            await new Promise(r => setTimeout(r, 500));

            for (let index = 0; index < requestedWindows.length; index += 1) {
                const requestedWindow = requestedWindows[index];
                const inputName = `KVE Pencere ${index + 1}`;
                console.log(`Step 2.${index + 1}: Creating window source ${inputName}`);

                try {
                    await this._call('CreateInput', {
                        sceneName,
                        inputName,
                        inputKind: kinds.window,
                        inputSettings: {
                            window: requestedWindow,
                            cursor: true
                        },
                        sceneItemEnabled: true
                    });
                } catch (createErr) {
                    console.error(`  CreateInput FAILED for ${inputName}:`, createErr.message);
                }

                await new Promise(r => setTimeout(r, 250));
                const resolvedWindowId = await this._resolveWindowCaptureValue(inputName, requestedWindow);

                try {
                    const sceneItems = await this._call('GetSceneItemList', { sceneName });
                    const items = sceneItems.sceneItems || sceneItems.items || [];
                    const item = items.find((entry) => entry.sourceName === inputName || entry.inputName === inputName);
                    const sceneItemId = item ? item.sceneItemId : null;

                    if (!this.sceneItems[sceneName]) this.sceneItems[sceneName] = {};
                    if (sceneItemId) {
                        this.sceneItems[sceneName][inputName] = sceneItemId;
                    }

                    windowResults.push({
                        id: resolvedWindowId,
                        name: requestedWindow,
                        windowId: resolvedWindowId,
                        inputName,
                        sceneItemId
                    });
                } catch (itemErr) {
                    console.error(`  Could not get scene item for ${inputName}:`, itemErr.message);
                    windowResults.push({
                        id: requestedWindow,
                        name: requestedWindow,
                        windowId: requestedWindow,
                        inputName,
                        sceneItemId: null
                    });
                }
            }

            if (windowResults.length > 0) {
                screenResult = {
                    inputName: windowResults[0].inputName,
                    sceneItemId: windowResults[0].sceneItemId
                };
            }
        } else {
            const screenInputName = 'KVE Ekran';

            console.log('Step 1: Removing old sources...');
            try { await this._removeInput('KVE Ekran'); } catch (e) { console.log('  KVE Ekran removal:', e.message || 'not found'); }
            await this._removeInputsByPrefix('KVE Pencere');
            await new Promise(r => setTimeout(r, 500));

            console.log('Step 2: Creating fresh source:', screenInputName);
            console.log('  inputKind:', kinds.screen);

            const initialSettings = { monitor: parseInt(screenIndex, 10) || 0, capture_cursor: true };
            console.log('  initialSettings:', JSON.stringify(initialSettings));

            try {
                await this._call('CreateInput', {
                    sceneName,
                    inputName: screenInputName,
                    inputKind: kinds.screen,
                    inputSettings: initialSettings,
                    sceneItemEnabled: true
                });
                console.log('  CreateInput SUCCESS');
            } catch (createErr) {
                console.error('  CreateInput FAILED:', createErr.message);
            }

            await new Promise(r => setTimeout(r, 300));

            console.log('Step 3: Fixing monitor_id (DUMMY removal)...');
            const targetIdx = parseInt(screenIndex, 10) || 0;

            try {
                await this._call('SetInputSettings', {
                    inputName: screenInputName,
                    inputSettings: {
                        monitor: targetIdx,
                        capture_cursor: true
                    },
                    overlay: false
                });
                console.log('  Strategy A: Settings replaced (overlay:false) - DUMMY should be gone');
            } catch (e) {
                console.error('  Strategy A failed:', e.message);
            }

            await new Promise(r => setTimeout(r, 200));

            try {
                const check = await this._call('GetInputSettings', { inputName: screenInputName });
                const settings = check.inputSettings || {};
                console.log('  After fix, settings:', JSON.stringify(settings));

                if (settings.monitor_id === 'DUMMY' || !settings.monitor_id) {
                    console.log('  Strategy B: Trying Windows display path format...');
                    const displayNum = targetIdx + 1;
                    const winDisplayId = `\\\\.\\DISPLAY${displayNum}`;

                    try {
                        await this._call('SetInputSettings', {
                            inputName: screenInputName,
                            inputSettings: {
                                monitor: targetIdx,
                                monitor_id: winDisplayId,
                                capture_cursor: true
                            },
                            overlay: false
                        });
                        console.log('  Strategy B applied');
                    } catch (e2) {
                        console.error('  Strategy B failed:', e2.message);
                    }
                }

                try {
                    const props = await this._call('GetInputPropertiesListPropertyItems', {
                        inputName: screenInputName,
                        propertyName: 'monitor_id'
                    });
                    const monitors = props.propertyItems || [];

                    if (monitors.length > 0) {
                        const realMonitors = monitors.filter(m =>
                            m.itemEnabled !== false && m.itemValue !== 'DUMMY' && m.value !== 'DUMMY'
                        );

                        if (realMonitors.length > 0) {
                            const selected = realMonitors[targetIdx] || realMonitors[0];
                            const realId = selected.itemValue || selected.value;

                            await this._call('SetInputSettings', {
                                inputName: screenInputName,
                                inputSettings: {
                                    monitor: targetIdx,
                                    monitor_id: realId,
                                    capture_cursor: true
                                },
                                overlay: false
                            });
                            console.log('  Strategy C: REAL monitor_id SET!');
                        }
                    }
                } catch (propErr) {
                    console.log('  Strategy C not available:', propErr.message);
                }
            } catch (checkErr) {
                console.error('  Settings check failed:', checkErr.message);
            }

            console.log('Step 4: Getting scene item ID...');
            try {
                const sceneItems = await this._call('GetSceneItemList', { sceneName });
                const items = sceneItems.sceneItems || sceneItems.items || [];
                const item = items.find(i => i.sourceName === screenInputName || i.inputName === screenInputName);
                if (item) {
                    screenResult.sceneItemId = item.sceneItemId;
                    if (!this.sceneItems[sceneName]) this.sceneItems[sceneName] = {};
                    this.sceneItems[sceneName][screenInputName] = item.sceneItemId;
                }
            } catch (e) {
                console.error('  GetSceneItemList failed:', e.message);
            }
        }

        console.log('========== SCREEN SOURCE SETUP END ==========');

        // For camera: OBS dshow_input needs video_device_id in OBS format, not browser format
        // Browser device IDs are NOT compatible with OBS DirectShow IDs
        // Kullanıcının seçtiği kamerayı label eşleştirmesiyle buluyoruz
        let cameraResult = null;
        if (includeCamera) {
            const camSettings = {};
            cameraResult = await this._ensureInput(sceneName, 'KVE Kamera', kinds.camera, camSettings, true);

            // Kamera oluşturulduktan sonra, kullanıcının seçtiği cihazı ayarla
            try {
                const props = await this._call('GetInputPropertiesListPropertyItems', {
                    inputName: 'KVE Kamera',
                    propertyName: 'video_device_id'
                });
                const devices = props.propertyItems || [];
                console.log('Available OBS camera devices:', JSON.stringify(devices));

                if (devices.length > 0) {
                    let targetDevice = null;

                    // Kullanıcının seçtiği kamera label'ını kullanarak eşleştir
                    const camLabel = params.cameraLabel || '';

                    if (camLabel) {
                        const normalizedLabel = camLabel.toLowerCase().trim();
                        targetDevice = devices.find(d => {
                            const devName = (d.itemName || '').toLowerCase().trim();
                            return devName.includes(normalizedLabel) || normalizedLabel.includes(devName);
                        });
                    }

                    if (!targetDevice && cameraDeviceId && cameraDeviceId !== 'default') {
                        // deviceId bazlı partial match dene
                        targetDevice = devices.find(d => {
                            const devVal = (d.itemValue || '').toLowerCase();
                            const devName = (d.itemName || '').toLowerCase();
                            const browserId = cameraDeviceId.toLowerCase();
                            return devVal.includes(browserId) || browserId.includes(devVal) ||
                                devName.includes(browserId) || browserId.includes(devName);
                        });
                    }

                    if (!targetDevice) {
                        // Eşleşme bulunamazsa, varsayılan olmayan ilk cihazı kullan
                        targetDevice = devices.find(d => d.itemValue !== 'default') || devices[0];
                    }

                    if (targetDevice) {
                        await this._call('SetInputSettings', {
                            inputName: 'KVE Kamera',
                            inputSettings: {
                                video_device_id: targetDevice.itemValue || targetDevice.value,
                                active: true
                            },
                            overlay: true
                        });
                        console.log(`Camera device set to: ${targetDevice.itemName} (${targetDevice.itemValue})`);
                    }
                }
            } catch (propErr) {
                console.log('Could not query camera properties:', propErr.message);
            }
        }

        // Aggressively mute ALL potential desktop audio sources first
        // This ensures default "Desktop Audio" or others don't leak into recording
        try {
            const inputList = await this._call('GetInputList');
            const inputs = inputList.inputs || [];

            for (const inp of inputs) {
                // Check if it looks like system audio (wasapi output, pulse output, or specifically named)
                const isSystemAudio = inp.inputKind.includes('output_capture') || inp.inputKind === 'wasapi_output_capture' || inp.inputKind === 'pulse_output_capture';

                // Mute logic: Mute if it's NOT our managed source
                if (isSystemAudio && inp.inputName !== 'KVE Sistem Sesi') {
                    console.log(`Muting unmanaged audio source: ${inp.inputName} (${inp.inputKind})`);
                    try {
                        await this._call('SetInputMute', { inputName: inp.inputName, inputMuted: true });
                    } catch (e) { }
                }
            }
        } catch (e) {
            console.warn('Mute all audio failed:', e.message);
        }

        // GLOBAL AUDIO FIX: Override audio settings
        // OBS'nin "Special Inputs" sistemini kullan:
        // - desktop1/desktop2: Masaüstü Sesi (sistem sesi)
        // - mic1/mic2/mic3/mic4: Mikrofon/Aux girişleri
        // Bu girişler HER ZAMAN aktiftir ve ayrıca oluşturulan kaynaklarla çakışır.
        // Bu yüzden doğrudan special input'ları kontrol ediyoruz.
        let desktopInputName = null;
        let defaultMicInputName = null;

        try {
            const specials = await this._call('GetSpecialInputs');
            console.log('OBS Special Inputs:', JSON.stringify(specials));

            // Desktop (Sistem Sesi) yönetimi
            if (specials.desktop1) desktopInputName = specials.desktop1;
            else if (specials.desktop2) desktopInputName = specials.desktop2;

            if (desktopInputName) {
                if (includeSystemAudio) {
                    console.log(`Unmuting System Audio: ${desktopInputName}`);
                    await this._call('SetInputMute', { inputName: desktopInputName, inputMuted: false });
                } else {
                    console.log(`Muting System Audio: ${desktopInputName}`);
                    await this._call('SetInputMute', { inputName: desktopInputName, inputMuted: true });
                }
            }

            // Mikrofon yönetimi — OBS'nin varsayılan Mic/Aux girişini kullan
            // Ayrıca oluşturduğumuz 'KVE Mikrofon' kaynağı ile çakışmayı önle
            if (specials.mic1) defaultMicInputName = specials.mic1;
            else if (specials.mic2) defaultMicInputName = specials.mic2;

            console.log(`Default Mic Input: ${defaultMicInputName}`);

            // Kullanılmayan diğer Mic/Aux kanallarını sustur (çift ses kaydını önle)
            const allMicSlots = [specials.mic1, specials.mic2, specials.mic3, specials.mic4].filter(Boolean);
            for (const micSlot of allMicSlots) {
                if (micSlot !== defaultMicInputName) {
                    try {
                        await this._call('SetInputMute', { inputName: micSlot, inputMuted: true });
                        console.log(`Muted unused mic slot: ${micSlot}`);
                    } catch (e) { }
                }
            }
        } catch (e) {
            console.warn('GetSpecialInputs failed:', e.message);
        }

        // Eski ayrı 'KVE Mikrofon' kaynağını kaldır — artık varsayılan Mic/Aux kullanıyoruz
        try { await this._removeInput('KVE Mikrofon'); } catch (e) { }

        // Mikrofon: Varsayılan Mic/Aux girişini doğrudan kontrol et
        // Bu yaklaşım daha güvenilir çünkü:
        // 1. OBS'nin global mikrofon girişi her zaman aktiftir
        // 2. Ayrı kaynak oluşturmak çift ses kaydına yol açıyordu
        // 3. Ses düzeyi ve izleme değişiklikleri doğrudan etkili olur
        let micInputName = null;
        if (includeMic && defaultMicInputName) {
            micInputName = defaultMicInputName;

            // Mikrofonu aktifleştir (unmute)
            try {
                await this._call('SetInputMute', { inputName: micInputName, inputMuted: false });
                console.log(`Mic unmuted: ${micInputName}`);
            } catch (e) {
                console.warn('Mic unmute failed:', e.message);
            }

            // Kullanıcının seçtiği mikrofon cihazını ayarla
            if (micDeviceId && micDeviceId !== 'default') {
                try {
                    // OBS'nin varsayılan Mic/Aux girişinin cihaz listesini sorgula
                    const micProps = await this._call('GetInputPropertiesListPropertyItems', {
                        inputName: micInputName,
                        propertyName: 'device_id'
                    });
                    const micDevices = micProps.propertyItems || [];
                    console.log('Available OBS mic devices for default Mic/Aux:', JSON.stringify(micDevices));

                    if (micDevices.length > 0) {
                        let micMatch = null;
                        const micLabel = params.micLabel || '';

                        if (micLabel) {
                            const normalizedLabel = micLabel.toLowerCase().trim();
                            micMatch = micDevices.find(d => {
                                const devName = (d.itemName || '').toLowerCase().trim();
                                return devName.includes(normalizedLabel) || normalizedLabel.includes(devName);
                            });
                        }

                        if (!micMatch) {
                            micMatch = micDevices.find(d => {
                                const devVal = (d.itemValue || '').toLowerCase();
                                const devName = (d.itemName || '').toLowerCase();
                                const browserId = micDeviceId.toLowerCase();
                                return devVal.includes(browserId) || browserId.includes(devVal) ||
                                    devName.includes(browserId) || browserId.includes(devName);
                            });
                        }

                        if (micMatch) {
                            console.log(`Setting default Mic/Aux device to: ${micMatch.itemName} (${micMatch.itemValue})`);
                            await this._call('SetInputSettings', {
                                inputName: micInputName,
                                inputSettings: { device_id: micMatch.itemValue || micMatch.value },
                                overlay: true
                            });
                        } else {
                            console.log(`No OBS mic match found for: ${micLabel || micDeviceId}. Keeping default.`);
                        }
                    }
                } catch (micPropErr) {
                    console.log('Could not query default mic properties:', micPropErr.message);
                }
            }
        } else if (includeMic) {
            // Fallback: Special inputs bulunamazsa eski yöntemi dene
            console.log('No special mic input found, creating KVE Mikrofon source...');
            const micResult = await this._ensureInput(sceneName, 'KVE Mikrofon', kinds.mic, {}, true);
            if (micResult) {
                micInputName = 'KVE Mikrofon';
                await this._call('SetInputMute', { inputName: micInputName, inputMuted: false }).catch(() => { });
            }
        }

        let systemResult = null;
        try { await this._removeInput('KVE Sistem Sesi'); } catch (e) { }
        if (!(includeSystemAudio && systemAudioMode === 'window')) {
            try { await this._removeInput('KVE Pencere Sesi'); } catch (e) { }
        }

        if (includeSystemAudio && systemAudioMode === 'window' && systemAudioWindowTarget) {
            const appAudioResult = await this._createWindowAudioCapture(sceneName, systemAudioWindowTarget);
            if (appAudioResult) {
                systemResult = { inputName: appAudioResult.inputName, mode: 'window' };
                if (desktopInputName) {
                    try {
                        await this._call('SetInputMute', { inputName: desktopInputName, inputMuted: true });
                    } catch (e) { }
                }
            }
        }

        if (!systemResult && includeSystemAudio && desktopInputName) {
            systemResult = { inputName: desktopInputName, mode: 'system' };
        }

        // Arrange scene items: screen at bottom, camera at top-right
        try {
            const videoSettings = await this.getVideoSettings();
            const baseWidth = videoSettings.baseWidth || 1920;
            const baseHeight = videoSettings.baseHeight || 1080;

            if (screenResult.sceneItemId) {
                // Ensure enabled
                try {
                    await this._call('SetSceneItemEnabled', {
                        sceneName,
                        sceneItemId: screenResult.sceneItemId,
                        sceneItemEnabled: true
                    });
                } catch (e) { }

                // Force full screen
                await this.setSceneItemTransform({
                    sceneName,
                    sceneItemId: screenResult.sceneItemId,
                    transform: {
                        positionX: 0,
                        positionY: 0,
                        boundsType: 'OBS_BOUNDS_SCALE_INNER',
                        boundsWidth: baseWidth,
                        boundsHeight: baseHeight,
                        alignment: 5 // Center? Or 0 (Top Left)? Default is usually Top-Left (5 is Center, 0 is Top-Left usually?)
                        // OBS alignment: 5 is Center. 0 is Top-Left?
                        // Actually let's assume valid defaults or check docs.
                        // Alignment 0 is usually fine.
                    }
                });
            }

            if (cameraResult && cameraResult.sceneItemId) {
                try {
                    await this._call('SetSceneItemEnabled', {
                        sceneName,
                        sceneItemId: cameraResult.sceneItemId,
                        sceneItemEnabled: true
                    });
                } catch (e) { }

                const scale = 0.25;
                const margin = 20;
                const x = baseWidth - baseWidth * scale - margin;
                const y = baseHeight - baseHeight * scale - margin;
                await this.setSceneItemTransform({
                    sceneName,
                    sceneItemId: cameraResult.sceneItemId,
                    transform: {
                        positionX: x,
                        positionY: y,
                        scaleX: scale,
                        scaleY: scale,
                        boundsType: 'OBS_BOUNDS_NONE' // Ensure no bounds forcing small size
                    }
                });
            }

            if (windowResults.length > 1) {
                for (let index = 1; index < windowResults.length; index += 1) {
                    const windowItem = windowResults[index];
                    if (!windowItem.sceneItemId) continue;
                    await this.setSceneItemTransform({
                        sceneName,
                        sceneItemId: windowItem.sceneItemId,
                        transform: {
                            positionX: -baseWidth * 2,
                            positionY: -baseHeight * 2,
                            boundsType: 'OBS_BOUNDS_SCALE_INNER',
                            boundsWidth: baseWidth,
                            boundsHeight: baseHeight
                        }
                    });
                }
            }

            // Ensure ordering (screen at bottom)
            try {
                if (screenResult.sceneItemId) {
                    await this._call('SetSceneItemIndex', {
                        sceneName,
                        sceneItemId: screenResult.sceneItemId,
                        sceneItemIndex: 0
                    });
                }
            } catch (e) { }
        } catch (e) { }

        return {
            sceneName,
            screenItemId: screenResult.sceneItemId,
            screenInputName: screenResult.inputName,
            cameraItemId: cameraResult ? cameraResult.sceneItemId : null,
            micInputName: micInputName || null,
            systemInputName: systemResult ? systemResult.inputName : null,
            systemAudioModeApplied: systemResult ? systemResult.mode : null,
            windowItems: windowResults
        };
    }

    async getWindowList() {
        try {
            let tempCreated = false;
            let tempName = 'KVE Temp Windows Fetch';

            try {
                await this._call('GetInputSettings', { inputName: 'KVE Pencere' });
                tempName = 'KVE Pencere';
            } catch (e) {
                let sceneNameToUse = 'KVE Kayıt';
                try {
                    const sceneList = await this._call('GetSceneList');
                    if (sceneList && sceneList.scenes && sceneList.scenes.length > 0) {
                        const hasKve = sceneList.scenes.some(s => s.sceneName === 'KVE Kayıt' || s.name === 'KVE Kayıt');
                        if (!hasKve) sceneNameToUse = sceneList.scenes[0].sceneName || sceneList.scenes[0].name;
                    }
                } catch (se) { }

                await this._call('CreateInput', {
                    sceneName: sceneNameToUse,
                    inputName: tempName,
                    inputKind: 'window_capture',
                    inputSettings: {},
                    sceneItemEnabled: false
                });
                tempCreated = true;
            }

            const props = await this._call('GetInputPropertiesListPropertyItems', {
                inputName: tempName,
                propertyName: 'window'
            });

            if (tempCreated) {
                await this._removeInput(tempName);
            }

            if (props && props.propertyItems) {
                return props.propertyItems
                    .filter(item => item.value && item.value !== '')
                    .map(item => ({
                        name: item.name,
                        id: item.value
                    }));
            }
        } catch (e) {
            console.error('OBS getWindowList error:', e.message);
        }
        return [];
    }

    async getMonitorList() {
        try {
            let tempCreated = false;
            let tempName = 'KVE Temp Monitor Fetch';

            try {
                await this._call('GetInputSettings', { inputName: 'KVE Ekran' });
                tempName = 'KVE Ekran';
            } catch (e) {
                let sceneNameToUse = 'KVE Kayıt';
                try {
                    const sceneList = await this._call('GetSceneList');
                    if (sceneList && sceneList.scenes && sceneList.scenes.length > 0) {
                        const hasKve = sceneList.scenes.some(s => s.sceneName === 'KVE Kayıt' || s.name === 'KVE Kayıt');
                        if (!hasKve) sceneNameToUse = sceneList.scenes[0].sceneName || sceneList.scenes[0].name;
                    }
                } catch (se) { }

                await this._call('CreateInput', {
                    sceneName: sceneNameToUse,
                    inputName: tempName,
                    inputKind: 'monitor_capture',
                    inputSettings: {},
                    sceneItemEnabled: false
                });
                tempCreated = true;
            }

            const props = await this._call('GetInputPropertiesListPropertyItems', {
                inputName: tempName,
                propertyName: 'monitor'
            });

            if (tempCreated) {
                await this._removeInput(tempName);
            }

            if (props && props.propertyItems) {
                return props.propertyItems.map(item => ({
                    name: item.name,
                    id: item.value
                }));
            }
        } catch (e) {
            console.error('OBS getMonitorList error:', e.message);
        }
        return [];
    }

    async setSceneItemTransform({ sceneName, sceneItemId, inputName, transform }) {
        if (!sceneName) throw new Error('sceneName required');
        let itemId = sceneItemId;
        if (!itemId && inputName && this.sceneItems[sceneName]) {
            itemId = this.sceneItems[sceneName][inputName];
        }
        if (!itemId) throw new Error('sceneItemId bulunamadı');

        const payload = {
            sceneName,
            sceneItemId: itemId,
            sceneItemTransform: transform || {}
        };

        try {
            await this._call('SetSceneItemTransform', payload);
        } catch (e) {
            // v4 fallback
            await this._call('SetSceneItemTransform', {
                'scene-name': sceneName,
                'scene-item-id': itemId,
                'scene-item-transform': transform || {}
            });
        }

        return { sceneItemId: itemId };
    }

    async applyCameraBackground(params) {
        const { sceneName, cameraItemId, colorName } = params;
        if (!sceneName || !cameraItemId) return { success: false, error: 'Eksik parametre' };

        const bgInputName = 'KVE Kamera Arka Plan';

        if (colorName === 'none') {
            try { await this._removeInput(bgInputName); } catch (e) { }
            return { success: true };
        }

        let camX, camY, camW, camH;
        try {
            ({ camX, camY, camW, camH } = await this._getCameraTransformMetrics(sceneName, cameraItemId));
        } catch (e) {
            console.error('Kamera transformu alınamadı:', e.message);
            return { success: false, error: 'Kamera transformu okunamadı' };
        }

        const colorInt = this._getOverlayColorInt(colorName);

        const padding = 20; // Add a 10px frame/border around the camera

        let createdBgId = null;
        try {
            const bgResult = await this._ensureInput(sceneName, bgInputName, 'color_source_v3', {
                color: colorInt,
                width: Math.round(camW + padding),
                height: Math.round(camH + padding)
            }, false);
            createdBgId = bgResult.sceneItemId;
        } catch (e) {
            console.error('Arka plan rengi ayarlanamadı:', e.message);
        }

        if (createdBgId) {
            await this.setSceneItemTransform({
                sceneName,
                sceneItemId: createdBgId,
                transform: {
                    positionX: Math.round(camX - padding / 2),
                    positionY: Math.round(camY - padding / 2),
                    scaleX: 1,
                    scaleY: 1,
                    boundsType: 'OBS_BOUNDS_NONE'
                }
            });

            try {
                const itemsResponse = await this._call('GetSceneItemList', { sceneName });
                const items = itemsResponse.sceneItems || itemsResponse.items || [];
                const camItem = items.find(i => i.sceneItemId === cameraItemId || i.id === cameraItemId);
                if (camItem) {
                    const idx = camItem.sceneItemIndex !== undefined ? camItem.sceneItemIndex : camItem.index;
                    if (idx !== undefined) {
                        await this._call('SetSceneItemIndex', {
                            sceneName,
                            sceneItemId: createdBgId,
                            sceneItemIndex: Math.max(0, idx - 1)
                        });
                    }
                }
            } catch (e) { }
        }
        return { success: true };
    }

    async applyCameraPanelFill(params) {
        const { sceneName, cameraItemId, colorName } = params;
        if (!sceneName || !cameraItemId) return { success: false, error: 'Eksik parametre' };

        const fillInputName = 'KVE Kamera Panel Dolgu';

        if (colorName === 'none') {
            try { await this._removeInput(fillInputName); } catch (e) { }
            return { success: true };
        }

        let camX, camY, camW, camH;
        try {
            ({ camX, camY, camW, camH } = await this._getCameraTransformMetrics(sceneName, cameraItemId));
        } catch (e) {
            console.error('Kamera panel dolgusu için transform alınamadı:', e.message);
            return { success: false, error: 'Kamera transformu okunamadı' };
        }

        const colorInt = this._getOverlayColorInt(colorName);

        let fillSceneItemId = null;
        try {
            const fillResult = await this._ensureInput(sceneName, fillInputName, 'color_source_v3', {
                color: colorInt,
                width: Math.max(1, Math.round(camW)),
                height: Math.max(1, Math.round(camH))
            }, false);
            fillSceneItemId = fillResult.sceneItemId;
        } catch (e) {
            console.error('Kamera panel dolgusu ayarlanamadı:', e.message);
        }

        if (fillSceneItemId) {
            await this.setSceneItemTransform({
                sceneName,
                sceneItemId: fillSceneItemId,
                transform: {
                    positionX: Math.round(camX),
                    positionY: Math.round(camY),
                    scaleX: 1,
                    scaleY: 1,
                    boundsType: 'OBS_BOUNDS_NONE'
                }
            });

            try {
                const itemsResponse = await this._call('GetSceneItemList', { sceneName });
                const items = itemsResponse.sceneItems || itemsResponse.items || [];
                const camItem = items.find(i => i.sceneItemId === cameraItemId || i.id === cameraItemId);
                if (camItem) {
                    const idx = camItem.sceneItemIndex !== undefined ? camItem.sceneItemIndex : camItem.index;
                    if (idx !== undefined) {
                        await this._call('SetSceneItemIndex', {
                            sceneName,
                            sceneItemId: fillSceneItemId,
                            sceneItemIndex: Math.max(0, idx - 1)
                        });
                    }
                }
            } catch (e) { }
        }

        return { success: true };
    }

    async _getInputMuteState(inputName) {
        if (!inputName) return null;
        try {
            const response = await this._call('GetInputMute', { inputName });
            if (typeof response?.inputMuted === 'boolean') return response.inputMuted;
        } catch (error) {
            try {
                const fallback = await this._call('GetMute', { source: inputName });
                if (typeof fallback?.muted === 'boolean') return fallback.muted;
            } catch (fallbackError) { }
        }
        return null;
    }

    async _suppressBaseSourcesForLiveEffect(sceneName, liveEffectInputName) {
        if (!sceneName) return;

        const state = {
            hiddenSceneItems: []
        };

        try {
            const sceneItems = await this._call('GetSceneItemList', { sceneName });
            const items = sceneItems.sceneItems || sceneItems.items || [];
            for (const item of items) {
                const sourceName = item.sourceName || item.inputName || '';
                if (!sourceName || sourceName === liveEffectInputName) continue;
                if (
                    sourceName.startsWith('KVE Pencere') ||
                    sourceName === 'KVE Ekran' ||
                    sourceName === 'KVE Kamera' ||
                    sourceName === 'KVE Kamera Arka Plan' ||
                    sourceName === 'KVE Kamera Panel Dolgu'
                ) {
                    state.hiddenSceneItems.push({
                        sceneItemId: item.sceneItemId,
                        sourceName
                    });
                    await this._setSceneItemEnabled({
                        sceneName,
                        sceneItemId: item.sceneItemId,
                        enabled: false
                    });
                }
            }
        } catch (error) {
            console.warn('[OBS] Live effect base scene suppression failed:', error.message);
        }

        this.liveEffectSuppressionState = state;
    }

    async _restoreBaseSourcesAfterLiveEffect(sceneName) {
        const state = this.liveEffectSuppressionState;
        if (!state) return;

        for (const item of state.hiddenSceneItems || []) {
            try {
                await this._setSceneItemEnabled({
                    sceneName,
                    sceneItemId: item.sceneItemId,
                    enabled: true
                });
            } catch (error) { }
        }

        this.liveEffectSuppressionState = null;
    }

    async showLiveEffectVideo({ sceneName = 'KVE Kayıt', sourcePath, volumePercent = 100, loop = false, visible = true, restart = true } = {}) {
        if (!sourcePath) throw new Error('sourcePath required');
        await this.ensureScene(sceneName);
        await this._removeInputsByPrefix(LIVE_EFFECT_IMAGE_INPUT);
        this.activeLiveEffectImageInputName = null;
        await this._removeInputsByPrefix(LIVE_EFFECT_VIDEO_INPUT);
        this.activeLiveEffectVideoInputName = `${LIVE_EFFECT_VIDEO_INPUT} ${Date.now()}`;
        const liveEffectInputName = this.activeLiveEffectVideoInputName;

        let mediaSourcePath = sourcePath;
        try {
            const metadata = await ffmpegHandler.getVideoMetadata(sourcePath);
            const rawRotation = Number(metadata?.rotation || 0);
            if (Number.isFinite(rawRotation) && Math.round(rawRotation) !== 0) {
                ensureLiveEffectCacheDir();
                const stat = fs.statSync(sourcePath);
                const sourceStem = sanitizeCacheStem(path.basename(sourcePath, path.extname(sourcePath)));
                const cacheName = `${sourceStem}_${stat.size}_${Math.round(stat.mtimeMs)}_rotfixed.mp4`;
                const cachePath = path.join(LIVE_EFFECT_CACHE_DIR, cacheName);

                if (!fs.existsSync(cachePath)) {
                    await ffmpegHandler.normalizeVideoRotation(sourcePath, cachePath);
                }
                mediaSourcePath = cachePath;
            }
        } catch (error) { }

        const mediaSettings = {
            is_local_file: true,
            local_file: mediaSourcePath,
            looping: !!loop,
            restart_on_activate: true,
            close_when_inactive: false,
            clear_on_media_end: true
        };

        const mediaResult = await this._ensureInput(
            sceneName,
            liveEffectInputName,
            'ffmpeg_source',
            mediaSettings,
            true
        );

        const videoSettings = await this.getVideoSettings();
        const baseWidth = videoSettings.baseWidth || 1920;
        const baseHeight = videoSettings.baseHeight || 1080;

        if (mediaResult.sceneItemId) {
            await this._suppressBaseSourcesForLiveEffect(sceneName, liveEffectInputName);
            try {
                    await this._call('SetSceneItemEnabled', {
                        sceneName,
                        sceneItemId: mediaResult.sceneItemId,
                        sceneItemEnabled: !!visible
                    });
                } catch (e) { }

            await this.setSceneItemTransform({
                sceneName,
                sceneItemId: mediaResult.sceneItemId,
                transform: {
                    positionX: 0,
                    positionY: 0,
                    boundsType: 'OBS_BOUNDS_SCALE_INNER',
                    boundsWidth: baseWidth,
                    boundsHeight: baseHeight,
                    alignment: 5
                }
            });

            try {
                const itemsResponse = await this._call('GetSceneItemList', { sceneName });
                const items = itemsResponse.sceneItems || itemsResponse.items || [];
                const maxIndex = items.reduce((highest, item) => {
                    const nextIndex = item.sceneItemIndex !== undefined ? item.sceneItemIndex : item.index;
                    return Math.max(highest, Number.isFinite(nextIndex) ? nextIndex : 0);
                }, 0);
                await this._call('SetSceneItemIndex', {
                    sceneName,
                    sceneItemId: mediaResult.sceneItemId,
                    sceneItemIndex: maxIndex
                });
                  } catch (e) { }
          }

        if (restart) {
            try {
                await this._call('TriggerMediaInputAction', {
                    inputName: liveEffectInputName,
                    mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
                });
            } catch (e) {
                try {
                    await this._call('PressInputPropertiesButton', {
                        inputName: liveEffectInputName,
                        propertyName: 'restart'
                    });
                } catch (e2) { }
            }
        }

        try {
            await this.setInputMute({ inputName: liveEffectInputName, muted: true });
        } catch (e) { }

        try {
            await this.setInputVolume({ inputName: liveEffectInputName, volumePercent });
        } catch (e) { }

        return {
            inputName: liveEffectInputName,
            sceneItemId: mediaResult.sceneItemId
        };
    }

    async showLiveEffectImage({ sceneName = 'KVE Kayıt', sourcePath, visible = true } = {}) {
        if (!sourcePath) throw new Error('sourcePath required');
        await this.ensureScene(sceneName);
        await this._removeInputsByPrefix(LIVE_EFFECT_VIDEO_INPUT);
        this.activeLiveEffectVideoInputName = null;
        await this._removeInputsByPrefix(LIVE_EFFECT_IMAGE_INPUT);
        this.activeLiveEffectImageInputName = `${LIVE_EFFECT_IMAGE_INPUT} ${Date.now()}`;
        const liveEffectInputName = this.activeLiveEffectImageInputName;

        const imageResult = await this._ensureInput(
            sceneName,
            liveEffectInputName,
            'image_source',
            {
                file: sourcePath
            },
            true
        );

        const videoSettings = await this.getVideoSettings();
        const baseWidth = videoSettings.baseWidth || 1920;
        const baseHeight = videoSettings.baseHeight || 1080;

        if (imageResult.sceneItemId) {
            await this._suppressBaseSourcesForLiveEffect(sceneName, liveEffectInputName);
            try {
                await this._call('SetSceneItemEnabled', {
                    sceneName,
                    sceneItemId: imageResult.sceneItemId,
                    sceneItemEnabled: !!visible
                });
            } catch (error) { }

            await this.setSceneItemTransform({
                sceneName,
                sceneItemId: imageResult.sceneItemId,
                transform: {
                    positionX: 0,
                    positionY: 0,
                    boundsType: 'OBS_BOUNDS_SCALE_INNER',
                    boundsWidth: baseWidth,
                    boundsHeight: baseHeight,
                    alignment: 5
                }
            });

            try {
                const itemsResponse = await this._call('GetSceneItemList', { sceneName });
                const items = itemsResponse.sceneItems || itemsResponse.items || [];
                const maxIndex = items.reduce((highest, item) => {
                    const nextIndex = item.sceneItemIndex !== undefined ? item.sceneItemIndex : item.index;
                    return Math.max(highest, Number.isFinite(nextIndex) ? nextIndex : 0);
                }, 0);
                await this._call('SetSceneItemIndex', {
                    sceneName,
                    sceneItemId: imageResult.sceneItemId,
                    sceneItemIndex: maxIndex
                });
            } catch (error) { }
        }

        return {
            inputName: liveEffectInputName,
            sceneItemId: imageResult.sceneItemId
        };
    }

    async updateLiveChatOverlay({ sceneName = 'KVE Kayıt', messages = [], visible = true } = {}) {
        await this.ensureScene(sceneName, { activate: false });

        const videoSettings = await this.getVideoSettings();
        const baseWidth = videoSettings.baseWidth || 1920;
        const baseHeight = videoSettings.baseHeight || 1080;
        const overlayWidth = Math.max(320, Math.round(baseWidth * 0.3));
        const overlayHeight = Math.max(240, Math.round(baseHeight * 0.4));
        const margin = Math.max(20, Math.round(baseWidth * 0.015));
        const padding = Math.max(16, Math.round(baseWidth * 0.01));
        const shouldShow = !!visible && Array.isArray(messages) && messages.length > 0;
        const overlayText = this._buildLiveChatOverlayText(messages);

        const backgroundResult = await this._ensureInput(
            sceneName,
            LIVE_CHAT_BG_INPUT,
            'color_source_v3',
            {
                color: 0xCC101010,
                width: overlayWidth,
                height: overlayHeight
            },
            false
        );

        const textResult = await this._ensureInputWithKinds(
            sceneName,
            LIVE_CHAT_TEXT_INPUT,
            ['text_gdiplus_v2', 'text_gdiplus', 'text_ft2_source_v2', 'text_ft2_source'],
            {
                text: overlayText || ' ',
                font: {
                    face: 'Segoe UI',
                    size: Math.max(22, Math.round(baseHeight * 0.022)),
                    style: 'Regular'
                },
                color: 0xFFFFFFFF,
                outline: true,
                outline_color: 0xFF000000,
                outline_size: 2,
                extents: true,
                extents_cx: Math.max(280, overlayWidth - padding * 2),
                extents_cy: Math.max(200, overlayHeight - padding * 2),
                word_wrap: true,
                valign: 'top'
            },
            false
        );

        const posX = Math.max(0, baseWidth - overlayWidth - margin);
        const posY = margin;

        if (backgroundResult?.sceneItemId) {
            await this.setSceneItemTransform({
                sceneName,
                sceneItemId: backgroundResult.sceneItemId,
                transform: {
                    positionX: posX,
                    positionY: posY,
                    scaleX: 1,
                    scaleY: 1,
                    boundsType: 'OBS_BOUNDS_NONE'
                }
            });
            await this._setSceneItemEnabled({
                sceneName,
                sceneItemId: backgroundResult.sceneItemId,
                enabled: shouldShow
            });
        }

        if (textResult?.sceneItemId) {
            await this.setSceneItemTransform({
                sceneName,
                sceneItemId: textResult.sceneItemId,
                transform: {
                    positionX: posX + padding,
                    positionY: posY + padding,
                    scaleX: 1,
                    scaleY: 1,
                    boundsType: 'OBS_BOUNDS_NONE'
                }
            });
            await this._setSceneItemEnabled({
                sceneName,
                sceneItemId: textResult.sceneItemId,
                enabled: shouldShow
            });
        }

        if (backgroundResult?.sceneItemId && textResult?.sceneItemId) {
            try {
                const itemsResponse = await this._call('GetSceneItemList', { sceneName });
                const items = itemsResponse.sceneItems || itemsResponse.items || [];
                const maxIndex = items.reduce((highest, item) => {
                    const nextIndex = item.sceneItemIndex !== undefined ? item.sceneItemIndex : item.index;
                    return Math.max(highest, Number.isFinite(nextIndex) ? nextIndex : 0);
                }, 0);
                await this._setSceneItemIndex({
                    sceneName,
                    sceneItemId: backgroundResult.sceneItemId,
                    sceneItemIndex: Math.max(0, maxIndex - 1)
                });
                await this._setSceneItemIndex({
                    sceneName,
                    sceneItemId: textResult.sceneItemId,
                    sceneItemIndex: Math.max(0, maxIndex)
                });
            } catch (error) { }
        }

        return {
            inputName: LIVE_CHAT_TEXT_INPUT,
            sceneItemId: textResult?.sceneItemId || null,
            visible: shouldShow
        };
    }

    async hideLiveEffectVideo({ sceneName = 'KVE Kayıt' } = {}) {
        try {
            const sceneItems = await this._call('GetSceneItemList', { sceneName });
            const items = sceneItems.sceneItems || sceneItems.items || [];
            const liveItems = items.filter((entry) => {
                const name = entry.sourceName || entry.inputName || '';
                return name === LIVE_EFFECT_VIDEO_INPUT || name.startsWith(`${LIVE_EFFECT_VIDEO_INPUT} `);
            });
            for (const item of liveItems) {
                if (item && item.sceneItemId) {
                    try {
                        await this._call('SetSceneItemEnabled', {
                            sceneName,
                            sceneItemId: item.sceneItemId,
                            sceneItemEnabled: false
                        });
                    } catch (e) { }
                }
            }
        } catch (e) { }

        await this._restoreBaseSourcesAfterLiveEffect(sceneName);

        return { success: true };
    }

    async hideLiveEffectImage({ sceneName = 'KVE Kayıt' } = {}) {
        try {
            const sceneItems = await this._call('GetSceneItemList', { sceneName });
            const items = sceneItems.sceneItems || sceneItems.items || [];
            const liveItems = items.filter((entry) => {
                const name = entry.sourceName || entry.inputName || '';
                return name === LIVE_EFFECT_IMAGE_INPUT || name.startsWith(`${LIVE_EFFECT_IMAGE_INPUT} `);
            });
            for (const item of liveItems) {
                if (item && item.sceneItemId) {
                    try {
                        await this._call('SetSceneItemEnabled', {
                            sceneName,
                            sceneItemId: item.sceneItemId,
                            sceneItemEnabled: false
                        });
                    } catch (error) { }
                }
            }
        } catch (error) { }

        await this._restoreBaseSourcesAfterLiveEffect(sceneName);

        return { success: true };
    }

    async pauseLiveEffectVideo({ sceneName = 'KVE Kayıt' } = {}) {
        const inputName = this.activeLiveEffectVideoInputName;
        if (!inputName) {
            await this.hideLiveEffectVideo({ sceneName });
            return { success: true, paused: false, inputName: null };
        }

        try {
            await this._call('TriggerMediaInputAction', {
                inputName,
                mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE'
            });
        } catch (error) { }

        await this.hideLiveEffectVideo({ sceneName });
        return { success: true, paused: true, inputName };
    }

    async resumeLiveEffectVideo({ sceneName = 'KVE Kayıt' } = {}) {
        const inputName = this.activeLiveEffectVideoInputName;
        if (!inputName) {
            return { success: false, resumed: false, error: 'No active live effect video input.' };
        }

        const sceneItems = await this._call('GetSceneItemList', { sceneName });
        const items = sceneItems.sceneItems || sceneItems.items || [];
        const item = items.find((entry) => {
            const name = entry.sourceName || entry.inputName || '';
            return name === inputName;
        });

        if (item?.sceneItemId) {
            await this._suppressBaseSourcesForLiveEffect(sceneName, inputName);
            await this._setSceneItemEnabled({
                sceneName,
                sceneItemId: item.sceneItemId,
                enabled: true
            });
            try {
                await this._call('SetSceneItemIndex', {
                    sceneName,
                    sceneItemId: item.sceneItemId,
                    sceneItemIndex: items.reduce((highest, next) => {
                        const idx = next.sceneItemIndex !== undefined ? next.sceneItemIndex : next.index;
                        return Math.max(highest, Number.isFinite(idx) ? idx : 0);
                    }, 0)
                });
            } catch (error) { }
        }

        try {
            await this._call('TriggerMediaInputAction', {
                inputName,
                mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY'
            });
        } catch (error) { }

        return { success: true, resumed: true, inputName, sceneItemId: item?.sceneItemId || null };
    }

    async hideLiveChatOverlay({ sceneName = 'KVE Kayıt' } = {}) {
        try {
            const sceneItems = await this._call('GetSceneItemList', { sceneName });
            const items = sceneItems.sceneItems || sceneItems.items || [];
            for (const item of items) {
                const sourceName = item.sourceName || item.inputName;
                if ((sourceName === LIVE_CHAT_TEXT_INPUT || sourceName === LIVE_CHAT_BG_INPUT) && item.sceneItemId) {
                    await this._setSceneItemEnabled({
                        sceneName,
                        sceneItemId: item.sceneItemId,
                        enabled: false
                    });
                }
            }
        } catch (error) { }

        return { success: true };
    }

    async removeLiveEffectVideo({ sceneName = 'KVE Kayıt' } = {}) {
        await this.hideLiveEffectVideo({ sceneName });
        try {
            await this._removeInputsByPrefix(LIVE_EFFECT_VIDEO_INPUT);
        } catch (e) { }
        this.activeLiveEffectVideoInputName = null;
        return { success: true };
    }

    async removeLiveEffectImage({ sceneName = 'KVE Kayıt' } = {}) {
        await this.hideLiveEffectImage({ sceneName });
        try {
            await this._removeInputsByPrefix(LIVE_EFFECT_IMAGE_INPUT);
        } catch (e) { }
        this.activeLiveEffectImageInputName = null;
        return { success: true };
    }

    async removeLiveChatOverlay({ sceneName = 'KVE Kayıt' } = {}) {
        await this.hideLiveChatOverlay({ sceneName });
        try { await this._removeInput(LIVE_CHAT_TEXT_INPUT); } catch (error) { }
        try { await this._removeInput(LIVE_CHAT_BG_INPUT); } catch (error) { }
        return { success: true };
    }

    async _getCameraTransformMetrics(sceneName, cameraItemId) {
        const trRes = await this._call('GetSceneItemTransform', {
            sceneName,
            sceneItemId: cameraItemId
        });
        const tr = trRes.sceneItemTransform || trRes;
        const camX = tr.positionX || 0;
        const camY = tr.positionY || 0;
        const camW = (tr.boundsType && tr.boundsType !== 'OBS_BOUNDS_NONE')
            ? tr.boundsWidth
            : (tr.sourceWidth || 1920) * (tr.scaleX || 1);
        const camH = (tr.boundsType && tr.boundsType !== 'OBS_BOUNDS_NONE')
            ? tr.boundsHeight
            : (tr.sourceHeight || 1080) * (tr.scaleY || 1);
        return { camX, camY, camW, camH };
    }

    _getOverlayColorInt(colorName) {
        const colorMap = {
            black: 0xFF000000,
            white: 0xFFFFFFFF,
            charcoal: 0xFF333333,
            purple: 0xFFFF0080,
            turquoise: 0xFFD0E040,
            green: 0xFF00FF00,
            blue: 0xFFFF0000,
            blur: 0xFF808080
        };
        return colorMap[colorName] !== undefined ? colorMap[colorName] : 0xFF000000;
    }

    async setInputVolume({ inputName, volumePercent }) {
        if (!inputName) throw new Error('inputName required');
        const mul = Math.max(0, Math.min(4, (volumePercent || 100) / 100));
        try {
            await this._call('SetInputVolume', {
                inputName,
                inputVolumeMul: mul
            });
        } catch (e) {
            // v4 fallback
            await this._call('SetVolume', {
                source: inputName,
                volume: mul
            });
        }
        return { inputName, volumePercent };
    }

    async setInputMonitoring({ inputName, monitorType }) {
        if (!inputName) throw new Error('inputName required');
        try {
            await this._call('SetInputAudioMonitorType', {
                inputName,
                monitorType: monitorType || 'OBS_MONITORING_TYPE_NONE'
            });
        } catch (e) {
            // v4 fallback
            await this._call('SetAudioMonitorType', {
                sourceName: inputName,
                monitorType: monitorType || 'monitorOff'
            });
        }
        return { inputName, monitorType };
    }

    async setInputMute({ inputName, muted }) {
        if (!inputName) throw new Error('inputName required');
        try {
            await this._call('SetInputMute', {
                inputName,
                inputMuted: muted
            });
        } catch (e) {
            // v4 fallback
            try {
                await this._call('SetMute', {
                    source: inputName,
                    mute: muted
                });
            } catch (e2) { }
        }
        return { inputName, muted };
    }

    async setMicrophoneDevice({ inputName, deviceId, deviceLabel }) {
        if (!inputName) throw new Error('inputName required');
        if (!deviceId || deviceId === 'default') {
            return { inputName, deviceId, changed: false };
        }

        const response = await this._call('GetInputPropertiesListPropertyItems', {
            inputName,
            propertyName: 'device_id'
        });
        const devices = response.propertyItems || [];
        if (!Array.isArray(devices) || devices.length === 0) {
            throw new Error('OBS mikrofon cihaz listesi alınamadı.');
        }

        const normalizedLabel = String(deviceLabel || '').toLowerCase().trim();
        const normalizedDeviceId = String(deviceId || '').toLowerCase();
        let match = null;

        if (normalizedLabel) {
            match = devices.find((device) => {
                const candidateName = String(device.itemName || device.name || '').toLowerCase().trim();
                return candidateName.includes(normalizedLabel) || normalizedLabel.includes(candidateName);
            });
        }

        if (!match) {
            match = devices.find((device) => {
                const candidateValue = String(device.itemValue || device.value || '').toLowerCase();
                const candidateName = String(device.itemName || device.name || '').toLowerCase();
                return candidateValue.includes(normalizedDeviceId)
                    || normalizedDeviceId.includes(candidateValue)
                    || candidateName.includes(normalizedDeviceId)
                    || normalizedDeviceId.includes(candidateName);
            });
        }

        if (!match) {
            throw new Error('Secilen mikrofon OBS tarafinda bulunamadi.');
        }

        await this._call('SetInputSettings', {
            inputName,
            inputSettings: {
                device_id: match.itemValue || match.value
            },
            overlay: true
        });

        return {
            inputName,
            deviceId: match.itemValue || match.value,
            deviceName: match.itemName || match.name || ''
        };
    }

    async startRecording() {
        const statusBefore = await this.getRecordingStatus().catch(() => null);

        if (statusBefore && statusBefore.outputActive) {
            return {
                started: true,
                alreadyActive: true,
                outputActive: true,
                outputPath: statusBefore.outputPath || this.lastRecordingPath || null
            };
        }

        try {
            await this._call('StartRecord');
        } catch (error) {
            const statusAfterFailure = await this.getRecordingStatus().catch(() => null);
            const errorDetails = [
                error.message || String(error),
                statusAfterFailure ? `outputActive=${statusAfterFailure.outputActive}` : null,
                statusAfterFailure && statusAfterFailure.outputPath ? `outputPath=${statusAfterFailure.outputPath}` : null
            ].filter(Boolean).join(' | ');
            throw new Error(errorDetails);
        }

        const startWait = Date.now();
        let statusAfter = await this.getRecordingStatus().catch(() => null);
        while (Date.now() - startWait < 2500 && (!statusAfter || !statusAfter.outputActive)) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            statusAfter = await this.getRecordingStatus().catch(() => null);
        }

        if (statusAfter && statusAfter.outputPath) {
            this.lastRecordingPath = statusAfter.outputPath;
        }

        return {
            started: true,
            outputActive: statusAfter ? !!statusAfter.outputActive : true,
            outputPath: statusAfter && statusAfter.outputPath ? statusAfter.outputPath : this.lastRecordingPath || null
        };
    }

    async pauseRecording() {
        try {
            await this._call('PauseRecord');
        } catch (e) {
            // Older OBS might not support pause
            throw e;
        }
        return { paused: true };
    }

    async resumeRecording() {
        await this._call('ResumeRecord');
        return { resumed: true };
    }

    async stopRecording() {
        const result = await this._call('StopRecord');
        return { stopped: true, outputPath: result?.outputPath || this.lastRecordingPath || null };
    }

    async getRecordingStatus() {
        const status = await this._call('GetRecordStatus');
        return {
            ...status,
            lastOutputPath: this.lastRecordingPath || null
        };
    }

    async getVideoSettings() {
        try {
            const settings = await this._call('GetVideoSettings');
            return settings;
        } catch (e) {
            return {
                baseWidth: 1920,
                baseHeight: 1080,
                outputWidth: 1920,
                outputHeight: 1080
            };
        }
    }

    async getSourceScreenshot({ sourceName, width, height, format } = {}) {
        if (!sourceName) throw new Error('sourceName required');
        const imageFormat = format || 'png';
        const imageWidth = width || 1280;
        const imageHeight = height || 720;
        try {
            const result = await this._call('GetSourceScreenshot', {
                sourceName,
                imageFormat,
                imageWidth,
                imageHeight
            });
            return { imageData: result.imageData };
        } catch (e) {
            // v4 fallback
            const result = await this._call('TakeSourceScreenshot', {
                sourceName,
                embedPictureFormat: imageFormat,
                width: imageWidth,
                height: imageHeight
            });
            return { imageData: result.img || result.imageData };
        }
    }

    async debugSceneSources(sceneName) {
        const results = {};

        // Get scene items
        try {
            const sceneItems = await this._call('GetSceneItemList', { sceneName });
            results.sceneItems = sceneItems.sceneItems || sceneItems.items || [];
        } catch (e) {
            results.sceneItemsError = e.message;
        }

        // Get input list
        try {
            const inputList = await this._call('GetInputList');
            results.inputs = (inputList.inputs || inputList).map(i => ({
                inputName: i.inputName || i.name,
                inputKind: i.inputKind || i.type
            }));
        } catch (e) {
            results.inputsError = e.message;
        }

        // For each KVE input, get its settings
        const kveInputs = ['KVE Ekran', 'KVE Pencere', 'KVE Kamera', 'KVE Mikrofon', 'KVE Sistem Sesi'];
        results.inputDetails = {};
        for (const name of kveInputs) {
            try {
                const settings = await this._call('GetInputSettings', { inputName: name });
                results.inputDetails[name] = {
                    inputKind: settings.inputKind,
                    inputSettings: settings.inputSettings
                };
            } catch (e) {
                results.inputDetails[name] = { error: e.message };
            }
        }

        // Get current program scene
        try {
            const current = await this._call('GetCurrentProgramScene');
            results.currentScene = current.currentProgramSceneName || current.sceneName || current.name;
        } catch (e) {
            results.currentSceneError = e.message;
        }

        // Get video settings
        try {
            results.videoSettings = await this.getVideoSettings();
        } catch (e) {
            results.videoSettingsError = e.message;
        }

        console.log('=== OBS DEBUG ===');
        console.log(JSON.stringify(results, null, 2));
        console.log('=== END DEBUG ===');

        return results;
    }
}

module.exports = new OBSController();
