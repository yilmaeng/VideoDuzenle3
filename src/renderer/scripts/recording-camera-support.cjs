function cameraSource(state) {
    return state.cameraInputName || (state.cameraItemId !== null && state.cameraItemId !== undefined ? 'KVE Kamera' : '');
}
function cameraErrorKey(error) {
    if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(error?.name)) return 'recording_camera.busy';
    if (['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'].includes(error?.name)) return 'recording_camera.missing';
    if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error?.name)) return 'recording_camera.denied';
    return 'recording_camera.failed';
}
function waitForImage(image, source, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); image.onload = null; image.onerror = null; };
        const timer = setTimeout(() => { cleanup(); reject(new Error('camera_frame_timeout')); }, timeout);
        image.onload = () => { cleanup(); resolve(); };
        image.onerror = () => { cleanup(); reject(new Error('camera_preview_failed')); };
        image.src = source;
        if (image.complete && image.naturalWidth > 0) { cleanup(); resolve(); }
    });
}
module.exports = { cameraSource, cameraErrorKey, waitForImage };
