const { ipcRenderer, shell } = require('electron');
const path = require('path');

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
            const value = this.t(el.getAttribute('data-i18n'), '');
            if (value) el.textContent = value;
        });
        document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
            const value = this.t(el.getAttribute('data-i18n-aria'), '');
            if (value) el.setAttribute('aria-label', value);
        });
        const titleEl = document.querySelector('title[data-i18n]');
        if (titleEl) {
            const value = this.t(titleEl.getAttribute('data-i18n'), '');
            if (value) document.title = value;
        }
    }
};

function t(key, fallback, params = {}) {
    return i18nState.t(key, fallback, params);
}

const state = {
    filePath: '',
    outputPath: '',
    cachedAudioPath: '',
    cachedSourcePath: '',
    cachedDubOnly: false,
    studioDubbingId: '',
    studioSegments: [],
    studioTargetLanguage: '',
    editingSegmentId: '',
    estimateStatus: '',
    busy: false,
    sourceLanguage: 'auto',
    targetLanguage: 'tr',
    dubVolume: 'high',
    originalVolume: 'very_low',
    dubOnly: false,
    status: ''
};

const els = {
    statusLine: document.getElementById('status-line'),
    selectedFile: document.getElementById('selected-file'),
    outputFile: document.getElementById('output-file'),
    cachedAudio: document.getElementById('cached-audio'),
    estimateStatus: document.getElementById('estimate-status'),
    sourceLanguage: document.getElementById('source-language'),
    targetLanguage: document.getElementById('target-language'),
    dubVolume: document.getElementById('dub-volume'),
    originalVolume: document.getElementById('original-volume'),
    dubOnly: document.getElementById('dub-only'),
    dubVolumeField: document.getElementById('dub-volume-field'),
    originalVolumeField: document.getElementById('original-volume-field'),
    btnCloseTool: document.getElementById('btn-close-tool'),
    btnChangeFile: document.getElementById('btn-change-file'),
    btnCheckEstimate: document.getElementById('btn-check-estimate'),
    btnPrepareStudio: document.getElementById('btn-prepare-studio'),
    btnCreateDubbedCopy: document.getElementById('btn-create-dubbed-copy'),
    btnRenderStudio: document.getElementById('btn-render-studio'),
    btnRemixDubbedCopy: document.getElementById('btn-remix-dubbed-copy'),
    btnOpenOutputFolder: document.getElementById('btn-open-output-folder'),
    studioSection: document.getElementById('studio-section'),
    studioSegmentList: document.getElementById('studio-segment-list'),
    segmentEditor: document.getElementById('segment-editor'),
    segmentText: document.getElementById('segment-text'),
    btnSaveSegment: document.getElementById('btn-save-segment'),
    btnCancelSegmentEdit: document.getElementById('btn-cancel-segment-edit'),
    liveRegion: document.getElementById('live-region')
};

function setStatus(message, { announce = true } = {}) {
    state.status = String(message || '');
    render();
    if (announce && els.liveRegion) {
        els.liveRegion.textContent = state.status;
    }
}

function buildOutputPath(inputPath) {
    const parsed = path.parse(inputPath);
    const extension = parsed.ext || '.mp4';
    return path.join(parsed.dir, `${parsed.name}-elevenlabs-dublaj${extension}`);
}

function getOriginalVolumeValue() {
    if (state.dubOnly) return 0;
    if (state.originalVolume === 'medium') return 0.16;
    if (state.originalVolume === 'low') return 0.1;
    return 0.06;
}

function getDubVolumeValue() {
    if (state.dubOnly) return 10;
    if (state.dubVolume === 'very_high') return 16;
    if (state.dubVolume === 'medium') return 6;
    return 10;
}

function formatDuration(seconds) {
    const safeSeconds = Math.max(0, Math.round(Number(seconds || 0)));
    const minutes = Math.floor(safeSeconds / 60);
    const rest = safeSeconds % 60;
    return t('elevenlabs_dubbing_tool.duration_format', '{minutes} dakika {seconds} saniye', {
        minutes,
        seconds: rest
    });
}

