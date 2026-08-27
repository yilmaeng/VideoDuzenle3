const { app } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const karaokeEngineManager = require('./karaoke-engine-manager');

function existingFile(candidates) {
    return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null;
}

function resolveAligner() {
    const installedRuntime = karaokeEngineManager.findInstalledRuntime();
    if (installedRuntime) return installedRuntime;
    const appPath = app && typeof app.getAppPath === 'function' ? app.getAppPath() : process.cwd();
    const pythonName = process.platform === 'win32' ? 'python.exe' : 'python3';
    const python = existingFile([
        process.env.EVD_KARAOKE_ALIGN_PYTHON,
        path.join(process.resourcesPath || '', 'karaoke-aligner', pythonName),
        path.join(process.resourcesPath || '', 'karaoke-aligner', 'bin', pythonName),
        path.join(appPath, 'temp', 'karaoke-align-venv', 'Scripts', pythonName),
        path.join(process.cwd(), 'temp', 'karaoke-align-venv', 'Scripts', pythonName),
        path.join(appPath, 'temp', 'karaoke-align-venv', 'bin', pythonName),
        path.join(process.cwd(), 'temp', 'karaoke-align-venv', 'bin', pythonName)
    ]);
    if (!python) return null;

    const pythonPath = existingFile([
        process.env.EVD_KARAOKE_ALIGN_PYTHONPATH,
        path.join(process.resourcesPath || '', 'karaoke-aligner'),
        path.join(appPath, 'temp', 'karaoke-align-packages'),
        path.join(process.cwd(), 'temp', 'karaoke-align-packages'),
        path.join(appPath, 'karaoke-align-packages')
    ]);
    if (!pythonPath) return null;
    return { python, pythonPath };
}

function isRuntimeAvailable() {
    return Boolean(resolveAligner());
}

function transcriptionCachePath(audioPath, language, model) {
    const stat = fs.statSync(audioPath);
    const fingerprint = crypto.createHash('sha256')
        .update([path.resolve(audioPath), stat.size, stat.mtimeMs, language, model].join('|'))
        .digest('hex');
    const appPath = app && typeof app.getAppPath === 'function' ? app.getAppPath() : process.cwd();
    const root = process.env.EVD_KARAOKE_TRANSCRIPTION_CACHE
        || (app?.isPackaged
            ? path.join(app.getPath('userData'), 'karaoke-transcription-cache')
            : path.join(appPath, 'temp', 'karaoke-transcription-cache'));
    fs.mkdirSync(root, { recursive: true });
    return path.join(root, `${fingerprint}.json`);
}

function runTranscriber(runtime, scriptPath, args, onProgress) {
    return new Promise((resolve, reject) => {
        const env = { ...process.env };
        env.PYTHONPATH = [runtime.pythonPath, env.PYTHONPATH].filter(Boolean).join(path.delimiter);
        const child = spawn(runtime.python, [scriptPath, ...args], { windowsHide: true, env });
        let output = '';
        const consume = chunk => {
            const text = String(chunk || '');
            output += text;
            const stages = [...text.matchAll(/EVD_STAGE:(separating|transcribing|aligning)/g)];
            if (stages.length) onProgress?.(stages.at(-1)[1]);
        };
        child.stdout.on('data', consume);
        child.stderr.on('data', consume);
        child.on('error', reject);
        child.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(`karaoke_forced_aligner_exit_${code}: ${output.slice(-2000)}`));
        });
    });
}

function parseLyrics(value) {
    const stanzas = String(value || '').replace(/\r\n?/g, '\n').trim()
        .split(/\n\s*\n/)
        .map(block => block.split('\n').map(line => line.trim()).filter(Boolean))
        .filter(stanza => stanza.length);
    const lines = [];
    stanzas.forEach((stanza, stanzaIndex) => stanza.forEach((line, lineIndex) => {
        lines.push({
            line,
            stanzaEnd: lineIndex === stanza.length - 1,
            sourceIndex: lines.length,
            stanzaIndex
        });
    }));
    return lines;
}

function normalize(value, locale = 'tr-TR') {
    return String(value || '').toLocaleLowerCase(locale)
        .replaceAll('ç', 'c').replaceAll('ğ', 'g').replaceAll('ı', 'i')
        .replaceAll('ö', 'o').replaceAll('ş', 's').replaceAll('ü', 'u')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/(.)\1{2,}/g, '$1$1')
        .replace(/[^a-z0-9]/g, '');
}

