'use strict';

const crypto = require('node:crypto');
const fail = (status, message) => Object.assign(new Error(message), {status});
const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token';
const GITHUB_API = 'https://api.github.com';
const CLOCK_SKEW = 60 * 1000;

/* Server-side OAuth adapter for OpenNEXT-auth-service.cjs.
 * Google: authorization code + PKCE; the id_token is verified against Google's JWKS (RS256),
 * issuer, audience, expiry and nonce, and must carry email_verified.
 * GitHub: authorization code + PKCE; identity is the numeric user id and the email is the
 * primary verified address from /user/emails (falls back to any verified address).
 * A provider is enabled only when both its client id and secret are present.
 */
function createOAuthAdapter({env = process.env, fetch = globalThis.fetch, now = () => Date.now()} = {}) {
  const clients = {
    google: {id: String(env.GOOGLE_CLIENT_ID || '').trim(), secret: String(env.GOOGLE_CLIENT_SECRET || '').trim()},
    github: {id: String(env.GITHUB_CLIENT_ID || '').trim(), secret: String(env.GITHUB_CLIENT_SECRET || '').trim()},
  };
  const providers = Object.keys(clients).filter(provider => clients[provider].id && clients[provider].secret);
  let certs = {keys: new Map(), expiresAt: 0}, certsPromise;

  async function call(url, options = {}) {
    let response;
    try {response = await fetch(url, {...options, signal: AbortSignal.timeout(10000)});}
    catch {throw fail(502, 'The sign-in provider could not be reached. Please try again.');}
    let data; try {data = await response.json();} catch {data = null;}
    if (!response.ok || !data || typeof data !== 'object') throw fail(502, 'The sign-in provider rejected the request. Please try again.');
    return data;
  }
  function form(values) {return {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'}, body: new URLSearchParams(values).toString()};}

  async function googleKeys(force) {
    if (!force && certs.expiresAt > now()) return certs.keys;
    if (!certsPromise) certsPromise = (async () => {
      let response;
      try {response = await fetch(GOOGLE_CERTS, {signal: AbortSignal.timeout(10000)});}
      catch {throw fail(502, 'Google sign-in keys could not be loaded. Please try again.');}
      const data = response.ok ? await response.json().catch(() => null) : null;
      if (!data || !Array.isArray(data.keys)) throw fail(502, 'Google sign-in keys could not be loaded. Please try again.');
      const keys = new Map();
      for (const jwk of data.keys) if (jwk && jwk.kty === 'RSA' && typeof jwk.kid === 'string') {
        try {keys.set(jwk.kid, crypto.createPublicKey({key: {kty: jwk.kty, n: jwk.n, e: jwk.e}, format: 'jwk'}));} catch {}
      }
      const maxAge = Number((/max-age=(\d+)/.exec(response.headers.get('cache-control') || '') || [])[1] || 3600);
      certs = {keys, expiresAt: now() + Math.min(Math.max(maxAge, 60), 24 * 3600) * 1000};
      return keys;
    })().finally(() => {certsPromise = null;});
    return certsPromise;
  }
  async function verifyGoogleToken(token, nonce) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw fail(401, 'Google did not return a valid identity.');
    let header, claims;
    try {header = JSON.parse(Buffer.from(parts[0], 'base64url')); claims = JSON.parse(Buffer.from(parts[1], 'base64url'));}
    catch {throw fail(401, 'Google did not return a valid identity.');}
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw fail(401, 'Google did not return a valid identity.');
    let key = (await googleKeys(false)).get(header.kid);
    if (!key) key = (await googleKeys(true)).get(header.kid);
    if (!key || !crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url'))) throw fail(401, 'Google did not return a valid identity.');
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!GOOGLE_ISSUERS.includes(claims.iss) || !audience.includes(clients.google.id) || (Array.isArray(claims.aud) && claims.azp !== clients.google.id)) throw fail(401, 'Google did not return a valid identity.');
    if (typeof claims.exp !== 'number' || claims.exp * 1000 + CLOCK_SKEW <= now() || (typeof claims.iat === 'number' && claims.iat * 1000 - CLOCK_SKEW > now())) throw fail(401, 'Your Google sign-in has expired. Please try again.');
    if (typeof claims.nonce !== 'string' || claims.nonce !== nonce) throw fail(401, 'Google did not return a valid identity.');
    if (claims.email_verified !== true && claims.email_verified !== 'true') throw fail(401, 'Your Google email address is not verified.');
    return {subject: String(claims.sub || ''), email: String(claims.email || ''), emailVerified: true, name: String(claims.name || '')};
  }

  async function getAuthorizationUrl({provider, state, nonce, codeChallenge, codeChallengeMethod, redirectUri}) {
    if (!providers.includes(provider)) throw fail(503, 'This sign-in provider is not configured.');
    const url = new URL(provider === 'google' ? GOOGLE_AUTHORIZE : GITHUB_AUTHORIZE);
    const params = provider === 'google'
      ? {client_id: clients.google.id, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, nonce, code_challenge: codeChallenge, code_challenge_method: codeChallengeMethod, prompt: 'select_account'}
      : {client_id: clients.github.id, redirect_uri: redirectUri, scope: 'read:user user:email', state, code_challenge: codeChallenge, code_challenge_method: codeChallengeMethod, allow_signup: 'true'};
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.href;
  }

  async function exchangeOAuthCallback({provider, code, codeVerifier, nonce, redirectUri}) {
    if (!providers.includes(provider)) throw fail(503, 'This sign-in provider is not configured.');
    const client = clients[provider];
    if (provider === 'google') {
      const token = await call(GOOGLE_TOKEN, form({code, client_id: client.id, client_secret: client.secret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: codeVerifier}));
      return verifyGoogleToken(token.id_token, nonce);
    }
    const token = await call(GITHUB_TOKEN, form({code, client_id: client.id, client_secret: client.secret, redirect_uri: redirectUri, code_verifier: codeVerifier}));
    if (typeof token.access_token !== 'string' || !token.access_token) throw fail(401, 'GitHub sign-in was not completed. Please try again.');
    const headers = {Authorization: 'Bearer ' + token.access_token, Accept: 'application/vnd.github+json', 'User-Agent': 'OpenNEXT', 'X-GitHub-Api-Version': '2022-11-28'};
    const [user, emails] = await Promise.all([call(GITHUB_API + '/user', {headers}), call(GITHUB_API + '/user/emails', {headers})]);
    const verified = Array.isArray(emails) ? emails.filter(item => item && item.verified === true && typeof item.email === 'string') : [];
    const chosen = verified.find(item => item.primary) || verified.find(item => !/@users\.noreply\.github\.com$/i.test(item.email));
    if (!chosen) throw fail(401, 'Your GitHub account has no verified email address. Verify an email on GitHub and try again.');
    if (!Number.isInteger(user.id)) throw fail(401, 'GitHub did not return a valid identity.');
    return {subject: String(user.id), email: chosen.email, emailVerified: true, name: String(user.name || user.login || '')};
  }

  return {providers, getAuthorizationUrl, exchangeOAuthCallback};
}

module.exports = {createOAuthAdapter};
