const { ipcRenderer } = require('electron');
const path = require('path');

let i18nState = { lang: 'tr', cache: {} };

function getValue(obj, key) {
    return key.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : null), obj);
}

function t(key, fallback = key, params = {}) {
    const template = getValue(i18nState.cache, key) ?? fallback;
    return Object.entries(params).reduce((text, [name, value]) => (
        String(text).replace(new RegExp(`{${name}}`, 'g'), value)
    ), template);
}

function translateDOM(root = document) {
    const scope = root && root.querySelectorAll ? root : document;
    const textEls = [];
    if (root !== document && root?.hasAttribute?.('data-i18n')) textEls.push(root);
    textEls.push(...scope.querySelectorAll('[data-i18n]'));
    textEls.forEach((el) => {
        const value = t(el.getAttribute('data-i18n'), null);
        if (value) el.textContent = value;
    });

    const placeholderEls = [];
    if (root !== document && root?.hasAttribute?.('data-i18n-placeholder')) placeholderEls.push(root);
    placeholderEls.push(...scope.querySelectorAll('[data-i18n-placeholder]'));
    placeholderEls.forEach((el) => {
        const value = t(el.getAttribute('data-i18n-placeholder'), null);
        if (value) el.setAttribute('placeholder', value);
    });

    const ariaEls = [];
    if (root !== document && root?.hasAttribute?.('data-i18n-aria')) ariaEls.push(root);
    ariaEls.push(...scope.querySelectorAll('[data-i18n-aria]'));
    ariaEls.forEach((el) => {
        const value = t(el.getAttribute('data-i18n-aria'), null);
        if (value) el.setAttribute('aria-label', value);
    });

    const titleEl = document.querySelector('title[data-i18n]');
    if (titleEl) {
        const value = t(titleEl.getAttribute('data-i18n'), null);
        if (value) document.title = value;
    }

    document.documentElement.lang = i18nState.lang;
}

async function initI18n() {
    try {
        i18nState.lang = await ipcRenderer.invoke('i18n-get-language');
        i18nState.cache = await ipcRenderer.invoke('i18n-get-all');
        translateDOM();
        ipcRenderer.on('language-changed', async (_event, lang) => {
            i18nState.lang = lang;
            i18nState.cache = await ipcRenderer.invoke('i18n-get-all');
            translateDOM();
            renderClipQueue();
            changeStep(state.step);
        });
    } catch (error) {
        console.warn('Vertical wizard i18n init failed:', error);
    }
}

function getCurrentAiLanguageName() {
    return ({ tr: 'Turkish', en: 'English', de: 'German', es: 'Spanish', fr: 'French' })[i18nState.lang] || 'English';
}

// State
let state = {
    step: 1,
    sourcePath: null,
    metadata: null,
    clipQueue: [],
    processingContext: null,
    finalOutputPaths: [],
    format: '9:16', // 9:16, 4:5, 1:1
    method: 'blur', // blur, crop, letterbox
    settings: {
        blur: { sigma: 18, brightness: 100, scale: 100 },
        crop: { focus: 'center', x: 0 },
        letterbox: { color: 'black' }
    },
    output: {
        folder: '',
        filename: '',
        codec: 'libx264',
        quality: 'balanced',
        addToProject: false
    }
};

