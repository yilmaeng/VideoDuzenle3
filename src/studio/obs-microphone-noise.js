const FILTER_NAME = 'EVD RNNoise';
const FILTER_KIND = 'noise_suppress_filter_v2';

async function syncMicrophoneNoise(call, sourceName, enabled, method = 'rnnoise', attenuation = 55) {
    // Disable the other EVD-owned processor first; never stack denoisers.
    if (method === 'deepfilter') {
        await syncMicrophoneNoise(call, sourceName, false);
        return syncOwnedNoise(call, sourceName, enabled, 'EVD DeepFilterNet3',
            'dfn3_noise_suppress_filter', { atten_lim_db: Number.isFinite(attenuation) ? Math.max(0, Math.min(100, attenuation)) : 55, post_filter_beta: 0, adaptive_queue: true });
    }
    await syncOwnedNoise(call, sourceName, false, 'EVD DeepFilterNet3', 'dfn3_noise_suppress_filter', {});
    return syncOwnedNoise(call, sourceName, enabled, FILTER_NAME, FILTER_KIND, { method: 'rnnoise' });
}

async function syncOwnedNoise(call, sourceName, enabled, filterName, filterKind, filterSettings) {
    const { filters = [] } = await call('GetSourceFilterList', { sourceName });
    const owned = filters.find(filter => filter.filterName === filterName);
    if (owned && owned.filterKind !== filterKind) {
        if (enabled) throw new Error('filter_name_conflict');
        return;
    }
    if (!enabled) {
        if (owned && owned.filterEnabled) {
            await call('SetSourceFilterEnabled', { sourceName, filterName, filterEnabled: false });
        }
        return;
    }
    if (!owned) {
        const { sourceFilterKinds = [] } = await call('GetSourceFilterKindList');
        if (!sourceFilterKinds.includes(filterKind)) throw new Error('noise_filter_unavailable');
        await call('CreateSourceFilter', {
            sourceName, filterName, filterKind, filterSettings
        });
    } else {
        await call('SetSourceFilterSettings', {
            sourceName, filterName, filterSettings
        });
    }
    await call('SetSourceFilterEnabled', { sourceName, filterName, filterEnabled: true });
}

module.exports = { syncMicrophoneNoise, FILTER_NAME, FILTER_KIND };
