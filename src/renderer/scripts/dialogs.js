/**
 * Diyalog Modülü
 * Tüm diyalog pencerelerinin yönetimi
 */

const Dialogs = {
    // Diyalog elementleri
    gotoDialog: null,
    rangeDialog: null,
    textDialog: null,
    audioAddDialog: null,
    audioEditorDialog: null,
    imagesDialog: null,
    shortcutsDialog: null,
    aiDialog: null,
    videoPropertiesDialog: null,
    ctaLibraryDialog: null,
    speedDialog: null,
    speedSuccessDialog: null,

    // Geçici veriler
    pendingAudioPath: null,
    pendingAudioMetadata: null, // Ses dosyası meta verileri
    audioTrimRange: null, // { start: 0, end: duration } - Kesme aralığı
    pendingImagePaths: null,
    originalVideoProps: null, // Özgün video özellikleri
    videoDuration: 0,
    previewAudioElement: null, // Ön izleme için audio elementi
    isPreviewPlaying: false, // Ses ön izleme aktif mi
    isTextPreviewPlaying: false, // Yazı ön izleme aktif mi
    textPreviewInterval: null, // Yazı ön izleme timer
    detectedSilences: [], // Tespit edilen sessiz alanlar
    selectedSilenceIndex: -1, // Seçili sessiz alan indeksi
    isSilencePreviewPlaying: false, // Sessizlik kesim önizlemesi aktif mi
    silencePreviewEnd: 0, // Önizleme sonu
    silencePreviewJump: 0, // Önizleme atlama noktası (sessizliğin başı)
    silencePreviewTarget: 0, // Önizleme atlama hedefi (sessizliğin sonu)
    aiChatHistory: [], // Yapay zeka konuşma geçmişi
    currentAiApiKey: null, // Mevcut API anahtarı
    instantVoiceTranslationDialog: null,
    instantVoiceTranslationRunning: false,
    instantVoiceTranslationStream: null,
    instantVoiceTranslationAudioContext: null,
    instantVoiceTranslationProcessor: null,
    instantVoiceTranslationSourceNode: null,
    instantVoiceTranslationSilentGain: null,
    instantVoiceTranslationRecorder: null,
    instantVoiceTranslationDecodeContext: null,
    instantVoiceTranslationOutputContext: null,
    instantVoiceTranslationNextPlayTime: 0,
    instantVoiceTranslationOriginalUnderlayNextPlayTime: 0,
    instantVoiceTranslationPendingAudioChunks: [],
    instantVoiceTranslationAudioSendTimer: null,
    instantVoiceTranslationDiagnostics: [],
    instantVoiceTranslationTranscriptEntries: [],
    instantVoiceTranslationAudioEntries: [],
    instantVoiceTranslationSourceAudioEntries: [],
    instantVoiceTranslationSourceAudioSessionRestore: null,
    instantVoiceTranslationOriginalUnderlayPendingNodes: [],
    instantVoiceTranslationOriginalPassthroughUntil: 0,
    instantVoiceTranslationSuppressNextTranslatedAudio: false,
    instantVoiceTranslationLastTextOnlyAnnouncement: '',
    instantVoiceTranslationTextOnlyAnnouncementBuffer: '',
    instantVoiceTranslationTextOnlyAnnouncementTimer: null,
    instantVoiceTranslationTextOnlyAnnouncementStartedAt: 0,
    instantVoiceTranslationTextOnlyAnnouncementSpokenText: '',
    instantVoiceTranslationTextOnlyAnnouncementLastInputText: '',
    instantVoiceTranslationTranscriptStartedAt: null,
    instantVoiceTranslationTranscriptStoppedAt: null,
    instantVoiceTranslationLatestSourceText: '',
    instantVoiceTranslationSentChunkCount: 0,
    instantVoiceTranslationReceivedAudioCount: 0,
    instantVoiceTranslationQueuedChunkCount: 0,
    instantVoiceTranslationGlobalShortcut: '',
    instantVoiceTranslationGlobalShortcutRegistered: false,
    instantVoiceTranslationShortcutToneContext: null,
    instantVoiceTranslationLanguages: [
        ['tr', 'language_tr', 'Türkçe'],
        ['en', 'language_en', 'İngilizce'],
        ['de', 'language_de', 'Almanca'],
        ['fr', 'language_fr', 'Fransızca'],
        ['es', 'language_es', 'İspanyolca'],
        ['ar', 'language_ar', 'Arapça'],
        ['bn', 'language_bn', 'Bengalce'],
        ['bg', 'language_bg', 'Bulgarca'],
        ['ca', 'language_ca', 'Katalanca'],
        ['zh-CN', 'language_zh_cn', 'Çince (Basitleştirilmiş)'],
        ['zh-TW', 'language_zh_tw', 'Çince (Geleneksel)'],
        ['hr', 'language_hr', 'Hırvatça'],
        ['cs', 'language_cs', 'Çekçe'],
        ['da', 'language_da', 'Danca'],
        ['nl', 'language_nl', 'Felemenkçe'],
        ['fi', 'language_fi', 'Fince'],
        ['el', 'language_el', 'Yunanca'],
        ['gu', 'language_gu', 'Guceratça'],
        ['he', 'language_he', 'İbranice'],
        ['hi', 'language_hi', 'Hintçe'],
        ['hu', 'language_hu', 'Macarca'],
        ['id', 'language_id', 'Endonezce'],
        ['it', 'language_it', 'İtalyanca'],
        ['ja', 'language_ja', 'Japonca'],
        ['kn', 'language_kn', 'Kannada'],
        ['ko', 'language_ko', 'Korece'],
        ['ml', 'language_ml', 'Malayalam'],
        ['mr', 'language_mr', 'Marathi'],
        ['no', 'language_no', 'Norveççe'],
        ['pl', 'language_pl', 'Lehçe'],
        ['pt', 'language_pt', 'Portekizce'],
        ['ro', 'language_ro', 'Romence'],
        ['ru', 'language_ru', 'Rusça'],
        ['sk', 'language_sk', 'Slovakça'],
        ['sv', 'language_sv', 'İsveççe'],
        ['ta', 'language_ta', 'Tamilce'],
        ['te', 'language_te', 'Telugu'],
        ['th', 'language_th', 'Tayca'],
        ['uk', 'language_uk', 'Ukraynaca'],
        ['ur', 'language_ur', 'Urduca'],
        ['vi', 'language_vi', 'Vietnamca']
    ],
    t(key, fallback, params = {}) {
        if (!window.i18nHelper) return fallback;
        const value = window.i18nHelper.t(key, params);
        return value && !value.startsWith('[') ? value : fallback;
    },
    getCurrentAiLocale() {
        const supported = ['tr', 'en', 'de', 'es', 'fr'];
        const lang = window.i18nHelper?.currentLang || 'en';
        return supported.includes(lang) ? lang : 'en';
    },
    getCurrentAiLanguageName() {
        const names = {
            tr: 'Turkish',
            en: 'English',
            de: 'German',
            es: 'Spanish',
            fr: 'French'
        };
        return names[this.getCurrentAiLocale()] || 'English';
    },
    getAiSystemInstruction(mode = 'default') {
        const lang = this.getCurrentAiLanguageName();
        const key = mode === 'json'
            ? 'runtime.dialogs.ai_system_instruction_json'
            : 'runtime.dialogs.ai_system_instruction';
        const fallback = mode === 'json'
            ? 'Respond only in {lang}. If JSON output is requested, keep all JSON keys and schema exactly as requested while writing any free text values in {lang}.'
            : 'Respond only in {lang}. Keep the same response language in follow-up answers.';
        return this.t(key, fallback, { lang });
    },
    buildAiFollowupPrompt(question) {
        const lang = this.getCurrentAiLanguageName();
        return this.t(
            'runtime.dialogs.ai_followup_prompt',
            'Answer the following question only in {lang}: {question}',
            { lang, question }
        );
    },
    getHelpTopicLocalized(topic) {
        return {
            title: this.t(topic.titleKey, topic.title),
            content: this.t(topic.contentKey, topic.content)
        };
    },
    async loadImageFromBase64(base64, mimeTypes = ['image/jpeg', 'image/png', 'image/webp']) {
        const normalized = String(base64 || '').trim();
        if (!normalized) {
            throw new Error('Preview frame is empty.');
        }

        const loadImageFromSource = (src) => new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error(`Preview image could not be loaded from source: ${src.slice(0, 32)}...`));
            image.src = src;
        });

        let payload = normalized;
        if (normalized.startsWith('data:')) {
            try {
                return await loadImageFromSource(normalized);
            } catch (error) {
                console.warn('[SubtitleStyleAI] Direct data URL load failed:', error);
                payload = normalized.split(',').pop() || '';
            }
        }

        let lastError = null;
        for (const mimeType of mimeTypes) {
            try {
                return await loadImageFromSource(`data:${mimeType};base64,${payload}`);
            } catch (error) {
                lastError = error;
            }
        }

        const decodeBase64 = (input) => {
            const binary = atob(input);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes;
        };

        try {
            const bytes = decodeBase64(payload);
            for (const mimeType of mimeTypes) {
                const blob = new Blob([bytes], { type: mimeType });
                const objectUrl = URL.createObjectURL(blob);
                try {
                    const image = await loadImageFromSource(objectUrl);
                    URL.revokeObjectURL(objectUrl);
                    return image;
                } catch (error) {
                    lastError = error;
                    URL.revokeObjectURL(objectUrl);
                }
            }
        } catch (decodeError) {
            lastError = decodeError;
        }

        throw lastError || new Error('Preview image could not be loaded.');
    },
    buildSubtitlePreviewFromCurrentVideo(previewText, styleOptions) {
        if (!window.VideoPlayer?.videoElement || !window.VideoPlayer.videoElement.videoWidth || !window.VideoPlayer.videoElement.videoHeight) {
            return null;
        }

        const videoEl = window.VideoPlayer.videoElement;
        const maxWidth = 640;
        const scale = videoEl.videoWidth > maxWidth ? (maxWidth / videoEl.videoWidth) : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(videoEl.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(videoEl.videoHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        this.drawSubtitlePreviewOnCanvas(ctx, canvas.width, canvas.height, previewText, styleOptions);
        return canvas.toDataURL('image/jpeg', 0.78).split(',')[1];
    },
    buildCurrentVideoFramePreview() {
        if (!window.VideoPlayer?.videoElement || !window.VideoPlayer.videoElement.videoWidth || !window.VideoPlayer.videoElement.videoHeight) {
            return null;
        }

        const videoEl = window.VideoPlayer.videoElement;
        const maxWidth = 640;
        const scale = videoEl.videoWidth > maxWidth ? (maxWidth / videoEl.videoWidth) : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(videoEl.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(videoEl.videoHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.78).split(',')[1];
    },
    drawSubtitlePreviewOnCanvas(ctx, width, height, previewText, styleOptions) {
        const layoutMode = styleOptions?.layoutMode || 'classic';
        const baseDimension = Math.max(320, Math.min(width, height));
        const sizeScale = Math.max(10, Math.min(140, Number(styleOptions?.sizeScale || 50))) / 100;
        const fontSize = layoutMode === 'classic'
            ? Math.max(14, Math.min(30, Math.round(baseDimension * 0.03)))
            : Math.max(10, Math.min(28, Math.round(baseDimension * 0.026 * sizeScale)));
        const lineHeight = Math.round(fontSize * 1.25);
        const maxTextWidth = Math.round(width * 0.82);
        ctx.font = `bold ${fontSize}px Arial, sans-serif`;

        const words = String(previewText || '').split(/\s+/).filter(Boolean);
        const lines = [];
        let currentLine = '';
        words.forEach((word) => {
            const candidate = currentLine ? `${currentLine} ${word}` : word;
            if (ctx.measureText(candidate).width > maxTextWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = candidate;
            }
        });
        if (currentLine) lines.push(currentLine);
        if (lines.length === 0) lines.push('-');

        const backgroundMode = layoutMode === 'classic'
            ? 'shadow-only'
            : (styleOptions?.backgroundMode || 'box');
        const bgOpacity = Math.max(0, Math.min(100, Number(styleOptions?.backgroundOpacity ?? 5))) / 100;
        const textColor = styleOptions?.textColor || '#ffffff';
        const bgColor = styleOptions?.backgroundColor || '#000000';
        const paddingX = Math.round(fontSize * 0.6);
        const paddingY = Math.round(fontSize * 0.35);
        const totalTextHeight = (lines.length * lineHeight) + (paddingY * 2);
        const bottomMargin = layoutMode === 'classic'
            ? Math.max(16, Math.round(height * 0.035))
            : Math.max(6, Math.round(height * 0.008));
        const boxY = height - bottomMargin - totalTextHeight;

        lines.forEach((line, index) => {
            const textWidth = Math.ceil(ctx.measureText(line).width);
            const boxWidth = textWidth + (paddingX * 2);
            const boxX = Math.round((width - boxWidth) / 2);
            const y = boxY + paddingY + fontSize + (index * lineHeight);
            const rowY = boxY + (index * lineHeight);

            if (backgroundMode === 'box') {
                ctx.fillStyle = bgColor;
                ctx.globalAlpha = bgOpacity;
                ctx.fillRect(boxX, rowY, boxWidth, lineHeight + (index === lines.length - 1 ? paddingY : 0));
                ctx.globalAlpha = 1;
            }

            ctx.lineWidth = backgroundMode === 'shadow-only'
                ? Math.max(1, Math.round(fontSize * 0.12))
                : Math.max(1, Math.round(fontSize * 0.08));
            ctx.strokeStyle = '#000000';
            ctx.fillStyle = textColor;
            ctx.textAlign = 'center';
            ctx.strokeText(line, width / 2, y);
            ctx.fillText(line, width / 2, y);
        });
    },
    async buildSubtitleStylePreviewImage({ videoPath, previewTime, previewText, styleOptions }) {
        const frameBase64 = await window.api.extractFrameBase64({
            videoPath,
            time: previewTime || 0
        });
        const image = await this.loadImageFromBase64(frameBase64);

        const maxWidth = 640;
        const scale = image.width > maxWidth ? (maxWidth / image.width) : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        this.drawSubtitlePreviewOnCanvas(ctx, canvas.width, canvas.height, previewText, styleOptions);

        return canvas.toDataURL('image/jpeg', 0.78).split(',')[1];
    },
    async buildSubtitleStyleAiReviewImages({ videoPath, previewTime, previewText, styleOptions }) {
        const images = [];

        try {
            const rawFrameBase64 = await window.api.extractFrameBase64({
                videoPath,
                time: previewTime || 0
            });

            if (rawFrameBase64) {
                images.push({
                    mimeType: 'image/jpeg',
                    data: rawFrameBase64
                });

                const image = await this.loadImageFromBase64(rawFrameBase64);
                const maxWidth = 640;
                const scale = image.width > maxWidth ? (maxWidth / image.width) : 1;
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                this.drawSubtitlePreviewOnCanvas(ctx, canvas.width, canvas.height, previewText, styleOptions);

                images.push({
                    mimeType: 'image/jpeg',
                    data: canvas.toDataURL('image/jpeg', 0.78).split(',')[1]
                });
            }
        } catch (error) {
            console.warn('[SubtitleStyleAI] Frame pair could not be prepared from file:', error);
        }

        if (images.length === 0) {
            const rawCurrentFrame = this.buildCurrentVideoFramePreview();
            const compositedCurrentFrame = this.buildSubtitlePreviewFromCurrentVideo(previewText, styleOptions);

            if (rawCurrentFrame) {
                images.push({
                    mimeType: 'image/jpeg',
                    data: rawCurrentFrame
                });
            }

            if (compositedCurrentFrame) {
                images.push({
                    mimeType: 'image/jpeg',
                    data: compositedCurrentFrame
                });
            }
        }

        return images.length > 0 ? images : null;
    },
    isAiCapacityErrorMessage(message) {
        const normalized = String(message || '').toLowerCase();
        return normalized.includes('high demand')
            || normalized.includes('try again later')
            || normalized.includes('exceeded your current quota')
            || normalized.includes('check your plan and billing')
            || normalized.includes('rate-limits')
            || normalized.includes('rate limit')
            || normalized.includes('resource exhausted')
            || normalized.includes('429')
            || normalized.includes('503');
    },
    async buildSubtitleStyleAiReviewVariants({ videoPath, previewTime, previewText, styleOptions, basePrompt }) {
        const variants = [];

        const pairImages = await this.buildSubtitleStyleAiReviewImages({
            videoPath,
            previewTime,
            previewText,
            styleOptions
        });

        if (Array.isArray(pairImages) && pairImages.length >= 2) {
            variants.push({
                imageBase64: pairImages,
                prompt: `${basePrompt}\n\nBu istekte iki görsel gönderildi. İlk görsel videonun ham karesi, ikinci görsel ise aynı kare üzerine seçilen altyazı stilinin yerleştirilmiş önizlemesidir. Yorumu bu iki görseli karşılaştırarak yap. Özellikle altyazının videodaki önemli detayları kapatıp kapatmadığına, arka planla kontrastına ve okunabilirliğine bak.`
            });
        }

        let singlePreview = null;
        try {
            singlePreview = await this.buildSubtitleStylePreviewImage({
                videoPath,
                previewTime,
                previewText,
                styleOptions
            });
        } catch (error) {
            console.warn('[SubtitleStyleAI] Single preview image could not be prepared from file:', error);
        }

        if (!singlePreview) {
            singlePreview = this.buildSubtitlePreviewFromCurrentVideo(previewText, styleOptions);
        }

        if (singlePreview) {
            variants.push({
                imageBase64: singlePreview,
                prompt: `${basePrompt}\n\nBu istekte gönderilen görsel, videonun gerçek bir karesi üzerine seçilen altyazı stilinin yerleştirilmiş önizlemesidir. Değerlendirmeyi öncelikle bu görsele göre yap.`
            });
        }

        variants.push({
            imageBase64: null,
            prompt: `${basePrompt}\n\nGörsel erişimin sınırlıysa yalnızca verilen altyazı ayarlarına göre en güvenli okunabilirlik yorumunu yap ve bunu açıkça belirt.`
        });

        return variants;
    },
    buildAiPositioningReviewPrompt({ videoW, videoH, x, y, effectiveW, effectiveH, extraInfo }) {
        const lang = this.getCurrentAiLanguageName();
        if (this.getCurrentAiLocale() === 'tr') {
            return `Sana iki görsel gönderiyorum (veya tek).
            1. Görsel: Videonun ham karesi. (Çözünürlük: ${videoW}x${videoH})
            2. Görsel (varsa): Videonun üzerine eklemek istediğim transparan arka planlı görsel/logo/yazı.

            Ben bu ikinci görseli, birinci görselin üzerine şu koordinatlara yerleştireceğim:
            Konum: (${x}, ${y}) piksel (Sol üst köşe 0,0).
            Hedef Boyut: ${effectiveW} x ${effectiveH}.

            ${extraInfo}

            Lütfen bu iki görselin birleşmiş halini zihninde canlandır ve şu maddeleri kullanım amacına göre değerlendir:

            Eğer bu bir LOGO/FİLGRAN ise:
            - Köşelere veya boş alanlara yerleşmiş mi?
            - Önemli bir detayı (yüz, mevcut yazı, ana obje) kapatıyor mu?
            - Yeterince okunabilir mi?

            Eğer bu bir ARKA PLAN GÖRSELİ ise (tam ekran veya büyük):
            - En boy oranı videoya uyuyor mu? (Kenarlarda boşluk kalır mı?)
            - Üzerine binecek diğer öğeler (varsa) ile renk uyumu nasıl?

            Eğer bu SERBEST BİR GÖRSEL (resim içinde resim) ise:
            - Videonun akışını ve kompozisyonunu bozuyor mu?
            - Estetik olarak dengeli duruyor mu?

            Sonuç olarak: Konum ve boyut sence uygun mu? Eğer değilse, piksel koordinatı veya boyut olarak ne önerirsin?

            Yanıtının tamamını yalnızca Türkçe ver.

            ÖNEMLİ: Eğer görsel çok büyükse, orantısızsa veya boyutlandırma gerekiyorsa, lütfen yanıtının sonuna ayrıca JSON formatında bir öneri ekle:
            \`\`\`json
            { "suggestion": { "width": 300, "height": -1 } }
            \`\`\``;
        }

        return `I am sending you two images (or one image).
        1. Image: The raw frame of the video. (Resolution: ${videoW}x${videoH})
        2. Image (if present): A transparent-background image/logo/text that I want to place on top of the video.

        I plan to place the second image over the first one at these coordinates:
        Position: (${x}, ${y}) pixels (top-left corner is 0,0).
        Target size: ${effectiveW} x ${effectiveH}.

        ${extraInfo}

        Please imagine the combined result of these visuals and evaluate it based on the intended use:

        If this is a LOGO/WATERMARK:
        - Is it placed in a corner or an empty area?
        - Does it cover an important detail such as a face, existing text, or the main object?
        - Is it readable enough?

        If this is a BACKGROUND IMAGE (full screen or large):
        - Does its aspect ratio fit the video? (Would there be empty borders?)
        - How well does it match the colors of any other elements that may appear on top?

        If this is a FREE-FLOATING IMAGE (picture in picture):
        - Does it disrupt the flow or composition of the video?
        - Does it look aesthetically balanced?

        Final assessment: Is the position and size appropriate? If not, what pixel coordinates or size would you recommend?

        Write your full answer only in ${lang}.

        IMPORTANT: If the image is too large, disproportionate, or needs resizing, append a JSON suggestion at the end of the answer:
        \`\`\`json
        { "suggestion": { "width": 300, "height": -1 } }
        \`\`\``;
    },
    buildAiPlacementSuggestionsPrompt({ videoW, videoH, overlayBase64 }) {
        const lang = this.getCurrentAiLanguageName();
        let prompt;
        if (this.getCurrentAiLocale() === 'tr') {
            prompt = `
            Bu video karesini analiz etmeni istiyorum. Videonun üzerine ek bir görsel (resim içinde resim, logo veya metin kutusu) eklemek istiyorum.
            Video Çözünürlüğü: ${videoW}x${videoH}
            `;

            if (overlayBase64) {
                prompt += `
                Sana ayrıca 2. görsel olarak, eklemek istediğim içeriğin (logo/resim/yazı) bir örneğini gönderdim.
                Lütfen bu 2. görselin içeriğini, rengini ve şeklini dikkate alarak;
                Videonun kompozisyonunu bozmayacak, estetik duracak ve önemli detayları kapatmayacak en uygun 3 alanı ve her alan için ideal boyutları öner.
                Önerdiğin boyutlar (w, h), görselin orijinal en-boy oranını korumalıdır.
                `;

                if (this.wizardState.sourceType === 'text') {
                    prompt += `
                    Ayrıca bu bir YAZI katmanıdır. Ekleneceği alandaki arka plan rengine göre, okunabilirliği en yüksek olacak yazı rengini ve gerekirse arka planını seç.
                    Mevcut renk seçenekleri:
                    - textColor: "white", "black", "yellow", "red"
                    - bgColor: "transparent", "black", "white" (yalnızca okunabilirlik çok kötüyse black/white seç, yoksa transparent kalsın)
                    `;
                }
            } else {
                prompt += `
                Lütfen videodaki meşgul olmayan, boş veya dikkat dağıtmayacak en uygun 3 alanı tespit et.
                Bu alanlar yüzleri, önemli metinleri veya ana objeleri kapatmamalı.
                `;
            }

            prompt += `
            JSON içindeki "label" ve "description" alanlarını yalnızca Türkçe yaz.
            Lütfen yanıtını sadece aşağıdaki JSON formatında ver:
            \`\`\`json
            [
              { "label": "Sol Üst", "x": 50, "y": 50, "w": 150, "h": 50, "textColor": "white", "bgColor": "transparent", "description": "..." },
              { "label": "Sağ Alt", "x": 1200, "y": 900, "w": 600, "h": 150, "textColor": "white", "bgColor": "black", "description": "..." }
            ]
            \`\`\`
            `;
            return prompt;
        }

        prompt = `
        I want you to analyze this video frame. I plan to add an extra visual element on top of the video, such as a picture-in-picture image, logo, or text box.
        Video resolution: ${videoW}x${videoH}
        `;

        if (overlayBase64) {
            prompt += `
            I also sent a second image that represents the content I want to add (logo/image/text).
            Please consider that second image's content, colors, and shape, then suggest the best 3 placement areas and ideal dimensions for each one.
            The suggested dimensions (w, h) should preserve the original aspect ratio of the overlay.
            `;

            if (this.wizardState.sourceType === 'text') {
                prompt += `
                This is also a TEXT layer. Based on the background color of the target area, choose the text color and, if necessary, a background color that will maximize readability.
                Available color options:
                - textColor: "white", "black", "yellow", "red"
                - bgColor: "transparent", "black", "white" (choose black/white only if readability would otherwise be very poor; otherwise keep transparent)
                `;
            }
        } else {
            prompt += `
            Please identify the best 3 areas in the video that are unoccupied, empty, or least distracting.
            These areas must not cover faces, important text, or the main subject.
            `;
        }

        prompt += `
        Write the "label" and "description" values only in ${lang}.
        Return your answer only in the following JSON format:
        \`\`\`json
        [
          { "label": "Top Left", "x": 50, "y": 50, "w": 150, "h": 50, "textColor": "white", "bgColor": "transparent", "description": "..." },
          { "label": "Bottom Right", "x": 1200, "y": 900, "w": 600, "h": 150, "textColor": "white", "bgColor": "black", "description": "..." }
        ]
        \`\`\`
        `;
        return prompt;
    },
    getAiChatLabel(type) {
        const labels = {
            question: this.t('runtime.dialogs.ai_question_label', 'Question'),
            answer: this.t('runtime.dialogs.ai_answer_label', 'AI')
        };
        return labels[type] || '';
    },

    /**
     * Modülü başlat
     */
    init() {
        this.speedDialog = document.getElementById('speed-dialog');
        this.speedSuccessDialog = document.getElementById('speed-success-dialog');
        this.gotoDialog = document.getElementById('goto-dialog');
        this.rangeDialog = document.getElementById('range-dialog');
        this.textDialog = document.getElementById('text-dialog');
        this.textOverlayDialog = document.getElementById('text-overlay-dialog');
        this.audioAddDialog = document.getElementById('audio-add-dialog');
        this.audioEditorDialog = document.getElementById('audio-editor-dialog');
        this.imagesDialog = document.getElementById('images-dialog');
        this.shortcutsDialog = document.getElementById('shortcuts-dialog');
        this.aiDialog = document.getElementById('ai-dialog');
        this.videoPropertiesDialog = document.getElementById('video-properties-dialog');
        this.videoMismatchDialog = document.getElementById('video-mismatch-dialog');
        this.silenceParamsDialog = document.getElementById('silence-params-dialog');
        this.silenceListDialog = document.getElementById('silence-list-dialog');
        this.aiDescriptionDialog = document.getElementById('ai-description-dialog');
        this.geminiApiKeyDialog = document.getElementById('gemini-api-key-dialog');
        this.openAiApiKeyDialog = document.getElementById('openai-api-key-dialog');
        this.elevenLabsApiKeyDialog = document.getElementById('elevenlabs-api-key-dialog');
        this.instantVoiceTranslationDialog = document.getElementById('instant-voice-translation-dialog');
        this.accessibleConfirmDialog = document.getElementById('accessible-confirm-dialog');
        this.imageWizardDialog = document.getElementById('image-wizard-dialog');
        this.selectionQueueDialog = document.getElementById('selection-queue-dialog');
        this.transitionLibraryDialog = document.getElementById('transition-library-dialog');
        this.transitionListDialog = document.getElementById('transition-list-dialog');
        this.subtitleTtsDialog = document.getElementById('subtitle-tts-options-dialog');
        this.subtitleActionDialog = document.getElementById('subtitle-action-dialog'); // YENİ
        this.subtitleStyleDialog = document.getElementById('subtitle-style-dialog');
        this.videoLayerWizardDialog = document.getElementById('video-layer-wizard-dialog'); // VIDEO LAYER
        this.ctaLibraryDialog = document.getElementById('cta-library-dialog'); // CTA LIBRARY

        // CtaLibrary sadece dialog açıldığında başlatılacak

        // Erişilebilir onay diyaloğu için callback
        this.accessibleConfirmResolve = null;
        this.accessibleConfirmCancelValue = false;
        this.subtitleActionResolve = null;
        this.subtitleTtsResolve = null;
        this.subtitleStyleResolve = null;
        this.subtitleStylePreviewContext = null;

        // --- Otomatik Klavye Yönetimi ---
        const allDialogs = [
            this.gotoDialog, this.rangeDialog, this.textDialog, this.textOverlayDialog,
            this.audioAddDialog, this.audioEditorDialog, this.imagesDialog,
            this.shortcutsDialog, this.aiDialog, this.videoPropertiesDialog,
            this.videoMismatchDialog, this.silenceParamsDialog, this.silenceListDialog,
            this.aiDescriptionDialog, this.geminiApiKeyDialog, this.openAiApiKeyDialog, this.elevenLabsApiKeyDialog, this.accessibleConfirmDialog,
            this.instantVoiceTranslationDialog,
            this.imageWizardDialog, this.selectionQueueDialog, this.transitionLibraryDialog, this.transitionListDialog,
            this.subtitleActionDialog, this.subtitleTtsDialog, this.subtitleStyleDialog,
            this.videoLayerWizardDialog, this.ctaLibraryDialog,
            this.speedDialog
        ];
        allDialogs.forEach(d => {
            if (d) {
                d.addEventListener('close', () => {
                    if (window.Keyboard) window.Keyboard.setEnabled(true);
                });
            }
        });

        // Audio Add Dialog için özel close handler - preview'ı durdur
        this.audioAddDialog?.addEventListener('close', () => {
            this.stopAudioAddPreview();
        });
        // --------------------------------

        this.setupEventListeners();
        this.setupAudioAddEventListeners();
        this.setupAudioEditorEventListeners();
        this.setupTextOverlayEventListeners();
        this.setupImageWizardEventListeners();
        this.setupSelectionQueueEventListeners();
        this.setupTransitionEventListeners();
        this.setupSilenceEventListeners();
        this.setupAIEventListeners();
        this.setupGeminiApiKeyEventListeners();
        this.setupOpenAiApiKeyEventListeners();
        this.setupElevenLabsApiKeyEventListeners();
        this.setupInstantVoiceTranslationEventListeners();
        this.setupAccessibleConfirmEventListeners();
        this.setupSubtitleTtsEventListeners();
        this.setupCtaLibraryEventListeners();
        this.setupSpeedEventListeners();
    },

    /**
 * CTA Kütüphanesi Event Listenerları
 */
    setupCtaLibraryEventListeners() {
        document.getElementById('cta-cancel')?.addEventListener('click', () => {
            if (this.ctaLibraryDialog) this.ctaLibraryDialog.close();
        });

        // Zaman Çizelgesine Ekle butonu (non-destructive)
        document.getElementById('cta-add-timeline')?.addEventListener('click', () => {
            console.log('CTA Add Timeline clicked');

            if (typeof CtaLibrary === 'undefined') {
                console.error('CtaLibrary not defined');
                return;
            }

            const selectedAsset = CtaLibrary.getSelected();
            console.log('Selected asset:', selectedAsset);

            if (!selectedAsset) {
                Accessibility.alert('Lütfen bir öğe seçin.');
                return;
            }

            // Ayarları al
            const position = document.getElementById('cta-position').value;
            const scale = parseInt(document.getElementById('cta-scale').value) / 100;
            const opacity = parseInt(document.getElementById('cta-opacity').value) / 100;
            const durationInput = parseFloat(document.getElementById('cta-duration').value);
            const fade = document.getElementById('cta-fade').checked;
            const description = document.getElementById('cta-desc').value;
            const sound = document.getElementById('cta-sound')?.value || 'embedded';

            const duration = (durationInput > 0) ? durationInput : (selectedAsset.duration || 5);

            // Mevcut video zamanını al
            let startTime = 0;
            if (typeof VideoPlayer !== 'undefined' && VideoPlayer.getTimelineTime) {
                startTime = VideoPlayer.getTimelineTime();
            }
            console.log('Start time:', startTime);

            // Diyaloğu kapat
            this.ctaLibraryDialog.close();

            // CTA'yı zaman çizelgesine ekle (non-destructive)
            if (typeof CtaOverlayPreview !== 'undefined') {
                const result = CtaOverlayPreview.addOverlayToTimeline({
                    asset: selectedAsset,
                    options: {
                        position,
                        scale,
                        opacity,
                        duration,
                        fade,
                        description,
                        sound,
                        startTime
                    }
                });

                console.log('CTA added result:', result);
                console.log('Total overlays:', CtaOverlayPreview.getOverlayCount());

                // Değişiklik yapıldığını işaretle
                if (typeof App !== 'undefined') {
                    App.hasChanges = true;
                }

                // Insertion Queue'ya ekle
                if (window.InsertionQueue) {
                    InsertionQueue.addItem('overlay', {
                        timelineOverlayId: result.id,
                        overlayId: selectedAsset.id,
                        overlayName: selectedAsset.name,
                        position: position,
                        scale: scale,
                        opacity: opacity,
                        duration: duration,
                        fade: fade,
                        description: description,
                        sound: sound,
                        startTime: startTime,
                        internalAsset: selectedAsset
                    });
                }

                Accessibility.announce(`${selectedAsset.name} zaman çizelgesine eklendi ve ekleme listesine dahil edildi. Video oynatıldığında ${startTime.toFixed(1)} saniyede görünecek.`);
            } else {
                console.error('CtaOverlayPreview not defined');
            }
        });
    },

    /**
     * CTA Kütüphanesini Göster
     */
    showCtaLibraryDialog() {
        if (!this.ctaLibraryDialog) return;

        // CtaLibrary'yi başlat (sadece ilk açılışta)
        if (typeof CtaLibrary !== 'undefined' && !CtaLibrary._initialized) {
            CtaLibrary.init();
            CtaLibrary._initialized = true;
        }

        this.ctaLibraryDialog.showModal();

        // İlk açılışta eğer seçili eleman yoksa veya "all" seçiliyse, onu vurgula
        setTimeout(() => {
            const list = document.getElementById('cta-categories-list');
            if (list) {
                const selected = list.querySelector('li.selected') || list.querySelector('li');
                if (selected) {
                    // Diğerlerinin tabindex'ini -1 yap
                    Array.from(list.querySelectorAll('li')).forEach(li => li.setAttribute('tabindex', '-1'));
                    selected.classList.add('selected');
                    selected.setAttribute('tabindex', '0');
                    selected.focus();
                }
            }
        }, 100);

        Accessibility.announce('CTA Kütüphanesi açıldı. Kategori seçmek için aşağı yukarı ok tuşlarını kullanın.');
    },

    /**
     * Event dinleyicilerini kur
     */
    setupEventListeners() {
        // === ZAMAN KODUNA GİT DİYALOĞU ===
        document.getElementById('goto-confirm')?.addEventListener('click', () => {
            const input = document.getElementById('goto-time-input');
            const timelineTime = Utils.parseTime(input.value);
            // seekToTimelineTime fonksiyonu doğru kaynağı bulur ve geçiş yapar
            VideoPlayer.seekToTimelineTime(timelineTime);
            this.gotoDialog.close();
            Accessibility.announceNavigation('Gidilen konum', timelineTime);
        });

        document.getElementById('goto-cancel')?.addEventListener('click', () => {
            this.gotoDialog.close();
        });

        // === ARALIK SEÇ DİYALOĞU ===
        document.getElementById('range-confirm')?.addEventListener('click', () => {
            const startInput = document.getElementById('range-start-input');
            const endInput = document.getElementById('range-end-input');
            const start = Utils.parseTime(startInput.value);
            const end = Utils.parseTime(endInput.value);
            Selection.setSelection(start, end);
            this.rangeDialog.close();
        });

        document.getElementById('range-cancel')?.addEventListener('click', () => {
            this.rangeDialog.close();
        });

        // === METİN EKLE DİYALOĞU ===
        document.getElementById('text-confirm')?.addEventListener('click', () => {
            const text = document.getElementById('text-content-input').value;
            const fontSize = document.getElementById('text-font-size').value;
            const position = document.getElementById('text-position').value;
            const color = document.getElementById('text-color').value;

            if (text.trim()) {
                App.addTextOverlay(text, {
                    fontSize: parseInt(fontSize),
                    position,
                    fontColor: color
                });
            }
            this.textDialog.close();
        });

        document.getElementById('text-cancel')?.addEventListener('click', () => {
            this.textDialog.close();
        });

        // === GÖRSEL EKLEME DİYALOĞU ===
        const durationTypeSelect = document.getElementById('images-duration-type');

        durationTypeSelect?.addEventListener('change', () => {
            const manualGroup = document.getElementById('manual-duration-group');
            manualGroup.style.display = durationTypeSelect.value === 'manual' ? 'block' : 'none';
        });

        document.getElementById('images-confirm')?.addEventListener('click', () => {
            const durationType = durationTypeSelect.value;
            let duration;

            if (durationType === 'manual') {
                duration = parseFloat(document.getElementById('images-duration').value);
            } else {
                // Otomatik hesapla
                const remainingDuration = VideoPlayer.getDuration() - VideoPlayer.getCurrentTime();
                duration = remainingDuration / this.pendingImagePaths.length;
            }

            if (this.pendingImagePaths && this.pendingImagePaths.length > 0) {
                App.insertImages(this.pendingImagePaths, duration);
                this.pendingImagePaths = null;
            }
            this.imagesDialog.close();
        });

        document.getElementById('images-cancel')?.addEventListener('click', () => {
            this.pendingImagePaths = null;
            this.imagesDialog.close();
        });

        // === KLAVYE KISAYOLLARI DİYALOĞU ===
        document.getElementById('shortcuts-close')?.addEventListener('click', () => {
            this.shortcutsDialog.close();
        });

        // === AI DİYALOĞU ===
        document.getElementById('ai-ask')?.addEventListener('click', () => {
            const question = document.getElementById('ai-question').value;
            if (question.trim()) {
                this.askAI(question);
            }
        });

        document.getElementById('ai-accept')?.addEventListener('click', () => {
            this.acceptAISuggestion();
            this.aiDialog.close();
        });

        document.getElementById('ai-reject')?.addEventListener('click', () => {
            this.aiDialog.close();
        });
    },

    /**
     * Zaman koduna git diyaloğunu göster
     * Timeline zamanını kullanır
     */
    showGotoDialog() {
        const input = document.getElementById('goto-time-input');
        // Timeline zamanını kullan
        input.value = Utils.formatTime(VideoPlayer.getTimelineTime());
        this.gotoDialog.showModal();
        input.select();
        Accessibility.announce('Zaman koduna git diyaloğu açıldı');
    },

    /**
     * Aralık seç diyaloğunu göster
     * Timeline zamanlarını kullanır
     */
    showRangeDialog() {
        const startInput = document.getElementById('range-start-input');
        const endInput = document.getElementById('range-end-input');

        if (Selection.hasSelection()) {
            const sel = Selection.getSelection();
            startInput.value = Utils.formatTime(sel.start);
            endInput.value = Utils.formatTime(sel.end);
        } else {
            // Timeline zamanını kullan
            const timelineTime = VideoPlayer.getTimelineTime();
            startInput.value = Utils.formatTime(timelineTime);
            endInput.value = Utils.formatTime(timelineTime);
        }

        this.rangeDialog.showModal();
        startInput.select();
        Accessibility.announce('Aralık seç diyaloğu açıldı');
    },

    /**
     * Hız Değiştirme diyaloğunu göster
     */
    showSpeedDialog() {
        if (!Selection.hasSelection()) {
            Accessibility.alert(this.t('runtime.dialogs.speed_select_area_first', 'Please select the area whose speed you want to change first.'));
            return;
        }

        const input = document.getElementById('speed-multiplier');
        input.value = "1.0";
        document.getElementById('speed-distortion-warning').classList.add('hidden');
        document.getElementById('speed-distortion-warning').classList.add('hidden');
        document.getElementById('speed-mute-audio').checked = false;

        const bgAudioCheckbox = document.getElementById('speed-add-bg-audio');
        const bgAudioContainer = document.getElementById('speed-bg-audio-container');
        const bgAudioPathSpan = document.getElementById('speed-bg-audio-path');

        if (bgAudioCheckbox) bgAudioCheckbox.checked = false;
        if (bgAudioContainer) bgAudioContainer.classList.add('hidden');
        if (bgAudioPathSpan) {
            bgAudioPathSpan.textContent = this.t('dialog.speed.no_bg_audio', 'No file selected');
            bgAudioPathSpan.dataset.path = '';
        }

        this.speedDialog.showModal();
        input.focus();
        Accessibility.announce(this.t('runtime.dialogs.speed_dialog_opened', 'Speed change dialog opened. Current playback speed is 1.0x.'));
    },

    setupSpeedEventListeners() {
        const confirmBtn = document.getElementById('speed-confirm');
        const cancelBtn = document.getElementById('speed-cancel');
        const multiplierInput = document.getElementById('speed-multiplier');
        const warning = document.getElementById('speed-distortion-warning');
        const muteCheckbox = document.getElementById('speed-mute-audio');

        if (multiplierInput) {
            multiplierInput.addEventListener('input', () => {
                const val = parseFloat(multiplierInput.value);
                if (val > 2.0 && val < 50.0) {
                    warning.classList.remove('hidden');
                } else {
                    warning.classList.add('hidden');
                }
            });
        }

        const bgAudioCheckbox = document.getElementById('speed-add-bg-audio');
        const bgAudioContainer = document.getElementById('speed-bg-audio-container');
        const browseBgAudioBtn = document.getElementById('speed-browse-bg-audio');
        const bgAudioPathSpan = document.getElementById('speed-bg-audio-path');

        const handleBrowse = async (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            try {
                const result = await window.api.openFileDialog({
                    properties: ['openFile'],
                    filters: [
                        { name: 'Ses Dosyaları', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac'] }
                    ]
                });

                if (result && !result.canceled && result.filePaths && result.filePaths.length > 0) {
                    const filePath = result.filePaths[0];
                    const filename = filePath.split(/[/\\]/).pop();
                    bgAudioPathSpan.textContent = filename;
                    bgAudioPathSpan.dataset.path = filePath;
                    Accessibility.announce(`${filename} seçildi. Uyqula diyerek işlemi tamamlayabilirsiniz.`);
                } else if (e && e.type === 'change' && bgAudioCheckbox) {
                    // Checkbox ile açılıp da iptal edildiyse, checkbox'ı geri kapat
                    bgAudioCheckbox.checked = false;
                    bgAudioContainer.classList.add('hidden');
                    Accessibility.announce('Dosya seçimi iptal edildi. Fon sesi eklenmeyecek.');
                }
            } catch (err) {
                console.error("Fon Sesi Seçimi Hatası:", err);
            }
        };

        if (bgAudioCheckbox && bgAudioContainer) {
            bgAudioCheckbox.addEventListener('change', (e) => {
                if (bgAudioCheckbox.checked) {
                    bgAudioContainer.classList.remove('hidden');
                    muteCheckbox.checked = true; // Sesi kapatmak önerilir
                    Accessibility.announce('Fon sesi ekleme aktif. Lütfen bir dosya seçin.');
                    handleBrowse(e);
                } else {
                    bgAudioContainer.classList.add('hidden');
                    Accessibility.announce('Fon sesi ekleme iptal edildi.');
                }
            });
        }

        if (browseBgAudioBtn) {
            browseBgAudioBtn.addEventListener('click', handleBrowse);
            browseBgAudioBtn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    handleBrowse(e);
                }
            });
        }

        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                try {
                    let multiplier = parseFloat(multiplierInput.value);
                    if (isNaN(multiplier) || multiplier <= 0 || multiplier > 10.0) {
                        multiplier = 1.0;
                    }
                    const mute = muteCheckbox.checked;

                    let bgAudioPath = null;
                    const bgAudioCheckbox = document.getElementById('speed-add-bg-audio');
                    const bgAudioPathSpan = document.getElementById('speed-bg-audio-path');

                    if (bgAudioCheckbox && bgAudioCheckbox.checked && bgAudioPathSpan && bgAudioPathSpan.dataset.path) {
                        bgAudioPath = bgAudioPathSpan.dataset.path;
                    }

                    // Timeline'a bildirelim
                    const sel = Selection.getSelection();
                    if (sel) {
                        Timeline.applySpeedToRange(sel.start, sel.end, multiplier, mute, bgAudioPath);
                        App.hasChanges = true;

                        try {
                            if (typeof App !== 'undefined' && App.updateAfterEdit) {
                                App.updateAfterEdit();
                            }
                        } catch (appErr) {
                            console.error("App.updateAfterEdit Error:", appErr);
                        }

                        const newDur = Timeline.getTotalDuration();
                        const msg = this.t('runtime.dialogs.speed_applied_success', 'Congratulations. The speed was applied successfully at {multiplier}x. The new total video duration is {duration}.', {
                            multiplier,
                            duration: Accessibility.formatTimeForSpeech(newDur)
                        });

                        // İşlemi bitir ve mesajı oku
                        this.speedDialog.close();
                        try { Selection.clear(); } catch (se) { }
                        Accessibility.announceImmediate(msg);

                        if (typeof VideoPlayer !== 'undefined' && VideoPlayer.video) {
                            VideoPlayer.video.focus();
                        }
                    } else {
                        Accessibility.alert(this.t('runtime.dialogs.speed_selection_missing', 'Warning: A valid selection could not be found.'));
                        this.speedDialog.close();
                    }
                } catch (err) {
                    console.error("Speed Dialog Confirm Error:", err);
                    Accessibility.alert(this.t('runtime.common.error', 'Error: {error}', { error: err.message }));
                    this.speedDialog.close();
                }
            });
        }

        // Enter tuşu desteğini elle ekleyelim (form'u sildiğimiz için)
        if (this.speedDialog) {
            this.speedDialog.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
                    e.preventDefault();
                    if (confirmBtn) confirmBtn.click();
                }
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.speedDialog.close();
            });
        }
    },

    /**
     * Metin ekle diyaloğunu göster
     */
    showTextDialog() {
        window.i18nHelper?.translateDOM();
        document.getElementById('text-content-input').value = '';
        document.getElementById('text-font-size').value = '24';
        document.getElementById('text-position').value = 'bottom';
        document.getElementById('text-color').value = 'white';

        this.textDialog.showModal();
        document.getElementById('text-content-input').focus();
        Accessibility.announce(this.t('runtime.dialogs.simple_text_dialog_opened', 'Insert text dialog opened.'));
    },

    /**
     * Gelişmiş ses ekleme diyaloğunu göster
     * @param {string} audioPath - Eklenecek ses dosyası
     */
    async showAudioAddDialog(audioPath) {
        if (!audioPath) {
            console.error('showAudioAddDialog: audioPath is undefined or empty');
            Accessibility.alert('Ses dosyası yolu geçersiz');
            return;
        }

        this.pendingAudioPath = audioPath;
        this.audioTrimRange = null;

        // Dialog açıldığındaki konumu kaydet (önizleme sırasında değişebilir)
        this.audioDialogStartTime = VideoPlayer.getCurrentTime();

        // Ses dosyası bilgilerini al
        const filename = audioPath.split(/[/\\]/).pop();
        document.getElementById('audio-add-filename').textContent = filename;

        // Video süresini göster
        const videoDuration = VideoPlayer.getDuration();
        const currentTime = this.audioDialogStartTime;
        const remainingDuration = videoDuration - currentTime;
        document.getElementById('video-remaining-duration').textContent =
            Utils.formatTime(remainingDuration) + ` (kalan süre)`;

        // Ses süresini almaya çalış (audio element ile)
        const audioDuration = await this.getAudioDuration(audioPath);
        this.pendingAudioMetadata = { duration: audioDuration, path: audioPath };
        document.getElementById('audio-add-duration').textContent = Utils.formatTime(audioDuration);

        // Süre uyarısını kontrol et
        const warningEl = document.getElementById('audio-duration-warning');
        if (audioDuration > remainingDuration) {
            warningEl.classList.remove('hidden');
            Accessibility.announce('Uyarı: Eklediğiniz ses içeriği videonuzdan daha uzun. İçerik kesilecek.');
        } else {
            warningEl.classList.add('hidden');
        }

        // Slider'ları sıfırla
        document.getElementById('target-audio-volume').value = 100;
        document.getElementById('source-audio-volume').value = 100;
        document.getElementById('target-audio-volume-value').textContent = '%100';
        document.getElementById('source-audio-volume-value').textContent = '%100';

        // Checkbox'ları sıfırla
        document.getElementById('audio-as-background').checked = false;

        this.audioAddDialog.showModal();
        document.getElementById('target-audio-volume').focus();
        Accessibility.announce('Ses ekle diyaloğu açıldı. ' + filename);
    },

    /**
     * Audio dosyasının süresini al
     * @param {string} audioPath - Ses dosyası yolu
     * @returns {Promise<number>} - Süre (saniye)
     */
    getAudioDuration(audioPath) {
        return new Promise((resolve) => {
            const audio = new Audio();
            audio.addEventListener('loadedmetadata', () => {
                resolve(audio.duration || 0);
            });
            audio.addEventListener('error', () => {
                resolve(0);
            });
            audio.src = audioPath;
        });
    },

    /**
     * Ses ekleme diyaloğu event listener'larını kur
     */
    setupAudioAddEventListeners() {
        const targetSlider = document.getElementById('target-audio-volume');
        const sourceSlider = document.getElementById('source-audio-volume');
        const dialog = document.getElementById('audio-add-dialog');

        // Diyalog seviyesinde Alt+P kısayolu
        dialog?.addEventListener('keydown', (e) => {
            if (e.altKey && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                e.stopPropagation();
                this.toggleAudioPreview();
            }
        });

        // Volume slider input olayları - anlık önizleme güncellemesi ile
        const updateVolumeDisplay = (slider, displayEl) => {
            displayEl.textContent = `%${slider.value}`;
            // Önizleme aktifse anlık güncelle
            this.updatePreviewVolumes();
        };

        targetSlider?.addEventListener('input', () => {
            updateVolumeDisplay(targetSlider, document.getElementById('target-audio-volume-value'));
        });

        sourceSlider?.addEventListener('input', () => {
            updateVolumeDisplay(sourceSlider, document.getElementById('source-audio-volume-value'));
        });

        // Slider'larda ok tuşu ve Page Up/Down desteği
        const handleSliderKeydown = (slider, valueDisplay) => {
            slider?.addEventListener('keydown', (e) => {
                let step = 0;

                // Alt+P kontrolü - slider üzerinde olsa bile çalışmalı
                if (e.altKey && e.key.toLowerCase() === 'p') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleAudioPreview();
                    return;
                }

                if (e.key === 'PageUp') {
                    step = 10;
                    e.preventDefault();
                } else if (e.key === 'PageDown') {
                    step = -10;
                    e.preventDefault();
                } else if (e.key === 'ArrowUp') {
                    step = 1;
                    e.preventDefault();
                } else if (e.key === 'ArrowDown') {
                    step = -1;
                    e.preventDefault();
                } else {
                    return;
                }

                const currentValue = parseInt(slider.value) || 100;
                const newValue = Math.min(200, Math.max(0, currentValue + step));
                slider.value = newValue;
                valueDisplay.textContent = `%${newValue}`;

                // Önizleme aktifse anlık güncelle
                this.updatePreviewVolumes();

                // Ekran okuyucu için duyuru
                Accessibility.announce(`%${newValue}`);
            });
        };

        handleSliderKeydown(targetSlider, document.getElementById('target-audio-volume-value'));
        handleSliderKeydown(sourceSlider, document.getElementById('source-audio-volume-value'));

        // Ön izle düğmesi
        document.getElementById('audio-add-preview')?.addEventListener('click', () => {
            this.toggleAudioPreview();
        });

        // Sesi düzenle düğmesi
        document.getElementById('audio-add-edit')?.addEventListener('click', () => {
            this.showAudioEditorDialog();
        });

        // Listeye Ekle düğmesi
        document.getElementById('audio-add-to-list')?.addEventListener('click', () => {
            const targetSlider = document.getElementById('target-audio-volume');
            const sourceSlider = document.getElementById('source-audio-volume');
            const targetVolume = parseInt(targetSlider.value) / 100;
            const sourceVolume = parseInt(sourceSlider.value) / 100;
            const asBackground = document.getElementById('audio-as-background').checked;

            if (this.pendingAudioPath) {
                // Listeye ekle - dialog açıldığındaki konumu kullan
                InsertionQueue.addItem('audio', {
                    audioPath: this.pendingAudioPath,
                    audioVolume: targetVolume,
                    videoVolume: sourceVolume,
                    loopAudio: asBackground,
                    audioTrimStart: this.audioTrimRange?.start || 0,
                    audioTrimEnd: asBackground ? 0 : (this.audioTrimRange?.end || (this.pendingAudioMetadata?.duration || 0)),
                    startTime: this.audioDialogStartTime || 0
                });

                Accessibility.announce(`Ses listeye eklendi. Toplam: ${InsertionQueue.getCount()} öğe`);
            }

            this.stopAudioPreview();
            this.pendingAudioPath = null;
            this.pendingAudioMetadata = null;
            this.audioTrimRange = null;
            this.audioDialogStartTime = undefined;
            this.audioAddDialog.close();
        });

        // Videoya Ekle düğmesi (doğrudan uygula)
        document.getElementById('audio-add-apply')?.addEventListener('click', async () => {
            const targetSlider = document.getElementById('target-audio-volume');
            const sourceSlider = document.getElementById('source-audio-volume');
            const targetVolume = parseInt(targetSlider.value) / 100;
            const sourceVolume = parseInt(sourceSlider.value) / 100;
            const asBackground = document.getElementById('audio-as-background').checked;

            if (this.pendingAudioPath) {
                this.stopAudioPreview();
                this.audioAddDialog.close();

                // Doğrudan videoya ekle
                await App.addAudioToVideo({
                    audioPath: this.pendingAudioPath,
                    targetVolume,
                    sourceVolume,
                    asBackground,
                    trimStart: this.audioTrimRange?.start || 0,
                    trimEnd: asBackground ? 0 : (this.audioTrimRange?.end || (this.pendingAudioMetadata?.duration || 0))
                });
            }

            this.pendingAudioPath = null;
            this.pendingAudioMetadata = null;
            this.audioTrimRange = null;
            this.audioDialogStartTime = undefined;
        });

        // Kapat düğmesi
        document.getElementById('audio-add-close')?.addEventListener('click', () => {
            this.pendingAudioPath = null;
            this.pendingAudioMetadata = null;
            this.audioTrimRange = null;
            this.stopAudioPreview();
            this.audioAddDialog.close();
        });
    },

    /**
     * Ses düzenleme diyaloğu event listener'larını kur
     */
    setupAudioEditorEventListeners() {
        const audioPlayer = document.getElementById('audio-editor-player');

        // Konum güncellemesi
        audioPlayer?.addEventListener('timeupdate', () => {
            const position = document.getElementById('audio-editor-position');
            position.textContent = `Konum: ${Utils.formatTime(audioPlayer.currentTime)}`;
            this.updateSelectedDuration();
        });

        // Oynat/Duraklat düğmesi
        document.getElementById('audio-editor-play')?.addEventListener('click', () => {
            if (audioPlayer.paused) {
                audioPlayer.play();
            } else {
                audioPlayer.pause();
            }
        });

        // Başlangıç ayarla düğmesi
        document.getElementById('audio-editor-set-start')?.addEventListener('click', () => {
            const startInput = document.getElementById('audio-trim-start');
            startInput.value = Utils.formatTime(audioPlayer.currentTime);
            this.updateSelectedDuration();
            Accessibility.announce(`Başlangıç noktası: ${startInput.value}`);
        });

        // Bitiş ayarla düğmesi
        document.getElementById('audio-editor-set-end')?.addEventListener('click', () => {
            const endInput = document.getElementById('audio-trim-end');
            endInput.value = Utils.formatTime(audioPlayer.currentTime);
            this.updateSelectedDuration();
            Accessibility.announce(`Bitiş noktası: ${endInput.value}`);
        });

        // Tamam düğmesi
        document.getElementById('audio-editor-confirm')?.addEventListener('click', () => {
            const startTime = Utils.parseTime(document.getElementById('audio-trim-start').value);
            const endTime = Utils.parseTime(document.getElementById('audio-trim-end').value);

            this.audioTrimRange = { start: startTime, end: endTime };

            // Ana diyaloğdaki ses süresini güncelle
            const trimmedDuration = endTime - startTime;
            document.getElementById('audio-add-duration').textContent =
                Utils.formatTime(trimmedDuration) + ' (kırpılmış)';

            audioPlayer.pause();
            this.audioEditorDialog.close();
            Accessibility.announce(`Ses kırpıldı: ${Utils.formatTime(trimmedDuration)}`);
        });

        // İptal düğmesi
        document.getElementById('audio-editor-cancel')?.addEventListener('click', () => {
            audioPlayer.pause();
            this.audioEditorDialog.close();
        });
    },

    /**
     * Ses düzenleme diyaloğunu göster
     */
    showAudioEditorDialog() {
        if (!this.pendingAudioPath) return;

        const audioPlayer = document.getElementById('audio-editor-player');
        const filename = this.pendingAudioPath.split(/[/\\]/).pop();

        document.getElementById('audio-editor-filename').textContent = filename;
        document.getElementById('audio-editor-total-duration').textContent =
            Utils.formatTime(this.pendingAudioMetadata?.duration || 0);

        // Trim aralığını ayarla
        const duration = this.pendingAudioMetadata?.duration || 0;
        document.getElementById('audio-trim-start').value =
            this.audioTrimRange?.start ? Utils.formatTime(this.audioTrimRange.start) : '00:00:00.000';
        document.getElementById('audio-trim-end').value =
            this.audioTrimRange?.end ? Utils.formatTime(this.audioTrimRange.end) : Utils.formatTime(duration);

        // Audio player'ı ayarla
        audioPlayer.src = this.pendingAudioPath;
        audioPlayer.currentTime = 0;

        this.updateSelectedDuration();

        this.audioEditorDialog.showModal();
        Accessibility.announce('Ses düzenleme diyaloğu açıldı. ' + filename);
    },

    /**
     * Seçili süreyi güncelle
     */
    updateSelectedDuration() {
        const startTime = Utils.parseTime(document.getElementById('audio-trim-start').value || '0');
        const endTime = Utils.parseTime(document.getElementById('audio-trim-end').value || '0');
        const selectedDuration = Math.max(0, endTime - startTime);
        document.getElementById('audio-editor-selected-duration').textContent = Utils.formatTime(selectedDuration);
    },

    /**
     * Ses ve video ön izlemesi - toggle
     */
    toggleAudioPreview() {
        if (this.isPreviewPlaying || (this.previewAudioElement && !this.previewAudioElement.paused)) {
            this.stopAudioAddPreview();
            Accessibility.announce('Ön izleme duraklatıldı');
        } else if (!this._audioPreviewLoading) {
            this.startAudioPreview();
        }
    },

    /**
     * Ses ve video ön izlemesi başlat
     */
    async startAudioPreview() {
        if (!this.pendingAudioPath) return;
        if (this._audioPreviewLoading) return;

        this._audioPreviewLoading = true;

        // ÖNCELİKLE: Mevcut herhangi bir oynatmayı durdur
        this._cleanupPreviewAudio();

        // Başlangıç konumunu kaydet
        this.previewStartTime = VideoPlayer.getCurrentTime();

        // isPreviewPlaying'i HEMEN true yap (toggle için)
        this.isPreviewPlaying = true;

        try {

            // Yeni audio element oluştur
            const audioUrl = this.pendingAudioPath.startsWith('http')
                ? this.pendingAudioPath
                : `file:///${this.pendingAudioPath.replace(/\\/g, '/').replace(/^[\/]+/, '')}`;

            // GLOBAL REFERANS KULLAN - En güvenli yöntem
            if (window.__PREVIEW_AUDIO__) {
                try {
                    window.__PREVIEW_AUDIO__.pause();
                    window.__PREVIEW_AUDIO__.src = '';
                } catch (e) { }
            }

            const audio = new Audio(audioUrl);
            window.__PREVIEW_AUDIO__ = audio; // Global sakla
            this.previewAudioElement = audio;

            // Volume ayarla
            const targetVolume = parseInt(document.getElementById('target-audio-volume').value) / 100;
            audio.volume = Math.min(1, Math.max(0, targetVolume));

            // Trim varsa başlangıç noktasına git
            if (this.audioTrimRange?.start) {
                audio.currentTime = this.audioTrimRange.start;
            }

            // Event Listeners
            audio.addEventListener('ended', () => {
                VideoPlayer.pause();
                this.stopAudioAddPreview();
                Accessibility.announce('Ön izleme tamamlandı');
            });

            audio.addEventListener('error', (e) => {
                console.error('Ön izleme ses hatası:', e);
                Accessibility.announce('Ses ön izlemesi başlatılamadı.');
                this.stopAudioAddPreview();
            });

            // Video volume'u ayarla
            const sourceVolume = parseInt(document.getElementById('source-audio-volume').value) / 100;
            VideoPlayer.setVolume(Math.min(1, sourceVolume));

            // Canplay bekle (timeout ile)
            await Promise.race([
                new Promise(resolve => { audio.oncanplaythrough = resolve; }),
                new Promise(resolve => setTimeout(resolve, 2000))
            ]);

            // Kullanıcı bu sırada durdurmuş olabilir
            if (!this.isPreviewPlaying || this.previewAudioElement !== audio) {
                this._audioPreviewLoading = false;
                return;
            }

            // Oynat
            VideoPlayer.play();
            const playPromise = audio.play();

            // Play promise'i bekle
            if (playPromise !== undefined) {
                await playPromise;
            }

            // KRİTİK: Play tamamlandıktan HEMEN SONRA tekrar kontrol!
            // Kullanıcı play sırasında stop demiş olabilir
            if (!this.isPreviewPlaying) {
                audio.pause();
                audio.currentTime = 0;
                VideoPlayer.pause();
                this._audioPreviewLoading = false;
                return;
            }

            this._audioPreviewLoading = false;
            Accessibility.announce('Ön izleme başlatıldı');

        } catch (e) {
            console.error('Preview start error:', e);
            this._audioPreviewLoading = false;
            this.stopAudioAddPreview();
        }
    },

    /**
     * Audio element'i temizle (dosya kilidini serbest bırak)
     */
    _cleanupPreviewAudio() {
        // Global temizlik
        if (window.__PREVIEW_AUDIO__) {
            try {
                window.__PREVIEW_AUDIO__.pause();
                window.__PREVIEW_AUDIO__.currentTime = 0;
                window.__PREVIEW_AUDIO__.src = '';
                window.__PREVIEW_AUDIO__.load();
            } catch (e) { }
            window.__PREVIEW_AUDIO__ = null;
        }

        if (this.previewAudioElement) {
            const audio = this.previewAudioElement;
            try {
                // Önce pause
                audio.pause();

                // Event listener'ları temizle
                audio.onended = null;
                audio.onerror = null;
                audio.oncanplaythrough = null;

                // Zorunlu reset
                audio.currentTime = 0;
                audio.src = '';
                audio.load();

                // Double-check: hala çalıyorsa tekrar durdur
                setTimeout(() => {
                    if (!audio.paused) {
                        console.warn('Audio hala çalıyor, tekrar durduruluyor...');
                        audio.pause();
                    }
                }, 50);
            } catch (e) {
                console.error('Audio cleanup error:', e);
            }
            this.previewAudioElement = null;
        }
    },

    /**
     * Ön izleme sırasında volume değerlerini anlık güncelle
     */
    updatePreviewVolumes() {
        if (!this.isPreviewPlaying) return;

        if (this.previewAudioElement) {
            const targetVolume = parseInt(document.getElementById('target-audio-volume').value) / 100;
            this.previewAudioElement.volume = Math.min(1, Math.max(0, targetVolume));
        }

        const sourceVolume = parseInt(document.getElementById('source-audio-volume').value) / 100;
        VideoPlayer.setVolume(Math.min(1, sourceVolume));
    },

    /**
     * Ses ön izlemesini durdur
     */
    stopAudioAddPreview() {
        // State'leri sıfırla
        this._audioPreviewLoading = false;
        this.isPreviewPlaying = false;

        // GLOBAL REFERANS KONTROLÜ
        if (window.__PREVIEW_AUDIO__) {
            const globalAudio = window.__PREVIEW_AUDIO__;
            try {
                globalAudio.pause();
                globalAudio.volume = 0;
                globalAudio.currentTime = 0;
                globalAudio.src = '';
            } catch (e) {
                console.error('Preview stop error:', e);
            }
            window.__PREVIEW_AUDIO__ = null;
        }

        // DOM'daki TÜM audio elementlerini kontrol et (ekstra güvenlik)
        try {
            const allAudios = document.querySelectorAll('audio');
            allAudios.forEach((audio) => {
                if (!audio.paused && audio.src.startsWith('file:///')) {
                    audio.pause();
                    audio.volume = 0;
                }
            });
        } catch (e) { }

        // Kendi audio elementimizi de temizle
        if (this.previewAudioElement) {
            const audio = this.previewAudioElement;
            try {
                audio.pause();
                audio.volume = 0;
                audio.src = '';
                audio.load();
            } catch (e) { }
            this.previewAudioElement = null;
        }

        // VideoPlayer'ı durdur
        try {
            VideoPlayer.pause();
            VideoPlayer.setVolume(1);
        } catch (e) { }

        // Cleanup helper
        this._cleanupPreviewAudio();

        // Başlangıç konumuna dön
        if (this.previewStartTime !== undefined) {
            try {
                VideoPlayer.seekTo(this.previewStartTime, false);
            } catch (e) { }
            this.previewStartTime = undefined;
        }
    },


    /**
     * Görsel ekleme diyaloğunu göster
     * @param {Array} imagePaths - Eklenecek görsel dosyaları
     */
    showImagesDialog(imagePaths) {
        this.pendingImagePaths = imagePaths;

        document.getElementById('images-count').textContent = `${imagePaths.length} görsel seçildi`;
        document.getElementById('images-duration-type').value = 'manual';
        document.getElementById('images-duration').value = '5';
        document.getElementById('manual-duration-group').style.display = 'block';

        this.imagesDialog.showModal();
        Accessibility.announce(`Görsel ekleme diyaloğu açıldı. ${imagePaths.length} görsel seçildi.`);
    },

    /**
     * Mac özel kısayol listesini oluştur
     */
    renderMacShortcuts() {
        const content = document.querySelector('#shortcuts-dialog .shortcuts-content');
        if (!content) return;

        // Kullanıcıdan gelen Mac listesine göre
        content.innerHTML = `
          <section>
            <h3>🧭 Navigasyon</h3>
            <dl>
              <dt>Sağ / Sol Ok</dt><dd>İnce ayara göre ileri / geri</dd>
              <dt>⌘ + Sağ / Sol Ok</dt><dd>30 saniye ileri / geri</dd>
              <dt>⌘ + ⌥ + Sağ / Sol Ok</dt><dd>5 dakika ileri / geri</dd>
              <dt>⌘ + G</dt><dd>Zaman koduna git</dd>
              <dt>⌘ + ↑ / ↓</dt><dd>Başa / sona git</dd>
              <dt>Shift + Delete</dt><dd>Sondan 30 sn önceye git</dd>
              <dt>⌘ + Shift + Delete</dt><dd>Ortaya git</dd>
              <dt>⌘ + Shift + F</dt><dd>İnce ayar süresini değiştir</dd>
              <dt>⌥ + Yukarı / Aşağı Ok</dt><dd>Hassasiyet ayarı</dd>
              <dt>⌥ + Sağ / Sol Ok</dt><dd>İşaretçiler arası gezinme</dd>
            </dl>
          </section>
          <section>
            <h3>▶️ Oynatma</h3>
            <dl>
              <dt>Space</dt><dd>Oynat / duraklat (dönüşlü)</dd>
              <dt>K</dt><dd>Duraklat (dönüşsüz)</dd>
              <dt>Return</dt><dd>Duraklat ve konumla</dd>
              <dt>Shift + Space</dt><dd>Seçili alanı oynat</dd>
              <dt>Fn + ↓ / ↑</dt><dd>5 saniye ileri / geri</dd>
              <dt>⌘ + Shift + J</dt><dd>Sessizliği atla</dd>
            </dl>
          </section>
          <section>
            <h3>📍 İşaretçiler & Seçim</h3>
            <dl>
                <dt>M</dt><dd>İşaretçi ekle</dd>
                <dt>Shift + Sağ / Sol</dt><dd>1 saniyelik seçim</dd>
                <dt>⌘ + Shift + Sağ / Sol</dt><dd>İşaretçiler arası seçim</dd>
                <dt>CTRL + Shift + ← / →</dt><dd>İmleçten işaretçiye</dd>
                <dt>⌘ + Shift + ↑ / ↓</dt><dd>İmleçten başa / sona</dd>
                <dt>⌘ + R</dt><dd>Aralık seç</dd>
                <dt>⌘ + A</dt><dd>Tümünü seç</dd>
            </dl>
          </section>
          <section>
            <h3>📁 Dosya & Düzen</h3>
            <dl>
                <dt>⌘ + O / ⌘ + S</dt><dd>Aç / Kaydet</dd>
                <dt>⌘ + W</dt><dd>Kapat</dd>
                <dt>CTRL + Tab</dt><dd>Sekmeler arası geçiş</dd>
                <dt>⌘ + Z / ⌘ + Shift + Z</dt><dd>Geri Al / Yinele</dd>
                <dt>⌘ + X / C / V</dt><dd>Kes / Kopyala / Yapıştır</dd>
                <dt>⌘ + D</dt><dd>Sil</dd>
            </dl>
          </section>
          <section>
             <h3>🤖 Yapay Zeka & Diğer</h3>
             <dl>
                 <dt>Option + ⌘ + V</dt><dd>Konumu betimle</dd>
                 <dt>Option + ⌘ + D</dt><dd>Seçimi betimle</dd>
                 <dt>⌘ + I</dt><dd>Akıllı seçim</dd>
                 <dt>F1 / F2</dt><dd>Kısayollar / Yardım</dd>
                 <dt>Ctrl + Tık / ⌘ + .</dt><dd>Sağ tık menüsü</dd>
             </dl>
          </section>
        `;
    },

    /**
     * Klavye kısayolları diyaloğunu göster
     */
    showShortcutsDialog() {
        const isMac = navigator.userAgent.includes('Mac');
        if (isMac) {
            this.renderMacShortcuts();
        }
        this.shortcutsDialog.showModal();
        Accessibility.announce(this.t('runtime.dialogs.shortcuts_opened', 'Keyboard shortcuts dialog opened'));
    },

    /**
     * Liste öğeleri için bağlam menüsü (sağ tık) desteği ekler
     * @param {HTMLElement} listElement - Liste elementi (ul/ol)
     * @param {string} type - Menü tipi ('insertion', 'silence', 'transition')
     */
    setupListContextMenu(listElement, itemType) {
        if (!listElement) return;

        listElement.addEventListener('contextmenu', (e) => {
            // Sadece liste öğesi üzerindeyken çalışsın
            const item = e.target.closest('li');
            if (!item || !listElement.contains(item)) return;

            e.preventDefault();
            e.stopPropagation();

            // Öğeyi seçili hale getir (görsel geri bildirim için)
            item.click();
            item.focus();

            const id = item.dataset.id || item.dataset.index;
            // id 0 olabilir, undefined kontrolü yap
            if (id === undefined || id === null) return;

            let template = [];

            if (itemType === 'insertion') {
                const queueItem = InsertionQueue.getItem(parseInt(id));
                if (queueItem && (queueItem.type === 'transition' || queueItem.type === 'overlay')) {
                    template = [
                        { label: 'Sil', click: 'delete-insertion', id: parseInt(id) },
                        { label: '1 saniye ileri', click: 'move-forward-insertion', id: parseInt(id) },
                        { label: '1 saniye geri', click: 'move-backward-insertion', id: parseInt(id) }
                    ];
                } else if (queueItem && queueItem.type === 'object') {
                    template = [
                        { label: 'Sil', click: 'delete-insertion', id: parseInt(id) }
                    ];
                } else {
                    template = [
                        { label: 'Düzenle', click: 'edit-insertion', id: parseInt(id) },
                        { label: 'Sil', click: 'delete-insertion', id: parseInt(id) }
                    ];
                }
            } else if (itemType === 'silence') {
                const idx = parseInt(item.dataset.index); // index kullan
                template = [
                    { label: 'Oynat', click: 'play-silence', index: idx },
                    { label: 'Kesim Önizle', click: 'preview-silence-cut', index: idx },
                    { label: 'Sil', click: 'delete-silence', index: idx }
                ];
            } else if (itemType === 'transition') {
                template = [
                    { label: 'Git', click: 'goto-transition', id: id },
                    { label: 'Sil', click: 'delete-transition', id: id }
                ];
            } else if (itemType === 'keyboard-shortcut') {
                const actionId = item.dataset.id;
                template = [
                    { label: 'Yeni Kısayol Ekle', click: 'edit-shortcut', id: actionId },
                    { label: 'Geçerli Kısayolu Sil', click: 'delete-shortcut', id: actionId },
                    { label: 'Varsayılan Temizle', click: 'reset-shortcut', id: actionId }
                ];


            }

            if (template.length > 0) {
                // Native menu yerine Custom HTML menu kullan
                // window.api.showContextMenu(template);
                this.showCustomContextMenu(e.clientX, e.clientY, template, listElement.closest('dialog'), item);
            }
        });
    },


    showCustomContextMenu(x, y, template, containerDialog, triggerItem) {
        // Varsa eskileri temizle
        const oldMenu = document.querySelector('.custom-context-menu');
        if (oldMenu) oldMenu.remove();

        const menu = document.createElement('div');
        menu.className = 'custom-context-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('tabindex', '-1');

        // Stil
        Object.assign(menu.style, {
            position: 'fixed',
            top: `${y}px`,
            left: `${x}px`,
            backgroundColor: '#2d2d2d',
            border: '1px solid #444',
            boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
            padding: '5px 0',
            zIndex: '10000',
            borderRadius: '4px',
            minWidth: '150px'
        });

        template.forEach((t, index) => {
            const btn = document.createElement('button');
            btn.textContent = t.label;
            btn.setAttribute('role', 'menuitem');
            btn.setAttribute('tabindex', '-1');
            btn.className = 'context-menu-item';
            Object.assign(btn.style, {
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 15px',
                background: 'none',
                border: 'none',
                color: '#eee',
                cursor: 'pointer',
                fontSize: '14px'
            });

            // Hover efekti
            btn.addEventListener('mouseenter', () => {
                btn.style.backgroundColor = '#3d3d3d';
                btn.focus();
            });
            btn.addEventListener('mouseleave', () => btn.style.backgroundColor = 'transparent');
            btn.addEventListener('focus', () => btn.style.backgroundColor = '#3d3d3d');
            btn.addEventListener('blur', () => btn.style.backgroundColor = 'transparent');

            // Tıklama
            btn.addEventListener('click', () => {
                this.handleContextMenuCommand({ action: t.click, id: t.id, index: t.index });
                menu.remove();
                if (triggerItem) triggerItem.focus();
            });

            // Klavye
            btn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    btn.click();
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const next = btn.nextElementSibling || menu.firstElementChild;
                    next.focus();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prev = btn.previousElementSibling || menu.lastElementChild;
                    prev.focus();
                } else if (e.key === 'ArrowLeft' || e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation(); // Diyalog kapanmasın
                    menu.remove();
                    if (triggerItem) triggerItem.focus();
                    Accessibility.announce('Menü kapatıldı');
                } else if (e.key === 'Tab') {
                    // Tab ile menüden çıkılırsa kapat
                    menu.remove();
                }
            });

            menu.appendChild(btn);
        });

        // Menüyü ekle (Dialog varsa içine yoksa body'e)
        // Dialog açıksa onun içine eklemek z-index ve focus trap açısından daha güvenli olabilir
        // Ancak fixed position kullanıyoruz, body de olabilir ama dialog 'modal' ise body'e erişim kısıtlı olabilir.
        if (containerDialog && containerDialog.open) {
            containerDialog.appendChild(menu);
        } else {
            document.body.appendChild(menu);
        }

        // İlk öğeye odaklan
        const first = menu.firstElementChild;
        if (first) setTimeout(() => first.focus(), 50);

        // Dışarı tıklama ile kapatma
        const outsideClickListener = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', outsideClickListener);
            }
        };
        // Timeout to avoid immediate trigger
        setTimeout(() => document.addEventListener('click', outsideClickListener), 10);

        Accessibility.announce('Bağlam menüsü açıldı. Yön tuşları ile gezinin.');
    },

    /**
     * Bağlam menüsü komutlarını işler
     * @param {Object} data - { action, id, index }
     */
    async handleContextMenuCommand(data) {
        console.log('Context Menu Command:', data);
        const { action, id, index } = data;

        // Insertion Queue
        if (action === 'edit-insertion') {
            const item = InsertionQueue.getItem(id);
            if (item) {
                // Not: Diyaloğu kapatmak kullanıcının akışını bozabilir, açık kalsın mı?
                // Text dialog modal olduğu için bunu kapatmak gerekebilir.
                // this.insertionQueueDialog.close(); 
                // Diyaloğu kapatmadan açabiliyorsak açalım, ama showModal iç içe sorun olabilir.
                this.insertionQueueDialog.close();
                await window.api.openTextOverlayDialog({
                    startTime: VideoPlayer.getCurrentTime(),
                    editItem: item
                });
            }
        } else if (action === 'delete-insertion') {
            const item = InsertionQueue.getItem(id);
            if (item) {
                if (item.type === 'transition' && window.Transitions && item.options.id) {
                    window.Transitions.remove(item.options.id);
                } else if (item.type === 'overlay' && window.CtaOverlayPreview && item.options.timelineOverlayId) {
                    window.CtaOverlayPreview.removeOverlay(item.options.timelineOverlayId);
                }
            }
            InsertionQueue.removeItem(id);
            this.updateInsertionQueueList();
            Accessibility.announce('Öğe silindi');
        } else if (action === 'move-forward-insertion') {
            const item = InsertionQueue.getItem(id);
            if (item) {
                const current = (item.options.time !== undefined) ? item.options.time : (item.options.startTime || 0);
                const newStartTime = current + 1;
                InsertionQueue.updateItem(id, { time: newStartTime, startTime: newStartTime });

                // Senkronizasyon
                if (item.type === 'transition' && window.Transitions && item.options.id) {
                    const trans = window.Transitions.getAppliedTransitions().find(t => t.id === item.options.id);
                    if (trans) {
                        trans.time = newStartTime;
                        if (window.Transitions.sortTransitions) window.Transitions.sortTransitions();
                        if (window.Transitions.onTransitionsListChanged) window.Transitions.onTransitionsListChanged(window.Transitions.appliedTransitions);
                    }
                }
                if (item.type === 'overlay' && window.CtaOverlayPreview && item.options.timelineOverlayId) {
                    const ov = window.CtaOverlayPreview.getTimelineOverlays().find(o => o.id === item.options.timelineOverlayId);
                    if (ov) {
                        const dur = ov.endTime - ov.startTime;
                        ov.startTime = newStartTime;
                        ov.endTime = newStartTime + dur;
                    }
                }

                this.updateInsertionQueueList();
                Accessibility.announce('Öğe 1 saniye ileri alındı');
            }
        } else if (action === 'move-backward-insertion') {
            const item = InsertionQueue.getItem(id);
            if (item) {
                const current = (item.options.time !== undefined) ? item.options.time : (item.options.startTime || 0);
                const newStartTime = current >= 1 ? current - 1 : 0;
                InsertionQueue.updateItem(id, { time: newStartTime, startTime: newStartTime });

                // Senkronizasyon
                if (item.type === 'transition' && window.Transitions && item.options.id) {
                    const trans = window.Transitions.getAppliedTransitions().find(t => t.id === item.options.id);
                    if (trans) {
                        trans.time = newStartTime;
                        if (window.Transitions.sortTransitions) window.Transitions.sortTransitions();
                        if (window.Transitions.onTransitionsListChanged) window.Transitions.onTransitionsListChanged(window.Transitions.appliedTransitions);
                    }
                }
                if (item.type === 'overlay' && window.CtaOverlayPreview && item.options.timelineOverlayId) {
                    const ov = window.CtaOverlayPreview.getTimelineOverlays().find(o => o.id === item.options.timelineOverlayId);
                    if (ov) {
                        const dur = ov.endTime - ov.startTime;
                        ov.startTime = newStartTime;
                        ov.endTime = newStartTime + dur;
                    }
                }

                this.updateInsertionQueueList();
                Accessibility.announce('Öğe 1 saniye geri alındı');
            }
        }

        // Silence List
        else if (action === 'play-silence') {
            // Diyalog açıkken oynatma çalışmayabilir (VideoPlayer engelliyor olabilir)
            // Ama oynatma butonları çalışıyor
            this.selectSilence(index);
            this.playSelectedSilence();
        } else if (action === 'preview-silence-cut') {
            this.selectSilence(index);
            this.previewSilenceCut();
        } else if (action === 'delete-silence') {
            this.selectSilence(index);
            this.deleteSelectedSilence();
        }

        // Transition List
        else if (action === 'goto-transition') {
            const transitions = Transitions.getAppliedTransitions();
            const transition = transitions.find(t => t.id === id);
            if (transition) {
                VideoPlayer.seekTo(transition.startTime);
            }
        } else if (action === 'delete-transition') {
            Transitions.remove(id);
            this.updateTransitionList();
            Accessibility.announce('Geçiş silindi');
        }

        // Keyboard Manager
        else if (action === 'edit-shortcut') {
            this.startListeningForShortcut(id);
        } else if (action === 'delete-shortcut') {
            if (confirm('Bu kısayolu silmek istediğinize emin misiniz?')) {
                this.tempKeymap[id] = ""; // Boş string = disabled
                this.populateKeyboardShortcuts(Keyboard.ACTIONS[id].category);
                Accessibility.announce('Kısayol silindi');
            }
        } else if (action === 'reset-shortcut') {
            if (confirm('Bu kısayolu varsayılana döndürmek istediğinize emin misiniz?')) {
                delete this.tempKeymap[id]; // Override kaldır
                this.populateKeyboardShortcuts(Keyboard.ACTIONS[id].category);
                Accessibility.announce('Kısayol varsayılana döndürüldü');
            }
        }
    },

    /**
     * AI diyaloğunu göster
     */
    showAIDialog() {
        if (!Selection.hasSelection()) {
            Accessibility.alert(this.t('runtime.dialogs.select_area_before_ai', 'You must select an area first.'));
            return;
        }

        document.getElementById('ai-analysis-status').classList.remove('hidden');
        document.getElementById('ai-result').classList.add('hidden');
        document.getElementById('ai-accept').classList.add('hidden');
        document.getElementById('ai-question').value = '';
        document.getElementById('ai-answer').classList.add('hidden');

        this.aiDialog.showModal();
        Accessibility.announce(this.t('runtime.dialogs.ai_selection_check_opened', 'Intelligent selection check dialog opened. Analysis is running.'));

        // AI analizini başlat
        this.startAIAnalysis();
    },

    /**
     * AI analizini başlat
     */
    async startAIAnalysis() {
        const selection = Selection.getSelection();
        if (!selection) return;

        // Simülasyon: Gerçek AI entegrasyonu için Gemini Vision API kullanılacak
        setTimeout(() => {
            const suggestion = this.generateMockAISuggestion(selection);

            document.getElementById('ai-analysis-status').classList.add('hidden');
            document.getElementById('ai-result').classList.remove('hidden');
            document.getElementById('ai-suggestion').textContent = suggestion.text;
            document.getElementById('ai-accept').classList.remove('hidden');

            // Öneriyi sakla
            this.aiSuggestion = suggestion;

            Accessibility.announce(this.t('runtime.dialogs.mock_ai_analysis_complete', 'AI analysis completed: {text}', { text: suggestion.text }));
        }, 2000);
    },

    /**
     * Mock AI önerisi oluştur (gerçek implementasyon için Gemini API kullanılacak)
     */
    generateMockAISuggestion(selection) {
        const options = [
            {
                text: this.t('runtime.dialogs.mock_ai_suggestion_start', 'I recommend moving the selection start back by 0.5 seconds. This creates a more natural transition.'),
                adjustStart: -0.5,
                adjustEnd: 0
            },
            {
                text: this.t('runtime.dialogs.mock_ai_suggestion_end', 'I recommend moving the selection end forward by 1 second. The scene ends more cleanly there.'),
                adjustStart: 0,
                adjustEnd: 1
            },
            {
                text: this.t('runtime.dialogs.mock_ai_suggestion_ok', 'The selection looks appropriate. The current boundaries align with clean transition points.'),
                adjustStart: 0,
                adjustEnd: 0
            }
        ];

        return options[Math.floor(Math.random() * options.length)];
    },

    /**
     * AI sorusu sor
     */
    async askAI(question) {
        const answerEl = document.getElementById('ai-answer');
        answerEl.classList.remove('hidden');
        answerEl.textContent = this.t('runtime.dialogs.mock_ai_answer_waiting', 'Waiting for response...');

        // Mock yanıt (gerçek implementasyon için Gemini API)
        setTimeout(() => {
            const answers = [
                this.t('runtime.dialogs.mock_ai_answer_yes', 'Yes, this point looks like a clean scene transition.'),
                this.t('runtime.dialogs.mock_ai_answer_motion', 'There is motion in this section, so it may not be ideal for a cut.'),
                this.t('runtime.dialogs.mock_ai_answer_better_end', 'The frame at the end of the selection may be a better cut point.')
            ];

            const answer = answers[Math.floor(Math.random() * answers.length)];
            answerEl.textContent = answer;
            Accessibility.announce(this.t('runtime.dialogs.mock_ai_answer_announce', 'AI response: {answer}', { answer }));
        }, 1500);
    },

    /**
     * AI önerisini kabul et
     */
    acceptAISuggestion() {
        if (!this.aiSuggestion) return;

        const selection = Selection.getSelection();
        if (!selection) return;

        const newStart = selection.start + (this.aiSuggestion.adjustStart || 0);
        const newEnd = selection.end + (this.aiSuggestion.adjustEnd || 0);

        Selection.setSelection(newStart, newEnd);
        Accessibility.announce(this.t('runtime.dialogs.mock_ai_suggestion_applied', 'AI suggestion applied.'));
    },

    /**
     * Video özellikleri diyaloğunu göster
     */
    showVideoPropertiesDialog() {
        if (!VideoPlayer.hasVideo()) {
            Accessibility.alert('Önce bir video açmalısınız');
            return;
        }

        // Özgün özellikleri kaydet
        this.originalVideoProps = VideoPlayer.metadata;
        this.videoDuration = VideoPlayer.getDuration();

        // Özgün bilgileri göster
        const infoEl = document.getElementById('prop-original-info');
        if (infoEl && this.originalVideoProps) {
            infoEl.textContent = `${this.originalVideoProps.width}x${this.originalVideoProps.height}, ` +
                `${Math.round(this.originalVideoProps.frameRate)} fps, ` +
                `${this.originalVideoProps.codec}, ` +
                `${Utils.formatFileSize(this.originalVideoProps.size)}`;
        }

        // Varsayılan değerleri ayarla
        document.getElementById('prop-resolution').value = 'original';
        document.getElementById('prop-fps').value = 'original';
        document.getElementById('prop-codec').value = 'original';
        document.getElementById('prop-quality-preset').value = 'medium';
        document.getElementById('custom-resolution-group').classList.add('hidden');
        document.getElementById('custom-bitrate-group').classList.add('hidden');

        // Özel çözünürlük alanlarını doldur
        if (this.originalVideoProps) {
            document.getElementById('prop-width').value = this.originalVideoProps.width;
            document.getElementById('prop-height').value = this.originalVideoProps.height;
        }

        // Tahmini boyutu hesapla
        this.updateEstimatedSize();

        // Event listener'ları kur
        this.setupVideoPropertiesListeners();

        this.videoPropertiesDialog.showModal();
        Accessibility.announce('Video özellikleri diyaloğu açıldı');
    },

    /**
     * Video özellikleri event listener'larını kur
     */
    setupVideoPropertiesListeners() {
        const resolutionSelect = document.getElementById('prop-resolution');
        const qualityPreset = document.getElementById('prop-quality-preset');

        // Çözünürlük değiştiğinde
        resolutionSelect.onchange = () => {
            const customGroup = document.getElementById('custom-resolution-group');
            customGroup.classList.toggle('hidden', resolutionSelect.value !== 'custom');
            this.updateEstimatedSize();
        };

        // Kalite preset değiştiğinde
        qualityPreset.onchange = () => {
            const customGroup = document.getElementById('custom-bitrate-group');
            customGroup.classList.toggle('hidden', qualityPreset.value !== 'custom');
            this.updateEstimatedSize();
        };

        // Diğer değişiklikler için boyut güncelleme
        document.getElementById('prop-fps').onchange = () => this.updateEstimatedSize();
        document.getElementById('prop-codec').onchange = () => this.updateEstimatedSize();
        document.getElementById('prop-width').onchange = () => this.updateEstimatedSize();
        document.getElementById('prop-height').onchange = () => this.updateEstimatedSize();
        document.getElementById('prop-bitrate').onchange = () => this.updateEstimatedSize();

        // Kaydet butonu
        document.getElementById('video-props-save').onclick = async () => {
            await this.saveVideoWithProperties();
        };

        // İptal butonu
        document.getElementById('video-props-cancel').onclick = () => {
            this.videoPropertiesDialog.close();
        };
    },

    /**
     * Tahmini dosya boyutunu hesapla ve göster
     * Orijinal dosya boyutunu referans alarak daha doğru tahmin yapar
     */
    updateEstimatedSize() {
        const qualityPreset = document.getElementById('prop-quality-preset').value;
        const resolutionValue = document.getElementById('prop-resolution').value;

        // Çözünürlük faktörünü hesapla
        let targetPixels;
        if (resolutionValue === 'original' && this.originalVideoProps) {
            targetPixels = this.originalVideoProps.width * this.originalVideoProps.height;
        } else if (resolutionValue === 'custom') {
            const w = parseInt(document.getElementById('prop-width').value) || 1920;
            const h = parseInt(document.getElementById('prop-height').value) || 1080;
            targetPixels = w * h;
        } else if (resolutionValue !== 'original') {
            const [w, h] = resolutionValue.split('x').map(Number);
            targetPixels = w * h;
        } else {
            targetPixels = 1920 * 1080; // Varsayılan
        }

        // Orijinal video piksel sayısı
        const originalPixels = this.originalVideoProps ?
            (this.originalVideoProps.width * this.originalVideoProps.height) : (1920 * 1080);

        // Çözünürlük oranı
        const resolutionRatio = targetPixels / originalPixels;

        // Kalite presetine göre CRF benzeri bir çarpan
        const qualityMultiplier = {
            'low': 0.3,
            'medium': 0.5,
            'high': 0.8,
            'veryhigh': 1.2
        };

        let multiplier;
        if (qualityPreset === 'custom') {
            const customBitrate = parseFloat(document.getElementById('prop-bitrate').value) || 5;
            multiplier = customBitrate / 10;
        } else {
            multiplier = qualityMultiplier[qualityPreset] || 0.5;
        }

        // Codec'e göre verimlilik faktörü
        const codec = document.getElementById('prop-codec').value;
        const codecEfficiency = {
            'original': 1.0,
            'h264': 1.0,
            'h265': 0.6,
            'vp9': 0.65,
            'av1': 0.5,
            'prores': 3.0
        };
        const efficiency = codecEfficiency[codec] || 1.0;

        // Orijinal dosya boyutunu referans al
        const originalSize = this.originalVideoProps?.size || 0;

        if (originalSize > 0) {
            // Orijinal boyutu referans alarak hesapla
            const estimatedBytes = originalSize * resolutionRatio * multiplier * efficiency;
            document.getElementById('prop-estimated-size').value = Utils.formatFileSize(Math.max(estimatedBytes, 1024));
        } else {
            // Basit formül
            const baseBitrateMbps = multiplier * 10;
            const estimatedMB = (baseBitrateMbps * this.videoDuration * efficiency) / 8;
            const estimatedBytes = estimatedMB * 1024 * 1024;
            document.getElementById('prop-estimated-size').value = Utils.formatFileSize(Math.max(estimatedBytes, 1024));
        }
    },

    /**
     * Video'yu yeni özelliklerle kaydet
     */
    async saveVideoWithProperties() {
        // Seçenekleri topla
        const resolutionValue = document.getElementById('prop-resolution').value;
        let width, height;

        if (resolutionValue === 'original') {
            width = null;
            height = null;
        } else if (resolutionValue === 'custom') {
            width = parseInt(document.getElementById('prop-width').value);
            height = parseInt(document.getElementById('prop-height').value);
        } else {
            const [w, h] = resolutionValue.split('x').map(Number);
            width = w;
            height = h;
        }

        const fps = document.getElementById('prop-fps').value;
        const codec = document.getElementById('prop-codec').value;

        const qualityPreset = document.getElementById('prop-quality-preset').value;
        let bitrate;
        const bitrateMap = { 'low': 2000, 'medium': 5000, 'high': 10000, 'veryhigh': 20000 };

        if (qualityPreset === 'custom') {
            bitrate = parseFloat(document.getElementById('prop-bitrate').value) * 1000;
        } else {
            bitrate = bitrateMap[qualityPreset] || 5000;
        }

        const options = {
            width,
            height,
            fps: fps === 'original' ? null : fps,
            codec: codec === 'original' ? null : codec,
            bitrate
        };

        // Dosya kaydetme diyaloğu
        const result = await window.api.showSaveDialog({
            title: this.t('dialog.video_properties.save_as_title', 'Save Video As'),
            defaultPath: this.t('dialog.video_properties.default_save_name', 'converted_video.mp4'),
            filters: [
                { name: 'MP4 Video', extensions: ['mp4'] },
                { name: 'WebM Video', extensions: ['webm'] },
                { name: 'MOV Video', extensions: ['mov'] }
            ]
        });

        if (!result || result.canceled || !result.filePath) {
            return;
        }

        let outputPath = result.filePath;
        if (!/\.[a-z0-9]+$/i.test(outputPath)) {
            outputPath += '.mp4';
        }

        this.videoPropertiesDialog.close();
        App.showProgress(this.t('dialog.video_properties.converting_progress', 'Converting video'));

        try {
            const convertResult = await window.api.convertVideo({
                inputPath: VideoPlayer.currentFilePath,
                outputPath,
                options
            });

            App.hideProgress();

            if (convertResult.success) {
                Accessibility.announce(this.t('dialog.video_properties.convert_success', 'Video was converted successfully'));
            } else {
                Accessibility.alert(this.t('dialog.video_properties.convert_error', 'Conversion error: {error}', {
                    error: convertResult.error
                }));
            }
        } catch (error) {
            App.hideProgress();
            Accessibility.alert(this.t('dialog.video_properties.convert_error', 'Conversion error: {error}', {
                error: error.message
            }));
        }
    },

    /**
     * Video uyuşmazlığı diyaloğunu göster
     * @param {Object} sourceProps - Kaynak videonun özellikleri
     * @param {Object} insertProps - Eklenecek videonun özellikleri
     * @returns {Promise<string>} 'convert' | 'as-is' | 'cancel'
     */
    showVideoMismatchDialog(sourceProps, insertProps) {
        return new Promise((resolve) => {
            // Bilgileri göster
            document.getElementById('mismatch-source-info').textContent =
                `${sourceProps.width}x${sourceProps.height}, ${Math.round(sourceProps.frameRate)} fps, ${sourceProps.codec}`;
            document.getElementById('mismatch-insert-info').textContent =
                `${insertProps.width}x${insertProps.height}, ${Math.round(insertProps.frameRate)} fps, ${insertProps.codec}`;

            // Buton event listeners
            const convertBtn = document.getElementById('mismatch-convert');
            const asIsBtn = document.getElementById('mismatch-as-is');
            const cancelBtn = document.getElementById('mismatch-cancel');

            const cleanup = () => {
                convertBtn.onclick = null;
                asIsBtn.onclick = null;
                cancelBtn.onclick = null;
                this.videoMismatchDialog.close();
            };

            convertBtn.onclick = () => {
                cleanup();
                resolve('convert');
            };

            asIsBtn.onclick = () => {
                cleanup();
                resolve('as-is');
            };

            cancelBtn.onclick = () => {
                cleanup();
                resolve('cancel');
            };

            this.videoMismatchDialog.showModal();
            Accessibility.announce('Video özellikleri uyuşmuyor diyaloğu açıldı');
        });
    },

    /**
     * Yazı ekleme diyaloğunu göster
     */
    async showTextOverlayDialog() {
        if (!this.textOverlayDialog) {
            console.error('Text overlay dialog bulunamadı');
            return;
        }

        window.i18nHelper?.translateDOM();

        // Alanları sıfırla
        document.getElementById('text-overlay-content').value = '';
        document.getElementById('text-overlay-font').value = 'arial';
        document.getElementById('text-overlay-size').value = '48';
        document.getElementById('text-overlay-color').value = 'white';
        document.getElementById('text-overlay-bg').value = 'none';
        document.getElementById('text-overlay-position').value = 'bottom';
        document.getElementById('text-overlay-transition').value = 'none';
        document.getElementById('text-overlay-duration').value = '5';
        document.getElementById('text-overlay-whole-video').checked = false;
        document.getElementById('text-overlay-duration').disabled = false;

        // TTS alanlarını sıfırla
        document.getElementById('text-overlay-tts-enable').checked = false;
        document.getElementById('tts-options').style.display = 'none';
        const textTtsServiceSelect = document.getElementById('text-overlay-tts-service');
        if (textTtsServiceSelect) textTtsServiceSelect.value = 'system';
        document.getElementById('text-overlay-tts-speed').value = '100';
        document.getElementById('text-overlay-tts-speed-value').textContent = '%100';
        document.getElementById('text-overlay-tts-volume').value = '100';
        document.getElementById('text-overlay-tts-volume-value').textContent = '%100';
        document.getElementById('text-overlay-video-volume').value = '100';
        document.getElementById('text-overlay-video-volume-value').textContent = '%100';

        // TTS seslerini yükle
        try {
            const result = await window.api.getTtsVoices({ service: textTtsServiceSelect?.value || 'system' });
            if (result.success && result.voices) {
                const voiceSelect = document.getElementById('text-overlay-tts-voice');
                voiceSelect.innerHTML = `<option value="">${this.t('dialog.text_overlay.default', 'Default')}</option>`;
                result.voices.forEach(voice => {
                    const voiceId = typeof voice === 'string' ? voice : voice?.id;
                    const voiceName = typeof voice === 'string' ? voice : voice?.name;
                    if (!voiceId || !voiceName) return;
                    const option = document.createElement('option');
                    option.value = voiceId;
                    option.textContent = voiceName;
                    voiceSelect.appendChild(option);
                });
            }
        } catch (error) {
            console.error('TTS sesleri yüklenemedi:', error);
        }

        this.textOverlayDialog.showModal();
        document.getElementById('text-overlay-content').focus();
        Accessibility.announce(this.t('runtime.dialogs.text_overlay_dialog_opened', 'Text overlay dialog opened.'));
    },

    /**
     * Yazı ekleme event listener'larını kur
     */
    setupTextOverlayEventListeners() {
        // Tüm video boyunca checkbox
        const wholeVideoCheckbox = document.getElementById('text-overlay-whole-video');
        const durationInput = document.getElementById('text-overlay-duration');
        const dialog = document.getElementById('text-overlay-dialog');

        // Diyalog seviyesinde Alt+P kısayolu
        dialog?.addEventListener('keydown', (e) => {
            if (e.altKey && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                e.stopPropagation();
                this.toggleTextPreview();
            }
        });

        wholeVideoCheckbox?.addEventListener('change', () => {
            durationInput.disabled = wholeVideoCheckbox.checked;
            if (wholeVideoCheckbox.checked) {
                Accessibility.announce(this.t('runtime.dialogs.text_overlay_whole_video_enabled', 'Text will be shown for the whole video.'));
            }
        });

        // Ön izle düğmesi
        document.getElementById('text-overlay-preview')?.addEventListener('click', () => {
            this.toggleTextPreview();
        });

        // TTS checkbox toggle
        const ttsEnableCheckbox = document.getElementById('text-overlay-tts-enable');
        const ttsOptions = document.getElementById('tts-options');
        const ttsServiceSelect = document.getElementById('text-overlay-tts-service');

        ttsEnableCheckbox?.addEventListener('change', () => {
            ttsOptions.style.display = ttsEnableCheckbox.checked ? 'block' : 'none';
            if (ttsEnableCheckbox.checked) {
                Accessibility.announce('Seslendirme seçenekleri açıldı');
            }
        });

        ttsServiceSelect?.addEventListener('change', async () => {
            try {
                const result = await window.api.getTtsVoices({ service: ttsServiceSelect.value || 'system' });
                const voiceSelect = document.getElementById('text-overlay-tts-voice');
                voiceSelect.innerHTML = `<option value="">${this.t('dialog.text_overlay.default', 'Default')}</option>`;
                if (result.success) {
                    (result.voices || []).forEach((voice) => {
                        const voiceId = typeof voice === 'string' ? voice : voice?.id;
                        const voiceName = typeof voice === 'string' ? voice : voice?.name;
                        if (!voiceId || !voiceName) return;
                        const option = document.createElement('option');
                        option.value = voiceId;
                        option.textContent = voiceName;
                        voiceSelect.appendChild(option);
                    });
                }
            } catch (error) {
                console.error('TTS sesleri yüklenemedi:', error);
            }
        });

        // TTS slider'lar için input event listener'ları
        const ttsSpeedSlider = document.getElementById('text-overlay-tts-speed');
        const ttsVolumeSlider = document.getElementById('text-overlay-tts-volume');
        const videoVolumeSlider = document.getElementById('text-overlay-video-volume');

        ttsSpeedSlider?.addEventListener('input', () => {
            document.getElementById('text-overlay-tts-speed-value').textContent = `%${ttsSpeedSlider.value}`;
        });

        ttsVolumeSlider?.addEventListener('input', () => {
            document.getElementById('text-overlay-tts-volume-value').textContent = `%${ttsVolumeSlider.value}`;
        });

        videoVolumeSlider?.addEventListener('input', () => {
            document.getElementById('text-overlay-video-volume-value').textContent = `%${videoVolumeSlider.value}`;
        });

        // Tamam düğmesi
        document.getElementById('text-overlay-confirm')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.stopTextPreview(); // Önce preview'ı durdur

            const text = document.getElementById('text-overlay-content').value.trim();
            if (!text) {
                Accessibility.announce('Lütfen bir metin girin');
                document.getElementById('text-overlay-content').focus();
                return;
            }

            const options = {
                text: text,
                font: document.getElementById('text-overlay-font').value,
                fontSize: parseInt(document.getElementById('text-overlay-size').value),
                fontColor: document.getElementById('text-overlay-color').value,
                background: document.getElementById('text-overlay-bg').value,
                position: document.getElementById('text-overlay-position').value,
                customX: parseInt(document.getElementById('posX')?.value) || 0,
                customY: parseInt(document.getElementById('posY')?.value) || 0,
                transition: document.getElementById('text-overlay-transition').value,
                duration: wholeVideoCheckbox.checked ? 'whole' : parseInt(durationInput.value),
                startTime: VideoPlayer.getCurrentTime(),
                // TTS seçenekleri
                ttsEnabled: ttsEnableCheckbox.checked,
                ttsService: document.getElementById('text-overlay-tts-service')?.value || 'system',
                ttsVoice: document.getElementById('text-overlay-tts-voice').value || null,
                ttsSpeed: parseInt(ttsSpeedSlider.value) / 100, // 100% = 1.0
                ttsVolume: parseInt(ttsVolumeSlider.value) / 100,
                videoVolume: parseInt(videoVolumeSlider.value) / 100
            };

            this.textOverlayDialog.close();
            App.addTextToVideo(options);
        });

        // İptal düğmesi
        document.getElementById('text-overlay-cancel')?.addEventListener('click', () => {
            this.stopTextPreview();
            window.api.ttsStop(); // TTS preview'ı da durdur
            this.textOverlayDialog.close();
            Accessibility.announce('Yazı ekleme iptal edildi');
        });
    },

    /**
     * Yazı ön izlemesi toggle
     */
    toggleTextPreview() {
        if (this.isTextPreviewPlaying) {
            this.stopTextPreview();
            Accessibility.announce('Ön izleme duraklatıldı');
        } else {
            this.startTextPreview();
        }
    },

    /**
     * Yazı ön izlemesi başlat
     */
    async startTextPreview() {
        const wholeVideoCheckbox = document.getElementById('text-overlay-whole-video');
        const durationInput = document.getElementById('text-overlay-duration');
        const ttsEnableCheckbox = document.getElementById('text-overlay-tts-enable');

        // Süreyi hesapla
        const startTime = VideoPlayer.getCurrentTime();
        let previewDuration;

        if (wholeVideoCheckbox.checked) {
            previewDuration = VideoPlayer.getDuration() - startTime;
        } else {
            previewDuration = parseInt(durationInput.value) || 5;
        }

        // Preview timer'ını ayarla (süre bitince durdur)
        const endTime = startTime + previewDuration;

        VideoPlayer.play();
        this.isTextPreviewPlaying = true;

        // TTS etkinse, metni seslendir
        if (ttsEnableCheckbox.checked) {
            const text = document.getElementById('text-overlay-content').value.trim();
            if (text) {
                const ttsVoice = document.getElementById('text-overlay-tts-voice').value || null;
                const ttsService = document.getElementById('text-overlay-tts-service')?.value || 'system';
                const ttsSpeed = parseInt(document.getElementById('text-overlay-tts-speed').value) / 100;

                try {
                    const result = await window.api.previewTts({ text, service: ttsService, voice: ttsVoice, speed: ttsSpeed });
                    if (result?.audioPath) {
                        const audio = new Audio(`file:///${result.audioPath.replace(/\\/g, '/')}`);
                        await audio.play();
                    }
                } catch (error) {
                    console.error('TTS önizleme hatası:', error);
                }
            }
        }

        // Durma zamanını kontrol et
        this.textPreviewInterval = setInterval(() => {
            if (VideoPlayer.getCurrentTime() >= endTime) {
                this.stopTextPreview();
                Accessibility.announce('Ön izleme tamamlandı');
            }
        }, 100);

        Accessibility.announce(`Ön izleme başlatıldı. ${previewDuration} saniye`);
    },

    /**
     * Yazı ön izlemesini durdur
     */
    stopTextPreview() {
        if (this.textPreviewInterval) {
            clearInterval(this.textPreviewInterval);
            this.textPreviewInterval = null;
        }
        VideoPlayer.pause();
        window.api.ttsStop(); // TTS'i de durdur
        this.isTextPreviewPlaying = false;
    },

    /**
     * Ekleme listesi diyaloğunu göster
     */
    showInsertionQueueDialog() {
        const dialog = document.getElementById('insertion-queue-dialog');
        if (!dialog) {
            console.error('Ekleme listesi diyaloğu bulunamadı');
            return;
        }

        this.updateInsertionQueueList();
        this.setupInsertionQueueEventListeners();
        dialog.showModal();

        // Erişilebilirlik: Liste özeti ve klavye kullanım talimatları
        const summary = InsertionQueue.getSummary();
        const instructions = InsertionQueue.isEmpty()
            ? ''
            : ' Listedeki bir öğeyi düzenlemek için sağ oka basın. Listeye geri dönmek için sol oka basın.';
        Accessibility.announce(`Ekleme listesi açıldı. ${summary}.${instructions}`);
    },

    showSelectionQueueDialog() {
        const dialog = this.selectionQueueDialog || document.getElementById('selection-queue-dialog');
        if (!dialog) {
            console.error('Seçim listesi diyaloğu bulunamadı');
            return;
        }

        this.updateSelectionQueueList();
        dialog.showModal();

        setTimeout(() => {
            const target = document.querySelector('#selection-queue-list [data-index="0"]')
                || document.getElementById('selection-queue-close');
            target?.focus?.();
        }, 40);

        const count = Array.isArray(window.App?.verticalClipQueue) ? window.App.verticalClipQueue.length : 0;
        Accessibility.announce(count > 0
            ? this.t('runtime.selection_queue.opened', 'Seçim listesi açıldı. Toplam {count} öğe var.', { count: String(count) })
            : this.t('runtime.selection_queue.empty', 'Seçim listesi şu anda boş.'));
    },

    updateSelectionQueueList() {
        const list = document.getElementById('selection-queue-list');
        const emptyBox = document.getElementById('selection-queue-empty');
        const contentBox = document.getElementById('selection-queue-content');
        const previewBtn = document.getElementById('selection-queue-preview');
        const removeBtn = document.getElementById('selection-queue-remove');
        const moveUpBtn = document.getElementById('selection-queue-move-up');
        const moveDownBtn = document.getElementById('selection-queue-move-down');
        const mergeBtn = document.getElementById('selection-queue-merge');
        const verticalBtn = document.getElementById('selection-queue-vertical');
        const clearBtn = document.getElementById('selection-queue-clear');

        if (!list) {
            return;
        }

        const items = Array.isArray(window.App?.verticalClipQueue) ? window.App.verticalClipQueue : [];
        const selectedIndex = Number.isInteger(this.selectionQueueSelectedIndex) ? this.selectionQueueSelectedIndex : -1;
        const safeSelectedIndex = (selectedIndex >= 0 && selectedIndex < items.length) ? selectedIndex : (items.length > 0 ? 0 : -1);
        this.selectionQueueSelectedIndex = safeSelectedIndex;

        if (emptyBox) emptyBox.hidden = items.length > 0;
        if (contentBox) contentBox.hidden = items.length === 0;

        list.innerHTML = '';

        items.forEach((item, index) => {
            const li = document.createElement('li');
            li.className = 'selection-queue-item insertion-queue-item';
            li.setAttribute('role', 'option');
            li.dataset.index = String(index);
            li.tabIndex = index === safeSelectedIndex ? 0 : -1;
            li.setAttribute('aria-selected', index === safeSelectedIndex ? 'true' : 'false');
            li.textContent = item.label || this.t('runtime.app.selection_item_label', 'Seçim {index}', {
                index: String(index + 1)
            });
            li.setAttribute('aria-label', this.t('dialog.selection_queue.item_aria', '{index}. öğe: {label}', {
                index: String(index + 1),
                label: li.textContent
            }));
            if (index === safeSelectedIndex) {
                li.classList.add('selected');
            }
            list.appendChild(li);
        });

        const hasSelection = safeSelectedIndex >= 0;
        if (previewBtn) previewBtn.disabled = !hasSelection;
        if (removeBtn) removeBtn.disabled = !hasSelection;
        if (moveUpBtn) moveUpBtn.disabled = !hasSelection || safeSelectedIndex <= 0;
        if (moveDownBtn) moveDownBtn.disabled = !hasSelection || safeSelectedIndex === items.length - 1;
        if (mergeBtn) mergeBtn.disabled = items.length === 0;
        if (verticalBtn) verticalBtn.disabled = items.length === 0;
        if (clearBtn) clearBtn.disabled = items.length === 0;
    },

    selectSelectionQueueIndex(index, shouldFocus = false) {
        this.selectionQueueSelectedIndex = index;
        this.updateSelectionQueueList();

        if (!shouldFocus) {
            return;
        }

        const list = document.getElementById('selection-queue-list');
        const item = list?.querySelector(`[data-index="${index}"]`);
        if (item) {
            item.focus();
            Accessibility.announce(item.getAttribute('aria-label') || item.textContent);
        }
    },

    setupSelectionQueueEventListeners() {
        const dialog = this.selectionQueueDialog;
        const list = document.getElementById('selection-queue-list');
        if (!dialog || !list || this.selectionQueueSetupDone) {
            return;
        }
        this.selectionQueueSetupDone = true;

        list.addEventListener('click', (event) => {
            const item = event.target.closest('[data-index]');
            if (!item) {
                return;
            }
            this.selectSelectionQueueIndex(parseInt(item.dataset.index, 10), false);
        });

        list.addEventListener('dblclick', () => {
            if (Number.isInteger(this.selectionQueueSelectedIndex) && this.selectionQueueSelectedIndex >= 0) {
                window.App?.previewVerticalClipQueueItem?.(this.selectionQueueSelectedIndex);
            }
        });

        list.addEventListener('keydown', (event) => {
            const items = Array.from(list.querySelectorAll('[data-index]'));
            if (items.length === 0) {
                return;
            }

            const currentIndex = Number.isInteger(this.selectionQueueSelectedIndex) && this.selectionQueueSelectedIndex >= 0
                ? this.selectionQueueSelectedIndex
                : 0;

            if (event.key === 'ArrowDown') {
                event.preventDefault();
                this.selectSelectionQueueIndex(Math.min(items.length - 1, currentIndex + 1), true);
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                this.selectSelectionQueueIndex(Math.max(0, currentIndex - 1), true);
            } else if (event.key === 'Delete') {
                event.preventDefault();
                document.getElementById('selection-queue-remove')?.click();
            } else if (event.altKey && event.key.toLowerCase() === 'p') {
                event.preventDefault();
                document.getElementById('selection-queue-preview')?.click();
            } else if (event.altKey && event.key === 'ArrowUp') {
                event.preventDefault();
                document.getElementById('selection-queue-move-up')?.click();
            } else if (event.altKey && event.key === 'ArrowDown') {
                event.preventDefault();
                document.getElementById('selection-queue-move-down')?.click();
            } else if (event.key === 'Enter') {
                event.preventDefault();
                document.getElementById('selection-queue-preview')?.click();
            }
        });

        document.getElementById('selection-queue-preview')?.addEventListener('click', () => {
            window.App?.suppressPlaybackShortcuts?.();
            if (Number.isInteger(this.selectionQueueSelectedIndex) && this.selectionQueueSelectedIndex >= 0) {
                window.App?.previewVerticalClipQueueItem?.(this.selectionQueueSelectedIndex);
            }
        });

        document.getElementById('selection-queue-remove')?.addEventListener('click', () => {
            window.App?.suppressPlaybackShortcuts?.();
            if (!Number.isInteger(this.selectionQueueSelectedIndex) || this.selectionQueueSelectedIndex < 0) {
                return;
            }
            const nextIndex = window.App?.removeVerticalClipQueueItem?.(this.selectionQueueSelectedIndex);
            this.selectSelectionQueueIndex(nextIndex, true);
        });

        document.getElementById('selection-queue-move-up')?.addEventListener('click', () => {
            window.App?.suppressPlaybackShortcuts?.();
            if (!Number.isInteger(this.selectionQueueSelectedIndex) || this.selectionQueueSelectedIndex < 0) {
                return;
            }
            const nextIndex = window.App?.moveVerticalClipQueueItem?.(this.selectionQueueSelectedIndex, -1);
            this.selectSelectionQueueIndex(nextIndex, true);
        });

        document.getElementById('selection-queue-move-down')?.addEventListener('click', () => {
            window.App?.suppressPlaybackShortcuts?.();
            if (!Number.isInteger(this.selectionQueueSelectedIndex) || this.selectionQueueSelectedIndex < 0) {
                return;
            }
            const nextIndex = window.App?.moveVerticalClipQueueItem?.(this.selectionQueueSelectedIndex, 1);
            this.selectSelectionQueueIndex(nextIndex, true);
        });

        document.getElementById('selection-queue-merge')?.addEventListener('click', async () => {
            window.App?.suppressPlaybackShortcuts?.();
            dialog.close();
            await window.App?.mergeVerticalClipQueue?.();
        });

        document.getElementById('selection-queue-vertical')?.addEventListener('click', () => {
            window.App?.suppressPlaybackShortcuts?.();
            dialog.close();
            window.App?.openVerticalWizardFromQueue?.();
        });

        document.getElementById('selection-queue-clear')?.addEventListener('click', () => {
            window.App?.suppressPlaybackShortcuts?.();
            window.App?.clearVerticalClipQueue?.();
            this.selectionQueueSelectedIndex = -1;
            this.updateSelectionQueueList();
        });

        document.getElementById('selection-queue-close')?.addEventListener('click', () => {
            window.App?.suppressPlaybackShortcuts?.();
            dialog.close();
        });

        dialog.addEventListener('close', () => {
            this.selectionQueueSelectedIndex = -1;
        });
    },

    /**
     * Ekleme listesini güncelle
     */
    updateInsertionQueueList() {
        const list = document.getElementById('insertion-queue-list');
        const emptyMsg = document.getElementById('insertion-queue-empty');
        const applyBtn = document.getElementById('insertion-queue-apply-all');
        const clearBtn = document.getElementById('insertion-queue-clear');

        if (!list) return;

        const items = InsertionQueue.getItems();

        // Boş mesajı göster/gizle
        if (emptyMsg) {
            emptyMsg.style.display = items.length === 0 ? 'block' : 'none';
        }

        // Butonları etkinleştir/devre dışı bırak
        if (applyBtn) applyBtn.disabled = items.length === 0;
        if (clearBtn) clearBtn.disabled = items.length === 0;

        // Listeyi temizle ve yeniden doldur
        list.innerHTML = '';

        items.forEach((item, index) => {
            const li = document.createElement('li');
            li.className = 'insertion-queue-item';
            li.setAttribute('role', 'option');
            li.setAttribute('data-id', item.id);
            li.setAttribute('tabindex', index === 0 ? '0' : '-1');
            li.setAttribute('aria-selected', 'false');

            // Detaylı ve erişilebilir etiket oluştur
            let label = '';
            let startTime = item.options.startTime || 0;
            let endTime = 0;

            if (item.type === 'text') {
                const text = item.options.text || '';
                const duration = item.options.duration === 'whole' ? 'tüm video' : item.options.duration;
                endTime = item.options.duration === 'whole' ? 'son' : startTime + (item.options.duration || 5);

                label = `Yazı ekleme: "${text.substring(0, 40)}${text.length > 40 ? '...' : ''}", `;
                label += `zaman aralığı ${Utils.formatTime(startTime)} - ${endTime === 'son' ? 'son' : Utils.formatTime(endTime)}`;
            } else if (item.type === 'audio') {
                const fileName = item.options.audioPath ? item.options.audioPath.split(/[\\/]/).pop() : 'Ses dosyası';
                const audioDuration = (item.options.audioTrimEnd || 0) - (item.options.audioTrimStart || 0);
                endTime = startTime + audioDuration;

                label = `Ses ekleme: ${fileName}, `;
                label += `zaman aralığı ${Utils.formatTime(startTime)} - ${Utils.formatTime(endTime)}`;
            } else if (item.type === 'image') {
                // Görsel tipi için etiket oluştur
                const typeLabel = item.options.imageType === 'watermark' ? 'Filigran' :
                    item.options.imageType === 'overlay' ? 'Serbest Görsel' : 'Arka Plan';
                const sourceLabel = item.options.sourceType === 'text' ? `Yazı: "${(item.options.textContent || '').substring(0, 20)}"` :
                    item.options.sourceType === 'library' ? `Renk: ${item.options.libraryColor || 'bilinmiyor'}` :
                        item.options.imagePath ? item.options.imagePath.split(/[\\/]/).pop() : 'Görsel dosyası';

                const timingLabel = item.options.durationMode === 'whole' ? 'tüm video' :
                    `${Utils.formatTime(item.options.startTime || 0)} - ${item.options.endTime === -1 ? 'son' : Utils.formatTime(item.options.endTime || 0)}`;

                label = `${typeLabel}: ${sourceLabel}, `;
                label += `konum (${item.options.x}, ${item.options.y}), `;
                label += `süre: ${timingLabel}`;
            } else if (item.type === 'transition') {
                const tName = item.options.transitionName || item.options.transitionId || 'Geçiş';
                label = `Aktif geçiş: ${tName} ${Utils.formatTime(item.options.time || 0)} konumunda`;
            } else if (item.type === 'overlay') {
                const oName = item.options.overlayName || item.options.overlayId || 'Overlay';
                label = `Overlay: ${oName} ${Utils.formatTime(item.options.time || item.options.startTime || 0)} konumunda`;
            } else if (item.type === 'object') {
                const oSource = item.options.objectName || 'Nesne';
                const oAction = item.options.actionType || 'İşlem';
                const oTime = (item.options.durationMode === 'whole' || item.options.durationMode === 'full') ? 'tüm klip boyunca' : (Utils.formatTime(item.options.startTime || 0) + ' / ' + Utils.formatTime(item.options.endTime || 0));
                label = `Nesne: ${oSource}. İşlem türü: ${oAction}. Zaman aralığı: ${oTime}`;
            }

            // Butonlar için kısa açıklama
            let shortDesc = '';
            if (item.type === 'text') {
                shortDesc = `yazı eklemesi: "${(item.options.text || '').substring(0, 20)}"`;
            } else if (item.type === 'audio') {
                shortDesc = `ses eklemesi: ${item.options.audioPath ? item.options.audioPath.split(/[\\/]/).pop() : 'Ses'}`;
            } else if (item.type === 'image') {
                const typeLabel = item.options.imageType === 'watermark' ? 'Filigran' :
                    item.options.imageType === 'overlay' ? 'Serbest Görsel' : 'Arka Plan';
                shortDesc = `görsel eklemesi: ${typeLabel}`;
            } else if (item.type === 'transition') {
                shortDesc = `geçiş eklemesi`;
            } else if (item.type === 'overlay') {
                shortDesc = `overlay eklemesi`;
            } else if (item.type === 'object') {
                shortDesc = `nesne işlemi eklemesi`;
            }

            li.innerHTML = `
                <span class="item-label">${label}</span>
                <span class="item-actions" role="group" aria-label="İşlemler">
                    <button type="button" class="edit-btn" data-id="${item.id}" tabindex="-1" aria-label="Düzenle ${shortDesc}">Düzenle</button>
                    <button type="button" class="delete-btn" data-id="${item.id}" tabindex="-1" aria-label="Sil ${shortDesc}">Sil</button>
                </span>
            `;

            li.setAttribute('aria-label', label);
            list.appendChild(li);
        });

        // İlk öğeye odaklan
        if (items.length > 0) {
            const firstItem = list.querySelector('.insertion-queue-item');
            if (firstItem) {
                firstItem.focus();
            }
        }
    },

    /**
     * Ekleme listesi event listener'larını kur
     */
    setupInsertionQueueEventListeners() {
        const dialog = document.getElementById('insertion-queue-dialog');
        const list = document.getElementById('insertion-queue-list');

        // Önceki listener'ları temizle
        const newList = list.cloneNode(true);
        list.parentNode.replaceChild(newList, list);

        // Context Menu
        this.setupListContextMenu(newList, 'insertion');

        // Klavye navigasyonu (ok tuşları ile gezinme)
        newList.addEventListener('keydown', (e) => {
            const items = newList.querySelectorAll('.insertion-queue-item');
            const currentIndex = Array.from(items).findIndex(item => item === document.activeElement);
            const focusedElement = document.activeElement;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                // Liste öğesinden veya butondan aşağı ok
                const parentItem = focusedElement.closest('.insertion-queue-item');
                if (parentItem) {
                    const itemIndex = Array.from(items).indexOf(parentItem);
                    const nextIndex = itemIndex < items.length - 1 ? itemIndex + 1 : 0;
                    items[nextIndex].focus();
                    Accessibility.announce(items[nextIndex].getAttribute('aria-label'));
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const parentItem = focusedElement.closest('.insertion-queue-item');
                if (parentItem) {
                    const itemIndex = Array.from(items).indexOf(parentItem);
                    const prevIndex = itemIndex > 0 ? itemIndex - 1 : items.length - 1;
                    items[prevIndex].focus();
                    Accessibility.announce(items[prevIndex].getAttribute('aria-label'));
                }
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                const parentItem = focusedElement.closest('.insertion-queue-item');
                if (parentItem) {
                    const rect = parentItem.getBoundingClientRect();
                    const event = new MouseEvent('contextmenu', {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        button: 2,
                        buttons: 2,
                        clientX: rect.left + rect.width / 2,
                        clientY: rect.top + rect.height / 2
                    });
                    parentItem.dispatchEvent(event);
                }
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                // Menü açıksa kapat (ContextMenu kapanma logic'i global event listener'da veya menu içinde olabilir)
                // Ancak burada sol ok ile menüden çıkıp listeye dönme isteniyor.
                // Eğer menü açıksa, menü zaten odaklıdır. Burası liste üzerindeki listener.
                // Eğer liste üzerindeysek ve sol ok basarsak, belki varsa parent'a dönmeliyiz ama
                // kullanıcı "sol okun da bağlam menüsünü kapatıp" dedi. Bu menü açıkken olur.
                // Menü açıkken focus menüdedir.
                // Dolayısıyla setupListContextMenu içindeki menu keydown listener'ına müdahale etmeliyiz.

                // Burası liste navigasyonu. Sol ok listede bir şey yapmıyor şimdilik.
            } else if (e.key === 'Tab') {
                // Varsayılan Tab geçişine bırak. Böylece tümünü videoya uygula düğmesine geçiş yapar.
            } else if (e.key === 'Delete') {
                // Delete ile sil
                const parentItem = focusedElement.closest('.insertion-queue-item');
                if (parentItem) {
                    const id = parseInt(parentItem.dataset.id);
                    InsertionQueue.removeItem(id);
                    this.updateInsertionQueueList();
                    Accessibility.announce('Öğe silindi');
                }
            } else if (e.key === 'Enter') {
                // Enter ile düzenle veya butonu tıkla
                if (focusedElement.classList.contains('insertion-queue-item')) {
                    const id = parseInt(focusedElement.dataset.id);
                    const item = InsertionQueue.getItem(id);
                    if (item) {
                        dialog.close();
                        window.api.openTextOverlayDialog({
                            startTime: VideoPlayer.getCurrentTime(),
                            editItem: item
                        });
                    }
                } else if (focusedElement.classList.contains('edit-btn') || focusedElement.classList.contains('delete-btn')) {
                    // Buton üzerinde Enter = tıklama
                    focusedElement.click();
                }
            }
        });

        // Düzenle/Sil butonları (click ile)
        newList.addEventListener('click', async (e) => {
            const editBtn = e.target.closest('.edit-btn');
            const deleteBtn = e.target.closest('.delete-btn');

            if (editBtn) {
                const id = parseInt(editBtn.dataset.id);
                const item = InsertionQueue.getItem(id);
                if (item) {
                    dialog.close();
                    await window.api.openTextOverlayDialog({
                        startTime: VideoPlayer.getCurrentTime(),
                        editItem: item
                    });
                }
            }

            if (deleteBtn) {
                const id = parseInt(deleteBtn.dataset.id);
                InsertionQueue.removeItem(id);
                this.updateInsertionQueueList();
                Accessibility.announce('Öğe silindi');
            }
        });

        // Tümünü Uygula
        const applyBtnElem = document.getElementById('insertion-queue-apply-all');
        if (applyBtnElem) {
            const newBtn = applyBtnElem.cloneNode(true);
            applyBtnElem.parentNode.replaceChild(newBtn, applyBtnElem);
            newBtn.addEventListener('click', async () => {
                dialog.close();
                await App.applyAllInsertions();
            });
        }

        // Listeyi Temizle
        const clearBtnElem = document.getElementById('insertion-queue-clear');
        if (clearBtnElem) {
            const newBtn = clearBtnElem.cloneNode(true);
            clearBtnElem.parentNode.replaceChild(newBtn, clearBtnElem);
            newBtn.addEventListener('click', () => {
                InsertionQueue.clear();
                this.updateInsertionQueueList();
                Accessibility.announce('Ekleme listesi temizlendi');
            });
        }

        // Kapat
        const closeBtnElem = document.getElementById('insertion-queue-close');
        if (closeBtnElem) {
            const newBtn = closeBtnElem.cloneNode(true);
            closeBtnElem.parentNode.replaceChild(newBtn, closeBtnElem);
            newBtn.addEventListener('click', () => {
                dialog.close();
            });
        }
    },

    /**
     * Sessizlik tespiti event listener'larını kur
     */
    setupSilenceEventListeners() {
        // Parametreler diyaloğu
        document.getElementById('silence-params-confirm')?.addEventListener('click', () => {
            this.startSilenceDetection();
        });

        document.getElementById('silence-params-cancel')?.addEventListener('click', () => {
            this.silenceParamsDialog.close();
        });

        // Liste diyaloğu
        const list = document.getElementById('silence-intervals-list');
        this.setupListContextMenu(list, 'silence');
        list?.addEventListener('keydown', (e) => this.handleSilenceListKeydown(e));
        list?.addEventListener('click', (e) => {
            const li = e.target.closest('li');
            if (li) {
                const index = parseInt(li.dataset.index);
                this.selectSilence(index);
            }
        });

        document.getElementById('silence-play-selected')?.addEventListener('click', () => {
            this.playSelectedSilence();
        });

        document.getElementById('silence-preview-cut')?.addEventListener('click', () => {
            this.previewSilenceCut();
        });

        this.silenceListDialog?.addEventListener('keydown', (e) => {
            if (e.altKey && e.key === 'p') {
                e.preventDefault();
                this.previewSilenceCut();
            }
        });

        document.getElementById('silence-delete-selected')?.addEventListener('click', () => {
            this.deleteSelectedSilence();
        });

        document.getElementById('silence-delete-all')?.addEventListener('click', () => {
            this.deleteAllSilences();
        });

        document.getElementById('silence-list-close')?.addEventListener('click', () => {
            this.silenceListDialog.close();
        });

        this.silenceListDialog?.addEventListener('close', () => {
            this.stopSilencePreview();
        });
    },

    /**
     * Sessizlik tespiti parametre diyaloğunu göster
     */
    showSilenceParamsDialog() {
        if (!VideoPlayer.hasVideo()) {
            Accessibility.alert('Önce bir video açmalısınız');
            return;
        }
        this.silenceParamsDialog.showModal();
        Accessibility.announce('Boşlukları listele diyaloğu açıldı. Süre ve eşik seçimi yapabilirsiniz.');
    },

    /**
     * Sessizlik tespitini başlat
     */
    async startSilenceDetection() {
        const minDurationMs = parseInt(document.getElementById('silence-min-duration').value) || 500;
        const threshold = parseInt(document.getElementById('silence-threshold').value) || -30;

        this.silenceParamsDialog.close();
        App.showProgress(this.t('runtime.dialogs.silence_analysis_in_progress', 'Silent sections are being analyzed...'));

        // Progress dinleyicisi ekle
        const progressHandler = (data) => {
            if (data.operation === 'detect-silence') {
                App.updateProgress(this.t('runtime.dialogs.silence_analysis_progress', 'Silence analysis'), data.percent);
            }
        };
        window.api.onFfmpegProgress(progressHandler);

        try {
            const result = await window.api.detectSilence({
                inputPath: VideoPlayer.currentFilePath,
                minDuration: minDurationMs / 1000,
                threshold: threshold
            });

            window.api.offFfmpegProgress(progressHandler);
            App.hideProgress();

            if (result.success) {
                this.detectedSilences = result.data || [];
                this.showSilenceListDialog();
            } else {
                Accessibility.alert(this.t('runtime.dialogs.analysis_error', 'Analysis error: {error}', { error: result.error }));
            }
        } catch (error) {
            window.api.offFfmpegProgress(progressHandler);
            App.hideProgress();
            Accessibility.alert(this.t('runtime.dialogs.unexpected_error', 'Unexpected error: {error}', { error: error.message }));
        }
    },

    /**
     * Sessizlik listesi diyaloğunu göster
     */
    showSilenceListDialog() {
        this.updateSilenceList();
        this.silenceListDialog.showModal();

        const count = this.detectedSilences.length;
        if (count > 0) {
            Accessibility.announce(this.t('runtime.dialogs.silence_found_announce', `${count} adet sessiz alan bulundu. Ok tuşlarıyla gezinebilirsiniz.`, { count }));
            setTimeout(() => {
                const firstItem = document.querySelector('#silence-intervals-list li');
                if (firstItem) firstItem.focus();
            }, 100);
        } else {
            Accessibility.announce(this.t('runtime.dialogs.no_silence_found', 'Hiç sessiz alan bulunamadı.'));
        }
    },

    /**
     * Sessizlik listesini güncelle
     */
    updateSilenceList() {
        const list = document.getElementById('silence-intervals-list');
        const countText = document.getElementById('silence-list-count');
        const totalCount = document.getElementById('silence-total-count');
        const totalDuration = document.getElementById('silence-total-duration');

        list.innerHTML = '';
        let totalTime = 0;

        this.detectedSilences.forEach((s, index) => {
            const li = document.createElement('li');
            li.setAttribute('role', 'option');
            li.setAttribute('tabindex', index === 0 ? '0' : '-1');
            li.setAttribute('data-index', index);
            li.style.padding = '8px';
            li.style.borderBottom = '1px solid #444';
            li.style.cursor = 'pointer';

            const startText = Utils.formatTime(s.start);
            const endText = Utils.formatTime(s.end);
            const durText = Utils.formatTime(s.duration);

            li.textContent = `${index + 1}. ${startText} - ${endText} (${durText})`;
            li.setAttribute('aria-label', this.t('runtime.dialogs.silence_item_aria', `${index + 1}. alan. Başlangıç ${startText}, bitiş ${endText}. Süre ${durText}`, { index: index + 1, start: startText, end: endText, duration: durText }));

            list.appendChild(li);
            totalTime += s.duration;
        });

        countText.textContent = this.t('runtime.dialogs.silence_count_found', `${this.detectedSilences.length} alan bulundu.`, { count: this.detectedSilences.length });
        totalCount.textContent = this.detectedSilences.length;
        totalDuration.textContent = Utils.formatTime(totalTime);

        this.selectedSilenceIndex = this.detectedSilences.length > 0 ? 0 : -1;
    },

    /**
     * Liste klavye olaylarını işle
     */
    handleSilenceListKeydown(e) {
        const items = document.querySelectorAll('#silence-intervals-list li');
        let index = this.selectedSilenceIndex;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            index = Math.min(items.length - 1, index + 1);
            this.selectSilence(index);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            index = Math.max(0, index - 1);
            this.selectSilence(index);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            this.playSelectedSilence();
        } else if (e.key === 'Delete') {
            e.preventDefault();
            this.deleteSelectedSilence();
        } else if (e.altKey && e.key.toLowerCase() === 'p') {
            e.preventDefault();
            this.previewSilenceCut();
        }
    },

    /**
     * Sessizliği seç
     */
    selectSilence(index) {
        const items = document.querySelectorAll('#silence-intervals-list li');
        items.forEach(li => {
            li.style.backgroundColor = '';
            li.setAttribute('tabindex', '-1');
            li.setAttribute('aria-selected', 'false');
        });

        if (items[index]) {
            items[index].style.backgroundColor = '#333';
            items[index].setAttribute('tabindex', '0');
            items[index].setAttribute('aria-selected', 'true');
            items[index].focus();
            this.selectedSilenceIndex = index;
            Accessibility.announce(items[index].getAttribute('aria-label'));
        }
    },

    /**
     * Seçili sessizliği oynat
     */
    playSelectedSilence() {
        if (this.selectedSilenceIndex < 0) return;
        const silence = this.detectedSilences[this.selectedSilenceIndex];

        VideoPlayer.ignoreTimeline = true; // Timeline atlamalarını devre dışı bırak
        VideoPlayer.seekTo(silence.start);
        VideoPlayer.play();

        // Seçili alanı da görselleştir (isteğe bağlı)
        Selection.setSelection(silence.start, silence.end);

        VideoPlayer.ignoreTimeline = true; // Timeline atlamalarını devre dışı bırak
        VideoPlayer.rangeEnd = silence.end;
        VideoPlayer.isRangePlaying = true;

        Accessibility.announce(`Oynatılıyor: ${Utils.formatTime(silence.start)} ile ${Utils.formatTime(silence.end)} arası`);
    },

    /**
     * Kesim önizlemesi (Alt+P)
     */
    previewSilenceCut() {
        if (this.selectedSilenceIndex < 0) return;
        const silence = this.detectedSilences[this.selectedSilenceIndex];

        this.stopSilencePreview();

        // Tampon bilgisini al
        const paddingMs = parseInt(document.getElementById('silence-padding-input').value) || 0;
        const paddingSec = paddingMs / 1000;
        const halfPadding = paddingSec / 2;

        // Atlama (silinme) aralığını hesapla (Source Time)
        let skipStartSource = silence.start + halfPadding;
        let skipEndSource = silence.end - halfPadding;

        // Tampon kontrolü
        if (skipEndSource <= skipStartSource) {
            Accessibility.announce('Tampon süresi sessizlikten uzun, atlama yapılmayacak.');
            skipStartSource = silence.start;
            skipEndSource = silence.start; // No skip
        }

        // Timeline zamanına çevir
        const skipStartTimeline = Timeline.sourceToTimeline(skipStartSource);
        const skipEndTimeline = Timeline.sourceToTimeline(skipEndSource);

        if (skipStartTimeline === -1 || skipEndTimeline === -1) {
            Accessibility.announce('Bu alan zaman çizelgesinde bulunamadı (zaten silinmiş olabilir).');
            return;
        }

        // VideoPlayer'ın playCutPreview özelliğini kullan (Timeline Time ile)
        VideoPlayer.playCutPreview(skipStartTimeline, skipEndTimeline);
    },

    /**
     * Sessizlik önizlemesini durdur
     */
    stopSilencePreview() {
        this.isSilencePreviewPlaying = false;
        VideoPlayer.ignoreTimeline = false; // Normal moda dön
        if (this._silencePreviewHandler) {
            const video = document.getElementById('video-player');
            if (video) video.removeEventListener('timeupdate', this._silencePreviewHandler);
            this._silencePreviewHandler = null;
        }
    },

    /**
     * Seçili sessiz alanı sil
     */
    deleteSelectedSilence() {
        if (this.selectedSilenceIndex < 0) return;
        this.stopSilencePreview(); // Eğer oynatılıyorsa durdur
        const silence = this.detectedSilences[this.selectedSilenceIndex];

        // Kaynak zamanını timeline zamanına çevir
        const timelineStart = Timeline.sourceToTimeline(silence.start);
        const timelineEnd = Timeline.sourceToTimeline(silence.end);

        if (timelineStart !== -1 && timelineEnd !== -1) {
            Timeline.deleteRange(timelineStart, timelineEnd);
            Accessibility.announce('Sessiz alan silindi.');
        } else {
            // Eğer tam örtüşme yoksa, en azından başlangıç timeline'da ise oradan itibaren silmeyi deneyebiliriz
            // Ama genellikle sessizlik tespiti taze ise sorun olmaz.
            Accessibility.alert('Bu sessiz alan mevcut düzenlemede bulunamadı veya zaten silinmiş.');
        }

        this.detectedSilences.splice(this.selectedSilenceIndex, 1);
        this.updateSilenceList();

        // Bir sonraki öğeyi seç (varsa)
        if (this.detectedSilences.length > 0) {
            this.selectSilence(Math.min(this.selectedSilenceIndex, this.detectedSilences.length - 1));
        }
    },

    /**
     * Tüm sessiz alanları sil
     */
    async deleteAllSilences() {
        if (this.detectedSilences.length === 0) return;
        this.stopSilencePreview(); // Eğer oynatılıyorsa durdur

        // Kullanıcı tanımlı koruma payı (buffer)
        const paddingMs = parseInt(document.getElementById('silence-padding-input').value) || 0;
        const paddingSec = paddingMs / 1000;

        // Bu koruma payını her iki uca (başlangıç ve bitiş) eşit olarak dağıtabiliriz
        // veya toplamda iki segment arasında kalacak boşluk olarak düşünebiliriz.
        // Kullanıcı "iki boşluk arasında en az 100 ms" dedi.
        // Yani silinen aralıktan, her iki uca (veya bir uca) pay bırakmalıyız.
        // En basit ve güvenli yöntem: Silinecek aralığı (buffer / 2) kadar daraltmak.
        // Böylece önceki segmentin sonuna (buffer/2) eklenir, sonraki segmentin başına (buffer/2) eklenir.
        // Toplamda konuşmalar arası (buffer) kadar boşluk kalır.
        const halfPadding = paddingSec / 2;

        let totalTime = this.detectedSilences.reduce((sum, s) => {
            // Silinecek efektif süre: (Duration - Padding)
            // Eğer süre padding'den kısaysa hiç silinmez (0 katkı)
            const effectiveDuration = Math.max(0, s.duration - paddingSec);
            return sum + effectiveDuration;
        }, 0);

        const confirmed = await window.api.showConfirm({
            title: this.t('dialog.silence_list.delete_all_title', 'Delete All Silent Sections'),
            message: this.t('dialog.silence_list.delete_all_message', '{count} silent sections were found. With a protection padding of {padding} ms, approximately {duration} will be deleted. Are you sure?', {
                count: this.detectedSilences.length,
                padding: paddingMs,
                duration: Utils.formatTime(totalTime)
            })
        });

        if (confirmed) {
            // Silme işlemi sırasında zamanlar kayar, bu yüzden sondan başa doğru silmek hayati önem taşır
            const ranges = [...this.detectedSilences]
                .sort((a, b) => b.start - a.start); // Kaynak zamanına göre sondan başa

            let deletedCount = 0;
            let skippedCount = 0;

            ranges.forEach(r => {
                // Aralığı daralt
                let safeStart = r.start + halfPadding;
                let safeEnd = r.end - halfPadding;

                // Eğer aralık çok kısaysa ve buffer'dan dolayı tamamen kayboluyorsa veya negatif oluyorsa silme
                if (safeEnd <= safeStart) {
                    skippedCount++;
                    return;
                }

                const tStart = Timeline.sourceToTimeline(safeStart);
                const tEnd = Timeline.sourceToTimeline(safeEnd);

                if (tStart !== -1 && tEnd !== -1) {
                    Timeline.deleteRange(tStart, tEnd);
                    deletedCount++;
                }
            });

            this.detectedSilences = [];
            this.updateSilenceList();

            let message = `${deletedCount} adet sessiz alan silindi.`;
            if (skippedCount > 0) {
                message += ` (${skippedCount} alan koruma payından kısa olduğu için atlandı)`;
            }
            Accessibility.announce(message);
            this.silenceListDialog.close();
        }
    },

    /**
     * AI diyalog olay dinleyicilerini kur
     */
    setupAIEventListeners() {
        document.getElementById('ai-description-close')?.addEventListener('click', () => {
            this.aiDescriptionDialog.close();
        });

        // Dialog kapandığında içeriği temizle
        this.aiDescriptionDialog?.addEventListener('close', () => {
            const chatContainer = document.getElementById('ai-description-chat');
            if (chatContainer) chatContainer.innerHTML = '';
        });

        // Form submit'i engelle - Enter tuşu dialogu kapatmasın
        const aiForm = this.aiDescriptionDialog?.querySelector('form');
        aiForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            // Enter basıldığında soru gönder
            this.sendAIQuestion();
        });

        document.getElementById('ai-question-send')?.addEventListener('click', () => {
            this.sendAIQuestion();
        });

        document.getElementById('ai-question-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation(); // Dialog kapanmasını engelle
                this.sendAIQuestion();
            }
        });
    },

    /**
     * Belirli bir video segmenti için AI betimlemesi iste (Konum Betimle)
     */
    async showAIDescriptionForSegment(startTime, duration) {
        // Önce API anahtarı kontrolü
        const apiData = await window.api.getGeminiApiData();
        const apiKey = apiData.apiKey;
        if (!apiKey) {
            this.showGeminiApiKeyDialog();
            Accessibility.announce(this.t('runtime.dialogs.gemini_key_missing_announce', 'Gemini API key is missing. Please enter your key first.'));
            return;
        }
        this.currentAiApiKey = apiKey;
        this.currentAiModel = apiData.model || 'gemini-2.5-flash';

        this.aiDescriptionDialog.showModal();

        // UI elementlerini hazırla
        const chatContainer = document.getElementById('ai-description-chat');
        chatContainer.innerHTML = `<p class="status-loading">${this.t('runtime.dialogs.ai_preparing_clip', 'Video klibi hazırlanıyor ve analiz ediliyor...')}</p>`;
        document.getElementById('ai-question-group').style.display = 'none';
        this.aiChatHistory = [];

        Accessibility.announce(this.t('runtime.dialogs.ai_preparing_clip_announce', 'Video klibi hazırlanıyor ve yapay zeka tarafından analiz ediliyor. Lütfen bekleyin.'));

        try {
            const currentLangName = this.getCurrentAiLanguageName();
            const prompt = window.i18nHelper.t('ai.describe_current_position', { time: startTime, lang: currentLangName }) || `Lütfen gönderdiğim bu klibi görme engelli birine en anlaşılır olacak biçimde kısaca betimle. Çıktı dili: ${currentLangName}`;

            // `geminiDescribeSelection` IPC handler'ı sunucu tarafında kesme, yükleme ve analiz işlemlerini yönetir
            const responseText = await window.api.geminiDescribeSelection({
                apiKey: apiKey,
                model: this.currentAiModel,
                startTime: startTime,
                endTime: startTime + duration,
                prompt: prompt,
                systemInstruction: this.getAiSystemInstruction()
            });

            // Sonucu Göster
            // responseText markdown formatında gelebilir
            chatContainer.innerHTML = `<div class="ai-response">${Utils.markdownToHtml(responseText)}</div>`;
            this.aiChatHistory.push({ role: 'assistant', content: responseText });

            // Soru sorma bölümünü göster
            document.getElementById('ai-question-group').style.display = 'block';
            document.getElementById('ai-question-input').focus();

            Accessibility.announce(this.t('runtime.dialogs.description_ready', 'Description ready: {response}', { response: responseText }));

        } catch (error) {
            console.error('AI Description Error:', error);
            chatContainer.innerHTML = `<p style="color: #ff4444;">${this.t('runtime.common.error', 'Hata: {error}', { error: error.message })}</p>`;
            Accessibility.announceError(this.t('runtime.dialogs.description_failed', 'Betimleme işlemi başarısız oldu: {error}', { error: error.message }));
        }
    },

    /**
     * Seçimi AI ile betimleme diyaloğunu göster
     */
    async showAIDescriptionDialog() {
        if (!VideoPlayer.hasVideo()) return;

        // API anahtarını kontrol et
        const apiData = await window.api.getGeminiApiData();
        const apiKey = apiData.apiKey;
        if (!apiKey) {
            Accessibility.alert(this.t('runtime.dialogs.gemini_key_missing', 'Hata: Gemini API anahtarı bulunamadı. Lütfen ayarlardan API anahtarınızı girin.'));
            return;
        }
        this.currentAiApiKey = apiKey;
        this.currentAiModel = apiData.model || 'gemini-2.5-flash';

        const selection = Selection.getSelection();
        if (!selection || selection.start === selection.end) {
            Accessibility.alert(this.t('runtime.dialogs.select_area_first', 'Lütfen önce bir alan seçin.'));
            return;
        }

        // Diyaloğu hazırla
        const chatContainer = document.getElementById('ai-description-chat');
        chatContainer.innerHTML = `<p>${this.t('dialog.ai_description.waiting', 'Yapay zeka analiz ediyor, lütfen bekleyin...')}</p>`;
        document.getElementById('ai-question-group').style.display = 'none';
        this.aiChatHistory = [];

        this.aiDescriptionDialog.showModal();
        Accessibility.announce(this.t('runtime.dialogs.ai_analyzing_selection', 'Yapay zeka seçili alanı analiz ediyor. Lütfen bekleyin.'));

        try {
            const currentLangName = this.getCurrentAiLanguageName();
            const prompt = window.i18nHelper.t('ai.prompt_describe_selection', { start: selection.start, end: selection.end, lang: currentLangName }) || `Sen bir görme engelliler için video betimleme asistanısın. Gönderilen kareleri (video kesitini) analiz et ve buradaki olayları, mekanları ve kişileri betimle. Çıktı dili: ${currentLangName}`;

            const response = await window.api.geminiDescribeSelection({
                apiKey: apiKey,
                model: this.currentAiModel,
                startTime: selection.start,
                endTime: selection.end,
                prompt: prompt,
                systemInstruction: this.getAiSystemInstruction()
            });

            // Yanıtı ekle
            chatContainer.innerHTML = `<div class="ai-response">${Utils.markdownToHtml(response)}</div>`;
            this.aiChatHistory.push({ role: 'assistant', content: response });

            // Soru sorma bölümünü göster
            document.getElementById('ai-question-group').style.display = 'block';
            document.getElementById('ai-question-input').focus();

            Accessibility.alert(this.t('runtime.dialogs.analysis_completed', 'Analiz tamamlandı. {response}', { response }));

        } catch (error) {
            chatContainer.innerHTML = `<p style="color: #ff4444;">${this.t('runtime.common.error', 'Hata: {error}', { error: error.message })}</p>`;
            Accessibility.announceError(this.t('runtime.dialogs.analysis_failed', 'Analiz sırasında bir hata oluştu: {error}', { error: error.message }));
        }
    },

    /**
     * AI'ya ek soru gönder
     */
    async sendAIQuestion() {
        const input = document.getElementById('ai-question-input');
        const question = input.value.trim();
        if (!question) return;

        // Erişilebilirlik için, önceki içeriği temizle ki ekran okuyucu baştan sona okumasın
        // Sadece son soru ve cevap kalsın
        const chatContainer = document.getElementById('ai-description-chat');
        chatContainer.innerHTML = '';

        // Kullanıcı sorusunu ekle
        const userMsgDiv = document.createElement('div');
        userMsgDiv.className = 'user-question';
        // userMsgDiv.style.marginTop = '15px'; // İlk eleman olduğu için margin'e gerek yok
        userMsgDiv.style.borderBottom = '1px solid #333';
        userMsgDiv.style.paddingBottom = '10px';
        userMsgDiv.style.marginBottom = '10px';
        userMsgDiv.innerHTML = `<strong>${this.getAiChatLabel('question')}:</strong> <p>${question}</p>`;
        chatContainer.appendChild(userMsgDiv);

        input.value = '';
        Accessibility.announce(this.t('runtime.dialogs.question_sent', 'Soru gönderildi, yanıt bekleniyor.'));

        // Loading göster
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'ai-loading';
        loadingDiv.innerHTML = `<p>${this.t('runtime.dialogs.ai_answering', 'AI yanıtlıyor...')}</p>`;
        chatContainer.appendChild(loadingDiv);
        // chatContainer.scrollTop = chatContainer.scrollHeight; // Tek içerik olduğu için gerek yok

        try {
            const localizedPrompt = this.buildAiFollowupPrompt(question);
            const response = await window.api.geminiVisionRequest({
                apiKey: this.currentAiApiKey,
                model: this.currentAiModel,
                prompt: localizedPrompt,
                history: this.aiChatHistory,
                systemInstruction: this.getAiSystemInstruction()
            });

            if (!response?.success) {
                throw new Error(response?.error || this.t('runtime.dialogs.ai_empty_response', 'AI returned an empty response.'));
            }

            // Loading'i kaldır
            loadingDiv.remove();

            // AI yanıtını ekle
            const aiMsgDiv = document.createElement('div');
            aiMsgDiv.className = 'ai-response';
            aiMsgDiv.style.color = '#4CAF50';
            const responseText = response.text || '';
            aiMsgDiv.innerHTML = `<strong>${this.getAiChatLabel('answer')}:</strong> ${Utils.markdownToHtml(responseText)}`;
            chatContainer.appendChild(aiMsgDiv);

            this.aiChatHistory.push({ role: 'user', content: question });
            this.aiChatHistory.push({ role: 'assistant', content: responseText });

            // Ekran okuyucuya odaklanmak için
            aiMsgDiv.setAttribute('tabindex', '-1');
            aiMsgDiv.focus();

            Accessibility.alert(responseText);

        } catch (error) {
            loadingDiv.remove();
            const errorDiv = document.createElement('div');
            errorDiv.style.color = '#ff4444';
            errorDiv.textContent = this.t('runtime.common.error', 'Hata: {error}', { error: error.message });
            chatContainer.appendChild(errorDiv);
        }
    },

    /**
     * Gemini API anahtarı olay dinleyicilerini kur
     */
    setupGeminiApiKeyEventListeners() {
        document.getElementById('gemini-api-key-confirm')?.addEventListener('click', async (e) => {
            const input = document.getElementById('gemini-api-key-input');
            const modelSelect = document.getElementById('gemini-model-select');
            const apiKey = input.value.trim();
            const model = modelSelect ? modelSelect.value : 'gemini-2.5-flash';

            if (!apiKey) {
                Accessibility.alert(this.t('runtime.dialogs.enter_api_key', 'Please enter an API key.'));
                return;
            }

            const result = await window.api.saveGeminiApiKey({ apiKey, model });
            if (result.success) {
                Accessibility.announce(this.t('runtime.dialogs.api_key_saved', 'API key and model preference were saved successfully.'));
                this.geminiApiKeyDialog.close();
            } else {
                Accessibility.alert(this.t('runtime.dialogs.api_key_save_failed', 'An error occurred while saving: {error}', { error: result.error }));
            }
        });

        document.getElementById('gemini-api-key-cancel')?.addEventListener('click', () => {
            this.geminiApiKeyDialog.close();
        });

        // Anahtarı göster/gizle
        document.getElementById('gemini-api-key-show')?.addEventListener('change', (e) => {
            const input = document.getElementById('gemini-api-key-input');
            input.type = e.target.checked ? 'text' : 'password';
            Accessibility.announce(e.target.checked
                ? this.t('runtime.dialogs.api_key_visible', 'Key is now visible.')
                : this.t('runtime.dialogs.api_key_hidden', 'Key is now hidden.'));
        });
    },

    /**
     * OpenAI API anahtarı olay dinleyicilerini kur
     */
    setupOpenAiApiKeyEventListeners() {
        document.getElementById('openai-api-key-confirm')?.addEventListener('click', async () => {
            const input = document.getElementById('openai-api-key-input');
            const apiKey = input.value.trim();

            if (!apiKey) {
                Accessibility.alert(this.t('runtime.dialogs.enter_openai_api_key', 'Lütfen OpenAI API anahtarınızı girin.'));
                return;
            }

            const result = await window.api.saveOpenAiApiKey({ apiKey });
            if (result.success) {
                Accessibility.announce(this.t('runtime.dialogs.openai_api_key_saved', 'OpenAI API anahtarı çeviri için kaydedildi.'));
                this.openAiApiKeyDialog.close();
            } else {
                Accessibility.alert(this.t('runtime.dialogs.openai_api_key_save_failed', 'OpenAI API anahtarı kaydedilirken bir hata oluştu: {error}', {
                    error: result.error
                }));
            }
        });

        document.getElementById('openai-api-key-cancel')?.addEventListener('click', () => {
            this.openAiApiKeyDialog.close();
        });

        document.getElementById('openai-api-key-show')?.addEventListener('change', (e) => {
            const input = document.getElementById('openai-api-key-input');
            input.type = e.target.checked ? 'text' : 'password';
            Accessibility.announce(e.target.checked
                ? this.t('runtime.dialogs.openai_api_key_visible', 'OpenAI anahtarı gösteriliyor.')
                : this.t('runtime.dialogs.openai_api_key_hidden', 'OpenAI anahtarı gizlendi.'));
        });
    },

    /**
     * ElevenLabs API anahtarı olay dinleyicilerini kur
     */
    setupElevenLabsApiKeyEventListeners() {
        document.getElementById('elevenlabs-api-key-confirm')?.addEventListener('click', async () => {
            const input = document.getElementById('elevenlabs-api-key-input');
            const apiKey = input.value.trim();

            if (!apiKey) {
                Accessibility.alert(this.t('runtime.dialogs.enter_elevenlabs_api_key', 'Lütfen ElevenLabs API anahtarınızı girin.'));
                return;
            }

            const result = await window.api.saveElevenLabsApiKey({ apiKey });
            if (result.success) {
                Accessibility.announce(this.t('runtime.dialogs.elevenlabs_api_key_saved', 'ElevenLabs API anahtarı canlı dublaj için kaydedildi.'));
                this.elevenLabsApiKeyDialog.close();
            } else {
                Accessibility.alert(this.t('runtime.dialogs.elevenlabs_api_key_save_failed', 'ElevenLabs API anahtarı kaydedilirken bir hata oluştu: {error}', {
                    error: result.error
                }));
            }
        });

        document.getElementById('elevenlabs-api-key-cancel')?.addEventListener('click', () => {
            this.elevenLabsApiKeyDialog.close();
        });

        document.getElementById('elevenlabs-api-key-show')?.addEventListener('change', (e) => {
            const input = document.getElementById('elevenlabs-api-key-input');
            input.type = e.target.checked ? 'text' : 'password';
            Accessibility.announce(e.target.checked
                ? this.t('runtime.dialogs.elevenlabs_api_key_visible', 'ElevenLabs anahtarı gösteriliyor.')
                : this.t('runtime.dialogs.elevenlabs_api_key_hidden', 'ElevenLabs anahtarı gizlendi.'));
        });
    },

    setupInstantVoiceTranslationEventListeners() {
        document.getElementById('instant-voice-translation-start')?.addEventListener('click', () => {
            this.startInstantVoiceTranslation().catch((error) => {
                this.stopInstantVoiceTranslation().catch(() => {});
                this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.start_failed', 'Canlı çeviri başlatılamadı: {error}', {
                    error: error?.message || error || 'unknown_error'
                }));
            });
        });
        document.getElementById('instant-voice-translation-stop')?.addEventListener('click', () => {
            this.stopInstantVoiceTranslation().catch(() => {});
        });
        document.getElementById('instant-voice-translation-save-transcript')?.addEventListener('click', () => {
            this.saveInstantVoiceTranslationTranscript().catch((error) => {
                this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.save_transcript_failed', 'Çeviri dökümü kaydedilemedi: {error}', {
                    error: error?.message || error || 'unknown_error'
                }));
            });
        });
        document.getElementById('instant-voice-translation-save-audio')?.addEventListener('click', () => {
            this.saveInstantVoiceTranslationAudio().catch((error) => {
                this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.save_translation_audio_failed', 'Çeviri sesi kaydedilemedi: {error}', {
                    error: error?.message || error || 'unknown_error'
                }));
            });
        });
        document.getElementById('instant-voice-translation-source')?.addEventListener('change', () => {
            this.updateInstantVoiceTranslationSourceControls();
        });
        document.getElementById('instant-voice-translation-conversation-mode')?.addEventListener('change', () => {
            this.updateInstantVoiceTranslationSourceControls();
        });
        document.getElementById('instant-voice-translation-text-only')?.addEventListener('change', () => {
            this.renderInstantVoiceTranslationState();
        });
        document.getElementById('instant-voice-translation-source-volume')?.addEventListener('change', () => {
            this.renderInstantVoiceTranslationState();
            this.updateInstantVoiceTranslationSourceAudioSessionVolumeLive().catch(() => {});
        });
        document.getElementById('instant-voice-translation-original-underlay')?.addEventListener('change', () => {
            this.renderInstantVoiceTranslationState();
        });
        document.getElementById('instant-voice-translation-refresh-microphones')?.addEventListener('click', () => {
            this.refreshInstantVoiceTranslationMicrophoneDevices().then(() => {
                this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.microphone_device_refreshed', 'Mikrofonlar yenilendi.'));
            }).catch((error) => {
                this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.microphone_device_refresh_failed', 'Mikrofonlar yenilenemedi: {error}', {
                    error: error?.message || error
                }));
            });
        });
        document.getElementById('instant-voice-translation-refresh-windows')?.addEventListener('click', () => {
            this.refreshInstantVoiceTranslationWindowSources().catch((error) => {
                this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.window_refresh_failed', 'Pencere listesi alınamadı: {error}', {
                    error: error?.message || error
                }));
            });
        });
        document.getElementById('instant-voice-translation-refresh-output-devices')?.addEventListener('click', () => {
            this.refreshInstantVoiceTranslationOutputDevices().then(() => {
                this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.output_device_refreshed', 'Çıkış aygıtları yenilendi.'));
            }).catch((error) => {
                this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.output_device_refresh_failed', 'Çıkış aygıtları yenilenemedi: {error}', {
                    error: error?.message || error
                }));
            });
        });
        document.getElementById('instant-voice-translation-close')?.addEventListener('click', () => {
            this.stopInstantVoiceTranslation().finally(() => {
                this.instantVoiceTranslationDialog?.close();
            });
        });
        this.instantVoiceTranslationDialog?.addEventListener('close', () => {
            this.unregisterInstantVoiceTranslationGlobalShortcut();
            this.stopInstantVoiceTranslation().catch(() => {});
        });
        window.api.onGeminiLiveTranslateEvent?.((payload) => {
            this.handleInstantVoiceTranslationGeminiEvent(payload);
        });
        window.api.onGlobalShortcutTriggered?.((accelerator) => {
            this.handleInstantVoiceTranslationGlobalShortcut(accelerator);
        });
    },

    async showInstantVoiceTranslationDialog() {
        const apiData = await window.api.getGeminiApiData();
        if (!apiData?.apiKey) {
            Accessibility.alert(this.t('dialog.instant_voice_translation.key_missing', 'Gemini API anahtarı bulunamadı. Önce Yapay Zeka menüsünden Gemini API Anahtarı öğesini açıp anahtarınızı ekleyin.'));
            return;
        }
        const sourceText = document.getElementById('instant-voice-translation-source-text');
        const translatedText = document.getElementById('instant-voice-translation-translated-text');
        const status = document.getElementById('instant-voice-translation-status');
        if (sourceText) sourceText.value = '';
        if (translatedText) translatedText.value = '';
        if (status) status.value = this.t('dialog.instant_voice_translation.ready', 'Hazır.');
        this.instantVoiceTranslationTranscriptEntries = [];
        this.instantVoiceTranslationAudioEntries = [];
        this.instantVoiceTranslationSourceAudioEntries = [];
        this.instantVoiceTranslationTranscriptStartedAt = null;
        this.instantVoiceTranslationTranscriptStoppedAt = null;
        this.instantVoiceTranslationLatestSourceText = '';
        this.populateInstantVoiceTranslationLanguages();
        this.renderInstantVoiceTranslationState();
        this.updateInstantVoiceTranslationSourceControls();
        await this.refreshInstantVoiceTranslationMicrophoneDevices();
        await this.refreshInstantVoiceTranslationOutputDevices();
        this.registerInstantVoiceTranslationGlobalShortcut();
        this.instantVoiceTranslationDialog?.showModal();
        setTimeout(() => {
            document.getElementById('instant-voice-translation-target-language')?.focus();
        }, 80);
        Accessibility.announce(this.t('dialog.instant_voice_translation.opened', 'Anlık sesli çeviri açıldı. Hedef dili seçip canlı dinlemeyi başlatabilirsiniz.'));
    },

    getInstantVoiceTranslationGlobalShortcut() {
        const actionId = 'instantVoiceTranslationGlobalToggle';
        const binding = window.Keyboard?.getActionShortcut?.(actionId);
        return Array.isArray(binding) ? binding[0] : (binding || 'Alt+Ctrl+D');
    },

    normalizeInstantVoiceTranslationGlobalShortcut(accelerator = '') {
        const normalized = String(accelerator || '').trim();
        if (!normalized) return '';
        return normalized
            .replace(/\bCommandOrControl\b/gi, 'Ctrl')
            .replace(/\bCmdOrCtrl\b/gi, 'Ctrl')
            .replace(/\bCmd\b/gi, 'Ctrl')
            .replace(/\bControl\b/gi, 'Ctrl')
            .split('+')
            .map((part) => part.trim())
            .filter(Boolean)
            .join('+');
    },

    populateInstantVoiceTranslationLanguages() {
        const select = document.getElementById('instant-voice-translation-target-language');
        if (!select || select.dataset.populated === 'true') return;
        const currentValue = select.value || 'tr';
        select.innerHTML = '';
        this.instantVoiceTranslationLanguages.forEach(([value, key, fallback]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = this.t(`dialog.instant_voice_translation.${key}`, fallback);
            select.appendChild(option);
        });
        select.value = this.instantVoiceTranslationLanguages.some(([value]) => value === currentValue)
            ? currentValue
            : 'tr';
        select.dataset.populated = 'true';
    },

    playInstantVoiceTranslationShortcutTone(kind = 'start') {
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return;
            if (!this.instantVoiceTranslationShortcutToneContext || this.instantVoiceTranslationShortcutToneContext.state === 'closed') {
                this.instantVoiceTranslationShortcutToneContext = new AudioContextClass();
            }
            const audioContext = this.instantVoiceTranslationShortcutToneContext;
            audioContext.resume().catch(() => {});
            const oscillator = audioContext.createOscillator();
            const gain = audioContext.createGain();
            const now = audioContext.currentTime;
            const isStart = kind === 'start';
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(isStart ? 880 : 330, now);
            oscillator.frequency.exponentialRampToValueAtTime(isStart ? 1320 : 220, now + 0.16);
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
            oscillator.connect(gain);
            gain.connect(audioContext.destination);
            oscillator.start(now);
            oscillator.stop(now + 0.2);
        } catch (_error) {}
    },

    registerInstantVoiceTranslationGlobalShortcut() {
        const accelerator = this.normalizeInstantVoiceTranslationGlobalShortcut(this.getInstantVoiceTranslationGlobalShortcut());
        if (!accelerator) return;
        this.instantVoiceTranslationGlobalShortcut = accelerator;
        this.instantVoiceTranslationGlobalShortcutRegistered = true;
        window.api.registerGlobalShortcut?.({
            accelerator,
            focusWindowOnTrigger: false
        }).catch(() => {
            this.instantVoiceTranslationGlobalShortcutRegistered = false;
        });
    },

    unregisterInstantVoiceTranslationGlobalShortcut() {
        const accelerator = this.instantVoiceTranslationGlobalShortcut;
        this.instantVoiceTranslationGlobalShortcut = '';
        this.instantVoiceTranslationGlobalShortcutRegistered = false;
        if (accelerator) {
            window.api.unregisterGlobalShortcut?.(accelerator).catch(() => {});
        }
    },

    handleInstantVoiceTranslationGlobalShortcut(accelerator = '') {
        if (!this.instantVoiceTranslationDialog?.open) return;
        const received = this.normalizeInstantVoiceTranslationGlobalShortcut(accelerator);
        const expected = this.normalizeInstantVoiceTranslationGlobalShortcut(this.instantVoiceTranslationGlobalShortcut || this.getInstantVoiceTranslationGlobalShortcut());
        if (!received || received !== expected) return;
        if (this.instantVoiceTranslationRunning) {
            this.stopInstantVoiceTranslation()
                .then(() => this.playInstantVoiceTranslationShortcutTone('stop'))
                .catch(() => {});
        } else {
            this.startInstantVoiceTranslation().catch((error) => {
                this.stopInstantVoiceTranslation().catch(() => {});
                this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.start_failed', 'Canlı çeviri başlatılamadı: {error}', {
                    error: error?.message || error || 'unknown_error'
                }));
            }).then(() => {
                if (this.instantVoiceTranslationRunning) {
                    this.playInstantVoiceTranslationShortcutTone('start');
                }
            });
        }
    },

    setInstantVoiceTranslationStatus(message, { announce = true } = {}) {
        const status = document.getElementById('instant-voice-translation-status');
        if (status) {
            status.value = message || '';
        }
        if (message && announce) {
            Accessibility.announce(message);
        }
    },

    addInstantVoiceTranslationDiagnostic(message, details = {}) {
        const time = new Date().toLocaleTimeString();
        const line = `[${time}] ${message}`;
        this.instantVoiceTranslationDiagnostics.push(line);
        if (this.instantVoiceTranslationDiagnostics.length > 40) {
            this.instantVoiceTranslationDiagnostics.splice(0, this.instantVoiceTranslationDiagnostics.length - 40);
        }
        try {
            window.api.send('broadcast-room-log', {
                event: 'instant-voice-translation',
                at: new Date().toISOString(),
                message,
                ...details
            });
        } catch (_error) {}
    },

    renderInstantVoiceTranslationState() {
        const startButton = document.getElementById('instant-voice-translation-start');
        const stopButton = document.getElementById('instant-voice-translation-stop');
        const languageSelect = document.getElementById('instant-voice-translation-target-language');
        const sourceSelect = document.getElementById('instant-voice-translation-source');
        const sourceVolumeSelect = document.getElementById('instant-voice-translation-source-volume');
        const translationVolumeSelect = document.getElementById('instant-voice-translation-translation-volume');
        const windowSelect = document.getElementById('instant-voice-translation-window');
        const microphoneSelect = document.getElementById('instant-voice-translation-microphone-device');
        const outputDeviceSelect = document.getElementById('instant-voice-translation-output-device');
        const conversationMode = document.getElementById('instant-voice-translation-conversation-mode');
        const textOnlyMode = document.getElementById('instant-voice-translation-text-only');
        const originalUnderlay = document.getElementById('instant-voice-translation-original-underlay');
        const originalUnderlayLevel = document.getElementById('instant-voice-translation-original-underlay-level');
        const refreshWindowsButton = document.getElementById('instant-voice-translation-refresh-windows');
        const refreshMicrophonesButton = document.getElementById('instant-voice-translation-refresh-microphones');
        const refreshOutputButton = document.getElementById('instant-voice-translation-refresh-output-devices');
        const saveTranscriptButton = document.getElementById('instant-voice-translation-save-transcript');
        const saveAudioButton = document.getElementById('instant-voice-translation-save-audio');
        if (startButton) startButton.disabled = this.instantVoiceTranslationRunning;
        if (stopButton) stopButton.disabled = !this.instantVoiceTranslationRunning;
        if (languageSelect) languageSelect.disabled = this.instantVoiceTranslationRunning;
        if (sourceSelect) sourceSelect.disabled = this.instantVoiceTranslationRunning;
        if (sourceVolumeSelect) sourceVolumeSelect.disabled = false;
        if (translationVolumeSelect) translationVolumeSelect.disabled = false;
        if (conversationMode) conversationMode.disabled = this.instantVoiceTranslationRunning;
        if (textOnlyMode) textOnlyMode.disabled = this.instantVoiceTranslationRunning;
        if (originalUnderlay) originalUnderlay.disabled = this.instantVoiceTranslationRunning;
        if (originalUnderlayLevel) originalUnderlayLevel.disabled = this.instantVoiceTranslationRunning || !Boolean(originalUnderlay?.checked);
        if (windowSelect) windowSelect.disabled = this.instantVoiceTranslationRunning;
        if (microphoneSelect) microphoneSelect.disabled = this.instantVoiceTranslationRunning;
        if (outputDeviceSelect) outputDeviceSelect.disabled = this.instantVoiceTranslationRunning;
        if (refreshWindowsButton) refreshWindowsButton.disabled = this.instantVoiceTranslationRunning;
        if (refreshMicrophonesButton) refreshMicrophonesButton.disabled = this.instantVoiceTranslationRunning;
        if (refreshOutputButton) refreshOutputButton.disabled = this.instantVoiceTranslationRunning;
        if (saveTranscriptButton) saveTranscriptButton.disabled = this.instantVoiceTranslationRunning || !this.instantVoiceTranslationTranscriptEntries.length;
        if (saveAudioButton) saveAudioButton.disabled = this.instantVoiceTranslationRunning || !this.instantVoiceTranslationAudioEntries.length;
        if (!this.instantVoiceTranslationRunning) {
            const status = document.getElementById('instant-voice-translation-status');
            if (status && !status.value) {
                status.value = this.t('dialog.instant_voice_translation.ready', 'Hazır.');
            }
        }
    },

    extractInstantVoiceTranslationWindowPid(source = {}) {
        const directPid = Number(source.processId || source.pid || 0);
        if (Number.isFinite(directPid) && directPid > 0) {
            return Math.trunc(directPid);
        }
        const id = String(source.id || '');
        const parts = id.split(':');
        const pid = Number(parts[2] || 0);
        return Number.isFinite(pid) && pid > 0 ? pid : 0;
    },

    async refreshInstantVoiceTranslationWindowSources() {
        const select = document.getElementById('instant-voice-translation-window');
        if (!select) return;
        select.innerHTML = '';
        const result = await window.api.getDesktopSources?.({
            types: ['window'],
            fetchWindowIcons: false,
            thumbnailSize: { width: 0, height: 0 }
        });
        let sources = Array.isArray(result?.sources) ? result.sources : [];
        this.addInstantVoiceTranslationDiagnostic('Pencere kaynakları alındı.', {
            sourceCount: sources.length,
            sourcePreview: sources.slice(0, 6).map((source) => ({
                id: String(source.id || ''),
                name: String(source.name || ''),
                processId: source.processId || 0
            }))
        });
        let usableSources = sources
            .map((source) => ({
                id: String(source.id || ''),
                name: String(source.name || '').trim(),
                pid: this.extractInstantVoiceTranslationWindowPid(source),
                processName: String(source.processName || '').trim()
            }))
            .filter((source) => source.name);

        if (!usableSources.length && window.api.getWindowProcessSources) {
            const fallbackResult = await window.api.getWindowProcessSources();
            sources = Array.isArray(fallbackResult?.sources) ? fallbackResult.sources : [];
            this.addInstantVoiceTranslationDiagnostic('Windows pencere süreçleri alındı.', {
                sourceCount: sources.length,
                sourcePreview: sources.slice(0, 6).map((source) => ({
                    id: String(source.id || ''),
                    name: String(source.name || ''),
                    processId: source.processId || 0
                }))
            });
            usableSources = sources
                .map((source) => ({
                    id: String(source.id || ''),
                    name: String(source.name || '').trim(),
                    pid: this.extractInstantVoiceTranslationWindowPid(source),
                    processName: String(source.processName || '').trim()
                }))
                .filter((source) => source.name);
        }

        if (!usableSources.length) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = this.t('dialog.instant_voice_translation.window_none', 'Dinlenebilir pencere bulunamadı');
            select.appendChild(option);
            return;
        }

        usableSources.forEach((source) => {
            const option = document.createElement('option');
            option.value = String(source.pid);
            option.textContent = source.name;
            option.dataset.sourceId = source.id;
            option.dataset.windowTitle = source.name;
            option.dataset.processName = source.processName || '';
            select.appendChild(option);
        });
    },

    async refreshInstantVoiceTranslationOutputDevices() {
        const select = document.getElementById('instant-voice-translation-output-device');
        if (!select) return;
        const previousValue = select.value || 'default';
        select.innerHTML = '';
        const defaultOption = document.createElement('option');
        defaultOption.value = 'default';
        defaultOption.textContent = this.t('dialog.instant_voice_translation.output_device_default', 'Sistem varsayılanı');
        select.appendChild(defaultOption);
        try {
            const devices = await navigator.mediaDevices?.enumerateDevices?.();
            (Array.isArray(devices) ? devices : [])
                .filter((device) => device.kind === 'audiooutput')
                .forEach((device, index) => {
                    const option = document.createElement('option');
                    option.value = device.deviceId || 'default';
                    option.textContent = device.label || this.t('dialog.instant_voice_translation.output_device_named_fallback', 'Ses çıkışı {number}', {
                        number: index + 1
                    });
                    select.appendChild(option);
                });
        } catch (_error) {}
        if ([...select.options].some((option) => option.value === previousValue)) {
            select.value = previousValue;
        }
    },

    async refreshInstantVoiceTranslationMicrophoneDevices() {
        const select = document.getElementById('instant-voice-translation-microphone-device');
        if (!select) return;
        const previousValue = select.value || 'default';
        select.innerHTML = '';
        const defaultOption = document.createElement('option');
        defaultOption.value = 'default';
        defaultOption.textContent = this.t('dialog.instant_voice_translation.microphone_device_default', 'Sistem varsayılanı');
        select.appendChild(defaultOption);
        try {
            const devices = await navigator.mediaDevices?.enumerateDevices?.();
            (Array.isArray(devices) ? devices : [])
                .filter((device) => device.kind === 'audioinput')
                .forEach((device, index) => {
                    const option = document.createElement('option');
                    option.value = device.deviceId || 'default';
                    option.textContent = device.label || this.t('dialog.instant_voice_translation.microphone_device_named_fallback', 'Mikrofon {number}', {
                        number: index + 1
                    });
                    select.appendChild(option);
                });
        } catch (_error) {}
        if ([...select.options].some((option) => option.value === previousValue)) {
            select.value = previousValue;
        }
    },

    updateInstantVoiceTranslationSourceControls() {
        const sourceSelect = document.getElementById('instant-voice-translation-source');
        const group = document.getElementById('instant-voice-translation-window-group');
        const sourceVolumeGroup = document.getElementById('instant-voice-translation-source-volume-group');
        const microphoneGroup = document.getElementById('instant-voice-translation-microphone-group');
        const originalUnderlayGroup = document.getElementById('instant-voice-translation-original-underlay-group');
        const conversationHint = document.getElementById('instant-voice-translation-conversation-hint');
        const virtualMicHint = document.getElementById('instant-voice-translation-virtual-mic-hint');
        const textOnlyGroup = document.getElementById('instant-voice-translation-text-only-group');
        const conversationMode = Boolean(document.getElementById('instant-voice-translation-conversation-mode')?.checked);
        const shouldShowWindowList = sourceSelect?.value === 'native-window-audio';
        const shouldShowMicrophoneList = conversationMode && (!sourceSelect || sourceSelect.value === 'native-microphone');
        if (group) {
            group.classList.toggle('hidden', !shouldShowWindowList);
        }
        sourceVolumeGroup?.classList.toggle('hidden', conversationMode || !shouldShowWindowList);
        if (microphoneGroup) {
            microphoneGroup.classList.toggle('hidden', !shouldShowMicrophoneList);
        }
        originalUnderlayGroup?.classList.toggle('hidden', !conversationMode);
        conversationHint?.classList.toggle('hidden', !conversationMode);
        virtualMicHint?.classList.toggle('hidden', !conversationMode);
        textOnlyGroup?.classList.toggle('hidden', conversationMode);
        if (shouldShowWindowList) {
            this.refreshInstantVoiceTranslationWindowSources().catch((error) => {
                this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.window_refresh_failed', 'Pencere listesi alınamadı: {error}', {
                    error: error?.message || error
                }));
            });
        }
    },

    encodeInstantVoiceTranslationAudio(samples) {
        const channel = samples && typeof samples.getChannelData === 'function'
            ? samples.getChannelData(0)
            : samples;
        if (!channel?.length) {
            return '';
        }
        const bytes = new Uint8Array(channel.length * 2);
        for (let index = 0; index < channel.length; index += 1) {
            const sample = Math.max(-1, Math.min(1, channel[index]));
            const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
            const value = Math.round(intSample);
            bytes[index * 2] = value & 0xff;
            bytes[index * 2 + 1] = (value >> 8) & 0xff;
        }
        let binary = '';
        const chunkSize = 0x8000;
        for (let index = 0; index < bytes.length; index += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
        }
        return btoa(binary);
    },

    startInstantVoiceTranslationAudioSender() {
        if (this.instantVoiceTranslationAudioSendTimer) {
            clearInterval(this.instantVoiceTranslationAudioSendTimer);
        }
        this.instantVoiceTranslationAudioSendTimer = setInterval(() => {
            if (!this.instantVoiceTranslationRunning) return;
            const samples = this.instantVoiceTranslationPendingAudioChunks.shift();
            if (!samples) return;
            const audioBase64 = this.encodeInstantVoiceTranslationAudio(samples);
            if (audioBase64) {
                this.instantVoiceTranslationSentChunkCount += 1;
                if (this.instantVoiceTranslationSentChunkCount <= 5 || this.instantVoiceTranslationSentChunkCount % 20 === 0) {
                    this.addInstantVoiceTranslationDiagnostic(this.t('dialog.instant_voice_translation.diagnostic_chunk_sent', 'Ses parçası Gemini’ye gönderildi: {count}', {
                        count: this.instantVoiceTranslationSentChunkCount
                    }), { count: this.instantVoiceTranslationSentChunkCount });
                }
                window.api.sendGeminiLiveTranslateAudioChunk({
                    audioBase64,
                    sampleRate: 16000
                });
            }
        }, 120);
    },

    getInstantVoiceTranslationRecorderMimeType() {
        if (typeof MediaRecorder === 'undefined') return '';
        const candidates = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/ogg'
        ];
        return candidates.find((mimeType) => MediaRecorder.isTypeSupported?.(mimeType)) || '';
    },

    async handleInstantVoiceTranslationRecorderBlob(blob) {
        if (!this.instantVoiceTranslationRunning || !blob || blob.size <= 0) return;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        try {
            if (!this.instantVoiceTranslationDecodeContext || this.instantVoiceTranslationDecodeContext.state === 'closed') {
                this.instantVoiceTranslationDecodeContext = new AudioContextClass();
            }
            const arrayBuffer = await blob.arrayBuffer();
            const audioBuffer = await this.instantVoiceTranslationDecodeContext.decodeAudioData(arrayBuffer.slice(0));
            if (!this.instantVoiceTranslationRunning) return;
            this.instantVoiceTranslationQueuedChunkCount += 1;
            if (this.instantVoiceTranslationQueuedChunkCount <= 3 || this.instantVoiceTranslationQueuedChunkCount % 10 === 0) {
                this.addInstantVoiceTranslationDiagnostic(this.t('dialog.instant_voice_translation.diagnostic_chunk_queued', 'Mikrofondan ses parçası kuyruğa alındı: {count}', {
                    count: this.instantVoiceTranslationQueuedChunkCount
                }), {
                    count: this.instantVoiceTranslationQueuedChunkCount,
                    duration: audioBuffer.duration,
                    sampleRate: audioBuffer.sampleRate
                });
            }
            const audioBase64 = this.encodeInstantVoiceTranslationAudio(audioBuffer);
            if (!audioBase64) return;
            this.instantVoiceTranslationSentChunkCount += 1;
            if (this.instantVoiceTranslationSentChunkCount <= 5 || this.instantVoiceTranslationSentChunkCount % 10 === 0) {
                this.addInstantVoiceTranslationDiagnostic(this.t('dialog.instant_voice_translation.diagnostic_chunk_sent', 'Ses parçası Gemini’ye gönderildi: {count}', {
                    count: this.instantVoiceTranslationSentChunkCount
                }), {
                    count: this.instantVoiceTranslationSentChunkCount,
                    sampleRate: audioBuffer.sampleRate
                });
            }
            window.api.sendGeminiLiveTranslateAudioChunk({
                audioBase64,
                sampleRate: audioBuffer.sampleRate || 48000
            });
        } catch (error) {
            this.addInstantVoiceTranslationDiagnostic(this.t('dialog.instant_voice_translation.diagnostic_chunk_decode_failed', 'Mikrofon parçası çözülemedi: {error}', {
                error: error?.message || error
            }), { error: error?.message || String(error) });
        }
    },

    parseInstantVoiceTranslationSampleRate(mimeType = '') {
        const match = String(mimeType || '').match(/rate=(\d+)/i);
        const sampleRate = Number(match?.[1] || 24000);
        return Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 24000;
    },

    base64ToArrayBuffer(base64) {
        const binary = atob(String(base64 || ''));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes.buffer;
    },

    normalizeInstantVoiceTranslationSpeechText(value = '') {
        return String(value || '')
            .toLocaleLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    },

    cleanInstantVoiceTranslationTextOnlyAnnouncement(value = '') {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .replace(/\s+([,.;:!?])/g, '$1')
            .replace(/([¿¡])\s+/g, '$1')
            .trim();
    },

    smoothInstantVoiceTranslationTextOnlyAnnouncementCasing(value = '') {
        const text = this.cleanInstantVoiceTranslationTextOnlyAnnouncement(value);
        const letters = text.match(/\p{L}/gu) || [];
        if (letters.length < 6) return text;
        const uppercaseLetters = letters.filter((letter) => letter === letter.toLocaleUpperCase() && letter !== letter.toLocaleLowerCase());
        if (uppercaseLetters.length / letters.length < 0.85) return text;
        const locale = document.documentElement?.lang || navigator.language || 'tr';
        const lowered = text.toLocaleLowerCase(locale);
        return lowered.replace(/(^|[.!?]\s+)(\p{L})/gu, (match, prefix, letter) => `${prefix}${letter.toLocaleUpperCase(locale)}`);
    },

    findInstantVoiceTranslationSentenceBoundary(value = '') {
        const text = String(value || '');
        let boundary = 0;
        const regex = /[.!?。！？]+(?:["'”’)\]]+)?(?=\s|$)/gu;
        let match = regex.exec(text);
        while (match) {
            boundary = match.index + match[0].length;
            match = regex.exec(text);
        }
        return boundary;
    },

    splitInstantVoiceTranslationReadableTextOnlyChunk(value = '') {
        const text = this.cleanInstantVoiceTranslationTextOnlyAnnouncement(value);
        if (!text) return { readyText: '', remainingText: '' };
        const boundaryIndex = this.findInstantVoiceTranslationSentenceBoundary(text);
        if (boundaryIndex > 0) {
            return {
                readyText: text.slice(0, boundaryIndex),
                remainingText: this.cleanInstantVoiceTranslationTextOnlyAnnouncement(text.slice(boundaryIndex))
            };
        }
        const lastSpaceIndex = text.lastIndexOf(' ');
        if (lastSpaceIndex >= 8 && text.length - lastSpaceIndex <= 18) {
            return {
                readyText: text.slice(0, lastSpaceIndex),
                remainingText: this.cleanInstantVoiceTranslationTextOnlyAnnouncement(text.slice(lastSpaceIndex + 1))
            };
        }
        return { readyText: text, remainingText: '' };
    },

    clearInstantVoiceTranslationTextOnlyAnnouncementTimer() {
        if (!this.instantVoiceTranslationTextOnlyAnnouncementTimer) return;
        clearTimeout(this.instantVoiceTranslationTextOnlyAnnouncementTimer);
        this.instantVoiceTranslationTextOnlyAnnouncementTimer = null;
    },

    resetInstantVoiceTranslationTextOnlyAnnouncementBuffer() {
        this.clearInstantVoiceTranslationTextOnlyAnnouncementTimer();
        this.instantVoiceTranslationTextOnlyAnnouncementBuffer = '';
        this.instantVoiceTranslationTextOnlyAnnouncementStartedAt = 0;
        this.instantVoiceTranslationTextOnlyAnnouncementSpokenText = '';
        this.instantVoiceTranslationTextOnlyAnnouncementLastInputText = '';
    },

    getInstantVoiceTranslationTextOnlyAnnouncementDelta(previous = '', current = '') {
        const oldText = this.cleanInstantVoiceTranslationTextOnlyAnnouncement(previous);
        const newText = this.cleanInstantVoiceTranslationTextOnlyAnnouncement(current);
        if (!newText) return { text: '', lastInputText: oldText };
        if (!oldText) return { text: newText, lastInputText: newText };
        if (newText === oldText || oldText.startsWith(newText)) {
            return { text: '', lastInputText: oldText };
        }
        if (newText.startsWith(oldText)) {
            const suffix = this.cleanInstantVoiceTranslationTextOnlyAnnouncement(newText.slice(oldText.length));
            return {
                text: suffix && !this.normalizeInstantVoiceTranslationSpeechText(suffix) ? '' : suffix,
                lastInputText: newText
            };
        }
        const minOverlap = Math.min(12, oldText.length, newText.length);
        for (let length = Math.min(oldText.length, newText.length); length >= minOverlap; length -= 1) {
            if (oldText.slice(-length) === newText.slice(0, length)) {
                return {
                    text: this.cleanInstantVoiceTranslationTextOnlyAnnouncement(newText.slice(length)),
                    lastInputText: newText
                };
            }
        }
        const normalizedOld = this.normalizeInstantVoiceTranslationSpeechText(oldText);
        const normalizedNew = this.normalizeInstantVoiceTranslationSpeechText(newText);
        if (normalizedOld && normalizedNew && (normalizedNew === normalizedOld || normalizedOld.startsWith(normalizedNew))) {
            return { text: '', lastInputText: oldText };
        }
        return { text: newText, lastInputText: newText };
    },

    announceInstantVoiceTranslationTextOnlyChunk(text = '', { force = false } = {}) {
        const cleanText = this.smoothInstantVoiceTranslationTextOnlyAnnouncementCasing(text);
        if (!cleanText) return false;
        const normalized = this.normalizeInstantVoiceTranslationSpeechText(cleanText);
        if (!force && (!normalized || normalized === this.instantVoiceTranslationLastTextOnlyAnnouncement)) {
            return false;
        }
        this.instantVoiceTranslationLastTextOnlyAnnouncement = normalized;
        this.instantVoiceTranslationTextOnlyAnnouncementSpokenText = this.cleanInstantVoiceTranslationTextOnlyAnnouncement(this.instantVoiceTranslationTextOnlyAnnouncementSpokenText
            ? `${this.instantVoiceTranslationTextOnlyAnnouncementSpokenText} ${cleanText}`
            : cleanText);
        Accessibility.announce(cleanText);
        return true;
    },

    flushInstantVoiceTranslationTextOnlyAnnouncement({ force = false } = {}) {
        this.clearInstantVoiceTranslationTextOnlyAnnouncementTimer();
        const text = this.cleanInstantVoiceTranslationTextOnlyAnnouncement(this.instantVoiceTranslationTextOnlyAnnouncementBuffer);
        if (!text) {
            this.instantVoiceTranslationTextOnlyAnnouncementBuffer = '';
            this.instantVoiceTranslationTextOnlyAnnouncementStartedAt = 0;
            return;
        }
        const { readyText, remainingText } = force
            ? this.splitInstantVoiceTranslationReadableTextOnlyChunk(text)
            : { readyText: text, remainingText: '' };
        if (!readyText || !this.announceInstantVoiceTranslationTextOnlyChunk(readyText, { force })) {
            return;
        }
        this.instantVoiceTranslationTextOnlyAnnouncementBuffer = this.cleanInstantVoiceTranslationTextOnlyAnnouncement(remainingText);
        this.instantVoiceTranslationTextOnlyAnnouncementStartedAt = this.instantVoiceTranslationTextOnlyAnnouncementBuffer ? Date.now() : 0;
        if (this.instantVoiceTranslationTextOnlyAnnouncementBuffer) {
            this.instantVoiceTranslationTextOnlyAnnouncementTimer = setTimeout(() => {
                this.flushInstantVoiceTranslationTextOnlyAnnouncement({ force: true });
            }, 900);
        }
    },

    queueInstantVoiceTranslationTextOnlyAnnouncement(value = '', { force = false } = {}) {
        if (!this.isInstantVoiceTranslationTextOnlyModeEnabled()) return;
        const incomingText = this.cleanInstantVoiceTranslationTextOnlyAnnouncement(value);
        const delta = this.getInstantVoiceTranslationTextOnlyAnnouncementDelta(this.instantVoiceTranslationTextOnlyAnnouncementLastInputText, incomingText);
        let text = delta.text;
        this.instantVoiceTranslationTextOnlyAnnouncementLastInputText = delta.lastInputText;
        if (!text) {
            const pendingText = this.cleanInstantVoiceTranslationTextOnlyAnnouncement(this.instantVoiceTranslationTextOnlyAnnouncementBuffer);
            if (pendingText
                && this.normalizeInstantVoiceTranslationSpeechText(pendingText) === this.normalizeInstantVoiceTranslationSpeechText(incomingText)
                && this.findInstantVoiceTranslationSentenceBoundary(incomingText) > 0) {
                this.clearInstantVoiceTranslationTextOnlyAnnouncementTimer();
                this.instantVoiceTranslationTextOnlyAnnouncementBuffer = incomingText;
                const boundaryIndex = this.findInstantVoiceTranslationSentenceBoundary(this.instantVoiceTranslationTextOnlyAnnouncementBuffer);
                const readyText = this.instantVoiceTranslationTextOnlyAnnouncementBuffer.slice(0, boundaryIndex);
                const remainingText = this.instantVoiceTranslationTextOnlyAnnouncementBuffer.slice(boundaryIndex);
                this.announceInstantVoiceTranslationTextOnlyChunk(readyText, { force: true });
                this.instantVoiceTranslationTextOnlyAnnouncementBuffer = this.cleanInstantVoiceTranslationTextOnlyAnnouncement(remainingText);
                this.instantVoiceTranslationTextOnlyAnnouncementStartedAt = this.instantVoiceTranslationTextOnlyAnnouncementBuffer ? Date.now() : 0;
            }
            return;
        }
        const spokenText = this.cleanInstantVoiceTranslationTextOnlyAnnouncement(this.instantVoiceTranslationTextOnlyAnnouncementSpokenText);
        if (spokenText && text.startsWith(spokenText)) {
            text = this.cleanInstantVoiceTranslationTextOnlyAnnouncement(text.slice(spokenText.length));
            if (!text) return;
        }
        const normalized = this.normalizeInstantVoiceTranslationSpeechText(text);
        if (!normalized || normalized === this.instantVoiceTranslationLastTextOnlyAnnouncement) return;

        const previous = this.cleanInstantVoiceTranslationTextOnlyAnnouncement(this.instantVoiceTranslationTextOnlyAnnouncementBuffer);
        let nextText = text;
        if (previous) {
            const previousNormalized = this.normalizeInstantVoiceTranslationSpeechText(previous);
            if (normalized.startsWith(previousNormalized)) {
                nextText = text;
            } else if (previousNormalized && previousNormalized.startsWith(normalized)) {
                nextText = previous;
            } else {
                nextText = `${previous} ${text}`;
            }
        }

        this.instantVoiceTranslationTextOnlyAnnouncementBuffer = this.cleanInstantVoiceTranslationTextOnlyAnnouncement(nextText);
        if (!this.instantVoiceTranslationTextOnlyAnnouncementStartedAt) {
            this.instantVoiceTranslationTextOnlyAnnouncementStartedAt = Date.now();
        }

        if (force) {
            this.flushInstantVoiceTranslationTextOnlyAnnouncement({ force: true });
            return;
        }

        const boundaryIndex = this.findInstantVoiceTranslationSentenceBoundary(this.instantVoiceTranslationTextOnlyAnnouncementBuffer);
        if (boundaryIndex > 0) {
            this.clearInstantVoiceTranslationTextOnlyAnnouncementTimer();
            const readyText = this.instantVoiceTranslationTextOnlyAnnouncementBuffer.slice(0, boundaryIndex);
            const pendingText = this.instantVoiceTranslationTextOnlyAnnouncementBuffer.slice(boundaryIndex);
            this.announceInstantVoiceTranslationTextOnlyChunk(readyText, { force: true });
            this.instantVoiceTranslationTextOnlyAnnouncementBuffer = this.cleanInstantVoiceTranslationTextOnlyAnnouncement(pendingText);
            this.instantVoiceTranslationTextOnlyAnnouncementStartedAt = this.instantVoiceTranslationTextOnlyAnnouncementBuffer ? Date.now() : 0;
            if (this.instantVoiceTranslationTextOnlyAnnouncementBuffer) {
                this.instantVoiceTranslationTextOnlyAnnouncementTimer = setTimeout(() => {
                    this.flushInstantVoiceTranslationTextOnlyAnnouncement({ force: true });
                }, 900);
            }
            return;
        }

        const waitedTooLong = Date.now() - this.instantVoiceTranslationTextOnlyAnnouncementStartedAt >= 2600;
        if (waitedTooLong) {
            this.flushInstantVoiceTranslationTextOnlyAnnouncement({ force: true });
            return;
        }

        this.clearInstantVoiceTranslationTextOnlyAnnouncementTimer();
        this.instantVoiceTranslationTextOnlyAnnouncementTimer = setTimeout(() => {
            this.flushInstantVoiceTranslationTextOnlyAnnouncement({ force: true });
        }, 900);
    },

    updateInstantVoiceTranslationTextOnlyDisplay(textarea, value = '') {
        if (!textarea) return;
        const incomingText = this.cleanInstantVoiceTranslationTextOnlyAnnouncement(value);
        if (!incomingText) return;
        const currentText = this.cleanInstantVoiceTranslationTextOnlyAnnouncement(textarea.value);
        if (!currentText || incomingText.startsWith(currentText)) {
            textarea.value = incomingText;
            return;
        }
        if (currentText.startsWith(incomingText)) {
            return;
        }
        const delta = this.getInstantVoiceTranslationTextOnlyAnnouncementDelta(currentText, incomingText);
        const nextText = delta.text
            ? this.cleanInstantVoiceTranslationTextOnlyAnnouncement(`${currentText} ${delta.text}`)
            : currentText;
        textarea.value = nextText || incomingText;
    },

    shouldSuppressInstantVoiceTranslationAudio(payload = {}) {
        const transcript = this.normalizeInstantVoiceTranslationSpeechText(payload.transcript);
        const translatedText = this.normalizeInstantVoiceTranslationSpeechText(payload.translatedText);
        if (!transcript || !translatedText) {
            return false;
        }
        return transcript === translatedText || transcript.includes(translatedText) || translatedText.includes(transcript);
    },

    isInstantVoiceTranslationConversationModeEnabled() {
        return Boolean(document.getElementById('instant-voice-translation-conversation-mode')?.checked);
    },

    isInstantVoiceTranslationTextOnlyModeEnabled() {
        return !this.isInstantVoiceTranslationConversationModeEnabled()
            && Boolean(document.getElementById('instant-voice-translation-text-only')?.checked);
    },

    isInstantVoiceTranslationOriginalUnderlayEnabled() {
        return this.isInstantVoiceTranslationConversationModeEnabled()
            && Boolean(document.getElementById('instant-voice-translation-original-underlay')?.checked);
    },

    getInstantVoiceTranslationOriginalUnderlayGain() {
        const value = Number(document.getElementById('instant-voice-translation-original-underlay-level')?.value || 0.2);
        return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.2;
    },

    getInstantVoiceTranslationSourceAudioSessionVolume() {
        const value = Number(document.getElementById('instant-voice-translation-source-volume')?.value || 1);
        return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
    },

    async applyInstantVoiceTranslationSourceAudioSessionVolume(targetProcessId, targetWindowTitle = '', targetProcessName = '', targetWindowSourceId = '') {
        const volume = this.getInstantVoiceTranslationSourceAudioSessionVolume();
        const pid = Number(targetProcessId || 0);
        if (volume >= 0.999) {
            return null;
        }
        if (!pid && !targetWindowTitle && !targetProcessName && !targetWindowSourceId) {
            return { success: false, error: 'target_process_id_required' };
        }
        if (typeof window.api?.setInstantVoiceTranslationAudioSessionVolume !== 'function') {
            return null;
        }
        const result = await window.api.setInstantVoiceTranslationAudioSessionVolume({
            targetProcessId: pid,
            targetWindowTitle,
            targetProcessName,
            targetWindowSourceId,
            volume
        });
        if (result?.success && Number.isFinite(Number(result.previousVolume))) {
            if (!this.instantVoiceTranslationSourceAudioSessionRestore) {
                this.instantVoiceTranslationSourceAudioSessionRestore = {
                    targetProcessId: Number(result.targetProcessId || pid),
                    targetWindowTitle,
                    targetProcessName,
                    targetWindowSourceId,
                    volume: Math.max(0, Math.min(1, Number(result.previousVolume)))
                };
            }
            return result;
        }
        return result || { success: false, error: 'audio_session_volume_failed' };
    },

    async updateInstantVoiceTranslationSourceAudioSessionVolumeLive() {
        if (!this.instantVoiceTranslationRunning || this.isInstantVoiceTranslationConversationModeEnabled()) {
            return;
        }
        const sourceSelect = document.getElementById('instant-voice-translation-source');
        const windowSelect = document.getElementById('instant-voice-translation-window');
        if (sourceSelect?.value !== 'native-window-audio') {
            return;
        }
        const selectedWindowOption = windowSelect?.selectedOptions?.[0] || null;
        const selectedWindowTitle = String(selectedWindowOption?.dataset?.windowTitle || selectedWindowOption?.textContent || this.instantVoiceTranslationSourceAudioSessionRestore?.targetWindowTitle || '').trim();
        const selectedWindowProcessName = String(selectedWindowOption?.dataset?.processName || this.instantVoiceTranslationSourceAudioSessionRestore?.targetProcessName || '').trim();
        const selectedWindowSourceId = String(selectedWindowOption?.dataset?.sourceId || this.instantVoiceTranslationSourceAudioSessionRestore?.targetWindowSourceId || '').trim();
        const pid = Number(windowSelect?.value || this.instantVoiceTranslationSourceAudioSessionRestore?.targetProcessId || 0);
        if (!pid && !selectedWindowTitle && !selectedWindowProcessName && !selectedWindowSourceId) {
            return;
        }
        const result = await this.applyInstantVoiceTranslationSourceAudioSessionVolume(
            pid,
            selectedWindowTitle,
            selectedWindowProcessName,
            selectedWindowSourceId
        ).catch((error) => ({
            success: false,
            error: error?.message || String(error)
        }));
        if (result && !result.success) {
            this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.source_volume_failed', 'Dinlenen uygulamanın ses düzeyi değiştirilemedi: {error}', {
                error: result.error || 'audio_session_not_found'
            }));
        }
    },

    async restoreInstantVoiceTranslationSourceAudioSessionVolume() {
        const restore = this.instantVoiceTranslationSourceAudioSessionRestore;
        this.instantVoiceTranslationSourceAudioSessionRestore = null;
        if (!restore || typeof window.api?.setInstantVoiceTranslationAudioSessionVolume !== 'function') {
            return;
        }
        await window.api.setInstantVoiceTranslationAudioSessionVolume({
            targetProcessId: restore.targetProcessId,
            targetWindowTitle: restore.targetWindowTitle,
            targetProcessName: restore.targetProcessName,
            targetWindowSourceId: restore.targetWindowSourceId,
            volume: restore.volume
        }).catch(() => {});
    },

    getInstantVoiceTranslationTargetLanguageLabel() {
        const select = document.getElementById('instant-voice-translation-target-language');
        return select?.selectedOptions?.[0]?.textContent?.trim() || select?.value || '';
    },

    appendInstantVoiceTranslationTranscriptEntry(payload = {}) {
        const translatedText = String(payload.translatedText || '').trim();
        if (!translatedText) return;
        const transcript = String(payload.transcript || this.instantVoiceTranslationLatestSourceText || '').trim();
        const previous = this.instantVoiceTranslationTranscriptEntries[this.instantVoiceTranslationTranscriptEntries.length - 1];
        if (
            previous
            && this.normalizeInstantVoiceTranslationSpeechText(previous.translatedText) === this.normalizeInstantVoiceTranslationSpeechText(translatedText)
            && this.normalizeInstantVoiceTranslationSpeechText(previous.transcript) === this.normalizeInstantVoiceTranslationSpeechText(transcript)
        ) {
            return;
        }
        this.instantVoiceTranslationTranscriptEntries.push({
            time: new Date().toISOString(),
            transcript,
            translatedText
        });
        this.renderInstantVoiceTranslationState();
    },

    appendInstantVoiceTranslationAudioEntry(payload = {}) {
        const audioBase64 = String(payload.audioBase64 || '').trim();
        if (!audioBase64 || this.shouldSuppressInstantVoiceTranslationAudio(payload)) return;
        const previous = this.instantVoiceTranslationAudioEntries[this.instantVoiceTranslationAudioEntries.length - 1];
        if (previous?.audioBase64 === audioBase64) return;
        this.instantVoiceTranslationAudioEntries.push({
            time: new Date().toISOString(),
            offsetMs: this.instantVoiceTranslationTranscriptStartedAt
                ? Math.max(0, Date.now() - new Date(this.instantVoiceTranslationTranscriptStartedAt).getTime())
                : 0,
            mimeType: String(payload.mimeType || 'audio/pcm;rate=24000'),
            audioBase64
        });
        this.renderInstantVoiceTranslationState();
    },

    appendInstantVoiceTranslationSourceAudioEntry(payload = {}) {
        const audioBase64 = String(payload.audioBase64 || '').trim();
        if (!audioBase64) return;
        const startedAt = this.instantVoiceTranslationTranscriptStartedAt
            ? new Date(this.instantVoiceTranslationTranscriptStartedAt).getTime()
            : 0;
        const sampleRate = this.parseInstantVoiceTranslationSampleRate(payload.mimeType || 'audio/pcm;rate=48000');
        const sampleCount = Math.floor(this.base64ToArrayBuffer(audioBase64).byteLength / 2);
        const durationMs = sampleRate > 0 ? Math.round((sampleCount / sampleRate) * 1000) : 0;
        const offsetMs = startedAt > 0
            ? Math.max(0, Date.now() - startedAt - Math.max(0, durationMs))
            : 0;
        this.instantVoiceTranslationSourceAudioEntries.push({
            time: new Date().toISOString(),
            offsetMs,
            durationMs,
            mimeType: String(payload.mimeType || 'audio/pcm;rate=48000'),
            audioBase64
        });
    },

    getInstantVoiceTranslationAudioGain() {
        const value = Number(document.getElementById('instant-voice-translation-translation-volume')?.value || 1);
        return Number.isFinite(value) ? Math.max(0.2, Math.min(3, value)) : 1;
    },

    buildInstantVoiceTranslationTranscriptText() {
        const lines = [];
        lines.push(this.t('dialog.instant_voice_translation.transcript_file_title', 'Anlık sesli çeviri dökümü'));
        lines.push(this.t('dialog.instant_voice_translation.transcript_file_target_language', 'Hedef dil: {language}', {
            language: this.getInstantVoiceTranslationTargetLanguageLabel() || '-'
        }));
        if (this.instantVoiceTranslationTranscriptStartedAt) {
            lines.push(this.t('dialog.instant_voice_translation.transcript_file_started_at', 'Başlangıç: {time}', {
                time: new Date(this.instantVoiceTranslationTranscriptStartedAt).toLocaleString()
            }));
        }
        if (this.instantVoiceTranslationTranscriptStoppedAt) {
            lines.push(this.t('dialog.instant_voice_translation.transcript_file_stopped_at', 'Bitiş: {time}', {
                time: new Date(this.instantVoiceTranslationTranscriptStoppedAt).toLocaleString()
            }));
        }
        lines.push('');
        this.instantVoiceTranslationTranscriptEntries.forEach((entry, index) => {
            lines.push(this.t('dialog.instant_voice_translation.transcript_file_entry_heading', 'Bölüm {number} - {time}', {
                number: index + 1,
                time: new Date(entry.time).toLocaleTimeString()
            }));
            if (entry.transcript) {
                lines.push(this.t('dialog.instant_voice_translation.transcript_file_source_label', 'Duyulan metin:'));
                lines.push(entry.transcript);
            }
            lines.push(this.t('dialog.instant_voice_translation.transcript_file_translation_label', 'Çeviri:'));
            lines.push(entry.translatedText);
            lines.push('');
        });
        return `${lines.join('\n').trim()}\n`;
    },

    getInstantVoiceTranslationTranscriptDefaultFilename() {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        return `${this.t('dialog.instant_voice_translation.transcript_default_filename', 'anlik-ceviri-dokumu')}-${stamp}.txt`;
    },

    async saveInstantVoiceTranslationTranscript() {
        if (!this.instantVoiceTranslationTranscriptEntries.length) {
            this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.save_transcript_empty', 'Kaydedilecek çeviri metni yok.'));
            return;
        }
        const saveResult = await window.api.showSaveDialog({
            title: this.t('dialog.instant_voice_translation.save_transcript_dialog_title', 'Çeviri dökümünü kaydet'),
            defaultPath: this.getInstantVoiceTranslationTranscriptDefaultFilename(),
            filters: [
                { name: this.t('dialog.instant_voice_translation.save_transcript_filter_text', 'Metin dosyası'), extensions: ['txt'] }
            ]
        });
        if (saveResult?.canceled || !saveResult?.filePath) {
            return;
        }
        const result = await window.api.saveFileContent({
            filePath: saveResult.filePath,
            content: this.buildInstantVoiceTranslationTranscriptText()
        });
        if (!result?.success) {
            this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.save_transcript_failed', 'Çeviri dökümü kaydedilemedi: {error}', {
                error: result?.error || 'unknown_error'
            }));
            return;
        }
        this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.save_transcript_success', 'Çeviri dökümü kaydedildi: {path}', {
            path: saveResult.filePath
        }));
    },

    getInstantVoiceTranslationAudioDefaultFilename() {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        return `${this.t('dialog.instant_voice_translation.translation_audio_default_filename', 'anlik-ceviri-sesi')}-${stamp}.mp3`;
    },

    async saveInstantVoiceTranslationAudio() {
        if (!this.instantVoiceTranslationAudioEntries.length) {
            this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.save_translation_audio_empty', 'Kaydedilecek çeviri sesi yok.'));
            return;
        }
        const saveResult = await window.api.showSaveDialog({
            title: this.t('dialog.instant_voice_translation.save_translation_audio_dialog_title', 'Çeviri sesini kaydet'),
            defaultPath: this.getInstantVoiceTranslationAudioDefaultFilename(),
            filters: [
                { name: this.t('dialog.instant_voice_translation.save_translation_audio_filter_mp3', 'MP3 ses dosyası'), extensions: ['mp3'] }
            ]
        });
        if (saveResult?.canceled || !saveResult?.filePath) {
            return;
        }
        const result = await window.api.saveInstantVoiceTranslationAudio?.({
            filePath: saveResult.filePath,
            entries: this.instantVoiceTranslationAudioEntries,
            sourceEntries: this.instantVoiceTranslationSourceAudioEntries,
            mode: document.getElementById('instant-voice-translation-audio-export-mode')?.value || 'translation-foreground'
        });
        if (!result?.success) {
            this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.save_translation_audio_failed', 'Çeviri sesi kaydedilemedi: {error}', {
                error: result?.error || 'unknown_error'
            }));
            return;
        }
        this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.save_translation_audio_success', 'Çeviri sesi kaydedildi: {path}', {
            path: result.outputPath || saveResult.filePath
        }));
    },

    async ensureInstantVoiceTranslationOutputContext(outputDeviceId = 'default') {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            throw new Error('audio_context_unavailable');
        }
        const requestedSinkId = outputDeviceId && outputDeviceId !== 'default' ? outputDeviceId : 'default';
        if (this.instantVoiceTranslationOutputContext && this.instantVoiceTranslationOutputSinkId && this.instantVoiceTranslationOutputSinkId !== requestedSinkId) {
            try { await this.instantVoiceTranslationOutputContext.close(); } catch (_error) {}
            if (this.instantVoiceTranslationOutputElement) {
                this.instantVoiceTranslationOutputElement.pause();
                this.instantVoiceTranslationOutputElement.srcObject = null;
            }
            this.instantVoiceTranslationOutputContext = null;
            this.instantVoiceTranslationOutputDestination = null;
            this.instantVoiceTranslationOutputElement = null;
            this.instantVoiceTranslationOutputSinkId = '';
        }
        if (!this.instantVoiceTranslationOutputContext || this.instantVoiceTranslationOutputContext.state === 'closed') {
            this.instantVoiceTranslationOutputContext = new AudioContextClass();
            this.instantVoiceTranslationOutputDestination = null;
            this.instantVoiceTranslationOutputElement = null;
            this.instantVoiceTranslationOutputSinkId = requestedSinkId;
            this.instantVoiceTranslationNextPlayTime = 0;
        }
        const audioContext = this.instantVoiceTranslationOutputContext;
        await audioContext.resume().catch(() => {});
        if (outputDeviceId && outputDeviceId !== 'default') {
            if (!this.instantVoiceTranslationOutputDestination) {
                this.instantVoiceTranslationOutputDestination = audioContext.createMediaStreamDestination();
            }
            if (!this.instantVoiceTranslationOutputElement || this.instantVoiceTranslationOutputSinkId !== outputDeviceId) {
                if (this.instantVoiceTranslationOutputElement) {
                    this.instantVoiceTranslationOutputElement.pause();
                    this.instantVoiceTranslationOutputElement.srcObject = null;
                }
                this.instantVoiceTranslationOutputElement = new Audio();
                this.instantVoiceTranslationOutputElement.srcObject = this.instantVoiceTranslationOutputDestination.stream;
                if (typeof this.instantVoiceTranslationOutputElement.setSinkId === 'function') {
                    await this.instantVoiceTranslationOutputElement.setSinkId(outputDeviceId);
                }
                await this.instantVoiceTranslationOutputElement.play().catch(() => {});
                this.instantVoiceTranslationOutputSinkId = outputDeviceId;
            }
        } else {
            this.instantVoiceTranslationOutputSinkId = 'default';
        }
        return audioContext;
    },

    async playInstantVoiceTranslationPcmAudio(payload = {}, { gainValue = 1, startDelaySeconds = 0, queueName = 'translation', allowSuppressed = false } = {}) {
        const audioBase64 = String(payload.audioBase64 || '').trim();
        if (!audioBase64) return;
        if (!allowSuppressed && this.shouldSuppressInstantVoiceTranslationAudio(payload)) return;
        const sampleRate = this.parseInstantVoiceTranslationSampleRate(payload.mimeType);
        const pcm = new Int16Array(this.base64ToArrayBuffer(audioBase64));
        if (!pcm.length) return;
        const outputDeviceId = document.getElementById('instant-voice-translation-output-device')?.value || 'default';
        const audioContext = await this.ensureInstantVoiceTranslationOutputContext(outputDeviceId);
        const audioBuffer = audioContext.createBuffer(1, pcm.length, sampleRate);
        const channel = audioBuffer.getChannelData(0);
        for (let index = 0; index < pcm.length; index += 1) {
            channel[index] = Math.max(-1, Math.min(1, pcm[index] / 32768));
        }
        const source = audioContext.createBufferSource();
        const gainNode = audioContext.createGain();
        gainNode.gain.value = Math.max(0, Math.min(3, Number(gainValue) || 1));
        source.buffer = audioBuffer;
        source.connect(gainNode);
        if (outputDeviceId && outputDeviceId !== 'default' && this.instantVoiceTranslationOutputDestination) {
            gainNode.connect(this.instantVoiceTranslationOutputDestination);
        } else {
            gainNode.connect(audioContext.destination);
        }
        const currentNextPlayTime = queueName === 'original-underlay'
            ? this.instantVoiceTranslationOriginalUnderlayNextPlayTime
            : this.instantVoiceTranslationNextPlayTime;
        const startAt = Math.max(
            audioContext.currentTime + 0.02 + Math.max(0, Number(startDelaySeconds) || 0),
            Number(currentNextPlayTime || 0)
        );
        if (queueName === 'original-underlay') {
            this.instantVoiceTranslationOriginalUnderlayNextPlayTime = startAt + audioBuffer.duration;
            const now = audioContext.currentTime;
            this.instantVoiceTranslationOriginalUnderlayPendingNodes = this.instantVoiceTranslationOriginalUnderlayPendingNodes
                .filter((item) => item.endAt > now);
            this.instantVoiceTranslationOriginalUnderlayPendingNodes.push({
                gainNode,
                startAt,
                endAt: startAt + audioBuffer.duration
            });
        } else {
            this.instantVoiceTranslationNextPlayTime = startAt + audioBuffer.duration;
        }
        source.start(startAt);
    },

    async playInstantVoiceTranslationAudio(payload = {}, options = {}) {
        return this.playInstantVoiceTranslationPcmAudio(payload, {
            gainValue: this.getInstantVoiceTranslationAudioGain(),
            ...options
        });
    },

    async playInstantVoiceTranslationOriginalUnderlayAudio(payload = {}) {
        if (!this.isInstantVoiceTranslationOriginalUnderlayEnabled()) return;
        const passthroughActive = Date.now() < Number(this.instantVoiceTranslationOriginalPassthroughUntil || 0);
        return this.playInstantVoiceTranslationPcmAudio(payload, {
            gainValue: passthroughActive ? 1 : this.getInstantVoiceTranslationOriginalUnderlayGain(),
            startDelaySeconds: passthroughActive ? 0 : 1.2,
            queueName: 'original-underlay',
            allowSuppressed: true
        });
    },

    raiseInstantVoiceTranslationPendingOriginalUnderlayToFullVolume() {
        if (!this.isInstantVoiceTranslationConversationModeEnabled()) return;
        this.instantVoiceTranslationOriginalPassthroughUntil = Date.now() + 3500;
        const audioContext = this.instantVoiceTranslationOutputContext;
        if (!audioContext) return;
        const now = audioContext.currentTime;
        this.instantVoiceTranslationOriginalUnderlayPendingNodes = this.instantVoiceTranslationOriginalUnderlayPendingNodes
            .filter((item) => item.endAt > now);
        this.instantVoiceTranslationOriginalUnderlayPendingNodes.forEach((item) => {
            try {
                item.gainNode.gain.cancelScheduledValues(now);
                item.gainNode.gain.setValueAtTime(1, now);
            } catch (_error) {}
        });
    },

    async startInstantVoiceTranslation() {
        if (this.instantVoiceTranslationRunning) return;
        const targetLanguage = document.getElementById('instant-voice-translation-target-language')?.value || 'tr';
        const captureMode = document.getElementById('instant-voice-translation-source')?.value || 'native-microphone';
        const microphoneDeviceId = document.getElementById('instant-voice-translation-microphone-device')?.value || 'default';
        const windowSelect = document.getElementById('instant-voice-translation-window');
        const selectedWindowPid = Number(windowSelect?.value || 0);
        const selectedWindowOption = windowSelect?.selectedOptions?.[0] || null;
        const selectedWindowTitle = String(selectedWindowOption?.dataset?.windowTitle || selectedWindowOption?.textContent || '').trim();
        const selectedWindowProcessName = String(selectedWindowOption?.dataset?.processName || '').trim();
        const selectedWindowSourceId = String(selectedWindowOption?.dataset?.sourceId || '').trim();
        if (captureMode === 'native-window-audio' && !selectedWindowTitle) {
            throw new Error(this.t('dialog.instant_voice_translation.window_required', 'Önce dinlenecek pencere veya uygulamayı seçin.'));
        }
        this.instantVoiceTranslationDiagnostics = [];
        this.instantVoiceTranslationTranscriptEntries = [];
        this.instantVoiceTranslationAudioEntries = [];
        this.instantVoiceTranslationSourceAudioEntries = [];
        this.instantVoiceTranslationOriginalUnderlayPendingNodes = [];
        this.instantVoiceTranslationOriginalPassthroughUntil = 0;
        this.instantVoiceTranslationSuppressNextTranslatedAudio = false;
        this.instantVoiceTranslationLastTextOnlyAnnouncement = '';
        this.resetInstantVoiceTranslationTextOnlyAnnouncementBuffer();
        this.instantVoiceTranslationTranscriptStartedAt = new Date().toISOString();
        this.instantVoiceTranslationTranscriptStoppedAt = null;
        this.instantVoiceTranslationLatestSourceText = '';
        this.instantVoiceTranslationSentChunkCount = 0;
        this.instantVoiceTranslationReceivedAudioCount = 0;
        this.instantVoiceTranslationQueuedChunkCount = 0;
        this.instantVoiceTranslationNextPlayTime = 0;
        this.instantVoiceTranslationOriginalUnderlayNextPlayTime = 0;
        this.addInstantVoiceTranslationDiagnostic(this.t('dialog.instant_voice_translation.diagnostic_start_clicked', 'Başlat düğmesi alındı. Hedef dil: {lang}', {
            lang: targetLanguage
        }), { targetLanguage, captureMode });
        this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.starting', 'Canlı dinleme başlatılıyor...'));
        this.addInstantVoiceTranslationDiagnostic(this.t('dialog.instant_voice_translation.diagnostic_capture_request', 'Ses yakalama hazırlanıyor.'));
        const startResult = await window.api.geminiLiveTranslateStart({
            sourceLanguage: 'auto',
            targetLanguage,
            captureMode,
            microphoneDeviceId: captureMode === 'native-microphone' && microphoneDeviceId !== 'default' ? microphoneDeviceId : undefined,
            targetProcessId: captureMode === 'native-window-audio' ? selectedWindowPid : undefined,
            targetWindowTitle: captureMode === 'native-window-audio' ? selectedWindowTitle : undefined,
            targetProcessName: captureMode === 'native-window-audio' ? selectedWindowProcessName : undefined,
            targetWindowSourceId: captureMode === 'native-window-audio' ? selectedWindowSourceId : undefined
        });
        if (!startResult?.success) {
            throw new Error(startResult?.error || 'gemini_live_translate_start_failed');
        }
        const sourceVolumeResult = captureMode === 'native-window-audio'
            ? await this.applyInstantVoiceTranslationSourceAudioSessionVolume(
                selectedWindowPid,
                selectedWindowTitle,
                selectedWindowProcessName,
                selectedWindowSourceId
            ).catch((error) => ({
                success: false,
                error: error?.message || String(error)
            }))
            : null;
        this.addInstantVoiceTranslationDiagnostic(this.t('dialog.instant_voice_translation.diagnostic_gemini_started', 'Gemini Live bağlantısı başlatıldı.'));
        this.instantVoiceTranslationRunning = true;
        this.addInstantVoiceTranslationDiagnostic(this.t('dialog.instant_voice_translation.diagnostic_recorder_started', 'Mikrofon kaydedici başladı. Biçim: {mime}', {
            mime: 'native-wasapi'
        }), { mimeType: 'native-wasapi' });
        this.addInstantVoiceTranslationDiagnostic(this.t('dialog.instant_voice_translation.diagnostic_capture_running', 'Ses yakalama ve gönderim başladı.'));
        this.renderInstantVoiceTranslationState();
        this.setInstantVoiceTranslationStatus(this.isInstantVoiceTranslationTextOnlyModeEnabled()
            ? this.t('dialog.instant_voice_translation.running_text_only', 'Canlı dinleme sürüyor. Çeviri metni hazır oldukça ekran okuyucuya duyurulacak.')
            : this.t('dialog.instant_voice_translation.running', 'Canlı dinleme sürüyor. Çeviri sesi hazır oldukça duyulacak.'));
        if (sourceVolumeResult && !sourceVolumeResult.success) {
            this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.source_volume_failed', 'Dinlenen uygulamanın ses düzeyi değiştirilemedi: {error}', {
                error: sourceVolumeResult.error || 'audio_session_not_found'
            }));
        }
    },

    async stopInstantVoiceTranslation() {
        if (!this.instantVoiceTranslationRunning && !this.instantVoiceTranslationStream && !this.instantVoiceTranslationAudioContext && !this.instantVoiceTranslationRecorder) {
            this.renderInstantVoiceTranslationState();
            return;
        }
        this.instantVoiceTranslationRunning = false;
        this.instantVoiceTranslationTranscriptStoppedAt = new Date().toISOString();
        this.flushInstantVoiceTranslationTextOnlyAnnouncement({ force: true });
        this.addInstantVoiceTranslationDiagnostic(this.t('dialog.instant_voice_translation.diagnostic_stop_requested', 'Durdurma istendi.'));
        await this.restoreInstantVoiceTranslationSourceAudioSessionVolume();
        try {
            if (this.instantVoiceTranslationRecorder && this.instantVoiceTranslationRecorder.state !== 'inactive') {
                this.instantVoiceTranslationRecorder.stop();
            }
        } catch (_error) {}
        this.instantVoiceTranslationRecorder = null;
        try {
            this.instantVoiceTranslationProcessor?.disconnect();
            this.instantVoiceTranslationSourceNode?.disconnect();
            this.instantVoiceTranslationSilentGain?.disconnect();
        } catch (_error) {}
        this.instantVoiceTranslationProcessor = null;
        this.instantVoiceTranslationSourceNode = null;
        this.instantVoiceTranslationSilentGain = null;
        if (this.instantVoiceTranslationAudioSendTimer) {
            clearInterval(this.instantVoiceTranslationAudioSendTimer);
            this.instantVoiceTranslationAudioSendTimer = null;
        }
        this.instantVoiceTranslationPendingAudioChunks = [];
        try {
            this.instantVoiceTranslationStream?.getTracks?.().forEach((track) => track.stop());
        } catch (_error) {}
        this.instantVoiceTranslationStream = null;
        try {
            await this.instantVoiceTranslationAudioContext?.close?.();
        } catch (_error) {}
        this.instantVoiceTranslationAudioContext = null;
        try {
            await this.instantVoiceTranslationDecodeContext?.close?.();
        } catch (_error) {}
        this.instantVoiceTranslationDecodeContext = null;
        try {
            await this.instantVoiceTranslationOutputContext?.close?.();
        } catch (_error) {}
        this.instantVoiceTranslationOutputContext = null;
        this.instantVoiceTranslationNextPlayTime = 0;
        this.instantVoiceTranslationOriginalUnderlayNextPlayTime = 0;
        await window.api.geminiLiveTranslateStop().catch(() => {});
        this.renderInstantVoiceTranslationState();
        this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.stopped', 'Canlı dinleme durduruldu.'));
    },

    handleInstantVoiceTranslationGeminiEvent(payload = {}) {
        if (!this.instantVoiceTranslationDialog?.open) return;
        const type = String(payload.type || '');
        if (type === 'ready') {
            this.addInstantVoiceTranslationDiagnostic(this.t('dialog.instant_voice_translation.diagnostic_event_ready', 'Gemini hazır olayı geldi.'));
            this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.connected', 'Gemini bağlantısı hazır.'));
            return;
        }
        if (type === 'connection-refreshing') {
            this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.connection_refreshing', 'Gemini bağlantısı süre sınırı nedeniyle yenileniyor. Çeviri birkaç saniye içinde devam edecek.'));
            return;
        }
        if (type === 'connection-refreshed') {
            this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.connection_refreshed', 'Gemini bağlantısı yenilendi. Canlı çeviri devam ediyor.'));
            return;
        }
        if (type === 'connection-refresh-failed') {
            this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.connection_refresh_failed', 'Gemini bağlantısı yenilenemedi. Çeviri açık kalacak ve kısa süre sonra yeniden denenecek: {error}', {
                error: payload.error || 'unknown_error'
            }));
            return;
        }
        if (type === 'error') {
            const errorText = String(payload.error || 'unknown_error');
            if (!this.instantVoiceTranslationRunning || errorText.includes('gemini_live_translate_socket_closed:1000')) {
                return;
            }
            this.addInstantVoiceTranslationDiagnostic(this.t('dialog.instant_voice_translation.diagnostic_event_error', 'Gemini hata olayı geldi: {error}', {
                error: errorText
            }), { error: errorText });
            this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.error', 'Canlı çeviri hatası: {error}', {
                error: errorText
            }));
            return;
        }
        if (type === 'diagnostic') {
            this.addInstantVoiceTranslationDiagnostic(this.t('dialog.instant_voice_translation.diagnostic_native_microphone_event', 'Native mikrofon olayı: {message}', {
                message: payload.message || 'event'
            }), payload);
            return;
        }
        if (type === 'source-audio' && this.instantVoiceTranslationRunning) {
            this.appendInstantVoiceTranslationSourceAudioEntry(payload);
            this.playInstantVoiceTranslationOriginalUnderlayAudio(payload).catch(() => {});
            return;
        }
        if (payload.transcript) {
            this.addInstantVoiceTranslationDiagnostic(this.t('dialog.instant_voice_translation.diagnostic_transcript', 'Duyulan metin geldi.'));
            const sourceText = document.getElementById('instant-voice-translation-source-text');
            this.instantVoiceTranslationLatestSourceText = String(payload.transcript || '');
            if (sourceText) sourceText.value = payload.transcript;
        }
        if (payload.translatedText) {
            this.addInstantVoiceTranslationDiagnostic(this.t('dialog.instant_voice_translation.diagnostic_translation', 'Çeviri metni geldi.'));
            const translatedText = document.getElementById('instant-voice-translation-translated-text');
            if (this.isInstantVoiceTranslationTextOnlyModeEnabled()) {
                this.updateInstantVoiceTranslationTextOnlyDisplay(translatedText, payload.translatedText);
            } else if (translatedText) {
                translatedText.value = payload.translatedText;
            }
            this.queueInstantVoiceTranslationTextOnlyAnnouncement(payload.translatedText);
            if (this.isInstantVoiceTranslationConversationModeEnabled() && this.shouldSuppressInstantVoiceTranslationAudio(payload)) {
                this.instantVoiceTranslationSuppressNextTranslatedAudio = true;
                this.raiseInstantVoiceTranslationPendingOriginalUnderlayToFullVolume();
            } else {
                this.instantVoiceTranslationSuppressNextTranslatedAudio = false;
            }
            this.appendInstantVoiceTranslationTranscriptEntry(payload);
        }
        if (type === 'audio' && this.instantVoiceTranslationRunning) {
            this.instantVoiceTranslationReceivedAudioCount += 1;
            if (this.isInstantVoiceTranslationTextOnlyModeEnabled()) {
                return;
            }
            if (this.instantVoiceTranslationSuppressNextTranslatedAudio || this.shouldSuppressInstantVoiceTranslationAudio(payload)) {
                this.instantVoiceTranslationSuppressNextTranslatedAudio = false;
                return;
            }
            this.appendInstantVoiceTranslationAudioEntry(payload);
            this.addInstantVoiceTranslationDiagnostic(this.t('dialog.instant_voice_translation.diagnostic_audio_received', 'Çeviri sesi geldi: {count}', {
                count: this.instantVoiceTranslationReceivedAudioCount
            }), { count: this.instantVoiceTranslationReceivedAudioCount });
            this.playInstantVoiceTranslationAudio(payload).catch((error) => {
                this.setInstantVoiceTranslationStatus(this.t('dialog.instant_voice_translation.audio_failed', 'Çeviri sesi çalınamadı: {error}', {
                    error: error?.message || error || 'unknown_error'
                }));
            });
        }
    },

    /**
     * Gemini API anahtarı girme diyaloğunu göster
     */
    async showGeminiApiKeyDialog() {
        const input = document.getElementById('gemini-api-key-input');
        const showCheckbox = document.getElementById('gemini-api-key-show');
        const modelSelect = document.getElementById('gemini-model-select');
        const apiData = await window.api.getGeminiApiData();

        // Diyaloğu her açışta gizli modda başla
        input.type = 'password';
        if (showCheckbox) showCheckbox.checked = false;

        if (apiData.apiKey) {
            input.value = apiData.apiKey;
            Accessibility.announce(this.t('runtime.dialogs.api_key_dialog_opened_existing', 'API key dialog opened. An existing key is already available.'));
        } else {
            input.value = '';
            Accessibility.announce(this.t('runtime.dialogs.api_key_dialog_opened_empty', 'API key dialog opened. Please paste your key.'));
        }

        if (modelSelect && apiData.model) {
            modelSelect.value = apiData.model;
        }

        this.geminiApiKeyDialog.showModal();

        // Küçük bir gecikme ile odaklan ve içeriği seç
        setTimeout(() => {
            input.focus();
            input.select();
        }, 100);
    },

    /**
     * OpenAI API anahtarı girme diyaloğunu göster
     */
    async showOpenAiApiKeyDialog() {
        const input = document.getElementById('openai-api-key-input');
        const showCheckbox = document.getElementById('openai-api-key-show');
        const apiData = await window.api.getOpenAiApiData();

        input.type = 'password';
        if (showCheckbox) showCheckbox.checked = false;

        if (apiData.apiKey) {
            input.value = apiData.apiKey;
            Accessibility.announce(this.t('runtime.dialogs.openai_api_key_dialog_opened_existing', 'OpenAI API anahtarı diyaloğu açıldı. Kayıtlı bir anahtar bulundu.'));
        } else {
            input.value = '';
            Accessibility.announce(this.t('runtime.dialogs.openai_api_key_dialog_opened_empty', 'OpenAI API anahtarı diyaloğu açıldı. Lütfen anahtarınızı yapıştırın.'));
        }

        this.openAiApiKeyDialog.showModal();

        setTimeout(() => {
            input.focus();
            input.select();
        }, 100);
    },

    /**
     * ElevenLabs API anahtarı girme diyaloğunu göster
     */
    async showElevenLabsApiKeyDialog() {
        const input = document.getElementById('elevenlabs-api-key-input');
        const showCheckbox = document.getElementById('elevenlabs-api-key-show');
        const apiData = await window.api.getElevenLabsApiData();

        input.type = 'password';
        if (showCheckbox) showCheckbox.checked = false;

        if (apiData.apiKey) {
            input.value = apiData.apiKey;
            Accessibility.announce(this.t('runtime.dialogs.elevenlabs_api_key_dialog_opened_existing', 'ElevenLabs API anahtarı diyaloğu açıldı. Kayıtlı bir anahtar bulundu.'));
        } else {
            input.value = '';
            Accessibility.announce(this.t('runtime.dialogs.elevenlabs_api_key_dialog_opened_empty', 'ElevenLabs API anahtarı diyaloğu açıldı. Lütfen anahtarınızı yapıştırın.'));
        }

        this.elevenLabsApiKeyDialog.showModal();

        setTimeout(() => {
            input.focus();
            input.select();
        }, 100);
    },

    /**
     * Erişilebilir onay diyaloğu event listener'larını kur
     */
    setupAccessibleConfirmEventListeners() {
        // ESC tuşu ile kapatma
        this.accessibleConfirmDialog?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.accessibleConfirmResolve) {
                    this.accessibleConfirmResolve(this.accessibleConfirmCancelValue);
                    this.accessibleConfirmResolve = null;
                }
            }
        });
    },

    /**
     * Erişilebilir onay diyaloğunu göster (ekran okuyucu uyumlu)
     * @param {string} title - Diyalog başlığı
     * @param {string} message - Diyalog mesajı
     * @returns {Promise<boolean>} - Kullanıcı seçimi
     */
    showAccessibleConfirm(title, message) {
        return this.showAccessibleChoice({
            title,
            message,
            buttons: [
                this.t('dialog.confirm.yes', 'Evet'),
                this.t('dialog.confirm.no', 'Hayır')
            ],
            cancelValue: false
        }).then(result => result === 0);
    },

    /**
     * Erişilebilir çok seçenekli onay diyaloğunu göster
     * @param {{title: string, message: string, buttons: string[], cancelValue?: any, focusIndex?: number}} options
     * @returns {Promise<number|any>}
     */
    showAccessibleChoice({ title, message, buttons = [], cancelValue = null, focusIndex = 0, details = '', detailsLabel = '' }) {
        return new Promise((resolve) => {
            this.accessibleConfirmResolve = resolve;
            this.accessibleConfirmCancelValue = cancelValue;

            const yesBtn = document.getElementById('accessible-confirm-yes');
            const noBtn = document.getElementById('accessible-confirm-no');
            const cancelBtn = document.getElementById('accessible-confirm-cancel');
            const buttonEls = [yesBtn, noBtn, cancelBtn];
            const detailsGroup = document.getElementById('accessible-confirm-details-group');
            const detailsLabelEl = document.getElementById('accessible-confirm-details-label');
            const detailsContainer = document.getElementById('accessible-confirm-details');

            // Başlık ve mesajı ayarla
            document.getElementById('accessible-confirm-title').textContent = title;
            document.getElementById('accessible-confirm-message').textContent = message;
            if (detailsGroup && detailsLabelEl && detailsContainer) {
                const hasDetails = String(details || '').trim().length > 0;
                detailsGroup.hidden = !hasDetails;
                detailsLabelEl.textContent = detailsLabel || this.t('dialog.confirm.details_label', 'Details');
                detailsContainer.textContent = hasDetails ? String(details).trim() : '';
            }

            buttonEls.forEach((button, index) => {
                if (!button) return;
                if (index < buttons.length) {
                    button.textContent = buttons[index];
                    button.hidden = false;
                    button.dataset.resultIndex = String(index);
                    button.onclick = () => {
                        window.App?.suppressPlaybackShortcuts?.();
                        if (this.accessibleConfirmResolve) {
                            this.accessibleConfirmResolve(index);
                            this.accessibleConfirmResolve = null;
                        }
                        this.accessibleConfirmDialog.close();
                    };
                } else {
                    button.hidden = true;
                    button.dataset.resultIndex = '';
                    button.onclick = null;
                }
            });

            // Diyaloğu aç
            this.accessibleConfirmDialog.showModal();

            const spokenParts = [title, message];
            if (String(details || '').trim()) {
                spokenParts.push(String(details).trim());
            }
            if (buttons.length > 0) {
                spokenParts.push(buttons.join(', '));
            }
            Accessibility.announceImmediate(spokenParts.filter(Boolean).join('. '));

            // İlk butona odaklan
            setTimeout(() => {
                const targetButton = buttonEls[focusIndex] || buttonEls.find(button => button && !button.hidden);
                targetButton?.focus();
            }, 100);
        });
    },

    // ==========================================
    // İNCE AYAR DİYALOĞU
    // ==========================================

    /**
     * İnce Ayar diyaloğunu göster
     */
    showFineTuneDialog() {
        const dialog = document.getElementById('fine-tune-dialog');
        if (!dialog) return;

        // Mevcut değeri al
        const currentStep = Settings.getNavigationStep();

        // Mevcut değeri göster
        this.updateFineTuneDisplay(currentStep);

        // Preset seçimini ayarla
        const presetSelect = document.getElementById('navigation-step-preset');
        const customContainer = document.getElementById('custom-step-container');

        // Mevcut değer preset'lerden birine eşleşiyor mu?
        const presetValues = ['1', '0.5', '0.25', '0.1', '0.05', '0.01'];
        const currentStepStr = currentStep.toString();

        if (presetValues.includes(currentStepStr)) {
            presetSelect.value = currentStepStr;
            customContainer.style.display = 'none';
        } else {
            presetSelect.value = 'custom';
            customContainer.style.display = 'block';
            document.getElementById('custom-step-input').value = Math.round(currentStep * 1000);
        }

        // Event listener'ları kur (bir kez)
        if (!this._fineTuneListenersSetup) {
            this.setupFineTuneEventListeners();
            this._fineTuneListenersSetup = true;
        }

        dialog.showModal();
        presetSelect.focus();

        Accessibility.announce(`İnce Ayar diyaloğu açıldı. Mevcut navigasyon atlama süresi: ${this.formatStepDuration(currentStep)}`);
    },

    /**
     * İnce Ayar diyaloğu event listener'larını kur
     */
    setupFineTuneEventListeners() {
        const dialog = document.getElementById('fine-tune-dialog');
        const presetSelect = document.getElementById('navigation-step-preset');
        const customContainer = document.getElementById('custom-step-container');
        const customInput = document.getElementById('custom-step-input');
        const confirmBtn = document.getElementById('fine-tune-confirm');
        const cancelBtn = document.getElementById('fine-tune-cancel');

        // Preset değiştiğinde
        presetSelect.addEventListener('change', () => {
            if (presetSelect.value === 'custom') {
                customContainer.style.display = 'block';
                customInput.focus();
            } else {
                customContainer.style.display = 'none';
                this.updateFineTuneDisplay(parseFloat(presetSelect.value));
            }
        });

        // Özel değer değiştiğinde
        customInput.addEventListener('input', () => {
            const ms = parseInt(customInput.value) || 100;
            this.updateFineTuneDisplay(ms / 1000);
        });

        // Uygula butonu
        confirmBtn.addEventListener('click', (e) => {
            e.preventDefault();

            let newStep;
            if (presetSelect.value === 'custom') {
                const ms = parseInt(customInput.value) || 100;
                newStep = Math.max(10, Math.min(10000, ms)) / 1000;
            } else {
                newStep = parseFloat(presetSelect.value);
            }

            Settings.setNavigationStep(newStep);
            dialog.close();

            Accessibility.announce(`Navigasyon atlama süresi ${this.formatStepDuration(newStep)} olarak ayarlandı.`);
        });

        // İptal butonu
        cancelBtn.addEventListener('click', () => {
            dialog.close();
        });
    },

    /**
     * Mevcut değer gösterimini güncelle
     * @param {number} seconds - Saniye cinsinden süre
     */
    updateFineTuneDisplay(seconds) {
        const display = document.getElementById('current-step-display');
        if (display) {
            display.textContent = this.formatStepDuration(seconds);
        }
    },

    /**
     * Atlama süresini okunabilir formata çevir
     * @param {number} seconds - Saniye cinsinden süre
     * @returns {string} Formatlanmış süre
     */
    formatStepDuration(seconds) {
        if (seconds >= 1) {
            return `${seconds} saniye`;
        } else {
            const ms = Math.round(seconds * 1000);
            return `${ms} milisaniye`;
        }
    },

    // ==========================================
    // Görsel Ekleme Sihirbazı
    // ==========================================

    wizardState: {
        currentStep: 1,
        imageType: 'watermark',
        sourceType: 'file',
        selectedFilePath: null,
        textParams: null,
        position: { x: 10, y: 10, w: -1, h: -1 },
        opacity: 1.0,
        timing: { mode: 'whole', start: 0, end: 0 }
    },

    showImageWizard() {
        if (!this.imageWizardDialog) return;

        // Diyalog açıkken video kısayollarını devre dışı bırak
        if (window.Keyboard) window.Keyboard.setEnabled(false);

        // Reset State
        this.wizardState = {
            currentStep: 1,
            imageType: 'watermark',
            sourceType: 'file',
            selectedFilePath: null,
            textParams: null,
            position: { x: 10, y: 10, w: -1, h: -1 },
            opacity: 1.0,
            timing: { mode: 'whole', start: 0, end: 0 }
        };

        // Reset UI
        document.getElementById('img-pos-x').value = 10;
        document.getElementById('img-pos-y').value = 10;
        document.getElementById('img-width').value = -1;
        document.getElementById('img-height').value = -1;
        document.getElementById('img-opacity').value = 1;
        document.getElementById('img-opacity-val').textContent = '%100';
        document.getElementById('selected-image-filename').textContent = this.t('runtime.dialogs.no_file_selected', 'Dosya seçilmedi');

        // İlk adıma git
        this.updateWizardStep(1);

        this.imageWizardDialog.showModal();
        Accessibility.announce(this.t('runtime.dialogs.image_wizard_opened', 'Görsel Ekleme Sihirbazı açıldı. Adım 1: Görsel Türünü Seçin.'));

        // İlk seçeneğe odaklan
        document.querySelector('input[name="image-type"]:checked').focus();
    },

    updateWizardStep(step) {
        window.i18nHelper?.translateDOM();
        // Hide all steps
        document.querySelectorAll('.wizard-step').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.wizard-steps .step').forEach(el => el.classList.remove('active'));

        // Show current step
        document.getElementById(`image-wizard-step-${step}`).classList.remove('hidden');
        document.getElementById(`step-indicator-${step}`).classList.add('active');

        this.wizardState.currentStep = step;

        // Button management
        document.getElementById('wizard-back').disabled = (step === 1);

        if (step === 4) {
            document.getElementById('wizard-next').classList.add('hidden');
            document.getElementById('wizard-finish').classList.remove('hidden');
            document.getElementById('wizard-add-to-queue').classList.remove('hidden');
        } else {
            document.getElementById('wizard-next').classList.remove('hidden');
            document.getElementById('wizard-finish').classList.add('hidden');
            document.getElementById('wizard-add-to-queue').classList.add('hidden');
        }

        // Accessibility announcements
        const stepTitleKeys = [
            'dialog.image_wizard.step_1_title',
            'dialog.image_wizard.step_2_title',
            'dialog.image_wizard.step_3_title',
            'dialog.image_wizard.step_4_title'
        ];
        const stepTitleFallbacks = [
            'Step 1: Choose Image Type',
            'Step 2: Image Source',
            'Step 3: Position and Size',
            'Step 4: Timing'
        ];
        Accessibility.announce(this.t('runtime.video_layer.step_announce', 'Step {step}: {title}', {
            step,
            title: this.t(stepTitleKeys[step - 1], stepTitleFallbacks[step - 1])
        }));

        // Auto-focus first interactive element in the new step to improve navigation flow
        setTimeout(() => {
            const stepContainer = document.getElementById(`image-wizard-step-${step}`);
            if (stepContainer) {
                // Find first focusable element (input, select, textarea, or non-disabled button)
                const firstInput = stepContainer.querySelector('input:not([type="hidden"]), select, textarea, button:not([disabled]), [tabindex]:not([tabindex="-1"])');
                if (firstInput) {
                    firstInput.focus();
                }
            }
        }, 150); // Small delay to allow visibility transition and screen reader to catch up
    },

    setupImageWizardEventListeners() {
        const dialog = this.imageWizardDialog;
        if (!dialog) return;

        // --- Navigation ---
        document.getElementById('wizard-next').addEventListener('click', () => {
            this.handleWizardNext();
        });

        document.getElementById('wizard-back').addEventListener('click', () => {
            if (this.wizardState.currentStep > 1) {
                this.updateWizardStep(this.wizardState.currentStep - 1);
            }
        });

        document.getElementById('wizard-cancel').addEventListener('click', () => dialog.close());

        document.getElementById('wizard-finish').addEventListener('click', () => {
            this.handleWizardFinish();
        });

        document.getElementById('wizard-add-to-queue').addEventListener('click', () => {
            this.handleWizardAddToQueue();
        });

        // --- Step 1: Type Selection ---
        const typeRadios = document.getElementsByName('image-type');
        typeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.wizardState.imageType = e.target.value;
                this.updateDefaultsBasedOnType(e.target.value);
            });
        });

        // --- Step 2: Source Selection ---
        const sourceRadios = document.getElementsByName('image-source-type');
        sourceRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.wizardState.sourceType = e.target.value;
                this.updateSourceUI(e.target.value);
            });
        });

        document.getElementById('btn-select-image-file').addEventListener('click', async () => {
            const result = await window.api.openFileDialog({
                filters: [
                    { name: 'Görseller', extensions: ['jpg', 'png', 'jpeg', 'gif', 'webp', 'bmp'] },
                    { name: 'Tüm Dosyalar', extensions: ['*'] }
                ],
                properties: ['openFile']
            });
            if (result && !result.canceled && result.filePaths.length > 0) {
                this.wizardState.selectedFilePath = result.filePaths[0];
                const filename = this.wizardState.selectedFilePath.split(/[/\\]/).pop();
                document.getElementById('selected-image-filename').textContent = filename;
                // Delay to ensure screen reader announces it after window focus return
                setTimeout(() => {
                    Accessibility.alert(`${filename} dosyası bölüme eklendi.`);
                }, 500);
            }
        });

        // --- Step 3: Positioning ---
        document.getElementById('img-opacity').addEventListener('input', (e) => {
            document.getElementById('img-opacity-val').textContent = `%${Math.round(e.target.value * 100)}`;
            this.wizardState.opacity = parseFloat(e.target.value);
        });

        document.getElementById('btn-voice-positioning').addEventListener('click', () => {
            this.startVoicePositioning();
        });

        // Inject AI Suggest Button (Dynamic Injection)
        const aiPosBtn = document.getElementById('btn-ask-ai-pos');
        if (aiPosBtn && !document.getElementById('btn-ai-suggest-areas')) {
            console.log('Injecting AI Suggest Button...');
            const suggestBtn = document.createElement('button');
            suggestBtn.id = 'btn-ai-suggest-areas';
            suggestBtn.type = 'button';
            suggestBtn.className = 'action-button';
            suggestBtn.innerText = this.t('runtime.dialogs.ai_suggest_areas_button', 'Suggest Suitable Areas');
            suggestBtn.title = this.t('runtime.dialogs.ai_suggest_areas_title', 'Find empty areas in the video with AI');
            suggestBtn.style.marginRight = '10px';
            suggestBtn.style.backgroundColor = '#2E7D32'; // Darker green
            suggestBtn.style.color = 'white';

            // Insert before 'Check' button
            aiPosBtn.parentNode.insertBefore(suggestBtn, aiPosBtn);

            const self = this; // Capture 'this' explicity
            suggestBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('AI Suggest Button Clicked');
                try {
                    if (typeof self.askAiForSuggestions !== 'function') {
                        throw new Error('askAiForSuggestions fonksiyonu bulunamadı!');
                    }
                    await self.askAiForSuggestions();
                } catch (err) {
                    console.error('AI Suggest Click Error:', err);
                    Accessibility.alert(this.t('runtime.common.error', 'Error: {error}', { error: err.message }));
                }
            });
        }

        // Inject Preview Button
        const voicePosBtn = document.getElementById('btn-voice-positioning');
        if (voicePosBtn && !document.getElementById('btn-preview-pos')) {
            const previewBtn = document.createElement('button');
            previewBtn.id = 'btn-preview-pos';
            previewBtn.type = 'button';
            previewBtn.className = 'action-button';
            previewBtn.innerHTML = `<i class="fas fa-eye"></i> ${this.t('runtime.dialogs.preview_alt_p', 'Önizle (Alt+P)')}`;
            previewBtn.title = this.t('runtime.dialogs.preview_position_title', 'Konumu görsel ve işitsel olarak önizle');
            previewBtn.style.marginLeft = '10px';
            previewBtn.style.backgroundColor = '#1976D2'; // Blue
            previewBtn.style.color = 'white';

            // Insert after Voice Positioning button
            voicePosBtn.parentNode.insertBefore(previewBtn, voicePosBtn.nextSibling);

            previewBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleImageWizardPreview();
            });
        }

        // Alt+P Shortcut for Wizard
        this.imageWizardDialog.addEventListener('keydown', (e) => {
            if (e.altKey && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                e.stopPropagation();
                this.toggleImageWizardPreview();
            }
            // Escape to close preview if active
            if (e.key === 'Escape' && this.isPreviewActive) {
                e.preventDefault();
                e.stopPropagation();
                this.stopImageWizardPreview();
            }
        });

        document.getElementById('btn-ask-ai-pos').addEventListener('click', () => {
            this.askAiForPositioning();
        });

        // --- Step 4: Timing ---
        const durationRadios = document.getElementsByName('img-duration-mode');
        durationRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.wizardState.timing.mode = e.target.value;
                if (e.target.value === 'manual') {
                    document.getElementById('img-timing-manual').classList.remove('hidden');
                } else {
                    document.getElementById('img-timing-manual').classList.add('hidden');
                }
            });
        });

        document.getElementById('btn-img-start-current').addEventListener('click', () => {
            const time = VideoPlayer.getCurrentTime();
            document.getElementById('img-start-time').value = time.toFixed(2);
        });

        document.getElementById('btn-img-end-current').addEventListener('click', () => {
            const time = VideoPlayer.getCurrentTime();
            document.getElementById('img-end-time').value = time.toFixed(2);
        });

        // Update position labels
        const xInput = document.getElementById('img-pos-x');
        const yInput = document.getElementById('img-pos-y');

        const updatePosLabels = () => {
            const x = parseInt(xInput.value) || 0;
            const y = parseInt(yInput.value) || 0;
            const w = parseInt(document.getElementById('img-width').value) || -1;
            const h = parseInt(document.getElementById('img-height').value) || -1;

            const posLabel = this.getPositionSemanticLabel(x, y);
            const sizeLabel = this.getSizeSemanticLabel(w, h);

            xInput.setAttribute('aria-label', `Yatay Konum (X): ${posLabel.x}`);
            yInput.setAttribute('aria-label', `Dikey Konum (Y): ${posLabel.y}`);

            // Add visual hints
            const xHint = document.getElementById('x-pos-hint') || this.createHintElement(xInput, 'x-pos-hint');
            xHint.textContent = `(${posLabel.x})`;

            const yHint = document.getElementById('y-pos-hint') || this.createHintElement(yInput, 'y-pos-hint');
            yHint.textContent = `(${posLabel.y})`;

            // Size hints
            const wInput = document.getElementById('img-width');
            const hInput = document.getElementById('img-height');

            if (wInput) {
                wInput.setAttribute('aria-label', `Genişlik: ${sizeLabel.w}`);
                const wHint = document.getElementById('w-hint') || this.createHintElement(wInput, 'w-hint');
                wHint.textContent = `(${sizeLabel.w})`;
            }
            if (hInput) {
                hInput.setAttribute('aria-label', `Yükseklik: ${sizeLabel.h}`);
                const hHint = document.getElementById('h-hint') || this.createHintElement(hInput, 'h-hint');
                hHint.textContent = `(${sizeLabel.h})`;
            }
        };

        const syncState = () => {
            this.wizardState.position.x = parseInt(xInput.value) || 0;
            this.wizardState.position.y = parseInt(yInput.value) || 0;
            this.wizardState.position.w = parseInt(document.getElementById('img-width').value) || -1;
            this.wizardState.position.h = parseInt(document.getElementById('img-height').value) || -1;
        };

        xInput.addEventListener('input', () => { updatePosLabels(); syncState(); });
        yInput.addEventListener('input', () => { updatePosLabels(); syncState(); });
        document.getElementById('img-width').addEventListener('input', () => { updatePosLabels(); syncState(); });
        document.getElementById('img-height').addEventListener('input', () => { updatePosLabels(); syncState(); });

        // Initial setup
        updatePosLabels();
        syncState();
    },

    createHintElement(input, id) {
        let hint = document.createElement('span');
        hint.id = id;
        hint.style.fontSize = '12px';
        hint.style.color = '#888';
        hint.style.marginLeft = '8px';
        hint.style.display = 'inline-block';
        // Input label'ının yanına ekle
        if (input.previousElementSibling && input.previousElementSibling.tagName === 'LABEL') {
            input.previousElementSibling.appendChild(hint);
        } else {
            // Fallback: input'tan sonra ekle
            input.parentNode.insertBefore(hint, input.nextSibling);
        }
        return hint;
    },

    getPositionSemanticLabel(x, y) {
        const width = VideoPlayer.videoElement ? VideoPlayer.videoElement.videoWidth : 1920;
        const height = VideoPlayer.videoElement ? VideoPlayer.videoElement.videoHeight : 1080;

        let xLabel = '';
        if (x === 0) xLabel = 'Sol Kenar (Bitişik)';
        else if (x < width * 0.05) xLabel = 'Sol Kenara Çok Yakın';
        else if (x < width * 0.33) xLabel = 'Sol Taraf';
        else if (x < width * 0.66) xLabel = 'Orta';
        else if (x < width * 0.95) xLabel = 'Sağ Taraf';
        else if (x >= width - 50) xLabel = 'Sağ Kenar'; // Approx for image width
        else xLabel = 'Sağ Tarafa Yakın';

        let yLabel = '';
        if (y === 0) yLabel = 'Üst Kenar (Bitişik)';
        else if (y < height * 0.05) yLabel = 'Üst Kenara Çok Yakın';
        else if (y < height * 0.33) yLabel = 'Üst Taraf';
        else if (y < height * 0.66) yLabel = 'Orta';
        else if (y < height * 0.95) yLabel = 'Alt Taraf';
        else if (y >= height - 50) yLabel = 'Alt Kenar';
        else yLabel = 'Alt Tarafa Yakın';

        return { x: xLabel, y: yLabel };
    },

    getSizeSemanticLabel(w, h) {
        if (w === -1) return { w: 'Orjinal Boyut (Otomatik)', h: h === -1 ? 'Orjinal' : h };

        const videoW = VideoPlayer.videoElement ? VideoPlayer.videoElement.videoWidth : 1920;
        const videoH = VideoPlayer.videoElement ? VideoPlayer.videoElement.videoHeight : 1080;

        let wLabel = '';
        if (w === -1) wLabel = 'Otomatik';
        else if (w >= videoW) wLabel = 'Tam Genişlik';
        else if (w > videoW * 0.8) wLabel = 'Çok Geniş';
        else if (w > videoW * 0.5) wLabel = 'Geniş (Yarım Ekran+)';
        else if (w > videoW * 0.25) wLabel = 'Orta Boy';
        else wLabel = 'Küçük';

        let hLabel = '';
        if (h === -1) hLabel = 'Otomatik';
        else if (h >= videoH) hLabel = 'Tam Yükseklik';
        else if (h > videoH * 0.8) hLabel = 'Çok Yüksek';
        else if (h > videoH * 0.5) hLabel = 'Yüksek (Yarım Ekran+)';
        else if (h > videoH * 0.25) hLabel = 'Orta Boy';
        else hLabel = 'Küçük';

        return { w: wLabel, h: hLabel };
    },

    updateDefaultsBasedOnType(type) {
        // Set smart defaults
        const xInput = document.getElementById('img-pos-x');
        const yInput = document.getElementById('img-pos-y');
        const wInput = document.getElementById('img-width');
        const hInput = document.getElementById('img-height');

        let x = 10, y = 10, w = 200, h = -1;

        if (type === 'watermark') {
            x = 10;
            y = 10;
            w = 200; // Small logo
            h = -1;
        } else if (type === 'overlay') {
            x = 100;
            y = 100;
            w = -1; // Auto
            h = -1;
        } else if (type === 'background') {
            x = 0;
            y = 0;
            w = -1; // Full width (approx)
            h = -1;
        }

        xInput.value = x;
        yInput.value = y;
        wInput.value = w;
        hInput.value = h;

        // Update state
        this.wizardState.position.x = x;
        this.wizardState.position.y = y;
        this.wizardState.position.w = w;
        this.wizardState.position.h = h;

        // Trigger label update for accessibility
        xInput.dispatchEvent(new Event('input'));
    },

    updateSourceUI(sourceType) {
        document.getElementById('source-detail-file').classList.add('hidden');
        document.getElementById('source-detail-text').classList.add('hidden');
        const libDiv = document.getElementById('source-detail-library');
        if (libDiv) libDiv.classList.add('hidden');

        if (sourceType === 'file') {
            document.getElementById('source-detail-file').classList.remove('hidden');
        } else if (sourceType === 'text') {
            document.getElementById('source-detail-text').classList.remove('hidden');
        } else if (sourceType === 'library') {
            // Library UI Creation (if missing)
            let libraryDiv = document.getElementById('source-detail-library');
            if (!libraryDiv) {
                // Find parent to append
                const parent = document.getElementById('source-detail-file').parentNode;
                libraryDiv = document.createElement('div');
                libraryDiv.id = 'source-detail-library';
                libraryDiv.className = 'form-group animate-fade-in';
                libraryDiv.innerHTML = `
                    <label>1. Renk/Arka Plan Seçin</label>
                    <div class="color-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 5px; margin-bottom: 15px;">
                        <button type="button" class="lib-color-btn" data-color="black" aria-pressed="false" style="background:black; color:white; height:40px;" title="Siyah">Siyah</button>
                        <button type="button" class="lib-color-btn" data-color="white" aria-pressed="false" style="background:white; border:1px solid #ccc; color:black; height:40px;" title="Beyaz">Beyaz</button>
                        <button type="button" class="lib-color-btn" data-color="#00FF00" aria-pressed="false" style="background:#00FF00; color:black; height:40px;" title="Yeşil Perde">Yeşil</button>
                        <button type="button" class="lib-color-btn" data-color="blue" aria-pressed="false" style="background:blue; color:white; height:40px;" title="Mavi">Mavi</button>
                        <button type="button" class="lib-color-btn" data-color="red" aria-pressed="false" style="background:red; color:white; height:40px;" title="Kırmızı">Kırmızı</button>
                        <button type="button" class="lib-color-btn" data-color="yellow" aria-pressed="false" style="background:yellow; color:black; height:40px;" title="Sarı">Sarı</button>
                        <button type="button" class="lib-color-btn" data-color="gray" aria-pressed="false" style="background:gray; color:white; height:40px;" title="Gri">Gri</button>
                        <button type="button" class="lib-color-btn" data-color="transparent" aria-pressed="false" style="background:linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%); background-size: 20px 20px; height:40px; border:1px solid #ccc; font-size:12px;" title="Şeffaf">Şeffaf</button>
                    </div>

                    <label>2. Şekil/Kullanım Tarzı Seçin</label>
                    <div class="style-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 5px;">
                         <button type="button" class="lib-style-btn" data-style="full" aria-pressed="true" style="padding:10px; border:1px solid #ccc;">Tam Ekran Kapla</button>
                         <button type="button" class="lib-style-btn" data-style="lower-third" aria-pressed="false" style="padding:10px; border:1px solid #ccc;">Alt Bant (Yazı İçin)</button>
                         <button type="button" class="lib-style-btn" data-style="sidebar" aria-pressed="false" style="padding:10px; border:1px solid #ccc;">Yan Panel (Sol)</button>
                         <button type="button" class="lib-style-btn" data-style="top-bar" aria-pressed="false" style="padding:10px; border:1px solid #ccc;">Üst Bant (Başlık)</button>
                    </div>

                    <div id="selected-lib-item" style="margin-top:10px; font-weight:bold;">Seçili: Yok</div>
                `;
                parent.appendChild(libraryDiv);

                // Add listeners
                const btns = libraryDiv.querySelectorAll('.lib-color-btn');
                btns.forEach(btn => {
                    btn.addEventListener('click', () => {
                        // Mark active
                        btns.forEach(b => {
                            b.style.outline = 'none';
                            b.setAttribute('aria-pressed', 'false');
                        });
                        btn.style.outline = '3px solid var(--accent-color)';
                        btn.setAttribute('aria-pressed', 'true');

                        const color = btn.getAttribute('data-color');
                        this.wizardState.selectedLibraryColor = color;
                        document.getElementById('selected-lib-item').textContent = `Seçili: ${btn.title} (${color})`;
                        Accessibility.announce(`${btn.title} rengi seçildi.`);
                    });
                });

                const styleBtns = libraryDiv.querySelectorAll('.lib-style-btn');
                styleBtns.forEach(btn => {
                    btn.addEventListener('click', () => {
                        styleBtns.forEach(b => {
                            b.style.borderColor = '#ccc';
                            b.setAttribute('aria-pressed', 'false');
                        });
                        btn.style.borderColor = 'var(--accent-color)';
                        btn.setAttribute('aria-pressed', 'true');

                        const style = btn.getAttribute('data-style');
                        Accessibility.announce(`${btn.innerText} tarzı seçildi.`);

                        // Auto-configure positioning based on style
                        const videoW = VideoPlayer.videoElement ? VideoPlayer.videoElement.videoWidth : 1920;
                        const videoH = VideoPlayer.videoElement ? VideoPlayer.videoElement.videoHeight : 1080;

                        const xInput = document.getElementById('img-pos-x');
                        const yInput = document.getElementById('img-pos-y');
                        const wInput = document.getElementById('img-width');
                        const hInput = document.getElementById('img-height');

                        if (style === 'full') {
                            xInput.value = 0; yInput.value = 0; wInput.value = -1; hInput.value = -1;
                        } else if (style === 'lower-third') {
                            xInput.value = 0;
                            yInput.value = Math.floor(videoH * 0.75); // Bottom 25%
                            wInput.value = -1;
                            hInput.value = Math.floor(videoH * 0.25);
                        } else if (style === 'sidebar') {
                            xInput.value = 0; yInput.value = 0;
                            wInput.value = Math.floor(videoW * 0.25); // 25% width
                            hInput.value = -1;
                        } else if (style === 'top-bar') {
                            xInput.value = 0; yInput.value = 0;
                            wInput.value = -1;
                            hInput.value = Math.floor(videoH * 0.15); // Top 15%
                        }

                        // Sync
                        xInput.dispatchEvent(new Event('input'));
                        yInput.dispatchEvent(new Event('input'));
                        wInput.dispatchEvent(new Event('input'));
                        hInput.dispatchEvent(new Event('input'));
                    });
                });
            }
            libraryDiv.classList.remove('hidden');
        }
    },

    handleWizardNext() {
        const step = this.wizardState.currentStep;

        // Validation
        if (step === 2) {
            if (this.wizardState.sourceType === 'file' && !this.wizardState.selectedFilePath) {
                Accessibility.alert('Lütfen bir görsel dosyası seçin.');
                return;
            }
            if (this.wizardState.sourceType === 'text') {
                const text = document.getElementById('img-text-content').value;
                if (!text) {
                    Accessibility.alert('Lütfen metin girin.');
                    return;
                }
            }
            if (this.wizardState.sourceType === 'library') {
                if (!this.wizardState.selectedLibraryColor) {
                    Accessibility.alert('Lütfen kütüphaneden bir renk seçin.');
                    return;
                }
            }
        }

        if (step < 4) {
            this.updateWizardStep(step + 1);
        }
    },

    async handleWizardFinish() {
        try {
            // Collect final data (initial grab, imagePath updated later)
            const options = {
                imagePath: null,
                x: parseInt(document.getElementById('img-pos-x').value) || 0,
                y: parseInt(document.getElementById('img-pos-y').value) || 0,
                width: parseInt(document.getElementById('img-width').value) || -1,
                height: parseInt(document.getElementById('img-height').value) || -1,
                opacity: parseFloat(document.getElementById('img-opacity').value) || 1,
                startTime: document.querySelector('input[name="img-duration-mode"]:checked').value === 'whole' ? 0 : parseFloat(document.getElementById('img-start-time').value) || 0,
                endTime: document.querySelector('input[name="img-duration-mode"]:checked').value === 'whole' ? VideoPlayer.getDuration() : parseFloat(document.getElementById('img-end-time').value) || 0
            };

            let finalImagePath = this.wizardState.selectedFilePath;

            // Text generation handling - if text source is selected
            if (this.wizardState.sourceType === 'text') {
                App.showProgress('Yazı görseli oluşturuluyor...');
                const textImagePath = await this.generateTextImageFile();
                App.hideProgress();

                if (!textImagePath) {
                    Accessibility.alert('Yazı görseli oluşturulamadı.');
                    return;
                }
                finalImagePath = textImagePath;
            } else if (this.wizardState.sourceType === 'library') {
                App.showProgress('Kütüphane görseli oluşturuluyor...');
                const color = this.wizardState.selectedLibraryColor || 'black';
                // Default to Full HD for backgrounds
                const libImagePath = await this.generateSolidColorImage(color, 1920, 1080);
                App.hideProgress();

                if (!libImagePath) {
                    Accessibility.alert('Kütüphane görseli oluşturulamadı.');
                    return;
                }
                finalImagePath = libImagePath;
            }

            if (!finalImagePath) {
                Accessibility.alert('Görsel dosyası bulunamadı. Lütfen bir görsel seçin veya yazı girin.');
                return;
            }

            options.imagePath = finalImagePath;
            this.imageWizardDialog.close();

            // Call App
            window.App.addImageOverlay(options);
        } catch (error) {
            App.hideProgress();
            console.error('Wizard Error:', error);
            Accessibility.announceError('İşlem sırasında bir hata oluştu: ' + error.message);
        }
    },

    /**
     * Görsel ekleme işlemini ekleme listesine ekler (hemen uygulamak yerine)
     */
    async handleWizardAddToQueue() {
        try {
            // Collect final data
            const options = {
                imagePath: null,
                sourceType: this.wizardState.sourceType,
                imageType: this.wizardState.imageType,
                x: parseInt(document.getElementById('img-pos-x').value) || 0,
                y: parseInt(document.getElementById('img-pos-y').value) || 0,
                width: parseInt(document.getElementById('img-width').value) || -1,
                height: parseInt(document.getElementById('img-height').value) || -1,
                opacity: parseFloat(document.getElementById('img-opacity').value) || 1,
                startTime: document.querySelector('input[name="img-duration-mode"]:checked').value === 'whole' ? 0 : parseFloat(document.getElementById('img-start-time').value) || 0,
                endTime: document.querySelector('input[name="img-duration-mode"]:checked').value === 'whole' ? -1 : parseFloat(document.getElementById('img-end-time').value) || 0,
                durationMode: document.querySelector('input[name="img-duration-mode"]:checked').value
            };

            let finalImagePath = this.wizardState.selectedFilePath;

            // Text generation handling - if text source is selected
            if (this.wizardState.sourceType === 'text') {
                App.showProgress('Yazı görseli oluşturuluyor...');
                const textImagePath = await this.generateTextImageFile();
                App.hideProgress();

                if (!textImagePath) {
                    Accessibility.alert('Yazı görseli oluşturulamadı.');
                    return;
                }
                finalImagePath = textImagePath;

                // Text params for queue display
                options.textContent = document.getElementById('img-text-content').value;
                options.textFont = document.getElementById('img-text-font').value;
                options.textColor = document.getElementById('img-text-color').value;
            } else if (this.wizardState.sourceType === 'library') {
                App.showProgress('Kütüphane görseli oluşturuluyor...');
                const color = this.wizardState.selectedLibraryColor || 'black';
                // Default to Full HD for backgrounds
                const libImagePath = await this.generateSolidColorImage(color, 1920, 1080);
                App.hideProgress();

                if (!libImagePath) {
                    Accessibility.alert('Kütüphane görseli oluşturulamadı.');
                    return;
                }
                finalImagePath = libImagePath;
                options.libraryColor = color;
            }

            if (!finalImagePath) {
                Accessibility.alert('Görsel dosyası bulunamadı. Lütfen bir görsel seçin veya yazı girin.');
                return;
            }

            options.imagePath = finalImagePath;

            // Add to InsertionQueue instead of applying immediately
            InsertionQueue.addItem('image', options);

            this.imageWizardDialog.close();

            // Provide feedback
            const typeLabel = this.wizardState.imageType === 'watermark' ? 'Filigran' :
                this.wizardState.imageType === 'overlay' ? 'Serbest Görsel' : 'Arka Plan';
            Accessibility.announce(`${typeLabel} ekleme listesine eklendi. Toplam: ${InsertionQueue.getCount()} öğe. Ekleme listesi diyaloğunu Ekle menüsünden açabilirsiniz.`);

        } catch (error) {
            App.hideProgress();
            console.error('Wizard Queue Error:', error);
            Accessibility.announceError('İşlem sırasında bir hata oluştu: ' + error.message);
        }
    },

    // ==========================================
    // Sesli Konumlandırma (Voice Positioning)
    // ==========================================

    voicePosState: {
        active: false,
        audioCtx: null,
        oscillator: null,
        gainNode: null,
        panner: null,
        stepBase: 10,
        videoWidth: 1920,
        videoHeight: 1080
    },

    initAudioContext() {
        if (!this.voicePosState.audioCtx) {
            this.voicePosState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    },

    startVoicePositioning() {
        this.initAudioContext();
        if (this.voicePosState.audioCtx.state === 'suspended') {
            this.voicePosState.audioCtx.resume();
        }

        this.voicePosState.active = true;

        // Modalın klavye olaylarını ele geçir
        this._boundVoicePosHandler = this.handleVoicePosKeydown.bind(this);
        this.imageWizardDialog.addEventListener('keydown', this._boundVoicePosHandler);

        Accessibility.announce('Sesli Konumlandırma Modu Başlatıldı. Ok tuşları ile hareket ettirin. Çıkmak için ESC basın.');

        // Görsel geri bildirim
        document.getElementById('btn-voice-positioning').classList.add('pulse-animation');
    },

    stopVoicePositioning() {
        this.voicePosState.active = false;
        if (this._boundVoicePosHandler) {
            this.imageWizardDialog.removeEventListener('keydown', this._boundVoicePosHandler);
            this._boundVoicePosHandler = null;
        }

        if (this.voicePosState.oscillator) {
            try {
                this.voicePosState.oscillator.stop();
            } catch (e) { }
            this.voicePosState.oscillator = null;
        }

        document.getElementById('btn-voice-positioning').classList.remove('pulse-animation');
        Accessibility.announce('Sesli Konumlandırma Modundan çıkıldı.');
    },

    handleVoicePosKeydown(e) {
        if (!this.voicePosState.active) return;

        let handled = false;
        let step = this.voicePosState.stepBase;

        if (e.shiftKey) step *= 5; // Hızlı
        if (e.ctrlKey) step *= 10; // Çok hızlı

        const xInput = document.getElementById('img-pos-x');
        const yInput = document.getElementById('img-pos-y');

        let x = parseInt(xInput.value) || 0;
        let y = parseInt(yInput.value) || 0;

        // Listen Key (Space or P)
        if (e.key === ' ' || e.key.toLowerCase() === 'p') {
            this.playPositionFeedback(x, y);
            e.preventDefault();
            return;
        }

        // Calculate potential new position
        let newX = x;
        let newY = y;

        switch (e.key) {
            case 'ArrowRight': newX += step; handled = true; break;
            case 'ArrowLeft': newX -= step; handled = true; break;
            case 'ArrowUp': newY -= step; handled = true; break;
            case 'ArrowDown': newY += step; handled = true; break;
            // Resize with < (shrink) and > (grow) or - / + 
            case '<':
            case '-':
                this.resizeImageInWizard(0.9, x, y); // Shrink by 10%
                handled = true;
                break;
            case '>':
            case '+':
                this.resizeImageInWizard(1.1, x, y); // Grow by 10%
                handled = true;
                break;
            case 'Escape':
            case 'Enter':
                this.stopVoicePositioning();
                e.preventDefault();
                e.stopPropagation();
                return;
        }

        if (handled) {
            e.preventDefault();
            e.stopPropagation();

            const imgW = parseInt(document.getElementById('img-width').value) || 100; // Estimated if not set
            const imgH = parseInt(document.getElementById('img-height').value) || 100;
            const maxW = this.voicePosState.videoWidth;
            const maxH = this.voicePosState.videoHeight;

            // Boundary Check
            let collision = false;
            // Left/Top Check
            if (newX < 0) { newX = 0; collision = true; }
            if (newY < 0) { newY = 0; collision = true; }
            // Right/Bottom Check (Assuming standard coordinate system top-left)
            // If we know image size, we can check right edge. 
            // If width is proportional (-1), we can't be sure, allowing center check or loose check.
            if (imgW > 0 && newX + imgW > maxW) { newX = maxW - imgW; collision = true; }
            if (imgH > 0 && newY + imgH > maxH) { newY = maxH - imgH; collision = true; }

            // Loose check if sizes are unknown or for very large movements
            if (newX > maxW) { newX = maxW; collision = true; }
            if (newY > maxH) { newY = maxH; collision = true; }

            xInput.value = newX;
            yInput.value = newY;

            // Update State
            this.wizardState.position.x = newX;
            this.wizardState.position.y = newY;

            if (collision) {
                this.playCollisionSound();
            } else {
                this.playPositionFeedback(newX, newY);
            }
        }
    },

    playCollisionSound() {
        const ctx = this.voicePosState.audioCtx;
        if (!ctx) return;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.15); // Drop pitch

        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.15);
    },

    playPositionFeedback(x, y) {
        const ctx = this.voicePosState.audioCtx;
        if (!ctx) return;

        // Clean up previous
        if (this.voicePosState.oscillator) {
            try {
                this.voicePosState.oscillator.stop();
                this.voicePosState.oscillator.disconnect();
            } catch (e) { }
        }

        const width = this.voicePosState.videoWidth;
        const height = this.voicePosState.videoHeight;

        // Stereo Panning (X) -1 (Left) to 1 (Right)
        let pan = (x / width) * 2 - 1;
        pan = Math.max(-0.95, Math.min(0.95, pan)); // Keep slightly inside for clarity

        // Pitch (Y) - Higher at Top, Lower at Bottom
        // User requested: "üste gittikçe incelme (ince ses = yüksek frekans), aşağı geldikçe kalınlaşma (kalın ses = düşük frekans)"
        // Optimized range for better distinction: 150Hz (Bottom) to 1200Hz (Top)
        const minFreq = 150;
        const maxFreq = 1200;

        // Normalized Y (0 at top, 1 at bottom)
        const normY = Math.max(0, Math.min(1, y / height));

        // Freq: Top (y=0) -> maxFreq, Bottom (y=1) -> minFreq
        const freq = maxFreq - (normY * (maxFreq - minFreq));

        // Create Audio Graph
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const panner = ctx.createStereoPanner();

        osc.type = 'sine'; // Pure tone
        osc.frequency.value = freq;

        panner.pan.value = pan;

        osc.connect(panner);
        panner.connect(gain);
        gain.connect(ctx.destination);

        // Sound Envelope (Short Ping)
        const now = ctx.currentTime;
        const duration = 0.15; // Slightly longer for clarity
        gain.gain.setValueAtTime(0.0, now);
        gain.gain.linearRampToValueAtTime(0.15, now + 0.02); // Attack
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration); // Release

        osc.start(now);
        osc.stop(now + duration + 0.1); // Cleanup buffer

        this.voicePosState.oscillator = osc;
    },

    resizeImageInWizard(factor, currentX, currentY) {
        const wInput = document.getElementById('img-width');
        const hInput = document.getElementById('img-height');

        let w = parseInt(wInput.value) || 100;
        let h = parseInt(hInput.value) || 100;

        // İlk kez -1 ise, gerçek boyutu bulmaya çalış veya tahmini bir değer ata
        if (w === -1 || h === -1) {
            // Bir varsayım yapalım veya mevcut video boyutuna göre ölçekleyelim
            // Ideally we should know the image size. For now assume an arbitrary size if unknown.
            w = 300; h = 300;
        }

        w = Math.round(w * factor);
        h = Math.round(h * factor);

        // Min size check
        if (w < 10) w = 10;
        if (h < 10) h = 10;

        wInput.value = w;
        hInput.value = h;

        // Update state
        this.wizardState.position.w = w;
        this.wizardState.position.h = h;

        // Play Feedback
        this.playResizeFeedback(w, h);
    },

    playResizeFeedback(w, h) {
        const ctx = this.voicePosState.audioCtx;
        if (!ctx) return;

        const videoArea = this.voicePosState.videoWidth * this.voicePosState.videoHeight;
        const imgArea = w * h;
        const ratio = imgArea / videoArea;

        // Determine number of notes (chord complexity) based on coverage
        // > 50%: 5 notes
        // > 20%: 4 notes
        // > 10%: 3 notes
        // > 5%: 2 notes
        // <= 5%: 1 note (Clean/Safe)

        let noteCount = 1;
        if (ratio > 0.5) noteCount = 5;
        else if (ratio > 0.2) noteCount = 4;
        else if (ratio > 0.1) noteCount = 3;
        else if (ratio > 0.05) noteCount = 2;

        // Base chord notes (C Majorish arpeggio frequencies)
        const notes = [261.63, 329.63, 392.00, 523.25, 659.25]; // C4, E4, G4, C5, E5

        const now = ctx.currentTime;
        const gainNode = ctx.createGain();
        gainNode.connect(ctx.destination);

        // Master volume for this chord
        gainNode.gain.setValueAtTime(0.2, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

        for (let i = 0; i < noteCount; i++) {
            const osc = ctx.createOscillator();
            osc.type = i === 0 ? 'sine' : 'triangle'; // Base is pure, added notes are richer
            osc.frequency.value = notes[i];
            osc.connect(gainNode);
            osc.start(now);
            osc.stop(now + 0.5);
        }

        // If single note (safe zone), maybe add a pleasant 'ding' quality
        if (noteCount === 1) {
            // Add a high overtone for 'clear' feeling
            const oscHigh = ctx.createOscillator();
            oscHigh.type = 'sine';
            oscHigh.frequency.value = 1046.50; // C6
            const gainHigh = ctx.createGain();
            gainHigh.gain.setValueAtTime(0.05, now);
            gainHigh.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
            oscHigh.connect(gainHigh);
            gainHigh.connect(ctx.destination);
            oscHigh.start(now);
            oscHigh.stop(now + 0.3);
        }
    },




    // ==========================================
    // ÖNİZLEME (PREVIEW) FONKSİYONLARI
    // ==========================================

    isPreviewActive: false,
    previewSoundInterval: null,

    toggleImageWizardPreview() {
        if (this.isPreviewActive) {
            this.stopImageWizardPreview();
        } else {
            this.startImageWizardPreview();
        }
    },

    async startImageWizardPreview() {
        if (!VideoPlayer.hasVideo()) return;

        this.isPreviewActive = true;
        this.initAudioContext();
        if (this.voicePosState.audioCtx.state === 'suspended') {
            this.voicePosState.audioCtx.resume();
        }

        // 1. Koordinatları ve boyutları al
        const x = this.wizardState.position.x;
        const y = this.wizardState.position.y;
        let w = this.wizardState.position.w;
        let h = this.wizardState.position.h;

        const videoW = VideoPlayer.videoElement.videoWidth;
        const videoH = VideoPlayer.videoElement.videoHeight;

        // Boyut -1 ise varsayılan ata
        if (w === -1) w = 200;
        if (h === -1) h = 100;

        Accessibility.announce(`Önizleme hazırlanıyor...`);

        // 2. Video karesini al
        const canvas = document.createElement('canvas');
        canvas.width = videoW;
        canvas.height = videoH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(VideoPlayer.videoElement, 0, 0, videoW, videoH);

        // 3. Overlay görselini hazırla
        let overlayImg = new Image();
        let overlayLoaded = false;

        try {
            let overlaySrc = null;
            if (this.wizardState.sourceType === 'file' && this.wizardState.selectedFilePath) {
                const readRes = await window.api.readFileBase64(this.wizardState.selectedFilePath);
                if (readRes.success) overlaySrc = 'data:image/png;base64,' + readRes.base64;
            } else if (this.wizardState.sourceType === 'text') {
                try {
                    const textPath = await this.generateTextImageFile();
                    if (textPath) {
                        const readRes = await window.api.readFileBase64(textPath);
                        if (readRes.success) overlaySrc = 'data:image/png;base64,' + readRes.base64;
                    }
                } catch (e) { console.error('Text gen error', e); }
            } else if (this.wizardState.sourceType === 'library') {
                // Renk library için özel çizim yapılacak, src yok
                overlaySrc = null;
            }

            if (overlaySrc) {
                await new Promise((resolve) => {
                    overlayImg.onload = () => { overlayLoaded = true; resolve(); };
                    overlayImg.onerror = resolve;
                    overlayImg.src = overlaySrc;
                });
            }
        } catch (e) { console.error('Preview overlay load error', e); }

        // 4. Overlay'i çiz
        ctx.globalAlpha = this.wizardState.opacity || 1.0;
        if (overlayLoaded) {
            ctx.drawImage(overlayImg, x, y, w, h);
        } else {
            // Resim yoksa (veya library ise) kutu çiz
            ctx.fillStyle = this.wizardState.selectedLibraryColor || 'rgba(255, 0, 0, 0.5)';
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 5;
            ctx.strokeRect(x, y, w, h);

            // Merkez noktası
            ctx.beginPath();
            ctx.arc(x + w / 2, y + h / 2, 10, 0, 2 * Math.PI);
            ctx.fillStyle = 'white';
            ctx.fill();
        }

        // 5. Ekran overlay'i oluştur
        let overlayDiv = document.getElementById('wizard-preview-overlay');
        if (!overlayDiv) {
            overlayDiv = document.createElement('div');
            overlayDiv.id = 'wizard-preview-overlay';
            overlayDiv.style.position = 'fixed';
            overlayDiv.style.top = '0';
            overlayDiv.style.left = '0';
            overlayDiv.style.width = '100vw';
            overlayDiv.style.height = '100vh';
            overlayDiv.style.backgroundColor = 'rgba(0,0,0,0.95)';
            overlayDiv.style.zIndex = '99999';
            overlayDiv.style.display = 'flex';
            overlayDiv.style.alignItems = 'center';
            overlayDiv.style.justifyContent = 'center';
            overlayDiv.style.flexDirection = 'column';

            // Close hint
            const hint = document.createElement('div');
            hint.textContent = 'Önizleme Modu - Çıkmak için ESC veya Alt+P basın';
            hint.style.color = 'white';
            hint.style.marginBottom = '20px';
            hint.style.fontSize = '24px';
            hint.style.fontWeight = 'bold';
            hint.setAttribute('aria-live', 'polite');
            overlayDiv.appendChild(hint);

            const img = document.createElement('img');
            img.id = 'wizard-preview-img';
            img.style.maxWidth = '95%';
            img.style.maxHeight = '85%';
            img.style.border = '3px solid #1976D2';
            img.style.boxShadow = '0 0 20px rgba(25, 118, 210, 0.5)';
            overlayDiv.appendChild(img);

            // Focus trap için dummy button
            const trapBtn = document.createElement('button');
            trapBtn.style.opacity = '0';
            overlayDiv.appendChild(trapBtn);
            trapBtn.focus();

            document.body.appendChild(overlayDiv);

            // Click to close
            overlayDiv.addEventListener('click', () => this.stopImageWizardPreview());
        }

        // Resmi göster
        const previewImg = document.getElementById('wizard-preview-img');
        previewImg.src = canvas.toDataURL();
        overlayDiv.style.display = 'flex';

        // Modalın odağını al (geçici)
        overlayDiv.querySelector('button')?.focus();

        // 6. Sesli Bildirim (Sürekli)
        if (this.previewSoundInterval) clearInterval(this.previewSoundInterval);

        // İlk çalma
        this.playPositionFeedback(x, y);

        // Döngü
        this.previewSoundInterval = setInterval(() => {
            if (!this.isPreviewActive) { clearInterval(this.previewSoundInterval); return; }
            this.playPositionFeedback(x, y);
        }, 600); // 600ms aralıkla çal

        // 7. Sözlü Duyuru
        Accessibility.announce(`Önizleme başlatıldı. Konum X: ${x}, Y: ${y}, Boyut: ${w}x${h}.`);
    },

    stopImageWizardPreview() {
        this.isPreviewActive = false;
        const overlayDiv = document.getElementById('wizard-preview-overlay');
        if (overlayDiv) {
            overlayDiv.style.display = 'none';
        }

        if (this.previewSoundInterval) {
            clearInterval(this.previewSoundInterval);
            this.previewSoundInterval = null;
        }

        Accessibility.announce('Önizleme kapatıldı.');

        // Focus back to button
        const btn = document.getElementById('btn-preview-pos');
        if (btn) btn.focus();
    },

    async askAiForPositioning() {
        if (!VideoPlayer.hasVideo()) return;

        const feedbackBox = document.getElementById('ai-pos-feedback');
        feedbackBox.classList.remove('hidden');
        feedbackBox.innerHTML = `<p>${this.t('runtime.dialogs.ai_overlay_review_loading', 'AI is analyzing the visual placement, please wait...')}</p>`;
        Accessibility.announce(this.t('runtime.dialogs.ai_overlay_review_announce', 'AI is analyzing the visual placement.'));

        // API Key Check
        const apiData = await window.api.getGeminiApiData();
        if (!apiData.apiKey) {
            feedbackBox.innerHTML = `<p style="color:red">${this.t('runtime.dialogs.api_key_missing_short', 'API key is missing.')}</p>`;
            Accessibility.alert(this.t('runtime.dialogs.gemini_key_required', 'You must enter the Gemini API key in settings first.'));
            return;
        }

        try {
            // Get current frame
            const time = VideoPlayer.getCurrentTime();
            let frameResult;
            try {
                frameResult = await window.api.extractFrameBase64({
                    videoPath: VideoPlayer.currentFilePath,
                    time: time
                });
            } catch (err) {
                throw new Error('Kare alınamadı: ' + err.message);
            }

            if (!frameResult) throw new Error('Kare verisi boş.');

            Accessibility.announce(this.t('runtime.dialogs.ai_processing_frame', 'Processing frame...'));

            // --- Multi-Image AI Analysis Strategy ---
            // Kullanıcının isteği üzerine: Ham video karesi ve Filgran görselini AYRI AYRI gönderiyoruz.
            // Bu sayede yapay zeka her iki görseli de net olarak görür ve mekansal (spatial) olarak zihninde birleştirir.

            let imagesToSend = [frameResult]; // İlk görsel: Video karesi
            let overlayBase64 = null;

            try {
                let overlayPath = null;
                if (this.wizardState.sourceType === 'file') {
                    overlayPath = this.wizardState.selectedFilePath;
                } else if (this.wizardState.sourceType === 'text') {
                    overlayPath = await this.generateTextImageFile();
                } else if (this.wizardState.sourceType === 'library') {
                    const color = this.wizardState.selectedLibraryColor || 'black';
                    overlayPath = await this.generateSolidColorImage(color, 1920, 1080);
                }

                if (overlayPath) {
                    // Dosyayı base64 olarak oku
                    const readResult = await window.api.readFileBase64(overlayPath);
                    if (readResult.success) {
                        overlayBase64 = readResult.base64;
                        imagesToSend.push(overlayBase64); // İkinci görsel: Filgran
                        console.log('Overlay image added to AI request');
                    } else {
                        console.warn('Overlay base64 okunamadı:', readResult.error);
                    }
                }
            } catch (e) {
                console.error('Overlay hazırlama hatası:', e);
            }

            // ------------------------------------------
            const { x, y, w, h } = this.wizardState.position;
            const widthStr = w === -1 ? "orijinal boyutunda" : `${w}px genişliğinde`;
            const heightStr = h === -1 ? "orijinal boyutunda" : `${h}px yüksekliğinde`;

            let extraInfo = "";
            if (this.wizardState.sourceType === 'text') {
                const textContent = document.getElementById('img-text-content').value;
                extraInfo = `Eklenen içerik şu metindir: "${textContent}".`;
            } else if (this.wizardState.sourceType === 'library') {
                extraInfo = `Eklenen içerik kütüphaneden seçilen "${this.wizardState.selectedLibraryColor}" renkli bir arka plandır.`;
            }

            // Video Çözünürlüğü
            const videoW = VideoPlayer.videoElement ? VideoPlayer.videoElement.videoWidth : 1920;
            const videoH = VideoPlayer.videoElement ? VideoPlayer.videoElement.videoHeight : 1080;

            // Resolve Auto Dimensions for Prompt Clarity
            const effectiveW = w === -1 ? videoW : w;
            const effectiveH = h === -1 ? "(Otomatik/Orjinal)" : h;

            const prompt = this.buildAiPositioningReviewPrompt({
                videoW,
                videoH,
                x,
                y,
                effectiveW,
                effectiveH,
                extraInfo
            });

            const response = await window.api.geminiVisionRequest({
                apiKey: apiData.apiKey,
                model: apiData.model || 'gemini-2.5-flash',
                imageBase64: imagesToSend,
                prompt: prompt,
                systemInstruction: this.getAiSystemInstruction('json')
            });

            if (response.success) {
                feedbackBox.innerHTML = `
                    <div style="background:#2a2a2a; padding:10px; border-radius:5px; border-left: 4px solid var(--accent-color);">
                        <p style="margin-bottom:10px;">${response.text.replace(/\n/g, '<br>')}</p>
                    </div>
                `;
                Accessibility.announce(this.t('runtime.dialogs.ai_response_ready', 'AI responded. Details are in the box.'));

                // Parse Suggestion
                const jsonMatch = response.text.match(/```json\s*(\{.*?\})\s*```/s);
                if (jsonMatch) {
                    try {
                        const suggestion = JSON.parse(jsonMatch[1]).suggestion;
                        if (suggestion) {
                            const btnId = `btn-apply-suggest-${Date.now()}`;
                            const applyBtn = document.createElement('button');
                            applyBtn.id = btnId;
                            applyBtn.textContent = this.t('runtime.dialogs.apply_suggested_size', 'Apply Suggested Size');
                            applyBtn.className = 'btn-secondary small';
                            applyBtn.style.marginTop = '10px';

                            applyBtn.onclick = () => {
                                if (suggestion.width !== undefined) {
                                    this.wizardState.position.w = suggestion.width;
                                    document.getElementById('img-width').value = suggestion.width;
                                }
                                if (suggestion.height !== undefined) {
                                    this.wizardState.position.h = suggestion.height;
                                    document.getElementById('img-height').value = suggestion.height;
                                }
                                // Sync
                                document.getElementById('img-width').dispatchEvent(new Event('input'));
                                document.getElementById('img-height').dispatchEvent(new Event('input'));

                                Accessibility.announce(this.t('runtime.dialogs.suggested_size_applied', 'Suggested dimensions were applied.'));
                                applyBtn.remove();
                            };
                            feedbackBox.querySelector('div').appendChild(applyBtn);
                        }
                    } catch (e) { console.error('JSON Parse Error', e); }
                }
            } else {
                const errMsg = response.error || this.t('runtime.dialogs.unknown_error', 'An unknown error occurred.');
                feedbackBox.innerHTML = `<p style="color:red">${this.t('runtime.common.error', 'Error: {error}', { error: errMsg })}</p>`;
                Accessibility.alert(this.t('runtime.dialogs.ai_response_failed', 'AI could not respond: {error}', { error: errMsg }));
            }

        } catch (error) {
            console.error('AI Position Error:', error);
            document.getElementById('ai-pos-feedback').innerHTML = `<p style="color:red">${this.t('runtime.common.error', 'Error: {error}', { error: error.message })}</p>`;
            Accessibility.alert(this.t('runtime.dialogs.ai_operation_failed', 'An error occurred: {error}', { error: error.message }));
        }
    },

    async askAiForSuggestions() {
        if (!VideoPlayer.hasVideo()) {
            Accessibility.alert(this.t('runtime.dialogs.load_video_first', 'You must load a video first.'));
            return;
        }

        const feedbackBox = document.getElementById('ai-pos-feedback');
        feedbackBox.classList.remove('hidden');
        feedbackBox.style.display = 'block'; // Ensure visibility
        feedbackBox.innerHTML = `<p>${this.t('runtime.dialogs.ai_searching_areas', 'AI is searching for suitable areas...')}</p>`;

        // Delay announce slightly to ensure it's not interrupted by button click speech
        setTimeout(() => {
            Accessibility.announce(this.t('runtime.dialogs.ai_searching_areas_announce', 'AI is searching for suitable empty areas in the video.'));
        }, 250);

        // Get API Key from Main Process (Source of Truth)
        const apiData = await window.api.getGeminiApiData();
        if (!apiData || !apiData.apiKey) {
            feedbackBox.innerHTML = `<p style="color:red">${this.t('runtime.dialogs.api_key_missing_short', 'API key is missing.')}</p>`;
            Accessibility.alert(this.t('runtime.dialogs.gemini_key_required', 'You must enter the Gemini API key in settings first.'));
            return;
        }

        try {
            // Get current frame directly from video element (Faster & Reliable)
            const videoEl = VideoPlayer.videoElement;
            if (!videoEl) throw new Error('Video element bulunamadı.');
            if (videoEl.videoWidth === 0 || videoEl.videoHeight === 0) throw new Error('Video boyutları algılanamadı. Video yüklenmemiş olabilir.');

            const canvas = document.createElement('canvas');
            canvas.width = videoEl.videoWidth;
            canvas.height = videoEl.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

            // Get base64 (remove prefix for API)
            const base64Data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

            let imagesToSend = [base64Data];
            let overlayBase64 = null;

            // --- Capture Overlay Content ---
            try {
                let overlayPath = null;
                if (this.wizardState.sourceType === 'file') {
                    overlayPath = this.wizardState.selectedFilePath;
                } else if (this.wizardState.sourceType === 'text') {
                    overlayPath = await this.generateTextImageFile();
                } else if (this.wizardState.sourceType === 'library') {
                    const color = this.wizardState.selectedLibraryColor || 'black';
                    overlayPath = await this.generateSolidColorImage(color, 1920, 1080);
                }

                if (overlayPath) {
                    const readResult = await window.api.readFileBase64(overlayPath);
                    if (readResult.success) {
                        overlayBase64 = readResult.base64;
                        imagesToSend.push(overlayBase64); // Add as 2nd image
                    }
                }
            } catch (e) {
                console.error('Overlay hazırlama hatası:', e);
            }
            // -------------------------------

            const videoW = videoEl.videoWidth;
            const videoH = videoEl.videoHeight;

            const prompt = this.buildAiPlacementSuggestionsPrompt({
                videoW,
                videoH,
                overlayBase64
            });

            console.log('Sending AI Suggestion Request:', { model: apiData.model, promptLength: prompt.length, imagesCount: imagesToSend.length });

            const response = await window.api.geminiVisionRequest({
                apiKey: apiData.apiKey,
                model: apiData.model || 'gemini-2.5-flash',
                imageBase64: imagesToSend,
                prompt: prompt,
                systemInstruction: this.getAiSystemInstruction('json')
            });

            console.log('AI Response:', response);

            if (!response) {
                throw new Error(this.t('runtime.dialogs.ai_empty_response_service', 'AI service returned an empty response.'));
            }

            if (response.success) {
                const jsonMatch = response.text.match(/```json\s*(\[.*?\])\s*```/s);
                if (jsonMatch) {
                    try {
                        const suggestions = JSON.parse(jsonMatch[1]);
                        feedbackBox.innerHTML = `<p>${this.t('runtime.dialogs.ai_suggested_areas_title', 'Suggested Areas:')}</p><div id="ai-suggestions-list" style="display:flex; flex-wrap:wrap; gap:10px; margin-top:10px;"></div>`;
                        const list = document.getElementById('ai-suggestions-list');

                        // Check if any suggestions have color changes to inform user generally
                        const hasColorSuggestions = suggestions.some(s => s.textColor || s.bgColor);
                        if (hasColorSuggestions && this.wizardState.sourceType === 'text') {
                            const note = document.createElement('p');
                            note.style.fontSize = '0.9em';
                            note.style.fontStyle = 'italic';
                            note.style.color = '#FFC107'; // Amber
                            note.textContent = this.t('runtime.dialogs.ai_color_suggestion_note', 'Note: Some suggestions may change text/background colors to improve readability.');
                            feedbackBox.appendChild(note);
                        }

                        suggestions.forEach(sug => {
                            const btn = document.createElement('button');
                            btn.type = 'button'; // Prevent form submission
                            btn.className = 'btn-secondary';
                            btn.style.flex = '1 1 45%';
                            btn.style.textAlign = 'left';
                            btn.style.padding = '8px';
                            btn.innerHTML = `<strong>${sug.label}</strong><br><small>${sug.description}</small>`;

                            if (sug.textColor || sug.bgColor) {
                                let colorInfo = '<br><span style="font-size:0.8em; opacity:0.8; display: flex; align-items: center; gap: 5px;">🎨 ';
                                if (sug.textColor) colorInfo += `<span style="width:10px; height:10px; border-radius:50%; background:${sug.textColor}; border:1px solid #777; display:inline-block;"></span>`;
                                if (sug.bgColor && sug.bgColor !== 'transparent') colorInfo += ` / <span style="width:10px; height:10px; border-radius:2px; background:${sug.bgColor}; border:1px solid #777; display:inline-block;"></span>`;
                                colorInfo += '</span>';
                                btn.innerHTML += colorInfo;
                            }

                            btn.onclick = async (e) => {
                                e.preventDefault(); // Stop any parent form submit
                                e.stopPropagation();

                                document.getElementById('img-pos-x').value = sug.x;
                                document.getElementById('img-pos-y').value = sug.y;
                                if (sug.w) document.getElementById('img-width').value = sug.w;
                                if (sug.h) document.getElementById('img-height').value = sug.h;

                                // --- STYLE APPLICATION LOGIC ---
                                let styleChanged = false;
                                let styleMsg = "";

                                if (this.wizardState.sourceType === 'text') {
                                    // Apply Text Color
                                    if (sug.textColor && ['white', 'black', 'yellow', 'red'].includes(sug.textColor)) {
                                        const colorEl = document.getElementById('img-text-color');
                                        if (colorEl && colorEl.value !== sug.textColor) {
                                            colorEl.value = sug.textColor;
                                            styleChanged = true;
                                            styleMsg += `Yazı: ${sug.textColor} `;
                                        }
                                    }
                                    // Apply BG Color
                                    if (sug.bgColor && ['transparent', 'black', 'white'].includes(sug.bgColor)) {
                                        const bgEl = document.getElementById('img-text-bg-color');
                                        if (bgEl && bgEl.value !== sug.bgColor) {
                                            bgEl.value = sug.bgColor;
                                            styleChanged = true;
                                            styleMsg += `Arka: ${sug.bgColor}`;
                                        }
                                    }

                                    if (styleChanged) {
                                        // Regenerate the text image with new styles
                                        Accessibility.announce(this.t('runtime.dialogs.ai_style_updating', 'Updating style...'));
                                        try {
                                            const newPath = await this.generateTextImageFile();
                                            if (newPath) {
                                                this.wizardState.selectedFilePath = newPath;
                                            }
                                        } catch (e) { console.error('Style update error', e); }
                                    }
                                }
                                // -------------------------------

                                document.getElementById('img-pos-x').dispatchEvent(new Event('input'));
                                document.getElementById('img-pos-y').dispatchEvent(new Event('input'));
                                document.getElementById('img-width').dispatchEvent(new Event('input'));
                                document.getElementById('img-height').dispatchEvent(new Event('input'));


                                // Delay to ensure screen reader announces it
                                setTimeout(() => {
                                    let fullMsg = this.t('runtime.dialogs.ai_suggestion_applied', '{label} suggestion applied.', { label: sug.label });
                                    if (styleChanged) fullMsg += ` ${this.t('runtime.dialogs.ai_colors_updated', 'Colors were updated for readability.')}`;
                                    Accessibility.alert(fullMsg);
                                }, 250);

                                // If preview is active, restart it to show new style
                                if (this.isPreviewActive) {
                                    this.stopImageWizardPreview();
                                    setTimeout(() => this.startImageWizardPreview(), 150);
                                }
                            };
                            list.appendChild(btn);
                        });
                        Accessibility.announce(this.t('runtime.dialogs.ai_found_suggestions', '{count} suitable areas found. You can choose from the list.', { count: suggestions.length }));
                    } catch (e) {
                        feedbackBox.innerHTML = `<p>${this.t('runtime.dialogs.ai_suggestions_parse_failed', 'Suggestions could not be parsed: {error}', { error: e.message })}</p>`;
                    }
                } else {
                    feedbackBox.innerHTML = `<p>${response.text}</p>`;
                }
            } else {
                const errMsg = response.error || this.t('runtime.dialogs.unknown_error', 'An unknown error occurred.');
                feedbackBox.innerHTML = `<p style="color:red">${this.t('runtime.common.error', 'Error: {error}', { error: errMsg })}</p>`;
                Accessibility.alert(this.t('runtime.dialogs.ai_service_failed', 'AI service returned an error: {error}', { error: errMsg }));
            }

        } catch (err) {
            console.error('AI Critical Error:', err);
            const msg = err.message || err.toString() || 'Tanımsız hata';
            document.getElementById('ai-pos-feedback').innerHTML = `<p style="color:red; word-break:break-all">${this.t('runtime.dialogs.critical_error', 'Critical error: {error}', { error: msg })}</p>`;
            Accessibility.alert(this.t('runtime.dialogs.ai_operation_failed', 'An error occurred: {error}', { error: msg }));
        }
    },

    async generateTextImageFile() {
        const text = document.getElementById('img-text-content').value;
        const font = document.getElementById('img-text-font').value;
        const color = document.getElementById('img-text-color').value;
        const bg = document.getElementById('img-text-bg-color').value;

        if (!text) return null;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Font settings
        const fontSize = 48;
        const isWatermark = (this.wizardState.imageType === 'watermark' || this.wizardState.imageType === 'logo');
        const fontWeight = isWatermark ? 'bold' : 'normal';

        const fontString = `${fontWeight} ${fontSize}px ${font}`;
        ctx.font = fontString; // Set initially to measure

        // Split text into lines
        const lines = text.split('\n');

        // Measure lines
        const padding = isWatermark ? 40 : 20;
        let maxWidth = 0;
        const lineHeight = fontSize * 1.2;

        lines.forEach(line => {
            const m = ctx.measureText(line);
            if (m.width > maxWidth) maxWidth = m.width;
        });

        const width = Math.ceil(maxWidth + padding * 2);
        const height = Math.ceil((lines.length * lineHeight) + padding * 2);

        canvas.width = width;
        canvas.height = height;

        // Reset Context and Re-apply settings
        ctx.font = fontString;
        ctx.textBaseline = 'top'; // Draw from top for multiline convenience

        // Background
        if (bg !== 'transparent') {
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, width, height);
        }

        // Draw Lines
        if (isWatermark) {
            // Styles - Soft Watermark Look
            ctx.lineWidth = 4;
            if (['white', 'yellow', '#ffffff', '#ffff00'].includes(color)) {
                ctx.strokeStyle = 'rgba(0,0,0,0.4)'; // Soft dark stroke for light text
            } else {
                ctx.strokeStyle = 'rgba(255,255,255,0.4)'; // Soft white stroke for dark text
            }
            ctx.lineJoin = 'round';
            ctx.miterLimit = 2;

            ctx.shadowColor = 'rgba(0,0,0,0.3)'; // Soft shadow
            ctx.shadowBlur = 4;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;
        }

        ctx.fillStyle = color;

        // Bake transparency for watermarks
        if (isWatermark) {
            ctx.globalAlpha = 0.5; // 50% opacity for true watermark effect
        } else {
            ctx.globalAlpha = 1.0;
        }

        lines.forEach((line, index) => {
            const xPos = padding;
            const yPos = padding + (index * lineHeight);

            if (isWatermark) {
                ctx.strokeText(line, xPos, yPos);
            }
            ctx.fillText(line, xPos, yPos);
        });

        // Convert to Base64
        const dataUrl = canvas.toDataURL('image/png');

        // Save to file via IPC
        const result = await window.api.saveBase64Image({
            base64Data: dataUrl,
            filename: `text_watermark_${Date.now()}.png`
        });

        if (result.success) {
            return result.filePath;
        } else {
            console.error('Text image save failed:', result.error);
            Accessibility.alert(`Yazı görseli kaydedilemedi: ${result.error} `);
            return null;
        }
    },

    async generateSolidColorImage(color, width = 1920, height = 1080) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // Fill
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/png');
        const result = await window.api.saveBase64Image({
            base64Data: dataUrl,
            filename: `color_bg_${Date.now()}.png`
        });

        return result.success ? result.filePath : null;
    },

    // ==========================================
    // GEÇİŞ DİYALOGLARI
    // ==========================================

    /**
     * Geçiş Kütüphanesi - seçilen geçiş ID'si
     */
    selectedTransitionId: null,

    /**
     * Geçiş Kütüphanesi Dialog'unu göster
     */
    showTransitionLibraryDialog() {
        if (!this.transitionLibraryDialog) return;

        if (window.Keyboard) window.Keyboard.setEnabled(false);

        // Listeyi doldur
        this.populateTransitionList();

        // Mevcut aktif geçişi seç
        const activeSettings = Transitions.getActiveSettings();
        this.selectedTransitionId = activeSettings.transitionId;

        // Süre ve ses ayarlarını yükle
        document.getElementById('transition-duration').value = activeSettings.duration;
        const sfxCheckbox = document.getElementById('transition-use-sfx');
        if (sfxCheckbox) {
            sfxCheckbox.checked = activeSettings.useSfx;
            // Özel ses grubu görünürlüğünü güncelle
            const customSfxGroup = document.getElementById('transition-custom-sfx-group');
            if (customSfxGroup) {
                customSfxGroup.style.display = activeSettings.useSfx ? 'block' : 'none';
            }
        }

        // Aktif geçiş bilgisini güncelle
        this.updateTransitionActiveInfo();

        this.transitionLibraryDialog.showModal();

        // Arama alanına odaklan
        setTimeout(() => {
            document.getElementById('transition-search').focus();
        }, 100);

        Accessibility.announce(this.t('runtime.transition.library_opened', 'Transition Library opened. Select a transition type.'));
    },

    /**
     * Geçiş listesini doldur
     */
    populateTransitionList() {
        const list = document.getElementById('transition-type-list');
        if (!list) return;

        const searchTerm = (document.getElementById('transition-search')?.value || '').toLowerCase();
        const categoryFilter = document.getElementById('transition-category-filter')?.value || 'all';

        list.innerHTML = '';

        const allTypes = Transitions.getAllTransitionTypes();
        const categories = Transitions.getAllCategories();

        // Filtreleme
        const filtered = allTypes.filter(t => {
            const matchesSearch = t.name.toLowerCase().includes(searchTerm) ||
                t.description.toLowerCase().includes(searchTerm);
            const matchesCategory = categoryFilter === 'all' || t.category === categoryFilter;
            return matchesSearch && matchesCategory;
        });

        // Kategoriye göre grupla
        const grouped = {};
        for (const t of filtered) {
            if (!grouped[t.category]) {
                grouped[t.category] = [];
            }
            grouped[t.category].push(t);
        }

        // Liste oluştur
        for (const [catId, items] of Object.entries(grouped)) {
            // Kategori başlığı
            const catHeader = document.createElement('li');
            catHeader.className = 'list-category-header';
            catHeader.setAttribute('role', 'presentation');
            catHeader.textContent = categories[catId] || catId;
            list.appendChild(catHeader);

            // Geçişler
            for (const t of items) {
                const li = document.createElement('li');
                li.className = 'transition-type-item';
                li.setAttribute('role', 'option');
                li.setAttribute('data-id', t.id);
                li.setAttribute('tabindex', '-1');
                li.setAttribute('aria-selected', this.selectedTransitionId === t.id ? 'true' : 'false');

                const extendsBadge = t.extendsDuration
                    ? `<span class="badge warning">${this.t('runtime.transition.extends_duration_badge', 'Extends duration')}</span>`
                    : '';

                li.innerHTML = `
                    <span class="transition-name">${t.name}</span>
                    <span class="transition-desc">${t.description}</span>
                    <span class="transition-meta">${this.t('runtime.transition.default_duration', 'Default: {duration}s', { duration: t.defaultDuration })} ${extendsBadge}</span>
                `;

                li.setAttribute('aria-label',
                    `${t.name}. ${t.description}. ${this.t('runtime.transition.default_duration_aria', 'Default duration {duration} seconds.', { duration: t.defaultDuration })}` +
                    (t.extendsDuration ? ` ${this.t('runtime.transition.extends_duration_aria', 'Extends the video duration.')}` : '')
                );

                if (this.selectedTransitionId === t.id) {
                    li.classList.add('selected');
                }

                list.appendChild(li);
            }
        }

        if (filtered.length === 0) {
            const emptyLi = document.createElement('li');
            emptyLi.textContent = this.t('runtime.transition.no_results', 'No results found');
            emptyLi.setAttribute('role', 'presentation');
            list.appendChild(emptyLi);
        }
    },

    /**
     * Aktif geçiş bilgisini güncelle
     */
    updateTransitionActiveInfo() {
        const infoEl = document.getElementById('transition-active-info');
        if (!infoEl) return;

        const trans = Transitions.getTransitionType(this.selectedTransitionId);
        if (trans) {
            const duration = document.getElementById('transition-duration')?.value || trans.defaultDuration;
            const useSfx = document.getElementById('transition-use-sfx')?.checked;

            infoEl.textContent = this.t('runtime.transition.selected_info', 'Selected transition: {name}. Duration: {duration} seconds. {audio} {extends}', {
                name: trans.name,
                duration,
                audio: useSfx
                    ? this.t('runtime.transition.audio_on', 'Audio on.')
                    : this.t('runtime.transition.audio_off', 'Audio off.'),
                extends: trans.extendsDuration
                    ? this.t('runtime.transition.extends_duration_sentence', 'Extends the video duration.')
                    : ''
            }).trim();
        } else {
            infoEl.textContent = this.t('runtime.transition.none_selected', 'No transition selected');
        }
    },

    /**
     * Seçili geçişi önizle (dialog içinden)
     */
    async previewSelectedTransition() {
        if (!this.selectedTransitionId) {
            Accessibility.announce(this.t('runtime.transition.select_first', 'Select a transition first'));
            return;
        }

        const trans = Transitions.getTransitionType(this.selectedTransitionId);
        if (!trans) {
            Accessibility.announce(this.t('runtime.transition.not_found', 'Transition not found'));
            return;
        }

        const duration = parseFloat(document.getElementById('transition-duration')?.value) || trans.defaultDuration;
        const useSfx = document.getElementById('transition-use-sfx')?.checked;

        // Erişilebilirlik duyurusu
        const sfxLabel = useSfx
            ? this.t('runtime.transition.with_sound_effect', 'With sound effect')
            : this.t('runtime.transition.audio_off_short', 'Audio off');
        Accessibility.announce(this.t('runtime.transition.preview_announce', 'Preview: {name}. Duration {duration} seconds. {sfx}.', {
            name: trans.name,
            duration,
            sfx: sfxLabel
        }));

        // Ses efekti çal
        // Ses efekti çal
        if (useSfx) {
            // Önce özel ses dosyasını kontrol et
            const customSfxInput = document.getElementById('transition-custom-sfx');
            if (customSfxInput && customSfxInput.value) {
                try {
                    const audio = new Audio(customSfxInput.value);
                    audio.volume = 0.5;
                    await audio.play();
                    return;
                } catch (error) {
                    console.warn('Özel ses dosyası çalınamadı:', error);
                    // Hata olursa varsayılanı dene
                }
            }

            // Varsayılan WAV dosyasını dene
            const sfxFile = Transitions.getSfxFileForTransition(this.selectedTransitionId);
            if (sfxFile) {
                try {
                    const audio = new Audio(`assets/sfx/${sfxFile}`);
                    audio.volume = 0.7;
                    await audio.play();
                    return;
                } catch (error) {
                    console.warn('Ses dosyası çalınamadı, yapay ses kullanılıyor');
                }
            }
            // Fallback: yapay ses
            Transitions.playGeneratedSfx(this.selectedTransitionId, duration);
        }
    },

    /**
     * Geçiş Listesi Dialog'unu göster
     */
    showTransitionListDialog() {
        if (!this.transitionListDialog) return;

        if (window.Keyboard) window.Keyboard.setEnabled(false);

        this.updateAppliedTransitionList();
        this.transitionListDialog.showModal();

        const count = Transitions.getCount();
        Accessibility.announce(this.t('runtime.transition.applied_list_opened', 'Applied Transitions. {count} transitions found.', { count }));
    },

    /**
     * Uygulanmış geçiş listesini güncelle
     */
    updateAppliedTransitionList() {
        const list = document.getElementById('applied-transition-list');
        const emptyMsg = document.getElementById('transition-list-empty');
        if (!list) return;

        const transitions = Transitions.getAll();

        if (emptyMsg) {
            emptyMsg.style.display = transitions.length === 0 ? 'block' : 'none';
        }

        list.innerHTML = '';

        transitions.forEach((t, index) => {
            const li = document.createElement('li');
            li.className = 'applied-transition-item';
            li.setAttribute('role', 'option');
            li.setAttribute('data-id', t.id);
            li.setAttribute('tabindex', index === 0 ? '0' : '-1');
            li.setAttribute('aria-selected', 'false');

            const localizedTransition = Transitions.getTransitionType(t.transitionId);
            const transitionName = localizedTransition?.name || t.transitionName;
            const label = `${Utils.formatTime(t.time)} - ${transitionName} (${t.duration}s)`;
            li.innerHTML = `<span class="transition-time">${Utils.formatTime(t.time)}</span>
                            <span class="transition-type">${transitionName}</span>
                            <span class="transition-duration">${t.duration}s</span>`;

            li.setAttribute('aria-label', label);
            list.appendChild(li);
        });

        // İlk öğeye odaklan
        if (transitions.length > 0) {
            const firstItem = list.querySelector('.applied-transition-item');
            if (firstItem) {
                firstItem.focus();
            }
        }
    },

    /**
     * Geçiş event listener'larını kur
     */
    setupTransitionEventListeners() {
        // === GEÇİŞ KÜTÜPHANESİ ===
        const libDialog = this.transitionLibraryDialog;
        if (libDialog) {
            // Arama
            document.getElementById('transition-search')?.addEventListener('input', () => {
                this.populateTransitionList();
            });

            // Kategori filtresi
            document.getElementById('transition-category-filter')?.addEventListener('change', () => {
                this.populateTransitionList();
            });

            // Liste öğesi seçimi
            document.getElementById('transition-type-list')?.addEventListener('click', (e) => {
                const item = e.target.closest('.transition-type-item');
                if (item) {
                    // Önceki seçimi kaldır
                    document.querySelectorAll('.transition-type-item').forEach(el => {
                        el.classList.remove('selected');
                        el.setAttribute('aria-selected', 'false');
                    });

                    // Yeni seçim
                    item.classList.add('selected');
                    item.setAttribute('aria-selected', 'true');
                    this.selectedTransitionId = item.getAttribute('data-id');

                    // Varsayılan süreyi ayarla
                    const trans = Transitions.getTransitionType(this.selectedTransitionId);
                    if (trans) {
                        document.getElementById('transition-duration').value = trans.defaultDuration;
                    }

                    this.updateTransitionActiveInfo();
                    Accessibility.announce(this.t('runtime.transition.selected', '{name} selected', {
                        name: trans?.name || this.t('runtime.transition.generic_name', 'Transition')
                    }));
                }
            });

            // Klavye navigasyonu
            document.getElementById('transition-type-list')?.addEventListener('keydown', (e) => {
                const items = Array.from(document.querySelectorAll('.transition-type-item'));
                const currentIndex = items.findIndex(el => el.classList.contains('selected'));

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const nextIndex = Math.min(currentIndex + 1, items.length - 1);
                    items[nextIndex]?.click();
                    items[nextIndex]?.focus();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prevIndex = Math.max(currentIndex - 1, 0);
                    items[prevIndex]?.click();
                    items[prevIndex]?.focus();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    document.getElementById('btn-transition-set-active')?.click();
                }
            });

            // Ses efekti checkbox
            document.getElementById('transition-use-sfx')?.addEventListener('change', (e) => {
                const customSfxGroup = document.getElementById('transition-custom-sfx-group');
                if (customSfxGroup) {
                    customSfxGroup.style.display = e.target.checked ? 'block' : 'none';
                }
                this.updateTransitionActiveInfo();
            });

            // Özel Ses Efekti Seç butonu
            document.getElementById('btn-select-transition-sfx')?.addEventListener('click', async () => {
                const result = await window.api.openFileDialog({
                    title: this.t('runtime.transition.select_custom_sfx_title', 'Select Custom Sound Effect'),
                    filters: [{ name: this.t('runtime.transition.audio_files', 'Audio Files'), extensions: ['wav', 'mp3', 'ogg'] }],
                    properties: ['openFile']
                });

                if (result && !result.canceled && result.filePaths.length > 0) {
                    const filePath = result.filePaths[0];
                    document.getElementById('transition-custom-sfx').value = filePath;
                    Accessibility.announce(this.t('runtime.transition.audio_file_selected', 'Audio file selected: {file}', { file: filePath.split(/[\\/]/).pop() }));

                    // Süre kontrolü uyarısı
                    const duration = parseFloat(document.getElementById('transition-duration').value) || 0.5;
                    // Not: Ses süresi kontrolü için backend metadata gerekebilir ama şimdilik sadece uyarı verelim
                    Accessibility.announce(this.t('runtime.transition.audio_trim_note', 'Note: If the audio file is longer than the transition duration, it will be trimmed automatically.'));
                }
            });

            // Süre değişikliği
            document.getElementById('transition-duration')?.addEventListener('change', () => {
                this.updateTransitionActiveInfo();
            });

            // Önizle butonu
            document.getElementById('btn-transition-preview')?.addEventListener('click', () => {
                this.previewSelectedTransition();
            });

            // Alt+P önizleme kısayolu
            libDialog.addEventListener('keydown', (e) => {
                if (e.altKey && e.key.toLowerCase() === 'p') {
                    e.preventDefault();
                    this.previewSelectedTransition();
                }
            });

            // Aktif olarak ayarla butonu
            document.getElementById('btn-transition-set-active')?.addEventListener('click', () => {
                if (this.selectedTransitionId) {
                    const duration = parseFloat(document.getElementById('transition-duration').value) || 0.5;
                    const useSfx = document.getElementById('transition-use-sfx').checked;
                    const customSfxPath = document.getElementById('transition-custom-sfx').value;

                    Transitions.setActiveTransition(this.selectedTransitionId, {
                        duration: duration,
                        useSfx: useSfx,
                        customSfxPath: customSfxPath || null
                    });

                    libDialog.close();
                }
            });

            // İptal/Kapat butonu
            document.getElementById('btn-transition-cancel')?.addEventListener('click', () => {
                libDialog.close();
            });

            // ESC ile kapat
            libDialog.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    libDialog.close();
                }
            });
        }

        // === GEÇİŞ LİSTESİ ===
        const listDialog = this.transitionListDialog;
        if (listDialog) {
            // Context Menu
            const list = document.getElementById('applied-transition-list');
            this.setupListContextMenu(list, 'transition');

            // Liste öğesi seçimi
            list?.addEventListener('click', (e) => {
                const item = e.target.closest('.applied-transition-item');
                if (item) {
                    document.querySelectorAll('.applied-transition-item').forEach(el => {
                        el.setAttribute('aria-selected', 'false');
                        el.classList.remove('selected');
                        el.setAttribute('tabindex', '-1');
                    });
                    item.setAttribute('aria-selected', 'true');
                    item.classList.add('selected');
                    item.setAttribute('tabindex', '0');
                    item.focus();
                }
            });

            // Klavye navigasyonu (Uygulanmış Geçiş Listesi - EKLENDİ)
            document.getElementById('applied-transition-list')?.addEventListener('keydown', (e) => {
                const items = Array.from(document.querySelectorAll('.applied-transition-item'));
                let index = items.indexOf(document.activeElement);

                // Eğer odak listede değilse (veya items boşsa), selected olanı bulmaya çalış
                if (index === -1) {
                    index = items.findIndex(el => el.classList.contains('selected'));
                }
                if (index === -1 && items.length > 0) index = 0;

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const nextIndex = Math.min(index + 1, items.length - 1);
                    if (items[nextIndex]) {
                        items[nextIndex].click(); // Seçim mantığını tetikle
                        items[nextIndex].focus();
                    }
                    if (items[prevIndex]) {
                        items[prevIndex].click();
                        items[prevIndex].focus();
                    }
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    if (items[index]) {
                        const rect = items[index].getBoundingClientRect();
                        const event = new MouseEvent('contextmenu', {
                            bubbles: true,
                            cancelable: true,
                            view: window,
                            button: 2,
                            buttons: 2,
                            clientX: rect.left + rect.width / 2,
                            clientY: rect.top + rect.height / 2
                        });
                        items[index].dispatchEvent(event);
                    }
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    document.getElementById('btn-transition-goto')?.click();
                } else if (e.key === 'Delete') {
                    e.preventDefault();
                    document.getElementById('btn-transition-delete')?.click();
                }
            });

            // Geçişe git butonu
            document.getElementById('btn-transition-goto')?.addEventListener('click', () => {
                const selected = document.querySelector('.applied-transition-item[aria-selected="true"]');
                if (selected) {
                    const id = selected.getAttribute('data-id');
                    const transition = Transitions.getById(id);
                    if (transition) {
                        VideoPlayer.seekToTimelineTime(transition.time);
                        Accessibility.announce(`${Utils.formatTime(transition.time)} konumuna gidildi`);
                    }
                } else {
                    Accessibility.announce(this.t('runtime.transition.select_first', 'Select a transition first'));
                }
            });

            // Sil butonu
            document.getElementById('btn-transition-delete')?.addEventListener('click', () => {
                const selected = document.querySelector('.applied-transition-item[aria-selected="true"]');
                if (selected) {
                    const id = selected.getAttribute('data-id');
                    Transitions.remove(id);
                    this.updateAppliedTransitionList();
                } else {
                    Accessibility.announce(this.t('runtime.transition.select_first', 'Select a transition first'));
                }
            });

            // Tümünü sil butonu
            document.getElementById('btn-transition-clear-all')?.addEventListener('click', async () => {
                const count = Transitions.getCount();
                if (count === 0) {
                    Accessibility.announce(this.t('runtime.transition.nothing_to_delete', 'There is no transition to delete'));
                    return;
                }

                const confirmed = await this.showAccessibleConfirm(
                    this.t('runtime.transition.clear_all_confirm', '{count} transitions will be deleted. Are you sure?', { count }),
                    this.t('runtime.transition.clear_all_title', 'Delete All Transitions')
                );

                if (confirmed) {
                    Transitions.clearAll();
                    this.updateAppliedTransitionList();
                }
            });

            // Kapat butonu
            document.getElementById('btn-transition-list-close')?.addEventListener('click', () => {
                listDialog.close();
            });
        }
    },

    /**
     * Altyazı TTS diyaloğu event listener'larını kur
     */
    /**
     * Altyazı TTS diyaloğu event listener'larını kur
     */
    setupSubtitleTtsEventListeners() {
        // --- Action Dialog Listeners ---
        const actionDialog = this.subtitleActionDialog;
        const actionConfirm = document.getElementById('sub-action-confirm');
        const actionCancel = document.getElementById('sub-action-cancel');
        const styleDialog = this.subtitleStyleDialog;
        const styleTextColor = document.getElementById('subtitle-style-text-color-select');
        const layoutModeSelect = document.getElementById('subtitle-style-layout-mode');
        const backgroundModeSelect = document.getElementById('subtitle-style-background-mode');
        const styleBgColor = document.getElementById('subtitle-style-bg-color-select');
        const styleBgOpacity = document.getElementById('subtitle-style-bg-opacity');
        const styleBgOpacityVal = document.getElementById('subtitle-style-bg-opacity-val');
        const styleBgColorGroup = document.getElementById('subtitle-style-bg-color-group');
        const styleBgOpacityGroup = document.getElementById('subtitle-style-bg-opacity-group');
        const styleTextColorGroup = styleTextColor?.closest('.form-group');
        const backgroundModeGroup = backgroundModeSelect?.closest('.form-group');
        const styleSizeScale = document.getElementById('subtitle-style-size-scale');
        const styleSizeScaleVal = document.getElementById('subtitle-style-size-scale-val');
        const styleSizeScaleGroup = styleSizeScale?.closest('.form-group');
        const styleAiReviewBtn = document.getElementById('subtitle-style-ai-review');
        const styleAiFeedback = document.getElementById('subtitle-style-ai-feedback');
        const styleConfirm = document.getElementById('subtitle-style-confirm');
        const styleCancel = document.getElementById('subtitle-style-cancel');

        const syncSubtitleStyleUi = () => {
            const isClassic = (layoutModeSelect?.value || 'classic') === 'classic';
            const useBox = (backgroundModeSelect?.value || 'box') === 'box';
            if (styleTextColor) styleTextColor.disabled = isClassic;
            if (backgroundModeSelect) backgroundModeSelect.disabled = isClassic;
            if (styleSizeScale) styleSizeScale.disabled = isClassic;
            if (styleBgColor) styleBgColor.disabled = isClassic || !useBox;
            if (styleBgOpacity) styleBgOpacity.disabled = isClassic || !useBox;
            if (styleTextColorGroup) styleTextColorGroup.style.opacity = isClassic ? '0.55' : '1';
            if (backgroundModeGroup) backgroundModeGroup.style.opacity = isClassic ? '0.55' : '1';
            if (styleSizeScaleGroup) styleSizeScaleGroup.style.opacity = isClassic ? '0.55' : '1';
            if (styleBgColorGroup) styleBgColorGroup.style.opacity = (!isClassic && useBox) ? '1' : '0.55';
            if (styleBgOpacityGroup) styleBgOpacityGroup.style.opacity = (!isClassic && useBox) ? '1' : '0.55';
        };

        const getSubtitleStyleOptions = () => ({
            layoutMode: layoutModeSelect?.value || 'classic',
            textColor: styleTextColor?.value || '#ffffff',
            backgroundMode: backgroundModeSelect?.value || 'box',
            backgroundColor: styleBgColor?.value || '#000000',
            backgroundOpacity: Number(styleBgOpacity?.value || 5),
            sizeScale: Number(styleSizeScale?.value || 50)
        });

        if (actionDialog && !this.actionDialogSetupDone) {
            actionConfirm?.addEventListener('click', () => {
                const selected = actionDialog.querySelector('input[name="sub-action"]:checked')?.value || 'tts-only';
                if (this.subtitleActionResolve) {
                    this.subtitleActionResolve(selected);
                    this.subtitleActionResolve = null;
                }
                actionDialog.close();
            });

            actionCancel?.addEventListener('click', () => {
                if (this.subtitleActionResolve) {
                    this.subtitleActionResolve('cancel');
                    this.subtitleActionResolve = null;
                }
                actionDialog.close();
            });

            actionDialog.addEventListener('close', () => {
                if (this.subtitleActionResolve) {
                    this.subtitleActionResolve('cancel');
                    this.subtitleActionResolve = null;
                }
            });
            this.actionDialogSetupDone = true;
        }

        if (styleDialog && !this.subtitleStyleDialogSetupDone) {
            layoutModeSelect?.addEventListener('change', syncSubtitleStyleUi);
            backgroundModeSelect?.addEventListener('change', syncSubtitleStyleUi);
            styleBgOpacity?.addEventListener('input', () => {
                if (styleBgOpacityVal) styleBgOpacityVal.textContent = `%${styleBgOpacity.value}`;
            });
            styleSizeScale?.addEventListener('input', () => {
                if (styleSizeScaleVal) styleSizeScaleVal.textContent = `%${styleSizeScale.value}`;
            });
            styleAiReviewBtn?.addEventListener('click', async () => {
                Accessibility.announce(this.t('dialog.subtitle_style.ai_review_loading', 'Yapay zeka altyazı ayarlarını inceliyor...'));
                if (styleAiReviewBtn) {
                    styleAiReviewBtn.disabled = true;
                }
                if (styleAiFeedback) {
                    styleAiFeedback.value = this.t('dialog.subtitle_style.ai_review_loading', 'Yapay zeka altyazı ayarlarını inceliyor...');
                }
                try {
                    const apiData = await window.api.getGeminiApiData();
                    if (!apiData?.apiKey) {
                        if (styleAiFeedback) {
                            styleAiFeedback.value = this.t('dialog.subtitle_style.ai_review_missing_key', 'Gemini API anahtarı ayarlı değil.');
                            styleAiFeedback.focus();
                        }
                        Accessibility.alert(this.t('dialog.subtitle_style.ai_review_missing_key', 'Gemini API anahtarı ayarlı değil.'));
                        return;
                    }
                    const currentStyleOptions = getSubtitleStyleOptions();
                    const layoutModeLabel = currentStyleOptions.layoutMode === 'classic'
                        ? this.t('dialog.subtitle_style.layout_mode_classic', 'Klasik ve Kararlı (1.0.3 benzeri)')
                        : this.t('dialog.subtitle_style.layout_mode_custom', 'Özelleştirilebilir Yeni Düzen');
                    let prompt = this.t(
                        'dialog.subtitle_style.ai_review_prompt',
                        'Sen erişilebilir video altyazıları konusunda uzman bir yardımcı asistansın. Şu altyazı ayarlarını kısaca değerlendir: yerleşim biçimi {layoutMode}, yazı rengi {textColor}, arka plan rengi {backgroundColor}, arka plan opaklığı yüzde {backgroundOpacity}, yazı boyutu yüzde {sizeScale}. En fazla 3 kısa cümleyle okunabilirlik yorumu ver ve gerekirse küçük bir öneri söyle.',
                        {
                            layoutMode: layoutModeLabel,
                            textColor: currentStyleOptions.textColor,
                            backgroundColor: currentStyleOptions.backgroundColor,
                            backgroundOpacity: currentStyleOptions.backgroundOpacity,
                            sizeScale: currentStyleOptions.sizeScale
                        }
                    );
                    let imageBase64 = null;
                    let requestVariants = [{
                        imageBase64: null,
                        prompt
                    }];
                    if (this.subtitleStylePreviewContext?.videoPath && this.subtitleStylePreviewContext?.previewText) {
                        try {
                            requestVariants = await this.buildSubtitleStyleAiReviewVariants({
                                videoPath: this.subtitleStylePreviewContext.videoPath,
                                previewTime: this.subtitleStylePreviewContext.previewTime || 0,
                                previewText: this.subtitleStylePreviewContext.previewText,
                                styleOptions: currentStyleOptions,
                                basePrompt: prompt
                            });
                        } catch (previewError) {
                            console.warn('[SubtitleStyleAI] Preview image could not be prepared:', previewError);
                            requestVariants = [{
                                imageBase64: null,
                                prompt: `${prompt}\n\nGörsel önizleme hazırlanamadı. Yalnızca verilen altyazı ayarlarına göre kısa ve güvenli bir okunabilirlik değerlendirmesi yap.`
                            }];
                            if (styleAiFeedback) {
                                styleAiFeedback.value = this.t(
                                    'dialog.subtitle_style.ai_review_preview_failed',
                                    'Görsel önizleme hazırlanamadı, değerlendirme yalnızca seçilen ayarlara göre yapılacak.'
                                );
                            }
                        }
                    }
                    let response = null;
                    let lastAiError = null;
                    for (let i = 0; i < requestVariants.length; i++) {
                        const variant = requestVariants[i];
                        imageBase64 = variant.imageBase64;
                        response = await window.api.geminiVisionRequest({
                            apiKey: apiData.apiKey,
                            model: apiData.model,
                            imageBase64,
                            prompt: variant.prompt
                        });

                        if (response?.success) {
                            break;
                        }

                        lastAiError = response?.error || this.t('runtime.app.unknown_error', 'Bilinmeyen hata');
                        const canFallback = i < requestVariants.length - 1 && this.isAiCapacityErrorMessage(lastAiError);
                        if (!canFallback) {
                            break;
                        }
                    }
                    if (styleAiFeedback) {
                        styleAiFeedback.value = response?.success
                            ? (response.text || this.t('dialog.subtitle_style.ai_review_empty', 'Yapay zekadan yorum alınamadı.'))
                            : this.t('dialog.subtitle_style.ai_review_failed', 'Yapay zeka yorumu alınamadı: {error}', {
                                error: lastAiError || response?.error || this.t('runtime.app.unknown_error', 'Bilinmeyen hata')
                            });
                        styleAiFeedback.focus();
                    }
                    Accessibility.announce(
                        response?.success
                            ? this.t('dialog.subtitle_style.ai_review_ready', 'Yapay zeka yorumu hazır.')
                            : this.t('dialog.subtitle_style.ai_review_failed_short', 'Yapay zeka yorumu alınamadı.')
                    );
                } catch (error) {
                    if (styleAiFeedback) {
                        styleAiFeedback.value = this.t('dialog.subtitle_style.ai_review_failed', 'Yapay zeka yorumu alınamadı: {error}', {
                            error: error.message || String(error)
                        });
                        styleAiFeedback.focus();
                    }
                    Accessibility.alert(this.t('dialog.subtitle_style.ai_review_failed_short', 'Yapay zeka yorumu alınamadı.'));
                } finally {
                    if (styleAiReviewBtn) {
                        styleAiReviewBtn.disabled = false;
                    }
                }
            });
            styleConfirm?.addEventListener('click', () => {
                if (this.subtitleStyleResolve) {
                    this.subtitleStyleResolve(getSubtitleStyleOptions());
                    this.subtitleStyleResolve = null;
                }
                styleDialog.close();
            });
            styleCancel?.addEventListener('click', () => {
                if (this.subtitleStyleResolve) {
                    this.subtitleStyleResolve('cancel');
                    this.subtitleStyleResolve = null;
                }
                styleDialog.close();
            });
            styleDialog.addEventListener('close', () => {
                if (this.subtitleStyleResolve) {
                    this.subtitleStyleResolve('cancel');
                    this.subtitleStyleResolve = null;
                }
            });
            this.subtitleStyleDialogSetupDone = true;
        }

        // --- TTS Options Dialog Listeners ---
        const dialog = this.subtitleTtsDialog;
        const serviceSelect = document.getElementById('subtitle-tts-service');
        const voiceSelect = document.getElementById('subtitle-tts-voice');
        const speedInput = document.getElementById('subtitle-tts-speed');
        const volumeInput = document.getElementById('subtitle-tts-volume');
        const originalVolumeInput = document.getElementById('subtitle-original-volume'); // YENİ
        const previewBtn = document.getElementById('subtitle-tts-preview-btn');
        const confirmBtn = document.getElementById('subtitle-tts-confirm');
        const cancelBtn = document.getElementById('subtitle-tts-cancel');

        // Miktar (Volume) güncelleme
        const updateSpeed = () => {
            if (document.getElementById('subtitle-tts-speed-val'))
                document.getElementById('subtitle-tts-speed-val').textContent = `%${speedInput.value}`;
        };
        const updateTtsVolume = () => {
            if (document.getElementById('subtitle-tts-volume-val'))
                document.getElementById('subtitle-tts-volume-val').textContent = `%${volumeInput.value}`;
        };
        const updateOriginalVolume = () => { // YENİ
            if (document.getElementById('subtitle-original-volume-val'))
                document.getElementById('subtitle-original-volume-val').textContent = `%${originalVolumeInput.value}`;
        };

        speedInput?.addEventListener('input', updateSpeed);
        volumeInput?.addEventListener('input', updateTtsVolume);
        originalVolumeInput?.addEventListener('input', updateOriginalVolume);
        serviceSelect?.addEventListener('change', () => {
            this.loadSubtitleTtsVoices({ force: true }).catch((error) => {
                console.error('Subtitle TTS voices reload failed:', error);
            });
        });

        // Önizleme (Sadece ses)
        previewBtn?.addEventListener('click', async () => {
            const text = document.getElementById('subtitle-preview-text').textContent;
            const service = serviceSelect ? serviceSelect.value : 'system';
            const voice = voiceSelect.value;
            const speed = parseFloat(speedInput.value) / 100;
            const volume = parseInt(volumeInput.value);

            Accessibility.announce(this.t('runtime.subtitle.preview_preparing', 'Preparing preview...'));
            previewBtn.disabled = true;

            try {
                // generateTts yerine previewTts kullanıyoruz
                const result = await window.api.previewTts({
                    text: text,
                    service: service,
                    voice: voice,
                    speed: speed,
                    volume: volume
                });

                if (result.success) {
                    if (result.spokeDirect) {
                        // Doğrudan okundu
                        console.log('TTS spoke directly');
                    } else if (result.wavPath || result.audioPath) {
                        // Dosya yolu döndü
                        const path = result.wavPath || result.audioPath;
                        const audio = new Audio(`file:///${path.replace(/\\/g, '/')}`);
                        await audio.play();
                        Accessibility.announce(this.t('runtime.subtitle.preview_playing', 'Preview is playing'));
                    }
                } else {
                    Accessibility.announceError(this.t('runtime.subtitle.preview_failed', 'Preview could not be created: {error}', {
                        error: result.error || this.t('runtime.subtitle.unknown_error', 'Unknown error')
                    }));
                }
            } catch (e) {
                console.error(e);
                Accessibility.announceError(this.t('runtime.common.error', 'Error: {error}', { error: e.message }));
            } finally {
                previewBtn.disabled = false;
            }
        });

        // Onay
        confirmBtn?.addEventListener('click', () => {
            if (this.subtitleTtsResolve) {
                const serviceVal = serviceSelect ? serviceSelect.value : 'system';
                const voiceVal = voiceSelect ? voiceSelect.value : '';
                const speedVal = speedInput ? parseFloat(speedInput.value) / 100 : 1.0;
                const volumeVal = volumeInput ? parseInt(volumeInput.value) : 100;
                const origVolVal = originalVolumeInput ? (parseInt(originalVolumeInput.value) / 100) : 0.2; // Varsayılan 0.2

                this.subtitleTtsResolve({
                    service: serviceVal,
                    voice: voiceVal,
                    speed: speedVal,
                    volume: volumeVal,
                    originalVolume: origVolVal,
                    confirmed: true
                });
                this.subtitleTtsResolve = null;
            }
            dialog.close();
        });

        // İptal (Tamamen iptal)
        cancelBtn?.addEventListener('click', () => {
            // İptal durumunda null döneriz
            if (this.subtitleTtsResolve) {
                this.subtitleTtsResolve(null);
                this.subtitleTtsResolve = null;
            }
            dialog.close();
        });

        dialog?.addEventListener('close', () => {
            if (this.subtitleTtsResolve) {
                this.subtitleTtsResolve(null);
                this.subtitleTtsResolve = null;
            }
        });
    },

    async loadSubtitleTtsVoices({ selectedVoice = '', force = false } = {}) {
        const serviceSelect = document.getElementById('subtitle-tts-service');
        const voiceSelect = document.getElementById('subtitle-tts-voice');
        if (!voiceSelect) return;
        if (!force && voiceSelect.options.length > 1) return;

        const service = serviceSelect ? serviceSelect.value : 'system';
        const result = await window.api.getTtsVoices({ service });
        if (result.success) {
            voiceSelect.innerHTML = `<option value="">${this.t('dialog.subtitle_tts.default_voice', 'Default')}</option>`;
            (result.voices || []).forEach((voice) => {
                const voiceId = typeof voice === 'string' ? voice : voice?.id;
                const voiceName = typeof voice === 'string' ? voice : voice?.name;
                if (!voiceId || !voiceName) return;
                const opt = document.createElement('option');
                opt.value = voiceId;
                opt.textContent = voiceName;
                voiceSelect.appendChild(opt);
            });
            if (selectedVoice && Array.from(voiceSelect.options).some((option) => option.value === selectedVoice)) {
                voiceSelect.value = selectedVoice;
            }
            return;
        }
        voiceSelect.innerHTML = `<option value="">${this.t('dialog.subtitle_tts.voice_load_failed', 'Voices could not be loaded')}</option>`;
    },

    /**
     * Altyazı TTS diyaloğunu göster
     */
    async showSubtitleTtsOptionsDialog(previewText) {
        document.getElementById('subtitle-preview-text').textContent = previewText;
        window.i18nHelper?.translateDOM?.(this.subtitleTtsDialog);

        // Sesleri yükle
        const serviceSelect = document.getElementById('subtitle-tts-service');
        if (serviceSelect) serviceSelect.value = serviceSelect.value || 'system';
        await this.loadSubtitleTtsVoices({ force: true });

        this.subtitleTtsDialog.showModal();
        Accessibility.announce(this.t('runtime.subtitle.tts_dialog_opened', 'Speech settings opened. You can adjust the original video volume here.'));

        // Button focus
        document.getElementById('subtitle-tts-confirm')?.focus();

        return new Promise((resolve) => {
            this.subtitleTtsResolve = resolve;
        });
    },

    /**
     * Altyazı işlem diyaloğunu göster
     */
    showSubtitleActionDialog(previewContext = null) {
        this.subtitleStylePreviewContext = previewContext || null;
        window.i18nHelper?.translateDOM?.(this.subtitleActionDialog);
        this.subtitleActionDialog.showModal();
        Accessibility.announce(this.t('runtime.subtitle.action_dialog_opened', 'Subtitle action selection. Please choose an option.'));

        // İlk radyoya odaklan
        const firstRadio = this.subtitleActionDialog.querySelector('input[type="radio"]');
        if (firstRadio) firstRadio.focus();

        return new Promise((resolve) => {
            this.subtitleActionResolve = resolve;
        });
    },

    showSubtitleStyleDialog(previewContext = null, initialStyleOptions = null) {
        this.subtitleStylePreviewContext = previewContext || null;
        window.i18nHelper?.translateDOM?.(this.subtitleStyleDialog);

        const resolvedStyleOptions = {
            layoutMode: initialStyleOptions?.layoutMode || 'classic',
            textColor: initialStyleOptions?.textColor || '#FFFFFF',
            backgroundMode: initialStyleOptions?.backgroundMode || 'box',
            backgroundColor: initialStyleOptions?.backgroundColor || '#000000',
            backgroundOpacity: Number(initialStyleOptions?.backgroundOpacity ?? 5),
            sizeScale: Number(initialStyleOptions?.sizeScale ?? 50)
        };

        const styleTextColor = document.getElementById('subtitle-style-text-color-select');
        const layoutModeSelect = document.getElementById('subtitle-style-layout-mode');
        const backgroundModeSelect = document.getElementById('subtitle-style-background-mode');
        const styleBgColor = document.getElementById('subtitle-style-bg-color-select');
        const styleBgOpacity = document.getElementById('subtitle-style-bg-opacity');
        const styleBgOpacityVal = document.getElementById('subtitle-style-bg-opacity-val');
        const styleBgColorGroup = document.getElementById('subtitle-style-bg-color-group');
        const styleBgOpacityGroup = document.getElementById('subtitle-style-bg-opacity-group');
        const styleSizeScale = document.getElementById('subtitle-style-size-scale');
        const styleSizeScaleVal = document.getElementById('subtitle-style-size-scale-val');
        const styleAiFeedback = document.getElementById('subtitle-style-ai-feedback');

        if (layoutModeSelect) layoutModeSelect.value = resolvedStyleOptions.layoutMode;
        if (styleTextColor) styleTextColor.value = resolvedStyleOptions.textColor.toUpperCase();
        if (backgroundModeSelect) backgroundModeSelect.value = resolvedStyleOptions.backgroundMode;
        if (styleBgColor) styleBgColor.value = resolvedStyleOptions.backgroundColor.toUpperCase();
        if (styleBgOpacity) styleBgOpacity.value = String(resolvedStyleOptions.backgroundOpacity);
        if (styleBgOpacityVal) styleBgOpacityVal.textContent = `%${resolvedStyleOptions.backgroundOpacity}`;
        if (styleSizeScale) styleSizeScale.value = String(resolvedStyleOptions.sizeScale);
        if (styleSizeScaleVal) styleSizeScaleVal.textContent = `%${resolvedStyleOptions.sizeScale}`;
        if (styleAiFeedback) styleAiFeedback.value = '';
        const isClassic = (layoutModeSelect?.value || 'classic') === 'classic';
        const useBox = (backgroundModeSelect?.value || 'box') === 'box';
        if (styleTextColor) styleTextColor.disabled = isClassic;
        if (backgroundModeSelect) backgroundModeSelect.disabled = isClassic;
        if (styleSizeScale) styleSizeScale.disabled = isClassic;
        if (styleBgColor) styleBgColor.disabled = isClassic || !useBox;
        if (styleBgOpacity) styleBgOpacity.disabled = isClassic || !useBox;
        if (styleTextColor?.closest('.form-group')) styleTextColor.closest('.form-group').style.opacity = isClassic ? '0.55' : '1';
        if (backgroundModeSelect?.closest('.form-group')) backgroundModeSelect.closest('.form-group').style.opacity = isClassic ? '0.55' : '1';
        if (styleSizeScale?.closest('.form-group')) styleSizeScale.closest('.form-group').style.opacity = isClassic ? '0.55' : '1';
        if (styleBgColorGroup) styleBgColorGroup.style.opacity = (!isClassic && useBox) ? '1' : '0.55';
        if (styleBgOpacityGroup) styleBgOpacityGroup.style.opacity = (!isClassic && useBox) ? '1' : '0.55';

        this.subtitleStyleDialog.showModal();
        Accessibility.announce(this.t('runtime.subtitle.style_dialog_opened', 'Altyazı görünüm ayarları açıldı.'));
        layoutModeSelect?.focus();

        return new Promise((resolve) => {
            this.subtitleStyleResolve = resolve;
        });
    },

    // ==========================================
    // YARDIM / KULLANIM KILAVUZU
    // ==========================================

    helpTopics: [
        {
            id: 'intro',
            titleKey: 'help.intro.title',
            contentKey: 'help.intro.content',
            title: 'Giriş',
            content: `
                <h3>Engelsiz Video Düzenleyicisi'ne Hoş Geldiniz</h3>
                <p>Bu uygulama, görme engelli kullanıcılar için özel olarak tasarlanmış, ekran okuyucu dostu ve klavye odaklı bir video düzenleme aracıdır.</p>
                <p>Soldaki menüden merak ettiğiniz konuyu seçerek detaylı bilgi alabilirsiniz.</p>
            `
        },
        {
            id: 'menu-bar',
            titleKey: 'help.menu_bar.title',
            contentKey: 'help.menu_bar.content',
            title: 'Menü Çubuğu Tanıtımı',
            content: `
                <h3>Menü Çubuğu</h3>
                <p>Uygulamanın ana menüsü standart Windows menü yapısındadır. Alt tuşuna basarak menüye erişebilirsiniz.</p>
                <ul>
                    <li><strong>Dosya (Alt+D):</strong> Yeni proje, açma, kaydetme ve dışa aktarma işlemleri.</li>
                    <li><strong>Düzenle (Alt+Z):</strong> Kes, kopyala, yapıştır, geri al ve seçim işlemleri.</li>
                    <li><strong>Oynat (Alt+O):</strong> Videoyu oynatma, duraklatma ve navigasyon komutları.</li>
                    <li><strong>Ekle (Alt+E):</strong> Video, ses, resim ve altyazı ekleme araçları.</li>
                    <li><strong>Görünüm (Alt+R):</strong> Video döndürme ve tam ekran seçenekleri.</li>
                    <li><strong>Git (Alt+G):</strong> Belirli zamanlara veya işaretçilere hızlı gitme komutları.</li>
                    <li><strong>İşaretçiler (Alt+C):</strong> İşaretçi ekleme ve yönetim.</li>
                    <li><strong>Yapay Zeka (Alt+Y):</strong> AI tabanlı betimleme ve analiz araçları.</li>
                    <li><strong>Yardım (Alt+M):</strong> Kısayollar ve bu kılavuz.</li>
                </ul>
            `
        },
        {
            id: 'api-key',
            titleKey: 'help.api_key.title',
            contentKey: 'help.api_key.content',
            title: 'Gemini API Anahtarı Girme',
            content: `
                <h3>Gemini API Anahtarı Nasıl Girilir?</h3>
                <p>Yapay zeka özelliklerini kullanmak için Google Gemini API anahtarı gereklidir.</p>
                <ol>
                    <li><strong>Yapay Zeka</strong> menüsüne gidin (Alt + Y).</li>
                    <li><strong>Gemini API Anahtarı...</strong> seçeneğini seçin.</li>
                    <li>Açılan pencerede, API anahtarınızı yapıştırın.</li>
                    <li>Model olarak "Gemini 2.5 Flash" (Hızlı) veya "Gemini 1.5 Flash" (Ekonomik) seçin.</li>
                    <li><strong>Kaydet</strong> butonuna basın.</li>
                </ol>
            `
        },
        {
            id: 'location-desc',
            titleKey: 'help.location_desc.title',
            contentKey: 'help.location_desc.content',
            title: 'Bulunduğun Konumu Betimle',
            content: `
                <h3>Anlık Sahne Betimlemesi</h3>
                <p>Videonun o anki karesinde ne olduğunu öğrenmek için:</p>
                <ol>
                    <li>Videoyu istediğiniz bir yerde durdurun.</li>
                    <li><strong>Yapay Zeka</strong> menüsünden <strong>Bulunduğun Konumu Betimle</strong>'yi seçin (veya Ctrl+Alt+V).</li>
                    <li>Yapay zeka, o anı çevreleyen yaklaşık 5 saniyelik bölümü analiz eder ve size sesli olarak anlatır.</li>
                </ol>
            `
        },
        {
            id: 'smart-selection',
            titleKey: 'help.smart_selection.title',
            contentKey: 'help.smart_selection.content',
            title: 'Akıllı Seçim',
            content: `
                <h3>Akıllı Seçim Nedir?</h3>
                <p>Seçtiğiniz bir alanın (başlangıç ve bitiş noktaları) mantıklı olup olmadığını (örn: cümle ortasında mı kesilmiş) yapay zekaya sorabilirsiniz.</p>
                <ol>
                    <li>Bir alan seçin (Shift + Yön Tuşları veya İşaretçiler ile).</li>
                    <li><strong>Yapay Zeka</strong> menüsünden <strong>Akıllı Seçim Kontrolü</strong>'nü seçin (Ctrl+I).</li>
                    <li>Yapay zeka seçimi analiz eder ve gerekirse "Biraz daha uzatmalısın" gibi önerilerde bulunur.</li>
                </ol>
            `
        },
        {
            id: 'selection-desc',
            titleKey: 'help.selection_desc.title',
            contentKey: 'help.selection_desc.content',
            title: 'Seçimi Betimle',
            content: `
                <h3>Seçili Alanı Betimle</h3>
                <p>Belirlediğiniz spesifik bir aralıkta neler olduğunu öğrenmek için:</p>
                <ol>
                    <li>Video üzerinde bir bölüm seçin.</li>
                    <li><strong>Yapay Zeka</strong> menüsünden <strong>Seçimi Betimle</strong>'ye tıklayın (Ctrl+Alt+D).</li>
                    <li>Yapay zeka seçili aralıktaki olayları özetler.</li>
                </ol>
            `
        },
        {
            id: 'new-project',
            titleKey: 'help.new_project.title',
            contentKey: 'help.new_project.content',
            title: 'Yeni Slayt/Video Projesi',
            content: `
                <h3>Yeni Proje Oluşturma</h3>
                <p>Sıfırdan bir çalışma başlatmak için:</p>
                <ul>
                    <li><strong>Dosya > Yeni Slayt Projesi (Ctrl+Shift+N):</strong> Resim ve seslerden oluşan bir slayt gösterisi hazırlar.</li>
                    <li><strong>Dosya > Yeni (Ctrl+N):</strong> Mevcut çalışmayı temizler ve boş bir video düzenleme oturumu açar.</li>
                </ul>
            `
        },
        {
            id: 'save-options',
            titleKey: 'help.save_options.title',
            contentKey: 'help.save_options.content',
            title: 'Kaydetme Seçenekleri',
            content: `
                <h3>Projeyi ve Videoyu Kaydetme</h3>
                <ul>
                    <li><strong>Projeyi Kaydet (.kve):</strong> Çalışmanızı daha sonra düzenlemek üzere proje dosyası olarak saklar.</li>
                    <li><strong>Videoyu Farklı Kaydet:</strong> Çalışmanızı MP4 formatında son halini alarak dışa aktarır.</li>
                    <li><strong>Sadece Ses Dışa Aktar:</strong> Videonun sadece sesini MP3 veya WAV olarak kaydeder.</li>
                </ul>
            `
        },
        {
            id: 'select-delete',
            titleKey: 'help.select_delete.title',
            contentKey: 'help.select_delete.content',
            title: 'Seçim ve Silme',
            content: `
                <h3>Seçim Yapma</h3>
                <ul>
                    <li><strong>Shift + Sağ/Sol Ok:</strong> İmleçten itibaren belirlediğiniz ince ayar süresi kadar (örn. 1sn) seçim yapar.</li>
                    <li><strong>I ve O Tuşları (veya [ ve ]):</strong> Başlangıç ve bitiş noktalarını işaretler (planlanan kısayol). Şu an için İşaretçiler (M) ve Ctrl+Shift+Ok tuşları ile işaretçiler arası seçim yapabilirsiniz.</li>
                </ul>
                <h3>Silme</h3>
                <p>Seçili alanı videodan çıkarmak için <strong>Delete</strong> tuşuna basın.</p>
            `
        },
        {
            id: 'playback',
            titleKey: 'help.playback.title',
            contentKey: 'help.playback.content',
            title: 'Oynatma İşlemleri',
            content: `
                <h3>Temel Kontroller</h3>
                <ul>
                    <li><strong>Boşluk (Space):</strong> Oynat/Duraklat (Duraklatınca başa döner - önizleme modu).</li>
                    <li><strong>Enter:</strong> Oynuyorsa o noktada duraklatır ve imleci bırakır; duruyorsa aynı noktadan devam eder.</li>
                    <li><strong>Ctrl + Space:</strong> Olduğu yerde duraklat.</li>
                    <li><strong>Shift + Space:</strong> Sadece seçili alanı oynat.</li>
                    <li><strong>Sağ/Sol Ok:</strong> Ufak adımlarla ileri/geri sar (dururken ses önizlemesi yapar).</li>
                </ul>
            `
        },
        {
            id: 'add-text',
            titleKey: 'help.add_text.title',
            contentKey: 'help.add_text.content',
            title: 'Metin Ekleme',
            content: `
                <h3>Videoya Yazı Ekleme</h3>
                <ol>
                    <li><strong>Ekle > Metin Ekle</strong> menüsünü seçin.</li>
                    <li>Metninizi yazın, renk, boyut ve konumunu (Üst/Orta/Alt) seçin.</li>
                    <li>"Tüm video boyunca" veya belirli bir süre için ayarlayabilirsiniz.</li>
                    <li>İsterseniz "Yazıyı Seslendir (TTS)" seçeneği ile yazının okunmasını sağlayabilirsiniz.</li>
                </ol>
            `
        },
        {
            id: 'add-audio',
            titleKey: 'help.add_audio.title',
            contentKey: 'help.add_audio.content',
            title: 'Ses Ekleme',
            content: `
                <h3>Ek Ses / Müzik Ekleme</h3>
                <ol>
                    <li><strong>Ekle > Ses Ekle</strong> menüsünü seçin.</li>
                    <li>Bir ses dosyası (MP3, WAV vb.) seçin.</li>
                    <li>Açılan pencerede ses seviyesini ve video sesiyle karışım oranını ayarlayın.</li>
                    <li>"Fon müziği" yaparsanız video bitene kadar döngüye girer.</li>
                </ol>
            `
        },
        {
            id: 'add-image',
            titleKey: 'help.add_image.title',
            contentKey: 'help.add_image.content',
            title: 'Görsel/Logo Ekleme',
            content: `
                <h3>Görsel Ekleme Sihirbazı</h3>
                <p>Videoya logo, filigran veya resim eklemek için:</p>
                <ol>
                    <li><strong>Ekle > Görsel Ekle</strong> menüsünü seçin (veya Ctrl+Shift+G).</li>
                    <li><strong>Tür Seçimi:</strong> Filigran (köşede ufak), Serbest (resim içinde resim) veya Tam Ekran.</li>
                    <li><strong>Konumlandırma:</strong> Sesli geri bildirim veya Yön tuşları ile görseli ekrana yerleştirin.</li>
                    <li>Yapay zeka desteği ile en uygun boş alanı bulmasını isteyebilirsiniz.</li>
                </ol>
            `
        },
        {
            id: 'recording-wizard',
            titleKey: 'help.recording_wizard.title',
            contentKey: 'help.recording_wizard.content',
            title: 'Erişilebilir Kayıt Sihirbazı',
            content: `
                <h3>Erişilebilir Kayıt Sihirbazı</h3>
                <p>OBS Studio ile ekran, pencere, mikrofon ve kamera kaydı almak için bu sihirbazı kullanabilirsiniz.</p>
                <ol>
                    <li><strong>Dosya &gt; Referans Sesle Video Kaydet</strong> veya <strong>Erişilebilir Kayıt</strong> menüsünden sihirbazı açın.</li>
                    <li>Önce OBS bağlantısını test edin ve ekran ya da pencere kaynağını seçin.</li>
                    <li>İsterseniz kamera overlay ve sistem sesi ekleyin.</li>
                    <li>Ön ayarlarla düzeni kurun, gerekirse yapay zekadan konum önerisi alın.</li>
                    <li>Son adımda kaydı başlatın, duraklatın ve bitince kayıt klasörüne ulaşın.</li>
                </ol>
            `
        },
        {
            id: 'zoom-recording',
            titleKey: 'help.zoom_recording.title',
            contentKey: 'help.zoom_recording.content',
            title: 'Zoom Kaydı İçin İpuçları',
            content: `
                <h3>Zoom Penceresini Daha Temiz Kaydetme</h3>
                <p>Zoom genellikle pencere kaydında daha temiz sonuç verir; ancak toplantı görünümü doğru ayarlanmazsa gereksiz katılımcı kutuları veya boş video alanları görünebilir.</p>
                <ol>
                    <li>Zoom toplantısını ayrı bir pencere olarak açık tutun.</li>
                    <li>Mümkünse <strong>Speaker View</strong> veya en sade toplantı düzenini seçin.</li>
                    <li>Toplantıda kamerası kapalı bir katılımcı varsa, sağ alt gibi alanlarda boş ya da kamera kapalı kutusu görünebilir. Bu durumda Zoom içindeki görünümü sadeleştirin.</li>
                    <li>Kayıt başlamadan önce sohbet, katılımcılar ve benzeri yan panellerin kapalı olduğundan emin olun.</li>
                    <li>Sonucu doğrulamak için kısa bir test kaydı alın ve gerekirse pencere düzenini yeniden kurun.</li>
                </ol>
                <p><strong>Öneri:</strong> Zoom penceresi temiz görünüyorsa EVD tarafında genelde ekstra bir işlem gerekmez; asıl önemli olan Zoom içindeki toplantı düzenidir.</p>
            `
        },
        {
            id: 'meet-recording',
            titleKey: 'help.meet_recording.title',
            contentKey: 'help.meet_recording.content',
            title: 'Google Meet Kaydı İçin İpuçları',
            content: `
                <h3>Google Meet Penceresini Daha Temiz Kaydetme</h3>
                <p>Google Meet web tarayıcısı içinde çalıştığı için, kayıt alınırken yalnızca konuşmacılar değil tarayıcı ve Meet arayüzünün bazı kısımları da görünebilir. Bu yüzden kayıt öncesi pencereyi hazırlamak daha önemlidir.</p>
                <ol>
                    <li>Meet'i mümkünse ayrı bir tarayıcı penceresinde açın.</li>
                    <li>Toplantı başlamadan önce ayarlar, sohbet, katılımcılar ve benzeri panelleri kapatın.</li>
                    <li>Tarayıcıyı önce büyütün, mümkünse ardından <strong>F11</strong> ile tam ekrana alın.</li>
                    <li>Fareyi hareket ettirmeden birkaç saniye bekleyin; böylece alt kontrol çubuğu çoğu zaman kaybolur.</li>
                    <li>Kayıt sırasında yeni bir pencere ya da ayar kutusu açmayın; bunlar doğrudan kayda girebilir.</li>
                </ol>
                <p><strong>Önemli not:</strong> Meet kontrol çubuğu ve bazı pencere öğeleri Meet içeriğinin bir parçası gibi davrandığı için, pencere kaydında görünmeleri normal olabilir. En temiz sonuç için kayıt öncesi görünümü sadeleştirmek gerekir.</p>
            `
        },
        {
            id: 'vertical-video',
            titleKey: 'help.vertical_video.title',
            contentKey: 'help.vertical_video.content',
            title: 'Dikey Video (Shorts/Reels) Oluşturma',
            content: `
                <h3>Dikey Video Oluşturma</h3>
                <p>Yatay bir videoyu Shorts, Reels veya TikTok için hızlıca 9:16 formata dönüştürmek istediğinizde bu araç işinizi kolaylaştırır.</p>
                <ol>
                    <li><strong>Ekle &gt; Dikey Video (Shorts/Reels) Oluştur</strong> menüsünü açın.</li>
                    <li>Kaynak videoyu seçin ve çıktı klasörünü belirleyin.</li>
                    <li>Kırpma, bulanık arka plan veya letterbox yöntemlerinden size uygun olanı seçin.</li>
                    <li>İsterseniz yapay zekadan sahneye en uygun çerçeve önerisini alın.</li>
                <li>Ön izleme yapın ve sonucu oluşturarak yeni dikey videoyu kaydedin.</li>
                </ol>
            `
        },
        {
            id: 'selection-list',
            titleKey: 'help.selection_list.title',
            contentKey: 'help.selection_list.content',
            title: 'Seçim Listesi',
            content: `
                <h3>Birden Fazla Seçimi Toplayıp Sonra İşleme</h3>
                <p>Uzun bir videodan birden fazla bölümü ayırmak, sıralamak ve sonra topluca işlemek istediğinizde seçim listesi en pratik yoldur.</p>
                <ol>
                    <li>Önce videoda bir alan seçin.</li>
                    <li><strong>Ekle &gt; Seçili Alanı Seçim Listesine Ekle</strong> komutunu kullanın.</li>
                    <li>Seçimi temizleyip başka aralıklar seçin ve aynı şekilde listeye eklemeye devam edin.</li>
                    <li><strong>Ekle &gt; Seçim Listesi</strong> penceresini açın.</li>
                    <li>Listede öğeleri dinleyin, silin, yukarı veya aşağı taşıyın.</li>
                    <li>İsterseniz tüm listeyi tek klipte birleştirin, isterseniz seçim listesinden dikey videolar üretin.</li>
                </ol>
            `
        },
        {
            id: 'live-effects-panel',
            titleKey: 'help.live_effects_panel.title',
            contentKey: 'help.live_effects_panel.content',
            title: 'Canlı Efekt Paneli',
            content: `
                <h3>Kayıt ve Yayın İçin Efekt Bankası</h3>
                <p>Canlı Efekt Paneli, kayıt veya yayın sırasında hızlıca çalacağınız sesleri, videoları ve isteğe bağlı görselleri önceden hazırlamanızı sağlar.</p>
                <ol>
                    <li><strong>Erişilebilir Video Kaydı &gt; Canlı Efekt Paneli</strong> komutunu açın.</li>
                    <li>Bir profil seçin ya da yeni profil oluşturun.</li>
                    <li>Slotlara ses veya video dosyaları ekleyin. Ses slotlarına isterseniz görsel de bağlayın.</li>
                    <li>Başlangıç ve bitiş efekti olarak kullanılacak slotları belirleyin.</li>
                    <li>Kayıt sihirbazında canlı efekt katmanını açın ve efektleri oturum sırasında çalın.</li>
                    <li>Panel içinde hızlı gezinim için <strong>Alt+R</strong>, <strong>Alt+1-0</strong>, <strong>Alt+P</strong> ve <strong>Alt+Ctrl+P</strong> kısayollarını kullanabilirsiniz.</li>
                </ol>
            `
        },
        {
            id: 'transitions',
            titleKey: 'help.transitions.title',
            contentKey: 'help.transitions.content',
            title: 'Geçiş Efekti Ekleme',
            content: `
                <h3>Geçişler</h3>
                <p>Videolar arası veya kesim noktalarında yumuşak geçiş için:</p>
                <ol>
                    <li>İmleci geçiş yapmak istediğiniz kesim noktasına getirin.</li>
                    <li><strong>Ş</strong> tuşu ile hızlıca varsayılan geçişi ekleyin.</li>
                    <li>veya <strong>Ekle > Geçiş Kütüphanesi (Ctrl+Shift+T)</strong> ile farklı efektler seçin.</li>
                    <li>Efektlere ses efekti (swoosh vb.) de ekleyebilirsiniz.</li>
                </ol>
            `
        },
        {
            id: 'subtitles',
            titleKey: 'help.subtitles.title',
            contentKey: 'help.subtitles.content',
            title: 'Altyazı Ekleme',
            content: `
                <h3>Altyazı İşlemleri</h3>
                <p>SRT dosyasını videoya gömmek veya seslendirmek için:</p>
                <ol>
                    <li><strong>Ekle > Altyazı Dosyası Ekle</strong> menüsünü kullanın.</li>
                    <li>Bir SRT dosyası seçin.</li>
                    <li>Seçenekler:
                        <ul>
                            <li><strong>Sadece Videoya Göm:</strong> Görsel olarak yazar.</li>
                            <li><strong>Seslendir (TTS) ve Karıştır:</strong> Altyazıları okur ve sese ekler.</li>
                            <li><strong>Hem Göm Hem Seslendir:</strong> İkisini de yapar.</li>
                        </ul>
                    </li>
                </ol>
            `
        },
        {
            id: 'insertion-list',
            titleKey: 'help.insertion_list.title',
            contentKey: 'help.insertion_list.content',
            title: 'Ekleme Listesi (Kuyruk)',
            content: `
                <h3>Toplu İşlemler</h3>
                <p>Birden fazla öğeyi aynı anda eklemek için:</p>
                <p>Görsel veya ses eklerken "Hemen Uygula" yerine "Listeye Ekle" derseniz, öğeler bekleme kuyruğuna alınır. <strong>Ekle > Ekleme Listesi</strong> menüsünden tümünü tek seferde videoya işleyebilirsiniz. Bu, her işlem için ayrı ayrı beklemeyi önler.</p>
            `
        },
        {
            id: 'broadcast-room-overview',
            titleKey: 'help.broadcast_room_overview.title',
            contentKey: 'help.broadcast_room_overview.content',
            title: 'Yayın Odasına Giriş',
            content: `
                <h3>Yayın Odası Nedir?</h3>
                <p>Yayın Odası; konukları davet etmek, sahne düzeni kurmak, kayıt almak, YouTube yayını başlatmak, ekran paylaşmak ve canlı efekt kullanmak için tasarlanmış erişilebilir bir canlı yayın çalışma alanıdır.</p>
                <p>Buradaki mantık iki parçalıdır. Önce oda bağlantısını kurarsınız. Sonra bu bağlantının ekranda ve kayıtta nasıl görüneceğini sahne düzeni ile belirlersiniz.</p>
                <ul>
                    <li><strong>Oda ve cihazlar:</strong> Oda oluşturma, kalıcı odalar, kamera, mikrofon ve hoparlör seçimi.</li>
                    <li><strong>Katılımcılar ve sohbet:</strong> Konuk listesi, söz isteme, özel mesaj ve herkese mesaj.</li>
                    <li><strong>Paylaşım ve kaynaklar:</strong> Host ekran paylaşımı, konuk ekran paylaşımı ve yerel kaynak seçimi.</li>
                    <li><strong>Sahne düzeni:</strong> Kim solda, kim sağda, ekran büyük mi, yüzler küçük mü gibi görünüm kararları.</li>
                    <li><strong>Kayıt ve yayın:</strong> OBS hazırlığı, yerel kayıt, YouTube canlı yayın ve efekt katmanı.</li>
                </ul>
                <p><strong>Menü yolu:</strong> <strong>Kayıt &gt; Yayın Odası</strong>.</p>
            `
        },
        {
            id: 'broadcast-room-interface',
            titleKey: 'help.broadcast_room_interface.title',
            contentKey: 'help.broadcast_room_interface.content',
            title: 'Yayın Odası Arayüzü',
            content: `
                <h3>Arayüzü Nasıl Düşünmelisiniz?</h3>
                <p>Yayın Odasının en üstünde <strong>Bölge Listesi</strong> bulunur. <strong>Alt+L</strong> ile bu listeye gidip ok tuşlarıyla bölgeler arasında dolaşabilir, <strong>Enter</strong> ile seçtiğiniz bölgenin ilk öğesine geçebilirsiniz.</p>
                <p>Başlıca bölgeler şunlardır:</p>
                <ul>
                    <li><strong>Canlı Görüntü Önizlemesi:</strong> Host, konuklar ve varsa ekran paylaşımının büyük önizlemesi.</li>
                    <li><strong>Oda ve Cihazlar:</strong> Oda oluşturma, kalıcı odalar ve cihaz seçimleri.</li>
                    <li><strong>Katılımcılar ve Sohbet:</strong> Mesaj listesi, host mesaj alanı ve katılımcı listesi.</li>
                    <li><strong>Paylaşım ve Kaynaklar:</strong> Host yerel paylaşımı ve yakalanacak kaynaklar.</li>
                    <li><strong>Sahne Düzeni:</strong> Yan yana, paylaşım büyük, yüzler küçük gibi yerleşimler.</li>
                    <li><strong>OBS, Kayıt, YouTube, Efekt:</strong> Yayın akışını fiilen başlatan ve yöneten bölümler.</li>
                    <li><strong>Tanı ve Olay Geçmişi:</strong> Bağlantı, paylaşım, ses ve katılımcı olaylarını izlediğiniz alan.</li>
                </ul>
                <p><strong>Hızlı gezinim:</strong> <strong>Ctrl+Sağ</strong> ve <strong>Ctrl+Sol</strong> ile bölgeler arasında şerit menü gibi hızlı geçiş yapabilirsiniz.</p>
            `
        },
        {
            id: 'broadcast-room-open-room',
            titleKey: 'help.broadcast_room_open_room.title',
            contentKey: 'help.broadcast_room_open_room.content',
            title: 'Nasıl Oda Açılır?',
            content: `
                <h3>Geçici Oda Açma</h3>
                <ol>
                    <li>Yayın Odasını açın.</li>
                    <li>Kamera, mikrofon ve hoparlör seçimlerinizi kontrol edin.</li>
                    <li>İsterseniz host adını ve oda adını düzenleyin.</li>
                    <li><strong>Oda Oluştur</strong> düğmesine basın.</li>
                    <li>Oda kurulduğunda bağlantı panoya kopyalanır. Bunu konuğunuzla paylaşabilirsiniz.</li>
                </ol>
                <p>Geçici oda, o oturum için hızlı bir bağlantı oluşturur. Bir prova, tek seferlik görüşme veya anlık yayın hazırlığı için en pratik yoldur.</p>
                <h3>Konuk Ne Yapar?</h3>
                <p>Konuk bağlantıyı açar, görünen adını yazar, isterse kamera ve mikrofonunu açar ve <strong>Odaya Katıl</strong> ile bağlanır. Eğer oda kurallarında parola isteniyorsa, parola alanı da otomatik görünür.</p>
            `
        },
        {
            id: 'broadcast-room-persistent-rooms',
            titleKey: 'help.broadcast_room_persistent_rooms.title',
            contentKey: 'help.broadcast_room_persistent_rooms.content',
            title: 'Kalıcı Odalar ve Kurallar',
            content: `
                <h3>Kalıcı Oda Ne İşe Yarar?</h3>
                <p>Aynı bağlantıyı tekrar tekrar kullanmak istiyorsanız kalıcı oda mantığı daha uygundur. Böylece her yayında yeni link göndermek zorunda kalmazsınız.</p>
                <ol>
                    <li><strong>Oda Yönetimi</strong> düğmesini açın.</li>
                    <li>Oda adı, host adı ve isterseniz kalıcı oda bağlantı anahtarını belirleyin.</li>
                    <li>Parola koruması istiyorsanız oda parolasını girin.</li>
                    <li>Host varken veya host yokken parolanın zorunlu olup olmayacağını seçin.</li>
                    <li>Host bağlı değilken konukların odaya girip giremeyeceğini belirleyin.</li>
                    <li><strong>Bu ayarlarla oda oluştur</strong> düğmesine basın.</li>
                </ol>
                <p>Oda kurulduktan sonra <strong>Kalıcı Oda Listesi</strong> içinde görünür. Bu listede yukarı ve aşağı oklarla gezebilir, <strong>Enter</strong> ile odayı açabilir, <strong>Sağ ok</strong> ile bağlam menüsünü açabilirsiniz.</p>
                <p>Kalıcı oda menüsünde bağlantı kopyalama, parola kuralı değiştirme, host yokken katılımı açıp kapatma ve oda düzenleme gibi işlemler bulunur.</p>
            `
        },
        {
            id: 'broadcast-room-layouts',
            titleKey: 'help.broadcast_room_layouts.title',
            contentKey: 'help.broadcast_room_layouts.content',
            title: 'Sahne Düzenleri',
            content: `
                <h3>Sahne Düzeni Nedir?</h3>
                <p>Sahne düzeni, host ve konukların kayıtta veya canlı yayında nasıl görüneceğini belirler. Odaya bağlanmak ile sahneye yerleşmek aynı şey değildir. Kişiler önce bağlanır, ardından siz onları sahne mantığına göre yerleştirirsiniz.</p>
                <p>Yaygın kullanım örnekleri şunlardır:</p>
                <ul>
                    <li><strong>Yan yana iki konuşmacı:</strong> Röportajlar ve eşit söz hakkı olan görüşmeler için uygundur.</li>
                    <li><strong>Paylaşım büyük, yüzler küçük:</strong> Sunum, eğitim ve ekran anlatımı için uygundur.</li>
                    <li><strong>Yüzler büyük, paylaşım küçük:</strong> Ekranın destekleyici olduğu ama konuşmacıların hâlâ ana unsur olduğu yayınlar için uygundur.</li>
                    <li><strong>Tek kişi veya odaklı görünüm:</strong> Tek konuşmacılı akışlar için kullanılır.</li>
                </ul>
                <p>Konuk ekran paylaşımı başlatırsa sistem size hızlı sahne önerileri sunabilir; fakat düzeni otomatik olarak zorla değiştirmez. Son kararı host verir.</p>
                <p><strong>İpucu:</strong> Düzen seçtikten sonra <strong>Yapay zekadan görüş al</strong> ile yüzlerin ve paylaşımın gerçekten doğru görünüp görünmediğini denetletebilirsiniz.</p>
            `
        },
        {
            id: 'broadcast-room-recording',
            titleKey: 'help.broadcast_room_recording.title',
            contentKey: 'help.broadcast_room_recording.content',
            title: 'Kayıt Nasıl Yapılır?',
            content: `
                <h3>Yerel Kayıt Akışı</h3>
                <ol>
                    <li>OBS bağlantısının ve gerekli kaynakların hazır olduğundan emin olun.</li>
                    <li>Konuklar bağlandıysa sahne düzeninizi seçin.</li>
                    <li>Gerekirse paylaşım ve efekt kontrollerini hazırlayın.</li>
                    <li><strong>Kaydı Başlat</strong> düğmesine basın veya <strong>Alt+R</strong> kısayolunu kullanın.</li>
                    <li>Kayıt sırasında sahne düzeni değiştirebilir, katılımcı yönetebilir ve gerekiyorsa paylaşım başlatabilirsiniz.</li>
                    <li>İşiniz bitince aynı düğmeyle kaydı durdurun.</li>
                </ol>
                <p>Yeni mimaride kayıt için ayrı bir <strong>Yayın Çıkışı</strong> mantığı kullanılır. Böylece host arayüzündeki kontrol düğmeleri kayda karışmadan, siz yönetim yapmaya devam edebilirsiniz.</p>
                <p><strong>Öneri:</strong> Özellikle yeni bir düzen veya efekt deniyorsanız önce kısa bir prova kaydı alın.</p>
            `
        },
        {
            id: 'broadcast-room-youtube',
            titleKey: 'help.broadcast_room_youtube.title',
            contentKey: 'help.broadcast_room_youtube.content',
            title: 'YouTube Canlı Yayın Süreci',
            content: `
                <h3>YouTube Yayınına Geçmeden Önce</h3>
                <p>YouTube tarafı kayıtla benzer görünse de ek olarak hesap, yayın planı ve akış anahtarı mantığı içerir.</p>
                <ol>
                    <li>OBS ve yayın odası düzeninizi tamamlayın.</li>
                    <li>YouTube hesabı bağlantınızı kontrol edin.</li>
                    <li>Yeni yayın oluşturacaksanız başlık, açıklama ve görünürlük gibi ayarları gözden geçirin.</li>
                    <li>Gerekirse mevcut bir yayın planını seçin.</li>
                    <li><strong>Canlı Yayını Başlat</strong> düğmesine basın.</li>
                    <li>Yayın başladıktan sonra katılımcı, paylaşım ve efekt işlemleri canlı olarak yönetilebilir.</li>
                </ol>
                <p><strong>İpucu:</strong> İlk yayından önce gizli ya da liste dışı bir YouTube testi yapmak, ses ve sahne doğrulaması için çok yararlıdır.</p>
            `
        },
        {
            id: 'broadcast-room-effects',
            titleKey: 'help.broadcast_room_effects.title',
            contentKey: 'help.broadcast_room_effects.content',
            title: 'Efekt Katmanı',
            content: `
                <h3>Efekt Katmanı Ne Zaman Kullanılır?</h3>
                <p>Efekt katmanı; jingle, geçiş videosu, kısa ses efekti veya görselli efekt tetiklemek istediğiniz yayınlarda kullanılır. Özellikle canlı program açılışı, ara anonslar ve kapanışlarda çok faydalıdır.</p>
                <ol>
                    <li>Önceden bir efekt profili oluşturun ya da mevcut profili seçin.</li>
                    <li>Slotlara ses, video ve gerekiyorsa görsel bağlayın.</li>
                    <li>Yayın Odasında ilgili efekt profilini etkinleştirin.</li>
                    <li>Yayında doğru anda slotu tetikleyin.</li>
                </ol>
                <p>Efekt katmanında oynayan içerik kayıt ve yayın akışına gider. Kullanım amacına göre başlangıç, ara ve bitiş efektlerini farklı slotlarda tutmak işinizi kolaylaştırır.</p>
            `
        },
        {
            id: 'broadcast-room-screen-share',
            titleKey: 'help.broadcast_room_screen_share.title',
            contentKey: 'help.broadcast_room_screen_share.content',
            title: 'Ekran Paylaşımı',
            content: `
                <h3>Host ve Konuk Paylaşımı</h3>
                <p>Hem host hem konuk ekran paylaşabilir. Fakat paylaşımın ne zaman ve hangi kurallarla açılacağını host belirler.</p>
                <h3>Host Paylaşımı</h3>
                <ol>
                    <li><strong>Alt+S</strong> ile paylaşım bölümünü açın.</li>
                    <li>Kaynak olarak tüm ekran, pencere veya uygun yerel kaynağı seçin.</li>
                    <li>Gerekirse sistem sesini de dahil edin.</li>
                    <li>Paylaşım başladıktan sonra sahne düzeninde bunu büyük veya küçük alan olarak konumlandırın.</li>
                </ol>
                <h3>Konuk Paylaşımı</h3>
                <p>Konuk paylaşım başlattığında tarayıcının kendi paylaşım penceresi açılır. Pencere, sekme veya tüm ekran seçimi oradan yapılır. Eğer tarayıcı ve işletim sistemi destekliyorsa paylaşım sesi de aynı akışta eklenir.</p>
                <p>Paylaşım başladığında host tarafında anons gelir ve hızlı sahne önerileri görünür.</p>
            `
        },
        {
            id: 'broadcast-room-participants',
            titleKey: 'help.broadcast_room_participants.title',
            contentKey: 'help.broadcast_room_participants.content',
            title: 'Katılımcı Yönetimi ve Sohbet',
            content: `
                <h3>Katılımcı Listesi</h3>
                <p><strong>Alt+U</strong> ile katılımcı listesine gidebilirsiniz. Liste içinde yukarı ve aşağı oklarla gezilir. <strong>Sağ ok</strong> seçili katılımcının menüsünü açar, <strong>Sol ok</strong> menüyü kapatır.</p>
                <p>Katılımcı menüsünde şu işlemler bulunur:</p>
                <ul>
                    <li>Odadan çıkar</li>
                    <li>Özel mesaj gönder</li>
                    <li>Sesini aç veya kapat</li>
                    <li>Videosunu aç veya kapat</li>
                    <li>Kamera, mikrofon ve ekran paylaşım izinlerini açıp kapat</li>
                    <li>Söz isteğini görüldü olarak işaretleme</li>
                </ul>
                <h3>Sohbet ve Söz İsteme</h3>
                <p><strong>Alt+C</strong> ile sohbet alanına geçebilirsiniz. Host hem herkese mesaj gönderebilir hem de katılımcı menüsünden özel mesaj yazabilir. Konuk tarafında da herkese gönder ve yöneticiye gönder akışları bulunur.</p>
                <p>Konuklar <strong>Söz İste</strong> ile taleplerini iletebilir. Bu istek host tarafında duyurulur ve ayrıca söz isteyenler alanında görünür.</p>
            `
        },
        {
            id: 'broadcast-room-shortcuts',
            titleKey: 'help.broadcast_room_shortcuts.title',
            contentKey: 'help.broadcast_room_shortcuts.content',
            title: 'Temel Kısayollar',
            content: `
                <h3>Host Kısayolları</h3>
                <ul>
                    <li><strong>Alt+A:</strong> Host mikrofonunu aç veya kapat.</li>
                    <li><strong>Alt+V:</strong> Host videosunu aç veya kapat.</li>
                    <li><strong>Alt+S:</strong> Paylaşım bölümünü aç; paylaşım aktifse durdur.</li>
                    <li><strong>Alt+Y:</strong> Düzen seçimine git.</li>
                    <li><strong>Alt+U:</strong> Katılımcı listesine git veya listeyi görünür hale getir.</li>
                    <li><strong>Alt+C:</strong> Sohbet paneline git.</li>
                    <li><strong>Alt+O:</strong> Oda Yönetimini aç veya kapat.</li>
                    <li><strong>Alt+Q:</strong> Odayı kapat.</li>
                    <li><strong>Alt+R:</strong> Kaydı başlat veya durdur.</li>
                    <li><strong>Alt+L:</strong> Bölge Listesine git.</li>
                </ul>
                <h3>Konuk Web Kısayolları</h3>
                <ul>
                    <li><strong>Ctrl+D:</strong> Mikrofonu aç veya kapat.</li>
                    <li><strong>Ctrl+E:</strong> Videoyu aç veya kapat.</li>
                    <li><strong>Ctrl+Shift+E:</strong> Ekran paylaşımını başlat veya durdur.</li>
                    <li><strong>Ctrl+Shift+H:</strong> Odadan ayrıl.</li>
                </ul>
                <p><strong>İpucu:</strong> Pek çok düğme odaklandığında kısayol bilgisini de okur; böylece akışı kullanırken kısayolları doğal olarak öğrenebilirsiniz.</p>
            `
        },
        {
            id: 'broadcast-room-ai-review',
            titleKey: 'help.broadcast_room_ai_review.title',
            contentKey: 'help.broadcast_room_ai_review.content',
            title: 'Yapay Zekadan Görüş Al',
            content: `
                <h3>AI Görüşü Ne İşe Yarar?</h3>
                <p>Canlı Görüntü Önizlemesi içindeki <strong>Yapay zekadan görüş al</strong> düğmesi, mevcut gerçek kareyi analiz edip erişilebilir bir değerlendirme verir.</p>
                <p>AI özellikle şu sorulara bakar:</p>
                <ul>
                    <li>Host ve seçili konuk yüzleri gerçekten görünüyor mu?</li>
                    <li>Ekran paylaşımı varsa paylaşım ile yüzler seçilen düzene uygun mu?</li>
                    <li>Yüzler çok küçük, kesilmiş veya yanlış yerde mi?</li>
                    <li>Ekranda fazladan kontrol, siyah boşluk veya istenmeyen bir öğe var mı?</li>
                </ul>
                <p>Bu özellik özellikle total kör kullanıcılar için yayın öncesi son kontrol katmanı olarak düşünülmelidir. Düzeni seçin, gerekirse paylaşımı başlatın, sonra AI görüşünü alın.</p>
            `
        },
        {
            id: 'broadcast-room-troubleshooting',
            titleKey: 'help.broadcast_room_troubleshooting.title',
            contentKey: 'help.broadcast_room_troubleshooting.content',
            title: 'Yayın Odası İçin Sorun Giderme',
            content: `
                <h3>En Sık Karşılaşılan Durumlar</h3>
                <ul>
                    <li><strong>Konuk bağlandı ama ses yok:</strong> Kamera ve mikrofon izinlerini, tarayıcı site izinlerini ve seçili cihazları kontrol edin.</li>
                    <li><strong>Paylaşım görüntüsü yok:</strong> Konuğun gerçekten paylaşım başlatıp başlatmadığını ve tanı alanında paylaşım akışının bağlanıp bağlanmadığını kontrol edin.</li>
                    <li><strong>Paylaşım sesi yok:</strong> Tarayıcının paylaşılan kaynak için ses sunup sunmadığına bakın. Bazı tarayıcılar yalnız belirli paylaşım türlerinde ses verir.</li>
                    <li><strong>Kayıtta kontrol düğmeleri görünüyorsa:</strong> Temiz sahne ve yayın çıkışı akışının aktif olduğundan emin olun, kısa test kaydı alın.</li>
                    <li><strong>Katılımcı listesi veya sohbet garip davranıyorsa:</strong> Odayı kapatmadan önce uygulamayı yeniden açıp hızlı bir prova yapın.</li>
                </ul>
                <p><strong>Tanı ve Olay Geçmişi</strong> alanı, özellikle paylaşım sesi, video akışı ve katılımcı olayları için ilk bakılacak yerdir.</p>
            `
        }
    ],

    /**
     * Kullanım Kılavuzu diyaloğunu göster
     */
    showHelpDialog() {
        this.helpDialog = document.getElementById('help-dialog');
        if (!this.helpDialog) return;

        // Reset sidebar selection
        this.populateHelpTopics();

        // Klavye kontrolünü diyalog moduna al
        if (window.Keyboard) window.Keyboard.setEnabled(false);

        this.helpDialog.showModal();
        Accessibility.announce(this.t('runtime.help.dialog_opened', 'User Guide opened. Navigate topics with the arrow keys.'));

        // İlk konuya odaklan
        setTimeout(() => {
            const firstItem = document.getElementById('help-topics-list').firstElementChild;
            if (firstItem) firstItem.focus();
        }, 100);

        this.setupHelpEventListeners();
    },

    /**
     * Yardım konularını listeye doldur
     */
    populateHelpTopics() {
        const list = document.getElementById('help-topics-list');
        list.innerHTML = '';

        this.helpTopics.forEach((topic, index) => {
            const localized = this.getHelpTopicLocalized(topic);
            const li = document.createElement('li');
            li.textContent = localized.title;
            li.setAttribute('role', 'option');
            li.setAttribute('tabindex', index === 0 ? '0' : '-1');
            li.setAttribute('data-id', topic.id);
            li.style.padding = '10px';
            li.style.cursor = 'pointer';
            li.style.marginBottom = '5px';
            li.style.borderRadius = '4px';
            li.style.color = '#eee';

            // Seçim olayları
            li.addEventListener('click', () => this.displayHelpTopic(topic, li));

            // Klavye olayları
            li.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.displayHelpTopic(topic, li);
                }
            });

            list.appendChild(li);
        });
    },

    /**
     * Seçilen konuyu göster
     */
    displayHelpTopic(topic, activeLi) {
        const contentArea = document.getElementById('help-content-area');
        const localized = this.getHelpTopicLocalized(topic);
        contentArea.innerHTML = localized.content;

        // Liste görünümü güncelle
        const items = document.querySelectorAll('#help-topics-list li');
        items.forEach(item => {
            item.style.backgroundColor = 'transparent';
            item.setAttribute('aria-selected', 'false');
            item.setAttribute('tabindex', '-1');
        });

        activeLi.style.backgroundColor = 'var(--primary-color)';
        activeLi.setAttribute('aria-selected', 'true');
        activeLi.setAttribute('tabindex', '0');
        activeLi.focus();

        Accessibility.announce(this.t('runtime.help.topic_opened', '{title} topic displayed. Press Tab to read the content.', { title: localized.title }));
    },

    /**
     * Yardım diyaloğu olaylarını kur
     */
    setupHelpEventListeners() {
        if (this.helpEventsSetup) return;

        const list = document.getElementById('help-topics-list');

        // Liste içinde ok tuşlarıyla gezinme
        list.addEventListener('keydown', (e) => {
            const items = Array.from(list.children);
            const active = document.activeElement;
            const index = items.indexOf(active);

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                const next = items[index + 1] || items[0];
                next.click();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const prev = items[index - 1] || items[items.length - 1];
                prev.click();
            }
        });

        // Kapat butonu
        document.getElementById('help-close').addEventListener('click', () => {
            this.helpDialog.close();
        });

        this.helpDialog.addEventListener('close', () => {
            if (window.Keyboard) window.Keyboard.setEnabled(true);
        });

        this.helpEventsSetup = true;
    },

    // ==========================================
    // KLAVYE YÖNETİCİSİ
    // ==========================================

    keyboardManagerDialog: null,
    tempKeymap: {}, // Geçici değişiklikler

    /**
     * Klavye Yöneticisi diyaloğunu göster
     */
    showKeyboardManagerDialog() {
        this.keyboardManagerDialog = document.getElementById('keyboard-manager-dialog');
        if (!this.keyboardManagerDialog) return;

        // Geçici keymap'i mevcut ayarlardan kopyala
        this.tempKeymap = JSON.parse(JSON.stringify(Keyboard.getUserKeymap()));

        // Kategorileri hazırla
        this.populateKeyboardCategories();

        if (window.Keyboard) window.Keyboard.setEnabled(false);
        this.keyboardManagerDialog.showModal();
        Accessibility.announce('Klavye yöneticisi açıldı. Kategoriler arasında gezinin.');

        this.setupKeyboardManagerEventListeners();

        // İlk kategoriye odaklan
        setTimeout(() => {
            const first = document.getElementById('keyboard-categories-list').firstElementChild;
            if (first) {
                first.click();
                first.focus();
            }
        }, 100);
    },

    /**
     * Klavye kategorilerini listele
     */
    populateKeyboardCategories() {
        const list = document.getElementById('keyboard-categories-list');
        list.innerHTML = '';

        // Tüm aksiyonlardan kategorileri çıkar
        const actions = Keyboard.getAllActions();
        const categories = new Set();
        Object.values(actions).forEach(a => categories.add(a.category));

        const sortedCategories = Array.from(categories).sort();

        sortedCategories.forEach((cat, index) => {
            const li = document.createElement('li');
            const localizedCategory = Keyboard.getLocalizedCategory(cat);
            li.textContent = localizedCategory;
            li.setAttribute('role', 'option');
            li.setAttribute('tabindex', index === 0 ? '0' : '-1');
            li.style.padding = '10px';
            li.style.cursor = 'pointer';
            li.style.marginBottom = '5px';
            li.style.borderRadius = '4px';
            li.style.color = '#eee';

            li.addEventListener('click', () => {
                // Seçim görseli
                Array.from(list.children).forEach(c => {
                    c.style.backgroundColor = 'transparent';
                    c.setAttribute('aria-selected', 'false');
                });
                li.style.backgroundColor = 'var(--primary-color)';
                li.setAttribute('aria-selected', 'true');

                this.populateKeyboardShortcuts(cat);
                Accessibility.announce(this.t('runtime.dialogs.keyboard_category_selected', '{category} category selected.', {
                    category: localizedCategory
                }));
            });

            // Klavye
            li.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    li.click();
                    // İçeriğe geç
                    const contentList = document.getElementById('keyboard-shortcuts-list');
                    const firstItem = contentList.querySelector('li');
                    if (firstItem) firstItem.focus();
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const next = li.nextElementSibling || list.firstElementChild;
                    next.focus();
                    next.click();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prev = li.previousElementSibling || list.lastElementChild;
                    prev.focus();
                    prev.click();
                } else if (e.key === 'ArrowRight') {
                    // İçeriğe geç
                    const contentList = document.getElementById('keyboard-shortcuts-list');
                    const firstItem = contentList.querySelector('li');
                    if (firstItem) {
                        firstItem.focus();
                        Accessibility.announce(this.t('runtime.dialogs.keyboard_shortcut_list_entered', 'Shortcut list entered'));
                    }
                }
            });

            list.appendChild(li);
        });
    },

    /**
     * Kısayolları listele
     */
    populateKeyboardShortcuts(category) {
        const list = document.getElementById('keyboard-shortcuts-list');
        list.innerHTML = '';

        const actions = Keyboard.getAllActions();

        // Bu kategorideki aksiyonları bul
        const categoryActions = Object.entries(actions)
            .filter(([_, def]) => def.category === category)
            .sort((a, b) => Keyboard.getLocalizedActionLabel(a[0], a[1].label).localeCompare(Keyboard.getLocalizedActionLabel(b[0], b[1].label)));

        categoryActions.forEach(([actionId, def]) => {
            const localizedLabel = Keyboard.getLocalizedActionLabel(actionId, def.label);
            const li = document.createElement('li');
            li.className = 'shortcut-item';
            li.setAttribute('role', 'option');
            li.setAttribute('tabindex', '-1');
            li.setAttribute('data-id', actionId);
            li.style.padding = '10px';
            li.style.borderBottom = '1px solid #444';
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';

            // Mevcut kısayolu bul (Temp map'ten, yoksa default'tan)
            let currentShortcut = this.tempKeymap[actionId];
            if (currentShortcut === undefined) currentShortcut = def.default;

            // Array ise string'e çevir
            let displayShortcut = Array.isArray(currentShortcut) ? currentShortcut.join(', ') : currentShortcut;

            // İşletim sistemine göre 'Mod' metnini düzenle (Görsel olarak)
            if (displayShortcut) {
                const isMac = navigator.userAgent.includes('Mac');
                if (isMac) {
                    displayShortcut = displayShortcut
                        .replace(/Mod/g, 'Cmd')
                        .replace(/Meta/g, 'Cmd')
                        .replace(/Alt/g, 'Option');
                } else {
                    displayShortcut = displayShortcut.replace(/Mod/g, 'Ctrl').replace(/Meta/g, 'Ctrl');
                }
            }

            const shortcutText = displayShortcut || this.t('runtime.dialogs.no_shortcut', 'No shortcut');
            const shortcutStyle = displayShortcut ? 'background:#333; color:#fff;' : 'background:transparent; color:#888; font-style:italic;';

            li.innerHTML = `
                <span class="action-label" style="font-weight:bold;">${localizedLabel}</span>
                <span class="shortcut-key" style="font-family:monospace; padding:2px 6px; border-radius:3px; ${shortcutStyle}">${shortcutText}</span>
            `;

            // Focus ve Hover
            li.addEventListener('focus', () => {
                li.style.backgroundColor = '#333';
                Accessibility.announce(this.t('runtime.dialogs.keyboard_shortcut_focus', '{label}, Shortcut: {shortcut}', {
                    label: localizedLabel,
                    shortcut: displayShortcut || this.t('runtime.dialogs.no_shortcut', 'No shortcut')
                }));
            });
            li.addEventListener('blur', () => li.style.backgroundColor = 'transparent');
            li.addEventListener('mouseenter', () => li.focus());

            // Klavye Dinleme (Düzenleme modu vb)
            li.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const next = li.nextElementSibling || list.firstElementChild;
                    if (next) next.focus();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prev = li.previousElementSibling || list.lastElementChild;
                    if (prev) prev.focus();
                } else if (e.key === 'ArrowLeft') {
                    // Kategoriye dön
                    const activeCat = document.querySelector('#keyboard-categories-list li[aria-selected="true"]');
                    if (activeCat) {
                        activeCat.focus();
                        Accessibility.announce(this.t('runtime.dialogs.keyboard_categories_returned', 'Returned to categories'));
                    }
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    // ContextMenu olayını tetikle
                    const ev = new MouseEvent('contextmenu', {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        buttons: 2,
                        clientX: li.getBoundingClientRect().x + 50,
                        clientY: li.getBoundingClientRect().y + 10
                    });
                    li.dispatchEvent(ev);
                }
            });

            list.appendChild(li);
        });

        // Context Menu Kurulumu
        this.setupListContextMenu(list, 'keyboard-shortcut');
    },

    /**
     * Kısayol düzenleme modunu başlat (Dinleme)
     */
    startListeningForShortcut(actionId) {
        const li = document.querySelector(`#keyboard-shortcuts-list li[data-id="${actionId}"]`);
        if (!li) return;

        const keySpan = li.querySelector('.shortcut-key');
        const originalText = keySpan.textContent;

        keySpan.textContent = 'Tuş kombinasyonuna basın...';
        keySpan.style.color = '#ffff00';
        keySpan.style.border = '1px solid #ffff00';

        Accessibility.announce(`Yeni kısayol için tuşlara basın. İptal etmek için Tab tuşuna basın.`);

        const handler = (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Tab iptal eder (veya onayı bitirir)
            if (e.key === 'Tab') {
                document.removeEventListener('keydown', handler, true);
                keySpan.textContent = originalText;
                keySpan.style.color = '';
                keySpan.style.border = '';
                Accessibility.announce('İptal edildi.');
                return;
            }

            // Kısayolu algıla
            // Sadece modifierlara basıldıysa bekle
            if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return;

            const shortcutString = Keyboard.eventToString(e);
            if (shortcutString) {
                // Çakışma kontrolü
                let conflictingActionId = null;

                // Temp keymap ve default keymap içinde ara
                const allActions = Keyboard.getAllActions();

                // Önce tempKeymap'te ara
                for (const [id, assignedKey] of Object.entries(this.tempKeymap)) {
                    if (id !== actionId && assignedKey === shortcutString) {
                        conflictingActionId = id;
                        break;
                    }
                }

                // Temp'te yoksa defaultlarda ara (eğer temp'te ezilmediyse)
                if (!conflictingActionId) {
                    for (const [id, def] of Object.entries(allActions)) {
                        // Eğer bu action için tempKeymap'te bir override yoksa ve default uyuşuyorsa
                        if (id !== actionId && this.tempKeymap[id] === undefined) {
                            if (def.default === shortcutString || (Array.isArray(def.default) && def.default.includes(shortcutString))) {
                                conflictingActionId = id;
                                break;
                            }
                        }
                    }
                }

                let message = `Yeni kısayol: ${shortcutString}\nOnaylıyor musunuz?`;
                if (conflictingActionId) {
                    const conflictingAction = allActions[conflictingActionId];
                    message = `DİKKAT: Bu kısayol (${shortcutString}) şu işlem tarafından kullanılıyor:\n"${conflictingAction.label}"\n\nBu kısayolu yeni işleme atamak istiyor musunuz? (Diğer işlemden silinecek)`;
                }

                // Onay iste
                // confirm() yerine asenkron showConfirm kullanalım, önce okuyalım
                Accessibility.announce(message);
                // Kısa bir gecikme ile diyaloğu aç ki okuma başlasın
                setTimeout(async () => {
                    const confirmed = await window.api.showConfirm({
                        title: 'Kısayol Onayı',
                        message: message
                    });

                    if (confirmed) {
                        // Eğer çakışma varsa, eski sahipten sil
                        if (conflictingActionId) {
                            this.tempKeymap[conflictingActionId] = ""; // Boşalt
                        }

                        this.tempKeymap[actionId] = shortcutString;

                        // UI Güncelle
                        const currentCategory = Keyboard.ACTIONS[actionId].category;
                        this.populateKeyboardShortcuts(currentCategory);

                        // Odak geri gelsin
                        setTimeout(() => {
                            const newLi = document.querySelector(`#keyboard-shortcuts-list li[data-id="${actionId}"]`);
                            if (newLi) newLi.focus();
                        }, 50);

                        Accessibility.announce(`Kısayol güncellendi: ${shortcutString}`);
                    } else {
                        keySpan.textContent = originalText;
                        Accessibility.announce('İptal edildi.');
                    }
                }, 200);
            } else {
                alert('Geçersiz tuş kombinasyonu veya sistem tuşu.');
                keySpan.textContent = originalText;
            }

            document.removeEventListener('keydown', handler, true);
            keySpan.style.color = '';
            keySpan.style.border = '';
        };

        // Capture phase ile dinle, diğer eventleri engelle
        document.addEventListener('keydown', handler, true);
    },

    /**
     * Klavye yöneticisi event listenerları
     */
    setupKeyboardManagerEventListeners() {
        if (this._keyboardManagerEventsSetup) return;

        // Reset All
        document.getElementById('keyboard-manager-reset-all')?.addEventListener('click', () => {
            const title = 'Tümünü Sıfırla';
            const message = 'Tüm özel kısayollar silinecek ve varsayılanlara dönülecek. Onaylıyor musunuz?';

            Accessibility.announce(message);

            setTimeout(async () => {
                const confirmed = await window.api.showConfirm({
                    title: title,
                    message: message
                });

                if (confirmed) {
                    this.tempKeymap = {};
                    this.populateKeyboardCategories(); // Yenile
                    // İlk kategoriye tıkla
                    document.getElementById('keyboard-categories-list').firstElementChild?.click();
                    Accessibility.announce('Tüm kısayollar varsayılana döndürüldü.');
                }
            }, 200);
        });

        // Save
        document.getElementById('keyboard-manager-save')?.addEventListener('click', () => {
            Keyboard.setUserKeymap(this.tempKeymap);
            this.keyboardManagerDialog.close();
        });

        // Cancel
        document.getElementById('keyboard-manager-cancel')?.addEventListener('click', () => {
            this.tempKeymap = {};
            this.keyboardManagerDialog.close();
        });

        // Export
        document.getElementById('keyboard-manager-export')?.addEventListener('click', () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.tempKeymap, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", "korcul_shortcuts.json");
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        });

        // Import
        document.getElementById('keyboard-manager-import')?.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const obj = JSON.parse(event.target.result);
                        this.tempKeymap = obj;
                        // UI Yenile
                        const activeCat = document.querySelector('#keyboard-categories-list li[aria-selected="true"]');
                        if (activeCat) activeCat.click();
                        else document.getElementById('keyboard-categories-list').firstElementChild?.click();

                        Accessibility.announce('Kısayol dosyası içe aktarıldı.');
                    } catch (err) {
                        alert('Dosya okuma hatası: ' + err.message);
                    }
                };
                reader.readAsText(file);
            };
            input.click();
        });

        this.keyboardManagerDialog.addEventListener('close', () => {
            if (window.Keyboard) window.Keyboard.setEnabled(true);
        });

        this._keyboardManagerEventsSetup = true;
    },

    // =====================================
    // VIDEO KATMANI SİHİRBAZI (PiP)
    // =====================================

    // Video layer wizard state
    videoLayerState: {
        currentStep: 1,
        layerVideoPath: null,
        layerMetadata: null,
        mainResolution: { width: 1920, height: 1080 },
        mode: 'sign-language',
        position: { x: 0, y: 0 },
        size: { width: 240, height: 135 },
        sizePercent: 12.5,
        keepAspect: true,
        layerMuted: true,
        layerVolume: 100,
        mainVolume: 100,
        timingMode: 'whole',
        startTime: 0,
        endTime: 0,
        syncOffset: 0,  // Senkronizasyon offset'i (ms)
        cutRegions: []  // Kesilecek bölgeler [{start, end}, ...]
    },

    /**
     * Video Katmanı Sihirbazını göster
     * @param {string} layerVideoPath - Katman olarak eklenecek video dosyası
     */
    async showVideoLayerWizard(layerVideoPath) {
        const dialog = document.getElementById('video-layer-wizard-dialog');
        if (!dialog) return;
        window.i18nHelper?.translateDOM?.(dialog);

        // Klavye kısayollarını devre dışı bırak
        if (window.Keyboard) window.Keyboard.setEnabled(false);

        // State'i sıfırla
        this.videoLayerState = {
            currentStep: 1,
            layerVideoPath: layerVideoPath,
            layerMetadata: null,
            mainResolution: { width: 1920, height: 1080 },
            mode: 'sign-language',
            position: { x: 0, y: 0 },
            size: { width: 480, height: 270 },
            sizePercent: 12.5,
            keepAspect: true,
            layerMuted: true,
            layerVolume: 100,
            mainVolume: 100,
            timingMode: 'whole',
            startTime: 0,
            endTime: 0,
            syncOffset: 0,
            cutRegions: []
        };

        // vlSyncState'i de sıfırla
        this.vlSyncState.offsetMs = 0;
        this.vlSyncState.cutMarkers = [];
        this.vlSyncState.pendingMarker = null;
        this.vlSyncState.selectedMarkerIndex = -1;
        this.vlSyncState.selectedMarkerType = 'start';

        // Ana video çözünürlüğünü al
        const mainMeta = VideoPlayer.metadata;
        if (mainMeta) {
            this.videoLayerState.mainResolution = {
                width: mainMeta.width || 1920,
                height: mainMeta.height || 1080
            };
        }

        // Katman video bilgilerini al
        const filename = layerVideoPath.split(/[/\\]/).pop();
        document.getElementById('vl-selected-filename').textContent = filename;

        try {
            const result = await window.api.getVideoMetadata(layerVideoPath);
            if (result.success) {
                this.videoLayerState.layerMetadata = result.data;
                document.getElementById('vl-layer-duration').textContent =
                    Utils.formatTime(result.data.duration);
            }
        } catch (e) {
            console.error('Layer video metadata alınamadı:', e);
        }

        // UI'ı sıfırla
        document.querySelector('input[name="vl-mode"][value="sign-language"]').checked = true;
        document.getElementById('vl-position-preset').value = 'bottom-right';
        document.getElementById('vl-size-percent').value = 12.5;
        document.getElementById('vl-size-percent-value').textContent = '%12.5';
        document.getElementById('vl-keep-aspect').checked = true;
        document.getElementById('vl-layer-mute').value = 'mute';
        document.getElementById('vl-layer-volume').value = 100;
        document.getElementById('vl-layer-volume-value').textContent = '%100';
        document.getElementById('vl-main-volume').value = 100;
        document.getElementById('vl-main-volume-value').textContent = '%100';
        document.querySelector('input[name="vl-timing-mode"][value="whole"]').checked = true;

        // End time'ı ana video süresine ayarla
        const mainDuration = VideoPlayer.getDuration() || 0;
        document.getElementById('vl-end-time').value = mainDuration.toFixed(1);

        // ÖNEMLI: Boyutu önce hesapla, sonra konumu hesapla
        // Bu sayede konum hesaplanırken doğru overlay boyutu kullanılır
        this.updateVideoLayerSize(12.5);
        this.applyVideoLayerPositionPreset('bottom-right');

        // Adımı güncelle
        this.updateVideoLayerWizardStep(1);

        // Event listeners'ı kur (ilk kez)
        this.setupVideoLayerWizardEventListeners();

        dialog.showModal();
        Accessibility.announce(this.t('runtime.video_layer.wizard_opened', 'Video Layer Wizard opened. Step 1: Select a layout mode.'));

        // İlk seçeneğe odaklan
        document.querySelector('input[name="vl-mode"]:checked')?.focus();
    },

    /**
     * Video Layer Wizard adımını güncelle
     */
    updateVideoLayerWizardStep(step) {
        this.videoLayerState.currentStep = step;

        // Tüm adımları gizle (5 adım)
        for (let i = 1; i <= 5; i++) {
            const stepEl = document.getElementById(`vl-wizard-step-${i}`);
            const indicator = document.getElementById(`vl-step-indicator-${i}`);
            if (stepEl) stepEl.classList.toggle('hidden', i !== step);
            if (indicator) indicator.classList.toggle('active', i === step);
        }

        // Butonları güncelle
        const backBtn = document.getElementById('vl-wizard-back');
        const nextBtn = document.getElementById('vl-wizard-next');
        const finishBtn = document.getElementById('vl-wizard-finish');

        backBtn.disabled = step === 1;
        nextBtn.classList.toggle('hidden', step === 5);
        finishBtn.classList.toggle('hidden', step !== 5);

        // Adıma özel işlemler
        if (step === 4) {
            // Senkronizasyon adımı - motorları hazırla
            this.initVideoLayerSyncEngine();
        }

        // Özeti güncelle (son adımda)
        if (step === 5) {
            this.updateVideoLayerSummary();
        }

        // Adıma göre focus ve duyuru
        const stepTitles = [
            this.t('runtime.video_layer.step_1', 'Layout Mode Selection'),
            this.t('runtime.video_layer.step_2', 'Position and Size Settings'),
            this.t('runtime.video_layer.step_3', 'Audio Control'),
            this.t('runtime.video_layer.step_4', 'Synchronization Fine Tuning'),
            this.t('runtime.video_layer.step_5', 'Timing')
        ];
        let announceText = this.t('runtime.video_layer.step_announce', 'Step {step}: {title}', {
            step,
            title: stepTitles[step - 1]
        });

        // Step 4 için özel hatırlatma (Kullanıcı İsteği)
        if (step === 4) {
            announceText += ` ${this.t('runtime.video_layer.step_4_help', 'Use K to play, J and L to seek. Move the layer video with Alt+Shift+Arrow for 100 ms, Alt+Arrow for 10 ms, and Ctrl+Arrow for 1 ms fine adjustment.')}`;
        }

        Accessibility.announce(announceText);

        // Adıma göre ilk elemana odaklan
        setTimeout(() => {
            let focusElement = null;
            switch (step) {
                case 1:
                    focusElement = document.querySelector('input[name="vl-mode"]:checked');
                    break;
                case 2:
                    focusElement = document.getElementById('vl-position-preset');
                    break;
                case 3:
                    focusElement = document.getElementById('vl-layer-mute');
                    break;
                case 4:
                    // Senkronizasyon - oynat butonuna odaklan
                    focusElement = document.getElementById('btn-vl-sync-play');
                    break;
                case 5:
                    focusElement = document.querySelector('input[name="vl-timing-mode"]:checked');
                    break;
            }
            if (focusElement) focusElement.focus();
        }, 100);
    },

    /**
     * Video Layer Wizard event listeners
     */
    setupVideoLayerWizardEventListeners() {
        if (this._vlWizardEventsSetup) return;

        const dialog = document.getElementById('video-layer-wizard-dialog');

        // Mod seçimi değiştiğinde
        dialog.querySelectorAll('input[name="vl-mode"]').forEach(radio => {
            radio.addEventListener('change', () => {
                this.videoLayerState.mode = radio.value;
                this.applyVideoLayerModePreset(radio.value);
            });
        });

        // Konum preset değiştiğinde
        document.getElementById('vl-position-preset')?.addEventListener('change', (e) => {
            const preset = e.target.value;
            if (preset === 'custom') {
                document.getElementById('vl-manual-position').classList.remove('hidden');
            } else {
                document.getElementById('vl-manual-position').classList.add('hidden');
                this.applyVideoLayerPositionPreset(preset);
            }
        });

        // Boyut yüzdesi değiştiğinde
        document.getElementById('vl-size-percent')?.addEventListener('input', (e) => {
            const percent = parseInt(e.target.value);
            document.getElementById('vl-size-percent-value').textContent = `%${percent}`;
            this.videoLayerState.sizePercent = percent;
            this.updateVideoLayerSize(percent);
        });

        // Genişlik/yükseklik değiştiğinde
        document.getElementById('vl-width')?.addEventListener('input', (e) => {
            this.videoLayerState.size.width = parseInt(e.target.value) || 480;
            if (this.videoLayerState.keepAspect && this.videoLayerState.layerMetadata) {
                const aspect = this.videoLayerState.layerMetadata.width / this.videoLayerState.layerMetadata.height;
                this.videoLayerState.size.height = Math.round(this.videoLayerState.size.width / aspect);
                document.getElementById('vl-height').value = this.videoLayerState.size.height;
            }
        });

        document.getElementById('vl-height')?.addEventListener('input', (e) => {
            this.videoLayerState.size.height = parseInt(e.target.value) || 270;
        });

        // Oranı koru checkbox
        document.getElementById('vl-keep-aspect')?.addEventListener('change', (e) => {
            this.videoLayerState.keepAspect = e.target.checked;
        });

        // Ses durumu değiştiğinde
        document.getElementById('vl-layer-mute')?.addEventListener('change', (e) => {
            this.videoLayerState.layerMuted = e.target.value === 'mute';
            const volumeGroup = document.getElementById('vl-layer-volume-group');
            if (volumeGroup) {
                volumeGroup.style.opacity = this.videoLayerState.layerMuted ? '0.5' : '1';
            }
            const announcement = this.videoLayerState.layerMuted
                ? this.t('runtime.video_layer.layer_audio_muted', 'Layer video audio muted.')
                : this.t('runtime.video_layer.layer_audio_unmuted', 'Layer video audio unmuted.');
            Accessibility.announce(announcement);
        });

        // Ses seviyeleri
        const setupVolumeSlider = (sliderId, valueId, stateKey) => {
            const slider = document.getElementById(sliderId);
            const valueEl = document.getElementById(valueId);
            if (!slider || !valueEl) return;

            slider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                valueEl.textContent = `%${value}`;
                this.videoLayerState[stateKey] = value;
            });

            slider.addEventListener('keydown', (e) => {
                let step = 0;
                if (e.key === 'PageUp') step = 10;
                else if (e.key === 'PageDown') step = -10;
                else if (e.key === 'ArrowUp') step = 1;
                else if (e.key === 'ArrowDown') step = -1;
                else return;

                e.preventDefault();
                const currentValue = parseInt(slider.value);
                const newValue = Math.min(200, Math.max(0, currentValue + step));
                slider.value = newValue;
                valueEl.textContent = `%${newValue}`;
                this.videoLayerState[stateKey] = newValue;
                Accessibility.announce(`%${newValue}`);
            });
        };

        setupVolumeSlider('vl-layer-volume', 'vl-layer-volume-value', 'layerVolume');
        setupVolumeSlider('vl-main-volume', 'vl-main-volume-value', 'mainVolume');

        // Boyut Yüzdesi slider'ı
        const sizeSlider = document.getElementById('vl-size-percent');
        const sizeValue = document.getElementById('vl-size-percent-value');
        if (sizeSlider && sizeValue) {
            sizeSlider.addEventListener('input', (e) => {
                const percent = parseFloat(e.target.value);
                sizeValue.textContent = `%${percent}`;
                this.videoLayerState.sizePercent = percent;

                // Genişlik ve yüksekliği hesapla ve güncelle
                const mainRes = this.videoLayerState.mainResolution;
                const newWidth = Math.round(mainRes.width * (percent / 100));
                const newHeight = Math.round(mainRes.height * (percent / 100));

                this.videoLayerState.size = { width: newWidth, height: newHeight };

                // Input alanlarını güncelle
                document.getElementById('vl-width').value = newWidth;
                document.getElementById('vl-height').value = newHeight;

                // Konum preset'ine göre konumu yeniden hesapla
                const posPreset = document.getElementById('vl-position-preset')?.value || 'bottom-right';
                if (posPreset !== 'custom') {
                    const margin = 20;
                    let x = margin, y = margin;

                    if (posPreset.includes('right')) x = mainRes.width - newWidth - margin;
                    if (posPreset.includes('bottom')) y = mainRes.height - newHeight - margin;
                    if (posPreset === 'center') {
                        x = Math.round((mainRes.width - newWidth) / 2);
                        y = Math.round((mainRes.height - newHeight) / 2);
                    }

                    this.videoLayerState.position = { x, y };
                    document.getElementById('vl-pos-x').value = x;
                    document.getElementById('vl-pos-y').value = y;
                }

                Accessibility.announce(this.t('runtime.video_layer.size_changed', 'Size %{percent}: {width}x{height} pixels', {
                    percent,
                    width: newWidth,
                    height: newHeight
                }));
            });
        }

        // Zamanlama modu
        dialog.querySelectorAll('input[name="vl-timing-mode"]').forEach(radio => {
            radio.addEventListener('change', () => {
                this.videoLayerState.timingMode = radio.value;
                const manualDiv = document.getElementById('vl-timing-manual');
                manualDiv.classList.toggle('hidden', radio.value !== 'manual');
            });
        });

        // Şu an butonları
        document.getElementById('btn-vl-start-current')?.addEventListener('click', () => {
            const currentTime = VideoPlayer.getCurrentTime();
            document.getElementById('vl-start-time').value = currentTime.toFixed(1);
            this.videoLayerState.startTime = currentTime;
            Accessibility.announce(this.t('runtime.video_layer.start_time_set', 'Start: {time}', { time: Utils.formatTime(currentTime) }));
        });

        document.getElementById('btn-vl-end-current')?.addEventListener('click', () => {
            const currentTime = VideoPlayer.getCurrentTime();
            document.getElementById('vl-end-time').value = currentTime.toFixed(1);
            this.videoLayerState.endTime = currentTime;
            Accessibility.announce(this.t('runtime.video_layer.end_time_set', 'End: {time}', { time: Utils.formatTime(currentTime) }));
        });

        // Zaman inputları
        document.getElementById('vl-start-time')?.addEventListener('change', (e) => {
            this.videoLayerState.startTime = parseFloat(e.target.value) || 0;
        });

        document.getElementById('vl-end-time')?.addEventListener('change', (e) => {
            this.videoLayerState.endTime = parseFloat(e.target.value) || 0;
        });

        // AI öneri butonu
        document.getElementById('btn-vl-ai-suggest')?.addEventListener('click', async () => {
            await this.getVideoLayerAiSuggestion();
        });

        // Ses Önizleme butonu (Alt+P)
        document.getElementById('btn-vl-audio-preview')?.addEventListener('click', async () => {
            await this.audioPreviewVideoLayer();
        });

        // Konum bilgisi önizle butonu
        document.getElementById('btn-vl-preview')?.addEventListener('click', () => {
            this.previewVideoLayer();
        });

        // Alt+P kısayolu (dialog genelinde)
        dialog.addEventListener('keydown', (e) => {
            if (e.altKey && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                // 3. adımdaysa ses önizleme yap
                if (this.videoLayerState.currentStep === 3) {
                    this.audioPreviewVideoLayer();
                }
            }
        });

        // Navigasyon butonları
        document.getElementById('vl-wizard-back')?.addEventListener('click', () => {
            if (this.videoLayerState.currentStep > 1) {
                this.updateVideoLayerWizardStep(this.videoLayerState.currentStep - 1);
            }
        });

        document.getElementById('vl-wizard-next')?.addEventListener('click', () => {
            if (this.videoLayerState.currentStep < 5) {
                this.updateVideoLayerWizardStep(this.videoLayerState.currentStep + 1);
            }
        });

        document.getElementById('vl-wizard-finish')?.addEventListener('click', async () => {
            await this.applyVideoLayer();
        });

        document.getElementById('vl-wizard-cancel')?.addEventListener('click', () => {
            const dialog = document.getElementById('video-layer-wizard-dialog');
            dialog.close();
            if (window.Keyboard) window.Keyboard.setEnabled(true);
        });

        // Dialog kapatıldığında
        dialog.addEventListener('close', () => {
            if (window.Keyboard) window.Keyboard.setEnabled(true);
        });

        this._vlWizardEventsSetup = true;
    },

    /**
     * Mod preset'ini uygula
     */
    applyVideoLayerModePreset(mode) {
        const { width: mainW, height: mainH } = this.videoLayerState.mainResolution;

        switch (mode) {
            case 'sign-language':
                // Türkiye standardı: Sağ alt, %12.5 (8'de bir)
                this.videoLayerState.sizePercent = 12.5;
                this.videoLayerState.layerMuted = true;
                document.getElementById('vl-position-preset').value = 'bottom-right';
                document.getElementById('vl-size-percent').value = 12.5;
                document.getElementById('vl-size-percent-value').textContent = '%12.5';
                document.getElementById('vl-layer-mute').value = 'mute';
                Accessibility.announce(this.t('runtime.video_layer.mode_sign_language', 'Sign language mode selected. Bottom right, twelve and a half percent, audio muted.'));
                break;

            case 'split-screen':
                // %50/%50 split
                this.videoLayerState.sizePercent = 50;
                this.videoLayerState.layerMuted = false;
                document.getElementById('vl-position-preset').value = 'center-left';
                document.getElementById('vl-size-percent').value = 50;
                document.getElementById('vl-size-percent-value').textContent = '%50';
                document.getElementById('vl-layer-mute').value = 'unmute';
                Accessibility.announce(this.t('runtime.video_layer.mode_split_screen', 'Split screen mode selected. Left half, fifty percent.'));
                break;

            case 'camera-corner':
                // Sağ üst, %15
                this.videoLayerState.sizePercent = 15;
                this.videoLayerState.layerMuted = false;
                document.getElementById('vl-position-preset').value = 'top-right';
                document.getElementById('vl-size-percent').value = 15;
                document.getElementById('vl-size-percent-value').textContent = '%15';
                document.getElementById('vl-layer-mute').value = 'unmute';
                Accessibility.announce(this.t('runtime.video_layer.mode_camera_corner', 'Camera in corner mode selected. Top right, fifteen percent.'));
                break;

            case 'custom':
                Accessibility.announce(this.t('runtime.video_layer.mode_custom', 'Custom layout mode selected. Set the position and size yourself.'));
                break;
        }

        this.updateVideoLayerSize(this.videoLayerState.sizePercent);
    },

    /**
     * Konum preset'ini uygula
     */
    applyVideoLayerPositionPreset(preset) {
        const { width: mainW, height: mainH } = this.videoLayerState.mainResolution;
        const { width: overlayW, height: overlayH } = this.videoLayerState.size;
        const margin = 20;

        let x = 0, y = 0;

        switch (preset) {
            case 'top-left':
                x = margin; y = margin;
                break;
            case 'top-center':
                x = Math.round((mainW - overlayW) / 2); y = margin;
                break;
            case 'top-right':
                x = mainW - overlayW - margin; y = margin;
                break;
            case 'center-left':
                x = margin; y = Math.round((mainH - overlayH) / 2);
                break;
            case 'center':
                x = Math.round((mainW - overlayW) / 2);
                y = Math.round((mainH - overlayH) / 2);
                break;
            case 'center-right':
                x = mainW - overlayW - margin;
                y = Math.round((mainH - overlayH) / 2);
                break;
            case 'bottom-left':
                x = margin; y = mainH - overlayH - margin;
                break;
            case 'bottom-center':
                x = Math.round((mainW - overlayW) / 2);
                y = mainH - overlayH - margin;
                break;
            case 'bottom-right':
                x = mainW - overlayW - margin;
                y = mainH - overlayH - margin;
                break;
        }

        this.videoLayerState.position = { x, y };
        document.getElementById('vl-pos-x').value = x;
        document.getElementById('vl-pos-y').value = y;

        const positionNames = {
            'top-left': this.t('runtime.video_layer.position_top_left', 'Top Left'),
            'top-center': this.t('runtime.video_layer.position_top_center', 'Top Center'),
            'top-right': this.t('runtime.video_layer.position_top_right', 'Top Right'),
            'center-left': this.t('runtime.video_layer.position_center_left', 'Center Left'),
            'center': this.t('runtime.video_layer.position_center', 'Center'),
            'center-right': this.t('runtime.video_layer.position_center_right', 'Center Right'),
            'bottom-left': this.t('runtime.video_layer.position_bottom_left', 'Bottom Left'),
            'bottom-center': this.t('runtime.video_layer.position_bottom_center', 'Bottom Center'),
            'bottom-right': this.t('runtime.video_layer.position_bottom_right', 'Bottom Right')
        };

        Accessibility.announce(this.t('runtime.video_layer.position_updated', 'Video layer position updated to {position}.', {
            position: positionNames[preset]
        }));
    },

    /**
     * Boyutu yüzdeye göre güncelle
     */
    updateVideoLayerSize(percent) {
        const { width: mainW, height: mainH } = this.videoLayerState.mainResolution;
        const layerMeta = this.videoLayerState.layerMetadata;

        let overlayW = Math.round(mainW * percent / 100);
        let overlayH;

        if (layerMeta && layerMeta.width && layerMeta.height) {
            const aspect = layerMeta.width / layerMeta.height;
            overlayH = Math.round(overlayW / aspect);
        } else {
            overlayH = Math.round(overlayW * 9 / 16); // Default 16:9
        }

        this.videoLayerState.size = { width: overlayW, height: overlayH };
        document.getElementById('vl-width').value = overlayW;
        document.getElementById('vl-height').value = overlayH;

        // Konum preset'ini de güncelle
        const preset = document.getElementById('vl-position-preset').value;
        if (preset !== 'custom') {
            this.applyVideoLayerPositionPreset(preset);
        }
    },

    /**
     * Özeti güncelle
     */
    updateVideoLayerSummary() {
        const state = this.videoLayerState;
        const modeNames = {
            'sign-language': this.t('runtime.video_layer.summary_mode_sign_language', 'Sign Language'),
            'split-screen': this.t('runtime.video_layer.summary_mode_split_screen', 'Split Screen'),
            'camera-corner': this.t('runtime.video_layer.summary_mode_camera_corner', 'Camera Corner'),
            'custom': this.t('runtime.video_layer.summary_mode_custom', 'Custom Layout')
        };

        const positionPreset = document.getElementById('vl-position-preset').value;
        const positionNames = {
            'top-left': this.t('runtime.video_layer.position_top_left', 'Top Left'),
            'top-center': this.t('runtime.video_layer.position_top_center', 'Top Center'),
            'top-right': this.t('runtime.video_layer.position_top_right', 'Top Right'),
            'center-left': this.t('runtime.video_layer.position_center_left', 'Center Left'),
            'center': this.t('runtime.video_layer.position_center', 'Center'),
            'center-right': this.t('runtime.video_layer.position_center_right', 'Center Right'),
            'bottom-left': this.t('runtime.video_layer.position_bottom_left', 'Bottom Left'),
            'bottom-center': this.t('runtime.video_layer.position_bottom_center', 'Bottom Center'),
            'bottom-right': this.t('runtime.video_layer.position_bottom_right', 'Bottom Right'),
            'custom': this.t('runtime.video_layer.position_custom', 'Custom')
        };

        const soundStatus = state.layerMuted
            ? this.t('runtime.video_layer.summary_sound_muted', 'audio muted')
            : this.t('runtime.video_layer.summary_sound_level', 'audio %{volume}', { volume: state.layerVolume });

        let timingText = '';
        switch (state.timingMode) {
            case 'whole':
                timingText = this.t('runtime.video_layer.timing_whole', 'For the whole video');
                break;
            case 'from-current':
                timingText = this.t('runtime.video_layer.timing_from_current', 'From {time}', { time: Utils.formatTime(VideoPlayer.getCurrentTime()) });
                break;
            case 'manual':
                const start = parseFloat(document.getElementById('vl-start-time').value) || 0;
                const end = parseFloat(document.getElementById('vl-end-time').value) || 0;
                timingText = this.t('runtime.video_layer.timing_manual', '{start} - {end}', {
                    start: Utils.formatTime(start),
                    end: Utils.formatTime(end)
                });
                break;
        }

        const summary = this.t('runtime.video_layer.summary_text', '{mode} mode. {position}, %{size}, {sound}. {timing}.', {
            mode: modeNames[state.mode],
            position: positionNames[positionPreset],
            size: state.sizePercent,
            sound: soundStatus,
            timing: timingText
        });
        document.getElementById('vl-summary-text').textContent = summary;
    },

    /**
     * AI ile konum önerisi al
     */
    async getVideoLayerAiSuggestion() {
        const feedbackEl = document.getElementById('vl-ai-feedback');
        feedbackEl.classList.remove('hidden');
        feedbackEl.textContent = this.t('runtime.video_layer.ai_loading', 'AI is analyzing, please wait...');
        Accessibility.announce(this.t('runtime.video_layer.ai_loading', 'AI is analyzing, please wait...'));

        try {
            const result = await window.api.getVideoLayerAiSuggestion({
                mainVideoPath: App.currentFilePath,
                layerVideoPath: this.videoLayerState.layerVideoPath,
                purpose: this.videoLayerState.mode,
                currentTime: VideoPlayer.getCurrentTime()
            });

            if (result.success && result.suggestions && result.suggestions.length > 0) {
                const suggestion = result.suggestions[0];
                const suggestionPosition = suggestion.positionKey
                    ? this.t(suggestion.positionKey, suggestion.positionFallback || suggestion.position || '')
                    : suggestion.position;
                const suggestionReason = suggestion.reasonKey
                    ? this.t(suggestion.reasonKey, suggestion.reasonFallback || suggestion.reason || '')
                    : suggestion.reason;

                // Öneriyi uygula
                this.videoLayerState.position = { x: suggestion.x, y: suggestion.y };
                this.videoLayerState.size = { width: suggestion.width, height: suggestion.height };

                // Preset'i custom yap ki diğer ayarlar bozmasın ve manuel alanları göster
                const presetSelect = document.getElementById('vl-position-preset');
                if (presetSelect) {
                    presetSelect.value = 'custom';
                }
                const manualPosDiv = document.getElementById('vl-manual-position');
                if (manualPosDiv) {
                    manualPosDiv.classList.remove('hidden');
                }

                // Slider'ı da güncellemeye çalış (yaklaşık)
                const mainW = this.videoLayerState.mainResolution.width;
                if (mainW > 0) {
                    const newPercent = Math.round((suggestion.width / mainW) * 100 * 2) / 2; // 0.5 step
                    const slider = document.getElementById('vl-size-percent');
                    const sliderVal = document.getElementById('vl-size-percent-value');
                    if (slider && sliderVal) {
                        slider.value = newPercent;
                        sliderVal.textContent = `%${newPercent}`;
                        this.videoLayerState.sizePercent = newPercent;
                    }
                }

                document.getElementById('vl-pos-x').value = suggestion.x;
                document.getElementById('vl-pos-y').value = suggestion.y;
                document.getElementById('vl-width').value = suggestion.width;
                document.getElementById('vl-height').value = suggestion.height;

                feedbackEl.textContent = this.t('runtime.video_layer.ai_suggestion', 'Suggestion: {position}. {reason}', {
                    position: suggestionPosition,
                    reason: suggestionReason
                });
                Accessibility.announce(this.t('runtime.video_layer.ai_first_suggestion', 'First suggestion: {position}. {reason}', {
                    position: suggestionPosition,
                    reason: suggestionReason
                }));
            } else {
                feedbackEl.textContent = this.t('runtime.video_layer.ai_suggestion_failed', 'AI suggestion could not be retrieved.');
                Accessibility.announce(this.t('runtime.video_layer.ai_suggestion_failed', 'AI suggestion could not be retrieved.'));
            }
        } catch (error) {
            console.error('AI öneri hatası:', error);
            feedbackEl.textContent = this.t('runtime.video_layer.ai_suggestion_error', 'An error occurred while retrieving the AI suggestion.');
            Accessibility.announce(this.t('runtime.video_layer.ai_suggestion_error', 'An error occurred while retrieving the AI suggestion.'));
        }
    },

    /**
     * Önizleme
     */
    previewVideoLayer() {
        // Basit önizleme: Sadece duyuru yap (gerçek önizleme video birleştirme gerektirir)
        const state = this.videoLayerState;
        const { width, height } = state.size;
        const { x, y } = state.position;

        Accessibility.announce(this.t('runtime.video_layer.preview_position', 'Preview: The video layer will appear at position {x},{y} with size {width}x{height}.', {
            x,
            y,
            width,
            height
        }));
    },

    // Ses Önizleme için geçici audio elementleri
    _audioPreviewElements: null,
    _audioPreviewPlaying: false,

    /**
     * Ses Önizleme - Her iki videonun sesini aynı anda çal
     */
    async audioPreviewVideoLayer() {
        const state = this.videoLayerState;
        const statusEl = document.getElementById('vl-audio-preview-status');
        const btn = document.getElementById('btn-vl-audio-preview');

        // Re-entry guard (duplicate click prevention)
        if (this._audioPreviewLoading) return;

        // Eğer zaten çalıyorsa durdur
        if (this._audioPreviewPlaying) {
            this.stopAudioPreview();
            return;
        }

        this._audioPreviewLoading = true;
        this._audioPreviewPlaying = true; // Set to true to allow cancellation via stop

        statusEl.classList.remove('hidden');
        statusEl.textContent = this.t('runtime.video_layer.audio_preparing', 'Preparing audio...');
        Accessibility.announce(this.t('runtime.video_layer.audio_preview_preparing', 'Preparing audio preview, please wait.'));

        try {
            // Audio elementlerini oluştur
            if (!this._audioPreviewElements) {
                this._audioPreviewElements = {
                    mainAudio: new Audio(),
                    layerAudio: new Audio()
                };
            }

            const { mainAudio, layerAudio } = this._audioPreviewElements;

            // Cancellation Check
            if (!this._audioPreviewPlaying) return;

            // Sesleri çıkar ve yükle
            const mainAudioPath = await window.api.getTempPath('vl_preview_main.wav');
            const layerAudioPath = await window.api.getTempPath('vl_preview_layer.wav');

            // Cancellation Check
            if (!this._audioPreviewPlaying) return;

            // Ana video sesini çıkar
            statusEl.textContent = this.t('runtime.video_layer.extracting_main_audio', 'Extracting main video audio...');
            const mainResult = await window.api.extractAudio({
                inputPath: App.currentFilePath,
                outputPath: mainAudioPath
            });

            if (!mainResult.success) {
                throw new Error(this.t('runtime.video_layer.extract_main_audio_failed', 'Main video audio could not be extracted'));
            }

            // Cancellation Check
            if (!this._audioPreviewPlaying) return;

            // Katman video sesini çıkar
            statusEl.textContent = this.t('runtime.video_layer.extracting_layer_audio', 'Extracting layer video audio...');
            const layerResult = await window.api.extractAudio({
                inputPath: state.layerVideoPath,
                outputPath: layerAudioPath
            });

            if (!layerResult.success) {
                throw new Error(this.t('runtime.video_layer.extract_layer_audio_failed', 'Layer video audio could not be extracted'));
            }

            // Cancellation Check
            if (!this._audioPreviewPlaying) return;

            // Sesleri yükle
            mainAudio.src = mainAudioPath;
            layerAudio.src = layerAudioPath;

            // Ses seviyelerini ayarla
            mainAudio.volume = Math.min(1, state.mainVolume / 100);
            layerAudio.volume = state.layerMuted ? 0 : Math.min(1, state.layerVolume / 100);

            // Yüklenmeyi bekle
            statusEl.textContent = this.t('runtime.video_layer.loading_audio', 'Loading audio...');
            await Promise.all([
                new Promise(resolve => { mainAudio.oncanplay = resolve; mainAudio.load(); }),
                new Promise(resolve => { layerAudio.oncanplay = resolve; layerAudio.load(); })
            ]);

            // Cancellation Check
            if (!this._audioPreviewPlaying) return;

            // Oynat
            statusEl.textContent = this.t('runtime.video_layer.preview_playing', 'Preview is playing... (Press again to stop)');
            btn.innerHTML = `<span class="icon">⏹</span> ${this.t('runtime.video_layer.stop_button', 'Stop')}`;
            // this._audioPreviewPlaying = true; // Already set

            mainAudio.currentTime = 0;
            layerAudio.currentTime = 0;
            mainAudio.play();
            layerAudio.play();

            Accessibility.announce(this.t('runtime.video_layer.audio_preview_started', 'Audio preview started. Main video %{mainVolume}, layer {layerVolume}', {
                mainVolume: state.mainVolume,
                layerVolume: state.layerMuted
                    ? this.t('runtime.video_layer.layer_silent', 'silent')
                    : `%${state.layerVolume}`
            }));

            // Bittiğinde temizle
            mainAudio.onended = () => {
                this.stopAudioPreview();
            };

        } catch (error) {
            console.error('Ses önizleme hatası:', error);
            statusEl.textContent = this.t('runtime.common.error', 'Error: {error}', { error: error.message });
            Accessibility.announceError(this.t('runtime.video_layer.audio_preview_error', 'Audio preview error'));
            this._audioPreviewPlaying = false;
        } finally {
            this._audioPreviewLoading = false;
        }
    },

    /**
     * Ses önizlemeyi durdur
     */
    stopAudioPreview() {
        if (this._audioPreviewElements) {
            this._audioPreviewElements.mainAudio.pause();
            this._audioPreviewElements.layerAudio.pause();
            this._audioPreviewElements.mainAudio.currentTime = 0;
            this._audioPreviewElements.layerAudio.currentTime = 0;
        }

        this._audioPreviewPlaying = false;

        const statusEl = document.getElementById('vl-audio-preview-status');
        const btn = document.getElementById('btn-vl-audio-preview');

        if (statusEl) {
            statusEl.textContent = this.t('runtime.video_layer.preview_stopped', 'Preview stopped.');
            setTimeout(() => statusEl.classList.add('hidden'), 2000);
        }
        if (btn) {
            btn.innerHTML = `<span class="icon">🔊</span> ${this.t('runtime.video_layer.audio_preview_button', 'Audio Preview (Alt+P)')}`;
        }

        Accessibility.announce(this.t('runtime.video_layer.audio_preview_stopped', 'Audio preview stopped.'));
    },

    // =====================================
    // SENKRON MOTORU (Video Layer İnce Ayar)
    // =====================================

    vlSyncState: {
        offsetMs: 0,
        loopEnabled: false,
        loopStart: 0,
        listenMode: 'mix',
        channelMode: 'split',
        isPlaying: false,
        audioContext: null,
        mainGain: null,
        layerGain: null,
        mainPanner: null,
        layerPanner: null,
        mainSource: null,
        layerSource: null,
        audioNodesInitialized: false,
        // Kesme modu
        cutMarkers: [],        // [{start: 15.5, end: 20.3}, ...]
        pendingMarker: null,   // Başlangıç koyuldu ama bitiş henüz yok
        selectedMarkerIndex: -1,
        selectedMarkerType: 'start' // 'start' veya 'end' - hangi uç seçili
    },

    /**
     * Video Layer Senkronizasyon Motorunu başlat
     */
    async initVideoLayerSyncEngine() {
        const state = this.videoLayerState;
        const syncState = this.vlSyncState;

        // Elementi al
        const mainVideo = document.getElementById('vl-sync-main-video');
        const mainAudio = document.getElementById('vl-sync-main-audio');
        const layerAudio = document.getElementById('vl-sync-layer-audio');

        if (!mainVideo || !mainAudio || !layerAudio) {
            console.error('Sync elementleri bulunamadı');
            return;
        }

        // Videoları yükle
        mainVideo.src = App.currentFilePath;
        mainVideo.load();

        // Sesleri çıkar ve yükle
        Accessibility.announce(this.t('runtime.video_layer.sync_preparing_audio', 'Preparing audio, please wait...'));
        document.getElementById('vl-sync-status').textContent = this.t('runtime.video_layer.sync_extracting_audio', 'Extracting audio...');

        try {
            // Ana video sesini çıkar
            const mainAudioPath = await window.api.getTempPath('vl_main_audio.wav');
            const mainExtract = await window.api.extractAudio({
                inputPath: App.currentFilePath,
                outputPath: mainAudioPath
            });

            if (mainExtract.success) {
                mainAudio.src = mainAudioPath;
                mainAudio.load();
            }

            // Katman video sesini çıkar
            const layerAudioPath = await window.api.getTempPath('vl_layer_audio.wav');
            const layerExtract = await window.api.extractAudio({
                inputPath: state.layerVideoPath,
                outputPath: layerAudioPath
            });

            if (layerExtract.success) {
                layerAudio.src = layerAudioPath;
                layerAudio.load();
            }

            document.getElementById('vl-sync-status').textContent = this.t('runtime.video_layer.sync_ready_press_space', 'Ready. Press Space to play.');
            Accessibility.announce(this.t('runtime.video_layer.sync_ready_split_mode_hint', 'Synchronization engine is ready. Switch listening mode to Split and wear headphones.'));

        } catch (error) {
            console.error('Ses çıkarma hatası:', error);
            document.getElementById('vl-sync-status').textContent = this.t('runtime.video_layer.sync_extract_error', 'Audio extraction error: {error}', { error: error.message });
            Accessibility.announceError(this.t('runtime.video_layer.sync_extract_error_short', 'Audio extraction error'));
        }

        // Web Audio API ile panning
        this.initVLSyncAudioNodes();

        // Event listeners (ilk kez)
        this.setupVLSyncEventListeners();

        // Varsayılan kanal modunu uygula
        document.getElementById('vl-sync-channel-mode').value = 'split';
        this.updateVLSyncChannelRouting();
    },

    /**
     * Web Audio düğümlerini başlat
     */
    initVLSyncAudioNodes() {
        if (this.vlSyncState.audioNodesInitialized) return;

        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.vlSyncState.audioContext = new AudioContext();
            const ctx = this.vlSyncState.audioContext;

            const mainAudio = document.getElementById('vl-sync-main-audio');
            const layerAudio = document.getElementById('vl-sync-layer-audio');

            // Ana video için
            this.vlSyncState.mainSource = ctx.createMediaElementSource(mainAudio);
            this.vlSyncState.mainGain = ctx.createGain();
            this.vlSyncState.mainPanner = ctx.createStereoPanner();
            this.vlSyncState.mainSource.connect(this.vlSyncState.mainGain)
                .connect(this.vlSyncState.mainPanner)
                .connect(ctx.destination);

            // Katman video için
            this.vlSyncState.layerSource = ctx.createMediaElementSource(layerAudio);
            this.vlSyncState.layerGain = ctx.createGain();
            this.vlSyncState.layerPanner = ctx.createStereoPanner();
            this.vlSyncState.layerSource.connect(this.vlSyncState.layerGain)
                .connect(this.vlSyncState.layerPanner)
                .connect(ctx.destination);

            this.vlSyncState.audioNodesInitialized = true;
            console.log('VL Sync Audio Nodes initialized');

        } catch (e) {
            console.error('Web Audio init error:', e);
        }
    },

    /**
     * Kanal yönlendirmesini güncelle
     */
    updateVLSyncChannelRouting() {
        const mode = document.getElementById('vl-sync-channel-mode')?.value || 'center';
        this.vlSyncState.channelMode = mode;

        if (!this.vlSyncState.audioNodesInitialized) return;

        if (mode === 'split') {
            // Ana video: Sol, Katman: Sağ
            this.vlSyncState.mainPanner.pan.value = -1;
            this.vlSyncState.layerPanner.pan.value = 1;
            Accessibility.announce(this.t('runtime.video_layer.channel_split_announce', 'Split mode: main video on the left, layer video on the right.'));
        } else {
            // Merkez
            this.vlSyncState.mainPanner.pan.value = 0;
            this.vlSyncState.layerPanner.pan.value = 0;
            Accessibility.announce(this.t('runtime.video_layer.channel_center_announce', 'Center mode: both audio sources are centered.'));
        }
    },

    /**
     * Dinleme modunu güncelle
     */
    updateVLSyncListeningMode() {
        const mode = document.getElementById('vl-sync-listen-mode')?.value || 'mix';
        this.vlSyncState.listenMode = mode;

        if (!this.vlSyncState.audioNodesInitialized) return;

        switch (mode) {
            case 'mix':
                this.vlSyncState.mainGain.gain.value = 0.5;
                this.vlSyncState.layerGain.gain.value = 0.5;
                break;
            case 'main':
                this.vlSyncState.mainGain.gain.value = 1;
                this.vlSyncState.layerGain.gain.value = 0;
                break;
            case 'layer':
                this.vlSyncState.mainGain.gain.value = 0;
                this.vlSyncState.layerGain.gain.value = 1;
                break;
        }
    },

    /**
     * Senkron oynatma toggle
     */
    async toggleVLSyncPlayback() {
        const mainVideo = document.getElementById('vl-sync-main-video');
        const mainAudio = document.getElementById('vl-sync-main-audio');
        const layerAudio = document.getElementById('vl-sync-layer-audio');
        const playBtn = document.getElementById('btn-vl-sync-play');

        if (!mainVideo) return;

        // AudioContext'i resume et
        if (this.vlSyncState.audioContext?.state === 'suspended') {
            await this.vlSyncState.audioContext.resume();
        }

        if (mainVideo.paused) {
            await mainVideo.play();
            mainAudio.play();
            layerAudio.play();
            playBtn.innerHTML = `<span class="icon">⏸</span> ${this.t('dialog.video_layer_wizard.sync_pause', 'Pause (Space)')}`;
            this.vlSyncState.isPlaying = true;
            Accessibility.announce(this.t('runtime.video_layer.sync_playing', 'Playing'));
        } else {
            mainVideo.pause();
            mainAudio.pause();
            layerAudio.pause();
            playBtn.innerHTML = `<span class="icon">▶</span> ${this.t('dialog.video_layer_wizard.sync_play', 'Play (Space/K)')}`;
            this.vlSyncState.isPlaying = false;
            Accessibility.announce(this.t('runtime.video_layer.sync_paused', 'Paused'));
        }
    },

    /**
     * Offset ayarla
     */
    adjustVLSyncOffset(deltaMs) {
        this.vlSyncState.offsetMs += deltaMs;
        this.videoLayerState.syncOffset = this.vlSyncState.offsetMs;

        document.getElementById('vl-sync-offset').value = `${this.vlSyncState.offsetMs} ms`;
        Accessibility.announce(this.t('runtime.video_layer.offset_announce', 'Offset {offset} milliseconds', {
            offset: this.vlSyncState.offsetMs
        }));

        // ZORLA senkronize et (çalıyor veya duraklatılmış olsa bile)
        this.syncVLAudio(true);
    },

    /**
     * Video'yu durdur ve başa al (S tuşu)
     */
    stopAndResetVLSync() {
        const mainVideo = document.getElementById('vl-sync-main-video');
        const mainAudio = document.getElementById('vl-sync-main-audio');
        const layerAudio = document.getElementById('vl-sync-layer-audio');
        const playBtn = document.getElementById('btn-vl-sync-play');

        if (!mainVideo) return;

        // Hepsini durdur
        mainVideo.pause();
        mainAudio.pause();
        layerAudio.pause();

        // Başa al
        mainVideo.currentTime = 0;
        mainAudio.currentTime = 0;
        layerAudio.currentTime = 0;

        // Loop'u kapat
        this.vlSyncState.loopEnabled = false;
        const loopBtn = document.getElementById('btn-vl-sync-loop');
        if (loopBtn) {
            loopBtn.textContent = this.t('dialog.video_layer_wizard.loop_off', 'Loop: Off (O)');
            loopBtn.style.background = '';
        }

        playBtn.innerHTML = `<span class="icon">▶</span> ${this.t('dialog.video_layer_wizard.sync_play', 'Play (Space/K)')}`;
        this.vlSyncState.isPlaying = false;
        Accessibility.announce(this.t('runtime.video_layer.sync_stopped_reset', 'Stopped and returned to the beginning.'));
    },

    /**
     * Video'yu ileri/geri sar (J/L tuşları)
     * @param {number} seconds - Saniye cinsinden (+ileri, -geri)
     */
    seekVLSync(seconds) {
        const mainVideo = document.getElementById('vl-sync-main-video');
        if (!mainVideo) return;

        const newTime = Math.max(0, Math.min(mainVideo.duration, mainVideo.currentTime + seconds));
        mainVideo.currentTime = newTime;

        // Ses de senkronize et
        this.syncVLAudio(true);

        const direction = seconds > 0
            ? this.t('runtime.video_layer.seek_forward', 'Forward')
            : this.t('runtime.video_layer.seek_backward', 'Backward');
        Accessibility.announce(this.t('runtime.video_layer.seek_announce', '{direction} {seconds} seconds. {time}', {
            direction,
            seconds: Math.abs(seconds),
            time: Utils.formatTime(newTime)
        }));
    },

    /**
     * Ses senkronizasyonu
     * @param {boolean} force - true ise drift kontrolü yapmadan doğrudan senkronize et
     */
    syncVLAudio(force = false) {
        const mainVideo = document.getElementById('vl-sync-main-video');
        const mainAudio = document.getElementById('vl-sync-main-audio');
        const layerAudio = document.getElementById('vl-sync-layer-audio');

        if (!mainVideo) return;

        const vidTime = mainVideo.currentTime;

        // Ana audio senkronu (video ile aynı olmalı)
        if (force) {
            mainAudio.currentTime = vidTime;
        } else {
            const mainDrift = Math.abs(mainAudio.currentTime - vidTime);
            if (mainDrift > 0.03) {
                mainAudio.currentTime = vidTime;
            }
        }

        // Katman audio senkronu (offset uygulanır)
        // Pozitif offset = katman GEÇ başlar (ana videodan sonra)
        // Negatif offset = katman ERKEN başlar (ana videodan önce)
        const layerTargetTime = vidTime - (this.vlSyncState.offsetMs / 1000);

        if (layerTargetTime >= 0 && layerTargetTime <= layerAudio.duration) {
            if (force) {
                layerAudio.currentTime = layerTargetTime;
                console.log(`Sync force: video=${vidTime.toFixed(2)}, layer=${layerTargetTime.toFixed(2)}, offset=${this.vlSyncState.offsetMs}ms`);
            } else {
                const layerDrift = Math.abs(layerAudio.currentTime - layerTargetTime);
                if (layerDrift > 0.03) {
                    layerAudio.currentTime = layerTargetTime;
                }
            }
        } else if (layerTargetTime < 0) {
            // Katman henüz başlamamalı - sessiz bekle
            layerAudio.currentTime = 0;
            if (!layerAudio.paused && !mainVideo.paused) {
                // Ses çıkmasın diye duraklatma durumu (volume 0 daha iyi olabilir)
            }
        }
    },

    /**
     * Senkron event listeners
     */
    setupVLSyncEventListeners() {
        if (this._vlSyncEventsSetup) return;

        const mainVideo = document.getElementById('vl-sync-main-video');
        const dialog = document.getElementById('video-layer-wizard-dialog');

        // Play butonu
        document.getElementById('btn-vl-sync-play')?.addEventListener('click', () => {
            this.toggleVLSyncPlayback();
        });

        // Offset butonları
        document.getElementById('btn-vl-offset-inc')?.addEventListener('click', () => {
            this.adjustVLSyncOffset(10);
        });

        document.getElementById('btn-vl-offset-dec')?.addEventListener('click', () => {
            this.adjustVLSyncOffset(-10);
        });

        // Kanal modu
        document.getElementById('vl-sync-channel-mode')?.addEventListener('change', () => {
            this.updateVLSyncChannelRouting();
        });

        // Dinleme modu
        document.getElementById('vl-sync-listen-mode')?.addEventListener('change', () => {
            this.updateVLSyncListeningMode();
        });

        // Loop butonu
        document.getElementById('btn-vl-sync-loop')?.addEventListener('click', () => {
            this.vlSyncState.loopEnabled = !this.vlSyncState.loopEnabled;
            const btn = document.getElementById('btn-vl-sync-loop');
            if (this.vlSyncState.loopEnabled) {
                this.vlSyncState.loopStart = mainVideo?.currentTime || 0;
                btn.textContent = this.t('dialog.video_layer_wizard.loop_on', 'Loop: ON (2s)');
                btn.style.background = '#0078d4';
                Accessibility.announce(this.t('runtime.video_layer.loop_enabled', 'Loop enabled. Two-second loop from the current position.'));
            } else {
                btn.textContent = this.t('dialog.video_layer_wizard.loop_off', 'Loop: Off (O)');
                btn.style.background = '';
                Accessibility.announce(this.t('runtime.video_layer.loop_disabled', 'Loop disabled.'));
            }
        });

        // Video timeupdate
        mainVideo?.addEventListener('timeupdate', () => {
            // Loop kontrolü
            if (this.vlSyncState.loopEnabled && mainVideo.currentTime >= this.vlSyncState.loopStart + 2) {
                mainVideo.currentTime = this.vlSyncState.loopStart;
            }
            this.syncVLAudio();
        });

        // Klavye kısayolları (dialog içinde)
        dialog?.addEventListener('keydown', (e) => {
            // Sadece 4. adımda (senkronizasyon) çalış
            if (this.videoLayerState.currentStep !== 4) return;

            const key = e.key.toLowerCase();

            // K - Duraklat/Oynat (her zaman çalışır)
            if (key === 'k' && !e.altKey && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                this.toggleVLSyncPlayback();
            }
            // Space - Duraklat/Oynat (buton üzerinde değilse)
            else if (e.key === ' ' && e.target.tagName !== 'BUTTON' && !e.altKey && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                this.toggleVLSyncPlayback();
            }
            // S - Durdur ve başa al
            else if (key === 's' && !e.altKey && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                this.stopAndResetVLSync();
            }
            // J - Geri sar (5 saniye)
            else if (key === 'j' && !e.altKey && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                this.seekVLSync(-5);
            }
            // L - İleri sar (5 saniye)
            else if (key === 'l' && !e.altKey && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                this.seekVLSync(5);
            }
            // O - Loop toggle (eskiden L idi)
            else if (key === 'o' && !e.altKey && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                document.getElementById('btn-vl-sync-loop')?.click();
            }
            // Alt+Arrow - offset ±10ms
            else if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    this.adjustVLSyncOffset(10);
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    this.adjustVLSyncOffset(-10);
                }
            }
            // Alt+Shift+Arrow - offset ±100ms
            else if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
                if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    this.adjustVLSyncOffset(100);
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    this.adjustVLSyncOffset(-100);
                }
            }
            // Win+Ctrl+Arrow - offset ±1ms (Windows'ta Meta+Ctrl)
            else if ((e.metaKey || e.ctrlKey) && e.ctrlKey && !e.altKey) {
                if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    this.adjustVLSyncOffset(1);
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    this.adjustVLSyncOffset(-1);
                }
            }
            // M - Marker koy (kesme modu)
            else if (key === 'm' && !e.altKey && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                this.addCutMarker();
            }
            // Delete - Seçili marker'ı sil
            else if (e.key === 'Delete' && !e.altKey && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                this.deleteCutMarker();
            }
            // G - Seçili işaretçiyi 1sn geri çek
            else if (key === 'g' && !e.altKey && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                this.moveSelectedMarkerPoint(-1);
            }
            // H - Seçili işaretçiyi 1sn ileri it
            else if (key === 'h' && !e.altKey && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                this.moveSelectedMarkerPoint(1);
            }
            // Shift+G - Önceki işaretçiye git
            else if (key === 'g' && e.shiftKey && !e.altKey && !e.ctrlKey) {
                e.preventDefault();
                this.navigateToMarker(-1);
            }
            // Shift+H - Sonraki işaretçiye git
            else if (key === 'h' && e.shiftKey && !e.altKey && !e.ctrlKey) {
                e.preventDefault();
                this.navigateToMarker(1);
            }
        });

        // --- Kesme Modu Event Listeners ---

        // Marker Koy butonu
        document.getElementById('btn-vl-add-cut-marker')?.addEventListener('click', () => {
            this.addCutMarker();
        });

        // Marker Sil butonu
        document.getElementById('btn-vl-delete-cut-marker')?.addEventListener('click', () => {
            this.deleteCutMarker();
        });

        // Marker taşı butonları
        document.getElementById('btn-vl-marker-left')?.addEventListener('click', () => {
            this.moveSelectedMarkerPoint(-1);
        });

        document.getElementById('btn-vl-marker-right')?.addEventListener('click', () => {
            this.moveSelectedMarkerPoint(1);
        });

        // Marker listesi seçimi
        document.getElementById('vl-cut-marker-list')?.addEventListener('change', (e) => {
            this.selectCutMarker(e.target.selectedIndex);
        });

        this._vlSyncEventsSetup = true;
    },

    // =====================================
    // KESME MODU FONKSİYONLARI
    // =====================================

    /**
     * Kesme marker'ı ekle (M tuşu)
     */
    addCutMarker() {
        const mainVideo = document.getElementById('vl-sync-main-video');
        if (!mainVideo) return;

        const currentTime = mainVideo.currentTime;
        const timeStr = Utils.formatTime(currentTime);

        // Eğer bekleyen başlangıç marker'ı varsa, bu bitiş
        if (this.vlSyncState.pendingMarker !== null) {
            const startTime = this.vlSyncState.pendingMarker;
            const endTime = currentTime;

            // Başlangıç < bitiş kontrolü
            if (endTime <= startTime) {
                Accessibility.announceError('Bitiş zamanı başlangıçtan büyük olmalı!');
                return;
            }

            // Bölge ekle
            this.vlSyncState.cutMarkers.push({
                start: startTime,
                end: endTime
            });

            this.vlSyncState.pendingMarker = null;
            this.updateCutMarkerList();

            const regionNum = this.vlSyncState.cutMarkers.length;
            Accessibility.announce(`Bölge ${regionNum} tamamlandı: ${Utils.formatTime(startTime)} - ${Utils.formatTime(endTime)}`);
        } else {
            // Bu başlangıç marker'ı
            this.vlSyncState.pendingMarker = currentTime;
            Accessibility.announce(`Başlangıç marker'ı: ${timeStr}. Bitiş için tekrar M basın.`);
            document.getElementById('vl-cut-status').textContent = `Başlangıç: ${timeStr} - Bitiş için M basın...`;
        }
    },

    /**
     * Seçili kesme marker'ını sil (Delete tuşu)
     */
    deleteCutMarker() {
        const listEl = document.getElementById('vl-cut-marker-list');
        const selectedIdx = listEl?.selectedIndex;

        // Bekleyen marker varsa önce onu iptal et
        if (this.vlSyncState.pendingMarker !== null) {
            this.vlSyncState.pendingMarker = null;
            this.updateCutMarkerList();
            Accessibility.announce('Bekleyen başlangıç marker\'ı iptal edildi.');
            return;
        }

        if (selectedIdx === undefined || selectedIdx < 0 || selectedIdx >= this.vlSyncState.cutMarkers.length) {
            Accessibility.announce('Silinecek marker seçilmedi.');
            return;
        }

        const deleted = this.vlSyncState.cutMarkers.splice(selectedIdx, 1)[0];
        this.updateCutMarkerList();
        Accessibility.announce(`Bölge silindi: ${Utils.formatTime(deleted.start)} - ${Utils.formatTime(deleted.end)}`);
    },

    /**
     * Seçili işaretçi noktasını (başlangıç veya bitiş) taşı (G/H tuşları)
     * @param {number} seconds - +1 ileri, -1 geri
     */
    moveSelectedMarkerPoint(seconds) {
        const selectedIdx = this.vlSyncState.selectedMarkerIndex;
        const selectedType = this.vlSyncState.selectedMarkerType;

        if (selectedIdx < 0 || selectedIdx >= this.vlSyncState.cutMarkers.length) {
            Accessibility.announce('Önce bir işaretçi seçin. Shift+H ile sonrakine gidin.');
            return;
        }

        const marker = this.vlSyncState.cutMarkers[selectedIdx];

        if (selectedType === 'start') {
            // Başlangıcı taşı (bitiş'e çok yaklaşmasın)
            const newStart = Math.max(0, marker.start + seconds);
            if (newStart >= marker.end - 0.1) {
                Accessibility.announce('Başlangıç, bitişi geçemez.');
                return;
            }
            marker.start = newStart;
            Accessibility.announce(`Başlangıç: ${Utils.formatTime(marker.start)}`);
        } else {
            // Bitişi taşı (başlangıç'a çok yaklaşmasın)
            const newEnd = marker.end + seconds;
            if (newEnd <= marker.start + 0.1) {
                Accessibility.announce('Bitiş, başlangıcı geçemez.');
                return;
            }
            marker.end = newEnd;
            Accessibility.announce(`Bitiş: ${Utils.formatTime(marker.end)}`);
        }

        this.updateCutMarkerList();

        // Seçimi koru
        const listEl = document.getElementById('vl-cut-marker-list');
        if (listEl) listEl.selectedIndex = selectedIdx;
    },

    /**
     * İşaretçiler arası gezinme (Shift+G/H)
     * @param {number} direction - +1 sonraki, -1 önceki
     */
    navigateToMarker(direction) {
        const markers = this.vlSyncState.cutMarkers;

        if (markers.length === 0) {
            Accessibility.announce('Henüz işaretlenmiş bölge yok.');
            return;
        }

        let currentIdx = this.vlSyncState.selectedMarkerIndex;
        let currentType = this.vlSyncState.selectedMarkerType;

        // Toplam işaretçi sayısı: her bölge için 2 (başlangıç + bitiş)
        // Flat index: bölge0-start, bölge0-end, bölge1-start, bölge1-end...
        let flatIndex = -1;
        if (currentIdx >= 0) {
            flatIndex = currentIdx * 2 + (currentType === 'end' ? 1 : 0);
        }

        // Sonraki veya öncekine git
        flatIndex += direction;

        // Sınırları kontrol et
        const maxFlatIndex = markers.length * 2 - 1;
        if (flatIndex < 0) flatIndex = 0;
        if (flatIndex > maxFlatIndex) flatIndex = maxFlatIndex;

        // Flat index'ten bölge ve tip çıkar
        const newMarkerIndex = Math.floor(flatIndex / 2);
        const newType = (flatIndex % 2 === 0) ? 'start' : 'end';

        this.vlSyncState.selectedMarkerIndex = newMarkerIndex;
        this.vlSyncState.selectedMarkerType = newType;

        // Listede seç
        const listEl = document.getElementById('vl-cut-marker-list');
        if (listEl) listEl.selectedIndex = newMarkerIndex;

        // Duyur
        const marker = markers[newMarkerIndex];
        const typeLabel = newType === 'start' ? 'Başlangıç' : 'Bitiş';
        const time = newType === 'start' ? marker.start : marker.end;
        const duration = (marker.end - marker.start).toFixed(1);

        Accessibility.announce(`Bölge ${newMarkerIndex + 1} ${typeLabel}: ${Utils.formatTime(time)}. Süre: ${duration} saniye.`);

        // Butonları aktifleştir
        this.updateMarkerButtons(true);
    },

    /**
     * Marker butonlarını güncelle
     */
    updateMarkerButtons(enabled) {
        document.getElementById('btn-vl-delete-cut-marker').disabled = !enabled;
        document.getElementById('btn-vl-marker-left').disabled = !enabled;
        document.getElementById('btn-vl-marker-right').disabled = !enabled;
    },

    /**
     * Marker seçildiğinde
     */
    selectCutMarker(index) {
        this.vlSyncState.selectedMarkerIndex = index;

        const hasSelection = index >= 0 && index < this.vlSyncState.cutMarkers.length;

        // Butonları aktifleştir
        document.getElementById('btn-vl-delete-cut-marker').disabled = !hasSelection;
        document.getElementById('btn-vl-marker-left').disabled = !hasSelection;
        document.getElementById('btn-vl-marker-right').disabled = !hasSelection;

        if (hasSelection) {
            const marker = this.vlSyncState.cutMarkers[index];
            Accessibility.announce(`Seçili: Bölge ${index + 1}, ${Utils.formatTime(marker.start)} - ${Utils.formatTime(marker.end)}`);
        }
    },

    /**
     * Marker listesini güncelle
     */
    updateCutMarkerList() {
        const listEl = document.getElementById('vl-cut-marker-list');
        const statusEl = document.getElementById('vl-cut-status');
        if (!listEl) return;

        listEl.innerHTML = '';

        if (this.vlSyncState.cutMarkers.length === 0 && this.vlSyncState.pendingMarker === null) {
            const opt = document.createElement('option');
            opt.disabled = true;
            opt.textContent = 'Henüz marker eklenmedi';
            listEl.appendChild(opt);
        } else {
            // Bekleyen marker varsa göster
            if (this.vlSyncState.pendingMarker !== null) {
                const opt = document.createElement('option');
                opt.disabled = true;
                opt.textContent = `⏳ Başlangıç: ${Utils.formatTime(this.vlSyncState.pendingMarker)} - Bitiş bekleniyor...`;
                listEl.appendChild(opt);
            }

            // Tamamlanmış bölgeler
            this.vlSyncState.cutMarkers.forEach((marker, idx) => {
                const opt = document.createElement('option');
                opt.value = idx;
                const duration = (marker.end - marker.start).toFixed(1);
                opt.textContent = `Bölge ${idx + 1}: ${Utils.formatTime(marker.start)} → ${Utils.formatTime(marker.end)} (${duration}sn)`;
                listEl.appendChild(opt);
            });
        }

        // Status güncelle
        const count = this.vlSyncState.cutMarkers.length;
        const totalDuration = this.vlSyncState.cutMarkers.reduce((sum, m) => sum + (m.end - m.start), 0);
        statusEl.textContent = `Toplam ${count} bölge işaretlendi (${totalDuration.toFixed(1)} saniye silinecek).`;

        // videoLayerState'e de kaydet
        this.videoLayerState.cutRegions = this.vlSyncState.cutMarkers;

        // Butonları güncelle
        document.getElementById('btn-vl-delete-cut-marker').disabled = count === 0;
        document.getElementById('btn-vl-marker-left').disabled = true;
        document.getElementById('btn-vl-marker-right').disabled = true;
    },

    /**
     * Video katmanını uygula
     */
    async applyVideoLayer() {
        const dialog = document.getElementById('video-layer-wizard-dialog');
        const state = this.videoLayerState;

        // Zamanlama değerlerini al
        let startTime = 0;
        let endTime = 0;

        switch (state.timingMode) {
            case 'whole':
                startTime = 0;
                endTime = 0; // 0 = video sonu
                break;
            case 'from-current':
                startTime = VideoPlayer.getCurrentTime();
                endTime = 0;
                break;
            case 'manual':
                startTime = parseFloat(document.getElementById('vl-start-time').value) || 0;
                endTime = parseFloat(document.getElementById('vl-end-time').value) || 0;
                break;
        }

        dialog.close();

        // Önce kayıt yerini sor
        const originalFilename = App.currentFilePath ? App.currentFilePath.split(/[/\\]/).pop().replace(/\.[^.]+$/, '') : 'video';
        const saveResult = await window.api.showSaveDialog({
            title: this.t('runtime.video_layer.save_dialog_title', 'Save Video Layer'),
            defaultPath: `${originalFilename}_katmanli.mp4`,
            filters: [
                { name: this.t('runtime.app.video_files_filter', 'Video Files'), extensions: ['mp4'] }
            ]
        });

        if (saveResult.canceled || !saveResult.filePath) {
            Accessibility.announce(this.t('runtime.video_layer.save_cancelled', 'Video layer insertion was cancelled.'));
            if (window.Keyboard) window.Keyboard.setEnabled(true);
            return;
        }

        const outputPath = saveResult.filePath;

        // İlerleme göster
        App.showProgress(this.t('runtime.video_layer.processing', 'Adding video layer...'));
        Accessibility.announce(this.t('runtime.video_layer.processing_announce', 'Adding video layer, please wait.'));

        // Konum değerlerini kontrol et - eğer varsayılan ise yeniden hesapla
        if (state.position.x === 0 && state.position.y === 0) {
            const preset = document.getElementById('vl-position-preset').value;
            if (preset !== 'custom' && preset !== 'top-left') {
                // Konum yeniden hesapla
                this.updateVideoLayerSize(state.sizePercent);
                console.log('Konum yeniden hesaplandı:', state.position);
            }
        }

        // DEBUG: Değerleri logla
        console.log('Video Katmanı Parametreleri:', {
            position: state.position,
            size: state.size,
            mainResolution: state.mainResolution,
            sizePercent: state.sizePercent
        });

        try {
            const result = await window.api.addVideoLayer({
                mainVideoPath: App.currentFilePath,
                layerVideoPath: state.layerVideoPath,
                outputPath: outputPath,
                position: state.position,
                size: state.size,
                startTime: startTime,
                endTime: endTime,
                layerVolume: state.layerMuted ? 0 : state.layerVolume,
                mainVolume: state.mainVolume,
                muteLayer: state.layerMuted,
                keepAspect: state.keepAspect,
                syncOffset: state.syncOffset || 0,  // Senkronizasyon offset'i (ms)
                cutRegions: state.cutRegions || []  // Kesilecek bölgeler
            });

            App.hideProgress();

            if (result.success) {
                // Yeni videoyu yükle
                await VideoPlayer.loadVideo(result.outputPath);
                App.currentFilePath = result.outputPath;
                App.hasChanges = false; // Zaten kaydedildi

                const modeNames = {
                    'sign-language': this.t('runtime.video_layer.summary_mode_sign_language', 'Sign Language'),
                    'split-screen': this.t('runtime.video_layer.summary_mode_split_screen', 'Split Screen'),
                    'camera-corner': this.t('runtime.video_layer.summary_mode_camera_corner', 'Camera Corner'),
                    'custom': this.t('runtime.video_layer.summary_mode_custom', 'Custom Layout')
                };

                const filename = outputPath.split(/[/\\]/).pop();
                Accessibility.announce(this.t('runtime.video_layer.saved_success', '{mode} video layer was added and saved as {filename}.', {
                    mode: modeNames[state.mode],
                    filename
                }));
            } else {
                Accessibility.announceError(this.t('runtime.video_layer.save_failed', 'An error occurred while adding the video layer: {error}', {
                    error: result.error
                }));
            }
        } catch (error) {
            App.hideProgress();
            console.error('Video katmanı ekleme hatası:', error);
            Accessibility.announceError(this.t('runtime.video_layer.save_failed_generic', 'An error occurred while adding the video layer.'));
        }

        if (window.Keyboard) window.Keyboard.setEnabled(true);
    }

    ,
    /**
     * İşaretçi listesine odaklan (Diyalog gibi davranır)
     */
    showMarkerListDialog() {
        const markerList = document.getElementById('marker-list');
        if (markerList) {
            markerList.focus();
            if (typeof Markers !== 'undefined') {
                Accessibility.announce(`İşaretçi listesi odaklandı. ${Markers.getCount()} işaretçi mevcut. Listede gezinmek için ok tuşlarını kullanın.`);
            }
        }
    }

    ,

    /**
     * Ses Kaynağı Seçimi (Dosya veya Mikrofon)
     */
    async showAudioSourceSelectionDialog() {
        const result = await window.api.showMessageBox({
            type: 'question',
            title: 'Ses Ekleme Yöntemi',
            message: 'Mevcut bir ses dosyası mı seçmek istersiniz, yoksa yeni bir kayıt mı yapmak istersiniz?',
            buttons: ['Ses Dosyası Seç', 'Yeni Kayıt Yap', 'İptal'],
            defaultId: 0,
            cancelId: 2
        });

        if (result.response === 0) {
            // Dosya Seç - dosya seçiciyi aç
            const fileResult = await window.api.openFileDialog({
                title: 'Ses Dosyası Seç',
                filters: [
                    { name: 'Ses Dosyaları', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma'] },
                    { name: 'Tüm Dosyalar', extensions: ['*'] }
                ],
                properties: ['openFile']
            });

            if (fileResult && !fileResult.canceled && fileResult.filePaths && fileResult.filePaths.length > 0) {
                await this.showAudioAddDialog(fileResult.filePaths[0]);
            }
        } else if (result.response === 1) {
            // Kayıt Yap
            if (typeof AudioRecorder !== 'undefined') {
                AudioRecorder.showDialog();
            } else {
                Accessibility.alert('Ses kayıt modülü yüklenemedi.');
            }
        }
    },

    /**
     * Ses kayıt diyaloğunu göster
     */
    showAudioRecorderDialog() {
        if (typeof AudioRecorder !== 'undefined') {
            AudioRecorder.showDialog();
        } else {
            Accessibility.alert('Ses kayıt modülü yüklenemedi.');
        }
    }
};

// Global olarak erişilebilir yap
window.Dialogs = Dialogs;

