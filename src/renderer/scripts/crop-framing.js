/* Shared, deterministic framing calculations. AI supplies estimates, not crops. */
(() => {
    'use strict';
    function parseResponse(text) {
        if (typeof text !== 'string' || text.length > 100000) throw new Error('ai');
        try { return JSON.parse(text.trim()); } catch (_) { /* Allow explanatory wrappers, not repaired JSON. */ }
        const objects = [];
        let start = -1, depth = 0, quoted = false, escaped = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (start < 0) { if (ch === '{') { start = i; depth = 1; } continue; }
            if (quoted) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') quoted = false;
                continue;
            }
            if (ch === '"') quoted = true;
            else if (ch === '{') depth++;
            else if (ch === '}' && --depth === 0) {
                objects.push(JSON.parse(text.slice(start, i + 1)));
                start = -1;
            }
        }
        if (start >= 0 || objects.length !== 1) throw new Error('ai');
        return objects[0];
    }
    function validate(data, count) {
        if (!data || typeof data.internalGap !== 'boolean'
            || typeof data.reason !== 'string' || !data.reason.trim() || data.reason.length > 2000
            || !Array.isArray(data.frames) || data.frames.length !== count) throw new Error('ai');
        const rectangle = rect => {
            if (!rect || !['left', 'top', 'right', 'bottom'].every(k => typeof rect[k] === 'number'
                && Number.isFinite(rect[k]) && rect[k] >= 0 && rect[k] <= 1000)
                || rect.left >= rect.right || rect.top >= rect.bottom) throw new Error('ai');
            return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        };
        const confidence = value => {
            if (!value || !['left','right','top','bottom'].every(k => ['high','medium','low'].includes(value[k]))) throw new Error('ai');
            return { left: value.left, right: value.right, top: value.top, bottom: value.bottom };
        };
        return { confidence: confidence(data.confidence), handsConfidence: confidence(data.handsConfidence), internalGap: data.internalGap, reason: data.reason.trim(),
            frames: data.frames.map(frame => ({ content: rectangle(frame.content), hands: rectangle(frame.hands) })) };
    }
    function calculate(data, width, height, tightness, protectHands) {
        if (![width, height].every(n => Number.isSafeInteger(n) && n >= 16 && n % 2 === 0)
            || !['careful', 'balanced', 'tight'].includes(tightness)) throw new Error('ai');
        const rects = data.frames.flatMap(frame => protectHands ? [frame.content, frame.hands] : [frame.content]);
        const bounds = { left: Math.min(...rects.map(r => r.left)), top: Math.min(...rects.map(r => r.top)),
            right: Math.max(...rects.map(r => r.right)), bottom: Math.max(...rects.map(r => r.bottom)) };
        const gaps = { left: bounds.left * width / 1000, right: (1000 - bounds.right) * width / 1000,
            top: bounds.top * height / 1000, bottom: (1000 - bounds.bottom) * height / 1000 };
        // Confidence is independent per edge. Uncertain hands below the subject
        // must not invalidate a clearly observed upper boundary.
        const levels = ['low', 'medium', 'high'];
        const confidence = {};
        const crop = Object.fromEntries(Object.entries(gaps).map(([edge, gap]) => {
            confidence[edge] = protectHands
                ? levels[Math.min(levels.indexOf(data.confidence[edge]), levels.indexOf(data.handsConfidence[edge]))]
                : data.confidence[edge];
            const dimension = ['left', 'right'].includes(edge) ? width : height;
            // Retain a framing margin around the union of all sampled subjects.
            // Do not also retain a percentage of the empty area: that compounds
            // caution and makes large backgrounds dominate even in tight mode.
            const marginRatio = (edge === 'top'
                ? { careful: 0.08, balanced: 0.05, tight: 0.03 }
                : { careful: 0.06, balanced: 0.04, tight: 0.02 })[tightness];
            const margin = Math.max(4, dimension * (marginRatio + (confidence[edge] === 'medium' ? 0.04 : 0)));
            const removable = confidence[edge] === 'low' ? 0 : gap - margin;
            return [edge, Math.max(0, Math.floor(removable / 2) * 2)];
        }));
        if (width - crop.left - crop.right < 16 || height - crop.top - crop.bottom < 16) throw new Error('ai');
        return { crop, gaps, bounds, confidence };
    }
    const api = { parseResponse, validate, calculate };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else window.CropFraming = api;
})();
