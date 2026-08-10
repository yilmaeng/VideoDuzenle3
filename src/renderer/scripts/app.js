/**
 * Ana Uygulama Modülü
 * Tüm modülleri başlatır ve koordine eder
 */

const App = {
    isReady: false,
    startupReadyAnnounced: false,
    startupPostTasksHandled: false,
    currentFilePath: null,
    originalFilePath: null, // Orijinal dosya (değişiklikler için)
    hasChanges: false, // Kaydedilmemiş değişiklik var mı?
    isOpeningFile: false, // Dosya açma işlemi sürüyor mu?
    nativeMenuActive: false,
    clipboard: null, // {type: 'video'|'audio', start, end, data}
    undoStack: [],
    redoStack: [],
    verticalClipQueue: [],

    t(key, fallback, params = {}) {
        if (!window.i18nHelper) return fallback;
        const value = window.i18nHelper.t(key, params);
        return value && !value.startsWith('[') ? value : fallback;
    },

    async ensureI18nReady() {
        if (!window.i18nHelper || !window.api?.i18n) {
            return;
        }

        if (window.i18nHelper.currentLang && Object.keys(window.i18nHelper.cache || {}).length > 0) {
            return;
        }

        window.i18nHelper.currentLang = await window.api.i18n.getLanguage();
        window.i18nHelper.cache = await window.api.i18n.getAll();
        document.documentElement.lang = window.i18nHelper.currentLang;
    },

    /**
     * Uygulamayı başlat
     */
    async init() {
        // Modülleri başlat
        Settings.init(); // Ayarları yükle (ilk)
        Accessibility.init();
        this.setupAccessibilityDialogAnnouncements();
        Utils; // Statik modül
        VideoPlayer.init();
        Markers.init();
        Transitions.init();
        Selection.init();
        Dialogs.init();
        Keyboard.init();
        TabManager.init();
        this.setupLaunchSurfaceActions();
        if (typeof InsertionQueue !== 'undefined') InsertionQueue.init();
        if (typeof AudioPlayer !== 'undefined') AudioPlayer.init();

        // VideoPlayer hata callback'lerini ayarla
        // NOT: Artık smartOpenVideo kullanıldığı için, dosya açma aşamasında
        // zaten uyumluluk kontrolü yapılıyor. Bu callback sadece oynatma 
        // sırasındaki beklenmedik hatalar için.
        VideoPlayer.onConversionNeeded = (filePath, errorMessage) => {
            console.warn('VideoPlayer oynatma hatası (smartOpen zaten uygulandı):', errorMessage);
            // Sadece kullanıcıya bilgi ver, dönüştürme önerme
            Accessibility.announceError(this.t('runtime.app.playback_error', 'Video oynatma hatası: {error}', {
                error: errorMessage
            }));
        };

        // IPC event'lerini dinle
        this.setupIpcListeners();

        // Klavye Kısayolları (Proje Yönetimi)
        window.addEventListener('keydown', (e) => {
            if (this.nativeMenuActive) {
                return;
            }

            // Ctrl+Shift+N: Yeni Slayt Projesi
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n') {
                e.preventDefault();
                window.api.send('slideshow-new-project');
            }
            // Ctrl+Shift+P: Projeyi Kaydet (.kve)
            else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                this.saveProject();
            }
            // Ctrl+Shift+O: Proje Aç (.kve)
            else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'o') {
                e.preventDefault();
                this.loadProject();
            }
            // NOT: Ctrl+Shift+S (Videoyu Farklı Kaydet) menü tarafından handle ediliyor
        });

        document.addEventListener('click', (event) => {
            const target = event.target;
            if (!target || typeof target.closest !== 'function') {
                return;
            }

            const dialogButton = target.closest('dialog[open] button, dialog[open] [role="button"]');
            if (dialogButton) {
                this.suppressPlaybackShortcuts();
            }
        }, true);

        // Hazır
        this.isReady = true;
        await this.ensureI18nReady();
        const shouldDelayStartupAnnouncement = window.StartupWelcome && window.StartupWelcome.shouldShow();
        if (!shouldDelayStartupAnnouncement) {
            this.handlePostStartupTasks();
        }

        if (window.StartupWelcome) {
            setTimeout(() => {
                window.StartupWelcome.showIfNeeded();
            }, 150);
        }
    },

    buildAccessibilityDialogAnnouncementText(payload = {}) {
        return [payload.title, payload.message, payload.detail]
            .map((part) => String(part || '').trim())
            .filter(Boolean)
            .join('. ');
    },

    setupAccessibilityDialogAnnouncements() {
        if (this._dialogAccessibilityBound) {
            return;
        }

        this._dialogAccessibilityBound = true;
        window.addEventListener('evd-accessibility-dialog-announce', (event) => {
            const message = this.buildAccessibilityDialogAnnouncementText(event.detail);
            if (!message) return;
            Accessibility.alert(message);
        });
    },

    async announceStartupReady() {
        if (this.startupReadyAnnounced) {
            return;
        }

        this.startupReadyAnnounced = true;
        await this.ensureI18nReady();
        const key = 'runtime.app.startup_ready';
        let message = window.i18nHelper?.t?.(key);
        if (!message || message.startsWith('[')) {
            message = await window.api?.i18n?.t?.(key);
        }
        if (message && !message.startsWith('[')) {
            Accessibility.announce(message);
        }
    },

    handlePostStartupTasks() {
        if (this.startupPostTasksHandled) {
            window.UpdateManager?.maybeShowPendingUpdatePrompt?.();
            return;
        }

        this.startupPostTasksHandled = true;
        this.announceStartupReady();

        setTimeout(() => {
            window.UpdateManager?.checkForUpdatesOnStartup?.();
            window.UpdateManager?.maybeShowPendingUpdatePrompt?.();
        }, 400);
    },

    suppressPlaybackShortcuts(durationMs = 600) {
        const safeDuration = Math.max(0, Number(durationMs) || 0);
        this._suppressPlaybackShortcutsUntil = Date.now() + safeDuration;
    },

    shouldSuppressPlaybackShortcuts() {
        return Date.now() < (this._suppressPlaybackShortcutsUntil || 0);
    },

    setupLaunchSurfaceActions() {
        const placeholder = document.getElementById('video-placeholder');
        if (!placeholder || placeholder.dataset.actionsBound === 'true') {
            return;
        }

        placeholder.addEventListener('click', (event) => {
            const trigger = event.target.closest('[data-launch-action]');
            if (!trigger) {
                return;
            }

            const action = trigger.getAttribute('data-launch-action');
            if (action) {
                this.runLaunchAction(action);
            }
        });

        placeholder.dataset.actionsBound = 'true';
    },

    runLaunchAction(action) {
        switch (action) {
            case 'open-video':
                this.openFile();
                break;
            case 'open-project':
                this.loadProject();
                break;
            case 'new-slideshow':
                window.api.send('slideshow-new-project');
                break;
            case 'sync-audio':
                window.api.openSyncWizard('A');
                break;
            case 'vertical-video':
                window.api.openVerticalWizard();
                break;
            case 'recording-wizard':
                window.api.openRecordingWizard();
                break;
            case 'api-key':
                Dialogs.showGeminiApiKeyDialog();
                break;
            case 'quick-start':
                window.StartupWelcome?.showQuickStartDialog?.();
                break;
            default:
                break;
        }
    },

    formatVerticalClipTime(seconds) {
        const totalSeconds = Math.max(0, Math.floor(seconds || 0));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const secs = totalSeconds % 60;
        if (hours > 0) {
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    },

    parseFilePath(filePath) {
        const normalized = String(filePath || '').replace(/\\/g, '/');
        const filename = normalized.split('/').pop() || '';
        const lastDot = filename.lastIndexOf('.');
        const ext = lastDot > 0 ? filename.slice(lastDot) : '';
        const name = lastDot > 0 ? filename.slice(0, lastDot) : (filename || 'video');
        const separator = String(filePath || '').includes('\\') ? '\\' : '/';
        return { name, ext, separator };
    },

    joinFilePath(folderPath, fileName) {
        const separator = String(folderPath || '').includes('\\') ? '\\' : '/';
        const trimmedFolder = String(folderPath || '').replace(/[\\/]+$/, '');
        return trimmedFolder ? `${trimmedFolder}${separator}${fileName}` : fileName;
    },

    buildVerticalClipFromRange(selection, options = {}) {
        if (!VideoPlayer.hasVideo()) {
            return {
                success: false,
                message: this.t('runtime.vertical.open_video_first', 'Önce bir video açmalısınız.')
            };
        }

        if (!selection || selection.end <= selection.start) {
            return {
                success: false,
                message: this.t('runtime.vertical.invalid_selection', 'Geçerli bir seçim bulunamadı.')
            };
        }

        const startInfo = Timeline.getSegmentAt(selection.start);
        const endInfo = Timeline.getSegmentAt(Math.max(selection.start, selection.end - 0.001));
        if (!startInfo || !endInfo) {
            return {
                success: false,
                message: this.t('runtime.vertical.selection_segment_unavailable', 'Seçili alan için kaynak segment bilgisi alınamadı.')
            };
        }

        if (startInfo.segmentIndex !== endInfo.segmentIndex) {
            return {
                success: false,
                message: this.t('runtime.vertical.selection_single_segment_only', 'Şimdilik kısa video üretimi aynı segment içindeki tek bir seçimle çalışır. Lütfen daha kısa bir alan seçin.')
            };
        }

        const segment = startInfo.segment;
        if ((segment.speed || 1) !== 1) {
            return {
                success: false,
                message: this.t('runtime.vertical.selection_speed_unsupported', 'Hızı değiştirilmiş alanlar için kısa video üretimi henüz desteklenmiyor. Lütfen normal hızdaki bir alan seçin.')
            };
        }

        const sourcePath = segment.sourceFile || this.currentFilePath || this.originalFilePath;
        if (!sourcePath) {
            return {
                success: false,
                message: this.t('runtime.vertical.source_path_missing', 'Kaynak video yolu bulunamadı.')
            };
        }

        const speed = segment.speed || 1;
        const segmentDuration = Math.max(0, (segment.end - segment.start) / speed);
        const clampedStartOffset = Math.min(Math.max(startInfo.offsetInSegment, 0), segmentDuration);
        const selectionDuration = Math.max(0, selection.end - selection.start);
        const clampedEndOffset = Math.min(clampedStartOffset + selectionDuration, segmentDuration);
        const startTime = segment.start + (clampedStartOffset * speed);
        const endTime = segment.start + (clampedEndOffset * speed);
        const duration = Math.max(0, endTime - startTime);
        if (duration <= 0.05) {
            return {
                success: false,
                message: this.t('runtime.vertical.selection_too_short', 'Seçili alan çok kısa. Lütfen biraz daha uzun bir alan seçin.')
            };
        }

        const startLabel = this.formatVerticalClipTime(startTime);
        const endLabel = this.formatVerticalClipTime(endTime);
        return {
            success: true,
            clip: {
                id: `vertical_clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                sourcePath,
                startTime,
                endTime,
                duration,
                label: this.t('runtime.vertical.clip_label', 'Klip {start} - {end}', {
                    start: startLabel,
                    end: endLabel
                }),
                filenameSuffix: `${startLabel.replace(/:/g, '-')}_${endLabel.replace(/:/g, '-')}`,
                selectionStart: selection.start,
                selectionEnd: selection.end,
                markerStartId: options.markerStartId || null,
                markerEndId: options.markerEndId || null
            }
        };
    },

    buildVerticalClipFromSelection() {
        if (!Selection.hasSelection()) {
            return {
                success: false,
                message: this.t('runtime.vertical.select_area_first', 'Önce dikey videoya dönüştürmek istediğiniz alanı seçin.')
            };
        }

        return this.buildVerticalClipFromRange(Selection.getSelection());
    },

    canAppendVerticalClip(clip) {
        if (!clip) {
            return false;
        }

        if (this.verticalClipQueue.length > 0) {
            const firstSourcePath = this.verticalClipQueue[0].sourcePath;
            if (firstSourcePath !== clip.sourcePath) {
                Accessibility.alert(this.t('runtime.vertical.queue_mixed_source_not_supported', 'Seçim listesi şimdilik tek bir kaynak video için kullanılabilir. Farklı bir videodan eklemeden önce listeyi temizleyin.'));
                return false;
            }
        }

        return true;
    },

    hasVerticalClipQueueMarkerPair(markerStartId, markerEndId, sourcePath) {
        if (!markerStartId || !markerEndId || !sourcePath) {
            return false;
        }

        return this.verticalClipQueue.some((clip) =>
            clip?.sourcePath === sourcePath
            && clip?.markerStartId === markerStartId
            && clip?.markerEndId === markerEndId
        );
    },

    addSelectionToVerticalQueue() {
        const built = this.buildVerticalClipFromSelection();
        if (!built.success) {
            Accessibility.alert(built.message);
            return null;
        }

        if (!this.canAppendVerticalClip(built.clip)) {
            return null;
        }

        this.verticalClipQueue.push(built.clip);
        Accessibility.announce(this.t('runtime.vertical.queue_add_success', '{label} seçim listesine eklendi. Listede toplam {count} öğe var.', {
            label: built.clip.label,
            count: String(this.verticalClipQueue.length)
        }));
        return built.clip;
    },

    addMarkerPairsToVerticalQueue() {
        if (!VideoPlayer.hasVideo()) {
            Accessibility.alert(this.t('runtime.vertical.open_video_first', 'Önce bir video açmalısınız.'));
            return { addedCount: 0, totalCount: this.verticalClipQueue.length };
        }

        const markers = (typeof Markers !== 'undefined' && typeof Markers.getAll === 'function')
            ? Markers.getAll()
            : [];

        if (markers.length < 2) {
            Accessibility.alert(this.t('runtime.vertical.marker_pairs_need_two', 'İşaretçilerden seçim listesi oluşturmak için en az 2 işaretçi gerekir.'));
            return { addedCount: 0, totalCount: this.verticalClipQueue.length };
        }

        const pairCount = Math.floor(markers.length / 2);
        let addedCount = 0;

        for (let i = 0; i < pairCount; i++) {
            const startMarker = markers[i * 2];
            const endMarker = markers[i * 2 + 1];
            if (!startMarker || !endMarker) {
                continue;
            }

            const selection = {
                start: Math.min(startMarker.time, endMarker.time),
                end: Math.max(startMarker.time, endMarker.time)
            };

            const built = this.buildVerticalClipFromRange(selection, {
                markerStartId: startMarker.id,
                markerEndId: endMarker.id
            });

            if (!built.success) {
                Accessibility.alert(built.message);
                return { addedCount, totalCount: this.verticalClipQueue.length };
            }

            if (!this.canAppendVerticalClip(built.clip)) {
                return { addedCount, totalCount: this.verticalClipQueue.length };
            }

            if (this.hasVerticalClipQueueMarkerPair(startMarker.id, endMarker.id, built.clip.sourcePath)) {
                continue;
            }

            this.verticalClipQueue.push(built.clip);
            addedCount++;
        }

        if (addedCount === 0) {
            const messageKey = markers.length % 2 === 1
                ? 'runtime.vertical.marker_pairs_no_new_need_more'
                : 'runtime.vertical.marker_pairs_no_new';
            const fallback = markers.length % 2 === 1
                ? 'İşaretçilerden eklenecek yeni seçim alanı bulunamadı. Son seçim alanını oluşturmak için bir işaretçi daha ekleyin.'
                : 'İşaretçilerden eklenecek yeni seçim alanı bulunamadı.';
            Accessibility.alert(this.t(messageKey, fallback));
            return { addedCount, totalCount: this.verticalClipQueue.length };
        }

        const messageKey = markers.length % 2 === 1
            ? 'runtime.vertical.marker_pairs_added_need_more'
            : 'runtime.vertical.marker_pairs_added';
        const fallback = markers.length % 2 === 1
            ? '{added} seçim alanı işaretçilerden seçim listesine eklendi. Listede artık toplam {count} öğe var. Bir seçim alanı daha oluşturmak için bir işaretçi daha ekleyin.'
            : '{added} seçim alanı işaretçilerden seçim listesine eklendi. Listede artık toplam {count} öğe var.';
        Accessibility.announce(this.t(messageKey, fallback, {
            added: String(addedCount),
            count: String(this.verticalClipQueue.length)
        }));

        return { addedCount, totalCount: this.verticalClipQueue.length };
    },

    openVerticalWizardFromSelection() {
        const built = this.buildVerticalClipFromSelection();
        if (!built.success) {
            Accessibility.alert(built.message);
            return;
        }

        window.api.openVerticalWizard({
            filePath: built.clip.sourcePath,
            clipQueue: [built.clip]
        });
    },

    openVerticalWizardFromQueue() {
        if (!Array.isArray(this.verticalClipQueue) || this.verticalClipQueue.length === 0) {
            Accessibility.alert(this.t('runtime.vertical.queue_empty', 'Seçim listesi şu anda boş.'));
            return;
        }

        const firstClip = this.verticalClipQueue[0];
        window.api.openVerticalWizard({
            filePath: firstClip.sourcePath,
            clipQueue: this.getVerticalClipQueueSnapshot()
        });
    },

    openSelectionQueueDialog() {
        Dialogs.showSelectionQueueDialog();
    },

    moveVerticalClipQueueItem(index, direction) {
        const currentIndex = Number(index);
        const targetIndex = currentIndex + Number(direction);
        if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= this.verticalClipQueue.length) {
            return -1;
        }
        if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= this.verticalClipQueue.length) {
            return currentIndex;
        }

        const [item] = this.verticalClipQueue.splice(currentIndex, 1);
        this.verticalClipQueue.splice(targetIndex, 0, item);

        Accessibility.announce(this.t(
            direction < 0 ? 'runtime.selection_queue.moved_up' : 'runtime.selection_queue.moved_down',
            direction < 0 ? 'Seçim yukarı taşındı.' : 'Seçim aşağı taşındı.'
        ));
        return targetIndex;
    },

    getVerticalClipQueueSnapshot() {
        return Array.isArray(this.verticalClipQueue)
            ? this.verticalClipQueue.map((clip) => ({ ...clip }))
            : [];
    },

    queueClipMatchesSelection(clip, selection = null) {
        if (!clip || typeof Selection === 'undefined' || typeof Selection.hasSelection !== 'function' || !Selection.hasSelection()) {
            return false;
        }

        const currentSelection = selection || Selection.getSelection();
        if (!currentSelection) {
            return false;
        }

        const clipSourcePath = String(clip.sourcePath || '');
        const currentSourcePath = String(this.currentFilePath || '');
        if (!clipSourcePath || !currentSourcePath || clipSourcePath !== currentSourcePath) {
            return false;
        }

        const clipStart = Number.isFinite(clip.selectionStart) ? clip.selectionStart : clip.startTime;
        const clipEnd = Number.isFinite(clip.selectionEnd) ? clip.selectionEnd : clip.endTime;
        if (!Number.isFinite(clipStart) || !Number.isFinite(clipEnd)) {
            return false;
        }

        return Math.abs(currentSelection.start - clipStart) < 0.001
            && Math.abs(currentSelection.end - clipEnd) < 0.001;
    },

    syncSelectionAfterQueueMutation(removedClips = []) {
        if (typeof Selection === 'undefined' || typeof Selection.hasSelection !== 'function' || !Selection.hasSelection()) {
            return;
        }

        const currentSelection = Selection.getSelection();
        if (!currentSelection) {
            return;
        }

        const normalizedRemovedClips = Array.isArray(removedClips) ? removedClips.filter(Boolean) : [];
        const matchedRemovedClip = normalizedRemovedClips.find((clip) => this.queueClipMatchesSelection(clip, currentSelection));
        if (!matchedRemovedClip) {
            return;
        }

        const stillExistsInQueue = this.verticalClipQueue.some((clip) => this.queueClipMatchesSelection(clip, currentSelection));
        if (!stillExistsInQueue) {
            Selection.clear(true);
        }
    },

    removeVerticalClipQueueItem(index) {
        const currentIndex = Number(index);
        if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= this.verticalClipQueue.length) {
            return -1;
        }

        const [removedClip] = this.verticalClipQueue.splice(currentIndex, 1);
        this.syncSelectionAfterQueueMutation([removedClip]);
        Accessibility.announce(this.t('runtime.selection_queue.item_removed', 'Seçim listeden kaldırıldı.'));

        if (this.verticalClipQueue.length === 0) {
            return -1;
        }
        return Math.min(currentIndex, this.verticalClipQueue.length - 1);
    },

    previewVerticalClipQueueItem(index) {
        const currentIndex = Number(index);
        const clip = this.verticalClipQueue[currentIndex];
        if (!clip) {
            return;
        }

        try {
            if (Number.isFinite(clip.selectionStart) && Number.isFinite(clip.selectionEnd)) {
                Selection.setSelection(clip.selectionStart, clip.selectionEnd);
                if (typeof VideoPlayer.seekToTimelineTime === 'function') {
                    VideoPlayer.seekToTimelineTime(clip.selectionStart);
                } else {
                    VideoPlayer.seekTo(clip.selectionStart);
                }
                if (typeof VideoPlayer.playSelectionWithDialogOpen === 'function') {
                    VideoPlayer.playSelectionWithDialogOpen();
                } else {
                    VideoPlayer.playSelection();
                }
                Accessibility.announce(this.t('runtime.selection_queue.preview_started', '{label} oynatılıyor.', {
                    label: clip.label || this.t('runtime.app.selection_item_label', 'Seçim {index}', {
                        index: String(currentIndex + 1)
                    })
                }));
                return true;
            }
        } catch (error) {
            console.error('Selection queue preview failed:', error);
        }

        Accessibility.alert(this.t('runtime.selection_queue.preview_unavailable', 'Bu seçim için önizleme başlatılamadı.'));
        return false;
    },

    async mergeVerticalClipQueue() {
        if (!Array.isArray(this.verticalClipQueue) || this.verticalClipQueue.length === 0) {
            Accessibility.alert(this.t('runtime.selection_queue.empty', 'Seçim listesi şu anda boş.'));
            return;
        }

        const parsedSource = this.parseFilePath(this.verticalClipQueue[0]?.sourcePath || this.currentFilePath || '');
        const saveResult = await window.api.showSaveDialog({
            title: this.t('messages.merge_selection_queue', 'Seçim Listesini Tek Klipte Birleştir'),
            defaultPath: `${parsedSource.name || 'video'}-selection-merge.mp4`,
            filters: [{ name: this.t('runtime.app.mp4_video_filter', 'MP4 Video'), extensions: ['mp4'] }]
        });

        if (saveResult.canceled || !saveResult.filePath) {
            return;
        }

        const tempFiles = [];
        try {
            this.showProgress(this.t('runtime.selection_queue.merging', 'Seçimler yeni bir klipte birleştiriliyor...'));
            Accessibility.announce(this.t('runtime.selection_queue.merging', 'Seçimler yeni bir klipte birleştiriliyor...'));

            for (let i = 0; i < this.verticalClipQueue.length; i++) {
                const clip = this.verticalClipQueue[i];
                this.showProgress(this.t('runtime.selection_queue.preparing_item', 'Kuyruktaki {index}. seçim hazırlanıyor. Toplam {count} seçim var.', {
                    index: String(i + 1),
                    count: String(this.verticalClipQueue.length)
                }));

                const tempPath = await window.api.getTempPath(`evd_selection_merge_${Date.now()}_${i + 1}.mp4`);
                tempFiles.push(tempPath);

                const cutResult = await window.api.cutVideo({
                    inputPath: clip.sourcePath,
                    outputPath: tempPath,
                    startTime: clip.startTime,
                    endTime: clip.endTime
                });

                if (!cutResult.success) {
                    throw new Error(cutResult.error || this.t('runtime.common.error', 'Hata: {error}', { error: 'Unknown' }));
                }
            }

            this.showProgress(this.t('runtime.selection_queue.concatenating', 'Hazırlanan seçimler birleştiriliyor...'));
            const concatResult = await window.api.concatVideosFast({
                inputPaths: tempFiles,
                outputPath: saveResult.filePath
            });

            if (!concatResult.success) {
                throw new Error(concatResult.error || this.t('runtime.selection_queue.merge_failed', 'Seçimler birleştirilemedi.'));
            }

            this.hideProgress();
            await this.openFile(saveResult.filePath);
            Accessibility.announceComplete(this.t('runtime.selection_queue.merge_completed', 'Seçim listesi tek klip olarak oluşturuldu.'));
        } catch (error) {
            this.hideProgress();
            Accessibility.announceError(error.message);
        } finally {
            if (tempFiles.length > 0) {
                try {
                    await window.api.deleteFiles(tempFiles);
                } catch (cleanupError) {
                    console.warn('Selection merge temp cleanup failed:', cleanupError);
                }
            }
        }
    },

    clearVerticalClipQueue(shouldAnnounce = true) {
        const removedClips = this.getVerticalClipQueueSnapshot();
        this.verticalClipQueue.length = 0;
        this.syncSelectionAfterQueueMutation(removedClips);
        if (shouldAnnounce) {
            Accessibility.announce(this.t('runtime.vertical.queue_cleared', 'Seçim listesi temizlendi.'));
        }
    },

    getSelectionSaveItems() {
        if (Array.isArray(this.verticalClipQueue) && this.verticalClipQueue.length > 0) {
            return this.verticalClipQueue.map((clip, index) => ({
                sourcePath: clip.sourcePath,
                startTime: clip.startTime,
                endTime: clip.endTime,
                label: clip.label || this.t('runtime.app.selection_item_label', 'Seçim {index}', { index: String(index + 1) }),
                index
            }));
        }

        const built = this.buildVerticalClipFromSelection();
        if (!built.success) {
            return { success: false, message: built.message };
        }

        return [{
            sourcePath: built.clip.sourcePath,
            startTime: built.clip.startTime,
            endTime: built.clip.endTime,
            label: built.clip.label,
            index: 0
        }];
    },

    buildSelectionOutputPath(folderPath, itemIndex, sourcePath, isLossless) {
        const parsedSource = this.parseFilePath(sourcePath || '');
        const sourceExt = (parsedSource.ext || '.mp4').toLowerCase();
        const baseName = parsedSource.name || 'video';
        const ext = isLossless ? sourceExt : '.mp4';
        return this.joinFilePath(folderPath, `${baseName}-selection${itemIndex + 1}${ext}`);
    },

    async chooseSelectionSaveTargets(items, isLossless) {
        if (!Array.isArray(items) || items.length === 0) {
            return { cancelled: true, targets: [] };
        }

        if (items.length === 1) {
            const sourcePath = items[0].sourcePath || this.currentFilePath || '';
            const parsedSource = this.parseFilePath(sourcePath || '');
            const sourceExt = (parsedSource.ext || '.mp4').toLowerCase();
            const saveExt = isLossless ? sourceExt : '.mp4';
            const defaultName = `${parsedSource.name || 'video'}-selection1${saveExt}`;
            const filterName = isLossless
                ? this.t('runtime.app.lossless_selection_filter', 'Kaynak Biçim')
                : this.t('runtime.app.mp4_video_filter', 'MP4 Video');
            const result = await window.api.showSaveDialog({
                title: isLossless
                    ? this.t('messages.save_selection_fast', 'Seçili Alanı Akıllı Hızlı Kaydet')
                    : this.t('messages.save_selection', 'Seçili Alanı Kaydet'),
                defaultPath: defaultName,
                filters: [{ name: filterName, extensions: [saveExt.replace('.', '')] }]
            });

            if (result.canceled || !result.filePath) {
                return { cancelled: true, targets: [] };
            }

            return { cancelled: false, targets: [result.filePath] };
        }

        const folderResult = await window.api.openFileDialog({
            title: isLossless
                ? this.t('messages.save_selection_fast_folder', 'Akıllı hızlı seçimleri kaydetmek için klasör seçin')
                : this.t('messages.save_selection_folder', 'Seçimleri kaydetmek için klasör seçin'),
            properties: ['openDirectory']
        });

        if (folderResult.canceled || !folderResult.filePaths || folderResult.filePaths.length === 0) {
            return { cancelled: true, targets: [] };
        }

        const folderPath = folderResult.filePaths[0];
        return {
            cancelled: false,
            targets: items.map((item, index) => this.buildSelectionOutputPath(folderPath, index, item.sourcePath, isLossless))
        };
    },

    async chooseLosslessSelectionMode(items) {
        const modeChoice = await window.api.showMessageBox({
            type: 'question',
            title: this.t('runtime.app.lossless_selection_mode_title', 'Akıllı hızlı kaydetme modu'),
            message: this.t('runtime.app.lossless_selection_mode_message', 'Akıllı hızlı kaydetme için hangi yöntemi kullanmak istersiniz?'),
            detail: this.t('runtime.app.lossless_selection_mode_detail', 'Sınırları aynen koru seçeneği mevcut seçimi korur ama uçlarda yeniden kodlama yapabilir. Keyframelere genişlet seçeneği seçimi en yakın ana karelere büyütür ve mümkün olduğunda kayıpsız kopyalama hedefler.'),
            buttons: [
                this.t('runtime.app.lossless_selection_mode_keep_exact', 'Sınırları aynen koru'),
                this.t('runtime.app.lossless_selection_mode_expand_keyframes', 'Keyframelere genişlet'),
                this.t('dialog.common.cancel', 'İptal')
            ],
            defaultId: 0,
            cancelId: 2,
            noLink: true
        });

        if (modeChoice.response === 2) {
            return { cancelled: true };
        }

        if (modeChoice.response === 0) {
            return {
                cancelled: false,
                mode: 'smart-exact',
                items
            };
        }

        const adjustedItems = [];
        const summaryLines = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const bounds = await window.api.getCutVideoFastBounds({
                inputPath: item.sourcePath,
                startTime: item.startTime,
                endTime: item.endTime
            });

            if (!bounds || !bounds.success) {
                throw new Error(bounds?.error || this.t('runtime.app.lossless_selection_bounds_failed', 'Kayıpsız sınırlar hesaplanamadı.'));
            }

            adjustedItems.push({
                ...item,
                startTime: bounds.startTime,
                endTime: bounds.endTime
            });

            summaryLines.push(this.t('runtime.app.lossless_selection_adjusted_item', '{label}: {oldStart} - {oldEnd} yerine {newStart} - {newEnd}', {
                label: item.label || this.t('runtime.app.selection_item_label', 'Seçim {index}', { index: String(i + 1) }),
                oldStart: Utils.formatTime(item.startTime),
                oldEnd: Utils.formatTime(item.endTime),
                newStart: Utils.formatTime(bounds.startTime),
                newEnd: Utils.formatTime(bounds.endTime)
            }));
        }

        const confirmChoice = await window.api.showMessageBox({
            type: 'question',
            title: this.t('runtime.app.lossless_selection_adjusted_title', 'Yeni seçim sınırları'),
            message: this.t('runtime.app.lossless_selection_adjusted_message', 'Tam kayıpsız kopyalama için seçimler aşağıdaki sınırlara genişletilecek:'),
            detail: summaryLines.join('\n'),
            buttons: [
                this.t('runtime.app.lossless_selection_adjusted_accept', 'Bu sınırlarla kaydet'),
                this.t('dialog.common.cancel', 'İptal')
            ],
            defaultId: 0,
            cancelId: 1,
            noLink: true
        });

        if (confirmChoice.response === 1) {
            return { cancelled: true };
        }

        Accessibility.announce(this.t('runtime.app.lossless_selection_adjusted_announce', '{count} seçim keyframe sınırlarına genişletildi.', {
            count: String(adjustedItems.length)
        }));

        return {
            cancelled: false,
            mode: 'lossless-expand',
            items: adjustedItems
        };
    },

    async saveSelectionInteractive(isLossless = false) {
        const itemsOrError = this.getSelectionSaveItems();
        if (!Array.isArray(itemsOrError)) {
            Accessibility.alert(itemsOrError.message);
            return;
        }

        let saveItems = itemsOrError;
        let fastMode = 'smart-exact';

        if (isLossless) {
            const losslessChoice = await this.chooseLosslessSelectionMode(itemsOrError);
            if (losslessChoice.cancelled) {
                return;
            }
            saveItems = losslessChoice.items;
            fastMode = losslessChoice.mode;
        }

        const picked = await this.chooseSelectionSaveTargets(saveItems, isLossless);
        if (picked.cancelled) {
            return;
        }

        await this.saveSelectionBatch(saveItems, picked.targets, {
            isLossless,
            fastMode
        });
    },

    async saveSelectionBatch(items, outputPaths, isLosslessOrOptions = false) {
        const options = typeof isLosslessOrOptions === 'object'
            ? isLosslessOrOptions
            : { isLossless: Boolean(isLosslessOrOptions), fastMode: 'smart-exact' };
        const isLossless = Boolean(options.isLossless);

        if (!Array.isArray(items) || items.length === 0) {
            Accessibility.alert(this.t('runtime.app.select_area_first', 'Önce bir alan seçmelisiniz'));
            return;
        }

        const operationLabel = isLossless
            ? this.t('runtime.app.selection_save_lossless_operation', 'Akıllı hızlı seçim kaydetme')
            : this.t('runtime.app.selection_save_operation', 'Seçim kaydetme');

        this.showProgress(isLossless
            ? this.t('runtime.app.saving_selection_fast', 'Seçim akıllı hızlı kaydediliyor')
            : this.t('runtime.app.saving_selection', 'Seçim kaydediliyor'));
        Accessibility.announce(isLossless
            ? this.t('runtime.app.saving_selection_fast', 'Seçim akıllı hızlı kaydediliyor')
            : this.t('runtime.app.saving_selection', 'Seçim kaydediliyor'));

        try {
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const outputPath = outputPaths[i];

                this.showProgress(items.length > 1
                    ? this.t('runtime.app.saving_selection_batch_progress', 'Kuyruktaki {index}. seçim kaydediliyor. Toplam {count} seçim var.', {
                        index: String(i + 1),
                        count: String(items.length)
                    })
                    : (isLossless
                        ? this.t('runtime.app.saving_selection_fast', 'Seçim akıllı hızlı kaydediliyor')
                        : this.t('runtime.app.saving_selection', 'Seçim kaydediliyor')));

                const result = isLossless
                    ? await window.api.cutVideoFast({
                        inputPath: item.sourcePath,
                        outputPath,
                        startTime: item.startTime,
                        endTime: item.endTime,
                        mode: options.fastMode || 'smart-exact'
                    })
                    : await window.api.cutVideo({
                        inputPath: item.sourcePath,
                        outputPath,
                        startTime: item.startTime,
                        endTime: item.endTime
                    });

                if (!result.success) {
                    throw new Error(result.error || this.t('runtime.common.error', 'Hata: {error}', { error: 'Unknown' }));
                }
            }

            this.hideProgress();
            Accessibility.announceComplete(items.length > 1
                ? this.t('runtime.app.selection_batch_save_operation', '{count} seçim kaydedildi', { count: String(items.length) })
                : operationLabel);
        } catch (error) {
            this.hideProgress();
            Accessibility.announceError(error.message);
        }
    },

    /**
     * IPC event dinleyicilerini kur
     */
    setupIpcListeners() {
        // Yeni proje
        window.api.onFileNew(() => {
            this.newProject();
        });

        // Proje Kaydet/Aç (.kve)
        window.api.onProjectSave(() => {
            this.saveProject();
        });
        window.api.onProjectOpen(() => {
            this.loadProject();
        });
        window.api.onProjectFileOpen((filePath) => {
            this.loadProjectFromPath(filePath);
        });

        // Dosya işlemleri
        window.api.onFileOpen((filePath) => {
            this.openFile(filePath);
        });

        window.api.onFileSave(() => {
            this.saveFile();
        });

        window.api.onFileSaveAs((filePath) => {
            this.saveFileAs(filePath);
        });

        window.api.onFileSaveFast((filePath) => {
            this.saveFileFast(filePath);
        });

        window.api.onFileSaveSelection((filePath) => {
            this.saveSelection(filePath);
        });
        window.api.onFileSaveSelectionRequest(() => {
            this.saveSelectionInteractive(false);
        });
        window.api.onFileSaveSelectionFastRequest(() => {
            this.saveSelectionInteractive(true);
        });

        window.api.onExportVideoOnly((filePath) => {
            this.exportVideoOnly(filePath);
        });

        window.api.onExportAudioOnly((filePath) => {
            this.exportAudioOnly(filePath);
        });

        // Düzenleme işlemleri
        window.api.onEditUndo(() => this.undo());
        window.api.onEditRedo(() => this.redo());
        window.api.onEditCut(() => this.cut());
        window.api.onEditCopy(() => this.copy());
        window.api.onEditPaste(() => this.paste());
        window.api.onEditDelete(() => this.delete());
        window.api.onEditSplit(() => this.split());

        // Seçim işlemleri
        window.api.onSelectAll(() => Selection.selectAll());
        window.api.onSelectClear(() => Selection.clear());
        window.api.onSelectRangeDialog(() => Dialogs.showRangeDialog());
        window.api.onSelectBetweenMarkers(() => Selection.selectBetweenMarkers());
        window.api.onShowSpeedDialog(() => Dialogs.showSpeedDialog());

        // Ekleme işlemleri
        window.api.onInsertAudio((filePath) => {
            if (!VideoPlayer.hasVideo()) {
                Accessibility.alert(this.t('runtime.app.open_video_first', 'Önce bir video açmalısınız'));
                return;
            }
            Dialogs.showAudioAddDialog(filePath);
        });


        window.api.onInsertVideo((filePath) => {
            this.insertVideo(filePath);
        });
        window.api.onVerticalVideoFromSelection(() => {
            this.openVerticalWizardFromSelection();
        });
        window.api.onVerticalVideoQueueAddSelection(() => {
            this.addSelectionToVerticalQueue();
        });
        window.api.onVerticalVideoQueueAddMarkerPairs(() => {
            this.addMarkerPairsToVerticalQueue();
        });
        window.api.onVerticalVideoQueueOpen(() => {
            this.openVerticalWizardFromQueue();
        });
        window.api.onVerticalVideoQueueClear(() => {
            this.clearVerticalClipQueue();
        });
        window.api.onSelectionQueueOpen(() => {
            this.openSelectionQueueDialog();
        });

        // Kaydı bitir ve projeye ekle
        window.api.onAddToTimeline((filePath) => {
            console.log('Kayıt projeye ekleniyor:', filePath);
            // Yeni proje olarak aç (mevcut dosya kapanır)
            this.openFile(filePath);
        });


        // Ses Ekle (Dosya veya Kayıt Seçimi)
        window.api.onInsertAudioRequest(async () => {
            if (!VideoPlayer.hasVideo()) {
                Accessibility.alert(this.t('runtime.app.open_video_first', 'Önce bir video açmalısınız'));
                return;
            }

            // Kullanıcıya seçenek sun: Dosya seç veya Kaydet
            const choice = await window.api.showMessageBox({
                type: 'question',
                title: window.i18nHelper.t('dialog.insert_audio_title') || 'Ses Ekle',
                message: window.i18nHelper.t('dialog.insert_audio_msg') || 'Ses nasıl eklenmesini istersiniz?',
                buttons: [
                    window.i18nHelper.t('dialog.select_file') || 'Dosya Seç',
                    window.i18nHelper.t('dialog.record') || 'Kayıt Yap',
                    window.i18nHelper.t('dialog.cancel') || 'İptal'
                ],
                defaultId: 0,
                cancelId: 2
            });

            if (choice.response === 0) {
                // Dosya seç
                const result = await window.api.openFileDialog({
                    title: this.t('runtime.app.select_audio_file', 'Ses Dosyası Seç'),
                    filters: [
                        { name: 'Ses Dosyaları', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma'] },
                        { name: 'Tüm Dosyalar', extensions: ['*'] }
                    ],
                    properties: ['openFile']
                });

                console.log('File dialog result:', result);

                if (result && !result.canceled && result.filePaths && result.filePaths.length > 0) {
                    const audioPath = result.filePaths[0];
                    console.log('Selected audio path:', audioPath);

                    if (audioPath) {
                        await Dialogs.showAudioAddDialog(audioPath);
                    } else {
                        console.error('Audio path is undefined');
                        Accessibility.alert(this.t('runtime.app.audio_file_not_selected', 'Ses dosyası seçilemedi'));
                    }
                } else {
                    console.log('No file selected or dialog canceled');
                }
            } else if (choice.response === 1) {
                // Kayıt yap
                Dialogs.showAudioRecorderDialog();
            }
        });


        window.api.onInsertTextDialog(async () => {
            if (!VideoPlayer.hasVideo()) {
                Accessibility.alert(this.t('runtime.app.open_video_first', 'Önce bir video açmalısınız'));
                return;
            }
            // Ayrı pencerede dialog aç
            const startTime = VideoPlayer.getCurrentTime();
            await window.api.openTextOverlayDialog({ startTime, videoPath: this.currentFilePath });
            // Dialog artık kendi içinde listeye ekliyor veya doğrudan uyguluyor
        });

        window.api.onInsertTickerDialog(async () => {
            if (!VideoPlayer.hasVideo()) {
                Accessibility.alert(this.t('runtime.app.open_video_first', 'Open a video first'));
                return;
            }
            const video = VideoPlayer.videoElement;
            await window.api.openVideoTickerDialog({
                projectDuration: VideoPlayer.getDuration(), startTime: VideoPlayer.getTimelineTime(),
                aspectRatio: video && video.videoHeight > video.videoWidth ? '9:16' : '16:9',
                previewMedia: { path: this.currentFilePath, type: 'video', fitMode: 'fit' },
                videoPath: this.currentFilePath
            });
        });

        window.api.onInsertImages((filePaths) => {
            Dialogs.showImagesDialog(filePaths);
        });

        window.api.onOpenImageWizard(() => {
            if (!VideoPlayer.hasVideo()) {
                Accessibility.alert(this.t('runtime.app.open_video_first', 'Önce bir video açmalısınız'));
                return;
            }
            Dialogs.showImageWizard();
        });

        window.api.onInsertSubtitle((filePath) => {
            this.insertSubtitle(filePath);
        });
        window.api.onOpenDescriptionSubtitleEditorRequest(() => {
            window.api.openDescriptionSubtitleEditor({ videoPath: this.currentFilePath || '', userKeymap: Keyboard.getUserKeymap(), navigationStep: Settings.getNavigationStep() });
        });

        // Görünüm işlemleri
        window.api.onRotateVideo((degrees) => {
            this.rotateVideo(degrees);
        });

        // Helper: Video kontrolü yapılabilir mi? (Diyalog açık değilse VE input/liste odaklı değilse)
        const isDialogOpen = () => document.querySelectorAll('dialog[open]').length > 0;
        const canControlVideo = () => !isDialogOpen() && !Keyboard.isInputFocused();

        // Navigasyon işlemleri

        // Video Yolu İsteği (Main Process için)
        window.api.onGetCurrentVideoPath(() => {
            window.api.sendCurrentVideoPath(VideoPlayer.currentFilePath);
        });
        window.api.onGotoNextMarker(() => { if (!isDialogOpen()) Markers.goToNext(); });
        window.api.onGotoPrevMarker(() => { if (!isDialogOpen()) Markers.goToPrevious(); });
        window.api.onGotoSelectionStart(() => { if (!isDialogOpen()) Selection.jumpToStart(); });
        window.api.onGotoSelectionEnd(() => { if (!isDialogOpen()) Selection.jumpToEnd(); });

        // İşaretçi işlemleri
        window.api.onMarkerAdd(() => { if (!isDialogOpen()) Markers.addAtCurrentTime(); });
        window.api.onMarkerDelete(() => { if (!isDialogOpen()) Markers.removeAtCurrentTime(); });
        window.api.onMarkerClearAll(() => { if (!isDialogOpen()) Markers.clearAll(); });
        window.api.onMarkerListDialog(() => {
            if (isDialogOpen()) return;
            // İşaretçi listesi diyaloğu
            const markerList = document.getElementById('marker-list');
            markerList.focus();
            Accessibility.announce(this.t('runtime.app.marker_count', '{count} işaretçi mevcut', {
                count: Markers.getCount()
            }));
        });

        // Yardım
        window.api.onShowShortcuts(() => Dialogs.showShortcutsDialog());
        window.api.onShowKeyboardManager(() => Dialogs.showKeyboardManagerDialog());

        window.api.onShowHelp(() => {
            Dialogs.showHelpDialog();
        });
        window.api.onShowFeedback(() => {
            this.openFeedbackDraft();
        });
        window.api.onShowStartupWelcome(() => {
            window.StartupWelcome?.show?.({ force: true });
        });

        // İnce Ayar diyaloğu
        window.api.onShowFineTuneDialog(() => Dialogs.showFineTuneDialog());

        // FFmpeg ilerleme
        window.api.onFfmpegProgress((data) => {
            this.updateProgress(data.operation, data.percent, data);
        });

        // Uygulama hazır
        window.api.onAppReady((data) => {
            if (data?.appVersion && window.UpdateManager) {
                window.UpdateManager.setCurrentVersion(data.appVersion);
            }
            if (window.UpdateManager) {
                window.UpdateManager.setPortableMode(data?.isPortable === true);
            }
            if (data.accessibilityEnabled) {
                console.log('Erişilebilirlik özellikleri etkin');
            }
        });

        window.api.onNativeMenuState((active) => {
            this.nativeMenuActive = Boolean(active);
            Keyboard.setEnabled(!this.nativeMenuActive);
        });

        // Dosya kapatma isteği
        window.api.onFileCloseRequest(async () => {
            await this.handleFileCloseRequest();
        });

        // Uygulama kapatma isteği
        window.api.onAppQuitRequest(async () => {
            await this.handleAppQuitRequest();
        });

        // Video özellikleri diyaloğu
        window.api.onEditVideoProperties(() => {
            Dialogs.showVideoPropertiesDialog();
        });

        // Boşlukları listele
        window.api.onEditListSilences(() => {
            Dialogs.showSilenceParamsDialog();
        });

        // Sessizliği atla
        window.api.onPlaybackSkipSilence(() => {
            VideoPlayer.skipSilence();
        });

        // Seçimi AI ile betimle
        window.api.onEditDescribeSelection(() => {
            Dialogs.showAIDescriptionDialog();
        });

        // Akıllı Seçim Kontrolü
        window.api.onIntelligentSelection(() => {
            // Gelecek özellik: Seçimi içeriğe göre (sessizlik, sahne değişimi vb.) optimize et
            Accessibility.announce(this.t('runtime.app.intelligent_selection_soon', 'Akıllı seçim kontrolü özelliği yakında eklenecek.'));
            // Veya basit bir işlem:
            const selection = Selection.getSelection();
            if (selection && selection.start !== selection.end) {
                // Seçimi en yakın 1 saniyeye yuvarla (basit "akıllı" davranış)
                let start = Math.round(selection.start);
                let end = Math.round(selection.end);
                if (start === end) end += 1;
                Selection.setSelection(start, end);
                Accessibility.announce(this.t('runtime.app.selection_rounded', 'Seçim tam saniyelere yuvarlandı: {start} - {end}', {
                    start: Utils.formatTime(start),
                    end: Utils.formatTime(end)
                }));
            } else {
                Accessibility.announce(this.t('runtime.app.select_area_first', 'Önce bir alan seçmelisiniz.'));
            }
        });

        // Gemini API anahtarı
        window.api.onEditGeminiApiKey(() => {
            Dialogs.showGeminiApiKeyDialog();
        });

        window.api.onEditOpenAiApiKey(() => {
            Dialogs.showOpenAiApiKeyDialog();
        });

        window.api.onEditElevenLabsApiKey(() => {
            Dialogs.showElevenLabsApiKeyDialog();
        });

        window.api.onShowInstantVoiceTranslation(() => {
            Dialogs.showInstantVoiceTranslationDialog();
        });

        // Bulunduğun konumu betimle (Akıllı 5 Saniye)
        window.api.onAiDescribeCurrentPosition((durationArg) => {
            this.describeCurrentPosition(durationArg);
        });

        // Dosya kapatıldı bildirimi
        window.api.onFileClosed(() => {
            this.closeCurrentFile();
        });

        // Oynatma olayları
        window.api.onPlaybackToggle(() => {
            if (this.shouldSuppressPlaybackShortcuts()) return;
            if (canControlVideo()) VideoPlayer.togglePlay();
        });

        window.api.onPlaybackPauseAtPosition(() => {
            if (this.shouldSuppressPlaybackShortcuts()) return;
            if (isDialogOpen()) return; // Dialog varsa enter ile kapatıyor olabilir, karışma
            // Ancak liste odaklıysa enter seçim yapar, playing durmamalı mı?
            // Pause at position genellikle Enter tuşuna bağlı. Listede Enter seçim yapar.
            // Bu yüzden listedeysek video durmasın (zaten duruyorsa durur).
            // Input/List odaklıysa videoya müdahale etme
            if (!Keyboard.isInputFocused()) {
                VideoPlayer.togglePauseAtCurrentPosition();
            }
        });

        window.api.onPlaybackPlaySelection(() => {
            if (canControlVideo()) VideoPlayer.playSelection();
        });

        window.api.onPlaybackPlayCutPreview(() => {
            if (canControlVideo()) VideoPlayer.playCutPreview();
        });

        window.api.onSeekForward((seconds) => {
            if (canControlVideo()) VideoPlayer.seekRelative(seconds);
        });

        window.api.onSeekBackward((seconds) => {
            if (canControlVideo()) VideoPlayer.seekRelative(-seconds);
        });

        window.api.onGotoStart(() => {
            if (isDialogOpen()) return; // Home tuşu inputlarda başa gider, engelle
            if (Keyboard.isInputFocused()) return;
            VideoPlayer.goToStart();
        });

        window.api.onGotoEnd(() => {
            if (isDialogOpen()) return;
            if (Keyboard.isInputFocused()) return; // End tuşu inputlarda sona gider
            VideoPlayer.goToEnd();
        });

        window.api.onGotoMiddle(() => {
            if (isDialogOpen()) return;
            VideoPlayer.goToMiddle();
        });

        window.api.onGotoBeforeEnd(() => {
            if (isDialogOpen()) return;
            VideoPlayer.goToBeforeEnd();
        });

        window.api.onGotoTimeDialog(() => {
            Dialogs.showGotoDialog();
        });

        // Klavye kontrolü (dialog penceresi açıldığında)
        window.api.onKeyboardDisable(() => {
            console.log('Klavye devre dışı bırakıldı (dialog açık)');
            Keyboard.setEnabled(false);
            // VideoPlayer.pause(); // İPTAL: Önizleme yapan dialoglar (Audio Settings) için otomatik durdurma sorun oluyor. Dialog kendisi yönetmeli.
        });

        window.api.onKeyboardEnable(() => {
            console.log('Klavye etkinleştirildi (dialog kapalı)');
            Keyboard.setEnabled(true);
        });

        // Ekleme listesi olayları
        window.api.onInsertionQueueAdd((data) => {
            console.log('Ekleme listesine ekleniyor:', data);
            InsertionQueue.addItem(data.type, data.options);
            Accessibility.announce(this.t('runtime.app.queue_item_added', '{type} listeye eklendi. Toplam: {count} öğe', {
                type: data.type === 'text'
                    ? this.t('runtime.app.queue_item_text', 'Text')
                    : (data.type === 'ticker'
                        ? this.t('runtime.app.queue_item_ticker', 'Ticker')
                        : this.t('runtime.app.queue_item_audio', 'Audio')),
                count: InsertionQueue.getCount()
            }));
        });

        window.api.onInsertionQueueUpdate((data) => {
            console.log('Ekleme listesi güncelleniyor:', data);
            InsertionQueue.updateItem(data.id, data.options);
            Accessibility.announce(this.t('runtime.app.queue_item_updated', 'Öğe güncellendi'));
        });

        window.api.onShowInsertionQueue(() => {
            Dialogs.showInsertionQueueDialog();
        });

        // === GEÇİŞ İŞLEMLERİ ===
        window.api.onShowTransitionLibrary(() => {
            if (!isDialogOpen()) Dialogs.showTransitionLibraryDialog();
        });

        window.api.onApplyActiveTransition(() => {
            if (!isDialogOpen()) Transitions.applyAtCurrentTime();
        });

        window.api.onApplyTransitionToMarkers(() => {
            if (!isDialogOpen()) Transitions.applyToAllMarkers();
        });

        window.api.onShowTransitionList(() => {
            if (!isDialogOpen()) Dialogs.showTransitionListDialog();
        });

        window.api.onApplyAllTransitions(() => {
            if (!isDialogOpen()) this.applyAllTransitions();
        });

        // Yazı doğrudan videoya ekle (liste kullanmadan)
        window.api.onTextOverlayDirectApply(async (options) => {
            console.log('Yazı doğrudan videoya ekleniyor:', options);
            await this.addTextToVideo(options);
        });

        window.api.onTickerOverlayDirectApply(async (options) => {
            await this.addTickerToVideo(options);
        });

        // Video yolu isteği (Gemini için)

        // === VIDEO KATMANI (Picture-in-Picture) ===
        window.api.onOpenVideoLayerWizard((filePath) => {
            if (!VideoPlayer.hasVideo()) {
                Accessibility.alert(this.t('runtime.app.open_video_first', 'Önce bir video açmalısınız'));
                return;
            }
            Dialogs.showVideoLayerWizard(filePath);
        });

        // CTA Library
        window.api.onShowCtaLibrary(() => {
            if (!VideoPlayer.hasVideo()) {
                Accessibility.alert(this.t('runtime.app.open_video_first', 'Önce bir video açmalısınız'));
                return;
            }
            Dialogs.showCtaLibraryDialog();
        });
    },

    /**
     * Video oynatıcısından gelen dönüştürme hatası işleyicisi
     * @param {string} filePath - Sorunlu dosya
     * @param {string} errorMessage - Hata mesajı
     */
    async handleVideoConversionNeeded(filePath, errorMessage) {
        console.log('Video oynatma hatası (conversion needed):', errorMessage);

        // Dosya açma işlemi sürüyorsa müdahale etme
        if (this.isOpeningFile) {
            console.log('Dosya açma işlemi sürüyor, hata yutuldu.');
            return;
        }

        // Eğer zaten şu an bir dosya açma/dönüştürme işlemi içindeysek (progress açıksa)
        // müdahale etme.
        if (document.getElementById('progress-overlay') &&
            !document.getElementById('progress-overlay').classList.contains('hidden')) {
            return;
        }

        // Eğer zaten dönüştürülmüş bir dosya kullanıyorsak ve yine hata alıyorsak
        if (this.currentFilePath && this.originalFilePath &&
            this.currentFilePath !== this.originalFilePath) {
            console.warn('Dönüştürülmüş video da hata verdi:', this.currentFilePath);
            Accessibility.announceError(this.t('runtime.app.playback_error', 'Video oynatma hatası: {error}', { error: errorMessage }));
            return;
        }

        // Kullanıcıya sor
        const confirmed = await Dialogs.showAccessibleConfirm(
            window.i18nHelper.t('dialog.playback_error_title') || 'Oynatma Hatası',
            (window.i18nHelper.t('dialog.playback_error_msg') || 'Video oynatılırken bir sorun oluştu ({error}). Formatı tamir etmek için dönüştürmek ister misiniz?').replace('{error}', errorMessage)
        );

        if (confirmed) {
            const inputPath = this.originalFilePath || filePath;
            const tempPath = await window.api.getTempPath(`repair_${Date.now()}.mp4`);

            this.showProgress(this.t('runtime.app.repairing_video', 'Video onarılıyor...'));

            const result = await window.api.convertVideo({
                inputPath: inputPath,
                outputPath: tempPath,
                options: { codec: 'h264', fps: 'original' }
            });

            this.hideProgress();

            if (result.success) {
                this.currentFilePath = tempPath;
                if (!this.originalFilePath) this.originalFilePath = filePath;

                await VideoPlayer.loadVideo(tempPath);
                Accessibility.announce(this.t('runtime.app.video_repaired_reloaded', 'Video onarıldı ve tekrar yüklendi.'));
            } else {
                Accessibility.announceError(this.t('runtime.app.repair_failed', 'Onarım başarısız: {error}', {
                    error: localizeMediaError(result.error)
                }));
            }
        }
    },

    /**
     * Dosya aç
     * @param {string} filePath
     */
    /**
     * Dosya aç (Wrapper)
     * @param {string} filePath
     * @param {boolean} resetUI - UI ve state sıfırlansın mı? (Proje yüklerken false)
     */
    async openFile(filePath, resetUI = true) {
        if (this.isOpeningFile) {
            console.warn('Dosya açma işlemi zaten sürüyor.');
            return;
        }

        // Eğer dosya yolu yoksa, diyalog aç
        if (!filePath) {
            const result = await window.api.openFileDialog({
                title: this.t('messages.open_video', 'Video Dosyası Aç'),
                filters: [
                    { name: this.t('messages.media_files_filter', 'Medya Dosyaları'), extensions: ['mp4', 'wmv', 'avi', 'mkv', 'mov', 'webm', 'flv', '3gp', 'mpg', 'mpeg', 'vob', 'm4v', 'ts', 'mts', 'm2ts', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'wma'] },
                    { name: this.t('runtime.app.video_files_filter', 'Video Dosyaları'), extensions: ['mp4', 'wmv', 'avi', 'mkv', 'mov', 'webm', 'flv', '3gp', 'mpg', 'mpeg', 'vob', 'm4v', 'ts', 'mts', 'm2ts'] },
                    { name: this.t('dialog.sync.audio_files_filter', 'Ses Dosyaları'), extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'wma'] },
                    { name: this.t('dialog.common.all_files', 'Tüm Dosyalar'), extensions: ['*'] }
                ],
                properties: ['openFile']
            });

            console.log('Dosya aç diyaloğu sonucu:', result);

            if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
                return;
            }
            filePath = result.filePaths[0];
        }

        console.log('Dosya açma başlatılıyor:', filePath);
        this.isOpeningFile = true;
        try {
            await this._openFileInternal(filePath, resetUI);
        } catch (error) {
            console.error('Dosya açma hatası:', error);
            Accessibility.announceError(this.t('runtime.app.file_open_error', 'Dosya açılırken bir hata oluştu'));
        } finally {
            this.isOpeningFile = false;
        }
    },
    /**
     * Dosya aç (Internal) - Akıllı Media Compatibility Sistemi
     * @param {string} filePath
     * @param {boolean} resetUI
     */
    async _openFileInternal(filePath, resetUI = true) {
        console.log('İç dosya açma akışı başladı:', filePath, 'resetUI=', resetUI);
        const localizeMediaError = (message) => message === 'primary_video_stream_missing'
            ? this.t('runtime.app.primary_video_stream_missing', 'Dosyada açılabilir bir ana video akışı bulunamadı.')
            : message;
        // Media compatibility status listener'ı kur
        const statusHandler = (status) => {
            console.log('Media Compat Status:', status);

            switch (status.status) {
                case 'analyzing':
                    Accessibility.announce(this.t('runtime.app.analyzing_file', 'Dosya analiz ediliyor...'));
                    break;
                case 'remuxing':
                    this.showProgress(this.t('runtime.app.fast_remux_progress', 'Hızlı format dönüşümü yapılıyor (kalite kaybı yok)'));
                    Accessibility.announce(status.message || this.t('runtime.app.fast_remux_started', 'Hızlı dönüşüm başladı'));
                    break;
                case 'transcoding':
                    this.showProgress(this.t('runtime.app.converting_video', 'Video dönüştürülüyor...'));
                    Accessibility.announce(status.message || this.t('runtime.app.conversion_started', 'Dönüştürme başladı'));
                    if (status.estimatedTime) {
                        Accessibility.announce(this.t('runtime.app.estimated_time_seconds', 'Tahmini süre: {seconds} saniye', {
                            seconds: Math.ceil(status.estimatedTime)
                        }));
                    }
                    break;
                case 'ready':
                    this.hideProgress();
                    break;
                case 'error':
                    this.hideProgress();
                    Accessibility.announceError(localizeMediaError(status.message) || this.t('runtime.app.generic_error', 'Bir hata oluştu'));
                    break;
            }
        };

        // Progress listener'ı kur
        const progressHandler = (progress) => {
            if (progress && progress.percent !== undefined) {
                let message = '';
                if (progress.stage === 'remux') {
                    message = this.t('runtime.app.fast_remux_operation', 'Hızlı dönüşüm');
                } else if (progress.stage === 'transcode') {
                    message = this.t('runtime.app.conversion_operation', 'Dönüştürme');
                }
                this.updateProgress(message, progress.percent);
            }
        };

        // Event listener'ları kaydet
        window.api.onMediaCompatStatus(statusHandler);
        window.api.onMediaCompatProgress(progressHandler);

        try {
            // Akıllı dosya açma - otomatik olarak en uygun stratejiyi seçer
            console.log('smartOpenVideo çağrılıyor:', filePath);
            const result = await window.api.smartOpenVideo(filePath);
            console.log('smartOpenVideo sonucu:', result);

            // Event listener'ları temizle
            window.api.removeAllListeners('media-compat-status');
            window.api.removeAllListeners('media-compat-progress');
            this.hideProgress();

            if (!result.success) {
                Accessibility.announceError(this.t('runtime.app.video_open_failed', 'Video açılamadı: {error}', {
                    error: localizeMediaError(result.error)
                }));
                return;
            }

            // Strateji bilgisini logla
            console.log('Video açıldı:', result.strategy, result.playbackPath);

            // Stratejiye göre kullanıcıya bilgi ver
            let strategyMessage = '';
            switch (result.strategy) {
                case 'DIRECT_PLAY':
                    strategyMessage = this.t('runtime.app.strategy_direct', 'Doğrudan açıldı');
                    break;
                case 'QUICK_REMUX':
                    strategyMessage = result.cached
                        ? this.t('runtime.app.strategy_fast_cache', 'Önbellekten hızlı açıldı')
                        : this.t('runtime.app.strategy_fast_remux', 'Hızlı dönüşüm yapıldı (kalite kaybı yok)');
                    break;
                case 'TRANSCODE':
                    strategyMessage = result.cached
                        ? this.t('runtime.app.strategy_cache', 'Önbellekten açıldı')
                        : this.t('runtime.app.strategy_conversion_done', 'Dönüştürme tamamlandı');
                    break;
            }

            const playbackPath = result.playbackPath;
            const probe = result.probe;

            // Video yükle
            try {
                await VideoPlayer.loadVideo(playbackPath);
            } catch (error) {
                console.error('Video yükleme hatası:', error);
                Accessibility.announceError(this.t('runtime.app.video_player_load_failed', 'Video oynatıcıya yüklenemedi'));
                return;
            }

            const loadedMetadata = VideoPlayer.metadata;
            const duration = loadedMetadata ? loadedMetadata.duration : 0;

            if (duration <= 0) {
                console.error('Video süresi alınamadı!');
                Accessibility.alert(this.t('runtime.app.video_open_failed_short', 'Video açılamadı'));
                return;
            }

            // TabManager ile sekme oluştur
            const convertedPath = playbackPath !== filePath ? playbackPath : null;
            const tab = await TabManager.createTabFromFile(filePath, loadedMetadata, duration, convertedPath);
            if (!tab) return; // Zaten açık veya limit aşıldı

            // Eğer dönüştürme yapıldıysa, TabManager'a kaydet
            if (convertedPath) {
                tab.originalPath = filePath;
            }

            // App state'i güncelle
            this.currentFilePath = playbackPath;
            this.originalFilePath = filePath;
            this.hasChanges = false;
            window.api.addRecentFile?.(filePath).catch(() => {});

            // Timeline'ı sekmedeki ile senkronize et
            Timeline.segments = tab.timeline.segments.map(s => ({ ...s }));
            Timeline.sourceFile = playbackPath;
            Timeline.hasChanges = false;
            Timeline.renderVisuals();

            // İşaretçileri ve seçimi temizle (Sadece yeni dosya açarken)
            if (resetUI) {
                Markers.clearAll();
                Selection.clear(true);
                this.clearVerticalClipQueue(false);
            }

            // Dosya bilgilerini hazırla
            const durationStr = Utils.formatTime(loadedMetadata.duration);
            const resolution = loadedMetadata.width && loadedMetadata.height
                ? `${loadedMetadata.width}x${loadedMetadata.height}`
                : '';

            // Video yönünü belirle
            let orientation = '';
            // Fix: Rotasyon varsa ve width > height ise bile DİKEY kabul edelim mi?
            // Hayır, getVideoMetadata zaten swap yapıyor. Eğer yapmıyorsa, manuel kontrol ekleyelim.
            // Ayrıca smartOpenVideo'dan gelen probe.rotation'a da bakabiliriz.

            // Eğer boyutlar swap edilmemişse ama rotasyon varsa, manuel düzeltme
            let finalWidth = loadedMetadata.width;
            let finalHeight = loadedMetadata.height;
            const rotation = loadedMetadata.rotation || 0;

            if ((Math.abs(rotation) === 90 || Math.abs(rotation) === 270) && finalWidth > finalHeight) {
                // Metadata swap yapmamış ama rotasyon var -> Swap
                const temp = finalWidth;
                finalWidth = finalHeight;
                finalHeight = temp;
            }

            if (finalWidth && finalHeight) {
                if (finalWidth > finalHeight) {
                    orientation = this.t('runtime.video_player.orientation_landscape', 'Landscape');
                } else if (finalWidth < finalHeight) {
                    orientation = this.t('runtime.video_player.orientation_portrait', 'Portrait');
                } else {
                    orientation = this.t('runtime.video_player.orientation_square', 'Square');
                }
            }

            // Dosya adını probe veya path'den al
            const filename = probe?.filePath
                ? probe.filePath.split(/[\\/]/).pop()
                : filePath.split(/[\\/]/).pop();

            const fileInfo = [
                this.t('runtime.app.file_opened', '{filename} opened', { filename }),
                strategyMessage,
                this.t('runtime.app.meta_duration', 'Duration: {value}', { value: durationStr }),
                resolution ? this.t('runtime.app.meta_resolution', 'Resolution: {value}', { value: resolution }) : '',
                orientation ? this.t('runtime.app.meta_orientation', 'Orientation: {value}', { value: orientation }) : '',
                loadedMetadata.frameRate ? this.t('runtime.app.meta_fps', 'FPS: {value}', {
                    value: typeof loadedMetadata.frameRate === 'number' ? loadedMetadata.frameRate.toFixed(2) : loadedMetadata.frameRate
                }) : '',
                loadedMetadata.bitrate ? this.t('runtime.app.meta_bitrate', 'Bitrate: {value} Mbps', {
                    value: (loadedMetadata.bitrate / 1000000).toFixed(1)
                }) : '',
                loadedMetadata.codec ? this.t('runtime.app.meta_codec', 'Codec: {value}', { value: loadedMetadata.codec }) : '',
                loadedMetadata.size && !isNaN(loadedMetadata.size) ? this.t('runtime.app.meta_size', 'Size: {value}', {
                    value: Utils.formatFileSize(loadedMetadata.size)
                }) : ''
            ].filter(x => x).join('. ');



            // Eğer zaten aynı dosya açıksa (reload/re-open durumu) sadece kısa bilgi ver
            if (this._lastLoadedPath === filePath) {
                Accessibility.announceImmediate(this.t('runtime.app.video_reloaded', 'Video reloaded. {message}', {
                    message: strategyMessage
                }));
            } else {
                // Yeni dosya - Detaylı bilgi
                Accessibility.announceImmediate(fileInfo);
            }

            // Son yüklenen dosya yolunu sakla
            this._lastLoadedPath = filePath;

        } catch (error) {
            console.error('Dosya açma hatası:', error);
            window.api.removeAllListeners('media-compat-status');
            window.api.removeAllListeners('media-compat-progress');
            this.hideProgress();
            Accessibility.announceError(this.t('runtime.app.file_open_error', 'An error occurred while opening the file'));
        }
    },

    async openFeedbackDraft() {
        const choice = await Dialogs.showAccessibleChoice({
            title: this.t('feedback.dialog.title', 'Geri Bildirim Gonder'),
            message: this.t(
                'feedback.dialog.message',
                'Bir e-posta taslagi acilacak. Isterseniz tanı bilgilerini ve son oturum log ozetini de ekleyebiliriz. Bunlar dosya yolları ve sistem bilgileri gibi size ozel veriler icerebilir.'
            ),
            buttons: [
                this.t('feedback.dialog.include_diagnostics', 'Tani Bilgilerini Ekle'),
                this.t('feedback.dialog.email_only', 'Sadece E-posta Taslagi'),
                this.t('dialog.cancel', 'Iptal')
            ],
            cancelValue: -1,
            focusIndex: 0,
            detailsLabel: this.t('feedback.dialog.details_label', 'Neler eklenecek?'),
            details: this.t(
                'feedback.dialog.details',
                'Tani bilgileri acik dosya yolunu, uygulama surumunu, sistem bilgisini ve son log satirlarini icerebilir.'
            )
        });

        if (choice === -1 || choice === 2) {
            Accessibility.announce(this.t('feedback.runtime.cancelled', 'Geri bildirim islemi iptal edildi.'));
            return;
        }

        const result = await window.api.createFeedbackDraft({
            includeDiagnostics: choice === 0,
            currentFilePath: this.currentFilePath || ''
        });

        if (result?.success) {
            Accessibility.announce(
                result.includedDiagnostics
                    ? this.t('feedback.runtime.opened_with_diagnostics', 'E-posta taslagi tanı bilgileriyle acildi.')
                    : this.t('feedback.runtime.opened_basic', 'E-posta taslagi acildi.')
            );
            return;
        }

        Accessibility.announceError(this.t('feedback.runtime.failed', 'Geri bildirim e-postasi acilamadi: {error}', {
            error: result?.error || this.t('recording.unknown_error', 'Bilinmeyen hata')
        }));
    },

    /**
     * Video oynatma hatası durumunda dönüştürme öner
     * @param {string} filePath - Hata veren video dosyası
     * @param {string} errorMessage - Hata mesajı
     */
    async handleVideoConversionNeeded(filePath, errorMessage) {
        if (!filePath) {
            console.error('Dönüştürme için dosya yolu yok');
            return;
        }

        // Dönüştürme öner (erişilebilir dialog)
        const runtimeErrorMessage = this.t(
            'runtime.app.convert_prompt',
            '{error}. Videoyu MP4 (H.264) formatına dönüştürmek ister misiniz?',
            { error: errorMessage }
        );
        const shouldConvert = await Dialogs.showAccessibleConfirm(
            this.t('runtime.app.video_unplayable_title', 'Video Oynatılamıyor'),
            runtimeErrorMessage
        );

        if (shouldConvert) {
            const ext = filePath.split('.').pop().toLowerCase();
            const tempPath = await window.api.getTempPath(`converted_${Date.now()}.mp4`);

            this.showProgress(this.t('runtime.app.converting_video_short', 'Video dönüştürülüyor'));
            Accessibility.announce(this.t('runtime.app.converting_video_wait', 'Video dönüştürülüyor, lütfen bekleyin'));

            const convertResult = await window.api.convertVideo({
                inputPath: filePath,
                outputPath: tempPath,
                options: { codec: 'h264', fps: 'original' }
            });

            this.hideProgress();

            if (convertResult.success) {
                Accessibility.announceImmediate(this.t('runtime.app.conversion_reopening', 'Dönüştürme tamamlandı, video yeniden açılıyor'));

                // Mevcut sekmeyi güncelle (varsa)
                const activeTab = TabManager.getActiveTab();
                if (activeTab) {
                    activeTab.convertedPath = tempPath;
                    activeTab.originalPath = filePath;
                }

                // Dönüştürülmüş videoyu yükle
                await VideoPlayer.loadVideo(tempPath);
                this.currentFilePath = tempPath;
                Timeline.sourceFile = tempPath;

                Accessibility.announce(this.t('runtime.app.video_ready', 'Video hazır'));
            } else {
                Accessibility.announceError(this.t('runtime.app.conversion_error', 'Dönüştürme hatası: {error}', {
                    error: convertResult.error
                }));
            }
        }
    },

    /**
     * Yeni boş proje oluştur
     */
    newProject() {
        const tab = TabManager.createNewProject();
        if (!tab) return;

        // App state'i temizle
        this.currentFilePath = null;
        this.originalFilePath = null;
        this.hasChanges = false;

        // Timeline'ı temizle
        Timeline.segments = [];
        Timeline.sourceFile = null;
        Timeline.hasChanges = false;
        Timeline.renderVisuals();

        // Diğer modülleri temizle
        Markers.clearAll();
        Selection.clear(true);
        this.clearVerticalClipQueue(false);
        VideoPlayer.showEmptyState();

        // UI güncelle
        document.getElementById('file-name').textContent = this.t('runtime.app.new_project', 'Yeni Proje');
        document.getElementById('total-duration').textContent = '00:00:00.000';
    },

    /**
     * Sekmeyi kapatma onayı ile kapat
     * @param {number} index - Sekme indeksi
     */
    async closeTabWithConfirm(index) {
        if (index < 0 || index >= TabManager.tabs.length) return;

        const tab = TabManager.tabs[index];

        if (tab.hasChanges) {
            const result = await window.api.showSaveConfirm(
                this.t('runtime.app.save_question_title', 'Kaydet?'),
                this.t('runtime.app.tab_unsaved_changes', '"{name}" dosyasında kaydedilmemiş değişiklikler var. Kaydetmek istiyor musunuz?', {
                    name: tab.name
                })
            );

            if (result === 0) { // Kaydet
                // Önce o sekmeye geç
                TabManager.switchToTab(index);
                await this.saveFile();
                TabManager.forceCloseTab(index);
            } else if (result === 1) { // Kaydetme
                TabManager.forceCloseTab(index);
            }
            // result === 2 ise İptal - hiçbir şey yapma
        } else {
            TabManager.forceCloseTab(index);
        }
    },

    /**
     * Dosya kaydet (Timeline segment'lerini dışa aktar)
     */
    async saveFile() {
        console.log('SaveFile tetiklendi');

        // Yeni proje veya segment varsa kaydet
        if (Timeline.segments.length === 0) {
            Accessibility.alert(this.t('runtime.app.nothing_to_save', 'Kaydedilecek içerik yok'));
            return;
        }

        // Eğer currentFilePath yoksa (yeni proje), farklı kaydet diyaloğu göster
        if (!this.currentFilePath) {
            console.log('Dosya kayıtlı değil, Save As diyaloğu açılıyor');
            const result = await window.api.showSaveDialog({
                title: this.t('runtime.app.save_project_title', 'Projeyi Kaydet'),
                defaultPath: 'yeni_video.mp4',
                filters: [
                    { name: this.t('runtime.app.video_files_filter', 'Video Dosyaları'), extensions: ['mp4'] }
                ]
            });

            if (result && !result.canceled && result.filePath) {
                await this.exportTimeline(result.filePath);
                this.currentFilePath = result.filePath;

                // Tab bilgilerini güncelle
                const activeTab = TabManager.getActiveTab();
                if (activeTab) {
                    activeTab.filePath = result.filePath;
                    activeTab.name = result.filePath.split(/[\\/]/).pop();
                    activeTab.hasChanges = false;
                    TabManager.updateTabBar();
                }
            }
            return;
        }

        // CTA overlay sayısı da değişiklik olarak sayılır
        const ctaCount = typeof CtaOverlayPreview !== 'undefined'
            ? CtaOverlayPreview.getOverlayCount()
            : 0;



        console.log('Save Check:', {
            timelineChanges: Timeline.hasChanges,
            ctaCount,

        });

        if (!Timeline.hasChanges && ctaCount === 0) {
            console.log('Değişiklik bulunamadı, kaydetme atlandı');
            Accessibility.announce(this.t('runtime.app.no_changes_skip_save', 'Değişiklik yok, kaydetme atlandı'));
            return;
        }

        console.log('Değişiklikler bulundu, exportTimeline çağrılıyor...');

        // Orijinal dosyanın üzerine yazma - önce farklı bir dosyaya kaydet
        const outputPath = this.originalFilePath.replace(/\.([^.]+)$/, '_saved.$1');
        await this.exportTimeline(outputPath);
    },


    /**
     * Farklı kaydet
     * @param {string} filePath
     */
    async saveFileAs(filePath) {
        if (!VideoPlayer.hasVideo()) return;

        if (!filePath) {
            const result = await window.api.showSaveDialog({
                title: 'Farklı Kaydet',
                defaultPath: this.currentFilePath ? this.currentFilePath.split(/[\\/]/).pop() : 'video.mp4',
                filters: [
                    { name: 'Video Dosyaları', extensions: ['mp4'] }
                ]
            });
            if (result.canceled || !result.filePath) return;
            filePath = result.filePath;
        }

        await this.exportTimeline(filePath);
    },

    /**
     * Hızlı Dışa Aktar (Smart Cut Mode)
     * @param {string} filePath
     */
    async saveFileFast(filePath) {
        if (!VideoPlayer.hasVideo()) return;

        // Geçiş kontrolü - Kullanıcı isteği üzerine engellendi
        if (typeof Transitions !== 'undefined' && Transitions.getCount() > 0) {
            Accessibility.announceError(this.t('runtime.app.fast_export_transition_short', 'Geçiş efektleri var, Hızlı Dışa Aktar kullanılamaz.'));
            await window.api.showError({
                title: this.t('runtime.app.operation_unavailable', 'İşlem Yapılamıyor'),
                message: this.t('runtime.app.fast_export_transition_error', 'Projenizde geçiş efektleri (Transitions) bulunmaktadır. "Hızlı Dışa Aktar" özelliği geçiş efektleriyle uyumlu değildir. Lütfen "Videoyu Farklı Kaydet" seçeneğini kullanın.')
            });
            return;
        }

        if (!filePath) return;
        console.log('Hızlı Dışa Aktar (Smart Cut) başlatılıyor...');
        await this.exportTimeline(filePath, { forceSmartCut: true });
    },

    /**
     * Timeline segment'lerini video olarak dışa aktar
     * Kesimler kesin (re-encode), birleştirme hızlı (stream copy)
     * @param {string} outputPath - Çıktı dosya yolu
     */
    async exportTimeline(outputPath, options = {}) {
        const segments = Timeline.getSegments();

        if (segments.length === 0) {
            Accessibility.alert(this.t('runtime.app.nothing_to_export', 'Dışa aktarılacak içerik yok'));
            return;
        }

        this.showProgress(this.t('runtime.app.exporting_video', 'Video dışa aktarılıyor'));
        Accessibility.announce(this.t('runtime.app.exporting_video', 'Video dışa aktarılıyor'));

        try {
            // CTA overlay sayısı
            const ctaCount = typeof CtaOverlayPreview !== 'undefined'
                ? CtaOverlayPreview.getOverlayCount()
                : 0;

            console.log('Export başlıyor. CTA sayısı:', ctaCount);

            let safeRenderMode = false;
            if (ctaCount > 0) {
                const meta = VideoPlayer.metadata || { width: 0, height: 0 };
                console.log('Safe Render Check - Meta:', meta, 'CTA Count:', ctaCount);

                // V90: Piksel sayısına göre kontrol (yatay/dikey fark etmez)
                // 2K (2560x1440) = ~3.7 milyon piksel
                // 4K (3840x2160) = ~8.3 milyon piksel
                // 1080p (1920x1080 veya 1080x1920) = ~2 milyon piksel (uyarı YOK)
                const totalPixels = (meta.width || 0) * (meta.height || 0);
                const isHighRes = totalPixels >= 3500000; // 3.5M+ piksel (2K ve üzeri)

                // FFmpeg (Lavf) tarafından oluşturulmuş
                const isConvertedByFfmpeg = meta.encoder && meta.encoder.toLowerCase().includes('lavf');

                // Zaten dönüştürülmüş/onarılmış dosya mı?
                const isSafeFile = this.currentFilePath &&
                    (this.currentFilePath.includes('converted') ||
                        this.currentFilePath.includes('repaired') ||
                        isConvertedByFfmpeg ||
                        (this.originalFilePath && this.currentFilePath !== this.originalFilePath));

                console.log('Safe Render Status:', { isHighRes, isSafeFile, encoder: meta.encoder });

                // Sadece Yüksek Çözünürlüklü VE Orijinal/Güvensiz dosya ise uyar
                if (isHighRes && !isSafeFile) {
                    this.hideProgress();
                    const confirmed = await Dialogs.showAccessibleConfirm(
                        this.t('runtime.app.safe_render_warning_title', 'Güvenli Render Uyarısı'),
                        this.t('runtime.app.safe_render_warning_message', 'Yüksek çözünürlüklü ve ham videolarda bindirme (Overlay) işlemi öncesinde, sistem kararlılığı için Safe Render (Tam Yeniden Kodlama) önerilir. Bu işlem daha uzun sürer ancak donmaları engeller. Güvenli Render kullanılsın mı?')
                    );

                    if (confirmed) {
                        safeRenderMode = true;
                        Accessibility.announce(this.t('runtime.app.safe_render_enabled', 'Güvenli render modu etkinleştirildi.'));
                    } else {
                        Accessibility.announce(this.t('runtime.app.standard_render_continue', 'Standart render ile devam ediliyor.'));
                    }
                    this.showProgress(this.t('runtime.app.exporting_video', 'Video dışa aktarılıyor'));
                } else if (isSafeFile) {
                    console.log('Dosya zaten güvenli/dönüştürülmüş (Lavf/Converted), Safe Render uyarısı atlandı.');
                    // Varsayılan olarak safeRenderMode = false (Smart Cut) devam eder.
                    // Kullanıcı "Mevcuta işlem yapmalı" dediği için re-encode zorlamıyoruz.
                }
            }

            console.log('CtaOverlayPreview tanımlı mı?', typeof CtaOverlayPreview !== 'undefined');
            if (typeof CtaOverlayPreview !== 'undefined') {
                console.log('Timeline overlays:', CtaOverlayPreview.getTimelineOverlays());
            }

            // Eğer tek segment varsa, değişiklik yoksa VE CTA yoksa, sadece kopyala
            if (segments.length === 1 &&
                segments[0].start === 0 &&
                segments[0].end === Timeline.sourceDuration &&
                !segments[0].sourceFile &&
                (segments[0].speed === undefined || segments[0].speed === 1.0) &&
                ctaCount === 0) {
                // Değişiklik yok, dosya kopyala
                const sourceFile = this.originalFilePath || this.currentFilePath;
                await window.api.copyFile(sourceFile, outputPath);
                this.hideProgress();
                Accessibility.announceComplete(this.t('runtime.app.file_copied_unchanged', 'Dosya kopyalandı (değişiklik yok)'));
                if (Utils && Utils.playSound) Utils.playSound('success');
                return;
            }

            // V88 OPTIMIZATION: Sadece CTA varsa ve timeline değişikliği yoksa, render'ı atla
            // V91: Koşullar iyileştirildi - sourceDuration=0 ve sourceFile durumları ele alındı

            const seg = segments[0];
            const origFile = this.originalFilePath || this.currentFilePath;

            // sourceDuration 0 ise, segment süresini referans al
            const effectiveSourceDuration = Timeline.sourceDuration > 0
                ? Timeline.sourceDuration
                : (seg?.end || 0);

            // Süre farkı kontrolü (0.5 saniye tolerans)
            const durationMatches = seg && Math.abs(seg.end - effectiveSourceDuration) < 0.5;

            // sourceFile kontrolü: boş VEYA orijinal dosyayla aynı ise OK
            const sourceFileOk = !seg?.sourceFile ||
                seg.sourceFile === origFile ||
                seg.sourceFile === this.currentFilePath;

            const hasNoTimelineChanges = segments.length === 1 &&
                seg?.start === 0 &&
                durationMatches &&
                sourceFileOk &&
                !seg?.noiseReduction?.enabled &&
                !seg?.isMuted &&
                (seg?.audioVolume === undefined || seg?.audioVolume === 100) &&
                (!seg?.audioChannelMode || seg?.audioChannelMode === 'source') &&
                (seg?.speed === undefined || seg?.speed === 1.0);

            const hasNoTransitions = typeof Transitions === 'undefined' || Transitions.getCount() === 0;

            // V91 DEBUG: Log all conditions
            console.log('V91 Optimization Check:', {
                segmentCount: segments.length,
                segStart: seg?.start,
                segEnd: seg?.end,
                sourceDuration: Timeline.sourceDuration,
                effectiveSourceDuration,
                durationMatches,
                sourceFile: seg?.sourceFile,
                origFile,
                sourceFileOk,
                noiseReduction: seg?.noiseReduction?.enabled,
                isMuted: seg?.isMuted,
                audioVolume: seg?.audioVolume,
                hasNoTimelineChanges,
                hasNoTransitions,
                ctaCount,
                willUseFastPath: hasNoTimelineChanges && hasNoTransitions && ctaCount > 0
            });

            if (hasNoTimelineChanges && hasNoTransitions && ctaCount > 0) {
                // Sadece CTA overlay var, timeline değişikliği yok
                // Render'ı atla, doğrudan orijinal dosyaya overlay uygula


                Accessibility.announce(this.t('runtime.app.overlay_only_optimization', 'Optimizasyon: Sadece overlay ekleniyor (render atlanıyor)'));
                console.log('V88 Fast Path: Skipping renderTimeline, applying CTA directly to source');
                if (Utils && Utils.playSound) Utils.playSound('start');

                const sourceFile = this.originalFilePath || this.currentFilePath;
                const rawOverlays = CtaOverlayPreview.getTimelineOverlays();

                // Relative path'leri absolute path'e dönüştür
                const resolveAssetPath = (assetPath) => {
                    if (assetPath.match(/^[A-Za-z]:[\\\/]/) || assetPath.startsWith('/')) {
                        return assetPath;
                    }
                    const baseUrl = new URL('.', window.location.href);
                    const absoluteUrl = new URL(assetPath, baseUrl);
                    let absolutePath = decodeURIComponent(absoluteUrl.pathname);
                    if (absolutePath.match(/^\/[A-Za-z]:\//)) {
                        absolutePath = absolutePath.substring(1);
                    }
                    return absolutePath.replace(/\//g, '\\');
                };

                const overlays = rawOverlays.map(o => ({
                    assetPath: resolveAssetPath(o.asset.path),
                    startTime: o.startTime,
                    duration: o.duration,
                    position: o.position,
                    scale: o.scale,
                    opacity: o.opacity,
                    sound: o.sound ? resolveAssetPath(o.sound) : null,
                    fade: o.fade,
                    removeBackground: 'black'
                }));

                // CTA progress handler
                let lastAnnouncedPercent = 0;

                // V92: İlerleme çubuğunu göster
                this.showProgress(this.t('runtime.app.applying_cta_overlay', 'CTA Overlay uygulanıyor'));

                const self = this; // Closure için referans
                const ctaProgressHandler = (data) => {
                    if (data.operation === 'apply-cta-smart' && data.percent != null) {
                        const percent = Math.round(data.percent);
                        if (!isFinite(percent) || percent < 0 || percent > 100) return;

                        // V92: İlerleme çubuğunu her zaman güncelle
                        if (self.updateProgress) {
                            self.updateProgress('apply-cta-smart', percent);
                        }

                        // Sesli duyuru sadece %10'luk artışlarda
                        if (percent >= lastAnnouncedPercent + 10 || percent === 100) {
                            lastAnnouncedPercent = percent;
                            Accessibility.announce(this.t('runtime.app.cta_overlay_progress', 'CTA overlay: yüzde {percent}', { percent }));
                        }
                    }
                };
                window.api.onFfmpegProgress(ctaProgressHandler);

                try {
                    const result = await window.api.applyCtaOverlaysSmart({
                        videoPath: sourceFile,
                        outputPath: outputPath,
                        overlays: overlays
                    });

                    window.api.offFfmpegProgress(ctaProgressHandler);

                    if (!result.success) {
                        throw new Error('CTA Overlay hatası: ' + result.error);
                    }

                    this.hideProgress();
                    this.hasChanges = false;
                    Timeline.hasChanges = false;

                    if (typeof CtaOverlayPreview !== 'undefined') {
                        CtaOverlayPreview.clearAllOverlays();
                    }

                    if (Utils && Utils.playSound) Utils.playSound('success');

                    Accessibility.announceComplete(this.t('runtime.app.export_complete_with_cta', 'Video dışa aktarma tamamlandı ({count} CTA overlay)', {
                        count: ctaCount
                    }));
                    return;

                } catch (err) {
                    window.api.offFfmpegProgress(ctaProgressHandler);
                    throw err;
                }
            }

            // === TEK ÇİZGİ (SINGLE PASS) RENDER ===
            // Parçalama/birleştirme yerine tüm timeline'ı tek FFmpeg komutuyla render et
            // Bu yöntem dikiş izleri, tekrarlamalar ve senkron kayması sorunlarını önler

            const inputPath = this.originalFilePath || this.currentFilePath;

            // Segment'leri renderTimeline için hazırla (sourceFile dahil - farklı kaynaklardan gelen segmentler için)
            const renderSegments = segments.map(seg => ({
                start: seg.start,
                end: seg.end,
                sourceFile: seg.sourceFile || inputPath, // Kaynak dosya bilgisini de ekle
                // ÖNEMLİ: Ses efektlerini ve gürültü temizleme ayarlarını da aktar
                noiseReduction: seg.noiseReduction, // { enabled: true, level: 'high', ... }
                audioEffects: seg.audioEffects,
                audioVolume: seg.audioVolume,
                audioChannelMode: seg.audioChannelMode,
                isMuted: seg.isMuted,
                speed: seg.speed || 1.0,
                speedBgAudio: seg.speedBgAudio
            }));

            Accessibility.announce(this.t('runtime.app.single_pass_render', 'Timeline tek seferde render ediliyor (Single Pass)'));

            // Geçişleri al
            const transitions = typeof Transitions !== 'undefined' ? Transitions.getAll() : [];

            const renderResult = await window.api.renderTimeline({
                inputPath: inputPath,
                segments: renderSegments,
                outputPath: outputPath,
                transitions: transitions,
                options: options
            });

            if (!renderResult.success) {
                throw new Error(`Render hatası: ${renderResult.error}`);
            }

            const expectedOutputDuration = renderSegments.reduce((sum, segment) => {
                const start = Number(segment.start || 0);
                const end = Number(segment.end || 0);
                const speed = Number(segment.speed || 1) || 1;
                return sum + Math.max(0, end - start) / speed;
            }, 0);

            if (expectedOutputDuration > 5 && window.api.getVideoMetadata) {
                const outputMetaResponse = await window.api.getVideoMetadata(outputPath);
                const outputMeta = outputMetaResponse?.success ? outputMetaResponse.data : outputMetaResponse;
                const actualOutputDuration = Number(outputMeta?.duration || 0);
                const missingDuration = expectedOutputDuration - actualOutputDuration;
                if (!actualOutputDuration || (missingDuration > 2 && actualOutputDuration < expectedOutputDuration * 0.75)) {
                    throw new Error(this.t('runtime.app.export_duration_validation_failed', 'Dışa aktarma tamamlanmış görünse de çıktı süresi beklenenden çok kısa. Dosya korunması için işlem başarısız sayıldı. Lütfen yeniden deneyin veya güvenli dışa aktar kullanın.'));
                }
            }

            // CTA Overlay'leri uygula
            if (ctaCount > 0) {
                Accessibility.announce(this.t('runtime.app.cta_overlay_processing', 'CTA overlay\'ler ekleniyor (Smart Processing)'));

                const rawOverlays = CtaOverlayPreview.getTimelineOverlays();

                // Relative path'leri absolute path'e dönüştür
                const resolveAssetPath = (assetPath) => {
                    // Eğer zaten absolute path ise (C:\ veya / ile başlıyor) olduğu gibi döndür
                    if (assetPath.match(/^[A-Za-z]:[\\/]/) || assetPath.startsWith('/')) {
                        return assetPath;
                    }
                    // Relative path - renderer klasöründen resolve et
                    // window.location kullanarak base URL'i al
                    const baseUrl = new URL('.', window.location.href);
                    const absoluteUrl = new URL(assetPath, baseUrl);
                    // file:// protokolünü kaldır ve Windows path'e çevir
                    let absolutePath = decodeURIComponent(absoluteUrl.pathname);
                    // Windows'ta /C:/... şeklinde geliyor, başındaki / karakterini kaldır
                    if (absolutePath.match(/^\/[A-Za-z]:\//)) {
                        absolutePath = absolutePath.substring(1);
                    }
                    return absolutePath.replace(/\//g, '\\');
                };

                // Map overlays to format expected by smart handler
                const overlays = rawOverlays.map(o => ({
                    assetPath: resolveAssetPath(o.asset.path),
                    startTime: o.startTime,
                    duration: o.duration,
                    position: o.position,
                    scale: o.scale,
                    opacity: o.opacity,
                    sound: o.sound ? resolveAssetPath(o.sound) : null,
                    fade: o.fade,
                    removeBackground: 'black' // Varsayılan olarak siyah arka planı sil
                }));

                const timestamp = Date.now();
                const ctaOutputPath = outputPath.replace(/\.mp4$/i, `_cta_final_${timestamp}.mp4`);

                // CTA progress için listener ekle
                let lastAnnouncedPercent = 0;
                const ctaProgressHandler = (data) => {
                    if (data.operation === 'apply-cta-smart' && data.percent != null) {
                        const percent = Math.round(data.percent);
                        // Geçerli değer mi kontrol et
                        if (!isFinite(percent) || percent < 0 || percent > 100) {
                            return;
                        }
                        // Her %10'da bir duyur
                        if (percent >= lastAnnouncedPercent + 10 || percent === 100) {
                            lastAnnouncedPercent = percent;
                            const message = this.t('runtime.app.cta_overlay_adding_progress', 'CTA overlay ekleniyor: yüzde {percent}', { percent });
                            Accessibility.announce(message);
                            if (this.updateProgress && typeof this.updateProgress === 'function') {
                                this.updateProgress('apply-cta-smart', percent);
                            }
                        }
                    }
                };
                window.api.onFfmpegProgress(ctaProgressHandler);

                try {
                    Accessibility.announce(this.t('runtime.app.cta_overlay_starting', 'CTA overlay işlemi başlıyor...'));
                    const result = await window.api.applyCtaOverlaysSmart({
                        videoPath: outputPath,
                        outputPath: ctaOutputPath,
                        overlays: overlays
                    });

                    // Listener'ı kaldır
                    window.api.offFfmpegProgress(ctaProgressHandler);

                    if (result.success) {
                        // Temp dosyayı asıl çıktıya taşı (overwrite)
                        await window.api.renameFile({
                            oldPath: ctaOutputPath,
                            newPath: outputPath
                        });
                    } else {
                        console.error('CTA Smart Overlay Error:', result.error);
                        throw new Error('CTA Overlay hatası: ' + result.error);
                    }
                } catch (err) {
                    console.error('CTA processing error:', err);
                    window.api.offFfmpegProgress(ctaProgressHandler);
                    // Cleanup temp if exists
                    // window.api.deleteFiles([ctaOutputPath]); // Optional
                    throw err;
                }
            }

            this.hideProgress();
            this.hasChanges = false;
            Timeline.hasChanges = false;

            // Başarı sesi çal
            if (Utils && Utils.playSound) Utils.playSound('success');

            // CTA overlay'leri temizle
            if (typeof CtaOverlayPreview !== 'undefined') {
                CtaOverlayPreview.clearAllOverlays();
            }

            const ctaMessage = ctaCount > 0
                ? this.t('runtime.app.export_complete_cta_suffix', ' ({count} CTA overlay dahil)', { count: ctaCount })
                : '';
            Accessibility.announceComplete(this.t('runtime.app.export_complete', 'Video dışa aktarma tamamlandı') + ctaMessage);

        } catch (error) {
            this.hideProgress();
            Accessibility.announceError(error.message);
        }

    },

    /**
     * Seçimi kaydet (kesin kesim - re-encode)
     * @param {string} filePath
     */
    async saveSelection(filePath) {
        if (!Selection.hasSelection()) {
            Accessibility.alert(this.t('runtime.app.select_area_first', 'Önce bir alan seçmelisiniz'));
            return;
        }

        const sel = Selection.getSelection();
        await this.saveSelectionBatch([{
            sourcePath: this.currentFilePath,
            startTime: sel.start,
            endTime: sel.end,
            label: this.t('runtime.app.selection_item_label', 'Seçim {index}', { index: '1' }),
            index: 0
        }], [filePath], false);
    },

    /**
     * Sadece video dışa aktar
     * @param {string} filePath
     */
    async exportVideoOnly(filePath) {
        if (!VideoPlayer.hasVideo()) return;

        this.showProgress(this.t('runtime.app.exporting_video', 'Video dışa aktarılıyor'));

        const result = await window.api.extractVideo({
            inputPath: this.currentFilePath,
            outputPath: filePath
        });

        this.hideProgress();

        if (result.success) {
            Accessibility.announceComplete(this.t('runtime.app.video_export_operation', 'Video dışa aktarma'));
        } else {
            Accessibility.announceError(result.error);
        }
    },

    /**
     * Sadece ses dışa aktar
     * @param {string} filePath
     */
    async exportAudioOnly(filePath) {
        if (!VideoPlayer.hasVideo()) return;

        // Kullanıcıya sor: İşlenmiş ses mi, yoksa ham ses mi?
        const choice = await window.api.showMessageBox({
            type: 'question',
            title: this.t('runtime.app.export_audio_title', 'Ses Dışa Aktarma'),
            message: this.t('runtime.app.export_audio_message', 'Sesi nasıl dışa aktarmak istersiniz?'),
            detail: this.t('runtime.app.export_audio_detail', 'İşlenmiş: Kesmeler, birleştirmeler ve efektler dahil (Yavaş)\nHam: Orijinal videodaki sesi olduğu gibi çıkar (Hızlı)'),
            buttons: [
                this.t('runtime.app.export_audio_render', 'İşlenmiş (Render)'),
                this.t('runtime.app.export_audio_raw', 'Ham (Sadece Çıkar)'),
                this.t('dialog.cancel', 'İptal')
            ],
            defaultId: 0,
            cancelId: 2
        });

        if (choice.response === 2) return; // İptal

        if (choice.response === 1) {
            // --- SEÇENEK: HAM (Sadece Extract) ---
            this.showProgress(this.t('runtime.app.exporting_audio_raw', 'Ses dışa aktarılıyor (Ham)...'));
            try {
                // Eğer proje henüz kaydedilmediyse (yeni proje) ve dosya yoksa hata verebilir.
                // Ama VideoPlayer.hasVideo() kontrolü yaptık.
                const inputPath = this.originalFilePath || this.currentFilePath;

                const result = await window.api.extractAudio({
                    inputPath: inputPath,
                    outputPath: filePath
                });

                this.hideProgress();

                if (result.success) {
                    Accessibility.announceComplete(this.t('runtime.app.audio_export_raw_operation', 'Ses dışa aktarma (Ham)'));
                } else {
                    Accessibility.announceError(result.error);
                }
            } catch (error) {
                this.hideProgress();
                console.error('Raw Audio Export Error:', error);
                Accessibility.announceError(error.message);
            }
            return;
        }

        // --- SEÇENEK: İŞLENMİŞ (Render) ---
        this.showProgress(this.t('runtime.app.exporting_audio_render', 'Ses dışa aktarılıyor (Render Ediliyor)...'));

        const processedAudioProgressHandler = (data) => {
            if (!data || data.percent === undefined) return;

            if (data.operation === 'render-timeline') {
                const stagedPercent = Math.max(1, Math.min(85, Math.round((data.percent || 0) * 0.85)));
                this.updateProgress(this.t('runtime.app.operation_render_processed_audio', 'Preparing processed audio'), stagedPercent);
            } else if (data.operation === 'extract-audio') {
                const stagedPercent = Math.max(85, Math.min(100, Math.round(85 + ((data.percent || 0) * 0.15))));
                this.updateProgress(this.t('runtime.app.operation_extract_processed_audio', 'Extracting processed audio'), stagedPercent);
            }
        };
        window.api.onFfmpegProgress(processedAudioProgressHandler);

        try {
            // 1. Önce Timeline'ı geçici bir dosyaya render et (Böylece kesmeler/efektler uygulanır)
            const tempVideoPath = await window.api.getTempPath(`audio_export_render_${Date.now()}.mp4`);

            const segments = Timeline.segments.map(seg => ({
                start: seg.start,
                end: seg.end,
                sourceFile: seg.sourceFile || this.originalFilePath || this.currentFilePath,
                noiseReduction: seg.noiseReduction,
                audioEffects: seg.audioEffects,
                audioVolume: seg.audioVolume,
                audioChannelMode: seg.audioChannelMode,
                isMuted: seg.isMuted
            }));

            // Tek parça ve efekt yoksa direkt extract yapılabilir mi?
            // Hayır, çünkü kesme yapılmış olabilir. Her durumda render en güvenlisi.
            // Ancak, segments.length > 1 veya start/end değişmişse render şart.

            console.log('Exporting Audio from Timeline:', segments);

            const renderResult = await window.api.renderTimeline({
                inputPath: this.originalFilePath || this.currentFilePath,
                segments: segments,
                outputPath: tempVideoPath,
                options: { audioOnly: false } // Geçici video oluşturuyoruz
            });

            if (!renderResult.success) throw new Error(renderResult.error);

            this.updateProgress(this.t('runtime.app.operation_extract_processed_audio', 'Extracting processed audio'), 85);

            // 2. Render edilen videodan sesi çıkar
            const extractResult = await window.api.extractAudio({
                inputPath: tempVideoPath,
                outputPath: filePath
            });

            // 3. Geçici dosyayı sil
            await window.api.deleteFiles([tempVideoPath]);

            if (!extractResult.success) throw new Error(extractResult.error);

            this.hideProgress();
            Accessibility.announceComplete(this.t('runtime.app.audio_export_operation', 'Ses dışa aktarma'));

        } catch (error) {
            this.hideProgress();
            console.error('Audio Export Error:', error);
            Accessibility.announceError(error.message);
        } finally {
            window.api.offFfmpegProgress(processedAudioProgressHandler);
        }
    },

    /**
     * Kes (ANI İŞLEM)
     */
    cut() {
        if (!Selection.hasSelection()) {
            Accessibility.alert(this.t('runtime.app.select_area_first', 'Önce bir alan seçmelisiniz'));
            return;
        }

        const sel = Selection.getSelection();

        if (Timeline.cut(sel.start, sel.end)) {
            this.hasChanges = true;
            this.updateAfterEdit();
            Accessibility.announce(this.t('runtime.app.selection_cut', '{duration} kesildi', {
                duration: Utils.formatTime(sel.end - sel.start)
            }));
            if (Utils && Utils.playSound) Utils.playSound('start'); // Kısa geri bildirim
        } else {
            Accessibility.alert(this.t('runtime.app.cut_failed', 'Kesme işlemi başarısız'));
        }

        Selection.clear();
    },

    /**
     * Kopyala (ANI İŞLEM - sekmeler arası çalışır)
     */
    copy() {
        if (!Selection.hasSelection()) {
            Accessibility.alert(this.t('runtime.app.select_area_first', 'Önce bir alan seçmelisiniz'));
            return;
        }

        const sel = Selection.getSelection();

        if (Timeline.copy(sel.start, sel.end)) {
            // TabManager'ın global clipboard'ına da kaydet (sekmeler arası için)
            const activeTab = TabManager.getActiveTab();
            const metadata = activeTab ? activeTab.metadata : null;
            TabManager.copyToClipboard(Timeline.clipboard.segments, metadata);

            Accessibility.announce(this.t('runtime.app.selection_copied', '{duration} kopyalandı', {
                duration: Utils.formatTime(sel.end - sel.start)
            }));
        } else {
            Accessibility.alert(this.t('runtime.app.copy_failed', 'Kopyalama işlemi başarısız'));
        }
    },

    /**
     * Yapıştır (ANI İŞLEM - sekmeler arası çalışır)
     */
    async paste() {
        // Önce TabManager'ın global clipboard'ını kontrol et
        const globalClipboard = TabManager.getClipboard();

        if (!globalClipboard && !Timeline.clipboard) {
            Accessibility.alert(this.t('runtime.app.clipboard_empty', 'Panoda içerik yok'));
            return;
        }

        const insertTime = VideoPlayer.getCurrentTime();
        const activeTab = TabManager.getActiveTab();

        // Yeni projeye yapıştırma - metadata al
        if (activeTab && activeTab.isNewProject && !activeTab.metadata && globalClipboard && globalClipboard.metadata) {
            activeTab.metadata = { ...globalClipboard.metadata };
            console.log('Yeni projeye metadata miras alındı:', activeTab.metadata);
        }

        // Global clipboard varsa ve Timeline'da yoksa, Timeline'a kopyala
        if (globalClipboard && !Timeline.clipboard) {
            // sourceFile bilgisini de ekle - cross-tab yapıştırma için gerekli
            const sourceFile = globalClipboard.metadata ? globalClipboard.metadata.filePath :
                (globalClipboard.segments[0] ? globalClipboard.segments[0].sourceFile : null);
            Timeline.clipboard = {
                sourceFile: sourceFile,
                segments: globalClipboard.segments,
                duration: globalClipboard.segments.reduce((sum, s) => sum + (s.end - s.start), 0)
            };
        }

        if (Timeline.paste(insertTime)) {
            this.hasChanges = true;
            TabManager.markAsChanged();
            this.updateAfterEdit();

            // Yeni proje için: kaynak videoyu yükle (sadece ilk yapıştırmada)
            if (activeTab && activeTab.isNewProject) {
                // İlk segment'in kaynak videosunu VideoPlayer'a yükle ve hazır olmasını bekle
                const firstSegment = Timeline.segments[0];
                if (firstSegment && firstSegment.sourceFile) {
                    await VideoPlayer.loadVideoSilent(firstSegment.sourceFile);
                    // Video hazır olduğunda ilk segment'in başına git
                    VideoPlayer.video.currentTime = firstSegment.start;
                    console.log('İlk yapıştırma: video yüklendi, konum:', firstSegment.start);
                    // Artık yeni proje değil, içerik var
                    activeTab.isNewProject = false;
                    activeTab.filePath = null; // Hala kayıtlı değil
                }
            }

            // Timeline süresini her zaman güncelle (yeni proje olsun olmasın)
            if (activeTab) {
                activeTab.timeline.totalDuration = Timeline.getTotalDuration();
                activeTab.timeline.segments = Timeline.segments.map(s => ({ ...s }));
            }
            document.getElementById('total-duration').textContent = Utils.formatTime(Timeline.getTotalDuration());

            Accessibility.announce(this.t('runtime.app.selection_pasted', '{duration} yapıştırıldı', {
                duration: Utils.formatTime(Timeline.clipboard.duration)
            }));
        } else {
            Accessibility.alert(this.t('runtime.app.paste_failed', 'Yapıştırma işlemi başarısız'));
        }
    },

    /**
     * Seçili alanı sil (ANI İŞLEM - FFmpeg kullanmaz!)
     */
    delete() {
        console.log('Delete çağrıldı');

        if (!Selection.hasSelection()) {
            console.log('Seçim yok');
            Accessibility.alert(this.t('runtime.app.select_area_first', 'Önce bir alan seçmelisiniz'));
            return;
        }

        if (!VideoPlayer.hasVideo()) {
            console.log('Video yok');
            Accessibility.alert(this.t('runtime.app.no_open_video', 'Açık video yok'));
            return;
        }

        const sel = Selection.getSelection();
        console.log('Seçim:', sel);
        console.log('Timeline segments:', Timeline.segments);

        const deletedDuration = sel.end - sel.start;

        // Timeline'ı güncelle (ANI!)
        const success = Timeline.deleteRange(sel.start, sel.end);
        console.log('DeleteRange sonucu:', success);

        if (success) {
            this.hasChanges = true;
            this.updateAfterEdit();
            Selection.clear(); // Sadece başarılı olduğunda temizle
            Accessibility.announce(this.t('runtime.app.selection_deleted', '{duration} silindi', {
                duration: Utils.formatTime(deletedDuration)
            }));
        } else {
            Accessibility.alert(this.t('runtime.app.delete_failed', 'Silme işlemi başarısız - Timeline segmentleri kontrol edin'));
        }
    },

    /**
     * Bölme İşlemi (Split)
     * Eğer seçim varsa, o aralığı ayırır (splitRange).
     * Seçim yoksa, imlecin olduğu yerden böler (splitAt).
     */
    split() {
        if (!VideoPlayer.hasVideo()) {
            Accessibility.alert(this.t('runtime.app.no_open_video', 'Açık video yok'));
            return;
        }

        let success = false;
        let message = '';

        if (Selection.hasSelection()) {
            const sel = Selection.getSelection();
            success = Timeline.splitRange(sel.start, sel.end);
            message = `${Utils.formatTime(sel.end - sel.start)}'lik alan bölündü ve ayrıldı`;
            Selection.clear();
        } else {
            const splitTime = VideoPlayer.getTimelineTime();
            success = Timeline.splitAt(splitTime);
            message = `${Utils.formatTime(splitTime)} noktasından bölündü`;
        }

        if (success) {
            this.hasChanges = true;
            this.updateAfterEdit();
            Accessibility.announce(message);
        } else {
            Accessibility.alert(this.t('runtime.app.split_failed', 'Bölme işlemi başarısız'));
        }
    },

    /**
     * Düzenleme sonrası UI güncelle
     */
    updateAfterEdit() {
        // Toplam süreyi güncelle
        const newDuration = Timeline.getTotalDuration();
        document.getElementById('total-duration').textContent = Utils.formatTime(newDuration);

        // İşaretleyicileri timeline değişikliklerine göre güncelle
        this.updateMarkersForTimeline();

        // Seçimi güncelle (eğer varsa ve geçerliyse)
        if (Selection.hasSelection()) {
            const sel = Selection.getSelection();
            // Seçim yeni timeline süresinden büyükse temizle
            if (sel.start >= newDuration || sel.end > newDuration) {
                Selection.clear(true); // Sessiz temizle
            }
        }

        // Segment indeksini mevcut konuma göre güncelle
        this.updateSegmentIndex();

        // Debug için
        Timeline.debugPrint();
    },

    /**
     * VideoPlayer'ın segment indeksini mevcut konuma göre güncelle
     * Segment ekleme/silme sonrası çağrılmalı
     */
    updateSegmentIndex() {
        const segments = Timeline.segments;
        if (!segments || segments.length === 0) {
            VideoPlayer._currentTimelineSegmentIndex = undefined;
            return;
        }

        const currentSource = VideoPlayer.currentFilePath;
        const currentTime = VideoPlayer.video ? VideoPlayer.video.currentTime : 0;

        // Mevcut konuma en yakın segmenti bul
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const segSource = seg.sourceFile || Timeline.sourceFile;

            if (segSource === currentSource) {
                if (currentTime >= seg.start - 0.5 && currentTime <= seg.end + 0.5) {
                    VideoPlayer._currentTimelineSegmentIndex = i;
                    console.log(`updateSegmentIndex: Segment indeksi güncellendi: ${i} / ${segments.length}`);
                    return;
                }
            }
        }

        // Bulunamadıysa ilk segmente ayarla
        VideoPlayer._currentTimelineSegmentIndex = 0;
        console.log(`updateSegmentIndex: Segment bulunamadı, 0'a ayarlandı`);
    },

    /**
     * İşaretleyicileri timeline değişikliklerine göre güncelle
     * Silinen bölgelerdeki işaretleyicileri kaldırır ve
     * geri kalanları yeni timeline pozisyonlarına kaydırır
     */
    updateMarkersForTimeline() {
        const markers = Markers.getAll();
        if (markers.length === 0) return;

        const newDuration = Timeline.getTotalDuration();
        const updatedMarkers = [];

        for (const marker of markers) {
            // İşaretleyicinin kaynak zamanını timeline zamanına çevir
            // (Eğer işaretleyici kaynak zamanıyla saklanıyorsa)
            const timelineTime = Timeline.sourceToTimeline(marker.time);

            if (timelineTime >= 0 && timelineTime <= newDuration) {
                // İşaretleyici hala geçerli - yeni timeline pozisyonuyla güncelle
                updatedMarkers.push({
                    ...marker,
                    time: timelineTime
                });
            }
            // timelineTime < 0 ise bu işaretleyici silinmiş bir bölgede, atla
        }

        // İşaretleyici sayısı değiştiyse kullanıcıyı bilgilendir
        const removedCount = markers.length - updatedMarkers.length;
        if (removedCount > 0) {
            console.log(`${removedCount} işaretleyici silinen bölgede olduğu için kaldırıldı`);
        }

        // Markers modülünü güncelle
        Markers.markers = updatedMarkers;
        Markers.sortMarkers();
        Markers.updateMarkerList();
        Markers.updateMarkerCount();
    },


    /**
     * Bulunduğun konumu betimle (AI)
     * @param {number} durationArg - İsteğe bağlı pencere süresi (varsayılan 5sn)
     */
    describeCurrentPosition(durationArg) {
        if (!VideoPlayer.hasVideo()) {
            Accessibility.alert(this.t('runtime.app.open_video_first', 'Önce bir video açmalısınız'));
            return;
        }
        const currentTime = VideoPlayer.getCurrentTime();
        const videoDuration = VideoPlayer.getDuration();

        // Kullanıcı aksini belirtmedikçe varsayılan 5 saniye
        const windowSize = durationArg || 5;

        // Varsayılan: Bulunduğumuz anın ortasında olduğu 5 saniyelik bir pencere
        let halfWindow = windowSize / 2;
        let start = currentTime - halfWindow;
        let end = currentTime + halfWindow;

        // Başlangıç kontrolü
        if (start < 0) {
            start = 0;
            end = Math.min(videoDuration, windowSize);
        }

        // Bitiş kontrolü
        if (end > videoDuration) {
            end = videoDuration;
            start = Math.max(0, videoDuration - windowSize);
        }

        const finalDuration = end - start;

        if (finalDuration <= 0.5) {
            Accessibility.alert(this.t('runtime.app.describe_area_too_short', 'Betimlenecek alan çok kısa veya video sonunda.'));
            return;
        }

        Dialogs.showAIDescriptionForSegment(start, finalDuration);
    },

    /**
     * Geri al (ANI İŞLEM)
     */
    undo() {
        if (Timeline.undo()) {
            this.updateAfterEdit();
            Accessibility.announce(this.t('runtime.app.undo_done', 'İşlem geri alındı'));
        } else {
            Accessibility.announce(this.t('runtime.app.nothing_to_undo', 'Geri alınacak işlem yok'));
        }
    },

    /**
     * Yinele (ANI İŞLEM)
     */
    redo() {
        if (Timeline.redo()) {
            this.updateAfterEdit();
            Accessibility.announce(this.t('runtime.app.redo_done', 'İşlem yinelendi'));
        } else {
            Accessibility.announce(this.t('runtime.app.nothing_to_redo', 'Yinelenecek işlem yok'));
        }
    },

    /**
     * Videoya ses ekle (gelişmiş)
     * @param {Object} options - Ses ekleme seçenekleri
     */
    async addAudioToVideo(options) {
        if (!VideoPlayer.hasVideo()) return;

        const {
            audioPath,
            targetVolume = 1,
            sourceVolume = 1,
            asBackground = false,
            trimStart = 0,
            trimEnd = 0
        } = options;

        this.showProgress(this.t('runtime.app.adding_audio', 'Ses ekleniyor...'));

        try {
            // Çıktı dosya yolunu oluştur - _audio eki ile
            const outputPath = this.currentFilePath.replace(/\.[^.]+$/, '_audio.mp4');
            console.log('Çıktı dosyası:', outputPath);

            // Gelişmiş ses karıştırma API'sini çağır
            const result = await window.api.mixAudioAdvanced({
                videoPath: this.currentFilePath,
                audioPath: audioPath,
                outputPath: outputPath,
                videoVolume: sourceVolume,
                audioVolume: targetVolume,
                insertTime: VideoPlayer.getCurrentTime(),
                audioTrimStart: trimStart,
                audioTrimEnd: trimEnd,
                loopAudio: asBackground
            });

            this.hideProgress();
            console.log('Mix sonucu:', result);

            if (result.success) {
                Accessibility.announceComplete(this.t('runtime.app.add_audio_operation', 'Ses ekleme'));
                console.log('Yeni dosya yükleniyor:', outputPath);

                // Yeni dosyayı aç (openFile metodu sekme ve dosya yüklemeyi düzgün halleder)
                await this.openFile(outputPath);

                Accessibility.announce(this.t('runtime.app.audio_added_video_loaded', 'Ses eklenmiş video yüklendi: {filename}', {
                    filename: outputPath.split(/[/\\]/).pop()
                }));
            } else {
                console.error('Mix hatası:', result.error);
                Accessibility.announceError(result.error);
            }
        } catch (error) {
            this.hideProgress();
            console.error('addAudioToVideo hatası:', error);
            Accessibility.announceError(error.message);
        }
    },

    /**
     * Add a moving ticker to the current video.
     * @param {Object} options - Ticker timing and style options
     */
    async addTickerToVideo(options) {
        if (!VideoPlayer.hasVideo()) return;
        this.showProgress(this.t('runtime.app.adding_ticker_overlay', 'Adding ticker...'));
        try {
            const outputPath = await window.api.getTempPath(`ticker_${Date.now()}.mp4`);
            const result = await window.api.addTickerOverlay({ videoPath: this.currentFilePath, outputPath, options });
            this.hideProgress();
            if (!result.success) throw new Error(result.error || this.t('runtime.app.ticker_add_failed', 'Ticker could not be added.'));
            Accessibility.announceComplete(this.t('runtime.app.ticker_add_operation', 'Ticker addition'));
            await this.openFile(result.outputPath);
            Accessibility.announce(this.t('runtime.app.ticker_added_video_loaded', 'The video with the ticker has been loaded.'));
        } catch (error) {
            this.hideProgress();
            Accessibility.announceError(error.message);
        }
    },

    /**
     * Add static text to the current video.
     * @param {Object} options - Text overlay options
     */
    async addTextToVideo(options) {
        if (!VideoPlayer.hasVideo()) return;

        const {
            text,
            font = 'arial',
            fontSize = 48,
            fontColor = 'white',
            background = 'none',
            position = 'bottom',
            transition = 'none',
            duration = 5,
            startTime = 0,
            shadow = 'none',
            ttsEnabled = false,
            ttsService = 'system',
            ttsVoice = null,
            ttsSpeed = 1.0,
            ttsVolume = 1.0,
            videoVolume = 1.0,
            customX,
            customY
        } = options;

        this.showProgress('Yazı ekleniyor...');

        try {
            // Video süresini al
            const videoDuration = VideoPlayer.getDuration();

            // Süre hesaplama
            let actualDuration;
            let effectiveStartTime = startTime;

            if (duration === 'whole') {
                // Tüm video boyunca (0'dan sona)
                effectiveStartTime = 0;
                actualDuration = videoDuration;

            } else {
                // Manuel süre
                actualDuration = duration;
            }

            // Ara dosya ve son dosya yolları
            const textOutputPath = this.currentFilePath.replace(/\.[^.]+$/, '_text.mp4');
            let finalOutputPath = textOutputPath;

            console.log('Yazı ekleme başlıyor:', options);

            // Adım 1: Yazı ekle
            const textResult = await window.api.addTextOverlay({
                videoPath: this.currentFilePath,
                outputPath: textOutputPath,
                text: text,
                font: font,
                fontSize: fontSize,
                fontColor: fontColor,
                background: background,
                position: position,
                customX: customX,
                customY: customY,
                transition: transition,
                shadow: shadow,
                startTime: effectiveStartTime,
                endTime: effectiveStartTime + actualDuration,
                ttsEnabled: ttsEnabled,
                ttsService: ttsService,
                ttsVoice: ttsVoice,
                ttsSpeed: ttsSpeed,
                ttsVolume: ttsVolume,
                videoVolume: videoVolume
            });

            if (!textResult.success) {
                throw new Error(textResult.error);
            }

            // Adım 2: TTS etkinse ses ekle
            if (ttsEnabled) {
                this.showProgress(this.t('runtime.app.generating_voiceover', 'Seslendiriliyor...'));

                // TTS ses dosyası oluştur
                const ttsResult = await window.api.generateTts({
                    text: text,
                    service: ttsService,
                    voice: ttsVoice,
                    speed: ttsSpeed,
                    volume: Math.round(ttsVolume * 100)
                });

                if (!ttsResult.success) {
                    console.error('TTS hatası:', ttsResult.error);
                    // TTS başarısız olsa bile devam et
                } else {
                    this.showProgress(this.t('runtime.app.adding_audio', 'Ses ekleniyor...'));

                    // TTS + Video ses karıştırma
                    finalOutputPath = this.currentFilePath.replace(/\.[^.]+$/, '_text_tts.mp4');

                    const mixResult = await window.api.mixAudioAdvanced({
                        videoPath: textOutputPath,
                        audioPath: ttsResult.wavPath,
                        outputPath: finalOutputPath,
                        videoVolume: videoVolume,
                        audioVolume: ttsVolume,
                        insertTime: startTime,
                        audioTrimStart: 0,
                        audioTrimEnd: 0,
                        loopAudio: false
                    });

                    if (!mixResult.success) {
                        console.error('Ses karıştırma hatası:', mixResult.error);
                        // Hata olsa bile yazılı videoyu kullan
                        finalOutputPath = textOutputPath;
                    }
                }
            }

            this.hideProgress();
            console.log('Yazı ekleme sonucu: başarılı');

            Accessibility.announceComplete(this.t('runtime.app.text_add_operation', 'Yazı ekleme'));
            console.log('Yeni dosya yükleniyor:', finalOutputPath);
            await this.openFile(finalOutputPath);
            Accessibility.announce(this.t('runtime.app.text_added_video_loaded', 'Yazı eklenmiş video yüklendi'));

        } catch (error) {
            this.hideProgress();
            console.error('addTextToVideo hatası:', error);
            Accessibility.announceError(error.message);
        }
    },

    /**
     * Ekleme listesindeki tüm öğeleri videoya uygula
     */
    async applyAllInsertions() {
        const items = InsertionQueue.getItems();

        if (items.length === 0) {
            Accessibility.announce(this.t('runtime.app.insertion_queue_empty', 'Ekleme listesi boş'));
            return;
        }

        if (!VideoPlayer.hasVideo()) {
            Accessibility.alert(this.t('runtime.app.open_video_first', 'Önce bir video açmalısınız'));
            return;
        }

        const transitionItems = items.filter(i => i.type === 'transition');
        const objectItems = items.filter(i => i.type === 'object');
        const overlayItems = items.filter(i => i.type === 'overlay');
        const textItems = items.filter(i => i.type === 'text');
        const tickerItems = items.filter(i => i.type === 'ticker');
        const audioItems = items.filter(i => i.type === 'audio');
        const imageItems = items.filter(i => i.type === 'image');

        // Debug: Tüm öğeleri ve tiplerini log'la
        console.log('InsertionQueue items:', items);
        console.log('Image items found:', imageItems.length, imageItems);
        items.forEach((item, idx) => {
            console.log(`Item ${idx}: type="${item.type}", options:`, item.options);
        });

        try {
            this.showProgress('Eklemeler uygulanıyor...');

            let currentVideoPath = this.currentFilePath;
            let stepCount = 0;
            const totalSteps = transitionItems.length + objectItems.length + overlayItems.length + textItems.length + tickerItems.length + audioItems.length + imageItems.length;
            const resolveAssetPath = (assetPath) => {
                if (!assetPath || typeof assetPath !== 'string') {
                    return assetPath;
                }

                if (assetPath.match(/^[A-Za-z]:[\\/]/) || assetPath.startsWith('/')) {
                    return assetPath;
                }

                const baseUrl = new URL('.', window.location.href);
                const absoluteUrl = new URL(assetPath, baseUrl);
                let absolutePath = decodeURIComponent(absoluteUrl.pathname);

                if (absolutePath.match(/^\/[A-Za-z]:\//)) {
                    absolutePath = absolutePath.substring(1);
                }

                return absolutePath.replace(/\//g, '\\');
            };

            // 1. Önce geçişleri uygula
            if (transitionItems.length > 0) {
                stepCount += transitionItems.length; // Toplu uygulandığı için tek adımda say
                this.updateProgress(`Geçişler uygulanıyor (${stepCount}/${totalSteps})`, (stepCount / totalSteps) * 100);

                const outputPath = await window.api.getTempPath(`transitions_${Date.now()}.mp4`);
                const queuedTransitionIds = new Set(transitionItems.map(item => item.options.id).filter(Boolean));
                const liveTransitions = (window.Transitions && typeof window.Transitions.getAll === 'function')
                    ? window.Transitions.getAll().filter(t => queuedTransitionIds.size === 0 || queuedTransitionIds.has(t.id))
                    : [];
                const transitionSource = liveTransitions.length > 0
                    ? liveTransitions
                    : transitionItems.map(item => item.options);

                const transitionOpts = transitionSource.map(t => {
                    let sfxPath = t.customSfxPath;
                    if (!sfxPath && t.defaultSfx) {
                        sfxPath = `assets/sfx/${t.defaultSfx}`;
                    }

                    return {
                        ...t,
                        type: t.ffmpegType || t.transitionType || t.transitionId || 'cross_dissolve',
                        transitionType: t.ffmpegType || t.transitionType || t.transitionId || 'cross_dissolve',
                        useSfx: t.useSfx !== false,
                        customSfxPath: sfxPath
                    };
                });

                const result = await window.api.applyTransitionsSmart({
                    videoPath: currentVideoPath,
                    outputPath: outputPath,
                    transitions: transitionOpts
                });

                if (result.success && result.outputPath) {
                    currentVideoPath = result.outputPath;
                } else {
                    console.error('Geçiş ekleme hatası:', result.error);
                }
            }

            // 2. Ardından nesne işlemlerini uygula
            for (const item of objectItems) {
                stepCount++;
                this.updateProgress(`Nesne işlemi uygulanıyor (${stepCount}/${totalSteps})`, (stepCount / totalSteps) * 100);

                const opts = item.options;
                const result = await window.api.applyObjectEffect({
                    videoPath: currentVideoPath,
                    objectTracks: opts.objectTracks,
                    effectType: opts.actionType,
                    scope: opts.durationMode,
                    customStart: opts.startTime,
                    customEnd: opts.endTime
                });

                if (result.success && result.outputPath) {
                    currentVideoPath = result.outputPath;
                } else {
                    console.error('Nesne işlemi hatası:', result.error);
                }
            }

            // 3. CTA/Overlay'leri uygula (Video katmanları)
            if (overlayItems.length > 0) {
                stepCount += overlayItems.length;
                this.updateProgress(`Overlay'ler uygulanıyor (${stepCount}/${totalSteps})`, (stepCount / totalSteps) * 100);

                const outputPath = await window.api.getTempPath(`overlays_${Date.now()}.mp4`);
                const queuedOverlayIds = new Set(overlayItems.map(item => item.options.timelineOverlayId).filter(Boolean));
                const liveOverlays = (window.CtaOverlayPreview && typeof window.CtaOverlayPreview.getTimelineOverlays === 'function')
                    ? window.CtaOverlayPreview.getTimelineOverlays().filter(o => queuedOverlayIds.size === 0 || queuedOverlayIds.has(o.id))
                    : [];
                const overlaySource = liveOverlays.length > 0
                    ? liveOverlays.map(o => ({
                        assetId: o.asset?.id,
                        assetPath: resolveAssetPath(o.asset?.path),
                        assetName: o.asset?.name,
                        assetType: o.asset?.type,
                        startTime: o.startTime,
                        duration: o.duration,
                        position: o.position,
                        scale: o.scale,
                        opacity: o.opacity,
                        sound: o.sound ? resolveAssetPath(o.sound) : null,
                        fade: o.fade,
                        removeBackground: 'black'
                    }))
                    : overlayItems
                    .map(item => ({
                        assetId: item.options.overlayId,
                        assetPath: resolveAssetPath(item.options.internalAsset?.path || item.options.assetPath),
                        assetName: item.options.overlayName,
                        assetType: item.options.internalAsset?.type || item.options.assetType,
                        startTime: item.options.startTime || 0,
                        duration: item.options.duration,
                        position: item.options.position,
                        scale: item.options.scale,
                        opacity: item.options.opacity,
                        sound: item.options.sound ? resolveAssetPath(item.options.sound) : null,
                        fade: item.options.fade,
                        removeBackground: 'black'
                    }));

                const overlayOpts = overlaySource
                    .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));

                const result = await window.api.applyCtaOverlaysSmart({
                    videoPath: currentVideoPath,
                    outputPath: outputPath,
                    overlays: overlayOpts
                });

                if (result.success && result.outputPath) {
                    currentVideoPath = result.outputPath;
                } else {
                    console.error('Overlay ekleme hatası:', result.error);
                }
            }

            // 4. Yazıları uygula
            for (const item of textItems) {
                stepCount++;
                this.updateProgress(`Yazı ekleniyor (${stepCount}/${totalSteps})`, (stepCount / totalSteps) * 100);

                const opts = item.options;
                const outputPath = await window.api.getTempPath(`text_${stepCount}_${Date.now()}.mp4`);

                // Video süresini al
                const videoDuration = VideoPlayer.getDuration();
                const endTime = opts.duration === 'whole'
                    ? videoDuration
                    : (opts.startTime || 0) + (opts.duration || 5);

                const result = await window.api.addTextOverlay({
                    videoPath: currentVideoPath,
                    outputPath: outputPath,
                    text: opts.text || '',
                    font: opts.font || 'arial',
                    fontSize: opts.fontSize || 48,
                    fontColor: opts.fontColor || 'white',
                    background: opts.background || 'none',
                    position: opts.position || 'bottom-center',
                    customX: opts.customX,
                    customY: opts.customY,
                    transition: opts.transition || 'none',
                    startTime: opts.startTime || 0,
                    endTime: endTime,
                    // TTS parametreleri - Options içinden al
                    shadow: opts.shadow || 'none',
                    ttsEnabled: opts.ttsEnabled || false,
                    ttsService: opts.ttsService || 'system',
                    ttsVoice: opts.ttsVoice || null,
                    ttsSpeed: opts.ttsSpeed || 1.0,
                    ttsVolume: opts.ttsVolume || 1.0,
                    videoVolume: opts.videoVolume || 1.0
                });

                if (result.success && result.outputPath) {
                    currentVideoPath = result.outputPath;
                } else {
                    console.error('Yazı ekleme hatası:', result.error);
                }
            }

            // Sonra sesleri uygula
            for (const item of tickerItems) {
                stepCount++;
                this.updateProgress(this.t('runtime.app.adding_ticker_progress', 'Adding ticker ({current}/{total})', { current: stepCount, total: totalSteps }), (stepCount / totalSteps) * 100);
                const outputPath = await window.api.getTempPath(`ticker_${stepCount}_${Date.now()}.mp4`);
                const result = await window.api.addTickerOverlay({ videoPath: currentVideoPath, outputPath, options: item.options });
                if (result.success && result.outputPath) currentVideoPath = result.outputPath;
                else throw new Error(result.error || this.t('runtime.app.ticker_add_failed', 'Ticker could not be added.'));
            }

            for (const item of audioItems) {
                stepCount++;
                this.updateProgress(`Ses ekleniyor (${stepCount}/${totalSteps})`, (stepCount / totalSteps) * 100);

                const opts = item.options;
                const outputPath = await window.api.getTempPath(`audio_${stepCount}_${Date.now()}.mp4`);

                const result = await window.api.mixAudio({
                    videoPath: currentVideoPath,
                    audioPath: opts.audioPath,
                    outputPath: outputPath,
                    videoVolume: opts.videoVolume || 1.0,
                    audioVolume: opts.audioVolume || 1.0,
                    insertTime: opts.startTime || 0,
                    audioTrimStart: opts.audioTrimStart || 0,
                    audioTrimEnd: opts.audioTrimEnd || 0,
                    loopAudio: opts.loopAudio || false
                });

                if (result.success && result.outputPath) {
                    currentVideoPath = result.outputPath;
                } else {
                    console.error('Ses ekleme hatası:', result.error);
                }
            }

            // Görselleri uygula
            for (const item of imageItems) {
                stepCount++;
                this.updateProgress(`Görsel ekleniyor (${stepCount}/${totalSteps})`, (stepCount / totalSteps) * 100);

                const opts = item.options;
                const videoDuration = VideoPlayer.getDuration();

                // Zamanlama ayarları
                const startTime = opts.startTime || 0;
                const endTime = opts.endTime === -1 || opts.durationMode === 'whole' ? videoDuration : (opts.endTime || videoDuration);

                const outputPath = await window.api.getTempPath(`image_${stepCount}_${Date.now()}.mp4`);

                const result = await window.api.addImageOverlay({
                    videoPath: currentVideoPath,
                    outputPath: outputPath,
                    imagePath: opts.imagePath,
                    options: {
                        x: opts.x || 0,
                        y: opts.y || 0,
                        width: opts.width || -1,
                        height: opts.height || -1,
                        opacity: opts.opacity || 1,
                        startTime: startTime,
                        endTime: endTime
                    }
                });

                if (result.success && result.outputPath) {
                    currentVideoPath = result.outputPath;
                } else {
                    console.error('Görsel ekleme hatası:', result.error);
                }
            }

            this.hideProgress();

            // Kullanıcıya kaydetme dialogu göster
            const saveResult = await window.api.showSaveDialog({
                title: 'Eklemeli Videoyu Kaydet',
                defaultPath: 'video_eklemeli.mp4',
                filters: [
                    { name: 'Video Dosyaları', extensions: ['mp4'] }
                ]
            });

            if (saveResult && saveResult.filePath) {
                // Geçici dosyayı kullanıcının seçtiği konuma kopyala
                await window.api.copyFile(currentVideoPath, saveResult.filePath);

                // Listeyi temizle
                InsertionQueue.clear();

                // Sonucu yükle
                await this.openFile(saveResult.filePath);
                Accessibility.announce(`Tüm eklemeler başarıyla uygulandı ve kaydedildi: ${saveResult.filePath}`);
            } else {
                // Kullanıcı iptal ettiyse geçici dosyayı yükle
                InsertionQueue.clear();
                await this.openFile(currentVideoPath);
                Accessibility.announce(`Tüm eklemeler başarıyla uygulandı. Video geçici klasöre kaydedildi.`);
            }

        } catch (error) {
            this.hideProgress();
            console.error('applyAllInsertions hatası:', error);
            Accessibility.announceError(error.message);
        }
    },


    /**
     * Video ekle
     * @param {string} videoPath
     */
    async insertVideo(videoPath) {
        // Eğer dosya yolu yoksa, diyalog aç
        if (!videoPath) {
            const result = await window.api.openFileDialog({
                filters: [
                    { name: 'Videolar', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv'] },
                    { name: 'Tüm Dosyalar', extensions: ['*'] }
                ]
            });

            if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
                return;
            }
            videoPath = result.filePaths[0];
        }

        if (!VideoPlayer.hasVideo()) {
            // İlk video olarak aç
            await this.openFile(videoPath);
            return;
        }

        Accessibility.announce(this.t('runtime.app.video_inserting', 'Video ekleniyor...'));
        // TODO: FFmpeg ile video birleştirme logic'i (concat) buraya gelecek
    },

    /**
     * Metin overlay ekle
     * @param {string} text
     * @param {Object} options
     */
    async addTextOverlay(text, options) {
        if (!VideoPlayer.hasVideo()) return;

        this.showProgress(this.t('runtime.app.adding_text_overlay', 'Metin ekleniyor'));

        const outputPath = this.currentFilePath.replace(/\.[^.]+$/, '_text.mp4');

        const sel = Selection.getSelection();
        const startTime = sel ? sel.start : 0;
        const endTime = sel ? sel.end : VideoPlayer.getDuration(); // Seçim yoksa tüm video

        const result = await window.api.addTextOverlay({
            videoPath: this.currentFilePath,
            outputPath: outputPath,
            text: text,
            font: options.font,
            fontSize: options.fontSize,
            fontColor: options.fontColor,
            background: options.background,
            position: options.position,
            customX: options.customX,
            customY: options.customY,
            transition: options.transition,
            startTime: startTime,
            endTime: endTime,
            ttsEnabled: options.ttsEnabled,
            ttsVoice: options.ttsVoice,
            ttsSpeed: options.ttsSpeed,
            ttsVolume: options.ttsVolume,
            videoVolume: options.videoVolume,
            shadow: options.shadow
        });

        this.hideProgress();

        if (result.success) {
            Accessibility.announceComplete(this.t('runtime.app.text_add_operation', 'Metin ekleme'));
            await this.openFile(outputPath);
        } else {
            Accessibility.announceError(result.error);
        }
    },

    /**
     * Görseller ekle
     * @param {Array} imagePaths
     * @param {number} duration - Her görsel için süre
     */
    async insertImages(imagePaths, duration) {
        this.showProgress(this.t('runtime.app.adding_images', 'Görseller ekleniyor'));

        const outputPath = this.currentFilePath
            ? this.currentFilePath.replace(/\.[^.]+$/, '_images.mp4')
            : 'output_images.mp4';

        const result = await window.api.createVideoFromImages({
            imagePaths: imagePaths,
            outputPath: outputPath,
            duration: duration
        });

        this.hideProgress();

        if (result.success) {
            Accessibility.announceComplete(this.t('runtime.app.image_add_operation', 'Görsel ekleme'));
            await this.openFile(outputPath);
        } else {
            Accessibility.announceError(result.error);
        }
    },

    /**
     * Videoya görsel overlay ekle (Wizard üzerinden)
     */
    async addImageOverlay(options) {
        if (!VideoPlayer.hasVideo()) return;

        this.showProgress(this.t('runtime.app.adding_image', 'Görsel ekleniyor'));

        const { imagePath, x, y, width, height, opacity, startTime, endTime } = options;

        const outputPath = this.currentFilePath.replace(/\.[^.]+$/, '_image_overlay.mp4');

        const result = await window.api.addImageOverlay({
            videoPath: this.currentFilePath,
            imagePath: imagePath,
            outputPath: outputPath,
            options: { x, y, width, height, opacity, startTime, endTime }
        });

        this.hideProgress();

        if (result.success) {
            if (Utils && Utils.playSound) Utils.playSound('success');
            Accessibility.announceComplete(this.t('runtime.app.image_add_operation', 'Görsel ekleme'));
            await this.openFile(outputPath);
        } else {
            Accessibility.announceError(result.error);
        }
    },

    /**
     * Altyazı ekle
     * @param {string} subtitlePath
     */
    async insertSubtitle(subtitlePath) {
        const isTtsProjectPath = /\.evdtts$/i.test(String(subtitlePath || ''));
        if (!VideoPlayer.hasVideo() && !isTtsProjectPath) return;

        if (this.isProcessingSubtitle) {
            console.warn('[insertSubtitle] Re-entrance detected, skipping:', subtitlePath);
            return;
        }
        this.isProcessingSubtitle = true;
        console.log('[insertSubtitle] Started:', subtitlePath);

        try {
            let preloadedTtsProject = null;
            let resumeTempSubtitlePath = '';
            if (isTtsProjectPath) {
                preloadedTtsProject = await Dialogs.loadSubtitleTtsProject(subtitlePath);
                if (!preloadedTtsProject) return;
                if (!preloadedTtsProject.videoPath || !await window.api.checkFileExists(preloadedTtsProject.videoPath)) {
                    Accessibility.announceError(this.t('runtime.subtitle_tts_editor.video_missing',
                        'Projenin kaynak videosu bulunamadı.'));
                    return;
                }
                if (this.currentFilePath !== preloadedTtsProject.videoPath) {
                    await this.openFile(preloadedTtsProject.videoPath);
                }
                const storedSubtitlePath = preloadedTtsProject.subtitlePath || '';
                if (storedSubtitlePath && await window.api.checkFileExists(storedSubtitlePath)) {
                    subtitlePath = storedSubtitlePath;
                } else if (preloadedTtsProject.subtitleContent) {
                    resumeTempSubtitlePath = await window.api.getTempPath(`evdtts_resume_${Date.now()}.srt`);
                    const writeResult = await window.api.saveFileContent({
                        filePath: resumeTempSubtitlePath,
                        content: preloadedTtsProject.subtitleContent
                    });
                    if (!writeResult?.success) throw new Error(writeResult?.error || 'subtitle_restore_failed');
                    subtitlePath = resumeTempSubtitlePath;
                } else {
                    Accessibility.announceError(this.t('runtime.subtitle_tts_editor.subtitle_missing',
                        'Projenin altyazı dosyası ve gömülü altyazı metni bulunamadı.'));
                    return;
                }
            }

            // 1. Altyazı dosyasını oku ve parse et (Önizleme metni için)
            const fileResult = await window.api.readFileContent(subtitlePath);
            if (!fileResult.success) {
                Accessibility.announceError(this.t('runtime.app.subtitle_file_read_failed', 'Altyazı dosyası okunamadı'));
                return;
            }

            const content = fileResult.content;
            const lines = content.split(/\r?\n/);
            let firstText = "Önizleme metni bulunamadı";
            const subtitles = [];

            // Basit SRT Parser
            let currentSub = {};
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) {
                    if (currentSub.text) {
                        subtitles.push(currentSub);
                        currentSub = {};
                    }
                    continue;
                }
                if (line.includes('-->')) {
                    currentSub.timing = line;
                } else if (!currentSub.timing && /^\d+$/.test(line)) {
                    currentSub.id = line;
                } else {
                    currentSub.text = (currentSub.text ? currentSub.text + ' ' : '') + line;
              }
            }
            if (currentSub.text) subtitles.push(currentSub);
            if (subtitles.length > 0) firstText = subtitles[0].text;
            let firstSubtitleStartTime = 0;
            if (subtitles.length > 0 && subtitles[0].timing) {
                const startPart = subtitles[0].timing.split('-->')[0]?.trim() || '';
                const timeParts = startPart.split(':');
                if (timeParts.length === 3) {
                    const secParts = timeParts[2].split(/[,\.]/);
                    firstSubtitleStartTime =
                        (parseInt(timeParts[0], 10) || 0) * 3600 +
                        (parseInt(timeParts[1], 10) || 0) * 60 +
                        (parseInt(secParts[0], 10) || 0) +
                        ((parseInt(secParts[1], 10) || 0) / 1000);
                }
            }

            let action = preloadedTtsProject?.action || '';
            let subtitleStyleOptions = preloadedTtsProject?.subtitleStyleOptions || null;
            let ttsOptions = preloadedTtsProject?.ttsOptions
                ? { ...preloadedTtsProject.ttsOptions, confirmed: true }
                : null;
            let editorChoice = preloadedTtsProject ? 0 : null;

            if (!preloadedTtsProject) {
                Accessibility.announce(this.t('runtime.app.subtitle_analyzed_opening_options',
                    'Altyazı analiz edildi. Seçenekler açılıyor...'));
                const subtitleActionResult = await Dialogs.showSubtitleActionDialog({
                    videoPath: this.currentFilePath,
                    previewText: firstText,
                    previewTime: firstSubtitleStartTime
                });
                if (subtitleActionResult === 'cancel' || !subtitleActionResult) {
                    Accessibility.announce(this.t('runtime.app.operation_cancelled', 'İşlem iptal edildi.'));
                    return;
                }
                action = typeof subtitleActionResult === 'string'
                    ? subtitleActionResult
                    : subtitleActionResult.action;

                if (action === 'burn' || action === 'tts-burn') {
                    subtitleStyleOptions = await Dialogs.showSubtitleStyleDialog({
                        videoPath: this.currentFilePath,
                        previewText: firstText,
                        previewTime: firstSubtitleStartTime
                    });
                    if (subtitleStyleOptions === 'cancel' || !subtitleStyleOptions) {
                        Accessibility.announce(this.t('runtime.app.operation_cancelled', 'İşlem iptal edildi.'));
                        return;
                    }
                }
                if (action === 'burn') {
                    await this.performSubtitleBurn(subtitlePath, subtitleStyleOptions);
                    return;
                }

                ttsOptions = await Dialogs.showSubtitleTtsOptionsDialog(firstText);
                if (!ttsOptions || !ttsOptions.confirmed) {
                    Accessibility.announce(this.t('runtime.app.voiceover_cancelled', 'Seslendirme işlemi iptal edildi.'));
                    return;
                }
                editorChoice = await Dialogs.showAccessibleChoice({
                    title: this.t('dialog.subtitle_tts_editor.choice_title', 'Seslendirme Düzenleme'),
                    message: this.t('dialog.subtitle_tts_editor.choice_message',
                        'Seslendirmeleri tek tek dinleyip düzenleyebilir veya mevcut ayarlarla doğrudan oluşturabilirsiniz.'),
                    buttons: [
                        this.t('dialog.subtitle_tts_editor.open_editor', 'Seslendirmeleri Düzenle'),
                        this.t('dialog.subtitle_tts_editor.build_directly', 'Doğrudan Mevcut Ayarlarla Oluştur'),
                        this.t('dialog.cancel', 'İptal')
                    ],
                    cancelValue: 2
                });
                if (editorChoice === 2 || editorChoice === null || editorChoice === undefined) {
                    Accessibility.announce(this.t('runtime.app.operation_cancelled', 'İşlem iptal edildi.'));
                    return;
                }
            }
            const useSegmentEditor = editorChoice === 0;



            this.showProgress(this.t('runtime.subtitle_tts_editor.preparing', 'Seslendirme işlemi hazırlanıyor...'));
            const tempSilencePath = await window.api.getTempPath(`master_silence_${Date.now()}.wav`);
            await window.api.generateSilence({ duration: 3600, outputPath: tempSilencePath });

            const audioFilesToDelete = [tempSilencePath];
            if (resumeTempSubtitlePath) audioFilesToDelete.push(resumeTempSubtitlePath);
            const parseTimestamp = (timestamp) => {
                const parts = String(timestamp || '').split(':');
                const seconds = String(parts[2] || '0').split(/[,\.]/);
                return (parseInt(parts[0], 10) || 0) * 3600
                    + (parseInt(parts[1], 10) || 0) * 60
                    + (parseInt(seconds[0], 10) || 0)
                    + (parseInt(seconds[1], 10) || 0) / 1000;
            };

            const formatSrtTimestamp = (value) => {
                const totalMilliseconds = Math.max(0, Math.round(Number(value || 0) * 1000));
                const hours = Math.floor(totalMilliseconds / 3600000);
                const minutes = Math.floor((totalMilliseconds % 3600000) / 60000);
                const seconds = Math.floor((totalMilliseconds % 60000) / 1000);
                const milliseconds = totalMilliseconds % 1000;
                return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
            };

            const generatedSegments = preloadedTtsProject
                ? preloadedTtsProject.segments.map((segment) => ({ ...segment }))
                : [];
            if (!preloadedTtsProject) {
            for (let index = 0; index < subtitles.length; index++) {
                const subtitle = subtitles[index];
                if (!subtitle.timing) continue;
                const times = subtitle.timing.split('-->').map((value) => value.trim());
                const startTime = parseTimestamp(times[0]);
                const endTime = Math.max(startTime + 0.1, parseTimestamp(times[1]));
                this.updateProgress(
                    this.t('runtime.subtitle_tts_editor.generating_item', 'Seslendiriliyor: {current}/{total}', {
                        current: index + 1,
                        total: subtitles.length
                    }),
                    (index / Math.max(1, subtitles.length)) * 80
                );
                const ttsResult = await window.api.generateTts({
                    text: subtitle.text,
                    service: ttsOptions.service || 'system',
                    voice: ttsOptions.voice,
                    speed: useSegmentEditor ? 1 : ttsOptions.speed,
                    volume: useSegmentEditor ? 100 : ttsOptions.volume
                }).catch(() => ({ success: false }));
                if (!ttsResult.success) continue;
                audioFilesToDelete.push(ttsResult.wavPath);
                const original = {
                    text: subtitle.text,
                    generatedText: subtitle.text,
                    startTime,
                    endTime,
                    speed: Number(ttsOptions.speed || 1),
                    generatedSpeed: useSegmentEditor ? 1 : Number(ttsOptions.speed || 1),
                    voice: String(ttsOptions.voice || ''),
                    generatedVoice: String(ttsOptions.voice || ''),
                    ttsVolume: useSegmentEditor ? Number(ttsOptions.volume ?? 100) : 100,
                    originalVolume: Number(ttsOptions.originalVolume ?? 0.8),
                    voiceEnabled: true
                };
                generatedSegments.push({
                    id: String(subtitle.id || index + 1),
                    subtitleIndex: index,
                    text: subtitle.text,
                    wavPath: ttsResult.wavPath,
                    ...original,
                    original: { ...original }
                });
            }
            }
            if (!generatedSegments.length) {
                throw new Error(this.t('runtime.subtitle_tts_editor.no_audio', 'Hiçbir altyazı seslendirmesi üretilemedi.'));
            }

            let finalSegments = generatedSegments;
            let editedMode = false;
            if (useSegmentEditor) {
                this.hideProgress();
                const editorResult = await Dialogs.showSubtitleTtsSegmentEditor({
                    segments: generatedSegments,
                    videoPath: this.currentFilePath,
                    defaults: ttsOptions,
                    projectContext: {
                        projectPath: preloadedTtsProject?.projectPath || '',
                        subtitlePath,
                        subtitleContent: content,
                        action,
                        subtitleStyleOptions,
                        selectedIndex: Number(preloadedTtsProject?.selectedIndex || 0)
                    }
                });
                if (!editorResult) {
                    await window.api.deleteFiles(audioFilesToDelete);
                    Accessibility.announce(this.t('runtime.app.operation_cancelled', 'İşlem iptal edildi.'));
                    return;
                }
                if (editorResult.ttsOptions) {
                    ttsOptions = { ...editorResult.ttsOptions, confirmed: true };
                }
                if (editorResult.videoPath && editorResult.videoPath !== this.currentFilePath) {
                    if (!await window.api.checkFileExists(editorResult.videoPath)) {
                        throw new Error(this.t('runtime.subtitle_tts_editor.video_missing', 'Projenin kaynak videosu bulunamadı.'));
                    }
                    await this.openFile(editorResult.videoPath);
                }
                if (editorResult.projectContext) {
                    action = editorResult.projectContext.action || action;
                    subtitleStyleOptions = editorResult.projectContext.subtitleStyleOptions || subtitleStyleOptions;
                    const restoredSubtitlePath = editorResult.projectContext.subtitlePath || '';
                    if (restoredSubtitlePath && await window.api.checkFileExists(restoredSubtitlePath)) {
                        subtitlePath = restoredSubtitlePath;
                    } else if (editorResult.projectContext.subtitleContent) {
                        const restoredTempPath = await window.api.getTempPath(`evdtts_editor_${Date.now()}.srt`);
                        const restoredWrite = await window.api.saveFileContent({
                            filePath: restoredTempPath,
                            content: editorResult.projectContext.subtitleContent
                        });
                        if (!restoredWrite?.success) throw new Error(restoredWrite?.error || 'subtitle_restore_failed');
                        subtitlePath = restoredTempPath;
                        audioFilesToDelete.push(restoredTempPath);
                    }
                }
                finalSegments = editorResult.segments || generatedSegments;
                editedMode = editorResult.mode === 'edited';
                for (const generatedPath of (editorResult.generatedTempPaths || [])) {
                    if (generatedPath && !audioFilesToDelete.includes(generatedPath)) {
                        audioFilesToDelete.push(generatedPath);
                    }
                }
                this.showProgress(this.t('runtime.subtitle_tts_editor.applying', 'Düzenlemeler uygulanıyor...'));

                if (editedMode) {
                    for (let index = 0; index < finalSegments.length; index++) {
                        const segment = finalSegments[index];
                        if (segment.voiceEnabled === false) continue;
                        const textChanged = String(segment.text || '') !== String(segment.generatedText ?? segment.original?.generatedText ?? segment.text ?? '');
                        const voiceChanged = String(segment.voice ?? ttsOptions.voice ?? '') !== String(segment.generatedVoice ?? segment.original?.generatedVoice ?? ttsOptions.voice ?? '');
                        if (!textChanged && !voiceChanged) continue;
                        this.updateProgress(
                            this.t('runtime.subtitle_tts_editor.regenerating_item', 'Değiştirilen seslendirme yeniden oluşturuluyor: {current}/{total}', {
                                current: index + 1,
                                total: finalSegments.length
                            }),
                            (index / Math.max(1, finalSegments.length)) * 25
                        );
                        const regenerated = await window.api.generateTts({
                            text: segment.text,
                            service: ttsOptions.service || 'system',
                            voice: segment.voice ?? ttsOptions.voice,
                            speed: 1,
                            volume: 100
                        });
                        if (!regenerated.success) throw new Error(regenerated.error || 'tts_regeneration_failed');
                        audioFilesToDelete.push(regenerated.wavPath);
                        segment.wavPath = regenerated.wavPath;
                        segment.generatedSpeed = 1;
                        segment.generatedText = segment.text;
                        segment.generatedVoice = String(segment.voice ?? ttsOptions.voice ?? '');
                    }
                }
            }

            const activeSegments = finalSegments
                .filter((segment) => segment.voiceEnabled !== false && segment.wavPath)
                .sort((left, right) => Number(left.startTime) - Number(right.startTime));
            if (!activeSegments.length) {
                throw new Error(this.t('runtime.subtitle_tts_editor.all_disabled', 'Tüm altyazı seslendirmeleri kapatıldı.'));
            }

            let subtitleBurnPath = subtitlePath;
            if (action === 'tts-burn' && editedMode) {
                const updatedSubtitleContent = [...finalSegments]
                    .sort((left, right) => Number(left.startTime || 0) - Number(right.startTime || 0))
                    .map((segment, index) => `${index + 1}\n${formatSrtTimestamp(segment.startTime)} --> ${formatSrtTimestamp(segment.endTime)}\n${String(segment.text || '').trim()}`)
                    .join('\n\n') + '\n';
                subtitleBurnPath = await window.api.getTempPath(`edited_subtitles_${Date.now()}.srt`);
                const subtitleWriteResult = await window.api.saveFileContent({
                    filePath: subtitleBurnPath,
                    content: updatedSubtitleContent
                });
                if (!subtitleWriteResult?.success) {
                    throw new Error(subtitleWriteResult?.error || 'edited_subtitle_write_failed');
                }
                audioFilesToDelete.push(subtitleBurnPath);
            }

            const CHUNK_SIZE = 50;
            const chunkFiles = [];
            for (let chunkStart = 0; chunkStart < activeSegments.length; chunkStart += CHUNK_SIZE) {
                const chunk = activeSegments.slice(chunkStart, chunkStart + CHUNK_SIZE);
                const chunkOffset = Number(chunk[0].startTime || 0);
                const chunkPath = await window.api.getTempPath(`chunk_${chunkFiles.length + 1}_${Date.now()}.wav`);
                audioFilesToDelete.push(chunkPath);
                this.updateProgress(
                    this.t('runtime.subtitle_tts_editor.mixing_chunks', 'Parçalar birleştiriliyor: {current}/{total}', {
                        current: chunkFiles.length + 1,
                        total: Math.ceil(activeSegments.length / CHUNK_SIZE)
                    }),
                    25 + ((chunkStart / activeSegments.length) * 45)
                );
                const chunkResult = await window.api.createAudioFromMix({
                    audioSegments: chunk.map((segment) => ({
                        path: segment.wavPath,
                        offset: Math.max(0, Number(segment.startTime) - chunkOffset),
                        volume: useSegmentEditor ? Number(segment.ttsVolume || 0) / 100 : 1,
                        tempo: useSegmentEditor
                            ? Number(segment.speed || 1) / Math.max(0.01, Number(segment.generatedSpeed || 1))
                            : 1
                    })),
                    outputPath: chunkPath
                });
                if (!chunkResult.success) throw new Error(`Chunk error: ${chunkResult.error}`);
                chunkFiles.push({ path: chunkPath, offset: chunkOffset });
            }

            const fullTtsPath = await window.api.getTempPath(`full_tts_${Date.now()}.wav`);
            audioFilesToDelete.push(fullTtsPath);
            const concatResult = await window.api.createAudioFromMix({
                audioSegments: chunkFiles,
                outputPath: fullTtsPath
            });
            if (!concatResult.success) throw new Error(concatResult.error);

            this.showProgress(this.t('runtime.subtitle_tts_editor.processing_video', 'Videoya işleniyor...'));
            const suffix = action === 'tts-burn' ? '_tts_sub' : '_tts';
            const finalOutputPath = this.currentFilePath.replace(/\.[^.]+$/, `${suffix}.mp4`);
            let audioMixOutputPath = finalOutputPath;
            if (action === 'tts-burn') {
                audioMixOutputPath = await window.api.getTempPath(`pre_burn_mix_${Date.now()}.mp4`);
                audioFilesToDelete.push(audioMixOutputPath);
            }

            const mixResult = await window.api.mixAudio({
                videoPath: this.currentFilePath,
                audioPath: fullTtsPath,
                outputPath: audioMixOutputPath,
                videoVolume: ttsOptions.originalVolume,
                videoVolumeSegments: editedMode
                    ? finalSegments
                        .filter((segment) => Math.abs(
                            Number(segment.originalVolume) - Number(ttsOptions.originalVolume)
                        ) >= 0.0001)
                        .map((segment) => ({
                            start: segment.startTime,
                            end: segment.endTime,
                            volume: segment.originalVolume
                        }))
                    : [],
                audioVolume: 1,
                preserveOriginalLevel: true,
                limitOutput: true
            });
            if (!mixResult.success) throw new Error(mixResult.error);

            if (action === 'tts-burn') {
                this.showProgress(this.t('runtime.subtitle_tts_editor.burning', 'Altyazılar görüntüye işleniyor...'));
                const burnResult = await window.api.burnSubtitles({
                    videoPath: audioMixOutputPath,
                    subtitlePath: subtitleBurnPath,
                    outputPath: finalOutputPath,
                    styleOptions: subtitleStyleOptions
                });
                if (!burnResult.success) throw new Error(burnResult.error);
            }

            this.hideProgress();
            if (Utils && Utils.playSound) Utils.playSound('success');
            Accessibility.announceComplete(this.t('runtime.app.operation_generic', 'İşlem'));
            await this.openFile(finalOutputPath);
            Accessibility.announce(this.t('runtime.app.operation_completed_file_opened', 'İşlem tamamlandı. Dosya açıldı: {filename}', {
                filename: finalOutputPath.split(/[\\/]/).pop()
            }));
            await window.api.deleteFiles(audioFilesToDelete);

        } catch (err) {
            this.hideProgress();
            console.error('[insertSubtitle] Error:', err);
            Accessibility.announceError(this.t('runtime.app.error_message', 'Hata: {message}', { message: err.message }));
        } finally {
            this.isProcessingSubtitle = false;
            console.log('[insertSubtitle] Finished (flag reset).');
        }
    },

    /**
     * CTA (Overlay) öğesini zaman çizelgesine ekle
     * @param {Object} params
     * @param {Object} params.asset - Seçilen asset
     * @param {Object} params.options - Kullanıcı seçenekleri (pos, scale, fade vb.)
     */
    async addCtaToTimeline(params) {
        if (!VideoPlayer.hasVideo()) {
            Accessibility.alert(this.t('runtime.app.open_video_first_polite', 'Lütfen önce bir video açın.'));
            return;
        }

        const { asset, options } = params;
        const currentVideoPath = this.currentFilePath;
        const outputPath = currentVideoPath.replace(/\.[^.]+$/, `_cta_${Date.now()}.mp4`);

        // Timeline cursor position is start time
        const startTime = VideoPlayer.getTimelineTime();

        // 1. İşlem başlıyor
        this.showProgress(this.t('runtime.app.adding_cta_named', 'CTA Ekleniyor: {name}...', { name: asset.name }));

        try {
            // Eğer import edilen bir dosya ise, asset.path doğrudur.
            // Eğer built-in asset ise, path düzeltilmeli (örn: resources path)
            // CtaLibrary zaten path'i yönetiyor ama IPC'ye gönderirken absolute path olduğundan emin olunmalı.
            // Şimdilik CtaLibrary.assets içindeki pathler relative olduğu için onları fixlememiz gerekebilir.
            // Ama CtaLibrary sadece select yapıyor, path'i düzenleyip yollamıyor.

            // Eğer asset.isUser ise path zaten absolute.
            // Değilse, absolute path'i bulmaya çalışalım.
            // Not: Web ortamında 'assets/...' çalışır ama ffmpeg için full path gerekir.

            let assetPath = asset.path;
            if (!asset.isUser && !assetPath.includes(':')) { // Basit check: Windows path mi?
                // Relative path, absolute'a çevir
                // Renderer process'indeyiz.
                // Ana process'ten yardım alabiliriz veya process.cwd kullanabiliriz ama renderer'da process.cwd güvenilir değil.
                // En iyisi main process'te `findSfxPath` gibi bir mantık kullanmak veya IPC ile path resolve etmek.
                // Basit çözüm: assetPath'i olduğu gibi yolla, ffmpeg-handler (main) bunu çözsün.
                // Ama `addCtaOverlay` fonksiyonu `getVideoMetadata` çağırıyor, o da absolute path bekliyor.

                // Demo için placeholder kullanılıyorsa, gerçek bir dosya oluşturup onu kullanmalıyız.
                // Şimdilik demo dosyaların var olduğunu varsayalım veya kullanıcıyı uyaralım.
                // "assets/cta/like_demo.webm" gibi.

                // İPUCU: `findSfxPath` main process'teydi. Benzer bir `findAssetPath` main process'te olabilir.
                // Şimdilik assetPath'i olduğu gibi gönderiyoruz.
            }

            const result = await window.api.invoke('add-cta-overlay', {
                mainVideoPath: currentVideoPath,
                ctaPath: assetPath,
                outputPath: outputPath,
                position: options.position,
                scale: options.scale,
                opacity: options.opacity,
                duration: options.duration,
                fade: options.fade,
                sound: options.sound,
                startTime: startTime
            });

            this.hideProgress();

            if (result.success) {
                // Başarılı
                Accessibility.announceComplete(this.t('runtime.app.cta_add_operation', 'CTA ekleme'));
                await this.openFile(outputPath);
            } else {
                // Hata
                Accessibility.announceError(this.t('runtime.app.error_message', 'Hata: {message}', { message: result.error }));
            }

        } catch (err) {
            this.hideProgress();
            console.error(err);
            Accessibility.announceError(this.t('runtime.app.unexpected_error_message', 'Beklenmeyen hata: {message}', { message: err.message }));
        }
    },

    /**
     * Sadece altyazı gömme işlemini gerçekleştirir
     */
    async performSubtitleBurn(subtitlePath, styleOptions = null) {
        console.log('[App] performSubtitleBurn started:', subtitlePath);
        this.showProgress(this.t('runtime.app.burning_subtitles', 'Altyazı gömülüyor...'));
        const outputPath = this.currentFilePath.replace(/\.[^.]+$/, '_sub.mp4');

        const result = await window.api.burnSubtitles({
            videoPath: this.currentFilePath,
            subtitlePath: subtitlePath,
            outputPath: outputPath,
            styleOptions
        });

        console.log('[App] burnSubtitles result:', result);
        this.hideProgress();

        if (result.success) {
            Accessibility.announceComplete(this.t('runtime.app.subtitle_burn_operation', 'Altyazı gömme'));
            console.log('[App] Opening burnt file:', outputPath);
            await this.openFile(outputPath);
        } else {
            console.error('[App] Burn failed:', result.error);
            Accessibility.announceError(result.error);
        }
    },

    /**
     * Video döndür
     * @param {number} degrees
     */
    async rotateVideo(degrees) {
        if (!VideoPlayer.hasVideo()) return;

        this.showProgress(this.t('runtime.app.rotating_video', 'Video döndürülüyor'));

        const outputPath = this.currentFilePath.replace(/\.[^.]+$/, `_rotated${degrees}.mp4`);

        const result = await window.api.rotateVideo({
            inputPath: this.currentFilePath,
            outputPath: outputPath,
            degrees: degrees
        });

        this.hideProgress();

        if (result.success) {
            Accessibility.announceComplete(this.t('runtime.app.rotate_video_operation', 'Video döndürme'));
            await this.openFile(outputPath);
        } else {
            Accessibility.announceError(result.error);
        }
    },

    /**
     * İlerleme göstergesini göster
     * @param {string} message
     */
    showProgress(message) {
        const overlay = document.getElementById('progress-overlay');
        const messageEl = document.getElementById('progress-message');
        const bar = document.getElementById('progress-bar');
        const percentEl = document.getElementById('progress-percent');

        // Durum Çubuğu Elementleri
        const statusBarText = document.getElementById('status-bar-text');
        const statusBarPercent = document.getElementById('status-bar-percent');

        if (overlay) {
            overlay.classList.remove('hidden');
            messageEl.textContent = message + '...';
            bar.value = 0;
            percentEl.textContent = '%0';
        }

        if (statusBarText) statusBarText.textContent = message + '...';
        if (statusBarPercent) statusBarPercent.textContent = '%0';

        this.resetProgressEstimate();
        this._announcedFinalizeExport = false;

        // Klavye kısayollarını devre dışı bırak
        Keyboard.setEnabled(false);
    },

    /**
     * İlerleme göstergesini gizle
     */
    hideProgress() {
        const overlay = document.getElementById('progress-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }

        // Durum Çubuğu Elementleri - Sıfırla
        const statusBarText = document.getElementById('status-bar-text');
        const statusBarPercent = document.getElementById('status-bar-percent');

        if (statusBarText) statusBarText.textContent = this.t('player.status_ready', 'Hazır');
        if (statusBarPercent) statusBarPercent.textContent = '';

        this.stopSyntheticConcatProgress();
        this.resetProgressEstimate();
        this._announcedFinalizeExport = false;

        // Klavye kısayollarını etkinleştir
        Keyboard.setEnabled(true);
    },

    resetProgressEstimate() {
        this._progressEstimateState = {
            operation: null,
            lastPercent: 0,
            points: []
        };
    },

    stopSyntheticConcatProgress() {
        if (this._syntheticConcatProgressTimer) {
            clearInterval(this._syntheticConcatProgressTimer);
            this._syntheticConcatProgressTimer = null;
        }
        this._syntheticConcatProgressValue = null;
        this._syntheticConcatProgressBase = null;
        this._syntheticConcatProgressLastReal = null;
    },

    ensureSyntheticConcatProgress(realPercent) {
        const safeReal = Math.max(0, Math.min(100, Number(realPercent) || 0));

        if (safeReal >= 100) {
            this.stopSyntheticConcatProgress();
            return;
        }

        this._syntheticConcatProgressBase = safeReal;
        this._syntheticConcatProgressLastReal = safeReal;

        if (this._syntheticConcatProgressValue == null || this._syntheticConcatProgressValue < safeReal) {
            this._syntheticConcatProgressValue = safeReal;
        }

        if (this._syntheticConcatProgressTimer) {
            return;
        }

        this._syntheticConcatProgressTimer = setInterval(() => {
            if (this._syntheticConcatProgressValue == null) return;
            const current = this._syntheticConcatProgressValue;
            const floor = Math.max(90, this._syntheticConcatProgressBase || 0);
            const target = Math.min(99, floor + 8);

            if (current >= target) {
                return;
            }

            const remaining = target - current;
            const step = remaining > 3 ? 0.4 : remaining > 1 ? 0.2 : 0.08;
            this._syntheticConcatProgressValue = Math.min(target, current + step);
            this.renderProgressState('concat', this._syntheticConcatProgressValue, true);
        }, 400);
    },

    renderProgressState(operation, percent, skipMilestones = false, meta = null) {
        const bar = document.getElementById('progress-bar');
        const percentEl = document.getElementById('progress-percent');
        const roundedPercent = Math.round(percent || 0);
        const etaSeconds = this.getProgressEstimate(operation, roundedPercent);
        const isFinalizingExport = operation === 'finalize-export' && roundedPercent < 100;
        const etaSuffix = etaSeconds != null
            ? this.t('runtime.app.progress_eta_suffix', ' · Yaklaşık {eta} kaldı', {
                eta: this.formatProgressEta(etaSeconds)
            })
            : '';
        const progressLabel = isFinalizingExport
            ? this.t('runtime.app.progress_finalizing_label', 'Son aşama')
            : `%${roundedPercent}${etaSuffix}`;
        const stepSuffix = meta && Number.isFinite(Number(meta.current)) && Number.isFinite(Number(meta.total)) && Number(meta.total) > 0
            ? this.t('runtime.app.progress_step_suffix', ' · Parça {current}/{total}', {
                current: Math.max(1, Math.round(Number(meta.current))),
                total: Math.max(1, Math.round(Number(meta.total)))
            })
            : '';
        const fullProgressLabel = `${progressLabel}${stepSuffix}`;

        if (bar && percentEl) {
            bar.value = roundedPercent;
            percentEl.textContent = fullProgressLabel;
        }

        const operationNames = {
            'cut': this.t('runtime.app.operation_cut', 'Video kesme'),
            'concat': this.t('runtime.app.operation_concat', 'Video birleştirme'),
            'render-timeline': this.t('runtime.app.operation_render_timeline', 'Zaman çizelgesi işleniyor'),
            'finalize-export': this.t('runtime.app.operation_finalize_export', 'Çıktı dosyası tamamlanıyor'),
            'rotate': this.t('runtime.app.operation_rotate', 'Video döndürme'),
            'extract-audio': this.t('runtime.app.operation_extract_audio', 'Ses çıkarma'),
            'extract-video': this.t('runtime.app.operation_extract_video', 'Video çıkarma'),
            'mix-audio': this.t('runtime.app.operation_mix_audio', 'Ses miksajı'),
            'mix-audio-advanced': this.t('runtime.app.operation_mix_audio_advanced', 'Gelişmiş ses miksajı'),
            'burn-subtitles': this.t('runtime.app.operation_burn_subtitles', 'Altyazı gömme'),
            'add-text': this.t('runtime.app.operation_add_text', 'Metin ekleme'),
            'add-image': this.t('runtime.app.image_add_operation', 'G?rsel ekleme'),
            'images-to-video': this.t('runtime.app.operation_images_to_video', 'Video oluşturma'),
            'convert': this.t('runtime.app.operation_convert', 'Video dönüştürme'),
            'apply-cta-smart': this.t('runtime.app.operation_apply_cta', 'CTA overlay ekleme')
        };
        const operationName = operationNames[operation] || operation || this.t('runtime.app.operation_processing', 'İşleniyor');

        const statusBarText = document.getElementById('status-bar-text');
        const statusBarPercent = document.getElementById('status-bar-percent');

        if (statusBarText) statusBarText.textContent = `${operationName}...`;
        if (statusBarPercent) statusBarPercent.textContent = fullProgressLabel;

        if (isFinalizingExport) {
            if (!this._announcedFinalizeExport) {
                this._announcedFinalizeExport = true;
                Accessibility.announce(this.t(
                    'runtime.app.progress_finalizing_announcement',
                    'Son aşamaya geçildi. Çıktı dosyası tamamlanıyor.'
                ));
            }
        } else {
            this._announcedFinalizeExport = false;
        }

        if (!skipMilestones) {
            const milestone = Math.floor(roundedPercent / 10) * 10;
            if (this._lastProgressMilestone === undefined) {
                this._lastProgressMilestone = -1;
            }
            if (milestone > this._lastProgressMilestone && milestone > 0) {
                this._lastProgressMilestone = milestone;
                Accessibility.announce(this.t('runtime.app.progress_percent', '{operation}: Yüzde {percent}', {
                    operation: operationName,
                    percent: milestone
                }));
            }
            if (roundedPercent >= 100) {
                this._lastProgressMilestone = -1;
            }

            if (this._lastPlayedPercent !== roundedPercent && roundedPercent > 0 && roundedPercent < 100) {
                this._lastPlayedPercent = roundedPercent;
                if (roundedPercent % 2 === 0) {
                    if (Utils && Utils.playProgressTone) Utils.playProgressTone(roundedPercent);
                }
            }
        }
    },

    formatProgressEta(seconds) {
        const totalSeconds = Math.max(0, Math.round(seconds || 0));
        const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));

        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        if (hours <= 0) {
            return this.t('runtime.app.duration_minutes_short', '{count} dk', {
                count: totalMinutes
            });
        }

        const hourText = this.t('runtime.app.duration_hours_short', '{count} sa', {
            count: hours
        });
        if (minutes <= 0) {
            return hourText;
        }

        const minuteText = this.t('runtime.app.duration_minutes_short', '{count} dk', { count: minutes });
        return `${hourText} ${minuteText}`;
    },

    getProgressEstimate(operation, percent) {
        const now = Date.now();
        const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));

        if (!this._progressEstimateState) {
            this.resetProgressEstimate();
        }

        const state = this._progressEstimateState;
        const operationChanged = state.operation !== operation;
        const movedBackward = safePercent + 1 < (state.lastPercent || 0);

        if (operationChanged || movedBackward || safePercent <= 0 || safePercent >= 100) {
            state.operation = operation;
            state.lastPercent = safePercent;
            state.points = safePercent > 0 && safePercent < 100
                ? [{ time: now, percent: safePercent }]
                : [];
            return null;
        }

        const lastPoint = state.points[state.points.length - 1];
        if (!lastPoint || safePercent > lastPoint.percent) {
            state.points.push({ time: now, percent: safePercent });
            if (state.points.length > 8) {
                state.points.shift();
            }
        }

        state.lastPercent = safePercent;

        if (state.points.length < 3) {
            return null;
        }

        const firstPoint = state.points[0];
        const latestPoint = state.points[state.points.length - 1];
        const elapsedSeconds = (latestPoint.time - firstPoint.time) / 1000;
        const progressed = latestPoint.percent - firstPoint.percent;

        if (elapsedSeconds < 4 || progressed < 2) {
            return null;
        }

        const percentPerSecond = progressed / elapsedSeconds;
        if (!isFinite(percentPerSecond) || percentPerSecond <= 0) {
            return null;
        }

        const remainingSeconds = (100 - safePercent) / percentPerSecond;
        if (!isFinite(remainingSeconds) || remainingSeconds < 120 || remainingSeconds > 24 * 3600) {
            return null;
        }

        return remainingSeconds;
    },

    /**
     * İlerlemeyi güncelle
     * @param {string} operation - İşlem kodu (örn: 'cut', 'concat')
     * @param {number} percent - Yüzde (0-100)
     */
    updateProgress(operation, percent, meta = null) {
        const roundedPercent = Math.round(percent || 0);

        if (operation === 'concat' && roundedPercent >= 90 && roundedPercent < 100) {
            this.ensureSyntheticConcatProgress(roundedPercent);
            this.renderProgressState(operation, Math.max(roundedPercent, this._syntheticConcatProgressValue || roundedPercent), false, meta);
            return;
        }

        if (operation !== 'concat' || roundedPercent >= 100) {
            this.stopSyntheticConcatProgress();
        }

        this.renderProgressState(operation, roundedPercent, false, meta);
    },

    /**
     * Dosya kapatma isteğini işle
     */
    async handleFileCloseRequest() {
        if (!VideoPlayer.hasVideo()) {
            Accessibility.announce(this.t('runtime.app.no_open_file', 'Açık dosya yok'));
            return;
        }

        if (this.hasChanges) {
            // Kaydetme onayı iste
            const result = await window.api.showSaveConfirm({
                title: this.t('runtime.app.save_changes_title', 'Değişiklikleri Kaydet'),
                message: this.t('runtime.app.unsaved_changes', 'Videoda kaydedilmemiş değişiklikler var. Kaydetmek istiyor musunuz?')
            });

            // 0 = Kaydet, 1 = Kaydetme, 2 = İptal
            if (result === 0) {
                // Kaydet
                await this.saveFile();
                this.closeCurrentFile();
            } else if (result === 1) {
                // Kaydetme - doğrudan kapat
                this.closeCurrentFile();
            }
            // result === 2 ise İptal - hiçbir şey yapma
        } else {
            this.closeCurrentFile();
        }
    },

    /**
     * Uygulama kapatma isteğini işle
     */
    async handleAppQuitRequest() {
        if (this.hasChanges) {
            // Kaydetme onayı iste
            const result = await window.api.showSaveConfirm({
                title: this.t('runtime.app.save_changes_title', 'Değişiklikleri Kaydet'),
                message: this.t('runtime.app.unsaved_changes', 'Videoda kaydedilmemiş değişiklikler var. Kaydetmek istiyor musunuz?')
            });

            // 0 = Kaydet, 1 = Kaydetme, 2 = İptal
            if (result === 0) {
                // Kaydet ve kapat
                await this.saveFile();
                window.api.sendQuitApp();
            } else if (result === 1) {
                // Kaydetme - doğrudan kapat
                window.api.sendQuitApp();
            }
            // result === 2 ise İptal - hiçbir şey yapma
        } else {
            window.api.sendQuitApp();
        }
    },

    /**
     * Mevcut dosyayı kapat (uygulama açık kalır)
     */
    closeCurrentFile() {
        // Video oynatıcıyı temizle
        VideoPlayer.unloadVideo();

        // Durum değişkenlerini sıfırla
        this.currentFilePath = null;
        this.originalFilePath = null;
        this.hasChanges = false;
        this.clipboard = null;
        this.undoStack = [];
        this.redoStack = [];

        // İşaretçileri ve seçimi temizle
        Markers.clearAll();
        Selection.clear();
        this.clearVerticalClipQueue(false);

        // UI'ı güncelle
        document.getElementById('current-time').textContent = '00:00:00';
        document.getElementById('total-time').textContent = '00:00:00';
        document.getElementById('file-name').textContent = this.t('runtime.app.no_file_opened', 'Dosya açılmadı');

        // Metadata bilgilerini temizle
        document.getElementById('meta-resolution').textContent = '-';
        document.getElementById('meta-framerate').textContent = '-';
        document.getElementById('meta-codec').textContent = '-';
        document.getElementById('meta-size').textContent = '-';
        document.getElementById('meta-orientation').textContent = '-';

        // Bekleyen duyuruları temizle
        Accessibility.clearPending();

        Accessibility.announceImmediate(this.t('runtime.app.file_closed_hint', 'Dosya kapatıldı. Yeni dosya açmak için Control artı O tuşlarına basın.'));
    },

    // Not: showProgress ve hideProgress fonksiyonları yukarıda (satır ~2648-2690) tanımlı

    /**
     * Video dosyası ekle
     * @param {string} filePath - Eklenecek video dosyasının yolu
     */
    async insertVideo(filePath) {
        try {
            // Eklenecek videonun metadata'sını al
            const result = await window.api.getVideoMetadata(filePath);

            if (!result || !result.success || !result.data) {
                Accessibility.alert(this.t('runtime.app.video_info_unavailable', 'Video bilgisi alınamadı'));
                return;
            }

            const insertMetadata = result.data;

            // Eğer hiç video açık değilse veya boş proje ise - ilk video olarak aç
            if (!VideoPlayer.hasVideo() || Timeline.segments.length === 0) {
                await this.openFile(filePath);
                Accessibility.announce(this.t('runtime.app.file_opened', '{filename} açıldı', {
                    filename: insertMetadata.filename
                }));
                return;
            }

            // Mevcut videonun özelliklerini al
            const sourceMetadata = VideoPlayer.metadata;

            if (!sourceMetadata) {
                Accessibility.alert(this.t('runtime.app.current_video_info_unavailable', 'Mevcut video bilgisi alınamadı'));
                return;
            }

            // Özellikleri karşılaştır
            const propsMatch = this.compareVideoProperties(sourceMetadata, insertMetadata);

            let videoToInsert = filePath;

            if (!propsMatch) {
                // Diyalog göster
                const choice = await Dialogs.showVideoMismatchDialog(sourceMetadata, insertMetadata);

                if (choice === 'cancel') {
                    Accessibility.announce(this.t('runtime.app.video_insert_cancelled', 'Video ekleme iptal edildi'));
                    return;
                }

                if (choice === 'convert') {
                    // Video'yu kaynak özelliklere dönüştür
                    this.showProgress(this.t('runtime.app.converting_video', 'Video dönüştürülüyor...'));

                    // Geçici dosya oluştur
                    const tempPath = filePath.replace(/\.[^.]+$/, '_converted.mp4');

                    const convertResult = await window.api.convertVideo({
                        inputPath: filePath,
                        outputPath: tempPath,
                        options: {
                            width: sourceMetadata.width,
                            height: sourceMetadata.height,
                            fps: sourceMetadata.frameRate,
                            codec: 'h264',
                            bitrate: Math.round(sourceMetadata.bitrate / 1000) || 5000
                        }
                    });

                    this.hideProgress();

                    if (!convertResult.success) {
                        Accessibility.alert(`Dönüştürme hatası: ${convertResult.error}`);
                        return;
                    }

                    videoToInsert = tempPath;
                    Accessibility.announce(this.t('runtime.app.video_converted', 'Video dönüştürüldü'));
                }
            }

            // Video zamanını timeline pozisyonuna çevir
            const videoTime = VideoPlayer.getCurrentTime();
            const timelinePosition = this.videoTimeToTimelinePosition(videoTime);

            console.log(`insertVideo: videoTime=${videoTime.toFixed(2)}, timelinePosition=${timelinePosition.toFixed(2)}`);

            // Timeline'a yeni segment ekle
            const insertDuration = insertMetadata.duration;

            // Yeni segment oluştur
            const newSegment = {
                start: 0,
                end: insertDuration,
                sourceFile: videoToInsert
            };

            // Segment'i timeline'a ekle
            Timeline.insertSegmentAtPosition(timelinePosition, newSegment);

            this.hasChanges = true;

            Accessibility.announce(`Video eklendi: ${insertMetadata.filename}, süre: ${Utils.formatTime(insertDuration)}`);

            // Durum güncelle
            this.updateAfterEdit();

        } catch (error) {
            console.error('Video ekleme hatası:', error);
            Accessibility.alert(`Video eklenirken hata: ${error.message}`);
        }
    },

    /**
     * İki videonun özelliklerini karşılaştır
     * @param {Object} source - Kaynak video özellikleri
     * @param {Object} insert - Eklenecek video özellikleri
     * @returns {boolean} Özellikler uyuşuyor mu
     */
    compareVideoProperties(source, insert) {
        // Çözünürlük kontrolü (±%10 tolerans)
        const widthMatch = Math.abs(source.width - insert.width) < source.width * 0.1;
        const heightMatch = Math.abs(source.height - insert.height) < source.height * 0.1;

        // Kare hızı kontrolü (±2 fps tolerans)
        const fpsMatch = Math.abs(source.frameRate - insert.frameRate) < 2;

        return widthMatch && heightMatch && fpsMatch;
    },

    /**
     * Video zamanını timeline pozisyonuna çevir
     * Multi-source timeline'da video player zamanı segment içindeki offset'i verir,
     * bunu gerçek timeline pozisyonuna çevirmek için segment'i bulup timeline başlangıcını eklemeliyiz
     * @param {number} videoTime - Video player'daki mevcut zaman
     * @returns {number} Timeline pozisyonu
     */
    videoTimeToTimelinePosition(videoTime) {
        const segments = Timeline.segments;
        const currentSource = VideoPlayer.currentFilePath;

        if (!segments || segments.length === 0) {
            return videoTime;
        }

        let timelinePosition = 0;

        // Segment'ler arasında ara
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const segSource = seg.sourceFile || Timeline.sourceFile;
            const segDuration = seg.end - seg.start;

            // Bu segment mevcut kaynak dosyasından mı?
            if (segSource === currentSource || !seg.sourceFile) {
                // Video zamanı bu segment içinde mi?
                if (videoTime >= seg.start && videoTime < seg.end) {
                    // Segment içindeki offset'i ekle
                    const offsetInSegment = videoTime - seg.start;
                    return timelinePosition + offsetInSegment;
                }
            }

            timelinePosition += segDuration;
        }

        // Segment bulunamadıysa timeline sonunu döndür
        return Timeline.getTotalDuration();
    },

    /**
     * Tüm geçişleri videoya uygula
     */
    async applyAllTransitions() {
        if (!this.currentFilePath) {
            Accessibility.announce(this.t('runtime.app.open_video_first', 'Önce bir video açmalısınız'));
            return;
        }

        const transitions = Transitions.getAll();
        if (transitions.length === 0) {
            Accessibility.announce(this.t('runtime.app.no_transitions_to_apply', 'Uygulanacak geçiş yok. Ş tuşu ile geçiş ekleyin.'));
            return;
        }

        // Onay al
        const confirmed = await Dialogs.showAccessibleConfirm(
            this.t('runtime.app.apply_all_transitions_confirm_message', '{count} transitions will be applied to the video. This may take a while. Continue?', { count: transitions.length }),
            this.t('runtime.app.apply_all_transitions_confirm_title', 'Apply Transitions')
        );

        if (!confirmed) {
            Accessibility.announce(this.t('runtime.app.operation_cancelled_short', 'İşlem iptal edildi'));
            return;
        }

        // Kayıt yeri seç
        const saveResult = await window.api.showSaveDialog({
            title: this.t('runtime.app.save_transitioned_video_title', 'Save Transitioned Video'),
            defaultPath: this.currentFilePath.replace(/(\.[^.]+)$/, '_transitions$1'),
            filters: [{ name: this.t('messages.media_files_filter', 'Video Files'), extensions: ['mp4'] }]
        });

        if (!saveResult || saveResult.canceled) {
            Accessibility.announce(this.t('runtime.app.save_location_not_selected', 'Kayıt yeri seçilmedi'));
            return;
        }

        const outputPath = saveResult.filePath;

        // İlerleme göster
        const progressOverlay = document.getElementById('progress-overlay');
        const progressMessage = document.getElementById('progress-message');
        const progressPercent = document.getElementById('progress-percent');
        const progressBar = document.getElementById('progress-bar');

        if (progressOverlay) progressOverlay.classList.remove('hidden');
        if (progressMessage) progressMessage.textContent = this.t('runtime.app.applying_transitions', 'Geçişler uygulanıyor...');
        if (progressPercent) progressPercent.textContent = '0%';
        if (progressBar) progressBar.value = 0;

        Accessibility.announce(this.t('runtime.app.applying_transitions_announce', `${transitions.length} geçiş uygulanıyor. Lütfen bekleyin.`, { count: transitions.length }));

        try {
            // Smart Transition Kullanımı
            // V102: defaultSfx yolunu da gönder
            const smartTransitions = transitions.map(t => {
                // customSfxPath yoksa defaultSfx'i kullan
                let sfxPath = t.customSfxPath;
                if (!sfxPath && t.defaultSfx) {
                    // defaultSfx'i tam yola çevir
                    sfxPath = `assets/sfx/${t.defaultSfx}`;
                }
                return {
                    transitionType: t.ffmpegType,
                    time: t.time,
                    duration: t.duration,
                    useSfx: t.useSfx !== false,
                    customSfxPath: sfxPath,
                    transitionName: t.transitionName
                };
            });

            // İlerleme dinleyicisi ekle
            const progressListener = (data) => {
                if (data.operation === 'apply-transitions') {
                    if (progressPercent) progressPercent.textContent = `${Math.round(data.percent)}%`;
                    if (progressBar) progressBar.value = data.percent;
                }
            };

            // Listener'ı kaydet (IPC üzerinden gelecek)
            window.api.onFfmpegProgress(progressListener);

            const result = await window.api.applyTransitionsSmart({
                videoPath: this.currentFilePath,
                outputPath: outputPath,
                transitions: smartTransitions
            });

            // Listener'ı temizle (Gerekirse, ama app.js global olduğu için kalabilir veya 
            // removeAllListeners ile temizlenebilir ama diğer işlemleri etkileyebilir.
            // Şimdilik kalsın, zaten üstüne yazar.)

            if (!result.success) {
                throw new Error(result.error || this.t('runtime.app.transition_apply_failed', 'Geçiş uygulanamadı'));
            }

            if (progressOverlay) progressOverlay.classList.add('hidden');

            Accessibility.announce(this.t(
                'runtime.app.transitions_applied_saved',
                'Tamamlandı. {count} geçiş başarıyla uygulandı. Video kaydedildi: {path}',
                { count: transitions.length, path: outputPath }
            ));

            // Yeni videoyu aç
            const openNew = await Dialogs.showAccessibleConfirm(
                this.t('runtime.app.transitions_open_new_message', 'Geçişler başarıyla uygulandı. Yeni videoyu açmak ister misiniz?'),
                this.t('runtime.app.completed_title', 'Tamamlandı')
            );

            if (openNew) {
                await this.openFile(outputPath);
            }

        } catch (error) {
            if (progressOverlay) progressOverlay.classList.add('hidden');
            console.error('Geçiş uygulama hatası:', error);
            Accessibility.announce(this.t('runtime.app.error_message', 'Hata: {message}', { message: error.message }));
        }
    },
    // ==========================================
    // Proje Yönetimi
    // ==========================================

    /**
     * Projeyi Kaydet
     */
    async saveProject() {
        if (!this.currentFilePath) {
            Accessibility.announce(this.t('runtime.app.no_project_to_save', 'Kaydedilecek bir proje yok (video yüklenmedi).'));
            return;
        }

        try {
            // CTA overlay'leri al
            const ctaOverlays = typeof CtaOverlayPreview !== 'undefined'
                ? CtaOverlayPreview.exportForProject()
                : [];
            const currentSelection = (typeof Selection !== 'undefined' && Selection.hasSelection && Selection.hasSelection())
                ? Selection.getSelection()
                : null;
            const playbackPosition = (typeof VideoPlayer !== 'undefined' && typeof VideoPlayer.getTimelineTime === 'function')
                ? Number(VideoPlayer.getTimelineTime() || 0)
                : 0;

            const projectData = {
                videoPath: this.currentFilePath,
                timeline: {
                    segments: Timeline.getSegments(),
                    sourceFile: Timeline.sourceFile,
                    sourceDuration: Timeline.sourceDuration
                },
                selection: currentSelection ? {
                    start: currentSelection.start,
                    end: currentSelection.end
                } : null,
                playbackPosition,
                verticalClipQueue: this.getVerticalClipQueueSnapshot(),
                insertionQueue: InsertionQueue.getItems(),
                transitions: Transitions.getAll(),
                markers: Markers.getAll ? Markers.getAll() : [],
                ctaOverlays: ctaOverlays,
                version: '1.3'
            };

            const result = await window.api.showSaveDialog({
                title: this.t('runtime.app.save_project_title', 'Projeyi Kaydet'),
                defaultPath: 'proje.kve',
                filters: [{ name: this.t('runtime.app.project_file_filter', 'Korcul Proje Dosyası'), extensions: ['kve'] }]
            });

            if (!result.canceled && result.filePath) {
                const jsonContent = JSON.stringify(projectData, null, 2);
                const saveResult = await window.api.saveFileContent({
                    filePath: result.filePath,
                    content: jsonContent
                });

                if (saveResult.success) {
                    Accessibility.announce(this.t('runtime.app.project_saved', 'Proje başarıyla kaydedildi.'));
                } else {
                    Accessibility.announce(this.t('runtime.app.save_error', 'Kaydetme hatası: {error}', {
                        error: saveResult.error
                    }));
                }
            }
        } catch (error) {
            console.error(error);
            Accessibility.announce(this.t('runtime.app.project_save_failed', 'Proje kaydedilemedi: {error}', {
                error: error.message
            }));
        }
    },

    /**
     * Projeyi Yükle
     */
    async loadProject() {
        try {
            const result = await window.api.openFileDialog({
                title: this.t('runtime.app.open_project_title', 'Proje Aç'),
                filters: [{ name: this.t('messages.project_filters.all_projects', 'Tüm Projeler (*.kve, *.eng)'), extensions: ['kve', 'eng'] }],
                properties: ['openFile']
            });

            if (result.canceled || result.filePaths.length === 0) return;
            const projectPath = result.filePaths[0];
            const extension = String(projectPath || '').toLowerCase().split('.').pop();
            if (extension === 'eng') {
                window.api.addRecentFile?.(projectPath).catch(() => {});
                window.api.send('slideshow-open-project-file', projectPath);
                return;
            }
            await this.loadProjectFromPath(projectPath);
        } catch (error) {
            console.error('Project load error:', error);
            Accessibility.announce(this.t('runtime.app.project_load_failed', 'Proje yüklenemedi: {error}', {
                error: error.message
            }));
        }
    },

    async loadProjectFromPath(projectPath) {
        try {
            const contentResult = await window.api.readFileContent(projectPath);
            if (!contentResult.success) {
                Accessibility.announce(this.t('runtime.app.file_read_failed', 'Dosya okunamadı: {error}', {
                    error: contentResult.error
                }));
                return;
            }

            const projectData = JSON.parse(contentResult.content);
            window.api.addRecentFile?.(projectPath).catch(() => {});

            if (projectData.videoPath) {
                let videoToLoad = projectData.videoPath;
                let videoFound = false;

                const checkAbs = await window.api.checkFileExists(videoToLoad);
                if (checkAbs) {
                    videoFound = true;
                } else {
                    const projectDir = projectPath.replace(/[/\\][^/\\]+$/, '');
                    const fileName = videoToLoad.split(/[/\\]/).pop();
                    const relativePath = projectDir + (projectDir.includes('/') ? '/' : '\\') + fileName;

                    const checkRel = await window.api.checkFileExists(relativePath);
                    if (checkRel) {
                        videoToLoad = relativePath;
                        videoFound = true;
                        console.log('Video proje klasöründe bulundu:', videoToLoad);
                    }
                }

                if (!videoFound) {
                    const userChoice = await Dialogs.showAccessibleConfirm(
                        this.t(
                            'runtime.app.project_video_missing',
                            'Projedeki video dosyası ({filename}) bulunamadı. Yerini kendiniz göstermek ister misiniz?',
                            { filename: videoToLoad.split(/[/\\]/).pop() }
                        ),
                        this.t('runtime.app.browse', 'Gözat'),
                        this.t('dialog.cancel', 'İptal')
                    );

                    if (userChoice) {
                        const manualSelect = await window.api.openFileDialog({
                            title: this.t('runtime.app.find_video_file', 'Video Dosyasını Bul'),
                            filters: [{ name: this.t('runtime.app.video_files_filter', 'Video Dosyaları'), extensions: ['mp4', 'wmv', 'avi', 'mkv', 'mov', 'webm', 'flv', '3gp', 'mpg', 'mpeg', 'vob', 'm4v', 'ts', 'mts', 'm2ts'] }],
                            properties: ['openFile']
                        });

                        if (!manualSelect.canceled && manualSelect.filePaths.length > 0) {
                            videoToLoad = manualSelect.filePaths[0];
                            videoFound = true;
                        } else {
                            Accessibility.announce(this.t('runtime.app.project_load_cancelled_no_video', 'Video seçilmedi. Proje yükleme iptal edildi.'));
                            return;
                        }
                    } else {
                        Accessibility.announce(this.t('runtime.app.project_load_failed_video_missing', 'Video bulunamadığı için proje yüklenemedi.'));
                        return;
                    }
                }

                try {
                    await this.openFile(videoToLoad, false);
                } catch (e) {
                    Accessibility.announce(this.t('runtime.app.video_file_open_failed', 'Video dosyası açılamadı.'));
                    console.error('Video open error:', e);
                    return;
                }
            }

            if (projectData.timeline) {
                Timeline.restoreState(
                    projectData.timeline.segments,
                    projectData.timeline.sourceFile || projectData.videoPath,
                    projectData.timeline.sourceDuration || VideoPlayer.getDuration()
                );
            }

            if (typeof Selection !== 'undefined' && typeof Selection.clear === 'function') {
                Selection.clear(true);
            }
            if (projectData.selection
                && Number.isFinite(projectData.selection.start)
                && Number.isFinite(projectData.selection.end)
                && projectData.selection.end > projectData.selection.start
                && typeof Selection !== 'undefined'
                && typeof Selection.setSelection === 'function') {
                Selection.setSelection(projectData.selection.start, projectData.selection.end);
            }

            this.verticalClipQueue.length = 0;
            if (Array.isArray(projectData.verticalClipQueue) && projectData.verticalClipQueue.length > 0) {
                this.verticalClipQueue.push(...projectData.verticalClipQueue
                    .filter((clip) => clip && clip.sourcePath && Number.isFinite(clip.startTime) && Number.isFinite(clip.endTime))
                    .map((clip, index) => ({
                        ...clip,
                        id: clip.id || `vertical_clip_restored_${Date.now()}_${index + 1}`,
                        label: clip.label || this.t('runtime.app.selection_item_label', 'Seçim {index}', { index: String(index + 1) })
                    })));
            }

            if (projectData.insertionQueue) {
                InsertionQueue.restore(projectData.insertionQueue);
            }

            if (projectData.ctaOverlays && typeof CtaOverlayPreview !== 'undefined') {
                CtaOverlayPreview.importFromProject(projectData.ctaOverlays);
            }

            if (projectData.transitions) {
                Transitions.restore(projectData.transitions);
                Dialogs.updateAppliedTransitionList();
            }

            console.log('Restoring markers...', projectData.markers);
            if (projectData.markers && typeof Markers !== 'undefined' && Markers.restore) {
                Markers.restore(projectData.markers);
                console.log('Markers restored successfully.');
            } else {
                console.warn('Markers restoration skipped:', {
                    hasData: !!projectData.markers,
                    markersModule: typeof Markers !== 'undefined',
                    hasRestore: Markers && !!Markers.restore
                });
            }

            if (Number.isFinite(projectData.playbackPosition)
                && typeof VideoPlayer !== 'undefined'
                && typeof VideoPlayer.seekToTimelineTime === 'function') {
                VideoPlayer.seekToTimelineTime(projectData.playbackPosition);
            }

            Accessibility.announce(this.t('runtime.app.project_loaded', 'Proje başarıyla yüklendi.'));
        } catch (error) {
            console.error('Project load error:', error);
            Accessibility.announce(this.t('runtime.app.project_load_failed', 'Proje yüklenemedi: {error}', {
                error: error.message
            }));
        }
    },

    /**
     * Uygulama kapatma isteğini işle
     */
    async handleAppQuitRequest() {
        // Kaydedilmemiş değişiklik kontrolü
        if (this.hasChanges || Timeline.hasChanges) {
            const result = await Dialogs.showAccessibleChoice({
                title: this.t('runtime.app.save_changes_title', 'Değişiklikleri Kaydet'),
                message: this.t('runtime.app.unsaved_changes', 'Videoda kaydedilmemiş değişiklikler var. Kaydetmek istiyor musunuz?'),
                buttons: [
                    this.t('menu.file.save', 'Kaydet'),
                    this.t('runtime.app.dont_save', 'Kaydetme'),
                    this.t('dialog.cancel', 'İptal')
                ],
                cancelValue: 2,
                focusIndex: 0
            });

            if (result === 0) {
                await this.saveFile();
                if (this.hasChanges || Timeline.hasChanges) {
                    return;
                }
            } else if (result === 1) {
                window.api.sendQuitApp();
                return;
            } else {
                return;
            }
        }

        window.api.sendQuitApp();
    },

    /**
     * Dosya kapatma isteğini işle
     */
    async handleFileCloseRequest() {
        if (!VideoPlayer.hasVideo()) {
            Accessibility.announce(this.t('runtime.app.no_open_file', 'Açık dosya yok'));
            return;
        }

        // Kaydedilmemiş değişiklik kontrolü
        if (this.hasChanges || Timeline.hasChanges) {
            const result = await Dialogs.showAccessibleChoice({
                title: this.t('runtime.app.save_changes_title', 'Değişiklikleri Kaydet'),
                message: this.t('runtime.app.unsaved_changes', 'Videoda kaydedilmemiş değişiklikler var. Kaydetmek istiyor musunuz?'),
                buttons: [
                    this.t('menu.file.save', 'Kaydet'),
                    this.t('runtime.app.dont_save', 'Kaydetme'),
                    this.t('dialog.cancel', 'İptal')
                ],
                cancelValue: 2,
                focusIndex: 0
            });

            if (result === 0) {
                await this.saveFile();
                if (this.hasChanges || Timeline.hasChanges) {
                    return;
                }
            } else if (result === 1) {
                this.closeCurrentFile();
                Accessibility.announce(this.t('runtime.app.file_closed', 'Dosya kapatıldı'));
                return;
            } else {
                return;
            }
        }

        this.closeCurrentFile();
        Accessibility.announce(this.t('runtime.app.file_closed', 'Dosya kapatıldı'));
    }
};

