'use strict';
// Only an empty, new production mount is accepted. No fixture or existing account is read.
const fs = require('node:fs');
const path = require('node:path');
const dir = process.env.OPENNEXT_DATA_DIR || '/app/.opennext-data';
const id = process.argv[2];
if (!/^[a-f0-9]{32}$/.test(id || '')) throw new Error('A production deployment ID is required.');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
if (fs.readdirSync(dir).length)
  throw new Error('Refusing to initialize a nonempty account directory.');
const marketplace = { version: 2 };
for (const key of [
  'rfqs',
  'supplies',
  'kyb',
  'interests',
  'instances',
  'quotes',
  'orders',
  'notifications',
  'audit',
  'homepageReviews',
  'submissionRequests',
])
  marketplace[key] = [];
const records = {
  'auth-state.json': { version: 1, users: [], sessions: [] },
  'marketplace.json': marketplace,
  'credit-topups.json': { version: 1, demo: false, requests: [], credits: [], notifications: [] },
  'credit-topups.initialized': { version: 1, demo: false },
  '.production-deployment.json': { deploymentId: id },
};
for (const [name, value] of Object.entries(records)) {
  const target = path.join(dir, name);
  fs.writeFileSync(target, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  if (process.getuid?.() === 0) fs.chownSync(target, 1000, 1000);
}
if (process.getuid?.() === 0) fs.chownSync(dir, 1000, 1000);
console.log('Initialized empty production accounts, Credit and marketplace records.');
