const { AsyncLocalStorage } = require('async_hooks');

const jobContext = new AsyncLocalStorage();
const jobs = new Map();

function createCancelledError() {
    const error = new Error('export_cancelled');
    error.code = 'EXPORT_CANCELLED';
    return error;
}

function getCurrentJobId() {
    return jobContext.getStore()?.jobId || '';
}

function ensureJob(jobId) {
    if (!jobId) return null;
    if (!jobs.has(jobId)) jobs.set(jobId, { processes: new Set(), cancelHandlers: new Set(), cancelled: false });
    return jobs.get(jobId);
}

async function runWithExportJob(jobId, callback) {
    if (!jobId) return callback();
    const job = ensureJob(jobId);
    try {
        const result = await jobContext.run({ jobId }, callback);
        if (job.cancelled) throw createCancelledError();
        return result;
    } finally {
        jobs.delete(jobId);
    }
}

function registerExportProcess(child) {
    const jobId = getCurrentJobId();
    if (!jobId) return () => {};
    const job = ensureJob(jobId);
    if (job.cancelled) {
        try { child.kill(); } catch (_error) {}
        throw createCancelledError();
    }
    job.processes.add(child);
    return () => job.processes.delete(child);
}

function isCurrentExportCancelled() {
    const jobId = getCurrentJobId();
    return Boolean(jobId && jobs.get(jobId)?.cancelled);
}

function registerExportCancellationHandler(handler) {
    const jobId = getCurrentJobId();
    if (!jobId || typeof handler !== 'function') return () => {};
    const job = ensureJob(jobId);
    if (job.cancelled) {
        handler();
        throw createCancelledError();
    }
    job.cancelHandlers.add(handler);
    return () => job.cancelHandlers.delete(handler);
}

function cancelExportJob(jobId) {
    const job = jobs.get(String(jobId || ''));
    if (!job) return false;
    job.cancelled = true;
    for (const child of job.processes) {
        try { child.kill(); } catch (_error) {}
    }
    for (const handler of job.cancelHandlers) {
        try { handler(); } catch (_error) {}
    }
    return true;
}

module.exports = {
    cancelExportJob,
    createCancelledError,
    getCurrentJobId,
    isCurrentExportCancelled,
    registerExportCancellationHandler,
    registerExportProcess,
    runWithExportJob
};
