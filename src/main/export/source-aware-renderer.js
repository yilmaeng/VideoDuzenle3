const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { analyzeSource } = require('./source-profile-analyzer');
const { estimateExport, sumTimelineDuration } = require('./export-estimator');
const { resolveAudioProfile, resolveVideoProfile } = require('./export-profile-resolver');
const { renderContinuousAudio, runFfmpeg } = require('./continuous-audio-renderer');
const { validateOutput } = require('./output-validator');

let encoderCache = null;

async function getAvailableEncoders(ffmpegPath) {
    if (encoderCache) return encoderCache;
    encoderCache = await new Promise((resolve) => {
        const child = spawn(ffmpegPath, ['-hide_banner', '-encoders'], { windowsHide: true });
        let output = '';
        child.stdout.on('data', (chunk) => { output += chunk.toString(); });
        child.stderr.on('data', (chunk) => { output += chunk.toString(); });
        child.on('close', () => {
            const encoders = new Set();
            for (const line of output.split(/\r?\n/)) {
                const match = line.match(/^\s*[VAS\.]{6}\s+([^\s]+)/);
                if (match) encoders.add(match[1]);
            }
            resolve(encoders);
        });
        child.on('error', () => resolve(new Set(['libx264', 'aac', 'alac'])));
    });
    return encoderCache;
}

function colorOutputArgs(color = {}) {
    const args = [];
    if (color.range) args.push('-color_range', color.range);
    if (color.space) args.push('-colorspace', color.space);
    if (color.primaries) args.push('-color_primaries', color.primaries);
    if (color.transfer) args.push('-color_trc', color.transfer);
    return args;
}

function cleanupPassLogs(directory, prefix) {
    try {
        for (const name of fs.readdirSync(directory)) {
            if (name.startsWith(path.basename(prefix))) {
                try { fs.unlinkSync(path.join(directory, name)); } catch (_error) {}
            }
        }
    } catch (_error) {}
}

