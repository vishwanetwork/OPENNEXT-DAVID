'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {gunzipSync} = require('node:zlib');
const http = require('node:http');
const https = require('node:https');
const {AWS_INSTANCE_SPECS, normalizeAws} = require('./OpenNEXT-pricing-service.cjs');
const {AWS_REGIONS} = require('./OpenNEXT-pricing-registry.cjs');

const TERMS = ['Spot', 'On-demand', 'Reserved'];
const MINUTE = 60000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const SYNC_INTERVAL = 5 * MINUTE;
// A segment stays open while consecutive syncs keep observing the same value.
const SEGMENT_GAP = 15 * MINUTE;
// Bot list prices (AWS Price List) refresh every six hours, so they stay current for two refreshes.
const BOT_TTL = 15 * MINUTE, PUBLIC_TTL = 2 * HOUR, LIST_TTL = 13 * HOUR;
const RETENTION = 365 * DAY, MAX_SEGMENTS = 500000;
// Bot history is imported once per reference offering, newest first, within these bounds.
const HISTORY_SPAN = 90 * DAY, HISTORY_PAGES = 100, HISTORY_RETRY = 10 * MINUTE;
// [window, bucket]: coarser buckets keep every period at a few hundred points.
const PERIODS = {'1D': [DAY, 5 * MINUTE], '1W': [7 * DAY, 30 * MINUTE], '1M': [30 * DAY, 2 * HOUR],
  '3M': [90 * DAY, 6 * HOUR]};
// Chart areas: every AWS Region with GPU instances. Other suppliers join an area only on an exact code.
const AWS_AREAS = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'sa-east-1', 'eu-central-1', 'eu-west-1',
  'eu-west-2', 'eu-west-3', 'eu-north-1', 'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3', 'ap-south-1', 'ap-southeast-1',
  'ap-southeast-2', 'me-central-1'];
const AREAS = new Set([...AWS_AREAS, ...AWS_REGIONS.map(([id]) => id)]);
const areaOrder = area => {const index = AWS_AREAS.indexOf(area); return index < 0 ? AWS_AREAS.length + (area ? 0 : 1) : index;};
// Azure regions are mapped onto chart areas only where the geography is equivalent.
const AZURE_AREAS = {eastus: 'us-east-1', eastus2: 'us-east-1', westus2: 'us-west-2', northeurope: 'eu-west-1',
  germanywestcentral: 'eu-central-1', southeastasia: 'ap-southeast-1', japaneast: 'ap-northeast-1',
  koreacentral: 'ap-northeast-2', uaenorth: 'me-central-1'};
// Nominal per-GPU memory for AWS GPUs whose instance specs omit it; AWS reports usable MiB (A10G: 22,888).
const AWS_MEMORY = {A10G: 24, L4: 24, L40S: 48, T4: 16, T4G: 16, V520: 8};
const AWS_FORMS = {p4d: 'SXM4', p4de: 'SXM4', p5: 'SXM5', p5e: 'SXM5', p5en: 'SXM5', 'p6-b200': 'SXM6', 'p6-b300': 'SXM6'};
// Whole-GPU Azure sizes from the Azure VM size documentation. Partial-GPU sizes and sizes whose
// GPU count is not documented are omitted rather than inferred.
const AZURE_SPECS = {};
for (const [sku, model, count, memory, form] of [
  ['NC24ads_A100_v4', 'A100', 1, 80, 'PCIe'], ['NC48ads_A100_v4', 'A100', 2, 80, 'PCIe'], ['NC96ads_A100_v4', 'A100', 4, 80, 'PCIe'],
  ['ND96asr_v4', 'A100', 8, 40, 'SXM4'], ['ND96amsr_A100_v4', 'A100', 8, 80, 'SXM4'],
  ['NC40ads_H100_v5', 'H100', 1, 94, 'NVL'], ['NC80adis_H100_v5', 'H100', 2, 94, 'NVL'],
  ['ND96isr_H100_v5', 'H100', 8, 80, 'SXM5'], ['ND96isr_H200_v5', 'H200', 8, 141, 'SXM5'], ['ND96isr_MI300X_v5', 'MI300X', 8, 192, 'OAM'],
  ['NC4as_T4_v3', 'T4', 1, 16, 'PCIe'], ['NC8as_T4_v3', 'T4', 1, 16, 'PCIe'], ['NC16as_T4_v3', 'T4', 1, 16, 'PCIe'], ['NC64as_T4_v3', 'T4', 4, 16, 'PCIe'],
  ['NV36ads_A10_v5', 'A10', 1, 24, 'PCIe'], ['NV72ads_A10_v5', 'A10', 2, 24, 'PCIe'],
  ['NC6s_v3', 'V100', 1, 16, null], ['NC12s_v3', 'V100', 2, 16, null], ['NC24s_v3', 'V100', 4, 16, null], ['ND40rs_v2', 'V100', 8, 32, 'SXM2'],
]) AZURE_SPECS['Standard_' + sku] = {model, count, memory, form};

const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;
const knownTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const round = value => Math.round(value * 1e6) / 1e6;
const iso = time => new Date(time).toISOString();

