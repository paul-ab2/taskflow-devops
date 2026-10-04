'use strict';

const jwt = require('jsonwebtoken');
const { AuthService, toPublicUser } = require('../../src/services/auth.service');
const { UserRepository } = require('../../src/repositories/user.repository');
const { ConflictError, UnauthorizedError } = require('../../src/utils/errors');
const { testConfig } = require('../helpers');

function fakeMetrics() {
  return { usersRegistered: { inc: jest.fn() }, authFailures: { inc: jest.fn() } };
}

describe('AuthService', () => {
  let service;
  let metrics;
  const config = testConfig();

  beforeEach(() => {
    metrics = fakeMetrics();
    service = new AuthService({ userRepository: new UserRepository(), config, metrics });
  });

  it('registers a user, hashes the password and never returns the hash', async () => {
    const { user, token } = await service.register({ email: 'a@b.com', password: 'Passw0rd!', name: 'A' });
    expect(user).not.toHaveProperty('passwordHash');
    expect(token).toEqual(expect.any(String));
    expect(metrics.usersRegistered.inc).toHaveBeenCalled();
  });

  it('rejects duplicate registrations', async () => {
    await service.register({ email: 'dup@b.com', password: 'Passw0rd!', name: 'A' });
    await expect(service.register({ email: 'DUP@b.com', password: 'Passw0rd!', name: 'B' }))
      .rejects.toThrow(ConflictError);
  });

  it('logs in with correct credentials', async () => {
    await service.register({ email: 'login@b.com', password: 'Passw0rd!', name: 'A' });
    const { user } = await service.login({ email: 'login@b.com', password: 'Passw0rd!' });
    expect(user.email).toBe('login@b.com');
  });

  it.each([
    ['wrong password', 'login2@b.com', 'WrongPass1'],
    ['unknown email', 'nobody@b.com', 'Passw0rd!'],
  ])('rejects login with %s using the same generic message', async (_label, email, password) => {
    await service.register({ email: 'login2@b.com', password: 'Passw0rd!', name: 'A' });
    await expect(service.login({ email, password })).rejects.toThrow('Invalid email or password');
    expect(metrics.authFailures.inc).toHaveBeenCalledWith({ reason: 'invalid_credentials' });
  });

  it('issues tokens that verify with the pinned algorithm and issuer', async () => {
    const { token, user } = await service.register({ email: 't@b.com', password: 'Passw0rd!', name: 'A' });
    expect(service.verifyToken(token)).toMatchObject({ sub: user.id, role: 'user', iss: 'taskflow-api' });
  });

  it('rejects tokens signed with a different secret', () => {
    const forged = jwt.sign({ sub: 'x' }, 'attacker-secret', { issuer: 'taskflow-api' });
    expect(() => service.verifyToken(forged)).toThrow(UnauthorizedError);
    expect(metrics.authFailures.inc).toHaveBeenCalledWith({ reason: 'token_invalid' });
  });

  it('rejects unsigned "alg: none" tokens', () => {
    const unsigned = jwt.sign({ sub: 'x' }, '', { algorithm: 'none', issuer: 'taskflow-api' });
    expect(() => service.verifyToken(unsigned)).toThrow(UnauthorizedError);
  });

  it('reports expired tokens distinctly', () => {
    const expired = jwt.sign({ sub: 'x', exp: Math.floor(Date.now() / 1000) - 60 }, config.jwt.secret, {
      issuer: 'taskflow-api',
    });
    expect(() => service.verifyToken(expired)).toThrow('Token has expired');
    expect(metrics.authFailures.inc).toHaveBeenCalledWith({ reason: 'token_expired' });
  });

  it('getProfile fails for deleted users', async () => {
    await expect(service.getProfile('ghost')).rejects.toThrow(UnauthorizedError);
  });

  it('toPublicUser strips the password hash', () => {
    expect(toPublicUser({ id: '1', passwordHash: 'secret' })).toEqual({ id: '1' });
  });
});
