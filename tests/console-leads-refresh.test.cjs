'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../OpenNEXT-console-leads.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const fixture = (overrides = {}) => ({
  id:'CONTACT-1234ABCD', name:'Test Buyer', email:'buyer@example.test', company:'Fixture Company',
  title:'Procurement lead', message:'Please help with a GPU cluster.\nDelivery this month.',
  createdAt:'2026-10-25T02:03:04.000Z', updatedAt:'2026-10-25T02:03:04.000Z',
  status:'New', source:'Website contact form', history:[{status:'New', at:'2026-10-25T02:03:04.000Z', note:'Submitted through the website.'}],
  ...overrides
});

class Element {
  constructor() {
    this.listeners = new Map(); this.children = new Map(); this.dataset = {}; this.isConnected = true;
    this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this.html = '';
    const classes = new Set();
    this.classList = {toggle:(name, enabled) => enabled ? classes.add(name) : classes.delete(name), contains:name => classes.has(name)};
  }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  async emit(type, target = this) {
    const event = {target, preventDefault() {}, stopPropagation() {}};
    for (const handler of this.listeners.get(type) || []) await handler(event);
  }
  set innerHTML(value) { this.html = value; }
  get innerHTML() { return this.html; }
  querySelector(selector) { return this.children.get(selector) || null; }
  setAttribute() {}
  closest() { return this; }
  remove() { this.isConnected = false; for (const element of this.children.values()) element.isConnected = false; }
}
class Dialog extends Element {
  set innerHTML(value) {
    this.html = value;
    const match = value.match(/<form data-lead-form="([^"]+)"(?: data-id="([^"]+)" data-version="([^"]+)")?/);
    if (!match) return;
    const form = new Element();
    form.dataset = {leadForm:match[1], id:match[2], version:match[3]};
    const selected = value.match(/<option selected>([^<]+)<\/option>/)?.[1] || 'New';
    form.fields = {status:selected, note:'', token:''};
    const submit = new Element(), error = new Element(), changed = new Element();
    changed.hidden = true; error.hidden = true;
    form.children.set('button[type="submit"],button:not([type])', submit);
    form.children.set('.on-lead-form-error', error);
    form.children.set('[data-lead-changed]', changed);
    form.children.set('[name="token"]', new Element());
    this.form = form;
    this.children.set('[data-lead-form="update"]', match[1] === 'update' ? form : null);
  }
  get innerHTML() { return this.html; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
  remove() { super.remove(); if (this.form) this.form.isConnected = false; }
}
function panel() {
  const root = new Element();
  for (const selector of ['.on-leads-message', '.on-leads-stats', '.on-leads-table', '[data-lead-search]', '[data-lead-filter]']) root.children.set(selector, new Element());
  root.querySelector('[data-lead-filter]').value = 'All requests';
  return root;
}
function harness() {
  const document = new Element(), window = new Element(), dialogs = [], timers = new Map(), calls = [];
  let root = panel(), nextTimer = 1, list = [], handler;
  document.hidden = false;
  document.querySelector = selector => selector === '.on-leads' ? root : null;
  document.createElement = () => new Dialog();
  document.body = {append:element => dialogs.push(element)};
  const response = (data, status = 200) => ({ok:status >= 200 && status < 300, status, json:async () => data});
  const fetch = async (url, options) => {
    const call = {url, options, body:options.body ? JSON.parse(options.body) : undefined};
    calls.push(call);
    return handler ? handler(call) : response({leads:JSON.parse(JSON.stringify(list))});
  };
  vm.runInNewContext(source, {
    document, window, fetch, AbortController, Date,
    FormData:class { constructor(form) { this.form = form; } get(name) { return this.form.fields[name]; } },
    setInterval:(callback, delay) => { const id = nextTimer++; timers.set(id, {callback, delay}); return id; },
    clearInterval:id => timers.delete(id)
  });
  return {
    api:window.OpenNEXTConsoleLeads, window, document, dialogs, calls, timers, response,
    get root() { return root; }, setList:value => { list = value; }, setHandler:value => { handler = value; },
    newRoot() { root.isConnected = false; root = panel(); return root; },
    async mount() { window.OpenNEXTConsoleLeads.mount(); await tick(); },
    async action(action, id) { const button = new Element(); button.dataset = {leadAction:action, id}; await root.emit('click', button); },
    get dialog() { return dialogs.filter(item => item.isConnected).at(-1); },
    get table() { return root.querySelector('.on-leads-table').innerHTML; }
  };
}

