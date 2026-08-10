const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Worker } = require('worker_threads');
const { ensureNativeWhisper, runWhisperChunk } = require('./description-whisper-native');

const transcriberCache = new Map();

function normalizeText(value) {
    return String(value || '')
        .toLocaleLowerCase('tr-TR')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9çğıöşü\s]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokens(value) {
    return normalizeText(value).split(' ').filter(Boolean);
}

function editSimilarity(left, right) {
    if (!left.length || !right.length) return 0;
    const previous = Array.from({ length: right.length + 1 }, (_item, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
        let diagonal = previous[0];
        previous[0] = i;
        for (let j = 1; j <= right.length; j += 1) {
            const above = previous[j];
            previous[j] = Math.min(
                previous[j] + 1,
                previous[j - 1] + 1,
                diagonal + (left[i - 1] === right[j - 1] ? 0 : 1)
            );
            diagonal = above;
        }
    }
    return Math.max(0, 1 - (previous[right.length] / Math.max(left.length, right.length)));
}

function textSimilarity(leftText, rightText) {
    const leftNormalized = normalizeText(leftText);
    const rightNormalized = normalizeText(rightText);
    const left = leftNormalized.split(' ').filter(Boolean);
    const right = rightNormalized.split(' ').filter(Boolean);
    if (!left.length || !right.length) return 0;
    const leftCounts = new Map();
    left.forEach(word => leftCounts.set(word, (leftCounts.get(word) || 0) + 1));
    let common = 0;
    right.forEach(word => {
        const count = leftCounts.get(word) || 0;
        if (count > 0) {
            common += 1;
            leftCounts.set(word, count - 1);
        }
    });
    const precision = common / right.length;
    const recall = common / left.length;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    const tokenOrder = editSimilarity(left, right);
    const characterOrder = editSimilarity([...leftNormalized], [...rightNormalized]);
    return (f1 * 0.45) + (tokenOrder * 0.2) + (characterOrder * 0.35);
}

function decodeAudio(ffmpegPath, sourcePath, onProgress) {
    return new Promise((resolve, reject) => {
        const child = spawn(ffmpegPath, [
            '-v', 'error', '-i', sourcePath, '-vn', '-ac', '1', '-ar', '16000',
            '-f', 'f32le', 'pipe:1'
        ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const chunks = [];
        const errors = [];
        child.stdout.on('data', chunk => chunks.push(chunk));
        child.stderr.on('data', chunk => errors.push(chunk));
        child.on('error', reject);
        child.on('close', code => {
            if (code !== 0) {
                reject(new Error(Buffer.concat(errors).toString('utf8').trim() || `ffmpeg_exited_${code}`));
                return;
            }
            const buffer = Buffer.concat(chunks);
            const view = new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4));
            onProgress?.({ stage: 'audio_ready', percent: 100 });
            resolve(Float32Array.from(view));
        });
    });
}

async function getTranscriber(model, cacheDir, onProgress) {
    if (!transcriberCache.has(model)) {
        transcriberCache.set(model, (async () => {
            const transformers = await import('@xenova/transformers');
            transformers.env.cacheDir = cacheDir;
            transformers.env.allowLocalModels = true;
            transformers.env.allowRemoteModels = true;
            return transformers.pipeline('automatic-speech-recognition', model, {
                progress_callback: progress => {
                    const percent = Number(progress?.progress);
                    onProgress?.({
                        stage: 'model',
                        percent: Number.isFinite(percent) ? Math.round(percent) : 0,
                        file: String(progress?.file || '')
                    });
                }
            });
        })());
    }
    return transcriberCache.get(model);
}

function wordsFromResult(result) {
    const chunks = Array.isArray(result?.chunks) ? result.chunks : [];
    return chunks.map((chunk, index) => {
        const timestamp = Array.isArray(chunk.timestamp) ? chunk.timestamp : [];
        const start = Number(timestamp[0]);
        const end = Number(timestamp[1]);
        return {
            index,
            text: String(chunk.text || '').trim(),
            start: Number.isFinite(start) ? Math.max(0, start) : 0,
            end: Number.isFinite(end) ? Math.max(Number.isFinite(start) ? start : 0, end) : (Number.isFinite(start) ? start + 0.3 : 0.3)
        };
    }).filter(word => word.text);
}

function buildUtterances(words) {
    const utterances = [];
    let current = [];
    const flush = () => {
        if (!current.length) return;
        utterances.push({
            start: current[0].start,
            end: current[current.length - 1].end,
            text: current.map(word => word.text).join(' ').replace(/\s+/g, ' ').trim()
        });
        current = [];
    };
    words.forEach(word => {
        const previous = current[current.length - 1];
        const gap = previous ? word.start - previous.end : 0;
        const durationBeforeWord = current.length ? previous.end - current[0].start : 0;
        if (current.length && (gap >= 0.9 || durationBeforeWord >= 22)) flush();
        current.push(word);
        const duration = word.end - current[0].start;
        if (/[.!?…]$/.test(word.text) && duration >= 1.2) flush();
    });
    flush();
    return utterances;
}

function classifyUtterances(utterances, descriptions, state = {}) {
    const candidates = [];
    const unmatched = [];
    const takeCounts = state.takeCounts || new Map();
    let cueCursor = Number(state.cueCursor) || 0;
    let sequence = Number(state.sequence) || 0;
    utterances.forEach(utterance => {
        sequence += 1;
        let best = null;
        descriptions.forEach((item, itemIndex) => {
            const score = textSimilarity(item.text, utterance.text);
            const orderPenalty = Math.max(0, Math.abs(itemIndex - cueCursor) - 1) * 0.018;
            const rankedScore = score - orderPenalty;
            if (!best || rankedScore > best.rankedScore) best = { item, itemIndex, score, rankedScore };
        });
        if (!best || best.score < 0.44) {
            unmatched.push({
                id: `unmatched-${sequence}`,
                start: utterance.start,
                end: utterance.end,
                transcript: utterance.text,
                reason: tokens(utterance.text).length < 2 ? 'non_speech' : 'no_text_match'
            });
            return;
        }
        cueCursor = Math.max(cueCursor, best.itemIndex);
        const cueTokens = tokens(best.item.text);
        const spokenTokens = tokens(utterance.text);
        const extraRatio = Math.max(0, spokenTokens.length - cueTokens.length) / Math.max(1, cueTokens.length);
        const spokenDuration = Math.max(0.05, utterance.end - utterance.start + 0.2);
        const availableDuration = Math.max(0, Number(best.item.end) - Number(best.item.start));
        const tooLongForSafeFit = availableDuration > 0 && spokenDuration > availableDuration * 1.35;
        const count = (takeCounts.get(best.item.id) || 0) + 1;
        takeCounts.set(best.item.id, count);
        candidates.push({
            id: `candidate-${sequence}`,
            eventId: best.item.id,
            takeNumber: count,
            sourceStart: Math.max(0, utterance.start - 0.08),
            sourceEnd: utterance.end + 0.12,
            transcript: utterance.text,
            score: Number(best.score.toFixed(4)),
            needsReview: best.score < 0.7 || extraRatio > 0.35 || tooLongForSafeFit,
            audioPath: '',
            duration: spokenDuration,
            recommended: false
        });
    });
    state.takeCounts = takeCounts;
    state.cueCursor = cueCursor;
    state.sequence = sequence;
    return { candidates, unmatched };
}

function timedWordsText(words) {
    return words.map(word => word.text).join(' ')
        .replace(/\s+([.,!?;:])/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

function classifyTimedWords(newWords, descriptions, state = {}, isFinal = false) {
    const combined = [...(state.pendingWords || []), ...(newWords || [])]
        .filter(word => word?.text && Number.isFinite(Number(word.start)) && Number.isFinite(Number(word.end)))
        .sort((left, right) => left.start - right.start);
    const candidates = [];
    const unmatched = [];
    const takeCounts = state.takeCounts || new Map();
    let cueCursor = Number(state.cueCursor) || 0;
    let sequence = Number(state.sequence) || 0;
    let scan = 0;
    let lastConsumed = 0;
    const appendUnmatched = (from, to) => {
        if (to <= from) return;
        const slice = combined.slice(from, to);
        const transcript = timedWordsText(slice);
        if (!transcript) return;
        sequence += 1;
        unmatched.push({
            id: `unmatched-${sequence}`,
            start: slice[0].start,
            end: slice[slice.length - 1].end,
            transcript,
            reason: slice.length < 2 ? 'non_speech' : 'no_text_match'
        });
    };

    const recoveryProfiles = descriptions.map((item, itemIndex) => ({
        item,
        itemIndex,
        words: tokens(item.text)
    }));
    const quickTokenSimilarity = (left, right) => {
        if (!left.length || !right.length) return 0;
        const counts = new Map();
        left.forEach(word => counts.set(word, (counts.get(word) || 0) + 1));
        let common = 0;
        right.forEach(word => {
            const count = counts.get(word) || 0;
            if (count > 0) { common += 1; counts.set(word, count - 1); }
        });
        const precision = common / right.length;
        const recall = common / left.length;
        return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    };
    const findForwardRecovery = (fromScan) => {
        const shortlist = [];
        const firstForwardCue = Math.min(descriptions.length, cueCursor + 1);
        const lastForwardCue = Math.min(descriptions.length, firstForwardCue + 80);
        const maxRecoveryStart = Math.min(combined.length - 1, fromScan + 80);
        for (let wordStart = fromScan; wordStart <= maxRecoveryStart; wordStart += 1) {
            const availableWords = combined.length - wordStart;
            for (let itemIndex = firstForwardCue; itemIndex < lastForwardCue; itemIndex += 1) {
                const profile = recoveryProfiles[itemIndex];
                const targetLength = profile.words.length;
                if (!targetLength) continue;
                const lengths = [...new Set([
                    Math.max(2, Math.floor(targetLength * 0.75)),
                    Math.max(2, targetLength),
                    Math.max(2, Math.ceil(targetLength * 1.35) + 1)
                ])].filter(length => length <= availableWords);
                for (const length of lengths) {
                    const spokenWords = combined.slice(wordStart, wordStart + length).flatMap(word => tokens(word.text));
                    const overlap = quickTokenSimilarity(profile.words, spokenWords);
                    const lengthPenalty = (Math.abs(spokenWords.length - targetLength) / Math.max(1, targetLength)) * 0.06;
                    const startPenalty = Math.min(0.04, Math.max(0, wordStart - fromScan) * 0.001);
                    const quickRank = overlap - lengthPenalty - startPenalty;
                    if (shortlist.length < 12 || quickRank > shortlist[shortlist.length - 1].quickRank) {
                        shortlist.push({ profile, wordStart, endIndex: wordStart + length, quickRank });
                        shortlist.sort((left, right) => right.quickRank - left.quickRank);
                        if (shortlist.length > 12) shortlist.pop();
                    }
                }
            }
        }
        let recovered = null;
        shortlist.forEach(entry => {
            const phrase = timedWordsText(combined.slice(entry.wordStart, entry.endIndex));
            const score = textSimilarity(entry.profile.item.text, phrase);
            const jump = Math.max(0, entry.profile.itemIndex - cueCursor);
            const jumpPenalty = Math.min(0.08, Math.max(0, jump - 8) * 0.001);
            const rankedScore = score - jumpPenalty;
            if (!recovered || rankedScore > recovered.rankedScore) {
                recovered = {
                    item: entry.profile.item, itemIndex: entry.profile.itemIndex,
                    wordStart: entry.wordStart, endIndex: entry.endIndex, phrase, score, rankedScore
                };
            }
        });
        return recovered?.score >= 0.52 ? recovered : null;
    };
    while (scan < combined.length) {
        let best = null;
        const maxStart = Math.min(combined.length - 1, scan + 20);
        const firstCue = Math.max(0, cueCursor - 1);
        const lastCue = Math.min(descriptions.length - 1, cueCursor + 12);
        let firstReliableStart = -1;
        let reliableItemIndex = -1;
        for (let wordStart = scan; wordStart <= maxStart; wordStart += 1) {
            let bestAtStart = null;
            const itemStart = reliableItemIndex >= 0 ? reliableItemIndex : firstCue;
            const itemEnd = reliableItemIndex >= 0 ? reliableItemIndex : lastCue;
            for (let itemIndex = itemStart; itemIndex <= itemEnd; itemIndex += 1) {
                const item = descriptions[itemIndex];
                const targetLength = tokens(item.text).length;
                if (!targetLength) continue;
                const minimum = Math.max(2, Math.floor(targetLength * 0.65));
                const maximum = Math.min(combined.length - wordStart, Math.ceil(targetLength * 1.45) + 2);
                for (let length = minimum; length <= maximum; length += 1) {
                    const phrase = timedWordsText(combined.slice(wordStart, wordStart + length));
                    const spokenLength = tokens(phrase).length;
                    const score = textSimilarity(item.text, phrase);
                    const orderPenalty = Math.max(0, itemIndex - cueCursor - 2) * 0.012;
                    const lengthPenalty = (Math.abs(spokenLength - targetLength) / Math.max(1, targetLength)) * 0.08;
                    const rankedScore = score - orderPenalty - lengthPenalty;
                    if (!bestAtStart || rankedScore > bestAtStart.rankedScore) {
                        bestAtStart = { item, itemIndex, wordStart, endIndex: wordStart + length, phrase, score, rankedScore };
                    }
                }
            }
            if (bestAtStart && (!best || bestAtStart.rankedScore > best.rankedScore)) best = bestAtStart;
            if (bestAtStart?.score >= 0.58 && firstReliableStart < 0) {
                firstReliableStart = wordStart;
                reliableItemIndex = bestAtStart.itemIndex;
            }
            if (firstReliableStart >= 0 && wordStart >= firstReliableStart + 20) break;
        }
        if (!best || best.score < 0.44) best = findForwardRecovery(scan);
        if (!best || best.score < 0.44) {
            const safeLimit = isFinal ? combined.length : Math.max(0, combined.length - 80);
            if (safeLimit > lastConsumed) appendUnmatched(lastConsumed, safeLimit);
            scan = safeLimit;
            lastConsumed = safeLimit;
            break;
        }
        appendUnmatched(lastConsumed, best.wordStart);
        const matchedWords = combined.slice(best.wordStart, best.endIndex);
        const cueTokens = tokens(best.item.text);
        const spokenTokens = tokens(best.phrase);
        const extraRatio = Math.max(0, spokenTokens.length - cueTokens.length) / Math.max(1, cueTokens.length);
        const sourceStart = Math.max(0, matchedWords[0].start - 0.04);
        const sourceEnd = matchedWords[matchedWords.length - 1].end + 0.04;
        const spokenDuration = Math.max(0.05, sourceEnd - sourceStart);
        const alignedSpeechDuration = Math.max(0.05, matchedWords[matchedWords.length - 1].end - matchedWords[0].start);
        const availableDuration = Math.max(0, Number(best.item.end) - Number(best.item.start));
        const tooLongForSafeFit = availableDuration > 0 && alignedSpeechDuration > availableDuration * 1.35;
        const count = (takeCounts.get(best.item.id) || 0) + 1;
        takeCounts.set(best.item.id, count);
        sequence += 1;
        candidates.push({
            id: `candidate-${sequence}`,
            eventId: best.item.id,
            takeNumber: count,
            sourceStart,
            sourceEnd,
            transcript: best.phrase,
            score: Number(best.score.toFixed(4)),
            needsReview: best.score < 0.7 || extraRatio > 0.35 || tooLongForSafeFit,
            audioPath: '',
            duration: spokenDuration,
            recommended: false
        });
        cueCursor = best.itemIndex;
        scan = best.endIndex;
        lastConsumed = scan;
    }

    const retentionStart = isFinal ? combined.length : Math.max(lastConsumed, combined.length - 80);
    appendUnmatched(lastConsumed, retentionStart);
    state.pendingWords = isFinal ? [] : combined.slice(retentionStart);
    state.takeCounts = takeCounts;
    state.cueCursor = cueCursor;
    state.sequence = sequence;
    return { candidates, unmatched };
}
function updateRecommendations(candidates, descriptions) {
    candidates.forEach(candidate => { candidate.recommended = false; });
    descriptions.forEach(item => {
        const matches = candidates.filter(candidate => candidate.eventId === item.id).sort((a, b) => b.score - a.score);
        const safeRecommendation = matches.find(candidate => !candidate.needsReview);
        if (safeRecommendation) safeRecommendation.recommended = true;
    });
}
function extractCandidate(ffmpegPath, sourcePath, candidate, directory) {
    const fingerprint = crypto.createHash('sha1')
        .update(`${sourcePath}|${candidate.sourceStart}|${candidate.sourceEnd}`)
        .digest('hex');
    const outputPath = path.join(directory, `${fingerprint}.wav`);
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 64) {
        candidate.audioPath = outputPath;
        return Promise.resolve(candidate);
    }
    return new Promise((resolve, reject) => {
        const child = spawn(ffmpegPath, [
            '-y', '-v', 'error', '-ss', candidate.sourceStart.toFixed(3),
            '-i', sourcePath, '-t', Math.max(0.05, candidate.sourceEnd - candidate.sourceStart).toFixed(3),
            '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', outputPath
        ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        const errors = [];
        child.stderr.on('data', chunk => errors.push(chunk));
        child.on('error', reject);
        child.on('close', code => {
            if (code !== 0) reject(new Error(Buffer.concat(errors).toString('utf8').trim() || `ffmpeg_exited_${code}`));
            else {
                candidate.audioPath = outputPath;
                resolve(candidate);
            }
        });
    });
}

function normalizedDescriptions(options = {}) {
    return (Array.isArray(options.descriptions) ? options.descriptions : [])
        .filter(item => item?.id && String(item.text || '').trim())
        .map(item => ({
            id: String(item.id),
            text: String(item.text),
            start: Math.max(0, Number(item.start) || 0),
            end: Math.max(0, Number(item.end) || 0)
        }));
}

function narrationResult(sourcePath, model, transcriptParts, candidates, unmatched, complete = true) {
    return {
        sourcePath,
        sourceName: path.basename(sourcePath),
        model,
        transcript: transcriptParts.join(' ').replace(/\s+/g, ' ').trim(),
        candidates,
        unmatched,
        analyzedAt: complete ? new Date().toISOString() : ''
    };
}

async function analyzeHumanNarrationNative(options = {}) {
    const sourcePath = path.resolve(String(options.sourcePath || ''));
    if (!fs.existsSync(sourcePath)) throw new Error('human_narration_source_missing');
    const descriptions = normalizedDescriptions(options);
    if (!descriptions.length) throw new Error('human_narration_descriptions_missing');
    const sourceDuration = Number(options.sourceDuration);
    if (!(sourceDuration > 0)) throw new Error('human_narration_duration_missing');

    const model = String(options.model || 'Xenova/whisper-base');
    const onProgress = options.onProgress;
    const runtime = await ensureNativeWhisper({
        model,
        modelCacheDir: options.modelCacheDir,
        onProgress
    });
    if (!runtime) return null;

    fs.mkdirSync(options.clipCacheDir, { recursive: true });
    const chunkDuration = 120;
    const chunkCount = Math.max(1, Math.ceil(sourceDuration / chunkDuration));
    const transcriptParts = [];
    const candidates = [];
    const unmatched = [];
    const classificationState = {};

    for (let index = 0; index < chunkCount; index += 1) {
        const offset = index * chunkDuration;
        const duration = Math.min(chunkDuration, sourceDuration - offset);
        const boundary = offset + duration;
        const transcription = await runWhisperChunk(runtime, {
            sourcePath,
            offset,
            duration,
            onChunkProgress: chunkPercent => {
                const percent = Math.round(((index + (chunkPercent / 100)) / chunkCount) * 100);
                onProgress?.({ stage: 'transcribing', percent });
            }
        });
        const ownedSegments = transcription.segments.filter(segment => {
            const midpoint = (Number(segment.start) + Number(segment.end)) / 2;
            return midpoint >= offset && midpoint < boundary;
        });
        const ownedWords = transcription.words.filter(word => {
            const midpoint = (Number(word.start) + Number(word.end)) / 2;
            return midpoint >= offset && midpoint < boundary;
        });
        if (ownedSegments.length) transcriptParts.push(ownedSegments.map(segment => segment.text).join(' '));
        const classified = classifyTimedWords(ownedWords, descriptions, classificationState, index === chunkCount - 1);
        for (const candidate of classified.candidates) {
            await extractCandidate(options.ffmpegPath, sourcePath, candidate, options.clipCacheDir);
            candidates.push(candidate);
        }
        unmatched.push(...classified.unmatched);
        updateRecommendations(candidates, descriptions);
        const percent = Math.round(((index + 1) / chunkCount) * 100);
        onProgress?.({
            stage: 'transcribing',
            percent,
            partial: narrationResult(sourcePath, model, transcriptParts, candidates, unmatched, false)
        });
    }
    updateRecommendations(candidates, descriptions);
    return narrationResult(sourcePath, model, transcriptParts, candidates, unmatched);
}

async function analyzeHumanNarrationTransformers(options = {}) {
    const sourcePath = path.resolve(String(options.sourcePath || ''));
    if (!fs.existsSync(sourcePath)) throw new Error('human_narration_source_missing');
    const descriptions = normalizedDescriptions(options);
    if (!descriptions.length) throw new Error('human_narration_descriptions_missing');
    const model = String(options.model || 'Xenova/whisper-base');
    const onProgress = options.onProgress;
    onProgress?.({ stage: 'decoding', percent: 0 });
    const audio = await decodeAudio(options.ffmpegPath, sourcePath, onProgress);
    onProgress?.({ stage: 'transcribing', percent: 0 });
    const transcriber = await getTranscriber(model, options.modelCacheDir, onProgress);
    const sampleRate = 16000;
    const transcriptionChunkSamples = sampleRate * 60;
    const chunkCount = Math.max(1, Math.ceil(audio.length / transcriptionChunkSamples));
    const words = [];
    const transcriptParts = [];
    for (let index = 0; index < chunkCount; index += 1) {
        const sampleStart = index * transcriptionChunkSamples;
        const sampleEnd = Math.min(audio.length, sampleStart + transcriptionChunkSamples);
        const result = await transcriber(audio.subarray(sampleStart, sampleEnd), {
            return_timestamps: 'word',
            chunk_length_s: 30,
            stride_length_s: 5,
            task: 'transcribe'
        });
        const timeOffset = sampleStart / sampleRate;
        words.push(...wordsFromResult(result).map(word => ({
            ...word,
            start: word.start + timeOffset,
            end: word.end + timeOffset
        })));
        const transcriptPart = String(result?.text || '').trim();
        if (transcriptPart) transcriptParts.push(transcriptPart);
        onProgress?.({
            stage: 'transcribing',
            percent: Math.round(((index + 1) / chunkCount) * 100)
        });
    }
    const utterances = buildUtterances(words);
    const classified = classifyUtterances(utterances, descriptions);
    fs.mkdirSync(options.clipCacheDir, { recursive: true });
    for (let index = 0; index < classified.candidates.length; index += 1) {
        await extractCandidate(options.ffmpegPath, sourcePath, classified.candidates[index], options.clipCacheDir);
        onProgress?.({ stage: 'extracting', percent: Math.round(((index + 1) / classified.candidates.length) * 100) });
    }
    updateRecommendations(classified.candidates, descriptions);
    return narrationResult(sourcePath, model, transcriptParts, classified.candidates, classified.unmatched);
}

async function analyzeHumanNarration(options = {}) {
    const nativeResult = await analyzeHumanNarrationNative(options);
    if (nativeResult) return nativeResult;
    return analyzeHumanNarrationTransformers(options);
}
function analyzeHumanNarrationInWorker(options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const workerOptions = { ...options };
    delete workerOptions.onProgress;

    return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'description-human-narration-worker.js'), {
            workerData: workerOptions
        });
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            callback(value);
        };
        worker.on('message', message => {
            if (message?.type === 'progress') {
                onProgress?.(message.payload || {});
                return;
            }
            if (message?.type === 'result') finish(resolve, message.payload);
            else if (message?.type === 'error') {
                const error = new Error(message.message || 'human_narration_worker_failed');
                if (message.stack) error.stack = message.stack;
                finish(reject, error);
            }
        });
        worker.on('error', error => finish(reject, error));
        worker.on('exit', code => {
            if (!settled) finish(reject, new Error(`human_narration_worker_exited_${code}`));
        });
    });
}

module.exports = { analyzeHumanNarration, analyzeHumanNarrationInWorker, normalizeText, textSimilarity };
