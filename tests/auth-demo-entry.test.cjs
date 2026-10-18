'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'OpenNEXT-auth.js'), 'utf8');
function auth(hostname) {
  const window = {location: {hostname}, dispatchEvent() {}};
  vm.runInNewContext(source, {window, CustomEvent: class {}});
  return window.OpenNEXTAuth;
}
test('sign-in and sign-up offer only real sign-in methods, with no demo entry', () => {
  for (const hostname of ['127.0.0.1', 'localhost', 'opennextlab.ai', 'terminal.opennextlab.ai']) {
    const api = auth(hostname);
    for (const mode of ['signin', 'signup']) {
      const html = api.render(mode);
      assert.doesNotMatch(html, /data-auth-demo|Enter Demo|\/demo\//);
      assert.match(html, /Continue with Google/);
      assert.match(html, /Continue with GitHub/);
      assert.match(html, /Send verification code/);
      assert.equal(api.getUser(), null);
    }
  }
});

const demoSource = fs.readFileSync(path.join(__dirname, '..', 'OpenNEXT-demo.js'), 'utf8');
function demo(pathname='/demo/', startResult={user:{id:'demo-1',role:'buyer',csrfToken:'demo-csrf'}}, search='?role=buyer') {
  const calls=[], events={}, location={pathname,search,hash:'',origin:'https://terminal.opennextlab.ai',href:'https://terminal.opennextlab.ai'+pathname+search};
  const window={location,history:{replaceState(){}},document:{documentElement:{classList:{add(){}}},readyState:'loading',addEventListener(){}},setTimeout,clearTimeout,addEventListener(name,fn){events[name]=fn;},async fetch(input,options){const url=input instanceof Request?input.url:String(input);calls.push({url,options});const result=calls.length===1?startResult:url==='/api/demo/auth/role'?{user:{...startResult.user,role:JSON.parse(options.body).role}}:{ok:true};return new Response(JSON.stringify(result),{status:200});}};
  vm.runInNewContext(demoSource,{window,URL,URLSearchParams,Request,Response,AbortController});
  return {window,calls,events};
}

test('demo bootstrap never runs on ordinary production pages', () => {
  const {window,calls}=demo('/');
  assert.equal(calls.length,0);
  assert.equal(window.OpenNEXTDemo,undefined);
});

test('demo waits for isolated session and remaps account, market, payment and contact requests', async () => {
  const {window,calls}=demo();
  await window.OpenNEXTDemo.ready;
  for(const path of ['/api/auth/session','/api/marketplace/public','/api/billing/checkout','/api/contact'])await window.fetch(path,{method:path.endsWith('session')||path.endsWith('public')?'GET':'POST',body:path.endsWith('session')||path.endsWith('public')?undefined:'{}'});
  assert.equal(calls[0].url,'/api/demo/start');
  assert.equal(JSON.parse(calls[0].options.body).role,'buyer');
  assert.deepEqual(calls.slice(1).map(c=>new URL(c.url).pathname),['/api/demo/auth/session','/api/demo/marketplace/public','/api/demo/billing/checkout','/api/demo/contact']);
  assert.ok(calls.slice(1).every(c=>c.options.credentials==='same-origin'));
});

test('demo retains read-only public prices while blocking admin, internal and unknown writes', async () => {
  const {window,calls}=demo();
  await window.OpenNEXTDemo.ready;
  await window.fetch('/api/pricing/regional-history?model=H100&period=3D');
  await window.fetch('/api/news');
  const before=calls.length;
  for(const [path,method] of [['/api/admin/marketplace','GET'],['/api/internal/install','POST'],['/api/unknown','POST'],['https://payments.example/checkout','POST']])assert.equal((await window.fetch(path,{method})).status,403);
  assert.equal(calls.length,before);
  assert.deepEqual(calls.slice(1).map(c=>c.url),['/api/pricing/regional-history?model=H100&period=3D','/api/news']);
});

test('a failed demo start never falls through to production account APIs', async () => {
  const {window,calls}=demo('/demo/',{error:'Demo is disabled.'});
  assert.equal(await window.OpenNEXTDemo.ready,null);
  const response=await window.fetch('/api/marketplace/rfqs',{method:'POST',body:'{}'});
  assert.equal(response.status,403);
  assert.equal(calls.length,1);
});

test('Request objects retain mutation payloads when routed to the sandbox', async () => {
  const {window,calls}=demo();
  await window.OpenNEXTDemo.ready;
  await window.fetch(new Request('https://terminal.opennextlab.ai/api/marketplace/rfqs',{method:'POST',body:'{"model":"H100"}',headers:{'Content-Type':'application/json'}}));
  assert.equal(calls.at(-1).url,'https://terminal.opennextlab.ai/api/demo/marketplace/rfqs');
});

test('explicit role links switch a resumed demo using its own CSRF token', async () => {
  const {window,calls}=demo('/demo/',{user:{id:'demo-1',role:'buyer',csrfToken:'demo-csrf'}},'?role=seller');
  const result=await window.OpenNEXTDemo.ready;
  assert.equal(result.user.role,'seller');
  assert.equal(calls.length,2);
  assert.equal(calls[1].url,'/api/demo/auth/role');
  assert.equal(calls[1].options.headers['X-CSRF-Token'],'demo-csrf');
  assert.equal(JSON.parse(calls[1].options.body).role,'seller');
});

test('plain demo URLs preserve the role of an existing test workspace', async () => {
  const {window,calls}=demo('/demo/',{user:{id:'demo-1',role:'seller',csrfToken:'demo-csrf'}},'');
  const result=await window.OpenNEXTDemo.ready;
  assert.equal(result.user.role,'seller');
  assert.equal(calls.length,1);
});

function element(extra = {}) {
  const attributes = {};
  return {...extra, focused: false, focus() {this.focused = true;}, setAttribute(name, value) {attributes[name] = value;}, removeAttribute(name) {delete attributes[name];}, getAttribute(name) {return attributes[name];}, hasAttribute(name) {return name in attributes;}};
}
function signInForm() {
  const fetches = [], window = {location: {hostname: 'terminal.opennextlab.ai'}, dispatchEvent() {}};
  vm.runInNewContext(source, {window, CustomEvent: class {}, fetch: async (...args) => {fetches.push(args); return new Response('{}');}, FormData: class {constructor(form) {this.form = form;} get(name) {return this.form.inputs.find(input => input.name === name).value;}}, Response});
  const input = element({name: 'email', value: ''}), submit = element({disabled: false}), box = element({textContent: '', hidden: true});
  const form = element({inputs: [input], querySelector: selector => selector === '[type="submit"]' ? submit : null, querySelectorAll: selector => selector === 'input[name]' ? [input] : []});
  const root = {matches: () => true, querySelector: selector => ({'[data-auth-back]': element(), '[data-auth-email]': form, '[data-auth-error]': box})[selector] || null,
    querySelectorAll: selector => selector === '[aria-invalid]' ? [input].filter(item => item.hasAttribute('aria-invalid')) : []};
  window.OpenNEXTAuth.bind(root, {});
  return {form, input, box, fetches, submit: () => form.onsubmit({preventDefault() {}})};
}
test('forms opt out of browser-native validation bubbles', () => {
  const html = auth('localhost').render('signin');
  assert.match(html, /<form data-auth-email novalidate>/);
  assert.doesNotMatch(source, /reportValidity/);
  assert.match(source, /<form data-auth-verify novalidate>/);
});
test('email validation errors render in-page in English and never call the API', async () => {
  const page = signInForm();
  await page.submit();
  assert.equal(page.box.hidden, false);
  assert.equal(page.box.textContent, 'Enter your email address.');
  assert.equal(page.input.getAttribute('aria-invalid'), 'true');
  assert.equal(page.input.focused, true);
  page.input.value = 'not-an-email';
  await page.submit();
  assert.equal(page.box.textContent, 'Enter a valid email address, like you@company.com.');
  assert.equal(page.fetches.length, 0);
  page.input.value = 'buyer@example.com';
  page.input.oninput();
  assert.equal(page.box.hidden, true);
  assert.equal(page.input.hasAttribute('aria-invalid'), false);
});
