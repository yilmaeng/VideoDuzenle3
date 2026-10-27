(function(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.AutomaticSubtitlesCore = api;
})(typeof window === 'undefined' ? null : window, () => {
    'use strict';
    const timestamp = seconds => {
        const ms = Math.max(0, Math.round(seconds * 1000));
        return `${String(Math.floor(ms / 3600000)).padStart(2,'0')}:${String(Math.floor(ms / 60000) % 60).padStart(2,'0')}:${String(Math.floor(ms / 1000) % 60).padStart(2,'0')},${String(ms % 1000).padStart(3,'0')}`;
    };
    function cues(transcript) {
        const valid = item => item && Number.isFinite(item.start) && Number.isFinite(item.end)
            && item.start >= 0 && item.end > item.start && typeof item.text === 'string' && item.text.trim();
        const words = (transcript.words || []).filter(valid);
        const items = (words.length ? words : (transcript.segments || []).filter(valid)).slice().sort((a,b) => a.start-b.start);
        const result = [];
        let cue = null;
        for (const item of items) {
            const text = item.text.replace(/\s+/g, ' ').trim();
            if (cue && (item.start - cue.end > 0.8 || item.end - cue.start > 6 || cue.text.length + text.length > 80)) {
                result.push(cue); cue = null;
            }
            if (!cue) cue = { start: item.start, end: item.end, text };
            else { cue.text += ` ${text}`; cue.end = Math.max(cue.end, item.end); }
            if (!words.length || /[.!?…]$/.test(text)) { result.push(cue); cue = null; }
        }
        if (cue) result.push(cue);
        return result.map((item, index) => ({ ...item, end: Math.min(item.end, result[index+1]?.start ?? Infinity) }))
            .filter(item => Math.round(item.end * 1000) > Math.round(item.start * 1000));
    }
    return { cues, toSrt: transcript => cues(transcript).map((cue,i) => `${i+1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}\n`).join('\n') };
});