test('Console emphasizes email, company, UTC submission time and Detail; the dialog includes all submitted fields', async () => {
  const h = harness();
  h.setList([fixture({name:'<script>bad</script>', message:'Full request <img src=x onerror=alert(1)>', source:'<source>'})]);
  await h.mount();
  assert.match(h.table, /<th>Email<\/th><th>Company<\/th><th>Submitted time/);
  assert.match(h.table, /25 Oct 2026, 02:03:04/);
  assert.match(h.table, />Detail<\/button>/);
  assert.match(h.table, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(h.table, /<script>|<img|Full request/);
  await h.action('details', fixture().id);
  for (const value of ['Name', 'Title', 'Email', 'Company', 'Submitted time · UTC', 'Procurement lead', 'buyer@example.test', 'Fixture Company', 'How can we help?', 'Request history']) assert(h.dialog.innerHTML.includes(value));
  assert.match(h.dialog.innerHTML, /Full request &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(h.dialog.innerHTML, /&lt;source&gt;/);
  assert.equal(h.calls[0].url, '/api/admin/contacts');
  assert.equal(h.calls[0].options.credentials, 'same-origin');
  assert.equal(h.calls[0].options.cache, 'no-store');
  h.api.destroy();
});

test('visible-page polling, focus and visibility refresh add new submissions without resetting search or status filters', async () => {
  const h = harness(); await h.mount();
  assert.equal(h.timers.size, 1); const timer = [...h.timers.values()][0]; assert.equal(timer.delay, 15000);
  const search = h.root.querySelector('[data-lead-search]'), filter = h.root.querySelector('[data-lead-filter]');
  search.value = 'Fixture'; await search.emit('input'); filter.value = 'New'; await filter.emit('change');
  h.setList([fixture()]);
  timer.callback(); await tick();
  assert.match(h.table, /buyer@example.test/);
  assert.equal(search.value, 'Fixture'); assert.equal(filter.value, 'New');
  h.document.hidden = true; const previous = h.calls.length;
  timer.callback(); await h.window.emit('focus'); await tick(); assert.equal(h.calls.length, previous);
  h.document.hidden = false; await h.document.emit('visibilitychange'); await tick(); assert.equal(h.calls.length, previous + 1);
  await h.window.emit('focus'); await tick(); assert.equal(h.calls.length, previous + 2);
  h.api.destroy(); assert.equal(h.timers.size, 0);
  await h.window.emit('focus'); timer.callback(); await tick(); assert.equal(h.calls.length, previous + 2);
  assert.match(h.api.render(), /value="Fixture"/); assert.match(h.api.render(), /<option selected>New/);
});

test('polling preserves unsaved notes and status and PATCH uses the opened version instead of the freshly polled version', async () => {
  const h = harness(); const initial = fixture(); h.setList([initial]); await h.mount();
  await h.action('details', initial.id);
  const dialog = h.dialog, form = dialog.form;
  form.fields.note = 'Unsaved operational follow-up'; form.fields.status = 'Qualified';
  h.setList([fixture({status:'Contacted', updatedAt:'2026-10-25T02:04:00.000Z'})]);
  await h.api.refresh();
  assert.equal(h.dialog, dialog); assert.equal(form.fields.note, 'Unsaved operational follow-up'); assert.equal(form.fields.status, 'Qualified');
  assert.equal(form.querySelector('[data-lead-changed]').hidden, false);
  h.setHandler(call => call.options.method === 'PATCH' ? h.response({error:'This request has changed.'}, 409) : h.response({leads:[]}));
  await dialog.emit('submit', form);
  const request = h.calls.find(call => call.options.method === 'PATCH');
  assert.equal(request.body.updatedAt, initial.updatedAt);
  assert.equal(request.body.status, 'Qualified'); assert.equal(request.body.note, 'Unsaved operational follow-up');
  assert.equal(h.dialog, dialog); assert.equal(form.fields.note, 'Unsaved operational follow-up');
  assert.match(form.querySelector('.on-lead-form-error').textContent, /draft has been preserved/);
  assert.equal(form.querySelector('button[type="submit"],button:not([type])').disabled, false);
  h.api.destroy();
});

test('successful status updates keep the existing authenticated workflow and do not claim an email was sent', async () => {
  const h = harness(); let record = fixture();
  h.setHandler(call => {
    if (call.options.method === 'PATCH') {
      record = {...record, status:call.body.status, updatedAt:'2026-10-25T02:04:00.000Z', history:[{status:call.body.status, note:call.body.note, at:'2026-10-25T02:04:00.000Z'}, ...record.history]};
      return h.response({lead:record});
    }
    return h.response({leads:[record]});
  });
  await h.mount(); await h.action('details', record.id);
  const previous = h.dialog; previous.form.fields.status = 'Qualified'; previous.form.fields.note = 'Budget confirmed.';
  await previous.emit('submit', previous.form);
  assert.equal(previous.isConnected, false); assert.match(h.dialog.innerHTML, /Budget confirmed\./);
  assert.match(h.table, /qualified/);
  assert.match(h.root.querySelector('.on-leads-message').textContent, /No email has been sent/);
  assert.equal(h.calls.filter(call => call.options.method === 'PATCH').length, 1);
  assert.equal(h.calls.some(call => /mail|email|contact$/.test(call.url)), false);
  h.api.destroy();
});

test('expired administrator access clears private rows and dialogs and pauses automatic requests', async () => {
  const h = harness(); h.setList([fixture()]); await h.mount(); await h.action('details', fixture().id);
  const previousDialog = h.dialog;
  h.setHandler(() => h.response({error:'Administrator session expired.'}, 401));
  await h.api.refresh();
  assert.equal(previousDialog.isConnected, false); assert.equal(h.dialog, undefined);
  assert.doesNotMatch(h.table, /buyer@example.test|Fixture Company/);
  assert.match(h.table, /Administrator access required/);
  assert.equal(h.root.querySelector('.on-leads-stats').innerHTML.match(/<strong>0<\/strong>/g).length, 4);
  const search = h.root.querySelector('[data-lead-search]'); search.value = 'Fixture'; await search.emit('input');
  assert.match(h.table, /Connect administrator session/);
  const previous = h.calls.length;
  await h.window.emit('focus'); [...h.timers.values()][0].callback(); await tick(); assert.equal(h.calls.length, previous);
  h.setList([]); h.setHandler(null); await h.api.refresh();
  await h.window.emit('focus'); await tick(); assert.equal(h.calls.length, previous + 2);
  h.api.destroy();
});

test('coalesced reads and mount generation prevent overlapping polls and old page responses leaking into a new page', async () => {
  const h = harness(), resolvers = [];
  h.setHandler(() => new Promise(resolve => resolvers.push(resolve)));
  h.api.mount(); await tick();
  await h.window.emit('focus'); [...h.timers.values()][0].callback(); await tick(); assert.equal(h.calls.length, 1);
  const firstSignal = h.calls[0].options.signal;
  h.newRoot(); h.api.mount(); await tick(); assert.equal(h.calls.length, 2); assert.equal(firstSignal.aborted, true);
  resolvers[1](h.response({leads:[fixture({email:'current@example.test'})]})); await tick();
  resolvers[0](h.response({leads:[fixture({email:'previous@example.test'})]})); await tick();
  assert.match(h.table, /current@example.test/); assert.doesNotMatch(h.table, /previous@example.test/);
  assert.equal(h.timers.size, 1); h.api.destroy();
});
