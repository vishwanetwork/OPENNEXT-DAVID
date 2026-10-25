'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createAppServer} = require('../OpenNEXT-preview-server.cjs');
const {listCuratedRfqs} = require('../OpenNEXT-curated-rfqs.cjs');

async function harness(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opennext-curated-api-'));
  const server = createAppServer({dataDir, externalService:false, env: {}, secureCookies: false});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return {dataDir, base: 'http://127.0.0.1:' + server.address().port};
}

function filesSnapshot(directory, prefix = '') {
  const result = {};
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(result, filesSnapshot(path.join(directory, entry.name), relative + '/'));
    else result[relative] = fs.readFileSync(path.join(directory, entry.name), 'base64');
  }
  return result;
}

test('homepage RFQ endpoint serves all four full English customer requirements without creating a session', async t => {
  const {base} = await harness(t);
  const response = await fetch(base + '/api/homepage/rfqs');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.headers.get('set-cookie'), null);
  const payload = await response.json();
  assert.deepEqual(payload.rfqs, listCuratedRfqs());
  assert.equal(payload.rfqs.length, 4);
  assert.doesNotMatch(JSON.stringify(payload), /[\u3400-\u9fff]/u);
  const h200 = payload.rfqs.find(row => row.model === 'H200');
  assert.equal(h200.region, 'Singapore');
  assert.ok(h200.specifications.some(spec => /NVSwitch/.test(spec.value)));
  assert.ok(payload.rfqs.every(row => row.price === null && row.specifications.length >= 6));
});

test('homepage RFQ endpoint supports an empty HEAD and rejects writes', async t => {
  const {base} = await harness(t);
  const head = await fetch(base + '/api/homepage/rfqs', {method: 'HEAD'});
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('set-cookie'), null);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await fetch(base + '/api/homepage/rfqs', {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({price: 1})});
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
  }
});

test('curated source and tests remain private HTTP assets', async t => {
  const {base} = await harness(t);
  for (const route of ['/OpenNEXT-curated-rfqs.cjs', '/tests/curated-rfqs.test.cjs', '/tests/homepage-curated-api.test.cjs']) {
    assert.equal((await fetch(base + route)).status, 404, route);
  }
});

test('reading curated requirements never seeds the production market, grants auth or changes private stores', async t => {
  const {base, dataDir} = await harness(t);
  const beforeMarket = await (await fetch(base + '/api/marketplace/public')).json();
  const beforeAuth = await (await fetch(base + '/api/auth/session')).json();
  assert.equal(beforeAuth.user, null);
  const beforeFiles = filesSnapshot(dataDir);
  for (let index = 0; index < 3; index++) {
    const response = await fetch(base + '/api/homepage/rfqs');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal((await response.json()).rfqs.length, 4);
  }
  assert.deepEqual(filesSnapshot(dataDir), beforeFiles);
  const afterAuth = await (await fetch(base + '/api/auth/session')).json();
  assert.deepEqual(afterAuth, beforeAuth);
  const afterMarket = await (await fetch(base + '/api/marketplace/public')).json();
  for (const key of ['rfqs', 'supplies', 'featured']) assert.deepEqual(afterMarket[key], beforeMarket[key]);
  assert.equal(afterMarket.rfqs.length, 0);
  assert.equal(afterMarket.supplies.length, 0);
});
