// Run explicitly on the deployment host. Does not join or record any user room.
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { createRequire } = require('module');
const app = '/var/www/evd/evd-yayinodasi-server';
const requireApp = createRequire(`${app}/package.json`);
process.loadEnvFile(`${app}/.env`);
const config = requireApp('./src/config').loadConfig();
const id = crypto.randomUUID();
const name = `${id}.mp4`, input = `/tmp/evd-storage-test-${id}`;
const output = `${config.recordingFilesDir}/${name}`;
const env = { ...process.env,
    RCLONE_CONFIG_VERIFY_TYPE: 's3', RCLONE_CONFIG_VERIFY_PROVIDER: 'Other',
    RCLONE_CONFIG_VERIFY_ACCESS_KEY_ID: config.recordingS3.accessKey,
    RCLONE_CONFIG_VERIFY_SECRET_ACCESS_KEY: config.recordingS3.secret,
    RCLONE_CONFIG_VERIFY_ENDPOINT: config.recordingS3.endpoint,
    RCLONE_CONFIG_VERIFY_REGION: config.recordingS3.region,
};
try {
    fs.writeFileSync(input, crypto.randomBytes(12 * 1024 * 1024), { mode: 0o600 });
    execFileSync('/usr/local/bin/evd-rclone', ['copyto', input, `verify:${config.recordingS3.bucket}/${name}`,
        '--config', '/dev/null', '--s3-upload-cutoff', '5Mi', '--s3-chunk-size', '5Mi', '--s3-upload-concurrency', '1'],
        { env, stdio: 'pipe', timeout: 90000 });
    const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (hash(input) !== hash(output)) throw new Error('storage_hash_mismatch');
    console.log('HTTPS authenticated multipart upload: OK; payload hash: OK');
} catch (error) {
    let detail = String(error.stderr || error.message);
    for (const secret of [config.recordingS3.secret, config.recordingS3.accessKey]) detail = detail.split(secret).join('[redacted]');
    detail = detail.replace(/https?:\/\/\S+/g, '[endpoint]');
    console.error('storage_verification_failed', detail.slice(-1600)); process.exitCode = 1;
} finally {
    for (const file of [input, output]) if (fs.existsSync(file)) fs.unlinkSync(file);
}
