'use strict';

const pino = require('pino');

/**
 * Structured JSON logger. JSON logs are easy to ship to Loki / ELK / Datadog
 * and are what the Monitoring stage relies on for incident investigation.
 */
function createLogger({ level = 'info', appEnv = 'development', version = 'dev' } = {}) {
  return pino({
    level,
    base: { service: 'taskflow-api', env: appEnv, version },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['req.headers.authorization', 'req.headers["x-chaos-token"]', '*.password'],
      censor: '[REDACTED]',
    },
  });
}

module.exports = { createLogger };
