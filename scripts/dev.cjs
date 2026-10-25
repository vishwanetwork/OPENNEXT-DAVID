'use strict';
/**
 * Local development runner.
 *
 *   browser → http://localhost:4188 (this proxy)
 *               ├─ /api/*     → interim legacy API on 127.0.0.1:4189  (Host preserved, no
 *               │                forwarded headers, so the API sees a direct localhost client
 *               │                exactly as before and the console needs no admin token)
 *               └─ everything → `next dev` on 127.0.0.1:4190 (HMR websocket included)
 *
 * This is dev-only plumbing. In production Next.js proxies /api itself (next.config.ts) and the
 * backend authenticates administrators with OPENNEXT_ADMIN_TOKEN behind the HTTPS reverse proxy.
 */
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = Number(process.env.PORT || 4188);
const WEB_PORT = Number(process.env.WEB_PORT || 4190);
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
run('web', 'pnpm', ['--filter', '@opennext/web', 'exec', 'next', 'dev', '-p', String(WEB_PORT), '-H', '127.0.0.1'], ROOT, {
  API_ORIGIN: process.env.API_ORIGIN || `http://127.0.0.1:${API_PORT}`,
});

const upstreamFor = (url) => (url.startsWith('/api/') || url === '/api' ? API_PORT : WEB_PORT);

const server = http.createServer((req, res) => {
  const port = upstreamFor(req.url || '/');
  const headers = { ...req.headers };
  // Next's dev server validates the Host header against its own origin; the API relies on the
  // browser-facing Host for same-origin checks, so only the web upstream gets it rewritten.
  if (port === WEB_PORT) headers.host = `localhost:${WEB_PORT}`;
  const upstream = http.request(
    { host: '127.0.0.1', port, method: req.method, path: req.url, headers },
    (response) => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`Upstream on port ${port} is not ready (${error.message}). Retry in a moment.`);
  });
  req.pipe(upstream);
});

server.on('upgrade', (req, socket, head) => {
  const port = upstreamFor(req.url || '/');
  const target = net.connect(port, '127.0.0.1', () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (const [key, value] of Object.entries(req.headers)) {
      const resolved = key === 'host' && port === WEB_PORT ? `localhost:${WEB_PORT}` : value;
      lines.push(`${key}: ${Array.isArray(resolved) ? resolved.join(', ') : resolved}`);
    }
    target.write(lines.join('\r\n') + '\r\n\r\n');
    if (head.length) target.write(head);
    socket.pipe(target).pipe(socket);
  });
  target.on('error', () => socket.destroy());
  socket.on('error', () => target.destroy());
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev] OpenNEXT at http://localhost:${PORT}  (/  /terminal  /admin  /demo)`);
});
