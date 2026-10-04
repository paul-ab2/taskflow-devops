#!/usr/bin/env node
'use strict';

/**
 * Build step: stamps version metadata into build-info.json so that every
 * artefact (Docker image, npm tarball) can be traced back to the exact
 * commit and Jenkins build that produced it. Served at GET /api/version.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

function gitCommit() {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'local';
  }
}

const pkg = require('../package.json');
const info = {
  version: process.env.APP_VERSION || pkg.version,
  commit: gitCommit(),
  buildNumber: process.env.BUILD_NUMBER || 'dev',
  builtAt: new Date().toISOString(),
};

fs.writeFileSync(path.join(__dirname, '..', 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(`build-info.json written: ${JSON.stringify(info)}`);
