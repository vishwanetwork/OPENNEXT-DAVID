'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const queues = new Map();
const METHODS = ['credit_card', 'paypal', 'bank_transfer'];
const fail = (status, message) => Object.assign(new Error(message), {status});
const clone = value => JSON.parse(JSON.stringify(value));
const money = cents => '$' + (cents / 100).toFixed(2);
const text = (value, max, required = false, multiline = false) => {
  if (value == null && !required) return '';
  const controls = multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/;
  if (typeof value !== 'string' || (required && !value.trim()) || value.trim().length > max || controls.test(value)) throw fail(400, 'Invalid request details.');
  return (multiline ? value.replace(/\r\n?/g, '\n') : value).trim();
};

// A review records manually verified funds; this service never charges a card,
// contacts a bank or treats a browser payment return as proof of payment.
// Decision, ledger credit and notification share one atomic serialized file.
// This file store assumes a single Node process per data directory. Replace it
// with transactional storage before running multiple workers or a real debit
// adapter. Real spending must share the same authoritative credit/debit ledger;
// the current account view sums approved top-ups and authenticated promo credit.
function createTopupService({dataDir, now = () => Date.now(), demo = false} = {}) {
  const directory = path.resolve(dataDir || process.env.OPENNEXT_DATA_DIR || path.join(__dirname, '.opennext-data'));
  const filename = path.join(directory, 'credit-topups.json');
  const initializedFile = path.join(directory, 'credit-topups.initialized');
  let seen = false;
  const serial = task => {
    const result = (queues.get(filename) || Promise.resolve()).then(task);
    const settled = result.catch(() => {}); queues.set(filename, settled);
    settled.finally(() => {if (queues.get(filename) === settled) queues.delete(filename);});
    return result;
  };
  const userId = user => {
    if (!user?.onboardingCompleted || typeof user.id !== 'string' || !user.id || typeof user.email !== 'string') throw fail(401, 'Verify your account and complete onboarding first.');
    if (!!user.demo !== !!demo) throw fail(403, 'This billing workspace does not match your account.');
    return user.id;
  };
  const publicRequest = request => {const {idempotencyKey, ...safe} = request; return clone(safe);};
  async function initialized() {
    try {
      const marker = JSON.parse(await fs.readFile(initializedFile, 'utf8'));
      if (marker.version !== 1 || marker.demo !== !!demo) throw Error('Invalid ledger initialization marker');
      return true;
    } catch (error) {if (error.code === 'ENOENT') return false; throw error;}
  }
  async function ensureInitialized() {
    if (await initialized()) return;
    try {await fs.writeFile(initializedFile, JSON.stringify({version: 1, demo: !!demo}), {flag: 'wx', mode: 0o600});}
    catch (error) {if (error.code !== 'EEXIST' || !(await initialized())) throw error;}
  }
  async function read() {
    let marked = false, loaded = false;
    try {
      marked = await initialized();
      const content = await fs.readFile(filename, 'utf8'); loaded = true;
      const state = JSON.parse(content);
      if (state.version !== 1 || state.demo !== !!demo || !Array.isArray(state.requests) || !Array.isArray(state.credits) || !Array.isArray(state.notifications)) throw Error('Invalid ledger');
      const ids = new Set();
      for (const row of state.requests) {
        if (!row || typeof row.id !== 'string' || ids.has(row.id) || typeof row.accountId !== 'string' || !Number.isSafeInteger(row.amountCents) || row.amountCents < 100 || row.amountCents > 10000000 || row.amount !== row.amountCents / 100 || !METHODS.includes(row.method) || !['Pending', 'Approved', 'Rejected'].includes(row.status)) throw Error('Invalid request');
        ids.add(row.id);
        const credits = state.credits.filter(item => item.requestId === row.id);
        const notices = state.notifications.filter(item => item.topupId === row.id);
        if (row.status === 'Approved' ? credits.length !== 1 : credits.length !== 0) throw Error('Invalid credit');
        if (row.status === 'Pending' ? notices.length !== 0 : notices.length !== 1) throw Error('Invalid notification');
        if (credits.some(item => item.accountId !== row.accountId || item.amountCents !== row.amountCents)) throw Error('Invalid owner');
        if (notices.some(item => item.ownerId !== row.accountId || item.amountCents !== row.amountCents)) throw Error('Invalid notification owner');
      }
      if (state.credits.some(item => !ids.has(item.requestId)) || state.notifications.some(item => !ids.has(item.topupId))) throw Error('Orphaned ledger record');
      // Backfill older valid ledgers and recover a first save whose marker write
      // failed. Existing authoritative records are never replaced with an empty state.
      if (!marked) await ensureInitialized();
      seen = true; return state;
    } catch (error) {
      if (error.code === 'ENOENT' && !seen && !marked && !loaded) return {version: 1, demo: !!demo, requests: [], credits: [], notifications: []};
      throw fail(503, 'Credit records are temporarily unavailable. No balance change was made.');
    }
  }
  async function write(state) {
    const temporary = filename + '.' + crypto.randomUUID() + '.tmp';
    try {
      await fs.mkdir(directory, {recursive: true});
      await fs.writeFile(temporary, JSON.stringify(state), {flag: 'wx', mode: 0o600});
      await fs.rename(temporary, filename); seen = true;
      // Create this only after the first atomic ledger save. A failed first save
      // remains retryable; a failed marker save recovers the already saved ledger.
      await ensureInitialized();
    } catch {
      await fs.unlink(temporary).catch(() => {});
      throw fail(503, 'Credit records could not be saved. Refresh before trying again.');
    }
  }
  function create(user, input) {
    const accountId = userId(user);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'Enter a top-up amount and payment method.');
    const amount = input.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 1 || amount > 100000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001 || !METHODS.includes(input.method)) throw fail(400, 'Choose a valid payment method and an amount from $1.00 to $100,000.00 with up to two decimal places.');
    const idempotencyKey = text(input.idempotencyKey, 80, true);
    if (!/^[A-Za-z0-9-]{12,80}$/.test(idempotencyKey)) throw fail(400, 'A valid submission reference is required.');
    const amountCents = Math.round(amount * 100), purchaseReference = text(input.purchaseReference, 200);
    return serial(async () => {
      const state = await read(), previous = state.requests.find(row => row.accountId === accountId && row.idempotencyKey === idempotencyKey);
      if (previous) {
        if (previous.amountCents !== amountCents || previous.method !== input.method || (previous.purchaseReference || '') !== purchaseReference) throw fail(409, 'This submission reference was already used for different top-up details.');
        return publicRequest(previous);
      }
      if (state.requests.length >= 10000) throw fail(503, 'Top-up requests are temporarily unavailable. Please contact support.');
      const request = {id: 'TOPUP-' + crypto.randomUUID(), accountId, email: user.email, amount: amountCents / 100, amountCents, method: input.method,
        createdAt: new Date(now()).toISOString(), status: 'Pending', solved: false, reviewedAt: null, reviewedBy: null, idempotencyKey,
        ...(purchaseReference ? {purchaseReference} : {}), ...(demo ? {demo: true, scope: 'demo'} : {})};
      state.requests.unshift(request); await write(state); return publicRequest(request);
    });
  }
  function account(user) {
    const accountId = userId(user);
    return serial(async () => {
      const state = await read(), promotional = Number(user.promotionalCredit || 0), promotionalCents = Math.round(promotional * 100);
      const paidCents = state.credits.filter(row => row.accountId === accountId).reduce((sum, row) => sum + row.amountCents, 0);
      if (!Number.isSafeInteger(paidCents) || !Number.isSafeInteger(promotionalCents) || promotionalCents < 0 || !Number.isSafeInteger(paidCents + promotionalCents)) throw fail(503, 'Your available Credit could not be confirmed.');
      return {confirmed: true, accountId, currency: 'USD', availableCredit: (paidCents + promotionalCents) / 100, paidCredit: paidCents / 100, promotionalCredit: promotionalCents / 100,
        requests: state.requests.filter(row => row.accountId === accountId).map(publicRequest), notifications: clone(state.notifications.filter(row => row.ownerId === accountId)), ...(demo ? {demo: true, scope: 'demo'} : {})};
    });
  }
  function get(user, id) {
    const accountId = userId(user);
    return serial(async () => {const row = (await read()).requests.find(item => item.id === id && item.accountId === accountId); if (!row) throw fail(404, 'Top-up request not found.'); return publicRequest(row);});
  }
  function list() {return serial(async () => (await read()).requests.map(publicRequest));}
  function review(id, input, operator = 'Console administrator') {
    if (!input || !['Approve', 'Reject'].includes(input.decision)) throw fail(400, 'Choose Approve or Reject.');
    if (input.decision === 'Approve' && input.fundsVerified !== true) throw fail(400, 'Verify receipt of the funds before approving this top-up.');
    const reason = text(input.reason, 2000, false, true), reviewedBy = text(operator, 160, true);
    return serial(async () => {
      const state = await read(), request = state.requests.find(row => row.id === id);
      if (!request) throw fail(404, 'Top-up request not found.');
      const status = input.decision === 'Approve' ? 'Approved' : 'Rejected';
      if (request.status !== 'Pending') {
        if (request.status !== status) throw fail(409, 'This top-up request already has a final decision.');
        return publicRequest(request);
      }
      const reviewedAt = new Date(now()).toISOString();
      Object.assign(request, {status, solved: true, reviewedAt, reviewedBy, ...(reason ? {reason} : {}), fundsVerified: status === 'Approved'});
      if (status === 'Approved') state.credits.push({id: 'CREDIT-' + crypto.randomUUID(), requestId: request.id, accountId: request.accountId, amountCents: request.amountCents, createdAt: reviewedAt});
      state.notifications.unshift({id: 'NTF-' + crypto.randomUUID(), ownerId: request.accountId, topupId: request.id, subject: status === 'Approved' ? 'Credit top-up approved' : 'Credit top-up rejected',
        message: status === 'Approved' ? 'Your ' + money(request.amountCents) + ' credit top-up has been approved and added to your available Credit.' : 'Your ' + money(request.amountCents) + ' credit top-up request was rejected. No credit was added.' + (reason ? ' ' + reason : ''),
        amount: request.amount, amountCents: request.amountCents, currency: 'USD', status, created: reviewedAt, createdAt: reviewedAt, read: false, route: 'billing'});
      await write(state); return publicRequest(request);
    });
  }
  return {create, account, get, list, review};
}