function estimateDubbingCredits(durationSeconds) {
    return Math.ceil((Math.max(1, Number(durationSeconds || 0)) / 60) * 3000);
}

function resetStudioState() {
    state.studioDubbingId = '';
    state.studioSegments = [];
    state.studioTargetLanguage = '';
    state.editingSegmentId = '';
}

function formatSegmentTime(seconds) {
    const value = Math.max(0, Number(seconds || 0));
    const minutes = Math.floor(value / 60);
    const rest = Math.floor(value % 60).toString().padStart(2, '0');
    return `${minutes}:${rest}`;
}

function buildSegmentOptionText(segment, index) {
    const text = String(segment?.text || '').replace(/\s+/g, ' ').trim();
    const shortText = text.length > 90 ? `${text.slice(0, 87)}...` : text;
    return t('elevenlabs_dubbing_tool.segment_option', 'Segment {index}, {start}-{end}: {text}', {
        index: index + 1,
        start: formatSegmentTime(segment?.startTime),
        end: formatSegmentTime(segment?.endTime),
        text: shortText
    });
}

function getSelectedStudioSegment() {
    const selectedId = String(els.studioSegmentList?.value || '').trim();
    return state.studioSegments.find((segment) => String(segment.id) === selectedId) || null;
}

function render() {
    if (els.sourceLanguage) els.sourceLanguage.value = state.sourceLanguage;
    if (els.targetLanguage) els.targetLanguage.value = state.targetLanguage;
    if (els.dubVolume) els.dubVolume.value = state.dubVolume;
    if (els.originalVolume) els.originalVolume.value = state.originalVolume;
    if (els.dubOnly) {
        els.dubOnly.checked = state.dubOnly;
        els.dubOnly.setAttribute('aria-describedby', 'dub-only-hint');
    }
    if (els.dubVolumeField) {
        els.dubVolumeField.hidden = state.dubOnly;
    }
    if (els.originalVolumeField) {
        els.originalVolumeField.hidden = state.dubOnly;
    }
    if (els.statusLine) {
        els.statusLine.textContent = state.status || t('elevenlabs_dubbing_tool.status_ready', 'Dublaj ayarları hazır.');
    }
    if (els.selectedFile) {
        els.selectedFile.textContent = state.filePath
            ? t('elevenlabs_dubbing_tool.selected_file', 'Seçili dosya: {path}', { path: state.filePath })
            : t('elevenlabs_dubbing_tool.no_file_selected', 'Henüz dosya seçilmedi.');
    }
    if (els.outputFile) {
        els.outputFile.textContent = state.outputPath
            ? t('elevenlabs_dubbing_tool.output_file', 'Çıktı dosyası: {path}', { path: state.outputPath })
            : t('elevenlabs_dubbing_tool.output_file_empty', 'Henüz çıktı oluşturulmadı.');
    }
    if (els.cachedAudio) {
        els.cachedAudio.textContent = state.cachedAudioPath && state.cachedSourcePath
            ? t('elevenlabs_dubbing_tool.cached_audio_ready', 'Ham dublaj sesi saklandı. Kaynak dosya: {path}', { path: state.cachedSourcePath })
            : t('elevenlabs_dubbing_tool.cached_audio_empty', 'Henüz saklanan ham dublaj sesi yok.');
    }
    if (els.estimateStatus) {
        els.estimateStatus.textContent = state.estimateStatus
            || t('elevenlabs_dubbing_tool.estimate_status_empty', 'Henüz süre ve kredi tahmini yapılmadı.');
    }
    if (els.studioSection) {
        els.studioSection.hidden = state.studioSegments.length === 0;
    }
    if (els.studioSegmentList) {
        const currentValue = String(els.studioSegmentList.value || '');
        els.studioSegmentList.innerHTML = '';
        state.studioSegments.forEach((segment, index) => {
            const option = document.createElement('option');
            option.value = String(segment.id);
            option.textContent = buildSegmentOptionText(segment, index);
            els.studioSegmentList.appendChild(option);
        });
        if (currentValue && state.studioSegments.some((segment) => String(segment.id) === currentValue)) {
            els.studioSegmentList.value = currentValue;
        } else if (state.studioSegments[0]) {
            els.studioSegmentList.value = String(state.studioSegments[0].id);
        }
    }
    if (els.segmentEditor) {
        els.segmentEditor.hidden = !state.editingSegmentId;
    }
    if (els.btnPrepareStudio) {
        els.btnPrepareStudio.disabled = state.busy || !state.filePath;
    }
    if (els.btnCreateDubbedCopy) {
        els.btnCreateDubbedCopy.disabled = state.busy || !state.filePath;
    }
    if (els.btnRenderStudio) {
        els.btnRenderStudio.disabled = state.busy || !state.studioDubbingId || state.studioSegments.length === 0;
    }
    if (els.btnRemixDubbedCopy) {
        els.btnRemixDubbedCopy.disabled = state.busy || !state.cachedAudioPath || !state.cachedSourcePath;
    }
    if (els.btnOpenOutputFolder) {
        els.btnOpenOutputFolder.disabled = !state.outputPath;
    }
    if (els.btnChangeFile) {
        els.btnChangeFile.disabled = state.busy;
    }
    if (els.btnCheckEstimate) {
        els.btnCheckEstimate.disabled = state.busy || !state.filePath;
    }
    if (els.btnCloseTool) {
        els.btnCloseTool.disabled = state.busy;
    }
}

