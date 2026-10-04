'use strict';

/**
 * Smoke / acceptance tests executed against a *deployed* environment.
 *   BASE_URL=http://taskflow-staging:3000 npm run test:smoke
 * They use the public HTTP API only (no imports from src/) so they test exactly
 * what users get from the running container.
 */
const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const EXPECTED_VERSION = process.env.EXPECTED_VERSION;
const EXPECTED_ENV = process.env.EXPECTED_ENV;

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function call(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: parseJson(text), text, headers: res.headers };
}

describe(`Deployed service at ${BASE_URL}`, () => {
  let token;

  it('is healthy and ready', async () => {
    const health = await call('/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
    expect((await call('/ready')).status).toBe(200);
  });

  it('runs the expected version in the expected environment', async () => {
    const { status, body } = await call('/api/version');
    expect(status).toBe(200);
    // When the pipeline passes the expected values, the deployed build must match them exactly.
    expect(body.version).toBe(EXPECTED_VERSION ?? body.version);
    expect(body.env).toBe(EXPECTED_ENV ?? body.env);
  });

  it('serves the web UI', async () => {
    const { status, text } = await call('/');
    expect(status).toBe(200);
    expect(text).toContain('TaskFlow');
  });

  it('registers a user and logs in (critical user journey)', async () => {
    const email = `smoke-${Date.now()}@example.com`;
    const reg = await call('/api/auth/register', {
      method: 'POST',
      body: { email, password: 'Sm0keTest!', name: 'Smoke Test' },
    });
    expect(reg.status).toBe(201);
    const login = await call('/api/auth/login', { method: 'POST', body: { email, password: 'Sm0keTest!' } });
    expect(login.status).toBe(200);
    token = login.body.token;
  });

  it('creates, updates, reads and deletes a task', async () => {
    const created = await call('/api/tasks', { method: 'POST', token, body: { title: 'smoke task', priority: 'high' } });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await call(`/api/tasks/${id}`, { method: 'PATCH', token, body: { status: 'done' } })).body.status).toBe('done');
    expect((await call('/api/tasks/stats', { token })).body.total).toBeGreaterThanOrEqual(1);
    expect((await call(`/api/tasks/${id}`, { method: 'DELETE', token })).status).toBe(204);
  });

  it('rejects unauthenticated access to protected routes', async () => {
    expect((await call('/api/tasks')).status).toBe(401);
  });

  it('exposes Prometheus metrics for the monitoring stack', async () => {
    const { status, text } = await call('/metrics');
    expect(status).toBe(200);
    expect(text).toContain('http_requests_total');
    expect(text).toContain('taskflow_app_info');
  });
});
