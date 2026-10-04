'use strict';

const { ValidationError } = require('../utils/errors');

/**
 * Validates and sanitises a request part (body, query or params) against a Joi schema.
 * Unknown fields are stripped, so clients cannot mass-assign fields such as ownerId.
 * Express 5 makes req.query a getter, so validated values are stored on req.validated.
 */
function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const { value, error } = schema.validate(req[source] ?? {}, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });
    if (error) {
      const details = error.details.map((d) => ({ field: d.path.join('.'), message: d.message }));
      return next(new ValidationError('Request validation failed', details));
    }
    req.validated = { ...req.validated, [source]: value };
    return next();
  };
}

module.exports = { validate };
