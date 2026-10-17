const test = require('node:test');
const assert = require('node:assert/strict');
const Billing = require('../OpenNEXT-billing.js');

function fixture(overrides = {}) {
  const S = Billing.init({ role: 'Buyer', identity: { name: 'Nova', email: 'nova@vishwalab.com' }, listings: [], ...overrides });
  const events = [];
  const ctx = { S, persist() { events.push('persist'); }, render() { events.push('render'); }, open(type, extra) { S.modal = { type, ...extra }; events.push(type); }, toast(text) { events.push(text); } };
  return { S, ctx, events };
}
function form(kind, data = {}) { return { dataset: { form: kind, ...data } }; }

test('new account starts with zero purchasing credit and zero earnings', () => {
  const { S } = fixture();
  assert.equal(S.balance, 0);
  assert.equal(S.earningsBalance, 0);
  assert.deepEqual(S.ledger, []);
  assert.deepEqual(S.payouts, []);
});

test('only untouched historical seed is migrated, preserving real local user changes', () => {
  const ledger = [{ id: 'CR-1001', amount: 10000 }, { id: 'CH-1002', amount: -48 }];
  const original = fixture({ balance: 9952, ledger: structuredClone(ledger) }).S;
  assert.equal(original.balance, 0);
  assert.equal(original.ledger.length, 0);
  const changed = fixture({ balance: 10052, ledger: [...ledger, { id: 'CR-USER', amount: 100 }] }).S;
  assert.equal(changed.balance, 10052);
  assert.equal(changed.ledger.length, 3);
  assert.equal(fixture({ balance: 9952, ledger: [{ id: 'REAL', amount: 9952 }] }).S.balance, 9952);
  assert.equal(fixture({ balance: 9952, ledger, billingVersion: 1 }).S.balance, 9952);
});

test('top-up creates review checkout and credits only after successful confirmation, once', () => {
  const { S, ctx } = fixture();
  assert.equal(Billing.submit(ctx, form('pay-amount', { orderId: 'ORDER-10086' }), { preset: '500' }), true);
  assert.equal(S.balance, 0);
  assert.equal(S.paymentSessions.length, 1);
  const p = S.paymentSessions[0];
  assert.equal(S.modal.type, 'pay-checkout');
  assert.equal(p.orderId, 'ORDER-10086');
  assert.match(Billing.modal(ctx, 'pay-checkout', { id: p.id }).body, /Test payment · no real charge/);
  assert.equal(Billing.completePayment(S, p.id, 'Paid'), true);
  assert.equal(S.balance, 500);
  assert.equal(S.ledger.length, 1);
  assert.equal(S.ledger[0].test, true);
  assert.equal(Billing.completePayment(S, p.id, 'Paid'), false);
  assert.equal(S.balance, 500);
  assert.equal(S.ledger.length, 1);
});

test('cancelled or failed checkout cannot credit the account or later succeed', () => {
  for (const result of ['Cancelled', 'Failed']) {
    const { S, ctx } = fixture();
    Billing.submit(ctx, form('pay-amount'), { preset: '100' });
    const p = S.paymentSessions[0];
    Billing.completePayment(S, p.id, result);
    assert.equal(S.balance, 0);
    assert.equal(S.ledger.length, 0);
    assert.equal(Billing.completePayment(S, p.id, 'Paid'), false);
  }
});

test('custom top-up rejects invalid values, precision errors and excessive amounts', () => {
  const { S, ctx } = fixture();
  for (const custom of ['', 'abc', '-1', '0', '0.5', '100000.01', '1.001']) Billing.submit(ctx, form('pay-amount'), { preset: 'other', custom });
  assert.equal(S.paymentSessions.length, 0);
  Billing.submit(ctx, form('pay-amount'), { preset: 'other', custom: '152.75' });
  assert.equal(S.paymentSessions[0].amount, 152.75);
});

