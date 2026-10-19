const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync(require('node:path').join(__dirname, '../renderer/scripts/app.js'), 'utf8');
const start = code.indexOf('    async saveProject() {');
const methods = code.slice(start, code.indexOf('    async handleAppQuitRequest() {', start));

function harness(project) {
    const calls = [], announcements = [], saved = [];
    const Timeline = { sourceFile: 'old/movie.mp4', sourceDuration: 20, segments: [{ start: 2, end: 8, sourceFile: 'old/movie.mp4' }],
        getSegments() { return this.segments; }, restoreState(segments, sourceFile, duration) { this.segments = segments; this.sourceFile = sourceFile; this.sourceDuration = duration; } };
    const api = {
        showSaveDialog: async () => ({ filePath: '/share/project.kve' }),
        saveFileContent: async value => { saved.push(JSON.parse(value.content)); return { success: true }; },
        readFileContent: async () => ({ success: true, content: JSON.stringify(project) }),
        addRecentFile: async () => {},
        checkFileExists: async file => file === '/share/movie.mp4',
        speechSearchProject: async request => { calls.push(request); return request.action === 'save' ? { data: { format: 'test-archive' } } : { count: 1 }; }
    };
    const app = vm.runInNewContext(`({${methods}})`, {
        window: { api, i18nHelper: { t: (key, params) => key + (params?.reason ? ':' + params.reason : '') } },
        Timeline, VideoPlayer: { getTimelineTime: () => 4, getDuration: () => 20, seekToTimelineTime() {} },
        Accessibility: { announce: text => announcements.push(text) },
        Selection: { hasSelection: () => false, clear() {} },
        InsertionQueue: { getItems: () => [], restore() {} },
        Transitions: { getAll: () => [], restore() {} },
        Markers: { getAll: () => [], restore() {} },
        Dialogs: { updateAppliedTransitionList() {}, showAccessibleConfirm: async () => false },
        document: { dispatchEvent() {} }, Event: class {}, console
    });
    Object.assign(app, { currentFilePath: 'old/movie.mp4', verticalClipQueue: [],
        getVerticalClipQueueSnapshot: () => [], t: key => key,
        openFile: async file => { app.currentFilePath = file; } });
    return { app, api, calls, announcements, saved, Timeline };
}

test('Save Project embeds the archive and does not silently save when archive preparation fails', async () => {
    const h = harness();
    await h.app.saveProject();
    assert.equal(h.saved[0].speechAnalysis.format, 'test-archive');
    assert.equal(h.saved[0].version, '1.4');
    assert.deepEqual(Array.from(h.calls[0].sources), ['old/movie.mp4']);
    h.api.speechSearchProject = async () => ({ error: 'busy' });
    await h.app.saveProject();
    assert.equal(h.saved.length, 1);
});

test('project relocation remaps timeline and restores embedded speech analysis automatically', async () => {
    const h = harness({ videoPath: 'old/movie.mp4', timeline: { sourceFile: 'old/movie.mp4', sourceDuration: 20,
        segments: [{ start: 2, end: 8, sourceFile: 'old/movie.mp4' }] }, speechAnalysis: { format: 'test-archive' } });
    await h.app.loadProjectFromPath('/share/project.kve');
    assert.equal(h.Timeline.sourceFile, '/share/movie.mp4');
    assert.equal(h.Timeline.segments[0].sourceFile, '/share/movie.mp4');
    assert.equal(h.calls[0].mappings[0].to, '/share/movie.mp4');
    assert.equal(h.announcements.at(-1), 'speech_search.project.loaded');
});

test('old projects still open and invalid embedded analysis warns without blocking editing', async () => {
    for (const embedded of [false, true]) {
        const h = harness({ videoPath: 'old/movie.mp4', ...(embedded ? { speechAnalysis: { bad: true } } : {}) });
        h.api.speechSearchProject = async () => ({ error: 'mismatch' });
        await h.app.loadProjectFromPath('/share/project.kve');
        assert.equal(h.app.currentFilePath, '/share/movie.mp4');
        assert.equal(h.announcements.at(-1), embedded
            ? 'speech_search.project.restore_warning:speech_search.archive.errors.mismatch' : 'runtime.app.project_loaded');
    }
});
