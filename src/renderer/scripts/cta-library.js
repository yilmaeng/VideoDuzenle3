/**
 * CTA / Overlay Library Manager
 */
const CtaLibrary = {
    // Built-in assets
    assets: [
        {
            id: 'like_demo_1',
            name: 'Beğen Butonu (Klasik)',
            category: 'like',
            path: 'assets/cta/like_classic.webm',
            type: 'video',
            duration: 3.0,
            description: 'Yukarı bakan başparmak animasyonu. İzleyicileri videoyu beğenmeye davet etmek için kullanılır.',
            defaultSound: 'assets/cta/sounds/button-press.mp3'
        },
        {
            id: 'sub_demo_1',
            name: 'Abone Ol (Kırmızı)',
            category: 'subscribe',
            path: 'assets/cta/sub_red.webm',
            type: 'video',
            duration: 4.0,
            description: 'Kırmızı renkli abone ol butonu animasyonu. İzleyicileri kanala abone olmaya davet etmek için kullanılır.',
            defaultSound: 'assets/cta/sounds/spacebar-click.mp3'
        },
        {
            id: 'bell_demo_1',
            name: 'Bildirim Zili',
            category: 'bell',
            path: 'assets/cta/bell_shake.webm',
            type: 'video',
            duration: 3.0,
            description: 'Sallanan bildirim zili animasyonu. İzleyicileri bildirimleri açmaya davet etmek için kullanılır.',
            defaultSound: 'assets/cta/sounds/bell-ring.mp3'
        },
        {
            id: 'share_demo_1',
            name: 'Paylaş Butonu',
            category: 'share',
            path: 'assets/cta/share_arrow.webm',
            type: 'video',
            duration: 3.0,
            description: 'Paylaşım oku animasyonu. İzleyicileri videoyu paylaşmaya davet etmek için kullanılır.',
            defaultSound: 'assets/cta/sounds/confirm-tap.mp3'
        }
    ],

    // User imported assets
    importedAssets: [],

    // Custom Sounds
    soundEffects: [
        { name: 'Zil Sesi (Ring)', path: 'assets/cta/sounds/bell-ring.mp3' },
        { name: 'Buton Sesi (Press)', path: 'assets/cta/sounds/button-press.mp3' },
        { name: 'Mouse Click', path: 'assets/cta/sounds/computer-mouse-click.mp3' },
        { name: 'Onay Sesi (Tap)', path: 'assets/cta/sounds/confirm-tap.mp3' },
        { name: 'Spacebar Click', path: 'assets/cta/sounds/spacebar-click.mp3' }
    ],

    selectedAsset: null,
    previewAudio: new Audio(),

    init() {
        console.log('CtaLibrary.init() called');
        this.categoriesList = document.getElementById('cta-categories-list');
        this.grid = document.getElementById('cta-grid');
        this.previewVideo = document.getElementById('cta-preview-video');
        this.previewPlaceholder = document.getElementById('cta-preview-placeholder');
        this.soundSelector = document.getElementById('cta-sound');

        console.log('Grid element:', this.grid);
        console.log('CategoriesList element:', this.categoriesList);

        this.setupEventListeners();
        this.populateSoundSelector();
        this.renderGrid('all');
    },

    populateSoundSelector() {
        if (!this.soundSelector) return;

        this.soundSelector.innerHTML = `
            <option value="none">Yok (Sessiz)</option>
        `;

        this.soundEffects.forEach(sound => {
            const opt = document.createElement('option');
            opt.value = sound.path;
            opt.textContent = sound.name;
            this.soundSelector.appendChild(opt);
        });
    },

    setupEventListeners() {
        // Categories click
        this.categoriesList.addEventListener('click', (e) => {
            const item = e.target.closest('li');
            if (!item) return;
            this.selectCategory(item);
        });

        // Categories keyboard navigation
        this.categoriesList.addEventListener('keydown', (e) => {
            const item = e.target.closest('li');
            if (!item) return;

            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                this.handleCategoryNav(e.key, item);
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.selectCategory(item);
            }
        });

        // Grid click
        this.grid.addEventListener('click', (e) => {
            const item = e.target.closest('.cta-item');
            if (!item) return;
            this.selectAsset(item.dataset.id);
        });

        // Import button
        document.getElementById('cta-import-btn')?.addEventListener('click', () => {
            this.handleImport();
        });

        // Preview video error
        this.previewVideo?.addEventListener('error', () => {
            console.warn('Preview video resource not found or error.');
        });

        // Alt+P for preview
        document.getElementById('cta-library-dialog')?.addEventListener('keydown', (e) => {
            if (e.altKey && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                this.togglePreview();
            }
        });

        // Sound selector change
        this.soundSelector?.addEventListener('change', () => {
            if (!this.previewVideo.paused) {
                this.togglePreview();
                setTimeout(() => this.togglePreview(), 100);
            }
        });

        // AI Suggestion Button
        document.getElementById('cta-ai-suggest-btn')?.addEventListener('click', () => {
            this.handleAISuggestion();
        });
    },

    selectCategory(item) {
        this.selectedAsset = null; // Kategori değişince seçimi sıfırla
        this.categoriesList.querySelectorAll('li').forEach(li => {
            li.classList.remove('selected');
            li.tabIndex = -1;
        });
        item.classList.add('selected');
        item.tabIndex = 0;
        item.focus();

        const category = item.dataset.category;
        this.renderGrid(category);

        Accessibility.announce(`Kategori seçildi: ${item.innerText}`);
    },

    handleCategoryNav(key, currentEl) {
        const items = Array.from(this.categoriesList.querySelectorAll('li'));
        const index = items.indexOf(currentEl);
        let nextIndex = index;

        if (key === 'ArrowDown') nextIndex++;
        if (key === 'ArrowUp') nextIndex--;

        if (nextIndex >= 0 && nextIndex < items.length) {
            this.selectCategory(items[nextIndex]);
        }
    },

    togglePreview() {
        if (!this.previewVideo || !this.previewVideo.src) {
            Accessibility.announce('Önizleme mevcut değil.');
            return;
        }

        const soundVal = this.soundSelector ? this.soundSelector.value : 'embedded';

        if (this.previewVideo.paused) {
            this.previewVideo.currentTime = 0;
            this.previewVideo.muted = false;

            if (soundVal === 'none') {
                this.previewVideo.muted = true;
            } else if (soundVal !== 'embedded') {
                this.previewVideo.muted = true;
                this.previewAudio.src = soundVal;
                this.previewAudio.currentTime = 0;
                this.previewAudio.play().catch(e => console.warn('Audio play failed', e));
            }

            this.previewVideo.play().catch(console.error);
            Accessibility.announce('Önizleme oynatılıyor.');
        } else {
            this.previewVideo.pause();
            this.previewAudio.pause();
            this.previewAudio.currentTime = 0;
            Accessibility.announce('Önizleme durduruldu.');
        }
    },

    async handleImport() {
        const result = await window.api.showOpenDialog({
            extensions: ['webm', 'mov', 'mp4', 'png', 'svg']
        });

        if (result && !result.canceled && result.filePaths.length > 0) {
            const filePath = result.filePaths[0];
            const fileName = filePath.split(/[/\\]/).pop();

            let category = 'other';
            const lowerName = fileName.toLowerCase();
            if (lowerName.includes('like')) category = 'like';
            else if (lowerName.includes('sub')) category = 'subscribe';
            else if (lowerName.includes('bell')) category = 'bell';

            const newAsset = {
                id: 'import_' + Date.now(),
                name: fileName,
                category: category,
                path: filePath,
                type: (fileName.endsWith('.png') || fileName.endsWith('.svg')) ? 'image' : 'video',
                duration: 5.0,
                description: fileName,
                isUser: true
            };

            this.importedAssets.push(newAsset);

            const currentCat = this.categoriesList.querySelector('.selected')?.dataset.category || 'all';
            this.renderGrid(currentCat);
            this.selectAsset(newAsset.id);
            Accessibility.announce(`Imported ${fileName}`);
        }
    },

    renderGrid(category) {
        console.log('renderGrid called with category:', category);
        this.grid.innerHTML = '';
        const allAssets = [...this.assets, ...this.importedAssets];

        const filtered = category === 'all'
            ? allAssets
            : allAssets.filter(a => a.category === category);

        console.log('Filtered assets count:', filtered.length);

        if (filtered.length === 0) {
            this.grid.innerHTML = '<p style="padding: 20px; color: #888; grid-column: 1/-1; text-align: center;">Bu kategoride öğe yok.</p>';
            return;
        }

        filtered.forEach((asset, index) => {
            const el = document.createElement('div');
            el.className = 'cta-item';
            el.dataset.id = asset.id;
            el.setAttribute('role', 'option');
            // Erişilebilirlik için detaylı etiket
            const ariaLabel = `${asset.name}. ${asset.description || ''}`;
            el.setAttribute('aria-label', ariaLabel);

            // Roving tabindex
            if (this.selectedAsset && this.selectedAsset.id === asset.id) {
                el.tabIndex = 0;
            } else if (!this.selectedAsset && index === 0) {
                el.tabIndex = 0;
            } else {
                el.tabIndex = -1;
            }

            const isAbsolute = asset.path.includes(':') || asset.path.startsWith('/') || asset.path.startsWith('\\');
            const assetSrc = isAbsolute ? `file:///${asset.path.replace(/\\/g, '/')}` : asset.path;

            let mediaHtml = '';
            if (asset.type === 'video') {
                mediaHtml = `<video src="${assetSrc}" preload="metadata" muted></video>`;
            } else {
                mediaHtml = `<img src="${assetSrc}" alt="${asset.name}">`;
            }

            el.innerHTML = `
                <div class="cta-thumbnail">${mediaHtml}</div>
                <div class="cta-label" title="${asset.name}">${asset.name}</div>
                <div class="cta-format-badge">${asset.path.split('.').pop().toUpperCase()}</div>
            `;

            // Keyboard navigation
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.selectAsset(asset.id);
                } else if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                    e.preventDefault();
                    this.handleGridNavigation(e.key, el);
                }
            });

            // Click
            el.addEventListener('click', () => {
                this.selectAsset(asset.id);
            });

            // Focus loads preview
            // Focus selects asset (ve preview)
            el.addEventListener('focus', () => {
                if (this.selectedAsset?.id !== asset.id) {
                    this.selectAsset(asset.id);
                }
            });

            this.grid.appendChild(el);
        });

        // İlk öğeyi otomatik seç
        if (filtered.length > 0 && !this.selectedAsset) {
            this.selectAsset(filtered[0].id);
        }
    },

    handleGridNavigation(key, currentEl) {
        const items = Array.from(this.grid.querySelectorAll('.cta-item'));
        const index = items.indexOf(currentEl);
        let nextIndex = index;

        const gridWidth = this.grid.clientWidth;
        const itemWidth = 140;
        const itemsPerRow = Math.max(1, Math.floor(gridWidth / itemWidth));

        if (key === 'ArrowRight') nextIndex++;
        else if (key === 'ArrowLeft') nextIndex--;
        else if (key === 'ArrowDown') nextIndex += itemsPerRow;
        else if (key === 'ArrowUp') nextIndex -= itemsPerRow;

        if (nextIndex < 0) nextIndex = 0;
        if (nextIndex >= items.length) nextIndex = items.length - 1;

        if (nextIndex !== index) {
            currentEl.tabIndex = -1;
            items[nextIndex].tabIndex = 0;
            // Otomatik seçim yap
            const assetId = items[nextIndex].dataset.id;
            this.selectAsset(assetId);
        }
    },

    loadPreview(asset) {
        if (!asset) return;
        const isAbsolute = asset.path.includes(':') || asset.path.startsWith('/') || asset.path.startsWith('\\');
        const assetSrc = isAbsolute ? `file:///${asset.path.replace(/\\/g, '/')}` : asset.path;

        if (asset.type === 'video') {
            this.previewVideo.src = assetSrc;
            this.previewVideo.style.display = 'block';
            this.previewVideo.load();
        } else {
            this.previewVideo.src = '';
            this.previewVideo.poster = assetSrc;
            this.previewVideo.style.display = 'block';
        }
    },

    selectAsset(id) {
        console.log('selectAsset called with id:', id);
        this.grid.querySelectorAll('.cta-item').forEach(i => i.classList.remove('selected'));

        const allAssets = [...this.assets, ...this.importedAssets];
        const asset = allAssets.find(a => a.id === id);

        this.selectedAsset = asset;
        console.log('selectedAsset set to:', this.selectedAsset);

        if (asset) {
            const itemEl = this.grid.querySelector(`.cta-item[data-id="${id}"]`);
            if (itemEl) {
                itemEl.classList.add('selected');
                itemEl.tabIndex = 0;
                if (document.activeElement !== itemEl) {
                    itemEl.focus();
                }
            }

            const isAbsolute = asset.path.includes(':') || asset.path.startsWith('/') || asset.path.startsWith('\\');
            const assetSrc = isAbsolute ? `file:///${asset.path.replace(/\\/g, '/')}` : asset.path;

            // Sadece yükle, otomatik oynatma - Alt+P ile oynatılacak
            if (asset.type === 'video') {
                this.previewVideo.src = assetSrc;
                this.previewVideo.style.display = 'block';
                this.previewVideo.muted = true; // Sessiz yükle
                this.previewVideo.load();
            } else {
                this.previewVideo.src = '';
                this.previewVideo.poster = assetSrc;
                this.previewVideo.style.display = 'block';
            }
            this.previewPlaceholder.style.display = 'none';

            const descInput = document.getElementById('cta-desc');
            if (descInput) {
                descInput.value = asset.description || asset.name;
            }

            // Seçim geri bildirimi - daha belirgin
            // Otomatik ses seçimi
            if (this.soundSelector && asset.defaultSound) {
                this.soundSelector.value = asset.defaultSound;
            }

            // Seçim geri bildirimi - daha detaylı ve Türkçe betimleme ile
            let announceMsg = `Animasyon seçildi: ${asset.name}. `;
            if (asset.description) {
                announceMsg += `${asset.description} `;
            }
            announceMsg += `Şu an seçili ses: ${this.soundSelector.options[this.soundSelector.selectedIndex].text}. `;
            announceMsg += `Zaman çizelgesine eklemek için Enter tuşuna basın.`;

            // Focus değişiminden sonra okunması için hafif gecikme
            setTimeout(() => {
                Accessibility.announce(announceMsg);
            }, 500);
        }
    },

    getSelected() {
        console.log('getSelected called, returning:', this.selectedAsset);
        return this.selectedAsset;
    },

    async handleAISuggestion() {
        if (!this.selectedAsset) {
            Accessibility.alert('Lütfen önce bir overlay seçin.');
            return;
        }

        const btn = document.getElementById('cta-ai-suggest-btn');
        if (!btn) return;

        // UI Elemanlarını bul
        const posInput = document.getElementById('cta-position');
        const scaleInput = document.getElementById('cta-scale');

        // Mevcut değerleri al
        const currentPos = posInput ? posInput.options[posInput.selectedIndex].text : 'Bilinmiyor';
        const currentScale = scaleInput ? scaleInput.value : '30';

        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Analiz ediliyor (Lütfen bekleyin)...';
        Accessibility.announce('Yapay zeka analizi ve öneri üretimi başlatılıyor.');

        // Sonuç alanını temizle/oluştur
        let resultContainer = document.getElementById('cta-ai-results');
        if (!resultContainer) {
            resultContainer = document.createElement('div');
            resultContainer.id = 'cta-ai-results';
            resultContainer.className = 'ai-results-box';
            resultContainer.style.marginTop = '10px';
            resultContainer.style.padding = '10px';
            resultContainer.style.background = 'rgba(0, 0, 0, 0.2)';
            resultContainer.style.borderRadius = '4px';
            resultContainer.style.fontSize = '0.9rem';
            btn.parentNode.appendChild(resultContainer);
        }
        resultContainer.innerHTML = '';
        resultContainer.style.display = 'none';

        try {
            // Ana videonun (arkaplanın) şu anki karesini al
            const videoPath = VideoPlayer.currentFilePath;
            const currentTime = VideoPlayer.getCurrentTime();

            if (!videoPath) {
                throw new Error('Video dosyası bulunamadı.');
            }

            // Kareyi çıkar (Base64)
            const base64 = await window.api.extractFrameBase64({
                videoPath: videoPath,
                time: currentTime
            });

            // Overlay bilgisini hazırla
            const overlayInfo = `Overlay Adı: ${this.selectedAsset.name}. Tip: ${this.selectedAsset.type}. Şu anki Konum: ${currentPos}, Boyut: %${currentScale}.`;

            // Prompt hazırla (JSON formatında yanıt iste)
            const prompt = `Bu video karesine bir overlay (görsel katman) eklemek istiyoruz.
            Ekleyeceğimiz Overlay Bilgisi: ${overlayInfo}
            
            Lütfen görseli analiz et ve şu formatta JSON döndür (Sadece JSON):
            {
              "analysis": "Kısa analiz ve düşüncen...",
              "recommendations": [
                {
                  "position": "bottom-right", 
                  "scale": 30,
                  "label": "Öneri 1: Sağ Alt",
                  "reason": "Burada boşluk var..."
                },
                {
                  "position": "top-left", 
                  "scale": 25,
                  "label": "Öneri 2: Sol Üst",
                  "reason": "..."
                }
              ]
            }
            
            Geçerli "position" değerleri şunlardır (Sadece bunları kullan):
            bottom-left, bottom-center, bottom-right, top-left, top-right, center.
            "scale" değeri 10 ile 100 arasında bir sayı olmalıdır.
            En az 2 farklı öneri sun.`;

            // API İsteği
            const apiKey = await window.api.getGeminiApiKey();
            if (!apiKey) {
                throw new Error('Gemini API anahtarı ayarlanmamış.');
            }

            const response = await window.api.geminiVisionRequest({
                apiKey,
                model: 'gemini-2.0-flash', // 2.5 -> 2.0 (Stable) update
                imageBase64: base64,
                prompt
            });

            if (response.success) {
                let resultText = response.text.trim();

                // Markdown json bloklarını temizle
                resultText = resultText.replace(/```json/g, '').replace(/```/g, '');

                let data = null;
                try {
                    data = JSON.parse(resultText);
                } catch (e) {
                    console.warn('JSON parse hatası, text fallback deneniyor', e);
                    // Fallback: Sadece metni göster, buton yok
                    data = { analysis: resultText, recommendations: [] };
                }

                // UI Güncelle
                resultContainer.style.display = 'block';

                let html = `<p style="margin-bottom:8px; color:#ddd;"><strong>Analiz:</strong> ${data.analysis}</p>`;

                if (data.recommendations && data.recommendations.length > 0) {
                    html += `<div style="display:flex; gap:8px; flex-wrap:wrap;">`;
                    data.recommendations.forEach((rec, idx) => {
                        html += `
                            <button type="button" class="ai-rec-btn" data-json='${JSON.stringify(rec)}' 
                                style="flex:1; padding:8px; background:var(--accent-color); border:none; border-radius:4px; color:white; cursor:pointer; font-size:0.85rem; text-align:left;">
                                <strong>${rec.label || 'Öneri ' + (idx + 1)}</strong><br>
                                <span style="opacity:0.8; font-size:0.8em;">Konum: ${rec.position}, Boyut: %${rec.scale}</span><br>
                                <span style="font-size:0.8em; font-style:italic;">"${rec.reason}"</span>
                            </button>
                        `;
                    });
                    html += `</div>`;
                }

                resultContainer.innerHTML = html;

                // Event Listeners for buttons
                resultContainer.querySelectorAll('.ai-rec-btn').forEach(b => {
                    const applyRec = (e) => {
                        const rec = JSON.parse(e.currentTarget.dataset.json);
                        this.applyAiRecommendation(rec);
                        // İşlem sonrası butona focus'u geri verelim veya bir sonraki adıma geçelim
                        e.currentTarget.focus();
                    };

                    b.addEventListener('click', applyRec);

                    b.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            applyRec(e);
                        }
                    });
                });

                Accessibility.announce(`Yapay Zeka Analizi Tamamlandı: ${data.analysis}. ${data.recommendations.length} öneri mevcut. Listeden birini seçip Enter'a basarak uygulayabilirsiniz.`);

            } else {
                throw new Error(response.error);
            }

        } catch (error) {
            console.error('AI Suggestion Error:', error);
            Accessibility.alert('Hata: ' + error.message);
            if (resultContainer) resultContainer.innerHTML = `<p style="color:red;">Hata: ${error.message}</p>`;
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    },

    applyAiRecommendation(rec) {
        if (!rec) return;

        const posInput = document.getElementById('cta-position');
        const scaleInput = document.getElementById('cta-scale');

        if (posInput && rec.position) {
            posInput.value = rec.position;
            // Trigger change event if needed
            posInput.dispatchEvent(new Event('change'));
        }

        if (scaleInput && rec.scale) {
            scaleInput.value = rec.scale;
            scaleInput.dispatchEvent(new Event('input'));
        }

        Accessibility.announce(`Öneri uygulandı: Konum ${rec.position}, Boyut yüzde ${rec.scale}`);

        // Önizlemeyi güncelle (varsa)
        if (window.CtaOverlayPreview) {
            // Preview nesnesine erişim varsa anlık güncelleme yapılabilir
            // Ancak wizard panelindeki inputlar değiştiğinde zaten preview güncellenmeli (listener varsa)
            // Listener yoksa manuel tetiklememiz gerekebilir.
            // cta-library.js içinde input listener'ları göremedim, index.html'den app.js yönetiyor olabilir.
            // Biz input değerlerini değiştirdik, eğer 'change' event dinleniyorsa otomatik olur.
        }
    }
};
