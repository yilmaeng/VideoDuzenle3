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

async function setMicrophoneDevice(call, inputName, deviceId, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    const current = await call('GetInputSettings', { inputName });
    const changed = current.inputSettings?.device_id !== deviceId;
    if (!changed && current.inputSettings?.use_device_timing === false) return;
    const { filters = [] } = await call('GetSourceFilterList', { sourceName: inputName });
    const active = filters.filter(f => f.filterKind === ASYNC_FILTER && f.filterEnabled);
    if (active.length) {
        if ((await call('GetRecordStatus')).outputActive || (await call('GetStreamStatus')).outputActive) {
            throw new Error('audio_device_change_while_active');
        }
    }
    await call('SetInputSettings', { inputName, inputSettings: { device_id: deviceId, use_device_timing: false }, overlay: true });
    if (!active.length) return;
    // The synchronizer's buffers/clock belong to the old WASAPI device.
    // Toggling enabled alone does not guarantee a new filter instance.
    await wait(500);
    for (const filter of active) {
        await call('RemoveSourceFilter', { sourceName: inputName, filterName: filter.filterName });
        await call('CreateSourceFilter', { sourceName: inputName, filterName: filter.filterName,
            filterKind: filter.filterKind, filterSettings: filter.filterSettings || {} });
        await call('SetSourceFilterIndex', { sourceName: inputName, filterName: filter.filterName, filterIndex: filter.filterIndex });
    }
    await wait(1500);
}

module.exports = { resolveDeviceTiming, syncFilter, setMicrophoneDevice };
