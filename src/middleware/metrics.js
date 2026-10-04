'use strict';

/**
 * Records RED metrics for every request. The route label uses the Express
 * route template (e.g. /api/tasks/:id) rather than the raw URL so that
 * metric cardinality stays bounded.
 */
function routeLabel(req) {
  if (req.route?.path) return `${req.baseUrl}${req.route.path}`;
  return 'unmatched';
}

function metricsMiddleware(metrics) {
  return (req, res, next) => {
    if (req.path === '/metrics') return next();
    const stopTimer = metrics.httpRequestDuration.startTimer();
    metrics.httpInFlight.inc();
    res.on('finish', () => {
      const labels = { method: req.method, route: routeLabel(req), status_code: String(res.statusCode) };
      metrics.httpRequestsTotal.inc(labels);
      stopTimer(labels);
      metrics.httpInFlight.dec();
    });
    return next();
  };
}

module.exports = { metricsMiddleware, routeLabel };
