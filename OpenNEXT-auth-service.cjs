'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const fail = (status, message) => Object.assign(new Error(message), {status});
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const equal = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const CHALLENGE_TTL = 10 * 60 * 1000;
const COOKIE = 'opennext_session';
const FLOW_COOKIE = 'opennext_auth_flow';

/* Backend integration contract:
 * adapter.providers = ['google', 'github']; adapter.emailEnabled = true;
 * adapter.getAuthorizationUrl({provider, state, nonce, codeChallenge, codeChallengeMethod, redirectUri}) -> HTTPS URL
 * adapter.exchangeOAuthCallback({provider, code, codeVerifier, nonce, redirectUri}) -> verified identity
 * adapter.requestEmailCode({email}) -> {challengeId}; this method must actually send the code.
 * adapter.verifyEmailCode({challengeId, email, code}) -> verified identity or null
 * A verified identity requires {subject, email, emailVerified: true, name?}.
 * OAuth adapters must validate issuer, audience, signature/nonce and verified email ownership.
 * GitHub adapters must use a verified email from GitHub's authenticated email endpoint.
 * Never expose a route accepting a client-supplied verified identity.
 * Production multi-instance deployments should replace file persistence with a transactional
 * database and shared rate limiting, retaining the unique welcome-credit grant per account.
 */
