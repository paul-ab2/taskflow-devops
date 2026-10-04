'use strict';

/**
 * Post-deployment smoke / acceptance tests. They run against a live
 * environment given by BASE_URL (staging in the Deploy stage, production in
 * the Release stage) and prove the deployment actually works end to end.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/smoke/**/*.test.js'],
  testTimeout: 20000,
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: 'reports/junit',
      outputName: `smoke-${process.env.SMOKE_ENV || 'env'}-results.xml`,
      suiteNameTemplate: `smoke (${process.env.SMOKE_ENV || 'env'}) › {filepath}`,
      classNameTemplate: `smoke-${process.env.SMOKE_ENV || 'env'} › {classname}`,
      titleTemplate: '{title}',
    }],
  ],
};
