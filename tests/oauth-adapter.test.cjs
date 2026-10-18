'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createAuthService} = require('../OpenNEXT-auth-service.cjs');
const {createOAuthAdapter} = require('../OpenNEXT-oauth-adapter.cjs');

const env = {GOOGLE_CLIENT_ID: 'google-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'google-secret', GITHUB_CLIENT_ID: 'github-client', GITHUB_CLIENT_SECRET: 'github-secret'};
const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa', {modulusLength: 2048});
const jwk = {...publicKey.export({format: 'jwk'}), kid: 'test-key', alg: 'RS256', use: 'sig'};
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json', ...headers}});
function idToken(claims, kid = 'test-key', key = privateKey) {
  const head = Buffer.from(JSON.stringify({alg: 'RS256', kid, typ: 'JWT'})).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return head + '.' + body + '.' + crypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), key).toString('base64url');
}
function googleClaims(nonce, overrides = {}) {
  const seconds = Math.floor(Date.now() / 1000);
  return {iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID, sub: '1098765', email: 'Buyer@Example.com', email_verified: true, name: 'Google Buyer', iat: seconds, exp: seconds + 3600, nonce, ...overrides};
}
function fakeFetch(handlers) {
  const calls = [];
  const fetch = async (url, options = {}) => {calls.push({url: String(url), options}); const handler = handlers[String(url)]; if (!handler) throw new Error('unexpected fetch ' + url); return handler(options);};
  return {fetch, calls};
}