test('cashout reserves earnings only, validates amount and masks payment destination', () => {
  const { S, ctx } = fixture({ role: 'Seller', balance: 500, earningsBalance: 320 });
  const f = form('cashout-request');
  const data = { amount: '150.25', bank: 'Business bank', beneficiary: 'Nova', last4: '8392' };
  Billing.submit(ctx, f, { ...data, amount: '321' });
  Billing.submit(ctx, f, { ...data, last4: '123456789012' });
  assert.equal(S.payouts.length, 0);
  Billing.submit(ctx, f, data);
  assert.equal(S.balance, 500);
  assert.equal(S.earningsBalance, 169.75);
  assert.equal(S.payouts.length, 1);
  assert.equal(S.payouts[0].destination, 'Business bank · •••• 8392');
  Billing.submit(ctx, f, data);
  assert.equal(S.payouts.length, 1);
  assert.equal(S.earningsBalance, 169.75);
  const id = S.payouts[0].id;
  Billing.action(ctx, 'cashout-settle', { dataset: { id } });
  Billing.action(ctx, 'cashout-settle', { dataset: { id } });
  assert.equal(S.earningsBalance, 169.75);
  assert.equal(S.payouts[0].status, 'Paid');
});

test('cashout cancellation returns reserved funds once and buyer cannot cashout', () => {
  const { S, ctx } = fixture({ role: 'Broker', earningsBalance: 400 });
  Billing.submit(ctx, form('cashout-request'), { amount: '125', bank: 'Bank', beneficiary: 'Nova', last4: '1234' });
  const id = S.payouts[0].id;
  Billing.action(ctx, 'cashout-cancel', { dataset: { id } });
  Billing.action(ctx, 'cashout-cancel', { dataset: { id } });
  assert.equal(S.earningsBalance, 400);
  S.role = 'Buyer';
  Billing.submit(ctx, form('cashout-request'), { amount: '125', bank: 'Bank', beneficiary: 'Nova', last4: '1234' });
  assert.equal(S.payouts.length, 1);
});

test('analytics excludes credit, payout and pending transactions; splits purchase/revenue/commission', () => {
  const now = new Date().toISOString();
  const { S } = fixture({ role: 'Broker', orders: [{ id: 'ORDER-1', term: 'Spot' }], ledger: [
    { type: 'Credit top-up', amount: 1000, createdAt: now, status: 'Paid' },
    { type: 'Capacity purchase', amount: -80, createdAt: now, orderId: 'ORDER-1', status: 'Paid' },
    { type: 'Sale settlement', amount: 120, createdAt: now, status: 'Paid' },
    { type: 'Broker commission', amount: 8, createdAt: now, status: 'Paid' },
    { type: 'Cashout request', amount: -40, createdAt: now, status: 'Paid' },
    { type: 'Sale settlement', amount: 900, createdAt: now, status: 'Pending' }
  ] });
  const { sums } = Billing.analytics(S);
  assert.equal(sums.purchase, 80);
  assert.equal(sums.spot, 80);
  assert.equal(sums.revenue, 120);
  assert.equal(sums.commission, 8);
});

test('sample analysis never changes credit or ledger and is explicitly identified', () => {
  const { S, ctx } = fixture();
  Billing.action(ctx, 'bill-sample', { dataset: {} });
  assert.ok(Billing.analytics(S).sums.purchase > 0);
  assert.equal(S.balance, 0);
  assert.equal(S.ledger.length, 0);
  const page = Billing.page(ctx);
  assert.match(page, /Example analytics/);
  assert.match(page, /Your credit, earnings and account activity below are unchanged/);
  assert.match(page, /Illustrative capacity and utilization metrics/);
  Billing.action(ctx, 'bill-sample', { dataset: {} });
  assert.match(Billing.page(ctx), /Awaiting usage telemetry/);
});

test('role-specific billing, charts and dates have working controls', () => {
  const { S, ctx } = fixture();
  assert.match(Billing.page(ctx), /Billing & usage/);
  assert.doesNotMatch(Billing.page(ctx), /Workspace allocation|View receipt|<th>Reference/);
  S.role = 'Seller'; assert.match(Billing.page(ctx), /Earnings & payouts/);
  assert.match(Billing.page(ctx), /Cash out/);
  S.role = 'Broker'; assert.match(Billing.page(ctx), /Trading margin/);
  assert.match(Billing.page(ctx), /Commission earned/);
  Billing.action(ctx, 'bill-chart', { dataset: { value: 'lines' } });
  assert.equal(S.billingUI.chart, 'lines');
  Billing.submit(ctx, form('bill-filter'), { from: '2026-10-01', to: '2026-10-17' });
  assert.equal(Billing.analytics(S).rows.length, 17);
  Billing.submit(ctx, form('bill-filter'), { from: '2026-10-18', to: '2026-10-01' });
  assert.equal(S.billingUI.from, '2026-10-01');
});

