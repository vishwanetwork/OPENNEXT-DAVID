/* Role-aware reporting. Financial balances change only through verified backend records. */
(function (root) {
  'use strict';
  const VERSION = 1;
  const COLORS = { purchase: '#7298b5', revenue: '#3a7355', commission: '#bea165', spot: '#3a7355', demand: '#7298b5', other: '#bea165' };
  let chartState = null, resizeFrame = null;
  const round = value => Math.round((Number(value) || 0) * 100) / 100;
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const usd = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num(value));
  const tokenUsd = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(num(value));
  const html = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const iso = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : d.toISOString(); };
  const dateKey = value => iso(value).slice(0, 10);
  const stamp = value => { const d = new Date(value); return !value || Number.isNaN(d.getTime()) ? 'Not recorded' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'; };
  const uid = prefix => prefix + '-' + (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 9));
  const role = S => ['Seller', 'Broker'].includes(S.role) ? S.role : 'Buyer';
  const orderSide = o => o.side || (o.role === 'Seller' ? 'sell' : 'buy');
  const inPeriod = (S, value) => { const day = dateKey(value); return day && day >= S.billingUI.from && day <= S.billingUI.to; };
  function chartWidth() { const viewport = Number(root.innerWidth) || 1440; return viewport < 700 ? Math.max(280, viewport - 120) : 1060; }
  const button = (text, act, attrs = '', primary = false) => `<button type="button" class="btn ${primary ? '' : 'secondary'} small" data-act="${act}" ${attrs}>${text}</button>`;
  const detail = (label, value) => `<div><small>${html(label)}</small><strong>${html(value == null || value === '' ? 'Not recorded' : value)}</strong></div>`;
  function init(S) {
    S.ledger = Array.isArray(S.ledger) ? S.ledger : [];
    // Only the exact, untouched old preview fixture is removed. User credits are never reset.
    if (!S.billingVersion && S.balance === 9952 && S.ledger.length === 2 &&
      S.ledger.some(l => l.id === 'CR-1001' && Number(l.amount) === 10000) &&
      S.ledger.some(l => l.id === 'CH-1002' && Number(l.amount) === -48)) { S.balance = 0; S.ledger = []; }
    if (!Number.isFinite(Number(S.balance))) S.balance = 0;
    S.balance = round(S.balance);
    S.earningsBalance = round(S.earningsBalance);
    S.payouts = Array.isArray(S.payouts) ? S.payouts : [];
    S.paymentSessions = Array.isArray(S.paymentSessions) ? S.paymentSessions : [];
    S.orders = Array.isArray(S.orders) ? S.orders : [];
    S.billingVersion = VERSION;
    const today = new Date();
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
    S.billingUI = { from: start, to: today.toISOString().slice(0, 10), chart: 'bars', sample: false, hidden: [], ...S.billingUI };
    return S;
  }
  function flow(l) {
    const type = String(l.type || '').toLowerCase();
    if (/cashout|payout|top.?up|credit|refund/.test(type) || l.wallet === 'credit' && num(l.amount) > 0) return 'transfer';
    if (/commission/.test(type)) return 'commission';
    if (/earning|sale|revenue|settlement/.test(type) && num(l.amount) > 0) return 'revenue';
    return num(l.amount) < 0 ? 'purchase' : 'transfer';
  }
  function signedCommission(S, value) { return (role(S) === 'Seller' ? -1 : 1) * Math.abs(num(value)); }
  function ledgerAmount(S, item) { return flow(item) === 'commission' ? signedCommission(S, item.amount) : num(item.amount); }
  function ledgerLabel(S, item) { return flow(item) === 'commission' ? role(S) === 'Seller' ? 'Commission paid' : 'Commission earned' : item.type; }
  function periodRows(S) {
    const { from, to } = S.billingUI;
    return S.ledger.filter(l => {
      const day = dateKey(l.createdAt || l.date);
      return day && day >= from && day <= to && !['Failed', 'Cancelled', 'Pending'].includes(l.status);
    });
  }
  function daysBetween(from, to) {
    const days = [], start = Date.parse(from + 'T00:00:00Z'), end = Date.parse(to + 'T00:00:00Z');
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return days;
    for (let t = start; t <= end && days.length < 366; t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
    return days;
  }
  function analytics(S) {
    const days = daysBetween(S.billingUI.from, S.billingUI.to);
    const rows = days.map(day => ({ day, purchase: 0, revenue: 0, commission: 0, spot: 0, demand: 0, other: 0 }));
    const map = Object.fromEntries(rows.map(r => [r.day, r]));
    for (const l of periodRows(S)) {
      const key = flow(l), r = map[dateKey(l.createdAt || l.date)];
      if (!r || key === 'transfer') continue;
      const amount = key === 'commission' ? signedCommission(S, l.amount) : Math.abs(num(l.amount)); r[key] += amount;
      if (key === 'purchase') {
        const o = S.orders.find(x => x.id === l.orderId);
        r[o && /spot/i.test(o.term) ? 'spot' : o && /on.?demand/i.test(o.term) ? 'demand' : 'other'] += amount;
      }
    }
    if (S.billingUI.sample) rows.forEach((r, i) => {
      r.spot = round(38 + i % 6 * 8); r.demand = round(118 + i % 9 * 13); r.other = round(12 + i % 4 * 3);
      r.purchase = r.spot + r.demand + r.other; r.revenue = round(r.purchase * 1.22); r.commission = signedCommission(S, round(r.revenue * .035));
    });
    const sums = rows.reduce((a, r) => { for (const k of ['purchase', 'revenue', 'commission', 'spot', 'demand', 'other']) a[k] += r[k]; return a; }, { purchase: 0, revenue: 0, commission: 0, spot: 0, demand: 0, other: 0 });
    return { rows, sums, sample: S.billingUI.sample };
  }
  function metrics(S, a) {
    const r = role(S), n = Math.max(1, a.rows.length), sample = a.sample ? 'Example analysis' : 'Selected period';
    const settled = S.orders.filter(o => orderSide(o) === 'buy' && /completed|settled/i.test(o.status) && o.paymentStatus === 'Paid' && inPeriod(S, o.completedAt || o.settledAt || (o.audit || []).filter(e => /completed|settled/i.test(e.event)).at(-1)?.at));
    const pending = S.orders.filter(o => orderSide(o) === 'sell' && o.paymentStatus === 'Paid' && !/completed|cancelled|settled/i.test(o.status)).reduce((sum, o) => sum + num(o.sellerNet == null ? o.subtotal == null ? o.total || o.amount : o.subtotal : o.sellerNet), 0);
    const cards = r === 'Buyer' ? [
      ['Purchases & usage charges', a.sums.purchase, sample], ['Average daily spend', a.sums.purchase / n, 'Posted charges / calendar days'],
      ['Pending orders', S.orders.filter(o => orderSide(o) === 'buy' && o.paymentStatus !== 'Paid' && !/cancelled/i.test(o.status)).reduce((sum, o) => sum + num(o.total || o.amount), 0), 'Current unpaid orders · not date-filtered'],
      ['Completed purchases', settled.length, 'Completed within selected period', true]
    ] : r === 'Seller' ? [
      ['Settled earnings', a.sums.revenue, sample], ['Pending settlement', pending, 'Current paid orders · not date-filtered'],
      ['Commission paid', a.sums.commission, 'Broker fees deducted from earnings'], ['Paid out', S.payouts.filter(p => p.status === 'Paid' && dateKey(p.paidAt) >= S.billingUI.from && dateKey(p.paidAt) <= S.billingUI.to).reduce((sum, p) => sum + num(p.amount), 0), 'Completed withdrawals']
    ] : [
      ['Purchase cost', a.sums.purchase, sample], ['Sales revenue', a.sums.revenue, sample],
      ['Trading margin', a.sums.revenue - a.sums.purchase, 'Revenue less purchase charges; before overhead'], ['Commission earned', a.sums.commission, 'Reported separately from trading margin']
    ];
    return `<div class="bill-metrics">${cards.map(([label, value, note, count]) => `<div class="bill-metric"><span>${label}</span><strong>${count ? value : usd(value)}</strong><small>${note}</small></div>`).join('')}</div>`;
  }
  function seriesFor(S) {
    return role(S) === 'Buyer' ? [['demand', 'On-demand'], ['spot', 'Spot'], ['other', 'Other capacity']] : role(S) === 'Seller' ? [['revenue', 'Earnings'], ['commission', 'Commission paid']] : [['purchase', 'Purchase cost'], ['revenue', 'Sales revenue'], ['commission', 'Commission earned']];
  }
  function chart(S, a) {
    const series = seriesFor(S), visible = series.filter(([key]) => !S.billingUI.hidden.includes(key));
    const w = chartWidth(), h = 240, left = 70, right = 20, top = 20, bottom = 35, inner = w - left - right, ch = h - top - bottom;
    const bounds = a.rows.map(r => {
      const values = visible.map(([key]) => num(r[key]));
      return S.billingUI.chart === 'bars'
        ? [values.reduce((sum, value) => sum + Math.min(0, value), 0), values.reduce((sum, value) => sum + Math.max(0, value), 0)]
        : [Math.min(0, ...values), Math.max(0, ...values)];
    });
    const min = Math.min(0, ...bounds.map(b => b[0])), max = Math.max(1, ...bounds.map(b => b[1])), span = max - min;
    const y = value => top + (max - value) / span * ch, zero = y(0);
    const step = inner / Math.max(1, a.rows.length), bw = Math.max(1, Math.min(25, step * .62));
    const grid = [0, .25, .5, .75, 1].map(f => {
      const value = min + span * f;
      return '<line x1="' + left + '" x2="' + (w - right) + '" y1="' + y(value) + '" y2="' + y(value) + '" stroke="#e8eee9"/><text x="' + (left - 10) + '" y="' + (y(value) + 4) + '" text-anchor="end">' + usd(value) + '</text>';
    }).join('') + '<line data-bill-zero="true" x1="' + left + '" x2="' + (w - right) + '" y1="' + zero + '" y2="' + zero + '" stroke="#9bac9f" stroke-width="1.2"/>';
    let drawing = '';
    if (S.billingUI.chart === 'bars') drawing = a.rows.map((r, i) => {
      let positive = 0, negative = 0;
      return visible.map(([key, label]) => {
        const value = num(r[key]), start = value < 0 ? negative : positive, end = start + value;
        if (value < 0) negative = end; else positive = end;
        return '<rect tabindex="0" role="img" data-bill-series="' + key + '" aria-label="' + html(r.day + ', ' + label + ': ' + usd(value)) + '" x="' + (left + step * i + (step - bw) / 2) + '" y="' + Math.min(y(start), y(end)) + '" width="' + bw + '" height="' + Math.abs(y(end) - y(start)) + '" rx="2" fill="' + COLORS[key] + '"><title>' + html(r.day + ' · ' + label + ' · ' + usd(value)) + '</title></rect>';
      }).join('');
    }).join('');
    else drawing = visible.map(([key, label]) => {
      const points = a.rows.map((r, i) => (left + step * (i + .5)) + ',' + y(r[key])).join(' ');
      return '<polyline data-bill-series="' + key + '" fill="none" stroke="' + COLORS[key] + '" stroke-width="2" points="' + points + '"/>' + a.rows.map((r, i) => '<circle tabindex="0" role="img" aria-label="' + html(r.day + ', ' + label + ': ' + usd(r[key])) + '" cx="' + (left + step * (i + .5)) + '" cy="' + y(r[key]) + '" r="3" fill="' + COLORS[key] + '"><title>' + html(r.day + ' · ' + label + ' · ' + usd(r[key])) + '</title></circle>').join('');
    }).join('');
    const indexes = [...new Set([0, Math.floor((a.rows.length - 1) / 3), Math.floor((a.rows.length - 1) * 2 / 3), a.rows.length - 1])].filter(i => i >= 0);
    const labels = indexes.map(i => '<text x="' + (left + step * (i + .5)) + '" y="' + (h - 10) + '" text-anchor="middle">' + html(new Date(a.rows[i].day).toLocaleDateString('en-GB', {day:'2-digit', month:'short', timeZone:'UTC'})) + '</text>').join('');
    const totalActivity = visible.reduce((sum, [key]) => sum + a.rows.reduce((value, row) => value + Math.abs(row[key]), 0), 0);
    return '<section class="panel bill-chart-panel"><div class="bill-panel-head"><div><h2>' + (role(S) === 'Buyer' ? 'Compute spend' : role(S) === 'Seller' ? 'Earnings over time' : 'Buying, selling & commission') + '</h2><p>' + (a.sample ? 'Example analysis · not your balance or transaction history' : 'Posted account activity · USD · UTC') + '</p></div><div class="bill-segment">' + button('Bars', 'bill-chart', 'data-value="bars" aria-pressed="' + (S.billingUI.chart === 'bars') + '"') + button('Lines', 'bill-chart', 'data-value="lines" aria-pressed="' + (S.billingUI.chart === 'lines') + '"') + '</div></div><div class="bill-chart-legend">' + series.map(([key, label]) => '<button class="bill-legend" type="button" data-act="bill-series" data-value="' + key + '" aria-pressed="' + !S.billingUI.hidden.includes(key) + '"><i style="--series-color:' + COLORS[key] + '"></i>' + label + '<strong>' + usd(a.sums[key]) + '</strong></button>').join('') + '</div><div class="bill-svg-wrap"><svg class="bill-chart" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Daily financial activity from ' + html(S.billingUI.from) + ' to ' + html(S.billingUI.to) + '">' + grid + drawing + labels + '</svg>' + (totalActivity === 0 ? '<div class="bill-chart-empty">No posted activity in this period</div>' : '') + '</div><p class="bill-footnote">' + (role(S) === 'Buyer' ? 'Payments and posted usage charges are shown on their posting date. Prepaid orders are not a measure of actual GPU utilization.' : role(S) === 'Seller' ? 'Broker commissions are expenses shown below zero. Only settled earnings are withdrawable.' : 'Only settled earnings are withdrawable. Quotes and projected sales are not spendable funds.') + '</p></section>';
  }
  function capacityPanel(S) {
    const paid = S.orders.filter(o => orderSide(o) === 'buy' && o.paymentStatus === 'Paid' && !/cancelled/i.test(o.status));
    const gpuOrders = paid.filter(o => !/model|token|physical|hardware/i.test(o.kind || '') && o.count && o.hours);
    let reserved = gpuOrders.reduce((sum, o) => sum + num(o.count) * num(o.hours), 0);
    const telemetry = gpuOrders.filter(o => o.telemetry && Number.isFinite(Number(o.telemetry.usedGpuHours)));
    let used = telemetry.reduce((sum, o) => sum + num(o.telemetry.usedGpuHours), 0);
    let coverage = reserved > 0 && telemetry.length === gpuOrders.length;
    const sample = S.billingUI.sample;
    if (sample) { reserved = 11520; used = 7920; coverage = true; }
    const seller = role(S) === 'Seller';
    const delivering = S.orders.filter(o => orderSide(o) === 'sell' && /provisioning|active/i.test(o.status)).length;
    return `<section class="panel bill-capacity"><div class="bill-panel-head"><div><h2>${seller ? 'Supply performance' : 'Capacity efficiency'}${sample ? ' · example' : ''}</h2><p>${sample ? 'Illustrative capacity and utilization metrics, not connected telemetry.' : seller ? 'Inventory and delivery metrics, separate from earnings.' : 'Purchased capacity and observed utilization, kept separate.'}</p></div>${button('Measurement details', 'bill-measurement')}</div><div class="bill-efficiency-grid">${detail(seller ? 'Published listings' : 'Reserved GPU-hours', seller ? (sample ? 12 : S.listings.filter(l => l.status === 'Published').length) : reserved.toLocaleString('en-US'))}${detail(seller ? 'Orders in delivery' : 'Metered GPU-hours', seller ? (sample ? 7 : delivering) : coverage ? used.toLocaleString('en-US') : 'Awaiting usage telemetry')}${detail(seller ? 'Acceptance rate' : 'Capacity utilization', seller ? (sample ? '97.2%' : 'Awaiting delivery history') : coverage ? (used / reserved * 100).toFixed(1) + '%' : 'Not available')}</div><div class="bill-meter"><span style="width:${coverage ? Math.min(100, Math.max(0, used / reserved * 100)) : 0}%"></span></div>${sample ? `<div class="bill-efficiency-sample"><div><span>Reserved capacity</span><strong>11,520 GPU-hours</strong><div class="bill-resource-bar"><i style="width:100%;background:#a7bdcf"></i></div></div><div><span>Productive GPU time</span><strong>7,920 GPU-hours</strong><div class="bill-resource-bar"><i style="width:68.75%;background:#629173"></i></div></div><div><span>Unutilized allocation</span><strong>3,600 GPU-hours · 31.3%</strong><div class="bill-resource-bar"><i style="width:31.25%;background:#c5ac78"></i></div></div></div>` : ''}<p class="bill-footnote">${sample ? 'Example only. Utilization = 7,920 / 11,520 GPU-hours. This illustration does not create orders, metering records or earnings.' : coverage ? 'Calculated from metered GPU-hours divided by reserved GPU-hours for paid GPU orders.' : 'Connect provider usage and delivery records before evaluating idle capacity, efficiency or SLA compliance.'}</p></section>`;
  }
  function activity(S) {
    const list = S.ledger.filter(l => { const d = dateKey(l.createdAt || l.date); return d && d >= S.billingUI.from && d <= S.billingUI.to; });
    const unpaid = S.orders.filter(o => o.paymentStatus !== 'Paid' && dateKey(o.createdAt || o.created) >= S.billingUI.from && dateKey(o.createdAt || o.created) <= S.billingUI.to && !list.some(l => l.orderId === o.id));
    const rows = [...list.map(l => ({ ...l, orderId: l.orderId, type: ledgerLabel(S, l), displayAmount: ledgerAmount(S, l), isOrder: false })), ...unpaid.map(o => ({ id: o.id, orderId: o.id, type: o.title || 'Capacity order', createdAt: o.createdAt || o.created, displayAmount: (orderSide(o) === 'sell' ? 1 : -1) * num(o.total || o.amount), status: o.status, isOrder: true }))].sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
    return `<section class="panel bill-activity"><div class="bill-panel-head"><div><h2>Activity</h2><p>Your account records · test transactions are identified individually</p></div>${button('Export CSV', 'bill-export', 'data-value="activity"')}</div><div class="table-scroll"><table class="data-table"><thead><tr><th>Order</th><th>Description</th><th>Date · UTC</th><th>Status</th><th>Amount</th><th></th></tr></thead><tbody>${rows.length ? rows.map(l => `<tr><td>${l.orderId ? `<button class="detail-link bill-order-link" data-act="bill-order" data-id="${html(l.orderId)}">${html(l.orderId)}</button>` : '<span class="muted">—</span>'}</td><td>${html(l.type)}${l.test ? '<small class="bill-test-tag">Test transaction</small>' : ''}<small class="bill-row-meta">${html(l.id)}</small></td><td>${stamp(l.createdAt || l.date)}</td><td><span class="tag">${html(l.status || 'Posted')}</span></td><td class="bill-number ${l.displayAmount > 0 ? 'positive' : ''}">${l.displayAmount > 0 ? '+' : ''}${usd(l.displayAmount)}</td><td>${button('View details', l.orderId ? 'bill-order' : 'bill-record', `data-id="${html(l.orderId || l.id)}"`)}</td></tr>`).join('') : '<tr><td colspan="6"><div class="empty-state"><strong>No account activity yet</strong>Add credit or complete an order to begin your account history.</div></td></tr>'}</tbody></table></div></section>`;
  }
  function dailyTable(S, a) {
    const columns = seriesFor(S);
    const hasActivity=a.rows.some(row=>columns.some(([key])=>Math.abs(num(row[key]))>0));
    const rows=hasActivity?a.rows.slice().reverse():a.rows.slice(-1);
    const emptyLabel=role(S)==='Buyer'?'No spent history yet':role(S)==='Seller'?'No earnings history yet':'No financial history yet';
    return `<section class="panel"><div class="bill-panel-head"><h2>Daily ${role(S) === 'Buyer' ? 'spend' : 'financial'} details${a.sample ? ' · example' : ''}</h2>${button('Export daily data', 'bill-export', 'data-value="daily"')}</div><div class="table-scroll bill-daily-scroll"><table class="data-table"><thead><tr><th>Date · UTC</th>${columns.map(([, label]) => `<th>${label}</th>`).join('')}<th>${role(S) === 'Broker' ? 'Trading margin' : 'Total'}</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.day}</td>${columns.map(([key]) => `<td class="bill-number">${usd(r[key])}</td>`).join('')}<td class="bill-number"><strong>${usd(role(S) === 'Broker' ? r.revenue - r.purchase : columns.reduce((sum, [k]) => sum + r[k], 0))}</strong></td></tr>`).join('')}${hasActivity?'':`<tr class="bill-daily-empty"><td colspan="${columns.length+2}"><div>${emptyLabel}</div></td></tr>`}</tbody></table></div></section>`;
  }
  function payouts(S) {
    if (role(S) === 'Buyer') return '';
    return `<section class="panel"><div class="bill-panel-head"><div><h2>Payouts</h2><p>Funds are reserved when a cashout request is submitted.</p></div>${button('Cash out', 'cashout-start')}</div>${S.payouts.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Payout</th><th>Destination</th><th>Requested</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${S.payouts.map(p => `<tr><td>${html(p.id)}</td><td>${html(p.destination)}</td><td>${stamp(p.createdAt)}</td><td>${usd(p.amount)}</td><td>${html(p.status)} ${p.test ? '<small class="bill-test-tag">Test</small>' : ''}</td><td>${button('View details', 'cashout-detail', `data-id="${html(p.id)}"`)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><strong>No payouts yet</strong>Settled sale proceeds become available for withdrawal. Prepaid purchasing credit cannot be cashed out.</div>'}</section>`;
  }
  function page(ctx) {
    const S = init(ctx.S), r = role(S), a = analytics(S);
    chartState = S;
    return `<div class="page-content bill-page"><div class="page-heading"><div><h1>${r === 'Seller' ? 'Earnings & payouts' : r === 'Broker' ? 'Billing & earnings' : 'Billing & usage'}</h1><p>${r === 'Seller' ? 'Track sales, delivery settlement and withdrawals.' : r === 'Broker' ? 'Keep procurement, sales proceeds and commissions in clear view.' : 'Manage your credit and understand your capacity spending.'}</p></div><div class="bill-actions">${r !== 'Seller' ? button('Add credit', 'pay-start', '', true) : ''}${r !== 'Buyer' ? button('Cash out', 'cashout-start', '', true) : ''}</div></div><div class="bill-wallets"><section class="bill-wallet"><span>Available credit</span><strong>${usd(S.balance)}</strong><p>For purchases and usage charges</p>${r === 'Seller' ? button('Add credit', 'pay-start') : ''}</section>${r !== 'Buyer' ? `<section class="bill-wallet"><span>Available to withdraw</span><strong>${usd(S.earningsBalance)}</strong><p>Settled earnings · excludes prepaid credit</p></section><section class="bill-wallet"><span>Payouts in progress</span><strong>${usd(S.payouts.filter(p => p.status === 'Pending').reduce((sum, p) => sum + num(p.amount), 0))}</strong><p>Already reserved from withdrawable earnings</p></section>` : `<section class="bill-wallet bill-wallet-note"><strong>One account. Clear records.</strong><p>Your welcome credit is a one-time, non-withdrawable reward. Additional credit is added after verified payment. Orders and delivery records stay linked.</p></section>`}</div><div class="bill-controls"><form data-form="bill-filter" class="bill-date-filter"><label>From<input class="field" type="date" name="from" value="${html(S.billingUI.from)}" required></label><label>To<input class="field" type="date" name="to" value="${html(S.billingUI.to)}" required></label><button class="btn secondary small">Apply</button></form><button class="btn secondary small" data-act="bill-sample" aria-pressed="${a.sample}">${a.sample ? 'Return to my activity' : 'Preview example analytics'}</button></div>${a.sample ? '<div class="bill-example-banner"><strong>Example analytics</strong>These illustrative charts show the reporting layout. Your credit, earnings and account activity below are unchanged.</div>' : ''}${metrics(S, a)}${chart(S, a)}${capacityPanel(S)}${dailyTable(S, a)}${activity(S)}${payouts(S)}</div>`;
  }
  function party(value, fallback) { return typeof value === 'string' ? value : value ? [value.company, value.name, value.email].filter(Boolean).join(' · ') || fallback : fallback; }
  function orderPricing(o) {
    const unitRate = o.unitPrice == null ? o.rate : o.unitPrice;
    if (!/model|token/i.test(o.kind || '')) return detail('Unit price', unitRate == null ? 'See accepted quote breakdown' : usd(unitRate) + (/physical|hardware/i.test(o.kind || '') ? ' / GPU' : ' / GPU-hour'));
    const actual = (...values) => values.find(v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)));
    const rows = [['Input tokens', actual(o.inputRate, o.inputPrice)], ['Output tokens', actual(o.outputRate, o.outputPrice)], ['Cached input tokens', actual(o.cacheRate, o.cachePrice, o.cachedInputRate, o.cachedInputPrice)]];
    return detail('Total quoted token allocation', usd(o.subtotal == null ? o.total == null ? o.amount : o.total : o.subtotal)) + rows.filter(([, value]) => value !== undefined).map(([label, value]) => detail(label, tokenUsd(value) + ' / 1M tokens')).join('');
  }
  function orderDelivery(o) {
    const physical = /physical|hardware/i.test(o.kind || '');
    const eta = o.deliveryMinutes ? physical ? 'Within ' + Number((num(o.deliveryMinutes) / 1440).toFixed(2)) + ' days after payment and shipping confirmation' : 'Within ' + o.deliveryMinutes + ' minutes after payment and access setup' : 'To be confirmed';
    let fields = detail('Order created', stamp(o.createdAt || o.created)) + detail('Delivery method', o.deliveryMethod || (physical ? 'Shipment · to be confirmed' : 'To be confirmed')) + detail('Expected delivery', eta);
    if (physical) {
      fields += detail('Required arrival', stamp(o.requiredArrival || o.requiredDeliveryBy || o.serviceStart)) + detail('Received', stamp(o.receivedAt || o.deliveredAt || o.completedAt));
      for (const [label, value] of [['Consignee', o.consignee], ['Shipping address', o.shippingAddress], ['Contact phone', o.contactPhone], ['Condition', o.condition], ['Warranty', o.warranty], ['Shipping terms', o.incoterms]]) if (value) fields += detail(label, value);
      fields += detail('Cancellation / return', o.cancellationTerms || 'Subject to shipment status and accepted supplier terms') + detail('Acceptance terms', o.sla || 'Inspect SKU, serial numbers, condition and warranty on receipt');
    } else fields += detail('Delivered at', stamp(o.deliveredAt)) + detail('Service starts', stamp(o.serviceStart)) + detail('Service ends', stamp(o.serviceEnd)) + detail('Cancellation / refund', o.cancellationTerms || 'Subject to accepted quote and delivery status') + detail('SLA / interruption', o.sla || (o.term === 'Spot' ? 'Interruptible; checkpointing recommended' : 'Subject to accepted quote'));
    return `<h3 class="bill-section-title">${physical ? 'Shipping & acceptance' : 'Delivery & service'}</h3><div class="bill-detail-grid">${fields}</div>`;
  }
  function orderActions(o) {
    const side = orderSide(o), id = html(o.id);
    if (/cancelled|completed|settled/i.test(o.status)) return '';
    if (side === 'buy' && o.paymentStatus !== 'Paid') return button('Add credit', 'pay-start', `data-order-id="${id}"`) + button('Pay order', 'proc-payment', `data-id="${id}"`, true);
    if (side === 'sell') {
      if (['Awaiting buyer payment', 'Awaiting payment'].includes(o.status)) return '<p class="form-note">Awaiting verified buyer payment.</p>';
      const labels = { Paid: 'Start provisioning', Provisioning: 'Confirm delivery', Active: 'Complete service & settle' };
      return labels[o.status] ? button(labels[o.status], 'proc-seller-progress', `data-id="${id}"`, true) : '';
    }
    return '';
  }
  function orderCommission(S, item) {
    const recorded = item.commissionAmount ?? item.brokerCommission ?? item.commission;
    if (recorded != null) return signedCommission(S, recorded);
    const entries = S.ledger.filter(entry => entry.orderId === item.id && flow(entry) === 'commission');
    return entries.length ? entries.reduce((sum, entry) => sum + ledgerAmount(S, entry), 0) : null;
  }
  function orderModal(S, id) {
    const o = S.orders.find(x => x.id === id);
    if (!o) return { title: 'Order unavailable', body: '<p class="form-note">This order is not in the current account. Check the order ID or contact support.</p>' };
    const total = num(o.total == null ? o.amount : o.total), subtotal = num(o.subtotal == null ? total - num(o.fees) - num(o.tax) : o.subtotal);
    const duration = /physical|hardware/i.test(o.kind || '') ? 'One-time purchase' : o.hours ? o.hours + ' hours' : o.days ? o.days + ' days' : 'As agreed';
    const quantity = o.kind === 'model_capacity' ? (o.inputMillion != null || o.outputMillion != null ? ((o.inputMillion || 0) + 'M input / ' + (o.outputMillion || 0) + 'M output tokens') : 'As agreed in accepted quote') : (o.count || '—') + ' GPUs';
    return { title: 'Order details · ' + o.id, wide: true, body: `<div class="bill-order-summary"><div><h3>${html(o.title || o.model)}</h3><p>${html(o.status)} · ${html(o.paymentStatus || 'Unpaid')}${o.sample ? ' · Sample order' : ''}</p></div><strong>${usd(total)}</strong></div><div class="bill-detail-grid">${detail('Buyer', party(o.buyer, 'Not recorded'))}${detail('Supplier', party(o.seller, o.provider || 'Not recorded'))}${detail('Broker / agent', party(o.broker, 'Not involved'))}${detail('Resource', o.model || o.sku)}${detail('Quantity', quantity)}${detail('Region', o.region)}${detail('Market terms', o.term)}${detail('Duration', duration)}${detail('Trade method', o.tradeMethod || 'RFQ · accepted supplier quote')}${detail('RFQ', o.rfqId)}${detail('Quote', o.quoteId)}${detail('Quote valid until', stamp(o.quoteValidUntil))}</div><h3 class="bill-section-title">Price breakdown</h3><div class="bill-price-list">${orderPricing(o)}${detail('Subtotal', usd(subtotal))}${detail('Platform fee', usd(o.fees))}${detail('Tax', usd(o.tax))}${detail('Order total · USD', usd(total))}${orderCommission(S, o) != null ? detail(role(S) === 'Seller' ? 'Commission paid' : 'Commission earned', usd(orderCommission(S, o))) : ''}${detail('Payment method', o.paymentMethod || 'Not selected')}${detail('Payment status', o.paymentStatus || 'Unpaid')}${detail('Payment reference', o.paymentId || o.paymentReference || 'Not yet paid')}</div>${orderDelivery(o)}<h3 class="bill-section-title">Order timeline</h3><ol class="bill-timeline">${(o.audit || [{ at: o.createdAt || o.created, event: 'Order created' }]).map(e => `<li><span>${html(e.event)}</span><time>${stamp(e.at)}</time></li>`).join('')}</ol><div class="modal-footer">${orderActions(o)}${button('Download order', 'bill-export', `data-value="order" data-id="${html(o.id)}"`)}${button('Close', 'close-modal')}</div>` };
  }
  function modal(ctx, type, extra = {}) {
    const S = init(ctx.S), id = extra.id || S.modal && S.modal.id;
    if (type === 'bill-order') return orderModal(S, id);
    if (type === 'bill-measurement') return { title: 'How reporting is measured', body: '<div class="callout">Spending comes from posted account charges, not GPU utilization estimates. Credit additions and withdrawals are excluded from operating spend.</div><div class="bill-detail-grid">' + detail('Reserved GPU-hours', 'Paid GPU count × contracted hours') + detail('Metered GPU-hours', 'Usage recorded by your resource provider') + detail('Utilization', 'Metered / reserved GPU-hours; only when coverage is complete') + detail('Earnings', 'Settled sale proceeds, excluding top-ups') + detail('Trading margin', 'Sales revenue minus purchase charges') + detail(role(S) === 'Seller' ? 'Commission paid' : 'Commission earned', role(S) === 'Seller' ? 'Broker fees are negative expenses' : 'Broker fees, reported separately') + '</div><p class="form-note">Provider telemetry and actual payment processing will be connected separately. Unknown values remain unavailable rather than being estimated as fact.</p>' };
    if (['pay-start', 'topup', 'pay-checkout'].includes(type)) {
      const payment = root.OpenNEXTPayments?.modal?.(ctx, type === 'pay-checkout' ? 'pay-start' : type, extra);
      return payment || {title: 'Payment setup required', body: '<p class="form-note">Secure checkout is not configured yet. No payment has been taken and no credit has been added.</p>'};
    }
    if (type === 'cashout-start') return {title: 'Cash out earnings', body: '<div class="pay-summary"><span>Available to withdraw</span><strong>' + usd(S.earningsBalance) + '</strong></div><p class="form-note">Payout processing is not configured yet. Contact your OpenNEXT account team to arrange a verified payout. Promotional credit and prepaid purchasing credit cannot be withdrawn.</p><div class="modal-footer">' + button('Close', 'close-modal') + '</div>'};
    if (type === 'cashout-detail') {
      const payout = S.payouts.find(item => item.id === id); if (!payout) return null;
      return {title: 'Payout details · ' + payout.id, body: '<div class="bill-detail-grid">' + detail('Amount', usd(payout.amount)) + detail('Status', payout.status) + detail('Destination', payout.destination) + detail('Beneficiary', payout.beneficiary) + detail('Requested', stamp(payout.createdAt)) + detail('Completed', stamp(payout.paidAt)) + '</div><p class="form-note">Payout status is confirmed by the payment service. It cannot be changed from this page.</p><div class="modal-footer">' + button('Close', 'close-modal') + '</div>'};
    }
    if (type === 'bill-record' || type === 'receipt') {
      const l = S.ledger.find(x => x.id === id); if (!l) return null;
      if (l.orderId) return orderModal(S, l.orderId);
      return { title: 'Activity details · ' + l.id, body: `${l.test ? '<div class="bill-test-notice"><strong>Test transaction</strong>No real funds were charged or transferred.</div>' : ''}<div class="bill-detail-grid">${detail('Description', ledgerLabel(S, l))}${detail('Amount', usd(ledgerAmount(S, l)))}${detail('Status', l.status || 'Posted')}${detail('Date', stamp(l.createdAt || l.date))}${detail('Account', S.identity && S.identity.email)}${detail('Payment method', l.paymentMethod || 'Not recorded')}${detail('Destination', l.destination || 'Not applicable')}${detail('Transaction ID', l.paymentId || l.id)}</div><div class="modal-footer">${button('Download record', 'bill-export', `data-value="record" data-id="${html(l.id)}"`)}</div>` };
    }
    return null;
  }
  function notify(ctx, text) { if (ctx.toast) ctx.toast(text); }
  function save(ctx) { ctx.persist(); ctx.render(); }
  function completePayment() {
    // Kept for compatibility; only an authenticated backend settlement can post funds.
    return false;
  }
  function csv(rows) {
    const keys = [...new Set(rows.flatMap(Object.keys))];
      const cell = value => { let text = value != null && typeof value === 'object' ? JSON.stringify(value) : String(value == null ? '' : value); if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text; return '"' + text.replace(/"/g, '""') + '"'; };
    return '\ufeff' + keys.map(cell).join(',') + '\r\n' + rows.map(r => keys.map(k => cell(r[k])).join(',')).join('\r\n');
  }
  function exportRows(S, type, id) {
    if (type === 'daily') return analytics(S).rows;
    if (type === 'order') return S.orders.filter(item => item.id === id).map(item => {
      const row = {...item};
      for (const key of ['commission', 'commissionAmount', 'brokerCommission']) if (row[key] != null) row[key] = signedCommission(S, row[key]);
      const commission = orderCommission(S, item); if (commission != null) row.commissionAmount = commission;
      return row;
    });
    return (type === 'record' ? S.ledger.filter(item => item.id === id) : S.ledger.filter(item => {
      const day = dateKey(item.createdAt || item.date); return day && day >= S.billingUI.from && day <= S.billingUI.to;
    })).map(item => ({...item, type: ledgerLabel(S, item), amount: ledgerAmount(S, item)}));
  }
  function download(ctx, type, id) {
    const S = ctx.S, rows = exportRows(S, type, id);
    if (!rows.length) { notify(ctx, 'No records to export in this period'); return; }
    if (!root.document || !root.URL) return;
    const url = root.URL.createObjectURL(new Blob([csv(rows)], {type: 'text/csv;charset=utf-8'}));
    const anchor = root.document.createElement('a'); anchor.href = url; anchor.download = 'OpenNEXT-' + (type === 'daily' && S.billingUI.sample ? 'example-' : '') + type + '.csv'; anchor.click(); setTimeout(() => root.URL.revokeObjectURL(url), 1000);
  }
  function action(ctx, act, b) {
    const S = init(ctx.S), d = b && b.dataset || {}, id = d.id;
    if (!/^(bill-|pay-|cashout-)/.test(act)) return false;
    if (act === 'pay-start') ctx.open('pay-start', {orderId: d.orderId});
    else if (act === 'bill-order' || act === 'bill-record' || act === 'cashout-detail') ctx.open(act, {id});
    else if (act === 'bill-measurement' || act === 'cashout-start') ctx.open(act);
    else if (act === 'bill-chart') {S.billingUI.chart = d.value === 'lines' ? 'lines' : 'bars'; ctx.render();}
    else if (act === 'bill-series') {const keys = seriesFor(S).map(([key]) => key); if (keys.includes(d.value)) {S.billingUI.hidden = S.billingUI.hidden.includes(d.value) ? S.billingUI.hidden.filter(key => key !== d.value) : [...S.billingUI.hidden, d.value]; ctx.render();}}
    else if (act === 'bill-sample') {S.billingUI.sample = !S.billingUI.sample; ctx.render();}
    else if (act === 'bill-export') download(ctx, d.value, id);
    else if (['pay-confirm', 'pay-fail', 'pay-cancel', 'cashout-settle', 'cashout-cancel'].includes(act)) notify(ctx, 'Payment and payout status can only be updated by the payment service.');
    return true;
  }
  function submit(ctx, form, data) {
    const S = init(ctx.S), kind = form.dataset.form;
    if (kind === 'bill-filter') {
      const from = dateKey(data.from), to = dateKey(data.to);
      if (!from || !to || from > to || Date.parse(to) - Date.parse(from) > 365 * 86400000) {notify(ctx, 'Choose a valid range of up to 366 days'); return true;}
      S.billingUI.from = from; S.billingUI.to = to; ctx.render(); return true;
    }
    if (kind === 'pay-amount' || kind === 'cashout-request') {
      notify(ctx, 'Secure payment and payout processing must be configured before funds can move. No balance has changed.');
      return true;
    }
    return false;
  }
  // Resize the chart alone. Re-rendering the whole workspace would discard in-progress
  // date fields or checkout inputs, so they deliberately remain untouched here.
  if (root.addEventListener && root.document) root.addEventListener('resize', () => {
    if (resizeFrame !== null) return;
    const schedule = root.requestAnimationFrame || (fn => setTimeout(fn, 16));
    resizeFrame = schedule(() => {
      resizeFrame = null;
      const panel = root.document.querySelector('.bill-chart-panel');
      const svg = panel && panel.querySelector('.bill-chart');
      if (!chartState || !svg || Number(svg.getAttribute('viewBox').split(' ')[2]) === chartWidth()) return;
      const active = root.document.activeElement;
      const focused = panel.contains(active) ? { act: active.dataset.act, value: active.dataset.value } : null;
      panel.outerHTML = chart(chartState, analytics(chartState));
      if (focused && focused.act) [...root.document.querySelectorAll('.bill-chart-panel [data-act]')].find(el => el.dataset.act === focused.act && el.dataset.value === focused.value)?.focus();
    });
  }, { passive: true });
  const api = { init, page, modal, action, submit, analytics, completePayment, csv, exportRows };
  root.OpenNEXTBilling = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