// Providers spell the same GPU differently (RTX4090, RTXPRO6000, NVIDIA L4).
function canonicalModel(value) {
  const text = String(value || '').toUpperCase().replace(/_/g, ' ').replace(/^(NVIDIA|AMD)\s+/, '').replace(/\s+/g, ' ').trim();
  let match;
  if ((match = /RTX\s*PRO\s*(?:SERVER\s*)?(\d{4})/.exec(text))) return 'RTX PRO ' + match[1];
  if ((match = /RTX\s*(A?)\s*(\d{4})(\s*ADA)?/.exec(text))) return `RTX ${match[1]}${match[2]}${match[3] ? ' ADA' : ''}`;
  if ((match = /^A([2-6]000)\b/.exec(text))) return 'RTX A' + match[1];
  return text.replace(/\s*\(.*\)$/, '');
}
function formOf(value) {
  const match = /(SXM\d*|PCIE|NVL|OAM)/i.exec(String(value || ''));
  return match ? (match[1].toUpperCase() === 'PCIE' ? 'PCIe' : match[1].toUpperCase()) : null;
}
const groupKey = (provider, cloud, sku, region) => [provider, cloud, sku, region].join('|');

// The chart's Reserved line is a one-year commitment with no upfront payment.
const chartReserved = offer => offer.details?.lease_contract_length === '1yr' && offer.details?.purchase_option === 'No Upfront';

function normalizeBot(offer) {
  if (!['spot', 'on_demand', 'reserved'].includes(offer?.market) || (offer.market === 'reserved' && !chartReserved(offer)) ||
      !positive(offer.price_hourly) ||
      !Number.isInteger(offer.gpu_count) || offer.gpu_count < 1 || !knownTime(offer.observed_at) ||
      offer.details?.gpu_count_kind === 'logical') return null;
  const aws = offer.provider === 'aws', spec = aws ? AWS_INSTANCE_SPECS[offer.sku] : null;
  const description = String(offer.gpu_description || '');
  const mib = offer.details?.gpu_specifications?.[0]?.MemoryInfo?.SizeInMiB;
  const described = /\b(\d+)\s*GB\b/i.exec(description);
  return {
    id: String(offer.offer_id), group: groupKey(offer.provider, offer.cloud, offer.sku, offer.region),
    area: aws || AREAS.has(offer.region) ? offer.region : null,
    model: spec?.gpuModel || canonicalModel(offer.gpu_model), count: offer.gpu_count,
    memory: spec?.gpuMemoryGb ?? AWS_MEMORY[spec?.gpuModel] ?? (positive(offer.details?.vram_per_gpu_gb) ? Number(offer.details.vram_per_gpu_gb) :
      positive(mib) ? Math.round(mib / 1024) : described ? Number(described[1]) : null),
    form: aws ? AWS_FORMS[offer.sku.split('.')[0]] || null : formOf(offer.details?.interconnect) || formOf(description),
    term: {spot: 'Spot', on_demand: 'On-demand', reserved: 'Reserved'}[offer.market],
    value: Number(offer.price_hourly) / offer.gpu_count,
    // Price-only Regions refresh hourly in the bot, so their Spot quotes stay current for two hours.
    observedAt: Date.parse(offer.observed_at),
    ttl: offer.price_kind === 'list' ? LIST_TTL : offer.details?.eligibility_status === 'price_only_region' ? PUBLIC_TTL : BOT_TTL,
    ...(knownTime(offer.effective_at) ? {since: Date.parse(offer.effective_at)} : {}),
  };
}

function awsQuote(sku, region, term, value, observedAt, extra = {}) {
  const spec = AWS_INSTANCE_SPECS[sku];
  return {id: sku + '|' + term, group: groupKey('aws', 'aws', sku, region), area: region,
    model: spec.gpuModel, count: spec.gpuCount, memory: spec.gpuMemoryGb ?? AWS_MEMORY[spec.gpuModel] ?? null,
    form: AWS_FORMS[sku.split('.')[0]] || null, term, value, observedAt, ttl: PUBLIC_TTL, ...extra};
}

function normalizePublic(payload, region, term, observedAt, sourceUrl = null) {
  const time = typeof observedAt === 'number' ? observedAt : Date.parse(observedAt);
  if (term === 'On-demand') return normalizeAws(payload, region, sourceUrl, iso(time)).records
    .map(row => awsQuote(row.instanceType, region, term, row.perGpuHourly, time, row.formFactor ? {form: row.formFactor} : {}));
  if (!payload?.regions || payload.manifest?.currencyCode !== 'USD') throw Error('Invalid reserved price schema');
  const rows = [];
  for (const entries of Object.values(payload.regions)) for (const row of Object.values(entries || {})) {
    const spec = AWS_INSTANCE_SPECS[row['Instance Type']];
    if (!spec || !positive(row.price) || row.LeaseContractLength !== '1yr' || row.PurchaseOption !== 'No Upfront' ||
        row['Operating System'] !== 'Linux' || row.Tenancy !== 'Shared' || row['Pre Installed S/W'] !== 'NA') continue;
    rows.push(awsQuote(row['Instance Type'], region, 'Reserved', Number(row.price) / spec.gpuCount, time));
  }
  return rows;
}