// Sayfa yüklendiğinde başlat
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

// Global olarak erişilebilir yap
// Eksik fonksiyonu ekle
App.addAudioToVideo = async function (options) {
    if (!this.currentFilePath) {
        Accessibility.alert(this.t('runtime.app.open_video_first', 'Önce bir video açmalısınız'));
        return;
    }
    const result = await window.api.showSaveDialog({
        title: this.t('runtime.app.save_video_title', 'Videoyu Kaydet'),
        defaultPath: `video_mixed_${Date.now()}.mp4`,
        filters: [{ name: this.t('runtime.app.mp4_video_filter', 'MP4 Video'), extensions: ['mp4'] }]
    });
    if (result.canceled || !result.filePath) return;
    this.showProgress(this.t('runtime.app.adding_audio', 'Ses ekleniyor...'));
    try {
        const response = await window.api.mixAudio({
            videoPath: this.currentFilePath,
            audioPath: options.audioPath,
            outputPath: result.filePath,
            videoVolume: options.sourceVolume,
            audioVolume: options.targetVolume,
            loop: options.asBackground,
            trimStart: options.trimStart,
            trimEnd: options.trimEnd
        });
        this.hideProgress();
        if (response && response.success) {
            Accessibility.announce(this.t('runtime.app.video_created', 'Video oluşturuldu.'));
            if (await Dialogs.showAccessibleConfirm(
                this.t('runtime.app.completed_title', 'Tamamlandı'),
                this.t('runtime.app.video_created_open_prompt', 'Video oluşturuldu. Açmak ister misiniz?')
            )) await this.openFile(result.filePath);
        } else throw new Error(response?.error);
    } catch (e) {
        this.hideProgress();
        console.error(e);
        Accessibility.announceError(this.t('runtime.app.error_message', 'Hata: {message}', { message: e.message }));
    }
};

window.App = App;
