'use strict';

const { randomUUID } = require('node:crypto');

/**
 * In-memory user store behind a repository interface.
 * Swapping this for PostgreSQL/MongoDB only requires a new class with the
 * same async methods - services and routes stay unchanged.
 */
class UserRepository {
  constructor() {
    this.users = new Map();
  }

  async create({ email, name, passwordHash, role = 'user' }) {
    const user = {
      id: randomUUID(),
      email: email.toLowerCase(),
      name,
      passwordHash,
      role,
      createdAt: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    return { ...user };
  }

  async findByEmail(email) {
    const needle = String(email).toLowerCase();
    for (const user of this.users.values()) {
      if (user.email === needle) return { ...user };
    }
    return null;
  }

  async findById(id) {
    const user = this.users.get(id);
    return user ? { ...user } : null;
  }

  async count() {
    return this.users.size;
  }

  async clear() {
    this.users.clear();
  }
}

module.exports = { UserRepository };
