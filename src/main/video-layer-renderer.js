const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const { sourceAudioProfile } = require('./slideshow-audio-policy');
const { buildSlideshowAudioMix } = require('./slideshow-audio-mix');

const even = n => Math.max(2, Math.round(Number(n) / 2) * 2);
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function blurredPanel(input, output, width, height) {
    const lowW = even(width / 8), lowH = even(height / 8);
    return [
        `${input}split=2[${output}bg0][${output}fg0]`,
        `[${output}bg0]scale=${lowW}:${lowH}:force_original_aspect_ratio=increase,crop=${lowW}:${lowH},boxblur=4:1,scale=${width}:${height},setsar=1[${output}bg]`,
        `[${output}fg0]scale=${width}:${height}:force_original_aspect_ratio=decrease,setsar=1[${output}fg]`,
        `[${output}bg][${output}fg]overlay=(W-w)/2:(H-h)/2[${output}]`,
    ];
}

function buildLayerPlan(params, main, layer, hdrFilter = () => '') {
    const width = even(main.width || 1920), height = even(main.height || 1080);
    const duration = Number(main.duration);
    if (!(duration > 0)) throw new Error('invalid_main_video_duration');
    const start = clamp(finite(params.startTime, 0), 0, duration);
    const end = params.endTime > 0 ? Math.min(duration, Number(params.endTime))
        : params.duration > 0 ? Math.min(duration, start + Number(params.duration)) : duration;
    if (end <= start) throw new Error('invalid_layer_interval');
    const offset = finite(params.syncOffset, 0) / 1000;
    // Match the sync preview: layer source time = main time - sync offset.
    // The visibility interval must not silently reset that synchronization.
    const delay = Math.max(0, offset);
    const trim = Math.max(0, -offset);
    const mainAudio = main.streams?.find(s => s.codec_type === 'audio');
    const layerAudio = layer.streams?.find(s => s.codec_type === 'audio');
    const profile = sourceAudioProfile([mainAudio, layerAudio].filter(Boolean));
    const mainGain = clamp(finite(params.mainVolume, 100)/100, 0, 4);
    const layerGain = params.muteLayer ? 0 : clamp(params.layerVolume !== undefined
        ? finite(params.layerVolume, 100)/100 : finite(params.audioVolume, 0), 0, 4);
    const mixLayerAudio = Boolean(layerAudio && layerGain > 0 && delay < end);
    const copyAudio = Boolean(mainAudio && mainGain === 1 && !mixLayerAudio
        && mainAudio.codec_name === 'aac' && mainAudio.profile === 'LC');
    const filters = [];
    const format = metadata => [hdrFilter(metadata), 'setsar=1', 'format=yuv420p'].filter(Boolean).join(',');
    filters.push(`[0:v]setpts=PTS-STARTPTS,${format(main)}[main0]`);
    filters.push(`[1:v]setpts=PTS-STARTPTS,${format(layer)}[layer0]`);

    // Cut regions remove material from the layer before synchronization.
    const cutRegions = (params.cutRegions || []).map(r => ({start:Math.max(0, Number(r.start)),end:Number(r.end)}))
        .filter(r => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start).sort((a,b)=>a.start-b.start);
    let layerVideo = 'layer0', layerSound = '1:a:0';
    if (cutRegions.length) {
        const keeps = []; let cursor = 0;
        const layerDuration = Number(layer.duration);
        for (const cut of cutRegions) {
            if (cut.start > cursor) keeps.push({start:cursor,end:Math.min(cut.start,layerDuration)});
            cursor = Math.max(cursor, cut.end);
        }
        if (cursor < layerDuration) keeps.push({start:cursor,end:layerDuration});
        const spans = keeps.filter(s=>s.end>s.start);
        if (!spans.length) throw new Error('empty_layer_after_cuts');
        filters.push(`[layer0]split=${spans.length}${spans.map((_,i)=>`[lv${i}]`).join('')}`);
        spans.forEach((s,i)=>filters.push(`[lv${i}]trim=${s.start}:${s.end},setpts=PTS-STARTPTS[lvc${i}]`));
        filters.push(`${spans.map((_,i)=>`[lvc${i}]`).join('')}concat=n=${spans.length}:v=1:a=0[layercut]`);
        layerVideo = 'layercut';
        if (mixLayerAudio) {
            spans.forEach((s,i)=>filters.push(`[1:a:0]atrim=${s.start}:${s.end},asetpts=PTS-STARTPTS[lac${i}]`));
            filters.push(`${spans.map((_,i)=>`[lac${i}]`).join('')}concat=n=${spans.length}:v=0:a=1[layeracut]`);
            layerSound = 'layeracut';
        }
    }
    filters.push(`[${layerVideo}]trim=start=${trim}:duration=${Math.max(.001,end-delay)},setpts=PTS-STARTPTS+${delay}/TB[layerTimed]`);
    const enable = `enable='between(t,${start},${end})'`;
    if (params.mode === 'split-screen') {
        const left = even(width/2), right = width-left;
        filters.push('[main0]split=2[base][mainPanelInput]');
        filters.push(...blurredPanel('[mainPanelInput]', 'mainPanel', right, height));
        filters.push(...blurredPanel('[layerTimed]', 'layerPanel', left, height));
        filters.push(`[mainPanel]pad=${width}:${height}:${left}:0:black[splitBase]`);
        filters.push(`[splitBase][layerPanel]overlay=0:0:eof_action=pass:repeatlast=0[splitVideo]`);
        filters.push(`[base][splitVideo]overlay=0:0:${enable}:eof_action=pass:repeatlast=0[outv]`);
    } else {
        const boxW = even(params.size?.width || params.width || width*finite(params.scale,25)/100);
        const boxH = even(params.size?.height || params.height || boxW*(layer.height||height)/(layer.width||width));
        const x = finite(params.position?.x ?? params.x, 0), y = finite(params.position?.y ?? params.y, 0);
        const fit = params.keepAspect === false ? '' : ':force_original_aspect_ratio=decrease';
        const opacity = clamp(finite(params.opacity,1),0,1);
        filters.push(`[layerTimed]scale=${boxW}:${boxH}${fit},format=rgba,colorchannelmixer=aa=${opacity}[layerSized]`);
        filters.push(`[main0][layerSized]overlay=${x}:${y}:${enable}:eof_action=pass:repeatlast=0[outv]`);
    }
    const audioLabels = [];
    if (mainAudio && !copyAudio) {
        filters.push(`[0:a:0]asetpts=PTS-STARTPTS,volume=${mainGain}[mainAudio]`);
        audioLabels.push('mainAudio');
    }
    if (mixLayerAudio) {
        const audioStart = Math.max(start,delay);
        filters.push(`[${layerSound}]atrim=start=${audioStart-offset}:duration=${end-audioStart},asetpts=PTS-STARTPTS,volume=${layerGain},aformat=sample_rates=${profile.sampleRate}:channel_layouts=${profile.layout},adelay=${Array(profile.channels).fill(Math.round(audioStart*1000)).join('|')}[layerAudio]`);
        audioLabels.push('layerAudio');
    }
    if (audioLabels.length) filters.push(buildSlideshowAudioMix(audioLabels,'outa',duration,profile));
    return {filters,profile,duration,hasAudio:copyAudio || audioLabels.length>0,copyAudio,width,height};
}

