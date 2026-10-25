'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const vm = require('node:vm');
const {Readable} = require('node:stream');
const {createPaymentRouter} = require('../OpenNEXT-payment-api.cjs');
const instances = require('../OpenNEXT-instances.js');

const checkout = {amount: 500, method: 'credit_card', idempotencyKey: 'fixture-checkout-001'};
const verified = {id: 'verified-account', onboardingCompleted: true, promotionalCredit: 100, csrfToken: 'valid-session-token'};
function payment(options = {}) {
  return createPaymentRouter({auth: {authenticate: async req => req.user, checkCsrf: (req, user) => req.headers.origin === 'https://terminal.example' && req.headers['x-csrf-token'] === user.csrfToken}, ...options});
}
async function callPayment(route, {input = checkout, raw, method = 'POST', user = verified, headers = {origin: 'https://terminal.example', 'x-csrf-token': verified.csrfToken}} = {}) {
  const request = Readable.from([raw === undefined ? JSON.stringify(input) : raw]);
  Object.assign(request, {method, user, headers: {'content-type': 'application/json', ...headers}});
  let status, result;
  await route(request, {writeHead: code => {status = code;}, end: body => {result = JSON.parse(body);}}, new URL('https://terminal.example/api/billing/checkout'));
  return {status, result};
}

test('checkout requires a verified onboarded session and matching CSRF origin/token before using an adapter', async () => {
  let calls = 0;
  const route = payment({checkoutAdapter: {createCheckout: async () => {calls++; return {checkoutUrl: 'https://checkout.example/session'};}}, allowedOrigins: ['https://checkout.example']});
  assert.equal((await callPayment(route, {user: null})).status, 401);
  assert.equal((await callPayment(route, {user: {...verified, onboardingCompleted: false}})).status, 401);
  assert.equal((await callPayment(route, {headers: {origin: 'https://evil.example', 'x-csrf-token': verified.csrfToken}})).status, 403);
  assert.equal((await callPayment(route, {headers: {origin: 'https://terminal.example'}})).status, 403);
  assert.equal((await callPayment(route, {headers: {origin: 'https://terminal.example', 'x-csrf-token': 'wrong'}})).status, 403);
  assert.equal((await callPayment(route, {method: 'GET'})).status, 405);
  assert.equal(calls, 0);
});

test('invalid checkout bodies fail with client errors rather than escaping the router', async () => {
  const route = payment();
  for (const raw of ['null', '[]', 'true', '"text"', '{invalid']) {
    assert.equal((await callPayment(route, {raw})).status, 400, raw);
  }
  for (const input of [{...checkout, amount: 0}, {...checkout, amount: -1}, {...checkout, amount: 100001}, {...checkout, amount: 1.001}, {...checkout, method: 'wire'}, {...checkout, idempotencyKey: 'bad'}]) {
    assert.equal((await callPayment(route, {input})).status, 400);
  }
  assert.equal((await callPayment(route, {raw: JSON.stringify({padding: 'x'.repeat(5000)})})).status, 413);
});

test('unconfigured payment providers add no funds and do not manufacture payment success', async () => {
  const account = structuredClone(verified), before = JSON.stringify(account);
  for (const method of ['credit_card', 'paypal']) {
    const result = await callPayment(payment(), {input: {...checkout, method}, user: account});
    assert.equal(result.status, 503);
    assert.equal(result.result.code, 'PAYMENTS_NOT_CONFIGURED');
    assert.match(result.result.error, /balance has not changed/);
    assert.equal(result.result.checkoutUrl, undefined);
  }
  assert.equal(JSON.stringify(account), before);
});

test('authentication storage failures produce a safe service error instead of escaping checkout routing', async () => {
  let calls = 0;
  const route = createPaymentRouter({auth: {authenticate: async () => {throw Object.assign(new Error('private authentication storage diagnostic'), {status: 503});}, checkCsrf: () => true},
    checkoutAdapter: {createCheckout: async () => {calls++; return {checkoutUrl: 'https://checkout.example/session'};}}});
  const result = await callPayment(route);
  assert.ok([500, 503].includes(result.status));
  assert.doesNotMatch(JSON.stringify(result.result), /private authentication storage diagnostic/);
  assert.equal(calls, 0);
});

test('checkout pins authenticated identity, integer USD cents, and allowlisted HTTPS destinations', async () => {
  let received;
  const adapter = url => ({createCheckout: async input => {received = input; return {checkoutUrl: url};}});
  const result = await callPayment(payment({checkoutAdapter: adapter('https://checkout.example/session/123'), allowedOrigins: ['https://checkout.example']}), {input: {...checkout, amount: 123.45, userId: 'attacker', currency: 'OTHER'}});
  assert.equal(result.status, 200);
  assert.deepEqual(received, {userId: verified.id, currency: 'USD', amountCents: 12345, method: 'credit_card', idempotencyKey: checkout.idempotencyKey});
  for (const url of ['http://checkout.example/session', 'https://evil.example/session', 'javascript:alert(1)']) {
    assert.equal((await callPayment(payment({checkoutAdapter: adapter(url), allowedOrigins: ['https://checkout.example']}))).status, 502);
  }
  const failure = await callPayment(payment({checkoutAdapter: {createCheckout: async () => {throw new Error('private provider diagnostic');}}, allowedOrigins: ['https://checkout.example']}));
  assert.equal(failure.status, 502); assert.doesNotMatch(JSON.stringify(failure.result), /private provider diagnostic/);
});