function createAuthService({dataDir, adapter = {}, sessionSecret = process.env.OPENNEXT_AUTH_SESSION_SECRET, secureCookies = process.env.NODE_ENV === 'production', publicOrigin, now = () => Date.now()} = {}) {
  const directory = path.resolve(dataDir || process.env.OPENNEXT_DATA_DIR || path.join(__dirname, '.opennext-data'));
  const filename = path.join(directory, 'auth-state.json');
  const secretFile = path.join(directory, 'auth-session.key');
  const flows = new Map(), limits = new Map();
  let chain = Promise.resolve(), secretPromise;
  const serial = task => {const pending = chain.then(task); chain = pending.catch(() => {}); return pending;};
  const configuredProviders = () => ['google', 'github'].filter(provider => Array.isArray(adapter.providers) && adapter.providers.includes(provider) && typeof adapter.getAuthorizationUrl === 'function' && typeof adapter.exchangeOAuthCallback === 'function');
  const emailConfigured = () => adapter.emailEnabled === true && typeof adapter.requestEmailCode === 'function' && typeof adapter.verifyEmailCode === 'function';
  function origin(req) {
    if (publicOrigin) return new URL(publicOrigin).origin;
    const host = String(req.headers.host || '');
    if (!/^[a-z0-9.:[\]-]+$/i.test(host)) throw fail(403, 'Invalid request host.');
    return (secureCookies || req.socket?.encrypted ? 'https://' : 'http://') + host;
  }
  function sameOrigin(req) {
    try {return new URL(String(req.headers.origin || '')).origin === origin(req);} catch {return false;}
  }
  function checkCsrf(req, user) {return !!user && sameOrigin(req) && equal(req.headers['x-csrf-token'], user.csrfToken);}
  function cookie(req, name) {
    const raw = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(name + '='));
    return raw ? raw.slice(name.length + 1) : '';
  }
  function setCookie(res, name, value, ttl) {
    const item = `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(ttl / 1000))}${secureCookies ? '; Secure' : ''}`;
    const current = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', [...(Array.isArray(current) ? current : current ? [current] : []), item]);
  }
  async function secret() {
    if (!secretPromise) secretPromise = (async () => {
      if (sessionSecret) {
        if (Buffer.byteLength(sessionSecret) < 32) throw fail(503, 'Authentication configuration is unavailable.');
        return sessionSecret;
      }
      await fs.mkdir(directory, {recursive: true});
      try {
        const stored = await fs.readFile(secretFile, 'utf8');
        if (Buffer.byteLength(stored) < 32) throw fail(503, 'Authentication configuration is unavailable.');
        return stored;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const generated = crypto.randomBytes(48).toString('base64url');
        try {await fs.writeFile(secretFile, generated, {flag: 'wx', mode: 0o600}); return generated;}
        catch (writeError) {
          if (writeError.code !== 'EEXIST') throw writeError;
          const stored = await fs.readFile(secretFile, 'utf8');
          if (Buffer.byteLength(stored) < 32) throw fail(503, 'Authentication configuration is unavailable.');
          return stored;
        }
      }
    })();
    return secretPromise;
  }
  async function signed(token) {return token + '.' + crypto.createHmac('sha256', await secret()).update(token).digest('base64url');}
  async function unpack(value) {
    if (!/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(value || '')) return null;
    return equal(value, await signed(value.split('.')[0])) ? value.split('.')[0] : null;
  }
  async function read() {
    try {
      const state = JSON.parse(await fs.readFile(filename, 'utf8'));
      if (state.version !== 1 || !Array.isArray(state.users) || !Array.isArray(state.sessions)) throw new Error('Invalid authentication storage.');
      return state;
    } catch (error) {if (error.code === 'ENOENT') return {version: 1, users: [], sessions: []}; throw fail(503, 'Account storage is temporarily unavailable.');}
  }
  async function write(state) {
    await fs.mkdir(directory, {recursive: true});
    const temporary = filename + '.' + crypto.randomUUID() + '.tmp';
    try {await fs.writeFile(temporary, JSON.stringify(state), {flag: 'wx', mode: 0o600}); await fs.rename(temporary, filename);}
    catch {await fs.unlink(temporary).catch(() => {}); throw fail(503, 'Account changes could not be saved. Please try again.');}
  }
  function publicUser(user, session) {
    return {id: user.id, email: user.email, name: user.name, role: user.role, onboardingCompleted: !!user.onboardingCompleted,
      promotionalCredit: Number(user.promotionalCredit || 0), promotionalCreditGranted: Number(user.promotionalCreditGranted || 0),
      promotionalCreditWithdrawable: false, welcomeCreditGrantedAt: user.welcomeCreditGrantedAt || null, csrfToken: session.csrfToken};
  }
  async function authenticate(req) {
    const token = await unpack(cookie(req, COOKIE));
    if (!token) return null;
    return serial(async () => {
      const state = await read(), session = state.sessions.find(item => item.tokenHash === hash(token) && item.expiresAt > now());
      const user = session && state.users.find(item => item.id === session.userId);
      return user ? publicUser(user, session) : null;
    });
  }
  function identity(raw, expectedEmail) {
    const email = String(raw?.email || '').trim().toLowerCase();
    if (raw?.emailVerified !== true || !raw.subject || typeof raw.subject !== 'string' || raw.subject.length > 512 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || (expectedEmail && email !== expectedEmail)) throw fail(401, 'Your identity could not be verified. Please sign in again.');
    return {email, subject: raw.subject, name: String(raw.name || '').trim().slice(0, 100)};
  }
  async function issueSession(req, res, raw, provider, expectedEmail) {
    const verified = identity(raw, expectedEmail), token = crypto.randomBytes(32).toString('base64url');
    const result = await serial(async () => {
      const state = await read();
      const linked = state.users.find(item => item.identities.some(identity => identity.provider === provider && identity.subject === verified.subject));
      const sameEmail = state.users.find(item => item.email === verified.email);
      if (linked && sameEmail && linked.id !== sameEmail.id) throw fail(409, 'This verified email belongs to another account. Contact support to link your accounts.');
      let user = linked || sameEmail;
      if (!user) {user = {id: crypto.randomUUID(), email: verified.email, name: verified.name, role: null, onboardingCompleted: false, promotionalCredit: 0, promotionalCreditGranted: 0, createdAt: new Date(now()).toISOString(), identities: []}; state.users.push(user);}
      user.email = verified.email;
      if (verified.name) user.name = verified.name;
      if (!user.identities.some(item => item.provider === provider && item.subject === verified.subject)) user.identities.push({provider, subject: verified.subject});
      const previous = await unpack(cookie(req, COOKIE));
      state.sessions = state.sessions.filter(item => item.expiresAt > now() && (!previous || item.tokenHash !== hash(previous)));
      const session = {tokenHash: hash(token), userId: user.id, expiresAt: now() + SESSION_TTL, csrfToken: crypto.randomBytes(32).toString('base64url')};
      state.sessions.push(session); await write(state); return publicUser(user, session);
    });
    setCookie(res, COOKIE, await signed(token), SESSION_TTL);
    setCookie(res, FLOW_COOKIE, '', 0);
    return result;
  }
  function prune() {
    for (const [key, flow] of flows) if (flow.expiresAt <= now()) flows.delete(key);
    for (const [key, bucket] of limits) if (bucket.until <= now()) limits.delete(key);
  }
  function rate(key, maximum, windowMs) {
    prune();
    if (!limits.has(key) && limits.size > 10000) throw fail(429, 'Authentication is busy. Please try again shortly.');
    const bucket = limits.get(key) || {count: 0, until: now() + windowMs};
    bucket.count++; limits.set(key, bucket);
    if (bucket.count > maximum) throw fail(429, 'Too many sign-in attempts. Please wait before trying again.');
  }
  async function body(req) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, 'Use a JSON request.');
    let size = 0; const chunks = [];
    for await (const chunk of req) {size += chunk.length; if (size > 4096) throw fail(413, 'The request is too large.'); chunks.push(chunk);}
    let data; try {data = JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw fail(400, 'Invalid request.');}
    if (!data || Array.isArray(data) || typeof data !== 'object') throw fail(400, 'Invalid request.');
    return data;
  }
  const send = (res, status, value) => {res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}); res.end(JSON.stringify(value));};
  async function handle(req, res, inputUrl) {
    const url = inputUrl || new URL(req.url, origin(req));
    if (!url.pathname.startsWith('/api/auth/')) return false;
    try {
      if (req.method === 'GET' && url.pathname === '/api/auth/config') {send(res, 200, {providers: {google: configuredProviders().includes('google'), github: configuredProviders().includes('github')}, email: emailConfigured(), otherMethods: false}); return true;}
      if (req.method === 'GET' && url.pathname === '/api/auth/session') {send(res, 200, {user: await authenticate(req)}); return true;}
      const oauth = url.pathname.match(/^\/api\/auth\/oauth\/(google|github)\/(start|callback)$/);
      if (oauth && req.method === 'GET') {
        const provider = oauth[1];
        if (!configuredProviders().includes(provider)) throw fail(503, `${provider === 'google' ? 'Google' : 'GitHub'} sign-in is not configured yet. Please contact OpenNEXT support.`);
        const redirectUri = origin(req) + `/api/auth/oauth/${provider}/callback`;
        if (oauth[2] === 'start') {
          rate('oauth:' + (req.socket?.remoteAddress || 'unknown'), 20, 60 * 1000);
          const token = crypto.randomBytes(32).toString('base64url'), state = crypto.randomBytes(32).toString('base64url'), verifier = crypto.randomBytes(48).toString('base64url'), nonce = crypto.randomBytes(32).toString('base64url');
          const authorization = await adapter.getAuthorizationUrl({provider, state, nonce, codeChallenge: crypto.createHash('sha256').update(verifier).digest('base64url'), codeChallengeMethod: 'S256', redirectUri});
          const destination = new URL(authorization);
          if (destination.protocol !== 'https:') throw fail(503, 'The sign-in provider is not configured securely.');
          flows.set(hash(token), {provider, state, verifier, nonce, expiresAt: now() + CHALLENGE_TTL});
          setCookie(res, FLOW_COOKIE, await signed(token), CHALLENGE_TTL);
          res.writeHead(302, {Location: destination.href, 'Cache-Control': 'no-store'}); res.end(); return true;
        }
        const token = await unpack(cookie(req, FLOW_COOKIE)), flow = token && flows.get(hash(token));
        if (!flow || flow.provider !== provider || flow.expiresAt <= now() || !equal(url.searchParams.get('state'), flow.state)) throw fail(401, 'This sign-in request has expired. Please start again.');
        flows.delete(hash(token));
        const code = url.searchParams.get('code');
        if (!code || code.length > 2048 || url.searchParams.has('error')) throw fail(401, 'Sign-in was not completed. Please try again.');
        const verified = await adapter.exchangeOAuthCallback({provider, code, codeVerifier: flow.verifier, nonce: flow.nonce, redirectUri});
        await issueSession(req, res, verified, provider);
        res.writeHead(302, {Location: '/#terminal/market', 'Cache-Control': 'no-store'}); res.end(); return true;
      }
      if (req.method !== 'POST') throw fail(405, 'Method not allowed.');
      if (!sameOrigin(req)) throw fail(403, 'Origin not allowed.');
      if (url.pathname === '/api/auth/email/request') {
        if (!emailConfigured()) throw fail(503, 'Email verification is not configured yet. No code has been sent. Please contact OpenNEXT support.');
        const input = await body(req), email = String(input.email || '').trim().toLowerCase();
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Enter a valid email address.');
        rate('email-ip:' + (req.socket?.remoteAddress || 'unknown'), 10, 10 * 60 * 1000);
        rate('email:' + hash(email), 3, 10 * 60 * 1000);
        const delivered = await adapter.requestEmailCode({email});
        if (!delivered || typeof delivered.challengeId !== 'string' || !delivered.challengeId) throw fail(503, 'A verification code could not be sent. Please try again.');
        const token = crypto.randomBytes(32).toString('base64url'), challengeId = crypto.randomUUID();
        flows.set(hash(token), {provider: 'email', email, challengeId, externalChallengeId: delivered.challengeId, attempts: 0, expiresAt: now() + CHALLENGE_TTL});
        setCookie(res, FLOW_COOKIE, await signed(token), CHALLENGE_TTL);
        send(res, 200, {challengeId, expiresIn: CHALLENGE_TTL / 1000, message: 'Check your email for a verification code.'}); return true;
      }
      if (url.pathname === '/api/auth/email/verify') {
        if (!emailConfigured()) throw fail(503, 'Email verification is not configured yet.');
        const input = await body(req), token = await unpack(cookie(req, FLOW_COOKIE)), flow = token && flows.get(hash(token));
        if (!flow || flow.provider !== 'email' || flow.challengeId !== input.challengeId || flow.expiresAt <= now()) throw fail(401, 'This code request has expired. Request a new code.');
        if (flow.verifying) throw fail(409, 'Verification is already in progress. Please wait.');
        if (++flow.attempts > 5) {flows.delete(hash(token)); throw fail(429, 'Too many incorrect codes. Request a new code.');}
        if (!/^[0-9]{6,8}$/.test(String(input.code || ''))) throw fail(400, 'Enter the verification code from your email.');
        flow.verifying = true;
        let verified;
        try {verified = await adapter.verifyEmailCode({challengeId: flow.externalChallengeId, email: flow.email, code: String(input.code)});}
        finally {flow.verifying = false;}
        if (!verified) throw fail(401, 'The verification code is invalid or expired.');
        const checked = identity(verified, flow.email);
        flows.delete(hash(token));
        send(res, 200, {user: await issueSession(req, res, {...verified, ...checked}, 'email', flow.email)}); return true;
      }
      const current = await authenticate(req);
      if (!current) throw fail(401, 'Sign in to continue.');
      if (!checkCsrf(req, current)) throw fail(403, 'Your session verification failed. Refresh and try again.');
      if (url.pathname === '/api/auth/logout') {
        const token = await unpack(cookie(req, COOKIE));
        await serial(async () => {const state = await read(); state.sessions = state.sessions.filter(item => item.tokenHash !== hash(token)); await write(state);});
        setCookie(res, COOKIE, '', 0); send(res, 200, {user: null}); return true;
      }
      if (['/api/auth/onboarding', '/api/auth/role'].includes(url.pathname)) {
        const input = await body(req), role = String(input.role || '').toLowerCase();
        if (!['buyer', 'seller'].includes(role)) throw fail(400, 'Choose Buyer or Seller. Broker access is not available yet.');
        const onboarding = url.pathname === '/api/auth/onboarding';
        const user = await serial(async () => {
          const state = await read(), account = state.users.find(item => item.id === current.id);
          if (!account) throw fail(401, 'Sign in to continue.');
          if (!onboarding && !account.onboardingCompleted) throw fail(409, 'Complete account setup first.');
          if (onboarding && account.onboardingCompleted) return {...current, ...publicUser(account, current)};
          account.role = role;
          if (onboarding) {
            account.onboardingCompleted = true;
            if (!account.welcomeCreditGrantedAt) {account.promotionalCredit = 100; account.promotionalCreditGranted = 100; account.welcomeCreditGrantedAt = new Date(now()).toISOString();}
          }
          await write(state); return publicUser(account, current);
        });
        send(res, 200, {user, reward: onboarding ? {amount: user.promotionalCreditGranted, currency: 'USD', withdrawable: false, grantedAt: user.welcomeCreditGrantedAt} : null}); return true;
      }
      throw fail(404, 'Authentication endpoint not found.');
    } catch (error) {
      const known = [400, 401, 403, 404, 405, 409, 413, 415, 429, 503].includes(error.status);
      send(res, known ? error.status : 503, {error: known ? error.message : 'Sign-in is temporarily unavailable. Please try again.'});
      return true;
    }
  }
  return {handle, authenticate, checkCsrf, close: async () => {await chain; flows.clear(); limits.clear();}};
}

module.exports = {createAuthService};
