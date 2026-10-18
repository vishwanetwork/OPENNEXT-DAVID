'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {createMarketplaceService, createMarketplaceRouter} = require('./OpenNEXT-marketplace-service.cjs');
const {createDemoData} = require('./OpenNEXT-demo-fixtures.cjs');

const COOKIE = 'opennext_demo_session';
const PREFIX = '/api/demo';
const fail = (status, message) => Object.assign(new Error(message), {status});
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const equal = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const bounded = (value, fallback, minimum, maximum) => Number.isInteger(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;

// This service never accepts a production data directory, authentication adapter,
// payment adapter or installer. Every guest receives an expiring private workspace.
function createDemoService({enabled = true, secureCookies = process.env.NODE_ENV === 'production', trustProxy = false,
  publicOrigin, now = () => Date.now(), sessionTtlMs = 2 * 60 * 60 * 1000, maxSessions = 100,
  maxMutations = 100, maxStartsPerWindow = 20} = {}) {
  const ttl = bounded(sessionTtlMs, 7200000, 1000, 86400000);
  const capacity = bounded(maxSessions, 100, 1, 500);
  const mutationLimit = bounded(maxMutations, 100, 1, 500);
  const startLimit = bounded(maxStartsPerWindow, 20, 1, 100);
  const sessions = new Map(), starts = new Map(), operations = new Set();
  let rootPromise, closing = false, creation = Promise.resolve(), showcaseCache, showcasePromise;
  const send = (res, status, value) => {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    res.end(JSON.stringify(value));
  };
  function origin(req) {
    if (publicOrigin) return new URL(publicOrigin).origin;
    const forwarded = trustProxy ? req.headers['x-forwarded-host'] : null;
    const host = String(forwarded || req.headers.host || '');
    if (!/^[a-z0-9.:[\]-]+$/i.test(host)) throw fail(403, 'Invalid request host.');
    return (secureCookies || req.socket?.encrypted ? 'https://' : 'http://') + host;
  }
  function sameOrigin(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    try {return new URL(String(req.headers.origin || '')).origin === origin(req);} catch {return false;}
  }
  function token(req) {
    const item = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(COOKIE + '='));
    const value = item ? item.slice(COOKIE.length + 1) : '';
    return /^[A-Za-z0-9_-]{64}$/.test(value) ? value : '';
  }
  function setCookie(res, value, expires) {
    res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=${PREFIX}; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(expires / 1000))}${secureCookies ? '; Secure' : ''}`);
  }
  function userFor(session) {
    return {...session.user, csrfToken: session.csrfToken};
  }
  function sessionFor(req) {
    const value = token(req), session = value && sessions.get(hash(value));
    return session && !session.removed && session.expiresAt > now() ? session : null;
  }
  async function root() {
    if (!rootPromise) rootPromise = fs.mkdtemp(path.join(os.tmpdir(), 'opennext-public-demo-'));
    return rootPromise;
  }
  async function removeWorkspace(session) {
    if (session.cleaning || session.active > 0 || !session.directory) return;
    session.cleaning = true;
    const base = path.resolve(await root()), target = path.resolve(session.directory);
    // Only directories created as direct children of this service's private root are eligible.
    if (path.dirname(target) !== base || !/^[a-f0-9-]{36}$/.test(path.basename(target))) throw new Error('Invalid demo cleanup target.');
    await fs.rm(target, {recursive: true, force: true});
  }
  async function expire(session) {
    sessions.delete(session.key);
    session.removed = true;
    await removeWorkspace(session);
  }
  async function prune() {
    const cleanup = [];
    for (const session of sessions.values()) if (session.expiresAt <= now()) cleanup.push(expire(session));
    for (const [key, value] of starts) if (value.until <= now()) starts.delete(key);
    await Promise.all(cleanup);
  }
  function rateStart(req) {
    // Deliberately do not trust X-Forwarded-For for an unauthenticated rate-limit key.
    const key = hash(String(req.socket?.remoteAddress || 'unknown'));
    if (!starts.has(key) && starts.size >= 10000) throw fail(429, 'Demo access is busy. Please try again shortly.');
    const bucket = starts.get(key) || {count: 0, until: now() + 600000};
    bucket.count++;
    starts.set(key, bucket);
    if (bucket.count > startLimit) throw fail(429, 'Too many demo workspaces requested. Please try again later.');
  }
  function rateSession(session, mutating) {
    if (session.window.until <= now()) session.window = {count: 0, until: now() + 60000};
    if (++session.window.count > 600) throw fail(429, 'Too many demo requests. Please wait before continuing.');
    if (mutating && ++session.mutations > mutationLimit) throw fail(429, 'This demo workspace has reached its testing limit. Start a new demo later.');
  }
  async function body(req) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, 'Use a JSON request.');
    const chunks = []; let size = 0;
    for await (const chunk of req) {size += chunk.length; if (size > 4096) throw fail(413, 'The request is too large.'); chunks.push(chunk);}
    let input;
    try {input = JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw fail(400, 'Invalid JSON request.');}
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'Invalid request object.');
    return input;
  }
  function role(value) {
    const selected = String(value || 'buyer').toLowerCase();
    if (!['buyer', 'seller'].includes(selected)) throw fail(400, 'Choose Buyer or Seller. Broker access is not available yet.');
    return selected;
  }
  async function approveFixtureCandidates(marketplace) {
    const snapshot = await marketplace.admin();
    for (const candidate of snapshot.featured || []) {
      if (!candidate.current || candidate.model === 'B300') continue;
      await marketplace.decideFeatured(candidate.id, {status: 'Approved', fingerprint: candidate.fingerprint, reason: 'Approved for this isolated demo workspace.'}, 'Demo operations');
    }
  }
  async function showcase() {
    if (showcaseCache && showcaseCache.expiresAt > now()) return showcaseCache.value;
    if (!showcasePromise) showcasePromise = (async () => {
      // Build one read-only public snapshot, never a guest session or a production record.
      // The short-lived directory uses the same bounded cleanup boundary as guest workspaces.
      const workspace = {directory: path.join(await root(), crypto.randomUUID()), active: 0};
      try {
        await fs.mkdir(workspace.directory, {mode: 0o700});
        await fs.writeFile(path.join(workspace.directory, 'marketplace.json'), JSON.stringify(createDemoData(now())), {flag: 'wx', mode: 0o600});
        const marketplace = createMarketplaceService({dataDir: workspace.directory, now, agentAdapter: null});
        await approveFixtureCandidates(marketplace);
        const value = {demo: true, ...await marketplace.publicMarket()};
        showcaseCache = {value, expiresAt: now() + 300000};
        return value;
      } finally {await removeWorkspace(workspace);}
    })().finally(() => {showcasePromise = null;});
    return showcasePromise;
  }
  async function makeSession(req, res, selectedRole) {
    const work = creation.then(async () => {
      await prune();
      if (closing) throw fail(503, 'The demo is restarting. Please try again.');
      const current = sessionFor(req);
      if (current) return current;
      rateStart(req);
      if (sessions.size >= capacity) throw fail(503, 'All demo workspaces are in use. Please try again shortly.');
      const value = crypto.randomBytes(48).toString('base64url'), key = hash(value);
      const directory = path.join(await root(), crypto.randomUUID());
      await fs.mkdir(directory, {mode: 0o700});
      const session = {key, directory, workspaceId: 'DEMO-' + crypto.randomUUID(), expiresAt: now() + ttl, active: 0, mutations: 0, window: {count: 0, until: now() + 60000},
        csrfToken: crypto.randomBytes(32).toString('base64url'),
        user: {id: 'demo-' + crypto.randomUUID(), email: 'guest@demo.invalid', name: 'Demo Guest', role: selectedRole,
          demo: true, onboardingCompleted: true, promotionalCredit: 100, promotionalCreditGranted: 100,
          promotionalCreditWithdrawable: false, welcomeCreditGrantedAt: new Date(now()).toISOString()}};
      try {
        await fs.writeFile(path.join(directory, 'marketplace.json'), JSON.stringify(createDemoData(now())), {flag: 'wx', mode: 0o600});
        session.marketplace = createMarketplaceService({dataDir: directory, now, agentAdapter: null});
        await approveFixtureCandidates(session.marketplace);
        const auth = {authenticate: async request => sessionFor(request) === session ? userFor(session) : null,
          checkCsrf: (request, user) => sameOrigin(request) && equal(request.headers['x-csrf-token'], user?.csrfToken)};
        session.route = createMarketplaceRouter(session.marketplace, {auth, security: null, env: {}});
        sessions.set(key, session);
        setCookie(res, value, ttl);
        return session;
      } catch (error) {await removeWorkspace(session); throw error;}
    });
    creation = work.catch(() => {});
    return work;
  }
  async function route(req, res, inputUrl) {
    const url = inputUrl || new URL(req.url, 'http://localhost');
    if (url.pathname !== PREFIX && !url.pathname.startsWith(PREFIX + '/')) return false;
    try {
      if (!enabled) throw fail(404, 'Demo access is unavailable.');
      if (closing) throw fail(503, 'The demo is restarting. Please try again.');
      const endpoint = url.pathname.slice(PREFIX.length);
      const mutating = !['GET', 'HEAD'].includes(req.method);
      if (mutating && !sameOrigin(req)) throw fail(403, 'Origin not allowed.');
      if (endpoint === '/showcase') {
        if (req.method !== 'GET') throw fail(405, 'The demo showcase is read-only.');
        send(res, 200, await showcase()); return true;
      }
      if (endpoint === '/config' && req.method === 'GET') {send(res, 200, {enabled: true, demo: true}); return true;}
      if (endpoint === '/auth/config' && req.method === 'GET') {send(res, 200, {demo: true, providers: {google: false, github: false}, email: false, otherMethods: false}); return true;}
      if (endpoint === '/start' && req.method === 'POST') {
        const input = await body(req), session = await makeSession(req, res, role(input.role));
        send(res, 200, {user: userFor(session), demo: true, expiresAt: new Date(session.expiresAt).toISOString()});
        return true;
      }
      await prune();
      const session = sessionFor(req);
      if (endpoint === '/auth/session' && req.method === 'GET') {send(res, 200, {user: session ? userFor(session) : null, demo: true}); return true;}
      if (!session) throw fail(401, 'Your demo session has expired. Open the demo again to start a new session.');
      if (mutating && !equal(req.headers['x-csrf-token'], session.csrfToken)) throw fail(403, 'Your demo session verification failed. Refresh and try again.');
      rateSession(session, mutating && endpoint !== '/auth/logout');
      session.active++;
      try {
        if (endpoint === '/auth/logout' && req.method === 'POST') {
          await expire(session); setCookie(res, '', 0); send(res, 200, {user: null, demo: true}); return true;
        }
        if (['/auth/role', '/auth/onboarding'].includes(endpoint) && req.method === 'POST') {
          const input = await body(req);
          session.user.role = role(input.role);
          send(res, 200, {user: userFor(session), demo: true, reward: endpoint === '/auth/onboarding' ? {amount: 100, currency: 'USD', withdrawable: false, grantedAt: session.user.welcomeCreditGrantedAt} : null});
          return true;
        }
        // Demo sessions never receive admin, webhook, payment or infrastructure authority.
        if (/^\/(?:admin|internal|billing|contact|auth)(?:\/|$)/.test(endpoint) || /\/(?:agent|resell|connect|ssh)(?:\/|$)/.test(endpoint)) {
          throw fail(403, 'This action is not available in Demo. No payment, infrastructure connection or real transaction has been made.');
        }
        if (!endpoint.startsWith('/marketplace/')) throw fail(404, 'Demo endpoint not found.');
        const demoUrl = new URL(url.href); demoUrl.pathname = '/api' + endpoint;
        if (await session.route(req, res, demoUrl, {onTerminal: true})) return true;
        throw fail(404, 'Demo endpoint not found.');
      } finally {
        session.active--;
        if (session.removed) await removeWorkspace(session);
      }
    } catch (error) {
      const known = [400, 401, 403, 404, 405, 409, 413, 415, 429, 503].includes(error.status);
      if (!res.headersSent) send(res, known ? error.status : 503, {error: known ? error.message : 'The demo is temporarily unavailable. Please try again.', demo: true});
      return true;
    }
  }
  function handle(req, res, url) {
    const operation = route(req, res, url);
    operations.add(operation);
    operation.finally(() => operations.delete(operation)).catch(() => {});
    return operation;
  }
  function trackAdmin(work) {
    const operation = work();
    operations.add(operation);
    operation.finally(() => operations.delete(operation)).catch(() => {});
    return operation;
  }
  function requireAdminWorkspaceService() {
    if (!enabled) throw fail(404, 'Demo access is unavailable.');
    if (closing) throw fail(503, 'The demo is restarting. Please try again.');
  }
  function consoleRecord(record, session) {
    const {sshHost, sshUser, sshPort, ...safe} = record;
    return {...safe, ...(record.kind && Object.hasOwn(record, 'sshHost') ? {sshConfigured: !!sshHost} : {}),
      demo: true, scope: 'demo', workspaceId: session.workspaceId,
      workspaceExpiresAt: new Date(session.expiresAt).toISOString()};
  }
  // These methods are callable only by the authenticated Console router. They
  // do not grant guest routes operations authority or expose session secrets.
  function consoleSnapshot() {
    return trackAdmin(async () => {
      requireAdminWorkspaceService();
      await prune();
      const result = {demo: true, scope: 'demo', rfqs: [], supplies: [], kyb: [], generatedAt: new Date(now()).toISOString()};
      for (const session of sessions.values()) {
        if (session.removed) continue;
        if (session.expiresAt <= now()) {await expire(session); continue;}
        session.active++;
        try {
          const snapshot = await session.marketplace.admin();
          if (session.removed || session.expiresAt <= now()) continue;
          for (const collection of ['rfqs', 'supplies', 'kyb']) {
            result[collection].push(...snapshot[collection].filter(record => record.ownerId === session.user.id).map(record => consoleRecord(record, session)));
          }
        } finally {
          session.active--;
          if (session.expiresAt <= now() && !session.removed) await expire(session);
          else if (session.removed) await removeWorkspace(session);
        }
      }
      await prune();
      const activeWorkspaces = new Set([...sessions.values()].filter(session => !session.removed && session.expiresAt > now()).map(session => session.workspaceId));
      for (const collection of ['rfqs', 'supplies', 'kyb']) result[collection] = result[collection].filter(record => activeWorkspaces.has(record.workspaceId))
        .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
      return result;
    });
  }
  function decideConsoleKyb(id, input, operator = 'Demo operations') {
    return trackAdmin(async () => {
      requireAdminWorkspaceService();
      await prune();
      if (!/^DEMO-[a-f0-9-]{36}$/.test(String(input?.workspaceId || ''))) throw fail(400, 'Select a valid Demo workspace.');
      const session = [...sessions.values()].find(value => value.workspaceId === input.workspaceId && !value.removed && value.expiresAt > now());
      if (!session) throw fail(404, 'This Demo workspace has expired or is unavailable. Start a new Demo to continue testing.');
      session.active++;
      try {
        const snapshot = await session.marketplace.admin();
        if (!snapshot.kyb.some(record => record.id === id && record.ownerId === session.user.id)) throw fail(404, 'The Demo KYB submission was not found in this workspace.');
        if (session.removed || session.expiresAt <= now()) throw fail(404, 'This Demo workspace has expired. Start a new Demo to continue testing.');
        const record = await session.marketplace.decideKyb(id, {status: input.status, reason: input.reason ?? input.note}, operator);
        if (session.removed || session.expiresAt <= now()) throw fail(404, 'This Demo workspace has expired. Start a new Demo to continue testing.');
        return consoleRecord(record, session);
      } finally {
        session.active--;
        if (session.expiresAt <= now() && !session.removed) await expire(session);
        else if (session.removed) await removeWorkspace(session);
      }
    });
  }
  const timer = setInterval(() => {prune().catch(() => {});}, 60000);
  timer.unref?.();
  async function close() {
    closing = true; clearInterval(timer);
    await Promise.allSettled([...operations]); await creation;
    for (const session of sessions.values()) await expire(session);
    if (rootPromise) {
      const target = path.resolve(await rootPromise), tempRoot = path.resolve(os.tmpdir());
      if (path.dirname(target) !== tempRoot || !path.basename(target).startsWith('opennext-public-demo-')) throw new Error('Invalid demo root cleanup target.');
      await fs.rm(target, {recursive: true, force: true});
    }
    starts.clear(); showcaseCache = null;
  }
  return {handle, close, enabled: !!enabled, consoleSnapshot, decideConsoleKyb};
}

module.exports = {createDemoService};
