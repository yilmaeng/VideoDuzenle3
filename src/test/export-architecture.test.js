const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ffmpegHandler = require('../main/ffmpeg-handler');
const { runFfmpeg, isDiscontinuous } = require('../main/export/continuous-audio-renderer');
const { analyzeSource } = require('../main/export/source-profile-analyzer');
const { classifyEditGraph } = require('../main/export/edit-graph-classifier');
const { estimateExport } = require('../main/export/export-estimator');
const { renderSourceAware } = require('../main/export/source-aware-renderer');
const {
    renderHybridSmart,
    buildHybridChunkPlan,
    estimateHybridWorkingBytes,
    resolveHybridAvDriftTolerance,
    assessHybridComplexity,
    MAX_HYBRID_SEGMENTS
} = require('../main/export/hybrid-smart-renderer');
const { ExportService } = require('../main/export/export-service');
const { validateOutput } = require('../main/export/output-validator');
const { cancelExportJob, runWithExportJob } = require('../main/export/export-process-registry');
const { copyFileWithProgress } = require('../main/export/progressive-file-copy');
const { renderSparseTransitions, buildSparseTransitionPlan } = require('../main/export/sparse-transition-renderer');
const { renderSparseOverlays, buildSparseOverlayPlan } = require('../main/export/sparse-overlay-renderer');

