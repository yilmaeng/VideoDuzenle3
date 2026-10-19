(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    // The bearer link never appears in API URLs, referrers, logs or persistent browser storage.
    const token = location.hash.slice(1);
    const formats = location.search ? new URLSearchParams(location.search).getAll('format') : [];
    const preferredFormat = formats.length === 1 && ['mp4', 'm4a'].includes(formats[0]) ? formats[0] : '';
    history.replaceState(null, '', location.pathname + location.search);
    let strings = {}, busy = false, signature = '', language = navigator.language.split('-')[0];
    const t = key => strings[key] || key;
    async function translate(lang) {
        language = ['tr','en','de','es','fr'].includes(lang) ? lang : 'tr';
        strings = (await (await fetch('/api/i18n/' + language)).json()).admin_auth;
        document.documentElement.lang = language; document.title = t('recordings_title'); $('language').value = language;
        document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
        signature = ''; await refresh();
    }
    async function refresh() {
        if (busy) return; busy = true; $('refresh').disabled = true;
        try {
            const response = await fetch('/api/meeting-access/shared/list', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            const next = JSON.stringify(result.recordings);
            if (next !== signature) {
                signature = next;
                $('recordings').replaceChildren(...result.recordings.map(row => {
                    const item = document.createElement('li'), text = document.createElement('p');
                    text.textContent = `${row.title}: ${t('recording_' + row.status)}. ${t('recording_expires').replace('{date}', new Date(row.expiresAt).toLocaleString(document.documentElement.lang))}`; item.append(text);
                    if (row.available) {
                        // Keep referrer/opener protection: shared downloads authorize the body token, not Origin or cookies.
                        const form = document.createElement('form'); form.method = 'post'; form.action = '/api/meeting-access/shared/download'; form.target = '_blank'; form.rel = 'noopener noreferrer';
                        for (const [name, value] of Object.entries({ token, id: row.id, lang: language })) { const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.append(input); }
                        const button = document.createElement('button'); button.type = 'submit'; button.textContent = t('recording_download'); button.setAttribute('aria-label', `${t('recording_download')}: ${row.title}`);
                        const audio = document.createElement('button'); audio.type = 'submit'; audio.name = 'format'; audio.value = 'm4a';
                        audio.textContent = t('recording_download_m4a'); audio.setAttribute('aria-label', `${t('recording_download_m4a')}: ${row.title}`);
                        // Native submitter values keep MP4 as the default and the bearer token out of URLs.
                        if (preferredFormat !== 'm4a') form.append(button);
                        if (preferredFormat !== 'mp4') form.append(audio);
                        item.append(form);
                    }
                    return item;
                }));
            }
            $('message').textContent = result.recordings.length ? '' : t('recording_share_empty');
        } catch (error) {
            $('recordings').replaceChildren(); signature = '';
            $('message').textContent = t(error.message === 'recording_link_invalid' ? 'recording_link_invalid' : 'request_failed');
        } finally { busy = false; $('refresh').disabled = false; }
    }
    $('refresh').addEventListener('click', refresh);
    $('language').addEventListener('change', () => translate($('language').value));
    // Explicit refresh preserves focus and avoids repeatedly announcing an updating list.
    translate(language).catch(() => { $('message').textContent = 'EVD'; });
})();
