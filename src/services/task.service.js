'use strict';

const { ForbiddenError, NotFoundError, ValidationError } = require('../utils/errors');

const STATUS_TRANSITIONS = {
  todo: ['in_progress', 'done'],
  in_progress: ['todo', 'done'],
  done: ['in_progress'],
};

/** Returns true when a task is past its due date and not yet completed. */
function isOverdue(task, now = new Date()) {
  if (!task.dueDate || task.status === 'done') return false;
  return new Date(task.dueDate).getTime() < now.getTime();
}

function assertTransition(from, to) {
  if (from === to) return;
  if (!STATUS_TRANSITIONS[from]?.includes(to)) {
    throw new ValidationError(`Invalid status transition from '${from}' to '${to}'`);
  }
}

class TaskService {
  constructor({ taskRepository, metrics }) {
    this.tasks = taskRepository;
    this.metrics = metrics;
  }

  async create(userId, data) {
    const task = await this.tasks.create(userId, data);
    this.metrics?.tasksCreated.inc({ priority: task.priority });
    return task;
  }

  async list(userId, query) {
    const result = await this.tasks.findByOwner(userId, query);
    return { ...result, items: result.items.map((t) => ({ ...t, overdue: isOverdue(t) })) };
  }

  async get(userId, taskId) {
    const task = await this.tasks.findById(taskId);
    if (!task) throw new NotFoundError('Task not found');
    if (task.ownerId !== userId) throw new ForbiddenError('You do not own this task');
    return { ...task, overdue: isOverdue(task) };
  }

  async update(userId, taskId, changes) {
    const task = await this.get(userId, taskId);
    if (changes.status) assertTransition(task.status, changes.status);
    const updated = await this.tasks.update(taskId, changes);
    if (changes.status === 'done' && task.status !== 'done') {
      this.metrics?.tasksCompleted.inc();
    }
    return { ...updated, overdue: isOverdue(updated) };
  }

  async remove(userId, taskId) {
    await this.get(userId, taskId);
    await this.tasks.delete(taskId);
  }

  async stats(userId, now = new Date()) {
    const all = await this.tasks.allForOwner(userId);
    const byStatus = { todo: 0, in_progress: 0, done: 0 };
    const byPriority = { low: 0, medium: 0, high: 0 };
    let overdue = 0;
    for (const task of all) {
      byStatus[task.status] += 1;
      byPriority[task.priority] += 1;
      if (isOverdue(task, now)) overdue += 1;
    }
    const completionRate = all.length === 0 ? 0 : Math.round((byStatus.done / all.length) * 100);
    return { total: all.length, byStatus, byPriority, overdue, completionRate };
  }
}

module.exports = { TaskService, isOverdue, assertTransition, STATUS_TRANSITIONS };
