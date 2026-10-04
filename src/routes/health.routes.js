'use strict';

const express = require('express');

/**
 * Liveness (/health), readiness (/ready), build info (/api/version) and
 * Prometheus scrape endpoint (/metrics).
 * - Docker HEALTHCHECK and the deploy script poll /health
 * - /ready returns 503 while the process is shutting down so load balancers drain it
 */
function healthRoutes({ config, metrics, lifecycle }) {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      env: config.appEnv,
      version: config.build.version,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/ready', (_req, res) => {
    if (lifecycle.shuttingDown) {
      return res.status(503).json({ status: 'shutting_down' });
    }
    return res.json({ status: 'ready' });
  });

  router.get('/api/version', (_req, res) => {
    res.json({ service: 'taskflow-api', env: config.appEnv, ...config.build });
  });

  router.get('/metrics', async (_req, res) => {
    res.set('Content-Type', metrics.register.contentType);
    res.send(await metrics.register.metrics());
  });

  return router;
}

module.exports = { healthRoutes };
