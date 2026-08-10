/**
 * Ses Ayarları Modülü
 * İlgili klibin (Video veya Ses) ses özelliklerini yönetir.
 */
const AudioSettings = {
    dialog: null,
    targetItem: null, // { type: 'video'|'audio', id: number|null, object: Object }
    t(key, fallback, params = {}) {
        if (!window.i18nHelper) return fallback;
        const value = window.i18nHelper.t(key, params);
        return value && !value.startsWith('[') ? value : fallback;
    },

    getNoiseRadioId(level) {
        if (level === 'medium') return 'noise-mid';
        return `noise-${level}`;
    },

    // UI Elements
    volumeSlider: null,
    volumeValue: null,
    volumeBypass: null,
    channelCurrent: null,
    channelMode: null,

    noiseEnable: null,
    noiseControls: null,
    noiseRadios: [],
    noiseCustomGroup: null,
    noiseSlider: null,
    noiseValue: null,
    compareBtn: null,

    effectEcho: null,
    effectReverb: null,
    effectPhone: null,

    previewBtn: null,
    applyBtn: null,
    resetBtn: null,
    cancelBtn: null,

    // Preview State
    isPreviewing: false,
    originalVolume: 1.0,
    preRenderedOriginalPath: null,
    preRenderedOriginalPathTime: null,
    currentSourceAudioChannels: null,

    init() {
        this.dialog = document.getElementById('audio-settings-dialog');
        if (!this.dialog) return;

        // Elementleri seç
        this.volumeSlider = document.getElementById('as-volume-slider');
        this.volumeValue = document.getElementById('as-volume-value');
        this.volumeBypass = document.getElementById('as-volume-bypass');
        this.channelCurrent = document.getElementById('as-channel-current');
        this.channelMode = document.getElementById('as-channel-mode');

        this.noiseEnable = document.getElementById('as-noise-enable');
        this.noiseControls = document.getElementById('as-noise-controls');
        this.noiseCustomGroup = document.getElementById('noise-custom-group');
        this.noiseSlider = document.getElementById('as-noise-slider');
        this.noiseValue = document.getElementById('as-noise-value');
        this.compareBtn = document.getElementById('as-compare-AB');

        // Radio buttons
        this.noiseRadios = Array.from(document.getElementsByName('noise-level'));

        this.effectEcho = document.getElementById('as-effect-echo');
        this.effectReverb = document.getElementById('as-effect-reverb');
        this.effectPhone = document.getElementById('as-effect-phone');

        this.previewBtn = document.getElementById('as-preview-toggle');
        if (this.previewBtn) this.previewBtn.style.display = 'none';
        this.applyBtn = document.getElementById('as-apply');
        this.resetBtn = document.getElementById('as-reset');
        this.cancelBtn = document.getElementById('as-cancel');

        this.bindEvents();
        this.injectRenderButton();
        this.setupIpc();
    },

    setupIpc() {
        console.log('AudioSettings: IPC Setup initiated.');
        if (window.api && window.api.onShowAudioSettingsDialog) {
            window.api.onShowAudioSettingsDialog(() => {
                console.log('AudioSettings: IPC show-audio-settings-dialog received.');
                this.open();
            });
            console.log('AudioSettings: Listener registered.');
        } else {
            console.error('AudioSettings: window.api.onShowAudioSettingsDialog missing!');
        }
    },

    bindEvents() {
        // Volume
        this.volumeSlider.addEventListener('input', () => {
            this.volumeValue.textContent = `%${this.volumeSlider.value}`;
            this.updatePreview();
        });

        this.volumeBypass.addEventListener('change', () => {
            this.volumeSlider.disabled = this.volumeBypass.checked;
            this.updatePreview();
        });
        if (this.channelMode) {
            this.channelMode.addEventListener('change', () => this.updatePreview());
        }

        // Noise Reduction
        this.noiseEnable.addEventListener('change', () => {
            this.updateNoiseUI();
            this.updatePreview();
        });

        this.noiseRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                this.updateNoiseUI();
                this.updatePreview();
            });
        });

        this.noiseSlider.addEventListener('input', () => {
            this.noiseValue.textContent = this.noiseSlider.value;
            this.updatePreview();
        });

        // A/B Compare -> Orijinali Dinle
        this.compareBtn.textContent = this.t('runtime.audio_settings.listen_original', 'Orj. Dinle');
        // Eski listenerları temizlemek için clone
        const newCompare = this.compareBtn.cloneNode(true);
        this.compareBtn.parentNode.replaceChild(newCompare, this.compareBtn);
        this.compareBtn = newCompare;

        this.compareBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.generateRenderedPreview(true);
        });

        // Effects
        [this.effectEcho, this.effectReverb, this.effectPhone].forEach(el => {
            if (el) el.addEventListener('change', () => this.updatePreview());
        });

        // Buttons
        this.previewBtn.addEventListener('click', () => this.togglePreview());
        this.applyBtn.addEventListener('click', (e) => {
            e.preventDefault(); // Form submit engelle
            this.apply();
        });
        this.resetBtn.addEventListener('click', () => this.resetValues());
        this.cancelBtn.addEventListener('click', () => this.close());

        // Form submit (Apply)
        this.dialog.querySelector('form').addEventListener('submit', (e) => {
            if (e.submitter !== this.applyBtn) e.preventDefault();
        });
    },

    // Orjinal ses önizlemesini arka planda hazırla
    prepareOriginalPreview() {
        if (!this.targetItem) return;

        // Eğer zaman veya dosya değişmişse render al
        const absoluteTime = VideoPlayer.getCurrentTime();
        if (this.preRenderedOriginalPath && this.preRenderedOriginalPathTime === absoluteTime) {
            console.log('AudioSettings: Orijinal önizleme zaten hazır.');
            return;
        }

        console.log('AudioSettings: Orijinal önizleme hazırlanıyor...');

        const sourceFile = this.targetItem.object.sourceFile || VideoPlayer.currentFilePath;
        if (!sourceFile) return;

        // Efektsiz (Ham) ayarlar
        const emptySettings = {
            volume: 100,
            muted: false,
            noiseReduction: { enabled: false },
            audioEffects: { echo: false, reverb: false, phone: false }
        };

        window.api.previewAudioSegment({
            videoPath: sourceFile,
            startTime: absoluteTime,
            duration: 5,
            settings: emptySettings
        }).then(result => {
            if (result.success && result.audioPath) {
                this.preRenderedOriginalPath = result.audioPath;
                this.preRenderedOriginalPathTime = absoluteTime;
                console.log('AudioSettings: Orijinal önizleme hazırlandı:', result.audioPath);
            }
        }).catch(err => {
            console.warn('AudioSettings: Orijinal önizleme hatası:', err);
        });
    },

    updateNoiseUI() {
        const enabled = this.noiseEnable.checked;
        this.noiseControls.style.opacity = enabled ? '1' : '0.5';
        this.noiseControls.style.pointerEvents = enabled ? 'auto' : 'none';

        const isCustom = document.getElementById('noise-custom').checked;
        this.noiseCustomGroup.style.display = isCustom ? 'block' : 'none';

        // Aria states
        this.noiseControls.setAttribute('aria-hidden', !enabled);
    },

    getEffectiveChannelMode(data) {
        if (data?.audioChannelMode === 'mono' || data?.audioChannelMode === 'stereo') {
            return data.audioChannelMode;
        }
        if (this.currentSourceAudioChannels === 1) return 'mono';
        if (this.currentSourceAudioChannels >= 2) return 'stereo';
        return 'source';
    },

    getChannelLabel(modeOrCount) {
        if (modeOrCount === 1 || modeOrCount === 'mono') {
            return this.t('dialog.audio_settings.channel_mono', 'Mono');
        }
        if ((typeof modeOrCount === 'number' && modeOrCount >= 2) || modeOrCount === 'stereo') {
            return this.t('dialog.audio_settings.channel_stereo', 'Stereo');
        }
        return this.t('dialog.audio_settings.channel_unknown', 'Bilinmiyor');
    },

    updateChannelAccessibilityLabel() {
        if (!this.channelMode) return;

        const currentLayout = this.getChannelLabel(this.currentSourceAudioChannels);
        this.channelMode.setAttribute('aria-label', this.t(
            'dialog.audio_settings.channel_mode_aria',
            'Dönüştürme. Mevcut kanal düzeni: {value}.',
            { value: currentLayout }
        ));
    },

    async loadCurrentChannelInfo() {
        this.currentSourceAudioChannels = null;
        const sourceFile = this.targetItem?.object?.sourceFile || VideoPlayer.currentFilePath;

        if (!sourceFile || !window.api?.getVideoMetadata) {
            if (this.channelCurrent) {
                this.channelCurrent.textContent = this.t('dialog.audio_settings.channel_current_unknown', 'Mevcut kanal düzeni belirlenemedi.');
            }
            this.updateChannelAccessibilityLabel();
            return;
        }

        try {
            const result = await window.api.getVideoMetadata(sourceFile);
            const audioStream = result?.success && result?.data?.streams
                ? result.data.streams.find((stream) => stream.codec_type === 'audio')
                : null;
            this.currentSourceAudioChannels = Number(audioStream?.channels || 0) || null;
        } catch (error) {
            console.warn('AudioSettings: channel metadata read failed:', error);
        }

        if (!this.channelCurrent) return;

        if (this.currentSourceAudioChannels === 1 || this.currentSourceAudioChannels >= 2) {
            this.channelCurrent.textContent = this.t('dialog.audio_settings.channel_current', 'Mevcut kanal düzeni: {value}', {
                value: this.getChannelLabel(this.currentSourceAudioChannels)
            });
        } else {
            this.channelCurrent.textContent = this.t('dialog.audio_settings.channel_current_unknown', 'Mevcut kanal düzeni belirlenemedi.');
        }

        this.updateChannelAccessibilityLabel();
    },

    async open() {
        this.identifyTarget();
        if (!this.targetItem) {
            console.error('Ses Ayarları: Hedef bulunamadı');
            if (window.Accessibility) Accessibility.announceError('Düzenlenecek bir video veya ses klibi bulunamadı.');
            return;
        }

        this.loadValues();
        await this.loadCurrentChannelInfo();
        this.dialog.showModal();

        // Hemen orijinal önizlemeyi başlat
        setTimeout(() => this.prepareOriginalPreview(), 100);

        // İlk odak
        this.volumeSlider.focus();

        // Kısayol dinleyicileri (Alt+P, Alt+D)
        this._keydownHandler = (e) => {
            // Alt+P: Efektli Dinle
            if (e.altKey && (e.key === 'p' || e.key === 'P')) {
                e.preventDefault();
                this.generateRenderedPreview(false);
            }
            // Alt+D: Orijinali (Doğal) Dinle
            if (e.altKey && (e.key === 'd' || e.key === 'D')) {
                e.preventDefault();
                this.generateRenderedPreview(true);
            }
        };
        document.addEventListener('keydown', this._keydownHandler);
    },

    close() {
        this.stopPreview();
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
        }
        this.dialog.close();
        if (VideoPlayer.videoElement) VideoPlayer.videoElement.muted = false;
        VideoPlayer.syncSegmentProperties();
    },

    identifyTarget() {
        console.log('Ses Ayarları: Hedef belirleniyor...');

        // 1. İmleç Konumundaki Segment
        const currentTime = VideoPlayer.getTimelineTime();
        let mainSegmentData = Timeline.getSegmentAt(currentTime);

        // 2. Eğer imleç boşluktaysa, en yakın önceki segmenti veya ilk segmenti bul
        if (!mainSegmentData && Timeline.segments.length > 0) {
            console.log('İmleç altında segment yok, varsayılan seçiliyor.');
            // Şimdilik ilk segmenti seçelim (veya son seçiliyi)
            // TODO: Daha akıllı seçim mantığı
            mainSegmentData = {
                segment: Timeline.segments[0],
                segmentIndex: 0
            };
        }

        if (mainSegmentData) {
            this.targetItem = {
                type: 'video',
                id: mainSegmentData.segmentIndex, // index
                object: mainSegmentData.segment,
                ref: mainSegmentData
            };
            const title = document.getElementById('audio-settings-title');
            if (title) {
                title.textContent = this.t('runtime.audio_settings.segment_title', `Ses Ayarları: ${mainSegmentData.segmentIndex + 1}. Video Parçası`, { index: mainSegmentData.segmentIndex + 1 });
            }
            console.log('Hedef belirlendi:', this.targetItem);
        } else {
            console.warn('Ses ayarları için uygun bir hedef bulunamadı (Timeline boş olabilir).');
            this.targetItem = null;
        }
    },

    loadValues() {
        if (!this.targetItem) return;

        const data = this.targetItem.object;

        // Varsayılanlar
        const vol = (data.audioVolume !== undefined) ? data.audioVolume : 100;
        const noise = data.noiseReduction || { enabled: false, level: 'medium', custom: 50 };
        const effects = data.audioEffects || { echo: false, reverb: false, phone: false };
        const muted = !!data.isMuted;
        const channelMode = data.audioChannelMode || 'source';

        // UI Doldur
        this.volumeSlider.value = vol;
        this.volumeValue.textContent = `%${vol}`;
        this.volumeBypass.checked = muted;
        this.volumeSlider.disabled = muted;
        if (this.channelMode) {
            this.channelMode.value = channelMode;
        }
        this.updateChannelAccessibilityLabel();

        this.noiseEnable.checked = noise.enabled;

        // Radio seçimi
        this.noiseRadios.forEach(r => r.checked = false);
        const radioToCheck = document.getElementById(this.getNoiseRadioId(noise.level));
        if (radioToCheck) radioToCheck.checked = true;

        this.noiseSlider.value = noise.custom || 50;
        this.noiseValue.textContent = this.noiseSlider.value;

        this.effectEcho.checked = effects.echo;
        this.effectReverb.checked = effects.reverb;
        this.effectPhone.checked = effects.phone;

        this.updateNoiseUI();
        this.updatePreview(); // Ses seviyesini anında videoya uygula
    },

    resetValues() {
        this.volumeSlider.value = 100;
        this.volumeValue.textContent = '%100';
        this.volumeBypass.checked = false;
        this.volumeSlider.disabled = false;
        if (this.channelMode) this.channelMode.value = 'source';
        this.updateChannelAccessibilityLabel();

        this.noiseEnable.checked = false;
        document.getElementById(this.getNoiseRadioId('medium')).checked = true;
        this.noiseSlider.value = 50;

        this.effectEcho.checked = false;
        this.effectReverb.checked = false;
        this.effectPhone.checked = false;

        this.updateNoiseUI();
        this.updatePreview();
    },

    async apply() {
        const vol = parseInt(this.volumeSlider.value);
        const muted = this.volumeBypass.checked;
        const selectedChannelMode = this.channelMode ? this.channelMode.value : 'source';

        let noiseLevel = 'medium';
        this.noiseRadios.forEach(r => { if (r.checked) noiseLevel = r.value; });

        const noiseData = {
            enabled: this.noiseEnable.checked,
            level: noiseLevel,
            custom: parseInt(this.noiseSlider.value)
        };

        const effectsData = {
            echo: this.effectEcho.checked,
            reverb: this.effectReverb.checked,
            phone: this.effectPhone.checked
        };

        Timeline.saveState(); // Değişiklik öncesi durum kaydet
        let appliedCount = 0;

        const shouldWarnNoChannelChange = (segmentsToCheck = []) => {
            if (selectedChannelMode === 'source' || !segmentsToCheck.length) {
                return false;
            }

            const allSame = segmentsToCheck.every((seg) => {
                const effectiveMode = (seg.audioChannelMode === 'mono' || seg.audioChannelMode === 'stereo')
                    ? seg.audioChannelMode
                    : this.getEffectiveChannelMode(seg);
                return effectiveMode === selectedChannelMode;
            });

            if (allSame) {
                Accessibility.announce(this.t('dialog.audio_settings.channel_already_same', 'Seçili kayıt zaten {value} durumda.', {
                    value: this.getChannelLabel(selectedChannelMode)
                }));
                return true;
            }

            return false;
        };

        // 1. Seçim var mı kontrol et (Range Selection)
        const selection = (typeof Selection !== 'undefined' && Selection.getSelection) ? Selection.getSelection() : null;

        if (selection) {
            const selectedSegments = [];
            // Seçili alandaki tüm segmentlere uygula
            const segments = Timeline.segments;
            for (const seg of segments) {
                // Kesişim kontrolü
                if (seg.end > selection.start && seg.start < selection.end) {
                    selectedSegments.push(seg);
                }
            }

            if (shouldWarnNoChannelChange(selectedSegments)) {
                return;
            }

            for (const seg of selectedSegments) {
                seg.audioVolume = vol;
                seg.isMuted = muted;
                seg.noiseReduction = { ...noiseData };
                seg.audioEffects = { ...effectsData };
                seg.audioChannelMode = selectedChannelMode;
                appliedCount++;
            }

            if (appliedCount > 0) {
                console.log(`Ses ayarları ${appliedCount} segmente uygulandı (Seçim Aralığı)`);
                Accessibility.announce(`Ses ayarları seçili alandaki ${appliedCount} klibe uygulandı`);
                Timeline.hasChanges = true;
                this.close();
                return;
            }
        }

        // 2. Seçim yoksa, mevcut hedef (imleç altındaki) klibe uygula
        if (this.targetItem && this.targetItem.type === 'video') {
            const seg = this.targetItem.object; // Referans
            if (shouldWarnNoChannelChange([seg])) {
                return;
            }
            seg.audioVolume = vol;
            seg.isMuted = muted;
            seg.noiseReduction = { ...noiseData };
            seg.audioEffects = { ...effectsData };
            seg.audioChannelMode = selectedChannelMode;

            Timeline.hasChanges = true;
            console.log('Ses ayarları uygulandı:', seg);
            Accessibility.announce('Ses ayarları kaydedildi');
        }

        this.close();
    },

    // --- PREVIEW LOGIC ---

    togglePreview() {
        if (this.isPreviewing) {
            this.stopPreview();
        } else {
            this.startPreview();
        }
    },

    startPreview() {
        if (this.isPreviewing) return;
        this.isPreviewing = true;
        this.previewBtn.textContent = this.t('runtime.audio_settings.stop_preview', 'Durdur (Alt+P)');

        // Video oynat
        VideoPlayer.play();
        this.updatePreview();
    },

    stopPreview() {
        if (!this.isPreviewing) return;
        this.isPreviewing = false;
        this.previewBtn.textContent = this.t('dialog.audio_settings.preview', 'Ön İzle Başlat (Alt+P)');

        VideoPlayer.pause();
        // Reset preview effects appropriately handled by updatePreview in loop?
        // Actually, pausing video stops sound.
    },

    updatePreview() {
        // Slider değişikliklerini anında video sesine yansıt (dialog açıkken)

        // Anlık ayarları al
        const volSlider = parseInt(this.volumeSlider.value);
        const bypass = this.volumeBypass.checked;

        // Web Audio gain keeps preview consistent with the 0-400% editor range.
        const vol = bypass ? 0 : Math.max(0, Math.min(4, volSlider / 100));

        console.log(`AudioSettings: Preview Volume Slider=${volSlider}, Gain=${vol.toFixed(2)}, Bypass=${bypass}`);

        if (VideoPlayer.videoElement) {
            VideoPlayer.videoElement.muted = false;
            VideoPlayer.setVolume(vol);
            console.log(`AudioSettings: Applied preview gain=${vol.toFixed(2)}`);
        } else {
            console.error('AudioSettings: Video elementi bulunamadı!');
        }
    },

    previewOriginal(isOriginal) {
        // A/B Karşılaştırma
        if (!this.isPreviewing) return;

        if (isOriginal) {
            // Varsa önceden render edilmiş temiz sesi çal
            if (this.preRenderedOriginalPath) {
                this.playRenderedAudio(this.preRenderedOriginalPath, this.compareBtn, this.t('runtime.audio_settings.listen_original', 'Orj. Dinle'));
            } else {
                // Yoksa anlık bypass (fallback)
                VideoPlayer.setVolume(1);
            }
        } else {
            // Mevcut ayarlar
            this.updatePreview();
        }
    },

    /**
     * Render Edilmiş Önizleme (5sn)
     * FFmpeg kullanarak gerçek bir önizleme oluşturur ve çalar.
     * isOriginal=true ise kaydedilmiş temiz sesi çalar.
     */
    async generateRenderedPreview(isOriginal = false) {
        if (!this.targetItem) return;

        // Orijinal isteniyorsa ve hazir varsa direkt çal
        if (isOriginal && this.preRenderedOriginalPath) {
            this.playRenderedAudio(this.preRenderedOriginalPath, this.compareBtn, this.t('runtime.audio_settings.listen_original', 'Orj. Dinle'));
            return;
        }

        const btn = isOriginal ? this.compareBtn : document.getElementById('btn-render-preview');
        if (btn) {
            btn.disabled = true;
            btn.textContent = this.t('runtime.common.preparing', 'Hazırlanıyor...');
        }

        try {
            console.log('AudioSettings: Rendered Preview isteniyor...');
            const vol = parseInt(this.volumeSlider.value);
            const muted = this.volumeBypass.checked;

            let noiseLevel = 'medium';
            this.noiseRadios.forEach(r => { if (r.checked) noiseLevel = r.value; });

            // isOriginal ise efektleri sıfırla
            const noise = isOriginal ? { enabled: false } : {
                enabled: this.noiseEnable.checked,
                level: noiseLevel,
                custom: parseInt(this.noiseSlider.value)
            };

            const effects = isOriginal ? { echo: false, reverb: false, phone: false } : {
                echo: this.effectEcho.checked,
                reverb: this.effectReverb.checked,
                phone: this.effectPhone.checked
            };

            // Kaynak dosya ve zaman
            const sourceFile = this.targetItem.object.sourceFile || VideoPlayer.currentFilePath;
            if (!sourceFile) throw new Error('Kaynak dosya yok');

            // Mutlak zamanı kullan (VideoPlayer.getCurrentTime())
            const absoluteTime = VideoPlayer.getCurrentTime();

            console.log(`Preview: File=${sourceFile}, Start=${absoluteTime}`);

            const result = await window.api.previewAudioSegment({
                videoPath: sourceFile,
                startTime: absoluteTime,
                duration: 5,
                settings: {
                    volume: isOriginal ? 100 : vol,
                    muted: isOriginal ? false : muted,
                    channelMode: isOriginal ? 'source' : (this.channelMode ? this.channelMode.value : 'source'),
                    noiseReduction: noise,
                    audioEffects: effects
                }
            });

            if (result.success && result.audioPath) {
                this.playRenderedAudio(result.audioPath);
            } else {
                console.error(result.error);
                if (window.Accessibility) Accessibility.alert(this.t('runtime.audio_settings.preview_error', 'Önizleme hatası: {error}', { error: result.error }));
            }

        } catch (e) {
            console.error(e);
            if (window.Accessibility) Accessibility.alert(this.t('runtime.common.error', 'Hata: {error}', { error: e.message }));
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = this.t('runtime.audio_settings.listen_effect', 'Efekti Dinle (5sn)');
            }
        }
    },

    playRenderedAudio(path, btn, defaultText) {
        VideoPlayer.pause(); // Ana videoyu durdur

        console.log('Playing rendered audio:', path);
        // Cache busting ekle
        const audio = new Audio('file://' + path + '?t=' + Date.now());
        audio.volume = 1.0;

        if (btn) btn.textContent = this.t('runtime.audio_settings.playing', 'Çalınıyor...');

        audio.play().catch(e => {
            console.error('Audio play error:', e);
            if (btn) {
                btn.disabled = false;
                btn.textContent = defaultText;
            }
        });

        audio.onended = () => {
            if (btn) {
                btn.disabled = false;
                btn.textContent = defaultText;
            }
            // Temp dosyayı silmek isteyebiliriz ama şimdilik kalsın (OS temizler veya sonraki overwrite eder)
        };
    },

    // UI'ya dinamik buton ekleme (init içinde çağrılır)
    injectRenderButton() {
        if (document.getElementById('btn-render-preview')) return;

        const btn = document.createElement('button');
        btn.id = 'btn-render-preview';
        btn.textContent = this.t('runtime.audio_settings.listen_effect', 'Efekti Dinle (5sn)');
        btn.className = 'btn btn-secondary';
        btn.style.marginRight = '10px';
        btn.title = this.t('runtime.audio_settings.listen_effect_title', 'Ayarları render ederek 5 saniyelik gerçek önizleme dinlet');

        // Preview butonunun yanına ekle
        if (this.previewBtn && this.previewBtn.parentNode) {
            this.previewBtn.parentNode.insertBefore(btn, this.previewBtn);
        }

        btn.addEventListener('click', () => this.generateRenderedPreview());
    }

};

window.AudioSettings = AudioSettings;
document.addEventListener('DOMContentLoaded', () => AudioSettings.init());