function normalizeAzure(items, region, observedAt, now = observedAt) {
  const best = new Map();
  for (const item of items) {
    const spec = AZURE_SPECS[item?.armSkuName];
    if (!spec || item.armRegionName !== region || item.currencyCode !== 'USD' || item.serviceName !== 'Virtual Machines' ||
        /windows/i.test(item.productName) || item.unitOfMeasure !== '1 Hour' || !positive(item.retailPrice)) continue;
    const effective = Date.parse(item.effectiveStartDate);
    if (!Number.isFinite(effective) || effective > now) continue;
    let term, hourly = Number(item.retailPrice);
    if (item.type === 'Consumption' && / Spot$/.test(item.skuName)) term = 'Spot';
    else if (item.type === 'Consumption' && !/Spot|Low Priority/.test(item.skuName)) term = 'On-demand';
    // Reservation retail prices are the total for the term; Azure also bills them monthly with no upfront.
    else if (item.type === 'Reservation' && item.reservationTerm === '1 Year') {term = 'Reserved'; hourly /= 365 * 24;}
    else continue;
    const key = item.armSkuName + '|' + term, previous = best.get(key);
    if (!previous || effective > previous.effective || (effective === previous.effective && hourly < previous.hourly))
      best.set(key, {sku: item.armSkuName, spec, term, hourly, effective});
  }
  const rows = [];
  for (const {sku, spec, term, hourly, effective} of best.values()) {
    // Some Spot meters repeat the On-demand rate as a placeholder; that is not a Spot discount.
    const onDemand = best.get(sku + '|On-demand');
    if (term === 'Spot' && onDemand && hourly >= onDemand.hourly) continue;
    rows.push({id: sku + '|' + term, group: groupKey('azure', 'azure', sku, region), area: AZURE_AREAS[region] || null,
      model: spec.model, count: spec.count, memory: spec.memory, form: spec.form,
      // A published rate applies from its effective date, so its history starts there.
      term, value: hourly / spec.count, observedAt, since: effective, ttl: PUBLIC_TTL});
  }
  return rows;
}

function matches(spec, filters) {
  return (!filters.gpuModel || spec.model === filters.gpuModel) &&
    (filters.gpuCount === undefined || spec.count === Number(filters.gpuCount)) &&
    (!filters.region || filters.region === 'all' || spec.area === filters.region) &&
    (filters.gpuMemoryGb === undefined || spec.memory === Number(filters.gpuMemoryGb)) &&
    (!filters.formFactor || String(spec.form || '').toLowerCase().startsWith(String(filters.formFactor).toLowerCase()));
}

