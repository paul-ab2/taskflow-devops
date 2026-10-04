'use strict';

const Joi = require('joi');

const STATUSES = ['todo', 'in_progress', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];

// At least 8 chars with a letter and a digit.
const password = Joi.string()
  .min(8)
  .max(128)
  .pattern(/[A-Za-z]/, 'letter')
  .pattern(/\d/, 'digit')
  .required();

const tags = Joi.array().items(Joi.string().trim().lowercase().max(30)).max(10).unique();

const schemas = {
  register: Joi.object({
    email: Joi.string().trim().lowercase().email().max(254).required(),
    password,
    name: Joi.string().trim().min(1).max(100).required(),
  }),

  login: Joi.object({
    email: Joi.string().trim().lowercase().email().required(),
    password: Joi.string().required(),
  }),

  createTask: Joi.object({
    title: Joi.string().trim().min(1).max(200).required(),
    description: Joi.string().trim().max(2000).allow(''),
    status: Joi.string().valid(...STATUSES),
    priority: Joi.string().valid(...PRIORITIES),
    dueDate: Joi.date().iso().allow(null),
    tags,
  }),

  updateTask: Joi.object({
    title: Joi.string().trim().min(1).max(200),
    description: Joi.string().trim().max(2000).allow(''),
    status: Joi.string().valid(...STATUSES),
    priority: Joi.string().valid(...PRIORITIES),
    dueDate: Joi.date().iso().allow(null),
    tags,
  }).min(1),

  listTasks: Joi.object({
    status: Joi.string().valid(...STATUSES),
    priority: Joi.string().valid(...PRIORITIES),
    tag: Joi.string().trim().lowercase().max(30),
    search: Joi.string().trim().max(100),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort: Joi.string().valid('createdAt', 'updatedAt', 'dueDate', 'priority', 'title').default('createdAt'),
    order: Joi.string().valid('asc', 'desc').default('desc'),
  }),

  taskId: Joi.object({
    id: Joi.string().guid({ version: 'uuidv4' }).required(),
  }),

  chaos: Joi.object({
    mode: Joi.string().valid('off', 'errors', 'latency').required(),
    errorRate: Joi.number().min(0).max(1).default(0.5),
    latencyMs: Joi.number().integer().min(0).max(10000).default(1500),
    durationSeconds: Joi.number().integer().min(1).max(900).default(120),
  }),
};

module.exports = { schemas, STATUSES, PRIORITIES };
