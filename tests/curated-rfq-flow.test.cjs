'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {listCuratedRfqs} = require('../OpenNEXT-curated-rfqs.cjs');
const source = fs.readFileSync(path.join(__dirname, '..', 'OpenNEXT-curated-inquiries.js'), 'utf8');
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

function setup({contactAvailable = true} = {}) {
  const contacts = [], dialogs = [], delayedCloses = [];
  const document = {activeElement:null, body:{style:{overflow:'scroll'}, append(element) {element.isConnected = true; dialogs.push(element);}}};
  const trigger = {isConnected:true, focus() {document.activeElement = this;}};
  document.activeElement = trigger;
  class Element {
    constructor() {this.handlers = {}; this.children = {}; this.open = false; this.hidden = true;}
    setAttribute(name, value) {this[name] = value;}
    addEventListener(name, handler) {(this.handlers[name] ||= []).push(handler);}
    emit(name, event = {}) {for (const handler of this.handlers[name] || []) handler(event);}
    querySelector(selector) {return this.children[selector] ||= new Element();}
    showModal() {this.open = true;}
    close() {this.open = false; delayedCloses.push(() => this.emit('close'));}
    remove() {this.isConnected = false;}
    focus() {document.activeElement = this;}
    getBoundingClientRect() {return {left:20, right:700, top:20, bottom:700};}
  }
  document.createElement = () => new Element();
  const window = contactAvailable ? {OpenNEXTContact:{open(options) {contacts.push(options); document.activeElement = 'contact-form';}}} : {};
  vm.runInNewContext(source, {window, document});
  return {api:window.OpenNEXTCuratedInquiries, contacts, dialogs, document, trigger, delayedCloses};
}

