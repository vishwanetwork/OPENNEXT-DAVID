'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');

const DAY = 24 * 60 * 60 * 1000;
const PERIOD_DAYS = Object.freeze({ '1D': 1, '3D': 3, '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365 });
const DEFAULT_FILE = path.join(__dirname, 'data', 'gpu-spot-history.json');
const normal = value => String(value ?? '').trim().toLowerCase();
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const valueOrNull = value => value === undefined ? null : value;
// Region identifiers are retained internally; public labels do not expose them.
const REGION_COUNTRIES = Object.freeze({
  'af-south-1':'South Africa', 'ap-east-1':'Hong Kong',
  'ap-northeast-1':'Japan', 'ap-northeast-2':'South Korea', 'ap-northeast-3':'Japan',
  'ap-south-1':'India', 'ap-south-2':'India', 'ap-southeast-1':'Singapore',
  'ap-southeast-2':'Australia', 'ap-southeast-3':'Indonesia', 'ap-southeast-5':'Malaysia',
  'ca-central-1':'Canada', 'eu-central-1':'Germany', 'eu-central-2':'Switzerland',
  'eu-north-1':'Sweden', 'eu-south-1':'Italy', 'eu-south-2':'Spain',
  'eu-west-1':'Ireland', 'eu-west-2':'United Kingdom', 'eu-west-3':'France',
  'il-central-1':'Israel', 'me-central-1':'United Arab Emirates', 'sa-east-1':'Brazil',
  'us-east-1':'United States', 'us-east-2':'United States',
  'us-west-1':'United States', 'us-west-2':'United States',
});
const positiveMetadata = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

function failure(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isCalendarDate(value) {
  if (!datePattern.test(String(value))) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function numericFilter(filters, name, { integer = false } = {}) {
  const raw = filters[name];
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw failure(name + ' must be a non-negative ' + (integer ? 'integer' : 'number'));
  }
  return value;
}

function windowFor(asOf, requested = 'ALL') {
  const period = String(requested || 'ALL').trim().toUpperCase();
  if (period === 'ALL') return { period, from: null, to: asOf, elapsedDays: null };
  const days = PERIOD_DAYS[period];
  if (!days) throw failure('Use period 1D, 3D, 1W, 1M, 3M, 6M, 1Y or ALL');
  // UTC is used only to do arithmetic on civil dates. The source timezone is unknown.
  const from = new Date(Date.parse(asOf + 'T00:00:00Z') - days * DAY).toISOString().slice(0, 10);
  return { period, from, to: asOf, elapsedDays: days };
}

function selectedUnit(raw) {
  const unit = normal(raw || 'gpu');
  if (!['gpu', 'instance'].includes(unit)) throw failure('Use unit gpu or instance');
  return unit;
}

function dateExtent(series) {
  let start = null;
  let end = null;
  let pointCount = 0;
  let nullPerGpuPointCount = 0;
  for (const item of series) {
    for (const point of item.points || []) {
      pointCount++;
      if (point.value == null) nullPerGpuPointCount++;
      if (typeof point.date === 'string') {
        if (start === null || point.date < start) start = point.date;
        if (end === null || point.date > end) end = point.date;
      }
    }
  }
  return { startDate: start, endDate: end, pointCount, nullPerGpuPointCount };
}

// Aggregate only availability zones of the exact same published configuration.
// Daily means have equal zone weight: raw tick counts are not supplied by the workbook.
function regionalStatistics(result, metric = 'avg') {
  if (!['min', 'avg', 'max'].includes(metric)) throw failure('Use metric min, avg or max');
  const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const groups = new Map();
  for (const row of result.series || []) {
    if (!Number.isInteger(row.gpuCount) || row.gpuCount < 1 || row.term !== 'Spot') continue;
    const key = JSON.stringify([row.region, row.provider, row.instanceType, row.gpuModel, row.gpuCount, row.gpuMemoryGb ?? null, row.formFactor ?? null, row.term]);
    if (!groups.has(key)) groups.set(key, {row, dates: new Map()});
    const dates = groups.get(key).dates;
    for (const point of row.points || []) {
      if (!isCalendarDate(point.date)) continue;
      if (!dates.has(point.date)) dates.set(point.date, []);
      dates.get(point.date).push(point);
    }
  }
  const series = [...groups].map(([key, {row, dates}]) => {
    const region = (result.regions || []).find(item => item.code === row.region);
    return {
      id: 'region-' + createHash('sha256').update(key).digest('hex').slice(0, 18),
      region: row.region, name: region?.city || region?.name || row.region,
      configuration: row.instanceType || [row.gpuCount + ' GPUs', row.gpuMemoryGb ? row.gpuMemoryGb + ' GB' : null, row.formFactor].filter(Boolean).join(' · '),
      gpuModel: row.gpuModel, gpuCount: row.gpuCount, gpuMemoryGb: row.gpuMemoryGb ?? null,
      formFactor: row.formFactor ?? null, term: row.term,
      points: [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => {
        const means = rows.map(p => p.value).filter(finite), lows = rows.map(p => p.low).filter(finite), highs = rows.map(p => p.high).filter(finite);
        const statistics = {avg: means.length ? means.reduce((a, b) => a + b, 0) / means.length : null,
          min: lows.length ? Math.min(...lows) : null, max: highs.length ? Math.max(...highs) : null};
        return {time: date + 'T00:00:00Z', date, ...statistics, value: statistics[metric], observations: means.length};
      }),
    };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.configuration.localeCompare(b.configuration));
  return {schemaVersion: 2, term: 'Spot', metric, unit: 'USD / GPU-hour', regions: result.regions || [], series,
    meta: {...result.meta, bucketMinutes: 1440, basis: 'same_configuration_regional', allSeriesReturned: true,
      sourceKind: 'uploaded_daily_history', synthetic: false,
      aggregation: 'Equal-weight average of recorded daily zone means; minimum of zone lows; maximum of zone highs. Different instance configurations are never pooled.',
      windowReference: 'snapshot_as_of', missingDataPolicy: 'Unavailable metrics remain null; dates without observations remain gaps.',
      snapshotAsOf: result.asOf || result.meta?.asOf, excludedFractional: true}};
}

function createSpotHistoryStore({ filePath = DEFAULT_FILE, readFile = fs.readFile } = {}) {
  let cached;

  async function load() {
    if (!cached) {
      cached = Promise.resolve().then(async () => {
        let raw;
        try { raw = await readFile(filePath, 'utf8'); }
        catch { throw failure('Uploaded GPU history snapshot is not available', 503); }
        let snapshot;
        try { snapshot = JSON.parse(String(raw)); }
        catch { throw failure('Uploaded GPU history snapshot is invalid', 503); }
        if (snapshot.schemaVersion !== 1 || !isCalendarDate(snapshot.asOf) || !Array.isArray(snapshot.regions) || !Array.isArray(snapshot.series)) {
          throw failure('Uploaded GPU history snapshot has an unsupported schema', 503);
        }
        if (snapshot.series.some(item => !item || !Array.isArray(item.points))) {
          throw failure('Uploaded GPU history snapshot has an invalid series', 503);
        }
        return snapshot;
      }).catch(error => {
        // A missing export can become available later; successful snapshots are read once.
        cached = undefined;
        throw error;
      });
    }
    return cached;
  }

  function filterSeries(snapshot, filters) {
    const model = normal(filters.gpuModel || filters.model);
    const instance = normal(filters.instanceType);
    const region = normal(filters.region);
    const count = numericFilter(filters, 'gpuCount', { integer: true });
    const memory = numericFilter(filters, 'gpuMemoryGb');
    const factor = normal(filters.formFactor);
    const hasFactor = filters.formFactor !== undefined && filters.formFactor !== '';
    const regionCodes = new Set(snapshot.regions.filter(item => [item.code, item.name, item.city].some(value => normal(value) === region)).map(item => normal(item.code)));
    if (region) regionCodes.add(region);
    return snapshot.series.filter(item => {
      if (model && model !== 'all' && ![item.gpuModel, item.sourceGpuModel].some(value => normal(value) === model)) return false;
      if (instance && instance !== 'all' && normal(item.instanceType) !== instance) return false;
      if (region && !['all', 'all regions'].includes(region) && !regionCodes.has(normal(item.region))) return false;
      if (count !== undefined && item.gpuCount !== count) return false;
      if (memory !== undefined && item.gpuMemoryGb !== memory) return false;
      if (hasFactor && (['null', 'unknown', 'unspecified'].includes(factor) ? item.formFactor != null : normal(item.formFactor) !== factor)) return false;
      return true;
    });
  }

  function metadata(snapshot, chosenSeries, unit, window) {
    return {
      ...(snapshot.meta || {}),
      sourceKind: snapshot.sourceKind || 'uploaded_daily_history',
      snapshotAsOf: snapshot.asOf,
      asOf: snapshot.asOf,
      aggregation: 'daily_average',
      dateTimezone: 'not supplied',
      timestampSemantics: 'Calendar dates from the uploaded source; no intraday observation time or timezone is inferred.',
      currency: snapshot.currency || 'USD',
      currencyVerification: 'Source currency is carried forward without independent verification.',
      unit: unit === 'instance' ? 'USD/instance-hour' : 'USD/GPU-hour',
      sourceUnit: snapshot.unit || 'USD/GPU-hour',
      selectedUnit: unit,
      window,
      windowReference: 'snapshot_as_of',
      windowSemantics: 'Inclusive calendar-date endpoints separated by elapsedDays; complete daily data contains elapsedDays + 1 observations.',
      allSeriesReturned: true,
      seriesCount: chosenSeries.length,
      sourceSeriesCount: snapshot.series.length,
      ...dateExtent(chosenSeries),
      liveInventory: false,
      livePrices: false,
      zeroCountPolicy: 'Zero-count or fractional instances retain their original null per-GPU values. Use unit=instance for their whole-instance price.',
      displayValuePolicy: 'Original value/high/low fields are retained; displayValue/displayHigh/displayLow follow the selected unit.',
    };
  }

  async function query(filters = {}) {
    const snapshot = await load();
    const unit = selectedUnit(filters.unit);
    const window = windowFor(snapshot.asOf, filters.period);
    const matched = filterSeries(snapshot, filters);
    const series = matched.map(item => ({
      ...item,
      unit: unit === 'instance' ? 'USD/instance-hour' : 'USD/GPU-hour',
      points: item.points.filter(point => window.period === 'ALL' || (typeof point.date === 'string' && point.date >= window.from && point.date <= window.to)).map(point => ({
        ...point,
        displayValue: valueOrNull(unit === 'instance' ? point.instanceHourly : point.value),
        displayHigh: valueOrNull(unit === 'instance' ? point.instanceHigh : point.high),
        displayLow: valueOrNull(unit === 'instance' ? point.instanceLow : point.low),
      })),
    }));
    const activeRegions = new Set(matched.map(item => normal(item.region)));
    return {
      schemaVersion: 1,
      asOf: snapshot.asOf,
      sourceKind: snapshot.sourceKind || 'uploaded_daily_history',
      currency: snapshot.currency || 'USD',
      unit: unit === 'instance' ? 'USD/instance-hour' : 'USD/GPU-hour',
      filters: { ...filters, period: window.period, unit },
      regions: snapshot.regions.filter(item => activeRegions.has(normal(item.code))).map(item => ({ ...item })),
      series,
      meta: metadata(snapshot, series, unit, window),
    };
  }

  async function catalog(filters = {}) {
    const snapshot = await load();
    const matched = filterSeries(snapshot, filters);
    const specs = new Map();
    for (const item of matched) {
      const key = JSON.stringify([item.gpuModel, item.instanceType, item.gpuCount, item.gpuMemoryGb, item.formFactor ?? null]);
      if (!specs.has(key)) specs.set(key, {
        gpuModel: item.gpuModel,
        sourceGpuModel: item.sourceGpuModel ?? item.gpuModel,
        instanceType: item.instanceType,
        gpuCount: item.gpuCount,
        gpuMemoryGb: item.gpuMemoryGb,
        formFactor: item.formFactor ?? null,
        providers: new Set(), regions: new Set(), zones: new Set(), seriesCount: 0, pointCount: 0,
      });
      const spec = specs.get(key);
      spec.providers.add(item.provider);
      spec.regions.add(item.region);
      if (item.zone != null) spec.zones.add(item.zone);
      spec.seriesCount++;
      spec.pointCount += item.points.length;
    }
    const specifications = [...specs.values()].map(spec => ({ ...spec, providers: [...spec.providers], regions: [...spec.regions], zones: [...spec.zones] }));
    const modelMap = new Map();
    for (const spec of specifications) {
      if (!modelMap.has(spec.gpuModel)) modelMap.set(spec.gpuModel, { name: spec.gpuModel, gpuModel: spec.gpuModel, gpuCounts: new Set(), gpuMemoryGb: new Set(), formFactors: new Set(), instanceTypes: new Set(), seriesCount: 0 });
      const model = modelMap.get(spec.gpuModel);
      model.gpuCounts.add(spec.gpuCount);
      if (spec.gpuMemoryGb != null) model.gpuMemoryGb.add(spec.gpuMemoryGb);
      if (spec.formFactor != null) model.formFactors.add(spec.formFactor);
      model.instanceTypes.add(spec.instanceType);
      model.seriesCount += spec.seriesCount;
    }
    const models = [...modelMap.values()].map(model => ({ ...model, gpuCounts: [...model.gpuCounts].sort((a, b) => a - b), gpuMemoryGb: [...model.gpuMemoryGb].sort((a, b) => a - b), formFactors: [...model.formFactors], instanceTypes: [...model.instanceTypes] }));
    const byRegion = new Map();
    const matchedRegionCounts = new Map();
    for (const item of snapshot.series) {
      const code = normal(item.region);
      if (!byRegion.has(code)) byRegion.set(code, new Map());
      const key = JSON.stringify([item.gpuModel, item.instanceType, item.gpuCount, item.gpuMemoryGb, item.formFactor ?? null]);
      byRegion.get(code).set(key, { gpuModel: item.gpuModel, instanceType: item.instanceType, gpuCount: item.gpuCount, gpuMemoryGb: item.gpuMemoryGb, formFactor: item.formFactor ?? null });
    }
    for (const item of matched) matchedRegionCounts.set(normal(item.region), (matchedRegionCounts.get(normal(item.region)) || 0) + 1);
    const search = normal(filters.q || filters.search);
    const regions = snapshot.regions.map(item => {
      const regionSpecs = [...(byRegion.get(normal(item.code))?.values() || [])];
      const count = matchedRegionCounts.get(normal(item.code)) || 0;
      return {
        ...item,
        label: item.name + ' (' + item.code + ')',
        searchText: [item.code, item.name, item.city].filter(Boolean).join(' ').toLowerCase(),
        available: count > 0,
        seriesCount: count,
        gpuModels: [...new Set(regionSpecs.map(spec => spec.gpuModel))],
        gpuCounts: [...new Set(regionSpecs.map(spec => spec.gpuCount))].sort((a, b) => a - b),
        instanceTypes: [...new Set(regionSpecs.map(spec => spec.instanceType))],
        specifications: regionSpecs,
      };
    }).filter(item => !search || item.searchText.includes(search));
    return {
      schemaVersion: 1,
      asOf: snapshot.asOf,
      sourceKind: snapshot.sourceKind || 'uploaded_daily_history',
      currency: snapshot.currency || 'USD',
      unit: snapshot.unit || 'USD/GPU-hour',
      regions,
      models,
      specifications,
      meta: { ...metadata(snapshot, matched, 'gpu', windowFor(snapshot.asOf, 'ALL')), sourceRegionCount: snapshot.regions.length, regionCount: regions.length },
    };
  }

  async function ticker({period='1W'} = {}) {
    const snapshot = await load();
    const window = windowFor(snapshot.asOf, period);
    // The homepage week is seven calendar dates ending at the snapshot date,
    // not eight inclusive daily points or a window relabelled as today's data.
    if (window.period === '1W') {
      window.from = new Date(Date.parse(snapshot.asOf + 'T00:00:00Z') - 6 * DAY).toISOString().slice(0, 10);
      window.elapsedDays = 6;
      window.calendarDays = 7;
    }
    const priority = ['H100', 'H200', 'B200', 'A100', 'L40S', 'L4', 'A10G', 'V100', 'T4'];
    const rank = model => priority.includes(model) ? priority.indexOf(model) : priority.length;
    const seen = new Set(), groups = new Map();
    // One actual configuration / availability zone per model and region. Never
    // join different instances into a synthetic price history or choose by price.
    const candidates = [...snapshot.series].sort((a, b) => rank(a.gpuModel) - rank(b.gpuModel)
      || Number(b.gpuCount === 8) - Number(a.gpuCount === 8)
      || String(a.instanceType).localeCompare(String(b.instanceType))
      || String(a.zone).localeCompare(String(b.zone)));
    for (const item of candidates) {
      if (item.term !== 'Spot' || !(item.gpuCount > 0)) continue;
      const key = [item.gpuModel, item.region].join('|');
      if (seen.has(key)) continue;
      const points = item.points.filter(p => isCalendarDate(p.date) && (window.period==='ALL'||p.date >= window.from) && p.date <= window.to)
        .map(p => ({date: p.date, value: Number.isFinite(p.value) && p.value >= 0 ? p.value : null}))
        .sort((a, b) => a.date.localeCompare(b.date));
      const observed = points.filter(p => p.value !== null);
      if (observed.length < 2) continue;
      const latest = observed[observed.length - 1];
      const region = snapshot.regions.find(r => r.code === item.region);
      const vcpu = positiveMetadata(item.vCpu ?? item.vcpu);
      const row = {recordId: 'history:' + item.id, provider: item.provider, gpuModel: item.gpuModel,
        region: item.region, regionName: region?.city || region?.name || item.region, zone: item.zone,
        country: region?.country || REGION_COUNTRIES[item.region] || null,
        instanceType: item.instanceType, gpuCount: item.gpuCount, term: 'Spot',
        vcpu: vcpu !== null && Number.isInteger(vcpu) ? vcpu : null,
        vCpu: vcpu !== null && Number.isInteger(vcpu) ? vcpu : null,
        gpuMemoryGb: positiveMetadata(item.gpuMemoryGb),
        memoryGiB: positiveMetadata(item.memoryGiB),
        instanceGpuMemoryGiB: positiveMetadata(item.instanceGpuMemoryGiB),
        hardwareMetadataSource: 'uploaded_configuration',
        perGpuHourly: latest.value, observedAt: latest.date, historical: true, points};
      if (!groups.has(item.gpuModel)) groups.set(item.gpuModel, []);
      groups.get(item.gpuModel).push(row);
      seen.add(key);
    }
    // Round-robin keeps the ribbon varied instead of showing only one GPU model.
    const records = [];
    for (let index = 0; records.length < 48; index++) {
      let added = false;
      for (const rows of groups.values()) {
        if (rows[index] && records.length < 48) {records.push(rows[index]); added = true;}
      }
      if (!added) break;
    }
    return {records, meta: {asOf: snapshot.asOf, window, windowReference: 'snapshot_as_of', aggregation: 'daily_average', livePrices: false,
      windowSemantics: window.period === '1W' ? 'Latest seven calendar dates ending at the recorded snapshot date. Missing observations remain gaps.' : 'Inclusive calendar-date endpoints separated by elapsedDays.',
      gpuMemoryUnit: 'GB / GPU', hostMemoryUnit: 'GiB / instance', vcpuBasis: 'instance',
      unit: 'USD/GPU-hour', sourceKind: snapshot.sourceKind || 'uploaded_daily_history'}};
  }

  return { load, query, catalog, ticker };
}

const defaultStore = createSpotHistoryStore();
module.exports = { createSpotHistoryStore, load: defaultStore.load, query: defaultStore.query, catalog: defaultStore.catalog, ticker: defaultStore.ticker, regionalStatistics, PERIOD_DAYS };
