'use strict';

const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ConflictError, UnauthorizedError } = require('../utils/errors');

const JWT_ALGORITHM = 'HS256';

/** Removes sensitive fields before a user object leaves the service layer. */
function toPublicUser(user) {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}

class AuthService {
  constructor({ userRepository, config, metrics }) {
    this.users = userRepository;
    this.config = config;
    this.metrics = metrics;
    // Pre-computed hash used when the email is unknown so login timing is constant.
    this.dummyHash = bcrypt.hashSync(randomUUID(), config.bcryptRounds);
  }

  async register({ email, password, name }) {
    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new ConflictError('An account with this email already exists');
    }
    const passwordHash = await bcrypt.hash(password, this.config.bcryptRounds);
    const user = await this.users.create({ email, name, passwordHash });
    this.metrics?.usersRegistered.inc();
    return { user: toPublicUser(user), token: this.issueToken(user) };
  }

  async login({ email, password }) {
    const user = await this.users.findByEmail(email);
    // Always run bcrypt.compare to keep response time constant and avoid
    // leaking which emails are registered (user-enumeration protection).
    const hash = user?.passwordHash ?? this.dummyHash;
    const valid = await bcrypt.compare(password, hash);
    if (!user || !valid) {
      this.metrics?.authFailures.inc({ reason: 'invalid_credentials' });
      throw new UnauthorizedError('Invalid email or password');
    }
    return { user: toPublicUser(user), token: this.issueToken(user) };
  }

  issueToken(user) {
    return jwt.sign({ sub: user.id, role: user.role }, this.config.jwt.secret, {
      algorithm: JWT_ALGORITHM,
      expiresIn: this.config.jwt.expiresIn,
      issuer: this.config.jwt.issuer,
    });
  }

  verifyToken(token) {
    try {
      return jwt.verify(token, this.config.jwt.secret, {
        algorithms: [JWT_ALGORITHM], // pin the algorithm - blocks "alg: none" / key-confusion attacks
        issuer: this.config.jwt.issuer,
      });
    } catch (err) {
      const reason = err.name === 'TokenExpiredError' ? 'token_expired' : 'token_invalid';
      this.metrics?.authFailures.inc({ reason });
      throw new UnauthorizedError(reason === 'token_expired' ? 'Token has expired' : 'Invalid token');
    }
  }

  async getProfile(userId) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedError('User no longer exists');
    return toPublicUser(user);
  }
}

module.exports = { AuthService, toPublicUser };