async function app(t, {split = false} = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opennext-integration-security-'));
  const modulePath = require.resolve('../OpenNEXT-preview-server.cjs');
  const hosts = {SITE_HOST: split ? 'site.example' : '', TERMINAL_HOST: split ? 'terminal.example' : '', ADMIN_HOST: split ? 'admin.example' : ''};
  const saved = Object.fromEntries(Object.keys(hosts).map(key => [key, process.env[key]]));
  let createAppServer;
  try {Object.assign(process.env, hosts); delete require.cache[modulePath]; ({createAppServer} = require(modulePath));}
  finally {for (const key of Object.keys(hosts)) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key]; delete require.cache[modulePath];}
  const server = createAppServer({dataDir, env: {OPENNEXT_ADMIN_TOKEN: 'fixture-administrator-token-0123456789', OPENNEXT_TRUST_PROXY: '0'}, secureCookies: false,
    pricingService: {close: async () => {}, listProviders: async () => []}, capacityService: {close: async () => {}},
    contactService: {list: async () => []},
    authAdapter: {emailEnabled: true, requestEmailCode: async () => ({challengeId: 'mail-fixture'}), verifyEmailCode: async ({email, code}) => code === '123456' ? {subject: 'fixture-subject', email, emailVerified: true, name: 'Verified Buyer'} : null}});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port, cookies = new Map();
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await server.auth.close(); await fs.rm(dataDir, {recursive: true, force: true});});
  async function call(route, {input, method = input === undefined ? 'GET' : 'POST', headers = {}} = {}) {
    const response = await fetch(origin + route, {method, headers: {Origin: origin, Cookie: [...cookies].map(([key, value]) => key + '=' + value).join('; '), ...(input === undefined ? {} : {'Content-Type': 'application/json'}), ...headers}, body: input === undefined ? undefined : JSON.stringify(input), redirect: 'manual'});
    for (const cookie of response.headers.getSetCookie()) {const pair = cookie.split(';')[0], index = pair.indexOf('='); cookies.set(pair.slice(0, index), pair.slice(index + 1));}
    const text = await response.text(); let body; try {body = JSON.parse(text);} catch {body = text;}
    return {status: response.status, body, text, headers: response.headers};
  }
  function raw(route, host, extra = {}) {
    return new Promise((resolve, reject) => {
      http.get({host: '127.0.0.1', port: server.address().port, path: route, headers: {Host: host, ...extra}}, res => {
        let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({status: res.statusCode, body}));
      }).on('error', reject);
    });
  }
  return {call, raw, server, dataDir, origin};
}

test('real auth and payment routing preserve the one-time reward and reject spoofed or unconfigured top-ups', async t => {
  const api = await app(t);
  const start = await api.call('/api/auth/email/request', {input: {email: 'buyer@example.test'}});
  const login = await api.call('/api/auth/email/verify', {input: {challengeId: start.body.challengeId, code: '123456'}});
  const csrf = {'X-CSRF-Token': login.body.user.csrfToken};
  assert.equal((await api.call('/api/auth/onboarding', {input: {role: 'buyer'}, headers: csrf})).status, 200);
  const before = (await api.call('/api/auth/session')).body.user;
  assert.equal(before.promotionalCredit, 100);
  assert.equal((await api.call('/api/billing/checkout', {input: checkout})).status, 403);
  assert.equal((await api.call('/api/billing/checkout', {input: checkout, headers: {...csrf, Origin: 'https://other.example'}})).status, 403);
  assert.equal((await api.call('/api/billing/checkout', {input: checkout, headers: csrf})).status, 503);
  assert.equal((await api.call('/api/billing/pay-confirm', {input: {amount: 10000}, headers: csrf})).status, 404);
  const after = (await api.call('/api/auth/session')).body.user;
  assert.equal(after.promotionalCredit, before.promotionalCredit);
  assert.equal(after.promotionalCreditGranted, 100);
  assert.equal((await api.server.marketplace.mine(after)).orders.length, 0);
});

test('private server source, identity data, key material and traversal paths are never public assets', async t => {
  const api = await app(t, {split: true});
  for (const host of ['site.example', 'terminal.example', 'admin.example']) {
    for (const route of ['/OpenNEXT-payment-api.cjs', '/OpenNEXT-auth-service.cjs', '/OpenNEXT-marketplace-service.cjs', '/OpenNEXT-preview-server.cjs', '/.opennext-data/auth-state.json', '/.opennext-data/auth-session.key', '/.opennext-data/marketplace.json', '/.env', '/.git/config', '/%2e%2e/.env', '/%2e%2e%2f.env', '/data/gpu-spot-history.json']) {
      const response = await api.raw(route, host);
      assert.equal(response.status, 404, host + route);
      assert.equal(response.body, 'Not found');
    }
  }
  assert.equal((await api.raw('/OpenNEXT-auth.js', 'terminal.example')).status, 200);
  assert.equal((await api.raw('/OpenNEXT-instances.js', 'terminal.example')).status, 200);
  assert.equal((await api.raw('/OpenNEXT-payments.js', 'terminal.example')).status, 200);
});

