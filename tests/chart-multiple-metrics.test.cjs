'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const state = {model: 'H100', count: 8, region: 'All regions', term: 'Spot', period: '3M', priceMetric: 'avg'};
const metrics = ['max', 'avg', 'min'];
const sample = () => ({metric: 'avg', term: 'Spot', regions: [], meta: {bucketMinutes: 1440}, series: Array.from({length: 9}, (_, i) => ({
  id: 'region-' + i, region: 'r' + i, name: 'Region ' + i, configuration: '8 GPU cluster', gpuCount: 8,
  points: [{time: '2026-10-01T00:00:00Z', min: 1 + i, avg: 2 + i, max: 3 + i, value: 2 + i},
    {time: '2026-10-03T00:00:00Z', min: 1.2 + i, avg: 2.2 + i, max: 3.2 + i, value: 2.2 + i}],
}))});
function regional() {
  const headings = Object.fromEntries(['marketPriceLabel', 'marketPrice', 'marketRecords', 'marketChange', 'historyPrimaryCaption'].map(id => [id, {textContent: '', className: ''}]));
  const window = {ONMarket: {modelOf: model => ({canonical: model}), regionCode: value => value}};
  const document = {getElementById: id => headings[id] || null};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../OpenNEXT-history-chart.js'), 'utf8'), {window, document, URLSearchParams, AbortSignal, console});
  const target = {innerHTML: '', isConnected: true, clientWidth: 1000, querySelectorAll: () => [], querySelector: () => null, addEventListener: () => {}, removeEventListener: () => {}};
  return {api: window.OpenNEXTRegionalHistory, window, target, headings};
}
const click = (target, selector) => target.onclick({target: {closest: value => value === selector ? {} : null}});

test('all seven nonempty metric combinations render the exact recorded values and one region legend per configuration', () => {
  for (let mask = 1; mask < 8; mask++) {
    const selected = metrics.filter((_, i) => mask & (1 << i)), {api} = regional();
    const rendered = api.markup({...state, priceMetrics: selected}, sample(), 1000);
    assert.equal(rendered.info.series.length, 3 * selected.length);
    assert.equal((rendered.html.match(/data-region-focus=/g) || []).length, 3);
    for (const series of rendered.info.series) {
      assert.ok(selected.includes(series.metric));
      assert.equal(series.points[0].value, series.points[0][series.metric]);
    }
    if (selected.length > 1) {
      assert.match(rendered.html, /Line style identifies metric/);
      assert.match(rendered.html, /<th>METRIC<\/th>/);
      assert.equal((rendered.html.match(/data-metric-focus=/g) || []).length, selected.length);
      const firstRegion = rendered.info.series.filter(series => series.id === 'region-0');
      assert.equal(new Set(firstRegion.map(series => series.color)).size, 1);
      assert.equal(new Set(firstRegion.map(series => series.dash)).size, selected.length);
    }
  }
});

test('all regions can be combined with all metrics, and existing region choices survive a metric switch', () => {
  const {api, target, window} = regional(), data = sample();
  api.mount(target, {...state, priceMetrics: metrics}, data);
  click(target, '[data-region-all]');
  assert.equal(window.__onHistoryChartInfo.series.length, 27);
  assert.equal((target.innerHTML.match(/data-region-focus=/g) || []).length, 9);
  api.mount(target, {...state, priceMetrics: ['min']}, data);
  assert.equal(window.__onHistoryChartInfo.series.length, 9);
  click(target, '[data-region-clear]');
  api.mount(target, {...state, priceMetrics: metrics}, data);
  assert.match(target.innerHTML, /Choose regions to compare/);
  assert.equal(window.__onHistoryChartInfo, null);
});

test('metric primary, old saved preferences, and empty or invalid selections remain unambiguous', () => {
  const {api, target, headings} = regional(), data = sample();
  api.mount(target, {...state, priceMetrics: ['min', 'avg', 'max'], priceMetric: 'max'}, data);
  assert.equal(headings.marketPriceLabel.textContent, 'AVERAGE SPOT / GPU-HR');
  assert.equal(headings.marketPrice.textContent, '$2.20');
  assert.equal(new URLSearchParams(api.queryFor({...state, priceMetrics: ['min', 'max']})).get('metric'), 'max');
  assert.equal(new URLSearchParams(api.queryFor({...state, priceMetrics: [], priceMetric: 'min'})).get('metric'), 'min');
  assert.equal(new URLSearchParams(api.queryFor({...state, priceMetrics: ['invalid'], priceMetric: 'invalid'})).get('metric'), 'avg');
  assert.equal(api.markup({...state, priceMetric: 'min'}, data, 1000).info.series[0].metric, 'min');
});

