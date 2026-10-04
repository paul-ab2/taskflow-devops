'use strict';

const { randomUUID } = require('node:crypto');

const SORTABLE_FIELDS = new Set(['createdAt', 'updatedAt', 'dueDate', 'priority', 'title']);
const PRIORITY_WEIGHT = { low: 1, medium: 2, high: 3 };

function compareValues(a, b, field) {
  if (field === 'priority') return PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
  const left = a[field] ?? '';
  const right = b[field] ?? '';
  return String(left).localeCompare(String(right));
}

function matchesFilters(task, { status, priority, search, tag }) {
  if (status && task.status !== status) return false;
  if (priority && task.priority !== priority) return false;
  if (tag && !task.tags.includes(tag)) return false;
  if (search) {
    const haystack = `${task.title} ${task.description}`.toLowerCase();
    if (!haystack.includes(search.toLowerCase())) return false;
  }
  return true;
}

/** In-memory task store. All reads return copies so callers cannot mutate state. */
class TaskRepository {
  constructor() {
    this.tasks = new Map();
  }

  async create(ownerId, data) {
    const now = new Date().toISOString();
    const task = {
      id: randomUUID(),
      ownerId,
      title: data.title,
      description: data.description ?? '',
      status: data.status ?? 'todo',
      priority: data.priority ?? 'medium',
      dueDate: data.dueDate ?? null,
      tags: data.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    return { ...task, tags: [...task.tags] };
  }

  async findById(id) {
    const task = this.tasks.get(id);
    return task ? { ...task, tags: [...task.tags] } : null;
  }

  async findByOwner(ownerId, options = {}) {
    const { page = 1, limit = 20, sort = 'createdAt', order = 'desc', ...filters } = options;
    const sortField = SORTABLE_FIELDS.has(sort) ? sort : 'createdAt';
    const direction = order === 'asc' ? 1 : -1;

    const matching = [...this.tasks.values()]
      .filter((task) => task.ownerId === ownerId && matchesFilters(task, filters))
      .sort((a, b) => compareValues(a, b, sortField) * direction);

    const start = (page - 1) * limit;
    return {
      items: matching.slice(start, start + limit).map((t) => ({ ...t, tags: [...t.tags] })),
      total: matching.length,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(matching.length / limit)),
    };
  }

  async update(id, changes) {
    const existing = this.tasks.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...changes, updatedAt: new Date().toISOString() };
    this.tasks.set(id, updated);
    return { ...updated, tags: [...updated.tags] };
  }

  async delete(id) {
    return this.tasks.delete(id);
  }

  async allForOwner(ownerId) {
    return [...this.tasks.values()].filter((t) => t.ownerId === ownerId).map((t) => ({ ...t }));
  }

  async count() {
    return this.tasks.size;
  }

  async countByStatus() {
    const counts = { todo: 0, in_progress: 0, done: 0 };
    for (const task of this.tasks.values()) counts[task.status] += 1;
    return counts;
  }

  async clear() {
    this.tasks.clear();
  }
}

module.exports = { TaskRepository, PRIORITY_WEIGHT };
