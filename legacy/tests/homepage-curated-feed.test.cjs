'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {listCuratedRfqs} = require('../OpenNEXT-curated-rfqs.cjs');

const copy = {rental: 'GPU rental', models: 'Model capacity', physical: 'Physical GPUs'};
const demoSupply = {id: 'SUP-DEMO-TEST', kind: 'rental', model: 'H100', title: 'H100 capacity', price: 2, count: 8, region: 'Singapore'};
const demoRfq = {...demoSupply, id: 'RFQ-DEMO-TEST', title: 'H100 requirement', price: 3};
const demoRegions = ['Singapore', 'United States', 'Germany', 'Japan', 'Canada', 'United Kingdom'];
const demoRfqs = Array.from({length: 12}, (_, index) => ({...demoRfq, id: index ? 'RFQ-DEMO-TEST-' + index : demoRfq.id, region: demoRegions[index % demoRegions.length]}));
const demoSupplies = Array.from({length: 12}, (_, index) => ({...demoSupply, id: index ? 'SUP-DEMO-TEST-' + index : demoSupply.id, region: demoRegions[index % demoRegions.length]}));
const showcase = {demo: true, featured: {rfqs: demoRfqs, supplies: demoSupplies}};
const source = fs.readFileSync(path.join(__dirname, '..', 'OpenNEXT-home-listings.js'), 'utf8');

function panel(html, index) {
  const start = html.indexOf('<div class="public-listing-panel public-listing-panel-' + index + '"');
  const next = html.indexOf('<div class="public-listing-panel public-listing-panel-', start + 1);
  const end = next === -1 ? html.indexOf('<div class="on-listing-under">', start) : next;
  return html.slice(start, end);
}

function setup({real = {rfqs: [], supplies: []}, catalogs = {}, response = {rfqs: listCuratedRfqs()}, ok = true, reject = false} = {}) {
  const requests = [], calls = [], handlers = {};
  let mounted = false;
  const component = {querySelectorAll: () => [], querySelector: selector => selector === '.public-listing-panels' ? {addEventListener() {}} : null, addEventListener: (type, fn) => {handlers[type] = fn;}};
  const context = {
    window: {
      location: {hostname: 'opennextlab.ai'},
      OpenNEXTExchange: {featured: () => real, listPublic: (kind, side) => catalogs[kind + ':' + side] || [], get: () => null},
      OpenNEXTCuratedInquiries: {showDetails: item => calls.push({action: 'details', item}), offer: item => calls.push({action: 'offer', item})},
    },
    document: {getElementById: () => ({}), querySelector: () => mounted ? component : null},
    matchMedia: () => ({matches: false, addEventListener() {}}),
    MutationObserver: class {observe() {}},
    IntersectionObserver: class {observe() {} disconnect() {}},
    ResizeObserver: class {observe() {} disconnect() {}},
    getComputedStyle: () => ({getPropertyValue: () => '5'}),
    setInterval: () => 1, clearInterval() {}, clearTimeout() {},
    fetch: async (url, options) => {
      requests.push({url, options});
      if (url === '/api/demo/showcase') return {ok: true, json: async () => showcase};
      if (reject) throw Error('Unavailable');
      return {ok, json: async () => response};
    },
  };
  vm.runInNewContext(source, context);
  const api = context.window.OpenNEXTListings;
  return {api, requests, calls, real, mount: () => {mounted = true; api.mount(); return handlers;}};
}

test('curated homepage loader fetches once without credentials and retains complete specifications', async () => {
  const {api, requests} = setup();
  const first = await api.loadCuratedRfqs();
  await api.loadCuratedRfqs();
  assert.equal(first.length, 4);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/homepage/rfqs');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.headers.Accept, 'application/json');
  api.selectSide('demand');
  api.render(copy);
  const row = api.get('CURATED-RFQ-H200-SINGAPORE-BARE-METAL');
  assert.equal(row.curated, true);
  assert.deepEqual(row.specifications, listCuratedRfqs()[3].specifications);
});