async function chooseFile() {
    const result = await ipcRenderer.invoke('open-file-dialog', {
        title: t('elevenlabs_dubbing_tool.import_dialog_title', 'ElevenLabs dublaj için dosya seçin'),
        properties: ['openFile'],
        filters: [
            { name: t('runtime.app.video_files_filter', 'Video Files'), extensions: ['mp4', 'wmv', 'avi', 'mkv', 'mov', 'webm', 'flv', 'm4v'] },
            { name: t('dialog.common.all_files', 'All Files'), extensions: ['*'] }
        ]
    });
    const filePath = Array.isArray(result?.filePaths) ? result.filePaths[0] : '';
    if (!filePath) return;
        state.filePath = filePath;
    state.outputPath = '';
    state.cachedAudioPath = '';
    state.cachedSourcePath = '';
    state.cachedDubOnly = false;
    resetStudioState();
    state.estimateStatus = '';
    setStatus(t('elevenlabs_dubbing_tool.status_file_selected', 'Dosya seçildi. Dublaj ayarlarını yapıp işlemi başlatabilirsiniz.'));
}

async function prepareStudioSegments() {
    if (!state.filePath) {
        setStatus(t('elevenlabs_dubbing_tool.status_file_required', 'Önce dublajlanacak dosyayı seçin.'));
        return;
    }
    if (!state.targetLanguage || state.targetLanguage === 'auto') {
        setStatus(t('elevenlabs_dubbing_tool.status_target_required', 'Hedef dili seçin.'));
        return;
    }
    state.busy = true;
    resetStudioState();
    setStatus(t('elevenlabs_dubbing_tool.status_studio_preparing', 'ElevenLabs Studio metinleri hazırlanıyor...'));
    try {
        const response = await ipcRenderer.invoke('elevenlabs-prepare-dubbing-studio-from-file', {
            filePath: state.filePath,
            sourceLanguage: state.sourceLanguage,
            targetLanguage: state.targetLanguage,
            dropBackgroundAudio: !state.dubOnly
        });
        if (!response?.success) {
            throw new Error(response?.error || 'elevenlabs_dubbing_studio_unavailable');
        }
        state.studioDubbingId = String(response.dubbingId || '').trim();
        state.studioTargetLanguage = String(response.targetLanguage || state.targetLanguage || '').trim();
        state.studioSegments = Array.isArray(response.segments) ? response.segments : [];
        setStatus(t('elevenlabs_dubbing_tool.status_studio_ready', '{count} dublaj metni hazır. Segment listesinde yukarı ve aşağı oklarla gezebilirsiniz.', {
            count: state.studioSegments.length
        }));
    } catch (error) {
        resetStudioState();
        setStatus(t('elevenlabs_dubbing_tool.status_studio_unavailable', 'ElevenLabs Studio metin düzenleme bu hesapta kullanılamıyor olabilir: {error}', {
            error: error?.message || error || 'unknown_error'
        }));
    } finally {
        state.busy = false;
        render();
        if (state.studioSegments.length) {
            els.studioSegmentList?.focus();
        }
    }
}

