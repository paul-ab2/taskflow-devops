'use strict';

const { buildConfig, DEFAULT_DEV_SECRET } = require('../../src/config');

describe('buildConfig', () => {
  it('uses safe development defaults', () => {
    const config = buildConfig({});
    expect(config.appEnv).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.jwt.secret).toBe(DEFAULT_DEV_SECRET);
    expect(config.bcryptRounds).toBe(10);
  });

  it('reads overrides from the environment', () => {
    const config = buildConfig({
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      PORT: '8080',
      LOG_LEVEL: 'debug',
      JWT_SECRET: 'x'.repeat(40),
      RATE_LIMIT_AUTH_MAX: '50',
      APP_VERSION: '2.0.0',
      GIT_COMMIT: 'abc1234',
      BUILD_NUMBER: '42',
    });
    expect(config).toMatchObject({ appEnv: 'staging', port: 8080, logLevel: 'debug' });
    expect(config.rateLimit.authMax).toBe(50);
    expect(config.build).toMatchObject({ version: '2.0.0', commit: 'abc1234', buildNumber: '42' });
  });

  it('falls back to defaults for invalid numbers', () => {
    expect(buildConfig({ PORT: 'not-a-number' }).port).toBe(3000);
  });

  it.each(['staging', 'production'])('refuses to start in %s without a JWT secret', (appEnv) => {
    expect(() => buildConfig({ APP_ENV: appEnv })).toThrow('JWT_SECRET must be set');
  });

  it('refuses short secrets in deployed environments', () => {
    expect(() => buildConfig({ APP_ENV: 'production', JWT_SECRET: 'short' })).toThrow('at least 32 characters');
  });
});
