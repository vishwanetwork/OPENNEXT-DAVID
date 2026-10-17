/* Role-aware account ledger. Preview payments never contact a payment processor. */
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
      const amount = Math.abs(num(l.amount)); r[key] += amount;
      if (key === 'purchase') {
        const o = S.orders.find(x => x.id === l.orderId);
        r[o && /spot/i.test(o.term) ? 'spot' : o && /on.?demand/i.test(o.term) ? 'demand' : 'other'] += amount;
      }
    }
    if (S.billingUI.sample) rows.forEach((r, i) => {
      r.spot = round(38 + i % 6 * 8); r.demand = round(118 + i % 9 * 13); r.other = round(12 + i % 4 * 3);
      r.purchase = r.spot + r.demand + r.other; r.revenue = round(r.purchase * 1.22); r.commission = round(r.revenue * .035);
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
      ['Average daily earnings', a.sums.revenue / n, 'Settled earnings / calendar days'], ['Paid out', S.payouts.filter(p => p.status === 'Paid' && dateKey(p.paidAt) >= S.billingUI.from && dateKey(p.paidAt) <= S.billingUI.to).reduce((sum, p) => sum + num(p.amount), 0), 'Completed withdrawals']
    ] : [
      ['Purchase cost', a.sums.purchase, sample], ['Sales revenue', a.sums.revenue, sample],
      ['Trading margin', a.sums.revenue - a.sums.purchase, 'Revenue less purchase charges; before overhead'], ['Commission earned', a.sums.commission, 'Reported separately from trading margin']
    ];
    return `<div class="bill-metrics">${cards.map(([label, value, note, count]) => `<div class="bill-metric"><span>${label}</span><strong>${count ? value : usd(value)}</strong><small>${note}</small></div>`).join('')}</div>`;
  }
  function seriesFor(S) {
    return role(S) === 'Buyer' ? [['demand', 'On-demand'], ['spot', 'Spot'], ['other', 'Other capacity']] : role(S) === 'Seller' ? [['revenue', 'Earnings'], ['commission', 'Commission']] : [['purchase', 'Purchase cost'], ['revenue', 'Sales revenue'], ['commission', 'Commission']];
  }
  function chart(S, a) {
    const series = seriesFor(S), visible = series.filter(([key]) => !S.billingUI.hidden.includes(key));
    const w = chartWidth();
    const h = 240, left = 58, right = 20, top = 20, bottom = 35, inner = w - left - right, ch = h - top - bottom;
    const max = Math.max(1, ...a.rows.map(r => S.billingUI.chart === 'bars' ? visible.reduce((sum, [k]) => sum + r[k], 0) : Math.max(0, ...visible.map(([k]) => r[k]))));
    const step = inner / Math.max(1, a.rows.length), bw = Math.max(1, Math.min(25, step * .62));
    const grid = [0, .25, .5, .75, 1].map(f => `<line x1="${left}" x2="${w - right}" y1="${top + ch * (1 - f)}" y2="${top + ch * (1 - f)}" stroke="#e8eee9"/><text x="${left - 10}" y="${top + ch * (1 - f) + 4}" text-anchor="end">${usd(max * f)}</text>`).join('');
    let drawing = '';
    if (S.billingUI.chart === 'bars') drawing = a.rows.map((r, i) => { let bottom = top + ch; return visible.map(([key, label]) => { const height = r[key] / max * ch; bottom -= height; return `<rect tabindex="0" role="img" aria-label="${html(r.day + ', ' + label + ': ' + usd(r[key]))}" x="${left + step * i + (step - bw) / 2}" y="${bottom}" width="${bw}" height="${height}" rx="2" fill="${COLORS[key]}"><title>${html(r.day + ' · ' + label + ' · ' + usd(r[key]))}</title></rect>`; }).join(''); }).join('');
    else drawing = visible.map(([key, label]) => {
      const points = a.rows.map((r, i) => `${left + step * (i + .5)},${top + ch - r[key] / max * ch}`).join(' ');
      return `<polyline fill="none" stroke="${COLORS[key]}" stroke-width="2" points="${points}"/>` + a.rows.map((r, i) => `<circle tabindex="0" role="img" aria-label="${html(r.day + ', ' + label + ': ' + usd(r[key]))}" cx="${left + step * (i + .5)}" cy="${top + ch - r[key] / max * ch}" r="3" fill="${COLORS[key]}"><title>${html(r.day + ' · ' + label + ' · ' + usd(r[key]))}</title></circle>`).join('');
    }).join('');
    const indexes = [...new Set([0, Math.floor((a.rows.length - 1) / 3), Math.floor((a.rows.length - 1) * 2 / 3), a.rows.length - 1])].filter(i => i >= 0);
    const labels = indexes.map(i => `<text x="${left + step * (i + .5)}" y="${h - 10}" text-anchor="middle">${html(new Date(a.rows[i].day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }))}</text>`).join('');
    const total = visible.reduce((sum, [key]) => sum + a.sums[key], 0);
    return `<section class="panel bill-chart-panel"><div class="bill-panel-head"><div><h2>${role(S) === 'Buyer' ? 'Compute spend' : role(S) === 'Seller' ? 'Earnings over time' : 'Buying, selling & commission'}</h2><p>${a.sample ? 'Example analysis · not your balance or transaction history' : 'Posted account activity · USD · UTC'}</p></div><div class="bill-segment">${button('Bars', 'bill-chart', `data-value="bars" aria-pressed="${S.billingUI.chart === 'bars'}"`)}${button('Lines', 'bill-chart', `data-value="lines" aria-pressed="${S.billingUI.chart === 'lines'}"`)}</div></div><div class="bill-chart-legend">${series.map(([key, label]) => `<button class="bill-legend" type="button" data-act="bill-series" data-value="${key}" aria-pressed="${!S.billingUI.hidden.includes(key)}"><i style="--series-color:${COLORS[key]}"></i>${label}<strong>${usd(a.sums[key])}</strong></button>`).join('')}</div><div class="bill-svg-wrap"><svg class="bill-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Daily financial activity from ${html(S.billingUI.from)} to ${html(S.billingUI.to)}">${grid}${drawing}${labels}</svg>${total === 0 ? '<div class="bill-chart-empty">No posted activity in this period</div>' : ''}</div><p class="bill-footnote">${role(S) === 'Buyer' ? 'Payments and posted usage charges are shown on their posting date. Prepaid orders are not a measure of actual GPU utilization.' : 'Only settled earnings are withdrawable. Quotes and projected sales are not spendable funds.'}</p></section>`;
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
    const rows = [...list.map(l => ({ ...l, orderId: l.orderId, displayAmount: l.amount, isOrder: false })), ...unpaid.map(o => ({ id: o.id, orderId: o.id, type: o.title || 'Capacity order', createdAt: o.createdAt || o.created, displayAmount: (orderSide(o) === 'sell' ? 1 : -1) * num(o.total || o.amount), status: o.status, isOrder: true }))].sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
    return `<section class="panel bill-activity"><div class="bill-panel-head"><div><h2>Activity</h2><p>Your account records · test transactions are identified individually</p></div>${button('Export CSV', 'bill-export', 'data-value="activity"')}</div><div class="table-scroll"><table class="data-table"><thead><tr><th>Order</th><th>Description</th><th>Date · UTC</th><th>Status</th><th>Amount</th><th></th></tr></thead><tbody>${rows.length ? rows.map(l => `<tr><td>${l.orderId ? `<button class="detail-link bill-order-link" data-act="bill-order" data-id="${html(l.orderId)}">${html(l.orderId)}</button>` : '<span class="muted">—</span>'}</td><td>${html(l.type)}${l.test ? '<small class="bill-test-tag">Test transaction</small>' : ''}<small class="bill-row-meta">${html(l.id)}</small></td><td>${stamp(l.createdAt || l.date)}</td><td><span class="tag">${html(l.status || 'Posted')}</span></td><td class="bill-number ${l.displayAmount > 0 ? 'positive' : ''}">${l.displayAmount > 0 ? '+' : ''}${usd(l.displayAmount)}</td><td>${button('View details', l.orderId ? 'bill-order' : 'bill-record', `data-id="${html(l.orderId || l.id)}"`)}</td></tr>`).join('') : '<tr><td colspan="6"><div class="empty-state"><strong>No account activity yet</strong>Add credit or complete an order to begin your account history.</div></td></tr>'}</tbody></table></div></section>`;
  }
  function dailyTable(S, a) {
    const columns = seriesFor(S);
    return `<section class="panel"><div class="bill-panel-head"><h2>Daily ${role(S) === 'Buyer' ? 'spend' : 'financial'} details${a.sample ? ' · example' : ''}</h2>${button('Export daily data', 'bill-export', 'data-value="daily"')}</div><div class="table-scroll bill-daily-scroll"><table class="data-table"><thead><tr><th>Date · UTC</th>${columns.map(([, label]) => `<th>${label}</th>`).join('')}<th>${role(S) === 'Broker' ? 'Trading margin' : 'Total'}</th></tr></thead><tbody>${a.rows.slice().reverse().map(r => `<tr><td>${r.day}</td>${columns.map(([key]) => `<td class="bill-number">${usd(r[key])}</td>`).join('')}<td class="bill-number"><strong>${usd(role(S) === 'Broker' ? r.revenue - r.purchase : columns.reduce((sum, [k]) => sum + r[k], 0))}</strong></td></tr>`).join('')}</tbody></table></div></section>`;
  }
  function payouts(S) {
    if (role(S) === 'Buyer') return '';
    return `<section class="panel"><div class="bill-panel-head"><div><h2>Payouts</h2><p>Funds are reserved when a cashout request is submitted.</p></div>${button('Cash out', 'cashout-start')}</div>${S.payouts.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Payout</th><th>Destination</th><th>Requested</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${S.payouts.map(p => `<tr><td>${html(p.id)}</td><td>${html(p.destination)}</td><td>${stamp(p.createdAt)}</td><td>${usd(p.amount)}</td><td>${html(p.status)} <small class="bill-test-tag">Test</small></td><td>${button('View details', 'cashout-detail', `data-id="${html(p.id)}"`)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><strong>No payouts yet</strong>Settled sale proceeds become available for withdrawal. Prepaid purchasing credit cannot be cashed out.</div>'}</section>`;
  }
  function page(ctx) {
    const S = init(ctx.S), r = role(S), a = analytics(S);
    chartState = S;
    return `<div class="page-content bill-page"><div class="page-heading"><div><h1>${r === 'Seller' ? 'Earnings & payouts' : r === 'Broker' ? 'Billing & earnings' : 'Billing & usage'}</h1><p>${r === 'Seller' ? 'Track sales, delivery settlement and withdrawals.' : r === 'Broker' ? 'Keep procurement, sales proceeds and commissions in clear view.' : 'Manage your credit and understand your capacity spending.'}</p></div><div class="bill-actions">${r !== 'Seller' ? button('Add credit', 'pay-start', '', true) : ''}${r !== 'Buyer' ? button('Cash out', 'cashout-start', '', true) : ''}</div></div><div class="bill-wallets"><section class="bill-wallet"><span>Available credit</span><strong>${usd(S.balance)}</strong><p>For purchases and usage charges</p>${r === 'Seller' ? button('Add credit', 'pay-start') : ''}</section>${r !== 'Buyer' ? `<section class="bill-wallet"><span>Available to withdraw</span><strong>${usd(S.earningsBalance)}</strong><p>Settled earnings · excludes prepaid credit</p></section><section class="bill-wallet"><span>Payouts in progress</span><strong>${usd(S.payouts.filter(p => p.status === 'Pending').reduce((sum, p) => sum + num(p.amount), 0))}</strong><p>Already reserved from withdrawable earnings</p></section>` : `<section class="bill-wallet bill-wallet-note"><strong>One account. Clear records.</strong><p>Credit is added only after a successful payment. Your orders, receipts and delivery timeline stay linked.</p></section>`}</div><div class="bill-controls"><form data-form="bill-filter" class="bill-date-filter"><label>From<input class="field" type="date" name="from" value="${html(S.billingUI.from)}" required></label><label>To<input class="field" type="date" name="to" value="${html(S.billingUI.to)}" required></label><button class="btn secondary small">Apply</button></form><button class="btn secondary small" data-act="bill-sample" aria-pressed="${a.sample}">${a.sample ? 'Return to my activity' : 'Preview example analytics'}</button></div>${a.sample ? '<div class="bill-example-banner"><strong>Example analytics</strong>These illustrative charts show the reporting layout. Your credit, earnings and account activity below are unchanged.</div>' : ''}${metrics(S, a)}${chart(S, a)}${capacityPanel(S)}${dailyTable(S, a)}${activity(S)}${payouts(S)}</div>`;
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
      const labels = { 'Awaiting buyer payment': 'Simulate buyer payment', 'Awaiting payment': 'Simulate buyer payment', Paid: 'Start provisioning', Provisioning: 'Confirm delivery', Active: 'Complete service & settle' };
      return labels[o.status] ? button(labels[o.status], 'proc-seller-progress', `data-id="${id}"`, true) : '';
    }
    return '';
  }
  function orderModal(S, id) {
    const o = S.orders.find(x => x.id === id);
    if (!o) return { title: 'Order unavailable', body: '<p class="form-note">This order is not in the current account. Check the order ID or contact support.</p>' };
    const total = num(o.total == null ? o.amount : o.total), subtotal = num(o.subtotal == null ? total - num(o.fees) - num(o.tax) : o.subtotal);
    const duration = /physical|hardware/i.test(o.kind || '') ? 'One-time purchase' : o.hours ? o.hours + ' hours' : o.days ? o.days + ' days' : 'As agreed';
    const quantity = o.kind === 'model_capacity' ? (o.inputMillion != null || o.outputMillion != null ? ((o.inputMillion || 0) + 'M input / ' + (o.outputMillion || 0) + 'M output tokens') : 'As agreed in accepted quote') : (o.count || '—') + ' GPUs';
    return { title: 'Order details · ' + o.id, wide: true, body: `<div class="bill-order-summary"><div><h3>${html(o.title || o.model)}</h3><p>${html(o.status)} · ${html(o.paymentStatus || 'Unpaid')}${o.sample ? ' · Sample order' : ''}</p></div><strong>${usd(total)}</strong></div><div class="bill-detail-grid">${detail('Buyer', party(o.buyer, 'Not recorded'))}${detail('Supplier', party(o.seller, o.provider || 'Not recorded'))}${detail('Broker / agent', party(o.broker, 'Not involved'))}${detail('Resource', o.model || o.sku)}${detail('Quantity', quantity)}${detail('Region', o.region)}${detail('Market terms', o.term)}${detail('Duration', duration)}${detail('Trade method', o.tradeMethod || 'RFQ · accepted supplier quote')}${detail('RFQ', o.rfqId)}${detail('Quote', o.quoteId)}${detail('Quote valid until', stamp(o.quoteValidUntil))}</div><h3 class="bill-section-title">Price breakdown</h3><div class="bill-price-list">${orderPricing(o)}${detail('Subtotal', usd(subtotal))}${detail('Platform fee', usd(o.fees))}${detail('Tax', usd(o.tax))}${detail('Order total · USD', usd(total))}${detail('Payment method', o.paymentMethod || 'Not selected')}${detail('Payment status', o.paymentStatus || 'Unpaid')}${detail('Payment reference', o.paymentId || o.paymentReference || 'Not yet paid')}</div>${orderDelivery(o)}<h3 class="bill-section-title">Order timeline</h3><ol class="bill-timeline">${(o.audit || [{ at: o.createdAt || o.created, event: 'Order created' }]).map(e => `<li><span>${html(e.event)}</span><time>${stamp(e.at)}</time></li>`).join('')}</ol><div class="modal-footer">${orderActions(o)}${button('Download order', 'bill-export', `data-value="order" data-id="${html(o.id)}"`)}${button('Close', 'close-modal')}</div>` };
  }
  function modal(ctx, type, extra = {}) {
    const S = init(ctx.S), id = extra.id || S.modal && S.modal.id;
    if (type === 'bill-order') return orderModal(S, id);
    if (type === 'bill-measurement') return { title: 'How reporting is measured', body: '<div class="callout">Spending comes from posted account charges, not GPU utilization estimates. Credit additions and withdrawals are excluded from operating spend.</div><div class="bill-detail-grid">' + detail('Reserved GPU-hours', 'Paid GPU count × contracted hours') + detail('Metered GPU-hours', 'Usage recorded by your resource provider') + detail('Utilization', 'Metered / reserved GPU-hours; only when coverage is complete') + detail('Earnings', 'Settled sale proceeds, excluding top-ups') + detail('Trading margin', 'Sales revenue minus purchase charges') + detail('Commission', 'Broker fees, reported separately') + '</div><p class="form-note">Provider telemetry and actual payment processing will be connected separately. Unknown values remain unavailable rather than being estimated as fact.</p>' };
    if (type === 'pay-start' || type === 'topup') return { title: 'Add credit', body: `<form data-form="pay-amount" data-order-id="${html(extra.orderId || '')}"><p class="form-note">Choose an amount to add to your purchasing balance. USD.</p><div class="pay-presets">${[100, 500, 1000].map((v, i) => `<label><input type="radio" name="preset" value="${v}" ${i === 0 ? 'checked' : ''}><span>${usd(v)}</span></label>`).join('')}<label><input type="radio" name="preset" value="other"><span>Other</span></label></div><label class="form-label" for="payCustom">Custom amount (only with Other)</label><input id="payCustom" class="field" type="number" name="custom" min="1" max="100000" step="0.01" placeholder="Enter USD amount"><p class="bill-test-notice"><strong>Test payment · no real charge</strong>Next, review a simulated checkout. Do not enter card or bank details.</p><div class="modal-footer"><button class="btn secondary" type="button" data-act="close-modal">Cancel</button><button class="btn">Continue to checkout</button></div></form>` };
    if (type === 'pay-checkout') {
      const p = S.paymentSessions.find(x => x.id === id);
      if (!p) return { title: 'Checkout unavailable', body: '<p>Start a new credit payment.</p>' };
      const paid = p.status === 'Paid', pending = p.status === 'Pending';
      return { title: paid ? 'Payment complete' : pending ? 'Review your payment' : 'Payment ' + p.status.toLowerCase(), body: `<div class="pay-checkout"><div class="bill-test-notice"><strong>Test payment · no real charge</strong>Stripe-style checkout preview. No connection to Stripe and no real payment details are collected.</div><div class="pay-summary"><span>OpenNEXT purchasing credit</span><strong>${usd(p.amount)}</strong></div><div class="bill-detail-grid">${detail('Account', S.identity && S.identity.email)}${detail('Currency', 'USD')}${detail('Payment method', 'Test card · 4242')}${detail('Processing fee', '$0.00 in this preview')}${detail('Payment ID', p.id)}${detail('Status', p.status)}</div>${paid ? '<div class="callout">Credit has been added once to your balance. Your payment record is available in Activity.</div>' : '<p class="form-note">Your available credit changes only after a successful test payment. A failed or cancelled payment adds no credit.</p>'}<div class="modal-footer">${pending ? button('Cancel', 'pay-cancel', `data-id="${html(p.id)}"`) + button('Test failure', 'pay-fail', `data-id="${html(p.id)}"`) + button('Pay ' + usd(p.amount) + ' · test', 'pay-confirm', `data-id="${html(p.id)}"`, true) : button('Done', 'close-modal')}${paid && p.orderId ? button('Back to order', 'bill-order', `data-id="${html(p.orderId)}"`, true) : ''}</div></div>` };
    }
    if (type === 'cashout-start') return { title: 'Cash out earnings', body: `<form data-form="cashout-request"><div class="bill-test-notice"><strong>Test payout · no funds transferred</strong>Use a bank label and last four digits only. Do not enter a full account number.</div><div class="pay-summary"><span>Available to withdraw</span><strong>${usd(S.earningsBalance)}</strong></div><p class="form-note">Only settled earnings can be withdrawn. Purchasing credit is held separately.</p><div class="form-grid"><label>Amount · USD<input class="field" name="amount" type="number" min="1" max="${Math.max(1, S.earningsBalance)}" step="0.01" required placeholder="0.00"></label><label>Beneficiary<input class="field" name="beneficiary" maxlength="120" value="${html(S.identity && (S.identity.company || S.identity.name) || '')}" required></label><label>Bank label<input class="field" name="bank" maxlength="80" placeholder="Business bank account" required></label><label>Account last 4 digits<input class="field" name="last4" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="1234" required></label></div><p class="form-note">Submitting reserves the amount immediately. Track the request in Payouts.</p><div class="modal-footer">${button('Cancel', 'close-modal')}<button class="btn" ${S.earningsBalance < 1 || role(S) === 'Buyer' ? 'disabled' : ''}>Request test payout</button></div></form>` };
    if (type === 'cashout-detail') {
      const p = S.payouts.find(x => x.id === id); if (!p) return null;
      return { title: 'Payout details · ' + p.id, body: `<div class="bill-test-notice"><strong>Test payout · no funds transferred</strong>The status below belongs to this local preview only.</div><div class="bill-detail-grid">${detail('Amount', usd(p.amount))}${detail('Status', p.status)}${detail('Destination', p.destination)}${detail('Beneficiary', p.beneficiary)}${detail('Requested', stamp(p.createdAt))}${detail('Completed', stamp(p.paidAt))}</div><div class="modal-footer">${p.status === 'Pending' ? button('Cancel request', 'cashout-cancel', `data-id="${html(p.id)}"`) + button('Simulate payout completion', 'cashout-settle', `data-id="${html(p.id)}"`, true) : button('Close', 'close-modal')}</div>` };
    }
    if (type === 'bill-record' || type === 'receipt') {
      const l = S.ledger.find(x => x.id === id); if (!l) return null;
      if (l.orderId) return orderModal(S, l.orderId);
      return { title: 'Activity details · ' + l.id, body: `${l.test ? '<div class="bill-test-notice"><strong>Test transaction</strong>No real funds were charged or transferred.</div>' : ''}<div class="bill-detail-grid">${detail('Description', l.type)}${detail('Amount', usd(l.amount))}${detail('Status', l.status || 'Posted')}${detail('Date', stamp(l.createdAt || l.date))}${detail('Account', S.identity && S.identity.email)}${detail('Payment method', l.paymentMethod || 'Not recorded')}${detail('Destination', l.destination || 'Not applicable')}${detail('Transaction ID', l.paymentId || l.id)}</div><div class="modal-footer">${button('Download record', 'bill-export', `data-value="record" data-id="${html(l.id)}"`)}</div>` };
    }
    return null;
  }
  function notify(ctx, text) { if (ctx.toast) ctx.toast(text); }
  function save(ctx) { ctx.persist(); ctx.render(); }
  function completePayment(S, id, result) {
    const p = S.paymentSessions.find(x => x.id === id);
    if (!p || p.status !== 'Pending') return false;
    if (!['Paid', 'Failed', 'Cancelled'].includes(result)) return false;
    p.status = result; p.updatedAt = new Date().toISOString();
    if (result === 'Paid') {
      S.balance = round(S.balance + p.amount);
      S.ledger.unshift({ id: 'CR-' + p.id, paymentId: p.id, type: 'Credit top-up', amount: p.amount, createdAt: p.updatedAt, date: p.updatedAt, role: p.role, status: 'Paid', wallet: 'credit', paymentMethod: 'Test card · 4242', test: true });
    }
    return true;
  }
  function csv(rows) {
    const keys = [...new Set(rows.flatMap(Object.keys))];
      const cell = value => { let text = value != null && typeof value === 'object' ? JSON.stringify(value) : String(value == null ? '' : value); if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text; return '"' + text.replace(/"/g, '""') + '"'; };
    return '\ufeff' + keys.map(cell).join(',') + '\r\n' + rows.map(r => keys.map(k => cell(r[k])).join(',')).join('\r\n');
  }
  function download(ctx, type, id) {
    const S = ctx.S;
    const rows = type === 'daily' ? analytics(S).rows : type === 'order' ? S.orders.filter(x => x.id === id) : type === 'record' ? S.ledger.filter(x => x.id === id) : S.ledger.filter(l => { const d = dateKey(l.createdAt || l.date); return d && d >= S.billingUI.from && d <= S.billingUI.to; });
    if (!rows.length) { notify(ctx, 'No records to export in this period'); return; }
    if (!root.document || !root.URL) return;
    const url = root.URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv;charset=utf-8' }));
    const a = root.document.createElement('a'); a.href = url; a.download = 'OpenNEXT-' + (type === 'daily' && S.billingUI.sample ? 'example-' : '') + type + '.csv'; a.click(); setTimeout(() => root.URL.revokeObjectURL(url), 1000);
  }
  function action(ctx, act, b) {
    const S = init(ctx.S), d = b && b.dataset || {}, id = d.id;
    if (!/^(bill-|pay-|cashout-)/.test(act)) return false;
    if (act === 'pay-start') ctx.open('pay-start', { orderId: d.orderId });
    else if (act === 'bill-order' || act === 'bill-record' || act === 'cashout-detail') ctx.open(act, { id });
    else if (act === 'bill-measurement' || act === 'cashout-start') ctx.open(act);
    else if (act === 'bill-chart') { S.billingUI.chart = d.value === 'lines' ? 'lines' : 'bars'; ctx.render(); }
    else if (act === 'bill-series') { const keys = seriesFor(S).map(([k]) => k); if (keys.includes(d.value)) { S.billingUI.hidden = S.billingUI.hidden.includes(d.value) ? S.billingUI.hidden.filter(k => k !== d.value) : [...S.billingUI.hidden, d.value]; ctx.render(); } }
    else if (act === 'bill-sample') { S.billingUI.sample = !S.billingUI.sample; ctx.render(); }
    else if (act === 'bill-export') download(ctx, d.value, id);
    else if (['pay-confirm', 'pay-fail', 'pay-cancel'].includes(act)) {
      const result = act === 'pay-confirm' ? 'Paid' : act === 'pay-fail' ? 'Failed' : 'Cancelled';
      if (completePayment(S, id, result)) { save(ctx); ctx.open('pay-checkout', { id }); notify(ctx, result === 'Paid' ? 'Test payment complete. Credit added once.' : 'Payment ' + result.toLowerCase() + '. No credit added.'); }
      else notify(ctx, 'This payment has already been processed');
    } else if (act === 'cashout-settle' || act === 'cashout-cancel') {
      const p = S.payouts.find(x => x.id === id);
      if (!p || p.status !== 'Pending') { notify(ctx, 'This payout is no longer pending'); return true; }
      p.status = act === 'cashout-settle' ? 'Paid' : 'Cancelled';
      p.updatedAt = new Date().toISOString(); if (p.status === 'Paid') p.paidAt = p.updatedAt; else S.earningsBalance = round(S.earningsBalance + p.amount);
      const l = S.ledger.find(x => x.payoutId === p.id); if (l) l.status = p.status;
      save(ctx); ctx.open('cashout-detail', { id }); notify(ctx, p.status === 'Paid' ? 'Test payout completed. No real funds transferred.' : 'Payout cancelled; reserved earnings restored.');
    }
    return true;
  }
  function submit(ctx, form, data) {
    const S = init(ctx.S), kind = form.dataset.form;
    if (kind === 'bill-filter') {
      const from = dateKey(data.from), to = dateKey(data.to);
      if (!from || !to || from > to || Date.parse(to) - Date.parse(from) > 365 * 86400000) { notify(ctx, 'Choose a valid range of up to 366 days'); return true; }
      S.billingUI.from = from; S.billingUI.to = to; ctx.render(); return true;
    }
    if (kind === 'pay-amount') {
      const amount = Number(data.preset === 'other' ? data.custom : data.preset);
      if (!Number.isFinite(amount) || amount < 1 || amount > 100000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) { notify(ctx, 'Enter an amount from $1.00 to $100,000.00 with up to two decimals'); return true; }
      const id = uid('PAY'); S.paymentSessions.unshift({ id, amount: round(amount), status: 'Pending', orderId: form.dataset.orderId || null, createdAt: new Date().toISOString(), role: role(S), test: true });
      ctx.persist(); ctx.open('pay-checkout', { id }); return true;
    }
    if (kind === 'cashout-request') {
      const amount = Number(data.amount), last4 = String(data.last4 || '').trim(), bank = String(data.bank || '').trim(), beneficiary = String(data.beneficiary || '').trim();
      if (role(S) === 'Buyer') { notify(ctx, 'Withdrawals are available to Seller and Broker accounts'); return true; }
      if (!Number.isFinite(amount) || amount < 1 || amount > S.earningsBalance || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) { notify(ctx, 'Enter a valid amount within your available earnings'); return true; }
      if (!/^[0-9]{4}$/.test(last4) || bank.length < 2 || !beneficiary || bank.length > 80 || beneficiary.length > 120) { notify(ctx, 'Provide a beneficiary, bank label and exactly four account digits'); return true; }
      const requestId = form.dataset.requestId || uid('PO'); form.dataset.requestId = requestId;
      if (S.payouts.some(p => p.id === requestId)) { notify(ctx, 'This payout request has already been submitted'); return true; }
      const p = { id: requestId, amount: round(amount), status: 'Pending', destination: bank + ' · •••• ' + last4, beneficiary, createdAt: new Date().toISOString(), role: role(S), test: true };
      S.earningsBalance = round(S.earningsBalance - p.amount); S.payouts.unshift(p);
      S.ledger.unshift({ id: 'WD-' + p.id, payoutId: p.id, type: 'Cashout request', amount: -p.amount, createdAt: p.createdAt, date: p.createdAt, status: 'Pending', role: p.role, wallet: 'earnings', destination: p.destination, test: true });
      save(ctx); ctx.open('cashout-detail', { id: p.id }); notify(ctx, 'Test payout requested. Funds reserved from earnings.'); return true;
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
  const api = { init, page, modal, action, submit, analytics, completePayment, csv };
  root.OpenNEXTBilling = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
