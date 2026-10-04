'use strict';

/**
 * Test strategy:
 *  - unit:        pure logic (services, repositories, middleware, config) with fakes
 *  - integration: the real Express app exercised over HTTP with Supertest
 *  - smoke:       separate config (jest.smoke.config.js) run against a deployed
 *                 container in the Deploy and Release stages
 * Coverage thresholds act as a hard quality gate: the Test stage fails below them.
 */
const common = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup-env.js'],
};

module.exports = {
  projects: [
    { ...common, displayName: 'unit', testMatch: ['<rootDir>/tests/unit/**/*.test.js'] },
    { ...common, displayName: 'integration', testMatch: ['<rootDir>/tests/integration/**/*.test.js'] },
  ],
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov', 'cobertura', 'html'],
  coverageThreshold: {
    global: { statements: 85, branches: 75, functions: 85, lines: 85 },
  },
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: 'reports/junit',
      outputName: 'jest-results.xml',
      classNameTemplate: '{displayName} › {classname}',
      titleTemplate: '{title}',
      addFileAttribute: 'true',
    }],
  ],
};
