'use strict';
/**
 * Container entry point: runs the Next.js front-end and the (interim) legacy API in one
 * container so the existing single-container deployment keeps working. When the Python
 * backend replaces the legacy API, run it as its own service and point API_ORIGIN at it.
 *
 * Bundled adapter: an image built with SPOTBOT_SOURCE=image also contains the SpotOrderBot
 * adapter and ClamAV. With OPENNEXT_ADAPTER=1 the container runs the legacy API on
 * 127.0.0.1:4189, ClamAV on 127.0.0.1:3310, the adapter on 127.0.0.1:4191 in front of the
 * legacy API, and the front-end pointed at the adapter. The adapter keeps its database and the
 * KYB documents in the data volume; its other settings come from SPOTBOT_* variables.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const WEB_PORT = process.env.PORT || '4188';
const API_PORT = process.env.API_PORT || '4189';
const ADAPTER_PORT = '4191';
const DATA_DIR = process.env.OPENNEXT_DATA_DIR || '/app/.opennext-data';
const SPOTBOT = '/opt/spotbot/bin/spotbot';
const DOCKER = __dirname;

const children = [];
function run(name, command, args, env, { required = true } = {}) {
  const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  child.on('exit', (code, signal) => {
    if (!required) {
      console.error(`[${name}] exited (${signal || code}); continuing without it`);
      return;
    }
    console.error(`[${name}] exited (${signal || code}); stopping container`);
    shutdown(code === 0 ? 0 : 1);
  });
  children.push(child);
  return child;
}
let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 2000).unref();
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

function runLegacy() {
  run('api', process.execPath, [path.join(DOCKER, '..', 'legacy', 'OpenNEXT-preview-server.cjs')], {
    PORT: API_PORT,
    HOST: '127.0.0.1',
    OPENNEXT_TRUST_PROXY: '1',
  });
}

function runWeb(apiOrigin) {
  run('web', process.execPath, [path.join(DOCKER, '..', 'apps', 'web', 'server.js')], {
    PORT: WEB_PORT,
    HOSTNAME: '0.0.0.0',
    API_ORIGIN: apiOrigin,
  });
}

/**
 * ClamAV for Buyer KYB uploads: refresh the signatures once, then run the daemon and keep
 * refreshing. A scanner that is down only stops uploads (the adapter refuses them); the rest
 * of the site keeps running. OPENNEXT_CLAMAV=0 leaves it off.
 */
function runClamav() {
  if (process.env.OPENNEXT_CLAMAV === '0') return;
  fs.mkdirSync(path.join(DATA_DIR, 'clamav'), { recursive: true });
  const update = spawn('freshclam', ['--config-file', path.join(DOCKER, 'freshclam.conf')], {
    stdio: 'inherit',
  });
  update.on('exit', () => {
    if (stopping) return;
    run(
      'clamd',
      'clamd',
      ['--config-file', path.join(DOCKER, 'clamd.conf')],
      {},
      { required: false },
    );
    run(
      'freshclam',
      'freshclam',
      ['--daemon', '--config-file', path.join(DOCKER, 'freshclam.conf')],
      {},
      { required: false },
    );
  });
}

/** The adapter in front of the legacy API; its own settings come from SPOTBOT_* variables. */
function runAdapter() {
  const dir = path.join(DATA_DIR, 'spotbot');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  run('adapter', SPOTBOT, ['opennext-api', '--host', '127.0.0.1', '--port', ADAPTER_PORT], {
    SPOTBOT_STORAGE_BACKEND: process.env.SPOTBOT_STORAGE_BACKEND || 'sqlite',
    SPOTBOT_DATABASE_PATH: process.env.SPOTBOT_DATABASE_PATH || path.join(dir, 'adapter.db'),
    SPOTBOT_OPENNEXT_LEGACY_ORIGIN: `http://127.0.0.1:${API_PORT}`,
    SPOTBOT_OPENNEXT_FILES_DIR: process.env.SPOTBOT_OPENNEXT_FILES_DIR || path.join(dir, 'kyb'),
    SPOTBOT_OPENNEXT_CLAMD:
      process.env.SPOTBOT_OPENNEXT_CLAMD ||
      (process.env.OPENNEXT_CLAMAV === '0' ? '' : '127.0.0.1:3310'),
  });
}

/** Start the stack; `legacy: false` lets a caller run the legacy API itself (test site). */
function start({ legacy = true } = {}) {
  if (process.env.OPENNEXT_ADAPTER === '1') {
    if (!fs.existsSync(SPOTBOT)) {
      console.error('[adapter] OPENNEXT_ADAPTER=1 needs an image built with SPOTBOT_SOURCE=image');
      process.exit(1);
    }
    if (legacy) runLegacy();
    runClamav();
    runAdapter();
    runWeb(`http://127.0.0.1:${ADAPTER_PORT}`);
    return;
  }
  if (process.env.API_ORIGIN) {
    console.log(`[api] external backend at ${process.env.API_ORIGIN}`);
  } else if (legacy) {
    runLegacy();
  }
  runWeb(process.env.API_ORIGIN || `http://127.0.0.1:${API_PORT}`);
}

module.exports = { start };
if (require.main === module) start();
