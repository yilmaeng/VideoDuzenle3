const { Menu, dialog, shell, app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const i18n = require('./i18n');
const editorMenuState = require('../shared/editor-menu-state');
const editorMenuBindings = new WeakMap();

function bindEditorMenu(mainWindow, menu) {
    const contents = mainWindow.webContents;
    let binding = editorMenuBindings.get(contents);
    if (!binding) {
        binding = { menu, state: {} };
        editorMenuBindings.set(contents, binding);
        const refresh = () => {
            if (!applyEditorMenuState(binding)) return;
            // MenuItem.label assignment does not update the native menu text.
            const refreshed = createMenu(mainWindow);
            if (process.platform !== 'darwin' && mainWindow.setMenu) mainWindow.setMenu(refreshed);
            else Menu.setApplicationMenu(refreshed);
        };
        contents.on('ipc-message', (event, channel, state) => {
            if (channel !== 'editor-menu-availability' || !state || typeof state !== 'object') return;
            if (event.senderFrame && event.senderFrame !== contents.mainFrame) return;
            binding.state = state;
            refresh();
        });
        contents.on('did-start-loading', () => {
            binding.state = {};
            refresh();
        });
    }
    binding.menu = menu;
    applyEditorMenuState(binding);
}

function applyEditorMenuState(binding) {
    const state = editorMenuState(binding.state);
    let labelsChanged = false;
    function visit(menu, depth = 0) {
        for (const item of menu.items) {
            const command = item.id?.startsWith('editor-') ? item.id.slice(7) : null;
            if (command && Object.hasOwn(state, command) && item.enabled !== state[command]) item.enabled = state[command];
            if (command === 'menu.edit.undo' || command === 'menu.edit.redo') {
                const operation = command.split('.').pop();
                const action = binding.state.text || !binding.state.loaded ? '' : binding.state[`${operation}Action`];
                const label = action ? i18n.t(`edit_history.menu_${operation}`, {action}) : i18n.t(command);
                if (item.label !== label) { item.label = label; labelsChanged = true; }
            }
            if (item.submenu) {
                visit(item.submenu, depth + 1);
                // Keep the top-level menu bar navigable. A nested managed
                // submenu is unavailable when none of its commands can run.
                const children = item.submenu.items.filter(child => child.type !== 'separator');
                if (depth > 0 && children.length && children.every(child => child.id?.startsWith('editor-'))) {
                    item.enabled = children.some(child => child.enabled);
                }
            }
        }
    }
    visit(binding.menu);
    return labelsChanged;
}

// Son açılan dosyalar listesi
let recentFiles = [];
const MAX_RECENT_FILES = 10;
const DESCRIPTION_SUBTITLE_GUIDE_FILES = Object.freeze({
    tr: 'evd-betimleme-altyazi-editoru-hizli-baslangic-kilavuzu.html',
    en: 'evd-description-subtitle-editor-quick-start-guide.html',
    de: 'evd-beschreibungs-und-untertitel-editor-schnellstartanleitung.html',
    es: 'guia-inicio-rapido-editor-audiodescripcion-subtitulos-evd.html',
    fr: 'guide-demarrage-rapide-editeur-audiodescription-sous-titres-evd.html'
});
const REVIEW_PACKAGE_GUIDE_FILES = Object.freeze({
    tr: 'evd-son-kontrol-paketi-kullanim-kilavuzu.html',
    en: 'evd-review-package-user-guide.html',
    de: 'evd-pruefpaket-benutzerhandbuch.html',
    es: 'guia-uso-paquete-revision-evd.html',
    fr: 'guide-utilisation-package-controle-evd.html'
});
const SUBTITLE_VOICEOVER_GUIDE_FILES = Object.freeze({
    tr: 'evd-altyazi-seslendirme-ve-duzenleme-kilavuzu.html',
    en: 'evd-subtitle-voiceover-editing-guide.html',
    de: 'evd-untertitel-sprachausgabe-bearbeitung-anleitung.html',
    es: 'guia-evd-locucion-edicion-subtitulos.html',
    fr: 'guide-evd-voix-edition-sous-titres.html'
});
const RECENT_FILES_STORE_KEY = 'recent_files';

function normalizeRecentFiles(files) {
    const seen = new Set();
    const list = Array.isArray(files) ? files : [];

    return list
        .map(filePath => String(filePath || '').trim())
        .filter(filePath => {
            if (!filePath) {
                return false;
            }
            const key = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        })
        .slice(0, MAX_RECENT_FILES);
}

function loadRecentFiles() {
    if (!i18n.store) {
        return recentFiles;
    }
    recentFiles = normalizeRecentFiles(i18n.store.get(RECENT_FILES_STORE_KEY, recentFiles));
    return recentFiles;
}

function saveRecentFiles() {
    if (!i18n.store) {
        return;
    }
    i18n.store.set(RECENT_FILES_STORE_KEY, recentFiles);
}

function openMediaOrProject(mainWindow, filePath) {
    if (!mainWindow || mainWindow.isDestroyed() || !filePath) {
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.eng') {
        const { openProjectFile } = require('./slideshow-handler');
        openProjectFile(mainWindow, filePath);
        return;
    }
    if (ext === '.kve') {
        mainWindow.webContents.send('project-open-file', filePath);
        return;
    }
    mainWindow.webContents.send('file-open', filePath);
}

function rebuildApplicationMenu(mainWindow) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    Menu.setApplicationMenu(createMenu(mainWindow));
}

function addToRecentFiles(filePath, mainWindow = null) {
    if (!filePath) return;
    const normalizedPath = path.resolve(filePath);
    loadRecentFiles();
    recentFiles = recentFiles.filter(f => {
        const current = process.platform === 'win32' ? f.toLowerCase() : f;
        const next = process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
        return current !== next;
    });
    recentFiles.unshift(normalizedPath);
    if (recentFiles.length > MAX_RECENT_FILES) {
        recentFiles = recentFiles.slice(0, MAX_RECENT_FILES);
    }
    saveRecentFiles();
    if (mainWindow) {
        rebuildApplicationMenu(mainWindow);
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
        await new Promise((resolve) => setTimeout(resolve, 420));
    } catch (error) {
        console.warn('Menu dialog accessibility announcement failed:', error.message);
    }
}

