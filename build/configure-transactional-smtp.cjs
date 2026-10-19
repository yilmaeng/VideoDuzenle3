'use strict';
// Run on the deployment server. Credentials arrive over stdin, never argv/logs.
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const readline = require('readline');
const root = path.resolve(process.argv[2] || '.');
const apply = process.argv.includes('--apply');
const testEmail = process.argv.includes('--test-email');
if (process.stdin.isTTY) require('child_process').execFileSync('stty', ['-echo'], { stdio: 'inherit' });
const input = readline.createInterface({ input: process.stdin, terminal: false });
console.log('SMTP_INPUT_READY');
const timeout = setTimeout(() => process.exit(2), 120000);
input.once('line', async line => {
    input.close();
    let transport;
    try {
        const config = JSON.parse(line);
        if (!config.host || !config.user || !config.password || config.port !== 465
            || (apply && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.from || ''))
            || Object.values(config).some(value => /[\r\n\0]/.test(String(value)))) throw new Error('invalid_configuration');
        const requireServer = createRequire(path.join(root, 'package.json'));
        transport = requireServer('nodemailer').createTransport({ host: config.host, port: 465,
            secure: true, requireTLS: true, auth: { user: config.user, pass: config.password },
            connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
            logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true });
        await transport.verify();
        let emailAccepted = false;
        if (testEmail) {
            const result = await transport.sendMail({
                from: config.from,
                to: 'engin_yilmaz@yahoo.com',
                subject: 'EVD e-posta hizmeti denemesi',
                text: 'Bu ileti, onayınız üzerine EVD sunucusundan gönderilen tek seferlik SMTP denemesidir. E-posta hizmeti yalnızca hesap doğrulama, parola yenileme ve davet gibi işlem iletileri için kullanılacaktır. Bu ileti için herhangi bir işlem yapmanız gerekmiyor.'
            });
            emailAccepted = result.accepted.length === 1 && result.rejected.length === 0;
        }
        if (apply) {
            const file = path.join(root, '.env');
            const stat = fs.statSync(file);
            const old = fs.readFileSync(file, 'utf8');
            const updates = { ADMIN_SMTP_HOST: config.host, ADMIN_SMTP_PORT: '465', ADMIN_SMTP_FROM: config.from,
                ADMIN_SMTP_USER: config.user, ADMIN_SMTP_PASSWORD: config.password };
            const lines = old.split(/\r?\n/).filter(value => !Object.keys(updates).some(key => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(value)));
            const result = lines.join('\n').trimEnd() + '\n' + Object.entries(updates).map(([key,value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';
            const backup = `${file}.before-smtp-${Date.now()}`;
            fs.writeFileSync(backup, old, { flag: 'wx', mode: 0o600 });
            const temporary = `${file}.smtp-${process.pid}`;
            fs.writeFileSync(temporary, result, { flag: 'wx', mode: 0o600 });
            fs.chownSync(temporary, stat.uid, stat.gid);
            fs.renameSync(temporary, file);
        }
        console.log(JSON.stringify({ smtpAuthenticated: true, implicitTls: true, configurationSaved: apply, emailSent: emailAccepted }));
        process.exitCode = 0;
    } catch (error) {
        // SMTP errors can contain addresses or authentication dialogue. Never log them verbatim.
        console.log(JSON.stringify({ smtpAuthenticated: false, code: /^[A-Z_]+$/.test(error.code || '') ? error.code : 'CONFIGURATION_FAILED',
            responseCode: Number(error.responseCode) || null,
            envelopeResponse: error.code === 'EENVELOPE' ? String(error.response || '').slice(0, 800) : undefined }));
        process.exitCode = 1;
    } finally { transport?.close(); clearTimeout(timeout); process.stdin.destroy(); }
});
