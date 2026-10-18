'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const NOW = Date.parse('2026-10-18T12:00:00Z');
class Clock extends Date {static now() {return NOW;}}
const row = (side, extra = {}) => ({id: side + '-1', side, provider: 'Capacity partner', region: 'Singapore', model: 'H100', price: 2.35, count: 8, hours: 72, term: 'Spot', biddingParties: 2, ...extra});
function fixture({role = 'Buyer', references = false, best, recent} = {}) {
  const supply = [row('supply', {referenceOnly: references})], demand = [row('demand', {referenceOnly: references})];
  const X = {matches: (_S, side) => side === 'supply' ? supply : demand,
    best: () => best || (role === 'Buyer' ? supply : demand), recent: () => recent || [], status: () => ({matchPrompt: role === 'Buyer' ? 'Submit an RFQ for more precise recommendations.' : 'Submit Supply for more precise recommendations.'}), regionMatches: (a, b) => a === b};
  const window = {OpenNEXTExchange: X};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../OpenNEXT-procurement.js'), 'utf8'), {window, Date: Clock});
  const c = {S: {role, model: 'H100', region: 'All regions', count: 8, term: 'Spot'}, esc: value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char])), money: value => '$' + Number(value).toFixed(2)};
  return {P: window.OpenNEXTProcurement, X, c};
}

test('Buyer sees Supply before RFQs and can act only on genuine supplier rows', () => {
  const {P, c} = fixture(), html = P.listingTable(c);
  assert.ok(html.indexOf('<h3>Supply</h3>') < html.indexOf('<h3>RFQs</h3>'));
  assert.match(html, /H100 Supply &amp; Demand/);
  assert.match(html, /Bidding Parties/);
  assert.match(html, /Buy capacity/);
  assert.doesNotMatch(html, /Offer capacity/);
  assert.match(html, /\$2\.35/);
});

test('Seller sees RFQs before Supply and can act only on genuine buyer rows', () => {
  const {P, c} = fixture({role: 'Seller'}), html = P.listingTable(c);
  assert.ok(html.indexOf('<h3>RFQs</h3>') < html.indexOf('<h3>Supply</h3>'));
  assert.match(html, /Offer capacity/);
  assert.doesNotMatch(html, /Buy capacity/);
});

test('restored reference rows remain visible but cannot be directly purchased or quoted', () => {
  for (const role of ['Buyer', 'Seller']) {
    const {P, c} = fixture({role, references: true}), html = P.listingTable(c);
    assert.match(html, /data-id="supply-1"/);
    assert.match(html, /data-id="demand-1"/);
    assert.match(html, /data-act="proc-listing"/);
    assert.doesNotMatch(html, /data-act="proc-opportunity"|Buy capacity|Offer capacity/);
    assert.match(html, /Reference listings · confirmation required/);
    assert.match(html, /not verified inventory or executable quotes/);
    if (role === 'Buyer') assert.match(html, /<td>—<\/td>/);
  }
});

test('Best Matches filters the selected GPU and region and retains a more-precise-submission hint', () => {
  const {P, c} = fixture({references: true, best: [row('supply', {referenceOnly: true}), row('supply', {id: 'wrong-model', model: 'H200'}), row('supply', {id: 'wrong-region', region: 'Tokyo'})]});
  c.S.region = 'Singapore';
  const html = P.matches(c, 'best');
  assert.match(html, /data-match-id="supply-1"/);
  assert.doesNotMatch(html, /data-match-id="wrong-model"|data-match-id="wrong-region"/);
  assert.match(html, /Same-model reference/);
  assert.match(html, /Submit an RFQ for more precise recommendations/);
  assert.doesNotMatch(html, /data-act="proc-opportunity"/);
});

test('Recent Matches names reference activity honestly and excludes unrelated or future records', () => {
  const recent = [row('activity', {referenceOnly: true, activityAt: '2026-10-18T10:00:00Z'}),
    row('activity', {id: 'wrong-model', model: 'H200', referenceOnly: true, activityAt: '2026-10-18T10:00:00Z'}),
    row('activity', {id: 'wrong-region', region: 'Tokyo', referenceOnly: true, activityAt: '2026-10-18T10:00:00Z'}),
    row('activity', {id: 'future', referenceOnly: true, activityAt: '2026-10-19T10:00:00Z'})];
  const {P, c} = fixture({recent}); c.S.region = 'Singapore';
  const html = P.matches(c, 'recent');
  assert.match(html, /<h3>Recent Matches<\/h3>/);
  assert.match(html, /Reference activity/);
  assert.match(html, /data-match-id="activity-1"/);
  assert.doesNotMatch(html, /data-match-id="wrong-model"|data-match-id="wrong-region"|data-match-id="future"/);
  assert.doesNotMatch(html, /Settled |data-act="proc-opportunity"/);
});

test('real settlements retain Recent Settled rather than being mislabeled as reference activity', () => {
  const {P, c} = fixture({recent: [row('settled', {settledAt: '2026-10-18T10:00:00Z'})]});
  const html = P.matches(c, 'recent');
  assert.match(html, /<h3>Recent Settled<\/h3>/);
  assert.match(html, /Settled /);
  assert.doesNotMatch(html, /Reference activity|reference records/);
});
