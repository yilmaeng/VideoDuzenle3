const { parentPort, workerData } = require('worker_threads');
const { analyzeHumanNarration } = require('./description-human-narration');

analyzeHumanNarration({
    ...(workerData || {}),
    onProgress: payload => parentPort.postMessage({ type: 'progress', payload })
}).then(result => {
    parentPort.postMessage({ type: 'result', payload: result });
}).catch(error => {
    parentPort.postMessage({
        type: 'error',
        message: error?.message || String(error),
        stack: error?.stack || ''
    });
});