function similarity(left, right, locale) {
    const a = normalize(left, locale);
    const b = normalize(right, locale);
    if (!a.length || !b.length) return 0;
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let row = 1; row <= a.length; row++) {
        const current = [row];
        for (let column = 1; column <= b.length; column++) {
            current[column] = Math.min(
                current[column - 1] + 1,
                previous[column] + 1,
                previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
            );
        }
        for (let column = 0; column < current.length; column++) previous[column] = current[column];
    }
    return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function isVocalization(value, locale) {
    const tokens = String(value || '').toLocaleLowerCase(locale)
        .replace(/[^a-zçğıöşüäöüßáéíóúñ\s]/gi, ' ')
        .split(/\s+/).filter(Boolean);
    if (!tokens.length) return false;
    return tokens.every(token => {
        const normalized = normalize(token, locale);
        return /^(?:a+h*|e+h*|o+h*|u+h*|i+h*|la+|na+|hey+|h[ıi]m+|m+|woo+|vay+)$/.test(normalized);
    });
}

function boundaryScore(words, endExclusive, strong) {
    if (endExclusive >= words.length) return 10;
    const previous = words[endExclusive - 1];
    const next = words[endExclusive];
    let score = 0;
    if (/[,.;:!?]\s*$/.test(previous.word)) score += 4;
    if (previous.segmentIndex !== next.segmentIndex) score += 4;
    score += Math.min(4, Math.max(0, next.start - previous.end) * 2.5);
    return score * (strong ? 1.7 : 1);
}

function partitionWords(lyrics, words, locale) {
    if (!lyrics.length || words.length < lyrics.length) return null;
    const lineCount = lyrics.length;
    const wordCount = words.length;
    const scores = Array.from({ length: lineCount + 1 }, () => Array(wordCount + 1).fill(-Infinity));
    const previousStarts = Array.from({ length: lineCount + 1 }, () => Array(wordCount + 1).fill(null));
    scores[0][0] = 0;

    for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
        const expectedCount = lyrics[lineIndex].line.split(/\s+/).filter(Boolean).length;
        const remainingLines = lineCount - lineIndex - 1;
        for (let previousEnd = 0; previousEnd < wordCount; previousEnd++) {
            if (!Number.isFinite(scores[lineIndex][previousEnd])) continue;
            const maximumSkip = Math.min(16, wordCount - previousEnd - remainingLines - 1);
            for (let skipped = 0; skipped <= maximumSkip; skipped++) {
                const start = previousEnd + skipped;
                const maximum = Math.min(Math.max(12, expectedCount + 6), wordCount - start - remainingLines);
                for (let length = 1; length <= maximum; length++) {
                    const end = start + length;
                    const spoken = words.slice(start, end).map(word => word.word).join(' ');
                    const textScore = similarity(lyrics[lineIndex].line, spoken, locale) * 7;
                    const countPenalty = Math.abs(length - expectedCount) * 0.3;
                    const boundary = boundaryScore(words, end, lyrics[lineIndex].stanzaEnd);
                    const skipPenalty = skipped * (lineIndex === 0 && previousEnd === 0 ? 0.05 : 1.2);
                    const score = scores[lineIndex][previousEnd] + textScore + boundary - countPenalty - skipPenalty;
                    if (score > scores[lineIndex + 1][end]) {
                        scores[lineIndex + 1][end] = score;
                        previousStarts[lineIndex + 1][end] = { previousEnd, start };
                    }
                }
            }
        }
    }

    let cursor = 0;
    let bestScore = -Infinity;
    for (let end = lineCount; end <= wordCount; end++) {
        const trailingPenalty = (wordCount - end) * 0.1;
        const score = scores[lineCount][end] - trailingPenalty;
        if (score > bestScore) { bestScore = score; cursor = end; }
    }
    const groups = [];
    for (let lineIndex = lineCount; lineIndex > 0; lineIndex--) {
        const step = previousStarts[lineIndex][cursor];
        if (!step) return null;
        groups.unshift(words.slice(step.start, cursor));
        cursor = step.previousEnd;
    }
    return groups;
}