async function main() {
    const { ffmpegPath, ffprobePath } = ffmpegHandler.getFFmpegPaths();
    assert(ffmpegPath && ffprobePath, 'Bundled FFmpeg and FFprobe must be available');

    const testDirectory = path.join(__dirname, '.export-architecture-temp');
    fs.mkdirSync(testDirectory, { recursive: true });
    const sourcePath = path.join(testDirectory, 'source-concert.mov');
    const qualityPath = path.join(testDirectory, 'source-quality.mov');
    const losslessPath = path.join(testDirectory, 'lossless-master.mov');
    const sourceSizePath = path.join(testDirectory, 'source-size.mov');
    const hybridPath = path.join(testDirectory, 'hybrid-smart.mp4');
    const hybridTransitionPath = path.join(testDirectory, 'hybrid-transition.mp4');
    const sparseTransitionPath = path.join(testDirectory, 'sparse-transition.mp4');
    const sparseTransitionSfxPath = path.join(testDirectory, 'sparse-transition-sfx.mp4');
    const sparseOverlayPath = path.join(testDirectory, 'sparse-overlay.mp4');
    const externalAudioMixPath = path.join(testDirectory, 'external-audio-mix.mp4');
    const backgroundAudioMixPath = path.join(testDirectory, 'background-audio-mix.mp4');
    const overlayAssetPath = path.join(testDirectory, 'overlay.png');
    const hybridOverlayPath = path.join(testDirectory, 'hybrid-overlay.mp4');
    const hybridVideoOverlayPath = path.join(testDirectory, 'hybrid-video-overlay.mp4');
    const hybridAudioReferencePath = path.join(testDirectory, 'hybrid-audio-reference.pcm');
    const hybridOverlayAudioPath = path.join(testDirectory, 'hybrid-overlay-audio.pcm');
    const subtitlePath = path.join(testDirectory, 'captions.srt');
    const hybridSubtitlePath = path.join(testDirectory, 'hybrid-subtitle.mp4');
    const rotatedSourcePath = path.join(testDirectory, 'source-rotated.mp4');
    const rotatedHybridPath = path.join(testDirectory, 'hybrid-rotated.mp4');
    const jingleSourcePath = path.join(testDirectory, 'jingle-source.mp4');
    const multiSourceHybridPath = path.join(testDirectory, 'hybrid-multi-source.mp4');
    const seamPcmPath = path.join(testDirectory, 'seam-check.pcm');
    const copiedSourcePath = path.join(testDirectory, 'source-copy.mov');
    const fragmentedQualityPath = path.join(testDirectory, 'fragmented-source-quality.mov');

    try {
        await runFfmpeg(ffmpegPath, [
            '-y',
            '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=5',
            '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=5',
            '-map', '0:v:0', '-map', '1:a:0',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-pix_fmt', 'yuv420p',
            '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
            '-c:a', 'pcm_s24le', '-ac', '2', '-ar', '48000',
            '-shortest', sourcePath
        ]);

        const sourceProfile = await analyzeSource(ffprobePath, sourcePath, { force: true });
        assert.strictEqual(sourceProfile.video.width, 640);
        assert.strictEqual(sourceProfile.video.height, 360);
        assert.strictEqual(sourceProfile.audio[0].sampleRate, 48000);
        assert.strictEqual(sourceProfile.audio[0].channels, 2);
        assert.strictEqual(sourceProfile.audio[0].lossless, true);

        const normalHybridDriftTolerance = resolveHybridAvDriftTolerance(
            { video: { duration: 60 }, audio: [{ duration: 60 }] },
            { frameRate: 30 },
            { codec: 'aac', sampleRate: 48000 }
        );
        const sourceAwareHybridDriftTolerance = resolveHybridAvDriftTolerance(
            { video: { duration: 60 }, audio: [{ duration: 59.867 }] },
            { frameRate: 30 },
            { codec: 'aac', sampleRate: 48000 }
        );
        const cappedHybridDriftTolerance = resolveHybridAvDriftTolerance(
            { video: { duration: 60 }, audio: [{ duration: 59 }] },
            { frameRate: 30 },
            { codec: 'aac', sampleRate: 48000 }
        );
        assert(normalHybridDriftTolerance < 0.07);
        assert(sourceAwareHybridDriftTolerance > 0.16 && sourceAwareHybridDriftTolerance < 0.18);
        assert.strictEqual(cappedHybridDriftTolerance, 0.25);

        const sparseTransitionPlan = buildSparseTransitionPlan(
            [
                { time: 12, duration: 1, type: 'dip_black' },
                { time: 42, duration: 1, type: 'cross_dissolve' }
            ],
            [0, 10, 20, 30, 40, 50, 60],
            60,
            30
        );
        assert.deepStrictEqual(
            sparseTransitionPlan.map((chunk) => [chunk.type, chunk.start, chunk.end]),
            [
                ['copy', 0, 10],
                ['encode', 10, 20],
                ['copy', 20, 40],
                ['encode', 40, 50],
                ['copy', 50, 60]
            ]
        );
        const sparseOverlayPlan = buildSparseOverlayPlan(
            [{ startTime: 11.5, duration: 1 }, { startTime: 41.5, duration: 1 }],
            [0, 10, 20, 30, 40, 50, 60],
            60,
            30
        );
        assert.deepStrictEqual(
            sparseOverlayPlan.map((chunk) => [chunk.type, chunk.start, chunk.end]),
            [
                ['copy', 0, 10],
                ['encode', 10, 20],
                ['copy', 20, 40],
                ['encode', 40, 50],
                ['copy', 50, 60]
            ]
        );

        await runFfmpeg(ffmpegPath, [
            '-y',
            '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=1.2',
            '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=44100:duration=1.2',
            '-map', '0:v:0', '-map', '1:a:0',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '192k', '-shortest', jingleSourcePath
        ]);

        const copyProgress = [];
        const copyResult = await copyFileWithProgress(sourcePath, copiedSourcePath, (percent) => copyProgress.push(percent));
        assert.strictEqual(copyResult.success, true);
        assert.strictEqual(fs.statSync(copiedSourcePath).size, fs.statSync(sourcePath).size);
        assert(copyProgress.some((percent) => percent >= 100));

        const segments = [
            { start: 0, end: 0.9, sourceFile: sourcePath, audioVolume: 100, speed: 1 },
            { start: 1.15, end: 2.5, sourceFile: sourcePath, audioVolume: 100, speed: 1 }
        ];
        assert.strictEqual(isDiscontinuous(segments[0], segments[1], sourcePath), true);
        assert.strictEqual(isDiscontinuous(
            { start: 0, end: 1, sourceFile: sourcePath },
            { start: 1, end: 2, sourceFile: sourcePath },
            sourcePath
        ), false);

        const graph = classifyEditGraph({ inputPath: sourcePath, segments });
        assert.strictEqual(graph.classification, 'time_only');
        assert.strictEqual(graph.hybridEligible, true);
        const estimate = estimateExport({ profiles: [sourceProfile], segments, mode: 'source_size' });
        assert(estimate.targetVideoBitrate > 0);
        assert(estimate.targetAudioBitrate >= 768000);
        const hybridWorkingSpace = estimateHybridWorkingBytes(estimate, sourceProfile, segments);
        assert(hybridWorkingSpace.requiredBytes > estimate.estimatedOutputSize * 2);

        const fragmentedSegments = Array.from({ length: MAX_HYBRID_SEGMENTS + 1 }, (_, index) => {
            // Exercise batching with 81 short, frame-aligned retained sections.
            const start = (index % 40) * 0.1;
            const end = start + 0.1;
            return { start, end, sourceFile: sourcePath, audioVolume: 100, speed: 1 };
        });
        const fragmentedComplexity = assessHybridComplexity(fragmentedSegments);
        assert.strictEqual(fragmentedComplexity.tooFragmented, true);
        assert.strictEqual(fragmentedComplexity.segmentCount, MAX_HYBRID_SEGMENTS + 1);

        const fragmentedHybridResult = await renderHybridSmart({
            ffmpegPath,
            ffprobePath,
            inputPath: sourcePath,
            segments: fragmentedSegments,
            outputPath: path.join(testDirectory, 'fragmented-hybrid-must-not-exist.mp4')
        });
        assert.strictEqual(fragmentedHybridResult.success, false);
        assert.strictEqual(fragmentedHybridResult.fallbackRequired, true);
        assert.strictEqual(fragmentedHybridResult.fallbackMode, 'source_quality');
        assert.strictEqual(fragmentedHybridResult.reason, 'high_timeline_fragmentation');

        const fragmentedQualityResult = await renderSourceAware({
            ffmpegPath,
            ffprobePath,
            inputPath: sourcePath,
            segments: fragmentedSegments,
            outputPath: fragmentedQualityPath,
            mode: 'source_quality'
        });
        assert.strictEqual(fragmentedQualityResult.success, true);
        const fragmentedQualityProfile = await analyzeSource(ffprobePath, fragmentedQualityPath, { force: true });
        assert.strictEqual(fragmentedQualityProfile.video.width, 640);
        assert.strictEqual(fragmentedQualityProfile.audio[0].sampleRate, 48000);
        assert.strictEqual(fragmentedQualityProfile.audio[0].channels, 2);
        assert.strictEqual(fragmentedQualityProfile.audio[0].codec, 'pcm_s24le');
        assert(Math.abs(fragmentedQualityProfile.duration - 8.1) < 0.12);

        const qualityResult = await renderSourceAware({
            ffmpegPath,
            ffprobePath,
            inputPath: sourcePath,
            segments,
            outputPath: qualityPath,
            mode: 'source_quality'
        });
        assert.strictEqual(qualityResult.success, true);
        const qualityProfile = await analyzeSource(ffprobePath, qualityPath, { force: true });
        assert.strictEqual(qualityProfile.video.width, 640);
        assert.strictEqual(qualityProfile.audio[0].sampleRate, 48000);
        assert.strictEqual(qualityProfile.audio[0].channels, 2);
        assert.strictEqual(qualityProfile.audio[0].codec, 'pcm_s24le');
        assert(Math.abs(qualityProfile.duration - 2.25) < 0.08);

        await runFfmpeg(ffmpegPath, [
            '-y', '-ss', '0.88', '-i', qualityPath, '-t', '0.04',
            '-map', '0:a:0', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2',
            '-f', 's16le', seamPcmPath
        ]);
        const seamSamples = fs.readFileSync(seamPcmPath);
        let maximumSampleJump = 0;
        for (let offset = 4; offset + 1 < seamSamples.length; offset += 4) {
            const previousLeft = seamSamples.readInt16LE(offset - 4);
            const currentLeft = seamSamples.readInt16LE(offset);
            maximumSampleJump = Math.max(maximumSampleJump, Math.abs(currentLeft - previousLeft));
        }
        assert(maximumSampleJump < 5000, `Cut seam sample jump is too large: ${maximumSampleJump}`);

        const losslessResult = await renderSourceAware({
            ffmpegPath,
            ffprobePath,
            inputPath: sourcePath,
            segments,
            outputPath: losslessPath,
            mode: 'lossless_master'
        });
        assert.strictEqual(losslessResult.success, true);
        const losslessProfile = await analyzeSource(ffprobePath, losslessPath, { force: true });
        assert.strictEqual(losslessProfile.audio[0].codec, 'pcm_s24le');
        assert(Math.abs(losslessProfile.duration - 2.25) < 0.08);

        const sourceSizeResult = await renderSourceAware({
            ffmpegPath,
            ffprobePath,
            inputPath: sourcePath,
            segments,
            outputPath: sourceSizePath,
            mode: 'source_size'
        });
        assert.strictEqual(sourceSizeResult.success, true);
        assert.strictEqual(sourceSizeResult.videoProfile.twoPass, true);
        assert(sourceSizeResult.validation.sizeDifferenceRatio <= 0.1);

        const plannedChunks = buildHybridChunkPlan(
            [{ start: 0.2, end: 2.7 }],
            [0, 1, 2, 3],
            0.01
        );
        assert.deepStrictEqual(plannedChunks.map((chunk) => chunk.type), ['encode', 'copy', 'encode']);

        const arbitraryHybridSegments = [
            { start: 0.2, end: 2.7, sourceFile: sourcePath, audioVolume: 100, speed: 1 },
            { start: 3.2, end: 4.7, sourceFile: sourcePath, audioVolume: 100, speed: 1 }
        ];
        const hybridResult = await renderHybridSmart({
            ffmpegPath,
            ffprobePath,
            inputPath: sourcePath,
            segments: arbitraryHybridSegments,
            outputPath: hybridPath
        });
        assert.strictEqual(hybridResult.success, true, JSON.stringify(hybridResult));
        const hybridProfile = await analyzeSource(ffprobePath, hybridPath, { force: true });
        assert.strictEqual(hybridProfile.video.codec, sourceProfile.video.codec);
        assert.strictEqual(hybridProfile.audio[0].codec, 'aac');
        assert.strictEqual(hybridResult.audioProfile.bitrate, 512000);
        assert(Math.abs(hybridProfile.duration - 4) < 0.08);
        assert(hybridResult.assessment.copiedDuration > 0);
        assert(hybridResult.assessment.encodedDuration > 0);

        const roundedContainerSegments = [{ start: 0, end: hybridProfile.duration - 0.09 }];
        const strictContainerValidation = await validateOutput({
            ffprobePath,
            outputPath: hybridPath,
            segments: roundedContainerSegments,
            expectedVideo: { width: 640, height: 360, frameRate: 30 }
        });
        assert.strictEqual(strictContainerValidation.reasons.includes('duration_mismatch'), true);
        const hybridContainerValidation = await validateOutput({
            ffprobePath,
            outputPath: hybridPath,
            segments: roundedContainerSegments,
            expectedVideo: { width: 640, height: 360, frameRate: 30 },
            durationTolerance: 0.12,
            avDriftTolerance: 0.16
        });
        assert.strictEqual(hybridContainerValidation.valid, true);
        assert.strictEqual(hybridContainerValidation.avDriftTolerance, 0.16);

        const transitionResult = await ffmpegHandler.applyTransitionsSmart(
            hybridPath,
            hybridTransitionPath,
            [{ time: 1.5, duration: 0.5, type: 'dip_black', useSfx: false }]
        );
        assert.strictEqual(transitionResult.success, true);
        const hybridTransitionProfile = await analyzeSource(ffprobePath, hybridTransitionPath, { force: true });
        assert.strictEqual(hybridTransitionProfile.audio[0].codec, hybridProfile.audio[0].codec);
        assert.strictEqual(hybridTransitionProfile.audio[0].sampleRate, hybridProfile.audio[0].sampleRate);
        assert(Math.abs(hybridTransitionProfile.duration - hybridProfile.duration) < 0.08);
        assert(
            fs.statSync(hybridTransitionPath).size <= fs.statSync(hybridPath).size * 1.35,
            'Transition encoding should stay reasonably close to the hybrid source size'
        );

        const sparseTransitionResult = await renderSparseTransitions({
            ffmpegPath,
            ffprobePath,
            inputPath: hybridPath,
            outputPath: sparseTransitionPath,
            transitions: [{ time: 1.5, duration: 0.5, type: 'dip_black', useSfx: false }]
        });
        assert.strictEqual(sparseTransitionResult.success, true);
        const sparseTransitionProfile = await analyzeSource(ffprobePath, sparseTransitionPath, { force: true });
        assert.strictEqual(sparseTransitionProfile.video.codec, hybridProfile.video.codec);
        assert.strictEqual(sparseTransitionProfile.audio[0].codec, hybridProfile.audio[0].codec);
        assert(Math.abs(sparseTransitionProfile.duration - hybridProfile.duration) < 0.12);

        process.env.EVD_SPARSE_TRANSITION_MIN_DURATION = '0';
        const sparseTransitionSfxResult = await ffmpegHandler.applyTransitionsSmart(
            hybridPath,
            sparseTransitionSfxPath,
            [{ time: 1.5, duration: 0.5, type: 'fade', useSfx: true, defaultSfx: 'cross_dissolve.wav' }]
        );
        delete process.env.EVD_SPARSE_TRANSITION_MIN_DURATION;
        assert.strictEqual(sparseTransitionSfxResult.success, true);
        assert.strictEqual(sparseTransitionSfxResult.sfxCount, 1);
        const sparseTransitionSfxProfile = await analyzeSource(ffprobePath, sparseTransitionSfxPath, { force: true });
        assert.strictEqual(sparseTransitionSfxProfile.audio[0].codec, 'aac');
        assert(Math.abs(sparseTransitionSfxProfile.duration - hybridProfile.duration) < 0.12);

        const sparseOverlayResult = await renderSparseOverlays({
            ffmpegPath,
            ffprobePath,
            inputPath: hybridPath,
            outputPath: sparseOverlayPath,
            overlays: [{ startTime: 1.25, duration: 0.5 }],
            renderEffectChunk: ({ inputPath, outputPath, start, duration }) => runFfmpeg(ffmpegPath, [
                '-y', '-ss', String(start), '-i', inputPath, '-t', String(duration),
                '-map', '0:v:0', '-map', '0:a:0?',
                '-vf', 'drawbox=x=10:y=10:w=80:h=40:color=red:t=fill',
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
                '-c:a', 'copy', outputPath
            ], { duration })
        });
        assert.strictEqual(sparseOverlayResult.success, true);
        const sparseOverlayProfile = await analyzeSource(ffprobePath, sparseOverlayPath, { force: true });
        assert.strictEqual(sparseOverlayProfile.video.codec, hybridProfile.video.codec);
        assert.strictEqual(sparseOverlayProfile.audio[0].codec, hybridProfile.audio[0].codec);
        assert(Math.abs(sparseOverlayProfile.duration - hybridProfile.duration) < 0.12);

        await ffmpegHandler.mixAudioAdvanced({
            videoPath: hybridPath,
            audioPath: jingleSourcePath,
            outputPath: externalAudioMixPath,
            videoVolume: 1,
            audioVolume: 0.75,
            insertTime: 0.75,
            audioTrimStart: 0.1,
            audioTrimEnd: 0.9,
            loopAudio: false
        });
        const externalAudioMixProfile = await analyzeSource(ffprobePath, externalAudioMixPath, { force: true });
        assert.strictEqual(externalAudioMixProfile.video.codec, hybridProfile.video.codec);
        assert.strictEqual(externalAudioMixProfile.audio[0].sampleRate, hybridProfile.audio[0].sampleRate);
        assert(Math.abs(externalAudioMixProfile.duration - hybridProfile.duration) < 0.12);

        await ffmpegHandler.mixAudioAdvanced({
            videoPath: hybridPath,
            audioPath: jingleSourcePath,
            outputPath: backgroundAudioMixPath,
            videoVolume: 1,
            audioVolume: 0.5,
            insertTime: 0,
            loopAudio: true
        });
        const backgroundAudioMixProfile = await analyzeSource(ffprobePath, backgroundAudioMixPath, { force: true });
        assert.strictEqual(backgroundAudioMixProfile.video.codec, hybridProfile.video.codec);
        assert.strictEqual(backgroundAudioMixProfile.audio[0].sampleRate, hybridProfile.audio[0].sampleRate);
        assert(Math.abs(backgroundAudioMixProfile.duration - hybridProfile.duration) < 0.12);

        await require('sharp')({
            create: { width: 64, height: 64, channels: 4, background: { r: 220, g: 40, b: 40, alpha: 1 } }
        }).png().toFile(overlayAssetPath);
        process.env.EVD_SPARSE_OVERLAY_MIN_DURATION = '0';
        await ffmpegHandler.applyCtaOverlaysSmart(
            hybridTransitionPath,
            hybridOverlayPath,
            [{ assetPath: overlayAssetPath, startTime: 0.5, duration: 0.75, position: 'top-left', scale: 0.15, sound: null }]
        );
        const hybridOverlayProfile = await analyzeSource(ffprobePath, hybridOverlayPath, { force: true });
        assert.strictEqual(hybridOverlayProfile.audio[0].codec, hybridTransitionProfile.audio[0].codec);
        assert(Math.abs(hybridOverlayProfile.duration - hybridTransitionProfile.duration) < 0.08);

        await ffmpegHandler.applyCtaOverlaysSmart(
            hybridTransitionPath,
            hybridVideoOverlayPath,
            [{ assetPath: jingleSourcePath, startTime: 1, duration: 1, position: 'bottom-right', scale: 0.2, audioVolume: 1 }]
        );
        delete process.env.EVD_SPARSE_OVERLAY_MIN_DURATION;
        const hybridVideoOverlayProfile = await analyzeSource(ffprobePath, hybridVideoOverlayPath, { force: true });
        assert.strictEqual(hybridVideoOverlayProfile.audio[0].codec, 'aac');
        assert(Math.abs(hybridVideoOverlayProfile.duration - hybridTransitionProfile.duration) < 0.08);
        await runFfmpeg(ffmpegPath, [
            '-y', '-ss', '1.1', '-i', hybridTransitionPath, '-t', '0.5',
            '-map', '0:a:0', '-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '2', '-f', 's16le', hybridAudioReferencePath
        ]);
        await runFfmpeg(ffmpegPath, [
            '-y', '-ss', '1.1', '-i', hybridVideoOverlayPath, '-t', '0.5',
            '-map', '0:a:0', '-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '2', '-f', 's16le', hybridOverlayAudioPath
        ]);
        assert.notDeepStrictEqual(
            fs.readFileSync(hybridOverlayAudioPath),
            fs.readFileSync(hybridAudioReferencePath),
            'Embedded video overlay audio must be mixed into the output'
        );

        fs.writeFileSync(subtitlePath, '1\n00:00:00,500 --> 00:00:02,000\nEVD source preserving subtitle test\n', 'utf8');
        await ffmpegHandler.burnSubtitles(hybridOverlayPath, subtitlePath, hybridSubtitlePath);
        const hybridSubtitleProfile = await analyzeSource(ffprobePath, hybridSubtitlePath, { force: true });
        assert.strictEqual(hybridSubtitleProfile.audio[0].codec, hybridOverlayProfile.audio[0].codec);
        assert(Math.abs(hybridSubtitleProfile.duration - hybridOverlayProfile.duration) < 0.08);

        await runFfmpeg(ffmpegPath, [
            '-y', '-i', sourcePath, '-map', '0:v:0', '-map', '0:a:0',
            '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k',
            '-metadata:s:v:0', 'rotate=-90', rotatedSourcePath
        ]);
        const rotatedSourceProfile = await analyzeSource(ffprobePath, rotatedSourcePath, { force: true });
        // FFprobe reports equivalent display-matrix rotations as either -90 or
        // 90 on different platforms/builds. The swapped dimensions are the
        // behavior this test needs to protect.
        assert.strictEqual(Math.abs(Math.round(rotatedSourceProfile.video.rotation)), 90);
        assert.strictEqual(rotatedSourceProfile.video.storageWidth, 640);
        assert.strictEqual(rotatedSourceProfile.video.storageHeight, 360);
        assert.strictEqual(rotatedSourceProfile.video.width, 360);
        assert.strictEqual(rotatedSourceProfile.video.height, 640);
        const rotatedHybridSegments = [
            { start: 0.2, end: 2.7, sourceFile: rotatedSourcePath, audioVolume: 100, speed: 1 },
            { start: 3.2, end: 4.7, sourceFile: rotatedSourcePath, audioVolume: 100, speed: 1 }
        ];
        const rotatedHybridResult = await renderHybridSmart({
            ffmpegPath,
            ffprobePath,
            inputPath: rotatedSourcePath,
            segments: rotatedHybridSegments,
            outputPath: rotatedHybridPath
        });
        assert.strictEqual(rotatedHybridResult.success, true);
        const rotatedHybridProfile = await analyzeSource(ffprobePath, rotatedHybridPath, { force: true });
        assert.strictEqual(Math.abs(Math.round(rotatedHybridProfile.video.rotation)), 90);
        assert.strictEqual(rotatedHybridProfile.video.width, 360);
        assert.strictEqual(rotatedHybridProfile.video.height, 640);

        const multiSourceSegments = [
            { start: 0, end: 0.6, sourceFile: jingleSourcePath, audioVolume: 100, speed: 1 },
            { start: 0.2, end: 2.7, sourceFile: sourcePath, audioVolume: 100, speed: 1 },
            { start: 3.2, end: 4.7, sourceFile: sourcePath, audioVolume: 100, speed: 1 },
            { start: 0.6, end: 1.2, sourceFile: jingleSourcePath, audioVolume: 100, speed: 1 }
        ];
        const multiSourceHybridResult = await renderHybridSmart({
            ffmpegPath,
            ffprobePath,
            inputPath: sourcePath,
            segments: multiSourceSegments,
            outputPath: multiSourceHybridPath
        });
        assert.strictEqual(multiSourceHybridResult.success, true);
        assert.strictEqual(path.resolve(multiSourceHybridResult.assessment.dominantSource), path.resolve(sourcePath));
        assert(multiSourceHybridResult.assessment.copiedDuration > 0);
        assert(multiSourceHybridResult.assessment.encodedDuration >= 1.2);
        const multiSourceProfile = await analyzeSource(ffprobePath, multiSourceHybridPath, { force: true });
        assert.strictEqual(multiSourceProfile.video.width, 640);
        assert.strictEqual(multiSourceProfile.video.height, 360);
        assert(Math.abs(multiSourceProfile.duration - 5.2) < 0.08);

        const cancellationJobId = `export-test-${Date.now()}`;
        const cancellationPromise = runWithExportJob(cancellationJobId, () => runFfmpeg(ffmpegPath, [
            '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=60:duration=30',
            '-c:v', 'libx264', '-preset', 'veryslow', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'
        ], { duration: 30 }));
        setTimeout(() => cancelExportJob(cancellationJobId), 100);
        await assert.rejects(cancellationPromise, (error) => error?.code === 'EXPORT_CANCELLED');

        const service = new ExportService({ ffmpegPath, ffprobePath, legacyRenderer: async () => {} });
        const localEffectFallback = await service.render({
            inputPath: sourcePath,
            segments: [{ start: 0, end: 2, sourceFile: sourcePath, overlays: [{ type: 'test' }] }],
            outputPath: path.join(testDirectory, 'must-not-be-written.mp4'),
            mode: 'hybrid_smart'
        });
        assert.strictEqual(localEffectFallback.success, false);
        assert.strictEqual(localEffectFallback.fallbackRequired, true);
        assert.strictEqual(localEffectFallback.reason, 'local_visual_effect');

        console.log('Source-aware export architecture tests passed.');
    } finally {
        for (const filePath of [sourcePath, copiedSourcePath, qualityPath, losslessPath, sourceSizePath, hybridPath, hybridTransitionPath, sparseTransitionPath, sparseTransitionSfxPath, sparseOverlayPath, externalAudioMixPath, backgroundAudioMixPath, overlayAssetPath, hybridOverlayPath, hybridVideoOverlayPath, hybridAudioReferencePath, hybridOverlayAudioPath, subtitlePath, hybridSubtitlePath, rotatedSourcePath, rotatedHybridPath, jingleSourcePath, multiSourceHybridPath, seamPcmPath, fragmentedQualityPath]) {
            try { fs.unlinkSync(filePath); } catch (_error) {}
        }
        try { fs.rmdirSync(testDirectory); } catch (_error) {}
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
