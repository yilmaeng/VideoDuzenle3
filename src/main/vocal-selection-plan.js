'use strict';
const path = require('path');
function planSelections(rows, source, duration, rate) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 1000) throw new Error('selections');
    const total = Math.round(duration * rate);
    const identity = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    const sorted = rows.map(row => {
        if (typeof row?.sourcePath !== 'string' || identity(row.sourcePath) !== identity(source)
            || typeof row.startTime !== 'number' || typeof row.endTime !== 'number'
            || !Number.isFinite(row.startTime) || !Number.isFinite(row.endTime)
            || row.startTime < 0 || row.endTime > duration + 1 / rate || row.endTime <= row.startTime) throw new Error('selections');
        const start = Math.round(row.startTime * rate), end = Math.min(total, Math.round(row.endTime * rate));
        if (end <= start) throw new Error('selections');
        return { start, end };
    }).sort((a,b) => a.start-b.start);
    const merged = [];
    for (const row of sorted) {
        const last = merged.at(-1);
        if (last && row.start <= last.end) last.end = Math.max(last.end, row.end);
        else merged.push({ ...row });
    }
    return merged.map(row => ({ ...row, contextStart: Math.max(0, row.start-rate), contextEnd: Math.min(total, row.end+rate) }));
}
function buildReplacementTimeline(plan, original, stems, duration, rate) {
    let cursor = 0;
    const segments = [], total = Math.round(duration * rate);
    const add = (sourceFile, start, end) => { if (end > start) segments.push({ sourceFile, start: start/rate, end: end/rate, speed: 1, audioVolume: 100 }); };
    plan.forEach((row,index) => {
        add(original, cursor, row.start);
        add(stems[index], row.start-row.contextStart, row.end-row.contextStart);
        cursor = row.end;
    });
    add(original, cursor, total);
    return segments;
}
module.exports = { planSelections, buildReplacementTimeline };
