const { execFile } = require('child_process');
const fs = require('fs');
const { sourceAudioTimelineFilter } = require('./seamless-timeline');

// Bounded PCM windows keep long projects out of renderer memory. This path is
// preview-only; exports retain the source-aware audio policy and channel layout.
async function renderPreviewAudio(ffmpegPath, { source, spans }, ffprobePath = null) {
    if (typeof source !== 'string' || !fs.statSync(source).isFile()
        || !Array.isArray(spans) || !spans.length || spans.length > 128) throw new Error('invalid_preview');
    let duration = 0;
    const args = ['-v', 'error'];
    const filters = [];
    const audioSources = new Map();
    for (const span of spans) {
        const file = span.source || source;
        if (typeof file !== 'string' || !fs.statSync(file).isFile()) throw new Error('invalid_preview_source');
        if (!audioSources.has(file)) {
            let hasAudio = true;
            if (ffprobePath) {
                const output = await new Promise((resolve, reject) => execFile(ffprobePath,
                    ['-v','error','-select_streams','a:0','-show_entries','stream=index','-of','json',file],
                    {windowsHide:true, timeout:10000, maxBuffer:65536},
                    (error, stdout) => error ? reject(error) : resolve(stdout)));
                hasAudio = JSON.parse(output).streams.length > 0;
            }
            audioSources.set(file, hasAudio);
        }
    }
    spans.forEach((span, i) => {
        const { start, end, volume = 1 } = span;
        if (![start, end, volume].every(Number.isFinite) || start < 0 || end <= start || volume < 0 || volume > 4) throw new Error('invalid_preview_span');
        duration += end - start;
        const seek = Math.max(0, start - 2);
        if (seek > 0) args.push('-ss', String(seek));
        const file = span.source || source;
        args.push('-t', String(end-seek), '-i', file);
        const prefix = audioSources.get(file)
            ? `[${i}:a:0]${sourceAudioTimelineFilter(48000)},atrim=start=${start-seek}:end=${end-seek},asetpts=PTS-STARTPTS,volume=${volume}`
            : 'anullsrc=r=48000:cl=stereo';
        filters.push(`${prefix},aformat=sample_fmts=flt:sample_rates=48000:channel_layouts=stereo,apad,atrim=end_sample=${Math.round((end-start)*48000)},asetpts=N/SR/TB[a${i}]`);
    });
    if (duration > 12.01) throw new Error('preview_window_too_large');
    filters.push(`${spans.map((_, i) => `[a${i}]`).join('')}concat=n=${spans.length}:v=0:a=1,asetpts=N/SR/TB[aout]`);
    args.push('-filter_complex', filters.join(';'), '-map', '[aout]', '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1');
    return new Promise((resolve, reject) => execFile(ffmpegPath, args,
        { encoding: 'buffer', windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 30000 },
        (error, stdout) => {
            if (error) return reject(error);
            // Use source-relative edges, not chunk edges: a 12-second buffering
            // boundary must never cause a fade. This also handles partial fades.
            let offset = 0;
            for (const span of spans) {
                const count = Math.round((span.end-span.start)*48000);
                const first = Number.isFinite(span.segmentStart) ? span.segmentStart : span.start;
                const last = Number.isFinite(span.segmentEnd) ? span.segmentEnd : span.end;
                const length = Math.min(144, Math.floor((last-first)*48000/2));
                if (length > 0) for (let n=0;n<count;n++) {
                    let gain=1;
                    if (span.fadeIn) gain=Math.min(gain, (Math.round((span.start-first)*48000)+n)/length);
                    if (span.fadeOut) gain=Math.min(gain, (Math.round((last-span.start)*48000)-n)/length);
                    if (gain>=1) continue;
                    for (let c=0;c<2;c++) {
                        const byte=((offset+n)*2+c)*4;
                        if (byte+4<=stdout.length) stdout.writeFloatLE(stdout.readFloatLE(byte)*Math.max(0,gain),byte);
                    }
                }
                offset+=count;
            }
            resolve({ pcm: stdout, sampleRate: 48000, channels: 2 });
        }));
}
module.exports = { renderPreviewAudio };
