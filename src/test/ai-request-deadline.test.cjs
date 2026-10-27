const { EventEmitter } = require('node:events');
const test = require('node:test');
const assert = require('node:assert/strict');
const { requestDeadline } = require('../main/ai-request-deadline');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function request() {
    const req = new EventEmitter();
    req.destroy = error => { req.failure = error; req.emit('error', error); };
    return req;
}
test('stalled request is destroyed with a bounded deadline', async () => {
    const req = request(); requestDeadline(req, 'timeout', 10);
    await wait(30); assert.equal(req.failure.code, 'AI_REQUEST_TIMEOUT');
});
test('completed response clears deadline', async () => {
    const req = request(), res = new EventEmitter();
    requestDeadline(req, 'timeout', 10); req.emit('response', res); res.emit('end');
    await wait(30); assert.equal(req.failure, undefined);
});
test('aborted response rejects instead of leaving the caller waiting', () => {
    const req = request(), res = new EventEmitter();
    requestDeadline(req, 'timeout', 1000); req.emit('response', res); res.emit('aborted');
    assert.equal(req.failure.code, 'AI_REQUEST_TIMEOUT');
});
