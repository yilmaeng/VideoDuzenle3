const { ipcMain, dialog, Menu, BrowserWindow, Notification, app, shell } = require('electron');
const ffmpegHandler = require('./ffmpeg-handler');
const ttsHandler = require('./tts-handler');
const mediaCompatibility = require('./media-compatibility-service');
const liveEffectsHandler = require('./live-effects-handler');
const path = require('path');
const fs = require('fs');
const os = require('os');
const i18n = require('./i18n');
const { execFile } = require('child_process');
const logger = require('./logger');

// const geminiHandler = require('./gemini-handler'); // Removed to prevent duplicate registration

function t(key, fallback, params) {
    const value = i18n.t(key, params);
    return value.startsWith('[') ? fallback : value;
}

function sanitizeMultilineValue(value) {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
}

function buildDialogAnnouncementPayload(options = {}) {
    return {
        title: String(options.title || '').trim(),
        message: String(options.message || '').trim(),
        detail: String(options.detail || '').trim()
    };
}

async function announceDialogForAccessibility(targetWindow, options = {}) {
    if (!targetWindow || targetWindow.isDestroyed() || !targetWindow.webContents) {
        return;
    }

    const payload = buildDialogAnnouncementPayload(options);
    if (!payload.title && !payload.message && !payload.detail) {
        return;
    }

    try {
        targetWindow.webContents.send('accessibility-dialog-announce', payload);
        await new Promise((resolve) => setTimeout(resolve, 90));
    } catch (error) {
        console.warn('Dialog accessibility announcement failed:', error.message);
    }
}

function buildFeedbackDraftBody({ includeDiagnostics, currentFilePath }) {
    const lines = [
        t('feedback_mail.body.greeting', 'Merhaba,'),
        '',
        t('feedback_mail.body.prompt', 'Yasadiginiz durumu, beklentinizi veya onerilerinizi asagiya yazabilirsiniz.'),
        '',
        t('feedback_mail.body.steps_label', 'Ne yapiyordunuz?'),
        '',
        '',
        t('feedback_mail.body.expected_label', 'Ne olmasini bekliyordunuz?'),
        '',
        '',
        t('feedback_mail.body.actual_label', 'Ne oldu?'),
        '',
        ''
    ];

    if (includeDiagnostics) {
        const diagnostics = [
            `${t('feedback_mail.body.app_version', 'Uygulama surumu')}: ${app.getVersion()}`,
            `${t('feedback_mail.body.platform', 'Platform')}: ${process.platform} ${os.release()} (${os.arch()})`,
            `${t('feedback_mail.body.language', 'Uygulama dili')}: ${i18n.getCurrentLanguage()}`,
            `${t('feedback_mail.body.timestamp', 'Tarih')}: ${new Date().toISOString()}`
        ];

        if (currentFilePath) {
            diagnostics.push(`${t('feedback_mail.body.current_file', 'Acik dosya')}: ${currentFilePath}`);
        }

        const recentLogs = sanitizeMultilineValue(logger.getRecentLogExcerpt());
        lines.push(
            t('feedback_mail.body.diagnostics_heading', 'Tani bilgileri (kullanici izniyle eklendi):'),
            diagnostics.join('\n')
        );

        if (recentLogs) {
            lines.push(
                '',
                t('feedback_mail.body.log_heading', 'Son oturum log ozeti:'),
                recentLogs
            );
        }
    }

    return lines.join('\n');
}

function getNativeWindowSources() {
    if (process.platform !== 'win32') {
        return Promise.resolve([]);
    }

    const script = `
$code = @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class KveWindowProbe {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
    [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
}
"@
Add-Type -TypeDefinition $code
$windows = New-Object System.Collections.Generic.List[object]
$shellWindow = [KveWindowProbe]::GetShellWindow()
[KveWindowProbe]::EnumWindows({
    param($hWnd, $lParam)
    if ($hWnd -eq $shellWindow) { return $true }
    if (-not [KveWindowProbe]::IsWindowVisible($hWnd)) { return $true }
    $length = [KveWindowProbe]::GetWindowTextLength($hWnd)
    if ($length -le 0) { return $true }
    $builder = New-Object System.Text.StringBuilder ($length + 1)
    [void][KveWindowProbe]::GetWindowText($hWnd, $builder, $builder.Capacity)
    $title = $builder.ToString().Trim()
    if ([string]::IsNullOrWhiteSpace($title)) { return $true }
    $windows.Add([PSCustomObject]@{
        name = $title
        id = "native:$($hWnd.ToInt64().ToString('X'))"
        _native = $true
    }) | Out-Null
    return $true
}, [IntPtr]::Zero) | Out-Null
$windows | ConvertTo-Json -Compress
`;

    return new Promise((resolve) => {
        execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
            windowsHide: true,
            timeout: 10000,
            maxBuffer: 1024 * 1024 * 4
        }, (error, stdout) => {
            if (error) {
                console.error('getNativeWindowSources error:', error.message);
                resolve([]);
                return;
            }

            const trimmed = String(stdout || '').trim();
            if (!trimmed) {
                resolve([]);
                return;
            }

            try {
                const parsed = JSON.parse(trimmed);
                resolve(Array.isArray(parsed) ? parsed : [parsed]);
            } catch (parseError) {
                console.error('getNativeWindowSources parse error:', parseError.message);
                resolve([]);
            }
        });
    });
}

