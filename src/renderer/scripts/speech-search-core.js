(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.SpeechSearchCore = api;
}(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    // Pure data API: keyboard commands and localized UI belong to the caller.
    const EPSILON = 1e-9;
    const MAX_FUZZY_CHARACTERS = 256;
    const MAX_SUFFIX_STEM = 64;
    const MAX_SUFFIX_LENGTH = 10;
    // A bounded subset of noun inflection, not arbitrary startsWith/stemming:
    // plural + possessive + case. Derivations (e.g. cay -> caylak) are excluded.
    const INFLECTION = /^(?:lar|ler)?(?:[iu\u00fc]m[iu\u00fc]z|[iu\u00fc]n[iu\u00fc]z|[iu\u00fc]m|[iu\u00fc]n|s[iu\u00fc]|[mn]|miz|muz|m\u00fcz|niz|nuz|n\u00fcz)?(?:[yn]?[ae]|[yn]?[iu\u00fc]|n?[iu\u00fc]n|[dt][ae]n?|n[dt][ae]n?|y?l[ae])?$/;
    const SOFT_FINALS = { k: '\u011f', p: 'b', t: 'd', '\u00e7': 'c' };

    function suffixMatch(stem, candidate) {
        const extra = candidate.length - stem.length;
        if (stem.length < 2 || stem.length > MAX_SUFFIX_STEM
            || extra < 1 || extra > MAX_SUFFIX_LENGTH
            || !/^[a-z\u00e7\u011f\u00f6\u015f\u00fc]+$/.test(stem)) return false;
        const suffix = candidate.slice(stem.length);
        if (!INFLECTION.test(suffix)) return false;
        if (candidate.startsWith(stem)) return true;
        // Avoid guessing softened monosyllables; only vowel-initial suffixes
        // can license final-consonant softening in this conservative subset.
        return stem.length >= 4 && (stem.match(/[aeiou\u00f6\u00fc]/g) || []).length >= 2
            && /^[aeiu\u00fc]/.test(suffix)
            && candidate.slice(0, stem.length - 1) === stem.slice(0, -1)
            && candidate[stem.length - 1] === SOFT_FINALS[stem.slice(-1)];
    }

    function tokenize(text) {
        if (typeof text !== 'string') return [];
        const matches = text.normalize('NFC').match(/[\p{L}\p{M}\p{N}]+(?:['\u2019][\p{L}\p{M}\p{N}]+)*/gu) || [];
        return matches.map(raw => ({
            text: raw,
            // Forgiving search intentionally treats Turkish dotted/dotless I
            // alike, including English capital I. Display text stays unchanged.
            normalized: raw.toLocaleLowerCase('tr-TR').replace(/\u0131/g, 'i').replace(/['\u2019]/g, '')
        }));
    }

    function validRange(item) {
        return item && Number.isFinite(item.start) && Number.isFinite(item.end)
            && item.start >= 0 && item.end > item.start;
    }

    function transcriptTokens(transcript) {
        const words = Array.isArray(transcript.words) ? transcript.words : [];
        const hasWords = words.some(word => validRange(word) && tokenize(word.text).length);
        const items = hasWords ? words : (Array.isArray(transcript.segments) ? transcript.segments : []);
        const tokens = [];
        let block = 0;
        for (const item of items) {
            if (!validRange(item) || typeof item.text !== 'string') {
                block++;
                continue;
            }
            // Keep segment-level bounds rather than inventing word timestamps.
            // Adjacent ASR segments still form one searchable token stream.
            for (const token of tokenize(item.text)) {
                tokens.push({ ...token, start: item.start, end: item.end, block, approximate: !hasWords });
            }
        }
        return tokens;
    }

    function timelineRuns(segments, sourceFile) {
        const runs = [];
        let elapsed = 0;
        let run = null;
        for (const segment of segments) {
            const speed = segment && (segment.speed || 1);
            if (!validRange(segment) || !Number.isFinite(speed) || speed <= 0) {
                run = null;
                continue;
            }
            const sourcePath = segment.sourceFile || sourceFile;
            const duration = (segment.end - segment.start) / speed;
            if (!Number.isFinite(duration)) {
                run = null;
                continue;
            }
            // Unlike Timeline's visual merge tolerance, only rounding noise is
            // accepted here: even a small deleted gap must break a phrase.
            if (!run || run.sourcePath !== sourcePath || Math.abs(run.end - segment.start) > EPSILON) {
                run = { sourcePath, start: segment.start, end: segment.end, parts: [] };
                runs.push(run);
            }
            run.parts.push({ start: segment.start, end: segment.end, speed, elapsed });
            run.end = segment.end;
            elapsed += duration;
        }
        return runs;
    }

    function mapTime(run, time, isEnd) {
        const parts = run.parts;
        let low = 0;
        let high = parts.length - 1;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (parts[middle].end < time - EPSILON
                || (isEnd && parts[middle + 1].start <= time + EPSILON)) low = middle + 1;
            else high = middle;
        }
        const part = parts[low];
        return part.elapsed + (Math.max(part.start, Math.min(time, part.end)) - part.start) / part.speed;
    }

    function lowerBound(index, time) {
        let low = 0;
        let high = index.length;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (index[middle].start < time) low = middle + 1;
            else high = middle;
        }
        return low;
    }

    // Banded Levenshtein: at most two edits, no unbounded fuzzy scan/regex.
    function distance(a, b, limit) {
        if (a === b) return 0;
        if (Math.abs(a.length - b.length) > limit) return limit + 1;
        let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
        for (let i = 1; i <= a.length; i++) {
            const current = new Array(b.length + 1).fill(limit + 1);
            current[0] = i;
            let minimum = current[0];
            for (let j = Math.max(1, i - limit); j <= Math.min(b.length, i + limit); j++) {
                current[j] = Math.min(previous[j] + 1, current[j - 1] + 1,
                    previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
                minimum = Math.min(minimum, current[j]);
            }
            if (minimum > limit) return limit + 1;
            previous = current;
        }
        return previous[b.length];
    }

    /**
     * Search transcript tokens on the edited Timeline EDL, without mutation.
     * Times are seconds. EDL entries use source start/end, sourceFile and speed.
     * Empty/missing EDL means no results, never an implicit unedited timeline.
     * Words take precedence over ASR segments; segment-only bounds are coarse.
     * approximate means suffixed/fuzzy text OR segment-level timing.
     * Whole tokens only; partially deleted words/ASR segments are not returned.
     * Exact > recognized suffix > fuzzy, then edit distance and edited time.
     * Suffix matching is directional (query stem to inflected transcript word),
     * bounded to 64 stem/10 suffix characters and never consumes extra tokens.
     * Dotted/dotless I are equivalent for search, including short Turkish words.
     * Results are not capped; callers should cap/virtualize rendered rows.
     * Fuzzy matching keeps token count, permits <=2 total character edits (15%
     * of query letters), and is disabled for <7 or >256 query characters.
     * @returns {Array<{text:string,start:number,end:number,sourcePath:string,
     * sourceStart:number,approximate:boolean}>}
     */
    function search({ transcripts = [], segments = [], sourceFile, query } = {}) {
        const queryTokens = tokenize(query).map(token => token.normalized);
        if (!queryTokens.length || !Array.isArray(transcripts) || !Array.isArray(segments)) return [];
        const length = queryTokens.reduce((total, token) => total + token.length, 0);
        const budget = length <= MAX_FUZZY_CHARACTERS ? Math.min(2, Math.floor(length * 0.15)) : 0;
        const runs = timelineRuns(segments, sourceFile);
        const results = [];
        for (const transcript of transcripts) {
            if (!transcript || typeof transcript.sourcePath !== 'string' || !transcript.sourcePath) continue;
            const tokens = transcriptTokens(transcript);
            // Index candidate starts once rather than scanning the entire
            // transcript for every cut. Keep original indices for phrase order.
            const index = tokens.map((token, position) => ({ start: token.start, position }))
                .sort((a, b) => a.start - b.start || a.position - b.position);
            for (const run of runs) {
                if (run.sourcePath !== transcript.sourcePath) continue;
                for (let cursor = lowerBound(index, run.start - EPSILON);
                    cursor < index.length && index[cursor].start < run.end; cursor++) {
                    const i = index[cursor].position;
                    if (i + queryTokens.length > tokens.length) continue;
                    let score = 0;
                    let rank = 0;
                    let end = -Infinity;
                    let approximate = false;
                    const first = tokens[i];
                    if (first.start < run.start - EPSILON || first.end > run.end + EPSILON) continue;
                    const matched = [];
                    for (let j = 0; j < queryTokens.length; j++) {
                        const token = tokens[i + j];
                        if (token.block !== first.block || (j > 0 && token.start < tokens[i + j - 1].start)
                            || token.start < run.start - EPSILON || token.end > run.end + EPSILON) {
                            score = budget + 1;
                            break;
                        }
                        const target = queryTokens[j];
                        if (target !== token.normalized) {
                            if (suffixMatch(target, token.normalized)) {
                                rank = Math.max(rank, 1);
                            } else {
                                // Short words allow recognized suffixes, never fuzzy edits.
                                if (target.length < 4 || token.normalized.length < 4) {
                                    score = budget + 1;
                                    break;
                                }
                                rank = 2;
                                score += distance(target, token.normalized, budget - score);
                            }
                        }
                        if (score > budget) break;
                        matched.push(token.text);
                        approximate = approximate || token.approximate;
                        end = Math.max(end, token.end);
                    }
                    if (score > budget) continue;
                    results.push({ rank, score, result: {
                        text: matched.join(' '),
                        start: mapTime(run, first.start, false),
                        end: mapTime(run, end, true),
                        sourcePath: run.sourcePath,
                        sourceStart: first.start,
                        approximate: approximate || rank > 0
                    } });
                }
            }
        }
        results.sort((a, b) => a.rank - b.rank || a.score - b.score
            || a.result.start - b.result.start || a.result.end - b.result.end);
        return results.map(entry => entry.result);
    }

    return { search };
}));
