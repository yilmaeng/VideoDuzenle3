/**
 * Slideshow Proje Handler
 * Slideshow (Resim + Ses) projesi için IPC handler'ları
 */

const { ipcMain, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const sharp = require('sharp');
const i18n = require('./i18n');

let newProjectWindow = null;
let slideshowEditorWindow = null;
let currentProjectSettings = null;
let storedMainWindow = null; // Ana pencere referansını sakla

function t(key, fallback, params) {
    const value = i18n.t(key, params);
    return value.startsWith('[') ? fallback : value;
}

async function announceDialogForAccessibility(targetWindow, options = {}) {
    if (!targetWindow || targetWindow.isDestroyed() || !targetWindow.webContents) {
        return;
    }

    const payload = {
        title: String(options.title || '').trim(),
        message: String(options.message || '').trim(),
        detail: String(options.detail || '').trim()
    };

    if (!payload.title && !payload.message && !payload.detail) {
        return;
    }

    try {
        targetWindow.webContents.send('accessibility-dialog-announce', payload);
        await new Promise((resolve) => setTimeout(resolve, 90));
    } catch (error) {
        console.warn('Slideshow dialog accessibility announcement failed:', error.message);
    }
}

async function getImageInfo(imagePath) {
    const metadata = await sharp(imagePath).metadata();
    const orientation = Number(metadata.orientation || 1);
    const rawWidth = Number(metadata.width || 1920);
    const rawHeight = Number(metadata.height || 1080);
    const rotatesDimensions = [5, 6, 7, 8].includes(orientation);

    return {
        width: rotatesDimensions ? rawHeight : rawWidth,
        height: rotatesDimensions ? rawWidth : rawHeight,
        orientation
    };
}

async function prepareSlideshowImages(images) {
    const preparedImages = [];
    const cleanupPaths = [];

    for (const image of images) {
        try {
            const info = await getImageInfo(image.path);
            const manualRotation = ((Number(image.rotation || 0) % 360) + 360) % 360;
            const needsNormalization = info.orientation !== 1 || manualRotation !== 0;

            if (!needsNormalization) {
                preparedImages.push({
                    ...image,
                    width: info.width,
                    height: info.height
                });
                continue;
            }

            const ext = path.extname(image.path) || '.jpg';
            const normalizedPath = path.join(os.tmpdir(), `slideshow_norm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}${ext}`);

            let pipeline = sharp(image.path).rotate();
            if (manualRotation !== 0) {
                pipeline = pipeline.rotate(manualRotation);
            }
            await pipeline.toFile(normalizedPath);

            const normalizedInfo = await getImageInfo(normalizedPath);

            cleanupPaths.push(normalizedPath);
            preparedImages.push({
                ...image,
                path: normalizedPath,
                width: normalizedInfo.width,
                height: normalizedInfo.height
            });
        } catch (error) {
            console.warn('[Slideshow] Image normalization skipped:', image.path, error.message);
            preparedImages.push(image);
        }
    }

    return {
        images: preparedImages,
        cleanup: () => {
            cleanupPaths.forEach(filePath => {
                try {
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                } catch (cleanupError) {
                    console.warn('[Slideshow] Normalized temp cleanup failed:', cleanupError.message);
                }
            });
        }
    };
}

async function prepareImageForAnalysis(imageInput) {
    const image = typeof imageInput === 'string'
        ? { path: imageInput, rotation: 0 }
        : imageInput;

    if (!image?.path) {
        throw new Error('Image path is required for analysis.');
    }

    const prepared = await prepareSlideshowImages([image]);
    const preparedImage = prepared.images[0];

    if (!preparedImage?.path) {
        prepared.cleanup();
        throw new Error('Prepared image could not be created for analysis.');
    }

    return {
        image: preparedImage,
        cleanup: prepared.cleanup
    };
}

/**
 * Slideshow handler'larını kur
 */
function setupSlideshowHandlers(mainWindow) {
    // Belirli resimlere yazı ekleme diyaloğu
    ipcMain.on('slideshow-add-text-to-image', async (event, data) => {
        console.log('slideshow-add-text-to-image alındı:', data);
        if (slideshowEditorWindow) {
            slideshowEditorWindow.webContents.send('request-image-list');

            ipcMain.once('image-list-response', (evt, imageList) => {
                openTextOverlayForSlideshow(storedMainWindow, {
                    images: imageList || [],
                    imageIds: data.imageIds || []
                });
            });
        }
    });

    storedMainWindow = mainWindow; // Ana pencereyi sakla

    // Yeni proje diyaloğunu aç
    ipcMain.on('slideshow-new-project', () => {
        openNewProjectDialog(storedMainWindow);
    });

    // Yeni proje oluştur
    ipcMain.on('slideshow-project-create', (event, settings) => {
        console.log('slideshow-project-create alındı:', settings);
        currentProjectSettings = settings;

        // Yeni proje diyaloğunu kapat
        if (newProjectWindow) {
            newProjectWindow.close();
            newProjectWindow = null;
        }

        // Slideshow düzenleyiciyi aç
        openSlideshowEditor(storedMainWindow, settings);
    });

    // Yeni proje iptal
    ipcMain.on('slideshow-project-cancel', () => {
        if (newProjectWindow) {
            newProjectWindow.close();
            newProjectWindow = null;
        }
    });

    // Slideshow'u kapat
    ipcMain.on('slideshow-close', () => {
        if (slideshowEditorWindow) {
            slideshowEditorWindow.close();
            slideshowEditorWindow = null;
        }
    });

    // Resim ekleme diyaloğu
    ipcMain.on('slideshow-add-images', async () => {
        const result = await dialog.showOpenDialog(slideshowEditorWindow, {
            title: t('dialog.slideshow_editor.select_images_title', 'Select Image Files'),
            filters: [
                { name: t('dialog.slideshow_editor.image_files_filter', 'Image Files'), extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] }
            ],
            properties: ['openFile', 'multiSelections']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            slideshowEditorWindow.webContents.send('slideshow-images-selected', result.filePaths);
        }
    });

    // Ses ekleme diyaloğu
    ipcMain.on('slideshow-add-audio', async () => {
        const result = await dialog.showOpenDialog(slideshowEditorWindow, {
            title: t('dialog.slideshow_editor.select_audio_title', 'Select Audio File'),
            filters: [
                { name: t('dialog.slideshow_editor.audio_files_filter', 'Audio Files'), extensions: ['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a', 'wma'] }
            ],
            properties: ['openFile', 'multiSelections']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            slideshowEditorWindow.webContents.send('slideshow-audio-selected', result.filePaths);
        }
    });

    // Yazı ekleme diyaloğu aç - resim listesini slideshow editorden iste
    ipcMain.on('slideshow-add-text', async (event, data) => {
        console.log('slideshow-add-text alındı');

        // Eğer data.images gelmediyse, slideshow editordan isteyelim
        if (!data || !data.images || data.images.length === 0) {
            console.log('Resim listesi boş, slideshow editorden isteniyor...');

            if (slideshowEditorWindow) {
                // Slideshow editordan resim listesini iste
                slideshowEditorWindow.webContents.send('request-image-list');

                // Yanıtı bekle
                ipcMain.once('image-list-response', (evt, imageList) => {
                    console.log('Resim listesi alındı:', imageList ? imageList.length : 0);
                    openTextOverlayForSlideshow(storedMainWindow, { images: imageList || [] });
                });
            } else {
                openTextOverlayForSlideshow(storedMainWindow, { images: [] });
            }
        } else {
            openTextOverlayForSlideshow(storedMainWindow, data);
        }
    });

    // Yazı ekleme diyaloğundan gelen sonuç
    ipcMain.on('slideshow-text-added', (event, textData) => {
        if (slideshowEditorWindow) {
            slideshowEditorWindow.webContents.send('slideshow-text-result', textData);
        }
    });

    // Yazı düzenleme diyaloğu aç 
    ipcMain.on('slideshow-edit-text', async (event, data) => {
        console.log('slideshow-edit-text alındı:', JSON.stringify(data, null, 2));

        // Eğer resim listesi yoksa veya boşsa, slideshow editorden isteyelim
        if (!data.images || data.images.length === 0) {
            console.log('Resim listesi boş, slideshow editor\'dan isteniyor...');
            if (slideshowEditorWindow) {
                slideshowEditorWindow.webContents.send('request-image-list');

                ipcMain.once('image-list-response', (evt, imageList) => {
                    console.log('Resim listesi alındı:', imageList ? imageList.length : 0);
                    data.images = imageList || [];
                    openTextOverlayForSlideshow(storedMainWindow, data);
                });
            } else {
                console.log('slideshowEditorWindow yok, direkt açılıyor');
                openTextOverlayForSlideshow(storedMainWindow, data);
            }
        } else {
            console.log('Resim listesi mevcut, pencere açılıyor. Resim sayısı:', data.images.length);
            openTextOverlayForSlideshow(storedMainWindow, data);
        }
    });

    // Yazı güncelleme
    ipcMain.on('slideshow-text-updated', (event, { editIndex, textData }) => {
        if (slideshowEditorWindow) {
            slideshowEditorWindow.webContents.send('slideshow-text-update-result', { editIndex, textData });
        }
    });

    ipcMain.on('slideshow-preview', (event, { projectData, options }) => {
        const previewWindow = new BrowserWindow({
            width: 1000,
            height: 700,
            parent: slideshowEditorWindow,
            modal: true,
            backgroundColor: '#000000',
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });
        previewWindow.setMenu(null);
        previewWindow.loadFile(path.join(__dirname, '../renderer/dialogs/slideshow-preview.html'));
        previewWindow.once('ready-to-show', () => {
            previewWindow.webContents.send('preview-init', { projectData, options });
            previewWindow.show();
        });
    });

    // Resim bilgisi al
    ipcMain.handle('get-image-info', async (event, imagePath) => {
        try {
            const info = await getImageInfo(imagePath);
            return {
                width: info.width,
                height: info.height,
                orientation: info.orientation
            };
        } catch (error) {
            console.warn('[Slideshow] get-image-info fallback used:', error.message);
            return { width: 1920, height: 1080, orientation: 1 };
        }
    });

    // Ses bilgisi al
    ipcMain.handle('get-audio-info', async (event, audioPath) => {
        return new Promise((resolve, reject) => {
            const { exec } = require('child_process');
            let ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
            // Portable/asar için yol düzeltmesi
            if (ffmpegPath.includes('app.asar')) {
                ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
            }

            exec(`"${ffmpegPath}" -i "${audioPath}" 2>&1`, (error, stdout, stderr) => {
                const output = stdout + stderr;

                // Süre bilgisini al
                const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
                if (durationMatch) {
                    const hours = parseInt(durationMatch[1]);
                    const minutes = parseInt(durationMatch[2]);
                    const seconds = parseInt(durationMatch[3]);
                    const ms = parseInt(durationMatch[4]) / 100;
                    const totalSeconds = hours * 3600 + minutes * 60 + seconds + ms;
                    resolve({ duration: totalSeconds });
                } else {
                    resolve({ duration: 0 });
                }
            });
        });
    });

    // Resmi base64'e çevir (AI için)
    ipcMain.handle('get-image-base64', async (event, imagePath) => {
        try {
            const imageBuffer = fs.readFileSync(imagePath);
            return imageBuffer.toString('base64');
        } catch (error) {
            console.error('Image read error:', error);
            throw new Error(t('runtime.slideshow_editor.image_read_error', 'Image could not be read: {error}', {
                error: error.message
            }));
        }
    });

    // Input diyaloğu
    ipcMain.handle('show-input-dialog', async (event, options) => {
        // Basit bir prompt için küçük bir pencere oluşturabiliriz
        // Şimdilik dialog.showMessageBox kullanıyoruz
        const dialogOptions = {
            type: 'question',
            title: options.title,
            message: options.message,
            buttons: [t('dialog.common.ok', 'OK'), t('dialog.cancel', 'Cancel')],
            defaultId: 0,
            cancelId: 1
        };
        await announceDialogForAccessibility(slideshowEditorWindow, dialogOptions);
        const { response } = await dialog.showMessageBox(slideshowEditorWindow, dialogOptions);

        if (response === 0) {
            return options.defaultValue; // Şimdilik varsayılan değeri döndür
        }
        return null;
    });

    // Mesaj diyaloğu
    ipcMain.handle('show-message-dialog', async (event, options) => {
        const dialogOptions = {
            type: 'info',
            title: options.title,
            message: options.message,
            buttons: [t('dialog.common.ok', 'OK')]
        };
        await announceDialogForAccessibility(slideshowEditorWindow, dialogOptions);
        await dialog.showMessageBox(slideshowEditorWindow, dialogOptions);
    });

    // AI ile resim betimleme
    ipcMain.handle('describe-image-ai', async (event, imageInput) => {
        const geminiHandler = require('./gemini-handler');
        const apiKey = geminiHandler.getApiKey();

        if (!apiKey) {
            throw new Error(t('runtime.slideshow_editor.api_key_missing', 'API key was not found. Please enter the API key in AI settings first.'));
        }

        const preparedAnalysis = await prepareImageForAnalysis(imageInput);

        // Gemini'ye istek gönder
        const langMap = { tr: 'Turkish', en: 'English', de: 'German', es: 'Spanish', fr: 'French' };
        const currentLang = i18n.getCurrentLanguage ? i18n.getCurrentLanguage() : 'tr';
        const aiLang = langMap[currentLang] || 'English';
        const prompt = `Describe this image in two ways and assess whether the photo orientation looks correct. Respond only in ${aiLang}.
1. SHORT (maximum 100 characters): a very brief summary of the image
2. DETAILED: a detailed description of the image
3. ORIENTATION: choose exactly one of these values:
- CORRECT
- ROTATE_LEFT
- ROTATE_RIGHT
- UNCERTAIN
4. ORIENTATION_NOTE: one short sentence for the user. If the orientation looks correct, clearly say there is no orientation problem. If the photo looks sideways, say whether they should rotate left or right. If unsure, say you are not sure.

Important orientation rule:
- ROTATE_LEFT means the app should rotate the image 90 degrees counterclockwise on screen.
- ROTATE_RIGHT means the app should rotate the image 90 degrees clockwise on screen.
- Choose the direction that makes people and objects appear upright in the final result.
- If a person would become upside down after that rotation, then that direction is wrong.
- Be conservative. If you are not confident, return UNCERTAIN instead of guessing.

Return your answer in exactly this format:
SHORT: [short description]
DETAILED: [detailed description]
ORIENTATION: [CORRECT/ROTATE_LEFT/ROTATE_RIGHT/UNCERTAIN]
ORIENTATION_NOTE: [short user-facing note]`;

        const https = require('https');

        return new Promise((resolve, reject) => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

            let requestBody = null;
            try {
                const imageBuffer = fs.readFileSync(preparedAnalysis.image.path);
                const base64 = imageBuffer.toString('base64');
                requestBody = JSON.stringify({
                    contents: [{
                        role: 'user',
                        parts: [
                            {
                                inline_data: {
                                    mime_type: 'image/jpeg',
                                    data: base64
                                }
                            },
                            { text: prompt }
                        ]
                    }],
                    systemInstruction: {
                        parts: [{ text: `Reply only in ${aiLang}.` }]
                    },
                    generationConfig: {
                        temperature: 0.2,
                        maxOutputTokens: 4096  // Detaylı betimleme için artırıldı
                    }
                });
            } catch (error) {
                preparedAnalysis.cleanup();
                reject(error);
                return;
            }

            const urlObj = new URL(url);
            const options = {
                hostname: urlObj.hostname,
                path: urlObj.pathname + urlObj.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody)
                }
            };

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);

                        if (response.error) {
                            reject(new Error(response.error.message));
                            return;
                        }

                        if (response.candidates && response.candidates[0] &&
                            response.candidates[0].content &&
                            response.candidates[0].content.parts) {
                            const text = response.candidates[0].content.parts
                                .map(p => p.text)
                                .join('');

                            // Kısa, detaylı ve yön tavsiyesini ayır
                            const shortMatch = text.match(/(?:SHORT|KISA):\s*(.+?)(?=(?:DETAILED|DETAYLI):|$)/is);
                            const longMatch = text.match(/(?:DETAILED|DETAYLI):\s*(.+?)(?=(?:ORIENTATION|YON|YÖN):|(?:ORIENTATION_NOTE|YON_NOTU|YÖN_NOTU):|$)/is);
                            const orientationMatch = text.match(/(?:ORIENTATION|YON|YÖN):\s*(CORRECT|ROTATE_LEFT|ROTATE_RIGHT|UNCERTAIN)/i);
                            const orientationNoteMatch = text.match(/(?:ORIENTATION_NOTE|YON_NOTU|YÖN_NOTU):\s*(.+)/is);
                            const orientationStatus = orientationMatch ? orientationMatch[1].toUpperCase() : 'UNCERTAIN';

                            let orientationMessage = orientationNoteMatch ? orientationNoteMatch[1].trim() : '';
                            if (!orientationMessage) {
                                const orientationMessageMap = {
                                    CORRECT: t('runtime.slideshow_editor.orientation_ai_correct', 'The photo direction looks correct. There does not appear to be an orientation problem.'),
                                    ROTATE_LEFT: t('runtime.slideshow_editor.orientation_ai_rotate_left', 'The photo looks sideways. Try rotating it left.'),
                                    ROTATE_RIGHT: t('runtime.slideshow_editor.orientation_ai_rotate_right', 'The photo looks sideways. Try rotating it right.'),
                                    UNCERTAIN: t('runtime.slideshow_editor.orientation_ai_uncertain', 'The photo direction is unclear. Please check it visually.')
                                };
                                orientationMessage = orientationMessageMap[orientationStatus] || orientationMessageMap.UNCERTAIN;
                            }

                            resolve({
                                short: shortMatch ? shortMatch[1].trim().substring(0, 100) : t('runtime.slideshow_editor.description_unavailable', 'Description unavailable'),
                                long: longMatch ? longMatch[1].trim() : text,
                                orientationStatus,
                                orientationMessage
                            });
                        } else {
                            reject(new Error(t('runtime.slideshow_editor.invalid_api_response', 'Invalid API response.')));
                        }
                    } catch (error) {
                        reject(new Error(t('runtime.slideshow_editor.api_response_parse_error', 'API response could not be processed: {error}', {
                            error: error.message
                        })));
                    } finally {
                        preparedAnalysis.cleanup();
                    }
                });
            });

            req.on('error', (error) => {
                preparedAnalysis.cleanup();
                reject(new Error(t('runtime.slideshow_editor.connection_error', 'Connection error: {error}', {
                    error: error.message
                })));
            });

            req.write(requestBody);
            req.end();
        });
    });

    // Slideshow video oluştur
    ipcMain.on('slideshow-export', async (event, projectData) => {
        // Proje klasörü (eğer proje kaydedildiyse)
        const projectDir = projectData.projectPath ? path.dirname(projectData.projectPath) : null;

        // Dosya yolunu düzelt - orijinal yol yoksa proje klasöründe ara
        function resolveFilePath(originalPath, filename) {
            // Önce orijinal yolu dene
            if (fs.existsSync(originalPath)) {
                return originalPath;
            }

            // Proje klasöründe ara
            if (projectDir) {
                const filenameOnly = filename || path.basename(originalPath);
                const projectFolderPath = path.join(projectDir, filenameOnly);
                if (fs.existsSync(projectFolderPath)) {
                    console.log(`Dosya proje klasöründe bulundu: ${projectFolderPath}`);
                    return projectFolderPath;
                }
            }

            // Bulunamadı
            return null;
        }

        // Dosyaları kontrol et ve yolları düzelt
        const missingFiles = [];
        let filesUpdated = false;

        // Resimleri kontrol et
        for (const img of projectData.images) {
            const resolvedPath = resolveFilePath(img.path, img.filename);
            if (resolvedPath) {
                if (resolvedPath !== img.path) {
                    img.path = resolvedPath;
                    filesUpdated = true;
                }
            } else {
                missingFiles.push(`Resim: ${img.filename || img.path}`);
            }
        }

        // Sesleri kontrol et
        for (const audio of projectData.audioTracks) {
            const resolvedPath = resolveFilePath(audio.path, audio.filename);
            if (resolvedPath) {
                if (resolvedPath !== audio.path) {
                    audio.path = resolvedPath;
                    filesUpdated = true;
                }
            } else {
                missingFiles.push(`Ses: ${audio.filename || audio.path}`);
            }
        }

        // Dosya yolları güncellendiyse bilgilendir
        if (filesUpdated && missingFiles.length === 0) {
            console.log('Bazı dosya yolları proje klasöründen çözümlendi');
        }

        // Eksik dosya varsa kullanıcıyı bilgilendir
        if (missingFiles.length > 0) {
            const missingList = missingFiles.slice(0, 5).join('\n');
            const moreCount = missingFiles.length > 5 ? `\n...ve ${missingFiles.length - 5} dosya daha` : '';

            const dialogOptions = {
                type: 'error',
                title: t('dialog.slideshow_editor.missing_files_title', 'Missing Files'),
                message: t('dialog.slideshow_editor.missing_files_message', 'The following files could not be found:\n\n{files}{more}\n\nCopy the files into the project folder (next to the .eng file) and try again.', {
                    files: missingList,
                    more: moreCount
                }),
                buttons: [t('dialog.common.ok', 'OK')]
            };
            announceDialogForAccessibility(slideshowEditorWindow, dialogOptions).then(() => {
                dialog.showMessageBox(slideshowEditorWindow, dialogOptions);
            });
            return;
        }

        const result = await dialog.showSaveDialog(slideshowEditorWindow, {
            title: t('dialog.slideshow_editor.save_video_title', 'Save Slideshow Video'),
            filters: [
                { name: 'MP4 Video', extensions: ['mp4'] }
            ]
        });

        if (!result.canceled) {
            // İlerleme bildirimini başlat
            if (slideshowEditorWindow) {
                slideshowEditorWindow.webContents.send('export-progress', {
                    status: 'started',
                    message: t('runtime.slideshow_editor.export_started', 'Creating video... This may take a few minutes.')
                });
            }

            try {
                const startTime = Date.now();
                // ** DEĞİŞİKLİK **
                // 30'dan fazla resim varsa Batch Modunu kullan, yoksa Single Pass kullan
                const MAX_SINGLE_PASS_IMAGES = 30;

                if (projectData.images.length > MAX_SINGLE_PASS_IMAGES) {
                    console.log(`Büyük proje tespit edildi (${projectData.images.length} resim). Batch işleme moduna geçiliyor.`);
                    await createSlideshowVideoBatched(projectData, result.filePath, slideshowEditorWindow);
                } else {
                    console.log('Küçük proje, tek seferde işleniyor.');
                    await createSlideshowVideo(projectData, result.filePath, slideshowEditorWindow);
                }

                const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);

                // İlerleme bildirimini kapat
                if (slideshowEditorWindow) {
                    slideshowEditorWindow.webContents.send('export-progress', {
                        status: 'completed',
                        message: t('runtime.slideshow_editor.export_completed', 'Video created ({seconds} seconds)', {
                            seconds: elapsedSeconds
                        })
                    });
                    slideshowEditorWindow.webContents.send('slideshow-export-result', {
                        message: t('runtime.slideshow_editor.export_result_announce', 'The slideshow video was created successfully. Duration: {seconds} seconds.', {
                            seconds: elapsedSeconds
                        })
                    });
                }

                // Let the renderer announce the result before the native dialog steals focus.
                await new Promise((resolve) => setTimeout(resolve, 900));

                const dialogOptions = {
                    type: 'info',
                    title: t('dialog.slideshow_editor.success_title', 'Success'),
                    message: t('dialog.slideshow_editor.video_created_message', 'The slideshow video was created successfully.\n\nDuration: {seconds} seconds', {
                        seconds: elapsedSeconds
                    }),
                    buttons: [t('dialog.common.ok', 'OK')]
                };
                announceDialogForAccessibility(slideshowEditorWindow, dialogOptions).then(() => {
                    dialog.showMessageBox(slideshowEditorWindow, dialogOptions);
                });
            } catch (error) {
                // İlerleme bildirimini kapat (hata ile)
                if (slideshowEditorWindow) {
                    slideshowEditorWindow.webContents.send('export-progress', {
                        status: 'error',
                        message: t('runtime.slideshow_editor.export_error_status', 'Video creation error')
                    });
                }
                const errorMsg = error.message.length > 500 ? error.message.substring(0, 500) + '...' : error.message;
                dialog.showErrorBox(t('messages.error_title', 'Error'), t('runtime.slideshow_editor.video_create_error', 'An error occurred while creating the video: {error}', {
                    error: errorMsg
                }));
            }
        }
    });

    // Proje kaydet
    ipcMain.on('slideshow-save-project', async (event, projectData) => {
        let filePath = projectData.projectPath;

        // Eğer proje daha önce kaydedilmişse (projectPath var), direkt üzerine kaydet
        if (filePath && fs.existsSync(filePath)) {
            try {
                const projectJSON = JSON.stringify(projectData, null, 2);
                fs.writeFileSync(filePath, projectJSON, 'utf8');
                slideshowEditorWindow.webContents.send('slideshow-project-saved', filePath);
                console.log('Project saved:', filePath);
            } catch (error) {
                dialog.showErrorBox(t('messages.error_title', 'Error'), t('runtime.slideshow_editor.project_save_error', 'An error occurred while saving the project: {error}', {
                    error: error.message
                }));
            }
        } else {
            // Yeni proje - dosya seçtir
            const result = await dialog.showSaveDialog(slideshowEditorWindow, {
                title: t('dialog.slideshow_editor.save_project_title', 'Save Project'),
                filters: [
                    { name: t('dialog.slideshow_editor.project_file_filter', 'Barrier-Free Video Project'), extensions: ['eng'] }
                ]
            });

            if (!result.canceled) {
                try {
                    // projectPath'i güncelle
                    projectData.projectPath = result.filePath;
                    const projectJSON = JSON.stringify(projectData, null, 2);
                    fs.writeFileSync(result.filePath, projectJSON, 'utf8');
                    slideshowEditorWindow.webContents.send('slideshow-project-saved', result.filePath);
                    console.log('New project saved:', result.filePath);
                } catch (error) {
                    dialog.showErrorBox(t('messages.error_title', 'Error'), t('runtime.slideshow_editor.project_save_error', 'An error occurred while saving the project: {error}', {
                        error: error.message
                    }));
                }
            }
        }
    });
}

