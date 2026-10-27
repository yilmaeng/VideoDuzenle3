/* Optional room microphone experiment. Native AEC stays enabled independently.
 * No global shortcut: this is a session-scoped device preference, reachable by Tab.
 */
(function (root) {
    let library;
    function loadLibrary() {
        if (!library) library = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            const fail = () => { library = null; script.remove(); reject(new Error('krisp_load_failed')); };
            const timer = setTimeout(fail, 20000);
            // Serve the pinned UMD as JavaScript: the CDN serves .cjs as application/node.
            script.src = '/yayinodasi/vendor/krisp-0.4.5/index.js';
            script.onload = () => { clearTimeout(timer); resolve(root['LiveKit Noise Filter']); };
            script.onerror = () => { clearTimeout(timer); fail(); };
            document.head.appendChild(script);
        });
        return library;
    }
    root.createEvdKrispPreview = function ({ control, music, announce, translate, loadSdk = loadLibrary, diagnose = () => {} }) {
        const processors = new WeakMap();
        let pending = Promise.resolve();
        return function apply(track) {
            const run = async () => {
                control.disabled = true;
                try {
                    const wanted = control.checked && !music.checked;
                    diagnose({ stage: 'requested', wanted, hasTrack: !!track });
                    if (!track) return;
                    let processor = processors.get(track);
                    if (!wanted) {
                        if (processor) {
                            await track.stopProcessor();
                            processors.delete(track);
                            diagnose({ stage: 'disabled', readyState: track.mediaStreamTrack?.readyState });
                        }
                        return;
                    }
                    if (processor) return;
                    announce(translate('krisp_preview.loading'));
                    const sdk = await loadSdk();
                    if (!sdk?.isKrispNoiseFilterSupported()) throw new Error('unsupported');
                    if (!control.checked || music.checked || track.mediaStreamTrack?.readyState === 'ended') return;
                    processor = sdk.KrispNoiseFilter({ useBVC: true, quality: 'medium' });
                    diagnose({ stage: 'initializing' });
                    try {
                        await track.setProcessor(processor);
                        await processor.setEnabled(true);
                        if (track.mediaStreamTrack?.readyState === 'ended') {
                            await track.stopProcessor();
                            return;
                        }
                        if (!processor.isEnabled()) throw new Error('krisp_not_enabled');
                        processors.set(track, processor);
                    } catch (error) {
                        await track.stopProcessor().catch(() => {});
                        await processor.destroy().catch(() => {});
                        throw error;
                    }
                    announce(translate('krisp_preview.ready'));
                    diagnose({ stage: 'enabled', readyState: track.mediaStreamTrack?.readyState });
                } catch (error) {
                    control.checked = false;
                    announce(translate('krisp_preview.failed'));
                    console.warn('Krisp preview unavailable:', error?.name || 'Error');
                    diagnose({ stage: 'failed', errorName: error?.name || 'Error' });
                } finally {
                    control.disabled = music.checked;
                }
            };
            pending = pending.then(run, run);
            return pending;
        };
    };
})(window);
