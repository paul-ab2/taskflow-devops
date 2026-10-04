'use strict';

const request = require('supertest');
const { buildTestApp, registerUser, authed } = require('../helpers');

describe('Tasks API', () => {
  let app;
  let api;

  beforeEach(async () => {
    app = buildTestApp();
    const { token } = await registerUser(app);
    api = authed(app, token);
  });

  async function createTask(body) {
    const res = await api.post('/api/tasks').send(body).expect(201);
    return res.body;
  }

  it('requires authentication', async () => {
    await request(app).get('/api/tasks').expect(401);
  });

  it('supports the full CRUD lifecycle', async () => {
    const created = await api.post('/api/tasks')
      .send({ title: 'Build pipeline', priority: 'high', tags: ['DevOps', 'uni'] })
      .expect(201);
    expect(created.headers.location).toBe(`/api/tasks/${created.body.id}`);
    expect(created.body).toMatchObject({ title: 'Build pipeline', status: 'todo', tags: ['devops', 'uni'] });

    const fetched = await api.get(`/api/tasks/${created.body.id}`).expect(200);
    expect(fetched.body.title).toBe('Build pipeline');

    const updated = await api.patch(`/api/tasks/${created.body.id}`).send({ status: 'in_progress' }).expect(200);
    expect(updated.body.status).toBe('in_progress');

    await api.delete(`/api/tasks/${created.body.id}`).expect(204);
    await api.get(`/api/tasks/${created.body.id}`).expect(404);
  });

  it('validates task payloads', async () => {
    const res = await api.post('/api/tasks').send({ title: '', priority: 'urgent' }).expect(400);
    const fields = res.body.error.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['title', 'priority']));
  });

  it('rejects empty PATCH bodies and malformed ids', async () => {
    const task = await createTask({ title: 'Patch me' });
    await api.patch(`/api/tasks/${task.id}`).send({}).expect(400);
    await api.get('/api/tasks/not-a-uuid').expect(400);
  });

  it('blocks invalid status transitions with 400', async () => {
    const task = await createTask({ title: 'Finished', status: 'done' });
    const res = await api.patch(`/api/tasks/${task.id}`).send({ status: 'todo' }).expect(400);
    expect(res.body.error.message).toMatch(/Invalid status transition/);
  });

  it('isolates tasks between users (403 on access to another user\'s task)', async () => {
    const task = await createTask({ title: 'Mine' });
    const { token: otherToken } = await registerUser(app);
    const other = authed(app, otherToken);
    await other.get(`/api/tasks/${task.id}`).expect(403);
    await other.patch(`/api/tasks/${task.id}`).send({ title: 'stolen' }).expect(403);
    await other.delete(`/api/tasks/${task.id}`).expect(403);
    const list = await other.get('/api/tasks').expect(200);
    expect(list.body.total).toBe(0);
  });

  it('filters, searches, sorts and paginates', async () => {
    await createTask({ title: 'Write report', priority: 'low' });
    await createTask({ title: 'Record demo video', priority: 'high', status: 'in_progress' });
    await createTask({ title: 'Submit report', priority: 'medium', status: 'done' });

    const byStatus = await api.get('/api/tasks?status=in_progress').expect(200);
    expect(byStatus.body.items.map((t) => t.title)).toEqual(['Record demo video']);

    const bySearch = await api.get('/api/tasks?search=report&sort=title&order=asc').expect(200);
    expect(bySearch.body.items.map((t) => t.title)).toEqual(['Submit report', 'Write report']);

    const paged = await api.get('/api/tasks?limit=2&page=2').expect(200);
    expect(paged.body).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
    expect(paged.body.items).toHaveLength(1);

    await api.get('/api/tasks?limit=1000').expect(400);
  });

  it('returns per-user statistics', async () => {
    await createTask({ title: 'Late', dueDate: '2001-01-01' });
    await createTask({ title: 'Done', status: 'done' });
    const res = await api.get('/api/tasks/stats').expect(200);
    expect(res.body).toMatchObject({ total: 2, overdue: 1, completionRate: 50 });
  });

  it('rejects malformed JSON with a clear error', async () => {
    const res = await api.post('/api/tasks').set('Content-Type', 'application/json').send('{"title": ').expect(400);
    expect(res.body.error.code).toBe('BAD_JSON');
  });
});
