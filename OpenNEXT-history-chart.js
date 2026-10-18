(function regionalHistoryModule() {
  'use strict';
  const D = window.ONMarket, cache = new Map(), choices = new Map();
  const labels = {min: 'Lowest', avg: 'Average', max: 'Highest'};
  const number = value => typeof value === 'number' && Number.isFinite(value);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const money = value => number(value) ? '$' + value.toFixed(2) : '—';
  const metricOf = S => labels[S.priceMetric] ? S.priceMetric : 'avg';
  const dateLabel = time => new Date(time).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', timeZone: 'UTC'});
  const timeLabel = (time, daily) => new Date(time).toLocaleString('en-GB', {day: 'numeric', month: 'short', year: 'numeric', ...(daily ? {} : {hour: '2-digit', minute: '2-digit'}), timeZone: 'UTC'}) + (daily ? '' : ' UTC');
  const color = index => ['#315f49', '#678bad', '#b18843', '#9671a7', '#298986', '#b36762'][index] || `hsl(${Math.round(index * 137.508) % 360} 48% 38%)`;
  const dash = index => ['', '8 4', '2 4', '10 3 2 3'][Math.floor(index / 6) % 4];
  const selectionKey = S => [S.model, S.count, S.region, S.term].join('|');
  const valueOf = (p, S, data) => number(p[metricOf(S)]) ? p[metricOf(S)] : data.metric === metricOf(S) && number(p.value) ? p.value : null;
  function selection(S, data) {
    const key = selectionKey(S);
    if (!choices.has(key)) choices.set(key, {selected: [], initialized: false, open: false, query: '', focus: null});
    const state = choices.get(key), eligible = (data.series || []).filter(s => Number.isInteger(s.gpuCount) && s.gpuCount > 0 && s.points.some(p => number(valueOf(p, S, data))));
    state.selected = state.selected.filter(id => eligible.some(s => s.id === id));
    if (!state.initialized && eligible.length) {
      state.selected = eligible.slice(0, 3).map(s => s.id);
      state.initialized = true;
    }
    if (!state.selected.includes(state.focus)) state.focus = null;
    return {state, eligible, selected: state.selected.map(id => eligible.find(s => s.id === id)).filter(Boolean)};
  }
  function summary(S, data) {
    if (!data) return null;
    const {selected} = selection(S, data), primary = selected[0];
    if (!primary) return null;
    const points = primary.points.map(p => ({...p, value: valueOf(p, S, data)})).filter(p => number(p.value));
    if (!points.length) return null;
    return {latest: points.at(-1).value, change: points.length > 1 && points[0].value > 0 ? (points.at(-1).value / points[0].value - 1) * 100 : null,
      points: points.length, region: primary.name, last: points.at(-1).time, selected: selected.length, unit: 'gpu'};
  }
  function header(S, data) {
    const info = summary(S, data), metric = labels[metricOf(S)], term = data.term || S.term || 'Spot';
    const set = (id, value) => {const node = document.getElementById(id); if (node) node.textContent = value;};
    set('marketPrice', info ? money(info.latest) : '—');
    set('marketPriceLabel', metric.toUpperCase() + ' ' + term.toUpperCase() + ' / GPU-HR');
    set('historyPrimaryCaption', info ? info.region + ' · ' + dateLabel(info.last) : 'Select regions to compare');
    set('marketRecords', info ? info.points + ' observations' : '0');
    set('marketChange', info?.change == null ? '—' : (info.change >= 0 ? '+' : '') + info.change.toFixed(2) + '%');
    const change = document.getElementById('marketChange'); if (change) change.className = info?.change == null ? '' : info.change >= 0 ? 'positive' : 'negative';
  }
  function controls(S, data, state, eligible) {
    const regions = [...new Map([...(data.regions || []), ...eligible.map(s => ({code: s.region, name: s.name}))].map(r => [r.code, r])).values()];
    const groups = regions.map(region => {
      const rows = eligible.filter(s => s.region === region.code), name = region.city || region.name || region.code;
      return `<div class="history-region-group" data-history-search-text="${esc([name, region.code, ...rows.map(s => s.configuration)].join(' ').toLowerCase())}"><div class="history-region-name">${esc(name)} <small>${esc(region.code)}</small></div>${rows.length ? rows.map(s => `<label class="history-zone-row"><input type="checkbox" data-region-id="${esc(s.id)}" ${state.selected.includes(s.id) ? 'checked' : ''}><span>${esc(s.configuration || s.name)}</span><small>${s.points.filter(p => number(valueOf(p, S, data))).length} points</small></label>`).join('') : '<div class="history-region-empty">No recorded prices for this configuration</div>'}</div>`;
    }).join('');
    return `<div class="history-controls"><div class="periods">${['1D', '3D', '1W', '1M', '3M'].map(period => `<button class="period ${S.period === period ? 'active' : ''}" data-act="period" data-value="${period}">${period}</button>`).join('')}</div><span class="capacity-unit">${labels[metricOf(S)]} · USD / GPU-hour · ${esc(data.term || S.term || 'Spot')}</span></div><div class="history-selection"><button class="btn secondary small" data-region-toggle aria-expanded="${state.open}">Compare regions <span class="history-count">${state.selected.length} selected</span>⌄</button><span>All ${regions.length} regions available · Hover or focus a legend to isolate a curve</span>${state.open ? `<section class="history-picker" aria-label="Choose regions for price comparison"><div class="history-picker-head"><strong>Compare global prices</strong><button type="button" data-region-toggle aria-label="Close region picker">×</button></div><input type="search" data-region-search aria-label="Search regions" placeholder="Search region or configuration…" value="${esc(state.query)}"><div class="history-picker-actions"><button type="button" data-region-all>Select all</button><button type="button" data-region-clear>Clear</button><span>${state.selected.length} selected · No limit</span></div><div class="history-options">${groups}</div><div class="history-picker-empty" hidden>No matching regions.</div><div class="history-picker-notice">Different hardware configurations remain separate. Missing prices are never estimated.</div></section>` : ''}</div>`;
  }
  function markup(S, data, width) {
    const {state, eligible, selected} = selection(S, data), metric = metricOf(S);
    const head = controls(S, data, state, eligible);
    if (!selected.length) return {html: head + `<div class="aws-history-empty"><h3>${eligible.length ? 'Choose regions to compare' : 'No ' + esc(data.term || S.term || 'Spot') + ' prices for this configuration yet'}</h3><p>${eligible.length ? 'Open Compare regions to select any number of curves.' : 'Try another GPU model, region, count or market term. Unreported configurations remain empty.'}</p></div>`, info: null};
    const series = selected.map(s => ({...s, color: color(eligible.findIndex(row => row.id === s.id)), dash: dash(eligible.findIndex(row => row.id === s.id)),
      points: s.points.map(p => ({...p, value: valueOf(p, S, data), timestamp: Date.parse(p.time)})).filter(p => number(p.value) && Number.isFinite(p.timestamp))})).filter(s => s.points.length);
    const w = Math.max(340, Math.min(1400, width - 40)), h = 360, left = 18, right = 70, top = 22, bottom = 44;
    let low = Infinity, high = -Infinity, from = Infinity, to = -Infinity;
    for (const s of series) for (const p of s.points) {low = Math.min(low, p.value); high = Math.max(high, p.value); from = Math.min(from, p.timestamp); to = Math.max(to, p.timestamp);}
    const pad = Math.max((high - low) * .13, high * .03, .02), min = Math.max(0, low - pad), max = high + pad;
    const px = time => from === to ? (left + w - right) / 2 : left + (time - from) / (to - from) * (w - left - right);
    const py = value => top + (max - value) / (max - min) * (h - top - bottom);
    const gap = (data.meta?.bucketMinutes || 1440) * 60000 * 1.5;
    const grid = Array.from({length: 4}, (_, i) => {const value = min + (max - min) * i / 3, y = py(value); return `<line x1="${left}" x2="${w - right}" y1="${y}" y2="${y}" stroke="#e3ebe5" stroke-dasharray="4 7"/><text x="${w - right + 10}" y="${y + 4}" class="history-axis">${money(value)}</text>`;}).join('');
    const paths = series.map(s => {
      s.points = s.points.map(p => ({...p, x: px(p.timestamp), y: py(p.value)}));
      const d = s.points.map((p, i) => (i && p.timestamp - s.points[i - 1].timestamp <= gap ? 'L' : 'M') + p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(' ');
      const dots = s.points.filter((p, i) => s.points.length === 1 || (!i || p.timestamp - s.points[i - 1].timestamp > gap) && (i === s.points.length - 1 || s.points[i + 1].timestamp - p.timestamp > gap));
      return `<g data-region-line="${esc(s.id)}"><path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-dasharray="${s.dash}" stroke-linejoin="round" stroke-linecap="round"/>${dots.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${s.color}"/>`).join('')}</g>`;
    }).join('');
    const observedTimes=[...new Set(series.flatMap(s=>s.points.map(p=>p.timestamp)))].sort((a,b)=>a-b);
    const tickTimes = data.meta?.bucketMinutes>=1440&&observedTimes.length<=6 ? observedTimes : from === to ? [from] : Array.from({length: w < 600 ? 3 : 5}, (_, i) => from + (to - from) * i / ((w < 600 ? 3 : 5) - 1));
    const axis = tickTimes.map((time, i) => `<text class="history-axis" x="${px(time)}" y="${h - 12}" text-anchor="${i === 0 ? 'start' : i === tickTimes.length - 1 ? 'end' : 'middle'}">${esc(dateLabel(time))}</text>`).join('');
    const legend = series.map(s => `<button type="button" class="history-legend-chip" data-region-focus="${esc(s.id)}" aria-pressed="${state.focus === s.id}" title="Focus ${esc(s.name)} · ${esc(s.configuration)}"><i style="--series-color:${s.color};${s.dash ? 'border-top-style:dashed' : ''}"></i><span>${esc(s.name)}<small>${esc(s.configuration)}</small></span></button>`).join('');
    const table = series.map(s => {const first = s.points[0], last = s.points.at(-1), change = s.points.length > 1 && first.value > 0 ? (last.value / first.value - 1) * 100 : null;
      return `<tr><td><i style="background:${s.color}"></i><strong>${esc(s.name)}</strong><small>${esc(s.configuration)}</small></td><td>${money(last.value)}<small>${esc(dateLabel(last.time))}</small></td><td>${change === null ? '—' : (change >= 0 ? '+' : '') + change.toFixed(2) + '%'}</td><td>${money(Math.min(...s.points.map(p => p.value)))} – ${money(Math.max(...s.points.map(p => p.value)))}</td><td>${s.points.length}</td></tr>`;}).join('');
    const snapshot = data.meta?.snapshotAsOf ? `Snapshot through ${dateLabel(data.meta.snapshotAsOf + 'T00:00:00Z')}` : data.meta?.lastSync ? `Updated ${timeLabel(data.meta.lastSync, false)}` : 'Recorded observations';
    return {html: head + `<div class="history-legend" aria-label="Price curve legend">${legend}</div><div class="history-range"><span>${dateLabel(from)} – ${dateLabel(to)}</span><span>${series.length} curves · ${labels[metric]} price</span></div><div class="history-plot regional-price-plot"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(S.model)} regional ${labels[metric].toLowerCase()} prices">${grid}${paths}${axis}<g class="history-hover" visibility="hidden"><line y1="${top}" y2="${h - bottom}" stroke="#8aa48f" stroke-dasharray="3 5"/><circle r="4" fill="white" stroke-width="2"/></g></svg><div class="history-tooltip" hidden></div></div><div class="history-footnote"><span>Actual ${labels[metric].toLowerCase()} observations · Missing dates remain gaps</span><span>${esc(snapshot)}</span></div><details class="regional-method"><summary>Price methodology</summary><p>${esc(data.meta?.aggregation || 'Recorded prices for comparable configurations.')} ${esc(data.meta?.missingDataPolicy || '')} All prices use USD / GPU-hour; quotes confirm capacity.</p></details><details class="history-comparison regional-table"><summary>View ${series.length} regional price series</summary><div class="table-scroll"><table><thead><tr><th>REGION / CONFIGURATION</th><th>LAST ${labels[metric].toUpperCase()}</th><th>PERIOD CHANGE</th><th>RECORDED RANGE</th><th>OBSERVATIONS</th></tr></thead><tbody>${table}</tbody></table></div></details>`, info: {series, w, h, daily: data.meta?.bucketMinutes >= 1440, metric}};
  }
  function mount(target, S, data) {
    let info;
    function filter() {
      const {state} = selection(S, data), query = state.query.trim().toLowerCase(); let count = 0;
      target.querySelectorAll('[data-history-search-text]').forEach(el => {el.hidden = !el.dataset.historySearchText.includes(query); if (!el.hidden) count++;});
      const empty = target.querySelector('.history-picker-empty'); if (empty) empty.hidden = count > 0;
    }
    function focus(id) {
      const {state} = selection(S, data), active = id || state.focus;
      target.querySelectorAll('[data-region-line]').forEach(el => {el.style.opacity = active ? (el.dataset.regionLine === active ? '1' : '.14') : info?.series.length > 8 ? '.6' : '1'; el.querySelector('path')?.setAttribute('stroke-width', active === el.dataset.regionLine ? '3' : '2');});
      target.querySelectorAll('[data-region-focus]').forEach(el => {el.classList.toggle('primary', el.dataset.regionFocus === active); el.setAttribute('aria-pressed', String(el.dataset.regionFocus === state.focus));});
    }
    function repaint() {
      if (!target.isConnected) return;
      const scroll = target.querySelector('.history-options')?.scrollTop || 0;
      const result = markup(S, data, target.clientWidth || 900); target.innerHTML = result.html; info = result.info;
      window.__onHistoryChartInfo = info;
      const options = target.querySelector('.history-options'); if (options) options.scrollTop = scroll;
      filter(); header(S, data); focus(null);
    }
    target.onclick = event => {
      const {state, eligible} = selection(S, data);
      if (event.target.closest('[data-region-toggle]')) {state.open = !state.open; repaint(); if (state.open) target.querySelector('[data-region-search]')?.focus();}
      if (event.target.closest('[data-region-all]')) {state.selected = eligible.map(s => s.id); state.initialized = true; repaint();}
      if (event.target.closest('[data-region-clear]')) {state.selected = []; state.initialized = true; repaint();}
      const chip = event.target.closest('[data-region-focus]'); if (chip) {state.focus = state.focus === chip.dataset.regionFocus ? null : chip.dataset.regionFocus; focus(null);}
    };
    target.onchange = event => {
      if (!event.target.matches('[data-region-id]')) return;
      const {state} = selection(S, data), id = event.target.dataset.regionId;
      state.selected = event.target.checked ? [...new Set([...state.selected, id])] : state.selected.filter(value => value !== id);
      state.initialized = true; repaint();
    };
    target.oninput = event => {if (event.target.matches('[data-region-search]')) {selection(S, data).state.query = event.target.value; filter();}};
    target.onkeydown = event => {if (event.key === 'Escape') {selection(S, data).state.open = false; repaint(); target.querySelector('[data-region-toggle]')?.focus(); event.stopPropagation();}};
    if (target.__regionalFocus) {
      target.removeEventListener('focusin', target.__regionalFocus.in);
      target.removeEventListener('focusout', target.__regionalFocus.out);
    }
    target.__regionalFocus = {
      in: event => {const chip = event.target.closest('[data-region-focus]'); if (chip) focus(chip.dataset.regionFocus);},
      out: () => focus(null),
    };
    target.addEventListener('focusin', target.__regionalFocus.in);
    target.addEventListener('focusout', target.__regionalFocus.out);
    target.onpointermove = event => {
      const svg = event.target.closest('.regional-price-plot svg');
      if (!svg) {const tip = target.querySelector('.history-tooltip'); if (tip) tip.hidden = true; target.querySelector('.history-hover')?.setAttribute('visibility', 'hidden');}
      const chip = event.target.closest('[data-region-focus]'); if (chip) {focus(chip.dataset.regionFocus); return;}
      if (!svg || !info) {focus(null); return;}
      const rect = svg.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width * info.w, y = (event.clientY - rect.top) / rect.height * info.h;
      let selected, point, distance = Infinity;
      for (const series of info.series) for (const candidate of series.points) {
        const d = Math.abs(candidate.x - x) * 2 + Math.abs(candidate.y - y);
        if (d < distance) {distance = d; selected = series; point = candidate;}
      }
      if (!point) return;
      window.dispatchEvent(new CustomEvent('opennext:pricehover',{detail:{model:S.model,region:selected.region,price:point.value,min:point.min,max:point.max}}));
      const hover = svg.querySelector('.history-hover'), line = hover.querySelector('line'), circle = hover.querySelector('circle'); hover.setAttribute('visibility', 'visible');
      line.setAttribute('x1', point.x); line.setAttribute('x2', point.x); circle.setAttribute('cx', point.x); circle.setAttribute('cy', point.y); circle.setAttribute('stroke', selected.color);
      const tip = target.querySelector('.history-tooltip');
      tip.innerHTML = `<strong>${money(point.value)} <small>/ GPU-hour</small></strong><span>${esc(selected.name)} · ${labels[info.metric]}</span><span>${esc(selected.configuration)}</span><div>Low ${money(point.min)} · Average ${money(point.avg)} · High ${money(point.max)}</div><time>${esc(timeLabel(point.time, info.daily))}</time>`;
      tip.hidden = false; tip.style.left = Math.max(4, Math.min(rect.width - 250, point.x / info.w * rect.width + 10)) + 'px'; tip.style.top = '12px'; focus(selected.id);
    };
    target.onpointerleave = () => {const tip = target.querySelector('.history-tooltip'); if (tip) tip.hidden = true; target.querySelector('.history-hover')?.setAttribute('visibility', 'hidden'); focus(null);};
    repaint();
    return {summary: () => summary(S, data), repaint};
  }
  function queryFor(S) {
    const query = new URLSearchParams({gpuModel: D.modelOf(S.model).canonical, gpuCount: String(S.count), region: S.region === 'All regions' ? 'all' : D.regionCode(S.region), term: S.term || 'Spot', period: ['1D', '3D'].includes(S.period) ? S.period : '3D', metric: metricOf(S)});
    if (/PCIe|SXM|NVL72/i.test(S.model)) query.set('formFactor', /PCIe|SXM|NVL72/i.exec(S.model)[0]);
    if (['A100 80GB', 'A100 PCIe'].includes(S.model)) query.set('gpuMemoryGb', '80');
    return query.toString();
  }
  function render() {return '<section id="importedHistory" class="imported-history"><div class="aws-history-empty"><h3>Loading regional prices…</h3></div></section>';}
  async function bind(S) {
    const target = document.getElementById('importedHistory'); if (!target) return;
    const query = queryFor(S);
    try {const response = await fetch('/api/pricing/regional-history?' + query, {signal: AbortSignal.timeout(15000)}); if (!response.ok) throw Error('History unavailable'); const data = await response.json(); cache.set(query, data); if (target.isConnected) mount(target, {...S}, data);}
    catch {if (target.isConnected) target.innerHTML = '<div class="aws-history-empty"><h3>Regional history is temporarily unavailable</h3><p>Please try again shortly.</p></div>';}
  }
  window.OpenNEXTRegionalHistory = {mount, markup, summary, queryFor};
  function priceRange(S) {
    const data = cache.get(queryFor(S));
    if (!data) return null;
    const values = data.series.flatMap(series => series.points.flatMap(point => [point.min, point.avg, point.max, point.value])).filter(number);
    return values.length ? values.reduce((range, value) => ({min: Math.min(range.min, value), max: Math.max(range.max, value), model: range.model}),
      {min: Infinity, max: -Infinity, model: D.modelOf(S.model).canonical}) : null;
  }
  window.OpenNEXTHistory = {render, bind, priceRange, summary: S => summary(S, cache.get(queryFor(S)))};
})();