function getShortcutTokenMap(lang) {
    const isMac = process.platform === 'darwin';
    const modKey = isMac ? 'Cmd' : 'Ctrl';
    const altKey = isMac ? 'Option' : 'Alt';
    if (lang === 'tr') {
        return {
            CmdOrCtrl: modKey,
            CommandOrControl: modKey,
            Cmd: 'Cmd',
            Command: 'Cmd',
            Meta: 'Cmd',
            Ctrl: 'Ctrl',
            Control: 'Ctrl',
            Alt: altKey,
            Option: 'Option',
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
        CmdOrCtrl: modKey,
        CommandOrControl: modKey,
        Cmd: 'Cmd',
        Command: 'Cmd',
        Meta: 'Cmd',
        Ctrl: 'Ctrl',
        Control: 'Ctrl',
        Alt: altKey,
        Option: 'Option',
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

async function isEditableFocused(mainWindow) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return false;
    }
    try {
        return Boolean(await mainWindow.webContents.executeJavaScript(`
            (() => {
                const el = document.activeElement;
                if (!el) return false;
                const tag = String(el.tagName || '').toLowerCase();
                if (tag === 'textarea') return true;
                if (tag === 'input') {
                    const type = String(el.type || 'text').toLowerCase();
                    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color'].includes(type);
                }
                return Boolean(el.isContentEditable);
            })()
        `, true));
    } catch (_error) {
        return false;
    }
}

function createTextAwareEditClick(mainWindow, action, nativeAction) {
    return async () => {
        if (await isEditableFocused(mainWindow)) {
            if (typeof mainWindow.webContents[nativeAction] === 'function') {
                mainWindow.webContents[nativeAction]();
            }
            return;
        }
        mainWindow.webContents.send(action);
    };
}

function buildRecentFilesSubmenu(mainWindow) {
    loadRecentFiles();
    const existingFiles = recentFiles.filter(filePath => {
        try {
            return filePath && fs.existsSync(filePath);
        } catch (_error) {
            return false;
        }
    });

    if (existingFiles.length !== recentFiles.length) {
        recentFiles = existingFiles;
        saveRecentFiles();
    }

    if (existingFiles.length === 0) {
        return [{
            availabilityKey: 'menu.file.no_recent_files',

            label: t('menu.file.no_recent_files', 'Son açılan dosya yok'),
            enabled: false
        }];
    }

    return existingFiles.map((filePath, index) => ({
        label: `${index + 1}. ${path.basename(filePath)}`,
        toolTip: filePath,
        click: () => {
            addToRecentFiles(filePath, mainWindow);
            openMediaOrProject(mainWindow, filePath);
        }
    }));
}

function formatEmergencyStopResultDetail(result) {
    const lines = [];
    const obs = result?.obs || {};
    const youtube = result?.youtube || {};

    if (obs.success === false) {
        lines.push(t('menu.record.emergency_stop_obs_failed', 'OBS yayını durdurulamadı: {error}', {
            error: obs.error || t('menu.record.emergency_stop_unknown_error', 'Bilinmeyen hata')
        }));
    } else if (obs.stopped) {
        lines.push(t('menu.record.emergency_stop_obs_stopped', 'OBS canlı yayın gönderimi durduruldu.'));
    } else {
        lines.push(t('menu.record.emergency_stop_obs_inactive', 'OBS tarafında aktif canlı yayın gönderimi bulunamadı.'));
    }

    if (youtube.success === false) {
        lines.push(t('menu.record.emergency_stop_youtube_failed', 'YouTube yayını tamamlanamadı: {error}', {
            error: youtube.error || t('menu.record.emergency_stop_unknown_error', 'Bilinmeyen hata')
        }));
    } else if (youtube.completed) {
        const title = youtube.broadcast?.title || youtube.session?.title || '';
        lines.push(title
            ? t('menu.record.emergency_stop_youtube_completed_with_title', 'YouTube yayını tamamlandı: {title}', { title })
            : t('menu.record.emergency_stop_youtube_completed', 'YouTube yayını tamamlandı.'));
    } else {
        lines.push(t('menu.record.emergency_stop_youtube_not_tracked', 'Tamamlanacak kayıtlı bir YouTube canlı yayın kimliği bulunamadı.'));
    }

    return lines.join('\n');
}

async function runEmergencyStopLiveBroadcast(mainWindow) {
    const title = t('menu.record.emergency_stop_live_broadcast_result_title', 'Acil canlı yayın durdurma');
    const message = t('menu.record.emergency_stop_live_broadcast_running', 'Devam eden canlı yayın güvenli biçimde durdurulmaya çalışılıyor.');
    await announceDialogForAccessibility(mainWindow, { title, message });

    let result = null;
    try {
        const { emergencyStopLiveBroadcast } = require('./emergency-broadcast-handler');
        result = await emergencyStopLiveBroadcast();
    } catch (error) {
        result = {
            success: false,
            obs: { success: false, error: error.message || String(error) },
            youtube: { success: true, completed: false }
        };
    }

    const resultTitle = result?.success
        ? t('menu.record.emergency_stop_live_broadcast_done_title', 'Acil durdurma tamamlandı')
        : t('menu.record.emergency_stop_live_broadcast_warning_title', 'Acil durdurma kısmen tamamlandı');
    const resultMessage = result?.success
        ? t('menu.record.emergency_stop_live_broadcast_done', 'Acil canlı yayın durdurma komutu çalıştırıldı.')
        : t('menu.record.emergency_stop_live_broadcast_partial', 'Acil durdurma çalıştı ancak bazı adımlar tamamlanamadı.');
    const detail = formatEmergencyStopResultDetail(result);

    await announceDialogForAccessibility(mainWindow, {
        title: resultTitle,
        message: resultMessage,
        detail
    });

    await dialog.showMessageBox(mainWindow, {
        type: result?.success ? 'info' : 'warning',
        title: resultTitle,
        message: resultMessage,
        detail,
        buttons: [t('common.close', 'Kapat')],
        defaultId: 0,
        cancelId: 0,
        noLink: true
    });
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

async function openDescriptionSubtitleEditorGuide(mainWindow) {
    const language = i18n.getCurrentLanguage();
    const fileName = DESCRIPTION_SUBTITLE_GUIDE_FILES[language] || DESCRIPTION_SUBTITLE_GUIDE_FILES.en;
    const guideDirectory = app.isPackaged
        ? path.join(process.resourcesPath, 'guides')
        : path.join(app.getAppPath(), 'docs');
    const guidePath = path.join(guideDirectory, fileName);

    try {
        if (!fs.existsSync(guidePath)) {
            throw new Error('Guide file not found: ' + guidePath);
        }
        const openError = await shell.openPath(guidePath);
        if (openError) {
            throw new Error(openError);
        }
    } catch (error) {
        const options = {
            type: 'error',
            title: t('menu.help.guide_open_error_title', 'Could Not Open Guide'),
            message: t('menu.help.guide_open_error', 'The Description and Subtitle Editor guide could not be opened.'),
            detail: error.message
        };
        await announceDialogForAccessibility(mainWindow, options);
        await dialog.showMessageBox(mainWindow, options);
    }
}
async function openReviewPackageGuide(mainWindow) {
    const language = i18n.getCurrentLanguage();
    const fileName = REVIEW_PACKAGE_GUIDE_FILES[language] || REVIEW_PACKAGE_GUIDE_FILES.en;
    const guideDirectory = app.isPackaged
        ? path.join(process.resourcesPath, 'guides')
        : path.join(app.getAppPath(), 'docs');
    const guidePath = path.join(guideDirectory, fileName);

    try {
        if (!fs.existsSync(guidePath)) {
            throw new Error('Guide file not found: ' + guidePath);
        }
        const openError = await shell.openPath(guidePath);
        if (openError) {
            throw new Error(openError);
        }
    } catch (error) {
        const options = {
            type: 'error',
            title: t('menu.help.review_guide_open_error_title', 'Could Not Open Review Guide'),
            message: t('menu.help.review_guide_open_error', 'The Review Package user guide could not be opened.'),
            detail: error.message
        };
        await announceDialogForAccessibility(mainWindow, options);
        await dialog.showMessageBox(mainWindow, options);
    }
}
async function openSubtitleVoiceoverGuide(mainWindow) {
    const language = i18n.getCurrentLanguage();
    const fileName = SUBTITLE_VOICEOVER_GUIDE_FILES[language] || SUBTITLE_VOICEOVER_GUIDE_FILES.en;
    const guideDirectory = app.isPackaged
        ? path.join(process.resourcesPath, 'guides')
        : path.join(app.getAppPath(), 'docs');
    const guidePath = path.join(guideDirectory, fileName);

    try {
        if (!fs.existsSync(guidePath)) {
            throw new Error('Guide file not found: ' + guidePath);
        }
        const openError = await shell.openPath(guidePath);
        if (openError) {
            throw new Error(openError);
        }
    } catch (error) {
        const options = {
            type: 'error',
            title: t('menu.help.subtitle_voiceover_guide_open_error_title', 'Could Not Open Subtitle Voiceover Guide'),
            message: t('menu.help.subtitle_voiceover_guide_open_error', 'The Subtitle Voiceover and Editing guide could not be opened.'),
            detail: error.message
        };
        await announceDialogForAccessibility(mainWindow, options);
        await dialog.showMessageBox(mainWindow, options);
    }
}
function createMenu(mainWindow) {
    const currentLanguage = i18n.getCurrentLanguage();
    // Electron's native macOS menu accepts ASCII accelerator keys only.
    // Preserve the established Turkish shortcut on Windows and use its ASCII
    // counterpart on macOS so menu creation does not emit an invalid shortcut.
    const applyTransitionAccelerator = process.platform === 'darwin'
        ? 'T'
        : (currentLanguage === 'tr' ? 'Ş' : 'T');
    const { hasActiveRecordingWizardSession } = require('./dialog-windows');
    const template = [
        // DOSYA MENÜSÜ
        {
            availabilityKey: 'menu.file.label',

            label: t('menu.file.label', '&Dosya'),
            submenu: [
                {
                    availabilityKey: 'menu.file.new_slideshow',

                    label: t('menu.file.new_slideshow', 'Yeni Slayt Projesi...'),
                    accelerator: 'CmdOrCtrl+Shift+N',
                    click: () => {
                        const { openNewProjectDialog } = require('./slideshow-handler');
                        openNewProjectDialog(mainWindow);
                    }
                },
                {
                    availabilityKey: 'menu.file.open_project',

                    label: t('menu.file.open_project', 'Proje Aç...'),
                    accelerator: 'CmdOrCtrl+Shift+O',
                    click: async () => {
                        const result = await dialog.showOpenDialog(mainWindow, {
                            title: t('messages.open_project_title', 'Open Project'),
                            filters: [
                                { name: t('messages.project_filters.all_projects', 'All Projects (*.kve, *.eng)'), extensions: ['kve', 'eng'] }
                            ],
                            properties: ['openFile']
                        });

                        if (!result.canceled && result.filePaths.length > 0) {
                            const filePath = result.filePaths[0];
                            const ext = path.extname(filePath).toLowerCase();

                            if (ext === '.eng') {
                                addToRecentFiles(filePath, mainWindow);
                                const { openProjectFile } = require('./slideshow-handler');
                                // openProjectFile might expect to open dialog itself if no arg. 
                                // We will modify it or call a specific loader if available.
                                // For now, let's pass the path and ensure handler supports it.
                                openProjectFile(mainWindow, filePath);
                            } else {
                                // .kve dosyasını renderer'a gönder
                                addToRecentFiles(filePath, mainWindow);
                                mainWindow.webContents.send('project-open-file', filePath);
                            }
                        }
                    }
                },
                {
                    availabilityKey: 'menu.file.save_project',

                    label: t('menu.file.save_project', 'Projeyi Kaydet (.kve)...'),
                    accelerator: 'CmdOrCtrl+Shift+P',
                    click: () => {
                        mainWindow.webContents.send('project-save');
                    }
                },
                {
                    // Intentionally not added to the keyboard shortcut manager.
                    // This is a niche helper for multi-window recording/tutorial workflows.
                    availabilityKey: 'menu.file.new_window',

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
                    availabilityKey: 'menu.file.new',

                    label: t('menu.file.new', 'Yeni'),
                    accelerator: 'CmdOrCtrl+N',
                    click: () => {
                        mainWindow.webContents.send('file-new');
                    }
                },
                {
                    availabilityKey: 'menu.file.open',

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
                            addToRecentFiles(filePath, mainWindow);
                            mainWindow.webContents.send('file-open', filePath);
                        }
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.file.save',

                    label: t('menu.file.save', 'Kaydet'),
                    accelerator: 'CmdOrCtrl+S',
                    click: () => {
                        mainWindow.webContents.send('file-save');
                    }
                },
                {
                    availabilityKey: 'menu.file.save_as',

                    label: t('menu.file.save_as', 'Videoyu Farklı Kaydet...'),
                    accelerator: 'CmdOrCtrl+Shift+S',
                    click: async () => {
                        const result = await dialog.showSaveDialog(mainWindow, {
                            title: t('messages.save_video_as', 'Save Video As'),
                            filters: [
                                { name: t('messages.file_filter_mp4_video', 'MP4 Video'), extensions: ['mp4'] },
                                { name: t('messages.file_filter_mov_video', 'MOV Video'), extensions: ['mov'] },
                                { name: t('messages.file_filter_mkv_video', 'Matroska Video'), extensions: ['mkv'] },
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
                    availabilityKey: 'menu.file.fast_export',
                    label: t('menu.file.fast_export', 'Hibrit Akıllı Dışa Aktar...'),
                    click: async () => {
                        const result = await dialog.showSaveDialog(mainWindow, {
                            title: t('menu.file.fast_export', 'Hibrit Akıllı Dışa Aktar...'),
                            filters: [
                                { name: t('messages.file_filter_mp4_video', 'MP4 Video'), extensions: ['mp4'] },
                                { name: t('messages.file_filter_mov_video', 'MOV Video'), extensions: ['mov'] },
                                { name: t('messages.file_filter_mkv_video', 'Matroska Video'), extensions: ['mkv'] }
                            ]
                        });
                        if (!result.canceled) {
                            // Keep the existing IPC event name for compatibility with packaged renderers.
                            mainWindow.webContents.send('file-save-fast', result.filePath);
                        }
                    }
                },
                {
                    availabilityKey: 'menu.file.save_selection',

                    label: t('menu.file.save_selection', 'Seçimi Kaydet...'),
                    accelerator: 'CmdOrCtrl+Alt+S',
                    click: () => {
                        mainWindow.webContents.send('file-save-selection-request');
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.file.export_video_only',

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
                    availabilityKey: 'menu.file.export_audio_only',

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
                {
                    // No default accelerator: this can process long media and is safer as an explicit menu action.
                    availabilityKey: 'menu.file.elevenlabs_dubbing_import',

                    label: t('menu.file.elevenlabs_dubbing_import', 'ElevenLabs ile Dublaj İçin Dosya İçe Aktar...'),
                    click: async () => {
                        const result = await dialog.showOpenDialog(mainWindow, {
                            title: t('elevenlabs_dubbing_tool.import_dialog_title', 'ElevenLabs dublaj için dosya seçin'),
                            filters: [
                                { name: t('runtime.app.video_files_filter', 'Video Files'), extensions: ['mp4', 'wmv', 'avi', 'mkv', 'mov', 'webm', 'flv', 'm4v'] },
                                { name: t('dialog.common.all_files', 'All Files'), extensions: ['*'] }
                            ],
                            properties: ['openFile']
                        });
                        if (result.canceled || !result.filePaths?.[0]) {
                            return;
                        }
                        const { hasElevenLabsApiKey } = require('./elevenlabs-handler');
                        if (!hasElevenLabsApiKey()) {
                            const options = {
                                type: 'warning',
                                title: t('elevenlabs_dubbing_tool.api_key_missing_title', 'ElevenLabs API Anahtarı Gerekli'),
                                message: t('elevenlabs_dubbing_tool.api_key_missing_message', 'ElevenLabs API anahtarı bulunamadı.'),
                                detail: t('elevenlabs_dubbing_tool.api_key_missing_detail', 'Yapay Zeka menüsünden ElevenLabs API Anahtarı öğesini açıp anahtarınızı ekleyin. Anahtarı ElevenLabs hesabınızda API Keys bölümünden alabilirsiniz.'),
                                buttons: [t('messages.ok', 'Tamam')],
                                defaultId: 0,
                                cancelId: 0
                            };
                            await announceDialogForAccessibility(mainWindow, options);
                            await dialog.showMessageBox(mainWindow, options);
                            return;
                        }
                        const { openElevenLabsDubbingTool } = require('./dialog-windows');
                        openElevenLabsDubbingTool(mainWindow, {
                            filePath: result.filePaths[0]
                        });
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.file.sync_external_audio',

                    label: t('menu.file.sync_external_audio', 'Harici Sesi Videoyla Senkronla...'),
                    click: () => {
                        const { openSyncWizard } = require('./dialog-windows');
                        openSyncWizard(mainWindow, 'A');
                    }
                },
                {
                    availabilityKey: 'menu.file.sync_reference_audio',

                    label: t('menu.file.sync_reference_audio', 'Referans Sesle Video Kaydet...'),
                    click: () => {
                        const { openSyncWizard } = require('./dialog-windows');
                        openSyncWizard(mainWindow, 'B');
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.file.recent_files',

                    label: t('menu.file.recent_files', 'Son Açılan Dosyalar'),
                    submenu: buildRecentFilesSubmenu(mainWindow)
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.file.close',

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
                    availabilityKey: 'menu.file.language',

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
                    availabilityKey: 'menu.file.quit',

                    label: t('menu.file.quit', 'Çıkış'),
                    accelerator: process.platform === 'darwin' ? 'Command+Q' : 'Alt+F4',
                    click: () => {
                        mainWindow.webContents.send('app-quit-request');
                    }
                }
            ]
        },

        // DÜZENLE MENÜSÜ
        {
            availabilityKey: 'menu.edit.label',

            label: t('menu.edit.label', 'Düzenle'),
            submenu: [
                {
                    availabilityKey: 'menu.edit.undo',

                    label: t('menu.edit.undo', 'Geri Al'),

                    accelerator: 'CmdOrCtrl+Z',
                    click: () => {
                        createTextAwareEditClick(mainWindow, 'edit-undo', 'undo')();
                    }
                },
                {
                    availabilityKey: 'menu.edit.redo',

                    label: t('menu.edit.redo', 'Yinele'),

                    accelerator: 'CmdOrCtrl+Y',
                    click: () => {
                        createTextAwareEditClick(mainWindow, 'edit-redo', 'redo')();
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.edit.speech_search',
                    label: t('speech_search.title'),
                    click: () => mainWindow.webContents.send('speech-search-open')
                },
                {
                    availabilityKey: 'menu.edit.vocal_separation',
                    label: t('vocal_separation.title'),
                    click: () => mainWindow.webContents.send('vocal-separation-open')
                },
                {
                    availabilityKey: 'menu.edit.video_crop',
                    label: t('video_crop.title'),
                    click: () => mainWindow.webContents.send('video-crop-open')
                },
                {
                    availabilityKey: 'menu.edit.speech_search_export',
                    label: t('speech_search.archive.export'),
                    click: () => mainWindow.webContents.send('speech-search-transfer', 'export')
                },
                {
                    availabilityKey: 'menu.edit.speech_search_import',
                    label: t('speech_search.archive.import'),
                    click: () => mainWindow.webContents.send('speech-search-transfer', 'import')
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.edit.cut',

                    label: t('menu.edit.cut', 'Kes'),

                    accelerator: 'CmdOrCtrl+X',
                    click: createTextAwareEditClick(mainWindow, 'edit-cut', 'cut')
                },
                {
                    availabilityKey: 'menu.edit.copy',

                    label: t('menu.edit.copy', 'Kopyala'),

                    accelerator: 'CmdOrCtrl+C',
                    click: createTextAwareEditClick(mainWindow, 'edit-copy', 'copy')
                },
                {
                    availabilityKey: 'menu.edit.paste',

                    label: t('menu.edit.paste', 'Yapıştır'),

                    accelerator: 'CmdOrCtrl+V',
                    click: createTextAwareEditClick(mainWindow, 'edit-paste', 'paste')
                },
                {
                    availabilityKey: 'menu.edit.delete',

                    label: t('menu.edit.delete', 'Sil'),

                    accelerator: 'Delete',
                    click: createTextAwareEditClick(mainWindow, 'edit-delete', 'delete')
                },
                {
                    availabilityKey: 'menu.edit.split',

                    label: t('menu.edit.split', 'Böl'),

                    accelerator: 'C',
                    click: () => {
                        mainWindow.webContents.send('edit-split');
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.edit.selection',

                    label: t('menu.edit.selection', 'Seçim'),
                    submenu: [
                        {
                            availabilityKey: 'menu.edit.select_all',

                            label: t('menu.edit.select_all', 'Tümünü Seç'),

                            accelerator: 'CmdOrCtrl+A',
                            click: createTextAwareEditClick(mainWindow, 'select-all', 'selectAll')
                        },
                        {
                            availabilityKey: 'menu.edit.clear_selection',

                            label: t('menu.edit.clear_selection', 'Seçimi Temizle'),

                            accelerator: 'Escape',
                            click: () => {
                                mainWindow.webContents.send('select-clear');
                            }
                        },
                        { type: 'separator' },
                        {
                            availabilityKey: 'menu.edit.select_range',

                            label: t('menu.edit.select_range', 'Aralık Seç...'),

                            accelerator: 'CmdOrCtrl+R',
                            click: () => {
                                mainWindow.webContents.send('select-range-dialog');
                            }
                        },
                        {
                            availabilityKey: 'menu.edit.select_between_markers',
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
                            availabilityKey: 'menu.edit.change_speed',

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
                    availabilityKey: 'menu.edit.video_properties',

                    label: t('menu.edit.video_properties', 'Video Özellikleri...'),

                    click: () => {
                        mainWindow.webContents.send('edit-video-properties');
                    }
                },
                {
                    availabilityKey: 'menu.edit.audio_settings',

                    label: t('menu.edit.audio_settings', 'Ses Ayarları...'),

                    accelerator: 'Alt+Shift+S',
                    click: () => {
                        mainWindow.webContents.send('show-audio-settings-dialog');
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.edit.list_silences',

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
            availabilityKey: 'menu.play.label',

            label: t('menu.play.label', 'Oynat'),
            submenu: [
                {
                    availabilityKey: 'menu.play.toggle',

                    label: t('menu.play.toggle', 'Oynat / Duraklat'),
                    accelerator: 'Space',
                    click: () => {
                        mainWindow.webContents.send('playback-toggle');
                    }
                },
                {
                    availabilityKey: 'menu.play.pause_at_position',

                    label: t('menu.play.pause_at_position', 'Pozisyonda Duraklat'),
                    accelerator: 'Enter',
                    click: () => {
                        mainWindow.webContents.send('playback-pause-at-position');
                    }
                },
                {
                    availabilityKey: 'menu.play.play_selection',

                    label: t('menu.play.play_selection', 'Seçili Alanı Oynat'),
                    accelerator: 'Shift+Space',
                    click: () => {
                        mainWindow.webContents.send('playback-play-selection');
                    }
                },
                {
                    availabilityKey: 'menu.play.preview_cut',

                    label: t('menu.play.preview_cut', 'Kesim Önizleme (Seçimsiz)'),
                    accelerator: 'CmdOrCtrl+Shift+Space',
                    click: () => {
                        mainWindow.webContents.send('playback-play-cut-preview');
                    }
                },
                {
                    availabilityKey: 'menu.play.skip_silence',

                    label: t('menu.play.skip_silence', 'Sessizliği Atla'),
                    accelerator: 'CmdOrCtrl+Shift+J',
                    click: () => {
                        mainWindow.webContents.send('playback-skip-silence');
                    }
                },
                {
                    availabilityKey: 'menu.play.forward_1s',

                    label: t('menu.play.forward_1s', '1 Saniye İleri'),
                    accelerator: 'Right',
                    click: () => {
                        mainWindow.webContents.send('seek-forward', 1);
                    }
                },
                {
                    availabilityKey: 'menu.play.backward_1s',

                    label: t('menu.play.backward_1s', '1 Saniye Geri'),
                    accelerator: 'Left',
                    click: () => {
                        mainWindow.webContents.send('seek-backward', 1);
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.play.forward_30s',

                    label: t('menu.play.forward_30s', '30 Saniye İleri'),
                    accelerator: 'CmdOrCtrl+Right',
                    click: () => {
                        mainWindow.webContents.send('seek-forward', 30);
                    }
                },
                {
                    availabilityKey: 'menu.play.backward_30s',

                    label: t('menu.play.backward_30s', '30 Saniye Geri'),
                    accelerator: 'CmdOrCtrl+Left',
                    click: () => {
                        mainWindow.webContents.send('seek-backward', 30);
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.play.forward_5m',

                    label: t('menu.play.forward_5m', '5 Dakika İleri'),
                    accelerator: 'CmdOrCtrl+Alt+Right',
                    click: () => {
                        mainWindow.webContents.send('seek-forward', 300);
                    }
                },
                {
                    availabilityKey: 'menu.play.backward_5m',

                    label: t('menu.play.backward_5m', '5 Dakika Geri'),
                    accelerator: 'CmdOrCtrl+Alt+Left',
                    click: () => {
                        mainWindow.webContents.send('seek-backward', 300);
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.play.goto_start',

                    label: t('menu.play.goto_start', 'Başa Git'),
                    click: () => {
                        mainWindow.webContents.send('goto-start');
                    }
                },
                {
                    availabilityKey: 'menu.play.goto_end',

                    label: t('menu.play.goto_end', 'Sona Git'),
                    click: () => {
                        mainWindow.webContents.send('goto-end');
                    }
                },
                {
                    availabilityKey: 'menu.play.goto_middle',

                    label: t('menu.play.goto_middle', 'Ortaya Git'),
                    click: () => {
                        mainWindow.webContents.send('goto-middle');
                    }
                },
                {
                    availabilityKey: 'menu.play.goto_before_end',

                    label: t('menu.play.goto_before_end', 'Sondan 30 Saniye Önce'),
                    accelerator: 'Shift+Backspace',
                    click: () => {
                        mainWindow.webContents.send('goto-before-end');
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.play.goto_timecode',

                    label: t('menu.play.goto_timecode', 'Zaman Koduna Git...'),
                    // Cmd/Ctrl+G is registered once in the Go menu below. Electron can
                    // handle duplicate accelerators inconsistently on macOS.
                    click: () => {
                        mainWindow.webContents.send('goto-time-dialog');
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.play.fine_tune',

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
            availabilityKey: 'menu.insert.label',

            label: t('menu.insert.label', 'Ekle'),
            submenu: [
                {
                    availabilityKey: 'menu.insert.audio',

                    label: t('menu.insert.audio', 'Ses Ekle...'),
                    click: async () => {
                        // Eski: Doğrudan dosya seçimi açılıyordu
                        // Yeni: Renderer tarafına istek gönderilir, orada seçim yapılır (Dosya/Kayıt)
                        mainWindow.webContents.send('insert-audio-request');
                    }
                },
                {
                    availabilityKey: 'menu.insert.video',

                    label: t('menu.insert.video', 'Video Ekle...'),
                    click: async () => {
                        const result = await dialog.showOpenDialog(mainWindow, {
                            title: t('messages.select_video_file', 'Select Video File'),
                            filters: [
                                { name: t('runtime.app.video_files_filter', 'Video Files'), extensions: ['mp4', 'wmv', 'avi', 'mkv', 'mov', 'webm', 'flv', '3gp', 'mpg', 'mpeg', 'vob', 'm4v', 'ts', 'mts', 'm2ts'] },
                                { name: t('dialog.common.all_files', 'All Files'), extensions: ['*'] }
                            ],
                            properties: ['openFile']
                        });
                        if (!result.canceled && result.filePaths.length > 0) {
                            mainWindow.webContents.send('insert-video', result.filePaths[0]);
                        }
                    }
                },
                {
                    availabilityKey: 'menu.insert.vertical_video',

                    label: t('menu.insert.vertical_video', 'Dikey Video (Shorts/Reels) Oluştur...'),
                    click: () => {
                        const { openVerticalWizard } = require('./dialog-windows');
                        openVerticalWizard(mainWindow);
                    }
                },
                {
                    availabilityKey: 'menu.insert.vertical_video_from_selection',

                    label: t('menu.insert.vertical_video_from_selection', 'Seçili Alanı Dikey Videoya Dönüştür...'),
                    click: () => {
                        mainWindow.webContents.send('vertical-video-from-selection');
                    }
                },
                {
                    availabilityKey: 'menu.insert.vertical_video_add_selection_to_queue',

                    label: t('menu.insert.vertical_video_add_selection_to_queue', 'Seçili Alanı Kısa Video Listesine Ekle'),
                    click: () => {
                        mainWindow.webContents.send('vertical-video-queue-add-selection');
                    }
                },
                {
                    availabilityKey: 'menu.insert.vertical_video_add_marker_pairs_to_queue',

                    label: t('menu.insert.vertical_video_add_marker_pairs_to_queue', 'İşaretçileri Seçim Listesine Ekle'),
                    click: () => {
                        mainWindow.webContents.send('vertical-video-queue-add-marker-pairs');
                    }
                },
                {
                    // Intentionally menu-only for now.
                    // This dialog manages a persistent multi-step selection workflow and should not
                    // be triggered accidentally with a global shortcut until the UX settles.
                    availabilityKey: 'menu.insert.selection_queue',

                    label: t('menu.insert.selection_queue', 'Seçim Listesi...'),
                    click: () => {
                        mainWindow.webContents.send('selection-queue-open');
                    }
                },
                {
                    availabilityKey: 'menu.insert.vertical_video_queue_open',

                    label: t('menu.insert.vertical_video_queue_open', 'Kısa Video Listesini Dikey Videoya Dönüştür...'),
                    click: () => {
                        mainWindow.webContents.send('vertical-video-queue-open');
                    }
                },
                {
                    availabilityKey: 'menu.insert.vertical_video_queue_clear',

                    label: t('menu.insert.vertical_video_queue_clear', 'Kısa Video Listesini Temizle'),
                    click: () => {
                        mainWindow.webContents.send('vertical-video-queue-clear');
                    }
                },

                {
                    availabilityKey: 'menu.insert.video_layer',

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
                    availabilityKey: 'menu.insert.cta_library',

                    label: t('menu.insert.cta_library', 'CTA / Overlay Kütüphanesi...'),
                    accelerator: 'CmdOrCtrl+Shift+K',
                    click: () => {
                        mainWindow.webContents.send('show-cta-library');
                    }
                },
                {
                    availabilityKey: 'menu.insert.text',

                    label: t('menu.insert.text', 'Metin Ekle...'),
                    click: () => {
                        mainWindow.webContents.send('insert-text-dialog');
                    }
                },
                {
                    // Intentionally menu-only: this opens a detailed timing and styling workflow.
                    availabilityKey: 'menu.insert.ticker',

                    label: t('menu.insert.ticker', 'Akan Yaz? Ekle...'),
                    click: () => {
                        mainWindow.webContents.send('insert-ticker-dialog');
                    }
                },
                {
                    availabilityKey: 'menu.insert.images',

                    label: t('menu.insert.images', 'Görsel(ler) Ekle...'),
                    click: () => {
                        mainWindow.webContents.send('open-image-wizard');
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.insert.subtitle',

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
                {
                    availabilityKey: 'menu.insert.description_subtitle_editor',

                    label: t('menu.insert.description_subtitle_editor', 'Betimleme / Altyazı Editörü...'),
                    click: () => {
                        mainWindow.webContents.send('open-description-subtitle-editor-request');
                    }
                },
                // Proje açma düzenleyicide ve menüde erişilebilir; kısayol haritasını kalabalıklaştırmamak için global kısayol kullanılmaz.
                {
                    availabilityKey: 'menu.insert.subtitle_tts_project',
                    label: t('menu.insert.subtitle_tts_project', 'Altyazı Seslendirme Projesi Aç...'),
                    click: async () => {
                        const result = await dialog.showOpenDialog(mainWindow, {
                            title: t('dialog.subtitle_tts_editor.open_project_title', 'Altyazı Seslendirme Projesi Aç'),
                            filters: [{
                                name: t('dialog.subtitle_tts_editor.project_filter', 'EVD Altyazı Seslendirme Projesi'),
                                extensions: ['evdtts']
                            }],
                            properties: ['openFile']
                        });
                        if (!result.canceled && result.filePaths.length > 0) {
                            mainWindow.webContents.send('insert-subtitle', result.filePaths[0]);
                        }
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.insert.transition',

                    label: t('menu.insert.transition', 'Geçiş'),
                    submenu: [
                        {
                            availabilityKey: 'menu.insert.transition_library',

                            label: t('menu.insert.transition_library', 'Geçiş Kütüphanesi...'),
                            accelerator: 'CmdOrCtrl+Shift+T',
                            click: () => {
                                mainWindow.webContents.send('show-transition-library');
                            }
                        },
                        {
                            availabilityKey: 'menu.insert.apply_active_transition',

                            label: t('menu.insert.apply_active_transition', 'Aktif Geçişi Uygula'),
                            accelerator: applyTransitionAccelerator,
                            click: () => {
                                mainWindow.webContents.send('apply-active-transition');
                            }
                        },
                        { type: 'separator' },
                        {
                            availabilityKey: 'menu.insert.apply_transition_to_markers',

                            label: t('menu.insert.apply_transition_to_markers', 'Aktif Geçişi Tüm İşaretçilere Uygula'),
                            click: () => {
                                mainWindow.webContents.send('apply-transition-to-markers');
                            }
                        },
                        { type: 'separator' },
                        {
                            availabilityKey: 'menu.insert.transition_list',

                            label: t('menu.insert.transition_list', 'Geçiş Listesi...'),
                            click: () => {
                                mainWindow.webContents.send('show-transition-list');
                            }
                        },
                        { type: 'separator' },
                        {
                            availabilityKey: 'menu.insert.apply_all_transitions',

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
                    availabilityKey: 'menu.insert.apply_to_object',

                    label: t('menu.insert.apply_to_object', 'Nesneye Uygula (Analiz)...'),
                    accelerator: 'CmdOrCtrl+Shift+A',
                    click: () => {
                        mainWindow.webContents.send('show-object-analysis-dialog');
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.insert.insertion_queue',

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
            availabilityKey: 'menu.view.label',

            label: t('menu.view.label', 'Görünüm'),
            submenu: [
                {
                    availabilityKey: 'menu.view.rotate_90_cw',

                    label: t('menu.view.rotate_90_cw', '90° Döndür (Saat Yönünde)'),
                    click: () => {
                        mainWindow.webContents.send('rotate-video', 90);
                    }
                },
                {
                    availabilityKey: 'menu.view.rotate_90_ccw',

                    label: t('menu.view.rotate_90_ccw', '90° Döndür (Saat Yönü Tersine)'),
                    click: () => {
                        mainWindow.webContents.send('rotate-video', -90);
                    }
                },
                {
                    availabilityKey: 'menu.view.rotate_180',

                    label: t('menu.view.rotate_180', '180° Döndür'),
                    click: () => {
                        mainWindow.webContents.send('rotate-video', 180);
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.view.fullscreen',

                    label: t('menu.view.fullscreen', 'Tam Ekran'),
                    accelerator: 'F11',
                    click: () => {
                        mainWindow.setFullScreen(!mainWindow.isFullScreen());
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.view.devtools',

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
            availabilityKey: 'menu.record.label',

            label: t('menu.record.label', 'Erişilebilir Video Kaydı'),
            submenu: [
                {
                    availabilityKey: 'menu.record.wizard',

                    label: t('menu.record.wizard', 'Kayıt Sihirbazı...'),
                    accelerator: 'CmdOrCtrl+Shift+R',
                    click: () => {
                        const { openRecordingWizard } = require('./dialog-windows');
                        openRecordingWizard(mainWindow);
                    }
                },
                {
                    availabilityKey: 'menu.record.offline_presets',

                    label: t('menu.record.offline_presets', 'Çevrim Dışı Önayarlar'),
                    submenu: [
                        {
                            availabilityKey: 'menu.record.offline_fullscreen',

                            label: t('menu.record.offline_fullscreen', 'Tam Ekran Çevrim Dışı Önayar...'),
                            click: () => {
                                const { openRecordingWizard } = require('./dialog-windows');
                                openRecordingWizard(mainWindow, { launchProfile: 'interview' });
                            }
                        },
                        {
                            availabilityKey: 'menu.record.offline_zoom',

                            label: t('menu.record.offline_zoom', 'Zoom Çevrim Dışı Önayar...'),
                            click: () => {
                                const { openRecordingWizard } = require('./dialog-windows');
                                openRecordingWizard(mainWindow, { launchProfile: 'offline-zoom' });
                            }
                        },
                        {
                            availabilityKey: 'menu.record.offline_meet',

                            label: t('menu.record.offline_meet', 'Google Meet Çevrim Dışı Önayar...'),
                            click: () => {
                                const { openRecordingWizard } = require('./dialog-windows');
                                openRecordingWizard(mainWindow, { launchProfile: 'offline-meet' });
                            }
                        },
                        {
                            availabilityKey: 'menu.record.offline_teams',

                            label: t('menu.record.offline_teams', 'Microsoft Teams Çevrim Dışı Önayar...'),
                            click: () => {
                                const { openRecordingWizard } = require('./dialog-windows');
                                openRecordingWizard(mainWindow, { launchProfile: 'offline-teams' });
                            }
                        }
                    ]
                },
                {
                    availabilityKey: 'menu.record.live_broadcast_presets',

                    label: t('menu.record.live_broadcast_presets', 'Canlı Yayın'),
                    submenu: [
                        {
                            availabilityKey: 'menu.record.live_broadcast_fullscreen',

                            label: t('menu.record.live_broadcast_fullscreen', 'Tam Ekran Canlı Yayın Preseti...'),
                            click: () => {
                                const { openRecordingWizard } = require('./dialog-windows');
                                openRecordingWizard(mainWindow, { launchProfile: 'broadcast' });
                            }
                        },
                        {
                            availabilityKey: 'menu.record.live_broadcast_zoom',

                            label: t('menu.record.live_broadcast_zoom', 'Zoom Canlı Yayın Preseti...'),
                            click: () => {
                                const { openRecordingWizard } = require('./dialog-windows');
                                openRecordingWizard(mainWindow, { launchProfile: 'broadcast-zoom' });
                            }
                        },
                        {
                            availabilityKey: 'menu.record.live_broadcast_meet',

                            label: t('menu.record.live_broadcast_meet', 'Google Meet Canlı Yayın Preseti...'),
                            click: () => {
                                const { openRecordingWizard } = require('./dialog-windows');
                                openRecordingWizard(mainWindow, { launchProfile: 'broadcast-meet' });
                            }
                        },
                        {
                            availabilityKey: 'menu.record.live_broadcast_teams',

                            label: t('menu.record.live_broadcast_teams', 'Microsoft Teams Canlı Yayın Preseti...'),
                            click: () => {
                                const { openRecordingWizard } = require('./dialog-windows');
                                openRecordingWizard(mainWindow, { launchProfile: 'broadcast-teams' });
                            }
                        },
                        {
                            availabilityKey: 'menu.record.youtube_chat_watch',

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
                    availabilityKey: 'menu.record.live_effects',

                    label: t('menu.record.live_effects', 'Canlı Efekt Paneli...'),
                    click: () => {
                        const { openLiveEffectsPanel } = require('./dialog-windows');
                        openLiveEffectsPanel(mainWindow);
                    }
                },
                {
                    availabilityKey: 'menu.record.broadcast_room',

                    label: t('menu.record.broadcast_room', 'Yayın Odası...'),
                    click: () => {
                        const { openBroadcastRoom } = require('./dialog-windows');
                        openBroadcastRoom(mainWindow);
                    }
                },
                {
                    availabilityKey: 'menu.record.resume_active_broadcast',

                    label: t('menu.record.resume_active_broadcast', 'Etkin Canlı Yayına Geri Dön'),
                    enabled: hasActiveRecordingWizardSession(),
                    click: () => {
                        const { resumeActiveRecordingWizard } = require('./dialog-windows');
                        resumeActiveRecordingWizard(mainWindow);
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.record.emergency_stop_live_broadcast',

                    label: t('menu.record.emergency_stop_live_broadcast', 'Acil Canlı Yayını Durdur'),
                    click: () => {
                        // Intentionally menu-only: this command can terminate an active live stream, so it should not have a default shortcut.
                        runEmergencyStopLiveBroadcast(mainWindow).catch((error) => {
                            console.error('Emergency live broadcast stop failed:', error);
                        });
                    }
                }
            ]
        },

        // GİT MENÜSÜ
        {
            availabilityKey: 'menu.goto.label',

            label: t('menu.goto.label', 'Git'),
            submenu: [
                {
                    availabilityKey: 'menu.play.goto_timecode',

                    label: t('menu.play.goto_timecode', 'Zaman Koduna Git...'),
                    accelerator: 'CmdOrCtrl+G',
                    click: () => {
                        mainWindow.webContents.send('goto-time-dialog');
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.play.goto_start',

                    label: t('menu.play.goto_start', 'Başa Git'),
                    accelerator: 'CmdOrCtrl+Home',
                    click: () => {
                        mainWindow.webContents.send('goto-start');
                    }
                },
                {
                    availabilityKey: 'menu.play.goto_end',

                    label: t('menu.play.goto_end', 'Sona Git'),
                    accelerator: 'CmdOrCtrl+End',
                    click: () => {
                        mainWindow.webContents.send('goto-end');
                    }
                },
                {
                    availabilityKey: 'menu.play.goto_middle',

                    label: t('menu.play.goto_middle', 'Ortaya Git'),
                    accelerator: 'CmdOrCtrl+Shift+Backspace',
                    click: () => {
                        mainWindow.webContents.send('goto-middle');
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.goto.next_marker',

                    label: t('menu.goto.next_marker', 'Sonraki İşaretçi'),
                    accelerator: 'Alt+Right',
                    click: () => {
                        mainWindow.webContents.send('goto-next-marker');
                    }
                },
                {
                    availabilityKey: 'menu.goto.previous_marker',

                    label: t('menu.goto.previous_marker', 'Önceki İşaretçi'),
                    accelerator: 'Alt+Left',
                    click: () => {
                        mainWindow.webContents.send('goto-prev-marker');
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.goto.selection_start',

                    label: t('menu.goto.selection_start', 'Seçimin Başına Git'),
                    accelerator: 'CmdOrCtrl+J',
                    click: () => {
                        mainWindow.webContents.send('goto-selection-start');
                    }
                },
                {
                    availabilityKey: 'menu.goto.selection_end',

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
            availabilityKey: 'menu.markers.label',

            label: t('menu.markers.label', 'İşaretçiler'),
            submenu: [
                {
                    availabilityKey: 'menu.markers.add',

                    label: t('menu.markers.add', 'İşaretçi Ekle'),
                    accelerator: 'M',
                    click: () => {
                        mainWindow.webContents.send('marker-add');
                    }
                },
                {
                    availabilityKey: 'menu.markers.delete',

                    label: t('menu.markers.delete', 'İşaretçi Sil'),
                    click: () => {
                        mainWindow.webContents.send('marker-delete');
                    }
                },
                {
                    availabilityKey: 'menu.markers.clear_all',

                    label: t('menu.markers.clear_all', 'Tüm İşaretçileri Temizle'),
                    click: () => {
                        mainWindow.webContents.send('marker-clear-all');
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.markers.list',

                    label: t('menu.markers.list', 'İşaretçi Listesi...'),
                    click: () => {
                        mainWindow.webContents.send('marker-list-dialog');
                    }
                }
            ]
        },

        // YAPAY ZEKA MENÜSÜ
        {
            availabilityKey: 'menu.ai.label',

            label: t('menu.ai.label', 'Yapay Zeka'),
            submenu: [
                {
                    availabilityKey: 'menu.ai.describe_current_position',

                    label: t('menu.ai.describe_current_position', 'Bulunduğun Konumu Betimle'),
                    accelerator: 'CmdOrCtrl+Alt+V',
                    click: () => {
                        mainWindow.webContents.send('ai-describe-current-position', 5);
                    }
                },
                {
                    availabilityKey: 'menu.ai.describe_selection',

                    label: t('menu.ai.describe_selection', 'Seçimi Betimle...'),
                    accelerator: 'CmdOrCtrl+Alt+D',
                    click: () => {
                        mainWindow.webContents.send('edit-describe-selection');
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.ai.intelligent_selection',

                    label: t('menu.ai.intelligent_selection', 'Akıllı Seçim...'),
                    accelerator: 'CmdOrCtrl+I',
                    click: () => {
                        mainWindow.webContents.send('intelligent-selection');
                    }
                },
                {
                    availabilityKey: 'menu.ai.instant_voice_translation',

                    label: t('menu.ai.instant_voice_translation', 'Anlık Sesli Çeviri...'),
                    click: () => {
                        mainWindow.webContents.send('show-instant-voice-translation');
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'menu.ai.settings',
                    label: t('ai_services.settings'),
                    click: () => mainWindow.webContents.send('ai-services-open')
                },
                {
                    availabilityKey: 'menu.ai.services',
                    label: t('ai_services.title'),
                    submenu: [
                        ...['gemini', 'openai', 'claude', 'deepseek', 'groq'].map(provider => ({
                            availabilityKey: provider === 'gemini' ? 'menu.ai.api_key' : provider === 'openai' ? 'menu.ai.openai_api_key' : `menu.ai.service_${provider}`,
                            label: t(`ai_services.providers.${provider}`),
                            click: () => mainWindow.webContents.send('ai-services-open', provider)
                        })),
                        { availabilityKey: 'menu.ai.elevenlabs_api_key', label: t('menu.ai.elevenlabs_api_key'),
                            click: () => mainWindow.webContents.send('edit-elevenlabs-api-key') }
                    ]
                }

            ]
        },

        // YARDIM MENÜSÜ
        {
            availabilityKey: 'menu.help.label',

            label: t('menu.help.label', 'Yardım'),
            submenu: [
                {
                    availabilityKey: 'menu.help.shortcuts',

                    label: t('menu.help.shortcuts', 'Klavye Kısayolları'),
                    accelerator: 'F1',
                    click: () => {
                        mainWindow.webContents.send('show-shortcuts');
                    }
                },
                {
                    availabilityKey: 'menu.help.keyboard_manager',

                    label: t('menu.help.keyboard_manager', 'Klavye Kısayol Yöneticisi...'),
                    accelerator: 'CmdOrCtrl+K',
                    click: () => {
                        mainWindow.webContents.send('show-keyboard-manager');
                    }
                },
                {
                    availabilityKey: 'menu.help.help_menu',

                    label: t('menu.help.help_menu', 'Yardım...'),
                    accelerator: 'F2',
                    click: () => {
                        mainWindow.webContents.send('show-help');
                    }
                },
                {
                    availabilityKey: 'menu.help.description_subtitle_editor_guide',
                    label: t('menu.help.description_subtitle_editor_guide', 'Betimleme ve Altyazı Editörü Kılavuzu'),
                    // Support documentation is intentionally not exposed as a configurable global shortcut.
                    click: () => {
                        openDescriptionSubtitleEditorGuide(mainWindow);
                    }
                },
                {
                    availabilityKey: 'menu.help.review_package_guide',
                    label: t('menu.help.review_package_guide', 'Son Kontrol Paketi Kılavuzu'),
                    // Support documentation is intentionally not exposed as a configurable global shortcut.
                    click: () => {
                        openReviewPackageGuide(mainWindow);
                    }
                },
                {
                    availabilityKey: 'menu.help.subtitle_voiceover_guide',
                    label: t('menu.help.subtitle_voiceover_guide', 'Altyazı Seslendirme ve Düzenleme Kılavuzu'),
                    // Support documentation is intentionally not exposed as a configurable global shortcut.
                    click: () => {
                        openSubtitleVoiceoverGuide(mainWindow);
                    }
                },
                {
                    availabilityKey: 'menu.help.feedback',

                    label: t('menu.help.feedback', 'Geri Bildirim Gönder...'),
                    accelerator: 'F3',
                    click: () => {
                        mainWindow.webContents.send('show-feedback');
                    }
                },
                {
                    availabilityKey: 'menu.help.startup_welcome',

                    label: t('menu.help.startup_welcome', 'Başlangıç Ekranı'),
                    click: () => {
                        mainWindow.webContents.send('show-startup-welcome');
                    }
                },
                {
                    availabilityKey: 'menu.help.open_log_folder',

                    label: t('menu.help.open_log_folder', 'Log klasörünü aç'),
                    // Support utility; intentionally omitted from the shortcut manager.
                    click: async () => {
                        try {
                            const logDirectory = path.dirname(require('./logger').logPath);
                            fs.mkdirSync(logDirectory, { recursive: true });
                            const openError = await shell.openPath(logDirectory);
                            if (openError) {
                                throw new Error(openError);
                            }
                        } catch (error) {
                            const options = {
                                type: 'error',
                                title: t('menu.help.log_folder_open_error_title', 'Log klasörü açılamadı'),
                                message: t('menu.help.log_folder_open_error', 'EVD log klasörü açılamadı.'),
                                detail: error.message
                            };
                            await announceDialogForAccessibility(mainWindow, options);
                            await dialog.showMessageBox(mainWindow, options);
                        }
                    }
                },
                { type: 'separator' },
                {
                    availabilityKey: 'messages.about_label',

                    label: t('messages.about_label', 'About'),
                    click: () => {
                        const options = {
                            type: 'info',
                            title: t('messages.about_title', 'About EVD'),
                            message: t('messages.app_display_name', 'EVD'),
                            detail: t('messages.about_detail', 'Version 5.5.0\n\nKeyboard-first video editor designed for blind and low-vision users.\n\nProgram Icon: Hands and ears editing video\n\n© 2025-2026 Engin Yılmaz\nAll rights reserved.')
                        };
                        announceDialogForAccessibility(mainWindow, options).then(() => {
                            dialog.showMessageBox(mainWindow, options);
                        });
                    }
                }
            ]
        }
    ];

    // Attach policy IDs before shortcut hints alter visible labels. Duplicate
    // commands in Play/Go are intentionally updated together.
    function tagAvailability(items, exempt = false) {
        for (const item of items) {
            const key = item.availabilityKey;
            // Strip metadata on every branch. Electron reserves commandId for
            // its numeric native command ID; never pass policy keys as that field.
            delete item.availabilityKey;
            // Recording/broadcast owns its session-specific availability.
            const skipPolicy = exempt || key?.startsWith('menu.record.');
            if (Array.isArray(item.submenu)) {
                tagAvailability(item.submenu, skipPolicy);
            } else if (!skipPolicy && item.click && key) {
                if (!Object.hasOwn(editorMenuState.requirements, key)) {
                    throw new Error(`Missing menu availability policy: ${key}`);
                }
                item.id = `editor-${key}`;
                item.enabled = false;
            }
        }
    }
    tagAvailability(template);
    // Supply history labels at native menu construction, not just after it.
    const historyState = editorMenuBindings.get(mainWindow.webContents)?.state || {};
    function labelHistory(items) {
        for (const item of items) {
            if (item.id === 'editor-menu.edit.undo' || item.id === 'editor-menu.edit.redo') {
                const operation = item.id.split('.').pop();
                const action = historyState.text || !historyState.loaded ? '' : historyState[`${operation}Action`];
                item.label = action ? i18n.t(`edit_history.menu_${operation}`, {action}) : i18n.t(`menu.edit.${operation}`);
            }
            if (Array.isArray(item.submenu)) labelHistory(item.submenu);
        }
    }
    labelHistory(template);

    // Windows ekran okuyucularında native menu semantics daha güvenilir çalışıyor.
    // Alt menü öğelerinin label/accelerator yapısını değiştirmek, ilk öğede
    // odakla eylem arasında "hayalet" bir adım oluşmasına neden olabiliyor.
    const finalTemplate = process.platform === 'win32' || process.platform === 'darwin'
        ? template
        : addShortcutHints(template, currentLanguage);

    const menu = Menu.buildFromTemplate(finalTemplate);
    bindEditorMenu(mainWindow, menu);
    return menu;
}

module.exports = { createMenu, addToRecentFiles };