test('untrusted forwarded hosts cannot expose Console assets on a public host', async t => {
  const api = await app(t, {split: true});
  assert.equal((await api.raw('/OpenNEXT-admin.js', 'admin.example')).status, 200);
  for (const host of ['site.example', 'terminal.example']) {
    assert.equal((await api.raw('/OpenNEXT-admin.js', host)).status, 404);
    assert.equal((await api.raw('/OpenNEXT-admin.js', host, {'X-Forwarded-Host': 'admin.example'})).status, 404);
    assert.equal((await api.raw('/api/admin/marketplace', host, {'X-Forwarded-Host': 'admin.example', Authorization: 'Bearer fixture-administrator-token-0123456789'})).status, 404);
  }
});

test('payment UI delegates card entry and settlement to provider checkout rather than collecting card numbers', async () => {
  const window = {}, source = await fs.readFile(path.join(__dirname, '../OpenNEXT-payments.js'), 'utf8');
  vm.runInNewContext(source, {window, Intl, URL});
  const api = window.OpenNEXTPayments, state = {credit: 100, paymentDraft: {amount: 500}};
  const c = {S: state, toast: () => {}};
  const amount = api.modal(c, 'topup').body, method = api.modal(c, 'payment-method').body;
  for (const preset of [100, 500, 1000]) assert.match(amount, new RegExp('value="' + preset + '"'));
  assert.match(amount, /Other amount/); assert.match(amount, /Process/);
  assert.match(method, /Credit card/); assert.match(method, /PayPal/); assert.match(method, /Proceed to payment/);
  assert.doesNotMatch(amount + method, /name="(?:card|cardNumber|cvc|cvv|expiry)|autocomplete="cc-/i);
  for (const action of ['pay-confirm', 'pay-fail', 'pay-cancel', 'cashout-settle']) {assert.equal(api.action(c, action), true); assert.equal(state.credit, 100);}
});

test('resale UI requires an active paid whole-GPU allocation, permission and current utilization below 95 percent', () => {
  const now = Date.now(), buyer = {role: 'Buyer'}, instance = {id: 'INSTANCE-1', model: 'H100', count: 8, status: 'Running', paymentStatus: 'Paid', resaleAllowed: true, availableResellCount: 2, serviceEnd: new Date(now + 86400000).toISOString(), telemetry: {utilizationPercent: 94.9, observedAt: new Date(now).toISOString()}};
  assert.equal(instances.eligibility(instance, buyer, now).allowed, true);
  for (const change of [{paymentStatus: 'Pending'}, {status: 'Stopped'}, {resaleAllowed: false}, {availableResellCount: 0}, {availableResellCount: .5}, {serviceEnd: new Date(now - 1).toISOString()}, {telemetry: {utilizationPercent: 95, observedAt: new Date(now).toISOString()}}, {telemetry: {utilizationPercent: 50, observedAt: new Date(now - 120001).toISOString()}}, {telemetry: {utilizationPercent: 50, observedAt: new Date(now + 6000).toISOString()}}, {telemetry: {utilizationPercent: null, observedAt: new Date(now).toISOString()}}]) {
    assert.equal(instances.eligibility({...instance, ...change}, buyer, now).allowed, false, JSON.stringify(change));
  }
  assert.equal(instances.eligibility(instance, {role: 'Seller'}, now).allowed, false);
  const allowed = instances.modal({S: {...buyer, instances: [instance]}}, 'instance-manage', {id: instance.id}).body;
  assert.match(allowed, /data-act="instance-resell"/);
  const blocked = instances.modal({S: {...buyer, instances: [{...instance, telemetry: {...instance.telemetry, utilizationPercent: 95}}]}}, 'instance-manage', {id: instance.id}).body;
  assert.match(blocked, /data-act="instance-resell"[^>]*disabled/);
  const empty = instances.page({S: {...buyer, instances: []}});
  assert.match(empty, /No instances yet/); assert.match(empty, /Example only · not an active resource/);
  assert.doesNotMatch(empty, /data-act="instance-manage"/);
});

test('new browser modules compile as scripts without top-level return or import-only syntax', async () => {
  for (const file of ['OpenNEXT-instances.js', 'OpenNEXT-payments.js', 'OpenNEXT-auth.js', 'OpenNEXT-console-marketplace.js', 'OpenNEXT-home-listings.js']) {
    assert.doesNotThrow(() => new vm.Script(require('node:fs').readFileSync(path.join(__dirname, '..', file), 'utf8'), {filename: file}));
  }
});
