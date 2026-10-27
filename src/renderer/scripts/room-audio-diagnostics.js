(function (root) {
    // Counters only: never record audio, tokens, SDP or network addresses.
    root.sampleRoomAudioDiagnostics = function (track, report, context = () => ({})) {
        const previous = new Map();
        for (const delay of [1000, 5000, 12000]) {
            setTimeout(async () => {
                if (track?.mediaStreamTrack?.readyState === 'ended') return;
                try {
                    const stats = await track?.getRTCStatsReport?.();
                    const rows = [];
                    stats?.forEach(stat => {
                        if (!['inbound-rtp', 'outbound-rtp', 'media-source', 'track'].includes(stat.type)) return;
                        if ((stat.kind || stat.mediaType) && (stat.kind || stat.mediaType) !== 'audio') return;
                        const row = { type: stat.type };
                        const before = previous.get(stat.id) || {};
                        for (const key of ['packetsReceived', 'packetsSent', 'bytesReceived', 'bytesSent',
                            'totalAudioEnergy', 'totalSamplesDuration', 'audioLevel', 'packetsLost',
                            'concealedSamples', 'silentConcealedSamples']) {
                            if (typeof stat[key] !== 'number') continue;
                            row[key] = stat[key];
                            if (key !== 'audioLevel' && typeof before[key] === 'number') row[`${key}Delta`] = stat[key] - before[key];
                        }
                        previous.set(stat.id, row);
                        rows.push(row);
                    });
                    report({
                        sampleAfterMs: delay, statsAvailable: !!stats, rows,
                        enabled: track?.mediaStreamTrack?.enabled,
                        muted: track?.isMuted, readyState: track?.mediaStreamTrack?.readyState,
                        processor: track?.getProcessor?.()?.name || null, ...context()
                    });
                } catch (error) {
                    report({ sampleAfterMs: delay, diagnosticError: error?.name || 'Error' });
                }
            }, delay);
        }
    };
})(window);