async function renderVideoOnlyPass({
    ffmpegPath,
    inputPath,
    segments,
    profiles,
    outputPath,
    videoProfile,
    inputSeekOffsets = null,
    onProgress
}) {
    const uniqueSources = [];
    const sourceIndexes = new Map();
    for (const segment of segments) {
        const source = path.resolve(segment.sourceFile || inputPath);
        if (!sourceIndexes.has(source)) {
            sourceIndexes.set(source, uniqueSources.length);
            uniqueSources.push(source);
        }
    }
    const filterLines = segments.map((segment, index) => {
        const source = path.resolve(segment.sourceFile || inputPath);
        const inputIndex = sourceIndexes.get(source);
        const inputOffset = Math.max(0, Number(inputSeekOffsets?.get(source) || 0));
        const start = Math.max(0, Number(segment.start || 0) - inputOffset);
        const end = Math.max(start, Number(segment.end || segment.start || 0) - inputOffset);
        // trim's start is inclusive and end is exclusive. Keep decimal
        // rounding from dropping the first frame or duplicating the next one.
        const inclusiveStart = Math.max(0, start - 0.000001);
        const exclusiveEnd = Math.max(inclusiveStart, end - 0.000001);
        const speed = Math.max(0.01, Number(segment.speed || 1));
        return `[${inputIndex}:v:0]trim=start=${inclusiveStart.toFixed(6)}:end=${exclusiveEnd.toFixed(6)},setpts=(PTS-STARTPTS)/${speed.toFixed(8)},scale=${videoProfile.width}:${videoProfile.height}:force_original_aspect_ratio=decrease,pad=${videoProfile.width}:${videoProfile.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=${videoProfile.pixelFormat}[v${index}]`;
    });
    filterLines.push(`${segments.map((_, index) => `[v${index}]`).join('')}concat=n=${segments.length}:v=1:a=0:unsafe=1[vout]`);
    const scriptPath = path.join(path.dirname(outputPath), `evd_video_filter_${Date.now()}_${process.pid}.txt`);
    const passLogPrefix = path.join(path.dirname(outputPath), `evd_2pass_${Date.now()}_${process.pid}`);
    fs.writeFileSync(scriptPath, `${filterLines.join(';\n')}\n`, 'utf8');
    const duration = sumTimelineDuration(segments);
    const baseArgs = ['-y'];
    uniqueSources.forEach((source) => {
        const inputOffset = Math.max(0, Number(inputSeekOffsets?.get(source) || 0));
        if (inputOffset > 0) baseArgs.push('-ss', inputOffset.toFixed(6));
        baseArgs.push('-i', source);
    });
    baseArgs.push('-filter_complex_script', scriptPath, '-map', '[vout]', '-map_metadata', '0', '-map_chapters', '0', '-an');
    const encodeArgs = ['-c:v', videoProfile.codec, '-preset', videoProfile.preset, '-pix_fmt', videoProfile.pixelFormat];
    if (videoProfile.bitrate) {
        if (videoProfile.exactTargetSize) {
            encodeArgs.push(
                '-b:v', String(videoProfile.bitrate),
                '-minrate', String(videoProfile.bitrate),
                '-maxrate', String(videoProfile.bitrate),
                '-bufsize', String(Math.round(videoProfile.bitrate * 2))
            );
            if (videoProfile.codec === 'libx264') {
                encodeArgs.push('-x264-params', 'nal-hrd=cbr:force-cfr=1');
            }
        } else {
            encodeArgs.push('-b:v', String(videoProfile.bitrate), '-maxrate', String(Math.round(videoProfile.bitrate * 1.2)), '-bufsize', String(Math.round(videoProfile.bitrate * 2)));
        }
    } else if (Array.isArray(videoProfile.encoderArgs) && videoProfile.encoderArgs.length) {
        encodeArgs.push(...videoProfile.encoderArgs);
    } else {
        encodeArgs.push('-crf', String(videoProfile.crf));
    }
    encodeArgs.push(...colorOutputArgs(videoProfile.color), '-movflags', '+faststart');

    try {
        if (videoProfile.twoPass) {
            const nullTarget = process.platform === 'win32' ? 'NUL' : '/dev/null';
            onProgress?.({ operation: 'source-aware-pass-1', percent: 0 });
            await runFfmpeg(ffmpegPath, [...baseArgs, ...encodeArgs, '-pass', '1', '-passlogfile', passLogPrefix, '-f', 'null', nullTarget], {
                duration,
                onProgress: (percent) => onProgress?.({ operation: 'source-aware-pass-1', percent: percent * 0.45 })
            });
            onProgress?.({ operation: 'source-aware-pass-2', percent: 45 });
            await runFfmpeg(ffmpegPath, [...baseArgs, ...encodeArgs, '-pass', '2', '-passlogfile', passLogPrefix, outputPath], {
                duration,
                onProgress: (percent) => onProgress?.({ operation: 'source-aware-pass-2', percent: 45 + percent * 0.45 })
            });
        } else {
            onProgress?.({ operation: 'source-aware-video', percent: 0 });
            await runFfmpeg(ffmpegPath, [...baseArgs, ...encodeArgs, outputPath], {
                duration,
                onProgress: (percent) => onProgress?.({ operation: 'source-aware-video', percent: percent * 0.9 })
            });
        }
    } finally {
        try { fs.unlinkSync(scriptPath); } catch (_error) {}
        cleanupPassLogs(path.dirname(outputPath), passLogPrefix);
    }
}

const SOURCE_AWARE_BATCH_THRESHOLD = 80;
const SOURCE_AWARE_BATCH_SIZE = 25;

function writeVideoConcatList(filePath, entries) {
    const content = entries
        .map(({ file, duration }) => [
            `file '${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`,
            `duration ${Math.max(0.001, Number(duration || 0)).toFixed(6)}`
        ].join('\n'))
        .join('\n');
    fs.writeFileSync(filePath, `${content}\n`, 'utf8');
}

function buildBatchInputOffsets(segments, inputPath) {
    const offsets = new Map();
    for (const segment of segments) {
        const source = path.resolve(segment.sourceFile || inputPath);
        const start = Math.max(0, Number(segment.start || 0));
        const current = offsets.get(source);
        if (!Number.isFinite(current) || start < current) offsets.set(source, start);
    }
    for (const [source, start] of offsets) {
        // Decode a short lead-in so exact trim boundaries remain stable after input seeking.
        offsets.set(source, Math.max(0, start - 2));
    }
    return offsets;
}

