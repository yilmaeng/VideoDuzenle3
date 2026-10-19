const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { AdminAccountStore } = require('../src/services/admin-account-store');
const { createAdminAuthRouter } = require('../src/routes/admin-auth');
const { createAdminMailer } = require('../src/services/admin-mailer');

function fixture(t, options) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-admin-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'accounts.json');
    return { file, store: new AdminAccountStore(file, options) };
}
test('single-use code creates a verified account, not a room administrator', t => {
    const { store, file } = fixture(t);
    const challenge = store.request(' Person@Example.com ', 'ip');
    assert.equal(store.state.users.length, 0);
    const result = store.verify({ ...challenge, token: undefined, ip: 'ip' });
    assert.equal(result.user.email, 'person@example.com');
    assert.deepEqual(Object.keys(result.user).sort(), ['email', 'id']);
    assert.equal(store.state.users[0].ownerKey, undefined);
    const persisted = fs.readFileSync(file, 'utf8');
    assert.ok(!persisted.includes(challenge.token));
    assert.ok(!persisted.includes(result.session));
    assert.throws(() => store.verify({ ...challenge, ip: 'ip' }), /verification_invalid/);
    const reload = new AdminAccountStore(file);
    assert.deepEqual(reload.session(result.session), result.user);
    reload.logout(result.session);
    assert.equal(reload.session(result.session), null);
});
test('profile name persists for the authenticated account and does not change permissions', t => {
    const { store, file } = fixture(t);
    const result = store.verify({ ...store.request('person@example.com', 'ip'), ip: 'ip' });
    const view = store.updateProfile(result.user.id, ' Engin Yılmaz ');
    assert.equal(view.displayName, 'Engin Yılmaz');
    assert.equal(new AdminAccountStore(file).session(result.session).displayName, 'Engin Yılmaz');
    assert.throws(() => store.updateProfile(result.user.id, ''), /display_name_invalid/);
    assert.throws(() => store.updateProfile('missing', 'Test'), /session_required/);
    assert.equal(view.ownerKey, undefined);
});

