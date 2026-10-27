const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { aacEncodingArgs } = require('../main/slideshow-audio-policy');

function runtime(root) {
    const bundled = process.resourcesPath && path.join(process.resourcesPath, 'native-gtcrn');
    if (bundled && fs.existsSync(path.join(bundled, 'python.exe'))) {
        const result = { python: path.join(bundled, 'python.exe'), model: path.join(bundled, 'gtcrn_simple.onnx'), script: path.join(bundled, 'gtcrn-recording.py') };
        if (!Object.values(result).every(p => fs.existsSync(p))) throw new Error('runtime');
        return result;
    }
    const python = path.join(root, 'temp', 'gtcrn-test-venv', 'Scripts', 'python.exe');
    const model = path.join(root, 'temp', 'gtcrn-test', 'gtcrn_simple.onnx');
    const script = path.join(root, 'tools', 'gtcrn-recording.py');
    if (![python, model, script].every(p => fs.existsSync(p))) throw new Error('runtime');
    return { python, model, script };
}

// Keep the ordinary mix on track 1 for recovery. Only track 2 is denoised.
// This experimental preset is chosen through the labelled native select;
// it deliberately has no global shortcut that could silently alter recording.
async function prepareTracks(call, mic) {
    const snapshots = [];
    const profiles = [];
    let originalProfile;
    const helperProfile = 'EVD-GTCRN-Reload';
    const reload = async () => {
        // RemoveProfile opens an OBS confirmation dialog. Keep one reusable
        // helper instead; never delete profiles in the recording lifecycle.
        const { profiles: available = [] } = await call('GetProfileList');
        try {
            await call(available.includes(helperProfile) ? 'SetCurrentProfile' : 'CreateProfile',
                { profileName: helperProfile });
        } finally {
            await call('SetCurrentProfile', { profileName: originalProfile });
        }
    };
    const restore = async () => {
        const errors = [];
        if (originalProfile && (await call('GetProfileList')).currentProfileName !== originalProfile) {
            await call('SetCurrentProfile', { profileName: originalProfile });
        }
        for (const data of [...profiles].reverse()) {
            try { await call('SetProfileParameter', data); } catch (e) { errors.push(e); }
        }
        if (profiles.length) {
            try { await reload(); } catch (e) { errors.push(e); }
        }
        for (const data of snapshots) {
            try { await call('SetInputAudioTracks', data); } catch (e) { errors.push(e); }
        }
        if (errors.length) throw new Error('restore');
    };
    const get = async (parameterCategory, parameterName) => {
        const r = await call('GetProfileParameter', { parameterCategory, parameterName });
        return r.parameterValue ?? r.defaultParameterValue ?? '';
    };
    const set = async (parameterCategory, parameterName, parameterValue) => {
        profiles.push({ parameterCategory, parameterName, parameterValue: await get(parameterCategory, parameterName) });
        await call('SetProfileParameter', { parameterCategory, parameterName, parameterValue });
    };
    try {
        if ((await call('GetStreamStatus')).outputActive || (await call('GetRecordStatus')).outputActive) throw new Error('busy');
        const replay = await call('GetReplayBufferStatus').catch(error => {
            if (error.code === 604) return { outputActive: false }; // Disabled replay buffer.
            throw error;
        });
        if (replay.outputActive) throw new Error('busy');
        originalProfile = (await call('GetProfileList')).currentProfileName;
        if (originalProfile === helperProfile) throw new Error('profile');
        const mode = await get('Output', 'Mode');
        const category = mode === 'Advanced' ? 'AdvOut' : 'SimpleOutput';
        if (mode === 'Advanced' && (await get(category, 'RecType')) !== 'Standard') throw new Error('profile');
        if (mode !== 'Advanced' && ['Stream', 'Lossless'].includes(await get(category, 'RecQuality'))) {
            await set(category, 'RecQuality', 'Small');
        }
        await set(category, 'RecTracks', '7');
        await set(category, 'RecFormat2', 'mkv');
        await set(category, 'RecFormat', 'mkv');
        // Profile parameters alone do not rebuild OBS recording encoders.
        await reload();
        const { inputs } = await call('GetInputList');
        let found = false;
        for (const { inputName } of inputs) {
            let inputAudioTracks;
            try { ({ inputAudioTracks } = await call('GetInputAudioTracks', { inputName })); }
            catch { continue; } // Video-only inputs do not expose audio tracks.
            snapshots.push({ inputName, inputAudioTracks });
            const isMic = inputName === mic;
            found ||= isMic;
            await call('SetInputAudioTracks', { inputName, inputAudioTracks: {
                '1': isMic || inputAudioTracks['1'] === true, '2': isMic,
                '3': !isMic && inputAudioTracks['1'] === true, '4': false, '5': false, '6': false
            } });
        }
        if (!found) throw new Error('microphone');
        return { restore };
    } catch (error) {
        await restore();
        throw error;
    }
}

