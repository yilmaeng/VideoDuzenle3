const fs = require('fs');
const path = require('path');

const PROJECT_FORMAT = 'evd-description-subtitle-project';
const PROJECT_VERSION = 2;
const PROJECT_EXTENSION = 'evdscript';

function isoNow() {
    return new Date().toISOString();
}

function normalizeSource(source = {}) {
    const filePath = String(source.path || '').trim();
    return {
        path: filePath,
        name: String(source.name || (filePath ? path.basename(filePath) : '')).trim(),
        duration: Number.isFinite(Number(source.duration)) ? Math.max(0, Number(source.duration)) : 0,
        width: Number.isFinite(Number(source.width)) ? Math.max(0, Number(source.width)) : 0,
        height: Number.isFinite(Number(source.height)) ? Math.max(0, Number(source.height)) : 0,
        fps: Number.isFinite(Number(source.fps)) ? Math.max(0, Number(source.fps)) : 0,
        size: Number.isFinite(Number(source.size)) ? Math.max(0, Number(source.size)) : 0,
        mtimeMs: Number.isFinite(Number(source.mtimeMs)) ? Math.max(0, Number(source.mtimeMs)) : 0,
        mediaType: String(source.mediaType || '').toLowerCase() === 'audio' ? 'audio' : 'video'
    };
}

function normalizeReviewNote(item = {}, index = 0) {
    const now = isoNow();
    return {
        id: String(item.id || `review-note-${Date.now()}-${index}`),
        eventId: String(item.eventId || ''),
        text: String(item.text || ''),
        resolved: Boolean(item.resolved),
        createdAt: String(item.createdAt || now),
        updatedAt: String(item.updatedAt || item.createdAt || now)
    };
}

function normalizeEvent(item = {}, index = 0) {
    const start = Math.max(0, Number(item.start) || 0);
    const end = Math.max(start, Number(item.end) || start);
    const type = ['description', 'subtitle', 'note'].includes(item.type) ? item.type : 'description';
    return {
        id: String(item.id || `event-${Date.now()}-${index}`),
        type,
        start,
        end,
        text: String(item.text || ''),
        speaker: String(item.speaker || ''),
        narrationNotes: String(item.narrationNotes || ''),
        narrationTone: String(item.narrationTone || ''),
        narrationTempo: String(item.narrationTempo || ''),
        voice: String(item.voice || ''),
        ttsService: String(item.ttsService || ''),
        ttsSpeed: Number.isFinite(Number(item.ttsSpeed)) ? Math.max(0.5, Math.min(2, Number(item.ttsSpeed))) : 1,
        ttsVolume: Number.isFinite(Number(item.ttsVolume)) ? Math.max(0, Math.min(200, Number(item.ttsVolume))) : 100,
        originalVolume: Number.isFinite(Number(item.originalVolume)) ? Math.max(0, Math.min(2, Number(item.originalVolume))) : 0.9,
        ttsAudioPath: String(item.ttsAudioPath || ''),
        ttsDuration: Number.isFinite(Number(item.ttsDuration)) ? Math.max(0, Number(item.ttsDuration)) : 0,
        ttsPlaybackRate: Number.isFinite(Number(item.ttsPlaybackRate)) ? Math.max(0.5, Math.min(2, Number(item.ttsPlaybackRate))) : 1,
        ttsGeneratedText: String(item.ttsGeneratedText || ''),
        ttsGeneratedVoice: String(item.ttsGeneratedVoice || ''),
        ttsGeneratedService: String(item.ttsGeneratedService || ''),
        narrationSource: ['human', 'tts'].includes(item.narrationSource) ? item.narrationSource : '',
        humanNarrationCandidateId: String(item.humanNarrationCandidateId || ''),
        contentStudioCueId: String(item.contentStudioCueId || ''),
        contentStudioConfidence: Number.isFinite(Number(item.contentStudioConfidence))
            ? Math.max(0, Math.min(1, Number(item.contentStudioConfidence))) : 0,
        status: ['draft', 'review', 'approved'].includes(item.status) ? item.status : 'draft',
        source: String(item.source || 'manual'),
        createdAt: String(item.createdAt || isoNow()),
        updatedAt: String(item.updatedAt || item.createdAt || isoNow())
    };
}

