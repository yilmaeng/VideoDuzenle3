const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../frontend/public/admin-recordings.js'), 'utf8');

function fixture() {
    const nodes = new Map(), calls = [];
    const document = { documentElement: { lang: 'en' }, hidden: false, activeElement: null };
    function make() {
        return { children: [], dataset: {}, events: {}, attributes: {}, value: '', checked: false, hidden: false, disabled: false, isConnected: true, textContent: '',
            append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } },
            replaceChildren(...items) { this.children = []; this.append(...items); if (items[0]?.value) this.value = items[0].value; },
            setAttribute(k, v) { this.attributes[k] = v; }, getAttribute(k) { return this.attributes[k]; },
            removeAttribute(k) { delete this.attributes[k]; },
            addEventListener(k, v) { this.events[k] = v; }, focus() { document.activeElement = this; },
            showModal() { this.open = true; }, close() { this.open = false; },
            remove() { this.parent.children = this.parent.children.filter(item => item !== this); this.isConnected = false; for (const child of this.children) child.isConnected = false; }
        };
    }
    const node = id => { if (!nodes.has(id)) nodes.set(id, make()); return nodes.get(id); };
    document.getElementById = node; document.createElement = make;
    const row = { id: 'one', roomId: 'room', title: 'Meeting', status: 'complete', canDelete: true, createdAt: 1, expiresAt: 10000 };
    const consent = { key: 'meeting-one', confirmed: false };
    const window = {};
    vm.runInNewContext(source, { document, window, setInterval: () => 1, clearInterval() {} });
    const context = { t: key => key === 'recording_delete_confirmation' ? 'Delete {name}?' : key,
        async request(route, body) {
            calls.push({ route, body });
            if (route.endsWith('/delete')) row.status = 'deleted';
            return { enabled: true, recordings: [{ ...row }], recordingConsent: { room: { ...consent } } };
        }
    };
    return { node, document, window, row, consent, calls, async start() {
        await window.EvdAdminRecordings.start(context);
        window.EvdAdminRecordings.setRooms([{ roomId: 'room', title: 'Meeting', accessRole: 'owner' }]);
    } };
}

test('delete uses accessible confirmation, supports cancel and restores useful focus after removal', async () => {
    const f = fixture(); await f.start();
    const button = f.node('recording-list').children[0].children[7];
    assert.equal(button.hidden, false);
    button.events.click();
    assert.equal(f.node('recording-delete-dialog').open, true);
    assert.equal(f.document.activeElement, f.node('recording-delete-description'));
    assert.ok(f.node('recording-delete-description').textContent.includes('Meeting'));
    f.node('recording-delete-cancel').events.click();
    assert.equal(f.calls.some(call => call.route.endsWith('/delete')), false);
    assert.equal(f.document.activeElement, button);
    button.events.click(); await f.node('recording-delete-confirm').events.click();
    assert.equal(f.calls.find(call => call.route.endsWith('/delete')).body.confirm, true);
    assert.equal(f.node('recording-list').children.length, 0);
    assert.equal(f.document.activeElement, f.node('recording-refresh'));
    assert.equal(f.node('recording-delete-dialog').open, false);
});

test('admin confirmation follows server meeting and deletion respects owner and running state', async () => {
    const f = fixture(); await f.start();
    f.consent.confirmed = true; await f.start();
    assert.equal(f.node('recording-consent').checked, true);
    f.consent.key = 'meeting-two'; f.consent.confirmed = false; await f.start();
    assert.equal(f.node('recording-consent').checked, false);
    f.row.canDelete = false; await f.start();
    assert.equal(f.node('recording-list').children[0].children[7].hidden, true);
    f.row.canDelete = true; f.row.status = 'active'; await f.start();
    assert.equal(f.node('recording-list').children[0].children[7].disabled, true);
});

test('available recording offers a visible-tab native preview as well as download', async () => {
    const f = fixture(); f.row.available = true; await f.start();
    const item = f.node('recording-list').children[0];
    assert.equal(item.children[3].getAttribute('target'), '_blank');
    assert.equal(item.children[8].hidden, false);
    assert.equal(item.children[8].getAttribute('target'), '_blank');
    assert.ok(item.children[8].getAttribute('href').endsWith('&view=1'));
});
