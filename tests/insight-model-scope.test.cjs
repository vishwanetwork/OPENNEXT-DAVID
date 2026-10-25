'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'OpenNEXT-seller-activities-preview.js'), 'utf8');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const row = (id, model, price, country = 'Singapore') => ({id, model, country, term: 'Spot', gpuCount: 8, vcpu: 192, memory: 80, perGpuHourly: price, settledAt: new Date(Date.now() - 3600000).toISOString(), status: 'Completed'});
function runtime() {
  const listeners = {};
  const root = {dataset: {}, querySelector() { return null; }, addEventListener(type, handler) { listeners[type] = handler; }};
  const seen = [];
  const sandbox = {Date, Intl, document: {querySelector() { return root; }}, OpenNEXTMarketInsightIndex: {
    filterRows: () => [{model: 'B200', country: 'Germany', vcpu: 192, memory: 180}],
    render(_ctx, options) { seen.push(JSON.parse(JSON.stringify(options))); return '<section data-test-index></section>'; }, bind() {},
  }};
  vm.runInNewContext(source, sandbox);
  const api = sandbox.OpenNEXTSellerActivities;
  const ctx = {S: {role: 'Buyer'}, esc, render() {}};
  api.setSettlements([row('H100-1', 'H100 SXM', 2), row('H100-2', 'H100 SXM', 3, 'Germany'), row('H200-1', 'H200 SXM', 5)]);
  api.bind(ctx);
  const change = (attrs, value, checked = true) => listeners.change({target: {value, checked, dataset: attrs,
    hasAttribute(name) { return name === 'data-sa-trade-model' ? !!attrs.saTradeModel : false; }}});
  const click = attrs => listeners.click({target: {closest() { return {dataset: attrs, hasAttribute(name) { return name === 'data-sa-clear' && !!attrs.clear; }}; }}});
  return {api, ctx, seen, change, click, render: () => api.render(ctx)};
}
const panel = (html, name) => html.match(new RegExp('<section class="onx-sa-panel onx-sa-' + name + '"[\\s\\S]*?<\\/section>'))?.[0] || '';

test('Analytics and Activities default to one explicit model, never an All aggregation', () => {
  const app = runtime(), html = app.render();
  const filters = html.match(/data-sa-group="tradeModel"[\s\S]*?<\/details>/)[0];
  assert.match(filters, /Analytics &amp; Activities · Select one model/);
  assert.match(filters, /type="radio" name="insight-trade-model"/);
  assert.equal((filters.match(/ checked/g) || []).length, 1);
  assert.doesNotMatch(filters, /data-sa-all|<span>All<\/span>/);
  assert.match(panel(html, 'analytics'), /COMPLETED TRADES<\/small><strong>2<\/strong>/);
  assert.match(panel(html, 'activities'), /<code>H100-1<\/code>/);
  assert.doesNotMatch(panel(html, 'activities'), /H200-1/);
});

test('Index model multiselect never changes the shared single-model trade panels', () => {
  const app = runtime(); app.render();
  app.change({saOption: 'model'}, 'H200 SXM');
  app.change({saOption: 'model'}, 'B200');
  const html = app.render();
  assert.deepEqual(app.seen.at(-1).selected.model, ['H200 SXM', 'B200']);
  assert.match(html, /<summary>Index models/);
  assert.match(panel(html, 'activities'), /H100-1/);
  assert.doesNotMatch(panel(html, 'activities'), /H200-1/);
  app.change({saTradeModel: true}, 'H200 SXM');
  const next = app.render();
  assert.match(panel(next, 'analytics'), /COMPLETED TRADES<\/small><strong>1<\/strong>/);
  assert.match(panel(next, 'activities'), /H200-1/);
  assert.doesNotMatch(panel(next, 'activities'), /H100-1/);
  assert.deepEqual(app.seen.at(-1).selected.model, ['H200 SXM', 'B200']);
});

test('Shared country filters retain the chosen trade model and show empty instead of another model', () => {
  const app = runtime(); app.render();
  app.change({saTradeModel: true}, 'H200 SXM');
  app.change({saOption: 'country'}, 'Germany');
  const html = app.render();
  assert.match(panel(html, 'activities'), /No completed activities match/);
  assert.match(panel(html, 'activities'), /H200 SXM/);
  assert.doesNotMatch(panel(html, 'activities'), /H100-2/);
  app.change({saTradeModel: true}, 'All');
  assert.match(panel(app.render(), 'activities'), /H200 SXM/);
  app.click({clear: true});
  const cleared = app.render();
  assert.match(panel(cleared, 'activities'), /H200-1/);
  assert.doesNotMatch(panel(cleared, 'activities'), /H100-1/);
});

test('Visible panels determine applicable model controls without losing either selection', () => {
  const app = runtime(); app.render();
  app.change({saOption: 'model'}, 'H200 SXM');
  app.change({saTradeModel: true}, 'H200 SXM');
  app.click({saPanel: 'index'});
  let html = app.render();
  assert.doesNotMatch(html, /data-sa-group="model"|data-sa-all="model"/);
  assert.match(html, /data-sa-group="tradeModel"/);
  app.click({saPanel: 'index'});
  app.click({saPanel: 'analytics'});
  app.click({saPanel: 'activities'});
  html = app.render();
  assert.match(html, /data-sa-group="model"/);
  assert.doesNotMatch(html, /data-sa-group="tradeModel"/);
  assert.deepEqual(app.seen.at(-1).selected.model, ['H200 SXM']);
  app.click({saPanel: 'activities'});
  assert.match(panel(app.render(), 'activities'), /H200-1/);
});

test('Models without completed settlements remain an explicit empty trade view', () => {
  const app = runtime(); app.render();
  app.change({saTradeModel: true}, 'B200');
  const html = app.render();
  assert.match(panel(html, 'analytics'), /No completed trades in the selected range/);
  assert.match(panel(html, 'activities'), /No completed activities match/);
  assert.match(panel(html, 'activities'), /B200/);
  assert.doesNotMatch(panel(html, 'activities'), /H100-1|H200-1/);
});
