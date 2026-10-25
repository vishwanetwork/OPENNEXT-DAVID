'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const state = {model: 'H100', count: 8, region: 'All regions', term: 'Spot', period: '3M', priceMetric: 'avg'};
const history = () => ({term: 'Spot', metric: 'avg', regions: [{code: 'ap-southeast-1', name: 'Singapore'}, {code: 'ap-northeast-1', name: 'Japan', city: 'Tokyo'}], meta: {bucketMinutes: 1440}, series: [
  {id: 'original-p5.48xlarge-ap-southeast-1', region: 'ap-southeast-1', name: 'Singapore · ap-southeast-1', configuration: 'p5.48xlarge', gpuCount: 8,
    points: [{time: '2026-10-17T00:00:00Z', min: 2, avg: 2.3, max: 2.6}, {time: '2026-10-18T00:00:00Z', min: 2.1, avg: 2.4, max: 2.7}]},
  {id: 'original-p5e.48xlarge-ap-northeast-1', region: 'ap-northeast-1', name: 'Tokyo (ap-northeast-1)', configuration: 'p5e.48xlarge', gpuCount: 8,
    points: [{time: '2026-10-17T00:00:00Z', min: 3, avg: 3.3, max: 3.6}, {time: '2026-10-18T00:00:00Z', min: 3.1, avg: 3.4, max: 3.7}]},
]});
const visible = html => html.replace(/<[^>]*>/g, ' ');
const click = (target, selector) => target.onclick({target: {closest: value => value === selector ? {} : null}});
function renderer() {
  const headings = Object.fromEntries(['marketPriceLabel', 'marketPrice', 'historyPrimaryCaption', 'marketRecords', 'marketChange'].map(id => [id, {textContent: ''}]));
  const window = {ONMarket: {modelOf: model => ({canonical: model}), regionCode: value => value, regionLabel: value => ({'ap-southeast-1': 'Singapore', 'ap-northeast-1': 'Tokyo'}[value] || value)}, dispatchEvent: () => {}};
  const listeners = {};
  const document = {body: {}, activeElement: null, modal: null, getElementById: id => headings[id] || null,
    addEventListener: (event, handler) => {listeners[event] ||= []; listeners[event].push(handler);}, querySelector: () => document.modal};
  document.activeElement = document.body;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../OpenNEXT-history-chart.js'), 'utf8'), {window, document, URLSearchParams, AbortSignal, console, CustomEvent: class {constructor(type, options) {this.type = type; this.detail = options.detail;}}});
  const tip = {innerHTML: '', hidden: true, style: {}};
  const line = {setAttribute: () => {}}, circle = {setAttribute: () => {}};
  const hover = {setAttribute: () => {}, querySelector: selector => selector === 'line' ? line : circle};
  const svg = {getBoundingClientRect: () => ({left: 0, top: 0, width: 960, height: 360}), querySelector: () => hover};
  const controls = {};
  const target = {innerHTML: '', isConnected: true, clientWidth: 1000, contains: node => node?.owner === target, querySelectorAll: () => [], querySelector: selector => selector === '.history-tooltip' ? tip : selector === '.history-picker' ? (target.innerHTML.includes('class="history-picker"') ? {owner: target} : null) : controls[selector] || null, addEventListener: () => {}, removeEventListener: () => {}};
  for (const selector of ['[data-region-toggle]', '[data-region-all]', '[data-region-clear]', '[data-region-search]']) controls[selector] = {selector, owner: target, focus: () => {document.activeElement = controls[selector];}};
  return {api: window.OpenNEXTRegionalHistory, target, headings, window, tip, svg, document, listeners};
}

test('Compare regions removes observation counters, machine names, and provider region suffixes', () => {
  const {api, target, headings} = renderer();
  api.mount(target, state, history());
  click(target, '[data-region-toggle]');
  assert.doesNotMatch(visible(target.innerHTML), /\d+ points|\.48xlarge|ap-[a-z-]+-\d/);
  assert.match(target.innerHTML, /aria-label="Singapore"/);
  assert.match(target.innerHTML, /aria-label="Tokyo"/);
  assert.match(visible(target.innerHTML), /Singapore/);
  assert.match(visible(target.innerHTML), /Tokyo/);
  assert.equal(headings.historyPrimaryCaption.textContent, 'Singapore · 18 Oct');
  assert.doesNotMatch(target.innerHTML, /(?:title|aria-label)="[^"]*(?:\.48xlarge|ap-southeast-1)/);
});

