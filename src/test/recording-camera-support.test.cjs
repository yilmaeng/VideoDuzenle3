const test = require('node:test');
const assert = require('node:assert/strict');
const { cameraSource, cameraErrorKey, waitForImage } = require('../renderer/scripts/recording-camera-support.cjs');
test('OBS scene item zero is valid and explicit source name is preferred', () => {
    assert.equal(cameraSource({ cameraItemId: 0 }), 'KVE Kamera');
    assert.equal(cameraSource({ cameraItemId: null }), '');
    assert.equal(cameraSource({ cameraInputName: 'USB', cameraItemId: 0 }), 'USB');
});
test('busy devices are not reported as permission denial', () => {
    assert.equal(cameraErrorKey({ name: 'NotReadableError' }), 'recording_camera.busy');
    assert.equal(cameraErrorKey({ name: 'NotFoundError' }), 'recording_camera.missing');
    assert.equal(cameraErrorKey({ name: 'NotAllowedError' }), 'recording_camera.denied');
    assert.equal(cameraErrorKey(new Error('other')), 'recording_camera.failed');
});
test('cached images resolve and missing frame events time out', async () => {
    await waitForImage({ complete: true, naturalWidth: 640 }, 'data:image/png;base64,test');
    const image = {};
    await assert.rejects(waitForImage(image, 'test', 10), /camera_frame_timeout/);
    assert.equal(image.onload, null);
    assert.equal(image.onerror, null);
});