function exactWords(line, acousticWords) {
    const tokens = String(line || '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length || !acousticWords.length) return [];
    if (tokens.length === acousticWords.length) {
        return tokens.map((text, index) => ({ text, start: acousticWords[index].start, manual: false }));
    }
    const start = acousticWords[0].start;
    const end = acousticWords.at(-1).end;
    const weights = tokens.map(token => Math.max(1, Array.from(token).length));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = start;
    return tokens.map((text, index) => {
        const word = { text, start: cursor, manual: false };
        cursor += (end - start) * weights[index] / total;
        return word;
    });
}

function findActiveRanges(energy, start, end, desiredCount) {
    const frameDuration = Number(energy?.frameDuration);
    const values = Array.isArray(energy?.values) ? energy.values : [];
    if (!Number.isFinite(frameDuration) || !values.length || end <= start) return [];
    const from = Math.max(0, Math.floor(start / frameDuration));
    const to = Math.min(values.length, Math.ceil(end / frameDuration));
    const sample = values.slice(from, to).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sample.length) return [];
    const low = sample[Math.floor(sample.length * 0.2)];
    const high = sample[Math.floor(sample.length * 0.85)];
    const adaptive = Math.max(-45, Math.min(-25, low + Math.max(6, (high - low) * 0.45)));
    const candidates = [...new Set([adaptive, -45, -42, -40, -38, -35, -33, -30, -28, -25])]
        .sort((left, right) => Math.abs(left + 35) - Math.abs(right + 35));
    const rangesForThreshold = threshold => {
        const ranges = [];
        let activeStart = null;
        for (let index = from; index <= to; index++) {
            const active = index < to && values[index] > threshold;
            if (active && activeStart === null) activeStart = index;
            if (!active && activeStart !== null) {
                const rangeStart = Math.max(start, activeStart * frameDuration);
                const rangeEnd = Math.min(end, index * frameDuration);
                if (rangeEnd - rangeStart >= 0.15) ranges.push({ start: rangeStart, end: rangeEnd });
                activeStart = null;
            }
        }
        const merged = [];
        ranges.forEach(range => {
            const previous = merged.at(-1);
            if (previous && range.start - previous.end < 0.25) previous.end = range.end;
            else merged.push({ ...range });
        });
        return merged;
    };
    const exact = candidates.map(rangesForThreshold).find(ranges =>
        ranges.length === desiredCount && ranges.every(range => range.end - range.start >= 0.35)
    );
    if (exact) return exact;
    const merged = rangesForThreshold(adaptive);
    if (!merged.length) return [];
    if (merged.length > desiredCount) {
        while (merged.length > desiredCount) {
            let bestIndex = 0;
            let bestGap = Infinity;
            for (let index = 0; index < merged.length - 1; index++) {
                const gap = merged[index + 1].start - merged[index].end;
                if (gap < bestGap) { bestGap = gap; bestIndex = index; }
            }
            merged.splice(bestIndex, 2, { start: merged[bestIndex].start, end: merged[bestIndex + 1].end });
        }
        return merged;
    }
    return [];
}

function divideRange(start, end, count) {
    const duration = end - start;
    if (count <= 0 || duration < count * 0.05) return [];
    return Array.from({ length: count }, (_, index) => ({
        start: start + duration * index / count,
        end: start + duration * (index + 1) / count
    }));
}

function assignVocalizations(allLyrics, alignedBySource, energy) {
    let index = 0;
    while (index < allLyrics.length) {
        if (!allLyrics[index].vocalization) { index++; continue; }
        const first = index;
        while (index < allLyrics.length && allLyrics[index].vocalization) index++;
        const count = index - first;
        const previous = [...alignedBySource.entries()].filter(([sourceIndex]) => sourceIndex < first).sort((a, b) => b[0] - a[0])[0]?.[1];
        const next = [...alignedBySource.entries()].filter(([sourceIndex]) => sourceIndex >= index).sort((a, b) => a[0] - b[0])[0]?.[1];
        const start = previous ? previous.end : 0;
        const end = next ? next.start : Math.max(start, (energy?.values?.length || 0) * Number(energy?.frameDuration || 0));
        const ranges = findActiveRanges(energy, start, end, count);
        const placements = ranges.length === count ? ranges : divideRange(start, end, count);
        placements.forEach((placement, offset) => {
            const lyric = allLyrics[first + offset];
            alignedBySource.set(lyric.sourceIndex, {
                line: lyric.line,
                start: placement.start,
                end: placement.end,
                score: ranges.length === count ? 0.75 : 0.45,
                matched: true,
                words: exactWords(lyric.line, [{ start: placement.start, end: placement.end }])
            });
        });
    }
}

