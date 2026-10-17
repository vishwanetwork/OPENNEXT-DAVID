(() => {
  'use strict';
  const D = window.ONMarket;
  const terms = [
    {name: 'Spot', color: '#315f49', dash: '', note: 'Interruptible'},
    {name: 'On-demand', color: '#6389ae', dash: '8 5', note: 'No commitment'},
    {name: 'Reserved', color: '#ac8748', dash: '2 5', note: '1 year · No upfront'},
  ];
  // With several regions, colour identifies the region and the dash pattern identifies the price type.
  // Ordered for contrast: the first regions shown get the most distinct colours.
  const palette = ['#2f6fa3', '#d9822b', '#2e8b57', '#c0392b', '#7b5ea7', '#17a2b8', '#b5487f', '#8a7a2e', '#5d6d7e',
    '#1b4f72', '#a04000', '#145a32', '#922b21', '#4a235a', '#0e6655', '#7d6608', '#6e2c00', '#283747'];
  const cache = new Map(), hiddenTerms = new Set(), hiddenAreas = new Set();
  let timer = null, active = null, generation = 0;
  const number = value => typeof value === 'number' && Number.isFinite(value);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const money = value => number(value) ? '$' + value.toFixed(4) : '—';
  const timeLabel = value => value ? new Date(value).toLocaleString('en-GB', {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'}) + ' UTC' : 'Not observed';
  const areaLabel = area => area ? D.regionLabel(area) : 'Other locations';
  let areaOrder = [];
  const areaColor = area => {const index = areaOrder.indexOf(String(area)); return index < 0 ? '#7d8a80' : palette[index % palette.length];};
  const selectedRegions = S => (S.regions || (S.region && S.region !== 'All regions' ? [S.region] : [])).map(name => D.regionCode(name));
  function queryFor(S) {
    const regions = selectedRegions(S);
    const query = new URLSearchParams({gpuModel: D.modelOf(S.model).canonical, gpuCount: String(S.count), region: regions.length ? regions.join(',') : 'all', period: S.period || '1M'});
    if (/PCIe|SXM|NVL72/i.test(S.model)) query.set('formFactor', /PCIe|SXM|NVL72/i.exec(S.model)[0]);
    if (['A100 80GB', 'A100 PCIe'].includes(S.model)) query.set('gpuMemoryGb', '80');
    return query.toString();
  }
  const bucketLabel = minutes => !minutes ? '5-minute' : minutes < 60 ? minutes + '-minute' : minutes < 1440 ? minutes / 60 + '-hour' : 'Daily';
  function referenceText(S, data) {
    const meta = data.meta || {}, series = data.series || [];
    if (series.length > 1) return `Each of ${series.length} regions uses its own reference offering, chosen from ${meta.matchingOfferings} matching offerings: live Spot first, then most complete, then lowest On-demand. Within a region, Spot, On-demand and Reserved come from that one offering (same GPU configuration and supplier). Cards show the lowest price of each type across these regions.`;
    const ref = meta.reference;
    if (!ref) return 'No single offering matches this configuration yet.';
    const parts = [ref.gpuCount + ' × ' + S.model, number(ref.gpuMemoryGb) ? ref.gpuMemoryGb + ' GB' : null, ref.formFactor, areaLabel(ref.area)].filter(Boolean);
    return `Reference offering: ${parts.join(' · ')} (chosen from ${meta.matchingOfferings} matching ${meta.matchingOfferings === 1 ? 'offering' : 'offerings'}: live Spot first, then most complete, then lowest On-demand). Spot, On-demand and Reserved all come from this one offering (same GPU configuration, supplier and region).`;
  }
  function summary(S) {return cache.get(queryFor(S)) || null;}
  function header(S, data) {
    const selected = data.latest?.[S.term] || data.latest?.Spot;
    const label = document.getElementById('marketPriceLabel');
    if (label) label.textContent = (terms.some(t => t.name === S.term) ? S.term.toUpperCase() : 'SPOT') + ' / GPU-HR';
    const price = document.getElementById('marketPrice'); if (price) price.textContent = money(selected?.value);
    const caption = document.getElementById('historyPrimaryCaption'); if (caption) caption.textContent = 'Same-offering reference';
    const count = document.getElementById('marketRecords'); if (count) count.textContent = String((data.points || []).filter(point => number(point.values[S.term]?.value)).length);
    const change = document.getElementById('marketChange');
    if (change) {
      const values = (data.points || []).map(point => point.values[S.term]?.value).filter(number);
      const delta = values.length > 1 && values[0] > 0 ? (values.at(-1) / values[0] - 1) * 100 : null;
      change.textContent = delta === null ? '—' : (delta >= 0 ? '+' : '') + delta.toFixed(2) + '%';
      change.className = delta === null ? '' : delta >= 0 ? 'positive' : 'negative';
    }
  }
  // Visible lines: one per region and price type, unless toggled off by a card or region chip.
  function lines(data) {
    const series = data.series || [], multi = series.length > 1;
    return series.filter(item => !multi || !hiddenAreas.has(String(item.area))).flatMap(item => terms.filter(term => !hiddenTerms.has(term.name))
      .map(term => ({item, term, color: multi ? areaColor(item.area) : term.color, values: item.values[term.name] || []})));
  }
  function markup(S, data) {
    const times = (data.times || []).map(time => Date.parse(time)), series = data.series || [], multi = series.length > 1;
    areaOrder = series.map(item => String(item.area));
    const visible = lines(data), values = visible.flatMap(line => line.values).filter(number);
    const cards = terms.map(term => {
      const entry = data.latest?.[term.name], off = hiddenTerms.has(term.name);
      const where = number(entry?.value) ? (multi ? 'Lowest · ' + esc(areaLabel(entry.area)) + ' · ' : '') + timeLabel(entry.observedAt) : 'No matching quote';
      return `<button class="capacity-rate ${off ? 'muted' : ''}" data-capacity-term="${term.name}" aria-pressed="${!off}" style="--rate-color:${term.color}"><span><i style="border-top-style:${term.name === 'Spot' ? 'solid' : term.name === 'Reserved' ? 'dotted' : 'dashed'}"></i>${term.name}</span><strong>${money(entry?.value)}</strong><small>${term.note}</small><small>${where}</small></button>`;
    }).join('');
    const chips = multi ? `<div class="capacity-regions" aria-label="Regions">${series.map(item => {const off = hiddenAreas.has(String(item.area)); return `<button class="capacity-region ${off ? 'muted' : ''}" data-capacity-area="${esc(String(item.area))}" aria-pressed="${!off}"><i style="background:${areaColor(item.area)}"></i>${esc(areaLabel(item.area))}</button>`;}).join('')}</div>` : '';
    const controls = `<div class="capacity-heading"><div><span class="eyebrow">GPU PRICE COMPARISON</span><h3>Three ways to rent compute</h3></div><span class="capacity-live ${data.meta?.sourceIssue ? 'partial' : ''}"><i></i>${data.meta?.syncing ? 'Updating' : data.meta?.sourceIssue ? 'Partial coverage' : 'Auto refresh · 30s'}</span></div><div class="capacity-rates" aria-label="Price type legend">${cards}</div>${chips}<div class="history-controls"><div class="periods">${['1D','1W','1M','3M'].map(period => `<button class="period ${S.period === period ? 'active' : ''}" data-act="period" data-value="${period}">${period}</button>`).join('')}</div><span class="capacity-unit">USD / GPU-hour · ${multi ? series.length + ' regions, one offering each' : 'One offering, three prices'}</span></div>`;
    if (!values.length) return controls + `<div class="aws-history-empty"><h3>${data.meta?.syncing ? 'Collecting price observations…' : 'No prices for this configuration yet'}</h3><p>Missing prices remain empty. Try another model, region or GPU count.</p><button class="btn secondary small" data-capacity-example>View A10G · 8 GPUs</button></div>`;
    const w = Math.max(360, Math.min(1000, (document.getElementById('capacityHistory')?.clientWidth || 900) - 40));
    const h = multi ? 360 : 320, left = 28, right = 92, top = 24, bottom = 43;
    const low = Math.min(...values), high = Math.max(...values), pad = Math.max((high - low) * .16, high * .05, .03);
    const min = Math.max(0, low - pad), max = high + pad;
    const from = times[0], to = times.at(-1);
    const x = value => from === to ? (left + w - right) / 2 : left + (value - from) / (to - from) * (w - left - right);
    const y = value => top + (max - value) / (max - min) * (h - top - bottom);
    const grid = Array.from({length: 4}, (_, index) => {const value = min + (max - min) * index / 3, py = y(value);return `<line x1="${left}" x2="${w - right}" y1="${py}" y2="${py}" stroke="#e3ebe5" stroke-dasharray="4 7"/><text x="${w - right + 14}" y="${py + 4}" class="history-axis">$${value.toFixed(2)}</text>`;}).join('');
    // Points arrive as consecutive buckets; an empty bucket breaks the line instead of joining it.
    const paths = visible.map(({item, term, color, values: series}) => {
      const runs = [];
      series.forEach((value, index) => {
        if (!number(value)) {if (runs.at(-1)) runs.at(-1).done = true; return;}
        if (!runs.length || runs.at(-1).done) runs.push(Object.assign([], {done: false}));
        runs.at(-1).push({time: times[index], value});
      });
      const d = runs.map(run => run.map((p, i) => (i ? 'L' : 'M') + x(p.time).toFixed(2) + ',' + y(p.value).toFixed(2)).join(' ')).join(' ');
      const dots = runs.flatMap(run => run.length === 1 ? run : [run[0], run.at(-1)]), last = runs.at(-1)?.at(-1);
      const label = !multi && last ? `<text x="${x(last.time) < left + 90 ? x(last.time) + 5 : x(last.time) - 5}" y="${y(last.value) - 10}" text-anchor="${x(last.time) < left + 90 ? 'start' : 'end'}" fill="${color}" class="history-end-name">${term.name}</text>` : '';
      return `<path data-capacity-line="${term.name}" data-capacity-area="${esc(String(item.area))}" d="${d}" fill="none" stroke="${color}" stroke-width="${multi ? 1.8 : 2.5}" stroke-dasharray="${term.dash}" stroke-linejoin="round"/>${dots.map(p => `<circle cx="${x(p.time)}" cy="${y(p.value)}" r="${multi ? 2.2 : 3}" fill="${color}"/>`).join('')}${label}`;
    }).join('');
    const tickCount = w < 600 ? 3 : 4;
    const ticks = from === to ? [from] : Array.from({length: tickCount}, (_, i) => from + (to - from) * i / (tickCount - 1));
    const axis = ticks.map((time, i) => `<text class="history-axis" x="${x(time)}" y="${h - 12}" text-anchor="${ticks.length === 1 ? 'middle' : i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}">${esc(new Date(time).toLocaleString('en-GB', {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'}))}</text>`).join('');
    const head = `<th>${multi ? 'REGION' : 'TIME · UTC'}</th><th>SPOT</th><th>ON-DEMAND</th><th>RESERVED · 1 YEAR</th>`;
    const rows = multi ? series.map(item => `<tr><td>${esc(areaLabel(item.area))}</td>${terms.map(term => `<td>${money(item.latest[term.name]?.value)}</td>`).join('')}</tr>`).join('') :
      times.map((time, index) => ({time, index})).filter(({index}) => terms.some(term => number(series[0].values[term.name][index]))).slice(-12).reverse()
        .map(({time, index}) => `<tr><td>${timeLabel(time)}</td>${terms.map(term => `<td>${money(series[0].values[term.name][index])}</td>`).join('')}</tr>`).join('');
    return controls + `<div class="history-plot capacity-plot"><svg data-plot-width="${w}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(S.model)} Spot, On-demand and Reserved prices${multi ? ' by region' : ''}">${grid}${paths}${axis}<line class="capacity-crosshair" y1="${top}" y2="${h - bottom}" stroke="#90a493" stroke-dasharray="3 4" visibility="hidden"/><rect class="capacity-hit" x="${left}" y="${top}" width="${w - left - right}" height="${h - top - bottom}" fill="transparent" tabindex="0" role="slider" aria-label="Price observation time" aria-valuemin="0" aria-valuemax="${times.length - 1}" aria-valuenow="${times.length - 1}"/></svg><div class="history-tooltip capacity-tooltip ${multi ? 'wide' : ''}" hidden></div></div><div class="capacity-footnote"><span>${bucketLabel(data.meta?.bucketMinutes)} buckets · UTC · No inferred inventory</span><span>Updated ${timeLabel(data.meta?.lastSync)}</span></div><div class="capacity-method">${esc(referenceText(S, data))} Reserved: 12 months, no upfront. Quotes do not confirm capacity.${times.length < 4 ? ' History is building from real observations.' : ''}</div><details class="capacity-data"><summary>${multi ? 'View latest prices by region' : 'View recorded prices'}</summary><div class="table-scroll"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div></details>`;
  }
  function render() {return '<section id="capacityHistory" class="capacity-history"><div class="aws-history-empty"><h3>Loading Spot, On-demand and Reserved prices…</h3></div></section>';}
  function bind(S) {
    if (timer) clearTimeout(timer);
    const target = document.getElementById('capacityHistory'); if (!target) {generation++; active = null; return;}
    const snapshot = {model: S.model, region: S.region, regions: [...(S.regions || [])], count: S.count, period: S.period, term: S.term};
    const key = queryFor(snapshot), token = ++generation;
    active = {snapshot}; let data = cache.get(key);
    function bindPlot() {
      const svg = target.querySelector('svg'), hit = target.querySelector('.capacity-hit'), tip = target.querySelector('.capacity-tooltip');
      if (!svg || !hit || !data?.times?.length) return;
      const times = data.times.map(time => Date.parse(time)), from = times[0], to = times.at(-1), multi = data.series.length > 1;
      const plotWidth = Number(svg.dataset.plotWidth), innerWidth = plotWidth - 120;
      let selected = times.length - 1;
      function show(index) {
        selected = Math.max(0, Math.min(times.length - 1, index)); const time = times[selected];
        const px = from === to ? (plotWidth - 64) / 2 : 28 + (time - from) / (to - from) * innerWidth;
        const cross = svg.querySelector('.capacity-crosshair'); cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
        const shownTerms = terms.filter(term => !hiddenTerms.has(term.name));
        const rows = multi ? `<table class="capacity-tip-table"><tr><th></th>${shownTerms.map(term => `<th>${term.name}</th>`).join('')}</tr>${data.series.filter(item => !hiddenAreas.has(String(item.area))).map(item => `<tr><td><i style="background:${areaColor(item.area)}"></i>${esc(areaLabel(item.area))}</td>${shownTerms.map(term => `<td>${money(item.values[term.name][selected])}</td>`).join('')}</tr>`).join('')}</table>` :
          shownTerms.map(term => `<div class="capacity-tip-row"><span>${term.name}</span><b>${money(data.series[0].values[term.name][selected])}</b></div>`).join('');
        tip.innerHTML = `<strong>${timeLabel(time)}</strong>${rows}<small>USD / GPU-hour · — means not observed</small>`;
        tip.hidden = false; const width = svg.getBoundingClientRect().width;
        const tipWidth = tip.offsetWidth || 250;
        tip.style.left = Math.max(4, Math.min(width - tipWidth - 4, px / plotWidth * width + 12)) + 'px'; tip.style.top = '12px';
        hit.setAttribute('aria-valuenow', String(selected));
        hit.setAttribute('aria-valuetext', timeLabel(time) + '; ' + shownTerms.map(term => term.name + ' ' + money(data.points[selected]?.values[term.name]?.value)).join('; '));
      }
      hit.addEventListener('pointermove', event => {
        const rect = svg.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width * plotWidth;
        const time = from + Math.max(0, Math.min(1, (x - 28) / innerWidth)) * (to - from);
        let best = 0; for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - time) < Math.abs(times[best] - time)) best = i;
        show(best);
      });
      const leave = () => {tip.hidden = true; svg.querySelector('.capacity-crosshair').setAttribute('visibility', 'hidden');};
      hit.addEventListener('pointerleave', leave); hit.addEventListener('blur', leave); hit.addEventListener('focus', () => show(selected));
      hit.addEventListener('keydown', event => {if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {event.preventDefault(); show(event.key === 'Home' ? 0 : event.key === 'End' ? times.length - 1 : selected + (event.key === 'ArrowRight' ? 1 : -1));}});
    }
    function repaint(value) {
      data = value; if (!target.isConnected || generation !== token || target.contains(document.activeElement)) return;
      const open = target.querySelector('details')?.open;
      target.innerHTML = markup(snapshot, value); if (open) target.querySelector('details')?.setAttribute('open', '');
      header(snapshot, value); bindPlot();
    }
    target.onclick = event => {
      const term = event.target.closest('[data-capacity-term]'), area = event.target.closest('button[data-capacity-area]');
      // Cards and region chips toggle lines; at least one price type and one region stay visible.
      if (term && data) {const name = term.dataset.capacityTerm; if (hiddenTerms.has(name)) hiddenTerms.delete(name); else if (hiddenTerms.size < terms.length - 1) hiddenTerms.add(name); term.blur(); repaint(data);}
      if (area && data) {const name = area.dataset.capacityArea; if (hiddenAreas.has(name)) hiddenAreas.delete(name); else if (data.series.filter(item => !hiddenAreas.has(String(item.area))).length > 1) hiddenAreas.add(name); area.blur(); repaint(data);}
      if (event.target.closest('[data-capacity-example]')) {Object.assign(window.ONPreview.state, {model: 'A10G', count: 8, region: 'All regions', regions: []}); window.ONPreview.navigate('market');}
    };
    async function refresh() {
      if (generation !== token || !target.isConnected) return;
      if (!document.hidden) {
        try {
          const response = await fetch('/api/pricing/capacity-history?' + key, {signal: AbortSignal.timeout(15000), cache: 'no-store'});
          if (!response.ok) throw Error('Price history unavailable');
          const value = await response.json(); cache.set(key, value); repaint(value);
        } catch {if (!data && target.isConnected) target.innerHTML = '<div class="aws-history-empty"><h3>Price service is temporarily unavailable</h3><p>The chart will retry automatically. Existing observations are retained.</p></div>';}
      }
      if (generation === token && target.isConnected) timer = setTimeout(refresh, data?.meta?.syncing ? 5000 : 30000);
    }
    if (data) repaint(data); refresh();
  }
  window.OpenNEXTHistory = {render, bind, summary, refresh: () => {if (active) bind(active.snapshot);}};
})();