async function renderVideoOnly({
    ffmpegPath,
    inputPath,
    segments,
    profiles,
    outputPath,
    videoProfile,
    onProgress
}) {
    if (segments.length <= SOURCE_AWARE_BATCH_THRESHOLD) {
        return renderVideoOnlyPass({
            ffmpegPath,
            inputPath,
            segments,
            profiles,
            outputPath,
            videoProfile,
            onProgress
        });
    }

    const extension = path.extname(outputPath) || '.mp4';
    const tempBase = path.join(
        path.dirname(outputPath),
        `${path.basename(outputPath, extension)}.evd-quality-batch-${Date.now()}-${process.pid}`
    );
    const batchFiles = [];
    const batchEntries = [];
    const listPath = `${tempBase}.concat.txt`;
    const totalDuration = Math.max(0.001, sumTimelineDuration(segments));
    let completedDuration = 0;

    try {
        for (let index = 0; index < segments.length; index += SOURCE_AWARE_BATCH_SIZE) {
            const batch = segments.slice(index, index + SOURCE_AWARE_BATCH_SIZE);
            const batchDuration = sumTimelineDuration(batch);
            const batchPath = `${tempBase}.${Math.floor(index / SOURCE_AWARE_BATCH_SIZE)}${extension}`;
            batchFiles.push(batchPath);
            batchEntries.push({ file: batchPath, duration: batchDuration });
            const batchNumber = batchFiles.length;
            const batchCount = Math.ceil(segments.length / SOURCE_AWARE_BATCH_SIZE);
            await renderVideoOnlyPass({
                ffmpegPath,
                inputPath,
                segments: batch,
                profiles,
                outputPath: batchPath,
                videoProfile,
                inputSeekOffsets: buildBatchInputOffsets(batch, inputPath),
                onProgress: (progress) => {
                    const passPercent = Math.min(100, Math.max(0, Number(progress?.percent || 0) / 0.9));
                    onProgress?.({
                        ...progress,
                        operation: 'source-aware-video-batch',
                        percent: ((completedDuration + batchDuration * passPercent / 100) / totalDuration) * 82,
                        current: batchNumber,
                        total: batchCount
                    });
                }
            });
            completedDuration += batchDuration;
        }

        writeVideoConcatList(listPath, batchEntries);
        await runFfmpeg(ffmpegPath, [
            '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
            '-map', '0:v:0', '-an', '-c:v', 'copy',
            '-fflags', '+genpts', '-avoid_negative_ts', 'make_zero',
            '-movflags', '+faststart', outputPath
        ], {
            duration: totalDuration,
            onProgress: (percent) => onProgress?.({
                operation: 'source-aware-video-batch-concat',
                percent: 82 + Math.min(100, Math.max(0, Number(percent || 0))) * 0.08,
                current: batchFiles.length,
                total: batchFiles.length
            })
        });
    } finally {
        for (const file of [...batchFiles, listPath]) {
            try { fs.unlinkSync(file); } catch (_error) {}
        }
    }
}

async function atomicReplace(tempPath, outputPath) {
    const backupPath = `${outputPath}.evd-backup-${Date.now()}`;
    let backedUp = false;
    try {
        if (fs.existsSync(outputPath)) {
            fs.renameSync(outputPath, backupPath);
            backedUp = true;
        }
        fs.renameSync(tempPath, outputPath);
        if (backedUp) fs.unlinkSync(backupPath);
    } catch (error) {
        if (!fs.existsSync(outputPath) && backedUp && fs.existsSync(backupPath)) {
            try { fs.renameSync(backupPath, outputPath); } catch (_restoreError) {}
        }
        throw error;
    } finally {
        try { if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath); } catch (_error) {}
    }
}

async function muxAndValidate({
    ffmpegPath,
    ffprobePath,
    videoPath,
    pcmAudioPath,
    outputPath,
    segments,
    videoProfile,
    audioProfile,
    targetSize = 0,
    rotation = 0,
    onProgress
}) {
    const extension = path.extname(outputPath) || '.mp4';
    const tempOutput = path.join(path.dirname(outputPath), `${path.basename(outputPath, extension)}.evd-partial-${Date.now()}${extension}`);
    const audioArgs = audioProfile.codec === 'aac'
        ? ['-c:a', 'aac', '-b:a', String(audioProfile.bitrate)]
        : ['-c:a', audioProfile.codec];
    const args = [
        '-y', '-i', videoPath, '-i', pcmAudioPath,
        '-map', '0:v:0', '-map', '1:a:0',
        '-map_metadata', '0', '-map_chapters', '0',
        '-c:v', 'copy', ...audioArgs,
        '-ar', String(audioProfile.sampleRate)
    ];
    if (['.mp4', '.mov', '.m4v'].includes(extension.toLowerCase())) args.push('-movflags', '+faststart');
    if (Math.abs(Number(rotation || 0)) > 0.1) {
        args.push('-metadata:s:v:0', `rotate=${Number(rotation)}`);
    }
    args.push(tempOutput);
    try {
        await runFfmpeg(ffmpegPath, args, {
            duration: sumTimelineDuration(segments),
            onProgress: (percent) => onProgress?.({ operation: 'source-aware-mux', percent: 90 + percent * 0.08 })
        });
        onProgress?.({ operation: 'source-aware-validate', percent: 98 });
        const validation = await validateOutput({
            ffprobePath,
            outputPath: tempOutput,
            segments,
            expectedVideo: videoProfile,
            targetSize,
            sizeTolerance: 0.1
        });
        if (!validation.valid) {
            console.warn('[EVD Source-Aware Validation Failed]', {
                reasons: validation.reasons,
                expectedDuration: validation.expectedDuration,
                containerDuration: validation.actualDuration,
                videoDuration: validation.profile?.video?.duration,
                audioDuration: validation.profile?.audio?.[0]?.duration,
                durationDelta: validation.durationDelta,
                avDrift: validation.avDrift
            });
            throw new Error(`output_validation_failed:${validation.reasons.join(',')}:duration_delta=${validation.durationDelta}:av_drift=${validation.avDrift}`);
        }
        await atomicReplace(tempOutput, outputPath);
        onProgress?.({ operation: 'source-aware-complete', percent: 100 });
        return validation;
    } catch (error) {
        try { fs.unlinkSync(tempOutput); } catch (_cleanupError) {}
        throw error;
    }
}

