'use strict';

const request = require('supertest');
const { createApp } = require('../src/app');
const { buildConfig } = require('../src/config');

function testConfig(overrides = {}) {
  return { ...buildConfig({ NODE_ENV: 'test', APP_ENV: 'test', LOG_LEVEL: 'silent' }), ...overrides };
}

function buildTestApp(configOverrides = {}) {
  return createApp({ config: testConfig(configOverrides) });
}

let counter = 0;
async function registerUser(app, overrides = {}) {
  counter += 1;
  const payload = {
    email: `user${counter}-${Date.now()}@example.com`,
    password: 'Sup3rSecret!',
    name: `User ${counter}`,
    ...overrides,
  };
  const res = await request(app).post('/api/auth/register').send(payload).expect(201);
  return { ...res.body, credentials: payload };
}

function authed(app, token) {
  const agent = request(app);
  const withAuth = (req) => req.set('Authorization', `Bearer ${token}`);
  return {
    get: (url) => withAuth(agent.get(url)),
    post: (url) => withAuth(agent.post(url)),
    patch: (url) => withAuth(agent.patch(url)),
    delete: (url) => withAuth(agent.delete(url)),
  };
}

module.exports = { testConfig, buildTestApp, registerUser, authed };
