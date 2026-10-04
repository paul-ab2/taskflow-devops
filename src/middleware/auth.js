'use strict';

const { ForbiddenError, UnauthorizedError } = require('../utils/errors');

/** Requires a valid "Authorization: Bearer <jwt>" header and attaches req.user. */
function authenticate(authService) {
  return (req, _res, next) => {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return next(new UnauthorizedError('Missing or malformed Authorization header'));
    }
    const payload = authService.verifyToken(token);
    req.user = { id: payload.sub, role: payload.role };
    return next();
  };
}

/** Restricts a route to the given roles. Must run after authenticate(). */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ForbiddenError());
    }
    return next();
  };
}

module.exports = { authenticate, requireRole };
