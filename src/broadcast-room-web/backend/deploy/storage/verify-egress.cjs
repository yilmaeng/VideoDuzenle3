// Explicit short smoke test in an isolated, empty room. Never records real participants.
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createRequire } = require('module');
const app = '/var/www/evd/evd-yayinodasi-server';
const requireApp = createRequire(`${app}/package.json`);
process.loadEnvFile(`${app}/.env`);
const config = requireApp('./src/config').loadConfig();
const { RoomServiceClient, EgressClient, EncodedFileOutput, EncodedFileType, S3Upload, EncodingOptionsPreset } = requireApp('livekit-server-sdk');
const url = config.livekitUrl.replace(/^ws/, 'http');
const rooms = new RoomServiceClient(url, config.livekitApiKey, config.livekitApiSecret);
const egress = new EgressClient(url, config.livekitApiKey, config.livekitApiSecret);
const name = `evd-recording-smoke-${crypto.randomUUID()}`, file = `${crypto.randomUUID()}.mp4`;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
    let job, publisher;
    try {
        await rooms.createRoom({ name, emptyTimeout: 120 });
        publisher = spawn('/root/evd-recording-storage-setup/lk', ['room', 'join', '--publish-demo', '--identity', 'evd-synthetic-test', name], { env: process.env, stdio: 'ignore' });
        for (let i = 0; i < 20; i++) {
            if ((await rooms.listParticipants(name)).some(p => p.identity === 'evd-synthetic-test' && p.tracks.length)) break;
            if (i === 19) throw new Error('synthetic_publisher_timeout');
            await wait(1000);
        }
        job = await egress.startRoomCompositeEgress(name, new EncodedFileOutput({ fileType: EncodedFileType.MP4, filepath: file,
            disableManifest: true, output: { case: 's3', value: new S3Upload({ ...config.recordingS3, forcePathStyle: true }) } }),
            { layout: 'grid', encodingOptions: EncodingOptionsPreset.H264_720P_30, audioOnly: false });
        console.log('Isolated Egress job created:', job.egressId);
        for (let i = 0; i < 30; i++) {
            const info = (await egress.listEgress({ egressId: job.egressId }))[0];
            if (info?.status === 1) break;
            if ([4,5,6].includes(info?.status)) throw new Error(`egress_failed_status_${info.status}: ${info.error}`);
            if (i === 29) throw new Error('egress_start_timeout');
            await wait(1000);
        }
        await wait(10000);
        await egress.stopEgress(job.egressId);
        for (let i = 0; i < 24; i++) {
            const result = (await egress.listEgress({ egressId: job.egressId }))[0];
            if (result?.status === 3) {
                const output = `${config.recordingFilesDir}/${file}`;
                console.log('Egress completed; local private MP4 bytes:', fs.statSync(output).size);
                fs.unlinkSync(output); return;
            }
            if ([4,5,6].includes(result?.status)) throw new Error(`egress_failed_status_${result.status}: ${result.error}`);
            await wait(5000);
        }
        throw new Error('egress_verification_timeout');
    } catch (error) {
        // Provider messages may include credentials or signed URLs. Return only the error type/code.
        let detail = String(error.message);
        for (const secret of [config.livekitApiKey, config.livekitApiSecret, config.recordingS3.accessKey, config.recordingS3.secret]) detail = detail.split(secret).join('[redacted]');
        console.error('Egress test failed:', error.code || error.name, detail.replace(/https?:\/\/\S+/g, '[endpoint]').slice(0, 1200)); process.exitCode = 1;
    } finally {
        if (job) try { await egress.stopEgress(job.egressId); } catch (_) {}
        publisher?.kill();
        try { await rooms.deleteRoom(name); } catch (_) {}
    }
})();