function run(exe, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(exe, args, { windowsHide: true });
        let out = '', err = '';
        child.stdout.on('data', data => { out = (out + data).slice(-2000000); });
        child.stderr.on('data', data => { err = (err + data).slice(-6000); });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve(out) : reject(new Error(`process_${code}: ${err}`)));
    });
}

async function waitForFinalizedRecording(probe, stat, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    let previous = '', stable = 0;
    for (let attempt = 0; attempt < 30; attempt++) {
        try {
            const info = await probe();
            const file = await stat();
            const audio = info.streams.filter(s => s.codec_type === 'audio');
            const duration = Number(info.format?.duration);
            const signature = `${file.size}:${file.mtimeMs}:${duration}:${audio.length}`;
            stable = signature === previous ? stable + 1 : 0;
            previous = signature;
            if (audio.length === 3 && Number.isFinite(duration) && duration > 0 && stable >= 2) return info;
        } catch {
            stable = 0;
            previous = '';
        }
        await wait(500);
    }
    throw new Error('recording_not_finalized_or_missing_tracks');
}

async function processRecording(source, root, progress = () => {}) {
    const rt = runtime(root);
    const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
    const ffprobe = require('@ffprobe-installer/ffprobe').path;
    const probe = async file => JSON.parse(await run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
    progress('extract');
    // StopRecord may return before the muxer has written the final duration/index.
    const info = await waitForFinalizedRecording(() => probe(source), () => fs.promises.stat(source));
    const audio = info.streams.filter(s => s.codec_type === 'audio');
    const duration = Number(info.format.duration);
    if (audio.length !== 3 || !Number.isFinite(duration) || duration <= 0) throw new Error('tracks');
    const folder = await fs.promises.mkdtemp(path.join(path.dirname(source), '.evd-gtcrn-'));
    const mic = path.join(folder, 'microphone.wav');
    const clean = path.join(folder, 'clean.wav');
    const partial = path.join(folder, 'result.mp4');
    let output = path.join(path.dirname(source), `${path.parse(source).name}.mp4`);
    for (let n = 2; fs.existsSync(output); n++) {
        output = path.join(path.dirname(source), `${path.parse(source).name} (${n}).mp4`);
    }
    try {
        await run(ffmpeg, ['-v', 'error', '-n', '-i', source, '-map', '0:a:1', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_f32le', '-rf64', 'auto', mic]);
        progress('clean');
        await run(rt.python, [rt.script, rt.model, mic, clean]);
        const cleaned = await probe(clean);
        const micDuration = Number((await probe(mic)).format.duration);
        if (Math.abs(Number(cleaned.format.duration) - micDuration) > 0.05) throw new Error('duration');
        progress('mix');
        // Explicit pan duplicates the mono mic without the -3 dB implicit
        // mono-to-stereo upmix. Never send the system/music track to GTCRN.
        const channels = Number(audio[2].channels);
        if (![1, 2].includes(channels)) throw new Error('channels');
        const rate = Number(audio[2].sample_rate);
        const offset = Math.max(0, Number(audio[1].start_time) || 0);
        const delay = Math.round(offset * 1000);
        const pan = channels === 2 ? ',pan=stereo|c0=c0|c1=c0' : '';
        const filters = `[1:a]aresample=${rate}${pan},adelay=${Array(channels).fill(delay).join('|')},apad,atrim=duration=${duration}[mic];` +
            `[0:a:2]apad,atrim=duration=${duration}[other];` +
            `[mic][other]amix=inputs=2:duration=longest:dropout_transition=0,volume=2,atrim=duration=${duration}[mix]`;
        await run(ffmpeg, ['-v', 'error', '-n', '-i', source, '-i', clean, '-filter_complex', filters,
            '-map', '0:v:0', '-map', '[mix]', '-c:v', 'copy', ...aacEncodingArgs([audio[2]]),
            '-t', String(duration), '-movflags', '+faststart', partial]);
        const result = await probe(partial);
        if (Math.abs(Number(result.format.duration) - duration) > 0.1 || !result.streams.some(s => s.codec_type === 'video')) throw new Error('validation');
        // Never replace a file created while the denoiser was running.
        await fs.promises.copyFile(partial, output, fs.constants.COPYFILE_EXCL);
        return output;
    } finally {
        // Only our uniquely created temporary folder is removed; source is kept.
        await fs.promises.rm(folder, { recursive: true, force: true });
    }
}

module.exports = { prepareTracks, processRecording, runtime, waitForFinalizedRecording };
