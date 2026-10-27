(() => {
'use strict';

async function prepareSegment({ start, end, videoPath, segments = [], extractFrame, context }) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
        throw new RangeError('Invalid description range');
    }
    const count = Math.min(20, Math.max(1, Math.ceil((end - start) / 2)));
    const images = [], times = [];
    for (let index = 0; index < count; index++) {
        const time = start + (end - start) * index / count;
        let sourceTime = time, sourceFile = videoPath, elapsed = 0;
        for (const segment of segments) {
            const speed = segment.speed || 1;
            const duration = (segment.end - segment.start) / speed;
            if (time < elapsed + duration) {
                sourceTime = segment.start + (time - elapsed) * speed;
                sourceFile = segment.sourceFile || videoPath;
                break;
            }
            elapsed += duration;
        }
        images.push(await extractFrame({ videoPath: sourceFile, time: sourceTime }));
        times.push(time.toFixed(3));
    }
    return { imageBase64: images, context: `${context}\n${times.join(', ')}` };
}

function parseLayerSuggestion(text, resolution) {
    const value = JSON.parse(text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''));
    for (const key of ['x', 'y', 'width', 'height']) {
        if (!Number.isFinite(value[key])) throw new Error('Invalid layout coordinates');
        value[key] = Math.round(value[key]);
    }
    if (value.x < 0 || value.y < 0 || value.width < 1 || value.height < 1 ||
        value.x + value.width > resolution.width || value.y + value.height > resolution.height ||
        typeof value.position !== 'string' || typeof value.reason !== 'string') {
        throw new Error('Invalid layout bounds');
    }
    return value;
}

const api = { prepareSegment, parseLayerSuggestion };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.AiSegmentDescription = api;
})();