test('order details include parties, financials, delivery, audit and escape external text', () => {
  const { ctx } = fixture({ orders: [{ id: 'ORDER-10086', title: '<img src=x onerror=alert(1)>', model: 'H100', count: 8, region: 'Singapore', term: 'Spot', hours: 24, rate: 2, subtotal: 384, fees: 4, tax: 0, total: 388, buyer: { name: 'Nova', company: 'Vishwa', email: 'nova@vishwalab.com' }, seller: { name: 'Supplier', email: 'seller@example.com' }, status: 'Awaiting payment', paymentStatus: 'Unpaid', createdAt: '2026-10-17T12:00:00Z', quoteValidUntil: '2026-10-18T12:00:00Z', audit: [{ at: '2026-10-17T12:00:00Z', event: 'Quote accepted' }] }] });
  const modal = Billing.modal(ctx, 'bill-order', { id: 'ORDER-10086' });
  assert.equal(modal.wide, true);
  for (const text of ['Buyer', 'Supplier', 'Platform fee', '$388.00', 'Service starts', 'Service ends', 'Quote valid until', 'Payment method', 'Quote accepted']) assert.ok(modal.body.includes(text));
  assert.ok(!modal.body.includes('<img src=x'));
});

test('CSV export escapes quotes and spreadsheet formula injection', () => {
  const csv = Billing.csv([{ order: 'ORDER-1', notes: '=HYPERLINK("bad")', total: -12 }]);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes('""bad""'));
  assert.ok(csv.includes('"-12"'));
});

test('buy and sell order details expose the appropriate next step', () => {
  const { S, ctx } = fixture({ role: 'Broker', orders: [
    { id: 'BUY-1', side: 'buy', role: 'Broker', status: 'Awaiting payment', paymentStatus: 'Unpaid', total: 80 },
    { id: 'SELL-1', side: 'sell', role: 'Broker', status: 'Awaiting buyer payment', paymentStatus: 'Unpaid', total: 120 }
  ] });
  const buy = Billing.modal(ctx, 'bill-order', { id: 'BUY-1' }).body;
  const sell = Billing.modal(ctx, 'bill-order', { id: 'SELL-1' }).body;
  assert.match(buy, /data-act="proc-payment"/);
  assert.match(buy, /Pay order/);
  assert.doesNotMatch(buy, /proc-seller-progress/);
  assert.match(sell, /data-act="proc-seller-progress"/);
  assert.match(sell, /Simulate buyer payment/);
  assert.doesNotMatch(sell, /data-act="pay-start"/);
  S.orders[1].status = 'Active';
  assert.match(Billing.modal(ctx, 'bill-order', { id: 'SELL-1' }).body, /Complete service & settle/);
  S.orders[1].status = 'Completed';
  assert.doesNotMatch(Billing.modal(ctx, 'bill-order', { id: 'SELL-1' }).body, /proc-seller-progress/);
});

test('pending seller settlement excludes unpaid sales, completed sales and broker buy orders', () => {
  const { ctx } = fixture({ role: 'Seller', orders: [
    { id: 'SELL-PAID', side: 'sell', role: 'Broker', status: 'Active', paymentStatus: 'Paid', subtotal: 120, total: 125 },
    { id: 'SELL-UNPAID', side: 'sell', status: 'Awaiting buyer payment', paymentStatus: 'Unpaid', total: 999 },
    { id: 'SELL-DONE', side: 'sell', status: 'Completed', paymentStatus: 'Paid', total: 500 },
    { id: 'BROKER-BUY', side: 'buy', role: 'Broker', status: 'Active', paymentStatus: 'Paid', total: 600 }
  ] });
  assert.match(Billing.page(ctx), /<span>Pending settlement<\/span><strong>\$120\.00<\/strong>/);
});