test('selected regions survive an unavailable metric and return without another selection', () => {
  const {api, target, window, headings} = regional(), data = sample();
  data.series = [{...data.series[0], points: data.series[0].points.map(point => ({...point, min: null}))}];
  api.mount(target, {...state, priceMetrics: ['avg']}, data);
  const originalColor = window.__onHistoryChartInfo.series[0].color;
  api.mount(target, {...state, priceMetrics: ['min']}, data);
  assert.equal(window.__onHistoryChartInfo, null);
  assert.match(target.innerHTML, /No recorded prices for the selected regions/);
  assert.match(target.innerHTML, /Your region selection is saved/);
  assert.match(target.innerHTML, /1 selected/);
  assert.equal(headings.historyPrimaryCaption.textContent, 'No observations for the selected metric or period');
  click(target, '[data-region-toggle]');
  assert.match(target.innerHTML, /data-region-id="region-0" checked/);
  api.mount(target, {...state, priceMetrics: ['avg']}, data);
  assert.equal(window.__onHistoryChartInfo.series.length, 1);
  assert.equal(window.__onHistoryChartInfo.series[0].id, 'region-0');
  assert.equal(window.__onHistoryChartInfo.series[0].color, originalColor);
});

test('empty or reordered time windows preserve region choices and colors without retaining old observations', () => {
  const {api, target, window} = regional(), data = sample();
  api.mount(target, {...state, period: '3M', priceMetrics: metrics}, data);
  click(target, '[data-region-all]');
  const original = new Map(window.__onHistoryChartInfo.series.map(series => [series.id, series.color]));
  api.mount(target, {...state, period: '1D', priceMetrics: metrics}, {...data, series: []});
  assert.equal(window.__onHistoryChartInfo, null);
  assert.match(target.innerHTML, /9 selected/);
  assert.match(target.innerHTML, /Your region selection is saved/);
  assert.doesNotMatch(target.innerHTML, /data-region-line=/);
  click(target, '[data-region-toggle]');
  assert.equal((target.innerHTML.match(/data-region-id="[^"]+" checked/g) || []).length, 9);
  assert.equal((target.innerHTML.match(/<small>0 points<\/small>/g) || []).length, 9);
  api.mount(target, {...state, period: '3M', priceMetrics: metrics}, {...data, series: [...data.series].reverse()});
  assert.equal(window.__onHistoryChartInfo.series.length, 27);
  for (const series of window.__onHistoryChartInfo.series) assert.equal(series.color, original.get(series.id));
  click(target, '[data-region-clear]');
  api.mount(target, {...state, period: '1D', priceMetrics: metrics}, {...data, series: []});
  assert.match(target.innerHTML, /Choose regions to compare/);
  assert.doesNotMatch(target.innerHTML, /Your region selection is saved/);
});

test('missing metrics are not estimated, invalid timestamps are skipped, and missing dates break each line', () => {
  const {api} = regional(), data = sample();
  data.series = [{...data.series[0], points: data.series[0].points.map(point => ({...point, min: null, max: null}))}];
  data.series[0].points.push({time: 'invalid', min: 0, avg: 0, max: 0});
  const rendered = api.markup({...state, priceMetrics: metrics}, data, 1000);
  assert.equal(rendered.info.series.length, 1);
  assert.equal(rendered.info.series[0].metric, 'avg');
  assert.equal(rendered.info.series[0].points.length, 2);
  assert.match(rendered.html, /M[\d.,]+ M[\d.,]+/);
  assert.doesNotMatch(rendered.html, /NaN|Infinity|\$0\.00/);
  assert.equal(api.markup({...state, priceMetrics: ['max']}, {...data, metric: 'max'}, 1000).info, null);
});

test('chart exposes every time range but requests only free windows through 3M', () => {
  const {api} = regional();
  const rendered = api.markup(state, sample(), 1000);
  for (const period of ['1D', '3D', '1W', '1M', '3M', '6M', '1Y', 'ALL']) assert.ok(rendered.html.includes('data-value="' + period + '"'));
  for (const period of ['1D', '3D', '1W', '1M', '3M']) assert.equal(new URLSearchParams(api.queryFor({...state, period})).get('period'), period);
  for (const period of ['6M', '1Y', 'ALL', 'invalid']) assert.equal(new URLSearchParams(api.queryFor({...state, period})).get('period'), '3D');
});

async function fallback(selected, data) {
  const headings = Object.fromEntries(['marketPriceLabel', 'marketPrice', 'marketRecords', 'marketChange', 'historyPrimaryCaption'].map(id => [id, {textContent: '', className: ''}]));
  const listeners = {}, tip = {innerHTML: '', hidden: true, style: {}}, attrs = {};
  const hit = {addEventListener: (event, callback) => {listeners[event] = callback;}, setAttribute: (key, value) => {attrs[key] = value;}};
  const svg = {dataset: {plotWidth: '900'}, querySelector: () => ({setAttribute: () => {}}), getBoundingClientRect: () => ({left: 0, width: 900})};
  const target = {innerHTML: '', isConnected: true, clientWidth: 1000, contains: () => false, querySelector: selector => ({svg, '.capacity-hit': hit, '.capacity-tooltip': tip}[selector] || null)};
  const window = {ONMarket: {modelOf: model => ({canonical: model}), regionCode: value => value, regionLabel: value => value}, dispatchEvent: () => {}};
  const document = {hidden: false, activeElement: null, getElementById: id => id === 'capacityHistory' ? target : headings[id]};
  const requests = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../OpenNEXT-capacity-chart.js'), 'utf8'), {window, document, URLSearchParams, AbortSignal, CustomEvent: class {}, setTimeout: () => 1, clearTimeout: () => {}, fetch: async url => {requests.push(url); return {ok: true, json: async () => data};}});
  window.OpenNEXTHistory.bind({...state, priceMetrics: selected});
  await new Promise(resolve => setImmediate(resolve));
  return {headings, target, tip, listeners, attrs, requests};
}

test('fallback capacity chart renders all selected statistics in one fetch and lists exact values in tooltip', async () => {
  const data = {points: sample().series[0].points.map(point => ({time: point.time, values: {Spot: {min: point.min, avg: point.avg, max: point.max, value: point.min}}})), meta: {bucketMinutes: 1440}};
  const result = await fallback(metrics, data);
  assert.equal((result.target.innerHTML.match(/data-capacity-line=/g) || []).length, 3);
  assert.equal(result.requests.length, 1);
  assert.match(result.requests[0], /period=3M/);
  assert.equal(result.headings.marketPriceLabel.textContent, 'AVERAGE SPOT / GPU-HR');
  assert.equal(result.headings.marketPrice.textContent, '$2.20');
  result.listeners.focus();
  assert.match(result.tip.innerHTML, /\$3\.20<\/b><span>Spot · Highest/);
  assert.match(result.tip.innerHTML, /\$2\.20<\/b><span>Spot · Average/);
  assert.match(result.tip.innerHTML, /\$1\.20<\/b><span>Spot · Lowest/);
  assert.match(result.tip.innerHTML, /<small>03 Oct, 00:00 UTC<\/small>$/);
});

test('fallback missing minimum and maximum never borrow the default value or become zero', async () => {
  const data = {points: [{time: '2026-10-01T00:00:00Z', values: {Spot: {min: null, avg: 2, max: null, value: 2}}}], meta: {bucketMinutes: 1440}};
  const result = await fallback(metrics, data);
  assert.equal((result.target.innerHTML.match(/data-capacity-line=/g) || []).length, 1);
  assert.match(result.target.innerHTML, /data-price-metric="avg"/);
  result.listeners.focus();
  assert.match(result.tip.innerHTML, /<b>—<\/b><span>Spot · Highest/);
  assert.match(result.tip.innerHTML, /<b>—<\/b><span>Spot · Lowest/);
  assert.doesNotMatch(result.tip.innerHTML, /\$0\.00/);
});