async function renderVideoLayer(params, onProgress, helpers) {
    if (path.resolve(params.outputPath) === path.resolve(params.mainVideoPath)
        || path.resolve(params.outputPath) === path.resolve(params.layerVideoPath)) throw new Error('output_must_not_replace_source');
    const main = await helpers.metadata(params.mainVideoPath);
    const layer = await helpers.metadata(params.layerVideoPath);
    const plan = buildLayerPlan(params,main,layer,helpers.hdrFilter);
    console.log('[VideoLayer] Render configuration', {
        mode: params.mode, mainVideoPath: params.mainVideoPath,
        layerVideoPath: params.layerVideoPath, outputPath: params.outputPath,
        position: params.position, size: params.size,
        startTime: params.startTime, endTime: params.endTime,
        syncOffset: params.syncOffset, cutRegions: params.cutRegions,
        mainVolume: params.mainVolume, layerVolume: params.layerVolume,
        muteLayer: params.muteLayer, keepAspect: params.keepAspect,
        width: plan.width, height: plan.height, duration: plan.duration
    });
    const visualOptions = helpers.visualOptions(main,{audioMode:'copy'});
    const audioCodecIndex = visualOptions.indexOf('-c:a');
    if (audioCodecIndex >= 0) visualOptions.splice(audioCodecIndex,2);
    return new Promise((resolve,reject)=>{
        // Auto threading multiplies decoder/filter/encoder buffers in a multi-input
        // graph. Bound each pool so exports can coexist with Electron previews.
        const cmd = ffmpeg(params.mainVideoPath).inputOptions(['-threads','2'])
            .input(params.layerVideoPath).inputOptions(['-threads','2']);
        if (/\.(png|jpe?g|webp|bmp)$/i.test(params.layerVideoPath)) cmd.inputOptions(['-loop','1']);
        else if (params.loop) cmd.inputOptions(['-stream_loop','-1']);
        cmd.complexFilter(plan.filters).outputOptions([
            '-filter_complex_threads','2',
            '-map','[outv]', ...(plan.hasAudio ? ['-map',plan.copyAudio?'0:a:0':'[outa]'] : ['-an']),
            ...visualOptions,
            '-threads:v','2',
            ...(plan.copyAudio ? ['-c:a','copy'] : plan.hasAudio ? plan.profile.encoding.split(' ') : []),
            '-t',String(plan.duration),'-movflags','+faststart',
        ]).output(params.outputPath)
            .on('start', command => console.log('[VideoLayer] FFmpeg command', command))
            .on('progress',p=>{
                const parts=String(p.timemark||'0:0:0').split(':').map(Number);
                const seconds=parts[0]*3600+parts[1]*60+parts[2];
                onProgress?.(Math.max(0,Math.min(99,seconds/plan.duration*100)));
            })
            .on('end',()=>{onProgress?.(100);resolve(params.outputPath);})
            .on('error',(error, stdout, stderr)=>{
                // fluent-ffmpeg's generic final line hides filter/encoder failures.
                console.error('[VideoLayer] FFmpeg failure', error.message, String(stderr || '').slice(-24000));
                reject(error);
            }).run();
    });
}
module.exports={buildLayerPlan,renderVideoLayer,blurredPanel};
