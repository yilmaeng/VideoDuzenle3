/**
 * Klavye Modülü
 * Tüm klavye kısayollarının yönetimi (Konfigüre edilebilir)
 */

const Keyboard = {
    isEnabled: true,

    t(key, fallback, params = {}) {
        if (!window.i18nHelper) return fallback;
        const value = window.i18nHelper.t(key, params);
        return value && !value.startsWith('[') ? value : fallback;
    },

    getApplyTransitionBindings() {
        return this.getCurrentLanguage().startsWith('tr') ? ['ş', 'Ş'] : ['t', 'T'];
    },

    getCurrentLanguage() {
        return (window.i18nHelper?.getCurrentLanguage?.() || document.documentElement.lang || 'tr').toLowerCase();
    },

    getLocalizedCategory(category) {
        if (category === 'Kayıt Global Kısayolları') {
            return this.t('dialog.keyboard_manager.category_recording_global', 'Recording Global Shortcuts');
        }
        if (category === 'Yayın Odası') {
            return this.t('dialog.keyboard_manager.category_broadcast_room', 'Broadcast Room');
        }
        const lang = this.getCurrentLanguage();
        const labels = {
            'Dosya': { tr: 'Dosya', en: 'File' },
            'Düzenleme': { tr: 'Düzenleme', en: 'Edit' },
            'Oynatma': { tr: 'Oynatma', en: 'Playback' },
            'Navigasyon': { tr: 'Navigasyon', en: 'Navigation' },
            'İşaretçiler': { tr: 'İşaretçiler', en: 'Markers' },
            'Seçim': { tr: 'Seçim', en: 'Selection' },
            'Araçlar': { tr: 'Araçlar', en: 'Tools' },
            'Yapay Zeka': { tr: 'Yapay Zeka', en: 'AI' },
            'Yardım': { tr: 'Yardım', en: 'Help' },
            'Genel': { tr: 'Genel', en: 'General' },
            'Ekle': { tr: 'Ekle', en: 'Insert' },
            'Erişilebilir Kayıt': { tr: 'Erişilebilir Kayıt', en: 'Accessible Recording' },
            'Görünüm': { tr: 'Görünüm', en: 'View' }
        };
        return labels[category]?.[lang.startsWith('en') ? 'en' : 'tr'] || category;
    },

    getLocalizedActionLabel(actionId, fallbackLabel) {
        const translated = this.t(`dialog.keyboard_manager.actions.${actionId}`, '');
        if (translated) {
            return translated;
        }
        const lang = this.getCurrentLanguage();
        const labels = {
            newProject: { tr: 'Yeni Proje', en: 'New Project' },
            openProject: { tr: 'Proje Aç (.kve, .eng)', en: 'Open Project (.kve, .eng)' },
            saveProject: { tr: 'Projeyi Kaydet (.kve)', en: 'Save Project (.kve)' },
            openVideo: { tr: 'Video Aç', en: 'Open Video' },
            saveVideo: { tr: 'Videoyu Kaydet/Dışa Aktar', en: 'Save or Export Video' },
            saveAs: { tr: 'Farklı Kaydet', en: 'Save As' },
            closeFile: { tr: 'Dosyayı Kapat', en: 'Close File' },
            tabNext: { tr: 'Sonraki Sekme', en: 'Next Tab' },
            tabPrev: { tr: 'Önceki Sekme', en: 'Previous Tab' },
            closeTab: { tr: 'Sekmeyi Kapat', en: 'Close Tab' },
            exitApp: { tr: 'Çıkış', en: 'Exit' },
            undo: { tr: 'Geri Al', en: 'Undo' },
            redo: { tr: 'Yinele', en: 'Redo' },
            cut: { tr: 'Kes', en: 'Cut' },
            copy: { tr: 'Kopyala', en: 'Copy' },
            paste: { tr: 'Yapıştır', en: 'Paste' },
            delete: { tr: 'Sil', en: 'Delete' },
            selectAll: { tr: 'Tümünü Seç', en: 'Select All' },
            addMarker: { tr: 'İşaretçi Ekle', en: 'Add Marker' },
            applyTransition: { tr: 'Varsayılan Geçiş Ekle', en: 'Add Default Transition' },
            transitionLib: { tr: 'Geçiş Kütüphanesi', en: 'Transition Library' },
            applyAllTrans: { tr: 'Tümüne Geçiş Uygula', en: 'Apply Transitions to All' },
            changeSpeed: { tr: 'Seçili Alanın Hızını Değiştir', en: 'Change Speed of Selected Area' },
            togglePlay: { tr: 'Oynat/Duraklat', en: 'Play/Pause' },
            playSelection: { tr: 'Seçimi Oynat', en: 'Play Selection' },
            playCutPreview: { tr: 'Kesim Önizleme (Seçimsiz)', en: 'Preview Cut (No Selection)' },
            pauseAt: { tr: 'Duraklat (İmleçsiz)', en: 'Pause at Position' },
            pauseAndSet: { tr: 'Duraklat ve Konumla', en: 'Pause and Set Cursor' },
            skipSilence: { tr: 'Sessizliği Atla', en: 'Skip Silence' },
            scrubRight: { tr: 'İleri (İnce)', en: 'Seek Forward (Fine)' },
            scrubLeft: { tr: 'Geri (İnce)', en: 'Seek Backward (Fine)' },
            scrubRight30: { tr: '30 Saniye İleri', en: 'Forward 30 Seconds' },
            scrubLeft30: { tr: '30 Saniye Geri', en: 'Backward 30 Seconds' },
            scrubRight5m: { tr: '5 Dakika İleri', en: 'Forward 5 Minutes' },
            scrubLeft5m: { tr: '5 Dakika Geri', en: 'Backward 5 Minutes' },
            seekF5: { tr: '5 Saniye İleri', en: 'Forward 5 Seconds' },
            seekB5: { tr: '5 Saniye Geri', en: 'Backward 5 Seconds' },
            goToStart: { tr: 'Başa Git', en: 'Go to Start' },
            goToEnd: { tr: 'Sona Git', en: 'Go to End' },
            goToMiddle: { tr: 'Ortaya Git', en: 'Go to Middle' },
            goToBeforeEnd: { tr: 'Sondan 30sn Önce', en: 'Go to 30 Seconds Before End' },
            goToTime: { tr: 'Zaman Koduna Git', en: 'Go to Timecode' },
            markerNext: { tr: 'Sonraki İşaretçi', en: 'Next Marker' },
            markerPrev: { tr: 'Önceki İşaretçi', en: 'Previous Marker' },
            changeFineTune: { tr: 'İnce Ayar Değiştir', en: 'Change Fine-Tune Step' },
            sensIncr: { tr: 'Sarma Adımını Küçült', en: 'Decrease Seek Step' },
            sensDecr: { tr: 'Sarma Adımını Büyüt', en: 'Increase Seek Step' },
            deleteMarker: { tr: 'İşaretçi Sil', en: 'Delete Marker' },
            clearAllMarkers: { tr: 'Tüm İşaretçileri Temizle', en: 'Clear All Markers' },
            markerList: { tr: 'İşaretçi Listesi', en: 'Marker List' },
            selectRight: { tr: 'Sağa Seçim (1sn)', en: 'Select Right (1s)' },
            selectLeft: { tr: 'Sola Seçim (1sn)', en: 'Select Left (1s)' },
            selectToStart: { tr: 'Başa Kadar Seç', en: 'Select to Start' },
            selectToEnd: { tr: 'Sona Kadar Seç', en: 'Select to End' },
            selectRange: { tr: 'Aralık Seç Diyaloğu', en: 'Range Selection Dialog' },
            clearSelection: { tr: 'Seçimi Temizle / İptal', en: 'Clear Selection / Cancel' },
            selectBetweenRight: { tr: 'İşaretçiler Arası Sağa', en: 'Select Right Between Markers' },
            selectBetweenLeft: { tr: 'İşaretçiler Arası Sola', en: 'Select Left Between Markers' },
            selectToMarkerRight: { tr: 'İşaretçiye Kadar Sağa', en: 'Select Right to Marker' },
            selectToMarkerLeft: { tr: 'İşaretçiye Kadar Sola', en: 'Select Left to Marker' },
            insertList: { tr: 'Ekleme Listesi / Kuyruk', en: 'Insertion Queue' },
            objectAnalysis: { tr: 'Nesne Analizi', en: 'Object Analysis' },
            listSilences: { tr: 'Boşlukları Listele', en: 'List Silent Sections' },
            describeSelection: { tr: 'Seçimi Betimle', en: 'Describe Selection' },
            describePosition: { tr: 'Konumu Betimle', en: 'Describe Current Position' },
            smartSelection: { tr: 'Akıllı Seçim', en: 'Smart Selection' },
            shortcuts: { tr: 'Kısayollar Listesi', en: 'Shortcut List' },
            help: { tr: 'Kullanım Kılavuzu', en: 'User Guide' },
            keyboardManager: { tr: 'Klavye Yöneticisi', en: 'Keyboard Manager' },
            sendFeedback: { tr: 'Geri Bildirim Gönder', en: 'Send Feedback' },
            contextMenu: { tr: 'Bağlam Menüsü', en: 'Context Menu' },
            contextMenuAlt: { tr: 'Bağlam Menüsü (Alt)', en: 'Context Menu (Alt)' },
            announceCurrentTime: { tr: 'Mevcut Zamanı Oku', en: 'Read Current Time' },
            exportVideoOnly: { tr: 'Dışa Aktar: Sadece Video (Sessiz)', en: 'Export: Video Only (Muted)' },
            exportAudioOnly: { tr: 'Dışa Aktar: Sadece Ses (.mp3)', en: 'Export: Audio Only (.mp3)' },
            syncAudio: { tr: 'Harici Sesi Senkronla (A)', en: 'Sync External Audio (A)' },
            recordReference: { tr: 'Referans Sesle Kayıt (B)', en: 'Record with Reference Audio (B)' },
            videoProperties: { tr: 'Video Özellikleri', en: 'Video Properties' },
            insertVideo: { tr: 'Video Ekle (Birleştir)', en: 'Insert Video (Merge)' },
            insertAudio: { tr: 'Ses Ekle / Dublaj', en: 'Insert Audio / Voiceover' },
            insertImage: { tr: 'Resim / Slayt Ekle', en: 'Insert Image / Slide' },
            insertText: { tr: 'Metin / Başlık Ekle', en: 'Insert Text / Title' },
            openCtaLibrary: { tr: 'CTA / Overlay Kütüphanesi', en: 'CTA / Overlay Library' },
            insertVideoLayer: { tr: 'Video Katmanı (PiP)', en: 'Insert Video Layer (PiP)' },
            insertSubtitle: { tr: 'Altyazı Ekle (.srt)', en: 'Insert Subtitle (.srt)' },
            createShorts: { tr: 'Dikey Video (Shorts/Reels) Oluştur', en: 'Create Vertical Video (Shorts/Reels)' },
            createShortsFromSelection: { tr: 'Seçili Alanı Dikey Videoya Dönüştür', en: 'Create Vertical Video from Selection' },
            addSelectionToQueue: { tr: 'Seçili Alanı Seçim Listesine Ekle', en: 'Add Selected Range to Selection List' },
            addMarkerPairsToQueue: { tr: 'İşaretçi Çiftlerini Seçim Listesine Ekle', en: 'Add Marker Pairs to Selection List' },
            openSelectionQueue: { tr: 'Seçim Listesi', en: 'Selection List' },
            mergeSelectionQueue: { tr: 'Seçim Listesini Tek Klipte Birleştir', en: 'Merge Selection List into One Clip' },
            createShortsFromQueue: { tr: 'Seçim Listesini Dikey Videoya Dönüştür', en: 'Convert Selection List to Vertical Video' },
            clearSelectionQueue: { tr: 'Seçim Listesini Temizle', en: 'Clear Selection List' },
            openRecordingWizard: { tr: 'Kayıt Sihirbazı', en: 'Recording Wizard' },
            openRecordingInterview: { tr: 'Tam Ekran Çevrim Dışı Önayar', en: 'Fullscreen Offline Preset' },
            openRecordingOfflineZoom: { tr: 'Zoom Çevrim Dışı Önayar', en: 'Zoom Offline Preset' },
            openRecordingOfflineMeet: { tr: 'Google Meet Çevrim Dışı Önayar', en: 'Google Meet Offline Preset' },
            openRecordingOfflineTeams: { tr: 'Microsoft Teams Çevrim Dışı Önayar', en: 'Microsoft Teams Offline Preset' },
            openRecordingBroadcast: { tr: 'Tam Ekran Canlı Yayın', en: 'Fullscreen Live Broadcast' },
            openRecordingBroadcastZoom: { tr: 'Zoom Canlı Yayın', en: 'Zoom Live Broadcast' },
            openRecordingBroadcastMeet: { tr: 'Google Meet Canlı Yayın', en: 'Google Meet Live Broadcast' },
            openRecordingBroadcastTeams: { tr: 'Microsoft Teams Canlı Yayın', en: 'Microsoft Teams Live Broadcast' },
            openRecordingBroadcastChatWatch: { tr: 'YouTube Sohbetini İzle', en: 'Watch YouTube Chat' },
            openLiveEffectsPanel: { tr: 'Canlı Efekt Paneli', en: 'Live Effects Panel' },
            openBroadcastRoom: { tr: 'Yayın Odası', en: 'Broadcast Room' },
            resumeActiveBroadcastWizard: { tr: 'Etkin Canlı Yayına Geri Dön', en: 'Return to Active Live Broadcast' },
            recordingGlobalStartStop: { tr: 'Global: Kaydı veya Yayını Başlat/Durdur', en: 'Global: Start/Stop Recording or Broadcast' },
            recordingGlobalPauseResume: { tr: 'Global: Kaydı Duraklat/Devam Ettir', en: 'Global: Pause/Resume Recording' },
            recordingGlobalToggleSystemAudio: { tr: 'Global: Sistem Sesini Aç/Kapat', en: 'Global: Toggle System Audio' },
            recordingGlobalToggleMicrophone: { tr: 'Global: Mikrofonu Aç/Kapat', en: 'Global: Toggle Microphone' },
            recordingGlobalToggleLiveEffects: { tr: 'Global: Canlı Efekt Katmanını Aç/Kapat', en: 'Global: Toggle Live Effects Layer' },
            recordingGlobalFullscreenCamera: { tr: 'Global: Kamerayı Tam Ekran Yap', en: 'Global: Make Camera Fullscreen' },
            recordingGlobalRestoreLayout: { tr: 'Global: Önceki Düzeni Geri Yükle', en: 'Global: Restore Previous Layout' },
            recordingGlobalHideScreen: { tr: 'Global: Ekranı Gizle veya Geri Aç', en: 'Global: Hide or Restore Screen' },
            recordingGlobalPreviousWindow: { tr: 'Global: Önceki Pencere', en: 'Global: Previous Window' },
            recordingGlobalNextWindow: { tr: 'Global: Sonraki Pencere', en: 'Global: Next Window' },
            recordingGlobalWindowList: { tr: 'Global: Pencere Listesini Aç', en: 'Global: Open Window List' },
            broadcastRoomGlobalToggleYouTubeLive: { tr: 'Yayın Odası: YouTube Canlı Yayını Başlat/Durdur', en: 'Broadcast Room: Start/Stop YouTube Live' },
            broadcastRoomGlobalToggleBotRecording: { tr: 'Yayın Odası: Bot Kaydını Başlat/Durdur', en: 'Broadcast Room: Start/Stop Bot Recording' },
            broadcastRoomGlobalToggleLiveTranslation: { tr: 'Yayın Odası: Canlı Çeviri/Altyazıyı Başlat/Durdur', en: 'Broadcast Room: Start/Stop Live Translation or Captions' },
            broadcastRoomGlobalReadYouTubeStats: { tr: 'Yayın Odası: YouTube İstatistiklerini Oku', en: 'Broadcast Room: Read YouTube Statistics' },
            instantVoiceTranslationGlobalToggle: { tr: 'Anlık Sesli Çeviri: Dinlemeyi Başlat/Durdur', en: 'Instant Spoken Translation: Start/Stop Listening' },
            zoomIn: { tr: 'Yakınlaştır (Timeline)', en: 'Zoom In (Timeline)' },
            zoomOut: { tr: 'Uzaklaştır (Timeline)', en: 'Zoom Out (Timeline)' },
            resetZoom: { tr: 'Yakınlaştırmayı Sıfırla', en: 'Reset Zoom' },
            rotateVideo: { tr: 'Videoyu Döndür (90°)', en: 'Rotate Video (90°)' }
        };
        return labels[actionId]?.[lang.startsWith('en') ? 'en' : 'tr'] || fallbackLabel;
    },

    // Varsayılan Kısayol Tanımları
    // Mod: Ctrl (Win) veya Cmd (Mac)
    // Ctrl: Her zaman Ctrl
    // Alt: Alt/Option
    // Shift: Shift
    ACTIONS: {
        // --- Dosya (File) ---
        'newProject': { default: 'Mod+N', category: 'Dosya', label: 'Yeni Proje' },
        'openProject': { default: 'Ctrl+Shift+O', category: 'Dosya', label: 'Proje Aç (.kve, .eng)' },
        'saveProject': { default: 'Ctrl+Shift+P', category: 'Dosya', label: 'Projeyi Kaydet (.kve)' },
        'openVideo': { default: 'Mod+O', category: 'Dosya', label: 'Video Aç' },
        'saveVideo': { default: 'Mod+S', category: 'Dosya', label: 'Videoyu Kaydet/Dışa Aktar' },
        'saveAs': { default: 'Mod+Shift+S', category: 'Dosya', label: 'Farklı Kaydet' },
        'closeFile': { default: 'Ctrl+F4', category: 'Dosya', label: 'Dosyayı Kapat' },
        'tabNext': { default: 'Ctrl+Tab', category: 'Dosya', label: 'Sonraki Sekme' },
        'tabPrev': { default: 'Ctrl+Shift+Tab', category: 'Dosya', label: 'Önceki Sekme' },
        'closeTab': { default: 'Mod+W', category: 'Dosya', label: 'Sekmeyi Kapat' },
        'exitApp': { default: navigator.userAgent.includes('Mac') ? 'Mod+Q' : 'Alt+F4', category: 'Dosya', label: 'Çıkış' },

        // --- Düzenleme (Edit) ---
        'undo': { default: 'Mod+Z', category: 'Düzenleme', label: 'Geri Al' },
        'redo': { default: ['Mod+Shift+Z', 'Mod+Y'], category: 'Düzenleme', label: 'Yinele' },
        'cut': { default: 'Mod+X', category: 'Düzenleme', label: 'Kes' },
        'copy': { default: 'Mod+C', category: 'Düzenleme', label: 'Kopyala' },
        'paste': { default: 'Mod+V', category: 'Düzenleme', label: 'Yapıştır' },
        'delete': { default: ['Delete', 'Mod+D'], category: 'Düzenleme', label: 'Sil' },
        'selectAll': { default: 'Mod+A', category: 'Düzenleme', label: 'Tümünü Seç' },
        'addMarker': { default: 'M', category: 'İşaretçiler', label: 'İşaretçi Ekle' },
        'applyTransition': { default: null, category: 'Düzenleme', label: 'Varsayılan Geçiş Ekle' },
        'transitionLib': { default: 'Mod+Shift+T', category: 'Düzenleme', label: 'Geçiş Kütüphanesi' },
        'applyAllTrans': { default: 'Mod+T', category: 'Düzenleme', label: 'Tümüne Geçiş Uygula' },
        'changeSpeed': { default: 'Mod+Shift+H', category: 'Düzenleme', label: 'Seçili Alanın Hızını Değiştir' },

        // --- Oynatma (Playback) ---
        'togglePlay': { default: 'Space', category: 'Oynatma', label: 'Oynat/Duraklat' },
        'playSelection': { default: 'Shift+Space', category: 'Oynatma', label: 'Seçimi Oynat' },
        'playCutPreview': { default: 'Ctrl+Shift+Space', category: 'Oynatma', label: 'Kesim Önizleme (Seçimsiz)' },
        'pauseAt': { default: 'K', category: 'Oynatma', label: 'Duraklat (İmleçsiz)' },
        'pauseAndSet': { default: 'Enter', category: 'Oynatma', label: 'Duraklat ve Konumla' },
        'skipSilence': { default: 'Mod+Shift+J', category: 'Oynatma', label: 'Sessizliği Atla' },

        // --- Navigasyon (Navigation) ---
        'scrubRight': { default: 'ArrowRight', category: 'Navigasyon', label: 'İleri (İnce)' },
        'scrubLeft': { default: 'ArrowLeft', category: 'Navigasyon', label: 'Geri (İnce)' },
        'scrubRight30': { default: 'Mod+ArrowRight', category: 'Navigasyon', label: '30 Saniye İleri' },
        'scrubLeft30': { default: 'Mod+ArrowLeft', category: 'Navigasyon', label: '30 Saniye Geri' },
        'scrubRight5m': { default: 'Mod+Alt+ArrowRight', category: 'Navigasyon', label: '5 Dakika İleri' },
        'scrubLeft5m': { default: 'Mod+Alt+ArrowLeft', category: 'Navigasyon', label: '5 Dakika Geri' },
        'seekF5': { default: 'PageDown', category: 'Navigasyon', label: '5 Saniye İleri' },
        'seekB5': { default: 'PageUp', category: 'Navigasyon', label: '5 Saniye Geri' },
        'goToStart': { default: ['Mod+ArrowUp', 'Ctrl+Home'], category: 'Navigasyon', label: 'Başa Git' },
        'goToEnd': { default: ['Mod+ArrowDown', 'Ctrl+End'], category: 'Navigasyon', label: 'Sona Git' },
        'goToMiddle': { default: ['Mod+Shift+Delete', 'Ctrl+Shift+Backspace'], category: 'Navigasyon', label: 'Ortaya Git' },
        'goToBeforeEnd': { default: 'Shift+Delete', category: 'Navigasyon', label: 'Sondan 30sn Önce' },
        'goToTime': { default: 'Mod+G', category: 'Navigasyon', label: 'Zaman Koduna Git' },
        'markerNext': { default: 'Alt+ArrowRight', category: 'İşaretçiler', label: 'Sonraki İşaretçi' },
        'markerPrev': { default: 'Alt+ArrowLeft', category: 'İşaretçiler', label: 'Önceki İşaretçi' },
        'changeFineTune': { default: 'Mod+Shift+F', category: 'Navigasyon', label: 'İnce Ayar Değiştir' },
        'sensIncr': { default: 'Alt+ArrowDown', category: 'Navigasyon', label: 'Hassasiyet Artır (-)' },
        'sensDecr': { default: 'Alt+ArrowUp', category: 'Navigasyon', label: 'Hassasiyet Azalt (+)' },

        // --- İşaretçiler (Markers) ---
        'deleteMarker': { default: null, category: 'İşaretçiler', label: 'İşaretçi Sil' },
        'clearAllMarkers': { default: null, category: 'İşaretçiler', label: 'Tüm İşaretçileri Temizle' },
        'markerList': { default: null, category: 'İşaretçiler', label: 'İşaretçi Listesi' },


        // --- Seçim (Selection) ---
        'selectRight': { default: 'Shift+ArrowRight', category: 'Seçim', label: 'Sağa Seçim (1sn)' },
        'selectLeft': { default: 'Shift+ArrowLeft', category: 'Seçim', label: 'Sola Seçim (1sn)' },
        'selectToStart': { default: ['Mod+Shift+ArrowUp', 'Ctrl+Shift+Home'], category: 'Seçim', label: 'Başa Kadar Seç' },
        'selectToEnd': { default: ['Mod+Shift+ArrowDown', 'Ctrl+Shift+End'], category: 'Seçim', label: 'Sona Kadar Seç' },
        'selectRange': { default: 'Mod+R', category: 'Seçim', label: 'Aralık Seç Diyaloğu' },
        'clearSelection': { default: 'Escape', category: 'Seçim', label: 'Seçimi Temizle / İptal' },
        'selectBetweenRight': { default: 'Mod+Shift+ArrowRight', category: 'Seçim', label: 'İşaretçiler Arası Sağa' },
        'selectBetweenLeft': { default: 'Mod+Shift+ArrowLeft', category: 'Seçim', label: 'İşaretçiler Arası Sola' },
        'selectToMarkerRight': { default: 'Ctrl+Shift+ArrowRight', category: 'Seçim', label: 'İşaretçiye Kadar Sağa' },
        'selectToMarkerLeft': { default: 'Ctrl+Shift+ArrowLeft', category: 'Seçim', label: 'İşaretçiye Kadar Sola' },

        // --- Araçlar (Tools) ---
        'insertList': { default: 'Mod+Shift+L', category: 'Araçlar', label: 'Ekleme Listesi / Kuyruk' },
        'objectAnalysis': { default: 'Mod+Shift+A', category: 'Araçlar', label: 'Nesne Analizi' },
        'listSilences': { default: 'Mod+Shift+B', category: 'Araçlar', label: 'Boşlukları Listele' },

        // --- Yapay Zeka (AI) ---
        'describeSelection': { default: 'Mod+Alt+D', category: 'Yapay Zeka', label: 'Seçimi Betimle' },
        'describePosition': { default: 'Mod+Alt+V', category: 'Yapay Zeka', label: 'Konumu Betimle' },
        'smartSelection': { default: 'Mod+I', category: 'Yapay Zeka', label: 'Akıllı Seçim' },

        // --- Yardım (Help) ---
        'shortcuts': { default: 'F1', category: 'Yardım', label: 'Kısayollar Listesi' },
        'help': { default: 'F2', category: 'Yardım', label: 'Kullanım Kılavuzu' },
        'keyboardManager': { default: 'Mod+K', category: 'Yardım', label: 'Klavye Yöneticisi' },
        'sendFeedback': { default: 'F3', category: 'Yardım', label: 'Geri Bildirim Gönder' },

        // --- Genel (General) ---
        'contextMenu': { default: ['ContextMenu', 'Shift+F10'], category: 'Genel', label: 'Bağlam Menüsü' },
        'contextMenuAlt': { default: 'Mod+.', category: 'Genel', label: 'Bağlam Menüsü (Alt)' },
        'announceCurrentTime': { default: 'Mod+B', category: 'Genel', label: 'Mevcut Zamanı Oku' },

        // --- Atanmamış (Unassigned) - Kullanıcının ataması için ---
        'exportVideoOnly': { default: null, category: 'Dosya', label: 'Dışa Aktar: Sadece Video (Sessiz)' },
        'exportAudioOnly': { default: null, category: 'Dosya', label: 'Dışa Aktar: Sadece Ses (.mp3)' },
        'syncAudio': { default: null, category: 'Dosya', label: 'Harici Sesi Senkronla (A)' },
        'recordReference': { default: null, category: 'Dosya', label: 'Referans Sesle Kayıt (B)' },
        'videoProperties': { default: null, category: 'Düzenleme', label: 'Video Özellikleri' },
        'insertVideo': { default: null, category: 'Ekle', label: 'Video Ekle (Birleştir)' },
        'insertAudio': { default: null, category: 'Ekle', label: 'Ses Ekle / Dublaj' },
        'insertImage': { default: null, category: 'Ekle', label: 'Resim / Slayt Ekle' },
        'insertText': { default: null, category: 'Ekle', label: 'Metin / Başlık Ekle' },
        'openCtaLibrary': { default: 'Mod+Shift+K', category: 'Ekle', label: 'CTA / Overlay Kütüphanesi' },
        'insertVideoLayer': { default: 'Ctrl+Shift+V', category: 'Ekle', label: 'Video Katmanı (PiP)' },
        'insertSubtitle': { default: null, category: 'Ekle', label: 'Altyazı Ekle (.srt)' },
        'createShorts': { default: null, category: 'Ekle', label: 'Dikey Video (Shorts/Reels) Oluştur' },
        'createShortsFromSelection': { default: null, category: 'Ekle', label: 'Seçili Alanı Dikey Videoya Dönüştür' },
        'addSelectionToQueue': { default: null, category: 'Ekle', label: 'Seçili Alanı Seçim Listesine Ekle' },
        'addMarkerPairsToQueue': { default: null, category: 'Ekle', label: 'İşaretçi Çiftlerini Seçim Listesine Ekle' },
        'openSelectionQueue': { default: null, category: 'Ekle', label: 'Seçim Listesi' },
        'mergeSelectionQueue': { default: null, category: 'Ekle', label: 'Seçim Listesini Tek Klipte Birleştir' },
        'createShortsFromQueue': { default: null, category: 'Ekle', label: 'Seçim Listesini Dikey Videoya Dönüştür' },
        'clearSelectionQueue': { default: null, category: 'Ekle', label: 'Seçim Listesini Temizle' },

        // --- Erişilebilir Kayıt (Accessible Recording) ---
        'openRecordingWizard': { default: 'Mod+Shift+R', category: 'Erişilebilir Kayıt', label: 'Kayıt Sihirbazı' },
        'openRecordingInterview': { default: null, category: 'Erişilebilir Kayıt', label: 'Tam Ekran Çevrim Dışı Önayar' },
        'openRecordingOfflineZoom': { default: null, category: 'Erişilebilir Kayıt', label: 'Zoom Çevrim Dışı Önayar' },
        'openRecordingOfflineMeet': { default: null, category: 'Erişilebilir Kayıt', label: 'Google Meet Çevrim Dışı Önayar' },
        'openRecordingOfflineTeams': { default: null, category: 'Erişilebilir Kayıt', label: 'Microsoft Teams Çevrim Dışı Önayar' },
        'openRecordingBroadcast': { default: null, category: 'Erişilebilir Kayıt', label: 'Tam Ekran Canlı Yayın' },
        'openRecordingBroadcastZoom': { default: null, category: 'Erişilebilir Kayıt', label: 'Zoom Canlı Yayın' },
        'openRecordingBroadcastMeet': { default: null, category: 'Erişilebilir Kayıt', label: 'Google Meet Canlı Yayın' },
        'openRecordingBroadcastTeams': { default: null, category: 'Erişilebilir Kayıt', label: 'Microsoft Teams Canlı Yayın' },
        'openRecordingBroadcastChatWatch': { default: null, category: 'Erişilebilir Kayıt', label: 'YouTube Sohbetini İzle' },
        'openLiveEffectsPanel': { default: null, category: 'Erişilebilir Kayıt', label: 'Canlı Efekt Paneli' },
        'openBroadcastRoom': { default: null, category: 'Erişilebilir Kayıt', label: 'Yayın Odası' },
        'resumeActiveBroadcastWizard': { default: null, category: 'Erişilebilir Kayıt', label: 'Etkin Canlı Yayına Geri Dön' },
        'recordingGlobalStartStop': { default: 'Alt+Ctrl+R', category: 'Kayıt Global Kısayolları', label: 'Global: Kaydı veya Yayını Başlat/Durdur' },
        'recordingGlobalPauseResume': { default: 'Alt+Ctrl+P', category: 'Kayıt Global Kısayolları', label: 'Global: Kaydı Duraklat/Devam Ettir' },
        'recordingGlobalToggleSystemAudio': { default: 'Alt+Ctrl+H', category: 'Kayıt Global Kısayolları', label: 'Global: Sistem Sesini Aç/Kapat' },
        'recordingGlobalToggleMicrophone': { default: 'Alt+Ctrl+M', category: 'Kayıt Global Kısayolları', label: 'Global: Mikrofonu Aç/Kapat' },
        'recordingGlobalToggleLiveEffects': { default: 'Alt+Ctrl+Space', category: 'Kayıt Global Kısayolları', label: 'Global: Canlı Efekt Katmanını Aç/Kapat' },
        'recordingGlobalFullscreenCamera': { default: 'Alt+Ctrl+K', category: 'Kayıt Global Kısayolları', label: 'Global: Kamerayı Tam Ekran Yap' },
        'recordingGlobalRestoreLayout': { default: 'Alt+Ctrl+J', category: 'Kayıt Global Kısayolları', label: 'Global: Önceki Düzeni Geri Yükle' },
        'recordingGlobalHideScreen': { default: 'Alt+Ctrl+L', category: 'Kayıt Global Kısayolları', label: 'Global: Ekranı Gizle veya Geri Aç' },
        'recordingGlobalPreviousWindow': { default: 'Alt+Ctrl+U', category: 'Kayıt Global Kısayolları', label: 'Global: Önceki Pencere' },
        'recordingGlobalNextWindow': { default: 'Alt+Ctrl+O', category: 'Kayıt Global Kısayolları', label: 'Global: Sonraki Pencere' },
        'recordingGlobalWindowList': { default: 'Alt+Ctrl+I', category: 'Kayıt Global Kısayolları', label: 'Global: Pencere Listesini Aç' },
        'broadcastRoomGlobalToggleYouTubeLive': { default: 'Alt+Ctrl+L', category: 'Yayın Odası', label: 'Yayın Odası: YouTube Canlı Yayını Başlat/Durdur' },
        'broadcastRoomGlobalToggleBotRecording': { default: 'Alt+Ctrl+B', category: 'Yayın Odası', label: 'Yayın Odası: Bot Kaydını Başlat/Durdur' },
        'broadcastRoomGlobalToggleLiveTranslation': { default: 'Alt+Ctrl+T', category: 'Yayın Odası', label: 'Yayın Odası: Canlı Çeviri/Altyazıyı Başlat/Durdur' },
        'broadcastRoomGlobalReadYouTubeStats': { default: 'Alt+Ctrl+Y', category: 'Yayın Odası', label: 'Yayın Odası: YouTube İstatistiklerini Oku' },
        'instantVoiceTranslationGlobalToggle': { default: 'Alt+Ctrl+D', category: 'Yapay Zeka', label: 'Anlık Sesli Çeviri: Dinlemeyi Başlat/Durdur' },
        'zoomIn': { default: null, category: 'Görünüm', label: 'Yakınlaştır (Timeline)' },
        'zoomOut': { default: null, category: 'Görünüm', label: 'Uzaklaştır (Timeline)' },
        'resetZoom': { default: null, category: 'Görünüm', label: 'Yakınlaştırmayı Sıfırla' },
        'rotateVideo': { default: null, category: 'Görünüm', label: 'Videoyu Döndür (90°)' },
    },

    /**
     * Modülü başlat
     */
    init() {
        // Capture phase kullan (true)
        document.addEventListener('keydown', (e) => this.handleKeyDown(e), true);
        document.addEventListener('keyup', (e) => this.handleKeyUp(e), true);

        // Kullanıcı ayarlarından keymap yükle, yoksa boş obje
        this.userKeymap = Settings.get('userKeymap') || {};
    },

    setEnabled(enabled) {
        this.isEnabled = enabled;
    },

    // --- Kısayol Kontrol ve Yönetim ---

    /**
     * Bir aksiyon tetiklendi mi kontrol et
     * @param {string} actionId 
     * @param {KeyboardEvent} e 
     * @returns {boolean}
     */
    check(actionId, e) {
        const def = this.ACTIONS[actionId];
        if (!def) return false;

        // Kullanıcı override var mı?
        // userKeymap[actionId] undefined ise default'u kullan
        const defaultBindings = actionId === 'applyTransition'
            ? this.getApplyTransitionBindings()
            : def.default;
        const bindings = this.userKeymap[actionId] !== undefined ? this.userKeymap[actionId] : defaultBindings;

        // Binding tek string olabilir veya array olabilir
        const bindingList = Array.isArray(bindings) ? bindings : [bindings];

        // Listeden herhangi biri uyuyor mu?
        return bindingList.some(binding => this.matchesBinding(e, binding));
    },

    /**
     * Bir event, spesifik bir binding string ile eşleşiyor mu?
     * @param {KeyboardEvent} e 
     * @param {string} binding 
     */
    matchesBinding(e, binding) {
        if (!binding) return false;

        const parts = binding.split('+').map(p => p.trim().toLowerCase());
        const key = parts[parts.length - 1]; // Son parça asıl tuş

        // Modifiers (beklenen)
        // Mod: Mac ise Meta, Win ise Ctrl
        const isMac = navigator.userAgent.includes('Mac');

        const reqCtrl = parts.includes('ctrl') || (!isMac && parts.includes('mod'));
        const reqMeta = parts.includes('meta') || parts.includes('cmd') || (isMac && parts.includes('mod'));
        const reqAlt = parts.includes('alt') || parts.includes('option');
        const reqShift = parts.includes('shift');

        // Event durumu
        const eventCtrl = e.ctrlKey;
        const eventMeta = e.metaKey;
        const eventAlt = e.altKey;
        const eventShift = e.shiftKey;

        // Eşleşme kontrolü
        if (eventCtrl !== reqCtrl) return false;
        if (eventMeta !== reqMeta) return false;
        if (eventAlt !== reqAlt) return false;
        if (eventShift !== reqShift) return false;

        // Tuş kontrolü
        if (key === 'space') return e.key === ' ';
        if (key === 'plus') return e.key === '+';

        // Letter/digit accelerators are more reliable via KeyboardEvent.code,
        // especially for Ctrl/Shift combinations that Chromium may localize oddly.
        if (/^[a-z]$/.test(key)) {
            return e.code === `Key${key.toUpperCase()}` || e.key.toLowerCase() === key;
        }
        if (/^[0-9]$/.test(key)) {
            return e.code === `Digit${key}` || e.key === key;
        }

        // e.key genellikle case-sensitive (ör. 'a' veya 'A'). 
        // Ancak Shift basılıyken 'A' gelir, shift yokken 'a' gelir.
        // Bizim logic'te shift modifier olarak zaten kontrol ediliyor.
        // Bu yüzden e.key'i lowercase yapıp karşılaştırabiliriz.
        // Not: 'ArrowRight' gibi tuşlar lowercase olunca 'arrowright' olur.
        return e.key.toLowerCase() === key;
    },

    /**
     * Event nesnesini okunabilir string'e çevir (Örn: "Ctrl+Shift+G")
     * Klavye yöneticisinde yeni kısayol kaydederken kullanılır.
     */
    eventToString(e) {
        const parts = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.metaKey) parts.push('Cmd');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');

        let key = e.key;
        if (key === ' ') key = 'Space';
        // Modifier tuşlarının kendisi basıldığında işlem yapma
        if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(key)) return null;

        // İlk harfi büyük yap
        if (key.length === 1) key = key.toUpperCase();
        else key = key.charAt(0).toUpperCase() + key.slice(1);

        parts.push(key);

        return parts.join('+');
    },

    // --- Olay İşleyicisi ---

    handleKeyDown(e) {
        if (!this.isEnabled) return;

        const target = e.target;
        const dialogOpen = this.isDialogOpen();
        const inputFocused = this.isInputFocused(target);
        const modKeyPressed = navigator.userAgent.includes('Mac') ? e.metaKey : e.ctrlKey;

        // Hard fallback for Transition Library.
        // Some environments or stale user keymap overrides can swallow Ctrl+Shift+T,
        // while the menu accelerator alone may not reliably reach the renderer.
        if (modKeyPressed && e.shiftKey && !e.altKey && e.code === 'KeyT') {
            if (!dialogOpen && !inputFocused) {
                Dialogs.showTransitionLibraryDialog();
                e.preventDefault();
                e.stopPropagation();
            }
            return;
        }

        // --- Diyalog/Input Engelleme Kuralları ---
        // Bu kurallar, diyaloğa veya input'a odaklıyken video kontrollerinin çalışmasını engeller
        // ancak Copy/Paste gibi temel kısayollara izin verir.
        if (dialogOpen || inputFocused) {
            // Diyalog açıkken Enter ve Space her zaman diyaloğun doğal etkileşimine bırakılmalı.
            // Özellikle erişilebilir onay kutularında odak bazen butonun içindeki alt öğelerde kalabildiği için
            // sadece target.tagName === BUTTON kontrolü yeterli olmuyor.
            if (dialogOpen && (e.key === 'Enter' || e.key === ' ')) {
                return;
            }

            // Escape her zaman geçmeli ki diyaloğu kapatabilsin (aşağıda check ediliyor)
            if (e.key === 'Escape') {
                // Fall throw
            }
            // Metin düzenleme kısayolları (izin ver)
            else if (this.check('copy', e) || this.check('paste', e) || this.check('cut', e) || this.check('selectAll', e) || this.check('undo', e) || this.check('redo', e)) {
                return; // Tarayıcı işlesin
            }
            // Alt+P (Önizleme) -> Dialog içinde kullanılıyor, izin ver (return)
            else if (e.altKey && e.key.toLowerCase() === 'p') { return; }

            // Eğer modifier yoksa (sadece harf veya sayı) ve input odaklıysa
            else if (!e.ctrlKey && !e.altKey && !e.metaKey) {
                // Space ve Enter özel: VideoPlayer'ı tetikleyebilir, o yüzden durdur.
                // Input içinde space basınca scroll olmasın veya video oynamasın
                if (e.key === ' ' || e.key === 'Enter') {
                    // Eğer odaklanılan eleman butonsa, enter/space işlesin (bırakalım browser click yapsın)
                    const activatesLikeButton = target.tagName === 'BUTTON' ||
                        (target.tagName === 'INPUT' && target.type === 'button') ||
                        target.getAttribute('role') === 'button' ||
                        !!target.closest('button,[role="button"]');
                    if (activatesLikeButton) {
                        return;
                    }
                    e.stopImmediatePropagation();
                    return; // Input işlesin
                }
                return; // Diğer harfleri input işlesin
            }
            else {
                // Diğer tüm kısayolları input içindeyken yutalım mı?
                // Hayır, "Ctrl+S" (Kaydet) gibi genel kısayollar çalışmalı mı? 
                // Diyalog açıkken arka planda işlem yapılması istenmeyebilir.
                // Bu yüzden Escape hariç durduralım.
                if (e.key !== 'Escape') {
                    // Ancak: Navigation gibi bazı tuşlar (Arrow) input içinde gezinti için gerekli.
                    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
                        return; // İzin ver
                    }
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return;
                }
            }
        }

        let handled = false;

        // --- EYLEMLERİN YÜRÜTÜLMESİ ---
        // Sıra önemlidir (öncelik sırası)

        // Yardım / Menü
        if (this.check('keyboardManager', e)) { Dialogs.showKeyboardManagerDialog(); handled = true; } // YENİ
        else if (this.check('shortcuts', e)) { Dialogs.showShortcutsDialog(); handled = true; }
        else if (this.check('help', e)) { Dialogs.showHelpDialog(); handled = true; }
        else if (this.check('sendFeedback', e)) { window.App?.openFeedbackDraft?.(); handled = true; }
        else if (this.check('contextMenu', e) || this.check('contextMenuAlt', e)) { this.showContextMenu(); handled = true; }
        else if (this.check('announceCurrentTime', e)) {
            const time = VideoPlayer.getTimelineTime();
            Accessibility.announce(`Şu anki konum: ${Utils.formatTimeForSpeech(time)}`);
            handled = true;
        }

        // Dosya
        else if (this.check('newProject', e)) { App.newProject(); handled = true; }
        else if (this.check('tabNext', e)) { TabManager.nextTab(); handled = true; }
        else if (this.check('tabPrev', e)) { TabManager.prevTab(); handled = true; }
        else if (this.check('closeTab', e)) { App.closeTabWithConfirm(TabManager.activeTabIndex); handled = true; }
        else if (this.check('closeFile', e)) { App.handleFileCloseRequest(); handled = true; }
        // Sekme 1-9
        else if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key >= '1' && e.key <= '9') {
            TabManager.switchToTabByNumber(parseInt(e.key)); handled = true;
        }

        // Navigasyon (Scrubbing için 'repeat' bilgisi önemli)
        else if (this.check('scrubRight', e)) { VideoPlayer.startScrubbing(1, Settings.getNavigationStep(), e.repeat); handled = true; }
        else if (this.check('scrubLeft', e)) { VideoPlayer.startScrubbing(-1, Settings.getNavigationStep(), e.repeat); handled = true; }
        else if (this.check('scrubRight30', e)) { VideoPlayer.startScrubbing(1, 30, e.repeat); handled = true; }
        else if (this.check('scrubLeft30', e)) { VideoPlayer.startScrubbing(-1, 30, e.repeat); handled = true; }
        else if (this.check('scrubRight5m', e)) { VideoPlayer.startScrubbing(1, 300, e.repeat); handled = true; }
        else if (this.check('scrubLeft5m', e)) { VideoPlayer.startScrubbing(-1, 300, e.repeat); handled = true; }

        else if (this.check('seekF5', e)) { VideoPlayer.seekRelative(5); handled = true; }
        else if (this.check('seekB5', e)) { VideoPlayer.seekRelative(-5); handled = true; }

        else if (this.check('goToStart', e)) { VideoPlayer.goToStart(); handled = true; }
        else if (this.check('goToEnd', e)) { VideoPlayer.goToEnd(); handled = true; }
        else if (this.check('goToTime', e)) { Dialogs.showGotoDialog(); handled = true; }

        else if (this.check('listSilences', e)) { Dialogs.showSilenceParamsDialog(); handled = true; }
        else if (this.check('skipSilence', e)) { VideoPlayer.skipSilence(); handled = true; }

        else if (this.check('goToBeforeEnd', e)) { VideoPlayer.goToBeforeEnd(); handled = true; }
        else if (this.check('goToMiddle', e)) { VideoPlayer.goToMiddle(); handled = true; }
        else if (this.check('changeFineTune', e)) { Dialogs.showFineTuneDialog(); handled = true; }

        else if (this.check('markerNext', e)) { Markers.goToNext(); handled = true; }
        else if (this.check('markerPrev', e)) { Markers.goToPrevious(); handled = true; }
        else if (this.check('sensIncr', e)) {
            const n = Settings.decreaseNavigationStep();
            Accessibility.announce(Accessibility.t('runtime.keyboard.sensitivity_increased', 'Sensitivity increased: {duration}', {
                duration: Utils.formatTimeForSpeech(n)
            }));
            handled = true;
        }
        else if (this.check('sensDecr', e)) {
            const n = Settings.increaseNavigationStep();
            Accessibility.announce(Accessibility.t('runtime.keyboard.sensitivity_decreased', 'Sensitivity decreased: {duration}', {
                duration: Utils.formatTimeForSpeech(n)
            }));
            handled = true;
        }

        // Oynatma
        else if (this.check('togglePlay', e)) { VideoPlayer.togglePlay(); handled = true; }
        else if (this.check('pauseAt', e)) { VideoPlayer.pauseAtCurrentPosition(); handled = true; }
        else if (this.check('pauseAndSet', e)) { VideoPlayer.togglePauseAtCurrentPosition(); handled = true; }
        else if (this.check('playSelection', e)) { VideoPlayer.playSelection(); handled = true; }
        else if (this.check('playCutPreview', e)) { VideoPlayer.playCutPreview(); handled = true; }

        // Düzenleme / İşaretçiler
        else if (this.check('addMarker', e)) { Markers.addAtCurrentTime(); handled = true; }
        else if (this.check('applyTransition', e)) { Transitions.applyAtCurrentTime(); handled = true; }
        else if (this.check('transitionLib', e)) { Dialogs.showTransitionLibraryDialog(); handled = true; }
        else if (this.check('applyAllTrans', e)) { App.applyAllTransitions(); handled = true; }

        else if (this.check('delete', e)) { App.delete(); handled = true; }
        else if (this.check('cut', e)) { App.cut(); handled = true; }
        else if (this.check('copy', e)) { App.copy(); handled = true; }
        else if (this.check('paste', e)) { App.paste(); handled = true; }
        else if (this.check('undo', e)) { App.undo(); handled = true; }
        else if (this.check('redo', e)) { App.redo(); handled = true; }
        else if (this.check('changeSpeed', e)) { Dialogs.showSpeedDialog(); handled = true; }
        else if (this.check('deleteMarker', e)) { Markers.removeAtCurrentTime(); handled = true; }
        else if (this.check('clearAllMarkers', e)) {
            Dialogs.showAccessibleConfirm('Onay', 'Tüm işaretçiler silinsin mi?').then(confirmed => {
                if (confirmed) Markers.clearAll();
            });
            handled = true;
        }
        else if (this.check('markerList', e)) { Dialogs.showMarkerListDialog(); handled = true; }


        // Seçim
        else if (this.check('selectRight', e)) { Selection.extend(Settings.getNavigationStep()); handled = true; }
        else if (this.check('selectLeft', e)) { Selection.extend(-Settings.getNavigationStep()); handled = true; }
        else if (this.check('selectBetweenRight', e)) { Selection.selectBetweenMarkers('expand'); handled = true; }
        else if (this.check('selectBetweenLeft', e)) { Selection.selectBetweenMarkers('shrink'); handled = true; }
        else if (this.check('selectToMarkerRight', e)) { Selection.selectToMarker('next'); handled = true; }
        else if (this.check('selectToMarkerLeft', e)) { Selection.selectToMarker('prev'); handled = true; }
        else if (this.check('selectToStart', e)) { Selection.selectTo('start'); handled = true; }
        else if (this.check('selectToEnd', e)) { Selection.selectTo('end'); handled = true; }
        else if (this.check('selectRange', e)) { Dialogs.showRangeDialog(); handled = true; }
        else if (this.check('selectAll', e)) { Selection.selectAll(); handled = true; }

        else if (this.check('clearSelection', e)) {
            if (this.isDialogOpen()) this.closeOpenDialog();
            else Selection.clear();
            handled = true;
        }

        // Araçlar / Ekle / Dışa Aktar (Yeni eklenenler)
        else if (this.check('insertList', e)) { Dialogs.showInsertionQueueDialog(); handled = true; }
        else if (this.check('objectAnalysis', e)) {
            const d = document.getElementById('object-analysis-dialog');
            if (d) d.showModal();
            handled = true;
        }
        else if (this.check('exportVideoOnly', e)) { App.exportVideoOnly(); handled = true; }
        else if (this.check('exportAudioOnly', e)) { App.exportAudioOnly(); handled = true; }
        else if (this.check('videoProperties', e)) { Dialogs.showVideoPropertiesDialog(); handled = true; }
        else if (this.check('openProject', e)) { App.loadProject(); handled = true; }
        else if (this.check('saveProject', e)) { App.saveProject(); handled = true; }
        else if (this.check('syncAudio', e)) { window.api.openSyncWizard('A'); handled = true; }
        else if (this.check('recordReference', e)) { window.api.openSyncWizard('B'); handled = true; }
        else if (this.check('openVideo', e)) { App.openFile(); handled = true; }
        else if (this.check('saveVideo', e)) { App.saveFile(); handled = true; }
        else if (this.check('saveAs', e)) { App.saveFileAs(); handled = true; }
        else if (this.check('exitApp', e)) { App.handleAppQuitRequest(); handled = true; }

        else if (this.check('insertVideo', e)) { if (VideoPlayer.hasVideo()) App.insertVideo(); else Accessibility.alert('Önce video açın'); handled = true; }
        else if (this.check('insertAudio', e)) { if (VideoPlayer.hasVideo()) Dialogs.showAudioSourceSelectionDialog(); else Accessibility.alert('Önce video açın'); handled = true; }
        else if (this.check('insertImage', e)) { if (VideoPlayer.hasVideo()) Dialogs.showImageWizard(); else Accessibility.alert('Önce video açın'); handled = true; }
        else if (this.check('insertText', e)) {
            if (VideoPlayer.hasVideo()) {
                window.api.openTextOverlayDialog({ startTime: VideoPlayer.getCurrentTime(), videoPath: App.currentFilePath });
            } else Accessibility.alert('Önce video açın');
            handled = true;
        }
        else if (this.check('insertSubtitle', e)) { App.insertSubtitle(); handled = true; }
        else if (this.check('insertVideoLayer', e)) {
            if (VideoPlayer.hasVideo()) {
                // Video seçim dialogunu aç
                window.api.openFileDialog({
                    title: window.i18nHelper?.t('dialog.video_layer_wizard.open_file_title') || 'Select Video Layer (Picture-in-Picture)',
                    filters: [{ name: window.i18nHelper?.t('runtime.app.video_files_filter') || 'Video Files', extensions: ['mp4', 'wmv', 'avi', 'mkv', 'mov', 'webm'] }],
                    properties: ['openFile']
                }).then(result => {
                    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
                        Dialogs.showVideoLayerWizard(result.filePaths[0]);
                    }
                });
            } else {
                Accessibility.alert('Önce bir video açmalısınız');
            }
            handled = true;
        }

        else if (this.check('openCtaLibrary', e)) {
            if (VideoPlayer.hasVideo()) {
                Dialogs.showCtaLibraryDialog();
            } else {
                Accessibility.alert('Önce bir video açın.');
            }
            handled = true;
        }
        else if (this.check('createShorts', e)) {
            if (VideoPlayer.hasVideo()) {
                window.api.openVerticalWizard();
            } else {
                Accessibility.alert('Önce bir video açın.');
            }
            handled = true;
        }
        else if (this.check('createShortsFromSelection', e)) {
            App.openVerticalWizardFromSelection();
            handled = true;
        }
        else if (this.check('addSelectionToQueue', e)) {
            App.addSelectionToVerticalQueue();
            handled = true;
        }
        else if (this.check('addMarkerPairsToQueue', e)) {
            App.addMarkerPairsToVerticalQueue();
            handled = true;
        }
        else if (this.check('openSelectionQueue', e)) {
            App.openSelectionQueueDialog();
            handled = true;
        }
        else if (this.check('mergeSelectionQueue', e)) {
            App.mergeVerticalClipQueue();
            handled = true;
        }
        else if (this.check('createShortsFromQueue', e)) {
            App.openVerticalWizardFromQueue();
            handled = true;
        }
        else if (this.check('clearSelectionQueue', e)) {
            App.clearVerticalClipQueue();
            handled = true;
        }
        else if (this.check('openRecordingWizard', e)) {
            window.api.openRecordingWizard();
            handled = true;
        }
        else if (this.check('openRecordingInterview', e)) {
            window.api.openRecordingWizard({ launchProfile: 'interview' });
            handled = true;
        }
        else if (this.check('openRecordingOfflineZoom', e)) {
            window.api.openRecordingWizard({ launchProfile: 'offline-zoom' });
            handled = true;
        }
        else if (this.check('openRecordingOfflineMeet', e)) {
            window.api.openRecordingWizard({ launchProfile: 'offline-meet' });
            handled = true;
        }
        else if (this.check('openRecordingOfflineTeams', e)) {
            window.api.openRecordingWizard({ launchProfile: 'offline-teams' });
            handled = true;
        }
        else if (this.check('openRecordingBroadcast', e)) {
            window.api.openRecordingWizard({ launchProfile: 'broadcast' });
            handled = true;
        }
        else if (this.check('openRecordingBroadcastZoom', e)) {
            window.api.openRecordingWizard({ launchProfile: 'broadcast-zoom' });
            handled = true;
        }
        else if (this.check('openRecordingBroadcastMeet', e)) {
            window.api.openRecordingWizard({ launchProfile: 'broadcast-meet' });
            handled = true;
        }
        else if (this.check('openRecordingBroadcastTeams', e)) {
            window.api.openRecordingWizard({ launchProfile: 'broadcast-teams' });
            handled = true;
        }
        else if (this.check('openRecordingBroadcastChatWatch', e)) {
            window.api.openRecordingWizard({ launchProfile: 'broadcast-chat-watch' });
            handled = true;
        }
        else if (this.check('openLiveEffectsPanel', e)) {
            window.api.openLiveEffectsPanel();
            handled = true;
        }
        else if (this.check('openBroadcastRoom', e)) {
            window.api.openBroadcastRoom();
            handled = true;
        }
        else if (this.check('resumeActiveBroadcastWizard', e)) {
            window.api.resumeActiveRecordingWizard();
            handled = true;
        }

        else if (this.check('zoomIn', e)) { Timeline.zoomIn(); handled = true; }
        else if (this.check('zoomOut', e)) { Timeline.zoomOut(); handled = true; }
        else if (this.check('resetZoom', e)) { Timeline.resetZoom(); handled = true; }
        else if (this.check('rotateVideo', e)) { App.rotateVideo(90); handled = true; }
        // Yapay Zeka
        else if (this.check('describeSelection', e)) { Dialogs.showAIDescriptionDialog(); handled = true; }
        else if (this.check('describePosition', e)) { App.describeCurrentPosition(); handled = true; }
        else if (this.check('smartSelection', e)) { Dialogs.showAIDialog(); handled = true; }

        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    },

    handleKeyUp(e) {
        if (!this.isEnabled) return;

        // Scrubbing durdurma logic'i
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            if (VideoPlayer.isScrubbing) {
                VideoPlayer.stopScrubbing();
                e.preventDefault();
                e.stopPropagation();
            }
        }
    },

    // --- Helper Functions ---
    isInputFocused(el) {
        const active = el || document.activeElement;
        if (!active) return false;
        if (active.isContentEditable) return true;
        const tag = active.tagName ? active.tagName.toUpperCase() : '';
        return (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.getAttribute('role') === 'listbox' || active.getAttribute('role') === 'option' || active.closest('[role="listbox"]'));
    },

    isDialogOpen() {
        const dialogs = document.querySelectorAll('dialog[open]');
        if (dialogs.length > 0) return true;
        const wizard = document.getElementById('image-wizard-dialog');
        if (wizard && (wizard.hasAttribute('open') || wizard.open)) return true;
        const vlWizard = document.getElementById('video-layer-wizard-dialog');
        if (vlWizard && (vlWizard.hasAttribute('open') || vlWizard.open)) return true;
        return false;
    },

    closeOpenDialog() {
        const dialog = document.querySelector('dialog[open]');
        if (dialog) dialog.close();
    },

    showContextMenu() {
        // Aktif element üzerinde contextmenu olayını tetikle
        const active = document.activeElement;
        if (active) {
            const ev = new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                view: window,
                buttons: 2,
                clientX: active.getBoundingClientRect().x + 5,
                clientY: active.getBoundingClientRect().y + 5
            });
            active.dispatchEvent(ev);
        }
    },

    // --- Yapılandırma ---
    getAllActions() {
        return this.ACTIONS;
    },

    getUserKeymap() {
        return this.userKeymap;
    },

    setUserKeymap(keymap) {
        this.userKeymap = keymap;
        Settings.set('userKeymap', keymap);
        Accessibility.announce('Klavye ayarları güncellendi');
    },

    resetUserKeymap() {
        this.userKeymap = {};
        Settings.set('userKeymap', {});
    },

    getActionShortcut(actionId) {
        if (this.userKeymap[actionId]) return this.userKeymap[actionId];
        if (actionId === 'applyTransition') {
            return this.getApplyTransitionBindings();
        }
        return this.ACTIONS[actionId]?.default;
    }
};

window.Keyboard = Keyboard;