function openSelectedSegmentEditor() {
    const segment = getSelectedStudioSegment();
    if (!segment) {
        setStatus(t('elevenlabs_dubbing_tool.status_no_segment_selected', 'Düzenlemek için bir segment seçin.'));
        return;
    }
    state.editingSegmentId = String(segment.id);
    render();
    if (els.segmentText) {
        els.segmentText.value = String(segment.text || '');
        els.segmentText.focus();
        els.segmentText.select();
    }
    setStatus(t('elevenlabs_dubbing_tool.status_segment_editing', 'Segment {index} düzenleniyor.', {
        index: Math.max(1, state.studioSegments.findIndex((item) => String(item.id) === String(segment.id)) + 1)
    }));
}

async function saveSelectedSegment() {
    const segment = state.studioSegments.find((item) => String(item.id) === String(state.editingSegmentId));
    if (!segment) {
        setStatus(t('elevenlabs_dubbing_tool.status_no_segment_selected', 'Düzenlemek için bir segment seçin.'));
        return;
    }
    const text = String(els.segmentText?.value || '').trim();
    if (!text) {
        setStatus(t('elevenlabs_dubbing_tool.status_segment_text_required', 'Segment metni boş olamaz.'));
        return;
    }
    state.busy = true;
    setStatus(t('elevenlabs_dubbing_tool.status_segment_saving', 'Segment metni ElevenLabs üzerinde kaydediliyor...'));
    try {
        const response = await ipcRenderer.invoke('elevenlabs-update-dubbing-studio-segment', {
            dubbingId: state.studioDubbingId,
            segmentId: segment.id,
            language: state.studioTargetLanguage || state.targetLanguage,
            text
        });
        if (!response?.success) {
            throw new Error(response?.error || 'elevenlabs_dubbing_segment_update_failed');
        }
        segment.text = text;
        state.editingSegmentId = '';
        setStatus(t('elevenlabs_dubbing_tool.status_segment_saved', 'Segment metni kaydedildi.'));
    } catch (error) {
        setStatus(t('elevenlabs_dubbing_tool.status_segment_save_failed', 'Segment metni kaydedilemedi: {error}', {
            error: error?.message || error || 'unknown_error'
        }));
    } finally {
        state.busy = false;
        render();
        els.studioSegmentList?.focus();
    }
}

