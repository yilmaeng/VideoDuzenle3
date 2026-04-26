const { Menu, dialog, shell, app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const i18n = require('./i18n');

// Son açılan dosyalar listesi
let recentFiles = [];
const MAX_RECENT_FILES = 10;

function addToRecentFiles(filePath) {
    recentFiles = recentFiles.filter(f => f !== filePath);
    recentFiles.unshift(filePath);
    if (recentFiles.length > MAX_RECENT_FILES) {
        recentFiles = recentFiles.slice(0, MAX_RECENT_FILES);
    }
}

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
        console.warn('Menu dialog accessibility announcement failed:', error.message);
    }
}

function getShortcutTokenMap(lang) {
    if (lang === 'tr') {
        return {
            CmdOrCtrl: 'Ctrl',
            Cmd: 'Ctrl',
            Ctrl: 'Ctrl',
            Control: 'Ctrl',
            Alt: 'Alt',
            Shift: 'Shift',
            Space: 'Bosluk',
            Enter: 'Enter',
            Escape: 'Escape',
            Delete: 'Delete',
            Backspace: 'Backspace',
            Home: 'Home',
            End: 'End',
            Left: 'Sol Ok',
            Right: 'Sag Ok',
            Up: 'Yukari Ok',
            Down: 'Asagi Ok',
            PageUp: 'Page Up',
            PageDown: 'Page Down',
        };
    }

    return {
        CmdOrCtrl: 'Ctrl',
        Cmd: 'Ctrl',
        Ctrl: 'Ctrl',
        Control: 'Ctrl',
        Alt: 'Alt',
        Shift: 'Shift',
        Space: 'Space',
        Enter: 'Enter',
        Escape: 'Escape',
        Delete: 'Delete',
        Backspace: 'Backspace',
        Home: 'Home',
        End: 'End',
        Left: 'Left Arrow',
        Right: 'Right Arrow',
        Up: 'Up Arrow',
        Down: 'Down Arrow',
        PageUp: 'Page Up',
        PageDown: 'Page Down',
    };
}

function formatAcceleratorForLabel(accelerator, lang) {
    if (!accelerator) return '';

    const tokenMap = getShortcutTokenMap(lang);
    return accelerator
        .split('+')
        .map(part => tokenMap[part] || part)
        .join('+');
}

function addShortcutHints(items, lang, depth = 0) {
    return items.map(item => {
        if (!item || item.type === 'separator') {
            return item;
        }

        const nextItem = { ...item };

        if (depth > 0 && typeof nextItem.label === 'string' && nextItem.accelerator) {
            const shortcutText = formatAcceleratorForLabel(nextItem.accelerator, lang);
            if (shortcutText && !nextItem.label.includes(`(${shortcutText})`)) {
                nextItem.label = `${nextItem.label} (${shortcutText})`;
            }
            delete nextItem.accelerator;
        }

        if (Array.isArray(nextItem.submenu)) {
            nextItem.submenu = addShortcutHints(nextItem.submenu, lang, depth + 1);
        }

        return nextItem;
    });
}

function withShortcutHint(label, shortcut, lang) {
    const shortcutText = formatAcceleratorForLabel(shortcut, lang);
    if (!shortcutText || label.includes(`(${shortcutText})`)) {
        return label;
    }
    return `${label} (${shortcutText})`;
}

function openAdditionalEvdWindow() {
    const args = [];

    if (process.defaultApp) {
        args.push(app.getAppPath());
    }

    args.push('--multi-instance');

    const child = spawn(process.execPath, args, {
        detached: true,
        stdio: 'ignore'
    });

    child.unref();
}

