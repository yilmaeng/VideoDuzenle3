const { createRequire } = require('module');
const root = '/var/www/evd/evd-yayinodasi-server';
const req = createRequire(root + '/package.json');
process.loadEnvFile(root + '/.env');
const config = req('./src/config').loadConfig();
const { RoomServiceClient, EgressClient } = req('livekit-server-sdk');
(async () => {
    const args = [config.livekitUrl.replace(/^ws/, 'http'), config.livekitApiKey, config.livekitApiSecret];
    const rooms = await new RoomServiceClient(...args).listRooms();
    const jobs = await new EgressClient(...args).listEgress({ active: true });
    console.log(JSON.stringify({ occupiedRooms: rooms.filter(room => room.numParticipants > 0).length, activeRecordings: jobs.filter(job => [0,1,2].includes(job.status)).length }));
})().catch(() => { console.error('activity_check_failed'); process.exitCode = 1; });