function createTopupRouter(service, {auth, security, demoService} = {}) {
  const send = (res, status, value) => {res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(value));};
  async function body(req) {
    if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) throw fail(415, 'Use application/json.');
    let size = 0; const chunks = [];
    for await (const chunk of req) {const bytes = Buffer.from(chunk); size += bytes.length; if (size > 4096) throw fail(413, 'Request too large.'); chunks.push(bytes);}
    let value; try {value = JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw fail(400, 'Invalid JSON request.');}
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'Invalid request object.'); return value;
  }
  return async (req, res, url, {onTerminal = false} = {}) => {
    const admin = /^\/api\/admin\/topups(?:\/|$)/.test(url.pathname), billing = url.pathname === '/api/billing/account' || /^\/api\/billing\/topups(?:\/|$)/.test(url.pathname);
    if (!admin && !billing) return false;
    try {
      if (admin) {
        if (onTerminal) throw fail(404, 'Not found.');
        if (!security?.authenticated(req)) throw fail(401, 'Administrator sign-in is required.');
        if (req.method !== 'GET' && !security.sameOrigin(req) && !security.bearerAuthenticated(req)) throw fail(403, 'Origin not allowed.');
        const scope = url.searchParams.get('scope'); if (scope && !['live', 'demo'].includes(scope)) throw fail(400, 'Choose a valid billing scope.');
        if (scope === 'demo' && !demoService) throw fail(404, 'Demo top-ups are unavailable.');
        if (url.pathname === '/api/admin/topups' && req.method === 'GET') {send(res, 200, {requests: scope === 'demo' ? await demoService.consoleTopups() : await service.list()}); return true;}
        const match = url.pathname.match(/^\/api\/admin\/topups\/(TOPUP-[a-f0-9-]{36})\/review$/);
        if (match && req.method === 'POST') {
          const input = await body(req);
          if (scope !== 'demo' && input.workspaceId) throw fail(400, 'Select Demo scope when reviewing a Demo workspace.');
          const request = scope === 'demo' ? await demoService.decideConsoleTopup(match[1], input) : await service.review(match[1], input);
          send(res, 200, {request}); return true;
        }
      } else {
        const user = await auth.authenticate(req); if (!user?.onboardingCompleted) throw fail(401, 'Verify your account and complete onboarding first.');
        if (req.method !== 'GET' && !auth.checkCsrf(req, user)) throw fail(403, 'Request origin was not verified.');
        if (url.pathname === '/api/billing/account' && req.method === 'GET') {send(res, 200, await service.account(user)); return true;}
        if (url.pathname === '/api/billing/topups' && req.method === 'POST') {send(res, 201, {request: await service.create(user, await body(req))}); return true;}
        const match = url.pathname.match(/^\/api\/billing\/topups\/(TOPUP-[a-f0-9-]{36})$/);
        if (match && req.method === 'GET') {send(res, 200, {request: await service.get(user, match[1])}); return true;}
      }
      if (!['GET', 'POST'].includes(req.method)) throw fail(405, 'Method not allowed.');
      throw fail(404, 'Top-up endpoint not found.');
    } catch (error) {const known = [400, 401, 403, 404, 405, 409, 413, 415, 503].includes(error.status); send(res, known ? error.status : 503, {error: known ? error.message : 'Credit service is temporarily unavailable. No balance change was made.'}); return true;}
  };
}

module.exports = {createTopupService, createTopupRouter};