test('expired links and sessions are rejected; remembered sessions last 30 days', t => {
    let now = 100000;
    const { store } = fixture(t, { now: () => now });
    const old = store.request('one@example.com', 'ip');
    now += 600001;
    assert.throws(() => store.verify({ ...old, ip: 'ip' }), /verification_invalid/);
    const fresh = store.request('one@example.com', 'ip');
    const result = store.verify({ ...fresh, ip: 'ip', remember: true });
    assert.equal(result.expires - now, 30 * 86400000);
    now = result.expires;
    assert.equal(store.session(result.session), null);
});
test('email requests and code guesses are bounded', t => {
    const { store } = fixture(t);
    const challenge = store.request('one@example.com', 'ip');
    const wrong = challenge.code === '00000000' ? '11111111' : '00000000';
    for (let i = 0; i < 5; i++) assert.throws(() => store.verify({ ...challenge, token: undefined, code: wrong, ip: 'ip' }), /verification_invalid/);
    assert.throws(() => store.verify({ ...challenge, ip: 'ip' }), /verification_invalid/);
    store.request('one@example.com', 'ip');
    store.request('one@example.com', 'ip');
    assert.throws(() => store.request('one@example.com', 'ip'), /rate_limited/);
});
test('new request replaces old code; repeated sign-in retains account identity', t => {
    const { store } = fixture(t);
    const old = store.request('one@example.com', 'ip');
    const current = store.request('one@example.com', 'ip');
    assert.throws(() => store.verify({ ...old, ip: 'ip' }), /verification_invalid/);
    const first = store.verify({ ...current, ip: 'ip' });
    const second = store.verify({ ...store.request('one@example.com', 'ip'), ip: 'ip' });
    assert.equal(first.user.id, second.user.id);
});
test('HTTP flow protects origin, cookies and secrets; supports code/link login and logout', async t => {
    const { store } = fixture(t);
    const messages = [];
    const mailer = { ready: true, send: async message => messages.push(message) };
    const localeDir = path.resolve(__dirname, '../../../locales');
    const app = express();
    app.use('/auth', createAdminAuthRouter({ config: { appBaseUrl: 'https://evd.example.com', localeDir }, store, mailer }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const url = `http://127.0.0.1:${server.address().port}/auth`;
    const post = (route, body, headers = {}) => fetch(url + route, { method: 'POST', headers: { Origin: 'https://evd.example.com', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await post('/request', { email: 'one@example.com' }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal(messages.length, 0);
    const sent = await post('/request', { email: 'one@example.com', lang: 'tr' });
    assert.equal(sent.headers.get('access-control-allow-origin'), null);
    assert.equal(sent.headers.get('cache-control'), 'no-store');
    const data = await sent.json();
    assert.deepEqual(Object.keys(data).sort(), ['challengeId', 'success']);
    const code = messages[0].text.match(/\b\d{8}\b/)[0];
    const verified = await post('/verify', { id: data.challengeId, email: 'one@example.com', code, remember: true });
    assert.equal(verified.status, 200);
    const cookie = verified.headers.get('set-cookie');
    for (const flag of ['__Host-evd-admin=', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=']) assert.ok(cookie.includes(flag));
    const cookieHeader = cookie.split(';')[0];
    assert.equal((await (await fetch(url + '/session', { headers: { Cookie: cookieHeader } })).json()).user.email, 'one@example.com');
    assert.equal((await post('/verify', { id: data.challengeId, email: 'one@example.com', code })).status, 400);
    await post('/logout', {}, { Cookie: cookieHeader });
    assert.equal((await (await fetch(url + '/session', { headers: { Cookie: cookieHeader } })).json()).user, null);
    const linkRequest = await post('/request', { email: 'two@example.com', lang: 'de' });
    assert.equal(linkRequest.status, 200);
    const link = new URL(messages[1].text.match(/https:\/\/\S+/)[0]);
    assert.equal(link.searchParams.get('lang'), 'de');
    const params = new URLSearchParams(link.hash.slice(1));
    assert.equal((await post('/verify', Object.fromEntries(params))).status, 200);
    mailer.send = async () => { throw new Error('SMTP private credentials'); };
    const failed = await post('/request', { email: 'three@example.com' });
    assert.deepEqual(await failed.json(), { error: 'mail_unavailable' });
    assert.equal(store.state.challenges.length, 0);
    mailer.ready = false;
    assert.equal((await post('/request', { email: 'four@example.com' })).status, 503);
});
test('all active locales cover the page and email; mail defaults disabled', () => {
    const root = path.resolve(__dirname, '../../../locales');
    const reference = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'tr.json'), 'utf8')).admin_auth).sort();
    for (const lang of ['tr', 'en', 'de', 'es', 'fr']) {
        const strings = JSON.parse(fs.readFileSync(path.join(root, `${lang}.json`), 'utf8')).admin_auth;
        assert.deepEqual(Object.keys(strings).sort(), reference);
        assert.ok(strings.email_body.includes('{code}') && strings.email_body.includes('{link}'));
        assert.ok(Object.values(strings).every(text => typeof text === 'string' && text.length));
    }
    assert.equal(createAdminMailer({ smtpFrom: 'evdyonetim@drenginyilmaz.net' }).ready, false);
});
test('page labels all fields and uses locale keys; local workspace config resolves locales', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../frontend/public/admin.html'), 'utf8');
    for (const id of ['language', 'email', 'code']) assert.ok(html.includes(`for="${id}"`) && html.includes(`id="${id}"`));
    const strings = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../locales/tr.json'), 'utf8')).admin_auth;
    for (const match of html.matchAll(/data-i18n="([^"]+)"/g)) assert.ok(strings[match[1]], match[1]);
    assert.ok(html.includes('aria-live="polite"'));
    const { loadConfig } = require('../src/config');
    const keys = ['APP_BASE_URL', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'];
    const previous = keys.map(key => process.env[key]);
    try {
        keys.forEach(key => { process.env[key] = 'test'; });
        assert.ok(fs.existsSync(path.join(loadConfig().localeDir, 'tr.json')));
    } finally {
        keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
    }
});
