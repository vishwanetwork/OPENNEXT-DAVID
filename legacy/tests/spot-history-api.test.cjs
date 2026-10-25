'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createPricingRouter } = require('../OpenNEXT-pricing-api.cjs');
const { createSpotHistoryStore } = require('../OpenNEXT-spot-history.cjs');

async function setup(t, importedHistory) {
  const liveCalls = [];
  const service = { getPrices(filters) { liveCalls.push(filters); return { records: [], filters }; } };
  const route = createPricingRouter(service, { importedHistory });
  const server = http.createServer(async (req, res) => {
    if (!await route(req, res, new URL(req.url, 'http://localhost'))) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const request = (endpoint, options = {}) => fetch('http://127.0.0.1:' + server.address().port + endpoint, options);
  return { request, liveCalls };
}

test('imported-history and catalog endpoints are public GET only, isolated from live pricing', async t => {
  const calls = [];
  const importedHistory = {
    query(filters) { calls.push(['query', filters]); return { series: [{ id: 'uploaded' }], filters, meta: { sourceKind: 'uploaded_daily_history' } }; },
    catalog(filters) { calls.push(['catalog', filters]); return { regions: [{ code: 'eu-west-1', name: 'Europe (Ireland)' }], filters }; },
  };
  const { request, liveCalls } = await setup(t, importedHistory);
  let response = await request('/api/pricing/imported-history?gpuModel=H100&region=us-east-1&gpuCount=8&gpuMemoryGb=80&formFactor=unknown&instanceType=p5.48xlarge&period=3D&unit=instance&limit=3', { headers: { Host: 'public.example' } });
  assert.equal(response.status, 200);
  const history = await response.json();
  assert.equal(history.filters.gpuCount, '8');
  assert.equal(history.filters.unit, 'instance');
  assert.equal(history.filters.period, '3D');
  assert.equal('limit' in history.filters, false);
  assert.equal(liveCalls.length, 0);
  response = await request('/api/pricing/history-catalog?q=Dublin');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).filters.q, 'Dublin');
  assert.equal(calls[1][0], 'catalog');
  for (const endpoint of ['/api/pricing/imported-history', '/api/pricing/history-catalog']) {
    for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await request(endpoint, { method })).status, 405);
  }
  response = await request('/api/pricing/prices?gpuModel=H100');
  assert.equal(response.status, 200);
  assert.equal(liveCalls.length, 1);
  assert.equal(calls.length, 2);
});

test('history API reports unavailable snapshots and invalid filters without exposing source paths', async t => {
  const importedHistory = createSpotHistoryStore({ readFile: async () => { throw Error('C:/private/original-workbook.xlsx'); } });
  const { request } = await setup(t, importedHistory);
  const response = await request('/api/pricing/imported-history');
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private|original-workbook/);
  const tooLong = await request('/api/pricing/history-catalog?q=' + 'x'.repeat(181));
  assert.equal(tooLong.status, 400);
});