test('presentation changes do not mutate source identities, observations, or selected prices', () => {
  const {api, target, window} = renderer(), data = history(), original = JSON.stringify(data);
  api.mount(target, state, data);
  click(target, '[data-region-all]');
  const result = window.__onHistoryChartInfo.series;
  assert.equal(result.length, 2);
  assert.equal(result[0].id, data.series[0].id);
  assert.equal(result[0].configuration, 'p5.48xlarge');
  assert.equal(result[0].region, 'ap-southeast-1');
  assert.equal(result[0].points.at(-1).value, 2.4);
  assert.equal(result[1].points.at(-1).value, 3.4);
  assert.equal(JSON.stringify(data), original);
  click(target, '[data-region-toggle]');
  assert.match(target.innerHTML, /data-region-id="original-p5\.48xlarge-ap-southeast-1"/);
});

test('different configurations in the same region remain separately named and selectable', () => {
  const {api, target, window} = renderer(), data = history();
  data.series.push({...data.series[0], id: 'another-machine', configuration: 'p5en.48xlarge', points: data.series[0].points.map(p => ({...p, avg: p.avg + 1}))});
  api.mount(target, state, data);
  click(target, '[data-region-toggle]');
  assert.match(target.innerHTML, /aria-label="Singapore · Series 1"/);
  assert.match(target.innerHTML, /aria-label="Singapore · Series 2"/);
  click(target, '[data-region-all]');
  assert.equal(window.__onHistoryChartInfo.series.length, 3);
  assert.equal(new Set(window.__onHistoryChartInfo.series.map(s => s.id)).size, 3);
  api.mount(target, state, {...data, series: [...data.series].reverse()});
  assert.equal(window.__onHistoryChartInfo.series.find(s => s.id === 'another-machine').display.description, 'Series 2');
});

test('human readable hardware details remain available without EC2 instance identifiers', () => {
  const {api} = renderer();
  assert.equal(api.cleanLabel('p5.48xlarge'), '');
  assert.equal(api.cleanLabel('Singapore · ap-southeast-1 · p5.48xlarge'), 'Singapore');
  assert.equal(api.cleanLabel('Tokyo (ap-northeast-1)'), 'Tokyo');
  assert.equal(api.cleanLabel('8 GPUs · 80 GB · SXM'), '8 GPUs · 80 GB · SXM');
  assert.equal(api.cleanLabel('p4d.24xlarge · 8 GPUs'), '8 GPUs');
  assert.equal(api.cleanLabel('US East · us-east-1'), 'US East');
});

test('unknown code-only region names are not shown as provider codes or invented countries', () => {
  const {api} = renderer(), data = history();
  data.regions = [];
  data.series = [{...data.series[0], id: 'unknown', name: 'ap-example-1', region: 'ap-example-1'}];
  const result = api.markup(state, data, 1000);
  assert.equal(result.info.series[0].display.name, 'Region not specified');
  assert.doesNotMatch(visible(result.html), /ap-example-1/);
});

test('tooltip shows a clean country name with bold price first and timestamp last', () => {
  const {api, target, window, tip, svg} = renderer();
  api.mount(target, state, history());
  const point = window.__onHistoryChartInfo.series[0].points[0];
  target.onpointermove({clientX: point.x, clientY: point.y, target: {closest: selector => selector === '.regional-price-plot svg' ? svg : null}});
  assert.match(tip.innerHTML, /^<strong>\$2\.30 /);
  assert.match(tip.innerHTML, /Singapore · Average/);
  assert.match(tip.innerHTML, /<time>17 Oct 2026<\/time>$/);
  assert.doesNotMatch(tip.innerHTML, /\.48xlarge|ap-southeast-1/);
  assert.equal(tip.hidden, false);
});

