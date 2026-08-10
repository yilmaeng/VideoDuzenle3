const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ttsHandler = require('./tts-handler');
const execFileAsync = promisify(execFile);
const { pathToFileURL } = require('url');
const i18n = require('./i18n');
const {
    PROJECT_EXTENSION,
    createProject,
    getSourceFileInfo,
    normalizeProject
} = require('./description-subtitle-project');
const { detectScenes, generateWaveform, stopJob } = require('./description-subtitle-analysis');
const { analyzeHumanNarrationInWorker } = require('./description-human-narration');
const contentStudio = require('./contentstudio-client');
const {
    createQualityWorkbook,
    createScenarioWorkbook,
    createZip,
    formatTimecode,
    readSubtitleFile,
    serializeSubtitles
} = require('./description-subtitle-file-operations');
const { createReviewDocx, mediaTypeForPath, parseDocxDescriptions, reviewText, scanControlPackage } = require('./description-subtitle-review-operations');

let editorWindow = null;
let allowEditorClose = false;
let initialPayload = null;
let initialPayloadRevision = 0;
let handlersRegistered = false;

function t(key, fallback) {
    const value = i18n.t(key);
    return value && !value.startsWith('[') ? value : fallback;
}

function projectFilter() {
    return [{
        name: t('description_subtitle_editor.project_filter', 'EVD Description and Subtitle Project'),
        extensions: [PROJECT_EXTENSION]
    }];
}

async function announceDialogForAccessibility(targetWindow, options = {}) {
    if (!targetWindow || targetWindow.isDestroyed()) return;
    targetWindow.webContents.send('accessibility-dialog-announce', {
        title: String(options.title || ''),
        message: String(options.message || ''),
        detail: String(options.detail || '')
    });
    await new Promise(resolve => setTimeout(resolve, 120));
}

function subtitleFilter() {
    return [{
        name: t('description_subtitle_editor.subtitle_file_filter', 'SRT, VTT and DOCX script files'),
        extensions: ['srt', 'vtt', 'docx', 'doc']
    }];
}

function narrationAudioFilters() {
    return [{
        name: t('description_subtitle_editor.human_audio_filter', 'Clean narration audio'),
        extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma']
    }];
}

function mediaFilters() {
    return [{
        name: t('description_subtitle_editor.media_files_filter', 'Video and audio files'),
        extensions: ['mp4', 'wmv', 'avi', 'mkv', 'mov', 'webm', 'flv', '3gp', 'mpg', 'mpeg', 'vob', 'm4v', 'ts', 'mts', 'm2ts', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma']
    }];
}

function sourceFileInfo(filePath) {
    return { ...getSourceFileInfo(filePath), mediaType: mediaTypeForPath(filePath) || 'video' };
}

function resolveFfmpegPath() {
    let binary = ffmpegInstaller.path;
    if (binary.includes('app.asar')) binary = binary.replace('app.asar', 'app.asar.unpacked');
    return binary;
}

function resolveFfprobePath() {
    let binary = ffprobeInstaller.path;
    if (binary.includes('app.asar')) binary = binary.replace('app.asar', 'app.asar.unpacked');
    return binary;
}

async function getAudioDuration(filePath) {
    const result = await execFileAsync(resolveFfprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath], { windowsHide: true });
    return Math.max(0, Number(String(result.stdout || '').trim()) || 0);
}

function descriptionTtsCachePath(options = {}) {
    const service = String(options.service || 'system').toLowerCase();
    const extension = service === 'system' ? 'wav' : 'mp3';
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
        text: String(options.text || ''), voice: String(options.voice || ''),
        speed: Number(options.speed) || 1, service
    })).digest('hex');
    const directory = path.join(app.getPath('userData'), 'description-subtitle-cache', 'tts');
    fs.mkdirSync(directory, { recursive: true });
    return path.join(directory, fingerprint + '.' + extension);
}

function sendInitialPayload() {
    if (!editorWindow || editorWindow.isDestroyed()) return;
    editorWindow.webContents.send('description-subtitle-editor-init', initialPayload || {});
}