async function harness(t, adapter) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opennext-oauth-test-'));
  const service = createAuthService({dataDir, secureCookies: false, adapter});
  const server = http.createServer(async (req, res) => {if (!await service.handle(req, res, new URL(req.url, 'http://localhost'))) {res.writeHead(404); res.end();}});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, jar = new Map();
  t.after(async () => {await new Promise(resolve => server.close(resolve)); await service.close(); await fs.rm(dataDir, {recursive: true, force: true});});
  async function get(route) {
    const response = await fetch(origin + route, {redirect: 'manual', headers: {Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; ')}});
    for (const value of response.headers.getSetCookie()) {const pair = value.split(';')[0], split = pair.indexOf('='); jar.set(pair.slice(0, split), pair.slice(split + 1));}
    const text = await response.text();
    let data; try {data = JSON.parse(text);} catch {data = text;}
    return {status: response.status, data, location: response.headers.get('location')};
  }
  return {get, origin};
}

test('providers are enabled only when both client id and secret are configured', () => {
  assert.deepEqual(createOAuthAdapter({env: {}}).providers, []);
  assert.deepEqual(createOAuthAdapter({env: {GOOGLE_CLIENT_ID: 'id'}}).providers, []);
  assert.deepEqual(createOAuthAdapter({env: {GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret'}}).providers, ['github']);
  assert.deepEqual(createOAuthAdapter({env}).providers, ['google', 'github']);
});

test('Google sign-in verifies the signed id_token and issues a session', async t => {
  let nonce;
  const {fetch, calls} = fakeFetch({
    'https://oauth2.googleapis.com/token': () => json({access_token: 'at', id_token: idToken(googleClaims(nonce))}),
    'https://www.googleapis.com/oauth2/v3/certs': () => json({keys: [jwk]}, 200, {'Cache-Control': 'public, max-age=600'}),
  });
  const api = await harness(t, createOAuthAdapter({env, fetch}));
  assert.deepEqual((await api.get('/api/auth/config')).data.providers, {google: true, github: true});
  const start = await api.get('/api/auth/oauth/google/start');
  assert.equal(start.status, 302);
  const authorize = new URL(start.location);
  assert.equal(authorize.origin + authorize.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(authorize.searchParams.get('client_id'), env.GOOGLE_CLIENT_ID);
  assert.equal(authorize.searchParams.get('redirect_uri'), api.origin + '/api/auth/oauth/google/callback');
  assert.equal(authorize.searchParams.get('scope'), 'openid email profile');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  nonce = authorize.searchParams.get('nonce');
  const callback = await api.get('/api/auth/oauth/google/callback?code=auth-code&state=' + encodeURIComponent(authorize.searchParams.get('state')));
  assert.equal(callback.status, 302);
  assert.equal(callback.location, '/#terminal/market');
  const exchange = new URLSearchParams(calls[0].options.body);
  assert.equal(exchange.get('client_secret'), 'google-secret');
  assert.equal(exchange.get('grant_type'), 'authorization_code');
  assert.ok(exchange.get('code_verifier'));
  const session = await api.get('/api/auth/session');
  assert.equal(session.data.user.email, 'buyer@example.com');
  assert.equal(session.data.user.name, 'Google Buyer');
});

test('Google id_tokens with a bad signature, audience, nonce or unverified email are rejected', async () => {
  const forged = crypto.generateKeyPairSync('rsa', {modulusLength: 2048}).privateKey;
  const cases = [
    ['forged signature', nonce => idToken(googleClaims(nonce), 'test-key', forged)],
    ['unknown key', nonce => idToken(googleClaims(nonce), 'other-key')],
    ['wrong audience', nonce => idToken(googleClaims(nonce, {aud: 'someone-else'}))],
    ['wrong issuer', nonce => idToken(googleClaims(nonce, {iss: 'https://evil.example'}))],
    ['wrong nonce', () => idToken(googleClaims('replayed'))],
    ['expired', nonce => idToken(googleClaims(nonce, {exp: Math.floor(Date.now() / 1000) - 600}))],
    ['unverified email', nonce => idToken(googleClaims(nonce, {email_verified: false}))],
  ];
  for (const [label, make] of cases) {
    const {fetch} = fakeFetch({
      'https://oauth2.googleapis.com/token': () => json({id_token: make('expected-nonce')}),
      'https://www.googleapis.com/oauth2/v3/certs': () => json({keys: [jwk]}),
    });
    await assert.rejects(createOAuthAdapter({env, fetch}).exchangeOAuthCallback({provider: 'google', code: 'c', codeVerifier: 'v', nonce: 'expected-nonce', redirectUri: 'https://terminal.opennextlab.ai/api/auth/oauth/google/callback'}), {status: 401}, label);
  }
});

test('GitHub sign-in uses the primary verified email and issues a session', async t => {
  const {fetch, calls} = fakeFetch({
    'https://github.com/login/oauth/access_token': () => json({access_token: 'gho_token', token_type: 'bearer'}),
    'https://api.github.com/user': () => json({id: 4242, login: 'octobuyer', name: null}),
    'https://api.github.com/user/emails': () => json([{email: 'old@example.com', verified: false, primary: false}, {email: 'Octo@Example.com', verified: true, primary: true}]),
  });
  const api = await harness(t, createOAuthAdapter({env, fetch}));
  const start = await api.get('/api/auth/oauth/github/start');
  const authorize = new URL(start.location);
  assert.equal(authorize.origin + authorize.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(authorize.searchParams.get('scope'), 'read:user user:email');
  assert.equal(authorize.searchParams.get('redirect_uri'), api.origin + '/api/auth/oauth/github/callback');
  const callback = await api.get('/api/auth/oauth/github/callback?code=gh-code&state=' + encodeURIComponent(authorize.searchParams.get('state')));
  assert.equal(callback.status, 302);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer gho_token');
  const session = await api.get('/api/auth/session');
  assert.equal(session.data.user.email, 'octo@example.com');
  assert.equal(session.data.user.name, 'octobuyer');
});

test('GitHub accounts without a verified email cannot sign in', async () => {
  const {fetch} = fakeFetch({
    'https://github.com/login/oauth/access_token': () => json({access_token: 'gho_token'}),
    'https://api.github.com/user': () => json({id: 7, login: 'nobody'}),
    'https://api.github.com/user/emails': () => json([{email: 'nobody@example.com', verified: false, primary: true}]),
  });
  await assert.rejects(createOAuthAdapter({env, fetch}).exchangeOAuthCallback({provider: 'github', code: 'c', codeVerifier: 'v', redirectUri: 'https://terminal.opennextlab.ai/api/auth/oauth/github/callback'}), {status: 401});
  const denied = fakeFetch({'https://github.com/login/oauth/access_token': () => json({error: 'bad_verification_code'})});
  await assert.rejects(createOAuthAdapter({env, fetch: denied.fetch}).exchangeOAuthCallback({provider: 'github', code: 'c', codeVerifier: 'v', redirectUri: 'x'}), {status: 401});
});
