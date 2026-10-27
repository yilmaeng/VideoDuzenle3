const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setMicrophoneDevice } = require('../studio/obs-audio-timing');
const filter = { filterKind: 'net.nagater.obs.asynchronous-audio-filter', filterName: 'Timing', filterEnabled: true, filterIndex: 0, filterSettings: { custom: 1 } };
function mock(device, active = false) {
    const calls = [];
    const call = async (method, args) => {
        calls.push({ method, args });
        if (method === 'GetInputSettings') return { inputSettings: { device_id: device, use_device_timing: false } };
        if (method === 'GetSourceFilterList') return { filters: [filter, { filterKind: 'dfn3_noise_suppress_filter', filterEnabled: true }] };
        if (method === 'GetRecordStatus' || method === 'GetStreamStatus') return { outputActive: active };
        return {};
    };
    return { calls, call };
}
test('unchanged microphone leaves capture and filters untouched', async () => {
    const m = mock('physical');
    await setMicrophoneDevice(m.call, 'Mic', 'physical', async () => {});
    assert.deepEqual(m.calls.map(c => c.method), ['GetInputSettings']);
});
test('device change recreates only the timing filter, preserving settings and order', async () => {
    const m = mock('krisp');
    await setMicrophoneDevice(m.call, 'Mic', 'physical', async () => {});
    assert.equal(m.calls.filter(c => c.method === 'CreateSourceFilter').length, 1);
    assert.deepEqual(m.calls.find(c => c.method === 'CreateSourceFilter').args.filterSettings, filter.filterSettings);
    assert.equal(m.calls.find(c => c.method === 'SetSourceFilterIndex').args.filterIndex, 0);
    assert.equal(m.calls.find(c => c.method === 'SetInputSettings').args.inputSettings.device_id, 'physical');
});
test('active recording cannot have its synchronizer replaced', async () => {
    const m = mock('krisp', true);
    await assert.rejects(setMicrophoneDevice(m.call, 'Mic', 'physical'), /while_active/);
    assert.ok(!m.calls.some(c => c.method.startsWith('Set') || c.method.startsWith('Remove')));
});
