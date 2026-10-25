(function (scope) {
  'use strict';

  const PAGE_SIZE = 12;
  const TERMS = ['Spot', 'On-demand', 'Reserved'];
  const GROUPS = [
    {key: 'model', label: 'Model', searchable: true},
    {key: 'country', label: 'Country', searchable: true},
    {key: 'vcpu', label: 'vCPU', numeric: true},
    {key: 'memory', label: 'Memory', numeric: true, suffix: ' GB'},
  ];
  const SORTS = [
    ['price-asc', 'Price: Low to High'],
    ['price-desc', 'Price: High to Low'],
    ['recent', 'Recently Listed'],
  ];
  const COUNTRIES = ['Singapore', 'Germany', 'United States', 'Japan', 'Netherlands', 'United Kingdom', 'Canada', 'France', 'Australia', 'Sweden', 'India', 'UAE'];
  const BASE_FIXTURES = [
    ['H100 SXM', 80, 192, 1.80, 0], ['H100 SXM', 80, 192, 1.65, 1],
    ['H100 SXM', 80, 192, 1.72, 2], ['H100 SXM', 80, 192, 1.95, 3],
    ['H100 SXM', 80, 192, 1.78, 4], ['H100 SXM', 80, 192, 1.88, 5],
    ['H200 SXM', 141, 192, 2.45, 0], ['H200 SXM', 141, 192, 2.38, 2],
    ['H200 SXM', 141, 192, 2.52, 6], ['H200 SXM', 141, 192, 2.41, 7],
    ['B200', 180, 192, 3.05, 0], ['B200', 180, 192, 2.96, 1],
    ['A100 SXM', 80, 96, 1.12, 8], ['A100 SXM', 80, 96, 1.08, 9],
    ['A100 SXM', 80, 128, 1.16, 10], ['H100 SXM', 80, 128, 1.74, 11],
    ['H200 SXM', 141, 192, 2.57, 3], ['B200', 180, 192, 3.18, 2],
  ];
  const TERM_MULTIPLIER = {'Spot': 1, 'On-demand': 1.22, 'Reserved': 0.84};
  const TERM_OFFSET = {'Spot': 0, 'On-demand': 18, 'Reserved': 36};
  const FIXTURE_EPOCH = Date.parse('2026-10-23T12:00:00Z');

  const state = {
    term: 'Spot',
    view: 'list',
    sort: 'recent',
    showFilters: typeof scope.innerWidth !== 'number' || scope.innerWidth > 650,
    page: 0,
    selected: {model: [], country: [], vcpu: [], memory: []},
    search: {model: '', country: ''},
    openGroups: ['model'],
    maxPrice: null,
    checkout: null,
  };

  let injectedRows = null;
  let lastContext = null;

  function round(value) { return Math.round(Number(value) * 100) / 100; }
  function usd(value) { return '$' + Number(value).toFixed(2); }
  function finite(value) { return Number.isFinite(Number(value)); }
  function positive(value) { return finite(value) && Number(value) > 0; }
  function icon(name) { return '<i data-lucide="' + name + '" aria-hidden="true"></i>'; }
  function selectorEscape(value) {
    if (scope.CSS?.escape) return scope.CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, character => '\\' + character.codePointAt(0).toString(16) + ' ');
  }
  function safeTime(value) { const time = Date.parse(value); return Number.isFinite(time) ? time : 0; }
  function canonicalTerm(value) {
    const normalized = String(value || 'Spot').trim().toLowerCase();
    if (normalized === 'on-demand' || normalized === 'on demand' || normalized === 'ondemand') return 'On-demand';
    if (normalized === 'reserved' || normalized === 'reservation') return 'Reserved';
    return 'Spot';
  }
  function isPricingObservation(row) {
    return row?.referenceOnly === true || row?.external === true || row?.observationOnly === true ||
      /(?:price|pricing)[_-]?observation/i.test(String(row?.sourceType || row?.provenance || ''));
  }
  function isAgentMarketplaceRow(row) {
    return !isPricingObservation(row) && row?.executable !== false &&
      (row?.agentStatus === 'Succeeded' || (row?.serverRecord === true && row?.status === 'Published'));
  }
  function explicitNodeGpuCount(row) {
    return row?.gpuCount ?? row?.gpus ?? row?.nodeGpuCount ?? row?.node?.gpuCount;
  }
  function isValidatedInstanceRow(row) {
    return positive(explicitNodeGpuCount(row)) &&
      positive(row?.vcpu ?? row?.vCPU ?? row?.cpu?.vcpu) &&
      positive(row?.memory ?? row?.gpuMemory ?? row?.gpuMemoryGb);
  }
  function normalizeRow(row, index, sourceKind) {
    if (!row || typeof row !== 'object' || isPricingObservation(row)) return null;
    const perGpuHourly = Number(row.perGpuHourly ?? row.rate ?? row.price ?? row.netPrice ?? row.unitPrice);
    if (!(perGpuHourly > 0) || !Number.isFinite(perGpuHourly)) return null;
    const nodeGpuCount = explicitNodeGpuCount(row);
    if (!positive(nodeGpuCount)) return null;
    const gpuCount = Math.max(1, Math.round(Number(nodeGpuCount)));
    const memory = positive(row.memory ?? row.gpuMemory ?? row.gpuMemoryGb) ? Number(row.memory ?? row.gpuMemory ?? row.gpuMemoryGb) : null;
    const vcpu = positive(row.vcpu ?? row.vCPU ?? row.cpu?.vcpu) ? Math.round(Number(row.vcpu ?? row.vCPU ?? row.cpu?.vcpu)) : null;
    const term = canonicalTerm(row.term);
    const id = String(row.id || 'spot-preview-' + term.toLowerCase().replace(/[^a-z]+/g, '-') + '-' + index);
    const listedAt = row.listedAt || row.createdAt || row.created || row.updatedAt || null;
    return {
      _key: term + ':' + id + ':' + index,
      id,
      model: String(row.model || row.name || 'GPU model to confirm'),
      country: String(row.country || row.region || row.regionLabel || 'Country to confirm'),
      vcpu,
      gpuCount,
      memory,
      perGpuHourly: round(perGpuHourly),
      instanceHourly: round(perGpuHourly * gpuCount),
      term,
      listedAt,
      listedAtTime: safeTime(listedAt),
      provider: String(row.provider || 'Supplier to confirm'),
      previewOnly: sourceKind !== 'agent' || row.previewOnly === true,
      sourceKind,
    };
  }
  function fixtureRows() {
    return TERMS.flatMap(term => BASE_FIXTURES.map(([model, memory, vcpu, rate, countryIndex], index) => normalizeRow({
      id: 'preview-' + term.toLowerCase().replace(/[^a-z]+/g, '-') + '-' + String(index + 1).padStart(2, '0'),
      model,
      memory,
      vcpu,
      perGpuHourly: round(rate * TERM_MULTIPLIER[term]),
      country: COUNTRIES[countryIndex],
      gpuCount: 8,
      term,
      listedAt: new Date(FIXTURE_EPOCH - (TERM_OFFSET[term] + index) * 37 * 60000).toISOString(),
      previewOnly: true,
    }, index, 'fixture'))).filter(Boolean);
  }
  const FALLBACK_ROWS = fixtureRows();

  function autoInventory() {
    const exchange = scope.OpenNEXTExchange;
    if (!exchange?.listPublic) return [];
    try {
      return (exchange.listPublic('rental', 'supply') || [])
        .filter(row => isAgentMarketplaceRow(row) && isValidatedInstanceRow(row))
        .map((row, index) => normalizeRow({
          ...row,
          country: row.country || (exchange.regionCountry ? exchange.regionCountry(row.region) : row.region),
        }, index, 'agent'))
        .filter(Boolean);
    } catch {
      return [];
    }
  }
  function inventoryState() {
    if (injectedRows !== null) {
      const hasAgent = injectedRows.some(row => row.sourceKind === 'agent' && !row.previewOnly);
      const hasPreview = injectedRows.some(row => row.previewOnly);
      return {
        rows: injectedRows,
        scope: hasAgent && hasPreview ? 'Mixed connected and preview feed · checkout remains disabled' : hasAgent ? 'Connected inventory preview · checkout remains disabled' : 'Injected preview feed · no live availability claim',
        kind: hasAgent && !hasPreview ? 'agent' : 'preview',
      };
    }
    const agentRows = autoInventory();
    if (agentRows.length) return {rows: agentRows, scope: 'Connected marketplace records · checkout remains preview-only', kind: 'agent'};
    if (scope.OpenNEXTDemo?.active === true) return {rows: FALLBACK_ROWS, scope: 'Demo inventory', kind: 'fixture'};
    return {rows: [], scope: 'Connected marketplace inventory', kind: 'agent'};
  }

  function pruneSelections(rows) {
    for (const group of GROUPS) {
      const available = new Set(rows.map(row => row[group.key]).filter(value => value !== null && value !== undefined).map(String));
      state.selected[group.key] = state.selected[group.key].filter(value => available.has(String(value)));
    }
  }
  function setInventory(rows) {
    if (rows === null || rows === undefined) injectedRows = null;
    else if (!Array.isArray(rows)) throw new TypeError('OpenNEXTSpotMarket.setInventory expects an array, null or undefined.');
    else injectedRows = rows.map((row, index) => normalizeRow(row, index, isAgentMarketplaceRow(row) ? 'agent' : 'preview')).filter(Boolean);
    pruneSelections((injectedRows === null ? inventoryState().rows : injectedRows));
    state.page = 0;
    if (lastContext?.render) lastContext.render();
    return injectedRows === null ? null : injectedRows.length;
  }

  function termRows(rows) { return rows.filter(row => row.term === state.term); }
  function attributeFiltered(rows, skippedKey) {
    return rows.filter(row => GROUPS.every(group => {
      if (group.key === skippedKey || !state.selected[group.key].length) return true;
      return state.selected[group.key].includes(String(row[group.key]));
    }));
  }
  function boundsFor(rows) {
    // Bounds follow the active term and non-price attribute filters. The price
    // filter itself never feeds back into its own minimum or maximum.
    const candidates = attributeFiltered(termRows(rows));
    const prices = candidates.map(row => row.perGpuHourly).filter(positive);
    if (!prices.length) return {min: null, max: null, rows: candidates};
    return {min: round(Math.min(...prices)), max: round(Math.max(...prices)), rows: candidates};
  }
  function filteredRows(rows) {
    const bounded = boundsFor(rows).rows.filter(row => state.maxPrice === null || row.perGpuHourly <= state.maxPrice + 1e-9);
    const sorted = bounded.slice();
    if (state.sort === 'price-asc') sorted.sort((a, b) => a.instanceHourly - b.instanceHourly || a.perGpuHourly - b.perGpuHourly || b.listedAtTime - a.listedAtTime || a._key.localeCompare(b._key));
    else if (state.sort === 'price-desc') sorted.sort((a, b) => b.instanceHourly - a.instanceHourly || b.perGpuHourly - a.perGpuHourly || b.listedAtTime - a.listedAtTime || a._key.localeCompare(b._key));
    else sorted.sort((a, b) => b.listedAtTime - a.listedAtTime || a._key.localeCompare(b._key));
    return sorted;
  }
  function optionsFor(group, rows) {
    const values = new Set(termRows(rows).map(row => row[group.key]).filter(value => value !== null && value !== undefined).map(String));
    state.selected[group.key].forEach(value => values.add(String(value)));
    return [...values].sort(group.numeric ? (a, b) => Number(a) - Number(b) : (a, b) => a.localeCompare(b));
  }
  function optionCount(group, value, rows) {
    return attributeFiltered(termRows(rows), group.key).filter(row => String(row[group.key]) === String(value)).length;
  }
  function selectedCount() {
    return GROUPS.reduce((sum, group) => sum + state.selected[group.key].length, 0) + (state.maxPrice === null ? 0 : 1);
  }
  function formatSpec(value, fallback = 'To confirm') { return value === null || value === undefined ? fallback : String(value); }
  function offerFor(row) {
    return {
      id: row.id,
      model: row.model,
      country: row.country,
      vcpu: row.vcpu,
      gpuCount: row.gpuCount,
      memory: row.memory,
      perGpuHourly: row.perGpuHourly,
      instanceHourly: row.instanceHourly,
      term: row.term,
    };
  }

  function filterGroup(ctx, group, rows) {
    const esc = ctx.esc;
    const selected = state.selected[group.key];
    const query = state.search[group.key] || '';
    const options = optionsFor(group, rows);
    const matching = options.filter(value => value.toLowerCase().includes(query.toLowerCase()));
    return '<details class="onx-spot-filter-group" data-spot-group="' + group.key + '" ' + (state.openGroups.includes(group.key) ? 'open' : '') + '>' +
      '<summary>' + esc(group.label) + '<span>' + (selected.length ? selected.length + ' selected' : 'All') + '</span>' + icon('chevron-down') + '</summary>' +
      '<div class="onx-spot-filter-options">' +
      (group.searchable ? '<label class="onx-spot-search">' + icon('search') + '<span class="onx-spot-sr-only">Search ' + esc(group.label) + '</span><input type="search" data-spot-search="' + group.key + '" value="' + esc(query) + '" placeholder="Search ' + esc(group.label.toLowerCase()) + '"></label>' : '') +
      '<label class="onx-spot-check"><input type="checkbox" data-spot-all="' + group.key + '" ' + (selected.length ? '' : 'checked') + '><span>All</span><small>' + termRows(rows).length + '</small></label>' +
      options.map(value => '<label class="onx-spot-check" data-spot-option-row="' + esc(value.toLowerCase()) + '" ' + (query && !value.toLowerCase().includes(query.toLowerCase()) ? 'hidden' : '') + '><input type="checkbox" data-spot-option="' + group.key + '" value="' + esc(value) + '" ' + (selected.includes(value) ? 'checked' : '') + '><span>' + esc(value) + (group.suffix || '') + '</span><small>' + optionCount(group, value, rows) + '</small></label>').join('') +
      '<p class="onx-spot-no-options" ' + (matching.length ? 'hidden' : '') + '>No options found.</p></div></details>';
  }

  function priceFilter(ctx, rows) {
    const bounds = boundsFor(rows);
    const available = bounds.min !== null && bounds.max !== null;
    const equal = available && Math.abs(bounds.max - bounds.min) < 0.005;
    const sliderValue = available ? Math.min(bounds.max, Math.max(bounds.min, state.maxPrice === null ? bounds.max : state.maxPrice)) : 0;
    const rangeText = available ? usd(bounds.min) + (equal ? '' : '–' + usd(bounds.max)) : 'No prices';
    return '<details class="onx-spot-filter-group" data-spot-group="price" ' + (state.openGroups.includes('price') ? 'open' : '') + '>' +
      '<summary>Price<span>' + (state.maxPrice === null ? 'All' : 'Up to ' + usd(state.maxPrice)) + '</span>' + icon('chevron-down') + '</summary>' +
      '<div class="onx-spot-filter-options">' +
      '<label class="onx-spot-check"><input type="checkbox" data-spot-price-all ' + (state.maxPrice === null ? 'checked' : '') + '><span>All</span></label>' +
      '<label class="onx-spot-price-number"><span>Maximum price</span><input type="number" min="0" step="0.01" inputmode="decimal" data-spot-price-number value="' + (state.maxPrice === null ? '' : state.maxPrice.toFixed(2)) + '" placeholder="' + (available ? bounds.max.toFixed(2) : 'No prices') + '" ' + (available ? '' : 'disabled') + '><small>USD/GPU-hour</small></label>' +
      '<div class="onx-spot-price-range"><div><span>Available range</span><output data-spot-price-output>' + rangeText + '</output></div><input type="range" data-spot-price-range min="' + (available ? bounds.min.toFixed(2) : '0') + '" max="' + (available ? bounds.max.toFixed(2) : '0') + '" step="0.01" value="' + sliderValue.toFixed(2) + '" ' + (!available || equal ? 'disabled' : '') + ' aria-label="Maximum USD per GPU-hour"></div>' +
      '</div></details>';
  }

  function priceMarkup(row) {
    return '<div class="onx-spot-price"><strong>' + usd(row.instanceHourly) + ' <span>/hour</span></strong><small>' + usd(row.perGpuHourly) + ' USD/GPU-hour</small></div>';
  }
  function actionButton(ctx, row) {
    const label = row.term === 'Spot' ? 'Buy Now' : 'Ask for quote';
    const attr = row.term === 'Spot' ? 'data-spot-buy' : 'data-spot-quote';
    return '<button type="button" class="onx-spot-action ' + (row.term === 'Spot' ? 'is-buy' : 'is-quote') + '" ' + attr + '="' + ctx.esc(row._key) + '" aria-label="' + label + ': ' + ctx.esc(row.model + ', ' + row.country) + '">' + label + '</button>';
  }
  function tableView(ctx, rows) {
    const esc = ctx.esc;
    return '<div class="onx-spot-table-scroll"><table class="onx-spot-table"><thead><tr><th>Model</th><th>Capacity</th><th>Price</th><th>Country</th><th aria-label="vCPU per node">vCPU</th><th>Memory</th><th class="onx-spot-action-column"><span class="onx-spot-sr-only">Action</span></th></tr></thead><tbody>' +
      (rows.length ? rows.map(row => '<tr><td><strong class="onx-spot-model">' + esc(row.model) + '</strong></td><td class="onx-spot-number">' + row.gpuCount + ' GPUs</td><td>' + priceMarkup(row) + '</td><td>' + esc(row.country) + '</td><td class="onx-spot-number">' + esc(formatSpec(row.vcpu)) + '</td><td class="onx-spot-number" aria-label="Memory per GPU">' + (row.memory === null ? 'To confirm' : esc(row.memory) + ' GB') + '</td><td>' + actionButton(ctx, row) + '</td></tr>').join('') : '<tr><td colspan="7"><div class="onx-spot-empty"><strong>No offers match these filters</strong><span>Adjust the filters or choose another market term.</span></div></td></tr>') +
      '</tbody></table></div>';
  }
  function cardView(ctx, rows) {
    const esc = ctx.esc;
    return '<div class="onx-spot-cards">' + (rows.length ? rows.map(row =>
      '<article class="onx-spot-card"><div class="onx-spot-card-main"><div class="onx-spot-card-identity"><div class="onx-spot-card-model"><h2 title="' + esc(row.model) + '">' + esc(row.model) + '</h2><span>' + row.gpuCount + ' GPUs</span></div><p>' + icon('map-pin') + esc(row.country) + '</p></div><div class="onx-spot-card-specs"><span><small>vCPU</small><strong>' + esc(formatSpec(row.vcpu)) + '</strong></span><span><small>Memory</small><strong>' + (row.memory === null ? 'To confirm' : esc(row.memory) + ' GB') + '</strong></span></div></div><div class="onx-spot-card-bottom">' + priceMarkup(row) + actionButton(ctx, row) + '</div></article>'
    ).join('') : '<div class="onx-spot-empty"><strong>No offers match these filters</strong><span>Adjust the filters or choose another market term.</span></div>') + '</div>';
  }
  const CHECKOUT_STORAGE='opennext:pending-spot-purchase:v1:';
  const CHECKOUT_TTL=2*60*60*1000;
  let inputBound=false;
  function owner(ctx){const user=ctx.S?.user;return user?.id&&ctx.S.auth!==false?(scope.OpenNEXTDemo?.active||user.demo?'demo:':'account:')+user.id+':'+ctx.S.role:null;}
  function durationHours(value){
    const text=String(value??'').trim(),hours=Number(text);
    if(!/^\d+(?:\.\d{1,2})?$/.test(text)||!Number.isFinite(hours)||hours<=0)throw new Error('Enter a usage duration greater than zero, with up to two decimal places.');
    return hours;
  }
  function checkoutTotals(row,hours=1){
    hours=durationHours(hours);
    const hourlyCents=Math.round(row.instanceHourly*100),hundredthHours=Math.round(hours*100),durationProduct=hourlyCents*hundredthHours;
    // Integer hundredth-hours preserve half-cent rounding; one twentieth is the aggregate 5% fee.
    const baseCents=Math.round(durationProduct/100),feeCents=Math.round(baseCents/20),totalCents=baseCents+feeCents;
    if(![hourlyCents,hundredthHours,durationProduct,baseCents,feeCents,totalCents].every(Number.isSafeInteger)||hourlyCents<=0||baseCents<=0)throw new Error('Enter a valid duration with a payable total.');
    return {currency:'USD',durationHours:hours,hourlyCents,baseCents,feeCents,totalCents};
  }
  function signature(row){return JSON.stringify([row.id,row.term,row.model,row.country,row.gpuCount,row.vcpu,row.memory,row.instanceHourly,row.perGpuHourly,row.sourceKind,row.previewOnly]);}
  function storageKey(ctx){const id=owner(ctx);return id?CHECKOUT_STORAGE+encodeURIComponent(id):null;}
  function clearStored(ctx){try{const key=storageKey(ctx);if(key)scope.sessionStorage?.removeItem(key);}catch{}}
  function savePending(ctx){
    const draft=state.checkout,key=storageKey(ctx);if(!draft||!key||draft.owner!==owner(ctx)||draft.stage==='completed')return;
    try{scope.sessionStorage?.setItem(key,JSON.stringify({version:2,owner:draft.owner,offerId:draft.row.id,signature:signature(draft.row),durationHours:durationHours(draft.hoursRaw),sshPublicKey:draft.sshPublicKey||'',idempotencyKey:draft.idempotencyKey,paymentSubmitted:!!draft.paymentSubmitted,createdAt:draft.createdAt}));}catch{ctx.toast('The purchase is retained in this tab. Browser storage is unavailable.');}
  }
  function pending(ctx){
    const id=owner(ctx);if(!id)return null;
    if(state.checkout?.owner===id)return state.checkout;
    state.checkout=null;
    try{
      const stored=JSON.parse(scope.sessionStorage?.getItem(storageKey(ctx))||'null');
      if(!stored||stored.version!==2||stored.owner!==id||!Number.isFinite(stored.createdAt)||Date.now()-stored.createdAt>CHECKOUT_TTL||stored.createdAt>Date.now()+60000||typeof stored.idempotencyKey!=='string'||stored.idempotencyKey.length>100)return null;
      const row=inventoryState().rows.find(item=>item.id===stored.offerId&&item.term==='Spot');if(!row)return null;
      const validator=scope.OpenNEXTAccountProfile?.validatePublicKey;
      const ssh=stored.sshPublicKey&&validator?validator(stored.sshPublicKey).publicKey:'';
      const hours=durationHours(stored.durationHours);checkoutTotals(row,hours);
      state.checkout={owner:id,key:row._key,row:{...row},stage:'payment',hoursRaw:String(hours),durationHours:hours,sshPublicKey:ssh,sshRaw:ssh,idempotencyKey:stored.idempotencyKey,paymentSubmitted:stored.paymentSubmitted===true,createdAt:stored.createdAt,balanceNeedsRefresh:true,reviewRequired:stored.signature!==signature(row),message:'',busy:false};
    }catch{clearStored(ctx);}
    return state.checkout;
  }
  function hasPending(ctx){const draft=pending(ctx);return Boolean(draft&&draft.stage!=='completed');}
  function beginCheckout(ctx,row){
    if(!owner(ctx)||ctx.S.role!=='Buyer'){ctx.toast('Sign in to a Buyer account before purchasing capacity.');return;}
    if(pending(ctx)?.paymentSubmitted){ctx.toast('A payment is awaiting confirmation. Check its order status before starting another purchase.');return;}
    clearStored(ctx);state.checkout={owner:owner(ctx),key:row._key,row:{...row},stage:'review',hoursRaw:'1',durationHours:1,sshRaw:'',sshPublicKey:'',idempotencyKey:scope.crypto.randomUUID(),createdAt:Date.now(),balanceNeedsRefresh:false,reviewRequired:false,message:'',busy:false};
    ctx.open('spot-review');
  }
  function liveRow(ctx){
    const draft=pending(ctx);if(!draft)throw new Error('This purchase is no longer available. Choose the offer again.');
    const row=inventoryState().rows.find(item=>item.id===draft.row.id&&item.term==='Spot');
    if(!row)throw new Error('This Spot offer is no longer available. Choose another offer.');
    if(draft.paymentSubmitted&&(draft.reviewRequired||signature(row)!==signature(draft.row)))throw new Error('The offer changed while payment confirmation is pending. Check your order status before trying again.');
    if(signature(row)!==signature(draft.row)){
      draft.row={...row};draft.key=row._key;draft.reviewRequired=true;draft.stage='review';draft.message='This offer has changed. Review its current specifications and hourly price before continuing.';ctx.open('spot-review');throw new Error(draft.message);
    }
    return row;
  }
  function totalsMarkup(row,hours){
    let total;try{total=checkoutTotals(row,hours);}catch{}
    return '<p><span>/ hour</span><strong>'+usd(row.instanceHourly)+'</strong></p><p><span>Compute / hour'+(total?'<small>'+total.durationHours+' '+(total.durationHours===1?'hour':'hours')+' × '+usd(total.hourlyCents/100)+' / hour</small>':'')+'</span><strong data-spot-compute>'+(total?usd(total.baseCents/100):'—')+'</strong></p><p><span>OpenNEXT Fee 5%</span><strong data-spot-fee>'+(total?usd(total.feeCents/100):'—')+'</strong></p><p class="onx-spot-checkout-total"><span>Total</span><strong data-spot-total>'+(total?usd(total.totalCents/100):'—')+'</strong></p>';
  }
  function hourlySummary(ctx,row,draft,editable=false){
    return '<div class="onx-spot-purchase-resource"><h3>'+ctx.esc(row.model)+' · '+ctx.esc(row.country)+'</h3><p>'+row.gpuCount+' GPUs · '+(row.memory===null?'Memory to confirm':ctx.esc(row.memory)+' GB / GPU')+' · '+(row.vcpu===null?'vCPU to confirm':ctx.esc(row.vcpu)+' vCPU')+'</p></div>'+(editable?'<label class="form-label onx-spot-duration">Usage duration <span class="muted">(hours)</span><input class="field" type="number" name="durationHours" data-spot-hours min="0.01" step="0.01" inputmode="decimal" required value="'+ctx.esc(draft.hoursRaw)+'" placeholder="Enter hours"></label>':'')+'<div class="onx-spot-checkout-summary" data-spot-checkout-totals aria-live="polite">'+totalsMarkup(row,draft.hoursRaw)+'</div>';
  }
  function availableCredit(ctx){const value=Number(ctx.S.balance);return Number.isFinite(value)&&value>=0?value:null;}
  function insufficientCredit(ctx,draft){const balance=availableCredit(ctx);return balance!==null&&Math.round(balance*100)<checkoutTotals(draft.row,draft.hoursRaw).totalCents;}
  function creditMarkup(ctx,draft){const credit=availableCredit(ctx),short=insufficientCredit(ctx,draft);return '<div class="onx-spot-credit-balance'+(short?' is-insufficient':'')+'"><span>Available Credit</span><strong>'+(credit===null?'—':usd(credit))+'</strong></div>'+(short?'<p class="onx-spot-credit-shortfall">Insufficient Credit. Add credit to complete this purchase.</p>':'');}
  function modal(ctx,type){
    if(!['spot-review','spot-payment-choice','spot-credit-confirm','spot-purchase-complete'].includes(type))return null;
    const draft=pending(ctx);if(!draft)return {title:'Purchase unavailable',body:'<p class="form-note">Choose an available Spot offer to start a purchase.</p>'};
    const row=draft.row,credit=availableCredit(ctx),notice=draft.message?'<p class="onx-spot-purchase-note" role="status">'+ctx.esc(draft.message)+'</p>':'';
    if(type==='spot-review')return {title:'Review Spot purchase',body:'<form data-form="spot-checkout-review" class="onx-spot-purchase" novalidate>'+hourlySummary(ctx,row,draft,true)+notice+'<label class="form-label">SSH Public Key <span class="muted">(optional)</span><textarea class="field" name="sshPublicKey" data-spot-ssh rows="4" maxlength="16384" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Paste your SSH public key">'+ctx.esc(draft.sshRaw||'')+'</textarea></label><p class="form-note">Add your SSH public key now to access your instance as soon as it is ready, or set it up later in Instances.</p><p class="onx-spot-purchase-error" data-spot-checkout-error role="alert"></p><div class="modal-footer"><button type="button" class="btn secondary" data-act="spot-checkout-cancel">Cancel</button><button type="submit" class="btn">Proceed to payment</button></div></form>'};
    if(type==='spot-payment-choice')return {title:'Choose payment',body:'<div class="onx-spot-purchase">'+hourlySummary(ctx,row,draft)+notice+'<div class="onx-spot-payment-options"><button type="button" data-act="spot-checkout-credit" '+(draft.busy?'disabled':'')+'><span><strong>Pay by Credit</strong><small class="onx-spot-credit-available'+(insufficientCredit(ctx,draft)?' is-insufficient':'')+'">Available Credit: '+(credit===null?'—':usd(credit))+'</small></span><span aria-hidden="true">→</span></button><button type="button" data-act="spot-checkout-direct"><span><strong>Direct Pay</strong><small>Pay with a payment provider</small></span><span aria-hidden="true">→</span></button></div><p class="onx-spot-purchase-error" data-spot-checkout-error role="alert"></p><div class="modal-footer"><button type="button" class="btn secondary" data-act="spot-checkout-review">Back to review</button></div></div>'};
    if(type==='spot-credit-confirm')return {title:'Confirm Credit payment',body:'<div class="onx-spot-purchase">'+hourlySummary(ctx,row,draft)+creditMarkup(ctx,draft)+notice+'<p class="onx-spot-purchase-error" data-spot-checkout-error role="alert"></p><div class="modal-footer"><button type="button" class="btn secondary" data-act="spot-checkout-payment">Back</button><button type="button" class="btn" data-act="'+(insufficientCredit(ctx,draft)?'spot-checkout-deposit':'spot-checkout-authorize')+'" '+(draft.busy?'disabled':'')+'>'+(insufficientCredit(ctx,draft)?'Deposit Credit':'Confirm Credit payment')+'</button></div></div>'};
    return {title:'Purchase confirmed',body:'<div class="onx-spot-purchase"><p>Your order was confirmed by OpenNEXT.</p><p class="form-note">Order '+ctx.esc(draft.orderId||'')+'. Provisioning updates will appear in Instances.</p><div class="modal-footer"><button type="button" class="btn" data-act="spot-checkout-instances">View Instances</button></div></div>'};
  }
  function showError(ctx,message){const node=scope.document?.querySelector('[data-spot-checkout-error]');if(node)node.textContent=message;ctx.toast(message);}
  async function validateSsh(value){
    const text=String(value||'').trim();if(!text)return '';
    const api=scope.OpenNEXTAccountProfile;if(!api?.validatePublicKey||!api?.fingerprint)throw new Error('SSH public key validation is unavailable. Leave the field empty and add a key later in Instances.');
    const parsed=api.validatePublicKey(text);await api.fingerprint(parsed);return parsed.publicKey;
  }
  async function refreshCredit(ctx){
    const draft=pending(ctx),id=owner(ctx),service=scope.OpenNEXTSpotCheckout;
    if(!draft)throw new Error('The purchase draft is no longer available.');
    let result;
    if(typeof service?.getCreditBalance==='function')result=await service.getCreditBalance();
    else if(typeof scope.OpenNEXTExchange?.refreshBillingAccount==='function')result=await scope.OpenNEXTExchange.refreshBillingAccount(ctx.S);
    else throw Object.assign(new Error('Your available Credit could not be refreshed. Please try again.'),{code:'CREDIT_SERVICE_UNAVAILABLE'});
    if(owner(ctx)!==id||pending(ctx)!==draft)throw new Error('Your account changed. Review the purchase again.');
    const value=Number(result?.availableCredit);
    if(result?.confirmed!==true||result.accountId!==ctx.S.user?.id||result.currency!=='USD'||result.availableCredit===null||result.availableCredit===undefined||!Number.isFinite(value)||value<0)throw new Error('The account service did not confirm your available Credit.');
    ctx.S.balance=round(value);draft.balanceNeedsRefresh=false;return ctx.S.balance;
  }
  function openTopup(ctx){const draft=pending(ctx);if(!draft)return;draft.stage='topup';draft.balanceNeedsRefresh=true;draft.message='';savePending(ctx);ctx.open('pay-start',{spotCheckout:true});}
  function resumeCheckout(ctx){
    const draft=pending(ctx);if(!draft){ctx.toast('There is no saved Spot purchase in this account.');return false;}
    try{liveRow(ctx);}catch(error){showError(ctx,error.message);return true;}
    if(draft.reviewRequired){draft.stage='review';ctx.open('spot-review');return true;}
    draft.stage='payment';draft.message='';ctx.open('spot-payment-choice');return true;
  }
  async function chooseCredit(ctx){
    const draft=pending(ctx);if(!draft||draft.busy)return;draft.busy=true;
    try{
      if(draft.stage!=='payment')throw new Error('Review the purchase and choose a payment method first.');
      const row=liveRow(ctx);if(draft.reviewRequired){ctx.open('spot-review');return;}
      let balance=availableCredit(ctx);
      if(draft.balanceNeedsRefresh){
        try{balance=await refreshCredit(ctx);}catch(error){
          // A known shortfall can still offer Deposit Credit; authorizing a
          // purchase always requires a fresh, verified account balance.
          if(error.code!=='CREDIT_SERVICE_UNAVAILABLE'||pending(ctx)!==draft||balance===null||!insufficientCredit(ctx,draft))throw error;
        }
      }
      if(pending(ctx)!==draft)return;const fresh=liveRow(ctx);if(draft.reviewRequired){ctx.open('spot-review');return;}
      if(balance===null)throw new Error('Your available Credit has not been confirmed.');
      checkoutTotals(fresh,draft.hoursRaw);
      draft.stage='confirm';draft.message='';ctx.open('spot-credit-confirm');
    }catch(error){showError(ctx,error.message);}finally{draft.busy=false;scope.document?.querySelectorAll('[data-act="spot-checkout-credit"],[data-act="spot-checkout-authorize"],[data-act="spot-checkout-deposit"]').forEach(button=>button.disabled=false);}
  }
  async function authorizeCredit(ctx){
    const draft=pending(ctx);if(!draft||draft.busy)return;draft.busy=true;
    const button=scope.document?.querySelector('[data-act="spot-checkout-authorize"]');if(button)button.disabled=true;
    try{
      if(draft.stage!=='confirm')throw new Error('Confirm the purchase duration and total before authorizing payment.');
      const row=liveRow(ctx);if(ctx.S.role!=='Buyer')throw new Error('A Buyer account is required to purchase capacity.');if(draft.reviewRequired)throw new Error('Review the updated offer before authorizing payment.');
      const confirmedHours=durationHours(draft.hoursRaw),confirmedSsh=draft.sshPublicKey,expectedSignature=signature(row),expectedPricing=checkoutTotals(row,confirmedHours);
      const confirmDetails=()=>{if(durationHours(draft.hoursRaw)!==confirmedHours||draft.sshPublicKey!==confirmedSsh)throw new Error('The purchase duration or SSH key changed. Review the updated purchase before paying.');};
      if(scope.OpenNEXTDemo?.active||ctx.S.user?.demo||row.previewOnly||row.sourceKind!=='agent'||draft.row.previewOnly||draft.row.sourceKind!=='agent')throw new Error('This purchase flow is for testing only. No Credit was charged and no order or instance was created.');
      const balance=await refreshCredit(ctx);
      confirmDetails();
      if(Math.round(balance*100)<expectedPricing.totalCents){draft.busy=false;ctx.open('spot-credit-confirm');return;}
      if(typeof scope.OpenNEXTSpotCheckout?.beginPurchase!=='function')throw new Error('Credit payment is not connected yet. No Credit was charged and no order was created.');
      const ssh=await validateSsh(confirmedSsh);
      if(pending(ctx)!==draft||owner(ctx)!==draft.owner)return;
      confirmDetails();
      const fresh=liveRow(ctx);if(draft.reviewRequired||signature(fresh)!==expectedSignature)throw new Error('The offer changed during validation. Review its current price before paying.');
      // The backend must authorize the session, lock the offer, independently
      // calculate the duration subtotal and 5% fee, check funds and apply idempotency.
      // This duration-based contract must not fall back to the old metered adapter.
      // getCreditBalance() -> {confirmed:true,accountId,currency:'USD',availableCredit}
      // beginPurchase({pricingVersion:'duration-v1',offerId,durationHours,
      //   expectedPricing:{currency,hourlyCents,baseCents,feeCents,totalCents,durationHours},
      //   sshPublicKey,idempotencyKey}) -> {confirmed:true,offerId,orderId,
      //   currency:'USD',durationHours,totalCents}. No client ledger changes.
      draft.paymentSubmitted=true;savePending(ctx);
      const result=await scope.OpenNEXTSpotCheckout.beginPurchase({pricingVersion:'duration-v1',offerId:fresh.id,durationHours:expectedPricing.durationHours,expectedPricing,sshPublicKey:ssh||null,idempotencyKey:draft.idempotencyKey});
      if(owner(ctx)!==draft.owner||pending(ctx)!==draft)return;
      if(result?.confirmed!==true||result.offerId!==fresh.id||typeof result.orderId!=='string'||!result.orderId||result.orderId.length>200||result.currency!=='USD'||result.durationHours!==expectedPricing.durationHours||result.totalCents!==expectedPricing.totalCents)throw new Error('The purchase total and duration have not been confirmed. Check your order status before trying again.');
      draft.orderId=result.orderId;draft.stage='completed';clearStored(ctx);ctx.open('spot-purchase-complete');
    }catch(error){showError(ctx,error.message);}finally{draft.busy=false;if(button?.isConnected)button.disabled=false;}
  }
  function action(ctx,act){
    if(!act.startsWith('spot-checkout-'))return false;
    const draft=pending(ctx);
    if(act==='spot-checkout-resume'){resumeCheckout(ctx);return true;}
    if(!draft){ctx.toast('Choose a Spot offer to start a purchase.');return true;}
    if(draft.busy){ctx.toast('Please wait for the current payment step to finish.');return true;}
    if(draft.paymentSubmitted&&['spot-checkout-cancel','spot-checkout-review'].includes(act)){ctx.toast('Payment confirmation is pending. Check your order status before changing or cancelling this purchase.');return true;}
    if(act==='spot-checkout-cancel'){clearStored(ctx);state.checkout=null;ctx.S.modal=null;ctx.render();return true;}
    if(act==='spot-checkout-review'){draft.stage='review';draft.message='';ctx.open('spot-review');return true;}
    if(act==='spot-checkout-payment'){draft.stage='payment';draft.message='';ctx.open('spot-payment-choice');return true;}
    if(act==='spot-checkout-credit'){chooseCredit(ctx);return true;}
    if(act==='spot-checkout-deposit'){if(draft.stage==='confirm'&&!draft.busy)openTopup(ctx);return true;}
    if(act==='spot-checkout-direct'){showError(ctx,'Direct Pay is not connected yet. No payment was taken and no order was created.');return true;}
    if(act==='spot-checkout-authorize'){authorizeCredit(ctx);return true;}
    if(act==='spot-checkout-instances'){state.checkout=null;ctx.go('instances');return true;}
    return false;
  }
  async function reviewPurchase(ctx,form,data){
    const draft=pending(ctx),button=form.querySelector('[type="submit"]');if(!draft||draft.busy)return;draft.busy=true;if(button)button.disabled=true;
    try{
      if(draft.paymentSubmitted)throw new Error('Payment confirmation is pending. Check your order status before changing this purchase.');
      const hours=durationHours(data.durationHours),reviewedSignature=signature(liveRow(ctx));checkoutTotals(draft.row,hours);
      draft.hoursRaw=String(data.durationHours);const ssh=await validateSsh(data.sshPublicKey);
      if(pending(ctx)!==draft)return;
      const currentRow=liveRow(ctx);if(signature(currentRow)!==reviewedSignature)throw new Error('The offer changed during validation. Review the updated price before continuing.');
      if(durationHours(draft.hoursRaw)!==hours)throw new Error('The usage duration changed. Review the total before continuing.');
      if(draft.durationHours!==hours||draft.sshPublicKey!==ssh)draft.idempotencyKey=scope.crypto.randomUUID();
      draft.durationHours=hours;draft.hoursRaw=String(hours);draft.sshPublicKey=ssh;draft.sshRaw=ssh;draft.reviewRequired=false;draft.message='';draft.stage='payment';draft.busy=false;ctx.open('spot-payment-choice');
    }
    catch(error){const node=form.querySelector('[data-spot-checkout-error]');if(node&&form.isConnected)node.textContent=error.message;ctx.toast(error.message);}
    finally{draft.busy=false;if(button?.isConnected)button.disabled=false;}
  }
  function submit(ctx,form,data){if(form.dataset.form!=='spot-checkout-review')return false;reviewPurchase(ctx,form,data);return true;}

  function render(ctx) {
    lastContext = ctx;
    const inventory = inventoryState();
    const allRows = inventory.rows;
    pruneSelections(allRows);
    const filtered = filteredRows(allRows);
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    state.page = Math.max(0, Math.min(state.page, pages - 1));
    const start = state.page * PAGE_SIZE;
    const visible = filtered.slice(start, start + PAGE_SIZE);
    const rangeStart = filtered.length ? start + 1 : 0;
    const rangeEnd = Math.min(start + PAGE_SIZE, filtered.length);
    const esc = ctx.esc;
    return '<section class="onx-spot-market" data-spot-market data-source-kind="' + inventory.kind + '">' +
      '<div class="onx-spot-market-head"><div><span class="eyebrow">AI CAPACITY MARKET</span><h1>GPU Market</h1></div><div class="onx-spot-market-actions"><div class="onx-spot-tabs" role="tablist" aria-label="GPU market terms">' + TERMS.map(term => '<button type="button" role="tab" data-spot-term="' + term + '" aria-selected="' + (state.term === term) + '" class="' + (state.term === term ? 'active' : '') + '">' + term + '</button>').join('') + '</div><button type="button" class="btn small onx-spot-post-rfq" data-act="new-rfq">Post RFQ</button></div></div>' +
      '<div class="onx-spot-toolbar"><button type="button" class="btn secondary small" data-spot-toggle-filters aria-expanded="' + state.showFilters + '">' + icon('sliders-horizontal') + 'Filters' + (selectedCount() ? ' · ' + selectedCount() : '') + '</button><span class="onx-spot-result-count" role="status">' + filtered.length + ' offer' + (filtered.length === 1 ? '' : 's') + ' · ' + esc(state.term) + '</span><select class="field" data-spot-sort aria-label="Sort offers">' + SORTS.map(([value, label]) => '<option value="' + value + '" ' + (state.sort === value ? 'selected' : '') + '>' + label + '</option>').join('') + '</select><div class="onx-spot-view"><button type="button" class="icon-btn ' + (state.view === 'list' ? 'selected' : '') + '" data-spot-view="list" aria-label="List view" aria-pressed="' + (state.view === 'list') + '">' + icon('list') + '</button><button type="button" class="icon-btn ' + (state.view === 'cards' ? 'selected' : '') + '" data-spot-view="cards" aria-label="Card view" aria-pressed="' + (state.view === 'cards') + '">' + icon('layout-grid') + '</button></div></div>' +
      '<div class="onx-spot-layout ' + (state.showFilters ? '' : 'filters-hidden') + '"><aside class="onx-spot-filters" ' + (state.showFilters ? '' : 'hidden') + ' aria-label="Offer filters"><div class="onx-spot-filter-head"><strong>Filter offers</strong><button type="button" data-spot-reset>Reset</button></div>' + GROUPS.slice(0, 2).map(group => filterGroup(ctx, group, allRows)).join('') + priceFilter(ctx, allRows) + GROUPS.slice(2).map(group => filterGroup(ctx, group, allRows)).join('') + '</aside><section class="onx-spot-results" aria-label="' + esc(state.term) + ' GPU offers">' + (state.view === 'list' ? tableView(ctx, visible) : cardView(ctx, visible)) + '<footer class="onx-spot-pagination"><span>' + rangeStart + '–' + rangeEnd + ' of ' + filtered.length + ' offers</span><div><button type="button" class="icon-btn" data-spot-page="-1" aria-label="Previous page" ' + (state.page === 0 ? 'disabled' : '') + '>' + icon('chevron-left') + '</button><span>' + (state.page + 1) + ' / ' + pages + '</span><button type="button" class="icon-btn" data-spot-page="1" aria-label="Next page" ' + (state.page >= pages - 1 ? 'disabled' : '') + '>' + icon('chevron-right') + '</button></div></footer></section></div>' +
      (hasPending(ctx)&&!ctx.S.modal?'<button type="button" class="btn secondary small onx-spot-resume" data-act="spot-checkout-resume">Continue purchase</button>':'') + '</section>';
  }

  function findCurrentRow(key) { return inventoryState().rows.find(row => row._key === key); }
  function refresh(ctx, focusSelector) {
    ctx.render();
    if (focusSelector) requestAnimationFrame(() => document.querySelector('[data-spot-market] ' + focusSelector)?.focus({preventScroll: true}));
  }
  function bind(ctx) {
    lastContext = ctx;
    if(!inputBound){inputBound=true;scope.document.addEventListener('input',event=>{
      const draft=lastContext&&pending(lastContext);if(!draft)return;
      if(event.target.matches('[data-spot-ssh]'))draft.sshRaw=event.target.value;
      if(event.target.matches('[data-spot-hours]')){
        draft.hoursRaw=event.target.value;
        const form=event.target.closest('form'),summary=form?.querySelector('[data-spot-checkout-totals]');
        if(summary)summary.innerHTML=totalsMarkup(draft.row,draft.hoursRaw);
        const error=form?.querySelector('[data-spot-checkout-error]');if(error)error.textContent='';
      }
    },true);}
    const root = document.querySelector('[data-spot-market]');
    if (!root || root.dataset.spotBound === 'true') return;
    root.dataset.spotBound = 'true';
    scope.lucide?.createIcons?.({attrs: {width: 16, height: 16}});

    root.addEventListener('toggle', event => {
      const key = event.target?.dataset?.spotGroup;
      if (!key) return;
      if (event.target.open && !state.openGroups.includes(key)) state.openGroups.push(key);
      else if (!event.target.open) state.openGroups = state.openGroups.filter(value => value !== key);
    }, true);

    root.addEventListener('input', event => {
      const target = event.target;
      if (target.dataset.spotSearch) {
        state.search[target.dataset.spotSearch] = target.value;
        const options = target.closest('.onx-spot-filter-options');
        const query = target.value.trim().toLowerCase();
        let shown = 0;
        options?.querySelectorAll('[data-spot-option-row]').forEach(row => {
          row.hidden = !!query && !row.dataset.spotOptionRow.includes(query);
          if (!row.hidden) shown += 1;
        });
        const empty = options?.querySelector('.onx-spot-no-options');
        if (empty) empty.hidden = shown > 0;
      } else if (target.matches('[data-spot-price-range]')) {
        const value = Number(target.value);
        const numberInput = root.querySelector('[data-spot-price-number]');
        const output = root.querySelector('[data-spot-price-output]');
        if (numberInput) numberInput.value = value.toFixed(2);
        if (output) output.textContent = 'Up to ' + usd(value);
      }
    });

    root.addEventListener('change', event => {
      const target = event.target;
      if (target.dataset.spotOption) {
        const key = target.dataset.spotOption;
        const current = state.selected[key];
        state.selected[key] = target.checked ? [...new Set([...current, target.value])] : current.filter(value => value !== target.value);
        state.page = 0;
        refresh(ctx, '[data-spot-option="' + selectorEscape(key) + '"][value="' + selectorEscape(target.value) + '"]');
      } else if (target.dataset.spotAll) {
        state.selected[target.dataset.spotAll] = [];
        state.page = 0;
        refresh(ctx, '[data-spot-all="' + selectorEscape(target.dataset.spotAll) + '"]');
      } else if (target.hasAttribute('data-spot-price-all')) {
        state.maxPrice = null;
        state.page = 0;
        refresh(ctx, '[data-spot-price-all]');
      } else if (target.matches('[data-spot-price-number]')) {
        const value = target.value.trim() === '' ? null : Number(target.value);
        state.maxPrice = value === null || !Number.isFinite(value) || value < 0 ? null : round(value);
        state.page = 0;
        refresh(ctx, '[data-spot-price-number]');
      } else if (target.matches('[data-spot-price-range]')) {
        state.maxPrice = round(Number(target.value));
        state.page = 0;
        refresh(ctx, '[data-spot-price-range]');
      } else if (target.matches('[data-spot-sort]')) {
        state.sort = SORTS.some(([value]) => value === target.value) ? target.value : 'recent';
        state.page = 0;
        refresh(ctx, '[data-spot-sort]');
      }
    });

    root.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || button.disabled) {
        return;
      }
      if (button.dataset.spotTerm) {
        state.term = canonicalTerm(button.dataset.spotTerm);
        state.maxPrice = null;
        state.page = 0;
        refresh(ctx, '[data-spot-term="' + selectorEscape(state.term) + '"]');
      } else if (button.dataset.spotView) {
        state.view = button.dataset.spotView === 'cards' ? 'cards' : 'list';
        state.page = 0;
        refresh(ctx, '[data-spot-view="' + state.view + '"]');
      } else if (button.hasAttribute('data-spot-toggle-filters')) {
        state.showFilters = !state.showFilters;
        refresh(ctx, '[data-spot-toggle-filters]');
      } else if (button.hasAttribute('data-spot-reset')) {
        state.selected = {model: [], country: [], vcpu: [], memory: []};
        state.search = {model: '', country: ''};
        state.maxPrice = null;
        state.page = 0;
        refresh(ctx, '[data-spot-reset]');
      } else if (button.dataset.spotPage) {
        state.page += Number(button.dataset.spotPage);
        refresh(ctx, '[data-spot-page="' + selectorEscape(button.dataset.spotPage) + '"]');
      } else if (button.dataset.spotBuy) {
        const row = findCurrentRow(button.dataset.spotBuy);
        if (!row || row.term !== 'Spot') { ctx.toast('This Spot offer is no longer available in the preview.'); return; }
        beginCheckout(ctx,row);
      } else if (button.dataset.spotQuote) {
        const row = findCurrentRow(button.dataset.spotQuote);
        if (!row) { ctx.toast('This offer is no longer available.'); return; }
        if (scope.OpenNEXTQuotePreview?.open) scope.OpenNEXTQuotePreview.open(ctx, offerFor(row));
        else ctx.toast('Quote preview is not available yet.');
      }
    });
  }

  scope.OpenNEXTSpotMarket = {render, bind, setInventory, modal, action, submit, hasPending, resumeCheckout, purchaseReference:ctx=>pending(ctx)?.idempotencyKey||null, testHelpers:{state,normalizeRow,durationHours,checkoutTotals,signature,pending,beginCheckout,liveRow,validateSsh,refreshCredit,openTopup,chooseCredit,authorizeCredit,reviewPurchase,offerFor,tableView,cardView,inventoryState}};
})(typeof window !== 'undefined' ? window : globalThis);