async function openDescriptionSubtitleControlPackage(parentWindow, directoryPath) {
    const resolvedDirectory = path.resolve(String(directoryPath || ''));
    let packageData;
    try {
        packageData = scanControlPackage(resolvedDirectory, readSubtitleFile);
    } catch (error) {
        packageData = null;
    }
    if (!packageData || (!packageData.media.length && !packageData.projects.length)) {
        const title = t('description_subtitle_editor.control_package_title', 'Open review package');
        const message = t('description_subtitle_editor.control_package_media_missing', 'No supported video, audio or EVD project was found in the folder.');
        await announceDialogForAccessibility(parentWindow, { title, message });
        await dialog.showMessageBox(parentWindow, { type: 'warning', title, message, buttons: [t('dialog.common.ok', 'OK')] });
        return false;
    }
    openDescriptionSubtitleEditor(parentWindow, { controlPackage: packageData });
    return true;
}

function openDescriptionSubtitleEditor(parentWindow, options = {}) {
    const sourcePath = String(options.videoPath || '').trim();
    initialPayload = {
        requestId: ++initialPayloadRevision,
        videoPath: sourcePath,
        projectPath: String(options.projectPath || '').trim(),
        controlPackage: options.controlPackage || null,
        userKeymap: options.userKeymap && typeof options.userKeymap === 'object'
            ? options.userKeymap
            : {},
        navigationStep: Number.isFinite(Number(options.navigationStep))
            ? Math.max(0.01, Math.min(10, Number(options.navigationStep)))
            : 1
    };

    if (editorWindow && !editorWindow.isDestroyed()) {
        if (editorWindow.isMinimized()) editorWindow.restore();
        editorWindow.show();
        editorWindow.focus();
        sendInitialPayload();
        return editorWindow;
    }

    allowEditorClose = false;
    editorWindow = new BrowserWindow({
        width: 1380,
        height: 900,
        minWidth: 900,
        minHeight: 650,
        show: false,
        title: t('description_subtitle_editor.window_title', 'Description and Subtitle Editor'),
        icon: path.join(__dirname, '../../Start_icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, '../preload/index.js')
        }
    });

    // The specialist editor owns its keyboard surface; inherited menu mnemonics would capture Alt+L on Windows.
    editorWindow.setMenu(null);
    editorWindow.loadFile(path.join(__dirname, '../renderer/description-subtitle-editor.html'));
    editorWindow.webContents.once('did-finish-load', sendInitialPayload);
    editorWindow.once('ready-to-show', () => {
        editorWindow.maximize();
        editorWindow.show();
        editorWindow.focus();
    });
    editorWindow.on('close', (event) => {
        if (allowEditorClose) {
            stopJob(editorWindow.webContents.id);
            return;
        }
        event.preventDefault();
        editorWindow.webContents.send('description-subtitle-editor-close-requested');
    });
    editorWindow.once('closed', () => {
        editorWindow = null;
        initialPayload = null;
        allowEditorClose = false;
        if (parentWindow && !parentWindow.isDestroyed()) parentWindow.focus();
    });
    return editorWindow;
}

function registerHandler(channel, handler) {
    if (ipcMain.listenerCount(channel) || ipcMain._invokeHandlers?.has?.(channel)) return;
    ipcMain.handle(channel, handler);
}