test('GPU-hour efficiency excludes physical hardware and token allocations', () => {
  const { ctx } = fixture({ orders: [
    { id: 'RENT', side: 'buy', kind: 'gpu_rental', paymentStatus: 'Paid', count: 8, hours: 24, status: 'Active' },
    { id: 'CARD', side: 'buy', kind: 'physical_gpu', paymentStatus: 'Paid', count: 8, hours: 999, status: 'Active' },
    { id: 'MODEL', side: 'buy', kind: 'model_capacity', paymentStatus: 'Paid', count: 8, hours: 999, status: 'Active' },
    { id: 'HARDWARE', side: 'buy', kind: 'hardware', paymentStatus: 'Paid', count: 8, hours: 999, status: 'Active' }
  ] });
  assert.match(Billing.page(ctx), /<small>Reserved GPU-hours<\/small><strong>192<\/strong>/);
});

test('completed purchases use the selected completion-date window', () => {
  const { S, ctx } = fixture({ orders: [
    { id: 'IN', side: 'buy', paymentStatus: 'Paid', status: 'Completed', completedAt: '2026-10-10T12:00:00Z' },
    { id: 'OUT', side: 'buy', paymentStatus: 'Paid', status: 'Completed', completedAt: '2026-09-10T12:00:00Z' },
    { id: 'UNKNOWN', side: 'buy', paymentStatus: 'Paid', status: 'Completed' }
  ] });
  S.billingUI.from = '2026-10-01'; S.billingUI.to = '2026-10-17';
  assert.match(Billing.page(ctx), /<span>Completed purchases<\/span><strong>1<\/strong>/);
});

test('model allocation total is not mislabeled as unit rate, and missing token rates stay absent', () => {
  const { ctx } = fixture({ orders: [
    { id: 'MODEL-TOTAL', kind: 'model_capacity', status: 'Awaiting payment', unitPrice: 150, subtotal: 150, total: 150 },
    { id: 'MODEL-RATES', kind: 'model_capacity', status: 'Awaiting payment', unitPrice: 150, subtotal: 150, total: 150, inputRate: 0.255, outputRate: 1.5, cacheRate: 0.0255 }
  ] });
  const total = Billing.modal(ctx, 'bill-order', { id: 'MODEL-TOTAL' }).body;
  assert.match(total, /Total quoted token allocation/);
  assert.doesNotMatch(total, /agreed unit|\/ 1M tokens/);
  const rates = Billing.modal(ctx, 'bill-order', { id: 'MODEL-RATES' }).body;
  assert.match(rates, /\$0\.255 \/ 1M tokens/);
  assert.match(rates, /\$1\.50 \/ 1M tokens/);
  assert.match(rates, /\$0\.0255 \/ 1M tokens/);
});

test('physical GPU order shows shipment, arrival and receipt instead of cloud rental terms', () => {
  const { ctx } = fixture({ orders: [{ id: 'PHYSICAL-1', kind: 'physical_gpu', count: 8, days: 30, hours: 0, unitPrice: 24500, subtotal: 196000, total: 196000, status: 'Completed', deliveryMinutes: 10080, serviceStart: '2026-10-24T08:00:00Z', deliveredAt: '2026-10-23T08:00:00Z', consignee: 'Nova', shippingAddress: 'Singapore warehouse', condition: 'New', warranty: '12 months', incoterms: 'DAP' }] });
  const body = Billing.modal(ctx, 'bill-order', { id: 'PHYSICAL-1' }).body;
  assert.match(body, /One-time purchase/);
  assert.match(body, /Within 7 days after payment and shipping confirmation/);
  for (const label of ['Required arrival', 'Received', 'Consignee', 'Shipping address', 'Condition', 'Warranty', 'Shipping terms', 'Singapore warehouse', 'DAP']) assert.ok(body.includes(label));
  assert.doesNotMatch(body, /30 days|Service starts|Service ends|10080 minutes|access setup|SSH|CUDA|GPU-hour/);
});
