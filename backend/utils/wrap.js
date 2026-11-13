/* Express 4 does not catch errors from async handlers. wrap() passes them to the error handler. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const httpError = (status, message) => Object.assign(new Error(message), { status });

module.exports = { wrap, httpError };
