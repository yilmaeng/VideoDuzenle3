/**
 * Ses Ayarları Modülü
 * İlgili klibin (Video veya Ses) ses özelliklerini yönetir.
 */
const AudioSettings = {
    dialog: null,
    targetItem: null, // { type: 'video'|'audio', id: number|null, object: Object }

    // UI Elements
    volumeSlider: null,
    volumeValue: null,
    volumeBypass: null,

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

    init() {
        this.dialog = document.getElementById('audio-settings-dialog');
        if (!this.dialog) return;

        // Elementleri seç
        this.volumeSlider = document.getElementById('as-volume-slider');
        this.volumeValue = document.getElementById('as-volume-value');
        this.volumeBypass = document.getElementById('as-volume-bypass');

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
        this.compareBtn.textContent = "Orj. Dinle";
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

    open() {
        this.identifyTarget();
        if (!this.targetItem) {
            console.error('Ses Ayarları: Hedef bulunamadı');
            if (window.Accessibility) Accessibility.announceError('Düzenlenecek bir video veya ses klibi bulunamadı.');
            return;
        }

        this.loadValues();
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
                title.textContent = `Ses Ayarları: ${mainSegmentData.segmentIndex + 1}. Video Parçası`;
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

        // UI Doldur
        this.volumeSlider.value = vol;
        this.volumeValue.textContent = `%${vol}`;
        this.volumeBypass.checked = muted;
        this.volumeSlider.disabled = muted;

        this.noiseEnable.checked = noise.enabled;

        // Radio seçimi
        this.noiseRadios.forEach(r => r.checked = false);
        const radioToCheck = document.getElementById(`noise-${noise.level}`);
        if (radioToCheck) radioToCheck.checked = true;

        this.noiseSlider.value = noise.custom || 50;
        this.noiseValue.textContent = this.noiseSlider.value;

        this.effectEcho.checked = effects.echo;
        this.effectReverb.checked = effects.reverb;
        this.effectPhone.checked = effects.phone;

        this.updateNoiseUI();
    },

    resetValues() {
        this.volumeSlider.value = 100;
        this.volumeValue.textContent = '%100';
        this.volumeBypass.checked = false;
        this.volumeSlider.disabled = false;

        this.noiseEnable.checked = false;
        document.getElementById('noise-medium').checked = true;
        this.noiseSlider.value = 50;

        this.effectEcho.checked = false;
        this.effectReverb.checked = false;
        this.effectPhone.checked = false;

        this.updateNoiseUI();
        this.updatePreview();
    },

    apply() {
        const vol = parseInt(this.volumeSlider.value);
        const muted = this.volumeBypass.checked;

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

        // 1. Seçim var mı kontrol et (Range Selection)
        const selection = (typeof Selection !== 'undefined' && Selection.getSelection) ? Selection.getSelection() : null;

        if (selection) {
            // Seçili alandaki tüm segmentlere uygula
            const segments = Timeline.segments;
            for (const seg of segments) {
                // Kesişim kontrolü
                if (seg.end > selection.start && seg.start < selection.end) {
                    seg.audioVolume = vol;
                    seg.isMuted = muted;
                    seg.noiseReduction = { ...noiseData };
                    seg.audioEffects = { ...effectsData };
                    appliedCount++;
                }
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
            seg.audioVolume = vol;
            seg.isMuted = muted;
            seg.noiseReduction = { ...noiseData };
            seg.audioEffects = { ...effectsData };

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
        this.previewBtn.textContent = 'Durdur (Alt+P)';

        // Video oynat
        VideoPlayer.play();
        this.updatePreview();
    },

    stopPreview() {
        if (!this.isPreviewing) return;
        this.isPreviewing = false;
        this.previewBtn.textContent = 'Ön İzle Başlat (Alt+P)';

        VideoPlayer.pause();
        // Reset preview effects appropriately handled by updatePreview in loop?
        // Actually, pausing video stops sound.
    },

    updatePreview() {
        if (!this.isPreviewing) return;

        // Anlık ayarları al
        const volSlider = parseInt(this.volumeSlider.value);
        const bypass = this.volumeBypass.checked;
        const vol = bypass ? 0 : (volSlider / 100);

        console.log(`AudioSettings: Preview Volume Target: ${vol} (Slider: ${volSlider}, Bypass: ${bypass})`);

        // VideoPlayer üzerinden ses ayarla
        const videoEl = (VideoPlayer.videoElement) || (VideoPlayer.video) || document.getElementById('main-video');

        if (videoEl) {
            videoEl.volume = Math.min(1, Math.max(0, vol));
            videoEl.muted = false; // Mutlaka sesi aç
            console.log(`AudioSettings: Applied Volume: ${videoEl.volume}`);
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
                this.playRenderedAudio(this.preRenderedOriginalPath, this.compareBtn, "Orj. Dinle");
            } else {
                // Yoksa anlık bypass (fallback)
                if (VideoPlayer.videoElement) VideoPlayer.videoElement.volume = 1.0;
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
            this.playRenderedAudio(this.preRenderedOriginalPath, this.compareBtn, "Orj. Dinle");
            return;
        }

        const btn = isOriginal ? this.compareBtn : document.getElementById('btn-render-preview');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Hazırlanıyor...';
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
                    noiseReduction: noise,
                    audioEffects: effects
                }
            });

            if (result.success && result.audioPath) {
                this.playRenderedAudio(result.audioPath);
            } else {
                console.error(result.error);
                if (window.Accessibility) Accessibility.alert('Önizleme hatası: ' + result.error);
            }

        } catch (e) {
            console.error(e);
            if (window.Accessibility) Accessibility.alert('Hata: ' + e.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Efekti Dinle (5sn)';
            }
        }
    },

    playRenderedAudio(path, btn, defaultText) {
        VideoPlayer.pause(); // Ana videoyu durdur

        console.log('Playing rendered audio:', path);
        // Cache busting ekle
        const audio = new Audio('file://' + path + '?t=' + Date.now());
        audio.volume = 1.0;

        if (btn) btn.textContent = 'Çalınıyor...';

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
        btn.textContent = 'Efekti Dinle (5sn)';
        btn.className = 'btn btn-secondary';
        btn.style.marginRight = '10px';
        btn.title = 'Ayarları render ederek 5 saniyelik gerçek önizleme dinlet';

        // Preview butonunun yanına ekle
        if (this.previewBtn && this.previewBtn.parentNode) {
            this.previewBtn.parentNode.insertBefore(btn, this.previewBtn);
        }

        btn.addEventListener('click', () => this.generateRenderedPreview());
    }

};

window.AudioSettings = AudioSettings;
document.addEventListener('DOMContentLoaded', () => AudioSettings.init());
