'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const requirement = (extra = {}) => ({id: 'RFQ-REVIEW-1', kind: 'gpu_rental', title: 'Singapore training run', project: 'Training', model: 'H100', region: 'Singapore', count: 8, hours: 72, budget: 2.5, term: 'Spot',
  notes: 'Dedicated GPU capacity for training.', status: 'Reviewing', reviewStatus: 'Reviewing', visibility: 'Public requirements', start: '2026-10-20T12:00:00Z', quoteDeadline: '2026-10-19T12:00:00Z', quotes: [], audit: [], ...extra});
function fixture(rows = [], extra = {}) {
  const window = {OpenNEXTAuth: {getUser: () => ({id: 'buyer-1', role: 'buyer'})}, OpenNEXTCountries: {options: () => '<option>Singapore</option>'}};
  const sandbox = {window};
  for (const file of ['OpenNEXT-exchange.js', 'OpenNEXT-procurement.js']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), sandbox, {filename: file});
  const X = window.OpenNEXTExchange, P = window.OpenNEXTProcurement;
  const S = X.init({auth: true, role: 'Buyer', identity: {name: 'Verified user', email: 'buyer@example.test', company: ''}, rfqs: rows, listings: [], orders: [], notifications: [], model: 'H100', region: 'All regions', count: 8, term: 'Spot', ...extra});
  const c = {S, esc: escape, money: value => '$' + Number(value).toFixed(2), persist() {}, render() {}, open(type, options) {S.modal = {type, ...options};}, toast() {}};
  return {P, X, S, c};
}
const detail = (f, id = f.S.rfqs[0].id) => f.P.modal(f.c, 'rfq', {id}).body;
const tableBody = html => html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] || '';

test('Reviewing RFQ row and detail retain an explicit not-public review state', () => {
  const f = fixture([requirement()]), page = tableBody(f.P.page(f.c)), html = detail(f);
  assert.match(page, /<span class="tag">Reviewing<\/span>/);
  assert.match(page, /data-act="view-rfq" data-id="RFQ-REVIEW-1"/);
  assert.match(html, /class="callout proc-reviewing"/);
  assert.match(html, /Operations is reviewing your RFQ/);
  assert.match(html, /not visible in the public market yet/);
  assert.match(html, /receive a notification/);
  assert.match(html, /data-act="proc-edit" data-id="RFQ-REVIEW-1"/);
  assert.doesNotMatch(html, /<span class="tag">Live RFQ<\/span>|data-act="proc-close"|data-act="proc-accept-review"/);
});

test('approved public Open and Quoted RFQs display Live RFQ with the operations review date', () => {
  for (const status of ['Open', 'Quoted']) {
    const f = fixture([requirement({status, reviewStatus: 'Approved', reviewedAt: '2026-10-18T10:00:00Z'})]);
    assert.match(tableBody(f.P.page(f.c)), /<span class="tag">Live RFQ<\/span>/);
    const html = detail(f);
    assert.match(html, /<span class="tag">Live RFQ<\/span>/);
    assert.match(html, /Operations approved this RFQ on 18 Oct 2026, 10:00 UTC/);
    assert.match(html, /available in the market while open/);
    assert.match(html, /data-act="proc-close"/);
    assert.doesNotMatch(html, /not visible in the public market yet/);
  }
});

test('approved private RFQs remain private in both row and detail and never receive Live RFQ badges', () => {
  const f = fixture([requirement({status: 'Open', reviewStatus: 'Approved', visibility: 'Private RFQ'})]);
  const row = tableBody(f.P.page(f.c)), html = detail(f);
  assert.match(row, /Approved · Private RFQ/);
  assert.match(html, /Approved · Private RFQ/);
  assert.match(html, /remains private to the selected supplier/);
  assert.doesNotMatch(row + html, /<span class="tag">Live RFQ<\/span>|available in the market while open/);
});

