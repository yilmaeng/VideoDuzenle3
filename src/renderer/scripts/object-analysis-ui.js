document.addEventListener('DOMContentLoaded', () => {
    function t(key, fallback, params = {}) {
        if (!window.i18nHelper) return fallback;
        const value = window.i18nHelper.t(key, params);
        return value && !value.startsWith('[') ? value : fallback;
    }

    function getCurrentAiLocale() {
        const supported = ['tr', 'en', 'de', 'es', 'fr'];
        const lang = window.i18nHelper?.currentLang || 'en';
        return supported.includes(lang) ? lang : 'en';
    }

    function getCurrentAiLanguageName() {
        const names = { tr: 'Turkish', en: 'English', de: 'German', es: 'Spanish', fr: 'French' };
        return names[getCurrentAiLocale()] || 'English';
    }

    function getAiSystemInstruction(mode = 'default') {
        const key = mode === 'json'
            ? 'runtime.dialogs.ai_system_instruction_json'
            : 'runtime.dialogs.ai_system_instruction';
        const fallback = mode === 'json'
            ? 'Respond only in {lang}. If JSON output is requested, keep all JSON keys and schema exactly as requested while writing any free text values in {lang}.'
            : 'Respond only in {lang}. Keep the same response language in follow-up answers.';
        return t(key, fallback, { lang: getCurrentAiLanguageName() });
    }

    function buildAiLabelPrompt(selectedLabel) {
        const lang = getCurrentAiLanguageName();
        if (getCurrentAiLocale() === 'tr') {
            return `Bu görseldeki ${selectedLabel} nesnesini (muhtemelen bounding box içindeki) kısaca tanımla. En fazla 5 kelime kullan ve yalnızca ${lang} dilinde yanıt ver. Örnek: 'Sarı ceketli adam', 'Coca-Cola logosu'.`;
        }
        return `Briefly describe the ${selectedLabel} object in this image, likely the one inside the bounding box. Use at most 5 words and answer only in ${lang}. Example: "man in yellow jacket", "Coca-Cola logo".`;
    }

    function buildAiPreviewPrompt(selectedLabel, position, effectName) {
        const lang = getCurrentAiLanguageName();
        if (getCurrentAiLocale() === 'tr') {
            return `Bu video karesini analiz et ve şu soruları yanıtla:

1. "${selectedLabel}" adlı nesne bu karede görünüyor mu?
2. Bu nesne "${position}" konumunda mı?
3. Eğer bu nesnenin üzerine, nesnenin gerçek boyutuna ve konumuna göre bir ${effectName} efekti uygulansaydı, nesneyi tamamen veya büyük ölçüde kapsar mıydı?

Yalnızca ${lang} dilinde ve şu formatta yanıt ver:
Nesne Görünür: [Evet/Hayır]
Konum Doğru: [Evet/Hayır/Kısmen]
Efekt Kapsama: [Tam/Büyük Ölçüde/Kısmen/Kapsamaz]
Özet: [1 cümlelik açıklama]`;
        }

        return `Analyze this video frame and answer the following:

1. Is the object named "${selectedLabel}" visible in this frame?
2. Is this object located at "${position}"?
3. If a ${effectName} effect were applied over this object using its real size and position, would it fully or mostly cover the object?

Respond only in ${lang} and use exactly this format:
Object Visible: [Yes/No]
Position Correct: [Yes/No/Partly]
Effect Coverage: [Full/Mostly/Partly/Does Not Cover]
Summary: [1 sentence explanation]`;
    }

    const dialog = document.getElementById('object-analysis-dialog');
    const startAnalysisBtn = document.getElementById('start-analysis-btn');
    const objectList = document.getElementById('object-list');
    const closeBtn = document.getElementById('object-close-btn');
    const applyBtn = document.getElementById('object-apply-btn');
    const queueBtn = document.getElementById('object-queue-btn');
    const previewBtn = document.getElementById('object-preview-btn');
    const aiLabelBtn = document.getElementById('ai-label-btn');

    const durationSelect = document.getElementById('analysis-duration');
    const actionTypeSelect = document.getElementById('object-action-type');
    const actionScopeSelect = document.getElementById('object-action-scope');
    const customTimeRangeDiv = document.getElementById('custom-time-range');
    const customStartTime = document.getElementById('custom-start-time');
    const customEndTime = document.getElementById('custom-end-time');

    // Display elements
    const detailLabel = document.getElementById('obj-detail-label');
    const detailPos = document.getElementById('obj-detail-pos');
    const detailTime = document.getElementById('obj-detail-time');
    const analysisStatus = document.getElementById('analysis-status-text');

    let currentVideoPath = null;
    let currentCursor = 0.0;

    let analysisResults = []; // [{ id, label, boxes... }]
    let selectedObject = null;
    let selectedObjects = []; // Çoklu seçim için

    // Scope değiştiğinde custom alanı göster/gizle
    if (actionScopeSelect) {
        actionScopeSelect.addEventListener('change', () => {
            if (customTimeRangeDiv) {
                customTimeRangeDiv.style.display = actionScopeSelect.value === 'custom' ? 'block' : 'none';
            }
        });
    }

    // IPC Listeners
    if (window.api) {
        window.api.onShowObjectAnalysisDialog(async () => {
            // Get current state
            // We need video path and cursor position. 
            // We can ask main process or use global variables if available immediately.
            // Better to request fresh data.
            try {
                // Assuming app.js exposes some state or we ask main
                // We'll ask main for current video info via IPC if possible, 
                // but usually renderer has the state in 'video-player'.
                const videoPlayer = document.getElementById('video-player');
                if (videoPlayer && videoPlayer.src) {
                    currentVideoPath = decodeURIComponent(videoPlayer.src.replace('file:///', '').replace('file://', ''));
                    // Fix path on windows
                    if (navigator.userAgent.indexOf("Windows") !== -1 && currentVideoPath.indexOf(':') === 1) {
                        // e.g. C:/...
                        // already correct format usually? 
                        // file:///C:/Users... -> C:/Users...
                    }
                    currentCursor = videoPlayer.currentTime;
                } else {
                    alert(t('runtime.object_analysis.open_video_first', 'Please open a video first.'));
                    return;
                }

                resetDialog();
                dialog.showModal();
                startAnalysisBtn.focus();
            } catch (e) {
                console.error(e);
            }
        });

        window.api.onAnalysisProgress(({ stage, current, total }) => {
            analysisStatus.textContent = t('runtime.object_analysis.processing_progress', 'Processing: {stage} ({current}/{total})', { stage, current, total });
        });

        window.api.onAnalysisStatus((msg) => {
            analysisStatus.textContent = msg;
        });

        window.api.onAnalysisError((msg) => {
            analysisStatus.textContent = t('runtime.common.error', 'Error: {error}', { error: msg });
            alert(t('runtime.common.error', 'Error: {error}', { error: msg }));
        });
    }

    // Handlers
    closeBtn.addEventListener('click', () => dialog.close());

    startAnalysisBtn.addEventListener('click', async () => {
        if (!currentVideoPath) return;

        const duration = parseInt(durationSelect.value);
        let startTime = Math.max(0, currentCursor - (duration / 2));

        // Model indirme kontrolü kaldırıldı (Gemini API kullanılıyor)

        analysisStatus.textContent = t('runtime.object_analysis.analysis_starting', 'Starting analysis (Gemini)...');
        startAnalysisBtn.disabled = true;

        try {
            const result = await window.api.analyzeSceneObjects({
                videoPath: currentVideoPath,
                startTime: startTime,
                duration: duration
            });

            startAnalysisBtn.disabled = false;

            if (result.success) {
                analysisResults = result.tracks;
                renderObjectList();
                analysisStatus.textContent = t('runtime.object_analysis.analysis_completed', 'Analysis completed. {count} objects found.', { count: analysisResults.length });

                // İlk öğeye odaklanma şansı ver
                setTimeout(() => {
                    const firstItem = objectList.querySelector('li');
                    if (firstItem) firstItem.focus();

                    // Odaklanma sonrasında anonsu yap ki kesilmesin (Süre uzatıldı: 1sn)
                    setTimeout(() => {
                        announce(t('runtime.object_analysis.analysis_completed_hint', 'Analysis completed. {count} objects found. Press S to select or deselect an object.', { count: analysisResults.length }));
                    }, 1000);
                }, 100);
            } else {
                analysisStatus.textContent = t('runtime.common.error', 'Error: {error}', { error: result.error });
                announce(t('runtime.object_analysis.analysis_error', 'Analysis error: {error}', { error: result.error }));
                setTimeout(() => {
                    if (window.Accessibility && window.Accessibility.alert) {
                        window.Accessibility.alert(t('runtime.object_analysis.analysis_error', 'Analysis error: {error}', { error: result.error }));
                    } else {
                        alert(t('runtime.common.error', 'Error: {error}', { error: result.error }));
                    }
                }, 200);
            }
        } catch (err) {
            startAnalysisBtn.disabled = false;
            analysisStatus.textContent = t('runtime.object_analysis.unexpected_error', 'Unexpected error.');
            announce(t('runtime.object_analysis.unexpected_error_announce', 'An unexpected error occurred.'));
            console.error(err);
            setTimeout(() => alert(t('runtime.object_analysis.unexpected_error_announce', 'An unexpected error occurred.')), 200);
        }
    });

    function renderObjectList() {
        objectList.innerHTML = '';
        if (analysisResults.length === 0) {
            objectList.innerHTML = `<li class="empty-message">${t('runtime.object_analysis.no_objects_found', 'No objects were found.')}</li>`;
            return;
        }

        analysisResults.forEach((obj, index) => {
            const li = document.createElement('li');
            li.tabIndex = 0; // Focusable
            li.className = 'object-item';
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', 'false');
            li.dataset.index = index;

            // Nice labeling
            const duration = (obj.endTime - obj.startTime).toFixed(1);
            const label = obj.label || t('runtime.object_analysis.unknown_object', 'Unknown Object');
            const position = obj.position || t('runtime.object_analysis.position_unknown', 'Position Unknown');

            // Bounding box boyutunu hesapla (görece boyut)
            let sizeInfo = '';
            if (obj.boxes && obj.boxes[0] && obj.boxes[0].box) {
                const box = obj.boxes[0].box;
                const boxWidth = box.xmax - box.xmin;
                const boxHeight = box.ymax - box.ymin;
                // Yaklaşık alan yüzdesi (1920x1080 varsayımı)
                const areaPercent = ((boxWidth * boxHeight) / (1920 * 1080) * 100).toFixed(1);
                sizeInfo = `, Boyut: %${areaPercent}`;
            }

            const text = t('runtime.object_analysis.object_list_item', '{label}{sizeInfo} ({duration}s) - Detection Accuracy: %{score}', {
                label,
                sizeInfo,
                duration,
                score: Math.round(obj.score * 100)
            });

            li.textContent = text;

            // Sadece ilk öğeye kullanım ipucunu ekle (Görsel ve İşitsel)
            if (index === 0) {
                li.textContent += ` (${t('runtime.object_analysis.press_s_hint', 'Press S to select or deselect')})`;
            }

            // Tıklama ile seçim (Ctrl = çoklu seçim)
            li.addEventListener('click', (e) => {
                if (e.ctrlKey || e.metaKey) {
                    toggleSelectObject(obj);
                } else {
                    selectObject(obj);
                }
                li.focus();
            });

            // Klavye Yönetimi (Erişilebilirlik)
            // S = Seçimi aç/kapa (toggle), A = Tümünü seç
            li.addEventListener('keydown', (e) => {
                if (e.key === 's' || e.key === 'S') {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleSelectObject(obj);
                } else if (e.key === 'a' || e.key === 'A') {
                    e.preventDefault();
                    e.stopPropagation();
                    // Tümünü seç
                    selectedObjects = [...analysisResults];
                    selectedObject = selectedObjects[selectedObjects.length - 1];
                    updateSelectionVisuals();
                    announce(t('runtime.object_analysis.all_selected', 'All selected: {count} objects', { count: selectedObjects.length }));
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const next = li.nextElementSibling;
                    if (next) {
                        next.focus();
                        const idx = parseInt(next.dataset.index);
                        const nextObj = analysisResults[idx];
                        if (nextObj) announce(nextObj.label);
                    }
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prev = li.previousElementSibling;
                    if (prev) {
                        prev.focus();
                        const idx = parseInt(prev.dataset.index);
                        const prevObj = analysisResults[idx];
                        if (prevObj) announce(prevObj.label);
                    }
                }
            });

            // NOT: Odaklanınca otomatik seçim kaldırıldı - kullanıcı oklarla gezebilmeli

            objectList.appendChild(li);
        });

        // İlk elemanı seç ve Tab sırasına sadece onu al
        if (analysisResults.length > 0) {
            selectObject(analysisResults[0]);

            // İlk öğeye odaklanma şansı ver
            setTimeout(() => {
                const first = objectList.querySelector('li');
                if (first) first.focus();
            }, 100);
        }

        // İlk öğeye odaklandığında kullanım talimatı duyur
        const firstItem = objectList.querySelector('li');
        if (firstItem) {
            firstItem.addEventListener('focus', () => {
                announce(t('runtime.object_analysis.press_s_hint_full', 'Press S to select or deselect an object.'));
            }, { once: true }); // Sadece ilk odaklanmada duyur
        }
    }

    function selectObject(obj) {
        selectedObject = obj;
        selectedObjects = [obj]; // Tek seçim - çoklu seçimi temizle

        // Görsel güncelleme ve TabIndex yönetimi (Roving TabIndex)
        const items = objectList.querySelectorAll('li');
        items.forEach(i => {
            i.classList.remove('selected');
            i.setAttribute('aria-selected', 'false');
            i.tabIndex = -1;
        });

        const index = analysisResults.indexOf(obj);
        const active = objectList.querySelector(`li[data-index="${index}"]`);
        if (active) {
            active.classList.add('selected');
            active.setAttribute('aria-selected', 'true');
            active.tabIndex = 0;
        }

        // Detayları güncelle
        detailLabel.textContent = obj.label || t('runtime.object_analysis.unknown_label', 'Unknown');
        detailPos.textContent = obj.position || t('runtime.object_analysis.auto_tracking', 'Auto Tracking');
        detailTime.textContent = obj.startTime.toFixed(2) + ' - ' + obj.endTime.toFixed(2);

        applyBtn.disabled = false;
        if (queueBtn) queueBtn.disabled = false;
        previewBtn.disabled = false;
        aiLabelBtn.disabled = false;
    }

    function toggleSelectObject(obj) {
        const objIndex = selectedObjects.indexOf(obj);

        if (objIndex === -1) {
            // Ekle
            selectedObjects.push(obj);
        } else {
            // Çıkar
            selectedObjects.splice(objIndex, 1);
        }

        // Son seçilen nesneyi ana seçim olarak ayarla
        selectedObject = selectedObjects.length > 0 ? selectedObjects[selectedObjects.length - 1] : null;

        // Görsel güncelleme
        const items = objectList.querySelectorAll('li');
        items.forEach(i => {
            const idx = parseInt(i.dataset.index);
            const isSelected = selectedObjects.some(o => analysisResults.indexOf(o) === idx);

            if (isSelected) {
                i.classList.add('selected');
                i.setAttribute('aria-selected', 'true');
            } else {
                i.classList.remove('selected');
                i.setAttribute('aria-selected', 'false');
            }
        });

        // Detayları güncelle
        if (selectedObjects.length === 0) {
            detailLabel.textContent = '-';
            detailPos.textContent = '-';
            detailTime.textContent = '-';
            applyBtn.disabled = true;
            if (queueBtn) queueBtn.disabled = true;
            previewBtn.disabled = true;
            aiLabelBtn.disabled = true;
        } else if (selectedObjects.length === 1) {
            const obj = selectedObjects[0];
            detailLabel.textContent = obj.label || t('runtime.object_analysis.unknown_label', 'Unknown');
            detailPos.textContent = obj.position || t('runtime.object_analysis.auto_tracking', 'Auto Tracking');
            detailTime.textContent = obj.startTime.toFixed(2) + ' - ' + obj.endTime.toFixed(2);
            applyBtn.disabled = false;
            if (queueBtn) queueBtn.disabled = false;
            previewBtn.disabled = false;
            aiLabelBtn.disabled = false;
        } else {
            // Çoklu seçim
            detailLabel.textContent = t('runtime.object_analysis.multiple_selected', '{count} objects selected', { count: selectedObjects.length });
            detailPos.textContent = t('runtime.object_analysis.multiple', 'Multiple');
            detailTime.textContent = t('runtime.object_analysis.multiple', 'Multiple');
            applyBtn.disabled = false;
            if (queueBtn) queueBtn.disabled = false;
            previewBtn.disabled = true; // Önizleme tek nesne için
            aiLabelBtn.disabled = true;
        }

        announce(t('runtime.object_analysis.multiple_selected', '{count} objects selected', { count: selectedObjects.length }));
    }

    // Görsel güncelleme yardımcı fonksiyonu (Tümünü Seç için)
    function updateSelectionVisuals() {
        const items = objectList.querySelectorAll('li');
        items.forEach(i => {
            const idx = parseInt(i.dataset.index);
            const isSelected = selectedObjects.some(o => analysisResults.indexOf(o) === idx);

            if (isSelected) {
                i.classList.add('selected');
                i.setAttribute('aria-selected', 'true');
            } else {
                i.classList.remove('selected');
                i.setAttribute('aria-selected', 'false');
            }
        });

        // Detayları güncelle
        if (selectedObjects.length > 0) {
            detailLabel.textContent = t('runtime.object_analysis.multiple_selected', '{count} objects selected', { count: selectedObjects.length });
            detailPos.textContent = t('runtime.object_analysis.multiple', 'Multiple');
            detailTime.textContent = t('runtime.object_analysis.multiple', 'Multiple');
            applyBtn.disabled = false;
            if (queueBtn) queueBtn.disabled = false;
            previewBtn.disabled = selectedObjects.length > 1;
            aiLabelBtn.disabled = selectedObjects.length > 1;
        }
    }

    aiLabelBtn.addEventListener('click', async () => {
        if (!selectedObject) return;

        aiLabelBtn.disabled = true;
        aiLabelBtn.textContent = t('runtime.object_analysis.labeling', 'Labeling...');

        try {
            // Get middle frame
            const midTime = (selectedObject.startTime + selectedObject.endTime) / 2;

            // Extract frame and send to Gemini
            const base64 = await window.api.extractFrameBase64({
                videoPath: currentVideoPath,
                time: midTime
            });

            // Get Gemini API Data
            const apiData = await window.api.getGeminiApiData();
            if (!apiData || !apiData.apiKey) {
                alert(t('runtime.object_analysis.gemini_key_missing', 'Gemini API key was not found.'));
                aiLabelBtn.disabled = false;
                aiLabelBtn.textContent = t('runtime.object_analysis.ai_label_button', 'Label with AI');
                return;
            }

            const prompt = buildAiLabelPrompt(selectedObject.label);

            const response = await window.api.geminiVisionRequest({
                apiKey: apiData.apiKey,
                model: apiData.model,
                imageBase64: base64,
                prompt,
                systemInstruction: getAiSystemInstruction()
            });

            if (response.success) {
                const newLabel = response.text.trim();
                selectedObject.label = newLabel;

                // Yalnızca ilgili öğeyi güncelle (Seçim/odak kaybını önler)
                const index = analysisResults.indexOf(selectedObject);
                const li = objectList.querySelector(`li[data-index="${index}"]`);
                if (li) {
                    const duration = (selectedObject.endTime - selectedObject.startTime).toFixed(1);
                    let sizeInfo = '';
                    if (selectedObject.boxes && selectedObject.boxes[0] && selectedObject.boxes[0].box) {
                        const box = selectedObject.boxes[0].box;
                        const boxWidth = box.xmax - box.xmin;
                        const boxHeight = box.ymax - box.ymin;
                        const areaPercent = ((boxWidth * boxHeight) / (1920 * 1080) * 100).toFixed(1);
                        sizeInfo = t('runtime.object_analysis.size_info', ', Size: %{percent}', { percent: areaPercent });
                    }
                    const text = t('runtime.object_analysis.object_list_item', '{label}{sizeInfo} ({duration}s) - Detection Accuracy: %{score}', {
                        label: newLabel,
                        sizeInfo,
                        duration,
                        score: Math.round(selectedObject.score * 100)
                    });

                    if (index === 0) {
                        li.textContent = `${text} (${t('runtime.object_analysis.press_s_hint', 'Press S to select or deselect')})`;
                    } else {
                        li.textContent = text;
                    }
                }

                detailLabel.textContent = newLabel;
                announce(t('runtime.object_analysis.object_labeled', 'Object labeled: {label}', { label: newLabel }));
            } else {
                alert(t('runtime.object_analysis.label_failed', 'Labeling failed: {error}', { error: response.error }));
            }
        } catch (err) {
            console.error(err);
            alert(t('runtime.object_analysis.generic_error', 'An error occurred.'));
        } finally {
            aiLabelBtn.disabled = false;
            aiLabelBtn.textContent = t('runtime.object_analysis.ai_label_button_gemini', 'Label with AI (Gemini)');
        }
    });

    applyBtn.addEventListener('click', async () => {
        if (selectedObjects.length === 0) return;

        applyBtn.disabled = true;
        applyBtn.textContent = t('runtime.object_analysis.applying', 'Applying ({count} objects)...', { count: selectedObjects.length });
        announce(t('runtime.object_analysis.applying_announce', 'Applying the selected operation to the video, please wait.'));

        if (window.App && window.App.showProgress) {
            window.App.showProgress(t('runtime.object_analysis.applying_progress', 'Applying object effect...'));
        }

        try {
            const effectType = actionTypeSelect.value;
            const scope = actionScopeSelect.value; // 'track', 'full', 'custom'

            // Custom zaman aralığı için değerleri al
            let customStart = null;
            let customEnd = null;
            if (scope === 'custom' && customStartTime && customEndTime) {
                customStart = parseFloat(customStartTime.value) || 0;
                customEnd = parseFloat(customEndTime.value) || 10;
            }

            const result = await window.api.applyObjectEffect({
                videoPath: currentVideoPath,
                objectTracks: selectedObjects, // Çoklu nesne desteği
                objectTrack: selectedObjects[0], // Geriye dönük uyumluluk
                effectType: effectType,
                scope: scope,
                customStart: customStart,
                customEnd: customEnd
            });

            if (result.success) {
                // alert('Efekt başarıyla uygulandı! Dosya: ' + result.outputPath + '\n(Not: Asıl projeye eklemek için bu dosyayı içe aktarmalısınız.)');

                // Otomatik olarak projeye ekle
                if (window.App && window.App.openFile) {
                    announce(t('runtime.object_analysis.effect_applied_opening_tab', 'Effect applied. The processed video is opening in a new tab...'));

                    // Biraz gecikmeli çağır ki dialog kapansın/kullanıcı anlasın
                    dialog.close();

                    // Open file in new tab
                    window.App.openFile(result.outputPath);

                    // Kullanıcıya bilgi ver
                    setTimeout(() => {
                        announce(t('runtime.object_analysis.processed_video_opened', 'The processed video was opened in a new tab. This file is temporary; use Save As to keep it.'));
                    }, 1000);

                } else {
                    alert(t('runtime.object_analysis.effect_applied_file', 'Effect was applied but could not be added automatically.\nFile: {path}', { path: result.outputPath }));
                }
            } else {
                alert(t('runtime.common.error', 'Error: {error}', { error: result.error }));
            }
        } catch (err) {
            console.error(err);
            alert(t('runtime.object_analysis.generic_failure', 'General error'));
        } finally {
            if (window.App && window.App.hideProgress) {
                window.App.hideProgress();
            }
            applyBtn.disabled = false;
            applyBtn.textContent = t('runtime.object_analysis.apply_to_video', 'Apply to Video');
        }
    });

    if (queueBtn) {
        queueBtn.addEventListener('click', () => {
            if (selectedObjects.length === 0) return;

            const effectType = actionTypeSelect.value;
            const scope = actionScopeSelect.value;
            let customStart = null;
            let customEnd = null;
            if (scope === 'custom' && customStartTime && customEndTime) {
                customStart = parseFloat(customStartTime.value) || 0;
                customEnd = parseFloat(customEndTime.value) || 10;
            }

            if (window.InsertionQueue) {
                InsertionQueue.addItem('object', {
                    objectTracks: [...selectedObjects], // Clone the items
                    objectName: selectedObjects.length > 1 ? t('runtime.object_analysis.multiple_object_name', 'Multiple Objects') : selectedObjects[0].label,
                    actionType: effectType,
                    durationMode: scope,
                    startTime: customStart || selectedObjects[0].startTime,
                    endTime: customEnd || selectedObjects[selectedObjects.length - 1].endTime
                });

                // Show change in App
                if (window.App) {
                    window.App.hasChanges = true;
                }

                announce(t('runtime.object_analysis.queue_added', '{count} object operations were added to the insertion queue.', { count: selectedObjects.length }));

                // Optionally close after a slight delay
                setTimeout(() => {
                    dialog.close();
                    if (window.Dialogs) {
                        window.Dialogs.showInsertionQueueDialog();
                    }
                }, 1500);
            }
        });
    }

    previewBtn.addEventListener('click', async () => {
        if (!selectedObject) return;

        const videoPlayer = document.getElementById('video-player');
        if (!videoPlayer) return;

        // Efekt adını al
        const effectSelect = document.getElementById('object-action-type');
        const effectType = effectSelect.value;
        const effectName = effectSelect.options[effectSelect.selectedIndex].text;

        previewBtn.disabled = true;
        previewBtn.textContent = t('runtime.object_analysis.checking', 'Checking...');

        announce(t('runtime.object_analysis.preview_checking', 'Checking the {effect} effect for object "{label}". Please wait...', {
            effect: effectName,
            label: selectedObject.label
        }));

        try {
            // Nesnenin orta zamanına git
            const midTime = (selectedObject.startTime + selectedObject.endTime) / 2;

            // Kareyi çıkar
            const base64 = await window.api.extractFrameBase64({
                videoPath: currentVideoPath,
                time: midTime
            });

            // Gemini API bilgilerini al
            const apiData = await window.api.getGeminiApiData();
            if (!apiData || !apiData.apiKey) {
                announce(t('runtime.object_analysis.preview_key_missing', 'Gemini API key was not found. Preview cannot continue.'));
                return;
            }

            // Konum bilgisini al
            const position = selectedObject.position || t('runtime.object_analysis.center', 'Center');

            // Gemini'ye sor
            const prompt = buildAiPreviewPrompt(selectedObject.label, position, effectName);

            const response = await window.api.geminiVisionRequest({
                apiKey: apiData.apiKey,
                model: apiData.model,
                imageBase64: base64,
                prompt,
                systemInstruction: getAiSystemInstruction()
            });

            if (response.success) {
                const result = response.text.trim();

                // Önce ekran okuyucuya duyur
                announce(t('runtime.object_analysis.preview_result', 'Preview result: {result}', { result }));

                // Sonra alert göster (200ms gecikmeyle ekran okuyucu okusun)
                setTimeout(() => {
                    if (window.Accessibility && window.Accessibility.alert) {
                        window.Accessibility.alert(t('runtime.object_analysis.preview_result_multiline', 'Preview result:\n\n{result}', { result }));
                    } else {
                        alert(t('runtime.object_analysis.preview_result_multiline', 'Preview result:\n\n{result}', { result }));
                    }
                }, 200);
            } else {
                const errorMsg = t('runtime.object_analysis.preview_error', 'Preview error: {error}', { error: response.error });
                announce(errorMsg);
                setTimeout(() => {
                    if (window.Accessibility && window.Accessibility.alert) {
                        window.Accessibility.alert(errorMsg);
                    } else {
                        alert(errorMsg);
                    }
                }, 200);
            }
        } catch (err) {
            console.error(err);
            const errorMsg = t('runtime.object_analysis.preview_failed', 'Error during preview: {error}', {
                error: err.message || t('runtime.object_analysis.unknown_error', 'Unknown error')
            });
            announce(errorMsg);
            setTimeout(() => {
                if (window.Accessibility && window.Accessibility.alert) {
                    window.Accessibility.alert(errorMsg);
                } else {
                    alert(errorMsg);
                }
            }, 200);
        } finally {
            previewBtn.disabled = false;
            previewBtn.textContent = t('runtime.object_analysis.preview_button_ai', 'Preview (AI Check)');
        }
    });

    function resetDialog() {
        analysisResults = [];
        selectedObject = null;
        objectList.innerHTML = `<li class="empty-message">${t('runtime.object_analysis.not_analyzed_yet', 'No analysis has been run yet.')}</li>`;
        startAnalysisBtn.disabled = false;
        applyBtn.disabled = true;
        if (queueBtn) queueBtn.disabled = true;
        previewBtn.disabled = true;
        aiLabelBtn.disabled = true;
        detailLabel.textContent = '-';
        analysisStatus.textContent = t('runtime.object_analysis.ready', 'Ready');
    }

    function announce(msg) {
        const announcer = document.getElementById('screen-reader-announcer');
        if (announcer) {
            announcer.textContent = '';
            // Force redraw/re-announce
            requestAnimationFrame(() => {
                announcer.textContent = msg;
            });
        }
    }

    function resetAnnouncer() {
        const announcer = document.getElementById('screen-reader-announcer');
        if (announcer) announcer.textContent = '';
    }
});