async function capacity(area, shared) {
  const listeners = {}, tip = {innerHTML: '', hidden: true, style: {}}, requests = [];
  const hit = {addEventListener: (event, callback) => {listeners[event] = callback;}, setAttribute: () => {}};
  const svg = {dataset: {plotWidth: '900'}, querySelector: () => ({setAttribute: () => {}}), getBoundingClientRect: () => ({left: 0, width: 900})};
  const target = {innerHTML: '', isConnected: true, clientWidth: 1000, contains: () => false, querySelector: selector => ({svg, '.capacity-hit': hit, '.capacity-tooltip': tip}[selector] || null)};
  const data = {latest: {'On-demand': {value: 4.5}}, points: [{time: '2026-10-18T00:00:00Z', values: {'On-demand': {value: 4.5}}}],
    meta: {bucketMinutes: 1440, matchingOfferings: 1, reference: {area, gpuCount: 8, gpuMemoryGb: 80, formFactor: 'SXM', instanceType: 'p5.48xlarge'}}};
  const window = {ONMarket: {modelOf: model => ({canonical: model}), regionCode: value => value, regionLabel: value => value}, dispatchEvent: () => {}};
  if (shared) window.OpenNEXTRegionalHistory = {cleanLabel: renderer().api.cleanLabel};
  const document = {hidden: false, activeElement: null, getElementById: id => id === 'capacityHistory' ? target : null};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../OpenNEXT-capacity-chart.js'), 'utf8'), {window, document, URLSearchParams, AbortSignal, CustomEvent: class {}, setTimeout: () => 1, clearTimeout: () => {}, fetch: async url => {requests.push(url); return {ok: true, json: async () => data};}});
  window.OpenNEXTHistory.bind({...state, region: 'ap-southeast-1', term: 'On-demand'});
  await new Promise(resolve => setImmediate(resolve));
  listeners.focus();
  return {target, tip, requests};
}

test('On-demand fallback cleans region labels with or without the shared regional renderer', async () => {
  for (const shared of [false, true]) {
    const result = await capacity('Singapore · ap-southeast-1 · p5.48xlarge', shared);
    assert.match(result.target.innerHTML, /Reference offering: 8 × H100 · 80 GB · SXM · Singapore/);
    assert.doesNotMatch(visible(result.target.innerHTML), /\.48xlarge|ap-southeast-1/);
    assert.match(result.tip.innerHTML, /^<div class="capacity-tip-row"><b>\$4\.50/);
    assert.doesNotMatch(result.tip.innerHTML, /\.48xlarge|ap-southeast-1/);
    assert.equal(new URL(result.requests[0], 'https://example.test').searchParams.get('region'), 'ap-southeast-1');
  }
});

test('unknown On-demand region codes do not become invented locations', async () => {
  const result = await capacity('ap-example-1', false);
  assert.match(result.target.innerHTML, /SXM · Region not specified/);
  assert.doesNotMatch(visible(result.target.innerHTML), /ap-example-1/);
});

test('Select all and Clear restore keyboard focus after region picker rerenders', () => {
  const {api, target, document} = renderer();
  api.mount(target, state, history()); click(target, '[data-region-toggle]');
  click(target, '[data-region-all]');
  assert.equal(document.activeElement.selector, '[data-region-all]');
  let stopped = false;
  target.onkeydown({key: 'Escape', preventDefault() {}, stopPropagation() {stopped = true;}});
  assert.ok(stopped); assert.equal(document.activeElement.selector, '[data-region-toggle]');
  assert.doesNotMatch(target.innerHTML, /class="history-picker"/);
  click(target, '[data-region-toggle]'); click(target, '[data-region-clear]');
  assert.equal(document.activeElement.selector, '[data-region-clear]');
});

test('Escape closes an open picker after focus falls to body without stacking document handlers', () => {
  const {api, target, document, listeners} = renderer();
  api.mount(target, state, history()); click(target, '[data-region-toggle]');
  for (let i = 0; i < 4; i++) api.mount(target, state, history());
  assert.equal(listeners.keydown.length, 1);
  document.activeElement = document.body;
  let prevented = false, stopped = false;
  listeners.keydown[0]({key: 'Escape', preventDefault() {prevented = true;}, stopImmediatePropagation() {stopped = true;}});
  assert.ok(prevented && stopped);
  assert.doesNotMatch(target.innerHTML, /class="history-picker"/);
  assert.equal(document.activeElement.selector, '[data-region-toggle]');
});

test('global picker Escape handler does not consume another input, a modal, or a removed chart', () => {
  const {api, target, document, listeners} = renderer();
  api.mount(target, state, history()); click(target, '[data-region-toggle]');
  let consumed = 0;
  const escape = {key: 'Escape', preventDefault() {consumed++;}, stopImmediatePropagation() {consumed++;}};
  document.activeElement = {tagName: 'INPUT'}; listeners.keydown[0](escape);
  assert.equal(consumed, 0); assert.match(target.innerHTML, /class="history-picker"/);
  document.activeElement = document.body; document.modal = {}; listeners.keydown[0](escape);
  assert.equal(consumed, 0); assert.match(target.innerHTML, /class="history-picker"/);
  document.modal = null; target.isConnected = false; listeners.keydown[0](escape);
  assert.equal(consumed, 0);
});
