/* Room-microphone only. Display capture and OBS audio must not use this helper. */
(function (root) {
    let supported;
    root.captureWithSystemEcho = async function (capture, options, { verify = true } = {}) {
        if (options.echoCancellation !== true || supported === false) return capture(options);
        let track;
        try {
            track = await capture({ ...options, echoCancellation: { exact: 'all' } });
        } catch (error) {
            // Permission, missing-device and busy-device failures are not capability failures.
            const unsupported = error?.name === 'TypeError' || error?.name === 'NotSupportedError'
                || (error?.name === 'OverconstrainedError' && error.constraint === 'echoCancellation');
            if (!unsupported) throw error;
            supported = false;
            return capture(options);
        }
        if (verify && track.mediaStreamTrack?.getSettings?.().echoCancellation !== 'all') {
            // Older browsers may silently coerce string constraints to booleans.
            track.stop();
            supported = false;
            return capture(options);
        }
        supported = true;
        return track;
    };
})(window);
