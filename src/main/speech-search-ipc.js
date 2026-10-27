'use strict';

// Each analysis belongs to its requesting window. Closing/reloading that window
// stops work, and a different window cannot cancel or receive its transcript.
function registerSpeechSearchIpc({ ipcMain, service, dialogs }) {
    const jobs = new Map();
    let transferring = false;
    const validateSources = sources => {
        if (!Array.isArray(sources) || !sources.length || sources.length > 1000
            || sources.some(source => typeof source !== 'string' || !source || source.includes('\0'))) {
            throw new Error('speech_search_invalid_request');
        }
        return [...new Set(sources)];
    };
    const validateModel = (params) => {
        const model = params?.model === undefined ? 'Xenova/whisper-small' : params.model;
        if (!['Xenova/whisper-base', 'Xenova/whisper-small'].includes(model)) {
            throw new Error('speech_search_invalid_request');
        }
        return model;
    };
    const trusted = event => {
        if (!event.sender || event.sender.isDestroyed()
            || (event.senderFrame && event.senderFrame !== event.sender.mainFrame)) {
            throw new Error('speech_search_invalid_sender');
        }
    };
    ipcMain.handle('speech-search-inspect', (event, params = {}) => {
        trusted(event);
        return service.inspect({ model: validateModel(params) });
    });
    ipcMain.handle('speech-search-cached', (event, params = {}) => {
        trusted(event);
        return service.readCached({ sources: validateSources(params.sources), allowPartial: true,
            ...(params.model === undefined ? {} : { model: validateModel(params) }) });
    });
    // Project save/open owns these actions; they intentionally have no separate shortcuts.
    ipcMain.handle('speech-search-project', async (event, params = {}) => {
        trusted(event);
        if (transferring || jobs.size) return { error: 'busy' };
        transferring = true;
        try {
            const archive = require('./speech-search-archive');
            if (params.action === 'save') {
                return { data: await archive.createProjectAnalysis(service, validateSources(params.sources)) };
            }
            if (params.action !== 'restore' || !Array.isArray(params.mappings) || params.mappings.length > 1000
                || params.mappings.some(item => !item || typeof item.from !== 'string' || typeof item.to !== 'string')) {
                throw new Error('speech_archive_invalid');
            }
            const result = await archive.restoreProjectAnalysis(service, params.data, params.mappings);
            return { count: result.transcripts.length };
        } catch (error) {
            console.error('Project speech analysis:', error);
            const code = String(error.message).replace('speech_archive_', '');
            return { error: ['invalid', 'mismatch', 'changed'].includes(code) ? code : 'failed' };
        } finally { transferring = false; }
    });
    for (const action of ['export', 'import']) {
        ipcMain.handle(`speech-search-${action}`, async (event, params = {}) => {
            trusted(event);
            const sources = validateSources(params.sources);
            if (transferring || jobs.size) return { error: 'busy' };
            transferring = true;
            try {
                const archive = require('./speech-search-archive');
                if (action === 'export' && !service.readCached({ sources })) return { error: 'missing' };
                const file = await dialogs.choose(event, action, sources[0]);
                if (!file || event.sender.isDestroyed()) return { cancelled: true };
                await dialogs.announce(event, 'checking_file');
                if (action === 'export') {
                    const text = await archive.createArchive(service, sources);
                    await archive.writeArchive(file, text, sources);
                    return { path: file };
                }
                return await archive.importArchive(service, file, sources);
            } catch (error) {
                console.error('Speech analysis archive:', error);
                const code = String(error.message).replace('speech_archive_', '');
                return { error: ['invalid', 'missing', 'mismatch', 'changed'].includes(code) ? code : 'failed' };
            } finally { transferring = false; }
        });
    }
    ipcMain.handle('speech-search-cancel', (event, jobId) => {
        trusted(event);
        const job = jobs.get(event.sender.id);
        if (!job || job.jobId !== jobId) return false;
        job.controller.abort();
        return true;
    });
    ipcMain.handle('speech-search-analyze', async (event, params = {}) => {
        trusted(event);
        const model = validateModel(params);
        const { jobId, sources } = params || {};
        if (params.mode !== undefined && params.mode !== 'fillers') throw new Error('speech_search_invalid_request');
        if (typeof jobId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(jobId)
            || !Array.isArray(sources) || !sources.length || sources.length > 1000
            || sources.some(source => typeof source !== 'string' || !source || source.includes('\0'))) {
            throw new Error('speech_search_invalid_request');
        }
        // A single worker avoids parallel model downloads and exhausting memory
        // when several EVD windows request speech analysis at the same time.
        if (jobs.size || transferring) throw new Error('speech_search_busy');
        const sender = event.sender;
        const controller = new AbortController();
        const job = { jobId, controller };
        const cancel = () => controller.abort();
        jobs.set(sender.id, job);
        sender.once('destroyed', cancel);
        sender.once('render-process-gone', cancel);
        sender.once('did-start-loading', cancel);
        try {
            return await service.analyze({
                model,
                ...(params.mode === 'fillers' ? {mode:'fillers', language:'tr'} : {}),
                sources: [...new Set(sources)],
                signal: controller.signal,
                onProgress: progress => {
                    if (!controller.signal.aborted && !sender.isDestroyed()) {
                        sender.send('speech-search-progress', { ...progress, jobId });
                    }
                }
            });
        } finally {
            sender.removeListener('destroyed', cancel);
            sender.removeListener('render-process-gone', cancel);
            sender.removeListener('did-start-loading', cancel);
            if (jobs.get(sender.id) === job) jobs.delete(sender.id);
        }
    });
}

module.exports = { registerSpeechSearchIpc };
