'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const jest = require('eslint-plugin-jest');

/**
 * ESLint is the first, fast layer of the Code Quality stage (SonarQube is the second).
 * The custom rules below enforce maintainability limits the team agreed on:
 * low cyclomatic complexity, shallow nesting, short functions and few parameters.
 */
module.exports = [
  {
    ignores: ['node_modules/**', 'coverage/**', 'reports/**', '.scannerwork/**', 'dist/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      complexity: ['error', { max: 10 }],
      'max-depth': ['error', 3],
      'max-params': ['error', 4],
      'max-lines-per-function': ['warn', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-nested-callbacks': ['error', 4],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      strict: ['error', 'global'],
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
    rules: { 'max-lines-per-function': 'off', 'no-alert': 'off', strict: 'off' },
  },
  {
    files: ['scripts/**/*.js'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['tests/**/*.js'],
    ...jest.configs['flat/recommended'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: {
      ...jest.configs['flat/recommended'].rules,
      'max-lines-per-function': 'off',
      'max-nested-callbacks': 'off',
      // Supertest's .expect(status) is an assertion too.
      'jest/expect-expect': ['error', {
        assertFunctionNames: ['expect', 'request.**.expect', 'api.**.expect', 'other.**.expect', 'admin.**.expect'],
      }],
    },
  },
];
