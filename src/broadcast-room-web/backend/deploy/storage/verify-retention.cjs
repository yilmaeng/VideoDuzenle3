const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const root = '/var/lib/evd-recordings/evd-recordings';
const old = `${root}/${crypto.randomUUID()}.mp4`, fresh = `${root}/${crypto.randomUUID()}.mp4`;
try {
    fs.writeFileSync(old, 'expired synthetic retention fixture', { mode: 0o600 });
    fs.writeFileSync(fresh, 'fresh synthetic retention fixture', { mode: 0o600 });
    const ago = new Date(Date.now() - 8 * 86400000); fs.utimesSync(old, ago, ago);
    execFileSync('systemctl', ['start', 'evd-recording-retention.service']);
    if (fs.existsSync(old) || !fs.existsSync(fresh)) throw new Error('retention_verification_failed');
    console.log('Independent retention timer: expired file deleted, fresh file preserved.');
} finally {
    for (const file of [old, fresh]) if (fs.existsSync(file)) fs.unlinkSync(file);
}
