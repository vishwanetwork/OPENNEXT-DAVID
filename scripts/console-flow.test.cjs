'use strict';

// Optional cross-repository acceptance test. All provider responses are fixtures;
// no cloud API, purchase, email service or production database is contacted.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');

const botRoot = process.env.SPOTBOT_TEST_ROOT;
const python = process.env.SPOTBOT_TEST_PYTHON;

test('Console credential -> collector -> Terminal catalog survives both service restarts', {
  skip: !botRoot || !python ? 'Set SPOTBOT_TEST_ROOT and SPOTBOT_TEST_PYTHON to run the two-service acceptance test.' : false,
  timeout: 90000,
}, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'console-flow-'));
  const token = randomBytes(32).toString('hex');
  const consoleKey = randomBytes(32).toString('base64');
  const providerKey = 'fixture-provider-key';
  const hosts = { SITE_HOST: 'site.test', TERMINAL_HOST: 'terminal.test', ADMIN_HOST: 'admin.test' };
  Object.assign(process.env, hosts);
  const { createAppServer } = require('../legacy/OpenNEXT-preview-server.cjs');
  const { createPricingService } = require('../legacy/OpenNEXT-pricing-service.cjs');
  fs.writeFileSync(path.join(dir, 'auth-state.json'), JSON.stringify({ version: 1, users: [{ id: 'user-one', name: 'Buyer', email: 'buyer@example.test',
    role: 'buyer', onboardingCompleted: true, createdAt: new Date().toISOString(), identities: [] }], sessions: [] }), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'marketplace.json'), JSON.stringify({ version: 2, orders: [], audit: [] }), { mode: 0o600 });
  let legacy, adapter, legacyPort, adapterPort, cookie;
  let providerCalls = 0;
  const environment = { ...hosts, OPENNEXT_ADMIN_TOKEN: token, OPENNEXT_TRUST_PROXY: '1', OPENNEXT_EXTERNAL_MARKETPLACE_ENABLED: '0' };

  async function startLegacy() {
    const pricing = createPricingService({ dataDir: dir, fetchImpl: async (url, init) => {
      assert.equal(new URL(url).hostname, 'cloud.lambda.ai');
      assert.equal(init.headers.Authorization, 'Bearer ' + providerKey);
      providerCalls++;
      return new Response(JSON.stringify({ data: { gpu_1x_h100: { instance_type: { name: 'gpu_1x_h100', gpu_description: 'H100 (80 GB SXM5)',
        price_cents_per_hour: 200, specs: { gpus: 1 } }, regions_with_capacity_available: [{ name: 'us-east-1' }] } } }));
    } });
    legacy = createAppServer({ dataDir: dir, env: environment, pricingService: pricing, externalService: false,
      capacityService: { close: async () => {} }, newsService: { close: async () => {} } });
    await new Promise((resolve) => legacy.listen(legacyPort || 0, '127.0.0.1', resolve));
    legacyPort = legacy.address().port;
  }
  async function stopLegacy() {
    if (!legacy) return;
    legacy.closeAllConnections();
    await new Promise((resolve) => legacy.close(resolve));
    legacy = null;
  }
  async function freePort() {
    const server = http.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    return port;
  }
  async function startAdapter() {
    adapterPort ||= await freePort();
    const source = [
      'import os, uvicorn', 'from spotbot.config import Settings', 'from spotbot.opennext import create_opennext_app',
      's=Settings(_env_file=None, spotbot_opennext_legacy_data_dir=os.environ["TEST_DATA"], spotbot_opennext_console_key=os.environ["TEST_KEY"], spotbot_database_path=os.environ["TEST_DB"])',
      'app=create_opennext_app(s, origin=os.environ["TEST_ORIGIN"])',
      'uvicorn.run(app, host="127.0.0.1", port=int(os.environ["TEST_PORT"]), log_level="error")',
    ].join('\n');
    adapter = spawn(python, ['-c', source], { cwd: botRoot, env: { PATH: process.env.PATH, PYTHONPATH: botRoot,
      ADMIN_HOST: hosts.ADMIN_HOST, OPENNEXT_ADMIN_TOKEN: token,
      TEST_DATA: dir, TEST_KEY: consoleKey, TEST_DB: path.join(dir, 'adapter.sqlite3'), TEST_ORIGIN: `http://127.0.0.1:${legacyPort}`, TEST_PORT: String(adapterPort) }, stdio: ['ignore', 'ignore', 'pipe'] });
    let failure = '';
    adapter.stderr.on('data', (chunk) => { failure += chunk.toString(); });
    for (let i = 0; i < 100; i++) {
      if (adapter.exitCode !== null) throw new Error('Acceptance adapter failed to start: ' + failure);
      try { await request(adapterPort, '/api/admin/pricing/session'); return; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Acceptance adapter startup timed out');
  }
  async function stopAdapter() {
    if (!adapter) return;
    const child = adapter;
    adapter = null;
    if (child.exitCode !== null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await exited;
  }
  function request(port, url, { method = 'GET', body, terminal = false, authenticated = true } = {}) {
    return new Promise((resolve, reject) => {
      const host = terminal ? hosts.TERMINAL_HOST : hosts.ADMIN_HOST;
      const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: {
        Host: host, Origin: 'https://' + host, 'X-Forwarded-For': '203.0.113.8', 'X-Forwarded-Proto': 'https',
        ...(authenticated && cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}),
      } }, (res) => {
        let text = '';
        res.setEncoding('utf8'); res.on('data', (part) => { text += part; });
        res.on('end', () => { try { resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(text) }); } catch (error) { reject(error); } });
      });
      req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  t.after(async () => { await stopAdapter(); await stopLegacy(); fs.rmSync(dir, { recursive: true, force: true }); });
  await startLegacy(); await startAdapter();
  assert.equal((await request(adapterPort, '/api/admin/users', { authenticated: false })).status, 401);
  async function login() {
    const response = await request(adapterPort, '/api/admin/pricing/session', { method: 'POST', body: { token } });
    assert.equal(response.status, 200);
    cookie = response.headers['set-cookie'][0].split(';')[0];
  }
  await login();
  assert.equal((await request(adapterPort, '/api/admin/users')).data.totalUsers, 1);
  const saved = await request(adapterPort, '/api/admin/pricing/providers/lambda/credential', { method: 'POST', body: { credential: providerKey } });
  assert.equal(saved.status, 200); assert.equal(saved.data.storage, 'encrypted_database');
  async function collect() {
    const response = await request(adapterPort, '/api/admin/pricing/providers/lambda/run', { method: 'POST', body: {} });
    assert.equal(response.status, 202);
    for (let i = 0; i < 80; i++) {
      const result = await request(adapterPort, '/api/admin/pricing/runs/' + response.data.id);
      if (result.data.status !== 'running') { assert.equal(result.data.status, 'completed'); return; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Fixture collection timed out');
  }
  await collect();
  const catalog = await request(adapterPort, '/api/pricing/prices?provider=lambda', { terminal: true, authenticated: false });
  assert.equal(catalog.status, 200); assert.equal(catalog.data.records[0].perGpuHourly, 2);
  await stopAdapter(); await stopLegacy(); await startLegacy(); await startAdapter();
  // Restoration happens during the adapter's first maintenance cycle, without a browser.
  await login();
  for (let i = 0; i < 100; i++) {
    const result = await request(legacyPort, '/api/admin/pricing/providers');
    if (result.data.providers.find((p) => p.id === 'lambda').credentialConfigured) break;
    if (i === 99) throw new Error('Persisted credentials were not restored after restart');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await collect();
  assert.ok(providerCalls >= 2);
  assert.equal((await request(adapterPort, '/api/pricing/prices?provider=lambda', { terminal: true, authenticated: false })).data.records[0].perGpuHourly, 2);
  const audit = await request(adapterPort, '/api/admin/operations/activity');
  assert.ok(audit.data.events.some((event) => event.action === 'Price source credential'));
  assert.ok(!JSON.stringify(audit.data).includes(providerKey));
});
