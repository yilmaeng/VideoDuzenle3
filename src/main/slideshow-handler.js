/**
 * Slideshow Proje Handler
 * Slideshow (Resim + Ses) projesi için IPC handler'ları
 */

const { ipcMain, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

let newProjectWindow = null;
let slideshowEditorWindow = null;
let currentProjectSettings = null;
let storedMainWindow = null; // Ana pencere referansını sakla

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
            title: 'Resim Dosyaları Seç',
            filters: [
                { name: 'Resim Dosyaları', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] }
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
            title: 'Ses Dosyası Seç',
            filters: [
                { name: 'Ses Dosyaları', extensions: ['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a', 'wma'] }
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
        return new Promise((resolve, reject) => {
            const { exec } = require('child_process');
            let ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
            // Portable/asar için yol düzeltmesi
            if (ffmpegPath.includes('app.asar')) {
                ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
            }

            exec(`"${ffmpegPath}" -i "${imagePath}" 2>&1`, (error, stdout, stderr) => {
                const output = stdout + stderr;

                // Çözünürlük bilgisini al
                const sizeMatch = output.match(/(\d{2,5})x(\d{2,5})/);
                if (sizeMatch) {
                    resolve({
                        width: parseInt(sizeMatch[1]),
                        height: parseInt(sizeMatch[2])
                    });
                } else {
                    // Varsayılan değerler
                    resolve({ width: 1920, height: 1080 });
                }
            });
        });
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
            console.error('Resim okuma hatası:', error);
            throw new Error('Resim okunamadı: ' + error.message);
        }
    });

    // Input diyaloğu
    ipcMain.handle('show-input-dialog', async (event, options) => {
        // Basit bir prompt için küçük bir pencere oluşturabiliriz
        // Şimdilik dialog.showMessageBox kullanıyoruz
        const { response } = await dialog.showMessageBox(slideshowEditorWindow, {
            type: 'question',
            title: options.title,
            message: options.message,
            buttons: ['Tamam', 'İptal'],
            defaultId: 0,
            cancelId: 1
        });

        if (response === 0) {
            return options.defaultValue; // Şimdilik varsayılan değeri döndür
        }
        return null;
    });

    // Mesaj diyaloğu
    ipcMain.handle('show-message-dialog', async (event, options) => {
        await dialog.showMessageBox(slideshowEditorWindow, {
            type: 'info',
            title: options.title,
            message: options.message,
            buttons: ['Tamam']
        });
    });

    // AI ile resim betimleme
    ipcMain.handle('describe-image-ai', async (event, imagePath) => {
        const geminiHandler = require('./gemini-handler');
        const apiKey = geminiHandler.getApiKey();

        if (!apiKey) {
            throw new Error('API anahtarı bulunamadı. Lütfen önce Yapay Zeka ayarlarından API anahtarını girin.');
        }

        // Resmi base64'e çevir
        const imageBuffer = fs.readFileSync(imagePath);
        const base64 = imageBuffer.toString('base64');

        // Gemini'ye istek gönder
        const prompt = `Bu resmi iki şekilde betimle:
1. KISA (en fazla 100 karakter): Resmin çok kısa bir özeti
2. DETAYLI: Resmin detaylı bir açıklaması

Yanıtını şu formatta ver:
KISA: [kısa betimleme]
DETAYLI: [detaylı betimleme]`;

        const https = require('https');

        return new Promise((resolve, reject) => {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

            const requestBody = JSON.stringify({
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
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 4096  // Detaylı betimleme için artırıldı
                }
            });

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

                            // Kısa ve detaylı betimlemeyi ayır
                            const shortMatch = text.match(/KISA:\s*(.+?)(?=DETAYLI:|$)/s);
                            const longMatch = text.match(/DETAYLI:\s*(.+)/s);

                            resolve({
                                short: shortMatch ? shortMatch[1].trim().substring(0, 100) : 'Betimleme alınamadı',
                                long: longMatch ? longMatch[1].trim() : text
                            });
                        } else {
                            reject(new Error('Geçersiz API yanıtı'));
                        }
                    } catch (error) {
                        reject(new Error('API yanıtı işlenemedi: ' + error.message));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error('Bağlantı hatası: ' + error.message));
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

            dialog.showMessageBox(slideshowEditorWindow, {
                type: 'error',
                title: 'Eksik Dosyalar',
                message: `Aşağıdaki dosyalar bulunamadı:\n\n${missingList}${moreCount}\n\nDosyaları proje klasörüne (.eng dosyasının yanına) kopyalayıp tekrar deneyin.`,
                buttons: ['Tamam']
            });
            return;
        }

        const result = await dialog.showSaveDialog(slideshowEditorWindow, {
            title: 'Slideshow Videoyu Kaydet',
            filters: [
                { name: 'MP4 Video', extensions: ['mp4'] }
            ]
        });

        if (!result.canceled) {
            // İlerleme bildirimini başlat
            if (slideshowEditorWindow) {
                slideshowEditorWindow.webContents.send('export-progress', {
                    status: 'started',
                    message: 'Video oluşturuluyor... Bu işlem birkaç dakika sürebilir.'
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
                        message: `Video oluşturuldu (${elapsedSeconds} saniye)`
                    });
                }

                dialog.showMessageBox(slideshowEditorWindow, {
                    type: 'info',
                    title: 'Başarılı',
                    message: `Slideshow video başarıyla oluşturuldu!\n\nSüre: ${elapsedSeconds} saniye`,
                    buttons: ['Tamam']
                });
            } catch (error) {
                // İlerleme bildirimini kapat (hata ile)
                if (slideshowEditorWindow) {
                    slideshowEditorWindow.webContents.send('export-progress', {
                        status: 'error',
                        message: 'Video oluşturma hatası'
                    });
                }
                const errorMsg = error.message.length > 500 ? error.message.substring(0, 500) + '...' : error.message;
                dialog.showErrorBox('Hata', 'Video oluşturulurken hata: ' + errorMsg);
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
                console.log('Proje kaydedildi:', filePath);
            } catch (error) {
                dialog.showErrorBox('Hata', 'Proje kaydedilirken hata: ' + error.message);
            }
        } else {
            // Yeni proje - dosya seçtir
            const result = await dialog.showSaveDialog(slideshowEditorWindow, {
                title: 'Projeyi Kaydet',
                filters: [
                    { name: 'Engelsiz Video Projesi', extensions: ['eng'] }
                ]
            });

            if (!result.canceled) {
                try {
                    // projectPath'i güncelle
                    projectData.projectPath = result.filePath;
                    const projectJSON = JSON.stringify(projectData, null, 2);
                    fs.writeFileSync(result.filePath, projectJSON, 'utf8');
                    slideshowEditorWindow.webContents.send('slideshow-project-saved', result.filePath);
                    console.log('Yeni proje kaydedildi:', result.filePath);
                } catch (error) {
                    dialog.showErrorBox('Hata', 'Proje kaydedilirken hata: ' + error.message);
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
        title: data.editText ? 'Yazı Düzenle - Slideshow' : 'Yazı Ekle - Slideshow',
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
        title: 'Yeni Proje Oluştur',
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
        title: 'Slideshow Düzenleyici',
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
 */
async function createSlideshowVideo(projectData, outputPath, parentWindow) {
    const ffmpegPath = getFFmpegPath();

    if (!fs.existsSync(ffmpegPath)) {
        throw new Error(`FFmpeg bulunamadı: ${ffmpegPath}`);
    }

    return new Promise((resolve, reject) => {
        const [width, height] = projectData.aspectRatio === '16:9' ? [1920, 1080] : [1080, 1920];
        const resolution = `${width}:${height}`;

        let currentTime = 0;
        const imageTimings = projectData.images.map(img => {
            const timing = { id: img.id, start: currentTime, end: currentTime + img.duration };
            currentTime += img.duration;
            return timing;
        });

        let cmd = `"${ffmpegPath}" -y `;

        // Inputları ekle
        projectData.images.forEach(img => {
            cmd += `-loop 1 -t ${img.duration.toFixed(3)} -i "${img.path}" `;
        });

        const imageCount = projectData.images.length;
        const audioTracks = projectData.audioTracks || [];
        const hasAudio = audioTracks.length > 0;

        // Ses dosyalarını input olarak ekle
        audioTracks.forEach(track => {
            cmd += `-i "${track.path}" `;
        });

        const scaleFilter = projectData.fillFrame
            ? `scale=${resolution}:force_original_aspect_ratio=increase,crop=${resolution},setsar=1`
            : `scale=${resolution}:force_original_aspect_ratio=decrease,pad=${resolution}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;

        let filterComplex = '';
        projectData.images.forEach((img, i) => {
            filterComplex += `[${i}:v]${scaleFilter}[v${i}]; `;
        });

        projectData.images.forEach((img, i) => {
            filterComplex += `[v${i}]`;
        });
        filterComplex += `concat=n=${projectData.images.length}:v=1:a=0[vcoll]; `;

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
                        .replace(/'/g, "'\\\''")
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
                // True Passthrough mode (no re-encoding)
                const inputIdx = imageCount;
                // No filter complex for audio, map directly from input
                audioMap = `-map ${inputIdx}:a -c:a copy -t ${currentTime.toFixed(3)}`;
            } else {
                // Concat mode (Normalize to 48k)
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

        cmd += `-filter_complex "${filterComplex}" -map "[${lastOutput}]" ${audioMap} -c:v libx264 -preset faster -crf 23 -pix_fmt yuv420p -r 25 "${outputPath}"`;

        // onProgress callback (Eğer parentWindow varsa)
        const onProgress = parentWindow ? (percent) => {
            parentWindow.webContents.send('export-progress', {
                status: 'progress',
                message: 'Videonuz işleniyor...',
                percent: percent
            });
        } : null;

        execCommand(cmd, outputPath, resolve, reject, { totalDuration: currentTime, onProgress });
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
                    status: 'started',
                    message: `Bölüm ${batchIndex + 1} oluşturuluyor (%${percent})...`
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
            const batchConfig = {
                ...projectData,
                images: batchImages,
                audioTracks: [], // Ses yok
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
                status: 'started',
                message: 'Parçalar birleştiriliyor (%80)...'
            });
        }

        const concatListPath = path.join(tempDir, `concat_list_${Date.now()}.txt`);
        const fileContent = batchFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
        fs.writeFileSync(concatListPath, fileContent);

        // Final montaj: Concat Video + Global Audio
        let cmd = `"${ffmpegPath}" -y -f concat -safe 0 -i "${concatListPath}" `;

        // Sesleri ekle
        const audioTracks = projectData.audioTracks || [];
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

        if (hasAudio) {
            if (audioTracks.length === 1) {
                // True Passthrough mode
                // Video Input Index: 0 (concat demuxer), Audio Input Index: 1
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
            cmd += `-filter_complex "${filterComplex}" ${videoMap} ${audioMap} "${outputPath}"`;
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
                message: 'Parçalar birleştiriliyor...',
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

    // Cmd string'ini parçala (Basit bir parser, tırnak işaretlerine dikkat ederek)
    // Spawn argümanlarını ayırmak exec'e göre daha karmaşık olabilir.
    // Ancak exec yerine spawn kullanmak için shell: true yapabiliriz.
    // Bu sayede cmd string'ini olduğu gibi verebiliriz.

    // Windows'ta 'cmd.exe' üzerinden, Mac/Linux'ta 'sh' üzerinden
    const child = spawn(cmd, {
        shell: true,
        maxBuffer: 100 * 1024 * 1024,
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
        reject(error);
    });

    child.on('close', (code) => {
        if (code === 0) {
            if (fs.existsSync(outputPath)) {
                resolve(outputPath);
            } else {
                reject(new Error('Çıktı dosyası oluşmadı.'));
            }
        } else {
            let details = `İşlem hata kodu ile sonlandı: ${code}\nFFmpeg STDERR:\n${stderrBuffer ? stderrBuffer.slice(-1000) : 'Yok'}`;
            try { fs.appendFileSync(logPath, `\nERROR:\n${details}`); } catch (e) { }
            console.error('Exec hatası:', details);
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
            title: 'Proje Aç',
            filters: [
                { name: 'Engelsiz Video Projesi', extensions: ['eng'] }
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
        dialog.showErrorBox('Hata', 'Proje açılırken hata: ' + error.message);
    }
}

module.exports = { setupSlideshowHandlers, openNewProjectDialog, openProjectFile };
