'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {listPacketDemands, PACKET_APPROVED_BATCH} = require('../OpenNEXT-packet-demand.cjs');

test('approved Packet snapshot has exactly 14 distinct, source-traceable RFQs', () => {
  const rows = listPacketDemands();
  assert.equal(rows.length, 14);
  assert.equal(new Set(rows.map(row => row.externalId)).size, 14);
  assert.equal(PACKET_APPROVED_BATCH.expectedCount, 14);
  assert.equal(rows.reduce((total, row) => total + row.quantity.totalGpusMin, 0), 5472);
  for (const row of rows) {
    assert.equal(row.sourceUrl, 'https://packet.ai/demand');
    assert.equal(row.externalIdKind, 'adapter-key');
    assert.equal(row.priceUnit, 'GPU-hour');
    assert.equal(row.currency, 'USD');
    assert.equal(row.quantity.gpusPerNode, 8);
    assert.equal(row.quantity.sourceMinimum, true);
    assert.ok(Object.isFrozen(row));
    assert.equal(row.startAt, undefined);
    assert.equal(row.quoteDeadline, undefined);
    assert.equal(row.hours, undefined);
    assert.equal(row.ownerId, undefined);
    assert.equal(row.email, undefined);
    assert.ok(!/[\u3400-\u9fff]/.test(JSON.stringify(row)));
  }
});

test('Packet model alternatives, node ranges and source term uncertainty are preserved', () => {
  const rows = listPacketDemands();
  const alternative = rows.find(row => row.externalId === 'b200-h200-100-worldwide');
  assert.deepEqual(alternative.modelOptions, ['B200', 'H200']);
  assert.deepEqual(alternative.modelBudgets, {B200: 3, H200: 1.7});
  const range = rows.find(row => row.externalId === 'b200-64-128-us-uk');
  assert.deepEqual(range.quantity, {minNodes: 64, maxNodes: 128, gpusPerNode: 8, totalGpusMin: 512, sourceMinimum: true});
  assert.deepEqual(range.rentalMonths.options, [12, 24]);
  assert.equal(rows.find(row => row.externalId === 'h200-4-eu').regionScope.unionOnly, true);
  assert.match(rows.find(row => row.externalId === 'h200-128-worldwide').rentalMonths.notes, /Confirm the term/);
  assert.equal(rows.find(row => row.externalId === 'b200-1-2-us').rentalMonths.max, undefined);
});
