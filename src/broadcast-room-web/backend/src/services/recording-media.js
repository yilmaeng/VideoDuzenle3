'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

function run(command, args) {
    return new Promise((resolve, reject) => execFile(command, args, {
        windowsHide: true, timeout: 30 * 60000, maxBuffer: 2 * 1024 * 1024
    }, (error, stdout) => error ? reject(new Error('recording_processing_failed')) : resolve(stdout)));
}

class RecordingMedia {
    constructor({ root, ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', execute = run }) {
        Object.assign(this, { root: path.resolve(root), ffmpeg, ffprobe, execute });
        this.queue = Promise.resolve(); this.jobs = new Map();
    }
    file(name, required = true) {
        if (!/^[a-f0-9-]+\.(mp4|m4a)$/.test(name)) throw new Error('recording_not_found');
        const target = path.join(this.root, name);
        if (fs.existsSync(target)) {
            if (fs.lstatSync(target).isSymbolicLink() || !fs.statSync(target).isFile()) throw new Error('recording_not_found');
            const rel = path.relative(fs.realpathSync(this.root), fs.realpathSync(target));
            if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('recording_not_found');
        } else if (required) throw new Error('recording_not_ready');
        return target;
    }
    job(key, work) {
        if (this.jobs.has(key)) return this.jobs.get(key);
        const job = this.queue.then(work);
        this.queue = job.catch(() => {});
        this.jobs.set(key, job);
        job.finally(() => this.jobs.delete(key)).catch(() => {});
        return job;
    }
    async probe(file) {
        return JSON.parse(await this.execute(this.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
    }
    checkDisk() {
        const disk = fs.statfsSync(this.root);
        if (disk.bavail * disk.bsize < 512 * 1024 ** 2) throw new Error('recording_disk_full');
    }
    audio(sourceName, outputName) {
        return this.job(outputName, async () => {
            const input = this.file(sourceName), output = this.file(outputName, false);
            if (fs.existsSync(output) && fs.statSync(output).size > 0) return output;
            this.checkDisk();
            const info = await this.probe(input), audio = info.streams.find(stream => stream.codec_type === 'audio');
            if (!audio) throw new Error('recording_processing_failed');
            const temp = this.file(`${crypto.randomUUID()}.m4a`, false);
            try {
                const encoding = audio.codec_name === 'aac' && audio.profile === 'LC' ? ['-c:a', 'copy']
                    : ['-c:a', 'aac', '-profile:a', 'aac_low', '-aac_coder', 'twoloop', '-ar', String(audio.sample_rate),
                        '-ac', String(audio.channels), '-b:a', String(Math.max(Number(audio.bit_rate) || 0, 160000 * Number(audio.channels || 1)))];
                await this.execute(this.ffmpeg, ['-nostdin', '-v', 'error', '-y', '-i', input, '-map', '0:a:0', '-vn', ...encoding, '-movflags', '+faststart', temp]);
                const result = await this.probe(temp);
                if (result.streams.some(stream => stream.codec_type === 'video') || !result.streams.some(stream => stream.codec_name === 'aac'
                    && stream.profile === 'LC' && Number(stream.channels) === Number(audio.channels)
                    && Number(stream.sample_rate) === Number(audio.sample_rate))) throw new Error('recording_processing_failed');
                fs.renameSync(temp, output); return output;
            } finally { fs.rmSync(temp, { force: true }); }
        });
    }
    assemble(names, outputName) {
        return this.job(outputName, async () => {
            const files = names.map(name => this.file(name)), output = this.file(outputName, false);
            this.checkDisk();
            const infos = [];
            for (const file of files) infos.push(await this.probe(file));
            const signature = info => JSON.stringify(info.streams.map(s => [s.codec_type, s.codec_name, s.width, s.height, s.sample_rate, s.channels]));
            if (!infos.length || infos.some(info => signature(info) !== signature(infos[0]))) throw new Error('recording_processing_failed');
            const duration = infos.reduce((sum, info) => sum + Number(info.format.duration), 0);
            if (!Number.isFinite(duration) || duration <= 0) throw new Error('recording_processing_failed');
            const list = path.join(this.root, `${crypto.randomUUID()}.concat`), temp = this.file(`${crypto.randomUUID()}.mp4`, false);
            try {
                fs.writeFileSync(list, files.map(file => `file '${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), { mode: 0o600 });
                await this.execute(this.ffmpeg, ['-nostdin', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
                    '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-movflags', '+faststart', temp]);
                const info = await this.probe(temp);
                const streams = info.streams.filter(s => ['audio', 'video'].includes(s.codec_type));
                const ends = streams.map(s => Number(s.start_time || 0) + Number(s.duration));
                if (Math.abs(Number(info.format.duration) - duration) > 0.2 || ends.some(n => !Number.isFinite(n))
                    || Math.max(...ends) - Math.min(...ends) > 0.15) throw new Error('recording_processing_failed');
                fs.renameSync(temp, output); return output;
            } finally { fs.rmSync(list, { force: true }); fs.rmSync(temp, { force: true }); }
        });
    }
}
module.exports = { RecordingMedia };