test('curated cards show exact server and rack quantities without invented prices or GPU unit assumptions', async () => {
  const {api} = setup();
  await api.loadCuratedRfqs();
  api.selectSide('demand');
  const rental = panel(api.render(copy), 0);
  assert.equal((rental.match(/<article /g) || []).length, 4);
  assert.equal((rental.match(/<strong>Price on request<\/strong>/g) || []).length, 4);
  assert.match(rental, /32 servers/);
  assert.match(rental, /32 or 64 servers/);
  assert.match(rental, /8 B300 servers or 1 GB200 \/ GB300 rack/);
  assert.match(rental, /1 server \/ 8 GPUs/);
  assert.match(rental, /Outside the United States/);
  assert.match(rental, /Location to confirm/);
  assert.doesNotMatch(rental, /\$\d|GPU-hour|GPUs \/ node|NVL72|128 GPUs|512 GPUs|Simulation|Simulated|Preview|data-exchange-id/);
  assert.doesNotMatch(rental, /[\u3400-\u9fff]/u);
});

test('curated requirements coexist with region-balanced demo demand until approved rows become available', async () => {
  const real = {rfqs: [], supplies: []};
  const {api} = setup({real});
  await api.loadShowcase();
  await api.loadCuratedRfqs();
  api.selectSide('demand');
  const html = api.render(copy), rental = panel(html, 0);
  const cards = [...rental.matchAll(/<article\b[\s\S]*?<\/article>/g)].map(match => match[0]);
  const ids = cards.map(card => card.match(/data-listing-id="([^"]+)"/)[1]);
  const curatedIds = listCuratedRfqs().map(row => row.id);
  assert.equal(cards.length, 16);
  assert.equal(new Set(ids).size, 16);
  assert.deepEqual(ids.slice(0, 8), curatedIds.flatMap((id, index) => [id, demoRfqs[index].id]));
  for (const row of demoRfqs) assert.ok(ids.includes(row.id));
  for (const region of demoRegions) assert.match(rental, new RegExp(region));
  assert.match(html, /Includes demo listings · Availability, pricing and delivery confirmed by quote/);
  for (const card of cards.filter(card => card.includes('on-listing-curated'))) {
    assert.match(card, /Price on request/);
    assert.doesNotMatch(card, /Demo|Test data|Simulated|Preview|data-exchange-id/);
  }
  assert.equal(api.get('CURATED-RFQ-B300-32-NON-US').region, 'Outside the United States');
  assert.equal(api.get('CURATED-RFQ-H200-SINGAPORE-BARE-METAL').region, 'Singapore');
  real.rfqs.push({...demoRfq, id: 'RFQ-NEWLY-APPROVED'});
  const approvedHtml = api.render(copy), approvedRental = panel(approvedHtml, 0);
  assert.equal((approvedRental.match(/<article /g) || []).length, 5);
  assert.match(approvedRental, /RFQ-NEWLY-APPROVED/);
  assert.doesNotMatch(approvedRental, /RFQ-DEMO-TEST/);
  assert.doesNotMatch(approvedHtml, /Includes demo listings/);
});

test('approved rental requirements supersede demo demand while retaining curated RFQs and avoiding duplicate IDs', async () => {
  const real = {rfqs: [{...demoRfq, id: 'RFQ-APPROVED', title: 'Approved H100 requirement'}, {...demoRfq, id: listCuratedRfqs()[0].id}], supplies: []};
  const {api} = setup({real});
  await api.loadShowcase();
  await api.loadCuratedRfqs();
  api.selectSide('demand');
  const html = api.render(copy), rental = panel(html, 0);
  assert.equal((rental.match(/<article /g) || []).length, 5);
  assert.match(rental, /data-exchange-id="RFQ-APPROVED"/);
  assert.doesNotMatch(rental, /RFQ-DEMO-TEST/);
  assert.equal((rental.match(/data-listing-id="CURATED-RFQ-B300-32-NON-US"/g) || []).length, 1);
  assert.match(html, /Buyer requirements · Pricing, capacity and delivery confirmed in supplier quotes/);
  assert.doesNotMatch(html, /Demo marketplace/);
  assert.equal(real.rfqs.length, 2);
});

