'use strict';

/**
 * Centralised, environment-driven configuration.
 * Every value can be overridden with an environment variable so the same
 * Docker image is promoted unchanged from staging to production
 * (12-factor "config in the environment").
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DEV_SECRET = 'dev-only-insecure-secret-change-me';

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function loadBuildInfo() {
  const file = path.join(__dirname, '..', '..', 'build-info.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function readBuild(env) {
  const buildInfo = loadBuildInfo();
  return {
    version: env.APP_VERSION || buildInfo.version || require('../../package.json').version,
    commit: env.GIT_COMMIT || buildInfo.commit || 'local',
    buildNumber: env.BUILD_NUMBER || buildInfo.buildNumber || 'dev',
    builtAt: buildInfo.builtAt || null,
  };
}

function readJwt(env) {
  return {
    secret: env.JWT_SECRET || DEFAULT_DEV_SECRET,
    expiresIn: env.JWT_EXPIRES_IN || '1h',
    issuer: 'taskflow-api',
  };
}

function buildConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isTest = nodeEnv === 'test';

  const config = {
    nodeEnv,
    appEnv: env.APP_ENV || nodeEnv,
    port: toInt(env.PORT, 3000),
    logLevel: env.LOG_LEVEL || (isTest ? 'silent' : 'info'),
    jwt: readJwt(env),
    bcryptRounds: toInt(env.BCRYPT_ROUNDS, isTest ? 4 : 10),
    rateLimit: {
      windowMs: toInt(env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
      authMax: toInt(env.RATE_LIMIT_AUTH_MAX, isTest ? 1000 : 20),
    },
    chaosToken: env.CHAOS_TOKEN || '',
    build: readBuild(env),
  };

  validateConfig(config);
  return config;
}

function validateConfig(config) {
  const isDeployed = ['staging', 'production'].includes(config.appEnv);
  if (isDeployed && config.jwt.secret === DEFAULT_DEV_SECRET) {
    throw new Error(`JWT_SECRET must be set when APP_ENV=${config.appEnv}`);
  }
  if (isDeployed && config.jwt.secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in deployed environments');
  }
}

module.exports = { buildConfig, validateConfig, DEFAULT_DEV_SECRET };
