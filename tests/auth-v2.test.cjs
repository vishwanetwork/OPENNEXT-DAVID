'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {createAuthService} = require('../OpenNEXT-auth-service.cjs');

async function harness(t, options = {}) {
  const dataDir = options.dataDir || await fs.mkdtemp(path.join(os.tmpdir(), 'opennext-auth-test-'));
  const service = createAuthService({dataDir, secureCookies: false, ...options});
  const server = http.createServer(async (req, res) => {if (!await service.handle(req, res, new URL(req.url, 'http://localhost'))) {res.writeHead(404); res.end();}});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, jar = new Map();
  t.after(async () => {await new Promise(resolve => server.close(resolve)); await service.close(); if (!options.dataDir) await fs.rm(dataDir, {recursive: true, force: true});});
  async function call(route, input, headers = {}, method = input === undefined ? 'GET' : 'POST') {
    const response = await fetch(origin + route, {method, redirect: 'manual', headers: {Origin: origin, Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '), ...(input !== undefined ? {'Content-Type': 'application/json'} : {}), ...headers}, body: input === undefined ? undefined : JSON.stringify(input)});
    for (const value of response.headers.getSetCookie()) {const pair = value.split(';')[0], split = pair.indexOf('='); jar.set(pair.slice(0, split), pair.slice(split + 1));}
    const text = await response.text();
    let data; try {data = JSON.parse(text);} catch {data = text;}
    return {status: response.status, data, headers: response.headers};
  }
  return {service, call, jar, origin, dataDir};
}
const emailAdapter = (overrides = {}) => ({emailEnabled: true,
  requestEmailCode: async () => ({challengeId: 'trusted-mail-challenge'}),
  verifyEmailCode: async ({email, code}) => code === '123456' ? {subject: 'verified-subject', email, emailVerified: true, name: 'Verified Person'} : null,
  ...overrides,
});
async function signIn(api, email = 'buyer@example.com') {
  const started = await api.call('/api/auth/email/request', {email});
  assert.equal(started.status, 200);
  const result = await api.call('/api/auth/email/verify', {challengeId: started.data.challengeId, code: '123456'});
  assert.equal(result.status, 200);
  return result.data.user;
}

test('unconfigured sign-in fails closed and sends no email or fabricated identity', async t => {
  const api = await harness(t);
  assert.deepEqual((await api.call('/api/auth/config')).data, {providers: {google: false, github: false}, email: false, otherMethods: false});
  assert.equal((await api.call('/api/auth/session')).data.user, null);
  assert.equal((await api.call('/api/auth/oauth/google/start')).status, 503);
  assert.equal((await api.call('/api/auth/oauth/github/start')).status, 503);
  const email = await api.call('/api/auth/email/request', {email: 'buyer@example.com'});
  assert.equal(email.status, 503); assert.match(email.data.error, /No code has been sent/);
  assert.equal((await api.call('/api/auth/email/verify', {code: '246810', email: 'buyer@example.com'})).status, 503);
  assert.equal((await api.call('/api/auth/onboarding', {role: 'buyer', verified: true, email: 'buyer@example.com'})).status, 401);
});

test('verified session uses HttpOnly signed cookie, not client-provided identity', async t => {
  const api = await harness(t, {adapter: emailAdapter()});
  const started = await api.call('/api/auth/email/request', {email: 'buyer@example.com'});
  assert.match(started.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const result = await api.call('/api/auth/email/verify', {challengeId: started.data.challengeId, code: '123456', name: 'Untrusted name', role: 'seller', promotionalCredit: 9999});
  assert.equal(result.status, 200); assert.match(result.headers.get('set-cookie'), /opennext_session=.*HttpOnly/);
  assert.equal(result.data.user.name, 'Verified Person'); assert.equal(result.data.user.role, null);
  assert.equal(result.data.user.promotionalCredit, 0); assert.equal(result.data.user.onboardingCompleted, false);
  assert.equal((await api.call('/api/auth/session')).data.user.id, result.data.user.id);
  api.jar.set('opennext_session', api.jar.get('opennext_session').replace(/^./, 'X'));
  assert.equal((await api.call('/api/auth/session')).data.user, null);
});

test('welcome reward is durable and exactly once; Broker is rejected; role switches do not regrant', async t => {
  const api = await harness(t, {adapter: emailAdapter()});
  let user = await signIn(api), headers = {'X-CSRF-Token': user.csrfToken};
  assert.equal((await api.call('/api/auth/onboarding', {role: 'broker'}, headers)).status, 400);
  const completed = await api.call('/api/auth/onboarding', {role: 'buyer'}, headers);
  assert.equal(completed.status, 200); user = completed.data.user;
  assert.equal(user.promotionalCredit, 100); assert.equal(user.promotionalCreditWithdrawable, false);
  assert.equal(user.onboardingCompleted, true); assert.equal(user.role, 'buyer');
  const replay = await api.call('/api/auth/onboarding', {role: 'seller'}, headers);
  assert.equal(replay.data.user.promotionalCredit, 100); assert.equal(replay.data.user.role, 'buyer');
  assert.equal((await api.call('/api/auth/role', {role: 'broker'}, headers)).status, 400);
  assert.equal((await api.call('/api/auth/role', {role: 'seller'}, headers)).data.user.role, 'seller');
  const storage = JSON.parse(await fs.readFile(path.join(api.dataDir, 'auth-state.json'), 'utf8'));
  assert.equal(storage.users.length, 1); assert.equal(storage.users[0].promotionalCreditGranted, 100);
  const restart = createAuthService({dataDir: api.dataDir, adapter: emailAdapter(), secureCookies: false});
  const restored = await restart.authenticate({headers: {cookie: 'opennext_session=' + api.jar.get('opennext_session')}});
  assert.equal(restored.id, user.id); assert.equal(restored.promotionalCredit, 100); await restart.close();
  assert.equal((await api.call('/api/auth/logout', {}, headers)).status, 200);
  assert.equal((await api.call('/api/auth/session')).data.user, null);
  const returned = await signIn(api);
  assert.equal(returned.id, user.id); assert.equal(returned.promotionalCredit, 100); assert.equal(returned.onboardingCompleted, true);
});

test('mutations require matching origin and session CSRF token', async t => {
  const api = await harness(t, {adapter: emailAdapter()});
  assert.equal((await api.call('/api/auth/email/request', {email: 'buyer@example.com'}, {Origin: 'https://untrusted.example'})).status, 403);
  const user = await signIn(api);
  assert.equal((await api.call('/api/auth/onboarding', {role: 'buyer'})).status, 403);
  assert.equal((await api.call('/api/auth/onboarding', {role: 'buyer'}, {'X-CSRF-Token': user.csrfToken, Origin: 'https://untrusted.example'})).status, 403);
  assert.equal((await api.call('/api/auth/onboarding', {role: 'buyer'}, {'X-CSRF-Token': user.csrfToken})).status, 200);
});

test('email identity must be verified and match the challenged address', async t => {
  const api = await harness(t, {adapter: emailAdapter({verifyEmailCode: async () => ({subject: 'x', email: 'attacker@example.com', emailVerified: true})})});
  const started = await api.call('/api/auth/email/request', {email: 'buyer@example.com'});
  const result = await api.call('/api/auth/email/verify', {challengeId: started.data.challengeId, code: '123456'});
  assert.equal(result.status, 401); assert.equal((await api.call('/api/auth/session')).data.user, null);
});

test('incorrect email codes are attempt limited and successful codes cannot replay', async t => {
  const api = await harness(t, {adapter: emailAdapter()});
  let started = await api.call('/api/auth/email/request', {email: 'buyer@example.com'});
  for (let i = 0; i < 5; i++) assert.equal((await api.call('/api/auth/email/verify', {challengeId: started.data.challengeId, code: '999999'})).status, 401);
  assert.equal((await api.call('/api/auth/email/verify', {challengeId: started.data.challengeId, code: '123456'})).status, 429);
  started = await api.call('/api/auth/email/request', {email: 'buyer@example.com'});
  const input = {challengeId: started.data.challengeId, code: '123456'};
  assert.equal((await api.call('/api/auth/email/verify', input)).status, 200);
  assert.equal((await api.call('/api/auth/email/verify', input)).status, 401);
});

test('OAuth uses server-side state and PKCE, and validates browser correlation', async t => {
  let authorization, exchange;
  const adapter = {providers: ['google'],
    getAuthorizationUrl: async input => {authorization = input; return 'https://accounts.google.com/o/oauth2/v2/auth?state=' + input.state;},
    exchangeOAuthCallback: async input => {exchange = input; return {subject: 'google-sub', email: 'oauth@example.com', emailVerified: true, name: 'OAuth User'};},
  };
  const api = await harness(t, {adapter});
  assert.equal((await api.call('/api/auth/oauth/google/start')).status, 302);
  assert.equal(authorization.codeChallenge.length, 43);
  assert.equal((await api.call('/api/auth/oauth/google/callback?state=invalid&code=abc')).status, 401);
  const result = await api.call('/api/auth/oauth/google/callback?state=' + authorization.state + '&code=abc');
  assert.equal(result.status, 302); assert.equal(result.headers.get('location'), '/#terminal/market');
  assert.ok(exchange.codeVerifier); assert.equal((await api.call('/api/auth/session')).data.user.email, 'oauth@example.com');
  assert.equal((await api.call('/api/auth/oauth/google/callback?state=' + authorization.state + '&code=abc')).status, 401);
});

test('frontend does not fabricate logins and renders verified-role onboarding', async () => {
  const source = await fs.readFile(path.join(__dirname, '..', 'OpenNEXT-auth.js'), 'utf8');
  assert.doesNotMatch(source, /Nova|nova@|246810|localStorage|sessionStorage|localLogin|preview-account/);
  const window = {dispatchEvent() {}}, context = {window, CustomEvent: class {}, console};
  vm.runInNewContext(source, context);
  const html = window.OpenNEXTAuth.render();
  assert.match(html, /Continue with Google/); assert.match(html, /Continue with GitHub/); assert.match(html, /Send verification code/);
  assert.doesNotMatch(html, /type="password"/);
  const onboarding = window.OpenNEXTAuth.renderOnboarding({id: 'verified', email: 'person@example.com', onboardingCompleted: false});
  assert.match(onboarding, /data-onboarding-role="buyer"/); assert.match(onboarding, /data-onboarding-role="seller"/);
  assert.match(onboarding, /disabled aria-disabled="true"><strong>Broker/);
  assert.match(onboarding, /one-time \$100 promotional credit/);
});

test('expired sessions cannot retrieve identity or mutate onboarding', async t => {
  let timestamp = Date.UTC(2026, 9, 18);
  const api = await harness(t, {adapter: emailAdapter(), now: () => timestamp});
  const user = await signIn(api);
  timestamp += 7 * 24 * 60 * 60 * 1000 + 1;
  assert.equal((await api.call('/api/auth/session')).data.user, null);
  assert.equal((await api.call('/api/auth/onboarding', {role: 'buyer'}, {'X-CSRF-Token': user.csrfToken})).status, 401);
});

test('expired email challenges cannot be verified', async t => {
  let timestamp = Date.UTC(2026, 9, 18);
  const api = await harness(t, {adapter: emailAdapter(), now: () => timestamp});
  const started = await api.call('/api/auth/email/request', {email: 'buyer@example.com'});
  timestamp += 10 * 60 * 1000 + 1;
  assert.equal((await api.call('/api/auth/email/verify', {challengeId: started.data.challengeId, code: '123456'})).status, 401);
  assert.equal((await api.call('/api/auth/session')).data.user, null);
});

test('provider failures remain generic and cannot create sessions', async t => {
  const api = await harness(t, {adapter: emailAdapter({requestEmailCode: async () => {throw new Error('Sensitive provider diagnostic');}})});
  const failed = await api.call('/api/auth/email/request', {email: 'buyer@example.com'});
  assert.equal(failed.status, 503); assert.doesNotMatch(failed.data.error, /Sensitive provider diagnostic/);
  assert.equal((await api.call('/api/auth/session')).data.user, null);
  const unverified = await harness(t, {adapter: emailAdapter({verifyEmailCode: async ({email}) => ({subject: 'user', email, emailVerified: false})})});
  const start = await unverified.call('/api/auth/email/request', {email: 'buyer@example.com'});
  assert.equal((await unverified.call('/api/auth/email/verify', {challengeId: start.data.challengeId, code: '123456'})).status, 401);
  assert.equal((await unverified.call('/api/auth/session')).data.user, null);
});

test('concurrent onboarding grants once and role casing is normalized', async t => {
  const api = await harness(t, {adapter: emailAdapter()});
  const user = await signIn(api), headers = {'X-CSRF-Token': user.csrfToken};
  const requests = await Promise.all(Array.from({length: 4}, () => api.call('/api/auth/onboarding', {role: 'Seller'}, headers)));
  for (const result of requests) {assert.equal(result.status, 200); assert.equal(result.data.user.role, 'seller'); assert.equal(result.data.user.promotionalCredit, 100);}
  const storage = JSON.parse(await fs.readFile(path.join(api.dataDir, 'auth-state.json'), 'utf8'));
  assert.equal(storage.users[0].promotionalCreditGranted, 100);
  assert.equal((await api.call('/api/auth/role', {role: 'BUYER'}, headers)).data.user.role, 'buyer');
});

test('a stable provider subject keeps its account and reward when verified email changes', async t => {
  const api = await harness(t, {adapter: emailAdapter()});
  const original = await signIn(api, 'first@example.com');
  await api.call('/api/auth/onboarding', {role: 'buyer'}, {'X-CSRF-Token': original.csrfToken});
  await api.call('/api/auth/logout', {}, {'X-CSRF-Token': original.csrfToken});
  const changed = await signIn(api, 'new@example.com');
  assert.equal(changed.id, original.id); assert.equal(changed.email, 'new@example.com');
  assert.equal(changed.onboardingCompleted, true); assert.equal(changed.promotionalCreditGranted, 100);
  const storage = JSON.parse(await fs.readFile(path.join(api.dataDir, 'auth-state.json'), 'utf8'));
  assert.equal(storage.users.length, 1);
});

test('one email challenge cannot be verified concurrently twice', async t => {
  let release, entered;
  const gate = new Promise(resolve => {release = resolve;}), startedVerification = new Promise(resolve => {entered = resolve;});
  const api = await harness(t, {adapter: emailAdapter({verifyEmailCode: async ({email}) => {entered(); await gate; return {subject: 'verified-subject', email, emailVerified: true};}})});
  const start = await api.call('/api/auth/email/request', {email: 'buyer@example.com'});
  const input = {challengeId: start.data.challengeId, code: '123456'};
  const first = api.call('/api/auth/email/verify', input);
  await startedVerification;
  assert.equal((await api.call('/api/auth/email/verify', input)).status, 409);
  release(); assert.equal((await first).status, 200);
});

test('frontend logout clears an expired session but preserves state on service failure', async () => {
  const source = await fs.readFile(path.join(__dirname, '..', 'OpenNEXT-auth.js'), 'utf8');
  let responseStatus = 401;
  const events = [], window = {dispatchEvent(event) {events.push(event);}};
  const context = {window, CustomEvent: class {constructor(type, init) {this.type = type; this.detail = init.detail;}},
    fetch: async () => ({ok: false, status: responseStatus, json: async () => ({error: responseStatus === 401 ? 'Sign in to continue.' : 'Service unavailable.'})})};
  vm.runInNewContext(source, context);
  const identity = {id: 'verified-account', email: 'person@example.com', csrfToken: 'session-csrf', onboardingCompleted: false};
  window.OpenNEXTAuth.renderOnboarding(identity);
  assert.equal(window.OpenNEXTAuth.getUser().id, identity.id);
  assert.equal(await window.OpenNEXTAuth.logout(), null);
  assert.equal(window.OpenNEXTAuth.getUser(), null);
  assert.equal(events.at(-1).detail.user, null);
  window.OpenNEXTAuth.renderOnboarding(identity);
  responseStatus = 503;
  await assert.rejects(window.OpenNEXTAuth.logout(), /Service unavailable/);
  assert.equal(window.OpenNEXTAuth.getUser().id, identity.id);
});
