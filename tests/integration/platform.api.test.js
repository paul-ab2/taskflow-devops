'use strict';

const request = require('supertest');
const { buildTestApp, registerUser, authed } = require('../helpers');

describe('Operational endpoints', () => {
  it('GET /health reports liveness and version', async () => {
    const res = await request(buildTestApp()).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', env: 'test', version: expect.any(String) });
  });

  it('GET /ready returns 503 while shutting down', async () => {
    const app = buildTestApp();
    await request(app).get('/ready').expect(200);
    app.locals.lifecycle.shuttingDown = true;
    await request(app).get('/ready').expect(503);
  });

  it('GET /api/version exposes build metadata', async () => {
    const res = await request(buildTestApp()).get('/api/version').expect(200);
    expect(res.body).toMatchObject({ service: 'taskflow-api', version: expect.any(String), commit: expect.any(String) });
  });

  it('GET /metrics exposes Prometheus RED and business metrics', async () => {
    const app = buildTestApp();
    const { token } = await registerUser(app);
    await authed(app, token).post('/api/tasks').send({ title: 'metric me' }).expect(201);
    await request(app).get('/does-not-exist').expect(404);

    const res = await request(app).get('/metrics').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toMatch(/http_requests_total\{method="POST",route="\/api\/tasks\/",status_code="201"/);
    expect(res.text).toMatch(/http_request_duration_seconds_bucket/);
    expect(res.text).toMatch(/taskflow_tasks_created_total\{priority="medium"/);
    expect(res.text).toMatch(/taskflow_users_current\{[^}]*\} 1/);
    expect(res.text).toMatch(/route="unmatched",status_code="404"/);
    expect(res.text).toMatch(/process_cpu_user_seconds_total/);
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(buildTestApp()).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    // Served over plain HTTP: browsers must not be told to upgrade asset requests to HTTPS
    expect(res.headers['content-security-policy']).not.toMatch(/upgrade-insecure-requests/);
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('propagates or generates a request id', async () => {
    const app = buildTestApp();
    const given = await request(app).get('/health').set('x-request-id', 'trace-123');
    expect(given.headers['x-request-id']).toBe('trace-123');
    const generated = await request(app).get('/health');
    expect(generated.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
  });

  it('serves the web UI', async () => {
    const res = await request(buildTestApp()).get('/').expect(200);
    expect(res.text).toContain('<title>TaskFlow</title>');
  });

  it('hides unexpected error details from clients', async () => {
    const app = buildTestApp();
    jest.spyOn(app.locals.taskRepository, 'allForOwner').mockRejectedValueOnce(new Error('db exploded'));
    const { token } = await registerUser(app);
    const res = await authed(app, token).get('/api/tasks/stats').expect(500);
    expect(res.body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain('db exploded');
  });
});

describe('Chaos / incident-simulation endpoints', () => {
  const TOKEN = 'chaos-test-token';

  it('are hidden (404) when no chaos token is configured', async () => {
    await request(buildTestApp()).get('/api/admin/chaos').expect(404);
  });

  it('reject an invalid token', async () => {
    const app = buildTestApp({ chaosToken: TOKEN });
    await request(app).get('/api/admin/chaos').set('x-chaos-token', 'wrong').expect(401);
  });

  it('inject failures that show up as 5xx in metrics, then recover', async () => {
    const app = buildTestApp({ chaosToken: TOKEN });
    const admin = (req) => req.set('x-chaos-token', TOKEN);

    const on = await admin(request(app).post('/api/admin/chaos'))
      .send({ mode: 'errors', errorRate: 1, durationSeconds: 60 })
      .expect(200);
    expect(on.body).toMatchObject({ mode: 'errors', errorRate: 1 });

    const failed = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'x' }).expect(500);
    expect(failed.body.error.code).toBe('CHAOS_INJECTED');
    await request(app).get('/health').expect(200); // health is outside /api so stays green

    const metrics = await request(app).get('/metrics');
    expect(metrics.text).toMatch(/taskflow_chaos_active\{mode="errors"[^}]*\} 1/);

    await admin(request(app).post('/api/admin/chaos')).send({ mode: 'off' }).expect(200);
    const status = await admin(request(app).get('/api/admin/chaos')).expect(200);
    expect(status.body).toEqual({ mode: 'off' });
  });

  it('validates the chaos request body', async () => {
    const app = buildTestApp({ chaosToken: TOKEN });
    await request(app).post('/api/admin/chaos').set('x-chaos-token', TOKEN).send({ mode: 'meltdown' }).expect(400);
  });
});