async function renderStudioDubbedCopy() {
    if (!state.studioDubbingId) {
        setStatus(t('elevenlabs_dubbing_tool.status_studio_required', 'Önce metinleri düzenlemek için Studio hazırlığını çalıştırın.'));
        return;
    }
    state.busy = true;
    setStatus(t('elevenlabs_dubbing_tool.status_studio_rendering', 'Düzenlenmiş metinlerle dublajlı çıktı oluşturuluyor...'));
    try {
        const response = await ipcRenderer.invoke('elevenlabs-render-dubbing-studio-project', {
            dubbingId: state.studioDubbingId,
            targetLanguage: state.studioTargetLanguage || state.targetLanguage,
            outputPath: buildOutputPath(state.filePath)
        });
        if (!response?.success) {
            throw new Error(response?.error || 'elevenlabs_dubbing_studio_render_failed');
        }
        state.outputPath = String(response.outputPath || '').trim();
        setStatus(t('elevenlabs_dubbing_tool.status_created', 'Dublajlı kopya oluşturuldu: {path}', {
            path: state.outputPath
        }));
    } catch (error) {
        setStatus(t('elevenlabs_dubbing_tool.status_studio_render_failed', 'Düzenlenmiş dublajlı kopya oluşturulamadı: {error}', {
            error: error?.message || error || 'unknown_error'
        }));
    } finally {
        state.busy = false;
        render();
    }
}

async function checkEstimate() {
    if (!state.filePath) {
        setStatus(t('elevenlabs_dubbing_tool.status_file_required', 'Önce dublajlanacak dosyayı seçin.'));
        return;
    }
    state.busy = true;
    state.estimateStatus = t('elevenlabs_dubbing_tool.estimate_status_checking', 'Süre ve kredi bilgisi kontrol ediliyor...');
    render();
    try {
        const metadataResponse = await ipcRenderer.invoke('get-video-metadata', state.filePath);
        if (!metadataResponse?.success) {
            throw new Error(metadataResponse?.error || 'metadata_failed');
        }
        const metadata = metadataResponse.data || metadataResponse.metadata || metadataResponse;
        const durationSeconds = Number(metadata?.duration || metadata?.format?.duration || 0) || 0;
        const estimatedCredits = estimateDubbingCredits(durationSeconds);
        const subscriptionResponse = await ipcRenderer.invoke('elevenlabs-get-subscription-info');
        if (!subscriptionResponse?.success) {
            throw new Error(subscriptionResponse?.error || 'subscription_failed');
        }
        const subscription = subscriptionResponse.subscription || {};
        const used = Number(subscription.character_count || 0) || 0;
        const limit = Number(subscription.character_limit || 0) || 0;
        const remaining = Math.max(0, limit - used);
        const overage = subscription.max_credit_limit_extension;
        const overageAllowed = overage === 'unlimited' || Number(overage || 0) > 0 || subscription.can_extend_character_limit === true;
        const key = remaining >= estimatedCredits
            ? 'elevenlabs_dubbing_tool.estimate_status_enough'
            : overageAllowed
                ? 'elevenlabs_dubbing_tool.estimate_status_overage_possible'
                : 'elevenlabs_dubbing_tool.estimate_status_not_enough';
        const fallback = remaining >= estimatedCredits
            ? 'Video süresi: {duration}. Tahmini kredi: {estimated}. Kalan kredi: {remaining}. Kredi yeterli görünüyor.'
            : overageAllowed
                ? 'Video süresi: {duration}. Tahmini kredi: {estimated}. Kalan kredi: {remaining}. Kalan kredi yetmeyebilir, ancak hesabınızda aşım/ek kullanım izni görünüyor.'
                : 'Video süresi: {duration}. Tahmini kredi: {estimated}. Kalan kredi: {remaining}. Kredi yeterli görünmüyor.';
        state.estimateStatus = t(key, fallback, {
            duration: formatDuration(durationSeconds),
            estimated: estimatedCredits,
            remaining
        });
        setStatus(state.estimateStatus);
    } catch (error) {
        state.estimateStatus = t('elevenlabs_dubbing_tool.estimate_status_failed', 'Süre ve kredi tahmini alınamadı: {error}', {
            error: error?.message || error || 'unknown_error'
        });
        setStatus(state.estimateStatus);
    } finally {
        state.busy = false;
        render();
    }
}

