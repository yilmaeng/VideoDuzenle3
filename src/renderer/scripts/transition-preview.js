/**
 * Transition Preview Manager
 * Video oynatılırken geçiş efektlerini gerçek zamanlı önizleme
 * Non-destructive - CSS filter/overlay ile simülasyon
 */
const TransitionPreview = {
    mainVideo: null,
    overlayElement: null,
    transitionAudio: null,

    // Timeline'daki geçişler
    timelineTransitions: [],

    // Aktif geçiş
    activeTransition: null,
    activeTimeout: null,

    // Ses dosyaları cache
    sfxCache: {},

    /**
     * Başlat
     */
    init() {
        this.mainVideo = document.getElementById('video-player');

        if (!this.mainVideo) {
            console.warn('TransitionPreview: video-player elementi henüz yok, 500ms sonra tekrar denenecek');
            setTimeout(() => this.init(), 500);
            return;
        }

        // Overlay element'i oluştur (fade efektleri için)
        this.createOverlayElement();

        // Ses elementi oluştur
        this.transitionAudio = document.createElement('audio');
        this.transitionAudio.id = 'transition-audio';
        document.body.appendChild(this.transitionAudio);

        // Event listeners
        this.setupEventListeners();

        console.log('TransitionPreview başlatıldı. Video element:', this.mainVideo);
    },

    /**
     * Overlay element oluştur
     */
    createOverlayElement() {
        // Video container'ı bul
        const videoContainer = document.querySelector('.video-container');
        if (!videoContainer) {
            console.warn('Video container bulunamadı, overlay oluşturulamadı');
            return;
        }

        // Overlay div oluştur
        this.overlayElement = document.createElement('div');
        this.overlayElement.id = 'transition-overlay';
        this.overlayElement.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            opacity: 0;
            z-index: 100;
            transition: opacity 0.05s linear;
        `;

        videoContainer.appendChild(this.overlayElement);
    },

    /**
     * Event listeners kur
     */
    setupEventListeners() {
        if (!this.mainVideo) return;

        // Video zaman güncelleme
        this.mainVideo.addEventListener('timeupdate', () => {
            this.checkTransitionTiming();
        });

        // Video pause/stop olduğunda efekti temizle
        this.mainVideo.addEventListener('pause', () => {
            this.clearActiveTransition();
        });

        this.mainVideo.addEventListener('seeked', () => {
            this.clearActiveTransition();
        });
    },

    /**
     * Geçiş zamanlamasını kontrol et
     */
    checkTransitionTiming() {
        if (!this.mainVideo || this.timelineTransitions.length === 0) return;

        // Timeline zamanını kullan (VideoPlayer varsa)
        let currentTime;
        if (typeof VideoPlayer !== 'undefined' && VideoPlayer.getTimelineTime) {
            currentTime = VideoPlayer.getTimelineTime();
        } else {
            currentTime = this.mainVideo.currentTime;
        }

        // Her geçişi kontrol et
        for (const transition of this.timelineTransitions) {
            const halfDur = (transition.duration || 0.5) / 2;
            const startTime = transition.time - halfDur;
            const endTime = transition.time + halfDur;

            // Bu geçişin zamanı mı?
            if (currentTime >= startTime && currentTime <= endTime) {
                // Aktif geçiş değilse başlat
                if (this.activeTransition !== transition) {
                    this.startTransitionEffect(transition, currentTime);
                } else {
                    // Aktif geçişi güncelle
                    this.updateTransitionEffect(transition, currentTime);
                }
                return; // Bir anda sadece bir geçiş
            }
        }

        // Hiçbir geçiş aktif değilse temizle
        if (this.activeTransition) {
            this.clearActiveTransition();
        }
    },

    /**
     * Geçiş efektini başlat
     */
    startTransitionEffect(transition, currentTime) {
        this.activeTransition = transition;

        console.log(`Geçiş önizleme başladı: ${transition.transitionType} @ ${transition.time}s`);

        // Ses efekti çal
        if (transition.useSfx !== false) {
            this.playTransitionSound(transition.transitionType, transition.customSfxPath);
        }

        // Görsel efekti uygula
        this.updateTransitionEffect(transition, currentTime);
    },

    /**
     * Geçiş efektini güncelle (her frame)
     */
    updateTransitionEffect(transition, currentTime) {
        const halfDur = (transition.duration || 0.5) / 2;
        const fadeOutStart = transition.time - halfDur;
        const fadeInStart = transition.time;
        const endTime = transition.time + halfDur;

        let intensity = 0;

        // Fade out (kararma) aşaması
        if (currentTime >= fadeOutStart && currentTime < fadeInStart) {
            intensity = (currentTime - fadeOutStart) / halfDur;
        }
        // Fade in (açılma) aşaması
        else if (currentTime >= fadeInStart && currentTime <= endTime) {
            intensity = 1 - ((currentTime - fadeInStart) / halfDur);
        }

        // Efekt tipine göre uygula
        this.applyVisualEffect(transition.transitionType, intensity);
    },

    /**
     * Görsel efekti uygula
     */
    applyVisualEffect(type, intensity) {
        if (!this.overlayElement || !this.mainVideo) return;

        // Intensity: 0 = normal, 1 = tam efekt
        intensity = Math.max(0, Math.min(1, intensity));

        switch (type) {
            case 'dip_black':
            case 'fade':
            case 'dipToBlack':
            default:
                // Siyaha fade
                this.overlayElement.style.backgroundColor = 'black';
                this.overlayElement.style.opacity = intensity;
                this.mainVideo.style.filter = `brightness(${1 - intensity})`;
                break;

            case 'dip_white':
            case 'dipToWhite':
                // Beyaza fade
                this.overlayElement.style.backgroundColor = 'white';
                this.overlayElement.style.opacity = intensity;
                this.mainVideo.style.filter = `brightness(${1 + intensity})`;
                break;

            case 'fade_in':
                // Sadece parlaklık artışı
                this.mainVideo.style.filter = `brightness(${1 - intensity})`;
                this.overlayElement.style.opacity = 0;
                break;

            case 'fade_out':
                // Sadece karartma
                this.mainVideo.style.filter = `brightness(${1 - intensity})`;
                this.overlayElement.style.opacity = 0;
                break;
        }
    },

    /**
     * Geçiş sesini çal (yüksek sesle)
     */
    playTransitionSound(transitionType, customSfxPath) {
        console.log(`SFX çalınıyor: transitionType=${transitionType}, customPath=${customSfxPath}`);

        // Ses dosyası yolunu belirle
        let sfxPath = customSfxPath;

        if (!sfxPath) {
            // Varsayılan ses dosyaları - transitionType eşleştirmesi
            const sfxMap = {
                // Fade türleri
                'fade': 'fade.wav',
                'fade_in': 'fade.wav',
                'fade_out': 'fade.wav',
                'fadeIn': 'fade.wav',
                'fadeOut': 'fade.wav',
                // Dip türleri
                'dip_black': 'dip_to_black.wav',
                'dip_white': 'dip_to_black.wav',
                'dipToBlack': 'dip_to_black.wav',
                'dipToWhite': 'dip_to_black.wav',
                // Chapter türleri
                'chapterBreak': 'chapter_break.wav',
                'chapter_break': 'chapter_break.wav',
                // Cross dissolve
                'crossDissolve': 'cross_dissolve.wav',
                'cross_dissolve': 'cross_dissolve.wav'
            };

            const sfxFile = sfxMap[transitionType] || 'cross_dissolve.wav';
            sfxPath = `assets/sfx/${sfxFile}`;
            console.log(`SFX dosyası seçildi: ${sfxFile} (path: ${sfxPath})`);
        }

        try {
            // Yeni audio element oluştur (her seferinde temiz)
            const audio = new Audio(sfxPath);
            audio.volume = 1.0;

            // Web Audio API ile amplify et
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            // AudioContext resume (Chrome autoplay policy)
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }

            // Audio elementi source olarak kullan
            const source = this.audioContext.createMediaElementSource(audio);
            const gainNode = this.audioContext.createGain();
            gainNode.gain.value = 0.15; // Dengeli ses seviyesi

            source.connect(gainNode);
            gainNode.connect(this.audioContext.destination);

            // Çal
            audio.play().catch(e => {
                console.warn('Geçiş sesi çalınamadı:', e);
            });

        } catch (e) {
            console.warn('Ses çalma hatası, basit mod deneniyor:', e);
            // Fallback: Basit audio
            try {
                const simpleAudio = new Audio(sfxPath);
                simpleAudio.volume = 1.0;
                simpleAudio.play().catch(() => { });
            } catch (e2) {
                console.warn('Basit ses de çalınamadı:', e2);
            }
        }
    },

    /**
     * Aktif geçişi temizle
     */
    clearActiveTransition() {
        this.activeTransition = null;

        // Görsel efektleri sıfırla
        if (this.overlayElement) {
            this.overlayElement.style.opacity = 0;
        }
        if (this.mainVideo) {
            this.mainVideo.style.filter = '';
        }

        // Sesi durdur
        if (this.transitionAudio) {
            this.transitionAudio.pause();
        }
    },

    /**
     * Geçişi timeline'a ekle
     */
    addTransition(params) {
        const {
            time,
            transitionType = 'dip_black',
            duration = 0.5,
            useSfx = true,
            customSfxPath = null
        } = params;

        const id = `trans_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const transition = {
            id,
            time,
            transitionType,
            duration,
            useSfx,
            customSfxPath,
            addedAt: Date.now()
        };

        this.timelineTransitions.push(transition);

        // Zamana göre sırala
        this.timelineTransitions.sort((a, b) => a.time - b.time);

        console.log(`TransitionPreview: Geçiş eklendi: ${transitionType} @ ${time}s. Toplam: ${this.timelineTransitions.length}`);
        console.log('TransitionPreview: Tüm geçişler:', this.timelineTransitions);
        return { success: true, id, transition };
    },

    /**
     * Geçişi kaldır
     */
    removeTransition(id) {
        const index = this.timelineTransitions.findIndex(t => t.id === id);
        if (index !== -1) {
            this.timelineTransitions.splice(index, 1);
            console.log(`Geçiş kaldırıldı: ${id}`);
            return true;
        }
        return false;
    },

    /**
     * Tüm geçişleri temizle
     */
    clearAllTransitions() {
        this.timelineTransitions = [];
        this.clearActiveTransition();
        console.log('Tüm geçişler temizlendi');
    },

    /**
     * Geçiş sayısını döndür
     */
    getTransitionCount() {
        return this.timelineTransitions.length;
    },

    /**
     * Tüm geçişleri döndür
     */
    getTimelineTransitions() {
        return this.timelineTransitions;
    },

    /**
     * Proje için export
     */
    exportForProject() {
        return this.timelineTransitions.map(t => ({
            time: t.time,
            transitionType: t.transitionType,
            duration: t.duration,
            useSfx: t.useSfx,
            customSfxPath: t.customSfxPath
        }));
    },

    /**
     * Projeden import
     */
    importFromProject(transitionsData) {
        if (!Array.isArray(transitionsData)) return;

        this.clearAllTransitions();

        transitionsData.forEach(t => {
            this.addTransition(t);
        });

        console.log(`${transitionsData.length} geçiş projeden yüklendi`);
    }
};

// Sayfa yüklendiğinde başlat
document.addEventListener('DOMContentLoaded', () => {
    TransitionPreview.init();
});