// DOM Elements
const els = {
    wizardTitle: document.getElementById('wizard-title'),
    steps: [1, 2, 3, 4, 5, 6].map(i => document.getElementById(`step-${i}`)),
    indicators: [1, 2, 3, 4, 5, 6].map(i => document.getElementById(`step-ind-${i}`)),
    btns: {
        back: document.getElementById('btn-back'),
        next: document.getElementById('btn-next'),
        cancel: document.getElementById('btn-cancel'),
        start: document.getElementById('btn-start'),
        finish: document.getElementById('btn-finish'),
        selectFile: document.getElementById('btn-select-file'),
        selectFolder: document.getElementById('btn-select-folder'),
        askAi: document.getElementById('btn-ask-ai'),
        aiApply: document.getElementById('btn-ai-apply'),
        aiIgnore: document.getElementById('btn-ai-ignore'),
        previewMethod: document.getElementById('btn-preview-method'),
        openFile: document.getElementById('btn-open-file'),
        openFolder: document.getElementById('btn-open-folder')
    },
    inputs: {
        sourcePath: document.getElementById('source-path'),
        outputFolder: document.getElementById('output-folder'),
        outputFilename: document.getElementById('output-filename'),
        videoCodec: document.getElementById('video-codec'),
        videoQuality: document.getElementById('video-quality'),
        addToProject: document.getElementById('add-to-project')
    },
    info: {
        container: document.getElementById('file-info'),
        duration: document.getElementById('info-duration'),
        resolution: document.getElementById('info-resolution'),
        fps: document.getElementById('info-fps'),
        audio: document.getElementById('info-audio')
    },
    clips: {
        panel: document.getElementById('clip-queue-panel'),
        summary: document.getElementById('clip-queue-summary'),
        list: document.getElementById('clip-queue-list')
    },
    ai: {
        panel: document.getElementById('ai-panel'),
        suggestion: document.getElementById('ai-suggestion-text'),
        rationale: document.getElementById('ai-rationale'),
        confidence: document.getElementById('ai-confidence')
    },
    progress: {
        bar: document.getElementById('progress-bar'),
        text: document.getElementById('progress-text'),
        log: document.getElementById('process-log'),
        status: document.getElementById('process-status'),
        actions: document.getElementById('process-actions')
    },
    batch: {
        note: document.getElementById('batch-output-note'),
        noteText: document.getElementById('batch-output-note-text')
    }
};

// --- Initialization ---

// IPC Listeners
ipcRenderer.on('init-data', (event, data) => {
    handleInitData(data);
});

ipcRenderer.on('ffmpeg-progress', (event, data) => {
    if (data.percent !== undefined && data.percent !== null) {
        if (state.processingContext && state.processingContext.totalItems > 1) {
            const itemPercent = Math.max(0, Math.min(100, data.percent));
            const overallPercent = ((state.processingContext.currentIndex + (itemPercent / 100)) / state.processingContext.totalItems) * 100;
            updateProgress(overallPercent, itemPercent);
        } else {
            updateProgress(data.percent, data.percent);
        }
    }
});

ipcRenderer.on('ffmpeg-log', (event, log) => {
    els.progress.log.textContent += log + '\n';
    els.progress.log.scrollTop = els.progress.log.scrollHeight;
});

// Event Listeners
els.btns.cancel.addEventListener('click', closeWizard);
els.btns.selectFile.addEventListener('click', selectSourceFile);
els.btns.next.addEventListener('click', nextStep);
els.btns.back.addEventListener('click', prevStep);
els.btns.start.addEventListener('click', startProcessing);
els.btns.finish.addEventListener('click', closeWizard);
els.btns.selectFolder.addEventListener('click', selectOutputFolder);
els.btns.openFile.addEventListener('click', () => shellOpen(state.finalOutputPath, 'file'));
els.btns.openFolder.addEventListener('click', () => shellOpen(state.finalOutputPath, 'folder'));
els.btns.previewMethod.addEventListener('click', generatePreview);

// AI Buttons
els.btns.askAi.addEventListener('click', askAiRecommendation);
els.btns.aiApply.addEventListener('click', applyAiRecommendation);
els.btns.aiIgnore.addEventListener('click', () => {
    els.ai.panel.style.display = 'none';
    els.btns.askAi.style.display = 'inline-block';
});

// Method Radio Change
document.querySelectorAll('input[name="format"]').forEach(r => {
    r.addEventListener('change', (e) => state.format = e.target.value);
});

document.querySelectorAll('input[name="method"]').forEach(r => {
    r.addEventListener('change', (e) => {
        state.method = e.target.value;
        updateMethodSettingsVisibility();
    });
});