async function renderSourceAware({
    ffmpegPath,
    ffprobePath,
    inputPath,
    segments,
    outputPath,
    mode = 'source_quality',
    onProgress = null
}) {
    const sources = [...new Set(segments.map((segment) => path.resolve(segment.sourceFile || inputPath)))];
    const profiles = await Promise.all(sources.map((source) => analyzeSource(ffprobePath, source)));
    const estimator = estimateExport({ profiles, segments, mode });
    const dominantSegment = [...segments].sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
    const dominantPath = path.resolve(dominantSegment?.sourceFile || inputPath);
    const dominantProfile = profiles.find((profile) => path.resolve(profile.filePath) === dominantPath) || profiles[0];
    const encoders = await getAvailableEncoders(ffmpegPath);
    const videoProfile = resolveVideoProfile(dominantProfile, mode, estimator, encoders);
    const audioProfile = resolveAudioProfile(dominantProfile, mode, path.extname(outputPath));
    const tempBase = path.join(path.dirname(outputPath), `evd_source_aware_${Date.now()}_${process.pid}`);
    const videoPath = `${tempBase}.video.mp4`;
    const audioPath = `${tempBase}.audio.wav`;
    try {
        await renderVideoOnly({
            ffmpegPath,
            inputPath,
            segments,
            profiles,
            outputPath: videoPath,
            videoProfile,
            onProgress: (progress) => onProgress?.({ ...progress, percent: Number(progress.percent || 0) * (70 / 90) })
        });
        onProgress?.({ operation: 'source-aware-audio', percent: 70 });
        const audioResult = await renderContinuousAudio({
            ffmpegPath,
            inputPath,
            segments,
            sourceProfiles: profiles,
            outputPath: audioPath,
            protectiveFadeMs: 3,
            onProgress: (percent) => onProgress?.({ operation: 'source-aware-audio', percent: 70 + percent * 0.18 })
        });
        audioProfile.sampleRate = audioResult.sampleRate;
        audioProfile.channelLayout = audioResult.channelLayout;
        const validation = await muxAndValidate({
            ffmpegPath,
            ffprobePath,
            videoPath,
            pcmAudioPath: audioPath,
            outputPath,
            segments,
            videoProfile,
            audioProfile,
            targetSize: mode === 'source_size' ? estimator.estimatedOutputSize : 0,
            onProgress
        });
        console.info('[EVD Source-Aware Export Complete]', {
            mode,
            videoCodec: videoProfile.codec,
            audioCodec: audioProfile.codec,
            audioSampleRate: audioProfile.sampleRate,
            audioChannelLayout: audioProfile.channelLayout,
            actualOutputSize: validation.profile?.fileSize,
            durationDelta: validation.durationDelta,
            avDrift: validation.avDrift,
            sizeDifferenceRatio: validation.sizeDifferenceRatio
        });
        return { success: true, mode, profiles, estimator, videoProfile, audioProfile, validation };
    } finally {
        try { fs.unlinkSync(videoPath); } catch (_error) {}
        try { fs.unlinkSync(audioPath); } catch (_error) {}
    }
}

module.exports = {
    renderSourceAware,
    renderVideoOnly,
    muxAndValidate,
    getAvailableEncoders,
    atomicReplace
};
