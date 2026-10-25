'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {CURATED_RFQS, listCuratedRfqs, getCuratedRfq} = require('../OpenNEXT-curated-rfqs.cjs');

test('curated public RFQs retain all four customer requirements without invented prices or identity', () => {
  assert.equal(listCuratedRfqs().length, 4);
  assert.equal(new Set(CURATED_RFQS.map(row => row.id)).size, 4);
  for (const row of CURATED_RFQS) {
    assert.equal(row.kind, 'rental');
    assert.equal(row.side, 'demand');
    assert.equal(row.price, null);
    assert.equal(row.priceLabel, 'Price on request');
    assert.equal(row.sourceKind, 'customer_requirement');
    assert.equal(row.publishedAt, '2026-10-18');
    assert.equal(row.paymentTerms, 'Flexible payment arrangements in accordance with the supplier\'s requirements.');
    assert.ok(row.specifications.every(spec => typeof spec.label === 'string' && typeof spec.value === 'string'));
    for (const key of ['budget', 'expiresAt', 'ownerEmail', 'buyerName', 'approvedBy', 'verified']) {
      assert.equal(Object.hasOwn(row, key), false);
    }
  }
  assert.doesNotMatch(JSON.stringify(CURATED_RFQS), /[\u3400-\u9fff]/u);
});

test('B300 requirements preserve server counts, regional restrictions and distinct term choices', () => {
  const first = getCuratedRfq('CURATED-RFQ-B300-32-NON-US');
  assert.equal(first.region, 'Outside the United States');
  assert.deepEqual(first.quantity.alternatives, [{model: 'B300', count: 32, unit: 'servers'}]);
  assert.deepEqual(first.termMonths, [6, 12]);
  assert.match(first.deliveryLabel, /before early December 2026/);
  const second = getCuratedRfq('CURATED-RFQ-B300-32-64-CLUSTER');
  assert.equal(second.region, 'Worldwide');
  assert.deepEqual(second.quantity.alternatives.map(item => item.count), [32, 64]);
  assert.deepEqual(second.termMonths, [12, 24, 36]);
  assert.equal(second.deliveryLabel, 'Deployment in Q1 2027');
  assert.ok(second.specifications.some(item => item.label === 'Cluster' && /one unified cluster/.test(item.value)));
});

test('alternative cluster does not assume rack GPU count or a preferred region', () => {
  const row = getCuratedRfq('CURATED-RFQ-B300-GB200-GB300-CLUSTER');
  assert.deepEqual(row.modelOptions, ['B300', 'GB200', 'GB300']);
  assert.equal(row.region, 'Location to confirm');
  assert.deepEqual(row.quantity.alternatives, [
    {model: 'B300', count: 8, unit: 'servers'},
    {model: 'GB200', count: 1, unit: 'rack'},
    {model: 'GB300', count: 1, unit: 'rack'},
  ]);
  assert.deepEqual(row.termMonths, {minimum: 6, maximum: 12});
  assert.doesNotMatch(JSON.stringify(row), /NVL72|gpusPerServer|totalGpuCount/);
});

test('Singapore H200 requirement retains technical delivery and storage conditions', () => {
  const row = getCuratedRfq('CURATED-RFQ-H200-SINGAPORE-BARE-METAL');
  const specs = Object.fromEntries(row.specifications.map(item => [item.label, item.value]));
  assert.equal(row.region, 'Singapore');
  assert.deepEqual(row.quantity.alternatives, [{model: 'H200', count: 1, unit: 'server', gpusPerServer: 8}]);
  assert.equal(row.termMonths, null);
  assert.match(specs['GPU interconnect'], /NVSwitch.*all 8 GPUs/);
  assert.match(specs['Deployment type'], /exclusive CPU, memory and storage/);
  assert.equal(specs.Access, 'Full Linux root access');
  assert.equal(specs.Service, 'Non-preemptible');
  assert.match(specs['System memory'], /2 TB ECC RAM/);
  assert.match(specs['Local storage'], /30 TB usable NVMe preferred; at least 15 TB usable storage/);
  assert.match(specs.Deployment, /15 November 2026/);
});

test('curated RFQ records and nested specification data cannot be mutated by consumers', () => {
  assert.equal(getCuratedRfq('unknown'), null);
  assert.equal(listCuratedRfqs(), CURATED_RFQS);
  assert.throws(() => CURATED_RFQS.push({}), TypeError);
  assert.throws(() => { CURATED_RFQS[0].price = 12; }, TypeError);
  assert.throws(() => { CURATED_RFQS[0].specifications[0].value = 'United States'; }, TypeError);
  assert.throws(() => { CURATED_RFQS[2].quantity.alternatives[0].count = 64; }, TypeError);
});
