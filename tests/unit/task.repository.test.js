'use strict';

const { TaskRepository } = require('../../src/repositories/task.repository');
const { UserRepository } = require('../../src/repositories/user.repository');

describe('TaskRepository', () => {
  let repo;

  beforeEach(async () => {
    repo = new TaskRepository();
    await repo.create('u1', { title: 'Alpha report', priority: 'low', tags: ['uni'] });
    await repo.create('u1', { title: 'Beta deploy', priority: 'high', status: 'in_progress', description: 'jenkins' });
    await repo.create('u1', { title: 'Gamma review', priority: 'medium', status: 'done', tags: ['uni', 'review'] });
    await repo.create('u2', { title: 'Other user task' });
  });

  it('only returns tasks for the requested owner', async () => {
    const result = await repo.findByOwner('u1');
    expect(result.total).toBe(3);
    expect(result.items.every((t) => t.ownerId === 'u1')).toBe(true);
  });

  it('filters by status, priority, tag and search text', async () => {
    expect((await repo.findByOwner('u1', { status: 'done' })).total).toBe(1);
    expect((await repo.findByOwner('u1', { priority: 'high' })).total).toBe(1);
    expect((await repo.findByOwner('u1', { tag: 'uni' })).total).toBe(2);
    expect((await repo.findByOwner('u1', { search: 'JENKINS' })).items[0].title).toBe('Beta deploy');
  });

  it('sorts by priority weight in both directions', async () => {
    const desc = await repo.findByOwner('u1', { sort: 'priority', order: 'desc' });
    expect(desc.items.map((t) => t.priority)).toEqual(['high', 'medium', 'low']);
    const asc = await repo.findByOwner('u1', { sort: 'priority', order: 'asc' });
    expect(asc.items.map((t) => t.priority)).toEqual(['low', 'medium', 'high']);
  });

  it('sorts by title and falls back to createdAt for unknown fields', async () => {
    const byTitle = await repo.findByOwner('u1', { sort: 'title', order: 'asc' });
    expect(byTitle.items[0].title).toBe('Alpha report');
    const fallback = await repo.findByOwner('u1', { sort: 'not-a-field' });
    expect(fallback.items).toHaveLength(3);
  });

  it('sorts tasks without due dates consistently', async () => {
    const result = await repo.findByOwner('u1', { sort: 'dueDate', order: 'asc' });
    expect(result.items).toHaveLength(3);
  });

  it('paginates results', async () => {
    const page2 = await repo.findByOwner('u1', { page: 2, limit: 2 });
    expect(page2.items).toHaveLength(1);
    expect(page2.totalPages).toBe(2);
  });

  it('returns copies so callers cannot mutate stored state', async () => {
    const { items } = await repo.findByOwner('u1', { tag: 'review' });
    items[0].tags.push('hacked');
    const fresh = await repo.findById(items[0].id);
    expect(fresh.tags).not.toContain('hacked');
  });

  it('updates, counts and deletes tasks', async () => {
    const task = await repo.create('u3', { title: 'temp' });
    const updated = await repo.update(task.id, { title: 'renamed' });
    expect(updated.title).toBe('renamed');
    expect(await repo.update('missing', { title: 'x' })).toBeNull();
    expect(await repo.count()).toBe(5);
    expect(await repo.countByStatus()).toEqual({ todo: 3, in_progress: 1, done: 1 });
    expect(await repo.delete(task.id)).toBe(true);
    expect(await repo.findById(task.id)).toBeNull();
    await repo.clear();
    expect(await repo.count()).toBe(0);
  });
});

describe('UserRepository', () => {
  it('stores users with normalised emails and finds them case-insensitively', async () => {
    const repo = new UserRepository();
    const user = await repo.create({ email: 'Peter@Example.com', name: 'Peter', passwordHash: 'h' });
    expect(user.email).toBe('peter@example.com');
    expect(user.role).toBe('user');
    expect(await repo.findByEmail('PETER@example.com')).toMatchObject({ id: user.id });
    expect(await repo.findByEmail('nobody@example.com')).toBeNull();
    expect(await repo.findById(user.id)).toMatchObject({ name: 'Peter' });
    expect(await repo.findById('missing')).toBeNull();
    expect(await repo.count()).toBe(1);
    await repo.clear();
    expect(await repo.count()).toBe(0);
  });
});