function createMenu(mainWindow) {
    const currentLanguage = i18n.getCurrentLanguage();
    const applyTransitionAccelerator = currentLanguage === 'tr' ? 'Ş' : 'T';
    const { hasActiveRecordingWizardSession } = require('./dialog-windows');
    const template = [
        // DOSYA MENÜSÜ
        {
            label: t('menu.file.label', '&Dosya'),
            submenu: [
                {
                    label: t('menu.file.new_slideshow', 'Yeni Slayt Projesi...'),
                    accelerator: 'CmdOrCtrl+Shift+N',
                    click: () => {
                        const { openNewProjectDialog } = require('./slideshow-handler');
                        openNewProjectDialog(mainWindow);
                    }
                },
                {
                    label: t('menu.file.open_project', 'Proje Aç...'),
                    accelerator: 'CmdOrCtrl+Shift+O',
                    click: async () => {
                        const result = await dialog.showOpenDialog(mainWindow, {
                            title: t('messages.open_project_title', 'Open Project'),
                            filters: [
                                { name: t('messages.project_filters.all_projects', 'All Projects'), extensions: ['kve', 'eng'] },
                                { name: t('messages.project_filters.video_project', 'Video Project'), extensions: ['kve'] },
                                { name: t('messages.project_filters.slideshow_project', 'Slideshow Project'), extensions: ['eng'] }
                            ],
                            properties: ['openFile']
                        });

                        if (!result.canceled && result.filePaths.length > 0) {
                            const filePath = result.filePaths[0];
                            const ext = path.extname(filePath).toLowerCase();

                            if (ext === '.eng') {
                                const { openProjectFile } = require('./slideshow-handler');
                                // openProjectFile might expect to open dialog itself if no arg. 
                                // We will modify it or call a specific loader if available.
                                // For now, let's pass the path and ensure handler supports it.
                                openProjectFile(mainWindow, filePath);
                            } else {
                                // .kve dosyasını renderer'a gönder
                                mainWindow.webContents.send('project-open-file', filePath);
                            }
                        }
                    }
                },
                {
                    label: t('menu.file.save_project', 'Projeyi Kaydet (.kve)...'),
                    accelerator: 'CmdOrCtrl+Shift+P',
                    click: () => {
                        mainWindow.webContents.send('project-save');
                    }
                },
                {
                    // Intentionally not added to the keyboard shortcut manager.
                    // This is a niche helper for multi-window recording/tutorial workflows.
                    label: t('menu.file.new_window', 'Yeni EVD Penceresi Aç'),
                    click: () => {
                        try {
                            openAdditionalEvdWindow();
                        } catch (error) {
                            dialog.showErrorBox(
                                t('messages.error_title', 'Error'),
                                t('messages.additional_window_launch_failed', 'A new EVD window could not be opened.')
                            );
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.file.new', 'Yeni'),
                    accelerator: 'CmdOrCtrl+N',
                    click: () => {
                        mainWindow.webContents.send('file-new');
                    }
                },
                {
                    label: t('menu.file.open', 'Aç...'),
                    accelerator: 'CmdOrCtrl+O',
                    click: async () => {
                        const result = await dialog.showOpenDialog(mainWindow, {
                            title: t('messages.open_video', 'Open Video File'),
                            filters: [
                                { name: t('runtime.app.video_files_filter', 'Video Files'), extensions: ['mp4', 'wmv', 'avi', 'mkv', 'mov', 'webm', 'flv', '3gp', 'mpg', 'mpeg', 'vob', 'm4v', 'ts', 'mts'] },
                                { name: t('dialog.common.all_files', 'All Files'), extensions: ['*'] }
                            ],
                            properties: ['openFile']
                        });
                        if (!result.canceled && result.filePaths.length > 0) {
                            const filePath = result.filePaths[0];
                            addToRecentFiles(filePath);
                            mainWindow.webContents.send('file-open', filePath);
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.file.save', 'Kaydet'),
                    accelerator: 'CmdOrCtrl+S',
                    click: () => {
                        mainWindow.webContents.send('file-save');
                    }
                },
                {
                    label: t('menu.file.save_as', 'Videoyu Farklı Kaydet...'),
                    accelerator: 'CmdOrCtrl+Shift+S',
                    click: async () => {
                        const result = await dialog.showSaveDialog(mainWindow, {
                            title: t('messages.save_video_as', 'Save Video As'),
                            filters: [
                                { name: t('messages.file_filter_mp4_video', 'MP4 Video'), extensions: ['mp4'] },
                                { name: t('messages.file_filter_avi_video', 'AVI Video'), extensions: ['avi'] },
                                { name: t('messages.file_filter_wmv_video', 'WMV Video'), extensions: ['wmv'] }
                            ]
                        });
                        if (!result.canceled) {
                            mainWindow.webContents.send('file-save-as', result.filePath);
                        }
                    }
                },
                {
                    label: t('menu.file.fast_export', 'Hızlı Dışa Aktar (Smart Cut)...'),
                    click: async () => {
                        const options = {
                            type: 'warning',
                            title: t('messages.export_warning_title', 'Fast Export Warning'),
                            message: t('messages.export_warning_msg', 'Please note that fast export may sometimes leave audio artifacts at the points you cut and split. Do you want to continue?'),
                            buttons: [
                                t('messages.export_warning_yes', 'Yes, Continue'),
                                t('messages.export_warning_no', 'No, Traditional Export'),
                                t('messages.cancel', 'Cancel')
                            ],
                            defaultId: 0,
                            cancelId: 2
                        };
                        await announceDialogForAccessibility(mainWindow, options);
                        const { response } = await dialog.showMessageBox(mainWindow, options);

                        if (response === 0) {
                            // FAST MODE (Smart Cut)
                            const result = await dialog.showSaveDialog(mainWindow, {
                                title: t('menu.file.fast_export', 'Fast Export (Smart Cut)...'),
                                filters: [{ name: t('messages.file_filter_mp4_video', 'MP4 Video'), extensions: ['mp4'] }]
                            });
                            if (!result.canceled) {
                                mainWindow.webContents.send('file-save-fast', result.filePath);
                            }
                        } else if (response === 1) {
                            // SLOW MODE (Traditional)
                            const result = await dialog.showSaveDialog(mainWindow, {
                            title: t('messages.save_video_as', 'Save Video As'),
                            filters: [
                                    { name: t('messages.file_filter_mp4_video', 'MP4 Video'), extensions: ['mp4'] },
                                    { name: t('messages.file_filter_avi_video', 'AVI Video'), extensions: ['avi'] },
                                    { name: t('messages.file_filter_wmv_video', 'WMV Video'), extensions: ['wmv'] }
                                ]
                            });
                            if (!result.canceled) {
                                mainWindow.webContents.send('file-save-as', result.filePath);
                            }
                        }
                    }
                },
                {
                    label: t('menu.file.save_selection', 'Seçimi Kaydet...'),
                    accelerator: 'CmdOrCtrl+Alt+S',
                    click: () => {
                        mainWindow.webContents.send('file-save-selection-request');
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.file.export_video_only', 'Sadece Video Dışa Aktar...'),
                    click: async () => {
                        const result = await dialog.showSaveDialog(mainWindow, {
                            title: t('messages.export_video', 'Export Video Only'),
                            filters: [
                                { name: t('messages.file_filter_mp4_video', 'MP4 Video'), extensions: ['mp4'] }
                            ]
                        });
                        if (!result.canceled) {
                            mainWindow.webContents.send('export-video-only', result.filePath);
                        }
                    }
                },
                {
                    label: t('menu.file.export_audio_only', 'Sadece Ses Dışa Aktar...'),
                    click: async () => {
                        const result = await dialog.showSaveDialog(mainWindow, {
                            title: t('messages.export_audio', 'Export Audio Only'),
                            filters: [
                                { name: t('messages.file_filter_mp3_audio', 'MP3 Audio'), extensions: ['mp3'] },
                                { name: t('messages.file_filter_wav_audio', 'WAV Audio'), extensions: ['wav'] },
                                { name: t('messages.file_filter_aac_audio', 'AAC Audio'), extensions: ['aac'] }
                            ]
                        });
                        if (!result.canceled) {
                            mainWindow.webContents.send('export-audio-only', result.filePath);
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.file.sync_external_audio', 'Harici Sesi Videoyla Senkronla...'),
                    click: () => {
                        const { openSyncWizard } = require('./dialog-windows');
                        openSyncWizard(mainWindow, 'A');
                    }
                },
                {
                    label: t('menu.file.sync_reference_audio', 'Referans Sesle Video Kaydet...'),
                    click: () => {
                        const { openSyncWizard } = require('./dialog-windows');
                        openSyncWizard(mainWindow, 'B');
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.file.recent_files', 'Son Açılan Dosyalar'),
                    submenu: [] // Dinamik olarak doldurulacak
                },
                { type: 'separator' },
                {
                    label: t('menu.file.close', 'Dosyayı Kapat'),
                    accelerator: 'CmdOrCtrl+W',
                    click: async () => {
                        // Renderer'a dosya kapatma isteği gönder
                        // hasChanges kontrolü renderer tarafında yapılacak
                        mainWindow.webContents.send('file-close-request');
                    }
                },
                // Gemini API Anahtarı taşındı
                { type: 'separator' },
                {
                    label: t('menu.file.language', 'Dil'),
                    submenu: [
                        { label: t('messages.system_language', 'Sistem dili (Otomatik)'), type: 'radio', checked: (i18n.store ? i18n.store.get('app_language') : 'system') === 'system' || !i18n.store?.get('app_language'), click: () => i18n.changeLanguage('system', mainWindow) },
                        { label: 'Türkçe', type: 'radio', checked: i18n.store?.get('app_language') === 'tr', click: () => i18n.changeLanguage('tr', mainWindow) },
                        { label: 'English', type: 'radio', checked: i18n.store?.get('app_language') === 'en', click: () => i18n.changeLanguage('en', mainWindow) },
                        { label: 'Français', type: 'radio', checked: i18n.store?.get('app_language') === 'fr', click: () => i18n.changeLanguage('fr', mainWindow) },
                        { label: 'Deutsch', type: 'radio', checked: i18n.store?.get('app_language') === 'de', click: () => i18n.changeLanguage('de', mainWindow) },
                        { label: 'Español', type: 'radio', checked: i18n.store?.get('app_language') === 'es', click: () => i18n.changeLanguage('es', mainWindow) },
                    ]
                },
                { type: 'separator' },
                {
                    label: t('menu.file.quit', 'Çıkış'),
                    accelerator: 'Alt+F4',
                    click: () => {
                        mainWindow.webContents.send('app-quit-request');
                    }
                }
            ]
        },

        // DÜZENLE MENÜSÜ
        {
            label: t('menu.edit.label', 'Düzenle'),
            submenu: [
                {
                    label: t('menu.edit.undo', 'Geri Al'),
                    accelerator: 'CmdOrCtrl+Z',
                    click: () => {
                        mainWindow.webContents.send('edit-undo');
                    }
                },
                {
                    label: t('menu.edit.redo', 'Yinele'),
                    accelerator: 'CmdOrCtrl+Y',
                    click: () => {
                        mainWindow.webContents.send('edit-redo');
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.edit.cut', 'Kes'),
                    accelerator: 'CmdOrCtrl+X',
                    click: () => {
                        mainWindow.webContents.send('edit-cut');
                    }
                },
                {
                    label: t('menu.edit.copy', 'Kopyala'),
                    accelerator: 'CmdOrCtrl+C',
                    click: () => {
                        mainWindow.webContents.send('edit-copy');
                    }
                },
                {
                    label: t('menu.edit.paste', 'Yapıştır'),
                    accelerator: 'CmdOrCtrl+V',
                    click: () => {
                        mainWindow.webContents.send('edit-paste');
                    }
                },
                {
                    label: t('menu.edit.delete', 'Sil'),
                    accelerator: 'Delete',
                    click: () => {
                        mainWindow.webContents.send('edit-delete');
                    }
                },
                {
                    label: t('menu.edit.split', 'Böl'),
                    accelerator: 'C',
                    click: () => {
                        mainWindow.webContents.send('edit-split');
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.edit.selection', 'Seçim'),
                    submenu: [
                        {
                            label: t('menu.edit.select_all', 'Tümünü Seç'),
                            accelerator: 'CmdOrCtrl+A',
                            click: () => {
                                mainWindow.webContents.send('select-all');
                            }
                        },
                        {
                            label: t('menu.edit.clear_selection', 'Seçimi Temizle'),
                            accelerator: 'Escape',
                            click: () => {
                                mainWindow.webContents.send('select-clear');
                            }
                        },
                        { type: 'separator' },
                        {
                            label: t('menu.edit.select_range', 'Aralık Seç...'),
                            accelerator: 'CmdOrCtrl+R',
                            click: () => {
                                mainWindow.webContents.send('select-range-dialog');
                            }
                        },
                        {
                            label: withShortcutHint(
                                t('menu.edit.select_between_markers', 'İşaretçiler Arası Seç'),
                                'CmdOrCtrl+Shift+Right / CmdOrCtrl+Shift+Left',
                                currentLanguage
                            ),
                            click: () => {
                                mainWindow.webContents.send('select-between-markers');
                            }
                        },
                        { type: 'separator' },
                        {
                            label: t('menu.edit.change_speed', 'Seçili Alanın Hızını Değiştir...'),
                            accelerator: 'CmdOrCtrl+Shift+H',
                            click: () => {
                                mainWindow.webContents.send('show-speed-dialog');
                            }
                        }
                    ]
                },
                // Akıllı Seçim taşındı
                { type: 'separator' },
                {
                    label: t('menu.edit.video_properties', 'Video Özellikleri...'),
                    click: () => {
                        mainWindow.webContents.send('edit-video-properties');
                    }
                },
                {
                    label: t('menu.edit.audio_settings', 'Ses Ayarları...'),
                    accelerator: 'Alt+Shift+S',
                    click: () => {
                        mainWindow.webContents.send('show-audio-settings-dialog');
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.edit.list_silences', 'Boşlukları Listele...'),
                    accelerator: 'CmdOrCtrl+Shift+B',
                    click: () => {
                        mainWindow.webContents.send('edit-list-silences');
                    }
                },
                // Seçimi Betimle taşındı
            ]
        },

        // OYNAT MENÜSÜ
        {
            label: t('menu.play.label', 'Oynat'),
            submenu: [
                {
                    label: t('menu.play.toggle', 'Oynat / Duraklat'),
                    accelerator: 'Space',
                    click: () => {
                        mainWindow.webContents.send('playback-toggle');
                    }
                },
                {
                    label: t('menu.play.pause_at_position', 'Pozisyonda Duraklat'),
                    accelerator: 'Enter',
                    click: () => {
                        mainWindow.webContents.send('playback-pause-at-position');
                    }
                },
                {
                    label: t('menu.play.play_selection', 'Seçili Alanı Oynat'),
                    accelerator: 'Shift+Space',
                    click: () => {
                        mainWindow.webContents.send('playback-play-selection');
                    }
                },
                {
                    label: t('menu.play.preview_cut', 'Kesim Önizleme (Seçimsiz)'),
                    accelerator: 'CmdOrCtrl+Shift+Space',
                    click: () => {
                        mainWindow.webContents.send('playback-play-cut-preview');
                    }
                },
                {
                    label: t('menu.play.skip_silence', 'Sessizliği Atla'),
                    accelerator: 'CmdOrCtrl+Shift+J',
                    click: () => {
                        mainWindow.webContents.send('playback-skip-silence');
                    }
                },
                {
                    label: t('menu.play.forward_1s', '1 Saniye İleri'),
                    accelerator: 'Right',
                    click: () => {
                        mainWindow.webContents.send('seek-forward', 1);
                    }
                },
                {
                    label: t('menu.play.backward_1s', '1 Saniye Geri'),
                    accelerator: 'Left',
                    click: () => {
                        mainWindow.webContents.send('seek-backward', 1);
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.play.forward_30s', '30 Saniye İleri'),
                    accelerator: 'CmdOrCtrl+Right',
                    click: () => {
                        mainWindow.webContents.send('seek-forward', 30);
                    }
                },
                {
                    label: t('menu.play.backward_30s', '30 Saniye Geri'),
                    accelerator: 'CmdOrCtrl+Left',
                    click: () => {
                        mainWindow.webContents.send('seek-backward', 30);
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.play.forward_5m', '5 Dakika İleri'),
                    accelerator: 'CmdOrCtrl+Alt+Right',
                    click: () => {
                        mainWindow.webContents.send('seek-forward', 300);
                    }
                },
                {
                    label: t('menu.play.backward_5m', '5 Dakika Geri'),
                    accelerator: 'CmdOrCtrl+Alt+Left',
                    click: () => {
                        mainWindow.webContents.send('seek-backward', 300);
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.play.goto_start', 'Başa Git'),
                    accelerator: 'CmdOrCtrl+Home',
                    click: () => {
                        mainWindow.webContents.send('goto-start');
                    }
                },
                {
                    label: t('menu.play.goto_end', 'Sona Git'),
                    accelerator: 'CmdOrCtrl+End',
                    click: () => {
                        mainWindow.webContents.send('goto-end');
                    }
                },
                {
                    label: t('menu.play.goto_middle', 'Ortaya Git'),
                    accelerator: 'CmdOrCtrl+Shift+Backspace',
                    click: () => {
                        mainWindow.webContents.send('goto-middle');
                    }
                },
                {
                    label: t('menu.play.goto_before_end', 'Sondan 30 Saniye Önce'),
                    accelerator: 'Shift+Backspace',
                    click: () => {
                        mainWindow.webContents.send('goto-before-end');
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.play.goto_timecode', 'Zaman Koduna Git...'),
                    accelerator: 'CmdOrCtrl+G',
                    click: () => {
                        mainWindow.webContents.send('goto-time-dialog');
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.play.fine_tune', 'İnce Ayar...'),
                    accelerator: 'CmdOrCtrl+Shift+F',
                    click: () => {
                        mainWindow.webContents.send('show-fine-tune-dialog');
                    }
                }
            ]
        },

        // EKLE MENÜSÜ
        {
            label: t('menu.insert.label', 'Ekle'),
            submenu: [
                {
                    label: t('menu.insert.audio', 'Ses Ekle...'),
                    click: async () => {
                        // Eski: Doğrudan dosya seçimi açılıyordu
                        // Yeni: Renderer tarafına istek gönderilir, orada seçim yapılır (Dosya/Kayıt)
                        mainWindow.webContents.send('insert-audio-request');
                    }
                },
                {
                    label: t('menu.insert.video', 'Video Ekle...'),
                    click: async () => {
                        const result = await dialog.showOpenDialog(mainWindow, {
                            title: t('messages.select_video_file', 'Select Video File'),
                            filters: [
                                { name: t('runtime.app.video_files_filter', 'Video Files'), extensions: ['mp4', 'wmv', 'avi', 'mkv', 'mov'] }
                            ],
                            properties: ['openFile']
                        });
                        if (!result.canceled && result.filePaths.length > 0) {
                            mainWindow.webContents.send('insert-video', result.filePaths[0]);
                        }
                    }
                },
                {
                    label: t('menu.insert.vertical_video', 'Dikey Video (Shorts/Reels) Oluştur...'),
                    click: () => {
                        const { openVerticalWizard } = require('./dialog-windows');
                        openVerticalWizard(mainWindow);
                    }
                },
                {
                    label: t('menu.insert.vertical_video_from_selection', 'Seçili Alanı Dikey Videoya Dönüştür...'),
                    click: () => {
                        mainWindow.webContents.send('vertical-video-from-selection');
                    }
                },
                {
                    label: t('menu.insert.vertical_video_add_selection_to_queue', 'Seçili Alanı Kısa Video Listesine Ekle'),
                    click: () => {
                        mainWindow.webContents.send('vertical-video-queue-add-selection');
                    }
                },
                {
                    // Intentionally menu-only for now.
                    // This dialog manages a persistent multi-step selection workflow and should not
                    // be triggered accidentally with a global shortcut until the UX settles.
                    label: t('menu.insert.selection_queue', 'Seçim Listesi...'),
                    click: () => {
                        mainWindow.webContents.send('selection-queue-open');
                    }
                },
                {
                    label: t('menu.insert.vertical_video_queue_open', 'Kısa Video Listesini Dikey Videoya Dönüştür...'),
                    click: () => {
                        mainWindow.webContents.send('vertical-video-queue-open');
                    }
                },
                {
                    label: t('menu.insert.vertical_video_queue_clear', 'Kısa Video Listesini Temizle'),
                    click: () => {
                        mainWindow.webContents.send('vertical-video-queue-clear');
                    }
                },

                {
                    label: t('menu.insert.video_layer', 'Video Katmanı Ekle...'),
                    accelerator: 'CmdOrCtrl+Shift+V',
                    click: async () => {
                        const result = await dialog.showOpenDialog(mainWindow, {
                            title: t('dialog.video_layer_wizard.open_file_title', 'Select Video Layer (Picture-in-Picture)'),
                            filters: [
                                { name: t('runtime.app.video_files_filter', 'Video Files'), extensions: ['mp4', 'wmv', 'avi', 'mkv', 'mov', 'webm', 'mts', 'm2ts', 'ts', 'mpg', 'mpeg', 'vob', 'm4v', 'flv', '3gp'] },
                                { name: t('dialog.common.all_files', 'All Files'), extensions: ['*'] }
                            ],
                            properties: ['openFile']
                        });
                        if (!result.canceled && result.filePaths.length > 0) {
                            mainWindow.webContents.send('open-video-layer-wizard', result.filePaths[0]);
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.insert.cta_library', 'CTA / Overlay Kütüphanesi...'),
                    accelerator: 'CmdOrCtrl+Shift+K',
                    click: () => {
                        mainWindow.webContents.send('show-cta-library');
                    }
                },
                {
                    label: t('menu.insert.text', 'Metin Ekle...'),
                    click: () => {
                        mainWindow.webContents.send('insert-text-dialog');
                    }
                },
                {
                    label: t('menu.insert.images', 'Görsel(ler) Ekle...'),
                    click: () => {
                        mainWindow.webContents.send('open-image-wizard');
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.insert.subtitle', 'Altyazı Dosyası Ekle...'),
                    click: async () => {
                        const result = await dialog.showOpenDialog(mainWindow, {
                            title: t('dialog.subtitle_file.open_title', 'Select Subtitle File'),
                            filters: [
                                { name: t('dialog.subtitle_file.filter_name', 'Subtitle Files'), extensions: ['srt', 'vtt', 'ass', 'ssa'] }
                            ],
                            properties: ['openFile']
                        });
                        if (!result.canceled && result.filePaths.length > 0) {
                            mainWindow.webContents.send('insert-subtitle', result.filePaths[0]);
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.insert.transition', 'Geçiş'),
                    submenu: [
                        {
                            label: t('menu.insert.transition_library', 'Geçiş Kütüphanesi...'),
                            accelerator: 'CmdOrCtrl+Shift+T',
                            click: () => {
                                mainWindow.webContents.send('show-transition-library');
                            }
                        },
                        {
                            label: t('menu.insert.apply_active_transition', 'Aktif Geçişi Uygula'),
                            accelerator: applyTransitionAccelerator,
                            click: () => {
                                mainWindow.webContents.send('apply-active-transition');
                            }
                        },
                        { type: 'separator' },
                        {
                            label: t('menu.insert.apply_transition_to_markers', 'Aktif Geçişi Tüm İşaretçilere Uygula'),
                            click: () => {
                                mainWindow.webContents.send('apply-transition-to-markers');
                            }
                        },
                        { type: 'separator' },
                        {
                            label: t('menu.insert.transition_list', 'Geçiş Listesi...'),
                            click: () => {
                                mainWindow.webContents.send('show-transition-list');
                            }
                        },
                        { type: 'separator' },
                        {
                            label: t('menu.insert.apply_all_transitions', 'Tüm Geçişleri Videoya Uygula'),
                            accelerator: 'CmdOrCtrl+T',
                            click: () => {
                                mainWindow.webContents.send('apply-all-transitions');
                            }
                        }
                    ]
                },
                { type: 'separator' },
                {
                    label: t('menu.insert.apply_to_object', 'Nesneye Uygula (Analiz)...'),
                    accelerator: 'CmdOrCtrl+Shift+A',
                    click: () => {
                        mainWindow.webContents.send('show-object-analysis-dialog');
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.insert.insertion_queue', 'Ekleme Listesi...'),
                    accelerator: 'CmdOrCtrl+Shift+L',
                    click: () => {
                        mainWindow.webContents.send('show-insertion-queue');
                    }
                }
            ]
        },

        // GÖRÜNÜM MENÜSÜ
        {
            label: t('menu.view.label', 'Görünüm'),
            submenu: [
                {
                    label: t('menu.view.rotate_90_cw', '90° Döndür (Saat Yönünde)'),
                    click: () => {
                        mainWindow.webContents.send('rotate-video', 90);
                    }
                },
                {
                    label: t('menu.view.rotate_90_ccw', '90° Döndür (Saat Yönü Tersine)'),
                    click: () => {
                        mainWindow.webContents.send('rotate-video', -90);
                    }
                },
                {
                    label: t('menu.view.rotate_180', '180° Döndür'),
                    click: () => {
                        mainWindow.webContents.send('rotate-video', 180);
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.view.fullscreen', 'Tam Ekran'),
                    accelerator: 'F11',
                    click: () => {
                        mainWindow.setFullScreen(!mainWindow.isFullScreen());
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.view.devtools', 'Geliştirici Araçları'),
                    accelerator: 'F12',
                    click: () => {
                        mainWindow.webContents.toggleDevTools();
                    }
                }
            ]
        },

        // ERİŞİLEBİLİR KAYIT MENÜSÜ
        {
            label: t('menu.record.label', 'Erişilebilir Video Kaydı'),
            submenu: [
                {
                    label: t('menu.record.wizard', 'Kayıt Sihirbazı...'),
                    accelerator: 'CmdOrCtrl+Shift+R',
                    click: () => {
                        const { openRecordingWizard } = require('./dialog-windows');
                        openRecordingWizard(mainWindow);
                    }
                },
                {
                    label: t('menu.record.offline_presets', 'Çevrim Dışı Önayarlar'),
                    submenu: [
                        {
                            label: t('menu.record.offline_fullscreen', 'Tam Ekran Çevrim Dışı Önayar...'),
                            click: () => {
                                const { openRecordingWizard } = require('./dialog-windows');
                                openRecordingWizard(mainWindow, { launchProfile: 'interview' });
                            }
                        },
                        {
                            label: t('menu.record.offline_zoom', 'Zoom Çevrim Dışı Önayar...'),
                            click: () => {
                                const { openRecordingWizard } = require('./dialog-windows');
                                openRecordingWizard(mainWindow, { launchProfile: 'offline-zoom' });
                            }
                        },
                        {
                            label: t('menu.record.offline_meet', 'Google Meet Çevrim Dışı Önayar...'),
                            click: () => {
                                const { openRecordingWizard } = require('./dialog-windows');
                                openRecordingWizard(mainWindow, { launchProfile: 'offline-meet' });
                            }
                        },
                        {
                            label: t('menu.record.offline_teams', 'Microsoft Teams Çevrim Dışı Önayar...'),
                            click: () => {
                                const { openRecordingWizard } = require('./dialog-windows');
                                openRecordingWizard(mainWindow, { launchProfile: 'offline-teams' });
                            }
                        }
                    ]
                },
                {
                    label: t('menu.record.live_broadcast_presets', 'Canlı Yayın'),
                    submenu: [
                        {
                            label: t('menu.record.live_broadcast_fullscreen', 'Tam Ekran Canlı Yayın Preseti...'),
                            click: () => {
                                const { openRecordingWizard } = require('./dialog-windows');
                                openRecordingWizard(mainWindow, { launchProfile: 'broadcast' });
                            }
                        },
                        {
                            label: t('menu.record.live_broadcast_zoom', 'Zoom Canlı Yayın Preseti...'),
                            click: () => {
                                const { openRecordingWizard } = require('./dialog-windows');
                                openRecordingWizard(mainWindow, { launchProfile: 'broadcast-zoom' });
                            }
                        },
                        {
                            label: t('menu.record.live_broadcast_meet', 'Google Meet Canlı Yayın Preseti...'),
                            click: () => {
                                const { openRecordingWizard } = require('./dialog-windows');
                                openRecordingWizard(mainWindow, { launchProfile: 'broadcast-meet' });
                            }
                        },
                        {
                            label: t('menu.record.live_broadcast_teams', 'Microsoft Teams Canlı Yayın Preseti...'),
                            click: () => {
                                const { openRecordingWizard } = require('./dialog-windows');
                                openRecordingWizard(mainWindow, { launchProfile: 'broadcast-teams' });
                            }
                        },
                        {
                            label: t('menu.record.youtube_chat_watch', 'YouTube Sohbetini İzle...'),
                            click: () => {
                                const { openRecordingWizard } = require('./dialog-windows');
                                // Intentionally menu-only for now; there is no default shortcut manager action for this utility flow.
                                openRecordingWizard(mainWindow, { launchProfile: 'broadcast-chat-watch' });
                            }
                        }
                    ]
                },
                {
                    label: t('menu.record.live_effects', 'Canlı Efekt Paneli...'),
                    click: () => {
                        const { openLiveEffectsPanel } = require('./dialog-windows');
                        openLiveEffectsPanel(mainWindow);
                    }
                },
                {
                    label: t('menu.record.resume_active_broadcast', 'Etkin Canlı Yayına Geri Dön'),
                    enabled: hasActiveRecordingWizardSession(),
                    click: () => {
                        const { resumeActiveRecordingWizard } = require('./dialog-windows');
                        resumeActiveRecordingWizard(mainWindow);
                    }
                }
            ]
        },

        // GİT MENÜSÜ
        {
            label: t('menu.goto.label', 'Git'),
            submenu: [
                {
                    label: t('menu.play.goto_timecode', 'Zaman Koduna Git...'),
                    accelerator: 'CmdOrCtrl+G',
                    click: () => {
                        mainWindow.webContents.send('goto-time-dialog');
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.play.goto_start', 'Başa Git'),
                    accelerator: 'CmdOrCtrl+Home',
                    click: () => {
                        mainWindow.webContents.send('goto-start');
                    }
                },
                {
                    label: t('menu.play.goto_end', 'Sona Git'),
                    accelerator: 'CmdOrCtrl+End',
                    click: () => {
                        mainWindow.webContents.send('goto-end');
                    }
                },
                {
                    label: t('menu.play.goto_middle', 'Ortaya Git'),
                    accelerator: 'CmdOrCtrl+Shift+Backspace',
                    click: () => {
                        mainWindow.webContents.send('goto-middle');
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.goto.next_marker', 'Sonraki İşaretçi'),
                    accelerator: 'Alt+Right',
                    click: () => {
                        mainWindow.webContents.send('goto-next-marker');
                    }
                },
                {
                    label: t('menu.goto.previous_marker', 'Önceki İşaretçi'),
                    accelerator: 'Alt+Left',
                    click: () => {
                        mainWindow.webContents.send('goto-prev-marker');
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.goto.selection_start', 'Seçimin Başına Git'),
                    accelerator: 'CmdOrCtrl+J',
                    click: () => {
                        mainWindow.webContents.send('goto-selection-start');
                    }
                },
                {
                    label: t('menu.goto.selection_end', 'Seçimin Sonuna Git'),
                    accelerator: 'CmdOrCtrl+L',
                    click: () => {
                        mainWindow.webContents.send('goto-selection-end');
                    }
                }
            ]
        },

        // İŞARETÇİLER MENÜSÜ
        {
            label: t('menu.markers.label', 'İşaretçiler'),
            submenu: [
                {
                    label: t('menu.markers.add', 'İşaretçi Ekle'),
                    accelerator: 'M',
                    click: () => {
                        mainWindow.webContents.send('marker-add');
                    }
                },
                {
                    label: t('menu.markers.delete', 'İşaretçi Sil'),
                    click: () => {
                        mainWindow.webContents.send('marker-delete');
                    }
                },
                {
                    label: t('menu.markers.clear_all', 'Tüm İşaretçileri Temizle'),
                    click: () => {
                        mainWindow.webContents.send('marker-clear-all');
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.markers.list', 'İşaretçi Listesi...'),
                    click: () => {
                        mainWindow.webContents.send('marker-list-dialog');
                    }
                }
            ]
        },

        // YAPAY ZEKA MENÜSÜ
        {
            label: t('menu.ai.label', 'Yapay Zeka'),
            submenu: [
                {
                    label: t('menu.ai.describe_current_position', 'Bulunduğun Konumu Betimle'),
                    accelerator: 'CmdOrCtrl+Alt+V',
                    click: () => {
                        mainWindow.webContents.send('ai-describe-current-position', 5);
                    }
                },
                {
                    label: t('menu.ai.describe_selection', 'Seçimi Betimle...'),
                    accelerator: 'CmdOrCtrl+Alt+D',
                    click: () => {
                        mainWindow.webContents.send('edit-describe-selection');
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.ai.intelligent_selection', 'Akıllı Seçim...'),
                    accelerator: 'CmdOrCtrl+I',
                    click: () => {
                        mainWindow.webContents.send('intelligent-selection');
                    }
                },
                { type: 'separator' },
                {
                    label: t('menu.ai.api_key', 'Gemini API Anahtarı...'),
                    click: () => {
                        mainWindow.webContents.send('edit-gemini-api-key');
                    }
                }
            ]
        },

        // YARDIM MENÜSÜ
        {
            label: t('menu.help.label', 'Yardım'),
            submenu: [
                {
                    label: t('menu.help.shortcuts', 'Klavye Kısayolları'),
                    accelerator: 'F1',
                    click: () => {
                        mainWindow.webContents.send('show-shortcuts');
                    }
                },
                {
                    label: t('menu.help.keyboard_manager', 'Klavye Kısayol Yöneticisi...'),
                    accelerator: 'CmdOrCtrl+K',
                    click: () => {
                        mainWindow.webContents.send('show-keyboard-manager');
                    }
                },
                {
                    label: t('menu.help.help_menu', 'Yardım...'),
                    accelerator: 'F2',
                    click: () => {
                        mainWindow.webContents.send('show-help');
                    }
                },
                {
                    label: t('menu.help.feedback', 'Geri Bildirim Gönder...'),
                    accelerator: 'F3',
                    click: () => {
                        mainWindow.webContents.send('show-feedback');
                    }
                },
                {
                    label: t('menu.help.startup_welcome', 'Başlangıç Ekranı'),
                    click: () => {
                        mainWindow.webContents.send('show-startup-welcome');
                    }
                },
                { type: 'separator' },
                {
                    label: t('messages.about_label', 'About'),
                    click: () => {
                        const options = {
                            type: 'info',
                            title: t('messages.about_title', 'About EVD'),
                            message: t('messages.app_display_name', 'EVD'),
                            detail: t('messages.about_detail', 'Version 3.9991\n\nKeyboard-first video editor designed for blind and low-vision users.\n\nProgram Icon: Hands and ears editing video\n\n© 2025-2026 Engin Yılmaz\nAll rights reserved.')
                        };
                        announceDialogForAccessibility(mainWindow, options).then(() => {
                            dialog.showMessageBox(mainWindow, options);
                        });
                    }
                }
            ]
        }
    ];

    // Windows ekran okuyucularında native menu semantics daha güvenilir çalışıyor.
    // Alt menü öğelerinin label/accelerator yapısını değiştirmek, ilk öğede
    // odakla eylem arasında "hayalet" bir adım oluşmasına neden olabiliyor.
    const finalTemplate = process.platform === 'win32'
        ? template
        : addShortcutHints(template, currentLanguage);

    return Menu.buildFromTemplate(finalTemplate);
}

module.exports = { createMenu, addToRecentFiles };
