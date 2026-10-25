'use strict';
/**
 * Container entry point: runs the Next.js front-end and the (interim) legacy API in one
 * container so the existing single-container deployment keeps working. When the Python
 * backend replaces the legacy API, run it as its own service and point API_ORIGIN at it.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const WEB_PORT = process.env.PORT || '4188';
const API_PORT = process.env.API_PORT || '4189';

const children = [];
function run(name, command, args, env) {
  const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  child.on('exit', (code, signal) => {
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

if (process.env.API_ORIGIN) {
  console.log(`[api] external backend at ${process.env.API_ORIGIN}`);
} else {
  run('api', process.execPath, [path.join(__dirname, '..', 'legacy', 'OpenNEXT-preview-server.cjs')], {
    PORT: API_PORT,
    HOST: '127.0.0.1',
    OPENNEXT_TRUST_PROXY: '1',
  });
}
run('web', process.execPath, [path.join(__dirname, '..', 'apps', 'web', 'server.js')], {
  PORT: WEB_PORT,
  HOSTNAME: '0.0.0.0',
  API_ORIGIN: process.env.API_ORIGIN || `http://127.0.0.1:${API_PORT}`,
});
