'use strict';
/**
 * Local development runner: starts the interim legacy API (127.0.0.1:4189) and `next dev`
 * (http://localhost:4188) together. Next forwards /api/* to the API through
 * apps/web/src/app/api/[...path]/route.ts, which keeps Host/Origin/cookies intact and drops
 * synthetic forwarded headers, so the backend sees a direct localhost client exactly as before.
 */
const path = require('node:path');
const { spawn } = require('node:child_process');

const WEB_PORT = Number(process.env.PORT || 4188);
const API_PORT = Number(process.env.API_PORT || 4189);
const ROOT = path.join(__dirname, '..');

const children = [];
function run(name, command, args, cwd, env = {}) {
  const child = spawn(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' });
  child.on('exit', (code, signal) => {
    console.error(`[dev] ${name} exited (${signal || code})`);
    shutdown(1);
  });
  children.push(child);
}
let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1500).unref();
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

if (!process.env.API_ORIGIN) {
  run('api', process.execPath, ['OpenNEXT-preview-server.cjs'], path.join(ROOT, 'legacy'), {
    PORT: String(API_PORT),
    HOST: '127.0.0.1',
  });
}
run('web', 'pnpm', ['--filter', '@opennext/web', 'exec', 'next', 'dev', '-p', String(WEB_PORT)], ROOT, {
  API_ORIGIN: process.env.API_ORIGIN || `http://127.0.0.1:${API_PORT}`,
});
