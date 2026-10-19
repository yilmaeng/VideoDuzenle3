// Local UI-only fixture; never connects to LiveKit or a production account.
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../frontend/public');
const locale = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../locales/tr.json'), 'utf8'));
const state = { webHost: true, participantRole: 'host', participantIdentity: 'host-test', roomConnection: {}, room: { roomId: 'test' },
    participants: [{ identity: 'guest1', displayName: 'Test Konuk', role: 'guest', connected: true }],
    settings: { participantVolumes: {}, allowGuestMicrophone: true, allowGuestCamera: true, allowGuestScreenShare: true } };
const fixture = `const state=${JSON.stringify(state)},locale=${JSON.stringify(locale)};
const t=key=>key.split('.').reduce((v,k)=>v?.[k],locale)||key;
document.querySelectorAll('[data-i18n]').forEach(n=>n.textContent=t(n.dataset.i18n));
EvdWebHost.init({t,state:()=>state,apply:async result=>{Object.assign(state,result);EvdWebHost.update(result)}});
EvdWebHost.update(state);`;
const server = http.createServer((req, res) => {
    if (req.url === '/') {
        const html = fs.readFileSync(path.join(root, 'join.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '')
            .replace('</body>', '<script src="/yayinodasi/web-host.js"></script><script src="/fixture.js"></script></body>');
        res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html);
    }
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fixture); }
    if (req.method === 'POST' && req.url.startsWith('/api/admin-auth/meeting/test/')) {
        let input = ''; req.on('data', data => input += data); req.on('end', () => {
            const body = JSON.parse(input), action = req.url.split('/').pop();
            if (action === 'volume') state.settings.participantVolumes[body.identity] = body.value;
            if (action === 'permissions') state.settings[body.key] = body.value;
            if (action === 'participant' && body.operation === 'spotlight') state.participants[0].spotlighted = body.value;
            if (action === 'remove') state.participants = [];
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: true, participants: state.participants, settings: state.settings }));
        }); return;
    }
    const name = req.url.split('?')[0].replace('/yayinodasi/', '');
    if (['join.css', 'web-host.js'].includes(name)) {
        res.setHeader('Content-Type', name.endsWith('css') ? 'text/css' : 'application/javascript'); return res.end(fs.readFileSync(path.join(root, name)));
    }
    res.statusCode = 404; res.end();
});
server.listen(Number(process.env.EVD_PREVIEW_PORT || 4321), '127.0.0.1', () => console.log(`UI fixture: http://127.0.0.1:${server.address().port}`));