let textOverlayWindow = null;

/**
 * Slideshow için yazı ekleme diyaloğunu aç
 */
function openTextOverlayForSlideshow(mainWindow, data = {}) {
    console.log('openTextOverlayForSlideshow çağrıldı, data:', JSON.stringify(data, null, 2));

    // Eğer pencere zaten varsa kapat ve yeniden aç
    // (Düzenleme modu için farklı veri göndermemiz gerekiyor)
    if (textOverlayWindow && !textOverlayWindow.isDestroyed()) {
        console.log('Mevcut pencere kapatılıyor...');
        textOverlayWindow.destroy(); // close() yerine destroy() kullan - daha güvenilir
        textOverlayWindow = null;
    }

    const parentWindow = slideshowEditorWindow || mainWindow;
    console.log('Parent pencere:', parentWindow ? 'var' : 'yok');

    textOverlayWindow = new BrowserWindow({
        width: 550,
        height: 700,
        parent: parentWindow,
        modal: true, // Modal yap - öne çıkmasını sağlar
        show: false,
        resizable: true,
        minimizable: false,
        maximizable: false,
        title: data.editText
            ? t('dialog.slideshow_editor.text_edit_window_title', 'Edit Text - Slideshow')
            : t('dialog.slideshow_editor.text_add_window_title', 'Add Text - Slideshow'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    textOverlayWindow.setMenu(null);
    textOverlayWindow.loadFile(path.join(__dirname, '../renderer/dialogs/slideshow-text-overlay.html'));

    // Pencere hazır olduğunda göster
    textOverlayWindow.once('ready-to-show', () => {
        console.log('Yazı penceresi ready-to-show');

        // Windows'ta pencereyi kesinlikle öne getirmek için
        textOverlayWindow.setAlwaysOnTop(true);
        textOverlayWindow.show();
        textOverlayWindow.focus();
        textOverlayWindow.moveTop();

        // Kısa bir gecikme sonra alwaysOnTop'u kapat ama odağı koru
        setTimeout(() => {
            if (textOverlayWindow && !textOverlayWindow.isDestroyed()) {
                textOverlayWindow.setAlwaysOnTop(false);
                textOverlayWindow.focus();
            }
        }, 200);
    });

    // Sayfa yüklendikten sonra verileri gönder
    textOverlayWindow.webContents.on('did-finish-load', () => {
        console.log('Yazı diyaloğu yüklendi, veri gönderiliyor:', data);
        textOverlayWindow.webContents.send('slideshow-text-init', data);

        // Ekran okuyucu için pencere içindeki ilk input'a odaklan
        setTimeout(() => {
            if (textOverlayWindow && !textOverlayWindow.isDestroyed()) {
                textOverlayWindow.webContents.executeJavaScript(`
                    const textInput = document.getElementById('text-content');
                    if (textInput) {
                        textInput.focus();
                        // Ekran okuyucu duyurusu
                        const liveRegion = document.getElementById('live-region');
                        if (liveRegion) {
                            liveRegion.textContent = 'Yazı düzenleme penceresi açıldı. Yazı içeriği alanındasınız.';
                        }
                    }
                `);
            }
        }, 300);
    });

    textOverlayWindow.on('closed', () => {
        console.log('Yazı penceresi kapatıldı');
        textOverlayWindow = null;
    });
}

/**
 * Yeni proje diyaloğunu aç
 */
function openNewProjectDialog(mainWindow) {
    if (newProjectWindow) {
        newProjectWindow.focus();
        return;
    }

    newProjectWindow = new BrowserWindow({
        width: 500,
        height: 550,
        parent: mainWindow,
        modal: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        show: false,  // Başlangıçta gizli
        title: t('dialog.new_project.window_title', 'Create New Project'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    newProjectWindow.setMenu(null);
    newProjectWindow.loadFile(path.join(__dirname, '../renderer/dialogs/new-project.html'));

    // Pencere hazır olduğunda göster
    newProjectWindow.once('ready-to-show', () => {
        newProjectWindow.show();
        newProjectWindow.focus();
    });

    newProjectWindow.on('closed', () => {
        newProjectWindow = null;
    });
}

/**
 * Slideshow düzenleyiciyi aç
 */
function openSlideshowEditor(mainWindow, settings) {
    console.log('openSlideshowEditor çağrıldı, settings:', settings);

    if (slideshowEditorWindow) {
        slideshowEditorWindow.focus();
        return;
    }

    console.log('Slideshow düzenleyici penceresi oluşturuluyor...');

    slideshowEditorWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        parent: mainWindow,
        title: t('dialog.slideshow_editor.window_title', 'Slideshow Editor'),
        show: false,  // Başlangıçta gizli, yüklendikten sonra göster
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    slideshowEditorWindow.setMenu(null);
    slideshowEditorWindow.loadFile(path.join(__dirname, '../renderer/dialogs/slideshow-editor.html'));

    // Pencere hazır olduğunda göster ve öne getir
    slideshowEditorWindow.once('ready-to-show', () => {
        slideshowEditorWindow.show();
        slideshowEditorWindow.focus();
    });

    slideshowEditorWindow.webContents.on('did-finish-load', () => {
        console.log('Slideshow düzenleyici yüklendi, init gönderiliyor');
        slideshowEditorWindow.webContents.send('slideshow-init', settings);
    });

    slideshowEditorWindow.on('closed', () => {
        slideshowEditorWindow = null;
    });
}

/**
 * FFmpeg yolunu bul ve hazırla
 */
function getFFmpegPath() {
    let ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    // Portable/asar için yol düzeltmesi
    if (ffmpegPath.includes('app.asar')) {
        ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
    }
    return ffmpegPath;
}

/**
 * Tek bir komutla video oluştur (Orijinal Fonksiyon)
 * Küçük projeler için ideal (<30 resim).
 * Eşlenmiş ses modunu destekler (resim-ses eşleştirmesi).
 */
async function createSlideshowVideo(projectData, outputPath, parentWindow) {
    const ffmpegPath = getFFmpegPath();

    if (!fs.existsSync(ffmpegPath)) {
        throw new Error(`FFmpeg bulunamadı: ${ffmpegPath}`);
    }

    const prepared = await prepareSlideshowImages(projectData.images);
    const slideshowImages = prepared.images;

    return new Promise((resolve, reject) => {
        const [width, height] = projectData.aspectRatio === '16:9' ? [1920, 1080] : [1080, 1920];
        const resolution = `${width}:${height}`;

        let currentTime = 0;
        const imageTimings = slideshowImages.map(img => {
            const timing = { id: img.id, start: currentTime, end: currentTime + img.duration };
            currentTime += img.duration;
            return timing;
        });

        const tempFilterFiles = []; // Temizlenecek geçici dosyalar
        let cmd = `"${ffmpegPath}" -y `;

        // Inputları ekle
        slideshowImages.forEach(img => {
            cmd += `-loop 1 -t ${img.duration.toFixed(3)} -i "${img.path}" `;
        });

        const imageCount = slideshowImages.length;
        const audioTracks = projectData.audioTracks || [];
        const hasAudio = audioTracks.length > 0;

        // Eşlenmiş ses modu kontrolü
        const hasPairedAudio = slideshowImages.some(img => img.pairedAudioId);

        if (hasPairedAudio) {
            // === EŞLENMIŞ SES MODU ===
            // Her benzersiz eşlenmiş ses dosyasını input olarak ekle
            const uniquePairedAudioIds = [...new Set(
                slideshowImages
                    .filter(img => img.pairedAudioId)
                    .map(img => img.pairedAudioId)
            )];

            const audioInputMap = {}; // audioId -> inputIndex
            uniquePairedAudioIds.forEach(audioId => {
                const audio = audioTracks.find(a => a.id === audioId);
                if (audio && fs.existsSync(audio.path)) {
                    const inputIdx = imageCount + Object.keys(audioInputMap).length;
                    audioInputMap[audioId] = inputIdx;
                    cmd += `-i "${audio.path}" `;
                }
            });

            // Eşlenmemiş global sesleri de ekle
            const pairedAudioIds = new Set(uniquePairedAudioIds);
            const globalAudioTracks = audioTracks.filter(a => !pairedAudioIds.has(a.id));
            const globalAudioInputStart = imageCount + Object.keys(audioInputMap).length;
            globalAudioTracks.forEach(track => {
                cmd += `-i "${track.path}" `;
            });

            // Video filter complex
            const scaleFilter = projectData.fillFrame
                ? `scale=${resolution}:force_original_aspect_ratio=increase,crop=${resolution},setsar=1`
                : `scale=${resolution}:force_original_aspect_ratio=decrease,pad=${resolution}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;

            let filterComplex = '';
            slideshowImages.forEach((img, i) => {
                filterComplex += `[${i}:v]${scaleFilter}[v${i}]; `;
            });

            slideshowImages.forEach((img, i) => {
                filterComplex += `[v${i}]`;
            });
            filterComplex += `concat=n=${slideshowImages.length}:v=1:a=0[vcoll]; `;

            let lastOutput = 'vcoll';

            // Text Overlays
            if (projectData.textOverlays && projectData.textOverlays.length > 0) {
                projectData.textOverlays.forEach((overlay, index) => {
                    overlay.targetImages.forEach((imgId, targetIdx) => {
                        const timing = imageTimings.find(t => t.id === imgId);
                        if (!timing) return;

                        const fontFile = 'C\\\\:/Windows/Fonts/arial.ttf';
                        const y = overlay.position === 'top' ? '30' : (overlay.position === 'center' ? '(h-th)/2' : 'h-th-30');

                        const escapedContent = overlay.content
                            .replace(/\\/g, '\\\\')
                            .replace(/'/g, "'\\''")
                            .replace(/:/g, '\\\\:')
                            .replace(/\n/g, '');

                        const startT = timing.start.toFixed(3);
                        const isVeryLast = !imageTimings.find(t => t.start > timing.start);
                        const endT = isVeryLast ? (timing.end + 1.0).toFixed(3) : (timing.end - 0.02).toFixed(3);

                        const drawtext = `drawtext=text='${escapedContent}':fontfile='${fontFile}':fontsize=${overlay.fontSize || 48}:fontcolor=${overlay.fontColor || 'white'}:x=(w-tw)/2:y=${y}${overlay.background && overlay.background !== 'none' ? `:box=1:boxcolor=${overlay.background === 'black' ? 'black@0.5' : 'white@0.5'}:boxborderw=10` : ''}:enable='between(t,${startT},${endT})'`;

                        const currentOut = `txt${index}_${targetIdx}`;
                        filterComplex += `[${lastOutput}]${drawtext}[${currentOut}]; `;
                        lastOutput = currentOut;
                    });
                });
            }

            // Eşlenmiş ses filter complex:
            // Her ses için: eşli resimlerin zamanlamalarına göre trim + delay
            const audioSegments = [];
            let segIdx = 0;

            uniquePairedAudioIds.forEach(audioId => {
                const inputIdx = audioInputMap[audioId];
                if (inputIdx === undefined) return;

                const pairedImgs = slideshowImages.filter(img => img.pairedAudioId === audioId);
                const audio = audioTracks.find(a => a.id === audioId);
                if (!audio) return;

                let audioOffset = 0;

                pairedImgs.forEach(img => {
                    const timing = imageTimings.find(t => t.id === img.id);
                    if (!timing) return;

                    const segDuration = img.duration;
                    const segLabel = `aseg${segIdx}`;
                    const delayMs = Math.round(timing.start * 1000);

                    filterComplex += `[${inputIdx}:a]atrim=${audioOffset.toFixed(3)}:${(audioOffset + segDuration).toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo`;

                    if (delayMs > 0) {
                        filterComplex += `,adelay=${delayMs}|${delayMs}`;
                    }

                    filterComplex += `[${segLabel}]; `;
                    audioSegments.push(segLabel);
                    audioOffset += segDuration;
                    segIdx++;
                });
            });

            // Global ses parçaları
            globalAudioTracks.forEach((_, i) => {
                const gInputIdx = globalAudioInputStart + i;
                const gLabel = `gaudio${i}`;
                filterComplex += `[${gInputIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,aresample=48000[${gLabel}]; `;
                audioSegments.push(gLabel);
            });

            // Ses segmentlerini birleştir
            let audioMap = '';
            if (audioSegments.length > 0) {
                if (audioSegments.length === 1) {
                    filterComplex += `[${audioSegments[0]}]atrim=0:${currentTime.toFixed(3)},asetpts=PTS-STARTPTS[outa]`;
                } else {
                    audioSegments.forEach(seg => {
                        filterComplex += `[${seg}]`;
                    });
                    // amix varsayılan olarak sesi giriş sayısına böler,
                    // volume filtresiyle telafi ediyoruz
                    const volBoost = audioSegments.length;
                    filterComplex += `amix=inputs=${audioSegments.length}:duration=longest[amixed]; `;
                    filterComplex += `[amixed]volume=${volBoost}[outa_pre]; `;
                    filterComplex += `[outa_pre]atrim=0:${currentTime.toFixed(3)},asetpts=PTS-STARTPTS[outa]`;
                }
                audioMap = '-map "[outa]" -c:a aac -b:a 192k -ar 48000 -ac 2';
            }

            filterComplex = filterComplex.trim();
            if (filterComplex.endsWith(';')) filterComplex = filterComplex.slice(0, -1);

            // Windows komut satırı uzunluk sınırı sorunu: filter_complex'i dosyaya yaz
            const fcScriptPath = path.join(os.tmpdir(), `fc_paired_${Date.now()}.txt`);
            fs.writeFileSync(fcScriptPath, filterComplex, 'utf-8');
            tempFilterFiles.push(fcScriptPath);

            cmd += `-filter_complex_script "${fcScriptPath}" -map "[${lastOutput}]" ${audioMap} -c:v libx264 -preset faster -crf 23 -pix_fmt yuv420p -r 25 "${outputPath}"`;

        } else {
            // === KLASİK MOD (eşleme yok) ===
            audioTracks.forEach(track => {
                cmd += `-i "${track.path}" `;
            });

            const scaleFilter = projectData.fillFrame
                ? `scale=${resolution}:force_original_aspect_ratio=increase,crop=${resolution},setsar=1`
                : `scale=${resolution}:force_original_aspect_ratio=decrease,pad=${resolution}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;

            let filterComplex = '';
            slideshowImages.forEach((img, i) => {
                filterComplex += `[${i}:v]${scaleFilter}[v${i}]; `;
            });

            slideshowImages.forEach((img, i) => {
                filterComplex += `[v${i}]`;
            });
            filterComplex += `concat=n=${slideshowImages.length}:v=1:a=0[vcoll]; `;

            let lastOutput = 'vcoll';

            // Text Overlays
            if (projectData.textOverlays && projectData.textOverlays.length > 0) {
                projectData.textOverlays.forEach((overlay, index) => {
                    overlay.targetImages.forEach((imgId, targetIdx) => {
                        const timing = imageTimings.find(t => t.id === imgId);
                        if (!timing) return;

                        const fontFile = 'C\\\\:/Windows/Fonts/arial.ttf';
                        const y = overlay.position === 'top' ? '30' : (overlay.position === 'center' ? '(h-th)/2' : 'h-th-30');

                        const escapedContent = overlay.content
                            .replace(/\\/g, '\\\\')
                            .replace(/'/g, "'\\''")
                            .replace(/:/g, '\\\\:')
                            .replace(/\n/g, '');

                        const startT = timing.start.toFixed(3);
                        const isVeryLast = !imageTimings.find(t => t.start > timing.start);
                        const endT = isVeryLast ? (timing.end + 1.0).toFixed(3) : (timing.end - 0.02).toFixed(3);

                        const drawtext = `drawtext=text='${escapedContent}':fontfile='${fontFile}':fontsize=${overlay.fontSize || 48}:fontcolor=${overlay.fontColor || 'white'}:x=(w-tw)/2:y=${y}${overlay.background && overlay.background !== 'none' ? `:box=1:boxcolor=${overlay.background === 'black' ? 'black@0.5' : 'white@0.5'}:boxborderw=10` : ''}:enable='between(t,${startT},${endT})'`;

                        const currentOut = `txt${index}_${targetIdx}`;
                        filterComplex += `[${lastOutput}]${drawtext}[${currentOut}]; `;
                        lastOutput = currentOut;
                    });
                });
            }

            filterComplex = filterComplex.trim();
            if (filterComplex.endsWith(';')) filterComplex = filterComplex.slice(0, -1);

            // Ses İşleme
            let audioMap = '';

            if (hasAudio) {
                if (audioTracks.length === 1) {
                    const inputIdx = imageCount;
                    audioMap = `-map ${inputIdx}:a -c:a copy -t ${currentTime.toFixed(3)}`;
                } else {
                    let audioConcats = '';
                    audioTracks.forEach((_, i) => {
                        const inputIdx = imageCount + i;
                        filterComplex += `; [${inputIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,aresample=48000[aud${i}]`;
                        audioConcats += `[aud${i}]`;
                    });
                    filterComplex += `; ${audioConcats}concat=n=${audioTracks.length}:v=0:a=1[outa_pre]; [outa_pre]atrim=0:${currentTime.toFixed(3)},asetpts=PTS-STARTPTS[outa]`;
                    audioMap = '-map "[outa]" -c:a aac -b:a 192k -ar 48000 -ac 2';
                }
            }

            // Windows komut satırı uzunluk sınırı sorunu: filter_complex'i dosyaya yaz
            const fcScriptPath = path.join(os.tmpdir(), `fc_classic_${Date.now()}.txt`);
            fs.writeFileSync(fcScriptPath, filterComplex, 'utf-8');
            tempFilterFiles.push(fcScriptPath);

            cmd += `-filter_complex_script "${fcScriptPath}" -map "[${lastOutput}]" ${audioMap} -c:v libx264 -preset faster -crf 23 -pix_fmt yuv420p -r 25 "${outputPath}"`;
        }

        console.log('--- Slideshow FFmpeg Cmd ---');
        console.log(cmd.substring(0, 500) + '...');

        // onProgress callback
        const onProgress = parentWindow ? (percent) => {
            parentWindow.webContents.send('export-progress', {
                status: 'progress',
                message: t('runtime.slideshow_editor.processing_video', 'Your video is being processed...'),
                percent: percent
            });
        } : null;

        execCommand(cmd, outputPath,
            (result) => {
                // Geçici filter dosyalarını temizle
                tempFilterFiles.forEach(f => { try { fs.unlinkSync(f); } catch (e) { } });
                prepared.cleanup();
                resolve(result);
            },
            (err) => {
                tempFilterFiles.forEach(f => { try { fs.unlinkSync(f); } catch (e) { } });
                prepared.cleanup();
                reject(err);
            },
            { totalDuration: currentTime, onProgress }
        );
    });
}

/**
 * Büyük projeler için Batch İşleme Yöntemi
 * Projeyi parçalara (batch) ayırır, her parçayı ayrı işler ve sonunda birleştirir.
 */
async function createSlideshowVideoBatched(projectData, outputPath, parentWindow) {
    const ffmpegPath = getFFmpegPath();
    const BATCH_SIZE = 20; // Her partide işlenecek resim sayısı
    const tempDir = os.tmpdir();
    const batchFiles = [];
    const totalImages = projectData.images.length;
    const [width, height] = projectData.aspectRatio === '16:9' ? [1920, 1080] : [1080, 1920];

    console.log(`Batch işleme başladı. Toplam ${totalImages} resim.`);

    try {
        // 1. Resimleri partilere ayır ve her birini video (sessiz) olarak render et
        for (let i = 0; i < totalImages; i += BATCH_SIZE) {
            const batchImages = projectData.images.slice(i, i + BATCH_SIZE);
            const batchIndex = Math.floor(i / BATCH_SIZE);
            const batchPath = path.join(tempDir, `batch_${Date.now()}_${batchIndex}.mp4`);

            console.log(`Batch ${batchIndex + 1} işleniyor (${batchImages.length} resim)...`);

            if (parentWindow) {
                const percent = Math.round((i / totalImages) * 80); // %0 - %80 arası
                parentWindow.webContents.send('export-progress', {
                    status: 'progress',
                    message: t('runtime.slideshow_editor.batch_progress', 'Processing part {current} of {total}...', {
                        current: batchIndex + 1,
                        total: Math.ceil(totalImages / BATCH_SIZE)
                    }),
                    percent
                });
            }

            // Batch için geçici proje verisi (Sadece Video, Ses Yok, Text Yok)
            // Text final montajda değil de burada işlenirse daha iyi olabilir ama global timestamp sorunu var.
            // En kolayı Text'leri final montajda değil, batch montajda işlemek.
            // Bunun için batch içindeki resimlerin textlerini filtrelemeliyiz.

            // Batch Zamanlaması:
            // Bu batch'in başlangıç zamanı (global timeline'da)
            let batchStartTime = 0;
            for (let k = 0; k < i; k++) {
                batchStartTime += projectData.images[k].duration;
            }

            // Batch içindeki textleri bul
            const batchTextOverlays = [];
            if (projectData.textOverlays) {
                projectData.textOverlays.forEach(overlay => {
                    // Bu overlay'in hedeflediği resimlerden herhangi biri bu batch içinde mi?
                    const relevantTargets = overlay.targetImages.filter(imgId =>
                        batchImages.some(img => img.id === imgId)
                    );

                    if (relevantTargets.length > 0) {
                        // Kopyasını oluştur ve sadece bu batch'teki hedefleri bırak
                        const overlayCopy = { ...overlay, targetImages: relevantTargets };
                        batchTextOverlays.push(overlayCopy);
                    }
                });
            }

            // Batch Konfigürasyonu
            // Eşlenmiş ses varsa, batch'e sadece ilgili ses parçalarını dahil et
            const hasPairedAudio = batchImages.some(img => img.pairedAudioId);
            let batchAudioTracks = [];
            if (hasPairedAudio) {
                const pairedAudioIds = [...new Set(
                    batchImages.filter(img => img.pairedAudioId).map(img => img.pairedAudioId)
                )];
                batchAudioTracks = (projectData.audioTracks || []).filter(
                    a => pairedAudioIds.includes(a.id)
                );
            }
            // Global (eşlenmemiş) sesler batch'e dahil DEĞİL, final merge'de işlenecek

            const batchConfig = {
                ...projectData,
                images: batchImages,
                audioTracks: batchAudioTracks,
                textOverlays: batchTextOverlays
            };

            // Batch Render komutunu oluştur (createSlideshowVideo'nun biraz modifiyesi lazım ama
            // createSlideshowVideo zaten promise dönüyor, onu REUSE edebiliriz ama text overlay zamanlaması GLOBAL
            // zamanlamaya göre olabilir mi? createSlideshowVideo fonksiyonu, verilen image listesine göre
            // start time 0'dan başlatıyor. Bu harika! Çünkü lokal mp4 üretiyoruz.
            // SORUN: createSlideshowVideo fonksiyonu localMP4 ürettiğinde zaman 0'dan başlar.
            // Ama biz text overlay'in "enable between" parametresini global zamana göre değil,
            // batch-içindeki zamana göre ayarlamalıyız. createSlideshowVideo zaten "imageTimings"i
            // loop içinde "currentTime=0"dan başlatarak kuruyor.
            // Dolayısıyla Text Overlay bu batch'e ait resime bağlıysa, sorunsuz çalışır!

            await createSlideshowVideo(batchConfig, batchPath, null);
            batchFiles.push(batchPath);
        }

        // 2. Parçaları Birleştir (Concat Demuxer)
        if (parentWindow) {
            parentWindow.webContents.send('export-progress', {
                status: 'progress',
                message: t('runtime.slideshow_editor.merging_parts_80', 'Merging parts (80%)...'),
                percent: 80
            });
        }

        const concatListPath = path.join(tempDir, `concat_list_${Date.now()}.txt`);
        const fileContent = batchFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
        fs.writeFileSync(concatListPath, fileContent);

        // Final montaj: Concat Video + Global Audio
        let cmd = `"${ffmpegPath}" -y -f concat -safe 0 -i "${concatListPath}" `;

        // Sesleri ekle — eşlenmiş sesler batch'lerde zaten işlendi,
        // sadece global (eşlenmemiş) sesleri final merge'e dahil et
        const allAudioTracks = projectData.audioTracks || [];
        const hasPairedAudio = projectData.images.some(img => img.pairedAudioId);
        const pairedAudioIds = hasPairedAudio
            ? new Set(projectData.images.filter(img => img.pairedAudioId).map(img => img.pairedAudioId))
            : new Set();
        const audioTracks = allAudioTracks.filter(a => !pairedAudioIds.has(a.id));
        const hasAudio = audioTracks.length > 0;
        audioTracks.forEach(track => {
            cmd += `-i "${track.path}" `;
        });

        // Toplam süre
        let totalDuration = 0;
        projectData.images.forEach(img => totalDuration += img.duration);

        // Filter Complex (Sadece Ses için, Video concat demuxer ile geliyor)
        let filterComplex = '';
        let audioMap = '';

        if (hasPairedAudio && !hasAudio) {
            // Eşlenmiş sesler batch'lerde zaten işlendi, global ses yok
            // Video'nun sesini koru (batch'lerden gelen)
            audioMap = '-map 0:a? -c:a copy';
        } else if (hasAudio) {
            if (hasPairedAudio) {
                // Batch'lerdeki ses var + global ses var: mix lazım
                let audioConcats = '';
                audioTracks.forEach((_, i) => {
                    const inputIdx = i + 1; // 0 video (concat), 1+ audio
                    filterComplex += `[${inputIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,aresample=48000[gaud${i}]; `;
                    audioConcats += `[gaud${i}]`;
                });
                if (audioTracks.length === 1) {
                    filterComplex += `[0:a]aformat=sample_rates=48000:channel_layouts=stereo[batchaud]; `;
                    filterComplex += `[batchaud]${audioConcats}amix=inputs=2:duration=longest[amixed]; `;
                    filterComplex += `[amixed]volume=2[outa_pre]; `;
                } else {
                    filterComplex += `${audioConcats}concat=n=${audioTracks.length}:v=0:a=1[gaud_concat]; `;
                    filterComplex += `[0:a]aformat=sample_rates=48000:channel_layouts=stereo[batchaud]; `;
                    filterComplex += `[batchaud][gaud_concat]amix=inputs=2:duration=longest[amixed]; `;
                    filterComplex += `[amixed]volume=2[outa_pre]; `;
                }
                filterComplex += `[outa_pre]atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS[outa]`;
                audioMap = '-map "[outa]" -c:a aac -b:a 192k -ar 48000 -ac 2';
            } else if (audioTracks.length === 1) {
                // True Passthrough mode
                audioMap = `-map 1:a -c:a copy -t ${totalDuration.toFixed(3)}`;
            } else {
                // Concat mode
                let audioConcats = '';
                audioTracks.forEach((_, i) => {
                    const inputIdx = i + 1; // 0 video, 1+ audio
                    filterComplex += `[${inputIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,aresample=48000[aud${i}]; `;
                    audioConcats += `[aud${i}]`;
                });
                filterComplex += `${audioConcats}concat=n=${audioTracks.length}:v=0:a=1[outa_pre]; [outa_pre]atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS[outa]`;
                audioMap = '-map "[outa]" -c:a aac -b:a 192k -ar 48000 -ac 2';
            }
        }

        // Video direkt kopyala (re-encode yok çünkü batchler zaten encode edildi)
        // ANCAK: Eğer ses eklenecekse ve map kullanıyorsak, video map de lazım.
        // concat demuxer video stream'i default haritası 0:v

        // ÖNEMLİ: Eğer filter_complex kullanıyorsak "-c:v copy" kullanamayız, complex filter output bekler.
        // Ama burada filter_complex SADECE ses için kullanılıyor.
        // Video için "-map 0:v -c:v copy" diyebiliriz! Bu ÇOK hızlı olur.

        let videoMap = '-map 0:v -c:v copy';

        if (filterComplex) {
            // Windows komut satırı uzunluk sınırı sorunu: filter_complex'i dosyaya yaz
            const fcMergePath = path.join(tempDir, `fc_merge_${Date.now()}.txt`);
            fs.writeFileSync(fcMergePath, filterComplex, 'utf-8');
            cmd += `-filter_complex_script "${fcMergePath}" ${videoMap} ${audioMap} "${outputPath}"`;
        } else {
            // filterComplex yok (ya ses yok, ya da passthrough audio)
            if (hasAudio && audioMap) {
                // Passthrough Audio + Video Copy
                cmd += `${videoMap} ${audioMap} "${outputPath}"`;
            } else {
                // Sadece video
                cmd += `-c:v copy "${outputPath}"`;
            }
        }

        console.log('--- Final Batch Merge Cmd ---');
        console.log(cmd);

        // Final Progress
        const onFinalProgress = parentWindow ? (percent) => {
            // Batch sonrası merge işlemi (Genel sürecin %80-%100 arası)
            const globalPercent = 80 + (percent * 0.2);
            parentWindow.webContents.send('export-progress', {
                status: 'progress',
                message: t('runtime.slideshow_editor.merging_parts', 'Merging parts...'),
                percent: Math.min(99, globalPercent) // Asla 100 deme, işlem bitince diyelim
            });
        } : null;

        await new Promise((resolve, reject) => {
            execCommand(cmd, outputPath, resolve, reject, { totalDuration: totalDuration, onProgress: onFinalProgress });
        });

        // Temizlik
        try {
            batchFiles.forEach(f => fs.unlinkSync(f));
            fs.unlinkSync(concatListPath);
        } catch (e) { console.error('Temizlik hatası:', e); }

        return outputPath;

    } catch (error) {
        // Hata durumunda da temizlik dene
        try {
            batchFiles.forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
        } catch (e) { }
        throw error;
    }
}

/**
 * Komut çalıştırıcı yardımcı fonksiyon
 */
/**
 * Komut çalıştırıcı yardımcı fonksiyon (Spawn ile Progress Destekli)
 */
function execCommand(cmd, outputPath, resolve, reject, options = {}) {
    const { spawn } = require('child_process');
    const { totalDuration, onProgress } = options;

    const logPath = path.join(os.tmpdir(), 'engelsiz-ffmpeg-log-exec.txt');
    try {
        fs.writeFileSync(logPath, `CMD:\n${cmd}\n\n`);
    } catch (e) { }

    // Windows komut satırı uzunluk sınırını aşmak için:
    // Komutu geçici bir .bat dosyasına yazıp, onu çalıştırıyoruz.
    // .bat dosyasının içindeki komutlarda uzunluk sınırı olmadığından
    // binlerce karakter uzunluğunda FFmpeg komutları sorunsuz çalışır.
    const batPath = path.join(os.tmpdir(), `ffmpeg_exec_${Date.now()}.bat`);
    const batContent = `@echo off\r\nchcp 65001 >nul 2>&1\r\n${cmd}\r\n`;
    fs.writeFileSync(batPath, batContent, 'utf-8');

    const child = spawn('cmd.exe', ['/c', batPath], {
        windowsHide: true
    });

    let stderrBuffer = '';

    child.stderr.on('data', (data) => {
        const dataStr = data.toString();
        stderrBuffer += dataStr; // Hata logu için biriktir

        // Progress Parse
        if (onProgress && totalDuration > 0) {
            // time=00:00:05.20 formatını yakala
            const timeMatch = dataStr.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
            if (timeMatch) {
                const hours = parseInt(timeMatch[1]);
                const minutes = parseInt(timeMatch[2]);
                const seconds = parseInt(timeMatch[3]);
                const ms = parseInt(timeMatch[4]);

                const currentSeconds = (hours * 3600) + (minutes * 60) + seconds + (ms / 100);
                const percent = Math.min(99, Math.round((currentSeconds / totalDuration) * 100));

                onProgress(percent);
            }
        }
    });

    child.stdout.on('data', (data) => {
        // stdout genellikle boştur (ffmpeg logları stderr'e yazar)
    });

    child.on('error', (error) => {
        console.error('Spawn error:', error);
        try { fs.unlinkSync(batPath); } catch (e) { }
        reject(error);
    });

    child.on('close', (code) => {
        // Geçici bat dosyasını temizle
        try { fs.unlinkSync(batPath); } catch (e) { }

        if (code === 0) {
            if (fs.existsSync(outputPath)) {
                resolve(outputPath);
            } else {
                reject(new Error(t('runtime.slideshow_editor.output_file_missing', 'The output file was not created.')));
            }
        } else {
            // Hata mesajında son 2000 karakteri göster (daha fazla bağlam)
            let details = t('runtime.slideshow_editor.process_failed_with_code', 'The process ended with error code {code}\nFFmpeg STDERR:\n{stderr}', {
                code,
                stderr: stderrBuffer ? stderrBuffer.slice(-2000) : t('runtime.slideshow_editor.none', 'None')
            });
            try { fs.appendFileSync(logPath, `\nERROR:\n${stderrBuffer}`); } catch (e) { }
            console.error('Exec error:', details);
            reject(new Error(details));
        }
    });
}

/**
 * Proje dosyası aç
 */
async function openProjectFile(mainWindow, directFilePath = null) {
    let filePath = directFilePath;

    if (!filePath) {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: t('messages.open_project_title', 'Open Project'),
            filters: [
                { name: t('dialog.slideshow_editor.project_file_filter', 'Barrier-Free Video Project'), extensions: ['eng'] }
            ],
            properties: ['openFile']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            filePath = result.filePaths[0];
        } else {
            return; // İptal edildi
        }
    }

    try {
        const projectJSON = fs.readFileSync(filePath, 'utf8');
        const projectData = JSON.parse(projectJSON);
        projectData.projectPath = filePath;

        // Slideshow düzenleyiciyi aç ve projeyi yükle
        openSlideshowEditor(mainWindow, projectData);

        // Proje yüklendiğinde düzenleyiciye bildir
        if (slideshowEditorWindow) {
            slideshowEditorWindow.webContents.on('did-finish-load', () => {
                slideshowEditorWindow.webContents.send('slideshow-project-loaded', projectData);
            });
        }
    } catch (error) {
        dialog.showErrorBox(t('messages.error_title', 'Error'), t('runtime.slideshow_editor.project_open_error', 'An error occurred while opening the project: {error}', {
            error: error.message
        }));
    }
}

module.exports = { setupSlideshowHandlers, openNewProjectDialog, openProjectFile };
