'use strict';

const request = require('supertest');
const { buildTestApp, registerUser, authed } = require('../helpers');

describe('Auth API', () => {
  let app;

  beforeEach(() => {
    app = buildTestApp();
  });

  describe('POST /api/auth/register', () => {
    it('creates an account and returns a JWT', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'New@Example.com', password: 'Passw0rd!', name: 'New User' })
        .expect(201);
      expect(res.body.user).toMatchObject({ email: 'new@example.com', name: 'New User', role: 'user' });
      expect(res.body.user).not.toHaveProperty('passwordHash');
      expect(res.body.token.split('.')).toHaveLength(3);
    });

    it('rejects weak passwords with field-level details', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'weak@example.com', password: 'short', name: 'Weak' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.map((d) => d.field)).toContain('password');
    });

    it('returns 409 for an email that is already registered', async () => {
      const { credentials } = await registerUser(app);
      const res = await request(app).post('/api/auth/register').send(credentials).expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('ignores attempts to self-assign the admin role (mass assignment)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'sneaky@example.com', password: 'Passw0rd!', name: 'Sneaky', role: 'admin' })
        .expect(201);
      expect(res.body.user.role).toBe('user');
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns a token for valid credentials', async () => {
      const { credentials } = await registerUser(app);
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: credentials.email, password: credentials.password })
        .expect(200);
      expect(res.body.token).toEqual(expect.any(String));
    });

    it('returns 401 with a generic message for bad credentials', async () => {
      const { credentials } = await registerUser(app);
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: credentials.email, password: 'WrongPassw0rd' })
        .expect(401);
      expect(res.body.error.message).toBe('Invalid email or password');
    });

    it('rate-limits repeated attempts', async () => {
      const limited = buildTestApp({ rateLimit: { windowMs: 60000, authMax: 2 } });
      const body = { email: 'x@example.com', password: 'whatever1' };
      await request(limited).post('/api/auth/login').send(body).expect(401);
      await request(limited).post('/api/auth/login').send(body).expect(401);
      const res = await request(limited).post('/api/auth/login').send(body).expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns the current user for a valid token', async () => {
      const { token, user } = await registerUser(app);
      const res = await authed(app, token).get('/api/auth/me').expect(200);
      expect(res.body.user.id).toBe(user.id);
    });

    it.each([
      ['no header', undefined],
      ['wrong scheme', 'Basic abc'],
      ['garbage token', 'Bearer not.a.jwt'],
    ])('returns 401 with %s', async (_label, header) => {
      const req = request(app).get('/api/auth/me');
      if (header) req.set('Authorization', header);
      const res = await req.expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });
});