test('supplier rental lane and reference model/hardware cards remain available after loading curated RFQs', async () => {
  const {api} = setup();
  await api.loadShowcase();
  await api.loadCuratedRfqs();
  const html = api.render(copy);
  assert.match(panel(html, 0), /SUP-DEMO-TEST/);
  assert.doesNotMatch(panel(html, 0), /CURATED-RFQ-/);
  assert.equal((panel(html, 0).match(/<article /g) || []).length, 12);
  for (const region of demoRegions) assert.match(panel(html, 0), new RegExp(region));
  assert.ok((panel(html, 1).match(/<article /g) || []).length >= 5);
  assert.ok((panel(html, 2).match(/<article /g) || []).length >= 5);
  assert.match(panel(html, 1), /Input \/ 1M tokens/);
  assert.match(panel(html, 2), /Reference purchase price/);
});

test('real model and physical supply listings still supersede dated catalog references', async () => {
  const catalogs = {
    'model:supply': [{id: 'MODEL-APPROVED', kind: 'model', model: 'Model API', title: 'Approved API allocation', region: 'Worldwide', input: 1, output: 2, price: 1}],
    'hardware:supply': [{id: 'HARDWARE-APPROVED', kind: 'hardware', model: 'H200', title: 'Approved H200 hardware', region: 'Singapore', price: 30000, count: 1}],
  };
  const {api} = setup({catalogs});
  await api.loadCuratedRfqs();
  const html = api.render(copy);
  assert.match(panel(html, 1), /data-exchange-id="MODEL-APPROVED"/);
  assert.match(panel(html, 2), /data-exchange-id="HARDWARE-APPROVED"/);
  assert.equal((panel(html, 1).match(/<article /g) || []).length, 1);
  assert.equal((panel(html, 2).match(/<article /g) || []).length, 1);
});

test('details and offer actions receive the exact full curated RFQ rather than an invented market record', async () => {
  const {api, calls, mount} = setup();
  await api.loadCuratedRfqs();
  await api.loadShowcase();
  const handlers = mount();
  const id = listCuratedRfqs()[3].id;
  for (const action of ['details', 'offer']) {
    const attr = 'data-curated-rfq-' + action;
    const button = {dataset: action === 'details' ? {curatedRfqDetails: id} : {curatedRfqOffer: id}, hasAttribute: value => value === attr};
    let prevented = false;
    handlers.click({target: {closest: selector => selector.includes('data-curated-rfq') ? button : null}, preventDefault() {prevented = true;}});
    assert.equal(prevented, true);
    assert.equal(calls.at(-1).action, action);
    assert.equal(calls.at(-1).item.id, id);
    assert.equal(calls.at(-1).item.price, null);
    assert.equal(calls.at(-1).item.specifications.length, 12);
  }
  api.destroy();
});

test('unavailable or malformed curated feeds do not fabricate requirements and unsafe copy is escaped', async () => {
  for (const options of [{ok: false}, {reject: true}, {response: {}}, {response: {rfqs: [{id: 'INVALID', title: 'Invalid record'}]}}]) {
    const {api} = setup(options);
    await api.loadCuratedRfqs();
    api.selectSide('demand');
    assert.equal((panel(api.render(copy), 0).match(/<article /g) || []).length, 0);
  }
  const malicious = {...listCuratedRfqs()[0], title: '<img src=x onerror=alert(1)>', region: '<script>unsafe</script>'};
  const {api} = setup({response: {rfqs: [malicious]}});
  await api.loadCuratedRfqs();
  api.selectSide('demand');
  const rental = panel(api.render(copy), 0);
  assert.match(rental, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(rental, /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.doesNotMatch(rental, /<img|<script>/);
});