function createCapacityPriceService({env = process.env, dataDir, fetchImpl = globalThis.fetch, clock = Date.now} = {}) {
  const directory = path.resolve(dataDir || env.OPENNEXT_PRICING_DATA_DIR || path.join(__dirname, '.opennext-data'));
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  const stateFile = path.join(directory, 'capacity-state.json');
  const logFile = path.join(directory, 'capacity-segments.jsonl');
  const botKey = env.OPENNEXT_SPOTBOT_API_KEY || '';
  const botUrl = env.OPENNEXT_SPOTBOT_URL || '';
  if (botUrl) {
    const parsed = new URL(botUrl);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw Error('SpotOrderBot requires HTTPS');
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw Error('Invalid SpotOrderBot URL');
  }
  const configured = Boolean(botKey && botUrl);
  const list = value => String(value).split(',').map(item => item.trim()).filter(Boolean);
  const awsRegions = AWS_REGIONS.filter(([id]) => list(env.OPENNEXT_CAPACITY_REGIONS ?? 'us-west-2,us-east-1').includes(id));
  const azureRegions = list(env.OPENNEXT_AZURE_REGIONS ?? 'eastus,westus2').filter(region => /^[a-z0-9]+$/.test(region));

  // Private state: group specs, open segments and the latest quotes per source. Closed segments are
  // appended to a log and only rewritten during compaction.
  const groups = new Map(), open = new Map(), archive = new Map();
  const imported = new Set(), spotHistory = new Map(), listHistory = new Map();
  let latest = {bot: [], aws: [], azure: []}, lastSync = null, publicFetchedAt = null, lastCompaction = 0, closedCount = 0, appends = [];
  const segmentKey = (group, term) => group + '\u0000' + term;
  function addClosed(segment) {
    if (!archive.has(segment.g)) archive.set(segment.g, []);
    archive.get(segment.g).push(segment); closedCount++;
  }
  function closeSegment(key, segment) {open.delete(key); addClosed(segment); appends.push(segment);}
  function remember(quote) {
    const spec = groups.get(quote.group);
    if (!spec) groups.set(quote.group, {model: quote.model, count: quote.count, memory: quote.memory, form: quote.form, area: quote.area});
    else for (const field of ['memory', 'form', 'area']) if (spec[field] == null && quote[field] != null) spec[field] = quote[field];
  }
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if ([2, 3].includes(saved.version)) {
      for (const [key, spec] of Object.entries(saved.groups || {})) groups.set(key, spec);
      for (const segment of saved.open || []) open.set(segmentKey(segment.g, segment.t), segment);
      latest = {...latest, ...saved.latest}; lastSync = saved.lastSync; publicFetchedAt = saved.publicFetchedAt;
      if (saved.version === 3) for (const group of saved.imported || []) imported.add(group);
      for (const [group, history] of Object.entries(saved.spotHistory || {})) spotHistory.set(group, history);
      for (const [group, history] of Object.entries(saved.listHistory || {})) listHistory.set(group, history);
    }
  } catch {}
  try {
    for (const line of fs.readFileSync(logFile, 'utf8').split('\n')) {
      if (!line) continue;
      try {const [g, t, v, f, l] = JSON.parse(line); if (TERMS.includes(t) && [v, f, l].every(Number.isFinite)) addClosed({g, t, v, f, l});} catch {}
    }
  } catch {}
  // A crash between appending a closed segment and rewriting state leaves it in both places.
  for (const [key, segment] of open) if (archive.get(segment.g)?.some(s => s.t === segment.t && s.f === segment.f)) open.delete(key);

  function persist() {
    if (appends.length) {fs.appendFileSync(logFile, appends.map(s => JSON.stringify([s.g, s.t, s.v, s.f, s.l])).join('\n') + '\n', {mode: 0o600}); appends = [];}
    const temp = stateFile + '.tmp';
    fs.writeFileSync(temp, JSON.stringify({version: 3, groups: Object.fromEntries(groups), open: [...open.values()],
      latest, lastSync, publicFetchedAt, imported: [...imported], spotHistory: Object.fromEntries(spotHistory), listHistory: Object.fromEntries(listHistory)}), {mode: 0o600});
    fs.renameSync(temp, stateFile);
  }
  function compact(now) {
    lastCompaction = now;
    let kept = [];
    for (const segments of archive.values()) for (const segment of segments) if (segment.l >= now - RETENTION) kept.push(segment);
    if (kept.length > MAX_SEGMENTS) kept = kept.sort((a, b) => a.l - b.l).slice(-MAX_SEGMENTS);
    if (kept.length === closedCount) return;
    archive.clear(); closedCount = 0; appends = [];
    for (const segment of kept) addClosed(segment);
    const temp = logFile + '.tmp';
    fs.writeFileSync(temp, kept.map(s => JSON.stringify([s.g, s.t, s.v, s.f, s.l]) + '\n').join(''), {mode: 0o600});
    fs.renameSync(temp, logFile);
    const used = new Set([...archive.keys(), ...[...open.values()].map(s => s.g), ...Object.values(latest).flat().map(q => q.group)]);
    for (const key of groups.keys()) if (!used.has(key)) groups.delete(key);
  }
  compact(clock());

  // Fresh quotes extend or replace open segments; anything no longer quoted is closed.
  function observe(quotes, now) {
    // The earliest start a new segment may take: just after the key's last closed segment before `before`.
    const floor = (group, term, before) => (archive.get(group) || [])
      .reduce((value, s) => s.t === term && s.l < before ? Math.max(value, s.l + 1) : value, now - RETENTION);
    const current = new Map();
    for (const quote of quotes) {
      remember(quote);
      const key = segmentKey(quote.group, quote.term), previous = current.get(key);
      // Equal rates from two sources keep the earliest published effective date.
      if (!previous || quote.value < previous.value) current.set(key, quote);
      else if (quote.value === previous.value && quote.since < (previous.since ?? Infinity)) current.set(key, quote);
    }
    for (const [key, segment] of open) if (!current.has(key)) closeSegment(key, segment);
    for (const [key, quote] of current) {
      const segment = open.get(key), value = round(quote.value);
      if (segment && segment.v === value && now - segment.l <= SEGMENT_GAP) {
        segment.l = now;
        if (quote.since < segment.f) segment.f = Math.max(quote.since, floor(quote.group, quote.term, segment.f));
        continue;
      }
      if (segment) closeSegment(key, segment);
      const start = Math.max(Math.min(quote.since ?? quote.observedAt, now), segment ? segment.l + 1 : floor(quote.group, quote.term, Infinity));
      open.set(key, {g: quote.group, t: quote.term, v: value, f: start, l: now});
    }
  }
  // Historical bot observations only fill time before a key's first recorded segment.
  function importHistory(quotes) {
    const byKey = new Map();
    for (const quote of quotes) {
      if (!quote) continue;
      remember(quote);
      const key = segmentKey(quote.group, quote.term), minute = Math.floor(quote.observedAt / MINUTE) * MINUTE;
      if (!byKey.has(key)) byKey.set(key, {group: quote.group, term: quote.term, points: new Map()});
      const points = byKey.get(key).points;
      if (!points.has(minute) || quote.value < points.get(minute)) points.set(minute, quote.value);
    }
    for (const [key, {group, term, points}] of byKey) {
      const starts = [...(archive.get(group) || []).filter(s => s.t === term), ...(open.has(key) ? [open.get(key)] : [])].map(s => s.f);
      const earliest = starts.length ? Math.min(...starts) : Infinity;
      let segment = null;
      for (const [time, raw] of [...points].sort((a, b) => a[0] - b[0])) {
        if (time >= earliest) break;
        const value = round(raw);
        if (segment && segment.v === value && time - segment.l <= SEGMENT_GAP) {segment.l = time; continue;}
        if (segment) {addClosed(segment); appends.push(segment);}
        segment = {g: group, t: term, v: value, f: time, l: time};
      }
      if (segment) {addClosed(segment); appends.push(segment);}
    }
  }

  const errors = new Set(), controllers = new Set(), importing = new Map(), importFailures = new Map();
  let pending = null, timer = null, closed = false, historyTail = Promise.resolve();
  async function get(url, authenticated = false) {
    if (closed) throw Error('Service closed');
    const controller = new AbortController(); controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), authenticated ? 90000 : 25000);
    try {
      const headers = {Accept: 'application/json', ...(authenticated ? {Authorization: 'Bearer ' + botKey} : {})};
      const options = {method: 'GET', redirect: 'error', signal: controller.signal, headers};
      // Use the built-in HTTPS transport for consistent TLS behavior across Node runtimes.
      const response = fetchImpl !== globalThis.fetch ? await fetchImpl(url, options) : await new Promise((resolve, reject) => {
        const transport = new URL(url).protocol === 'https:' ? https : http;
        const request = transport.get(url, {...options, headers: {...headers, 'Accept-Encoding': 'gzip'}},
          incoming => resolve({ok: incoming.statusCode === 200, body: incoming}));
        request.once('error', reject);
      });
      if (!response.ok) {response.body?.destroy?.(); throw Error('Price source unavailable');}
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {size += chunk.length; if (size > 12 * 1024 * 1024) throw Error('Price response too large'); chunks.push(chunk);}
      let body = Buffer.concat(chunks);
      if (body[0] === 0x1f && body[1] === 0x8b) body = gunzipSync(body, {maxOutputLength: 12 * 1024 * 1024});
      return JSON.parse(body.toString('utf8'));
    } finally {clearTimeout(timeout); controllers.delete(controller);}
  }
  async function pullBot() {
    if (!configured) return;
    const rows = []; let total = Infinity, failure = null;
    try {
      for (let offset = 0; offset < total; offset += 1000) {
        if (offset >= 20000) throw Error('Bot catalog pagination limit');
        const data = await get(new URL('/v1/prices/latest?limit=1000&offset=' + offset, botUrl).href, true);
        if (!Array.isArray(data.groups) || !Number.isInteger(data.total) || data.total < 0) throw Error('Invalid bot catalog');
        total = data.total;
        for (const group of data.groups) for (const offer of group.offers || []) {const row = normalizeBot(offer); if (row) rows.push(row);}
      }
    } catch (error) {failure = error;}
    // Pages that did arrive are real quotes; offers on failed pages keep their previous quote until it expires.
    const seen = new Set(rows.map(row => row.id));
    latest.bot = [...rows, ...(failure ? latest.bot.filter(row => !seen.has(row.id)) : [])];
    if (failure) throw failure;
    errors.delete('bot');
  }
  async function pullAzure(region, observedAt) {
    const skus = Object.keys(AZURE_SPECS), items = [];
    // The retail price API rejects long OR filters, so SKUs are requested in small batches.
    for (let index = 0; index < skus.length; index += 8) {
      const clause = skus.slice(index, index + 8).map(sku => `armSkuName eq '${sku}'`).join(' or ');
      let url = 'https://prices.azure.com/api/retail/prices?' + new URLSearchParams({$filter: `serviceName eq 'Virtual Machines' and armRegionName eq '${region}' and (${clause})`});
      for (let page = 0; url; page++) {
        if (page >= 20) throw Error('Azure pagination limit');
        const data = await get(url);
        if (!Array.isArray(data.Items)) throw Error('Invalid Azure price schema');
        items.push(...data.Items);
        const next = data.NextPageLink ? new URL(data.NextPageLink) : null;
        if (next && (next.protocol !== 'https:' || next.hostname !== 'prices.azure.com')) throw Error('Unexpected Azure page link');
        url = next?.href || null;
      }
    }
    return normalizeAzure(items, region, observedAt, clock());
  }
  async function pullPublic() {
    if (publicFetchedAt && clock() - publicFetchedAt < HOUR) return;
    const observedAt = clock(); let failed = false;
    const replace = (source, scope, rows) => {latest[source] = [...latest[source].filter(row => !scope(row)), ...rows];};
    await Promise.all([
      ...awsRegions.flatMap(([region, location]) => ['On-demand', 'Reserved'].map(async term => {
        const name = term === 'Reserved' ? 'ec2-reservedinstance/1%20year/No%20Upfront' : 'ec2-ondemand-without-sec-sel';
        const suffix = term === 'Reserved' ? '/Linux/Shared/index.json' : '/Linux/index.json';
        const url = `https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/${name}/${encodeURIComponent(location)}${suffix}`;
        try {
          const rows = normalizePublic(await get(url), region, term, observedAt, url);
          replace('aws', row => row.area === region && row.term === term, rows); errors.delete('aws_' + region + '_' + term);
        } catch {failed = true; errors.add('aws_' + region + '_' + term);}
      })),
      ...azureRegions.map(async region => {
        try {
          const rows = await pullAzure(region, observedAt);
          replace('azure', row => row.group.endsWith('|' + region), rows); errors.delete('azure_' + region);
        } catch {failed = true; errors.add('azure_' + region);}
      }),
    ]);
    if (!failed) publicFetchedAt = observedAt;
  }
  function sync() {
    if (closed) return Promise.resolve();
    if (pending) return pending;
    pending = Promise.allSettled([pullBot().catch(() => errors.add('bot')), pullPublic()])
      .then(() => {
        const now = clock();
        lastSync = now;
        observe(Object.values(latest).flat().filter(row => now - row.observedAt <= row.ttl && row.observedAt <= now + MINUTE), now);
        if (now - lastCompaction >= DAY) compact(now);
        persist();
      })
      .finally(() => {pending = null;});
    return pending;
  }
  // Import the bot's saved observations for one offering. History never comes from a current catalog.
  function importOffering(group) {
    const [provider, cloud, sku, region] = group.split('|');
    if (!configured || closed || provider === 'azure' || imported.has(group) || importing.has(group) ||
        clock() - (importFailures.get(group) ?? -Infinity) < HISTORY_RETRY) return;
    const work = historyTail.then(async () => {
      const query = new URLSearchParams({provider, cloud, sku, region, limit: '1000', since: iso(clock() - HISTORY_SPAN)});
      const quotes = [];
      for (let page = 0; page < HISTORY_PAGES && !closed; page++) {
        query.set('offset', String(page * 1000));
        const data = await get(new URL('/v1/prices/history?' + query, botUrl).href, true);
        if (!Array.isArray(data.items) || !Number.isInteger(data.total)) throw Error('Invalid bot history');
        quotes.push(...data.items.map(normalizeBot).filter(quote => quote?.group === group));
        if ((page + 1) * 1000 >= data.total) break;
      }
      if (closed) return;
      importHistory(quotes); imported.add(group); persist(); errors.delete('history');
    }).catch(() => {importFailures.set(group, clock()); errors.add('history');}).finally(() => importing.delete(group));
    historyTail = work;
    importing.set(group, work);
  }

  // AWS events describe effective prices until the next change, even when changes are days apart.
  function importSpotChanges(group) {
    const [provider, cloud, sku, region] = group.split('|'), key = 'spot:' + group;
    if (provider !== 'aws' || cloud !== 'aws' || !configured || closed || importing.has(key) ||
        clock() - (spotHistory.get(group)?.fetchedAt ?? -Infinity) < HISTORY_RETRY ||
        clock() - (importFailures.get(key) ?? -Infinity) < HISTORY_RETRY) return;
    const work = historyTail.then(async () => {
      const end = clock(), start = end - HISTORY_SPAN;
      const query = new URLSearchParams({region, sku, since: iso(start), until: iso(end), limit: '5000'});
      const events = []; let coverage;
      for (let page = 0; ; page++) {
        if (page >= 100 || closed) throw Error('Incomplete Spot history');
        query.set('offset', String(page * 5000));
        const data = await get(new URL('/v1/prices/aws-spot-history?' + query, botUrl).href, true);
        if (data.coverage === null) {const error = Error('Spot history backfill pending'); error.pending = true; throw error;}
        if (data.kind !== 'price_change_events' || data.unit !== 'USD / instance-hour' ||
            !data.coverage || !Array.isArray(data.items) || !Number.isInteger(data.total)) throw Error('Invalid Spot history');
        coverage = data.coverage; events.push(...data.items);
        if (events.length >= data.total) break;
        if (!data.items.length) throw Error('Incomplete Spot history');
      }
      const from = Math.max(start, Date.parse(coverage.since)), to = Math.min(end, Date.parse(coverage.until));
      if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) throw Error('Invalid Spot coverage');
      const changes = new Map(), zones = new Map(), segments = [], count = groups.get(group)?.count;
      if (!(count > 0)) throw Error('Invalid GPU count');
      for (const event of events) {
        const at = Date.parse(event.effective_at), price = Number(event.price_hourly);
        if (!Number.isFinite(at) || !(price > 0) || !Number.isFinite(price) || typeof event.availability_zone !== 'string') throw Error('Invalid Spot event');
        if (at > to) continue;
        const time = Math.max(from, at);
        if (!changes.has(time)) changes.set(time, []);
        changes.get(time).push({at, zone: event.availability_zone, price});
      }
      const times = [...changes.keys()].sort((a, b) => a - b);
      for (let i = 0; i < times.length; i++) {
        const time = times[i];
        for (const event of changes.get(time).sort((a, b) => a.at - b.at)) zones.set(event.zone, event.price);
        const last = i + 1 < times.length ? times[i + 1] - 1 : to;
        const value = round(Math.min(...zones.values()) / count), previous = segments.at(-1);
        if (previous?.v === value && previous.l + 1 === time) previous.l = last;
        else segments.push({g: group, t: 'Spot', v: value, f: time, l: last});
      }
      if (closed) return;
      spotHistory.set(group, {segments, from, to, fetchedAt: clock()});
      persist(); errors.delete(key);
    }).catch(error => {
      // A newly deployed bot may still be filling this series; check again on the next page poll.
      importFailures.set(key, clock() - (error.pending ? HISTORY_RETRY - 30000 : 0)); errors.add(key);
    }).finally(() => importing.delete(key));
    historyTail = work; importing.set(key, work);
  }

  function importListHistory(group) {
    const [provider, cloud, sku, region] = group.split('|'), key = 'list:' + group;
    if (provider !== 'aws' || cloud !== 'aws' || !configured || closed || importing.has(key) ||
        clock() - (listHistory.get(group)?.fetchedAt ?? -Infinity) < HISTORY_RETRY ||
        clock() - (importFailures.get(key) ?? -Infinity) < HISTORY_RETRY) return;
    const work = historyTail.then(async () => {
      const end = clock(), start = end - HISTORY_SPAN, count = groups.get(group)?.count;
      const query = new URLSearchParams({region, sku, since: iso(start), until: iso(end), limit: '5000'});
      const segments = []; let pending = false;
      for (let page = 0, received = 0; ; page++) {
        if (page >= 100 || closed) throw Error('Incomplete list history');
        query.set('offset', String(page * 5000));
        const data = await get(new URL('/v1/prices/aws-list-history?' + query, botUrl).href, true);
        if (data.coverage === null) {const error = Error('List history backfill pending'); error.pending = true; throw error;}
        if (data.kind !== 'published_price_intervals' || data.unit !== 'USD / instance-hour' ||
            data.commitment?.months !== 12 || data.commitment?.payment !== 'no_upfront' ||
            !Array.isArray(data.items) || !Number.isInteger(data.total) || !(count > 0)) throw Error('Invalid list history');
        pending ||= Boolean(data.pending);
        for (const item of data.items) {
          const term = {on_demand: 'On-demand', reserved: 'Reserved'}[item.market];
          const first = Date.parse(item.valid_from), last = Date.parse(item.valid_until), effective = Date.parse(item.effective_at);
          const price = Number(item.price_hourly);
          if (!term || ![first, last, effective, price].every(Number.isFinite) || first < effective || last <= first || !(price > 0) ||
              (item.market === 'reserved' && !chartReserved({details: item}))) throw Error('Invalid list interval');
          const from = Math.max(start, first), to = Math.min(end, last) - 1;
          if (from <= to) segments.push({g: group, t: term, v: round(price / count), f: from, l: to});
        }
        received += data.items.length;
        if (received >= data.total) break;
        if (!data.items.length) throw Error('Incomplete list history');
      }
      if (closed) return;
      listHistory.set(group, {segments, fetchedAt: clock() - (pending ? HISTORY_RETRY - 30000 : 0)});
      if (pending) errors.add(key); else errors.delete(key);
      persist();
    }).catch(error => {
      importFailures.set(key, clock() - (error.pending ? HISTORY_RETRY - 30000 : 0)); errors.add(key);
    }).finally(() => importing.delete(key));
    historyTail = work; importing.set(key, work);
  }

  // Each region shows one reference offering, so its three lines are directly comparable.
  function query(filters = {}) {
    const now = clock();
    if (!lastSync || now - lastSync >= SYNC_INTERVAL) sync().catch(() => {});
    const [span, bucket] = PERIODS[filters.period] || PERIODS['1M'];
    const from = now - span, openByGroup = new Map();
    const wanted = !filters.region || filters.region === 'all' ? null :
      new Set(String(filters.region).split(',').map(region => region.trim()).filter(Boolean));
    const hardware = {...filters, region: undefined};
    for (const segment of open.values()) {
      if (!openByGroup.has(segment.g)) openByGroup.set(segment.g, []);
      openByGroup.get(segment.g).push(segment);
    }
    const areas = new Map();
    for (const [group, spec] of groups) {
      if (!matches(spec, hardware) || (wanted && !wanted.has(spec.area))) continue;
      const current = (openByGroup.get(group) || []).filter(s => now - s.l <= SEGMENT_GAP);
      const history = spotHistory.get(group);
      const saved = [...(archive.get(group) || []), ...(openByGroup.get(group) || [])];
      // Vendor change history takes precedence inside its confirmed coverage. Observations after it stay live.
      const observed = history ? saved.flatMap(s => s.t !== 'Spot' || s.l < history.from || s.f > history.to ? [s] :
        [s.f < history.from ? {...s, l: history.from - 1} : null, s.l > history.to ? {...s, f: history.to + 1} : null].filter(Boolean)) : saved;
      const tariffs = listHistory.get(group)?.segments || [];
      // Replace only verified tariff intervals; gaps can still contain genuine bot observations.
      let merged = observed;
      for (const tariff of tariffs) merged = merged.flatMap(s => s.t !== tariff.t || s.l < tariff.f || s.f > tariff.l ? [s] :
        [s.f < tariff.f ? {...s, l: tariff.f - 1} : null, s.l > tariff.l ? {...s, f: tariff.l + 1} : null].filter(Boolean));
      const segments = [...merged, ...(history?.segments || []), ...tariffs].filter(s => s.l >= from && s.f <= now);
      if (!segments.length) continue;
      const area = AREAS.has(spec.area) ? spec.area : null;
      if (!areas.has(area)) areas.set(area, {reference: null, offerings: 0});
      const slot = areas.get(area);
      slot.offerings++;
      // Prefer an offering whose Spot price the bot observes live (published Azure Spot rates are fixed),
      // then the most complete current offering, then the lowest On-demand reference.
      const valueOf = term => current.find(s => s.t === term)?.v ?? Infinity;
      const liveSpot = !group.startsWith('azure|') && current.some(s => s.t === 'Spot');
      const score = [liveSpot ? 0 : 1, -new Set(current.map(s => s.t)).size, -new Set(segments.map(s => s.t)).size,
        valueOf('On-demand'), Math.min(...TERMS.map(valueOf))];
      const reference = slot.reference, index = reference ? score.findIndex((value, i) => value !== reference.score[i]) : -1;
      if (!reference || (index < 0 ? group < reference.group : score[index] < reference.score[index]))
        slot.reference = {group, spec, segments, current, score};
    }
    const slots = [...areas].sort((a, b) => areaOrder(a[0]) - areaOrder(b[0]));
    for (const [, {reference}] of slots) {
      if (reference.group.startsWith('aws|aws|')) {importSpotChanges(reference.group); importListHistory(reference.group);}
      else importOffering(reference.group);
    }
    const references = slots.map(([, slot]) => slot.reference);
    const times = [];
    if (references.length) {
      // Buckets run from the first to the last observation; a bucket still awaiting its sync is not shown empty.
      const all = references.flatMap(reference => reference.segments);
      const last = Math.min(now, Math.max(...all.map(s => s.l)));
      for (let time = Math.floor(Math.max(from, Math.min(...all.map(s => s.f))) / bucket) * bucket; time <= last; time += bucket) times.push(time);
    }
    const valueAt = (segments, term, time) => {
      const covering = segments.filter(s => s.t === term && s.f < time + bucket && s.l >= time);
      return covering.length ? Math.min(...covering.map(s => s.v)) : null;
    };
    const series = slots.map(([area, {reference, offerings}]) => ({
      area, matchingOfferings: offerings,
      reference: {gpuCount: reference.spec.count, gpuMemoryGb: reference.spec.memory ?? null, formFactor: reference.spec.form ?? null},
      latest: Object.fromEntries(TERMS.map(term => {
        const segment = reference.current.find(s => s.t === term);
        return [term, {value: segment?.v ?? null, observedAt: segment ? iso(segment.l) : null}];
      })),
      values: Object.fromEntries(TERMS.map(term => [term, times.map(time => valueAt(reference.segments, term, time))])),
    }));
    // Cards and the summary line show the lowest price of each type across the selected regions.
    const lowest = (values, pick) => values.reduce((best, item) => pick(item) !== null && (best === null || pick(item) < pick(best)) ? item : best, null);
    const points = times.map((time, index) => ({time: iso(time), values: Object.fromEntries(TERMS.map(term =>
      [term, {value: lowest(series, item => item.values[term][index])?.values[term][index] ?? null}]))}));
    const latestValues = Object.fromEntries(TERMS.map(term => {
      const best = lowest(series, item => item.latest[term].value);
      return [term, {value: best?.latest[term].value ?? null, observedAt: best?.latest[term].observedAt ?? null, area: best ? best.area : null}];
    }));
    return {
      terms: TERMS, points, latest: latestValues, times: times.map(iso), series,
      meta: {status: errors.size ? 'partial' : lastSync ? 'ok' : 'loading',
        botConfigured: configured, syncing: Boolean(pending) || importing.size > 0, lastSync: lastSync ? iso(lastSync) : null,
        serverTime: iso(now), unit: 'USD / GPU-hour', bucketMinutes: bucket / MINUTE, refreshSeconds: 30,
        basis: 'same_offering_per_region', regions: series.length,
        matchingOfferings: series.reduce((sum, item) => sum + item.matchingOfferings, 0),
        reference: series.length === 1 ? {area: series[0].area, ...series[0].reference} : null,
        commitment: {months: 12, payment: 'no_upfront'}, synthetic: false,
        coverage: TERMS.filter(term => series.some(item => item.values[term].some(value => value !== null))),
        sourceIssue: Boolean(errors.size),
      },
    };
  }
  function start() {if (!timer && !closed) {sync().catch(() => {}); timer = setInterval(() => sync().catch(() => {}), SYNC_INTERVAL); timer.unref?.();}}
  async function close() {closed = true; if (timer) clearInterval(timer); for (const controller of controllers) controller.abort(); await Promise.allSettled([pending, ...importing.values()].filter(Boolean)); if (appends.length) persist();}
  // Resolves when the current sync and any history imports have finished.
  const settled = () => Promise.allSettled([pending, ...importing.values()].filter(Boolean));
  return {query, sync, start, close, settled};
}

module.exports = {createCapacityPriceService, normalizeBot, normalizePublic, normalizeAzure, canonicalModel, TERMS, AZURE_SPECS};
