'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createAppServer} = require('../OpenNEXT-preview-server.cjs');
const {listPacketDemands} = require('../OpenNEXT-packet-demand.cjs');

async function setup(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'on-external-production-'));
  const server = createAppServer({
    dataDir, secureCookies: false,
    env: {OPENNEXT_DEMO_ENABLED: '1', OPENNEXT_TRUST_PROXY: '0'},
    newsService: {async start() {}, async close() {}},
    pricingService: {async close() {}}, capacityService: {async close() {}},
    authAdapter: {
      emailEnabled: true,
      requestEmailCode: async ({email}) => ({challengeId: 'test-' + email}),
      verifyEmailCode: async ({email, code}) => code === '654321' ? {subject: 'test-' + email, email, emailVerified: true, name: 'Integration Test'} : null,
    },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await server.auth.close();
    await fs.rm(dataDir, {recursive: true, force: true});
  });
  function client() {
    let cookie = '';
    return async (route, body, method = body === undefined ? 'GET' : 'POST', extra = {}) => {
      const response = await fetch(base + route, {method, signal: AbortSignal.timeout(15000), headers: {Origin: base, ...(cookie ? {Cookie: cookie} : {}), ...(body === undefined ? {} : {'Content-Type': 'application/json'}), ...extra}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return {status: response.status, body: await response.json()};
    };
  }
  async function login(role) {
    const request = client(), email = role + '@example.test';
    const challenge = await request('/api/auth/email/request', {email});
    assert.equal(challenge.status, 200);
    const verified = await request('/api/auth/email/verify', {challengeId: challenge.body.challengeId, code: '654321'});
    assert.equal(verified.status, 200);
    const csrf = {'X-CSRF-Token': verified.body.user.csrfToken};
    const onboard = await request('/api/auth/onboarding', {role}, 'POST', csrf);
    assert.equal(onboard.status, 200);
    return {request, csrf};
  }
  return {server, base, request: client(), login};
}

test('approved Packet batch enters formal public RFQs and Console, not own records, homepage or Demo', async t => {
  const {request, login, base} = await setup(t);
  const market = await request('/api/marketplace/public');
  assert.equal(market.status, 200);
  assert.equal(market.body.rfqs.length, 14);
  assert.equal(market.body.supplies.length, 0);
  assert.equal(market.body.featured.rfqs.length, 0);
  for (const row of market.body.rfqs) {
    assert.equal(row.external, true);
    assert.equal(row.executable, false);
    assert.equal(row.responseMode, 'operations');
    assert.equal(row.provider, 'Sourced requirement');
    assert.equal(row.ownerEmail, undefined);
    assert.equal(row.provenance, undefined);
  }
  const admin = await request('/api/admin/marketplace');
  assert.equal(admin.status, 200);
  assert.equal(admin.body.rfqs.length, 14);
  assert.ok(admin.body.rfqs.every(row => row.provenance.sourceName === 'Packet.ai' && row.provenance.sourceUrl === 'https://packet.ai/demand' && row.reviewStatus === 'Approved'));
  const {request: seller, csrf} = await login('seller');
  const own = await seller('/api/marketplace/me');
  for (const key of ['rfqs', 'listings', 'orders', 'instances']) assert.equal(own.body[key].length, 0, key);
  const matched = await seller('/api/marketplace/matches?model=H200&region=Singapore&term=Spot&count=8');
  assert.equal(matched.status, 200);
  assert.ok(matched.body.rows.length > 0);
  assert.ok(matched.body.rows.every(row => row.model === 'H200' && row.bestMatch === false));
  const alternative = matched.body.rows.find(row => row.modelOptions.includes('B200'));
  assert.equal(alternative.price, 1.7);
  const quote = await seller('/api/marketplace/rfqs/' + market.body.rfqs[0].id + '/quotes', {}, 'POST', csrf);
  assert.equal(quote.status, 404);
  const demo = await request('/api/demo/start', {role: 'buyer'});
  assert.equal(demo.status, 200);
  const demoMarket = await request('/api/demo/marketplace/public');
  assert.equal(demoMarket.status, 200);
  assert.ok(demoMarket.body.rfqs.every(row => !row.external && !row.id.startsWith('EXT-')));
  for (const route of ['/OpenNEXT-packet-demand.cjs', '/OpenNEXT-external-marketplace.cjs', '/.opennext-data/external-marketplace.json']) {
    assert.equal((await fetch(base + route)).status, 404, route);
  }
});

test('future external Supply is reviewed and traced; RFQ replay cannot republish a withdrawal', async t => {
  const {request} = await setup(t);
  const original = (await request('/api/admin/marketplace')).body.rfqs[0];
  const withdrawn = await request('/api/admin/marketplace/external/' + original.id, {status: 'Withdrawn', expectedRevision: original.reviewRevision, reason: 'Source confirmation required.'}, 'PATCH');
  assert.equal(withdrawn.status, 200);
  const replay = {sourceId: 'packet-ai', sourceName: 'Packet.ai', batchId: 'recheck', records: [listPacketDemands()[0]]};
  assert.equal((await request('/api/admin/marketplace/external/import', replay)).status, 200);
  assert.ok(!(await request('/api/marketplace/public')).body.rfqs.some(row => row.id === original.id));
  const input = {sourceId: 'future-source', sourceName: 'Future source', batchId: 'supply-1', approvalReason: 'Client cannot approve', records: [{...listPacketDemands()[0], side: 'supply', externalId: 'supply-1', title: 'H200 supplier listing', sourceUrl: 'https://example.com/supply', status: 'Approved', reviewStatus: 'Approved', ownerEmail: 'forged@example.test'}]};
  const imported = await request('/api/admin/marketplace/external/import', input);
  assert.equal(imported.status, 200);
  const admin = (await request('/api/admin/marketplace')).body;
  const supply = admin.supplies.find(row => row.provenance.sourceId === 'future-source');
  assert.equal(supply.reviewStatus, 'Reviewing');
  assert.equal(supply.ownerEmail, undefined);
  assert.equal((await request('/api/marketplace/public')).body.supplies.length, 0);
  assert.equal((await request('/api/admin/marketplace/external/' + supply.id, {status: 'Approved', expectedRevision: supply.reviewRevision}, 'PATCH')).status, 200);
  const publicSupply = (await request('/api/marketplace/public')).body.supplies;
  assert.equal(publicSupply.length, 1);
  assert.equal(publicSupply[0].executable, false);
  assert.equal(publicSupply[0].responseMode, 'operations');
  assert.equal(publicSupply[0].price, 1.8);
  assert.equal((await request('/api/admin/marketplace/external/import', input, 'POST', {'X-Forwarded-For': '203.0.113.2'})).status, 401);
});
