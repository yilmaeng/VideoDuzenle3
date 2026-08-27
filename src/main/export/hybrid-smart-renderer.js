const fs = require('fs');
const path = require('path');
const { analyzeSource, getKeyframes } = require('./source-profile-analyzer');
const { classifyEditGraph } = require('./edit-graph-classifier');
const { estimateExport, sumTimelineDuration } = require('./export-estimator');
const { resolveAudioProfile } = require('./export-profile-resolver');
const { renderContinuousAudio, runFfmpeg } = require('./continuous-audio-renderer');
const { getAvailableEncoders, atomicReplace } = require('./source-aware-renderer');
const { validateOutput } = require('./output-validator');

const MAX_HYBRID_SEGMENTS = 80;
const MAX_HYBRID_CHUNKS = 240;
const MAX_HYBRID_ENCODED_RATIO = 0.30;

function assessHybridComplexity(segments = [], assessment = null) {
    const segmentCount = segments.length;
    const chunkCount = Array.isArray(assessment?.chunks) ? assessment.chunks.length : 0;
    const outputDuration = sumTimelineDuration(segments);
    const encodedDuration = Math.max(0, Number(assessment?.encodedDuration || 0));
    const encodedRatio = outputDuration > 0 ? encodedDuration / outputDuration : 0;
    // A high encoded ratio is harmless for a few ordinary cuts. It becomes a
    // reliability risk only when the timeline is already substantially split.
    const excessiveEncodedBoundaryLoad = segmentCount >= 20
        && encodedRatio > MAX_HYBRID_ENCODED_RATIO;
    const tooFragmented = segmentCount > MAX_HYBRID_SEGMENTS
        || chunkCount > MAX_HYBRID_CHUNKS
        || excessiveEncodedBoundaryLoad;
    return {
        tooFragmented,
        segmentCount,
        chunkCount,
        outputDuration,
        encodedDuration,
        encodedRatio,
        excessiveEncodedBoundaryLoad,
        limits: {
            segmentCount: MAX_HYBRID_SEGMENTS,
            chunkCount: MAX_HYBRID_CHUNKS,
            encodedRatio: MAX_HYBRID_ENCODED_RATIO
        }
    };
}

function nearestKeyframeDistance(keyframes, time) {
    let minimum = Number.POSITIVE_INFINITY;
    for (const keyframe of keyframes) {
        const distance = Math.abs(keyframe - time);
        if (distance < minimum) minimum = distance;
        if (keyframe > time && distance > minimum) break;
    }
    return minimum;
}

