'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const history = require('./OpenNEXT-spot-history.cjs');
const source = fs.readFileSync(path.join(__dirname, 'OpenNEXT-market-insight-index.js'), 'utf8');

function runtime(fetch) {
  const context = vm.createContext({URLSearchParams, AbortSignal, fetch,
    ONMarket: {catalog: [{name: 'H100', canonical: 'H100'}, {name: 'H100 SXM', canonical: 'H100'}, {name: 'H200', canonical: 'H200'}]}});
  vm.runInContext(source, context);
  return context.OpenNEXTMarketInsightIndex;
}
const copy = value => JSON.parse(JSON.stringify(value));
const selected = values => ({model: [], country: [], vcpu: [], memory: [], ...values});
const options = values => ({range: '7D', days: 7, term: 'Spot', selected: selected(), ...values});

test('index bridge preserves exact history, local state, filters and range authority', async t => {
  const raw = await history.query({period: '1D', unit: 'gpu'});
  const description = await history.catalog();
  const regional = history.regionalStatistics(await history.query({period: '1W', unit: 'gpu', gpuModel: 'H100'}));
  const calls = [];
  const api = runtime(async url => {
    calls.push(url);
    return {ok: true, json: async () => url === '/api/pricing/history-catalog' ? description : raw};
  });
  const helper = api.testHelpers;
  const ctx = {S: {identity: {email: 'index-test@example.invalid'}, role: 'Seller', model: 'A100', term: 'Reserved', period: '3M', priceMetrics: ['min']}};
  const originalState = copy(ctx.S);

  await t.test('only shared free ranges map to backend periods', () => {
    for (const [range, period] of [['24H', '1D'], ['3D', '3D'], ['7D', '1W'], ['1M', '1M']]) {
      const query = new URLSearchParams(helper.requestQuery(helper.optionsCopy(options({range})), {model: 'H100'}, 'Spot'));
      assert.equal(query.get('period'), period);
    }
    for (const range of ['3M', '6M', '1Y', 'ALL']) assert.equal(helper.optionsCopy(options({range})).range, null);
  });

  await t.test('markup shows focus and local term without changing buyer/shared state', () => {
    const html = api.render(ctx, options({term: 'All'}));
    assert.match(html, /data-insight-focus>H100</);
    assert.match(html, /data-insight-term/);
    assert.match(html, /data-insight-metric="max"/);
    assert.match(html, /data-insight-metric="avg" aria-pressed="true"/);
    assert.match(html, /data-insight-metric="min"/);
    assert.doesNotMatch(html, /data-act="period"/);
    assert.doesNotMatch(api.render(ctx, options()), /<select data-insight-term/);
    assert.deepEqual(ctx.S, originalState);
  });

  await t.test('parent model selection constrains the focused index model', () => {
    const html = api.render(ctx, options({selected: selected({model: ['H200']})}));
    assert.match(html, /data-insight-focus>H200</);
    assert.doesNotMatch(html, /<option value="H100"/);
    assert.deepEqual(ctx.S, originalState);
  });

  await t.test('actual catalog loads once and supplies verified filter metadata', async () => {
    assert.equal(await api.ensureCatalog(), true);
    assert.equal(await api.ensureCatalog(), false);
    assert.equal(calls.length, 2);
    const rows = api.filterRows();
    assert.ok(rows.some(row => row.model === 'H100' && row.country === 'Japan' && row.vcpu === 192 && row.memory === 80));
    assert.ok(rows.some(row => row.model === 'H100' && row.country === 'Japan' && row.vcpu === 16 && row.memory === 80));
    assert.ok(rows.some(row => row.model === 'B200' && row.memory === 179.0625));
    assert.ok(rows.some(row => row.country === 'Singapore'));
    const previous = rows[0].country;
    rows[0].country = 'modified';
    assert.equal(api.filterRows()[0].country, previous);
  });

  await t.test('real Japan H100 + 192 vCPU + 80 GB joins to only its recorded configuration', () => {
    assert.equal(regional.meta.sourceKind, 'uploaded_daily_history');
    assert.ok(regional.series.every(row => row.vCpu === undefined));
    const result = helper.filterData(regional, options({selected: selected({country: ['Japan'], vcpu: ['192'], memory: ['80']})}), 'H100', 'Spot');
    assert.equal(result.data.series.length, 1);
    assert.equal(result.data.series[0].region, 'ap-northeast-1');
    assert.equal(result.data.series[0].configuration, 'p5.48xlarge');
    assert.deepEqual(copy(result.data.series[0].points), regional.series.find(row => row.id === result.data.series[0].id).points);
    assert.equal(result.data.meta.snapshotAsOf, raw.asOf);
    assert.equal(result.unknown.vcpu, 0);
    const smaller = helper.filterData(regional, options({selected: selected({country: ['Japan'], vcpu: ['16'], memory: ['80']})}), 'H100', 'Spot');
    assert.equal(smaller.data.series.length, 1);
    assert.equal(smaller.data.series[0].configuration, 'p5.4xlarge');
  });

  await t.test('unsupported country, hardware and unverified form factor remain empty', () => {
    for (const filters of [{country: ['Singapore']}, {vcpu: ['512']}, {memory: ['141']}]) {
      assert.equal(helper.filterData(regional, options({selected: selected(filters)}), 'H100', 'Spot').data.series.length, 0);
    }
    const variant = helper.filterData(regional, options(), 'H100 SXM', 'Spot');
    assert.equal(variant.data.series.length, 0);
    assert.ok(variant.unknown.form > 0);
    assert.equal(helper.filterData(regional, options(), 'H200', 'Spot').data.series.length, 0);
  });

  await t.test('recorded live history cannot borrow unverified vCPU from imported instances', () => {
    const recorded = {...regional, meta: {...regional.meta, sourceKind: 'recorded_capacity_history'}};
    const result = helper.filterData(recorded, options({selected: selected({vcpu: ['192']})}), 'H100', 'Spot');
    assert.equal(result.data.series.length, 0);
    assert.ok(result.unknown.vcpu > 0);
    const explicit = {...recorded, series: recorded.series.map(row => ({...row, vCpu: 192}))};
    assert.ok(helper.filterData(explicit, options({selected: selected({vcpu: ['192']})}), 'H100', 'Spot').data.series.length > 0);
  });

  await t.test('mismatched terms cannot repaint old Spot prices under On-demand', () => {
    assert.equal(helper.filterData(regional, options({term: 'All'}), 'H100', 'On-demand').data.series.length, 0);
    assert.equal(helper.filterData(regional, options({term: 'Reserved'}), 'H100').data.series.length, 0);
    const mixed = {...regional, series: regional.series.map(row => ({...row, term: 'On-demand'}))};
    assert.equal(helper.filterData(mixed, options(), 'H100', 'Spot').data.series.length, 0);
    assert.match(source, /stateEntry\.record=null/);
  });

  await t.test('missing observations, original dates and source objects are unchanged', () => {
    const record = {...regional, series: [{...regional.series[0], points: [
      {time: '2026-10-01T00:00:00Z', min: null, avg: 1.25, max: null},
      {time: '2026-10-05T00:00:00Z', min: 1.5, avg: null, max: 2.5}
    ]}]};
    const before = copy(record);
    const result = helper.filterData(record, options(), 'H100', 'Spot');
    assert.deepEqual(copy(result.data.series), before.series);
    assert.deepEqual(copy(result.data.meta), before.meta);
    result.data.series[0].points[0].avg = 999;
    assert.deepEqual(record, before);
  });

  await t.test('country aliases are normalized but unknown geography is not fabricated', () => {
    assert.equal(helper.countryFor('ap-southeast-1'), 'Singapore');
    assert.equal(helper.normalizeCountry('US'), 'United States');
    assert.equal(helper.normalizeCountry('UK'), 'United Kingdom');
    assert.equal(helper.countryFor('unknown-region'), null);
    const result = helper.filterData(regional, options({selected: selected({country: ['US']})}), 'H100', 'Spot');
    assert.ok(result.data.series.length > 0);
    assert.ok(result.data.series.every(row => row.region.startsWith('us-')));
  });
});
