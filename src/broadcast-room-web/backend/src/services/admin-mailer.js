function createAdminMailer(config) {
    const ready = Boolean(config.smtpHost && config.smtpFrom && config.smtpUser && config.smtpPassword);
    let transport;
    return {
        ready,
        async send({ email, subject, text }) {
            if (!ready) throw new Error('mail_unavailable');
            transport ||= require('nodemailer').createTransport({ host: config.smtpHost, port: config.smtpPort,
                secure: config.smtpPort === 465, requireTLS: true, auth: { user: config.smtpUser, pass: config.smtpPassword },
                connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
                disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false });
            await transport.sendMail({ from: config.smtpFrom, to: email, subject, text });
        }
    };
}
module.exports = { createAdminMailer };