function writeConcatList(filePath, files) {
    const text = files
        .map((item) => `file '${item.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
        .join('\n');
    fs.writeFileSync(filePath, `${text}\n`, 'utf8');
}

function resolveHybridAvDriftTolerance(sourceProfile = {}, videoProfile = {}, audioProfile = {}) {
    const frameDuration = 1 / Math.max(1, Number(videoProfile.frameRate || 25));
    const audioFrameDuration = audioProfile.codec === 'aac'
        ? 1024 / Math.max(1, Number(audioProfile.sampleRate || 48000))
        : 0;
    const codecRoundingFloor = Math.max(0.04, frameDuration, audioFrameDuration * 3 + 0.001);
    const sourceVideoDuration = Number(sourceProfile.video?.duration || 0);
    const sourceAudioDuration = Number(sourceProfile.audio?.[0]?.duration || 0);
    const sourceTailDifference = sourceVideoDuration > 0 && sourceAudioDuration > 0
        ? Math.abs(sourceVideoDuration - sourceAudioDuration)
        : 0;
    const sourceAwareAllowance = sourceTailDifference + Math.max(frameDuration, audioFrameDuration);
    return Math.max(codecRoundingFloor, Math.min(0.25, sourceAwareAllowance));
}

async function muxHybridChunksAndValidate({
    ffmpegPath,
    ffprobePath,
    listPath,
    pcmAudioPath,
    outputPath,
    segments,
    videoProfile,
    audioProfile,
    sourceProfile,
    chunks,
    rotation = 0,
    onProgress
}) {
    const extension = path.extname(outputPath) || '.mp4';
    const expectedDuration = sumTimelineDuration(segments);
    const tempOutput = path.join(
        path.dirname(outputPath),
        `${path.basename(outputPath, extension)}.evd-partial-${Date.now()}${extension}`
    );
    const audioArgs = audioProfile.codec === 'aac'
        ? ['-c:a', 'aac', '-b:a', String(audioProfile.bitrate)]
        : ['-c:a', audioProfile.codec];
    const args = [
        '-y',
        '-f', 'concat', '-safe', '0', '-i', listPath,
        '-i', pcmAudioPath,
        '-map', '0:v:0', '-map', '1:a:0',
        '-map_metadata', '0', '-map_chapters', '0',
        '-c:v', 'copy', ...audioArgs,
        '-ar', String(audioProfile.sampleRate),
        '-fflags', '+genpts', '-avoid_negative_ts', 'make_zero',
        '-t', expectedDuration.toFixed(6)
    ];
    if (['.mp4', '.mov', '.m4v'].includes(extension.toLowerCase())) {
        args.push('-movflags', '+faststart');
    }
    if (Math.abs(Number(rotation || 0)) > 0.1) {
        args.push('-metadata:s:v:0', `rotate=${Number(rotation)}`);
    }
    args.push(tempOutput);

    try {
        await runFfmpeg(ffmpegPath, args, {
            duration: expectedDuration,
            onProgress: (percent) => onProgress?.({
                operation: 'hybrid-smart-finalize',
                percent: 83 + percent * 0.15
            })
        });
        onProgress?.({ operation: 'hybrid-smart-validate-boundaries', percent: 98 });
        await validateHybridBoundaries(ffmpegPath, tempOutput, chunks, (percent) => {
            onProgress?.({ operation: 'hybrid-smart-validate-boundaries', percent: 98 + percent * 0.008 });
        });
        onProgress?.({ operation: 'source-aware-validate', percent: 99 });
        const frameDuration = 1 / Math.max(1, Number(videoProfile.frameRate || 25));
        const audioFrameDuration = audioProfile.codec === 'aac'
            ? 1024 / Math.max(1, Number(audioProfile.sampleRate || 48000))
            : 0;
        // Stream-copy joins can make the MP4 container report a few packet durations
        // beyond or before the exact timeline end. Keep A/V drift validation strict,
        // but allow this bounded container-duration rounding for hybrid output only.
        const hybridDurationTolerance = Math.max(0.12, frameDuration * 3, audioFrameDuration * 6);
        // Compare stream-tail rounding with the source instead of raising a global fixed limit.
        // A one-frame margin is allowed, with an absolute 250 ms safety ceiling.
        const hybridAvDriftTolerance = resolveHybridAvDriftTolerance(sourceProfile, videoProfile, audioProfile);
        const validation = await validateOutput({
            ffprobePath,
            outputPath: tempOutput,
            segments,
            expectedVideo: videoProfile,
            durationTolerance: hybridDurationTolerance,
            avDriftTolerance: hybridAvDriftTolerance
        });
        if (!validation.valid) {
            throw new Error(`output_validation_failed:${validation.reasons.join(',')}:duration_delta=${validation.durationDelta}:duration_tolerance=${validation.durationTolerance}:av_drift=${validation.avDrift}:av_drift_tolerance=${validation.avDriftTolerance}`);
        }
        onProgress?.({ operation: 'finalize-export', percent: 99 });
        await atomicReplace(tempOutput, outputPath);
        onProgress?.({ operation: 'source-aware-complete', percent: 100 });
        return validation;
    } catch (error) {
        try { fs.unlinkSync(tempOutput); } catch (_cleanupError) {}
        throw error;
    }
}

function getAvailableDiskBytes(directory) {
    try {
        const stats = fs.statfsSync(directory);
        return Number(stats.bavail) * Number(stats.bsize);
    } catch (_error) {
        return 0;
    }
}

function estimateHybridWorkingBytes(estimator, profile, segments) {
    const finalBytes = Math.max(1, Number(estimator?.estimatedOutputSize || 0));
    const duration = sumTimelineDuration(segments);
    const audioTrack = profile.audio?.[0] || {};
    const sampleRate = Math.max(32000, Number(audioTrack.sampleRate || 48000));
    const channels = Math.max(1, Number(audioTrack.channels || 2));
    const pcmBytes = duration * sampleRate * channels * 4;
    return {
        finalBytes,
        requiredBytes: Math.ceil(finalBytes * 2.15 + pcmBytes)
    };
}

function normalizedCodec(codec) {
    const value = String(codec || '').toLowerCase();
    return value === 'h265' ? 'hevc' : value;
}

function normalizedRotation(rotation) {
    return ((Number(rotation || 0) % 360) + 360) % 360;
}

function selectDominantSource(segments, inputPath) {
    const durations = new Map();
    for (const segment of segments) {
        const source = path.resolve(segment.sourceFile || inputPath);
        const duration = Math.max(0, Number(segment.end || 0) - Number(segment.start || 0));
        durations.set(source, (durations.get(source) || 0) + duration);
    }
    return [...durations.entries()].sort((left, right) => right[1] - left[1])[0]?.[0]
        || path.resolve(inputPath);
}

function profilesCompatibleForCopy(referenceProfile, candidateProfile) {
    const reference = referenceProfile?.video || {};
    const candidate = candidateProfile?.video || {};
    const sameText = (left, right) => String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
    return normalizedCodec(reference.codec) === normalizedCodec(candidate.codec)
        && Number(reference.storageWidth || reference.rawWidth || reference.width) === Number(candidate.storageWidth || candidate.rawWidth || candidate.width)
        && Number(reference.storageHeight || reference.rawHeight || reference.height) === Number(candidate.storageHeight || candidate.rawHeight || candidate.height)
        && Math.abs(Number(reference.averageFrameRate || 0) - Number(candidate.averageFrameRate || 0)) <= 0.05
        && normalizedRotation(reference.rotation) === normalizedRotation(candidate.rotation)
        && sameText(reference.pixelFormat, candidate.pixelFormat)
        && Number(reference.bitDepth || 8) === Number(candidate.bitDepth || 8)
        && sameText(reference.profile, candidate.profile)
        && Number(reference.level || 0) === Number(candidate.level || 0)
        && sameText(reference.colorRange, candidate.colorRange)
        && sameText(reference.colorSpace, candidate.colorSpace)
        && sameText(reference.colorPrimaries, candidate.colorPrimaries)
        && sameText(reference.colorTransfer, candidate.colorTransfer);
}

function targetVideoFilter(profile, encoder, preserveStorageOrientation) {
    const video = profile.video || {};
    const displayWidth = Number(video.width || 1920);
    const displayHeight = Number(video.height || 1080);
    const storageWidth = Number(video.storageWidth || video.rawWidth || displayWidth);
    const storageHeight = Number(video.storageHeight || video.rawHeight || displayHeight);
    const frameRate = Math.max(1, Number(video.averageFrameRate || video.realFrameRate || 25));
    if (preserveStorageOrientation) {
        return `setpts=PTS-STARTPTS,scale=${storageWidth}:${storageHeight}:force_original_aspect_ratio=decrease,pad=${storageWidth}:${storageHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${frameRate.toFixed(6)},format=${encoder.pixelFormat}`;
    }
    const filters = [
        'setpts=PTS-STARTPTS',
        `scale=${displayWidth}:${displayHeight}:force_original_aspect_ratio=decrease`,
        `pad=${displayWidth}:${displayHeight}:(ow-iw)/2:(oh-ih)/2`,
        'setsar=1',
        `fps=${frameRate.toFixed(6)}`
    ];
    const rotation = normalizedRotation(video.rotation);
    if (rotation === 270) filters.push('transpose=clock');
    else if (rotation === 90) filters.push('transpose=cclock');
    else if (rotation === 180) filters.push('hflip', 'vflip');
    filters.push(`format=${encoder.pixelFormat}`);
    return filters.join(',');
}

function isKeyframeAligned(keyframes, time, tolerance) {
    return nearestKeyframeDistance(keyframes, time) <= tolerance;
}

function buildHybridChunkPlan(segments, keyframes, frameTolerance) {
    const chunks = [];
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        const segment = segments[segmentIndex];
        const start = Math.max(0, Number(segment.start || 0));
        const end = Math.max(start, Number(segment.end || start));
        if (end - start <= frameTolerance) continue;

        const startAligned = isKeyframeAligned(keyframes, start, frameTolerance);
        const endAligned = isKeyframeAligned(keyframes, end, frameTolerance);
        const interiorKeyframes = keyframes.filter((time) =>
            time > start + frameTolerance && time < end - frameTolerance);

        let cursor = start;
        if (!startAligned) {
            const nextKeyframe = interiorKeyframes[0];
            if (!Number.isFinite(nextKeyframe)) {
                chunks.push({ type: 'encode', start, end, segmentIndex });
                continue;
            }
            chunks.push({ type: 'encode', start, end: nextKeyframe, segmentIndex });
            cursor = nextKeyframe;
        }

        if (endAligned) {
            if (end - cursor > frameTolerance) chunks.push({ type: 'copy', start: cursor, end, segmentIndex });
            continue;
        }

        const previousKeyframe = [...interiorKeyframes].reverse().find((time) => time > cursor + frameTolerance);
        if (Number.isFinite(previousKeyframe)) {
            chunks.push({ type: 'copy', start: cursor, end: previousKeyframe, segmentIndex });
            chunks.push({ type: 'encode', start: previousKeyframe, end, segmentIndex });
        } else if (end - cursor > frameTolerance) {
            chunks.push({ type: 'encode', start: cursor, end, segmentIndex });
        }
    }
    return chunks;
}

function resolveBoundaryEncoder(profile, encoders) {
    const codec = String(profile.video?.codec || '').toLowerCase();
    const sourcePixelFormat = String(profile.video?.pixelFormat || '').toLowerCase();
    const safePixelFormat = /^yuvj?(420|422|444)p$/.test(sourcePixelFormat)
        || /^yuv(420|422|444)p(10|12)le$/.test(sourcePixelFormat)
        ? sourcePixelFormat
        : (Number(profile.video?.bitDepth || 8) > 8 ? 'yuv420p10le' : 'yuv420p');
    if (codec === 'h264') {
        return {
            codec: Number(profile.video?.bitDepth || 8) <= 8 && encoders.has('libx264') ? 'libx264' : null,
            bitstreamFilter: 'h264_mp4toannexb',
            pixelFormat: safePixelFormat
        };
    }
    if (['hevc', 'h265'].includes(codec)) {
        return {
            codec: encoders.has('libx265') ? 'libx265' : null,
            bitstreamFilter: 'hevc_mp4toannexb',
            pixelFormat: safePixelFormat
        };
    }
    return null;
}

async function renderHybridChunk({ ffmpegPath, source, chunk, outputPath, sourceProfile, targetProfile, encoder, videoFilter = '', onProgress }) {
    const duration = Math.max(0.001, chunk.end - chunk.start);
    if (chunk.type === 'copy') {
        await runFfmpeg(ffmpegPath, [
            '-y', '-ss', chunk.start.toFixed(6), '-i', source,
            '-t', duration.toFixed(6),
            '-map', '0:v:0', '-an', '-c:v', 'copy',
            '-bsf:v', encoder.bitstreamFilter,
            '-avoid_negative_ts', 'make_zero', '-mpegts_flags', '+resend_headers',
            '-f', 'mpegts', outputPath
        ], { duration, onProgress });
        return;
    }

    const preSeek = Math.max(0, chunk.start - 5);
    const accurateSeek = chunk.start - preSeek;
    const colorArgs = [];
    const colorFields = [
        ['-color_range', targetProfile.video.colorRange],
        ['-colorspace', targetProfile.video.colorSpace],
        ['-color_primaries', targetProfile.video.colorPrimaries],
        ['-color_trc', targetProfile.video.colorTransfer]
    ];
    for (const [flag, value] of colorFields) {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized && !['unknown', 'unspecified', 'reserved'].includes(normalized)) colorArgs.push(flag, normalized);
    }
    const preserveStorageOrientation = profilesCompatibleForCopy(targetProfile, sourceProfile);
    const filters = [targetVideoFilter(targetProfile, encoder, preserveStorageOrientation)];
    if (String(videoFilter || '').trim()) filters.push(String(videoFilter).trim());
    const args = [
        '-y',
        ...(preserveStorageOrientation ? ['-noautorotate'] : []),
        '-ss', preSeek.toFixed(6), '-i', source,
        '-ss', accurateSeek.toFixed(6), '-t', duration.toFixed(6),
        '-map', '0:v:0', '-an',
        '-vf', filters.join(','),
        '-c:v', encoder.codec, '-preset', 'fast', '-crf', encoder.codec === 'libx265' ? '20' : '18',
        '-pix_fmt', encoder.pixelFormat,
        ...colorArgs,
        '-avoid_negative_ts', 'make_zero', '-mpegts_flags', '+resend_headers',
        '-f', 'mpegts', outputPath
    ];
    await runFfmpeg(ffmpegPath, args, { duration, onProgress });
}

async function validateHybridBoundaries(ffmpegPath, videoPath, chunks, onProgress = null) {
    const boundaries = [];
    let position = 0;
    for (let index = 0; index < chunks.length - 1; index += 1) {
        position += chunks[index].end - chunks[index].start;
        boundaries.push(position);
    }
    const samples = boundaries.length <= 50
        ? boundaries
        : Array.from({ length: 50 }, (_, index) => boundaries[Math.round(index * (boundaries.length - 1) / 49)]);
    const nullTarget = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const uniqueSamples = [...new Set(samples)];
    if (!uniqueSamples.length) onProgress?.(100);
    for (let index = 0; index < uniqueSamples.length; index += 1) {
        const boundary = uniqueSamples[index];
        const start = Math.max(0, boundary - 0.2);
        await runFfmpeg(ffmpegPath, [
            '-v', 'error', '-xerror', '-ss', start.toFixed(6), '-i', videoPath,
            '-t', '0.4', '-map', '0:v:0', '-an', '-f', 'null', nullTarget
        ]);
        onProgress?.(((index + 1) / uniqueSamples.length) * 100);
    }
}

async function assessHybridEligibility({ ffprobePath, inputPath, segments, transitions = [], globalEffects = [], ctaCount = 0, onProgress = null, scanKeyframes = true }) {
    const graph = classifyEditGraph({ inputPath, segments, transitions, globalEffects, ctaCount });
    if (!graph.hybridEligible) {
        return { eligible: false, reason: graph.reasons[0] || 'edit_graph_not_supported', graph };
    }
    const sources = [...new Set(segments.map((segment) => path.resolve(segment.sourceFile || inputPath)))];
    const profiles = await Promise.all(sources.map((source) => analyzeSource(ffprobePath, source)));
    const profileByPath = new Map(profiles.map((item) => [path.resolve(item.filePath), item]));
    const dominantSource = selectDominantSource(segments, inputPath);
    const profile = profileByPath.get(dominantSource) || profiles[0];
    if (!profile?.video) return { eligible: false, reason: 'video_stream_missing', graph, profile, profiles };
    const hasUnsupportedHdrMetadata = profiles.some((item) => {
        const transfer = String(item.video?.colorTransfer || '').toLowerCase();
        return ['smpte2084', 'arib-std-b67'].includes(transfer)
            || (item.video?.sideData || []).some((entry) => /dolby|dovi|mastering display|content light/i.test(String(entry?.side_data_type || '')));
    });
    if (hasUnsupportedHdrMetadata) {
        return { eligible: false, reason: 'hdr_metadata_not_supported', graph, profile, profiles };
    }
    if (!['h264', 'hevc', 'h265'].includes(String(profile.video?.codec || '').toLowerCase())) {
        return { eligible: false, reason: 'video_codec_not_supported', graph, profile, profiles };
    }
    if (profile.video?.variableFrameRate) {
        return { eligible: false, reason: 'variable_frame_rate', graph, profile, profiles };
    }
    const normalizedRotation = ((Number(profile.video?.rotation || 0) % 360) + 360) % 360;
    const rightAngleRotation = [0, 90, 180, 270].some((angle) => Math.abs(normalizedRotation - angle) <= 0.1);
    if (!rightAngleRotation) {
        return { eligible: false, reason: 'rotation_metadata_not_supported', graph, profile, profiles };
    }
    if (!scanKeyframes) {
        return {
            eligible: true,
            reason: '',
            graph,
            profile,
            profiles,
            dominantSource,
            planReady: false,
            copiedDuration: 0,
            encodedDuration: 0
        };
    }
    onProgress?.({ operation: 'hybrid-smart-analyze', percent: 0 });
    const frameTolerance = Math.max(0.001, 0.25 / Math.max(1, Number(profile.video?.averageFrameRate || 25)));
    const compatibleSources = sources.filter((source) => profilesCompatibleForCopy(profile, profileByPath.get(source)));
    const sourceWeights = new Map(compatibleSources.map((source) => [source, segments
        .filter((segment) => path.resolve(segment.sourceFile || inputPath) === source)
        .reduce((sum, segment) => sum + Math.max(0, Number(segment.end || 0) - Number(segment.start || 0)), 0)]));
    const totalWeight = Math.max(0.001, [...sourceWeights.values()].reduce((sum, value) => sum + value, 0));
    const keyframesBySource = new Map();
    let completedWeight = 0;
    for (const source of compatibleSources) {
        const sourceProfile = profileByPath.get(source);
        const weight = sourceWeights.get(source) || 0;
        const keyframes = await getKeyframes(ffprobePath, source, {
            duration: Number(sourceProfile.duration || sourceProfile.video?.duration || 0),
            onProgress: (percent) => onProgress?.({
                operation: 'hybrid-smart-analyze',
                percent: ((completedWeight + weight * Number(percent || 0) / 100) / totalWeight) * 5
            })
        });
        keyframesBySource.set(source, keyframes);
        completedWeight += weight;
    }
    const chunks = [];
    segments.forEach((segment, segmentIndex) => {
        const source = path.resolve(segment.sourceFile || inputPath);
        const sourceProfile = profileByPath.get(source);
        if (!profilesCompatibleForCopy(profile, sourceProfile)) {
            chunks.push({
                type: 'encode',
                start: Math.max(0, Number(segment.start || 0)),
                end: Math.max(Number(segment.start || 0), Number(segment.end || 0)),
                segmentIndex,
                source,
                sourceProfile
            });
            return;
        }
        const segmentChunks = buildHybridChunkPlan([segment], keyframesBySource.get(source) || [], frameTolerance);
        segmentChunks.forEach((chunk) => chunks.push({ ...chunk, segmentIndex, source, sourceProfile }));
    });
    return {
        eligible: chunks.length > 0,
        reason: chunks.length ? '' : 'empty_hybrid_plan',
        graph,
        profile,
        profiles,
        dominantSource,
        frameTolerance,
        chunks,
        planReady: true,
        copiedDuration: chunks.filter((chunk) => chunk.type === 'copy').reduce((sum, chunk) => sum + chunk.end - chunk.start, 0),
        encodedDuration: chunks.filter((chunk) => chunk.type === 'encode').reduce((sum, chunk) => sum + chunk.end - chunk.start, 0)
    };
}

async function renderHybridSmart({
    ffmpegPath,
    ffprobePath,
    inputPath,
    segments,
    outputPath,
    transitions = [],
    globalEffects = [],
    ctaCount = 0,
    onProgress = null
}) {
    const initialComplexity = assessHybridComplexity(segments);
    if (initialComplexity.tooFragmented) {
        console.info('[EVD Hybrid Export Fallback]', {
            reason: 'high_timeline_fragmentation',
            ...initialComplexity
        });
        return {
            success: false,
            fallbackRequired: true,
            fallbackMode: 'source_quality',
            reason: 'high_timeline_fragmentation',
            complexity: initialComplexity
        };
    }
    const assessment = await assessHybridEligibility({ ffprobePath, inputPath, segments, transitions, globalEffects, ctaCount, onProgress });
    if (!assessment.eligible) {
        console.info('[EVD Hybrid Export Fallback]', { reason: assessment.reason });
        return { success: false, fallbackRequired: true, fallbackMode: 'source_quality', assessment };
    }
    const plannedComplexity = assessHybridComplexity(segments, assessment);
    if (plannedComplexity.tooFragmented) {
        console.info('[EVD Hybrid Export Fallback]', {
            reason: 'high_timeline_fragmentation',
            ...plannedComplexity
        });
        return {
            success: false,
            fallbackRequired: true,
            fallbackMode: 'source_quality',
            reason: 'high_timeline_fragmentation',
            assessment,
            complexity: plannedComplexity
        };
    }
    const tempBase = path.join(path.dirname(outputPath), `evd_hybrid_${Date.now()}_${process.pid}`);
    const segmentFiles = [];
    const listPath = `${tempBase}.concat.txt`;
    const audioPath = `${tempBase}.audio.wav`;
    const duration = sumTimelineDuration(segments);
    const videoProfile = {
        width: assessment.profile.video.width,
        height: assessment.profile.video.height,
        frameRate: assessment.profile.video.averageFrameRate,
        codec: assessment.profile.video.codec,
        pixelFormat: assessment.profile.video.pixelFormat,
        rotation: Number(assessment.profile.video.rotation || 0)
    };
    const estimator = estimateExport({ profiles: assessment.profiles || [assessment.profile], segments, mode: 'hybrid_smart' });
    const diskSpace = estimateHybridWorkingBytes(estimator, assessment.profile, segments);
    const availableBytes = getAvailableDiskBytes(path.dirname(outputPath));
    if (availableBytes > 0 && availableBytes < diskSpace.requiredBytes) {
        console.info('[EVD Hybrid Export Blocked]', {
            reason: 'insufficient_disk_space',
            requiredBytes: diskSpace.requiredBytes,
            availableBytes
        });
        return {
            success: false,
            fallbackRequired: false,
            reason: 'insufficient_disk_space',
            error: 'insufficient_disk_space',
            requiredBytes: diskSpace.requiredBytes,
            availableBytes,
            assessment,
            estimator
        };
    }
    const audioProfile = resolveAudioProfile(assessment.profile, 'source_quality', path.extname(outputPath));
    const encoders = await getAvailableEncoders(ffmpegPath);
    const boundaryEncoder = resolveBoundaryEncoder(assessment.profile, encoders);
    if (!boundaryEncoder || (assessment.encodedDuration > 0 && !boundaryEncoder.codec)) {
        return { success: false, fallbackRequired: true, fallbackMode: 'source_quality', assessment: { ...assessment, eligible: false, reason: 'boundary_encoder_not_available' } };
    }

    try {
        let completedDuration = 0;
        for (let index = 0; index < assessment.chunks.length; index += 1) {
            const chunk = assessment.chunks[index];
            const segmentPath = `${tempBase}.chunk-${index}.ts`;
            segmentFiles.push(segmentPath);
            const chunkDuration = chunk.end - chunk.start;
            await renderHybridChunk({
                ffmpegPath,
                source: chunk.source || path.resolve(segments[chunk.segmentIndex]?.sourceFile || inputPath),
                chunk,
                outputPath: segmentPath,
                sourceProfile: chunk.sourceProfile || assessment.profile,
                targetProfile: assessment.profile,
                encoder: boundaryEncoder,
                onProgress: (percent) => onProgress?.({
                    operation: 'hybrid-smart-video-copy',
                    percent: 5 + ((completedDuration + chunkDuration * percent / 100) / duration) * 60,
                    current: index + 1,
                    total: assessment.chunks.length,
                    stage: chunk.type
                })
            });
            completedDuration += chunkDuration;
        }
        writeConcatList(listPath, segmentFiles);
        const audioResult = await renderContinuousAudio({
            ffmpegPath,
            inputPath,
            segments,
            sourceProfiles: assessment.profiles || [assessment.profile],
            outputPath: audioPath,
            protectiveFadeMs: 3,
            onProgress: (percent) => onProgress?.({ operation: 'hybrid-smart-audio', percent: 65 + percent * 0.18 })
        });
        audioProfile.sampleRate = audioResult.sampleRate;
        audioProfile.channelLayout = audioResult.channelLayout;
        const validation = await muxHybridChunksAndValidate({
            ffmpegPath,
            ffprobePath,
            listPath,
            pcmAudioPath: audioPath,
            outputPath,
            segments,
            videoProfile,
            audioProfile,
            sourceProfile: assessment.profile,
            rotation: videoProfile.rotation,
            chunks: assessment.chunks,
            onProgress
        });
        console.info('[EVD Hybrid Export Complete]', {
            copiedVideoDuration: assessment.copiedDuration,
            encodedBoundaryDuration: assessment.encodedDuration,
            audioCodec: audioProfile.codec,
            audioSampleRate: audioProfile.sampleRate,
            actualOutputSize: validation.profile?.fileSize,
            durationDelta: validation.durationDelta,
            avDrift: validation.avDrift
        });
        return { success: true, mode: 'hybrid_smart', assessment, estimator, audioProfile, validation };
    } finally {
        for (const file of [...segmentFiles, listPath, audioPath]) {
            try { fs.unlinkSync(file); } catch (_error) {}
        }
    }
}

module.exports = {
    assessHybridEligibility,
    renderHybridSmart,
    nearestKeyframeDistance,
    buildHybridChunkPlan,
    resolveBoundaryEncoder,
    renderHybridChunk,
    writeConcatList,
    validateHybridBoundaries,
    muxHybridChunksAndValidate,
    getAvailableDiskBytes,
    estimateHybridWorkingBytes,
    resolveHybridAvDriftTolerance,
    assessHybridComplexity,
    MAX_HYBRID_SEGMENTS,
    MAX_HYBRID_CHUNKS,
    MAX_HYBRID_ENCODED_RATIO
};
