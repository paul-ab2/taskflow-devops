'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const pinoHttp = require('pino-http');

const { buildConfig } = require('./config');
const { createLogger } = require('./utils/logger');
const { createMetrics } = require('./metrics/registry');
const { UserRepository } = require('./repositories/user.repository');
const { TaskRepository } = require('./repositories/task.repository');
const { AuthService } = require('./services/auth.service');
const { TaskService } = require('./services/task.service');
const { ChaosController } = require('./middleware/chaos');
const { metricsMiddleware } = require('./middleware/metrics');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { healthRoutes } = require('./routes/health.routes');
const { authRoutes } = require('./routes/auth.routes');
const { taskRoutes } = require('./routes/task.routes');
const { adminRoutes } = require('./routes/admin.routes');

/**
 * Application factory (composition root). Dependencies are wired here and can be
 * overridden in tests, which is what makes the code easy to unit-test.
 */
function createApp(overrides = {}) {
  const config = overrides.config ?? buildConfig();
  const logger = overrides.logger ?? createLogger({
    level: config.logLevel,
    appEnv: config.appEnv,
    version: config.build.version,
  });
  const userRepository = overrides.userRepository ?? new UserRepository();
  const taskRepository = overrides.taskRepository ?? new TaskRepository();
  const metrics = createMetrics({
    appEnv: config.appEnv,
    version: config.build.version,
    commit: config.build.commit,
    taskRepository,
    userRepository,
  });
  const authService = new AuthService({ userRepository, config, metrics });
  const taskService = new TaskService({ taskRepository, metrics });
  const chaos = overrides.chaos ?? new ChaosController({ metrics });
  const lifecycle = { shuttingDown: false };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(pinoHttp({
    logger,
    genReqId: (req, res) => {
      const id = req.headers['x-request-id'] || randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    autoLogging: { ignore: (req) => ['/health', '/ready', '/metrics'].includes(req.url) },
  }));
  // The app is served over plain HTTP (TLS would be terminated by a reverse proxy in a
  // real deployment), so the HTTPS-only defaults are switched off: with
  // upgrade-insecure-requests Safari rewrites /styles.css and /app.js to https:// and the UI breaks.
  app.use(helmet({
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
    strictTransportSecurity: false,
  }));
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));
  app.use(metricsMiddleware(metrics));

  app.use(healthRoutes({ config, metrics, lifecycle }));
  app.use('/api', chaos.middleware());
  app.use('/api/auth', authRoutes({ authService, config }));
  app.use('/api/tasks', taskRoutes({ taskService, authService }));
  app.use('/api/admin', adminRoutes({ config, chaos }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  app.locals = { ...app.locals, config, logger, metrics, chaos, lifecycle, userRepository, taskRepository };
  return app;
}

module.exports = { createApp };
