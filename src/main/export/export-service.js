const path = require('path');
const { analyzeSource } = require('./source-profile-analyzer');
const { classifyEditGraph } = require('./edit-graph-classifier');
const { estimateExport } = require('./export-estimator');
const { renderSourceAware } = require('./source-aware-renderer');
const {
    assessHybridEligibility,
    assessHybridComplexity,
    renderHybridSmart,
    getAvailableDiskBytes,
    estimateHybridWorkingBytes
} = require('./hybrid-smart-renderer');

class ExportService {
    constructor({ ffmpegPath, ffprobePath, legacyRenderer }) {
        this.ffmpegPath = ffmpegPath;
        this.ffprobePath = ffprobePath;
        this.legacyRenderer = legacyRenderer;
    }

    async analyze({ inputPath, outputPath, segments = [], mode = 'legacy', transitions = [], globalEffects = [], ctaCount = 0 }) {
        const sources = [...new Set(segments.map((segment) => path.resolve(segment.sourceFile || inputPath)).filter(Boolean))];
        if (!sources.length && inputPath) sources.push(path.resolve(inputPath));
        const profiles = await Promise.all(sources.map((source) => analyzeSource(this.ffprobePath, source)));
        const graph = classifyEditGraph({ inputPath, segments, transitions, globalEffects, ctaCount });
        const estimator = estimateExport({ profiles, segments, mode });
        let hybrid = null;
        if (mode === 'hybrid_smart') {
            const complexity = assessHybridComplexity(segments);
            hybrid = complexity.tooFragmented
                ? {
                    eligible: false,
                    reason: 'high_timeline_fragmentation',
                    complexity,
                    graph
                }
                : await assessHybridEligibility({
                    ffprobePath: this.ffprobePath,
                    inputPath,
                    segments,
                    transitions,
                    globalEffects,
                    ctaCount,
                    scanKeyframes: false
                });
        }
        let diskSpace = null;
        if (mode === 'hybrid_smart' && outputPath && hybrid?.profile) {
            const estimate = estimateHybridWorkingBytes(estimator, hybrid.profile, segments);
            const availableBytes = getAvailableDiskBytes(path.dirname(outputPath));
            diskSpace = {
                requiredBytes: estimate.requiredBytes,
                availableBytes,
                sufficient: availableBytes <= 0 || availableBytes >= estimate.requiredBytes
            };
        }
        console.info('[EVD Export Analysis]', {
            mode,
            sourceCount: profiles.length,
            graph: graph.classification,
            codecs: profiles.map((profile) => ({ video: profile.video?.codec, audio: profile.audio?.[0]?.codec })),
            estimatedOutputSize: estimator.estimatedOutputSize,
            hybridEligible: hybrid?.eligible ?? null,
            hybridReason: hybrid?.reason || ''
        });
        return { success: true, profiles, graph, estimator, hybrid, diskSpace };
    }

    async render({ inputPath, segments = [], outputPath, mode = 'legacy', transitions = [], globalEffects = [], ctaCount = 0, options = {}, onProgress }) {
        console.info('[EVD Export Start]', { mode, segmentCount: segments.length, transitionCount: transitions.length, ctaCount });
        if (mode === 'legacy' || !mode) {
            await this.legacyRenderer(inputPath, segments, outputPath, onProgress, options);
            return { success: true, mode: 'legacy' };
        }
        const extension = path.extname(outputPath).toLowerCase();
        if (!['.mp4', '.mov', '.mkv'].includes(extension)) {
            return { success: false, fallbackRequired: true, fallbackMode: 'legacy', reason: 'container_not_supported' };
        }
        if (mode === 'lossless_master' && !['.mov', '.mkv'].includes(extension)) {
            return { success: false, fallbackRequired: true, fallbackMode: 'legacy', reason: 'lossless_container_required' };
        }
        const graph = classifyEditGraph({ inputPath, segments, transitions, globalEffects, ctaCount });
        const sourceFiles = [...new Set(segments.map((segment) => path.resolve(segment.sourceFile || inputPath)))];
        const sourceProfiles = await Promise.all(sourceFiles.map((source) => analyzeSource(this.ffprobePath, source)));
        if (sourceProfiles.some((profile) => profile.audio?.length > 1)) {
            return { success: false, fallbackRequired: true, fallbackMode: 'legacy', reason: 'multiple_audio_streams_not_supported' };
        }
        const hasUnsupportedHdrMetadata = sourceProfiles.some((profile) => {
            const transfer = String(profile.video?.colorTransfer || '').toLowerCase();
            const sideData = profile.video?.sideData || [];
            return ['smpte2084', 'arib-std-b67'].includes(transfer)
                || sideData.some((item) => /dolby|dovi|mastering display|content light/i.test(String(item?.side_data_type || '')));
        });
        if (hasUnsupportedHdrMetadata) {
            return { success: false, fallbackRequired: true, fallbackMode: 'legacy', reason: 'hdr_metadata_not_supported' };
        }
        if (graph.hasLocalVisualEffects || graph.hasGlobalVisualEffects) {
            console.info('[EVD Export Fallback]', { mode, reason: graph.hasGlobalVisualEffects ? 'global_visual_effect' : 'local_visual_effect' });
            return {
                success: false,
                fallbackRequired: true,
                fallbackMode: 'legacy',
                reason: graph.hasGlobalVisualEffects ? 'global_visual_effect' : 'local_visual_effect',
                graph
            };
        }
        if (segments.some((segment) => segment.noiseReduction?.enabled || segment.speedBgAudio || (Array.isArray(segment.audioEffects) && segment.audioEffects.length))) {
            console.info('[EVD Export Fallback]', { mode, reason: 'complex_audio_effect' });
            return { success: false, fallbackRequired: true, fallbackMode: 'legacy', reason: 'complex_audio_effect', graph };
        }
        if (mode === 'hybrid_smart') {
            return renderHybridSmart({
                ffmpegPath: this.ffmpegPath,
                ffprobePath: this.ffprobePath,
                inputPath,
                segments,
                outputPath,
                transitions,
                globalEffects,
                ctaCount,
                onProgress
            });
        }
        return renderSourceAware({
            ffmpegPath: this.ffmpegPath,
            ffprobePath: this.ffprobePath,
            inputPath,
            segments,
            outputPath,
            mode,
            onProgress
        });
    }
}

module.exports = { ExportService };
