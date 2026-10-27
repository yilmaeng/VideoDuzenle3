// A wall-clock deadline, including DNS, connection, and response body time.
// Socket inactivity timeouts alone do not bound a stalled AI request.
function requestDeadline(request, message, milliseconds = 90000) {
    const fail = () => request.destroy(Object.assign(new Error(message), { code: 'AI_REQUEST_TIMEOUT' }));
    const timer = setTimeout(fail, milliseconds);
    const clear = () => clearTimeout(timer);
    request.once('error', clear);
    request.once('response', response => {
        response.once('end', clear);
        response.once('aborted', () => { clear(); fail(); });
        response.once('error', () => { clear(); fail(); });
    });
    return clear;
}
module.exports = { requestDeadline };
