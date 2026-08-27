const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { sumTimelineDuration } = require('./export-estimator');
const {
    createCancelledError,
    isCurrentExportCancelled,
    registerExportProcess
} = require('./export-process-registry');

function escapeFilterPath(filePath) {
    return String(filePath).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function buildAtempo(speed) {
    const filters = [];
    let remaining = Math.max(0.01, Number(speed || 1));
    while (remaining > 2) {
        filters.push('atempo=2');
        remaining /= 2;
    }
    while (remaining < 0.5) {
        filters.push('atempo=0.5');
        remaining /= 0.5;
    }
    if (Math.abs(remaining - 1) > 0.0001) filters.push(`atempo=${remaining.toFixed(8)}`);
    return filters;
}

function isDiscontinuous(previous, current, inputPath) {
    if (!previous || !current) return false;
    const previousSource = path.resolve(previous.sourceFile || inputPath);
    const currentSource = path.resolve(current.sourceFile || inputPath);
    if (previousSource !== currentSource) return true;
    return Math.abs(Number(previous.end || 0) - Number(current.start || 0)) > 0.001;
}

function runFfmpeg(ffmpegPath, args, { duration = 0, onProgress = null } = {}) {
    return new Promise((resolve, reject) => {
        if (isCurrentExportCancelled()) {
            reject(createCancelledError());
            return;
        }
        const progressArgs = ['-progress', 'pipe:2', '-nostats', ...args];
        const child = spawn(ffmpegPath, progressArgs, { windowsHide: true });
        let unregister = () => {};
        try {
            unregister = registerExportProcess(child);
        } catch (error) {
            reject(error);
            return;
        }
        let stderr = '';
        const diagnosticLines = [];
        let progressBuffer = '';
        let lastProgress = -1;
        const emitProgressSeconds = (seconds) => {
            if (!(duration > 0) || !onProgress || !Number.isFinite(seconds)) return;
            const percent = Math.min(99, Math.max(0, (seconds / duration) * 100));
            if (percent >= lastProgress + 0.05) {
                lastProgress = percent;
                onProgress(percent);
            }
        };
        child.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            stderr += text;
            if (stderr.length > 24000) stderr = stderr.slice(-24000);
            for (const line of text.split(/\r?\n/)) {
                if (/error|failed|no space|not enough space|invalid|could not|cannot|conversion failed/i.test(line)) {
                    diagnosticLines.push(line.trim());
                    if (diagnosticLines.length > 12) diagnosticLines.shift();
                }
            }
            progressBuffer += text;
            const lines = progressBuffer.split(/\r?\n/);
            progressBuffer = lines.pop() || '';
            for (const line of lines) {
                const separator = line.indexOf('=');
                if (separator < 0) continue;
                const key = line.slice(0, separator).trim();
                const value = line.slice(separator + 1).trim();
                if (key === 'out_time_us' || key === 'out_time_ms') {
                    emitProgressSeconds(Number(value) / 1000000);
                } else if (key === 'out_time') {
                    const match = value.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
                    if (match) emitProgressSeconds(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
                }
            }
            const matches = [...text.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
            const match = matches[matches.length - 1];
            if (match) emitProgressSeconds(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
        });
        child.on('error', (error) => {
            unregister();
            reject(isCurrentExportCancelled() ? createCancelledError() : error);
        });
        child.on('close', (code) => {
            unregister();
            if (isCurrentExportCancelled()) {
                reject(createCancelledError());
                return;
            }
            if (code === 0) {
                if (onProgress) onProgress(100);
                resolve();
                return;
            }
            const tail = stderr.trim().split(/\r?\n/).slice(-8);
            const details = [...new Set([...diagnosticLines, ...tail])].filter(Boolean).join(' | ');
            reject(new Error(details || `ffmpeg_exited_${code}`));
        });
    });
}

function chooseAudioFormat(sourceProfiles = []) {
    const audioTracks = sourceProfiles.flatMap((profile) => profile.audio || []);
    const sampleRate = audioTracks.length
        ? Math.max(...audioTracks.map((track) => Number(track.sampleRate || 0)).filter(Boolean), 44100)
        : 48000;
    const layouts = [...new Set(audioTracks.map((track) => track.channelLayout).filter(Boolean))];
    const channelLayout = layouts.length === 1 ? layouts[0] : 'stereo';
    return {
        sampleRate: Math.min(192000, Math.max(32000, sampleRate)),
        channelLayout: /^[a-z0-9.()+-]+$/i.test(channelLayout) ? channelLayout : 'stereo'
    };
}

async function renderContinuousAudioPass({
    ffmpegPath,
    inputPath,
    segments = [],
    sourceProfiles = [],
    outputPath,
    protectiveFadeMs = 3,
    previousSegment = null,
    nextSegment = null,
    inputSeekOffsets = null,
    onProgress = null
}) {
    if (!segments.length) throw new Error('empty_audio_timeline');
    const uniqueSources = [];
    const sourceIndexes = new Map();
    for (const segment of segments) {
        const source = path.resolve(segment.sourceFile || inputPath);
        if (!sourceIndexes.has(source)) {
            sourceIndexes.set(source, uniqueSources.length);
            uniqueSources.push(source);
        }
    }
    const { sampleRate, channelLayout } = chooseAudioFormat(sourceProfiles);
    const duration = sumTimelineDuration(segments);
    const filterLines = [];
    const profileByPath = new Map(sourceProfiles.map((profile) => [path.resolve(profile.filePath), profile]));

    segments.forEach((segment, index) => {
        const source = path.resolve(segment.sourceFile || inputPath);
        const inputIndex = sourceIndexes.get(source);
        const sourceHasAudio = Boolean(profileByPath.get(source)?.audio?.length);
        const inputOffset = Math.max(0, Number(inputSeekOffsets?.get(source) || 0));
        const start = Math.max(0, Number(segment.start || 0) - inputOffset);
        const end = Math.max(start, Number(segment.end || segment.start || 0) - inputOffset);
        const speed = Math.max(0.01, Number(segment.speed || 1));
        const outputDuration = Math.max(0.001, (end - start) / speed);
        const volume = segment.isMuted ? 0 : Math.max(0, Number(segment.audioVolume ?? 100) / 100);
        const chain = [];
        let prefix;
        if (sourceHasAudio) {
            prefix = `[${inputIndex}:a:0]`;
            chain.push(`atrim=start=${start.toFixed(6)}:end=${end.toFixed(6)}`, 'asetpts=PTS-STARTPTS');
            chain.push(...buildAtempo(speed));
        } else {
            prefix = '';
            chain.push(`anullsrc=r=${sampleRate}:cl=${channelLayout}:d=${outputDuration.toFixed(6)}`);
        }
        chain.push(`aresample=${sampleRate}:async=0:first_pts=0`);
        if (segment.audioChannelMode === 'mono' && channelLayout !== 'mono') {
            chain.push('pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1');
        }
        chain.push(`volume=${volume.toFixed(6)}`);

        const fadeSeconds = Math.min(protectiveFadeMs / 1000, outputDuration / 4);
        const previous = index > 0 ? segments[index - 1] : previousSegment;
        const next = index < segments.length - 1 ? segments[index + 1] : nextSegment;
        const fadeIn = Boolean(previous) && isDiscontinuous(previous, segment, inputPath);
        const fadeOut = Boolean(next) && isDiscontinuous(segment, next, inputPath);
        if (fadeIn && fadeSeconds > 0) chain.push(`afade=t=in:st=0:d=${fadeSeconds.toFixed(6)}:curve=tri`);
        if (fadeOut && fadeSeconds > 0) {
            chain.push(`afade=t=out:st=${Math.max(0, outputDuration - fadeSeconds).toFixed(6)}:d=${fadeSeconds.toFixed(6)}:curve=tri`);
        }
        chain.push(`apad`, `atrim=0:${outputDuration.toFixed(6)}`);
        chain.push(`aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=${channelLayout}`);
        filterLines.push(`${prefix}${chain.join(',')}[a${index}]`);
    });
    filterLines.push(`${segments.map((_, index) => `[a${index}]`).join('')}concat=n=${segments.length}:v=0:a=1[aout]`);

    const scriptPath = path.join(path.dirname(outputPath), `evd_audio_filter_${Date.now()}_${process.pid}.txt`);
    fs.writeFileSync(scriptPath, `${filterLines.join(';\n')}\n`, 'utf8');
    const args = ['-y'];
    uniqueSources.forEach((source) => {
        const inputOffset = Math.max(0, Number(inputSeekOffsets?.get(source) || 0));
        if (inputOffset > 0) args.push('-ss', inputOffset.toFixed(6));
        args.push('-i', source);
    });
    args.push(
        '-filter_complex_script', scriptPath,
        '-map', '[aout]',
        '-c:a', 'pcm_f32le',
        '-ar', String(sampleRate),
        outputPath
    );
    try {
        await runFfmpeg(ffmpegPath, args, { duration, onProgress });
        return { outputPath, duration, sampleRate, channelLayout, protectiveFadeMs };
    } finally {
        try { fs.unlinkSync(scriptPath); } catch (_error) {}
    }
}

const CONTINUOUS_AUDIO_BATCH_THRESHOLD = 80;
const CONTINUOUS_AUDIO_BATCH_SIZE = 25;

function buildAudioBatchInputOffsets(segments, inputPath) {
    const offsets = new Map();
    for (const segment of segments) {
        const source = path.resolve(segment.sourceFile || inputPath);
        const start = Math.max(0, Number(segment.start || 0));
        const current = offsets.get(source);
        if (!Number.isFinite(current) || start < current) offsets.set(source, start);
    }
    for (const [source, start] of offsets) offsets.set(source, Math.max(0, start - 2));
    return offsets;
}

function writeAudioConcatList(filePath, files) {
    const content = files
        .map((file) => `file '${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
        .join('\n');
    fs.writeFileSync(filePath, `${content}\n`, 'utf8');
}

async function renderContinuousAudio({
    ffmpegPath,
    inputPath,
    segments = [],
    sourceProfiles = [],
    outputPath,
    protectiveFadeMs = 3,
    onProgress = null
}) {
    if (segments.length <= CONTINUOUS_AUDIO_BATCH_THRESHOLD) {
        return renderContinuousAudioPass({
            ffmpegPath,
            inputPath,
            segments,
            sourceProfiles,
            outputPath,
            protectiveFadeMs,
            onProgress
        });
    }

    const { sampleRate, channelLayout } = chooseAudioFormat(sourceProfiles);
    const duration = sumTimelineDuration(segments);
    const tempBase = path.join(
        path.dirname(outputPath),
        `${path.basename(outputPath, path.extname(outputPath))}.evd-audio-batch-${Date.now()}-${process.pid}`
    );
    const batchFiles = [];
    const listPath = `${tempBase}.concat.txt`;
    let completedDuration = 0;

    try {
        for (let index = 0; index < segments.length; index += CONTINUOUS_AUDIO_BATCH_SIZE) {
            const batch = segments.slice(index, index + CONTINUOUS_AUDIO_BATCH_SIZE);
            const batchDuration = sumTimelineDuration(batch);
            const batchPath = `${tempBase}.${Math.floor(index / CONTINUOUS_AUDIO_BATCH_SIZE)}.wav`;
            batchFiles.push(batchPath);
            const batchNumber = batchFiles.length;
            const batchCount = Math.ceil(segments.length / CONTINUOUS_AUDIO_BATCH_SIZE);
            await renderContinuousAudioPass({
                ffmpegPath,
                inputPath,
                segments: batch,
                sourceProfiles,
                outputPath: batchPath,
                protectiveFadeMs,
                previousSegment: index > 0 ? segments[index - 1] : null,
                nextSegment: index + batch.length < segments.length ? segments[index + batch.length] : null,
                inputSeekOffsets: buildAudioBatchInputOffsets(batch, inputPath),
                onProgress: (percent) => onProgress?.(
                    ((completedDuration + batchDuration * Number(percent || 0) / 100) / Math.max(0.001, duration)) * 92
                )
            });
            completedDuration += batchDuration;
        }

        writeAudioConcatList(listPath, batchFiles);
        await runFfmpeg(ffmpegPath, [
            '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
            '-map', '0:a:0', '-c:a', 'pcm_f32le', '-ar', String(sampleRate),
            outputPath
        ], {
            duration,
            onProgress: (percent) => onProgress?.(92 + Number(percent || 0) * 0.08)
        });
        return { outputPath, duration, sampleRate, channelLayout, protectiveFadeMs, batched: true };
    } finally {
        for (const file of [...batchFiles, listPath]) {
            try { fs.unlinkSync(file); } catch (_error) {}
        }
    }
}

module.exports = {
    renderContinuousAudio,
    renderContinuousAudioPass,
    runFfmpeg,
    chooseAudioFormat,
    isDiscontinuous,
    escapeFilterPath,
    CONTINUOUS_AUDIO_BATCH_THRESHOLD,
    CONTINUOUS_AUDIO_BATCH_SIZE
};