test('curated RFQ inquiries retain exact requirements and use the existing contact collector only', () => {
  const {api, contacts, dialogs} = setup();
  for (const item of listCuratedRfqs()) {
    assert.equal(api.offer(item), true);
    const message = contacts.at(-1).message;
    assert.match(message, new RegExp(item.id));
    assert.ok(message.includes(item.title));
    assert.ok(message.includes(item.paymentTerms));
    for (const spec of item.specifications) assert.ok(message.includes(`${spec.label}: ${spec.value}`));
    for (const label of ['Location','Quantity','Rental term','Deployment','Payment']) {
      assert.equal(message.split('\n').filter(line => line.startsWith(`${label}: `)).length, 1, `${item.id} must contain one complete ${label} field`);
    }
    assert.ok(message.length < 4000, `${item.id} exceeds the contact message limit`);
    assert.doesNotMatch(message, /\$\d|simulat|demo|test data/i);
  }
  assert.equal(contacts.length, 4);
  assert.equal(dialogs.length, 0);
  assert.match(contacts[0].message, /Location: Any region outside the United States/);
  assert.match(contacts[0].message, /Quantity: 32 servers/);
  assert.match(contacts[0].message, /Rental term: 6 months or 1 year/);
  assert.match(contacts[0].message, /Deployment: As soon as possible; preferably before early December 2026/);
  assert.match(contacts[1].message, /Location: Any region/);
  assert.match(contacts[1].message, /Quantity: 32 or 64 servers/);
  assert.match(contacts[1].message, /Cluster: All servers must form one unified cluster/);
  assert.match(contacts[1].message, /Rental term: 1 year, 2 years or 3 years/);
  assert.match(contacts[1].message, /Deployment: Expected in Q1 2027/);
  assert.match(contacts[2].message, /Quantity: 8 B300 servers, or 1 GB200 rack, or 1 GB300 rack/);
  assert.match(contacts[2].message, /Cluster: The selected hardware must form one unified cluster/);
  assert.match(contacts[2].message, /Rental term: 6 months to 1 year/);
  assert.match(contacts[2].message, /Deployment: As soon as possible/);
  assert.match(contacts[3].message, /Location: Singapore/);
  assert.match(contacts[3].message, /Quantity: 1 server with 8 GPUs/);
  for (const term of ['Full NVSwitch connectivity across all 8 GPUs','exclusive CPU, memory and storage resources','Full Linux root access','Non-preemptible','Approximately 2 TB ECC RAM','30 TB usable NVMe preferred; at least 15 TB usable storage','Expected by 15 November 2026']) {
    assert.ok(contacts[3].message.includes(term), `H200 inquiry must preserve ${term}`);
  }
  assert.doesNotMatch(source, /\bfetch\s*\(|localStorage|sessionStorage|\/api\/marketplace\/|\/api\/demo\//);
});

test('details use the complete specification rows once without duplicate summary fields', () => {
  const {api, dialogs} = setup();
  for (const item of listCuratedRfqs()) {
    api.showDetails(item);
    const html = dialogs.at(-1).innerHTML;
    assert.equal((html.match(/<dt>/g) || []).length, item.specifications.length);
    for (const spec of item.specifications) {
      assert.ok(html.includes(`<dt>${escapeHtml(spec.label)}</dt><dd>${escapeHtml(spec.value)}</dd>`));
    }
  }
});

test('requirements without detailed specification rows retain every fallback field', () => {
  const {api, contacts, dialogs} = setup();
  const item = {...listCuratedRfqs()[0], specifications:[]};
  api.showDetails(item);
  api.offer(item);
  for (const value of [item.region,item.model,item.quantityLabel,item.termLabel,item.deliveryLabel,item.paymentTerms]) {
    assert.ok(dialogs[0].innerHTML.includes(escapeHtml(value)));
    assert.ok(contacts[0].message.includes(value));
  }
});

test('details escape every external field and show all terms without inventing a price', () => {
  const {api, dialogs, document} = setup();
  const base = listCuratedRfqs()[0];
  const item = {...base, title:'<script>injected</script>', description:'<img src=x onerror=alert(1)>', specifications:[...base.specifications,{label:'<Label>', value:'<unsafe>'}]};
  assert.equal(api.showDetails(item), true);
  const dialog = dialogs[0];
  assert.equal(dialog.open, true);
  assert.equal(dialog['aria-labelledby'], 'on-curated-heading');
  assert.equal(document.body.style.overflow, 'hidden');
  assert.match(dialog.innerHTML, /&lt;script&gt;injected&lt;\/script&gt;/);
  assert.match(dialog.innerHTML, /&lt;Label&gt;/);
  assert.match(dialog.innerHTML, /&lt;unsafe&gt;/);
  assert.doesNotMatch(dialog.innerHTML, /<script>|<img src=x|\$\d/);
  assert.ok(dialog.innerHTML.includes(escapeHtml(item.specifications.find(row => row.label === 'Deployment').value)));
  assert.match(dialog.innerHTML, /Availability and final pricing are confirmed by quote/);
});

test('offer from details closes the dialog before opening contact and preserves focus afterward', () => {
  const {api, dialogs, contacts, document, delayedCloses} = setup();
  const item = listCuratedRfqs()[3];
  api.showDetails(item);
  const dialog = dialogs[0];
  dialog.querySelector('.on-curated-offer').emit('click');
  assert.equal(dialog.open, false);
  assert.equal(dialog.isConnected, false);
  assert.equal(document.body.style.overflow, 'scroll');
  assert.equal(contacts.length, 1);
  assert.match(contacts[0].message, /2\s?TB|2 TB/);
  assert.equal(document.activeElement, 'contact-form');
  delayedCloses.forEach(callback => callback());
  assert.equal(document.activeElement, 'contact-form', 'a delayed close event must not steal contact focus');
});

test('Escape closes only the RFQ dialog and restores scroll and trigger focus', () => {
  const {api, dialogs, document, trigger} = setup();
  api.showDetails(listCuratedRfqs()[0]);
  let prevented = false, stopped = false;
  dialogs[0].emit('keydown', {key:'Escape', preventDefault() {prevented = true;}, stopPropagation() {stopped = true;}});
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(dialogs[0].isConnected, false);
  assert.equal(document.body.style.overflow, 'scroll');
  assert.equal(document.activeElement, trigger);
});

test('unavailable contact service is visible and invalid items cannot open an inquiry', () => {
  const {api, dialogs} = setup({contactAvailable:false});
  const item = listCuratedRfqs()[0];
  assert.equal(api.showDetails(null), false);
  assert.equal(api.offer({...item, sourceKind:'generated'}), false);
  assert.equal(dialogs.length, 0);
  api.showDetails(item);
  assert.equal(api.offer(item), false);
  const error = dialogs[0].querySelector('[data-curated-error]');
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /unavailable/);
  assert.equal(dialogs[0].open, true);
});