function setupDescriptionSubtitleEditorHandlers(mainWindow) {
    if (handlersRegistered) return;
    handlersRegistered = true;

    registerHandler('description-subtitle-editor-open', async (_event, options = {}) => {
        openDescriptionSubtitleEditor(mainWindow, options);
        return { opened: true };
    });
    registerHandler('description-subtitle-editor-get-initial-payload', async () => initialPayload || {});


    registerHandler('description-subtitle-editor-choose-video', async (event) => {
        const owner = BrowserWindow.fromWebContents(event.sender) || editorWindow || mainWindow;
        const result = await dialog.showOpenDialog(owner, {
            title: t('description_subtitle_editor.choose_video_title', 'Choose source video or audio'),
            filters: mediaFilters(),
            properties: ['openFile']
        });
        if (result.canceled || !result.filePaths[0]) return { canceled: true };
        return { canceled: false, source: sourceFileInfo(result.filePaths[0]) };
    });

    registerHandler('description-subtitle-editor-source-info', async (_event, filePath) => {
        return sourceFileInfo(filePath);
    });

    registerHandler('description-subtitle-editor-path-url', async (_event, filePath) => {
        return pathToFileURL(path.resolve(String(filePath || ''))).href;
    });

    registerHandler('description-subtitle-editor-new-project', async (_event, source = {}) => {
        return createProject(source);
    });

    registerHandler('description-subtitle-editor-open-project', async (event) => {
        const owner = BrowserWindow.fromWebContents(event.sender) || editorWindow || mainWindow;
        const result = await dialog.showOpenDialog(owner, {
            title: t('description_subtitle_editor.open_project_title', 'Open Project'),
            filters: projectFilter(),
            properties: ['openFile']
        });
        if (result.canceled || !result.filePaths[0]) return { canceled: true };
        const projectPath = result.filePaths[0];
        const project = normalizeProject(JSON.parse(fs.readFileSync(projectPath, 'utf8')));
        return { canceled: false, projectPath, project };
    });

    registerHandler('description-subtitle-editor-save-project', async (event, payload = {}) => {
        const owner = BrowserWindow.fromWebContents(event.sender) || editorWindow || mainWindow;
        const project = normalizeProject(payload.project || {});
        let projectPath = String(payload.projectPath || '').trim();
        if (!projectPath || payload.saveAs) {
            const sourceName = path.parse(project.source.name || 'project').name;
            const result = await dialog.showSaveDialog(owner, {
                title: t('description_subtitle_editor.save_project_title', 'Save Project'),
                defaultPath: `${sourceName}.${PROJECT_EXTENSION}`,
                filters: projectFilter()
            });
            if (result.canceled || !result.filePath) return { canceled: true };
            projectPath = result.filePath.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`)
                ? result.filePath
                : `${result.filePath}.${PROJECT_EXTENSION}`;
        }
        project.updatedAt = new Date().toISOString();
        fs.writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
        return { canceled: false, projectPath, project };
    });


    registerHandler('description-subtitle-editor-choose-control-package', async (event) => {
        const owner = BrowserWindow.fromWebContents(event.sender) || editorWindow || mainWindow;
        const title = t('description_subtitle_editor.control_package_title', 'Open review package');
        await announceDialogForAccessibility(owner, { title, message: t('description_subtitle_editor.control_package_announcement', 'Choose the folder containing media and script files.') });
        const result = await dialog.showOpenDialog(owner, { title, properties: ['openDirectory'] });
        if (result.canceled || !result.filePaths[0]) return { canceled: true };
        return { canceled: false, ...scanControlPackage(result.filePaths[0], readSubtitleFile) };
    });

    registerHandler('description-subtitle-editor-load-project-path', async (_event, projectPath) => {
        const resolved = path.resolve(String(projectPath || ''));
        return { projectPath: resolved, project: normalizeProject(JSON.parse(fs.readFileSync(resolved, 'utf8'))) };
    });

    registerHandler('description-subtitle-editor-import-subtitles', async (event, options = {}) => {
        const owner = BrowserWindow.fromWebContents(event.sender) || editorWindow || mainWindow;
        const title = t('description_subtitle_editor.import_subtitles_title', 'Import SRT or VTT');
        await announceDialogForAccessibility(owner, {
            title,
            message: t('description_subtitle_editor.import_subtitles_announcement', 'Choose an SRT or VTT file to import.')
        });
        const result = await dialog.showOpenDialog(owner, {
            title,
            filters: subtitleFilter(),
            properties: ['openFile']
        });
        if (result.canceled || !result.filePaths[0]) return { canceled: true };
        const filePath = result.filePaths[0];
        const extension = path.extname(filePath).toLowerCase();
        if (extension === '.doc') return { canceled: false, filePath, fileName: path.basename(filePath), format: 'doc', cues: [], warnings: [{ code: 'legacy_doc' }], confidence: 0 };
        const parsed = extension === '.docx'
            ? parseDocxDescriptions(filePath, { fps: options.fps, duration: options.duration, defaultDuration: options.defaultDuration })
            : readSubtitleFile(filePath);
        return {
            canceled: false,
            filePath,
            fileName: path.basename(filePath),
            format: parsed.format,
            cues: parsed.cues,
            warnings: parsed.warnings || [],
            confidence: Number(parsed.confidence ?? 1)
        };
    });

    registerHandler('description-subtitle-editor-choose-human-narration', async event => {
        const owner = BrowserWindow.fromWebContents(event.sender) || editorWindow || mainWindow;
        const title = t('description_subtitle_editor.human_choose_title', 'Choose clean human narration');
        await announceDialogForAccessibility(owner, {
            title,
            message: t('description_subtitle_editor.human_choose_announcement', 'Choose the clean MP3 or WAV recording read by the narrator.')
        });
        const result = await dialog.showOpenDialog(owner, {
            title, filters: narrationAudioFilters(), properties: ['openFile']
        });
        if (result.canceled || !result.filePaths[0]) return { canceled: true };
        return {
            canceled: false,
            sourcePath: result.filePaths[0],
            sourceName: path.basename(result.filePaths[0])
        };
    });

    registerHandler('description-subtitle-editor-analyze-human-narration', async (event, options = {}) => {
        const sender = event.sender;
        return analyzeHumanNarrationInWorker({
            sourcePath: options.sourcePath,
            sourceDuration: await getAudioDuration(path.resolve(String(options.sourcePath || ''))),
            descriptions: options.descriptions,
            model: options.model,
            ffmpegPath: resolveFfmpegPath(),
            modelCacheDir: path.join(app.getPath('userData'), 'description-subtitle-cache', 'whisper-models'),
            clipCacheDir: path.join(app.getPath('userData'), 'description-subtitle-cache', 'human-narration'),
            onProgress: progress => {
                if (!sender.isDestroyed()) sender.send('description-subtitle-human-narration-progress', progress);
            }
        });
    });

    registerHandler('description-subtitle-editor-trim-human-narration-candidate', async (_event, options = {}) => {
        const requestedPath = String(options.sourcePath || '').trim();
        if (!requestedPath) throw new Error('human_narration_source_missing');
        const sourcePath = path.resolve(requestedPath);
        if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) throw new Error('human_narration_source_missing');
        const sourceDuration = await getAudioDuration(sourcePath);
        const start = Math.max(0, Math.min(Math.max(0, sourceDuration - 0.05), Number(options.start) || 0));
        const end = Math.max(start + 0.05, Math.min(sourceDuration, Number(options.end) || sourceDuration));
        if (end - start < 0.05) throw new Error('human_narration_trim_too_short');
        const directory = path.join(app.getPath('userData'), 'description-subtitle-cache', 'human-narration-edits');
        fs.mkdirSync(directory, { recursive: true });
        const fingerprint = crypto.createHash('sha1').update(`${sourcePath}|${start.toFixed(3)}|${end.toFixed(3)}`).digest('hex');
        const outputPath = path.join(directory, `${fingerprint}.wav`);
        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 64) {
            await execFileAsync(resolveFfmpegPath(), [
                '-y', '-v', 'error', '-ss', start.toFixed(3), '-i', sourcePath,
                '-t', (end - start).toFixed(3), '-vn', '-ac', '1', '-ar', '48000',
                '-c:a', 'pcm_s16le', outputPath
            ], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
        }
        return { audioPath: outputPath, duration: end - start, trimStart: start, trimEnd: end, sourceDuration };
    });
    registerHandler('description-subtitle-contentstudio-key-status', async () => ({ configured: contentStudio.hasApiKey() }));

    registerHandler('description-subtitle-contentstudio-save-key', async (_event, payload = {}) => {
        contentStudio.saveApiKey(payload.apiKey);
        return { success: true, configured: true };
    });

    registerHandler('description-subtitle-contentstudio-account', async () => contentStudio.getAccount());

    registerHandler('description-subtitle-contentstudio-create-project', async (event, payload = {}) => {
        const sender = event.sender;
        const duration = Number(payload.duration) > 0
            ? Number(payload.duration)
            : await getAudioDuration(path.resolve(String(payload.videoPath || '')));
        return contentStudio.createVideoProject({ ...payload, duration }, progress => {
            if (!sender.isDestroyed()) sender.send('description-subtitle-contentstudio-progress', progress);
        });
    });

    registerHandler('description-subtitle-contentstudio-find-project', async (_event, payload = {}) => {
        return contentStudio.findLatestVideoProject(payload.sourceName);
    });

    registerHandler('description-subtitle-contentstudio-job', async (_event, payload = {}) => {
        return contentStudio.getJob(payload.projectId);
    });

    registerHandler('description-subtitle-contentstudio-descriptions', async (_event, payload = {}) => {
        return contentStudio.getDescriptions(payload.projectId);
    });

    registerHandler('description-subtitle-contentstudio-export', async (event, payload = {}) => {
        const owner = BrowserWindow.fromWebContents(event.sender) || editorWindow || mainWindow;
        const format = ['mp3', 'mp4', 'srt'].includes(String(payload.format || '').toLowerCase())
            ? String(payload.format).toLowerCase() : 'srt';
        const sourceName = path.parse(String(payload.sourceName || 'contentstudio')).name || 'contentstudio';
        const title = t('description_subtitle_editor.contentstudio_export_title', 'Download ContentStudio output');
        await announceDialogForAccessibility(owner, {
            title,
            message: t('description_subtitle_editor.contentstudio_export_announcement', 'Choose where to save the ContentStudio output.')
        });
        const result = await dialog.showSaveDialog(owner, {
            title,
            defaultPath: sourceName + '-contentstudio.' + format,
            filters: [{ name: format.toUpperCase(), extensions: [format] }]
        });
        if (result.canceled || !result.filePath) return { canceled: true };
        const outputPath = result.filePath.toLowerCase().endsWith('.' + format) ? result.filePath : result.filePath + '.' + format;
        const started = await contentStudio.requestExport(
            payload.projectId, format, payload.quality || 'high', payload.includeCaptions !== false
        );
        if (format === 'srt') {
            fs.writeFileSync(outputPath, '\uFEFF' + String(started?.content || ''), 'utf8');
            return { canceled: false, filePath: outputPath };
        }
        let status = started;
        for (let attempt = 0; attempt < 720; attempt += 1) {
            if (status?.status === 'completed' && status.downloadUrl) break;
            if (status?.status === 'failed') throw new Error(status.error || 'contentstudio_export_failed');
            if (!event.sender.isDestroyed()) {
                event.sender.send('description-subtitle-contentstudio-progress', { stage: 'exporting', percent: 0 });
            }
            await contentStudio.sleep(30000);
            status = await contentStudio.getExportStatus(payload.projectId);
        }
        if (!status?.downloadUrl) throw new Error('contentstudio_export_timeout');
        await contentStudio.downloadFile(status.downloadUrl, outputPath);
        return { canceled: false, filePath: outputPath };
    });

    registerHandler('description-subtitle-editor-export', async (event, payload = {}) => {
        const owner = BrowserWindow.fromWebContents(event.sender) || editorWindow || mainWindow;
        const format = ['srt', 'vtt', 'xlsx', 'docx', 'txt'].includes(String(payload.format || '').toLowerCase())
            ? String(payload.format).toLowerCase()
            : 'srt';
        const title = t('description_subtitle_editor.export_title', 'Export description and subtitle file');
        await announceDialogForAccessibility(owner, {
            title,
            message: t('description_subtitle_editor.export_announcement', 'Choose where to save the exported file.')
        });
        const sourceName = path.parse(String(payload.sourceName || 'script')).name || 'script';
        const fileNameSuffix = String(payload.fileNameSuffix || '').trim().replace(/[\\/:*?\"<>|]+/g, '-');
        const defaultBaseName = [sourceName, fileNameSuffix].filter(Boolean).join(' ');
        const result = await dialog.showSaveDialog(owner, {
            title,
            defaultPath: defaultBaseName + '.' + format,
            filters: [{
                name: format === 'xlsx'
                    ? t('description_subtitle_editor.xlsx_file_filter', 'Excel scenario workbook')
                    : format === 'docx' ? t('description_subtitle_editor.docx_file_filter', 'Word review document')
                    : format === 'txt' ? t('description_subtitle_editor.txt_file_filter', 'Text review document')
                    : t('description_subtitle_editor.subtitle_export_filter', 'Subtitle file'),
                extensions: [format]
            }]
        });
        if (result.canceled || !result.filePath) return { canceled: true };
        const exportPath = result.filePath.toLowerCase().endsWith('.' + format)
            ? result.filePath
            : result.filePath + '.' + format;
        const events = Array.isArray(payload.events) ? payload.events : [];
        if (format === 'xlsx') {
            fs.writeFileSync(exportPath, createScenarioWorkbook(events, payload.labels || {}));
        } else if (format === 'docx') {
            fs.writeFileSync(exportPath, createReviewDocx(events, { ...(payload.labels || {}), formatTime: seconds => formatTimecode(seconds, '.') }, createZip));
        } else if (format === 'txt') {
            fs.writeFileSync(exportPath, '\uFEFF' + reviewText(events, { ...(payload.labels || {}), formatTime: seconds => formatTimecode(seconds, '.') }), 'utf8');
        } else {
            fs.writeFileSync(exportPath, '\uFEFF' + serializeSubtitles(events, format), 'utf8');
        }
        return { canceled: false, filePath: exportPath, count: events.length };
    });


    registerHandler('description-subtitle-editor-quality-export', async (event, payload = {}) => {
        const owner = BrowserWindow.fromWebContents(event.sender) || editorWindow || mainWindow;
        const format = String(payload.format || '').toLowerCase() === 'xlsx' ? 'xlsx' : 'txt';
        const title = t('description_subtitle_editor.quality_export_title', 'Export quality report');
        await announceDialogForAccessibility(owner, {
            title,
            message: t('description_subtitle_editor.quality_export_announcement', 'Choose where to save the quality report.')
        });
        const sourceName = path.parse(String(payload.sourceName || 'quality-report')).name || 'quality-report';
        const result = await dialog.showSaveDialog(owner, {
            title,
            defaultPath: sourceName + '-quality-report.' + format,
            filters: [{
                name: format === 'xlsx'
                    ? t('description_subtitle_editor.quality_xlsx_filter', 'Excel quality report')
                    : t('description_subtitle_editor.quality_txt_filter', 'Text quality report'),
                extensions: [format]
            }]
        });
        if (result.canceled || !result.filePath) return { canceled: true };
        const exportPath = result.filePath.toLowerCase().endsWith('.' + format) ? result.filePath : result.filePath + '.' + format;
        if (format === 'xlsx') fs.writeFileSync(exportPath, createQualityWorkbook(Array.isArray(payload.issues) ? payload.issues : [], payload.labels || {}));
        else fs.writeFileSync(exportPath, '\uFEFF' + String(payload.reportText || ''), 'utf8');
        return { canceled: false, filePath: exportPath };
    });

    registerHandler('description-subtitle-editor-tts-voices', async (_event, options = {}) => {
        const voices = await ttsHandler.getProviderVoices(String(options.service || 'system'));
        return { success: true, voices };
    });

    registerHandler('description-subtitle-editor-synthesize', async (_event, options = {}) => {
        const textValue = String(options.text || '').trim();
        if (!textValue) throw new Error('tts_text_required');
        const service = String(options.service || 'system');
        const outputPath = descriptionTtsCachePath({ ...options, text: textValue, service });
        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 64) {
            await ttsHandler.textToSpeechFile({ text: textValue, voice: String(options.voice || ''), speed: Number(options.speed) || 1, outputPath, volume: 100, service });
        }
        return { success: true, audioPath: outputPath, duration: await getAudioDuration(outputPath) };
    });


    registerHandler('description-subtitle-editor-render-described-video', async (event, options = {}) => {
        const owner = BrowserWindow.fromWebContents(event.sender) || editorWindow || mainWindow;
        const sourcePath = path.resolve(String(options.videoPath || ''));
        const items = (Array.isArray(options.events) ? options.events : []).filter(item => item.ttsAudioPath && fs.existsSync(item.ttsAudioPath));
        if (!fs.existsSync(sourcePath) || !items.length) throw new Error('description_tts_tracks_missing');
        const probe = await execFileAsync(resolveFfprobePath(), ['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',sourcePath], { windowsHide: true });
        const metadata = JSON.parse(String(probe.stdout || '{}'));
        const duration = Math.max(0.1, Number(metadata.format?.duration) || 0.1);
        const hasAudio = (metadata.streams || []).some(stream => stream.codec_type === 'audio');
        const hasVideo = (metadata.streams || []).some(stream => stream.codec_type === 'video');
        const title = t('description_subtitle_editor.render_title', 'Create described output');
        await announceDialogForAccessibility(owner, { title, message: t('description_subtitle_editor.render_announcement', 'Choose where to save the described video or MP3 audio.') });
        const saveFilters = hasVideo
            ? [
                { name: t('description_subtitle_editor.render_mp4_filter', 'MP4 video'), extensions: ['mp4'] },
                { name: t('description_subtitle_editor.render_mp3_filter', 'MP3 audio'), extensions: ['mp3'] }
            ]
            : [{ name: t('description_subtitle_editor.render_mp3_filter', 'MP3 audio'), extensions: ['mp3'] }];
        const defaultExtension = hasVideo ? 'mp4' : 'mp3';
        const result = await dialog.showSaveDialog(owner, {
            title,
            defaultPath: path.parse(sourcePath).name + '-described.' + defaultExtension,
            filters: saveFilters
        });
        if (result.canceled || !result.filePath) return { canceled: true };
        const requestedExtension = path.extname(result.filePath).toLowerCase();
        const outputFormat = requestedExtension === '.mp3' || !hasVideo ? 'mp3' : 'mp4';
        const outputPath = requestedExtension === '.' + outputFormat
            ? result.filePath
            : result.filePath.replace(/\.[^.\\/]+$/, '') + '.' + outputFormat;
        let volumeExpression = '1';
        for (const item of [...items].sort((a,b)=>a.start-b.start)) {
            const start = Math.max(0, Number(item.start) || 0).toFixed(3);
            const played = Math.max(0.05, Number(item.ttsDuration || 0) / Math.max(0.5, Number(item.ttsPlaybackRate) || 1));
            const end = Math.max(Number(item.end) || 0, Number(item.start) + played).toFixed(3);
            const gain = Math.max(0, Math.min(2, Number(item.originalVolume ?? 0.9))).toFixed(3);
            volumeExpression = `if(between(t,${start},${end}),${gain},${volumeExpression})`;
        }
        const filters = [];
        if (hasAudio) filters.push(`[0:a:0]volume='${volumeExpression}'[original]`);
        else filters.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${duration.toFixed(3)}[original]`);
        items.forEach((item,index)=>{
            const rate=Math.max(0.5,Math.min(2,Number(item.ttsPlaybackRate)||1)).toFixed(3);
            const gain=Math.max(0,Math.min(2,Number(item.ttsVolume??100)/100)).toFixed(3);
            const delay=Math.max(0,Math.round((Number(item.start)||0)*1000));
            filters.push(`[${index+1}:a:0]atempo=${rate},volume=${gain},adelay=${delay}|${delay}[tts${index}]`);
        });
        filters.push(`${['[original]',...items.map((_item,index)=>`[tts${index}]`)].join('')}amix=inputs=${items.length+1}:duration=first:dropout_transition=0[outa]`);
        const filterPath=path.join(app.getPath('temp'),'evd-description-mix-'+Date.now()+'.txt');
        fs.writeFileSync(filterPath,filters.join(';'),'utf8');
        const args=['-y','-i',sourcePath]; items.forEach(item=>args.push('-i',item.ttsAudioPath));
        args.push('-filter_complex_script',filterPath);
        if (outputFormat === 'mp3') {
            args.push('-map','[outa]','-c:a','libmp3lame','-b:a','192k','-t',duration.toFixed(3),outputPath);
        } else {
            args.push('-map','0:v:0','-map','[outa]','-c:v','copy','-c:a','aac','-b:a','192k','-movflags','+faststart','-t',duration.toFixed(3),outputPath);
        }
        try { await execFileAsync(resolveFfmpegPath(),args,{windowsHide:true,maxBuffer:8*1024*1024}); }
        finally { try { fs.unlinkSync(filterPath); } catch (_) {} }
        return { canceled:false,filePath:outputPath };
    });

    registerHandler('description-subtitle-editor-generate-waveform', async (event, options = {}) => {
        return generateWaveform(event.sender, options);
    });

    registerHandler('description-subtitle-editor-detect-scenes', async (event, options = {}) => {
        return detectScenes(event.sender, options);
    });

    registerHandler('description-subtitle-editor-cancel-analysis', async (event) => {
        return { cancelled: stopJob(event.sender.id) };
    });

    registerHandler('description-subtitle-editor-confirm-close', async () => {
        if (!editorWindow || editorWindow.isDestroyed()) return { closed: true };
        allowEditorClose = true;
        editorWindow.close();
        return { closed: true };
    });
}

module.exports = {
    openDescriptionSubtitleControlPackage,
    openDescriptionSubtitleEditor,
    setupDescriptionSubtitleEditorHandlers
};
