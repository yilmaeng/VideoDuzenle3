const { ipcRenderer } = require('electron');
const path = require('path');

// State
let state = {
    step: 1,
    sourcePath: null,
    metadata: null,
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
    }
};

// --- Initialization ---

// IPC Listeners
ipcRenderer.on('init-data', (event, data) => {
    if (data && data.filePath) {
        handleFileSelection(data.filePath);
    }
});

ipcRenderer.on('ffmpeg-progress', (event, data) => {
    if (data.percent) {
        updateProgress(data.percent);
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
        liveRegion.textContent = message;
    }
}

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

function updateMethodSettingsVisibility() {
    document.querySelectorAll('.method-settings').forEach(el => el.classList.remove('active'));

    // Safety check for state.method
    if (state.method && document.getElementById(`settings-${state.method}`)) {
        document.getElementById(`settings-${state.method}`).classList.add('active');
        announce(`Yöntem ayarları değiştirildi: ${state.method}`);
    }
}

async function selectSourceFile() {
    try {
        const result = await ipcRenderer.invoke('open-file-dialog', {
            title: 'Video Seç',
            filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi'] }],
            properties: ['openFile']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            announce("Video yükleniyor, lütfen bekleyin.");
            handleFileSelection(result.filePaths[0]);
        }
    } catch (error) {
        console.error('Dosya seçimi hatası:', error);
        alert('Dosya seçimi penceresi açılamadı: ' + error.message);
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
            announce(`Video yüklendi: ${path.basename(filePath)}. Süre: ${state.metadata.durationFormatted}. İlerle düğmesi artık aktif.`);

        } else {
            announce(`Hata: Video bilgileri okunamadı.`);
            alert('Video bilgileri okunamadı.');
        }
    } catch (error) {
        console.error(error);
        alert('Hata: ' + error.message);
    }
}

function showFileInfo(meta) {
    if (!els.info.container) return;
    els.info.duration.textContent = meta.durationFormatted;
    els.info.resolution.textContent = `${meta.width}x${meta.height}`;
    els.info.fps.textContent = Math.round(meta.frameRate * 100) / 100;
    els.info.audio.textContent = meta.audioCodec ? 'Var' : 'Yok';
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
    const stepTitles = ["Kaynak Seçimi", "Format Seçimi", "Yöntem Seçimi", "Ayarlar", "Çıktı Ayarları", "İşlem Durumu"];
    const title = stepTitles[step - 1] || `Adım ${step}`;
    if (els.wizardTitle) {
        els.wizardTitle.textContent = title;
        els.wizardTitle.focus();
    }
    announce(`Adım ${step}: ${title}`);
}

function prepareOutputStep() {
    let suffix = '_vertical';
    if (state.format === '9:16') suffix = '_9x16';
    else if (state.format === '4:5') suffix = '_4x5';
    else if (state.format === '1:1') suffix = '_1x1';

    if (state.sourcePath) {
        const parse = path.parse(state.sourcePath);
        let name = parse.name + suffix + '.mp4';
        els.inputs.outputFilename.value = name;
    }
}

async function selectOutputFolder() {
    try {
        const result = await ipcRenderer.invoke('open-file-dialog', {
            title: 'Kayıt Klasörü Seç',
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
    els.btns.askAi.textContent = '⏳ Analiz Ediliyor...';
    announce("Yapay zeka analiz yapıyor...");

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
        if (!apiData.apiKey) throw new Error('API Anahtarı yok');

        const prompt = `Bu videoyu 9:16 dikey formata çevirmek istiyorum. Üç yöntem var: 1. blur (arka planı bulanıklaştırarak doldur), 2. crop (kırpma), 3. letterbox (siyah kenarlık). Kare görüntülerini analiz et ve en iyi yöntemi öner. Yanıtını SADECE Türkçe olarak şu JSON formatında ver: { "recommended_method": "blur", "confidence": 90, "rationale": ["Birinci gerekçe...", "İkinci gerekçe..."], "suggested_params": {} }`;

        const response = await ipcRenderer.invoke('gemini-vision-request', {
            apiKey: apiData.apiKey,
            model: apiData.model,
            imageBase64: frames[1],
            prompt: prompt
        });

        if (response.success) {
            parseAiResponse(response.text);
            // NOT: Detaylı duyuru parseAiResponse içinde yapılıyor, burada tekrar yapmıyoruz
        } else {
            throw new Error(response.error);
        }

    } catch (error) {
        console.error('AI Error:', error);
        alert('AI Analizi başarısız.');
        announce("Yapay zeka analizi başarısız.");
    } finally {
        els.btns.askAi.disabled = false;
        els.btns.askAi.textContent = '✨ Yapay Zekaya Sor';
    }
}

function parseAiResponse(text) {
    try {
        // Clean markdown code blocks
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(jsonStr);

        // Update UI
        els.ai.suggestion.textContent = `Öneri: ${getMethodLabel(data.recommended_method)}`;
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
        let fullAnnouncement = `Yapay zeka önerisi: ${getMethodLabel(data.recommended_method)}. Güven oranı yüzde ${data.confidence}.`;
        if (data.rationale && data.rationale.length > 0) {
            fullAnnouncement += ' Gerekçeler: ' + data.rationale.join('. ');
        }
        announce(fullAnnouncement);

    } catch (e) {
        console.error('JSON Parse Error:', e);
        alert('AI yanıtı anlaşılamadı.');
    }
}

function getMethodLabel(method) {
    const map = { 'blur': 'Arka Plan Bulanık', 'crop': 'Kırpma (Crop)', 'letterbox': 'Siyah Kenarlık' };
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
    els.btns.aiApply.textContent = 'Uygulandı ✓';
    announce("Önerilen ayarlar uygulandı.");
    setTimeout(() => els.btns.aiApply.textContent = 'Önerilen Ayarları Uygula', 2000);
}

function updateRangeVal(inputId, valId, value) {
    const input = document.getElementById(inputId);
    const display = document.getElementById(valId);
    if (input && display) {
        input.value = value;
        display.textContent = value;
    }
}

// --- PREVIEW & PROCESSING ---

async function generatePreview() {
    // Generate a 5s low res preview
    const previewArea = document.getElementById('preview-area');
    previewArea.style.display = 'flex';
    previewArea.innerHTML = '<p style="color: #aaa;">Önizleme oluşturuluyor...</p>';
    announce("Önizleme oluşturuluyor...");

    try {
        const options = {
            format: state.format,
            method: state.method,
            settings: state.settings[state.method],
            isPreview: true,
            duration: 5
        };

        const result = await ipcRenderer.invoke('create-vertical-video-preview', {
            inputPath: state.sourcePath,
            options: options
        });

        if (result.success) {
            previewArea.innerHTML = `<video src="${result.outputPath}" controls autoplay loop class="preview-video"></video>`;
            announce("Önizleme videosu oynatılıyor.");
        } else {
            previewArea.innerHTML = `<p style="color: red;">Hata: ${result.error}</p>`;
            announce("Önizleme hatası oluştu.");
        }
    } catch (error) {
        previewArea.innerHTML = `<p style="color: red;">Hata: ${error.message}</p>`;
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

    const outputPath = path.join(state.output.folder, els.inputs.outputFilename.value);
    state.finalOutputPath = outputPath;

    announce("Video işlenmeye başlandı, lütfen bekleyin.");

    // Start IPC
    try {
        const result = await ipcRenderer.invoke('create-vertical-video', {
            inputPath: state.sourcePath,
            outputPath: outputPath,
            options: options
        });

        if (result.success) {
            els.progress.status.textContent = 'İşlem Tamamlandı!';
            els.progress.bar.style.backgroundColor = '#4caf50'; // Green
            els.progress.actions.style.display = 'block';
            els.btns.finish.style.display = 'block';

            announce("Video işlemi başarıyla tamamlandı.");

            if (els.inputs.addToProject.checked) {
                ipcRenderer.send('insert-video', outputPath);
            }
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        els.progress.status.textContent = 'Hata Oluştu';
        els.progress.status.style.color = 'red';
        els.progress.log.textContent += `\nFATAL ERROR: ${error.message}`;
        els.btns.finish.style.display = 'block'; // Allow close
        announce("Hata oluştu. Lütfen günlüklere bakın.");
    }
}

function shellOpen(path, type) {
    ipcRenderer.send(type === 'file' ? 'show-item-in-folder' : 'open-path', path);
}

function updateProgress(percent) {
    if (els.progress.bar) {
        els.progress.bar.style.width = `${percent}%`;
        els.progress.bar.setAttribute('aria-valuenow', Math.round(percent));
    }
    if (els.progress.text) els.progress.text.textContent = `%${Math.round(percent)}`;
}

// Request init data when ready
window.addEventListener('DOMContentLoaded', () => {
    // Force focus on logic start
    changeStep(1);
    // Wait for data
    ipcRenderer.send('vertical-wizard-ready');
});
