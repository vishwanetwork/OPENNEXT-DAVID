'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {regionalStatistics} = require('../OpenNEXT-spot-history.cjs');
const {intervalStatistics} = require('../OpenNEXT-capacity-prices.cjs');
const {createPricingRouter} = require('../OpenNEXT-pricing-api.cjs');

function source() {
  const regions = Array.from({length: 9}, (_, i) => ({code: 'region-' + i, name: 'Region ' + i, city: 'City ' + i}));
  const series = regions.flatMap((region, i) => ['a', 'b'].map((zone, z) => ({id: region.code + zone, provider: 'test', region: region.code, zone,
    instanceType: 'whole-8', gpuModel: 'H100', gpuCount: 8, gpuMemoryGb: 80, formFactor: null, term: 'Spot',
    points: [{date: '2026-10-01', value: 2 + i + z * 2, low: 1 + i + z, high: 5 + i + z},
      {date: '2026-10-03', value: 3 + i + z * 2, low: 2 + i + z, high: 6 + i + z}]})));
  return {asOf: '2026-10-03', regions, series, meta: {asOf: '2026-10-03'}};
}

test('regional metrics retain every region and use actual zone low, mean and high', () => {
  const result = regionalStatistics(source());
  assert.equal(result.series.length, 9);
  assert.equal(result.meta.allSeriesReturned, true);
  assert.deepEqual(result.series[0].points[0], {time: '2026-10-01T00:00:00Z', date: '2026-10-01', min: 1, avg: 3, max: 6, value: 3, observations: 2});
  assert.equal(regionalStatistics(source(), 'min').series[0].points[0].value, 1);
  assert.equal(regionalStatistics(source(), 'max').series[0].points[0].value, 6);
  assert.equal(result.series[0].points.length, 2, 'missing date must not be interpolated');
  assert.throws(() => regionalStatistics(source(), 'median'), /metric/);
});

test('different GPU counts, memory, instance specifications and terms are never pooled', () => {
  const input = source(), row = input.series[0];
  input.series.push({...row, gpuCount: 1, instanceType: 'whole-1'}, {...row, gpuMemoryGb: 94}, {...row, instanceType: 'other-cpu-network'},
    {...row, gpuCount: .5}, {...row, gpuCount: 0}, {...row, term: 'On-demand'});
  const result = regionalStatistics(input);
  assert.equal(result.series.length, 12);
  assert.ok(result.series.every(s => Number.isInteger(s.gpuCount) && s.gpuCount > 0 && s.term === 'Spot'));
  assert.equal(result.series.find(s => s.configuration === 'whole-8' && s.region === row.region && s.gpuMemoryGb === 80).points[0].avg, 3);
});

test('missing high and low remain null rather than borrowing averages or zero', () => {
  const input = source(); input.series = [{...input.series[0], points: [{date: '2026-10-01', value: 2, low: null, high: null}]}];
  const high = regionalStatistics(input, 'max').series[0].points[0];
  assert.equal(high.value, null); assert.equal(high.max, null); assert.equal(high.min, null); assert.equal(high.avg, 2);
});

test('live bucket means are duration weighted, with real extrema and no gap fill', () => {
  const result = intervalStatistics([{v: 2, f: 0, l: 24}, {v: 6, f: 25, l: 99}], 0, 100);
  assert.deepEqual(result, {min: 2, avg: 5, max: 6, observations: 2});
  assert.deepEqual(intervalStatistics([{v: 2, f: 0, l: 24}], 50, 100), {min: null, avg: null, max: null, observations: 0});
});

function renderer() {
  const document = {getElementById: () => null};
  const window = {ONMarket: {modelOf: model => ({canonical: model}), regionCode: value => value}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../OpenNEXT-history-chart.js'), 'utf8'), {window, document, URLSearchParams, AbortSignal, console}, {filename: 'OpenNEXT-history-chart.js'});
  const target = {innerHTML: '', isConnected: true, clientWidth: 1000, querySelectorAll: () => [], querySelector: () => null, addEventListener: () => {}, removeEventListener: () => {}};
  return {api: window.OpenNEXTRegionalHistory, target};
}
const click = (target, selector) => target.onclick({target: {closest: value => value === selector ? {} : null}});

test('all nine curves can be selected, cleared, and refiltered without Instance or Unit controls', () => {
  const {api, target} = renderer(), data = regionalStatistics(source()), state = {model: 'H100', count: 8, region: 'All regions', term: 'Spot', period: '1M', priceMetric: 'avg'};
  api.mount(target, state, data);
  assert.equal((target.innerHTML.match(/data-region-line=/g) || []).length, 3);
  click(target, '[data-region-all]');
  assert.equal((target.innerHTML.match(/data-region-line=/g) || []).length, 9);
  assert.doesNotMatch(target.innerHTML, /data-history-instance|data-history-unit|Choose up to|at most five/);
  assert.match(target.innerHTML, /View 9 regional price series/);
  assert.match(target.innerHTML, /stroke-dasharray="8 4"/);
  api.mount(target, {...state, priceMetric: 'max'}, {...data, metric: 'max'});
  assert.equal((target.innerHTML.match(/data-region-line=/g) || []).length, 9);
  assert.match(target.innerHTML, /Highest/);
  assert.match(target.innerHTML, /M[\d.,]+ M[\d.,]+/, 'missing day leaves separate path segments');
  click(target, '[data-region-clear]');
  assert.equal((target.innerHTML.match(/data-region-line=/g) || []).length, 0);
  assert.match(target.innerHTML, /Choose regions to compare/);
  api.mount(target, state, data);
  assert.equal((target.innerHTML.match(/data-region-line=/g) || []).length, 0, 'refresh must preserve the intentional empty selection');
});

test('regional endpoint is read-only, validates filters and does not mislabel missing market terms', async () => {
  let remoteCalls = 0;
  const route = createPricingRouter({}, {env: {}, importedHistory: {query: async () => source()}, capacity: {queryRegional: query => {remoteCalls++; return {term: query.term, metric: query.metric, series: [], meta: {synthetic: false}};}}});
  const request = async (suffix, method = 'GET') => {
    let status, body; const res = {writeHead: code => {status = code;}, end: value => {body = JSON.parse(value);}};
    await route({method, headers: {}}, res, new URL('http://example.test/api/pricing/regional-history' + suffix));
    return {status, body};
  };
  assert.equal((await request('?term=Spot&gpuCount=8&metric=max')).body.series.length, 9);
  assert.equal((await request('?term=Reserved')).body.series.length, 0);
  assert.equal(remoteCalls, 1);
  assert.equal((await request('?metric=bogus')).status, 400);
  assert.equal((await request('?gpuCount=0.5')).status, 400);
  assert.equal((await request('', 'POST')).status, 405);
});
