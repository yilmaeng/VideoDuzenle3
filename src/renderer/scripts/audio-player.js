/**
 * Audio Player Modülü
 * Timeline üzerindeki ses dosyalarının önizlemesini yönetir.
 * VideoPlayer ile senkronize çalışır.
 */
const AudioPlayer = {
    tracks: [], // { id, audio: HTMLAudioElement, options: Object }
    videoElement: null,
    isPlaying: false,

    init() {
        console.log('AudioPlayer başlatılıyor...');
        this.videoElement = document.getElementById('video-player');

        // InsertionQueue değişikliklerini dinle
        document.addEventListener('insertion-queue-change', (e) => {
            console.log('AudioPlayer: Queue change detected', e.detail);
            this.updateTracksFromQueue(e.detail.items);
        });

        // VideoPlayer eventlerini dinle
        if (this.videoElement) {
            this.videoElement.addEventListener('play', () => this.onVideoPlay());
            this.videoElement.addEventListener('pause', () => this.onVideoPause());
            this.videoElement.addEventListener('seeking', () => this.onVideoSeek());
            this.videoElement.addEventListener('seeked', () => this.onVideoSeek());
            this.videoElement.addEventListener('timeupdate', () => this.onVideoTimeUpdate());
            this.videoElement.addEventListener('ratechange', () => this.onVideoRateChange());
        }

        // İlk yükleme
        if (window.InsertionQueue) {
            this.updateTracksFromQueue(window.InsertionQueue.getItems());
        }
    },

    updateTracksFromQueue(items) {
        if (!items) return;

        // Sadece ses öğelerini al
        const audioItems = items.filter(i => i.type === 'audio');
        console.log(`AudioPlayer: ${audioItems.length} audio items found`);

        // Mevcut trackleri işaretle (silinecek mi?)
        const activeIds = new Set(audioItems.map(i => i.id));

        // Silinenleri kaldır
        this.tracks = this.tracks.filter(track => {
            if (!activeIds.has(track.id)) {
                console.log('AudioPlayer: Removing track', track.id);
                track.audio.pause();
                track.audio.src = '';
                track.audio = null;
                return false;
            }
            return true;
        });

        // Yeni veya güncellenenleri ekle
        audioItems.forEach(item => {
            let track = this.tracks.find(t => t.id === item.id);
            // Parametre uyumluluğu: audioPath (dialogs.js) veya path
            const path = item.options.audioPath || item.options.path || item.options.file;

            if (!path) {
                console.warn('AudioPlayer: Item has no path', item);
                return;
            }

            if (!track) {
                // Yeni track
                console.log('AudioPlayer: Adding new track', path);
                const audio = new Audio();
                audio.src = path;
                audio.preload = 'auto';

                track = {
                    id: item.id,
                    audio: audio,
                    options: item.options
                };
                this.tracks.push(track);
            } else {
                // Güncelleme
                track.options = item.options;
                // Path değişmişse güncelle
                // Basit bir check: src içinde filename var mı?
                const fileName = path.split(/[/\\]/).pop();
                if (!track.audio.src.includes(encodeURIComponent(fileName))) {
                    console.log('AudioPlayer: Updating track source', path);
                    track.audio.src = path;
                }
            }

            this.applyTrackSettings(track);
        });
    },

    applyTrackSettings(track) {
        let vol = 1.0;
        // Farklı isimlendirmeleri kontrol et
        const opts = track.options;

        if (opts.audioVolume !== undefined) vol = parseFloat(opts.audioVolume);
        else if (opts.volume !== undefined) vol = parseFloat(opts.volume);

        // Eğer scale 0-100 ise 0-1'e normalize et (genellikle 1.0 üstü ise 100 tabanlıdır)
        if (vol > 1.0) vol = vol / 100;

        track.audio.volume = Math.max(0, Math.min(1, isNaN(vol) ? 1.0 : vol));
    },

    onVideoPlay() {
        this.isPlaying = true;
        this.syncAll();
    },

    onVideoPause() {
        this.isPlaying = false;
        this.pauseAll();
    },

    onVideoSeek() {
        this.syncAll(true); // Forced sync
    },

    onVideoTimeUpdate() {
        if (!this.isPlaying) return;
        this.syncAll();
    },

    onVideoRateChange() {
        if (!this.videoElement) return;
        const rate = this.videoElement.playbackRate;
        this.tracks.forEach(t => t.audio.playbackRate = rate);
    },

    pauseAll() {
        this.tracks.forEach(t => t.audio.pause());
    },

    syncAll(forceSeek = false) {
        if (!this.videoElement) return;
        const currentTime = window.VideoPlayer ? window.VideoPlayer.getTimelineTime() : this.videoElement.currentTime;
        // Video gerçekten oynuyor mu?
        const isVideoPlaying = !this.videoElement.paused && !this.videoElement.ending;

        this.tracks.forEach(track => {
            const opts = track.options;

            // Başlangıç zamanı (Video üzerinde)
            const startTime = parseFloat(opts.startTime || opts.start || 0);

            // Trim (Kesme) ayarları (Ses dosyası üzerinde)
            const trimStart = parseFloat(opts.audioTrimStart || opts.trimStart || 0);

            // Bitiş (Trim End veya Duration)
            let trimEnd = parseFloat(opts.audioTrimEnd || opts.trimEnd || track.audio.duration || Infinity);
            if (isNaN(trimEnd)) trimEnd = Infinity;

            // Efektif süre (çalınacak kısım)
            const effectiveDuration = trimEnd - trimStart;

            // Bitiş zamanı (Video üzerinde)
            const endTime = startTime + effectiveDuration;

            // Arka plan / Loop mu?
            const isBackground = !!(opts.loopAudio || opts.isBackground || opts.background);

            // Ses şu anki zaman diliminde mi? (Zaman aralığı kontrolü)
            const isInTimeRange = (isBackground || (currentTime >= startTime && currentTime < endTime));

            if (isInTimeRange) {
                // Video başlangıcından ne kadar süre geçti?
                let timeSinceStart = currentTime - startTime;
                let targetAudioTime = 0;

                // Background loop mantığı
                if (isBackground) {
                    if (effectiveDuration > 0 && isFinite(effectiveDuration)) {
                        const loopPos = timeSinceStart % effectiveDuration;
                        const positiveLoopPos = loopPos < 0 ? loopPos + effectiveDuration : loopPos;
                        targetAudioTime = trimStart + positiveLoopPos;
                    } else {
                        targetAudioTime = trimStart + timeSinceStart;
                    }
                } else {
                    // Normal çalma
                    targetAudioTime = trimStart + timeSinceStart;

                    // Eğer trimEnd'i geçtiyse durdur
                    if (targetAudioTime >= trimEnd) {
                        if (!track.audio.paused) track.audio.pause();
                        return;
                    }
                }

                // Audio hazır değilse çık
                if (isNaN(track.audio.duration)) return;

                // Sync check
                const timeDiff = Math.abs(track.audio.currentTime - targetAudioTime);

                if (isVideoPlaying) {
                    // Video OYNUYORSA: Ses de çalmalı
                    if (track.audio.paused) {
                        track.audio.currentTime = targetAudioTime;
                        track.audio.play().catch(e => {
                            // console.warn('Audio play error:', e);
                        });
                    } else if (timeDiff > 0.3 || forceSeek) {
                        // 300ms'den fazla kayma varsa düzelt
                        track.audio.currentTime = targetAudioTime;
                    }
                } else {
                    // Video DURUYORSA: Ses de durmalı (ama konumu doğru olmalı)
                    if (timeDiff > 0.1 || forceSeek) {
                        track.audio.currentTime = targetAudioTime;
                    }
                    if (!track.audio.paused) {
                        track.audio.pause();
                    }
                }
            } else {
                // Zaman aralığı dışında -> Durdur
                if (!track.audio.paused) {
                    track.audio.pause();
                }
            }
        });
    }
};

window.AudioPlayer = AudioPlayer;
