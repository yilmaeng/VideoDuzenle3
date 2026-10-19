'use strict';

const ASYNC_FILTER = 'net.nagater.obs.asynchronous-audio-filter';

async function resolveDeviceTiming(call, inputName, requestedTiming) {
    // The optional asynchronous filter expects WASAPI timestamps based on OBS
    // time. Preserve an explicitly enabled filter without enabling it globally.
    const result = await call('GetSourceFilterList', { sourceName: inputName });
    const active = (result.filters || []).some(filter =>
        filter.filterKind === ASYNC_FILTER && filter.filterEnabled === true);
    return active ? false : !!requestedTiming;
}

async function syncFilter(call, inputName, enabled, filterName) {
    const { filters = [] } = await call('GetSourceFilterList', { sourceName: inputName });
    const existing = filters.filter(f => f.filterKind === ASYNC_FILTER);
    if (enabled && !existing.length) {
        const { sourceFilterKinds = [] } = await call('GetSourceFilterKindList');
        if (!sourceFilterKinds.includes(ASYNC_FILTER)) throw new Error('plugin_missing');
        await call('CreateSourceFilter', { sourceName: inputName, filterName, filterKind: ASYNC_FILTER, filterSettings: {} });
    }
    for (const filter of existing) if (filter.filterEnabled !== enabled) {
        await call('SetSourceFilterEnabled', { sourceName: inputName, filterName: filter.filterName, filterEnabled: enabled });
    }
}

module.exports = { resolveDeviceTiming, syncFilter };