// Sliders with value display
setupRangeInput('blur-sigma', 'val-blur-sigma', v => state.settings.blur.sigma = parseInt(v));
setupRangeInput('blur-brightness', 'val-blur-brightness', v => state.settings.blur.brightness = parseInt(v));
setupRangeInput('blur-center-scale', 'val-blur-center-scale', v => state.settings.blur.scale = parseInt(v));
setupRangeInput('crop-x', 'val-crop-x', v => state.settings.crop.x = parseInt(v));

document.querySelectorAll('input[name="crop-focus"]').forEach(r => {
    r.addEventListener('change', (e) => state.settings.crop.focus = e.target.value);
});

document.getElementById('letterbox-color').addEventListener('change', (e) => state.settings.letterbox.color = e.target.value);

// --- Functions ---

function setupRangeInput(id, valId, callback) {
    const input = document.getElementById(id);
    const display = document.getElementById(valId);
    if (input && display) {
        input.addEventListener('input', (e) => {
            display.textContent = e.target.value;
            callback(e.target.value);
        });
    }
}

function announce(message) {
    const liveRegion = document.getElementById('live-region');
    // Live region might not exist if HTML wasn't updated correctly, check existence
    if (liveRegion) {
        liveRegion.textContent = '';
        setTimeout(() => {
            liveRegion.textContent = message;
        }, 50);
    }
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

function closeWizard() {
    // Sadece bu pencereyi kapat
    // nodeIntegration:true olduğu için doğrudan window.close() çalışır
    // Ama ana pencereyi değil, bu dialog penceresini kapatır
    window.close();
}

// Escape tuşu ile kapatma
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeWizard();
    }
});

function handleInitData(data) {
    if (!data) {
        return;
    }

    if (Array.isArray(data.clipQueue)) {
        state.clipQueue = data.clipQueue
            .filter(item => item && item.sourcePath)
            .map((item, index) => ({
                id: item.id || `clip_${index + 1}`,
                sourcePath: item.sourcePath,
                startTime: Number(item.startTime) || 0,
                endTime: Number(item.endTime) || 0,
                duration: Math.max(0, (Number(item.endTime) || 0) - (Number(item.startTime) || 0)),
                label: item.label || t('runtime.vertical.clip_label_indexed', 'Klip {index}', { index: String(index + 1) }),
                filenameSuffix: item.filenameSuffix || `clip_${String(index + 1).padStart(2, '0')}`
            }));
    }

    renderClipQueue();

    const initialPath = data.filePath || state.clipQueue[0]?.sourcePath;
    if (initialPath) {
        handleFileSelection(initialPath);
    }
}

