// Basit ve temiz Electron main process
process.on('uncaughtException', err => { require('fs').writeFileSync('fatal.log', err.stack); console.error(err); });
process.on('unhandledRejection', err => { require('fs').writeFileSync('fatal-reject.log', err ? (err.stack || err.toString()) : 'Unknown rejection'); console.error('Promise Rejection:', err); });
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
require('./logger'); // Initialize logging system
const i18n = require('./i18n'); // Initialize i18n

if (process.platform === 'win32') {
    app.setAppUserModelId('com.engelsiz.videoeditor');
}

let mainWindow;
let createMenuFn;
let setupIpcHandlersFn;
let pendingLaunchPath = null;
const allowMultiInstance = process.argv.includes('--multi-instance') || process.env.EVD_ALLOW_MULTI_INSTANCE === '1';

function isPortableMode() {
    return Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
}

const SUPPORTED_VIDEO_EXTENSIONS = new Set([
    '.mp4', '.wmv', '.avi', '.mkv', '.mov', '.webm', '.flv', '.3gp',
    '.mpg', '.mpeg', '.vob', '.m4v', '.ts', '.mts'
]);
const SUPPORTED_PROJECT_EXTENSIONS = new Set(['.kve', '.eng']);

function normalizeArgPath(arg) {
    if (!arg || typeof arg !== 'string') {
        return null;
    }

    if (arg.startsWith('--') || arg.startsWith('/')) {
        return null;
    }

    const resolvedPath = path.resolve(arg);
    if (!fs.existsSync(resolvedPath)) {
        return null;
    }

    return resolvedPath;
}

function isSupportedOpenPath(filePath) {
    const ext = path.extname(filePath || '').toLowerCase();
    return SUPPORTED_VIDEO_EXTENSIONS.has(ext) || SUPPORTED_PROJECT_EXTENSIONS.has(ext);
}

function extractLaunchPath(argv = []) {
    for (const arg of argv) {
        const normalizedPath = normalizeArgPath(arg);
        if (normalizedPath && isSupportedOpenPath(normalizedPath)) {
            return normalizedPath;
        }
    }

    return null;
}

function sendOpenPathToRenderer(filePath) {
    if (!mainWindow || !mainWindow.webContents || !filePath) {
        return false;
    }

    const ext = path.extname(filePath).toLowerCase();
    if (SUPPORTED_PROJECT_EXTENSIONS.has(ext)) {
        mainWindow.webContents.send('project-open-file', filePath);
    } else {
        mainWindow.webContents.send('file-open', filePath);
    }

    return true;
}

function queueOrOpenPath(filePath) {
    if (!filePath) {
        return;
    }

    pendingLaunchPath = filePath;
    if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isLoading()) {
        sendOpenPathToRenderer(filePath);
        pendingLaunchPath = null;
    }
}

if (!allowMultiInstance) {
    const singleInstanceLock = app.requestSingleInstanceLock();
    if (!singleInstanceLock) {
        app.quit();
    }

    pendingLaunchPath = extractLaunchPath(process.argv.slice(1));

    app.on('second-instance', (event, argv) => {
        const nextPath = extractLaunchPath(argv.slice(1));

        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.show();
            mainWindow.focus();
        }

        if (nextPath) {
            queueOrOpenPath(nextPath);
        }
    });
} else {
    pendingLaunchPath = extractLaunchPath(process.argv.slice(1));
}

app.whenReady().then(async () => {
    try {
        createMenuFn = require('./menu').createMenu;
        setupIpcHandlersFn = require('./ipc-handlers').setupIpcHandlers;
        const { setupDialogHandlers } = require('./dialog-windows');
        const { setupObsIpcHandlers } = require('./obs-ipc');
        const { setupGeminiHandlers } = require('./gemini-handler');
        const { setupYouTubeHandlers } = require('./youtube-handler');
        const { setupSlideshowHandlers } = require('./slideshow-handler');
        const { setupObjectAnalysisHandlers } = require('./object-analysis-handler');

        await i18n.init(); // Initialize i18n and wait for it now that app is ready

        createWindow();
        setupIpcHandlersFn(mainWindow);
        setupDialogHandlers(mainWindow);
        setupObsIpcHandlers(mainWindow);
        setupGeminiHandlers(mainWindow);
        setupYouTubeHandlers(mainWindow);
        setupSlideshowHandlers(mainWindow);
        setupObjectAnalysisHandlers(mainWindow);

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    } catch (error) {
        console.error('Uygulama başlatma hatası:', error);
        const errorTitle = i18n.t('messages.error_title');
        dialog.showErrorBox(errorTitle.startsWith('[') ? 'Error' : errorTitle, error.message);
    }
});

ipcMain.handle('open-external-url', async (_event, url) => {
    if (!url || typeof url !== 'string') {
        return { success: false, error: 'invalid_url' };
    }

    try {
        await shell.openExternal(url);
        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error && error.message ? error.message : String(error)
        };
    }
});

ipcMain.handle('app-is-portable', () => isPortableMode());

function createWindow() {
    const launchedWithExternalFile = Boolean(pendingLaunchPath);

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        title: i18n.t('messages.app_window_title') || 'EVD',
        icon: path.join(__dirname, '../../Start_icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, '../preload/index.js')
        },
        titleBarStyle: 'default',
        autoHideMenuBar: false
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
        query: launchedWithExternalFile ? { externalLaunch: '1' } : {}
    });

    const menu = createMenuFn(mainWindow);
    Menu.setApplicationMenu(menu);

    if (process.platform === 'win32' && typeof mainWindow.hookWindowMessage === 'function') {
        const WM_ENTERMENULOOP = 0x0211;
        const WM_EXITMENULOOP = 0x0212;

        mainWindow.hookWindowMessage(WM_ENTERMENULOOP, () => {
            mainWindow?.webContents?.send('native-menu-state', true);
        });

        mainWindow.hookWindowMessage(WM_EXITMENULOOP, () => {
            mainWindow?.webContents?.send('native-menu-state', false);
        });
    }

    mainWindow.on('blur', () => {
        mainWindow?.webContents?.send('native-menu-state', true);
    });

    mainWindow.on('focus', () => {
        mainWindow?.webContents?.send('native-menu-state', false);
    });

    if (process.argv.includes('--enable-logging')) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    mainWindow.once('ready-to-show', () => {
        if (!mainWindow) return;
        mainWindow.maximize();
        mainWindow.show();
    });

    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('app-ready', {
            accessibilityEnabled: app.accessibilitySupportEnabled,
            appVersion: app.getVersion(),
            isPortable: isPortableMode(),
            launchedWithExternalFile
        });

        if (pendingLaunchPath) {
            sendOpenPathToRenderer(pendingLaunchPath);
            pendingLaunchPath = null;
        }
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
