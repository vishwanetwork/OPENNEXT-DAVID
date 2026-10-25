'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createDemoService} = require('../OpenNEXT-demo-service.cjs');
const {createAuthService} = require('../OpenNEXT-auth-service.cjs');
const {createDemoData, MODELS} = require('../OpenNEXT-demo-fixtures.cjs');

async function harness(t, options = {}) {
  const service = createDemoService({secureCookies: false, ...options});
  const server = http.createServer(async (req, res) => {
    if (!await service.handle(req, res, new URL(req.url, 'http://localhost'))) {res.writeHead(404); res.end('{}');}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {await new Promise(resolve => server.close(resolve)); await service.close();});
  async function request(endpoint, {method = 'GET', data, cookie, csrf, origin: requestOrigin = origin, headers = {}} = {}) {
    const response = await fetch(origin + endpoint, {method, headers: {Origin: requestOrigin, ...(data === undefined ? {} : {'Content-Type': 'application/json'}), ...(cookie ? {Cookie: cookie} : {}), ...(csrf ? {'X-CSRF-Token': csrf} : {}), ...headers}, body: data === undefined ? undefined : JSON.stringify(data)});
    return {status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie'), headers: response.headers};
  }
  async function start(selectedRole = 'buyer') {
    const response = await request('/api/demo/start', {method: 'POST', data: {role: selectedRole}});
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return {cookie: response.cookie.split(';')[0], csrf: response.data.user.csrfToken, user: response.data.user, rawCookie: response.cookie};
  }
  return {request, start, origin, service};
}
const rfq = (now = Date.now(), title = 'Private test workload') => ({kind: 'gpu_rental', model: 'H100', region: 'United States', term: 'Spot', count: 8, hours: 48,
  title, project: 'Demo validation', notes: 'Test requirement in this private guest workspace.', budget: 3,
  start: new Date(now + 72 * 3600000).toISOString(), quoteDeadline: new Date(now + 24 * 3600000).toISOString(), visibility: 'Public requirements'});

test('public showcase exposes only approved ranked fixture listings without creating a session', async t => {
  const clock = Date.parse('2026-10-18T00:00:00Z');
  const {request, start} = await harness(t, {now: () => clock, maxSessions: 1, maxStartsPerWindow: 1});
  const [first, concurrent] = await Promise.all([request('/api/demo/showcase'), request('/api/demo/showcase')]);
  assert.equal(first.status, 200);
  assert.equal(first.cookie, null);
  assert.equal(first.data.demo, true);
  assert.deepEqual(first.data, concurrent.data);
  assert.equal(first.data.rfqs.length, 117);
  assert.equal(first.data.supplies.length, 117);
  assert.equal(first.data.featured.rfqs.length, 12);
  assert.equal(first.data.featured.supplies.length, 12);
  assert.equal((await request('/api/demo/auth/session')).data.user, null);
  const fixtures = createDemoData(clock);
  for (const row of first.data.featured.rfqs) {
    assert.notEqual(row.model, 'B300');
    const candidates = fixtures.rfqs.filter(candidate => candidate.model === row.model);
    assert.equal(row.price, Math.max(...candidates.map(candidate => candidate.budget)));
  }
  for (const row of first.data.featured.supplies) {
    assert.notEqual(row.model, 'B300');
    const winner = fixtures.supplies.filter(candidate => candidate.model === row.model).sort((a, b) => a.netPrice - b.netPrice)[0];
    assert.equal(row.id, winner.id);
    assert.equal(row.price, winner.buyerPrice);
  }
  assert.doesNotMatch(JSON.stringify(first.data), /ownerEmail|ownerId|netPrice|registration|csrfToken|sshHost/);
  const guest = await start();
  const market = await request('/api/demo/marketplace/public', guest);
  assert.deepEqual(first.data.featured.supplies.map(row => row.id), market.data.featured.supplies.map(row => row.id));
  assert.deepEqual(first.data.featured.rfqs.map(row => row.id), market.data.featured.rfqs.map(row => row.id));
  assert.equal((await request('/api/demo/showcase', {...guest, method: 'POST', data: {}})).status, 405);
});

test('public showcase caches a bounded snapshot and stays isolated from guest mutations', async t => {
  let clock = Date.parse('2026-10-18T00:00:00Z');
  const {request, start} = await harness(t, {now: () => clock});
  const initial = (await request('/api/demo/showcase')).data;
  const guest = await start();
  const created = await request('/api/demo/marketplace/rfqs', {...guest, method: 'POST', data: rfq(clock, 'Guest-only request')});
  assert.equal(created.status, 201);
  clock += 60000;
  const cached = (await request('/api/demo/showcase', guest)).data;
  assert.deepEqual(cached, initial);
  assert.ok(!cached.rfqs.some(row => row.id === created.data.rfq.id));
  clock += 300001;
  const refreshed = (await request('/api/demo/showcase')).data;
  assert.notEqual(refreshed.updatedAt, initial.updatedAt);
  assert.deepEqual(refreshed.featured.supplies.map(row => row.id), initial.featured.supplies.map(row => row.id));
  assert.equal(refreshed.rfqs.length, 117);
  assert.ok(!refreshed.rfqs.some(row => row.id === created.data.rfq.id));
});

test('public demo creates separate opaque sessions without production authentication', async t => {
  const {request, start} = await harness(t);
  const guest = await start();
  assert.match(guest.rawCookie, /^opennext_demo_session=[A-Za-z0-9_-]{64}; Path=\/api\/demo; HttpOnly; SameSite=Lax;/);
  assert.equal(guest.user.demo, true);
  assert.equal(guest.user.role, 'buyer');
  assert.equal(guest.user.promotionalCredit, 100);
  assert.equal(guest.user.promotionalCreditWithdrawable, false);
  const productionOnly = await request('/api/demo/auth/session', {cookie: 'opennext_session=' + guest.cookie.split('=')[1]});
  assert.equal(productionOnly.data.user, null);
  assert.equal((await request('/api/demo/marketplace/public', {cookie: 'opennext_session=fake'})).status, 401);
  assert.equal((await request('/api/demo/auth/session', guest)).data.user.id, guest.user.id);
  assert.equal((await request('/api/auth/session', guest)).status, 404);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opennext-demo-auth-test-'));
  const realAuth = createAuthService({dataDir: directory, secureCookies: false});
  t.after(async () => {await realAuth.close(); assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); await fs.rm(directory, {recursive: true, force: true});});
  assert.equal(await realAuth.authenticate({headers: {cookie: guest.cookie}}), null);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('demo records and guest mutations stay within the session workspace', async t => {
  const {request, start} = await harness(t);
  const first = await start(), second = await start();
  assert.notEqual(first.user.id, second.user.id);
  const original = await request('/api/demo/marketplace/public', first);
  assert.equal(original.data.rfqs.length, 117);
  assert.equal(original.data.supplies.length, 117);
  assert.ok(original.data.featured.rfqs.length >= 10);
  const created = await request('/api/demo/marketplace/rfqs', {...first, method: 'POST', data: rfq()});
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal((await request('/api/demo/marketplace/me', first)).data.rfqs.length, 1);
  assert.equal((await request('/api/demo/marketplace/me', second)).data.rfqs.length, 0);
  assert.equal((await request('/api/demo/marketplace/public', second)).data.rfqs.length, 117);
  const otherEdit = await request('/api/demo/marketplace/rfqs/' + created.data.rfq.id, {...second, method: 'PATCH', data: rfq()});
  assert.equal(otherEdit.status, 404);
  const mine = (await request('/api/demo/marketplace/me', first)).data;
  assert.deepEqual(mine.orders, []);
  assert.deepEqual(mine.instances, []);
  const matches = (await request('/api/demo/marketplace/matches?model=H100', first)).data;
  assert.ok(matches.rows.length >= 5);
  assert.ok(matches.rows.every(row => row.model === 'H100'));
  const settled = (await request('/api/demo/marketplace/settlements?days=3', first)).data;
  assert.ok(settled.rows.length >= MODELS.length * 5);
});

test('demo requires same-origin start and CSRF for every mutation', async t => {
  const {request, start} = await harness(t);
  assert.equal((await request('/api/demo/start', {method: 'POST', data: {}, origin: 'https://attacker.invalid'})).status, 403);
  assert.equal((await request('/api/demo/start', {method: 'POST', data: {}, origin: ''})).status, 403);
  assert.equal((await request('/api/demo/start', {method: 'POST', data: {}, headers: {'sec-fetch-site': 'cross-site'}})).status, 403);
  const guest = await start();
  assert.equal((await request('/api/demo/marketplace/rfqs', {cookie: guest.cookie, method: 'POST', data: rfq()})).status, 403);
  assert.equal((await request('/api/demo/auth/role', {...guest, method: 'POST', origin: 'https://attacker.invalid', data: {role: 'seller'}})).status, 403);
  assert.equal((await request('/api/demo/auth/role', {...guest, method: 'POST', data: {role: 'broker'}})).status, 400);
  const role = await request('/api/demo/auth/role', {...guest, method: 'POST', data: {role: 'seller'}});
  assert.equal(role.data.user.role, 'seller');
  const restarted = await request('/api/demo/start', {...guest, method: 'POST', data: {role: 'buyer'}});
  assert.equal(restarted.data.user.role, 'seller');
  assert.equal(restarted.data.user.id, guest.user.id);
});

test('demo refuses real payments, admin actions, credentials and infrastructure callbacks', async t => {
  const {request, start} = await harness(t);
  const guest = await start('seller');
  for (const endpoint of ['/billing/checkout', '/contact', '/auth/email/request', '/auth/oauth/google/start', '/admin/marketplace', '/internal/marketplace/telemetry', '/marketplace/supplies/SUP-ABC/agent', '/marketplace/instances/ins-1/resell']) {
    const response = await request('/api/demo' + endpoint, {...guest, method: 'POST', data: {}});
    assert.equal(response.status, 403, endpoint);
    assert.match(response.data.error, /not available in Demo/);
  }
  assert.equal((await request('/api/demo/admin/marketplace', guest)).status, 403);
  assert.equal((await request('/api/demo/marketplace/me', guest)).data.review.status, 'Not started');
  const submitted = await request('/api/demo/marketplace/kyb', {...guest, method: 'POST', data: {company: 'Demo company', registration: 'TEST-123', country: 'United States', rights: 'Test ownership evidence.', evidence: 'Test evidence only.', eligibility: true, rightsConfirmed: true}});
  assert.equal(submitted.status, 201);
  assert.equal(submitted.data.review.status, 'Reviewing');
});

test('demo sessions expire, log out and enforce resource bounds', async t => {
  let clock = Date.now();
  const {request, start} = await harness(t, {now: () => clock, sessionTtlMs: 1000, maxSessions: 1, maxMutations: 2});
  const first = await start();
  assert.equal((await request('/api/demo/start', {method: 'POST', data: {}})).status, 503);
  clock += 1001;
  assert.equal((await request('/api/demo/auth/session', first)).data.user, null);
  const second = await start();
  assert.equal((await request('/api/demo/auth/role', {...second, method: 'POST', data: {role: 'seller'}})).status, 200);
  assert.equal((await request('/api/demo/auth/role', {...second, method: 'POST', data: {role: 'buyer'}})).status, 200);
  assert.equal((await request('/api/demo/marketplace/rfqs', {...second, method: 'POST', data: rfq(clock)})).status, 429);
  assert.equal((await request('/api/demo/auth/logout', {...second, method: 'POST', data: {}})).status, 200);
});

test('demo logout invalidates only the guest cookie', async t => {
  const {request, start} = await harness(t);
  const guest = await start();
  const result = await request('/api/demo/auth/logout', {...guest, method: 'POST', data: {}});
  assert.equal(result.status, 200);
  assert.match(result.cookie, /^opennext_demo_session=; Path=\/api\/demo;.*Max-Age=0/);
  assert.doesNotMatch(result.cookie, /(?:^|[;, ])opennext_session=/);
  assert.equal((await request('/api/demo/auth/session', guest)).data.user, null);
});

test('demo cookies are secure in production and proxy origins are opt-in', async t => {
  const secure = await harness(t, {secureCookies: true, publicOrigin: 'https://terminal.example.test'});
  const response = await secure.request('/api/demo/start', {method: 'POST', data: {}, origin: 'https://terminal.example.test'});
  assert.equal(response.status, 200);
  assert.match(response.cookie, /; Secure$/);
  const direct = await harness(t);
  assert.equal((await direct.request('/api/demo/start', {method: 'POST', data: {}, origin: 'http://proxy.example.test', headers: {'X-Forwarded-Host': 'proxy.example.test'}})).status, 403);
  const trusted = await harness(t, {trustProxy: true});
  assert.equal((await trusted.request('/api/demo/start', {method: 'POST', data: {}, origin: 'http://proxy.example.test', headers: {'X-Forwarded-Host': 'proxy.example.test'}})).status, 200);
});

test('demo session creation is rate limited independently of production auth', async t => {
  const {request, start} = await harness(t, {maxStartsPerWindow: 1});
  const guest = await start();
  assert.equal((await request('/api/demo/start', {...guest, method: 'POST', data: {}})).status, 200);
  assert.equal((await request('/api/demo/start', {method: 'POST', data: {}})).status, 429);
});

test('public demo can be disabled without falling through to production routes', async t => {
  const {request} = await harness(t, {enabled: false});
  for (const endpoint of ['/api/demo/start', '/api/demo/config', '/api/demo/showcase', '/api/demo/marketplace/public']) {
    const response = await request(endpoint, endpoint.endsWith('start') ? {method: 'POST', data: {}} : {});
    assert.equal(response.status, 404);
    assert.equal(response.data.demo, true);
  }
});

test('demo fixture generation is pure and keeps financial history off the guest account', () => {
  const fixtures = createDemoData(Date.parse('2026-10-18T00:00:00Z'));
  assert.equal(fixtures.supplies.length, 117);
  assert.equal(fixtures.rfqs.length, 117);
  assert.equal(fixtures.orders.length, 78);
  assert.ok(fixtures.orders.every(row => row.buyerId.startsWith('fixture-') && row.sellerId.startsWith('fixture-')));
  assert.deepEqual(fixtures.instances, []);
});