test('rejected RFQ shows escaped review feedback and a revision entry point without quote actions', () => {
  const f = fixture([requirement({status: 'Rejected', reviewStatus: 'Rejected', reviewReason: 'Confirm <delivery> & country.'})]);
  const html = detail(f);
  assert.match(tableBody(f.P.page(f.c)), /<span class="tag">Rejected<\/span>/);
  assert.match(html, /Not approved · Confirm &lt;delivery&gt; &amp; country\./);
  assert.match(html, /data-act="proc-edit" data-id="RFQ-REVIEW-1"[^>]*>Edit requirement/);
  assert.doesNotMatch(html, /<delivery>|data-act="proc-accept-review"|data-act="proc-close"/);
  assert.equal(f.P.action(f.c, 'proc-edit', {dataset: {id: 'RFQ-REVIEW-1'}}), true);
  assert.equal(f.S.modal.type, 'proc-edit');
  assert.equal(f.S.modal.id, 'RFQ-REVIEW-1');
  assert.match(f.P.modal(f.c, 'proc-edit', {id: 'RFQ-REVIEW-1'}).body, /data-id="RFQ-REVIEW-1"/);
});

test('rejected RFQs without a supplied reason still explain how to revise', () => {
  const f = fixture([requirement({status: 'Rejected', reviewStatus: 'Rejected', reviewReason: ''})]);
  assert.match(detail(f), /Review the requirements and resubmit for operations approval/);
});

test('closed lifecycle states are not relabeled as Live RFQ even after an earlier approval', () => {
  for (const status of ['Confirmed', 'Provisioning', 'Active', 'Completed', 'Cancelled']) {
    const f = fixture([requirement({status, reviewStatus: 'Approved'})]);
    const html = detail(f), row = tableBody(f.P.page(f.c));
    assert.match(row, new RegExp('<span class="tag">' + status + '<\\/span>'));
    assert.doesNotMatch(html + row, /<span class="tag">Live RFQ<\/span>/);
    assert.doesNotMatch(html, /data-act="proc-edit"|data-act="proc-close"/);
  }
});

test('review notifications link the correct RFQ and do not expose another account notification', () => {
  const own = {id: 'notification-1', ownerId: 'buyer-1', subject: 'RFQ approved', message: 'Your requirement is ready.', rfqId: 'RFQ-REVIEW-1', created: '2026-10-18T10:00:00Z'};
  const f = fixture([requirement()], {notifications: [own, {...own, id: 'notification-2', ownerId: 'buyer-2', rfqId: 'RFQ-OTHER', subject: 'Other account'}]});
  const html = f.P.notifications(f.c);
  assert.match(html, /data-act="view-rfq" data-id="RFQ-REVIEW-1"[^>]*>View RFQ<\/button>/);
  assert.doesNotMatch(html, /RFQ-OTHER|Other account/);
  assert.equal(f.P.modal(f.c, 'rfq', {id: 'RFQ-REVIEW-1'}).title, 'Singapore training run');
});

test('Reviewing, Live RFQ, Rejected and Quoted filters select their corresponding owner records', () => {
  const rows = [requirement({id: 'RFQ-REVIEWING'}), requirement({id: 'RFQ-LIVE', status: 'Open', reviewStatus: 'Approved'}),
    requirement({id: 'RFQ-PRIVATE', status: 'Open', reviewStatus: 'Approved', visibility: 'Private RFQ'}),
    requirement({id: 'RFQ-QUOTED', status: 'Quoted', reviewStatus: 'Approved'}), requirement({id: 'RFQ-REJECTED', status: 'Rejected', reviewStatus: 'Rejected'})];
  const f = fixture(rows);
  for (const [filter, expected] of [['Reviewing', ['RFQ-REVIEWING']], ['Live RFQ', ['RFQ-LIVE', 'RFQ-QUOTED']], ['Rejected', ['RFQ-REJECTED']], ['Quoted', ['RFQ-QUOTED']], ['All', rows.map(row => row.id)]]) {
    f.S.rfqFilter = filter;
    const html = f.P.page(f.c), body = tableBody(html);
    assert.match(html, new RegExp('<option selected>' + filter + '<\\/option>'));
    for (const row of rows) assert.equal(body.includes('data-id="' + row.id + '"'), expected.includes(row.id), filter + ': ' + row.id);
  }
  f.S.rfqFilter = 'Completed';
  assert.match(tableBody(f.P.page(f.c)), /No matching requirements/);
});
