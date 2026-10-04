'use strict';

const { AppError } = require('../utils/errors');

function notFoundHandler(req, _res, next) {
  next(new AppError(`Route ${req.method} ${req.path} not found`, 404, 'NOT_FOUND'));
}

/**
 * Central error handler: converts every error into a consistent JSON body and
 * never leaks stack traces to clients. Unexpected errors are logged at error level.
 */
// Express identifies error handlers by arity, so the unused 4th argument must stay.
function errorHandler(err, req, res, _next) {
  let error = err;
  if (err.type === 'entity.parse.failed') {
    error = new AppError('Malformed JSON body', 400, 'BAD_JSON');
  } else if (!(err instanceof AppError)) {
    req.log?.error({ err }, 'Unhandled error');
    error = new AppError('Internal server error', 500, 'INTERNAL_ERROR');
  } else if (error.statusCode >= 500) {
    req.log?.warn({ code: error.code }, error.message);
  }

  res.status(error.statusCode).json({
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      requestId: req.id,
    },
  });
}

module.exports = { notFoundHandler, errorHandler };
