const test = require('node:test');
const assert = require('node:assert/strict');
const { syncMicrophoneNoise, FILTER_NAME, FILTER_KIND } = require('../studio/obs-microphone-noise');

function mock(filters = [], available = true) {
    const calls = [];
    return {
        calls,
        call: async (method, args) => {
            calls.push({ method, args });
            assert.equal(args?.sourceName || 'Mic', 'Mic');
            if (method === 'GetSourceFilterList') return { filters };
            if (method === 'GetSourceFilterKindList') return { sourceFilterKinds: available ? [FILTER_KIND] : [] };
            return {};
        }
    };
}

test('default off creates nothing and preserves other filters', async () => {
    const m = mock([{ filterName: 'User noise', filterKind: FILTER_KIND, filterEnabled: true },
        { filterName: 'Audio stability', filterKind: 'net.nagater.obs.asynchronous-audio-filter', filterEnabled: true }]);
    await syncMicrophoneNoise(m.call, 'Mic', false);
    assert.deepEqual(m.calls.map(c => c.method), ['GetSourceFilterList', 'GetSourceFilterList']);
});

test('enabling creates only RNNoise on the selected microphone', async () => {
    const m = mock();
    await syncMicrophoneNoise(m.call, 'Mic', true);
    const created = m.calls.find(c => c.method === 'CreateSourceFilter').args;
    assert.equal(created.filterKind, FILTER_KIND);
    assert.deepEqual(created.filterSettings, { method: 'rnnoise' });
    assert.equal(created.filterName, FILTER_NAME);
    assert.equal(m.calls.at(-1).args.filterEnabled, true);
});

test('existing managed filter is updated without duplicating or reordering', async () => {
    const m = mock([{ filterName: FILTER_NAME, filterKind: FILTER_KIND, filterEnabled: false }]);
    await syncMicrophoneNoise(m.call, 'Mic', true);
    assert.deepEqual(m.calls.map(c => c.method), [
        'GetSourceFilterList', 'GetSourceFilterList', 'SetSourceFilterSettings', 'SetSourceFilterEnabled'
    ]);
});

test('disabling touches only the managed filter', async () => {
    const m = mock([{ filterName: FILTER_NAME, filterKind: FILTER_KIND, filterEnabled: true }]);
    await syncMicrophoneNoise(m.call, 'Mic', false);
    assert.equal(m.calls.at(-1).method, 'SetSourceFilterEnabled');
    assert.equal(m.calls.at(-1).args.filterEnabled, false);
});

test('unsupported filter and name collision fail safely', async () => {
    const missing = mock([], false);
    await assert.rejects(syncMicrophoneNoise(missing.call, 'Mic', true), /noise_filter_unavailable/);
    const conflict = mock([{ filterName: FILTER_NAME, filterKind: 'gain_filter' }]);
    await assert.rejects(syncMicrophoneNoise(conflict.call, 'Mic', true), /filter_name_conflict/);
    assert.equal(conflict.calls.length, 2);
});

test('DeepFilter uses moderate settings and disables RNNoise first', async () => {
    const m = mock([{ filterName: FILTER_NAME, filterKind: FILTER_KIND, filterEnabled: true },
        { filterName: 'EVD DeepFilterNet3', filterKind: 'dfn3_noise_suppress_filter', filterEnabled: false }]);
    await syncMicrophoneNoise(m.call, 'Mic', true, 'deepfilter');
    const disable = m.calls.findIndex(c => c.method === 'SetSourceFilterEnabled' && c.args.filterName === FILTER_NAME);
    const enable = m.calls.findIndex(c => c.method === 'SetSourceFilterEnabled' && c.args.filterName === 'EVD DeepFilterNet3' && c.args.filterEnabled);
    assert.ok(disable >= 0 && enable > disable);
    assert.deepEqual(m.calls.find(c => c.method === 'SetSourceFilterSettings').args.filterSettings,
        { atten_lim_db: 55, post_filter_beta: 0, adaptive_queue: true });
});

test('DeepFilter accepts lighter reduction and bounds invalid values', async () => {
    for (const [value, expected] of [[20, 20], [0, 0], [-5, 0], [150, 100], [NaN, 55]]) {
        const m = mock([{ filterName: 'EVD DeepFilterNet3', filterKind: 'dfn3_noise_suppress_filter', filterEnabled: false }]);
        await syncMicrophoneNoise(m.call, 'Mic', true, 'deepfilter', value);
        assert.equal(m.calls.find(c => c.method === 'SetSourceFilterSettings').args.filterSettings.atten_lim_db, expected);
    }
});