async function createDubbedCopy() {
    if (!state.filePath) {
        setStatus(t('elevenlabs_dubbing_tool.status_file_required', 'Önce dublajlanacak dosyayı seçin.'));
        return;
    }
    if (!state.targetLanguage || state.targetLanguage === 'auto') {
        setStatus(t('elevenlabs_dubbing_tool.status_target_required', 'Hedef dili seçin.'));
        return;
    }
    state.busy = true;
    setStatus(t('elevenlabs_dubbing_tool.status_uploading', 'Dosya ElevenLabs Dubbing servisine gönderiliyor...'));
    try {
        const dubbingResponse = await ipcRenderer.invoke('elevenlabs-create-dubbing-audio-from-file', {
            filePath: state.filePath,
            sourceLanguage: state.sourceLanguage,
            targetLanguage: state.targetLanguage,
            dropBackgroundAudio: !state.dubOnly
        });
        if (!dubbingResponse?.success) {
            throw new Error(dubbingResponse?.error || 'elevenlabs_dubbing_failed');
        }
        state.cachedAudioPath = String(dubbingResponse.outputPath || '').trim();
        state.cachedSourcePath = state.filePath;
        state.cachedDubOnly = state.dubOnly;
        setStatus(t('elevenlabs_dubbing_tool.status_mixing', 'Dublaj indirildi. Tek sesli kopya oluşturuluyor...'));
        await mixCachedDubbing({ outputPath: buildOutputPath(state.filePath) });
    } catch (error) {
        setStatus(t('elevenlabs_dubbing_tool.status_failed', 'Dublajlı kopya oluşturulamadı: {error}', {
            error: error?.message || error || 'unknown_error'
        }));
    } finally {
        state.busy = false;
        render();
    }
}

async function mixCachedDubbing({ outputPath = '' } = {}) {
    if (!state.cachedSourcePath || !state.cachedAudioPath) {
        throw new Error(t('elevenlabs_dubbing_tool.status_cache_missing', 'Yeniden dengelemek için saklanan dublaj sesi bulunamadı.'));
    }
    if (state.dubOnly !== state.cachedDubOnly) {
        throw new Error(t('elevenlabs_dubbing_tool.status_cache_mode_mismatch', 'Bu seçenek için dublajı yeniden oluşturun. Yalnızca dublaj modu arka plan sesini ElevenLabs tarafında farklı hazırlar.'));
    }
    const response = await ipcRenderer.invoke('ffmpeg-create-single-dubbed-recording-from-audio', {
        videoPath: state.cachedSourcePath,
        dubAudioPath: state.cachedAudioPath,
        outputPath: outputPath || buildOutputPath(state.cachedSourcePath),
        trackTitle: state.dubOnly
            ? t('elevenlabs_dubbing_tool.dub_only_track_title', 'Dublaj')
            : t('broadcast_room.dub_track_title', 'Dublaj + Özgün'),
        originalUnderVolume: getOriginalVolumeValue(),
        dubVolume: getDubVolumeValue()
    });
    if (!response?.success) {
        throw new Error(response?.error || 'dubbing_mix_failed');
    }
    state.outputPath = String(response.outputPath || outputPath || '');
    setStatus(t('elevenlabs_dubbing_tool.status_created', 'Dublajlı kopya oluşturuldu: {path}', {
        path: state.outputPath
    }));
}

async function remixDubbedCopy() {
    state.busy = true;
    setStatus(t('elevenlabs_dubbing_tool.status_remixing', 'Saklanan dublaj sesiyle yeni denge oluşturuluyor...'));
    try {
        await mixCachedDubbing({ outputPath: buildOutputPath(state.cachedSourcePath) });
    } catch (error) {
        setStatus(t('elevenlabs_dubbing_tool.status_remix_failed', 'Saklanan dublaj sesi yeniden dengelenemedi: {error}', {
            error: error?.message || error || 'unknown_error'
        }));
    } finally {
        state.busy = false;
        render();
    }
}

async function openOutputFolder() {
    if (!state.outputPath) return;
    shell.showItemInFolder(state.outputPath);
}

