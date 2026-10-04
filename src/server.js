'use strict';

const { createApp } = require('./app');

const app = createApp();
const { config, logger, lifecycle } = app.locals;

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.appEnv, version: config.build.version }, 'TaskFlow API started');
});

// Graceful shutdown: stop accepting traffic, let in-flight requests finish,
// then exit. Docker sends SIGTERM on `docker stop` / redeploys.
function shutdown(signal) {
  if (lifecycle.shuttingDown) return;
  lifecycle.shuttingDown = true;
  logger.info({ signal }, 'Shutting down gracefully');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

module.exports = server;
