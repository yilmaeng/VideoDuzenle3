const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/public/recordings.js'), 'utf8');

for (const [search, expected] of [
    ['', ['mp4', 'm4a']], ['?format=mp4', ['mp4']], ['?format=m4a', ['m4a']],
    ['?format=bad', ['mp4', 'm4a']], ['?format=', ['mp4', 'm4a']],
    ['?format=mp4&format=m4a', ['mp4', 'm4a']], ['?format=M4A', ['mp4', 'm4a']],
    ['?format=%6d4a', ['m4a']]
]) test(`shared format ${search || '(legacy)'} keeps token private and renders expected actions`, async () => {
    const nodes = new Map(), calls = [], historyCalls = [];
    const make = tag => ({ tag, children: [], events: {}, attributes: {},
        append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
        setAttribute(k, v) { this.attributes[k] = v; }, addEventListener(k, fn) { this.events[k] = fn; }
    });
    const node = id => { if (!nodes.has(id)) nodes.set(id, make()); return nodes.get(id); };
    const document = { documentElement: {}, getElementById: node, createElement: make, querySelectorAll: () => [] };
    const fetch = async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => url.startsWith('/api/i18n/') ? { admin_auth: {} } : { recordings: [{ id: 'one', title: 'Meeting', status: 'complete', available: true, expiresAt: 10000 }] } };
    };
    vm.runInNewContext(source, { document, fetch, URLSearchParams, navigator: { language: 'en' },
        location: { hash: '#private-bearer', pathname: '/recordings.html', search },
        history: { replaceState: (...args) => historyCalls.push(args) } });
    await new Promise(resolve => setImmediate(resolve));
    const form = node('recordings').children[0].children[1];
    assert.deepEqual(Array.from(form.children.filter(child => child.tag === 'button'), child => child.value || 'mp4'), expected);
    assert.equal(form.method, 'post');
    assert.equal(form.action, '/api/meeting-access/shared/download');
    assert.equal(form.children.find(child => child.name === 'token').value, 'private-bearer');
    assert.ok(form.children.filter(child => child.tag === 'button').every(child => child.attributes['aria-label'].includes('Meeting')));
    assert.ok(calls.every(call => !call.url.includes('private-bearer')));
    assert.equal(JSON.parse(calls.find(call => call.url.endsWith('/shared/list')).options.body).token, 'private-bearer');
    assert.equal(historyCalls[0][2], '/recordings.html' + search);
});
