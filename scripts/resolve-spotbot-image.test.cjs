'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveImage } = require('./resolve-spotbot-image.cjs');
const repo = 'ghcr.io/vishwanetwork/spot-order-bot';

test('the checked-in Dockerfile pins an immutable bot version', () => {
  assert.match(resolveImage(fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8')), /:[a-f0-9]{40}$/);
});

test('operators can select an immutable SHA or digest', () => {
  for (const suffix of [':' + 'a'.repeat(40), '@sha256:' + 'b'.repeat(64)]) {
    assert.equal(resolveImage('', repo + suffix), repo + suffix);
  }
});

test('mutable, missing, malformed and foreign images cannot silently enter a deployment', () => {
  for (const image of ['', repo + ':latest', repo + ':shortsha', repo + ':main', 'other:latest', repo + ':' + 'a'.repeat(40) + '\ninjected=1']) {
    assert.throws(() => resolveImage('', image), /must pin/);
  }
});
