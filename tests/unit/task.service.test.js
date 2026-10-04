'use strict';

const { TaskService, isOverdue, assertTransition } = require('../../src/services/task.service');
const { TaskRepository } = require('../../src/repositories/task.repository');
const { ForbiddenError, NotFoundError, ValidationError } = require('../../src/utils/errors');

function fakeMetrics() {
  return { tasksCreated: { inc: jest.fn() }, tasksCompleted: { inc: jest.fn() } };
}

describe('isOverdue', () => {
  const now = new Date('2026-06-15T12:00:00Z');

  it('is false when there is no due date', () => {
    expect(isOverdue({ status: 'todo', dueDate: null }, now)).toBe(false);
  });

  it('is false for completed tasks even if the due date has passed', () => {
    expect(isOverdue({ status: 'done', dueDate: '2026-01-01T00:00:00Z' }, now)).toBe(false);
  });

  it('is true for open tasks past their due date', () => {
    expect(isOverdue({ status: 'in_progress', dueDate: '2026-06-01T00:00:00Z' }, now)).toBe(true);
  });

  it('is false for open tasks due in the future', () => {
    expect(isOverdue({ status: 'todo', dueDate: '2026-07-01T00:00:00Z' }, now)).toBe(false);
  });
});

describe('assertTransition', () => {
  it.each([
    ['todo', 'in_progress'],
    ['todo', 'done'],
    ['in_progress', 'done'],
    ['done', 'in_progress'],
    ['todo', 'todo'],
  ])('allows %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it('rejects done -> todo', () => {
    expect(() => assertTransition('done', 'todo')).toThrow(ValidationError);
  });
});

describe('TaskService', () => {
  let service;
  let metrics;

  beforeEach(() => {
    metrics = fakeMetrics();
    service = new TaskService({ taskRepository: new TaskRepository(), metrics });
  });

  it('creates a task with defaults and records a metric', async () => {
    const task = await service.create('user-1', { title: 'Write report' });
    expect(task).toMatchObject({ title: 'Write report', status: 'todo', priority: 'medium', ownerId: 'user-1' });
    expect(metrics.tasksCreated.inc).toHaveBeenCalledWith({ priority: 'medium' });
  });

  it('prevents users from reading tasks they do not own', async () => {
    const task = await service.create('owner', { title: 'Private' });
    await expect(service.get('intruder', task.id)).rejects.toThrow(ForbiddenError);
  });

  it('throws NotFoundError for unknown ids', async () => {
    await expect(service.get('user-1', 'missing')).rejects.toThrow(NotFoundError);
  });

  it('counts a completion only when a task first moves to done', async () => {
    const task = await service.create('u', { title: 'Ship it' });
    await service.update('u', task.id, { status: 'done' });
    await service.update('u', task.id, { title: 'Ship it (renamed)' });
    expect(metrics.tasksCompleted.inc).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid status transitions', async () => {
    const task = await service.create('u', { title: 'Done already', status: 'done' });
    await expect(service.update('u', task.id, { status: 'todo' })).rejects.toThrow(ValidationError);
  });

  it('removes a task', async () => {
    const task = await service.create('u', { title: 'Temp' });
    await service.remove('u', task.id);
    await expect(service.get('u', task.id)).rejects.toThrow(NotFoundError);
  });

  it('flags overdue tasks when listing', async () => {
    await service.create('u', { title: 'Late', dueDate: '2000-01-01T00:00:00Z' });
    const { items } = await service.list('u', {});
    expect(items[0].overdue).toBe(true);
  });

  it('computes stats per user', async () => {
    const now = new Date('2026-06-15T00:00:00Z');
    await service.create('u', { title: 'a', priority: 'high', dueDate: '2026-06-01T00:00:00Z' });
    await service.create('u', { title: 'b', status: 'done', priority: 'low' });
    await service.create('u', { title: 'c', status: 'in_progress' });
    await service.create('someone-else', { title: 'not mine' });

    const stats = await service.stats('u', now);
    expect(stats).toEqual({
      total: 3,
      byStatus: { todo: 1, in_progress: 1, done: 1 },
      byPriority: { low: 1, medium: 1, high: 1 },
      overdue: 1,
      completionRate: 33,
    });
  });

  it('returns zero completion rate when the user has no tasks', async () => {
    const stats = await service.stats('nobody');
    expect(stats.total).toBe(0);
    expect(stats.completionRate).toBe(0);
  });

  it('works without a metrics collector', async () => {
    const plain = new TaskService({ taskRepository: new TaskRepository() });
    const task = await plain.create('u', { title: 'no metrics' });
    await expect(plain.update('u', task.id, { status: 'done' })).resolves.toMatchObject({ status: 'done' });
  });
});