function normalizeMarker(item = {}, index = 0) {
    return {
        id: String(item.id || `marker-${Date.now()}-${index}`),
        time: Math.max(0, Number(item.time) || 0),
        label: String(item.label || '')
    };
}

function createProject(source = {}) {
    const now = isoNow();
    return {
        format: PROJECT_FORMAT,
        version: PROJECT_VERSION,
        createdAt: now,
        updatedAt: now,
        source: normalizeSource(source),
        settings: {
            language: '',
            defaultVoice: '',
            readingSpeedWpm: 160,
            ttsService: 'system',
            defaultVoice: '',
            ttsSpeed: 1,
            ttsVolume: 100,
            originalVolume: 0.9,
            autoFitTts: true,
            maxAutoSpeed: 1.35,
            humanNarrationModel: 'Xenova/whisper-base'
        },
        workspace: {
            currentTime: 0,
            selectedEventId: '',
            selectedEventIds: [],
            zoom: 1
        },
        analysis: {
            fingerprint: '',
            waveformReady: false,
            sceneTimes: []
        },
        markers: [],
        events: [],
        reviewNotes: [],
        contentStudio: {
            projectId: '',
            status: '',
            cues: [],
            settings: {},
            lastError: '',
            lastCheckedAt: ''
        },
        humanNarration: {
            sourcePath: '',
            sourceName: '',
            model: 'Xenova/whisper-base',
            transcript: '',
            candidates: [],
            unmatched: [],
            analyzedAt: ''
        }
    };
}

function normalizeProject(input = {}) {
    if (!input || typeof input !== 'object' || input.format !== PROJECT_FORMAT) {
        const error = new Error('invalid_description_subtitle_project');
        error.code = 'INVALID_PROJECT';
        throw error;
    }

    const base = createProject(input.source);
    return {
        ...base,
        ...input,
        format: PROJECT_FORMAT,
        version: PROJECT_VERSION,
        source: normalizeSource(input.source),
        settings: { ...base.settings, ...(input.settings || {}) },
        workspace: {
            ...base.workspace,
            ...(input.workspace || {}),
            selectedEventIds: Array.isArray(input.workspace?.selectedEventIds)
                ? input.workspace.selectedEventIds.map(String)
                : (input.workspace?.selectedEventId ? [String(input.workspace.selectedEventId)] : [])
        },
        analysis: {
            ...base.analysis,
            ...(input.analysis || {}),
            sceneTimes: Array.isArray(input.analysis?.sceneTimes) ? input.analysis.sceneTimes : []
        },
        markers: Array.isArray(input.markers)
            ? input.markers.map(normalizeMarker).sort((a, b) => a.time - b.time)
            : [],
        events: Array.isArray(input.events) ? input.events.map(normalizeEvent) : [],
        reviewNotes: Array.isArray(input.reviewNotes)
            ? input.reviewNotes.map(normalizeReviewNote).filter(item => item.eventId && item.text.trim())
            : [],
        contentStudio: {
            ...base.contentStudio,
            ...(input.contentStudio || {}),
            cues: Array.isArray(input.contentStudio?.cues) ? input.contentStudio.cues : [],
            settings: input.contentStudio?.settings && typeof input.contentStudio.settings === 'object'
                ? input.contentStudio.settings : {}
        },
        humanNarration: {
            ...base.humanNarration,
            ...(input.humanNarration || {}),
            candidates: Array.isArray(input.humanNarration?.candidates) ? input.humanNarration.candidates : [],
            unmatched: Array.isArray(input.humanNarration?.unmatched) ? input.humanNarration.unmatched : []
        },
        updatedAt: String(input.updatedAt || isoNow())
    };
}

function getSourceFileInfo(filePath) {
    const resolvedPath = path.resolve(String(filePath || ''));
    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile()) {
        throw new Error('source_is_not_file');
    }
    return {
        path: resolvedPath,
        name: path.basename(resolvedPath),
        size: stats.size,
        mtimeMs: stats.mtimeMs
    };
}

module.exports = {
    PROJECT_EXTENSION,
    PROJECT_FORMAT,
    PROJECT_VERSION,
    createProject,
    getSourceFileInfo,
    normalizeProject,
    normalizeReviewNote,
    normalizeSource
};

