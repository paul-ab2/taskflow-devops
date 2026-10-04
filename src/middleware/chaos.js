'use strict';

const { AppError } = require('../utils/errors');

/**
 * Fault-injection controller used for incident simulation in the Monitoring stage.
 * When active it makes a share of /api requests fail with 500 ("errors" mode)
 * or adds artificial latency ("latency" mode). It switches itself off after
 * durationSeconds so a forgotten experiment cannot cause a lasting outage.
 */
class ChaosController {
  constructor({ metrics, random = Math.random, now = Date.now } = {}) {
    this.metrics = metrics;
    this.random = random;
    this.now = now;
    this.state = { mode: 'off' };
  }

  enable({ mode, errorRate = 0.5, latencyMs = 1500, durationSeconds = 120 }) {
    if (mode === 'off') return this.disable();
    this.state = { mode, errorRate, latencyMs, expiresAt: this.now() + durationSeconds * 1000 };
    this.metrics?.chaosActive.reset();
    this.metrics?.chaosActive.set({ mode }, 1);
    return this.status();
  }

  disable() {
    this.state = { mode: 'off' };
    this.metrics?.chaosActive.reset();
    return this.status();
  }

  current() {
    if (this.state.mode !== 'off' && this.now() >= this.state.expiresAt) this.disable();
    return this.state;
  }

  status() {
    const state = this.current();
    if (state.mode === 'off') return { mode: 'off' };
    return { ...state, expiresAt: new Date(state.expiresAt).toISOString() };
  }

  middleware() {
    return async (req, _res, next) => {
      const state = this.current();
      if (state.mode === 'off' || req.path.startsWith('/admin')) return next();
      if (state.mode === 'latency') {
        await new Promise((resolve) => setTimeout(resolve, state.latencyMs));
        return next();
      }
      if (this.random() < state.errorRate) {
        return next(new AppError('Injected failure (chaos experiment)', 500, 'CHAOS_INJECTED'));
      }
      return next();
    };
  }
}

module.exports = { ChaosController };
