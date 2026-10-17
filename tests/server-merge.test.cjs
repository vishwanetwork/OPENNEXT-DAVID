'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const TOKEN = 'merge-regression-test-token-0123456789';

async function setup(t) {
  const modulePath = require.resolve('../OpenNEXT-preview-server.cjs');
  const hosts = {SITE_HOST: 'site.test', TERMINAL_HOST: 'terminal.test', ADMIN_HOST: 'admin.test'};
  const saved = Object.fromEntries(Object.keys(hosts).map(key => [key, process.env[key]]));
  let createAppServer;
  try {
    Object.assign(process.env, hosts);
    delete require.cache[modulePath];
    ({createAppServer} = require(modulePath));
  } finally {
    for (const key of Object.keys(hosts)) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key];
    delete require.cache[modulePath];
  }
  const calls = {pricingClosed: 0, capacityClosed: 0, capacityQueries: [], leads: []};
  const pricing = {getPrices: () => ({records: []}), listProviders: () => [], close: async () => {calls.pricingClosed++;}};
  const capacity = {query: filters => {calls.capacityQueries.push(filters); return {terms: ['Spot', 'On-demand', 'Reserved'], points: [], filters};}, close: async () => {calls.capacityClosed++;}};
  const contacts = {create: async input => {calls.leads.push(input); return {id: 'CONTACT-1234ABCD', status: 'New'};}, list: async () => calls.leads};
  const server = createAppServer({pricingService: pricing, capacityService: capacity, contactService: contacts, env: {OPENNEXT_ADMIN_TOKEN: TOKEN, OPENNEXT_TRUST_PROXY: '1'}});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(calls.pricingClosed, 1);
    assert.equal(calls.capacityClosed, 1);
  });
  const request = (url, {host = 'site.test', method = 'GET', headers = {}, body} = {}) => new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port: server.address().port, path: url, method, headers: {Host: host, ...(body ? {'Content-Type': 'application/json'} : {}), ...headers}}, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', value => text += value);
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text)}));
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  return {request, calls};
}

test('standalone console retains all dependencies and never serves them on public hosts', async t => {
  const {request} = await setup(t);
  const admin = await request('/', {host: 'admin.test'});
  assert.equal(admin.status, 200);
  assert.match(admin.text, /Operations Console/);
  for (const match of admin.text.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const asset = new URL(match[1], 'https://admin.test/').pathname;
    assert.equal((await request(asset, {host: 'admin.test'})).status, 200, asset);
    for (const host of ['site.test', 'terminal.test']) assert.equal((await request(asset, {host})).status, 404, host + asset);
  }
  for (const asset of ['/OpenNEXT-contact.js', '/OpenNEXT-exchange.js', '/OpenNEXT-procurement.js', '/OpenNEXT-billing.js', '/OpenNEXT-capacity-chart.js']) {
    assert.equal((await request(asset, {host: 'terminal.test'})).status, 200, asset);
    assert.equal((await request(asset, {host: 'admin.test'})).status, 404, asset);
  }
});

test('admin routes stay on ADMIN_HOST even when a public request has a valid token', async t => {
  const {request} = await setup(t);
  for (const route of ['/api/admin/pricing/session', '/api/admin/pricing/providers', '/api/admin/contacts']) {
    for (const host of ['site.test', 'terminal.test', 'unknown.test']) {
      assert.equal((await request(route, {host, headers: {Authorization: 'Bearer ' + TOKEN}})).status, 404, host + route);
    }
    assert.equal((await request(route, {host: 'admin.test', headers: {Authorization: 'Bearer ' + TOKEN}})).status, 200, route);
  }
});

test('ticker history, capacity history and contact collection coexist with shared admin sessions', async t => {
  const {request, calls} = await setup(t);
  const ticker = await request('/api/pricing/ticker');
  assert.equal(ticker.status, 200);
  assert(ticker.json().records.length > 0);
  const comparison = await request('/api/pricing/capacity-history?gpuModel=H100&gpuCount=8&period=1M');
  assert.equal(comparison.status, 200);
  assert.deepEqual(comparison.json().terms, ['Spot', 'On-demand', 'Reserved']);
  assert.equal(calls.capacityQueries[0].gpuModel, 'H100');
  const contact = await request('/api/contact', {method: 'POST', headers: {Origin: 'https://site.test'}, body: {name: 'Test Buyer', company: 'Fixture', title: 'Buyer', email: 'buyer@example.test', message: 'GPU capacity'}});
  assert.equal(contact.status, 201);
  assert.equal(calls.leads.length, 1);
  const session = await request('/api/admin/pricing/session', {host: 'admin.test', method: 'POST', headers: {Origin: 'https://admin.test', 'X-Forwarded-Proto': 'https'}, body: {token: TOKEN}});
  assert.equal(session.status, 200);
  const cookie = session.headers['set-cookie'][0];
  assert.match(cookie, /Path=\/api\/admin;/);
  const leads = await request('/api/admin/contacts', {host: 'admin.test', headers: {Cookie: cookie.split(';')[0]}});
  assert.equal(leads.status, 200);
  assert.equal(leads.json().leads[0].email, 'buyer@example.test');
});
