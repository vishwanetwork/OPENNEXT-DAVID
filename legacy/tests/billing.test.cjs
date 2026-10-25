const test = require('node:test');
const assert = require('node:assert/strict');
const Billing = require('../OpenNEXT-billing.js');

function fixture(overrides = {}) {
  const S = Billing.init({ role: 'Buyer', identity: { name: 'Verified User', email: 'verified@example.com' }, listings: [], ...overrides });
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

test('legacy checkout cannot create funds or fabricate payment success', () => {
  const {S, ctx, events} = fixture();
  assert.equal(Billing.submit(ctx, form('pay-amount'), {preset:'500'}), true);
  assert.equal(S.balance, 0); assert.equal(S.paymentSessions.length, 0); assert.equal(S.ledger.length, 0);
  S.paymentSessions.push({id:'PAY-OLD',amount:500,status:'Pending'});
  assert.equal(Billing.completePayment(S, 'PAY-OLD', 'Paid'), false);
  Billing.action(ctx, 'pay-confirm', {dataset:{id:'PAY-OLD'}});
  assert.equal(S.balance, 0); assert.equal(S.paymentSessions[0].status, 'Pending');
  assert.ok(events.some(message => /payment service/.test(message)));
  const checkout = Billing.modal(ctx, 'pay-checkout', {id:'PAY-OLD'}).body;
  assert.doesNotMatch(checkout, /4242|pay-confirm|Test payment|Payment complete/);
  assert.match(checkout, /not configured/);
});

test('legacy payouts cannot reserve, release or mark funds paid on the client', () => {
  const {S, ctx} = fixture({role:'Seller',balance:100,earningsBalance:320});
  Billing.submit(ctx, form('cashout-request'), {amount:'150',bank:'Business bank',beneficiary:'Verified User',last4:'8392'});
  assert.equal(S.earningsBalance, 320); assert.equal(S.payouts.length, 0);
  S.payouts.push({id:'PAYOUT-OLD',amount:150,status:'Pending'});
  Billing.action(ctx, 'cashout-settle', {dataset:{id:'PAYOUT-OLD'}});
  Billing.action(ctx, 'cashout-cancel', {dataset:{id:'PAYOUT-OLD'}});
  assert.equal(S.payouts[0].status, 'Pending'); assert.equal(S.earningsBalance, 320);
  assert.match(Billing.modal(ctx,'cashout-start').body,/not configured/);
  assert.doesNotMatch(Billing.modal(ctx,'cashout-detail',{id:'PAYOUT-OLD'}).body,/Simulate|cashout-settle|cashout-cancel/);
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
  const { ctx } = fixture({ orders: [{ id: 'ORDER-10086', title: '<img src=x onerror=alert(1)>', model: 'H100', count: 8, region: 'Singapore', term: 'Spot', hours: 24, rate: 2, subtotal: 384, fees: 4, tax: 0, total: 388, buyer: { name: 'Verified User', company: 'Vishwa', email: 'verified@example.com' }, seller: { name: 'Supplier', email: 'seller@example.com' }, status: 'Awaiting payment', paymentStatus: 'Unpaid', createdAt: '2026-10-17T12:00:00Z', quoteValidUntil: '2026-10-18T12:00:00Z', audit: [{ at: '2026-10-17T12:00:00Z', event: 'Quote accepted' }] }] });
  const modal = Billing.modal(ctx, 'bill-order', { id: 'ORDER-10086' });
  assert.equal(modal.wide, true);
  for (const text of ['Buyer', 'Supplier', 'Recorded fee', '$388.00', 'Service starts', 'Service ends', 'Quote valid until', 'Payment method', 'Quote accepted']) assert.ok(modal.body.includes(text));
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
  assert.doesNotMatch(sell, /Simulate buyer payment/);
  assert.match(sell, /Awaiting verified buyer payment/);
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
  const { ctx } = fixture({ orders: [{ id: 'PHYSICAL-1', kind: 'physical_gpu', count: 8, days: 30, hours: 0, unitPrice: 24500, subtotal: 196000, total: 196000, status: 'Completed', deliveryMinutes: 10080, serviceStart: '2026-10-24T08:00:00Z', deliveredAt: '2026-10-23T08:00:00Z', consignee: 'Verified User', shippingAddress: 'Singapore warehouse', condition: 'New', warranty: '12 months', incoterms: 'DAP' }] });
  const body = Billing.modal(ctx, 'bill-order', { id: 'PHYSICAL-1' }).body;
  assert.match(body, /One-time purchase/);
  assert.match(body, /Within 7 days after payment and shipping confirmation/);
  for (const label of ['Required arrival', 'Received', 'Consignee', 'Shipping address', 'Condition', 'Warranty', 'Shipping terms', 'Singapore warehouse', 'DAP']) assert.ok(body.includes(label));
  assert.doesNotMatch(body, /30 days|Service starts|Service ends|10080 minutes|access setup|SSH|CUDA|GPU-hour/);
});

test('seller commission is a negative expense in analytics, activity, details and exports', () => {
  const at = new Date().toISOString();
  const {S,ctx} = fixture({role:'Seller',ledger:[
    {id:'SALE',type:'Sale settlement',amount:200,createdAt:at,status:'Paid'},
    {id:'COMMISSION',type:'Broker commission',amount:12,createdAt:at,status:'Paid'},
  ],orders:[{id:'SELL-ORDER',side:'sell',status:'Completed',total:200,commissionAmount:12}]});
  const sums=Billing.analytics(S).sums;
  assert.equal(sums.revenue,200);assert.equal(sums.commission,-12);
  const page=Billing.page(ctx);
  assert.match(page,/Commission paid/);assert.match(page,/-\$12\.00/);
  assert.doesNotMatch(page,/\+\$12\.00/);
  assert.match(Billing.modal(ctx,'bill-record',{id:'COMMISSION'}).body,/-\$12\.00/);
  assert.match(Billing.modal(ctx,'bill-order',{id:'SELL-ORDER'}).body,/Commission paid<\/small><strong>-\$12\.00/);
  assert.equal(Billing.exportRows(S,'activity').find(row=>row.id==='COMMISSION').amount,-12);
  assert.equal(Billing.exportRows(S,'record','COMMISSION')[0].type,'Commission paid');
  assert.equal(Billing.exportRows(S,'order','SELL-ORDER')[0].commissionAmount,-12);
  assert.equal(Billing.exportRows(S,'daily').find(row=>row.day===at.slice(0,10)).commission,-12);
});

test('seller bars and lines support a negative axis and do not hide net-zero activity', () => {
  const at = new Date().toISOString();
  const {S,ctx}=fixture({role:'Seller',ledger:[
    {id:'SALE',type:'Sale settlement',amount:10,createdAt:at,status:'Paid'},
    {id:'FEE',type:'Broker commission',amount:-10,createdAt:at,status:'Paid'},
  ]});
  const bars=Billing.page(ctx);
  assert.match(bars,/data-bill-zero="true"/);
  assert.match(bars,/-\$10\.00/);
  assert.doesNotMatch(bars,/No posted activity in this period/);
  const negativeBar=[...bars.matchAll(/<rect[^>]*data-bill-series="commission"[^>]*height="([^"]+)"/g)].map(match=>Number(match[1]));
  assert.ok(negativeBar.every(height=>height>=0));
  assert.ok(negativeBar.some(height=>height>0));
  S.billingUI.chart='lines';
  const lines=Billing.page(ctx);
  assert.match(lines,/<polyline data-bill-series="commission"/);
  assert.doesNotMatch(lines,/NaN|Infinity/);
});

test('broker commission remains positive and seller example metrics also use negative commission', () => {
  const at=new Date().toISOString();
  const {S,ctx}=fixture({role:'Broker',ledger:[{id:'BROKER-FEE',type:'Broker commission',amount:12,createdAt:at,status:'Paid'}]});
  assert.equal(Billing.analytics(S).sums.commission,12);
  assert.match(Billing.page(ctx),/Commission earned/);
  assert.equal(Billing.exportRows(S,'activity')[0].amount,12);
  S.role='Seller';S.billingUI.sample=true;
  assert.ok(Billing.analytics(S).sums.commission<0);
});

test('daily table with no spending keeps one current row and a blank history state', () => {
  const {S,ctx} = fixture();
  S.billingUI.from='2026-10-01';S.billingUI.to='2026-10-18';
  const page=Billing.page(ctx);
  const daily=page.match(/class="table-scroll bill-daily-scroll"[\s\S]*?<\/table>/)[0];
  assert.match(daily, /2026-10-18/);
  assert.doesNotMatch(daily, /2026-10-17|2026-10-01/);
  assert.match(daily, /No spent history yet/);
  assert.equal((daily.match(/<tr/g)||[]).length,3);
  assert.equal(Billing.analytics(S).rows.length,18);
  assert.deepEqual(S.ledger,[]);
});

test('seller and broker empty daily histories preserve their role-specific columns', () => {
  const {S,ctx}=fixture({role:'Seller'});
  let daily=Billing.page(ctx).match(/class="table-scroll bill-daily-scroll"[\s\S]*?<\/table>/)[0];
  assert.match(daily, /Earnings/);assert.match(daily, /Commission paid/);assert.match(daily, /No earnings history yet/);
  S.role='Broker';
  daily=Billing.page(ctx).match(/class="table-scroll bill-daily-scroll"[\s\S]*?<\/table>/)[0];
  assert.match(daily, /Trading margin/);assert.match(daily, /No financial history yet/);
});

test('daily histories remain complete when nonzero activity or example analytics is present', () => {
  const {S,ctx}=fixture({ledger:[{id:'CHARGE',type:'Capacity purchase',amount:-10,createdAt:'2026-10-02T12:00:00Z',status:'Paid'}]});
  S.billingUI.from='2026-10-01';S.billingUI.to='2026-10-03';
  let daily=Billing.page(ctx).match(/class="table-scroll bill-daily-scroll"[\s\S]*?<\/table>/)[0];
  assert.equal((daily.match(/<tr/g)||[]).length,4);
  assert.match(daily, /\$10\.00/);assert.doesNotMatch(daily, /No spent history yet/);
  S.ledger=[];S.billingUI.sample=true;
  daily=Billing.page(ctx).match(/class="table-scroll bill-daily-scroll"[\s\S]*?<\/table>/)[0];
  assert.equal((daily.match(/<tr/g)||[]).length,4);
  assert.doesNotMatch(daily, /No spent history yet/);
});
