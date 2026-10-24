(function (scope) {
  'use strict';

  const DAY_MS = 86400000;
  const ACTIVITY_LIMIT = 100;
  const ACTIVITY_SHOW_OPTIONS = Object.freeze([20, 50, ACTIVITY_LIMIT]);
  const TERMS = ['All', 'Spot', 'On-demand', 'Reserved'];
  const PANELS = ['index', 'analytics', 'activities'];
  const RANGES = [
    {key: '24H', label: '24H', days: 1, gated: false},
    {key: '3D', label: '3D', days: 3, gated: false},
    {key: '7D', label: '7D', days: 7, gated: false},
    {key: '1M', label: '1M', days: 30, gated: false},
    {key: '3M', label: '3M', days: 90, gated: true},
    {key: '6M', label: '6M', days: 180, gated: true},
    {key: '1Y', label: '1Y', days: 365, gated: true},
    {key: 'ALL', label: 'ALL', days: null, gated: true},
  ];
  const GROUPING_STEPS = [100, 10, 1];
  const GROUPS = [
    {key: 'model', label: 'Model', searchable: true},
    {key: 'country', label: 'Country', searchable: true},
    {key: 'vcpu', label: 'vCPU', numeric: true},
    {key: 'memory', label: 'Memory', numeric: true, suffix: ' GB'},
  ];
  const DEMO_PROFILES = [
    {model: 'H100 SXM', memory: 80, vcpu: 192, baseCents: 180},
    {model: 'H200 SXM', memory: 141, vcpu: 192, baseCents: 244},
    {model: 'B200', memory: 180, vcpu: 192, baseCents: 306},
    {model: 'A100 SXM', memory: 80, vcpu: 96, baseCents: 112},
    {model: 'L40S', memory: 48, vcpu: 64, baseCents: 78},
  ];
  const DEMO_COUNTRIES = ['Singapore', 'United States', 'Germany', 'Japan', 'United Kingdom', 'Canada', 'Sweden', 'Australia'];
  const DEMO_COUNTS = [1, 2, 4, 8, 8, 16, 32];
  const DEMO_TERMS = ['Spot', 'Spot', 'Spot', 'On-demand', 'Spot', 'Reserved', 'On-demand'];
  const TERM_BPS = {'Spot': 10000, 'On-demand': 11800, 'Reserved': 8600};
  const PRICE_WAVE_BPS = [-650, -420, -250, -100, 0, 120, 260, 410, 580, 330, 170, -180];

  const state = {
    term: 'All',
    showFilters: typeof scope.innerWidth !== 'number' || scope.innerWidth > 650,
    selected: {model: [], country: [], vcpu: [], memory: []},
    search: {model: '', country: ''},
    openGroups: ['model'],
    groupingStepCents: 10,
    activityShow: ACTIVITY_SHOW_OPTIONS[0],
    range: '7D',
    panels: PANELS.slice(),
    modal: null,
    requestedRange: null,
  };

  let injectedRows = null;
  let lastContext = null;

  function positive(value) { return Number.isFinite(Number(value)) && Number(value) > 0; }
  function selectorEscape(value) {
    if (scope.CSS?.escape) return scope.CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, character => '\\' + character.codePointAt(0).toString(16) + ' ');
  }
  function icon(name) { return '<i data-lucide="' + name + '" aria-hidden="true"></i>'; }
  function canonicalTerm(value) {
    const term = String(value || '').trim().toLowerCase();
    if (term === 'spot') return 'Spot';
    if (term === 'on-demand' || term === 'on demand' || term === 'ondemand') return 'On-demand';
    if (term === 'reserved' || term === 'reservation') return 'Reserved';
    return null;
  }
  function isReferenceRow(row) {
    return row?.external === true || row?.referenceOnly === true || row?.observationOnly === true ||
      /(?:price|pricing)[_-]?observation/i.test(String(row?.sourceType || row?.provenance || ''));
  }
  function normalizeSettlement(row, index, sourceKind = 'injected') {
    if (!row || typeof row !== 'object' || isReferenceRow(row)) return null;
    if (row.status && !['completed', 'settled'].includes(String(row.status).trim().toLowerCase())) return null;
    const id = String(row.orderId || row.id || '').trim();
    const model = String(row.model || '').trim();
    const country = String(row.country || row.region || '').trim();
    const term = canonicalTerm(row.term);
    const rawPrice = Number(row.perGpuHourly ?? row.unitPrice ?? row.price ?? row.rate);
    const rawCount = Number(row.gpuCount ?? row.count);
    const settledAtTime = Date.parse(row.settledAt || row.completedAt || '');
    if (!id || !model || !country || !term || !Number.isFinite(rawPrice) || !(rawPrice > 0) ||
      !Number.isFinite(rawCount) || !Number.isSafeInteger(rawCount) || !(rawCount > 0) || !Number.isFinite(settledAtTime)) return null;
    const priceCents = Math.round(rawPrice * 100);
    if (!Number.isSafeInteger(priceCents) || priceCents < 1) return null;
    const vcpuRaw = row.vcpu ?? row.vCPU ?? row.cpu?.vcpu;
    const memoryRaw = row.memory ?? row.gpuMemory ?? row.gpuMemoryGb;
    return {
      _key: id + ':' + index,
      id,
      model,
      country,
      term,
      gpuCount: Math.max(1, Math.round(rawCount)),
      vcpu: positive(vcpuRaw) ? Math.round(Number(vcpuRaw)) : null,
      memory: positive(memoryRaw) ? Number(memoryRaw) : null,
      priceCents,
      perGpuHourly: priceCents / 100,
      settledAt: new Date(settledAtTime).toISOString(),
      settledAtTime,
      sourceKind,
    };
  }

  function demoPriceCents(profile, term, index) {
    const wave = 10000 + PRICE_WAVE_BPS[index % PRICE_WAVE_BPS.length];
    return Math.max(1, Math.round(profile.baseCents * TERM_BPS[term] * wave / 100000000));
  }
  function buildDemoSettlements(now = Date.now()) {
    const rows = [];
    for (let index = 0; index < 168; index += 1) {
      const profile = DEMO_PROFILES[(index * 3 + Math.floor(index / 11)) % DEMO_PROFILES.length];
      const term = DEMO_TERMS[(index * 5 + Math.floor(index / 9)) % DEMO_TERMS.length];
      const hoursAgo = 0.25 + index * 0.97;
      rows.push(normalizeSettlement({
        id: 'ORDER-DEMO-7D-' + String(index + 1).padStart(4, '0'),
        model: profile.model,
        country: DEMO_COUNTRIES[(index * 5 + Math.floor(index / 13)) % DEMO_COUNTRIES.length],
        vcpu: profile.vcpu,
        memory: profile.memory,
        gpuCount: DEMO_COUNTS[(index * 3 + Math.floor(index / 8)) % DEMO_COUNTS.length],
        perGpuHourly: demoPriceCents(profile, term, index) / 100,
        term,
        status: 'Completed',
        settledAt: new Date(now - hoursAgo * 3600000).toISOString(),
      }, index, 'demo'));
    }
    for (let index = 0; index < 24; index += 1) {
      const profile = DEMO_PROFILES[(index * 2 + 1) % DEMO_PROFILES.length];
      const term = DEMO_TERMS[(index + 2) % DEMO_TERMS.length];
      rows.push(normalizeSettlement({
        id: 'ORDER-DEMO-OLDER-' + String(index + 1).padStart(4, '0'),
        model: profile.model,
        country: DEMO_COUNTRIES[(index * 3 + 2) % DEMO_COUNTRIES.length],
        vcpu: profile.vcpu,
        memory: profile.memory,
        gpuCount: DEMO_COUNTS[(index * 4 + 1) % DEMO_COUNTS.length],
        perGpuHourly: demoPriceCents(profile, term, index + 17) / 100,
        term,
        status: 'Completed',
        settledAt: new Date(now - (8 + index * 1.15) * DAY_MS).toISOString(),
      }, 168 + index, 'demo'));
    }
    return rows.filter(Boolean);
  }
  const DEMO_SETTLEMENTS = buildDemoSettlements();

  function autoSettlements() {
    const exchange = scope.OpenNEXTExchange;
    if (!exchange?.recent) return [];
    try {
      // With no filters, Exchange.recent() returns its loaded anonymized tape;
      // this module applies the exact rolling seven-day window locally.
      const recent = exchange.recent();
      if (!Array.isArray(recent)) return [];
      return recent
        .filter(row => row?.serverRecord === true && !isReferenceRow(row))
        .map((row, index) => normalizeSettlement({
          ...row,
          country: row.country || (exchange.regionCountry ? exchange.regionCountry(row.region) : row.region),
        }, index, 'marketplace'))
        .filter(Boolean);
    } catch {
      return [];
    }
  }
  function settlementRows() {
    if (injectedRows !== null) return injectedRows;
    if (scope.OpenNEXTDemo?.active) return DEMO_SETTLEMENTS;
    return autoSettlements();
  }
  function currentRange() {
    return RANGES.find(range => range.key === state.range) || RANGES[2];
  }
  function insightOptions() {
    const range = currentRange();
    return {
      range: range.key,
      days: range.days,
      term: state.term,
      selected: Object.fromEntries(GROUPS.map(group => [group.key, state.selected[group.key].slice()])),
    };
  }
  function normalizeFilterRow(row, index) {
    if (!row || typeof row !== 'object') return null;
    const model = String(row.model || '').trim();
    const country = String(row.country || row.region || '').trim();
    const vcpuRaw = row.vcpu ?? row.vCPU ?? row.cpu?.vcpu;
    const memoryRaw = row.memory ?? row.gpuMemory ?? row.gpuMemoryGb;
    const term = canonicalTerm(row.term);
    if (!model && !country && !positive(vcpuRaw) && !positive(memoryRaw)) return null;
    return {
      _key: 'index-filter:' + index,
      model: model || null,
      country: country || null,
      vcpu: positive(vcpuRaw) ? Math.round(Number(vcpuRaw)) : null,
      memory: positive(memoryRaw) ? Number(memoryRaw) : null,
      term,
      _indexFilterRow: true,
    };
  }
  function indexFilterRows(ctx) {
    const bridge = scope.OpenNEXTMarketInsightIndex;
    if (!bridge?.filterRows) return [];
    try {
      const rows = bridge.filterRows(ctx, insightOptions());
      return Array.isArray(rows) ? rows.map(normalizeFilterRow).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  function pruneSelections(rows) {
    for (const group of GROUPS) {
      const available = new Set(rows.map(row => row[group.key]).filter(value => value !== null && value !== undefined).map(String));
      state.selected[group.key] = state.selected[group.key].filter(value => available.has(String(value)));
    }
  }
  function setSettlements(rows) {
    if (rows === null || rows === undefined) injectedRows = null;
    else if (!Array.isArray(rows)) throw new TypeError('OpenNEXTSellerActivities.setSettlements expects an array, null or undefined.');
    else injectedRows = rows.map((row, index) => normalizeSettlement(row, index, 'injected')).filter(Boolean);
    if (lastContext?.render) lastContext.render();
    return injectedRows === null ? null : injectedRows.length;
  }

  function termFiltered(rows) {
    return state.term === 'All' ? rows : rows.filter(row => row.term === state.term || (row._indexFilterRow && !row.term));
  }
  function attributeFiltered(rows, skippedKey = null, selected = state.selected) {
    return termFiltered(rows).filter(row => GROUPS.every(group => {
      if (group.key === skippedKey || !selected[group.key]?.length) return true;
      return selected[group.key].includes(String(row[group.key]));
    }));
  }
  function optionsFor(group, rows) {
    const values = new Set(termFiltered(rows).map(row => row[group.key]).filter(value => value !== null && value !== undefined).map(String));
    state.selected[group.key].forEach(value => values.add(String(value)));
    return [...values].sort(group.numeric ? (a, b) => Number(a) - Number(b) : (a, b) => a.localeCompare(b));
  }
  function optionCount(group, value, rows) {
    return attributeFiltered(rows, group.key).filter(row => String(row[group.key]) === String(value)).length;
  }
  function selectedCount() {
    return GROUPS.reduce((total, group) => total + state.selected[group.key].length, 0);
  }
  function recentWindow(rows, now = Date.now(), days = 7) {
    if (days === null || days === 'ALL') return rows.filter(row => row.settledAtTime <= now);
    const safeDays = Number(days);
    if (!Number.isFinite(safeDays) || safeDays <= 0) return [];
    const start = now - safeDays * DAY_MS;
    return rows.filter(row => row.settledAtTime >= start && row.settledAtTime <= now);
  }
  function allowedActivityLimit(value) {
    const limit = Number(value);
    return Number.isSafeInteger(limit) && ACTIVITY_SHOW_OPTIONS.includes(limit) ? limit : null;
  }
  function latestMatching(rows, limit = ACTIVITY_LIMIT) {
    const safeLimit = allowedActivityLimit(limit) ?? ACTIVITY_LIMIT;
    return rows.slice().sort((a, b) => b.settledAtTime - a.settledAtTime || b.id.localeCompare(a.id)).slice(0, safeLimit);
  }

  function priceBands(rows, stepCents) {
    if (!GROUPING_STEPS.includes(stepCents)) throw new RangeError('Unsupported grouping step.');
    const map = new Map();
    let totalGpus = 0;
    let weightedCents = 0;
    for (const row of rows) {
      const lowerCents = Math.floor(row.priceCents / stepCents) * stepCents;
      const current = map.get(lowerCents) || {lowerCents, trades: 0, gpus: 0};
      current.trades += 1;
      current.gpus += row.gpuCount;
      map.set(lowerCents, current);
      totalGpus += row.gpuCount;
      weightedCents += row.priceCents * row.gpuCount;
    }
    const bands = [...map.values()].sort((a, b) => b.lowerCents - a.lowerCents);
    const maxBandGpus = Math.max(0, ...bands.map(band => band.gpus));
    bands.forEach(band => {
      band.share = totalGpus ? band.gpus / totalGpus : 0;
      band.relative = maxBandGpus ? band.gpus / maxBandGpus : 0;
    });
    const top = bands.reduce((best, band) => !best || band.gpus > best.gpus ? band : best, null);
    return {
      bands,
      trades: rows.length,
      totalGpus,
      weightedAverageCents: totalGpus ? Math.round(weightedCents / totalGpus) : null,
      topShare: top?.share || 0,
    };
  }
  function usdCents(cents, digits = 2) { return '$' + (Number(cents) / 100).toFixed(digits); }
  function integer(value) { return new Intl.NumberFormat('en-US', {maximumFractionDigits: 0}).format(Number(value) || 0); }
  function bandLabel(lowerCents, stepCents) {
    const digits = stepCents === 100 ? 0 : stepCents === 10 ? 1 : 2;
    const short = usdCents(lowerCents, digits);
    const upperCents = lowerCents + stepCents - 1;
    return {short, range: stepCents === 1 ? short : usdCents(lowerCents) + '–' + usdCents(upperCents)};
  }
  function stepLabel(stepCents) { return stepCents === 100 ? '$1' : stepCents === 10 ? '$0.10' : '$0.01'; }
  function formatTime(timestamp) {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return 'Time unavailable';
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
    }).format(date).replace(',', ' ·') + ' UTC';
  }

  function filterGroup(ctx, group, rows) {
    const esc = ctx.esc;
    const selected = state.selected[group.key];
    const query = state.search[group.key] || '';
    const options = optionsFor(group, rows);
    const matching = options.filter(value => value.toLowerCase().includes(query.toLowerCase()));
    return '<details class="onx-sa-filter-group" data-sa-group="' + group.key + '" ' + (state.openGroups.includes(group.key) ? 'open' : '') + '>' +
      '<summary>' + esc(group.label) + '<span>' + (selected.length ? selected.length + ' selected' : 'All') + '</span>' + icon('chevron-down') + '</summary>' +
      '<div class="onx-sa-filter-options">' +
      (group.searchable ? '<label class="onx-sa-search">' + icon('search') + '<span class="onx-sa-sr-only">Search ' + esc(group.label) + '</span><input type="search" data-sa-search="' + group.key + '" value="' + esc(query) + '" placeholder="Search ' + esc(group.label.toLowerCase()) + '"></label>' : '') +
      '<label class="onx-sa-check"><input type="checkbox" data-sa-all="' + group.key + '" ' + (selected.length ? '' : 'checked') + '><span>All</span><small>' + termFiltered(rows).length + '</small></label>' +
      options.map(value => '<label class="onx-sa-check" data-sa-option-row="' + esc(value.toLowerCase()) + '" ' + (query && !value.toLowerCase().includes(query.toLowerCase()) ? 'hidden' : '') + '><input type="checkbox" data-sa-option="' + group.key + '" value="' + esc(value) + '" ' + (selected.includes(value) ? 'checked' : '') + '><span>' + esc(value) + (group.suffix || '') + '</span><small>' + optionCount(group, value, rows) + '</small></label>').join('') +
      '<p class="onx-sa-no-options" ' + (matching.length ? 'hidden' : '') + '>No options found.</p></div></details>';
  }

  function analyticsPanel(ctx, rows) {
    const stats = priceBands(rows, state.groupingStepCents);
    return '<section class="onx-sa-panel onx-sa-analytics" aria-labelledby="onx-sa-analytics-title"><header class="onx-sa-panel-head"><h2 id="onx-sa-analytics-title">Analytics</h2><span class="onx-sa-price-unit">USD / GPU-hour</span></header>' +
      '<div class="onx-sa-metrics"><div><small>COMPLETED TRADES</small><strong>' + integer(stats.trades) + '</strong></div><div><small>TRADED GPUs</small><strong>' + integer(stats.totalGpus) + '</strong></div><div><small>GPU-WEIGHTED AVG.</small><strong>' + (stats.weightedAverageCents === null ? '—' : usdCents(stats.weightedAverageCents)) + '</strong></div></div>' +
      '<div class="onx-sa-band-toolbar"><span>Band size</span><div role="group" aria-label="Executed price band size">' + GROUPING_STEPS.map(step => '<button type="button" data-sa-step="' + step + '" class="' + (state.groupingStepCents === step ? 'active' : '') + '" aria-pressed="' + (state.groupingStepCents === step) + '">' + stepLabel(step) + '</button>').join('') + '</div><span class="onx-sa-concentration">Largest band · ' + (stats.topShare * 100).toFixed(1) + '% of GPUs</span></div>' +
      '<div class="onx-sa-band-head" aria-hidden="true"><span>Executed band</span><span>GPU concentration</span><span>Trades</span><span>GPUs</span></div>' +
      '<div class="onx-sa-band-list">' + (stats.bands.length ? stats.bands.map(band => {
        const label = bandLabel(band.lowerCents, state.groupingStepCents);
        return '<div class="onx-sa-band-row"><div class="onx-sa-band-price"><strong>' + label.short + '</strong><small>' + (label.range === label.short ? 'Exact cent' : label.range) + '</small></div><div class="onx-sa-depth"><span style="width:' + Math.max(2, band.relative * 100).toFixed(2) + '%"></span><b>' + (band.share * 100).toFixed(1) + '%</b></div><strong class="onx-sa-band-number">' + integer(band.trades) + '</strong><strong class="onx-sa-band-number">' + integer(band.gpus) + '</strong></div>';
      }).join('') : '<div class="onx-sa-empty"><strong>No completed trades in the selected range</strong><span>Adjust the filters, range or market term.</span></div>') + '</div></section>';
  }

  function activitiesPanel(ctx, matchingRows) {
    const esc = ctx.esc;
    const latest = latestMatching(matchingRows, state.activityShow);
    return '<section class="onx-sa-panel onx-sa-activities" aria-labelledby="onx-sa-activities-title"><header class="onx-sa-panel-head"><h2 id="onx-sa-activities-title">Activities</h2><label class="onx-sa-show-control"><span>Show</span><select data-sa-show aria-label="Show activities">' + ACTIVITY_SHOW_OPTIONS.map(limit => '<option value="' + limit + '" ' + (state.activityShow === limit ? 'selected' : '') + '>' + limit + '</option>').join('') + '</select></label></header>' +
      '<div class="onx-sa-activity-head" aria-hidden="true"><span>Price</span><span>Model / Country</span><span>Capacity / Term</span><span>Time / Order ID</span></div>' +
      '<div class="onx-sa-activity-list">' + (latest.length ? latest.map(row => '<article class="onx-sa-activity-row"><div class="onx-sa-activity-price"><strong>' + usdCents(row.priceCents) + '</strong><small>USD/GPU-hour</small></div><div><strong>' + esc(row.model) + '</strong><small>' + esc(row.country) + '</small></div><div><strong>' + integer(row.gpuCount) + ' GPU' + (row.gpuCount === 1 ? '' : 's') + '</strong><small>' + esc(row.term) + (row.vcpu === null ? '' : ' · ' + integer(row.vcpu) + ' vCPU') + (row.memory === null ? '' : ' · ' + row.memory + ' GB/GPU') + '</small></div><div><time datetime="' + esc(row.settledAt) + '">' + esc(formatTime(row.settledAtTime)) + '</time><code>' + esc(row.id) + '</code></div></article>').join('') : '<div class="onx-sa-empty"><strong>No completed activities match</strong><span>Adjust the filters or choose another market term.</span></div>') + '</div>' +
      '<footer class="onx-sa-panel-foot"><span>Showing ' + latest.length + ' of ' + matchingRows.length + ' in the selected range</span><button type="button" class="text-link" data-sa-history>Request older activity</button></footer></section>';
  }

  function indexPanel(ctx, options) {
    try {
      const panel = scope.OpenNEXTMarketInsightIndex?.render?.(ctx, options);
      if (panel) return panel;
    } catch { /* The other insight panels remain usable if the index bridge fails. */ }
    return '<section class="onx-sa-panel onx-sa-index" aria-labelledby="onx-sa-index-title"><header class="onx-sa-panel-head"><h2 id="onx-sa-index-title">Index</h2></header><div class="onx-sa-empty"><strong>Index data is unavailable</strong><span>Try again when the market index feed is connected.</span></div></section>';
  }
  function panelControls() {
    return '<div class="onx-sa-panel-controls" role="group" aria-label="Visible insight panels">' + PANELS.map(panel => {
      const active = state.panels.includes(panel);
      const lastActive = active && state.panels.length === 1;
      const label = panel[0].toUpperCase() + panel.slice(1);
      return '<button type="button" data-sa-panel="' + panel + '" aria-pressed="' + active + '" class="' + (active ? 'active' : '') + '" ' + (lastActive ? 'disabled aria-disabled="true"' : '') + '><span class="onx-sa-panel-marker" aria-hidden="true">' + (active ? '✓' : '+') + '</span>' + label + '</button>';
    }).join('') + '</div>';
  }
  function rangeControls() {
    return '<div class="onx-sa-ranges" role="group" aria-label="History range">' + RANGES.map(range => '<button type="button" data-sa-range="' + range.key + '" aria-pressed="' + (state.range === range.key) + '" ' + (range.gated ? 'aria-haspopup="dialog" ' : '') + 'class="' + (state.range === range.key ? 'active' : '') + '">' + range.label + '</button>').join('') + '</div>';
  }
  function historyModal() {
    if (!state.modal) return '';
    const gated = state.modal === 'range-gate';
    const title = gated ? 'Historical data access' : 'Request older activity';
    const copy = gated ? 'To view three months or more of historical data, please contact Sales.' : 'Up to the latest 100 settlements matching your current filters are available here. Contact Sales for additional history.';
    return '<div class="onx-sa-modal-overlay" data-sa-modal-overlay><section class="onx-sa-modal" role="dialog" aria-modal="true" aria-labelledby="onx-sa-history-title" aria-describedby="onx-sa-history-copy"><header><div><h2 id="onx-sa-history-title">' + title + '</h2></div><button type="button" class="icon-btn" data-sa-modal-close aria-label="Close historical data dialog">×</button></header><div class="onx-sa-modal-body"><p id="onx-sa-history-copy">' + copy + '</p><footer><button type="button" class="btn secondary" data-sa-modal-close>Not now</button><button type="button" class="btn" data-sa-contact>Contact Sales</button></footer></div></section></div>';
  }

  function render(ctx) {
    lastContext = ctx;
    const now = Date.now();
    const rows = settlementRows().filter(row => row.settledAtTime <= now);
    const filterRows = rows.concat(indexFilterRows(ctx));
    pruneSelections(filterRows);
    const matching = attributeFiltered(rows);
    const options = insightOptions();
    const windowed = recentWindow(matching, now, options.days);
    const visiblePanels = PANELS.filter(panel => state.panels.includes(panel));
    const panels = visiblePanels.map(panel => panel === 'index' ? indexPanel(ctx, options) : panel === 'analytics' ? analyticsPanel(ctx, windowed) : activitiesPanel(ctx, windowed)).join('');
    const panelClasses = 'onx-sa-panels' + (visiblePanels.includes('index') ? ' has-index' : '') + (visiblePanels.length === 1 ? ' single-panel' : '');
    return '<section class="onx-seller-activities" data-seller-activities>' +
      '<header class="onx-sa-page-head"><div><h1>Market Insight</h1><p>Market indexes, executed-price analytics and anonymized GPU capacity activity.</p></div>' + (ctx.S?.role === 'Buyer' ? '<button type="button" class="btn onx-sa-list-supply" data-nav="market">Browse GPU Market</button>' : '<button type="button" class="btn onx-sa-list-supply" data-act="new-supply">' + icon('plus') + 'List my supply</button>') + '</header>' +
      '<div class="onx-sa-termbar"><div class="onx-sa-tabs" role="tablist" aria-label="Market term">' + TERMS.map(term => '<button type="button" role="tab" data-sa-term="' + term + '" aria-selected="' + (state.term === term) + '" class="' + (state.term === term ? 'active' : '') + '">' + (term === 'All' ? 'All terms' : term) + '</button>').join('') + '</div></div>' +
      '<div class="onx-sa-toolbar"><button type="button" class="btn secondary small" data-sa-toggle-filters aria-expanded="' + state.showFilters + '">' + icon('sliders-horizontal') + 'Filters' + (selectedCount() ? ' · ' + selectedCount() : '') + '</button>' + panelControls() + rangeControls() + '</div>' +
      '<div class="onx-sa-layout ' + (state.showFilters ? '' : 'filters-hidden') + '"><aside class="onx-sa-filters" ' + (state.showFilters ? '' : 'hidden') + ' aria-label="Market insight filters"><div class="onx-sa-filter-head"><strong>Filter market data</strong><button type="button" data-sa-clear>Clear</button></div>' + GROUPS.map(group => filterGroup(ctx, group, filterRows)).join('') + '</aside><div class="' + panelClasses + '" data-visible-count="' + visiblePanels.length + '">' + panels + '</div></div>' +
      historyModal() + '</section>';
  }

  function refresh(ctx, focusSelector) {
    ctx.render();
    if (focusSelector) scope.requestAnimationFrame?.(() => document.querySelector('[data-seller-activities] ' + focusSelector)?.focus({preventScroll: true}));
  }
  function closeHistory(ctx) {
    const restore = state.modal === 'range-gate' ? '[data-sa-range="' + selectorEscape(state.requestedRange || state.range) + '"]' : '[data-sa-history]';
    state.modal = null;
    state.requestedRange = null;
    refresh(ctx, restore);
  }
  function bind(ctx) {
    lastContext = ctx;
    const root = document.querySelector('[data-seller-activities]');
    if (!root || root.dataset.saBound === 'true') return;
    root.dataset.saBound = 'true';
    scope.lucide?.createIcons?.({attrs: {width: 16, height: 16}});
    if (state.modal) scope.requestAnimationFrame?.(() => root.querySelector('[data-sa-modal-close]')?.focus({preventScroll: true}));

    root.addEventListener('toggle', event => {
      const key = event.target?.dataset?.saGroup;
      if (!key) return;
      if (event.target.open && !state.openGroups.includes(key)) state.openGroups.push(key);
      else if (!event.target.open) state.openGroups = state.openGroups.filter(value => value !== key);
    }, true);

    root.addEventListener('input', event => {
      const target = event.target;
      if (!target.dataset.saSearch) return;
      state.search[target.dataset.saSearch] = target.value;
      const options = target.closest('.onx-sa-filter-options');
      const query = target.value.trim().toLowerCase();
      let shown = 0;
      options?.querySelectorAll('[data-sa-option-row]').forEach(row => {
        row.hidden = !!query && !row.dataset.saOptionRow.includes(query);
        if (!row.hidden) shown += 1;
      });
      const empty = options?.querySelector('.onx-sa-no-options');
      if (empty) empty.hidden = shown > 0;
    });

    root.addEventListener('change', event => {
      const target = event.target;
      if (target.hasAttribute('data-sa-show')) {
        const limit = allowedActivityLimit(target.value);
        if (limit === null) {
          target.value = String(state.activityShow);
          return;
        }
        state.activityShow = limit;
        refresh(ctx, '[data-sa-show]');
      } else if (target.dataset.saOption) {
        const key = target.dataset.saOption;
        const current = state.selected[key];
        state.selected[key] = target.checked ? [...new Set([...current, target.value])] : current.filter(value => value !== target.value);
        refresh(ctx, '[data-sa-option="' + selectorEscape(key) + '"][value="' + selectorEscape(target.value) + '"]');
      } else if (target.dataset.saAll) {
        state.selected[target.dataset.saAll] = [];
        refresh(ctx, '[data-sa-all="' + selectorEscape(target.dataset.saAll) + '"]');
      }
    });

    root.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || button.disabled) {
        if (event.target.matches('[data-sa-modal-overlay]')) closeHistory(ctx);
        return;
      }
      if (button.dataset.saPanel) {
        const panel = button.dataset.saPanel;
        if (!PANELS.includes(panel)) return;
        const active = state.panels.includes(panel);
        if (active && state.panels.length === 1) return;
        state.panels = active ? state.panels.filter(value => value !== panel) : PANELS.filter(value => state.panels.includes(value) || value === panel);
        refresh(ctx, '[data-sa-panel="' + selectorEscape(panel) + '"]');
      } else if (button.dataset.saRange) {
        const range = RANGES.find(item => item.key === button.dataset.saRange);
        if (!range) return;
        if (range.gated) {
          state.requestedRange = range.key;
          state.modal = 'range-gate';
          refresh(ctx);
        } else {
          state.range = range.key;
          refresh(ctx, '[data-sa-range="' + selectorEscape(range.key) + '"]');
        }
      } else if (button.dataset.saTerm) {
        state.term = TERMS.includes(button.dataset.saTerm) ? button.dataset.saTerm : 'All';
        refresh(ctx, '[data-sa-term="' + selectorEscape(state.term) + '"]');
      } else if (button.dataset.saStep) {
        const step = Number(button.dataset.saStep);
        if (GROUPING_STEPS.includes(step)) state.groupingStepCents = step;
        refresh(ctx, '[data-sa-step="' + step + '"]');
      } else if (button.hasAttribute('data-sa-toggle-filters')) {
        state.showFilters = !state.showFilters;
        refresh(ctx, '[data-sa-toggle-filters]');
      } else if (button.hasAttribute('data-sa-clear')) {
        state.term = 'All';
        state.selected = {model: [], country: [], vcpu: [], memory: []};
        state.search = {model: '', country: ''};
        refresh(ctx, '[data-sa-clear]');
      } else if (button.hasAttribute('data-sa-history')) {
        state.modal = 'history';
        refresh(ctx);
      } else if (button.hasAttribute('data-sa-modal-close')) {
        closeHistory(ctx);
      } else if (button.hasAttribute('data-sa-contact')) {
        state.modal = null;
        state.requestedRange = null;
        ctx.render();
        if (scope.OpenNEXTContact?.open) scope.OpenNEXTContact.open({message: 'I would like access to older anonymized GPU settlement activity and historical market data.'});
        else ctx.toast('Contact Sales is not available in this preview.');
      }
    });

    root.addEventListener('keydown', event => {
      if (!state.modal) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeHistory(ctx);
      } else if (event.key === 'Tab') {
        const dialog = root.querySelector('.onx-sa-modal');
        const focusable = [...(dialog?.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') || [])]
          .filter(element => element.getClientRects().length);
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });

    if (state.panels.includes('index')) {
      try { scope.OpenNEXTMarketInsightIndex?.bind?.(ctx, insightOptions()); }
      catch { /* Analytics and Activities stay interactive if the index bridge fails. */ }
    }
  }

  const testHelpers = Object.freeze({
    normalizeSettlement,
    buildDemoSettlements,
    recentWindow,
    latestMatching,
    allowedActivityLimit,
    priceBands,
    bandLabel,
    activityLimit: ACTIVITY_LIMIT,
    activityShowOptions: ACTIVITY_SHOW_OPTIONS,
  });
  scope.OpenNEXTSellerActivities = {render, bind, setSettlements, testHelpers};
})(typeof window !== 'undefined' ? window : globalThis);