function alignWordTimings(transcription, lyricsText, language) {
    const locale = language === 'tr' ? 'tr-TR' : language;
    const allLyrics = parseLyrics(lyricsText).map(lyric => ({
        ...lyric,
        vocalization: isVocalization(lyric.line, locale)
    }));
    const regularLyrics = allLyrics.filter(lyric => !lyric.vocalization);
    const words = [];
    (transcription.segments || []).forEach((segment, segmentIndex) => {
        (segment.words || []).forEach(word => {
            const start = Number(word.start);
            const end = Number(word.end);
            if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
                words.push({ start, end, word: String(word.word || ''), segmentIndex });
            }
        });
    });
    const groups = partitionWords(regularLyrics, words, locale);
    if (!groups) throw new Error('karaoke_forced_invalid_result');

    const alignedBySource = new Map();
    regularLyrics.forEach((lyric, index) => {
        const group = groups[index];
        const spoken = group.map(word => word.word).join(' ');
        const score = similarity(lyric.line, spoken, locale);
        alignedBySource.set(lyric.sourceIndex, {
            line: lyric.line,
            start: group[0].start,
            end: group.at(-1).end,
            score,
            matched: true,
            words: exactWords(lyric.line, group)
        });
    });
    assignVocalizations(allLyrics, alignedBySource, transcription.energy);
    return allLyrics.map(lyric => alignedBySource.get(lyric.sourceIndex) || {
        line: lyric.line, start: null, end: null, score: 0, matched: false
    });
}

function alignmentQuality(lines, language) {
    const locale = language === 'tr' ? 'tr-TR' : language;
    const regular = lines.filter(line => !isVocalization(line.line, locale) && line.matched);
    if (!regular.length) return 0;
    const scores = regular.map(line => Number(line.score) || 0);
    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const reliableRatio = scores.filter(score => score >= 0.55).length / scores.length;
    return average * 0.65 + reliableRatio * 0.35;
}

async function alignLyrics({ audioPath, lyrics, language = 'tr', onProgress } = {}) {
    if (!audioPath || !fs.existsSync(audioPath)) throw new Error('karaoke_forced_audio_missing');
    const normalizedLyrics = String(lyrics || '').replace(/\r\n?/g, '\n').trim();
    if (!normalizedLyrics) throw new Error('karaoke_forced_lyrics_required');
    const runtime = resolveAligner();
    if (!runtime) throw new Error('karaoke_forced_aligner_unavailable');

    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-karaoke-align-'));
    const outputPath = path.join(tempDirectory, 'transcription.json');
    const helperPath = path.join(tempDirectory, 'karaoke-word-transcriber.py');
    const packagedHelper = path.join(__dirname, 'karaoke-word-transcriber.py');
    fs.copyFileSync(packagedHelper, helperPath);
    try {
        onProgress?.('preparing');
        const model = 'medium';
        const selectedLanguage = String(language || 'tr');
        const loadTranscription = async sourceMode => {
            const cacheModel = sourceMode === 'separated' ? model : `${model}-original`;
            const cachePath = transcriptionCachePath(audioPath, selectedLanguage, cacheModel);
            if (fs.existsSync(cachePath)) return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            await runTranscriber(runtime, helperPath, [
                audioPath,
                outputPath,
                '--language', selectedLanguage,
                '--model', model,
                '--source-mode', sourceMode
            ], onProgress);
            fs.copyFileSync(outputPath, cachePath);
            return JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        };

        const separated = await loadTranscription('separated');
        let lines = alignWordTimings(separated, normalizedLyrics, selectedLanguage);
        let quality = alignmentQuality(lines, selectedLanguage);
        if (quality < 0.72) {
            onProgress?.('transcribing');
            const original = await loadTranscription('original');
            original.energy = separated.energy || original.energy;
            const originalLines = alignWordTimings(original, normalizedLyrics, selectedLanguage);
            const originalQuality = alignmentQuality(originalLines, selectedLanguage);
            if (originalQuality > quality) {
                lines = originalLines;
                quality = originalQuality;
            }
        }
        onProgress?.('finalizing');
        const matchedCount = lines.filter(line => line.matched && Number.isFinite(line.start) && Number.isFinite(line.end)).length;
        return { success: true, lines, matchedCount, unmatchedCount: lines.length - matchedCount };
    } finally {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
}

module.exports = { alignLyrics, resolveAligner, isRuntimeAvailable, alignWordTimings };
