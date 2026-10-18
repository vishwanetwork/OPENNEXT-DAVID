'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSpotHistoryStore } = require('../OpenNEXT-spot-history.cjs');

function fixtureSnapshot() {
  const points = [
    { date: '2026-09-12', value: 1, instanceHourly: 8, high: 1.2, low: .8, instanceHigh: 9.6, instanceLow: 6.4 },
    { date: '2026-09-14', value: null, instanceHourly: null, high: null, low: null, instanceHigh: null, instanceLow: null },
    { date: '2026-10-07', value: 2, instanceHourly: 16, high: 2.4, low: 1.6, instanceHigh: 19.2, instanceLow: 12.8 },
    { date: '2026-10-13', value: 3, instanceHourly: 24, high: 3.4, low: 2.6, instanceHigh: 27.2, instanceLow: 20.8 },
  ];
  return {
    schemaVersion: 1, asOf: '2026-10-13', sourceKind: 'uploaded_daily_history', currency: 'USD', unit: 'USD/GPU-hour',
    regions: [
      { code: 'us-east-1', name: 'US East (N. Virginia)', city: 'N. Virginia' },
      { code: 'eu-west-1', name: 'Europe (Ireland)', city: 'Dublin' },
      { code: 'ap-northeast-2', name: 'Asia Pacific (Seoul)', city: 'Seoul' },
    ],
    series: [
      ...Array.from({ length: 5 }, (_, i) => ({ id: 'h100-' + i, provider: 'aws', region: 'us-east-1', zone: 'us-east-1' + String.fromCharCode(97 + i), instanceType: 'p5.48xlarge', gpuModel: 'H100', sourceGpuModel: 'H100', gpuCount: 8, gpuMemoryGb: 80, formFactor: null, term: 'Spot', points })),
      { id: 'a100', provider: 'aws', region: 'eu-west-1', zone: 'eu-west-1a', instanceType: 'p4d.24xlarge', gpuModel: 'A100', gpuCount: 8, gpuMemoryGb: 40, formFactor: null, term: 'Spot', points: [points[3]] },
      { id: 'fractional', provider: 'aws', region: 'us-east-1', zone: 'us-east-1a', instanceType: 'g6f.large', gpuModel: 'L4', gpuCount: 0, gpuMemoryGb: 3, formFactor: null, term: 'Spot', points: [{ date: '2026-10-13', value: null, instanceHourly: .04, high: null, low: null, instanceHigh: .05, instanceLow: .03 }] },
    ],
    meta: { sourceRows: 22, importedAt: '2026-10-14' },
  };
}

function store(snapshot = fixtureSnapshot()) {
  let reads = 0;
  const instance = createSpotHistoryStore({ filePath: 'fixture.json', readFile: async () => { reads++; return JSON.stringify(snapshot); } });
  return { instance, reads: () => reads };
}

test('successful uploaded snapshot is loaded once and all matching series are returned', async () => {
  const { instance, reads } = store();
  await Promise.all([instance.load(), instance.load(), instance.catalog()]);
  const data = await instance.query({ gpuModel: 'H100', period: 'ALL' });
  assert.equal(reads(), 1);
  assert.equal(data.series.length, 5);
  assert.equal(data.meta.allSeriesReturned, true);
  assert.equal(data.meta.sourceSeriesCount, 7);
  assert.equal(data.meta.pointCount, 20);
  assert.equal(data.meta.sourceRows, 22);
  assert.equal(data.meta.dateTimezone, 'not supplied');
  assert.equal(data.meta.liveInventory, false);
  assert.equal(data.meta.livePrices, false);
  assert.equal(data.meta.aggregation, 'daily_average');
});

test('periods use the snapshot date, retain nulls, and do not invent intraday timestamps', async () => {
  const { instance } = store();
  const monthly = await instance.query({ gpuModel: 'H100', period: '1M' });
  assert.deepEqual(monthly.meta.window, { period: '1M', from: '2026-09-13', to: '2026-10-13', elapsedDays: 30 });
  assert.deepEqual(monthly.series[0].points.map(point => point.date), ['2026-09-14', '2026-10-07', '2026-10-13']);
  assert.equal(monthly.series[0].points[0].value, null);
  assert.equal(monthly.series[0].points[0].displayValue, null);
  assert.equal('time' in monthly.series[0].points[0], false);
  const weekly = await instance.query({ gpuModel: 'H100', period: '1W' });
  assert.deepEqual(weekly.series[0].points.map(point => point.date), ['2026-10-07', '2026-10-13']);
  const daily = await instance.query({ gpuModel: 'H100', period: '1D' });
  assert.deepEqual(daily.series[0].points.map(point => point.date), ['2026-10-13']);
});

test('instance units expose fractional-instance prices without replacing original null per-GPU fields', async () => {
  const { instance } = store();
  const gpu = await instance.query({ gpuCount: 0 });
  assert.equal(gpu.series.length, 1);
  assert.equal(gpu.series[0].points[0].value, null);
  assert.equal(gpu.series[0].points[0].displayValue, null);
  const whole = await instance.query({ gpuCount: 0, unit: 'instance' });
  assert.equal(whole.unit, 'USD/instance-hour');
  assert.equal(whole.series[0].points[0].displayValue, .04);
  assert.equal(whole.series[0].points[0].displayHigh, .05);
  assert.equal(whole.series[0].points[0].displayLow, .03);
  assert.equal(whole.series[0].points[0].value, null);
  assert.equal(whole.series[0].points[0].high, null);
  assert.equal(whole.series[0].points[0].low, null);
  assert.equal(whole.series[0].gpuCount, 0);
});

