'use strict';

const Joi = require('joi');
const { validate } = require('../../src/middleware/validate');
const { requireRole } = require('../../src/middleware/auth');
const { routeLabel } = require('../../src/middleware/metrics');
const { ChaosController } = require('../../src/middleware/chaos');
const { safeEqual } = require('../../src/routes/admin.routes');
const { ForbiddenError, ValidationError } = require('../../src/utils/errors');

describe('validate middleware', () => {
  const schema = Joi.object({ name: Joi.string().required() });

  it('strips unknown fields and stores the clean value on req.validated', () => {
    const req = { body: { name: 'ok', ownerId: 'evil' } };
    const next = jest.fn();
    validate(schema)(req, {}, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.validated.body).toEqual({ name: 'ok' });
  });

  it('passes a ValidationError with field details', () => {
    const next = jest.fn();
    validate(schema)({ body: {} }, {}, next);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.details[0]).toMatchObject({ field: 'name' });
  });

  it('treats a missing request part as an empty object', () => {
    const next = jest.fn();
    validate(Joi.object({}), 'query')({}, {}, next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('requireRole', () => {
  it('allows matching roles and blocks others', () => {
    const next = jest.fn();
    requireRole('admin')({ user: { role: 'admin' } }, {}, next);
    expect(next).toHaveBeenLastCalledWith();
    requireRole('admin')({ user: { role: 'user' } }, {}, next);
    expect(next.mock.calls[1][0]).toBeInstanceOf(ForbiddenError);
    requireRole('admin')({}, {}, next);
    expect(next.mock.calls[2][0]).toBeInstanceOf(ForbiddenError);
  });
});

describe('routeLabel', () => {
  it('uses the route template to keep metric cardinality low', () => {
    expect(routeLabel({ baseUrl: '/api/tasks', route: { path: '/:id' } })).toBe('/api/tasks/:id');
    expect(routeLabel({})).toBe('unmatched');
  });
});

describe('safeEqual', () => {
  it('compares strings in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('ChaosController', () => {
  function fakeMetrics() {
    return { chaosActive: { set: jest.fn(), reset: jest.fn() } };
  }

  it('injects errors according to the configured rate', async () => {
    const chaos = new ChaosController({ metrics: fakeMetrics(), random: () => 0.1 });
    chaos.enable({ mode: 'errors', errorRate: 0.5, durationSeconds: 60 });
    const next = jest.fn();
    await chaos.middleware()({ path: '/tasks' }, {}, next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 500, code: 'CHAOS_INJECTED' });
  });

  it('lets requests through when the random draw is above the error rate', async () => {
    const chaos = new ChaosController({ random: () => 0.9 });
    chaos.enable({ mode: 'errors', errorRate: 0.5 });
    const next = jest.fn();
    await chaos.middleware()({ path: '/tasks' }, {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('adds latency in latency mode', async () => {
    const chaos = new ChaosController();
    chaos.enable({ mode: 'latency', latencyMs: 20 });
    const next = jest.fn();
    const started = Date.now();
    await chaos.middleware()({ path: '/tasks' }, {}, next);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
    expect(next).toHaveBeenCalledWith();
  });

  it('never affects admin routes so the experiment can always be stopped', async () => {
    const chaos = new ChaosController({ random: () => 0 });
    chaos.enable({ mode: 'errors', errorRate: 1 });
    const next = jest.fn();
    await chaos.middleware()({ path: '/admin/chaos' }, {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('switches itself off after the duration expires', () => {
    let clock = 1000;
    const chaos = new ChaosController({ now: () => clock });
    chaos.enable({ mode: 'errors', durationSeconds: 10 });
    expect(chaos.status().mode).toBe('errors');
    clock += 11000;
    expect(chaos.status()).toEqual({ mode: 'off' });
  });

  it('can be disabled explicitly via mode "off"', () => {
    const metrics = fakeMetrics();
    const chaos = new ChaosController({ metrics });
    chaos.enable({ mode: 'latency' });
    expect(chaos.enable({ mode: 'off' })).toEqual({ mode: 'off' });
    expect(metrics.chaosActive.reset).toHaveBeenCalled();
  });
});
