const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.join(__dirname, '../../frontend/public');
function helper() {
    const window = {};
    vm.runInNewContext(fs.readFileSync(path.join(base, 'system-echo.js'), 'utf8'), { window });
    return window.captureWithSystemEcho;
}
function track(setting) {
    return { stopped: false, stop() { this.stopped = true; }, mediaStreamTrack: { getSettings: () => ({ echoCancellation: setting }) } };
}
test('uses exact system reference and verifies it', async () => {
    const capture = helper();
    const result = track('all');
    assert.equal(await capture(async options => {
        assert.equal(options.echoCancellation.exact, 'all');
        assert.equal(options.deviceId, 'mic');
        return result;
    }, { deviceId: 'mic', echoCancellation: true }), result);
});
test('unsupported browsers fall back once and retain other settings', async () => {
    for (const error of [
        { name: 'OverconstrainedError', constraint: 'echoCancellation' },
        { name: 'TypeError' }, { name: 'NotSupportedError' }
    ]) {
        const capture = helper();
        let count = 0;
        const run = async options => {
            count++;
            assert.equal(options.noiseSuppression, false);
            if (options.echoCancellation.exact) throw error;
            return track(true);
        };
        await capture(run, { echoCancellation: true, noiseSuppression: false });
        await capture(run, { echoCancellation: true, noiseSuppression: false });
        assert.equal(count, 3);
    }
});
test('silently ignored mode stops intermediate capture before fallback', async () => {
    const capture = helper();
    const ignored = track(true);
    let count = 0;
    await capture(async options => {
        if (++count === 1) return ignored;
        assert.equal(ignored.stopped, true);
        assert.equal(options.echoCancellation, true);
        return track(true);
    }, { echoCancellation: true });
    assert.equal(count, 2);
});
test('permission and unrelated device errors are never retried by negotiation', async () => {
    for (const error of [
        { name: 'NotAllowedError' }, { name: 'NotReadableError' },
        { name: 'OverconstrainedError', constraint: 'deviceId' }
    ]) {
        let count = 0;
        await assert.rejects(helper()(async () => { count++; throw error; }, { echoCancellation: true }));
        assert.equal(count, 1);
    }
});
test('music/user-disabled AEC is untouched; restart also negotiates', async () => {
    const capture = helper();
    const options = { echoCancellation: false };
    await capture(async actual => { assert.equal(actual, options); }, options);
    await capture(async actual => {
        assert.equal(actual.echoCancellation.exact, 'all');
        return track(undefined); // Processed tracks may not expose raw capture settings.
    }, { echoCancellation: true }, { verify: false });
});
test('Krisp UI defaults and negotiation script ordering', () => {
    const web = fs.readFileSync(path.join(base, 'join.html'), 'utf8');
    assert.match(web, /id="microphone-krisp-preview"[^>]* checked/);
    assert.ok(web.indexOf('/system-echo.js') < web.indexOf('/join.js'));
    const desktop = fs.readFileSync(path.join(__dirname, '../../../renderer/dialogs/broadcast-room.html'), 'utf8');
    assert.match(desktop, /id="host-microphone-krisp-preview"[^>]* checked/);
});