test('hardware and region filters use supplied specifications without guessing form factors', async () => {
  const { instance } = store();
  const data = await instance.query({ gpuModel: 'h100', region: 'N. Virginia', gpuCount: '8', gpuMemoryGb: '80', instanceType: 'p5.48xlarge', formFactor: 'unknown' });
  assert.equal(data.series.length, 5);
  assert.equal(data.series[0].formFactor, null);
  assert.equal((await instance.query({ gpuModel: 'H100', formFactor: 'SXM' })).series.length, 0);
  assert.equal((await instance.query({ gpuMemoryGb: 40, region: 'Europe (Ireland)' })).series[0].gpuModel, 'A100');
  assert.equal((await instance.query({ region: 'all' })).series.length, 7);
  assert.equal((await instance.query({ region: 'All regions', gpuModel: 'all', instanceType: 'all' })).series.length, 7);
});

test('catalog retains every region, English search, available SKU/count combinations and disabled regions', async () => {
  const { instance } = store();
  const catalog = await instance.catalog({ gpuModel: 'H100', gpuCount: 8 });
  assert.equal(catalog.regions.length, 3);
  assert.equal(catalog.regions.find(region => region.code === 'us-east-1').available, true);
  const ireland = catalog.regions.find(region => region.code === 'eu-west-1');
  assert.equal(ireland.available, false);
  assert.deepEqual(ireland.gpuModels, ['A100']);
  assert.deepEqual(ireland.gpuCounts, [8]);
  assert.deepEqual(ireland.instanceTypes, ['p4d.24xlarge']);
  assert.equal(catalog.regions.find(region => region.city === 'Seoul').available, false);
  assert.deepEqual(catalog.specifications[0].regions, ['us-east-1']);
  assert.equal(catalog.specifications[0].seriesCount, 5);
  const searched = await instance.catalog({ q: 'dublin' });
  assert.equal(searched.regions.length, 1);
  assert.equal(searched.regions[0].code, 'eu-west-1');
  const all = await instance.catalog();
  assert.deepEqual(all.models.find(model => model.gpuModel === 'L4').gpuCounts, [0]);
});

test('queries do not mutate cached source data and reject invalid filters', async () => {
  const { instance } = store();
  const raw = await instance.load();
  const before = JSON.stringify(raw);
  const data = await instance.query({ unit: 'instance' });
  data.series[0].points[0].value = 999;
  assert.equal(JSON.stringify(raw), before);
  assert.equal((await instance.query()).series[0].points[0].value, 1);
  for (const filters of [{ period: 'TODAY' }, { unit: 'token' }, { gpuCount: -1 }, { gpuCount: .5 }, { gpuMemoryGb: 'NaN' }]) {
    await assert.rejects(instance.query(filters), error => error.status === 400);
  }
});

test('a missing snapshot reports unavailable and can be loaded after the export is ready', async () => {
  let ready = false;
  let reads = 0;
  const instance = createSpotHistoryStore({ readFile: async () => { reads++; if (!ready) throw Error('private-path-is-never-exposed'); return JSON.stringify(fixtureSnapshot()); } });
  await assert.rejects(instance.load(), error => error.status === 503 && !error.message.includes('private-path'));
  ready = true;
  assert.equal((await instance.catalog()).models.length, 3);
  assert.equal(reads, 2);
});

test('calendar-date period arithmetic handles leap days without inferring source timezone', async () => {
  const snapshot = fixtureSnapshot();
  snapshot.asOf = '2024-03-01';
  snapshot.series = [{ ...snapshot.series[0], points: [{ date: '2024-02-29', value: 2 }, { date: '2024-03-01', value: 3 }] }];
  const { instance } = store(snapshot);
  assert.deepEqual((await instance.query({ period: '1W' })).meta.window, { period: '1W', from: '2024-02-23', to: '2024-03-01', elapsedDays: 7 });
  snapshot.asOf = '2024-02-30';
  await assert.rejects(store(snapshot).instance.load(), error => error.status === 503);
});

test('elapsed-day windows include both endpoints: 1D has 2, 3D has 4, 1W has 8 and 1M has 31 complete daily observations', async () => {
  const snapshot = fixtureSnapshot();
  const end = Date.parse(snapshot.asOf + 'T00:00:00Z');
  snapshot.series = [{ ...snapshot.series[0], points: Array.from({ length: 32 }, (_, index) => ({ date: new Date(end - (31 - index) * 86400000).toISOString().slice(0, 10), value: 1 })) }];
  const { instance } = store(snapshot);
  for (const [period, elapsedDays, count, start] of [['1D', 1, 2, '2026-10-12'], ['3D', 3, 4, '2026-10-10'], ['1W', 7, 8, '2026-10-06'], ['1M', 30, 31, '2026-09-13']]) {
    const result = await instance.query({ period });
    assert.equal(result.meta.window.elapsedDays, elapsedDays);
    assert.equal(result.series[0].points.length, count);
    assert.equal(result.series[0].points[0].date, start);
    assert.equal(result.series[0].points.at(-1).date, '2026-10-13');
  }
});
