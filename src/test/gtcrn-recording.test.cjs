const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepareTracks, waitForFinalizedRecording } = require('../studio/gtcrn-recording');

function mock(failure) {
    const original = { '1': true, '2': true, '3': true, '4': true, '5': true, '6': true };
    const tracks = { Mic: { ...original }, Desktop: { ...original } };
    const params = { 'Output/Mode': 'Simple', 'SimpleOutput/RecQuality': 'Stream', 'SimpleOutput/RecTracks': '1', 'SimpleOutput/RecFormat': 'mp4', 'SimpleOutput/RecFormat2': 'mp4' };
    let current = 'Original', failed = false;
    const profileNames = ['Original'];
    const calls = [];
    const call = async (name, data = {}) => {
        calls.push({ name, data });
        if (failure === name && !failed) { failed = true; throw new Error('test failure'); }
        if (['GetStreamStatus', 'GetRecordStatus', 'GetReplayBufferStatus'].includes(name)) return { outputActive: false };
        if (name === 'GetProfileList') return { currentProfileName: current, profiles: [...profileNames] };
        if (name === 'CreateProfile') {
            assert.ok(!profileNames.includes(data.profileName));
            profileNames.push(data.profileName);
            current = data.profileName;
            return {};
        }
        if (name === 'SetCurrentProfile') {
            assert.ok(profileNames.includes(data.profileName));
            current = data.profileName;
            return {};
        }
        if (name === 'RemoveProfile') throw new Error('Profile deletion must never open an OBS confirmation');
        const key = `${data.parameterCategory}/${data.parameterName}`;
        if (name === 'GetProfileParameter') return { parameterValue: params[key] };
        if (name === 'SetProfileParameter') { params[key] = data.parameterValue; return {}; }
        if (name === 'GetInputList') return { inputs: [{ inputName: 'Mic' }, { inputName: 'Desktop' }] };
        if (name === 'GetInputAudioTracks') return { inputAudioTracks: { ...tracks[data.inputName] } };
        if (name === 'SetInputAudioTracks') { tracks[data.inputName] = { ...data.inputAudioTracks }; return {}; }
        throw new Error(name);
    };
    return { call, params, tracks, original, calls, profileNames };
}

test('separates microphone and system, preserving and restoring all original track settings', async () => {
    const m = mock();
    const session = await prepareTracks(m.call, 'Mic');
    assert.equal(m.tracks.Mic['2'], true);
    assert.equal(m.tracks.Mic['3'], false);
    assert.equal(m.tracks.Desktop['2'], false);
    assert.equal(m.tracks.Desktop['3'], true);
    assert.equal(m.params['SimpleOutput/RecTracks'], '7');
    await session.restore();
    assert.deepEqual(m.tracks.Mic, m.original);
    assert.deepEqual(m.tracks.Desktop, m.original);
    assert.equal(m.params['SimpleOutput/RecTracks'], '1');
    assert.equal(m.params['SimpleOutput/RecQuality'], 'Stream');
    assert.equal(m.params['SimpleOutput/RecFormat2'], 'mp4');
});

test('failed setup rolls back profile and source settings', async () => {
    const m = mock('SetInputAudioTracks');
    await assert.rejects(prepareTracks(m.call, 'Mic'));
    assert.deepEqual(m.tracks.Mic, m.original);
    assert.equal(m.params['SimpleOutput/RecTracks'], '1');
});

test('missing mic does not leave a modified recording profile', async () => {
    const m = mock();
    await assert.rejects(prepareTracks(m.call, 'Missing'));
    assert.equal(m.params['SimpleOutput/RecQuality'], 'Stream');
    assert.deepEqual(m.tracks.Desktop, m.original);
});

test('reuses one helper across recordings without requesting profile deletion', async () => {
    const m = mock();
    for (let i = 0; i < 3; i++) {
        const session = await prepareTracks(m.call, 'Mic');
        await session.restore();
        assert.equal((await m.call('GetProfileList')).currentProfileName, 'Original');
    }
    assert.equal(m.calls.filter(c => c.name === 'CreateProfile').length, 1);
    assert.equal(m.calls.filter(c => c.name === 'RemoveProfile').length, 0);
    assert.deepEqual(m.profileNames, ['Original', 'EVD-GTCRN-Reload']);
});

test('waits for final duration and a stable file before processing', async () => {
    let calls = 0;
    const streams = Array.from({ length: 3 }, () => ({ codec_type: 'audio' }));
    const info = await waitForFinalizedRecording(async () => {
        calls++;
        return { streams, format: calls < 3 ? {} : { duration: '24.166' } };
    }, async () => ({ size: calls < 4 ? calls * 100 : 400, mtimeMs: 1 }), async () => {});
    assert.equal(info.format.duration, '24.166');
    assert.equal(calls, 6);
});

test('never processes an ordinary single-track recording as an isolated microphone', async () => {
    await assert.rejects(waitForFinalizedRecording(async () => ({ streams: [{ codec_type: 'audio' }], format: { duration: 10 } }),
        async () => ({ size: 100, mtimeMs: 1 }), async () => {}), /missing_tracks/);
});
