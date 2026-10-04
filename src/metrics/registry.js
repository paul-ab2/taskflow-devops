'use strict';

const client = require('prom-client');

/**
 * Prometheus metrics exposed on GET /metrics.
 * - RED metrics (Rate, Errors, Duration) for every HTTP route
 * - business metrics (users, tasks) for product-level dashboards
 * - Node.js runtime metrics (CPU, memory, event-loop lag, GC)
 * A fresh registry per app instance keeps tests isolated.
 */

function createHttpMetrics(register) {
  return {
    httpRequestsTotal: new client.Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [register],
    }),
    httpRequestDuration: new client.Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [register],
    }),
    httpInFlight: new client.Gauge({
      name: 'http_requests_in_flight',
      help: 'HTTP requests currently being processed',
      registers: [register],
    }),
  };
}

function createBusinessMetrics(register) {
  return {
    usersRegistered: new client.Counter({
      name: 'taskflow_users_registered_total',
      help: 'Number of user registrations',
      registers: [register],
    }),
    authFailures: new client.Counter({
      name: 'taskflow_auth_failures_total',
      help: 'Failed authentication attempts by reason',
      labelNames: ['reason'],
      registers: [register],
    }),
    tasksCreated: new client.Counter({
      name: 'taskflow_tasks_created_total',
      help: 'Number of tasks created',
      labelNames: ['priority'],
      registers: [register],
    }),
    tasksCompleted: new client.Counter({
      name: 'taskflow_tasks_completed_total',
      help: 'Number of tasks moved to done',
      registers: [register],
    }),
    chaosActive: new client.Gauge({
      name: 'taskflow_chaos_active',
      help: '1 when fault injection is active (incident simulation)',
      labelNames: ['mode'],
      registers: [register],
    }),
  };
}

/** Gauges computed at scrape time from the repositories. */
function createStateGauges(register, { taskRepository, userRepository }) {
  const tasksCurrent = new client.Gauge({
    name: 'taskflow_tasks_current',
    help: 'Tasks currently stored, by status',
    labelNames: ['status'],
    registers: [register],
    async collect() {
      if (!taskRepository) return;
      const counts = await taskRepository.countByStatus();
      for (const [status, value] of Object.entries(counts)) this.set({ status }, value);
    },
  });

  const usersCurrent = new client.Gauge({
    name: 'taskflow_users_current',
    help: 'Users currently registered',
    registers: [register],
    async collect() {
      if (userRepository) this.set(await userRepository.count());
    },
  });

  return { tasksCurrent, usersCurrent };
}

function createMetrics({ appEnv, version, commit, taskRepository, userRepository }) {
  const register = new client.Registry();
  register.setDefaultLabels({ app: 'taskflow-api', env: appEnv });
  client.collectDefaultMetrics({ register });

  const stateGauges = createStateGauges(register, { taskRepository, userRepository });

  const appInfo = new client.Gauge({
    name: 'taskflow_app_info',
    help: 'Build information for the running application',
    labelNames: ['version', 'commit'],
    registers: [register],
  });
  appInfo.set({ version, commit }, 1);

  return {
    register,
    appInfo,
    ...stateGauges,
    ...createHttpMetrics(register),
    ...createBusinessMetrics(register),
  };
}

module.exports = { createMetrics };
