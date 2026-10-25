'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sources = fs.readdirSync(root).filter(name => /\.(?:js|cjs)$/.test(name));
sources.push('scripts/check.cjs', ...fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.cjs')).map(name => 'tests/' + name));
for (const source of sources) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, source)], {encoding: 'utf8'});
  if (result.status !== 0) {
    console.error(result.stderr || result.error?.message || `Invalid JavaScript: ${source}`);
    process.exit(1);
  }
}
console.log(`Syntax checked ${sources.length} JavaScript files.`);
