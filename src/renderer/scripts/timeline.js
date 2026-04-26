/**
 * Timeline Modülü
 * Non-destructive editing için Edit Decision List (EDL) yönetimi
 * Tüm düzenleme işlemleri bellekte tutulur, sadece dışa aktarırken FFmpeg çalışır
 */

const Timeline = {
    // Kaynak dosya
    sourceFile: null,
    sourceDuration: 0,

    // Segment listesi - video'nun hangi kısımlarının gösterileceği
    // Her segment: { start: number, end: number }
    // Örnek: [{start: 0, end: 10}, {start: 25, end: 60}] → 10-25 arası silinmiş
    segments: [],

    // Pano (clipboard)
    clipboard: null, // { segments: [], duration: number }

    // Geri alma / yineleme
    undoStack: [],
    redoStack: [],
    maxUndoSteps: 50,

    // Değişiklik durumu
    hasChanges: false,

    /**
     * Modülü başlat
     */
    init() {
        this.reset();
    },

    /**
     * Sıfırla
     */
    reset() {
        this.sourceFile = null;
        this.sourceDuration = 0;
        this.segments = [];
        this.clipboard = null;
        this.undoStack = [];
        this.redoStack = [];
        this.hasChanges = false;
        this.renderVisuals();
    },

    /**
     * Video yükle - tüm video tek segment olarak başlar
     * @param {string} filePath - Dosya yolu
     * @param {number} duration - Video süresi (saniye)
     */
    loadVideo(filePath, duration) {
        this.reset();
        this.sourceFile = filePath;
        this.sourceDuration = duration;
        // Başlangıçta tüm video tek bir segment
        this.segments = [{
            start: 0,
            end: duration,
            // Ses özellikleri
            audioVolume: 100, // %
            noiseReduction: { enabled: false, level: 'medium', custom: 50 },
            audioEffects: { echo: false, reverb: false, phone: false },
            isMuted: false, // Bypass için (Volume 0 veya bypass)
            speed: 1.0 // Oynatma/Dışa aktarma hızı
        }];
        this.renderVisuals();
        console.log(`Timeline: Video yüklendi, süre: ${duration}s`);
    },

    /**
     * Mevcut durumu kaydet (undo için)
     */
    saveState() {
        this.undoStack.push(JSON.stringify(this.segments));
        if (this.undoStack.length > this.maxUndoSteps) {
            this.undoStack.shift();
        }
        this.redoStack = []; // Yeni işlem yapıldığında redo temizlenir
        this.hasChanges = true;
    },
    /**
     * Durumu geri yükle (Proje yükleme)
     * @param {Array} segments 
     * @param {string} sourceFile 
     * @param {number} duration 
     */
    restoreState(segments, sourceFile, duration) {
        this.reset();
        this.sourceFile = sourceFile;
        this.sourceDuration = duration;
        this.segments = segments;
        this.hasChanges = false;
        this.renderVisuals();
        console.log(`Timeline: Durum yüklendi. ${segments.length} segment, kaynak: ${sourceFile}, süre: ${duration}s`);
    },

    /**
     * Geri al
     * @returns {boolean} Başarılı mı
     */
    undo() {
        if (this.undoStack.length === 0) return false;

        this.redoStack.push(JSON.stringify(this.segments));
        this.segments = JSON.parse(this.undoStack.pop());
        this.renderVisuals();
        return true;
    },

    /**
     * Yinele
     * @returns {boolean} Başarılı mı
     */
    redo() {
        if (this.redoStack.length === 0) return false;

        this.undoStack.push(JSON.stringify(this.segments));
        this.segments = JSON.parse(this.redoStack.pop());
        this.renderVisuals();
        return true;
    },

    /**
     * Timeline gorunumu icin toplam sureyi al
     * @returns {number}
     */
    getVisualDuration() {
        return this.getTotalDuration() || this.sourceDuration || 0;
    },

    /**
     * Segment gorsel siniflarini belirle
     * @param {Object} seg
     * @returns {string[]}
     */
    getSegmentVisualClasses(seg) {
        const classes = ['timeline-segment-block'];
        const isInserted = !!(seg.sourceFile && this.sourceFile && seg.sourceFile !== this.sourceFile);
        const hasAudioChange = seg.audioVolume !== undefined && seg.audioVolume !== 100;
        const hasMuteChange = !!seg.isMuted;
        const hasNoiseChange = !!(seg.noiseReduction && seg.noiseReduction.enabled);
        const hasEffectChange = !!(seg.audioEffects && (seg.audioEffects.echo || seg.audioEffects.reverb || seg.audioEffects.phone));
        const hasSpeedChange = (seg.speed || 1.0) !== 1.0;

        if (isInserted) {
            classes.push('is-inserted');
        } else if (hasAudioChange || hasMuteChange || hasNoiseChange || hasEffectChange || hasSpeedChange || this.segments.length > 1) {
            classes.push('is-edited');
        }

        return classes;
    },

    /**
     * Timeline segment katmanini yeniden ciz
     */
    renderVisuals() {
        const layer = document.getElementById('timeline-segment-layer');
        if (!layer) return;

        layer.innerHTML = '';

        const totalDuration = this.getVisualDuration();
        if (!totalDuration || !Array.isArray(this.segments) || this.segments.length === 0) {
            return;
        }

        let elapsed = 0;

        this.segments.forEach((seg, index) => {
            const speed = seg.speed || 1.0;
            const segDuration = Math.max(0, (seg.end - seg.start) / speed);
            const startPercent = (elapsed / totalDuration) * 100;
            const widthPercent = Math.max((segDuration / totalDuration) * 100, 0.35);
            const segTimelineStart = elapsed;
            const segTimelineEnd = elapsed + segDuration;

            const block = document.createElement('div');
            block.className = this.getSegmentVisualClasses(seg).join(' ');
            block.dataset.segmentIndex = String(index);
            block.dataset.timelineStart = String(segTimelineStart);
            block.dataset.timelineEnd = String(segTimelineEnd);
            block.style.left = `${startPercent}%`;
            block.style.width = `${widthPercent}%`;
            layer.appendChild(block);

            elapsed += segDuration;

            if (index < this.segments.length - 1) {
                const boundary = document.createElement('div');
                boundary.className = 'timeline-segment-boundary';
                boundary.style.left = `${(elapsed / totalDuration) * 100}%`;
                layer.appendChild(boundary);
            }
        });
    },

    /**
     * Aktif segmenti imlec konumuna gore vurgula
     * @param {number} timelineTime
     */
    updateActiveSegment(timelineTime) {
        const blocks = document.querySelectorAll('#timeline-segment-layer .timeline-segment-block');
        if (!blocks.length) return;

        blocks.forEach((block) => {
            const start = parseFloat(block.dataset.timelineStart || '0');
            const end = parseFloat(block.dataset.timelineEnd || '0');
            const isCurrent = Number.isFinite(timelineTime) && timelineTime >= start && timelineTime <= end;
            block.classList.toggle('is-current', isCurrent);
        });
    },

    /**
     * Timeline zamanını kaynak video zamanına çevir
     * @param {number} timelineTime - Timeline üzerindeki zaman
     * @returns {number} Kaynak videodaki gerçek zaman
     */
    timelineToSource(timelineTime) {
        let elapsed = 0;

        for (const seg of this.segments) {
            const speed = seg.speed || 1.0;
            const segDuration = (seg.end - seg.start) / speed;

            if (elapsed + segDuration > timelineTime) {
                // Bu segment içinde
                return seg.start + ((timelineTime - elapsed) * speed);
            }

            elapsed += segDuration;
        }

        // Sonun ötesinde ise son noktayı döndür
        if (this.segments.length > 0) {
            const lastSeg = this.segments[this.segments.length - 1];
            return lastSeg.end;
        }

        return 0;
    },

    /**
     * Kaynak video zamanını timeline zamanına çevir
     * Farklı kaynaklı segmentleri destekler
     * @param {number} sourceTime - Kaynak videodaki zaman
     * @param {string} sourceFile - Hangi kaynak dosyadan (opsiyonel, verilmezse mevcut sourceFile kullanılır)
     * @returns {number} Timeline üzerindeki zaman (-1 eğer silinmiş bölgedeyse)
     */
    sourceToTimeline(sourceTime, sourceFile = null) {
        const targetSource = sourceFile || this.sourceFile;
        let timelineTime = 0;

        for (const seg of this.segments) {
            const segSource = seg.sourceFile || this.sourceFile;
            const speed = seg.speed || 1.0;
            const segDuration = (seg.end - seg.start) / speed;

            // Bu segment aynı kaynaktan mı?
            if (segSource === targetSource) {
                if (sourceTime >= seg.start && sourceTime <= seg.end) {
                    // Bu segment içinde
                    return timelineTime + ((sourceTime - seg.start) / speed);
                }
            }
            timelineTime += segDuration;
        }

        return -1; // Silinmiş bölgede veya bulunamadı
    },

    /**
     * Toplam timeline süresini al
     * @returns {number} Toplam süre (saniye)
     */
    getTotalDuration() {
        return this.segments.reduce((total, seg) => total + ((seg.end - seg.start) / (seg.speed || 1.0)), 0);
    },

    /**
     * Seçili alanı sil (ANI işlem)
     * @param {number} startTime - Başlangıç (timeline zamanı)
     * @param {number} endTime - Bitiş (timeline zamanı)
     * @returns {boolean} Başarılı mı
     */
    deleteRange(startTime, endTime) {
        if (startTime >= endTime) return false;
        if (this.segments.length === 0) return false;

        this.saveState();

        const newSegments = [];
        let elapsed = 0;

        for (const seg of this.segments) {
            const speed = seg.speed || 1.0;
            const segDuration = (seg.end - seg.start) / speed;
            const segStart = elapsed;
            const segEnd = elapsed + segDuration;

            // Bu segment seçimle kesişiyor mu?
            if (segEnd <= startTime || segStart >= endTime) {
                // Kesişmiyor - olduğu gibi ekle
                newSegments.push({ ...seg });
            } else {
                // Kesişiyor - parçala

                // Seçimden önceki kısım
                if (segStart < startTime) {
                    const beforeDuration = (startTime - segStart) * speed;
                    newSegments.push({
                        ...seg,
                        start: seg.start,
                        end: seg.start + beforeDuration
                    });
                }

                // Seçimden sonraki kısım
                if (segEnd > endTime) {
                    const afterOffset = (endTime - segStart) * speed;
                    newSegments.push({
                        ...seg,
                        start: seg.start + afterOffset,
                        end: seg.end
                    });
                }
            }

            elapsed += segDuration;
        }

        this.segments = newSegments;

        // İşaretçileri güncelle
        if (typeof Markers !== 'undefined') {
            Markers.handleTimelineDelete(startTime, endTime);
        }

        this.mergeSegments(); // Segmentleri birleştir (pürüzsüz oynatma için)
        return true;
    },

    /**
     * Ardışık, aynı kaynaktan VE aynı özelliklere sahip segmentleri birleştir
     */
    mergeSegments() {
        if (this.segments.length <= 1) {
            this.renderVisuals();
            return;
        }

        const merged = [];
        let current = { ...this.segments[0] };

        for (let i = 1; i < this.segments.length; i++) {
            const next = this.segments[i];

            // 1. Kaynak Kontrolü
            const sameSource = (current.sourceFile || this.sourceFile) === (next.sourceFile || this.sourceFile);

            // 2. Zaman Sürekliliği
            const isContiguous = Math.abs(current.end - next.start) < 0.05;

            // 3. Özellik (settings) Kontrolü - özellikler farklıysa birleşmemeli
            const sameVolume = current.audioVolume === next.audioVolume;
            const sameMuted = current.isMuted === next.isMuted;
            const sameNoise = JSON.stringify(current.noiseReduction) === JSON.stringify(next.noiseReduction);
            const sameEffects = JSON.stringify(current.audioEffects) === JSON.stringify(next.audioEffects);
            const sameSpeed = (current.speed || 1.0) === (next.speed || 1.0);

            if (sameSource && isContiguous && sameVolume && sameMuted && sameNoise && sameEffects && sameSpeed) {
                current.end = next.end;
            } else {
                merged.push(current);
                current = { ...next };
            }
        }
        merged.push(current);
        this.segments = merged;
        this.renderVisuals();
    },

    /**
     * Timeline'ı belirtilen bir noktadan ikiye böl
     * (Efektleri ayrı ayrı uygulamak için segmentasyon)
     * @param {number} splitTime - Bölünecek nokta (timeline zamanı)
     * @returns {boolean} Başarılı mı
     */
    splitAt(splitTime) {
        if (splitTime <= 0 || splitTime >= this.getTotalDuration()) return false;

        this.saveState();

        const newSegments = [];
        let elapsed = 0;
        let splitted = false;

        for (const seg of this.segments) {
            const speed = seg.speed || 1.0;
            const segDuration = (seg.end - seg.start) / speed;

            // Sadece gerçekten segmentin İÇİNDE bir bölünme varsa (sınırlarında değilse)
            // floating point hassasiyeti için 0.001 saniye hata payı (epsilon) kullanıyoruz.
            const epsilon = 0.001;
            if (splitTime > elapsed + epsilon && splitTime < elapsed + segDuration - epsilon && !splitted) {
                const splitOffset = (splitTime - elapsed) * speed;

                // İlk parça
                newSegments.push({
                    ...seg,
                    end: seg.start + splitOffset
                });

                // İkinci parça
                newSegments.push({
                    ...seg, // Mevcut ayarları kopyala (önemli!)
                    start: seg.start + splitOffset
                });

                splitted = true;
            } else {
                newSegments.push({ ...seg });
            }

            elapsed += segDuration;
        }

        if (splitted) {
            this.segments = newSegments;
            this.renderVisuals();
            // mergeSegments yapmıyoruz, çünkü amaç ayırmak
            return true;
        }

        return false;
    },

    /**
     * Bir aralığı bölerek ayır (Araba gürültüsü senaryosu için)
     * @param {number} startTime 
     * @param {number} endTime 
     */
    splitRange(startTime, endTime) {
        let success = false;
        // Bitişten başlayarak böl, böylece offsetler kaymaz
        if (this.splitAt(endTime)) success = true;
        if (this.splitAt(startTime)) success = true;
        return success;
    },

    /**
     * Seçili alana hız çarpanı uygula
     * @param {number} startTime
     * @param {number} endTime
     * @param {number} speedMultiplier
     * @param {boolean} mute
     * @param {string|null} bgAudioPath - Sessiz alan arka plan sesi
     */
    applySpeedToRange(startTime, endTime, speedMultiplier, mute, bgAudioPath = null) {
        this.saveState();
        this.splitRange(startTime, endTime);

        let elapsed = 0;
        for (let i = 0; i < this.segments.length; i++) {
            const seg = this.segments[i];
            const currentSpeed = seg.speed || 1.0;
            const segDuration = (seg.end - seg.start) / currentSpeed;

            // Eğer segment kesişen bölgedeyse
            // Bölme işlemi yapıldığı için (segEnd <= endTime) vs. yapabiliriz ama hassasiyet sorunları için tolerans ekleyelim.
            const segCenter = elapsed + (segDuration / 2);
            if (segCenter > startTime && segCenter < endTime) {
                seg.speed = parseFloat(speedMultiplier);
                if (mute) {
                    seg.isMuted = true;
                }
                if (bgAudioPath) {
                    seg.speedBgAudio = bgAudioPath;
                }
            }
            elapsed += segDuration;
        }

        this.mergeSegments();
        this.hasChanges = true;
        return true;
    },

    /**
     * Seçili alanı kes (ANI işlem)
     * @param {number} startTime - Başlangıç (timeline zamanı)
     * @param {number} endTime - Bitiş (timeline zamanı)
     * @returns {boolean} Başarılı mı
     */
    cut(startTime, endTime) {
        // Önce kopyala
        if (!this.copy(startTime, endTime)) return false;
        // Sonra sil
        return this.deleteRange(startTime, endTime);
    },

    /**
     * Seçili alanı kopyala (ANI işlem)
     * @param {number} startTime - Başlangıç (timeline zamanı)
     * @param {number} endTime - Bitiş (timeline zamanı)
     * @returns {boolean} Başarılı mı
     */
    copy(startTime, endTime) {
        if (startTime >= endTime) return false;
        if (this.segments.length === 0) return false;

        const copiedSegments = [];
        let elapsed = 0;

        for (const seg of this.segments) {
            const speed = seg.speed || 1.0;
            const segDuration = (seg.end - seg.start) / speed;
            const segStart = elapsed;
            const segEnd = elapsed + segDuration;

            // Bu segment seçimle kesişiyor mu?
            if (segEnd > startTime && segStart < endTime) {
                // Kesişen kısmı al
                const copyStart = Math.max(seg.start, seg.start + ((startTime - segStart) * speed));
                const copyEnd = Math.min(seg.end, seg.start + ((endTime - segStart) * speed));

                if (copyEnd > copyStart) {
                    copiedSegments.push({
                        start: copyStart,
                        end: copyEnd,
                        sourceFile: seg.sourceFile || this.sourceFile,
                        speed: speed,
                        isMuted: seg.isMuted,
                        audioVolume: seg.audioVolume,
                        noiseReduction: seg.noiseReduction ? { ...seg.noiseReduction } : undefined,
                        audioEffects: seg.audioEffects ? { ...seg.audioEffects } : undefined
                    });
                }
            }

            elapsed += segDuration;
        }

        if (copiedSegments.length === 0) return false;

        this.clipboard = {
            sourceFile: this.sourceFile,
            segments: copiedSegments,
            duration: endTime - startTime
        };

        console.log(`Timeline: Kopyalandı ${this.clipboard.duration.toFixed(2)}s`);
        return true;
    },

    /**
     * Yapıştır (ANI işlem)
     * @param {number} insertTime - Ekleme noktası (timeline zamanı)
     * @returns {boolean} Başarılı mı
     */
    paste(insertTime) {
        if (!this.clipboard) return false;

        this.saveState();

        // Clipboard'daki segment'leri sourceFile bilgisiyle birlikte kopyala
        const clipboardSegments = this.clipboard.segments.map(seg => ({
            ...seg,
            sourceFile: this.clipboard.sourceFile || seg.sourceFile
        }));

        // Boş proje mi? (segment yok veya sourceFile yok)
        if (this.segments.length === 0 || !this.sourceFile) {
            // Doğrudan ekle
            this.segments = clipboardSegments;
            this.renderVisuals();

            // Eğer sourceFile yoksa, clipboard'dan al
            if (!this.sourceFile && this.clipboard.sourceFile) {
                this.sourceFile = this.clipboard.sourceFile;
            }

            console.log(`Timeline: Boş projeye yapıştırıldı ${this.clipboard.duration.toFixed(2)}s`);
            return true;
        }

        const newSegments = [];
        let elapsed = 0;
        let inserted = false;

        for (const seg of this.segments) {
            const speed = seg.speed || 1.0;
            const segDuration = (seg.end - seg.start) / speed;
            const segEnd = elapsed + segDuration;

            // Ekleme noktasına geldik mi?
            if (!inserted && insertTime <= elapsed) {
                // Clipboard segment'lerini ekle
                for (const clipSeg of clipboardSegments) {
                    newSegments.push({ ...clipSeg });
                }
                inserted = true;
            }

            // Ekleme noktası bu segment'in içinde mi?
            if (!inserted && insertTime > elapsed && insertTime < segEnd) {
                // Segment'i ikiye böl
                const splitPoint = seg.start + ((insertTime - elapsed) * speed);

                // İlk parça
                newSegments.push({
                    ...seg,
                    start: seg.start,
                    end: splitPoint
                });

                // Clipboard'ı ekle
                for (const clipSeg of clipboardSegments) {
                    newSegments.push({ ...clipSeg });
                }
                inserted = true;

                // İkinci parça
                newSegments.push({
                    ...seg,
                    start: splitPoint,
                    end: seg.end
                });
            } else {
                newSegments.push({
                    ...seg,
                    sourceFile: seg.sourceFile || this.sourceFile
                });
            }

            elapsed += segDuration;
        }

        // Eğer sona ekleme ise
        if (!inserted) {
            for (const clipSeg of clipboardSegments) {
                newSegments.push({ ...clipSeg });
            }
        }

        this.segments = newSegments;
        this.renderVisuals();
        console.log(`Timeline: Yapıştırıldı ${this.clipboard.duration.toFixed(2)}s`);
        return true;
    },

    /**
     * Segment listesini al (dışa aktarma için)
     * @returns {Array} Segment listesi
     */
    getSegments() {
        return [...this.segments];
    },

    /**
     * Belirli timeline zamanındaki segment'i bul
     * @param {number} timelineTime 
     * @returns {object|null} { segmentIndex, segment, offsetInSegment }
     */
    getSegmentAt(timelineTime) {
        let elapsed = 0;

        for (let i = 0; i < this.segments.length; i++) {
            const seg = this.segments[i];
            const speed = seg.speed || 1.0;
            const segDuration = (seg.end - seg.start) / speed;

            if (elapsed + segDuration > timelineTime) {
                return {
                    segmentIndex: i,
                    segment: seg,
                    offsetInSegment: timelineTime - elapsed
                };
            }

            elapsed += segDuration;
        }

        return null;
    },

    /**
     * Belirtilen pozisyona segment ekle
     * @param {number} position - Ekleme pozisyonu (timeline time)
     * @param {Object} newSegment - Eklenecek segment {start, end, sourceFile}
     */
    insertSegmentAtPosition(position, newSegment) {
        this.saveState();

        // Eğer timeline boşsa veya position 0 ise, başa ekle
        if (this.segments.length === 0 || position <= 0) {
            this.segments.unshift(newSegment);
            this.renderVisuals();
            console.log('Segment başa eklendi:', newSegment);
            return;
        }

        // Pozisyon timeline sonunda veya ötesinde ise, sona ekle
        const totalDuration = this.getTotalDuration();
        if (position >= totalDuration) {
            this.segments.push(newSegment);
            this.renderVisuals();
            console.log('Segment sona eklendi:', newSegment);
            return;
        }

        // Pozisyonun hangi segment içinde olduğunu bul
        let elapsed = 0;
        let insertIndex = this.segments.length;

        for (let i = 0; i < this.segments.length; i++) {
            const seg = this.segments[i];
            const speed = seg.speed || 1.0;
            const segDuration = (seg.end - seg.start) / speed;

            if (elapsed + segDuration > position) {
                // Bu segment içinde bir pozisyon
                const offsetInSegment = position - elapsed;

                // Segment'i böl
                if (offsetInSegment > 0.1) {
                    // Segment'in ilk kısmı
                    const firstPart = {
                        ...seg,
                        end: seg.start + (offsetInSegment * speed)
                    };

                    // Segment'in ikinci kısmı
                    const secondPart = {
                        ...seg,
                        start: seg.start + (offsetInSegment * speed)
                    };

                    // Mevcut segment'i ilk kısım ile değiştir, yeni segment'i ve ikinci kısmı ekle
                    this.segments.splice(i, 1, firstPart, newSegment, secondPart);
                    this.renderVisuals();
                    console.log('Segment bölündü ve araya eklendi:', newSegment);
                } else {
                    // Segment başındayız, öncesine ekle
                    this.segments.splice(i, 0, newSegment);
                    this.renderVisuals();
                    console.log('Segment başına eklendi:', newSegment);
                }
                return;
            }

            elapsed += segDuration;
        }

        // Herhangi bir segment'e denk gelmediyse sona ekle
        this.segments.push(newSegment);
        this.renderVisuals();
        console.log('Segment fallback olarak sona eklendi:', newSegment);
    },

    /**
     * Debug: Segment listesini yazdır
     */
    debugPrint() {
        console.log('Timeline segments:');
        this.segments.forEach((seg, i) => {
            const speed = seg.speed || 1.0;
            const dur = (seg.end - seg.start) / speed;
            const source = seg.sourceFile ? ` [${seg.sourceFile.split(/[/\\]/).pop()}]` : '';
            console.log(`  [${i}] ${seg.start.toFixed(2)}s - ${seg.end.toFixed(2)}s (Dur: ${dur.toFixed(2)}s, Hız: ${speed}x)${source}`);
        });
        console.log(`  Total: ${this.getTotalDuration().toFixed(2)}s`);
    }
};

// Global olarak erişilebilir yap
window.Timeline = Timeline;