function bindEvents() {
    els.btnCloseTool?.addEventListener('click', () => {
        window.close();
    });
    els.sourceLanguage?.addEventListener('change', () => {
        state.sourceLanguage = String(els.sourceLanguage.value || 'auto');
        render();
    });
    els.targetLanguage?.addEventListener('change', () => {
        state.targetLanguage = String(els.targetLanguage.value || 'tr');
        render();
    });
    els.dubVolume?.addEventListener('change', () => {
        state.dubVolume = String(els.dubVolume.value || 'high');
        render();
    });
    els.originalVolume?.addEventListener('change', () => {
        state.originalVolume = String(els.originalVolume.value || 'very_low');
        render();
    });
    els.dubOnly?.addEventListener('change', () => {
        state.dubOnly = Boolean(els.dubOnly.checked);
        setStatus(state.dubOnly
            ? t('elevenlabs_dubbing_tool.status_dub_only_enabled', 'Yalnızca dublaj sesi kullanılacak. Özgün video sesi çıktıya eklenmeyecek.')
            : t('elevenlabs_dubbing_tool.status_dub_only_disabled', 'Özgün ses altta kalacak şekilde dublaj dengesi kullanılacak.')
        );
    });
    els.btnChangeFile?.addEventListener('click', () => chooseFile().catch((error) => {
        setStatus(t('elevenlabs_dubbing_tool.status_file_select_failed', 'Dosya seçilemedi: {error}', {
            error: error?.message || error || 'unknown_error'
        }));
    }));
    els.btnCheckEstimate?.addEventListener('click', () => checkEstimate());
    els.btnPrepareStudio?.addEventListener('click', () => prepareStudioSegments());
    els.btnCreateDubbedCopy?.addEventListener('click', () => createDubbedCopy());
    els.btnRenderStudio?.addEventListener('click', () => renderStudioDubbedCopy());
    els.btnRemixDubbedCopy?.addEventListener('click', () => remixDubbedCopy());
    els.btnOpenOutputFolder?.addEventListener('click', () => openOutputFolder());
    els.studioSegmentList?.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowRight' || event.key === 'Enter') {
            event.preventDefault();
            openSelectedSegmentEditor();
        }
    });
    els.studioSegmentList?.addEventListener('dblclick', () => openSelectedSegmentEditor());
    els.btnSaveSegment?.addEventListener('click', () => saveSelectedSegment());
    els.btnCancelSegmentEdit?.addEventListener('click', () => {
        state.editingSegmentId = '';
        render();
        els.studioSegmentList?.focus();
    });
}

ipcRenderer.on('elevenlabs-dubbing-tool-init', (_event, options = {}) => {
    if (options.filePath) {
        state.filePath = String(options.filePath || '');
        state.cachedAudioPath = '';
        state.cachedSourcePath = '';
        state.cachedDubOnly = false;
        resetStudioState();
        state.outputPath = '';
        state.estimateStatus = '';
        setStatus(t('elevenlabs_dubbing_tool.status_file_selected', 'Dosya seçildi. Dublaj ayarlarını yapıp işlemi başlatabilirsiniz.'), { announce: false });
    }
    render();
});

ipcRenderer.on('elevenlabs-dubbing-progress', (_event, payload = {}) => {
    const percent = Math.max(0, Math.min(100, Math.round(Number(payload.percent || 0))));
    const status = String(payload.status || '').trim();
    setStatus(status
        ? t('elevenlabs_dubbing_tool.status_progress_with_state', 'ElevenLabs dublaj işlemi sürüyor. Durum: {status}. İlerleme: %{percent}', { status, percent })
        : t('elevenlabs_dubbing_tool.status_progress', 'ElevenLabs dublaj işlemi sürüyor. İlerleme: %{percent}', { percent })
    );
});

(async function init() {
    await i18nState.init();
    bindEvents();
    render();
})();
