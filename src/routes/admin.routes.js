'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { validate } = require('../middleware/validate');
const { schemas } = require('../validation/schemas');
const { NotFoundError, UnauthorizedError } = require('../utils/errors');

/** Constant-time string comparison to avoid timing attacks on the chaos token. */
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Operational endpoints used by the pipeline's incident simulation.
 * Disabled entirely (404) unless CHAOS_TOKEN is configured for the environment.
 */
function adminRoutes({ config, chaos }) {
  const router = express.Router();

  router.use((req, _res, next) => {
    if (!config.chaosToken) return next(new NotFoundError('Route not found'));
    if (!safeEqual(req.get('x-chaos-token') || '', config.chaosToken)) {
      return next(new UnauthorizedError('Invalid chaos token'));
    }
    return next();
  });

  router.get('/chaos', (_req, res) => {
    res.json(chaos.status());
  });

  router.post('/chaos', validate(schemas.chaos), (req, res) => {
    const status = chaos.enable(req.validated.body);
    req.log?.warn({ chaos: status }, 'Chaos experiment state changed');
    res.json(status);
  });

  return router;
}

module.exports = { adminRoutes, safeEqual };
