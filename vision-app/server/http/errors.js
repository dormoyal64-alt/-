// @ts-check
/** Uniform API errors: `{ error: { code, message } }`. Stack traces never reach clients. */

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code     stable machine-readable code (UPPER_SNAKE)
   * @param {string} [message]
   * @param {Record<string, string>} [headers]
   */
  constructor(status, code, message, headers) {
    super(message ?? code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

/** @param {import('express').Request} req */
const isApi = (req) => /^\/api(\/|\?|$)/.test(req.originalUrl || req.url);

/** @param {import('express').Response} res @param {number} status @param {string} code @param {string} message */
export function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

/**
 * Final error handler (Express 5 forwards rejected promises here).
 * @param {{warn: Function, error: Function}} logger
 * @returns {import('express').ErrorRequestHandler}
 */
export function errorHandler(logger) {
  return (err, req, res, _next) => {
    const e = /** @type {any} */ (err);
    let status = 500;
    let code = 'INTERNAL';
    let message = 'Internal server error';
    if (e instanceof HttpError) {
      ({ status, code } = e);
      message = e.message;
      if (e.headers) for (const [k, v] of Object.entries(e.headers)) res.setHeader(k, v);
    } else if (e && e.type === 'entity.parse.failed') {
      status = 400; code = 'INVALID_JSON'; message = 'Request body is not valid JSON';
    } else if (e && e.type === 'entity.too.large') {
      status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body is too large';
    } else if (e && (e.type === 'charset.unsupported' || e.type === 'encoding.unsupported')) {
      status = 415; code = 'UNSUPPORTED_ENCODING'; message = 'Unsupported request encoding';
    } else if (e && typeof e.status === 'number' && e.status >= 400 && e.status < 500 && e.expose) {
      status = e.status; code = 'BAD_REQUEST'; message = 'Bad request';
    } else {
      logger.error(`[error] ${req.method} ${req.path}:`, e && e.stack ? e.stack : e);
    }
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (isApi(req)) {
      res.setHeader('Cache-Control', 'no-store');
      sendError(res, status, code, message);
    } else {
      res.status(status).type('text/plain; charset=utf-8').send(status === 404 ? 'Not found' : message);
    }
  };
}

/** @param {import('express').Request} req @param {import('express').Response} res */
export function notFound(req, res) {
  if (isApi(req)) {
    res.setHeader('Cache-Control', 'no-store');
    sendError(res, 404, 'NOT_FOUND', 'Not found');
  } else {
    res.status(404).type('text/plain; charset=utf-8').send('Not found');
  }
}
