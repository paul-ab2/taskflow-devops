'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { schemas } = require('../validation/schemas');

function authRoutes({ authService, config }) {
  const router = express.Router();

  // Brute-force protection on credential endpoints.
  const authLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.authMax,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, please try again later' } },
  });

  router.post('/register', authLimiter, validate(schemas.register), async (req, res) => {
    const result = await authService.register(req.validated.body);
    res.status(201).json(result);
  });

  router.post('/login', authLimiter, validate(schemas.login), async (req, res) => {
    const result = await authService.login(req.validated.body);
    res.json(result);
  });

  router.get('/me', authenticate(authService), async (req, res) => {
    res.json({ user: await authService.getProfile(req.user.id) });
  });

  return router;
}

module.exports = { authRoutes };