function formatSecondsForDisplay(seconds) {
    const total = Math.max(0, Math.floor(seconds || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatSecondsForFilename(seconds) {
    const total = Math.max(0, Math.floor(seconds || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return `${hours.toString().padStart(2, '0')}-${minutes.toString().padStart(2, '0')}-${secs.toString().padStart(2, '0')}`;
}

function getProcessingItems() {
    if (state.clipQueue.length > 0) {
        return state.clipQueue;
    }

    return [{
        id: 'full_video',
        sourcePath: state.sourcePath,
        startTime: null,
        endTime: null,
        duration: state.metadata?.duration || 0,
        label: t('dialog.vertical_wizard.full_video_label', 'Tüm Video'),
        filenameSuffix: 'full'
    }];
}

function renderClipQueue() {
    if (!els.clips.panel || !els.clips.summary || !els.clips.list) {
        return;
    }

    const items = getProcessingItems().filter(item => item && item.sourcePath);
    const hasQueuedClips = state.clipQueue.length > 0;

    if (!hasQueuedClips) {
        els.clips.panel.style.display = 'none';
        els.batch.note.style.display = 'none';
        return;
    }

    els.clips.panel.style.display = 'block';
    els.clips.list.innerHTML = '';

    els.clips.summary.textContent = state.clipQueue.length === 1
        ? t('dialog.vertical_wizard.clip_queue_summary_single', 'Bu işlem seçili 1 klip için hazırlanacak.')
        : t('dialog.vertical_wizard.clip_queue_summary_count', 'Bu işlem listede bulunan {count} klip için hazırlanacak.', {
            count: String(state.clipQueue.length)
        });

    state.clipQueue.forEach((clip, index) => {
        const li = document.createElement('li');
        const start = formatSecondsForDisplay(clip.startTime);
        const end = formatSecondsForDisplay(clip.endTime);
        li.textContent = t('dialog.vertical_wizard.clip_queue_item', '{index}. {label} ({start} - {end})', {
            index: String(index + 1),
            label: clip.label,
            start,
            end
        });
        els.clips.list.appendChild(li);
    });

    if (els.batch.note) {
        els.batch.note.style.display = state.clipQueue.length > 1 ? 'block' : 'none';
        if (els.batch.noteText) {
            els.batch.noteText.textContent = state.clipQueue.length > 1
                ? t('dialog.vertical_wizard.batch_output_note_count', 'Listede {count} klip var. Her klip ayrı dosya olarak kaydedilecek.', {
                    count: String(state.clipQueue.length)
                })
                : t('dialog.vertical_wizard.batch_output_note_single', 'Seçili alan ayrı bir dikey video olarak kaydedilecek.');
        }
    }
}

function updateMethodSettingsVisibility() {
    document.querySelectorAll('.method-settings').forEach(el => el.classList.remove('active'));

    // Safety check for state.method
    if (state.method && document.getElementById(`settings-${state.method}`)) {
        document.getElementById(`settings-${state.method}`).classList.add('active');
        announce(t('runtime.vertical.method_changed', 'Method settings changed: {method}', {
            method: getMethodLabel(state.method)
        }));
    }
}

async function selectSourceFile() {
    try {
        const result = await ipcRenderer.invoke('open-file-dialog', {
            title: t('dialog.vertical_wizard.select_video_title', 'Select Video'),
            filters: [{ name: t('runtime.app.video_files_filter', 'Video Files'), extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi'] }],
            properties: ['openFile']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            announce(t('runtime.vertical.video_loading', 'Loading video, please wait.'));
            handleFileSelection(result.filePaths[0]);
        }
    } catch (error) {
        console.error('Vertical wizard file selection error:', error);
        alert(t('runtime.vertical.file_dialog_failed', 'The file selection dialog could not be opened: {error}', { error: error.message }));
    }
}

async function handleFileSelection(filePath) {
    state.sourcePath = filePath;
    if (els.inputs.sourcePath) els.inputs.sourcePath.value = filePath;

    // Reset file info
    if (els.info.container) els.info.container.style.display = 'none';
    if (els.btns.next) els.btns.next.disabled = true;

    try {
        const response = await ipcRenderer.invoke('get-video-metadata', filePath);
        if (response.success) {
            state.metadata = response.data;
            showFileInfo(state.metadata);

            // Set default output info
            const parse = path.parse(filePath);
            state.output.folder = parse.dir;
            if (els.inputs.outputFolder) els.inputs.outputFolder.value = parse.dir;

            if (els.btns.next) els.btns.next.disabled = false;
            renderClipQueue();
            announce(t('runtime.vertical.video_loaded', 'Video loaded: {name}. Duration: {duration}. The Continue button is now active.', {
                name: path.basename(filePath),
                duration: state.metadata.durationFormatted
            }));

        } else {
            announce(t('runtime.vertical.metadata_failed_short', 'Error: video information could not be read.'));
            alert(t('runtime.vertical.metadata_failed', 'Video information could not be read.'));
        }
    } catch (error) {
        console.error(error);
        alert(t('runtime.common.error', 'Error: {error}', { error: error.message }));
    }
}

function showFileInfo(meta) {
    if (!els.info.container) return;
    els.info.duration.textContent = meta.durationFormatted;
    els.info.resolution.textContent = `${meta.width}x${meta.height}`;
    els.info.fps.textContent = Math.round(meta.frameRate * 100) / 100;
    els.info.audio.textContent = meta.audioCodec
        ? t('dialog.vertical_wizard.audio_yes', 'Yes')
        : t('dialog.vertical_wizard.audio_no', 'No');
    els.info.container.style.display = 'block';
}

function nextStep() {
    if (state.step < 6) {
        if (state.step === 4) prepareOutputStep();
        changeStep(state.step + 1);
    }
}

function prevStep() {
    if (state.step > 1) {
        changeStep(state.step - 1);
    }
}

function changeStep(step) {
    // Hide current
    if (els.steps[state.step - 1]) els.steps[state.step - 1].style.display = 'none';
    if (els.indicators[state.step - 1]) els.indicators[state.step - 1].classList.remove('active');

    // Show new
    state.step = step;
    if (els.steps[state.step - 1]) els.steps[state.step - 1].style.display = 'block';

    // Update Indicators
    els.indicators.forEach((ind, i) => {
        if (i < state.step) ind.classList.add('active');
        else ind.classList.remove('active');
    });

    // Button States
    els.btns.back.style.display = step === 1 ? 'none' : 'block';

    if (step === 6) {
        // Process Step
        els.btns.next.style.display = 'none';
        els.btns.start.style.display = 'none';
        els.btns.next.style.display = 'none';
        els.btns.start.style.display = 'block';
    } else if (step === 5) {
        els.btns.next.style.display = 'none';
        els.btns.start.style.display = 'block';
    } else {
        els.btns.next.style.display = 'block';
        els.btns.start.style.display = 'none';
    }

    // Accessibility
    const stepTitles = [
        t('dialog.vertical_wizard.step_title_source', 'Source Selection'),
        t('dialog.vertical_wizard.step_title_format', 'Format Selection'),
        t('dialog.vertical_wizard.step_title_method', 'Method Selection'),
        t('dialog.vertical_wizard.step_title_settings', 'Settings'),
        t('dialog.vertical_wizard.step_title_output', 'Output Settings'),
        t('dialog.vertical_wizard.step_title_process', 'Process Status')
    ];
    const title = stepTitles[step - 1] || t('runtime.vertical.step_title_fallback', 'Step {step}', { step });
    if (els.wizardTitle) {
        els.wizardTitle.textContent = title;
        els.wizardTitle.focus();
    }
    announce(t('runtime.vertical.step_announce', 'Step {step}: {title}', { step, title }));
}

function prepareOutputStep() {
    let suffix = '_vertical';
    if (state.format === '9:16') suffix = '_9x16';
    else if (state.format === '4:5') suffix = '_4x5';
    else if (state.format === '1:1') suffix = '_1x1';

    if (!state.sourcePath) {
        return;
    }

    const parse = path.parse(state.sourcePath);
    const items = getProcessingItems();

    if (state.clipQueue.length > 0) {
        els.inputs.outputFilename.value = parse.name;
    } else {
        els.inputs.outputFilename.value = `${parse.name}${suffix}.mp4`;
    }

    renderClipQueue();
}

async function selectOutputFolder() {
    try {
        const result = await ipcRenderer.invoke('open-file-dialog', {
            title: t('dialog.vertical_wizard.select_output_folder_title', 'Select Output Folder'),
            properties: ['openDirectory']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            state.output.folder = result.filePaths[0];
            els.inputs.outputFolder.value = state.output.folder;
        }
    } catch (e) {
        console.error(e);
    }
}

async function askAiRecommendation() {
    if (!state.sourcePath) return;

    els.btns.askAi.disabled = true;
    els.btns.askAi.textContent = t('dialog.vertical_wizard.ai_busy', 'Analyzing...');
    announce(t('runtime.vertical.ai_analyzing', 'AI is analyzing...'));

    try {
        const duration = state.metadata.duration || 10;
        const times = [duration * 0.1, duration * 0.5, duration * 0.9];
        const frames = [];
        for (const t of times) {
            const base64 = await ipcRenderer.invoke('extract-frame-base64', {
                videoPath: state.sourcePath,
                time: t
            });
            frames.push(base64);
        }

        const apiData = await ipcRenderer.invoke('get-gemini-api-data');
        if (!apiData.apiKey) {
            throw new Error(t('runtime.dialogs.api_key_missing_short', 'API key is missing.'));
        }

        const lang = getCurrentAiLanguageName();
        const prompt = `I want to convert this video to a vertical social format. There are three methods: 1. blur (fill the background with a blurred version), 2. crop, 3. letterbox. Analyze the frames and recommend the best method. Respond only in ${lang} and only in this JSON format: { "recommended_method": "blur", "confidence": 90, "rationale": ["reason one", "reason two"], "suggested_params": {} }`;

        const response = await ipcRenderer.invoke('gemini-vision-request', {
            apiKey: apiData.apiKey,
            model: apiData.model,
            imageBase64: frames[1],
            prompt: prompt,
            systemInstruction: t('runtime.dialogs.ai_system_instruction_json', 'Respond only in {lang}. If JSON output is requested, keep all JSON keys and schema exactly as requested while writing any free text values in {lang}.', {
                lang
            })
        });

        if (response.success) {
            parseAiResponse(response.text);
            // NOT: Detaylı duyuru parseAiResponse içinde yapılıyor, burada tekrar yapmıyoruz
        } else {
            throw new Error(response.error);
        }

    } catch (error) {
        console.error('AI Error:', error);
        alert(t('runtime.vertical.ai_failed', 'AI analysis failed.'));
        announce(t('runtime.vertical.ai_failed', 'AI analysis failed.'));
    } finally {
        els.btns.askAi.disabled = false;
        els.btns.askAi.textContent = t('dialog.vertical_wizard.ask_ai', 'Ask AI');
    }
}

function parseAiResponse(text) {
    try {
        // Clean markdown code blocks
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(jsonStr);

        // Update UI
        els.ai.suggestion.textContent = t('runtime.vertical.ai_suggestion', 'Suggestion: {method}', {
            method: getMethodLabel(data.recommended_method)
        });
        els.ai.confidence.textContent = `%${data.confidence}`;

        els.ai.rationale.innerHTML = '';
        if (data.rationale) {
            data.rationale.forEach(r => {
                const li = document.createElement('li');
                li.textContent = r;
                els.ai.rationale.appendChild(li);
            });
        }

        // Store for apply
        state.lastAiSuggestion = data;

        // Show panel
        els.ai.panel.style.display = 'block';
        els.btns.askAi.style.display = 'none';

        // Accessibility: Tüm öneriyi sesli okut (aria-live ile)
        let fullAnnouncement = t('runtime.vertical.ai_announcement', 'AI suggestion: {method}. Confidence {confidence} percent.', {
            method: getMethodLabel(data.recommended_method),
            confidence: data.confidence
        });
        if (data.rationale && data.rationale.length > 0) {
            fullAnnouncement += ' ' + t('runtime.vertical.ai_rationale', 'Reasons: {reasons}', {
                reasons: data.rationale.join('. ')
            });
        }
        announce(fullAnnouncement);

    } catch (e) {
        console.error('JSON Parse Error:', e);
        alert(t('runtime.vertical.ai_response_unreadable', 'The AI response could not be understood.'));
    }
}

function getMethodLabel(method) {
    const map = {
        blur: t('dialog.vertical_wizard.method_label_blur', 'Blur Background'),
        crop: t('dialog.vertical_wizard.method_label_crop', 'Crop'),
        letterbox: t('dialog.vertical_wizard.method_label_letterbox', 'Letterbox')
    };
    return map[method] || method;
}

function applyAiRecommendation() {
    if (!state.lastAiSuggestion) return;
    const rec = state.lastAiSuggestion;

    // Select Radio
    const radio = document.querySelector(`input[name="method"][value="${rec.recommended_method}"]`);
    if (radio) {
        radio.checked = true;
        state.method = rec.recommended_method;
        updateMethodSettingsVisibility();
    }

    // Apply Params
    if (rec.suggested_params) {
        const p = rec.suggested_params;
        if (p.blur_sigma) {
            state.settings.blur.sigma = p.blur_sigma;
            updateRangeVal('blur-sigma', 'val-blur-sigma', p.blur_sigma);
        }
        if (p.crop_focus) {
            const r = document.querySelector(`input[name="crop-focus"][value="${p.crop_focus}"]`);
            if (r) { r.checked = true; state.settings.crop.focus = p.crop_focus; }
        }
        // ... apply others if needed
    }

    // Disable listener for this click? No need.
    els.btns.aiApply.textContent = t('dialog.vertical_wizard.ai_applied', 'Applied ✓');
    announce(t('runtime.vertical.ai_applied', 'The recommended settings were applied.'));
    setTimeout(() => {
        els.btns.aiApply.textContent = t('dialog.vertical_wizard.ai_apply', 'Apply Recommended Settings');
    }, 2000);
}

function updateRangeVal(inputId, valId, value) {
    const input = document.getElementById(inputId);
    const display = document.getElementById(valId);
    if (input && display) {
        input.value = value;
        display.textContent = value;
    }
}

function buildOutputPathForClip(clip, clipIndex, totalClips) {
    const rawFilename = (els.inputs.outputFilename.value || '').trim();
    const folder = state.output.folder || path.dirname(state.sourcePath || '');
    const parsedInput = path.parse(state.sourcePath || 'video.mp4');
    const safeBaseName = rawFilename
        ? path.parse(rawFilename).name
        : parsedInput.name;
    const extension = path.parse(rawFilename || '').ext || '.mp4';

    const usingQueuedClips = state.clipQueue.length > 0;

    if (totalClips <= 1 && !usingQueuedClips) {
        const finalName = rawFilename || `${parsedInput.name}.mp4`;
        return path.join(folder, finalName.endsWith(extension) ? finalName : `${finalName}${extension}`);
    }

    const readableSuffix = String(clip?.filenameSuffix || '').trim().replace(/[^\w.-]+/g, '_');
    const suffixPart = readableSuffix ? `-${readableSuffix}` : '';
    return path.join(folder, `${safeBaseName}-short${clipIndex + 1}${suffixPart}${extension}`);
}

// --- PREVIEW & PROCESSING ---

async function generatePreview() {
    // Generate a 5s low res preview
    const previewArea = document.getElementById('preview-area');
    previewArea.style.display = 'flex';
    previewArea.innerHTML = `<p style="color: #aaa;">${t('dialog.vertical_wizard.preview_preparing', 'Preparing preview...')}</p>`;
    announce(t('runtime.vertical.preview_preparing', 'Preparing preview...'));

    try {
        const previewClip = getProcessingItems()[0];
        const options = {
            format: state.format,
            method: state.method,
            settings: state.settings[state.method],
            isPreview: true,
            duration: 5,
            clip: previewClip && previewClip.startTime !== null ? {
                startTime: previewClip.startTime,
                endTime: previewClip.endTime
            } : null
        };

        const result = await ipcRenderer.invoke('create-vertical-video-preview', {
            inputPath: previewClip?.sourcePath || state.sourcePath,
            options: options
        });

        if (result.success) {
            previewArea.innerHTML = `<video src="${result.outputPath}" controls autoplay loop class="preview-video"></video>`;
            announce(t('runtime.vertical.preview_playing', 'Preview video is playing.'));
        } else {
            previewArea.innerHTML = `<p style="color: red;">${t('runtime.common.error', 'Error: {error}', { error: result.error })}</p>`;
            announce(t('runtime.vertical.preview_failed', 'A preview error occurred.'));
        }
    } catch (error) {
        previewArea.innerHTML = `<p style="color: red;">${t('runtime.common.error', 'Error: {error}', { error: error.message })}</p>`;
    }
}

async function startProcessing() {
    // Switch to step 6
    changeStep(6);

    // Lock buttons
    els.btns.back.style.display = 'none';
    els.btns.cancel.style.display = 'none'; // Maybe enable cancel?

    // Construct Options
    const options = {
        format: state.format, // "9:16", "4:5", "1:1"
        method: state.method, // "blur", "crop", letterbox"
        settings: state.settings[state.method],
        videoCodec: els.inputs.videoCodec.value,
        quality: els.inputs.videoQuality.value
    };
    const items = getProcessingItems();
    state.processingContext = { currentIndex: 0, totalItems: items.length };
    state.finalOutputPaths = [];

    announce(t('runtime.vertical.processing_started', 'Video processing started, please wait.'));

    // Start IPC
    try {
        els.progress.log.textContent = '';
        for (let index = 0; index < items.length; index++) {
            const clip = items[index];
            state.processingContext.currentIndex = index;
            const outputPath = buildOutputPathForClip(clip, index, items.length);

            els.progress.status.textContent = items.length > 1
                ? t('runtime.vertical.processing_batch_status', 'Kuyruktaki {index}. dosya işleniyor. Toplam {count} dosya var.', {
                    index: String(index + 1),
                    count: String(items.length)
                })
                : t('dialog.vertical_wizard.processing', 'İşleniyor...');

            els.progress.log.textContent += `${t('runtime.vertical.processing_clip_log', 'İşleniyor')}: ${clip.label}\n`;
            state.finalOutputPath = outputPath;

            const result = await ipcRenderer.invoke('create-vertical-video', {
                inputPath: clip.sourcePath,
                outputPath,
                options: {
                    ...options,
                    clip: clip.startTime !== null ? {
                        startTime: clip.startTime,
                        endTime: clip.endTime
                    } : null
                }
            });

            if (!result.success) {
                throw new Error(result.error);
            }

            state.finalOutputPaths.push(outputPath);
            els.progress.log.textContent += `${t('runtime.vertical.processing_clip_done_log', 'Tamamlandı')}: ${path.basename(outputPath)}\n`;
            els.progress.log.scrollTop = els.progress.log.scrollHeight;

            if (els.inputs.addToProject.checked) {
                ipcRenderer.send('insert-video', outputPath);
            }
        }

        els.progress.status.textContent = items.length > 1
            ? t('runtime.vertical.process_completed_batch', '{count} kısa video başarıyla oluşturuldu.', {
                count: String(items.length)
            })
            : t('runtime.vertical.process_completed', 'Process Completed!');
        els.progress.bar.style.backgroundColor = '#4caf50'; // Green
        els.progress.actions.style.display = 'block';
        els.btns.finish.style.display = 'block';
        els.btns.openFile.style.display = items.length > 1 ? 'none' : 'inline-block';

        announce(items.length > 1
            ? t('runtime.vertical.process_completed_batch_announce', '{count} kısa video başarıyla oluşturuldu.', {
                count: String(items.length)
            })
            : t('runtime.vertical.process_completed_announce', 'Video processing was completed successfully.'));
    } catch (error) {
        els.progress.status.textContent = t('runtime.vertical.process_error', 'An Error Occurred');
        els.progress.status.style.color = 'red';
        els.progress.log.textContent += `\nFATAL ERROR: ${error.message}`;
        els.btns.finish.style.display = 'block'; // Allow close
        announce(t('runtime.vertical.process_error_announce', 'An error occurred. Please check the logs.'));
    } finally {
        state.processingContext = null;
    }
}

function shellOpen(path, type) {
    ipcRenderer.send(type === 'file' ? 'show-item-in-folder' : 'open-path', path);
}

function updateProgress(percent, itemPercent = percent) {
    if (els.progress.bar) {
        els.progress.bar.style.width = `${percent}%`;
        els.progress.bar.setAttribute('aria-valuenow', Math.round(percent));
    }
    if (els.progress.text) {
        if (state.processingContext && state.processingContext.totalItems > 1) {
            els.progress.text.textContent = t('runtime.vertical.processing_batch_progress_text', 'Kuyruktaki {index}. dosya: %{percent}', {
                index: String(state.processingContext.currentIndex + 1),
                percent: String(Math.round(itemPercent))
            });
        } else {
            els.progress.text.textContent = `%${Math.round(percent)}`;
        }
    }
}

// Request init data when ready
window.addEventListener('DOMContentLoaded', () => {
    initI18n();
    // Force focus on logic start
    changeStep(1);
    // Wait for data
    ipcRenderer.send('vertical-wizard-ready');
});
