const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

function probePackets(ffprobePath, file, intervals) {
    return new Promise((resolve, reject) => {
        execFile(ffprobePath, ['-v', 'error', '-select_streams', 'a:0',
            '-read_intervals', intervals, '-show_packets', '-show_entries',
            'packet=pts_time,duration_time', '-of', 'json', file],
        { windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 30000 }, (error, stdout) => {
            if (error) return reject(error);
            try { resolve(JSON.parse(stdout).packets || []); } catch (e) { reject(e); }
        });
    });
}

function isUnmodifiedSelection(segments) {
    if (segments.length !== 1) return false;
    const s = segments[0];
    return Number(s.speed ?? 1) === 1 && Number(s.audioVolume ?? 100) === 100
        && !s.isMuted && !s.speedBgAudio && !s.noiseReduction?.enabled
        && !s.audioEffects?.length && !s.overlays?.length
        && (!s.audioChannelMode || s.audioChannelMode === 'source');
}

async function tryCopySelectionAudio({ ffmpegPath, ffprobePath, inputPath, segments,
    sourceProfiles, outputPath, runFfmpeg, onProgress }) {
    if (!ffprobePath || path.extname(outputPath) !== '.mov' || !isUnmodifiedSelection(segments)) return null;
    const s = segments[0];
    const file = path.resolve(s.sourceFile || inputPath);
    const profile = sourceProfiles.find(p => path.resolve(p.filePath) === file);
    const audio = profile?.audio?.[0];
    if (profile?.audio?.length !== 1 || audio.codec !== 'aac' || audio.profile !== 'LC') return null;
    const start = Number(s.start || 0), end = Number(s.end), duration = end - start;
    if (!(duration > 0) || Math.abs(audio.startTime || 0) > 0.000001) return null;
    const tolerance = 1 / audio.sampleRate;
    try {
        // Probe only boundary windows. If demuxer seeking cannot expose an exact
        // packet boundary, use the normal sample-accurate renderer instead.
        const packets = await probePackets(ffprobePath, file,
            `${Math.max(0, start - 1)}%${start + 1},${Math.max(0, end - 1)}%${end + 1}`);
        const starts = packets.map(p => Number(p.pts_time));
        const ends = packets.map(p => Number(p.pts_time) + Number(p.duration_time));
        if (!starts.some(t => Math.abs(t - start) <= tolerance)
            || !ends.some(t => Math.abs(t - end) <= tolerance)) return null;
        await runFfmpeg(ffmpegPath, ['-y', '-i', file, '-ss', String(start), '-t', String(duration),
            '-map', '0:a:0', '-vn', '-c:a', 'copy', outputPath], { duration, onProgress });
        const edges = await probePackets(ffprobePath, outputPath, `0%1,${Math.max(0, duration - 1)}%${duration + 1}`);
        const first = Math.min(...edges.map(p => Number(p.pts_time)));
        const last = Math.max(...edges.map(p => Number(p.pts_time) + Number(p.duration_time)));
        if (Math.abs(first) > tolerance || Math.abs(last - duration) > tolerance) {
            fs.unlinkSync(outputPath);
            return null;
        }
        return { outputPath, duration, sampleRate: audio.sampleRate, channelLayout: audio.channelLayout, copied: true };
    } catch (error) {
        if (/cancel/i.test(error.message)) throw error;
        try { fs.unlinkSync(outputPath); } catch (_) {}
        return null;
    }
}

module.exports = { tryCopySelectionAudio, isUnmodifiedSelection };
