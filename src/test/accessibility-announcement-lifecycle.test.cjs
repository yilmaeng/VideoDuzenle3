const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
    let now = 0, next = 0;
    const timers = new Map();
    const element = () => ({ textContent: '', setAttribute() {} });
    const polite = element(), alert = element(), local = element();
    const context = {
        window: {}, console: { log() {} },
        document: { querySelector: () => null, querySelectorAll: () => [local] },
        setTimeout(callback, delay) { const id = ++next; timers.set(id, { callback, time: now + delay }); return id; },
        clearTimeout(id) { timers.delete(id); }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/scripts/accessibility.js'), 'utf8'), context);
    const api = context.window.Accessibility;
    api.announcer = polite; api.alerter = alert;
    function advance(ms) {
        const end = now + ms;
        while (true) {
            const entry = [...timers].filter(([, timer]) => timer.time <= end).sort((a, b) => a[1].time - b[1].time)[0];
            if (!entry) break;
            timers.delete(entry[0]); now = entry[1].time; entry[1].callback();
        }
        now = end;
    }
    return { api, polite, alert, local, advance };
}

test('file-open metadata expires instead of resurfacing after a modal closes', () => {
    const { api, alert, advance } = setup();
    api.announceImmediate('video.mp4 opened. Duration: 00:01:17.343');
    advance(100); assert.match(alert.textContent, /17.343/);
    advance(8000); assert.equal(alert.textContent, '');
});

test('cleanup result clears file metadata and all pending delayed announcements', () => {
    const { api, polite, alert, local, advance } = setup();
    api.announceImmediate('old file duration'); advance(100);
    api.announce('old paused state'); api.announceDialogMessage('old question');
    local.textContent = 'old local message';
    api.clearPending(); advance(10000);
    assert.equal(alert.textContent, ''); assert.equal(polite.textContent, ''); assert.equal(local.textContent, '');
});

test('expired immediate announcement does not erase a newer alert', () => {
    const { api, alert, advance } = setup();
    api.announceImmediate('old file duration'); advance(7000);
    api.alert('new result'); advance(1100);
    assert.match(alert.textContent, /new result/);
});

test('immediate announcement uses the current modal target', () => {
    const { api, alert, local, advance } = setup();
    api._getTarget = () => local;
    api.announceImmediate('result'); advance(100);
    assert.equal(local.textContent, 'result'); assert.equal(alert.textContent, '');
    advance(8000); assert.equal(local.textContent, '');
});
