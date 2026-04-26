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
            defaultScale: 30,
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
            defaultScale: 30,
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
            defaultScale: 25,
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
            defaultScale: 25,
            description: 'Paylaşım oku animasyonu. İzleyicileri videoyu paylaşmaya davet etmek için kullanılır.',
            defaultSound: 'assets/cta/sounds/confirm-tap.mp3'
        },
        {
            id: 'sub_tr_demo_1',
            name: 'Abone Ol (Türkçe)',
            category: 'subscribe',
            path: 'assets/cta/sub_tr_abone_ol.png',
            type: 'image',
            duration: 5.0,
            defaultScale: 30,
            description: 'Türkçe Abone Ol CTA görseli. İzleyicileri kanala abone olmaya davet etmek için kullanılır.',
            defaultSound: 'assets/cta/sounds/spacebar-click.mp3'
        },
        {
            id: 'follow_demo_1',
            name: 'Takip Et',
            category: 'follow',
            path: 'assets/cta/follow_blue.png',
            type: 'image',
            duration: 5.0,
            defaultScale: 28,
            description: 'Takip Et çağrısı. İzleyicileri hesabı veya seriyi takip etmeye yönlendirmek için kullanılır.',
            defaultSound: 'assets/cta/sounds/button-press.mp3'
        },
        {
            id: 'comment_demo_1',
            name: 'Yorum Yap',
            category: 'comment',
            path: 'assets/cta/comment_chat.png',
            type: 'image',
            duration: 5.0,
            defaultScale: 28,
            description: 'Yorum balonu CTA görseli. İzleyicileri yorum bırakmaya davet etmek için kullanılır.',
            defaultSound: 'assets/cta/sounds/computer-mouse-click.mp3'
        },
        {
            id: 'save_demo_1',
            name: 'Kaydet',
            category: 'save',
            path: 'assets/cta/save_bookmark.png',
            type: 'image',
            duration: 5.0,
            defaultScale: 26,
            description: 'Kaydet CTA görseli. İzleyicileri videoyu daha sonra izlemek için kaydetmeye yönlendirmek için kullanılır.',
            defaultSound: 'assets/cta/sounds/confirm-tap.mp3'
        },
        {
            id: 'join_demo_1',
            name: 'Katıl',
            category: 'join',
            path: 'assets/cta/join_green.png',
            type: 'image',
            duration: 5.0,
            defaultScale: 28,
            description: 'Katıl çağrısı. İzleyicileri topluluğa veya üyeliğe katılmaya davet etmek için kullanılır.',
            defaultSound: 'assets/cta/sounds/button-press.mp3'
        },
        {
            id: 'next_demo_1',
            name: 'Sonraki Video',
            category: 'next',
            path: 'assets/cta/next_video_dark.png',
            type: 'image',
            duration: 5.0,
            defaultScale: 25,
            description: 'Sonraki video CTA görseli. İzleyicileri bir sonraki içeriğe yönlendirmek için kullanılır.',
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
    t(key, fallback, params = {}) {
        if (!window.i18nHelper) return fallback;
        const value = window.i18nHelper.t(key, params);
        return value && !value.startsWith('[') ? value : fallback;
    },
    getLocalizedAsset(asset) {
        if (!asset || asset.isUser) return asset;
        return {
            ...asset,
            name: this.t(`dialog.cta_library.assets.${asset.id}.name`, asset.name),
            description: this.t(`dialog.cta_library.assets.${asset.id}.description`, asset.description || '')
        };
    },
    getCurrentAiLocale() {
        const supported = ['tr', 'en', 'de', 'es', 'fr'];
        const lang = window.i18nHelper?.currentLang || 'en';
        return supported.includes(lang) ? lang : 'en';
    },
    getCurrentAiLanguageName() {
        const names = { tr: 'Turkish', en: 'English', de: 'German', es: 'Spanish', fr: 'French' };
        return names[this.getCurrentAiLocale()] || 'English';
    },
    getAiSystemInstruction() {
        return this.t(
            'runtime.dialogs.ai_system_instruction_json',
            'Respond only in {lang}. If JSON output is requested, keep all JSON keys and schema exactly as requested while writing any free text values in {lang}.',
            { lang: this.getCurrentAiLanguageName() }
        );
    },
    buildAiOverlayRecommendationPrompt(overlayInfo) {
        if (this.getCurrentAiLocale() === 'tr') {
            return `Bu video karesine bir overlay (görsel katman) eklemek istiyoruz.
            Ekleyeceğimiz Overlay Bilgisi: ${overlayInfo}

            Lütfen görseli analiz et ve şu formatta JSON döndür (sadece JSON):
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

            Geçerli "position" değerleri şunlardır (yalnızca bunları kullan):
            bottom-left, bottom-center, bottom-right, top-left, top-right, center.
            "scale" değeri 10 ile 100 arasında bir sayı olmalıdır.
            En az 2 farklı öneri sun.`;
        }

        return `We want to add an overlay visual on top of this video frame.
        Overlay information: ${overlayInfo}

        Please analyze the frame and return JSON in this format (JSON only):
        {
          "analysis": "Short analysis and reasoning...",
          "recommendations": [
            {
              "position": "bottom-right",
              "scale": 30,
              "label": "Recommendation 1: Bottom Right",
              "reason": "There is empty space here..."
            },
            {
              "position": "top-left",
              "scale": 25,
              "label": "Recommendation 2: Top Left",
              "reason": "..."
            }
          ]
        }

        Valid "position" values are only:
        bottom-left, bottom-center, bottom-right, top-left, top-right, center.
        The "scale" value must be a number between 10 and 100.
        Provide at least 2 different recommendations.`;
    },

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
            let item = e.target.closest('li');

            // Eğer odak UL üzerindeyse, seçili olanı bul
            if (!item && e.target === this.categoriesList) {
                item = this.categoriesList.querySelector('li.selected');
            }

            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                // Item null ise handleCategoryNav handle edecek (veya 0'dan başlatacak)
                this.handleCategoryNav(e.key, item);
            } else if ((e.key === 'Enter' || e.key === ' ') && item) {
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

        // AI önerilerini temizle
        if (typeof this.clearAISuggestions === 'function') {
            this.clearAISuggestions();
        }

        // Tüm elemanların seçimini ve odağını kaldır (Strict Reset)
        const allItems = Array.from(this.categoriesList.querySelectorAll('li'));
        allItems.forEach(li => {
            li.classList.remove('selected');
            li.setAttribute('tabindex', '-1');
            li.tabIndex = -1;
        });

        // Yeni elemanı seç
        item.classList.add('selected');
        item.setAttribute('tabindex', '0');
        item.tabIndex = 0;
        item.focus();

        const category = item.dataset.category;
        this.renderGrid(category);

        Accessibility.announce(`Kategori seçildi: ${item.innerText}`);
    },

    handleCategoryNav(key, currentEl) {
        if (!this.categoriesList) {
            console.error('Categories list element not found!');
            return;
        }

        const items = Array.from(this.categoriesList.querySelectorAll('li'));

        // Her zaman DOM'daki güncel seçili öğeye güven
        const selected = this.categoriesList.querySelector('li.selected');
        let index = selected ? items.indexOf(selected) : -1;

        console.log(`[CTA Nav] Key: ${key}, Current Index: ${index}, Total Items: ${items.length}`);

        if (index === -1) {
            // Hiçbiri seçili değilse varsayılan
            if (key === 'ArrowDown') index = 0;
            else index = items.length - 1;
        } else {
            // Seçili varsa ilerle/gerile
            if (key === 'ArrowDown') {
                index++;
                if (index >= items.length) index = 0;
            } else if (key === 'ArrowUp') {
                index--;
                if (index < 0) index = items.length - 1;
            }
        }

        console.log(`[CTA Nav] New Index: ${index}`);

        const nextItem = items[index];
        if (nextItem) {
            console.log(`[CTA Nav] Selecting item: ${nextItem.innerText}`);
            this.selectCategory(nextItem);
            nextItem.scrollIntoView({ block: 'nearest' });
        } else {
            console.error('[CTA Nav] Next item not found!');
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
            this.selectAsset(newAsset.id, true);
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
            const localizedAsset = this.getLocalizedAsset(asset);
            const ariaLabel = `${localizedAsset.name}. ${localizedAsset.description || ''}`;
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
                mediaHtml = `<img src="${assetSrc}" alt="${localizedAsset.name}">`;
            }

            el.innerHTML = `
                <div class="cta-thumbnail">${mediaHtml}</div>
                <div class="cta-label" title="${localizedAsset.name}">${localizedAsset.name}</div>
                <div class="cta-format-badge">${asset.path.split('.').pop().toUpperCase()}</div>
            `;

            // Keyboard navigation
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.selectAsset(asset.id, true);
                } else if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                    e.preventDefault();
                    this.handleGridNavigation(e.key, el);
                }
            });

            // Click
            el.addEventListener('click', () => {
                this.selectAsset(asset.id, true);
            });

            // Focus loads preview but shouldn't auto-select in our new strict mode
            // We rely on click or keyboard Enter/Space for selection

            this.grid.appendChild(el);
        });

        // İlk öğeyi otomatik seç (Kullanıcı isteği üzerine geri getirildi)
        // Auto-focus kapalı (false), böylece kategori listesinde sapma olmaz
        if (filtered.length > 0 && !this.selectedAsset) {
            this.selectAsset(filtered[0].id, false);
        } else if (filtered.length > 0 && this.selectedAsset) {
            // Eğer seçili olan listede yoksa (kategori değiştiyse), ilkini seç
            const stillExists = filtered.find(a => a.id === this.selectedAsset.id);
            if (!stillExists) {
                this.selectAsset(filtered[0].id, false);
            }
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
            this.selectAsset(assetId, true);
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

    getRecommendedScale(asset) {
        if (!asset) return 30;
        if (Number.isFinite(asset.defaultScale)) {
            return asset.defaultScale;
        }

        const defaultsByCategory = {
            like: 30,
            subscribe: 30,
            bell: 25,
            share: 25,
            follow: 28,
            comment: 28,
            save: 26,
            join: 28,
            next: 25,
            package: 30
        };

        return defaultsByCategory[asset.category] || 30;
    },

    selectAsset(id, shouldFocus = false) {
        console.log('selectAsset called with id:', id, 'shouldFocus:', shouldFocus);
        this.clearAISuggestions(); // YENİ: Seçim değişince eski önerileri temizle
        this.grid.querySelectorAll('.cta-item').forEach(i => i.classList.remove('selected'));

        const allAssets = [...this.assets, ...this.importedAssets];

        // ID string olabilir, karşılaştırmada dikkatli olalım
        const asset = allAssets.find(a => String(a.id) === String(id));

        if (!asset) {
            console.error('[CTA Library] Asset not found for id:', id);
            return;
        }

        const localizedAsset = this.getLocalizedAsset(asset);
        this.selectedAsset = { ...asset, name: localizedAsset.name, description: localizedAsset.description };
        console.log('[CTA Library] selectedAsset set to:', this.selectedAsset);

        if (asset) {
            const itemEl = this.grid.querySelector(`.cta-item[data-id="${id}"]`);
            if (itemEl) {
                itemEl.classList.add('selected');
                itemEl.tabIndex = 0;
                // Sadece istenirse odaklan (Kategoriler arası gezerken odak çalmayı engelle)
                if (shouldFocus && document.activeElement !== itemEl) {
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
                descInput.value = localizedAsset.description || localizedAsset.name;
            }

            const scaleInput = document.getElementById('cta-scale');
            if (scaleInput) {
                scaleInput.value = this.getRecommendedScale(asset);
            }

            // Seçim geri bildirimi - daha belirgin
            // Otomatik ses seçimi
            if (this.soundSelector && asset.defaultSound) {
                this.soundSelector.value = asset.defaultSound;
            }

            // Seçim geri bildirimi - daha detaylı ve Türkçe betimleme ile
            let announceMsg = this.t('runtime.cta.asset_selected', 'Animation selected: {name}.', {
                name: localizedAsset.name
            }) + ' ';
            if (localizedAsset.description) {
                announceMsg += `${localizedAsset.description} `;
            }
            announceMsg += this.t('runtime.cta.selected_sound', 'Currently selected sound: {sound}.', {
                sound: this.soundSelector.options[this.soundSelector.selectedIndex].text
            }) + ' ';
            announceMsg += this.t('runtime.cta.press_enter_to_add', 'Press Enter to add it to the timeline.');

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

    // YENİ: AI Sonuçlarını Temizle
    clearAISuggestions() {
        const resultContainer = document.getElementById('cta-ai-results');
        if (resultContainer) {
            console.log('Clearing AI suggestions...');
            resultContainer.innerHTML = '';
            resultContainer.style.display = 'none';
        }
        const btn = document.getElementById('cta-ai-suggest-btn');
        if (btn) {
            btn.disabled = false;
            // Orijinal metni geri yüklemek zor olabilir çünkü buton içinde ikon vs olabilir.
            // Genelde "Yapay Zeka Önerisi Al" gibi bir metin vardır.
            // Bu reset işlemi sadece buton disabled kaldıysa kurtarmak için.
            if (btn.textContent.includes('Analiz ediliyor')) {
                btn.textContent = 'Yapay Zeka Önerisi Al';
            }
        }
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
        Accessibility.announce(this.t('runtime.cta.ai_analysis_starting', 'AI analysis and suggestion generation is starting.'));

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
            const prompt = this.buildAiOverlayRecommendationPrompt(overlayInfo);

            // API İsteği
            const apiKey = await window.api.getGeminiApiKey();
            if (!apiKey) {
                throw new Error('Gemini API anahtarı ayarlanmamış.');
            }

            const response = await window.api.geminiVisionRequest({
                apiKey,
                model: 'gemini-2.5-flash',
                imageBase64: base64,
                prompt,
                systemInstruction: this.getAiSystemInstruction()
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

                const analysisLabel = this.t('runtime.cta.analysis_label', 'Analysis');
                const suggestionLabel = this.t('runtime.cta.suggestion_label', 'Recommendation');
                const positionLabel = this.t('runtime.cta.position_label', 'Position');
                const sizeLabel = this.t('runtime.cta.size_label', 'Size');
                let html = `<p style="margin-bottom:8px; color:#ddd;"><strong>${analysisLabel}:</strong> ${data.analysis}</p>`;

                if (data.recommendations && data.recommendations.length > 0) {
                    html += `<div style="display:flex; gap:8px; flex-wrap:wrap;">`;
                    data.recommendations.forEach((rec, idx) => {
                        // Fix for JSON single quotes breaking HTML attribute
                        const safeJson = JSON.stringify(rec).replace(/'/g, "&apos;");
                        html += `
                            <button type="button" class="ai-rec-btn" data-json='${safeJson}' 
                                style="flex:1; padding:8px; background:var(--accent-color); border:none; border-radius:4px; color:white; cursor:pointer; font-size:0.85rem; text-align:left;">
                                <strong>${rec.label || `${suggestionLabel} ${idx + 1}`}</strong><br>
                                <span style="opacity:0.8; font-size:0.8em;">${positionLabel}: ${rec.position}, ${sizeLabel}: %${rec.scale}</span><br>
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
                        try {
                            const rec = JSON.parse(e.currentTarget.dataset.json);
                            this.applyAiRecommendation(rec);
                            // İşlem sonrası butona focus'u geri verelim veya bir sonraki adıma geçelim
                            e.currentTarget.focus();
                        } catch (err) {
                            console.error('Error applying recommendation:', err);
                            Accessibility.alert(this.t('runtime.cta.apply_recommendation_failed', 'An error occurred while applying the recommendation.'));
                        }
                    };


                    b.addEventListener('click', applyRec);

                    b.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            applyRec(e);
                        }
                    });
                });

                Accessibility.announce(this.t(
                    'runtime.cta.ai_analysis_completed',
                    'AI analysis completed: {analysis}. {count} recommendations available. Select one from the list and press Enter to apply it.',
                    {
                        analysis: data.analysis,
                        count: data.recommendations.length
                    }
                ));

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
        console.log('Applying AI Recommendation:', rec);
        if (!rec) return;

        const posInput = document.getElementById('cta-position');
        const scaleInput = document.getElementById('cta-scale');

        let changes = [];

        if (posInput && rec.position) {
            // Select element handling: explicit selection
            const options = Array.from(posInput.options);
            // Try matching value first, then text content slightly looser check
            const matchingOption = options.find(opt =>
                opt.value === rec.position ||
                opt.text.toLowerCase().includes(rec.position.replace('-', ' '))
            );

            if (matchingOption) {
                // Set value directly to the option's value to be safe
                posInput.value = matchingOption.value;
                matchingOption.selected = true;

                // Dispatch event to notify listeners
                // Using a slight timeout to ensure UI refresh if needed
                setTimeout(() => {
                    posInput.dispatchEvent(new Event('change', { bubbles: true }));
                }, 0);

                changes.push(this.t('runtime.cta.applied_position', 'Position: {value}', {
                    value: matchingOption.text
                }));
                console.log(`Position set to: ${matchingOption.value}`);
            } else {
                console.warn(`Position option '${rec.position}' not found in dropdown. Available values:`, options.map(o => o.value));
            }
        }

        if (scaleInput && rec.scale) {
            scaleInput.value = rec.scale;
            // Dispatch both input (for slider drag effect) and change (for commit)
            setTimeout(() => {
                scaleInput.dispatchEvent(new Event('input', { bubbles: true }));
                scaleInput.dispatchEvent(new Event('change', { bubbles: true }));
            }, 0);

            // Update the output display next to slider if exists
            const outputId = scaleInput.getAttribute('oninput')?.match(/value\s*=\s*(.*)\.value/)?.[1];
            if (outputId) {
                const outputEl = document.getElementById(outputId) || scaleInput.nextElementSibling;
                if (outputEl && outputEl.tagName === 'OUTPUT') {
                    outputEl.value = rec.scale;
                }
            }

            changes.push(this.t('runtime.cta.applied_size', 'Size: %{value}', {
                value: rec.scale
            }));
            console.log(`Scale set to: ${rec.scale}`);
        }

        if (changes.length > 0) {
            Accessibility.announce(this.t('runtime.cta.recommendation_applied', 'Recommendation applied: {changes}', {
                changes: changes.join(', ')
            }));
        } else {
            Accessibility.announce(this.t('runtime.cta.recommendation_not_applied', 'The recommendation could not be applied or no change was needed.'));
        }

        // Değişiklik sonrası önizlemeyi güncelle
        if (this.selectedAsset && this.selectedAsset.path) {
            const overlayPreview = document.querySelector('cta-overlay-preview'); // Eğer component varsa
            // Veya direkt olarak preview'ı tetikle
        }
    }
};