function setupIpcHandlers(mainWindow) {
    // Gemini handlers are already set up in index.js via gemini-handler module

    // Pencere başlığını ayarla
    ipcMain.on('set-window-title', (event, title) => {
        if (mainWindow) {
            mainWindow.setTitle(title);
        }
    });

    // Dialog penceresini kapat (ana uygulamayı kapatmadan)
    ipcMain.on('close-dialog-window', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && win !== mainWindow) {
            win.close();
        }
    });

    // --- DIALOG HANDLERS ---

    // Dosya açma diyaloğu
    ipcMain.handle('open-file-dialog', async (event, options) => {
        const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
        const result = await dialog.showOpenDialog(win, options);
        return result;
    });

    // Kaydetme diyaloğu
    ipcMain.handle('show-save-dialog', async (event, options) => {
        const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
        const result = await dialog.showSaveDialog(win, options);
        return result;
    });
    // --- END DIALOG HANDLERS ---

    // Video metadata al (ve Probe)
    ipcMain.handle('get-video-metadata', async (event, filePath) => {
        try {
            const metadata = await ffmpegHandler.getVideoMetadata(filePath);
            return { success: true, data: metadata };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // TTS Önizleme
    ipcMain.handle('preview-tts', async (event, { text, voice, speed, volume, videoPath, startTime, duration, videoVolume }) => {
        try {
            const normalizedText = sanitizeMultilineValue(text);
            const normalizedSpeed = Number(speed) > 0 ? Number(speed) : 1;
            const normalizedVolume = Math.max(0, Math.min(100, Math.round(Number(volume) || 100)));
            const normalizedVideoVolume = Math.max(0, Math.min(100, Math.round(Number(videoVolume) || 100)));
            const trimmedVideoPath = String(videoPath || '').trim();
            const previewStart = Math.max(0, Number(startTime) || 0);
            const previewDuration = Math.max(1, Math.min(15, Number(duration) || 5));

            if (trimmedVideoPath) {
                const stamp = Date.now();
                const ttsPath = path.join(os.tmpdir(), `tts_preview_${stamp}.wav`);
                const videoAudioPath = path.join(os.tmpdir(), `tts_video_preview_${stamp}.wav`);
                const mixedAudioPath = path.join(os.tmpdir(), `tts_mix_preview_${stamp}.wav`);

                console.log('TTS Preview (Mixed):', {
                    text: normalizedText.slice(0, 40),
                    voice,
                    speed: normalizedSpeed,
                    ttsVolume: normalizedVolume,
                    videoVolume: normalizedVideoVolume,
                    previewStart,
                    previewDuration
                });

                await ttsHandler.textToWav(normalizedText, voice, normalizedSpeed, ttsPath, normalizedVolume);
                await ffmpegHandler.previewAudioSegment(trimmedVideoPath, videoAudioPath, previewStart, previewDuration, {
                    volume: normalizedVideoVolume,
                    muted: normalizedVideoVolume <= 0,
                    channelMode: 'source',
                    noiseReduction: { enabled: false },
                    audioEffects: { echo: false, reverb: false, phone: false }
                });
                await ffmpegHandler.createAudioFromMix([
                    { path: videoAudioPath, offset: 0 },
                    { path: ttsPath, offset: 0 }
                ], mixedAudioPath);

                try { if (fs.existsSync(ttsPath)) fs.unlinkSync(ttsPath); } catch (cleanupError) { }
                try { if (fs.existsSync(videoAudioPath)) fs.unlinkSync(videoAudioPath); } catch (cleanupError) { }

                return { success: true, audioPath: mixedAudioPath };
            }

            console.log('TTS Preview (Direct Speak):', { text: normalizedText.slice(0, 40), voice, speed: normalizedSpeed });
            await ttsHandler.speak(normalizedText, voice, normalizedSpeed);
            return { success: true, spokeDirect: true };
        } catch (error) {
            console.error('TTS Preview Error:', error);
            return { success: false, error: error.message };
        }
    });



    // Video kes
    ipcMain.handle('cut-video', async (event, { inputPath, outputPath, startTime, endTime }) => {
        try {
            const ext = path.extname(inputPath).toLowerCase();
            const isAudio = ['.wav', '.mp3', '.aac', '.ogg', '.m4a', '.wma'].includes(ext);

            if (isAudio && ffmpegHandler.cutAudio) {
                await ffmpegHandler.cutAudio(inputPath, outputPath, startTime, endTime, (percent) => {
                    mainWindow.webContents.send('ffmpeg-progress', { operation: 'cut-audio', percent });
                });
            } else {
                await ffmpegHandler.cutVideo(inputPath, outputPath, startTime, endTime, (percent) => {
                    mainWindow.webContents.send('ffmpeg-progress', { operation: 'cut', percent });
                }, (log) => {
                    mainWindow.webContents.send('ffmpeg-log', log);
                });
            }
            mainWindow.webContents.send('ffmpeg-progress', { operation: 'cut', percent: 100 });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Hızlı video kes (stream copy - re-encode yok)
    ipcMain.handle('cut-video-fast', async (event, { inputPath, outputPath, startTime, endTime, mode }) => {
        try {
            const ext = path.extname(inputPath).toLowerCase();
            const isAudio = ['.wav', '.mp3', '.aac', '.ogg', '.m4a', '.wma'].includes(ext);

            if (isAudio && ffmpegHandler.cutAudio) {
                await ffmpegHandler.cutAudio(inputPath, outputPath, startTime, endTime, (percent) => {
                    mainWindow.webContents.send('ffmpeg-progress', { operation: 'cut-audio', percent });
                });
            } else {
                await ffmpegHandler.cutVideoFast(inputPath, outputPath, startTime, endTime, (percent) => {
                    mainWindow.webContents.send('ffmpeg-progress', { operation: 'cut-fast', percent });
                }, { mode });
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-cut-video-fast-bounds', async (event, { inputPath, startTime, endTime }) => {
        try {
            const bounds = await ffmpegHandler.getCutVideoFastBounds(inputPath, startTime, endTime);
            return { success: true, ...bounds };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Remux (MKV -> MP4)
    ipcMain.handle('ffmpeg-remux', async (event, { inputPath, targetFormat }) => {
        try {
            console.log(`IPC: ffmpeg-remux requested for ${inputPath} to ${targetFormat}`);
            if (ffmpegHandler.remuxVideo) {
                const result = await ffmpegHandler.remuxVideo(inputPath, targetFormat);
                return result;
            } else {
                return { success: false, error: 'ffmpegHandler.remuxVideo not implemented' };
            }
        } catch (error) {
            console.error('IPC Remux Error:', error);
            return { success: false, error: error.message };
        }
    });

    // Recording finished: Add to project and close dialog
    ipcMain.on('recording-finished-add-to-project', (event, filePath) => {
        console.log(`Adding recording to project: ${filePath}`);
        if (mainWindow) {
            mainWindow.webContents.send('add-to-timeline', filePath);
            const win = BrowserWindow.fromWebContents(event.sender);
            if (win && win !== mainWindow) {
                win.close();
            }
        }
    });

    // Akıllı video kes (hızlı dene, olmazsa re-encode)
    ipcMain.handle('cut-video-smart', async (event, { inputPath, outputPath, startTime, endTime, options }) => {
        try {
            const ext = path.extname(inputPath).toLowerCase();
            const isAudio = ['.wav', '.mp3', '.aac', '.ogg', '.m4a', '.wma'].includes(ext);

            if (isAudio && ffmpegHandler.cutAudio) {
                await ffmpegHandler.cutAudio(inputPath, outputPath, startTime, endTime, (percent) => {
                    mainWindow.webContents.send('ffmpeg-progress', { operation: 'cut-audio', percent });
                });
            } else {
                await ffmpegHandler.cutVideoSmart(inputPath, outputPath, startTime, endTime, options || {}, (percent) => {
                    mainWindow.webContents.send('ffmpeg-progress', { operation: 'cut-smart', percent });
                }, (log) => {
                    mainWindow.webContents.send('ffmpeg-log', log);
                });
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Timeline'ı tek seferde render et (Filter Complex - Single Pass)
    // Bu yöntem parçalama/birleştirme hatalarını önler
    // Timeline'ı tek seferde render et (Filter Complex - Single Pass)
    // Bu yöntem parçalama/birleştirme hatalarını önler
    ipcMain.handle('render-timeline', async (event, { inputPath, segments, outputPath, options }) => {
        try {
            await ffmpegHandler.renderTimeline(inputPath, segments, outputPath, (progress) => {
                const payload = typeof progress === 'number'
                    ? { operation: 'render-timeline', percent: progress }
                    : {
                        operation: progress?.operation || 'render-timeline',
                        percent: progress?.percent,
                        current: progress?.current,
                        total: progress?.total,
                        stage: progress?.stage
                    };
                mainWindow.webContents.send('ffmpeg-progress', payload);
            }, options);
            return { success: true };
        } catch (error) {
            console.error('Render timeline hatası:', error);
            return { success: false, error: error.message };
        }
    });

    // Videoları birleştir
    ipcMain.handle('concat-videos', async (event, { inputPaths, outputPath }) => {
        try {
            const firstInput = inputPaths[0];
            const ext = path.extname(firstInput).toLowerCase();
            const isAudio = ['.wav', '.mp3', '.aac', '.ogg', '.m4a', '.wma'].includes(ext);

            if (isAudio && ffmpegHandler.concatenateAudios) {
                await ffmpegHandler.concatenateAudios(inputPaths, outputPath, (percent) => {
                    mainWindow.webContents.send('ffmpeg-progress', { operation: 'concat-audio', percent });
                });
            } else {
                await ffmpegHandler.concatenateVideos(inputPaths, outputPath, (percent) => {
                    mainWindow.webContents.send('ffmpeg-progress', { operation: 'concat', percent });
                }, (log) => {
                    mainWindow.webContents.send('ffmpeg-log', log);
                });
            }
            // İşlem bittiğinde %100 gönder
            mainWindow.webContents.send('ffmpeg-progress', { operation: 'concat', percent: 100 });
            return { success: true };
        } catch (error) {
            console.error('Concat error:', error);
            return { success: false, error: error.message };
        }
    });

    // Hızlı video birleştir (stream copy - aynı codec gerekli)
    ipcMain.handle('concat-videos-fast', async (event, { inputPaths, outputPath }) => {
        try {
            await ffmpegHandler.concatenateVideosFast(inputPaths, outputPath, (percent) => {
                mainWindow.webContents.send('ffmpeg-progress', { operation: 'concat-fast', percent });
            }, (log) => {
                mainWindow.webContents.send('ffmpeg-log', log);
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Video döndür
    ipcMain.handle('rotate-video', async (event, { inputPath, outputPath, degrees }) => {
        try {
            await ffmpegHandler.rotateVideo(inputPath, outputPath, degrees, (percent) => {
                mainWindow.webContents.send('ffmpeg-progress', { operation: 'rotate', percent });
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Ses çıkar
    ipcMain.handle('extract-audio', async (event, { inputPath, outputPath }) => {
        try {
            await ffmpegHandler.extractAudio(inputPath, outputPath, (percent) => {
                mainWindow.webContents.send('ffmpeg-progress', { operation: 'extract-audio', percent });
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Video çıkar (sessiz)
    ipcMain.handle('extract-video', async (event, { inputPath, outputPath }) => {
        try {
            await ffmpegHandler.extractVideo(inputPath, outputPath, (percent) => {
                mainWindow.webContents.send('ffmpeg-progress', { operation: 'extract-video', percent });
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Ses karıştır
    // Ses karıştır
    ipcMain.handle('mix-audio', async (event, params) => {
        try {
            // ffmpegHandler.mixAudio artık tek bir obje parametresi + callback bekliyor
            await ffmpegHandler.mixAudio(params, (percent) => {
                mainWindow.webContents.send('ffmpeg-progress', { operation: 'mix-audio', percent });
            });
            return { success: true, outputPath: params.outputPath };
        } catch (error) {
            console.error('mix-audio hatası:', error);
            return { success: false, error: error.message };
        }
    });

    // Gelişmiş ses karıştırma
    ipcMain.handle('mix-audio-advanced', async (event, options) => {
        try {
            await ffmpegHandler.mixAudioAdvanced(options, (percent) => {
                mainWindow.webContents.send('ffmpeg-progress', { operation: 'mix-audio-advanced', percent });
            });
            return { success: true, outputPath: options.outputPath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Ses Ayarları için Render Edilmiş Önizleme (5sn)
    ipcMain.handle('preview-audio-segment', async (event, params) => {
        try {
            const { videoPath, startTime, duration, settings } = params;
            const tempDir = os.tmpdir();
            const timestamp = Date.now();
            const outputPath = path.join(tempDir, `preview_audio_${timestamp}.wav`);

            console.log('IPC: Preview Audio Segment requested', params);

            // Pass onStatus callback to notify renderer
            // We need to modify previewAudioSegment in ffmpeg-handler to invoke this callback which calls ensureRNNoiseModel
            // Actually, we modified call site in ffmpeg-handler.js but we didn't pass the callback FROM here properly to there.
            // Wait, ffmpegHandler.previewAudioSegment signature is: (input, output, start, dur, settings, onStatus) - I need to update it in ffmpeg-handler first!

            // Let's assume I updated ffmpeg-handler to accept onStatus as 6th arg or inside settings?
            // Since I only updated the CALL to ensureRNNoiseModel inside previewAudioSegment, I hardcoded the callback there.
            // To make it dynamic, I should have updated previewAudioSegment signature.

            // Re-eval step: Update ffmpeg-handler.previewAudioSegment signature first.

            await ffmpegHandler.previewAudioSegment(videoPath, outputPath, startTime, duration, settings, (status) => {
                if (status === 'downloading') {
                    mainWindow.webContents.send('show-info', {
                        title: t('messages.ai_model_downloading_title', 'AI Model Downloading'),
                        message: t('messages.ai_model_downloading_message', 'The AI model required for noise reduction is being downloaded. This is only done once.')
                    });
                }
            });

            return { success: true, audioPath: outputPath };
        } catch (error) {
            console.error('Preview Audio Error:', error);
            return { success: false, error: error.message };
        }
    });

    // Dosyayı Base64 olarak oku
    ipcMain.handle('read-file-base64', async (event, filePath) => {
        try {
            if (!fs.existsSync(filePath)) throw new Error('Dosya bulunamadı.');
            const buffer = fs.readFileSync(filePath);
            return { success: true, base64: buffer.toString('base64') };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });



    // Altyazı yak
    ipcMain.handle('burn-subtitles', async (event, { videoPath, subtitlePath, outputPath, styleOptions } = {}) => {
        try {
            await ffmpegHandler.burnSubtitles(videoPath, subtitlePath, outputPath, styleOptions, (percent) => {
                mainWindow.webContents.send('ffmpeg-progress', { operation: 'burn-subtitles', percent });
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Metin ekle
    ipcMain.handle('add-text-overlay', async (event, params) => {
        try {
            const {
                videoPath, outputPath, text,
                font, fontSize, fontColor, background, position, transition,
                customX, customY,
                startTime, endTime, shadow,
                ttsEnabled, ttsVoice, ttsSpeed, ttsVolume, videoVolume
            } = params;
            const options = {
                font,
                fontSize,
                fontColor,
                background,
                position,
                customX,
                customY,
                transition,
                startTime,
                endTime,
                shadow,
                ttsEnabled,
                ttsVoice,
                ttsSpeed,
                ttsVolume,
                videoVolume
            };
            await ffmpegHandler.addTextOverlay(videoPath, outputPath, text, options, (percent) => {
                mainWindow.webContents.send('ffmpeg-progress', { operation: 'add-text', percent });
            });
            mainWindow.webContents.send('ffmpeg-progress', { operation: 'add-text', percent: 100 });
            return { success: true, outputPath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Görsel overlay ekle
    ipcMain.handle('add-image-overlay', async (event, params) => {
        try {
            const { videoPath, imagePath, outputPath, options } = params;
            await ffmpegHandler.addImageOverlay(videoPath, imagePath, outputPath, options, (percent) => {
                mainWindow.webContents.send('ffmpeg-progress', { operation: 'add-image', percent });
            });
            return { success: true, outputPath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Geçiş efekti ekle
    ipcMain.handle('add-transition', async (event, params) => {
        try {
            const { videoPath, outputPath, options } = params;
            await ffmpegHandler.addTransition(videoPath, outputPath, options, (percent) => {
                mainWindow.webContents.send('ffmpeg-progress', { operation: 'add-transition', percent });
            });
            return { success: true, outputPath };
        } catch (error) {
            console.error('add-transition hatası:', error);
            return { success: false, error: error.message };
        }
    });

    // Akıllı Geçiş Uygulama (Toplu)
    ipcMain.handle('apply-transitions-smart', async (event, params) => {
        try {
            const { videoPath, outputPath, transitions } = params;
            await ffmpegHandler.applyTransitionsSmart(videoPath, outputPath, transitions, (percent) => {
                mainWindow.webContents.send('ffmpeg-progress', { operation: 'apply-transitions', percent });
            });
            return { success: true, outputPath };
        } catch (error) {
            console.error('Smart transition hatası:', error);
            return { success: false, error: error.message };
        }
    });

    // Base64 görüntüyü dosyaya kaydet (Geçici)
    ipcMain.handle('save-base64-image', async (event, { base64Data, filename }) => {
        try {
            const data = base64Data.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(data, 'base64');
            const tempPath = path.join(os.tmpdir(), filename || `temp_img_${Date.now()}.png`);
            await fs.promises.writeFile(tempPath, buffer);
            return { success: true, filePath: tempPath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Görsellerden video oluştur
    ipcMain.handle('create-video-from-images', async (event, { imagePaths, outputPath, duration }) => {
        try {
            await ffmpegHandler.createVideoFromImages(imagePaths, outputPath, duration, (percent) => {
                mainWindow.webContents.send('ffmpeg-progress', { operation: 'images-to-video', percent });
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Kare çıkar
    ipcMain.handle('extract-frame', async (event, { videoPath, outputPath, time }) => {
        try {
            await ffmpegHandler.extractFrame(videoPath, outputPath, time);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Video dönüştürme
    ipcMain.handle('convert-video', async (event, { inputPath, outputPath, options }) => {
        try {
            await ffmpegHandler.safeConvertVideo(inputPath, outputPath, options, (percent) => {
                mainWindow.webContents.send('ffmpeg-progress', { operation: 'convert', percent });
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Dosya varlık kontrolü
    ipcMain.handle('check-file-exists', async (event, filePath) => {
        try {
            return fs.existsSync(filePath);
        } catch (error) {
            console.error('File check error:', error);
            return false;
        }
    });

    // Ses mixleme (ffmpeg)spiti
    ipcMain.handle('detect-silence', async (event, { inputPath, minDuration, threshold }) => {
        try {
            const silences = await ffmpegHandler.detectSilence(inputPath, minDuration, threshold, (percent) => {
                mainWindow.webContents.send('ffmpeg-progress', { operation: 'detect-silence', percent });
            });
            return { success: true, data: silences };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Zaman formatla
    ipcMain.handle('format-time', (event, seconds) => {
        return ffmpegHandler.formatTime(seconds);
    });

    // Zaman parse et
    ipcMain.handle('parse-time', (event, timeString) => {
        return ffmpegHandler.parseTime(timeString);
    });

    // Hata mesajı göster
    ipcMain.handle('show-error', async (event, { title, message }) => {
        const targetWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
        const options = {
            type: 'error',
            title: title,
            message: message
        };
        await announceDialogForAccessibility(targetWindow, options);
        await dialog.showMessageBox(targetWindow, options);
    });

    // Bilgi mesajı göster
    ipcMain.handle('show-info', async (event, { title, message }) => {
        const targetWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
        const options = {
            type: 'info',
            title: title,
            message: message
        };
        await announceDialogForAccessibility(targetWindow, options);
        await dialog.showMessageBox(targetWindow, options);
    });

    // Generic Message Box (Restored from Backup for Audio/Video Dialogs)
    ipcMain.handle('show-message-box', async (event, options) => {
        const targetWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
        await announceDialogForAccessibility(targetWindow, options);
        const result = await dialog.showMessageBox(targetWindow, options);
        return result;
    });

    ipcMain.handle('show-save-confirm', async (_event, { title, message }) => {
        const options = {
            type: 'question',
            title,
            message,
            buttons: [
                t('menu.file.save', 'Save'),
                t('runtime.app.dont_save', 'Do Not Save'),
                t('dialog.cancel', 'Cancel')
            ],
            defaultId: 0,
            cancelId: 2,
            noLink: true
        };
        await announceDialogForAccessibility(mainWindow, options);
        const result = await dialog.showMessageBox(mainWindow, options);
        return result.response;
    });

    // Onay diyaloğu (Restored)
    ipcMain.handle('show-confirm', async (event, { title, message }) => {
        const targetWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
        const options = {
            type: 'question',
            title: title,
            message: message,
            buttons: [
                t('dialog.confirm.yes', 'Evet'),
                t('dialog.confirm.no', 'Hayır')
            ],
            defaultId: 0,
            cancelId: 1
        };
        await announceDialogForAccessibility(targetWindow, options);
        const result = await dialog.showMessageBox(targetWindow, options);
        return result.response === 0;
    });

    ipcMain.handle('create-feedback-draft', async (_event, { includeDiagnostics = false, currentFilePath = '' } = {}) => {
        try {
            const subject = t('feedback_mail.subject', 'EVD geri bildirim');
            const body = buildFeedbackDraftBody({
                includeDiagnostics,
                currentFilePath: sanitizeMultilineValue(currentFilePath)
            });
            const mailtoUrl = `mailto:yilmaeng@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

            await shell.openExternal(mailtoUrl);

            return {
                success: true,
                includedDiagnostics: includeDiagnostics
            };
        } catch (error) {
            console.error('Feedback draft oluşturulamadı:', error);
            return {
                success: false,
                error: error.message
            };
        }
    });



    // TTS: Sesleri al
    ipcMain.handle('get-tts-voices', async () => {
        try {
            const voices = await ttsHandler.getVoices();
            return { success: true, voices };
        } catch (error) {
            console.error('TTS voices error:', error);
            return { success: false, error: error.message };
        }
    });

    // TTS: Metni WAV dosyasına çevir
    ipcMain.handle('generate-tts', async (event, { text, voice, speed, outputPath, volume }) => {
        try {
            const wavPath = outputPath || ttsHandler.getTempWavPath();
            await ttsHandler.textToWav(text, voice, speed, wavPath, volume);
            return { success: true, wavPath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // TTS: Önizleme için seslendir
    ipcMain.handle('tts-speak-preview', async (event, { text, voice, speed }) => {
        try {
            await ttsHandler.speak(text, voice, speed);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // TTS: Seslendirmeyi durdur
    ipcMain.handle('tts-stop', async () => {
        try {
            ttsHandler.stop();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Geçici dosya yolu oluştur
    ipcMain.handle('get-temp-path', async (event, filename) => {
        const os = require('os');
        return path.join(os.tmpdir(), filename);
    });

    // Dosya kopyala
    ipcMain.handle('copy-file', async (event, { src, dest }) => {
        const fs = require('fs');
        try {
            fs.copyFileSync(src, dest);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Dosya sil (Toplu)
    ipcMain.handle('delete-files', async (event, filePaths) => {
        const fs = require('fs');
        try {
            for (const filePath of filePaths) {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
            return { success: true };
        } catch (error) {
            console.error('Dosya silme hatası:', error);
            return { success: false, error: error.message };
        }
    });

    // Dosya İçeriği Kaydet (JSON/Text)
    ipcMain.handle('save-file-content', async (event, { filePath, content }) => {
        try {
            const fs = require('fs');
            fs.writeFileSync(filePath, content, 'utf-8');
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Concat Audio
    ipcMain.handle('create-audio-from-concat', async (event, { concatFilePath, outputPath }) => {
        try {
            await ffmpegHandler.createAudioFromConcat(concatFilePath, outputPath, (percent) => {
                mainWindow.webContents.send('ffmpeg-progress', { operation: 'create-audio-concat', percent });
            });
            return { success: true, outputPath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Generate Silence
    ipcMain.handle('generate-silence', async (event, { duration, outputPath }) => {
        try {
            await ffmpegHandler.generateSilence(duration, outputPath);
            return { success: true, outputPath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });



    // Create Audio from Mix (Adelay + Amix)
    ipcMain.handle('create-audio-from-mix', async (event, { audioSegments, outputPath }) => {
        try {
            await ffmpegHandler.createAudioFromMix(audioSegments, outputPath, (percent) => {
                mainWindow.webContents.send('ffmpeg-progress', { operation: 'create-audio-mix', percent });
            });
            return { success: true, outputPath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Dosya İçeriği Oku
    ipcMain.handle('read-file-content', async (event, filePath) => {
        try {
            const fs = require('fs');
            if (!fs.existsSync(filePath)) throw new Error('Dosya bulunamadı');
            const content = fs.readFileSync(filePath, 'utf-8');
            return { success: true, content };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });


    // Vertical Video Wizard (Shorts)
    ipcMain.handle('create-vertical-video', async (event, { inputPath, outputPath, options }) => {
        try {
            await ffmpegHandler.createVerticalVideo(inputPath, outputPath, options, (percent) => {
                event.sender.send('ffmpeg-progress', { percent });
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('create-vertical-video-preview', async (event, { inputPath, options }) => {
        try {
            const os = require('os');
            const tempPath = path.join(os.tmpdir(), `preview_vert_${Date.now()}.mp4`);
            await ffmpegHandler.createVerticalVideoPreview(inputPath, tempPath, options);
            return { success: true, outputPath: tempPath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // === MEDIA COMPATIBILITY SERVICE ===

    // Akıllı dosya açma - uyumluluk kontrolü ve gerekirse dönüştürme
    ipcMain.handle('smart-open-video', async (event, filePath) => {
        try {
            const result = await mediaCompatibility.smartOpen(
                filePath,
                // Progress callback
                (progress) => {
                    mainWindow.webContents.send('media-compat-progress', progress);
                },
                // Status change callback
                (status) => {
                    mainWindow.webContents.send('media-compat-status', status);
                }
            );
            return result;
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Sadece uyumluluk analizi yap (dönüştürme yapmadan)
    ipcMain.handle('analyze-video-compatibility', async (event, filePath) => {
        try {
            const analysis = await mediaCompatibility.analyzeCompatibility(filePath);
            return { success: true, ...analysis };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Video probe (detaylı metadata)
    ipcMain.handle('probe-video', async (event, filePath) => {
        try {
            const probe = await mediaCompatibility.probeVideo(filePath);
            return { success: true, probe };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Hızlı remux (container değiştir)
    ipcMain.handle('quick-remux', async (event, filePath) => {
        try {
            const result = await mediaCompatibility.quickRemux(filePath, (progress) => {
                mainWindow.webContents.send('ffmpeg-progress', {
                    operation: 'remux',
                    percent: progress.percent
                });
            });
            return result;
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Tam transcode
    ipcMain.handle('smart-transcode', async (event, { filePath, options }) => {
        try {
            const result = await mediaCompatibility.transcode(filePath, options, (progress) => {
                mainWindow.webContents.send('ffmpeg-progress', {
                    operation: 'transcode',
                    percent: progress.percent,
                    stage: progress.stage,
                    speed: progress.speed
                });
            });
            return result;
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Cache temizle
    ipcMain.handle('clear-media-cache', async (event, olderThanDays) => {
        try {
            const cleared = mediaCompatibility.clearCache(olderThanDays || 7);
            return { success: true, clearedFiles: cleared };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Cache boyutunu al
    ipcMain.handle('get-media-cache-size', async () => {
        try {
            const size = mediaCompatibility.getCacheSize();
            return { success: true, size };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Context Menu Göster
    ipcMain.on('show-context-menu', (event, template) => {
        if (!template || !Array.isArray(template)) return;

        const menuTemplate = template.map(item => ({
            label: item.label,
            click: () => {
                event.sender.send('context-menu-command', { action: item.click, id: item.id, index: item.index });
            }
        }));

        const menu = Menu.buildFromTemplate(menuTemplate);
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
            menu.popup({ window: win });
        }
    });

    // --- SYNC WIZARD HANDLERS ---

    // Open Sync Wizard (from Renderer)
    ipcMain.on('open-sync-wizard', (event, mode) => {
        const { openSyncWizard } = require('./dialog-windows');
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
            openSyncWizard(win, mode);
        }
    });

    // Open Vertical Video Wizard (Shorts/Reels) from Renderer
    ipcMain.on('open-vertical-wizard', (event, data) => {
        const { openVerticalWizard } = require('./dialog-windows');
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
            openVerticalWizard(win, data || null);
        }
    });

    // Open Accessible Recording Wizard from Renderer
    ipcMain.on('open-recording-wizard', (event, options) => {
        const { openRecordingWizard } = require('./dialog-windows');
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
            openRecordingWizard(win, options || {});
        }
    });

    ipcMain.on('open-live-effects-panel', (event) => {
        const { openLiveEffectsPanel } = require('./dialog-windows');
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
            openLiveEffectsPanel(win);
        }
    });

    ipcMain.on('recording-wizard-log', (_event, payload) => {
        const safePayload = payload && typeof payload === 'object'
            ? payload
            : { message: String(payload || '') };
        console.log('[RecordingWizard]', safePayload);
    });

    ipcMain.handle('live-effects-get-state', async () => {
        return { success: true, state: liveEffectsHandler.getState() };
    });

    ipcMain.handle('live-effects-save-profile', async (_event, profile) => {
        return { success: true, state: liveEffectsHandler.saveProfile(profile) };
    });

    ipcMain.handle('live-effects-create-profile', async (_event, { name }) => {
        return { success: true, state: liveEffectsHandler.createProfile(name) };
    });

    ipcMain.handle('live-effects-delete-profile', async (_event, { profileId }) => {
        return { success: true, state: liveEffectsHandler.deleteProfile(profileId) };
    });

    ipcMain.handle('live-effects-set-active-profile', async (_event, { profileId }) => {
        return { success: true, state: liveEffectsHandler.setActiveProfile(profileId) };
    });

    // Render Sync Video
    ipcMain.handle('render-sync-video', async (event, { videoPath, audioPath, offsetMs, muteOriginal, targetOutputPath }) => {
        try {
            const path = require('path');
            // If targetOutputPath is provided, use it. Otherwise default to auto-generated.
            let outputPath = targetOutputPath || path.join(path.dirname(videoPath), `synced_output_${Date.now()}.mp4`);
            if (outputPath && !path.extname(outputPath)) {
                outputPath += '.mp4';
            }

            await ffmpegHandler.replaceAudio(videoPath, audioPath, offsetMs, muteOriginal, outputPath, (percent) => {
                // Optional: Send progress back?
            });
            return { success: true, outputPath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Save Temp Recording
    ipcMain.handle('save-temp-recording', async (event, buffer) => {
        try {
            const path = require('path');
            const os = require('os');
            const fs = require('fs');
            const tempName = `rec_${Date.now()}`;
            const videoPath = path.join(os.tmpdir(), `${tempName}.webm`);
            const audioPath = path.join(os.tmpdir(), `${tempName}.wav`);

            fs.writeFileSync(videoPath, buffer);

            // Extract Audio and Normalize
            await new Promise((resolve, reject) => {
                const ffmpeg = require('fluent-ffmpeg');
                ffmpeg(videoPath)
                    .audioFilters('dynaudnorm=f=150:g=15:m=10.0') // SESİ DENGELER VE GÜÇLENDİRİR
                    .output(audioPath)
                    .on('end', resolve)
                    .on('error', reject)
                    .run();
            });

            return { success: true, videoPath, audioPath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Helper for Wizard File Selection
    ipcMain.handle('show-open-dialog', async (event, { extensions, allowMultiple = false }) => {
        const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
            filters: [
                { name: t('messages.media_files_filter', 'Media Files'), extensions: extensions || ['*'] }
            ],
            properties: allowMultiple ? ['openFile', 'multiSelections'] : ['openFile']
        });
        return result;
    });




    // === VIDEO LAYER (Picture-in-Picture) HANDLERS ===

    // CTA Overlay Ekle
    ipcMain.handle('add-cta-overlay', async (event, params) => {
        try {
            await ffmpegHandler.addCtaOverlay(params, (percent) => {
                mainWindow.webContents.send('ffmpeg-progress', { operation: 'add-cta-overlay', percent });
            });
            return { success: true, outputPath: params.outputPath };
        } catch (error) {
            console.error('CTA Overlay Hatası:', error);
            return { success: false, error: error.message };
        }
    });

    // Smart CTA Overlay Ekle (Toplu)
    ipcMain.handle('apply-cta-overlays-smart', async (event, params) => {
        try {
            const { videoPath, outputPath, overlays } = params;
            await ffmpegHandler.applyCtaOverlaysSmart(videoPath, outputPath, overlays, (percent) => {
                mainWindow.webContents.send('ffmpeg-progress', { operation: 'apply-cta-smart', percent });
            });
            return { success: true, outputPath };
        } catch (error) {
            console.error('Smart CTA Overlay Hatası:', error);
            return { success: false, error: error.message };
        }
    });

    // Video katmanı ekle
    ipcMain.handle('add-video-layer', async (event, params) => {
        try {
            const result = await ffmpegHandler.addVideoLayer(params, (percent) => {
                mainWindow.webContents.send('ffmpeg-progress', { operation: 'add-video-layer', percent });
            });
            return { success: true, outputPath: result };
        } catch (error) {
            console.error('Video katmanı ekleme hatası:', error);
            return { success: false, error: error.message };
        }
    });

    // AI ile konum önerisi al
    ipcMain.handle('get-video-layer-ai-suggestion', async (event, params) => {
        try {
            const { mainVideoPath, layerVideoPath, purpose, currentTime } = params;

            // Video metadata'larını al
            const mainMeta = await ffmpegHandler.getVideoMetadata(mainVideoPath);
            const layerMeta = await ffmpegHandler.getVideoMetadata(layerVideoPath);

            const mainWidth = mainMeta.width || 1920;
            const mainHeight = mainMeta.height || 1080;

            // Amaca göre varsayılan öneriler
            let suggestions = [];

            switch (purpose) {
                case 'sign-language':
                    // İşaret dili: Sağ alt, %12.5 (Türkiye standardı: 8'de bir)
                    const slWidth = Math.round(mainWidth * 0.125);
                    const slHeight = Math.round(slWidth * (layerMeta.height / layerMeta.width));
                    suggestions.push({
                        x: mainWidth - slWidth - 20,
                        y: mainHeight - slHeight - 20,
                        width: slWidth,
                        height: slHeight,
                        positionKey: 'runtime.video_layer.position_bottom_right',
                        positionFallback: 'Bottom Right',
                        reasonKey: 'runtime.video_layer.ai_reason_sign_language',
                        reasonFallback: 'Standard sign-language position (12.5%, one eighth of the frame).'
                    });
                    break;

                case 'split-screen':
                    // Split screen: Sol yarı
                    suggestions.push({
                        x: 0,
                        y: 0,
                        width: Math.round(mainWidth / 2),
                        height: mainHeight,
                        positionKey: 'runtime.video_layer.ai_position_left_half',
                        positionFallback: 'Left Half',
                        reasonKey: 'runtime.video_layer.ai_reason_split_screen',
                        reasonFallback: 'Left half is suitable for split-screen mode.'
                    });
                    break;

                case 'camera-corner':
                    // Kamera köşede: Sağ üst, %15
                    const ccWidth = Math.round(mainWidth * 0.15);
                    const ccHeight = Math.round(ccWidth * (layerMeta.height / layerMeta.width));
                    suggestions.push({
                        x: mainWidth - ccWidth - 10,
                        y: 10,
                        width: ccWidth,
                        height: ccHeight,
                        positionKey: 'runtime.video_layer.position_top_right',
                        positionFallback: 'Top Right',
                        reasonKey: 'runtime.video_layer.ai_reason_camera_corner',
                        reasonFallback: 'Ideal position for a corner camera.'
                    });
                    break;

                default:
                    // Serbest: Merkez-alt öner
                    const defWidth = Math.round(mainWidth * 0.25);
                    const defHeight = Math.round(defWidth * (layerMeta.height / layerMeta.width));
                    suggestions.push({
                        x: Math.round((mainWidth - defWidth) / 2),
                        y: mainHeight - defHeight - 20,
                        width: defWidth,
                        height: defHeight,
                        positionKey: 'runtime.video_layer.position_bottom_center',
                        positionFallback: 'Bottom Center',
                        reasonKey: 'runtime.video_layer.ai_reason_default',
                        reasonFallback: 'A centered position that is less likely to cover important content.'
                    });
            }

            return {
                success: true,
                suggestions,
                mainResolution: { width: mainWidth, height: mainHeight },
                layerResolution: { width: layerMeta.width, height: layerMeta.height }
            };
        } catch (error) {
            console.error('AI öneri hatası:', error);
            return { success: false, error: error.message };
        }
    });

    // Dosya Yeniden Adlandır
    ipcMain.handle('rename-file', async (event, { oldPath, newPath }) => {
        try {
            // Önce hedef dosya varsa sil
            if (fs.existsSync(newPath)) {
                fs.unlinkSync(newPath);
            }
            fs.renameSync(oldPath, newPath);
            return { success: true };
        } catch (error) {
            console.error('Dosya yeniden adlandırma hatası:', error);
            return { success: false, error: error.message };
        }
    });

    // Uygulamayı kapat
    ipcMain.on('quit-app', () => {
        const { app } = require('electron');
        app.quit();
    });

    // Desktop Capturer Sources (Moved from Renderer to Main to avoid crash)
    ipcMain.handle('get-desktop-sources', async (event, options) => {
        try {
            const { desktopCapturer } = require('electron');
            const opts = options || { types: ['screen', 'window'] };
            if (!opts.thumbnailSize) opts.thumbnailSize = { width: 0, height: 0 };
            const sources = await desktopCapturer.getSources(opts);
            return { success: true, sources };
        } catch (error) {
            console.error('get-desktop-sources error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-native-window-sources', async () => {
        try {
            const sources = await getNativeWindowSources();
            return { success: true, sources };
        } catch (error) {
            console.error('get-native-window-sources error:', error);
            return { success: false, error: error.message, sources: [] };
        }
    });

    ipcMain.handle('show-native-notification', async (event, { title, body, silent = true } = {}) => {
        try {
            if (!Notification.isSupported()) {
                console.warn('Native notification is not supported on this system.');
                return { success: false, error: 'Native notifications are not supported on this system.' };
            }

            console.log('Showing native notification:', {
                title: String(title || '').trim() || 'Korcul Video Editor',
                body: String(body || '').trim(),
                silent: !!silent
            });

            const notification = new Notification({
                title: String(title || '').trim() || 'Korcul Video Editor',
                body: String(body || '').trim(),
                silent: !!silent
            });

            const senderWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
            notification.on('click', () => {
                try {
                    if (senderWindow) {
                        if (senderWindow.isMinimized()) {
                            senderWindow.restore();
                        }
                        senderWindow.show();
                        senderWindow.focus();
                    }
                } catch (focusError) {
                    console.warn('notification focus error:', focusError);
                }
            });

            notification.show();
            console.log('Native notification show() called successfully.');
            return { success: true };
        } catch (error) {
            console.error('show-native-notification error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('window-is-focused', async (event) => {
        try {
            const senderWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
            const focusedWindow = BrowserWindow.getFocusedWindow();
            const focused = !!(senderWindow && focusedWindow && senderWindow.id === focusedWindow.id);
            return { success: true, focused };
        } catch (error) {
            return { success: false, focused: true, error: error.message };
        }
    });

    ipcMain.handle('flash-window-attention', async (event, { durationMs = 6000 } = {}) => {
        try {
            const senderWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
            if (!senderWindow || senderWindow.isDestroyed()) {
                return { success: false, error: 'window_not_found' };
            }

            senderWindow.flashFrame(true);
            setTimeout(() => {
                try {
                    if (!senderWindow.isDestroyed()) {
                        senderWindow.flashFrame(false);
                    }
                } catch (error) {
                    console.warn('flash-window-attention stop failed:', error);
                }
            }, Math.max(1000, Number(durationMs) || 6000));

            return { success: true };
        } catch (error) {
            console.error('flash-window-attention error:', error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = { setupIpcHandlers };
