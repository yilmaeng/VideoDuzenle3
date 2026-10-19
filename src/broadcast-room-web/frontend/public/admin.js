(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const api = '/api/admin-auth';
    const supported = ['tr', 'en', 'de', 'es', 'fr'];
    let lang = new URLSearchParams(location.search).get('lang') || navigator.language.split('-')[0];
    if (!supported.includes(lang)) lang = 'tr';
    let strings = {}, challengeId = '', email = '', user = null, enabled = false, busy = false, statusKey = '';
    const fragment = new URLSearchParams(location.hash.slice(1));
    let link = fragment.has('id') && fragment.has('token') ? { id: fragment.get('id'), token: fragment.get('token') } : null;
    // Keep sign-in tokens out of browser history, storage and subsequent URLs.
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    const t = key => strings[key] || key;
    function status(key) { statusKey = key; $('status').textContent = key ? t(key) : ''; }
    function render() {
        const heading = user ? (user.displayName || user.email) : t('title');
        $('page-heading').textContent = heading; document.title = heading;
        $('profile-form').hidden = !user || !!user.passwordChangeRequired;
        if (document.activeElement !== $('profile-name')) $('profile-name').value = user?.displayName || '';
        $('login').hidden = !!user;
        $('account').hidden = !user;
        $('password-change-form').hidden = !user?.passwordChangeRequired;
        $('room-dashboard').hidden = !!user?.passwordChangeRequired;
        $('email-form').hidden = !!link || !!challengeId;
        $('code-form').hidden = !!link || !challengeId;
        $('link-panel').hidden = !link;
        $('account-email').textContent = user?.email || '';
        document.querySelectorAll('button').forEach(button => {
            if (button.closest('#recording-panel')) return;
            button.disabled = busy || (!enabled && (button.closest('#email-form') || button.id === 'resend'));
        });
        $('language').disabled = busy;
    }
    async function request(path, body) {
        const response = await fetch(api + path, { credentials: 'same-origin', cache: 'no-store',
            ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'request_failed');
        return result;
    }
    async function action(work) {
        if (busy) return;
        busy = true; status('working'); render();
        try { await work(); } catch (error) {
            status(['email_invalid', 'rate_limited', 'verification_invalid', 'mail_unavailable', 'credentials_invalid', 'password_policy', 'password_mismatch', 'display_name_invalid'].includes(error.message) ? error.message : 'request_failed');
        } finally { busy = false; render(); }
    }
    async function locale(value) {
        const response = await fetch('/api/i18n/' + value, { cache: 'no-store' });
        if (!response.ok) throw new Error('locale_unavailable');
        const next = (await response.json()).admin_auth;
        if (!next?.title) throw new Error('locale_unavailable');
        strings = next; lang = value;
        document.documentElement.lang = lang; document.title = t('title'); $('language').value = lang;
        document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
        status(statusKey);
        window.EvdAdminRooms?.translate();
        window.EvdAdminRecordings?.translate();
        window.EvdAdminManagers?.translate();
    }
    async function send() {
        const result = await request('/request', { email, lang });
        challengeId = result.challengeId; $('code').value = ''; status('sent'); render(); $('code').focus();
    }
    async function verify(payload) {
        const result = await request('/verify', { ...payload, remember: $('remember').checked });
        user = result.user; link = null; challengeId = ''; $('code').value = ''; status('signed_in');
        render(); $('account-heading').focus();
        if (user.passwordChangeRequired) { $('new-password').focus(); return; }
        await window.EvdAdminRooms.start({ t, request, status });
        await window.EvdAdminManagers.start({ t, request });
        await window.EvdAdminRecordings.start({ t, request });
    }
    $('email-form').addEventListener('submit', event => {
        event.preventDefault(); email = $('email').value.trim(); action(send);
    });
    $('profile-form').addEventListener('submit', event => {
        event.preventDefault();
        const displayName = $('profile-name').value;
        action(async () => { user = (await request('/profile', { displayName })).user; status('profile_saved'); });
    });
    async function passwordSignedIn(result) {
        user = result.user; link = null; challengeId = ''; render();
        status(user.passwordChangeRequired ? 'password_change_required' : 'signed_in');
        if (user.passwordChangeRequired) { $('new-password').focus(); return; }
        $('account-heading').focus();
        await window.EvdAdminRooms.start({ t, request, status });
        await window.EvdAdminManagers.start({ t, request });
        await window.EvdAdminRecordings.start({ t, request });
    }
    $('password-login-form').addEventListener('submit', event => {
        event.preventDefault(); action(async () => {
            const password = $('login-password').value;
            $('login-password').value = '';
            await passwordSignedIn(await request('/password-login', { email: $('password-email').value, password, remember: $('remember').checked }));
        });
    });
    $('password-change-form').addEventListener('submit', event => {
        event.preventDefault(); action(async () => {
            if ($('new-password').value !== $('new-password-repeat').value) throw new Error('password_mismatch');
            const result = await request('/password-change', { password: $('new-password').value });
            $('new-password').value = ''; $('new-password-repeat').value = '';
            await passwordSignedIn(result);
        });
    });
    $('code-form').addEventListener('submit', event => {
        event.preventDefault(); action(() => verify({ id: challengeId, code: $('code').value.trim(), email }));
    });
    $('resend').addEventListener('click', () => action(send));
    $('verify-link').addEventListener('click', () => action(() => verify(link)));
    $('restart').addEventListener('click', () => { link = null; challengeId = ''; status(''); render(); $('email').focus(); });
    $('change-email').addEventListener('click', () => { challengeId = ''; $('code').value = ''; status(''); render(); $('email').focus(); });
    $('logout').addEventListener('click', () => action(async () => {
        await request('/logout', {}); user = null; window.EvdAdminRooms.clear(); window.EvdAdminRecordings.clear(); window.EvdAdminManagers.clear(); status('signed_out'); render(); $('email').focus();
    }));
    $('language').addEventListener('change', () => {
        const previousStatus = statusKey;
        action(async () => { await locale($('language').value); status(previousStatus); });
    });
    // Standard Tab/Enter form navigation; no desktop keyboard-manager action is needed for this web-only page.
    (async () => {
        await locale(lang);
        const config = await request('/config'); enabled = config.emailEnabled;
        user = (await request('/session')).user;
        if (user) link = null;
        render();
        if (user && !user.passwordChangeRequired) await window.EvdAdminRooms.start({ t, request, status });
        if (user && !user.passwordChangeRequired) await window.EvdAdminManagers.start({ t, request });
        if (user && !user.passwordChangeRequired) await window.EvdAdminRecordings.start({ t, request });
        if (user?.passwordChangeRequired) { status('password_change_required'); $('new-password').focus(); }
        if (!enabled && !user) status('mail_unavailable');
    })().catch(() => { status('request_failed'); });
})();
