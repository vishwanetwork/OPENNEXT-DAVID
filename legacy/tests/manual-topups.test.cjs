'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {Readable} = require('node:stream');
const {createTopupService, createTopupRouter} = require('../OpenNEXT-topup-service.cjs');
const {createDemoService} = require('../OpenNEXT-demo-service.cjs');
const buyer = {id: 'buyer-one', email: 'buyer@example.test', onboardingCompleted: true, promotionalCredit: 100};
const secondBuyer = {...buyer, id: 'buyer-two', email: 'second@example.test'};
const input = {amount: 123.45, method: 'bank_transfer', idempotencyKey: 'request-fixture-0001'};
const approve = {decision: 'Approve', fundsVerified: true};

async function fixture(t, options = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opennext-topups-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('opennext-topups-test-'));
    await fs.rm(dataDir, {recursive: true, force: true});
  });
  return {dataDir, service: createTopupService({dataDir, ...options})};
}
const status = code => error => error?.status === code;
const auth = {authenticate: async req => req.user, checkCsrf: req => req.headers.origin === 'https://terminal.example' && req.headers['x-csrf-token'] === 'csrf-token'};
const security = {authenticated: req => req.admin === true, sameOrigin: req => req.headers.origin === 'https://terminal.example', bearerAuthenticated: req => req.headers.authorization === 'Bearer fixture-token'};
async function call(route, pathname, {method = 'GET', value, user = buyer, admin = false, headers = {}, context = {}, raw} = {}) {
  const request = Readable.from([Buffer.from(raw ?? (value === undefined ? '' : JSON.stringify(value)))]);
  Object.assign(request, {method, user, admin, headers: {host: 'terminal.example', origin: 'https://terminal.example', 'content-type': 'application/json', 'x-csrf-token': 'csrf-token', ...headers}, socket: {remoteAddress: '192.0.2.1'}});
  let code, result, responseHeaders = {};
  const response = {headersSent: false, setHeader(name, value) {responseHeaders[name.toLowerCase()] = value;}, writeHead(status, fields) {code = status; responseHeaders = {...responseHeaders, ...fields}; this.headersSent = true;}, end(body) {result = body ? JSON.parse(body) : null;}};
  const handled = await route(request, response, new URL(pathname, 'https://terminal.example'), context);
  return {status: code, body: result, headers: responseHeaders, handled};
}

test('manual top-ups credit verified funds once and persist decision, ledger and notification together', async t => {
  const {service, dataDir} = await fixture(t);
  const request = await service.create(buyer, {...input, accountId: secondBuyer.id, email: secondBuyer.email, amountCents: 999999, status: 'Approved'});
  assert.equal(request.accountId, buyer.id); assert.equal(request.email, buyer.email); assert.equal(request.amountCents, 12345); assert.equal(request.status, 'Pending'); assert.equal(request.solved, false);
  assert.equal((await service.account(buyer)).availableCredit, 100);
  const duplicate = await service.create(buyer, input); assert.equal(duplicate.id, request.id);
  const anotherService = createTopupService({dataDir});
  const results = await Promise.all(Array.from({length: 12}, (_, index) => (index % 2 ? service : anotherService).review(request.id, approve, 'Verified operator')));
  assert.ok(results.every(row => row.id === request.id && row.status === 'Approved' && row.solved === true));
  const account = await service.account(buyer);
  assert.equal(account.paidCredit, 123.45); assert.equal(account.promotionalCredit, 100); assert.equal(account.availableCredit, 223.45); assert.equal(account.notifications.length, 1);
  assert.match(account.notifications[0].message, /\$123\.45/); assert.equal(account.notifications[0].ownerId, buyer.id); assert.equal(account.notifications[0].topupId, request.id);
  const reopened = createTopupService({dataDir}); assert.deepEqual(await reopened.account(buyer), account);
  await assert.rejects(reopened.review(request.id, {decision: 'Reject'}), status(409));
  assert.deepEqual(await reopened.account(buyer), account);
});

test('reject adds no credit, makes a single amount-bearing notification and remains final', async t => {
  const {service} = await fixture(t), request = await service.create(buyer, input);
  await service.review(request.id, {decision: 'Reject', reason: 'Funds were not received.'});
  await service.review(request.id, {decision: 'Reject', reason: 'Ignored duplicate reason.'});
  const account = await service.account(buyer); assert.equal(account.paidCredit, 0); assert.equal(account.availableCredit, 100); assert.equal(account.notifications.length, 1);
  assert.match(account.notifications[0].message, /\$123\.45[\s\S]*No credit was added/); assert.equal(account.requests[0].reason, 'Funds were not received.'); assert.equal(account.requests[0].solved, true);
  await assert.rejects(service.review(request.id, approve), status(409));
});

test('review reasons accept multiline notes but reject other controls and excessive length', async t => {
  const {service} = await fixture(t), approved = await service.create(buyer, input), rejected = await service.create(buyer, {...input, idempotencyKey: 'request-fixture-0002'});
  const reason = 'Verified receipt.\r\nBank reference:\tABC-42\rReviewed by finance.';
  const result = await service.review(approved.id, {...approve, reason}); assert.equal(result.reason, 'Verified receipt.\nBank reference:\tABC-42\nReviewed by finance.');
  for (const value of ['Bad\u0000note', 'Bad\u000bnote', 'Bad\u000cnote', 'Bad\u001fnote', 'Bad\u007fnote', 'x'.repeat(2001)]) assert.throws(() => service.review(rejected.id, {decision: 'Reject', reason: value}), status(400));
  assert.throws(() => service.review(rejected.id, {decision: 'Reject'}, 'Operator\nInjected'), status(400));
  assert.throws(() => service.create(buyer, {...input, purchaseReference: 'purchase\nother'}), status(400));
  const decline = await service.review(rejected.id, {decision: 'Reject', reason: 'Receipt does not match.\n\tPlease contact support.'});
  assert.equal(decline.reason, 'Receipt does not match.\n\tPlease contact support.'); assert.equal((await service.account(buyer)).paidCredit, 123.45);
});

test('amount, method, immutable idempotency payload and verified-funds acknowledgement are validated', async t => {
  const {service} = await fixture(t);
  for (const amount of [undefined, null, '', '100', 0, -1, 0.99, 100000.01, 1.001, NaN, Infinity, true]) assert.throws(() => service.create(buyer, {...input, amount}), status(400));
  for (const method of ['', 'cash', 'crypto', null]) assert.throws(() => service.create(buyer, {...input, method}), status(400));
  assert.throws(() => service.create(buyer, {...input, purchaseReference: {id: 'ORDER-1'}}), status(400));
  const request = await service.create(buyer, {...input, purchaseReference: 'spot:offer-42'});
  await assert.rejects(service.create(buyer, {...input, amount: 500}), status(409));
  await assert.rejects(service.create(buyer, {...input, method: 'paypal'}), status(409));
  await assert.rejects(service.create(buyer, {...input, purchaseReference: 'spot:changed'}), status(409));
  assert.throws(() => service.review(request.id, {decision: 'Approve'}), status(400));
  assert.throws(() => service.review(request.id, {decision: 'Approve', fundsVerified: 'true'}), status(400));
  assert.equal((await service.get(buyer, request.id)).status, 'Pending');
});

test('ownership derives from authenticated identity and accounts cannot read each other', async t => {
  const {service} = await fixture(t), first = await service.create(buyer, input), second = await service.create(secondBuyer, input);
  assert.notEqual(first.id, second.id); await service.review(first.id, approve);
  await assert.rejects(service.get(secondBuyer, first.id), status(404));
  const account = await service.account(secondBuyer); assert.equal(account.requests.length, 1); assert.equal(account.requests[0].id, second.id); assert.equal(account.notifications.length, 0); assert.equal(account.availableCredit, 100);
  assert.throws(() => service.account(null), status(401)); assert.throws(() => service.create({...buyer, onboardingCompleted: false}, input), status(401));
  assert.throws(() => service.create({...buyer, demo: true}, input), status(403));
});

test('corrupt ledger and missing established ledger fail closed without resetting funds', async t => {
  const {service, dataDir} = await fixture(t), request = await service.create(buyer, input); await service.review(request.id, approve);
  const filename = path.join(dataDir, 'credit-topups.json'), original = await fs.readFile(filename, 'utf8');
  await fs.writeFile(filename, '{broken'); await assert.rejects(service.account(buyer), status(503)); await assert.rejects(service.create(buyer, {...input, idempotencyKey: 'another-request-002'}), status(503));
  const corrupted = JSON.parse(original); corrupted.credits[0].amountCents += 1; await fs.writeFile(filename, JSON.stringify(corrupted)); await assert.rejects(service.account(buyer), status(503));
  await fs.writeFile(filename, original); assert.equal((await service.account(buyer)).availableCredit, 223.45);
  await fs.unlink(filename); await assert.rejects(service.account(buyer), status(503));
  const restarted = createTopupService({dataDir});
  await assert.rejects(restarted.account(buyer), status(503));
  await assert.rejects(restarted.create(buyer, {...input, idempotencyKey: 'after-restart-request'}), status(503));
  await assert.rejects(fs.access(filename), error => error.code === 'ENOENT');
});

test('a failed initial atomic save leaves initialization retryable without an empty ledger marker', async t => {
  const {service, dataDir} = await fixture(t), filename = path.join(dataDir, 'credit-topups.json'), marker = path.join(dataDir, 'credit-topups.initialized');
  const rename = fs.rename;
  try {
    fs.rename = async (source, target) => {if (target === filename) throw Object.assign(Error('Injected rename failure'), {code: 'EIO'}); return rename(source, target);};
    await assert.rejects(service.create(buyer, input), status(503));
  } finally {fs.rename = rename;}
  await assert.rejects(fs.access(filename), error => error.code === 'ENOENT'); await assert.rejects(fs.access(marker), error => error.code === 'ENOENT');
  const saved = await createTopupService({dataDir}).create(buyer, input); assert.equal(saved.status, 'Pending');
  assert.equal((await service.list()).length, 1); await fs.access(marker);
});

test('marker creation failure recovers the saved request without duplicating or losing its ledger', async t => {
  const {service, dataDir} = await fixture(t), filename = path.join(dataDir, 'credit-topups.json'), marker = path.join(dataDir, 'credit-topups.initialized');
  const writeFile = fs.writeFile;
  try {
    fs.writeFile = async (target, ...args) => {if (target === marker) throw Object.assign(Error('Injected marker failure'), {code: 'EACCES'}); return writeFile(target, ...args);};
    await assert.rejects(service.create(buyer, input), status(503));
  } finally {fs.writeFile = writeFile;}
  const original = JSON.parse(await fs.readFile(filename, 'utf8')); assert.equal(original.requests.length, 1); assert.equal(original.credits.length, 0);
  const restarted = createTopupService({dataDir}), recovered = await restarted.create(buyer, input); assert.equal(recovered.id, original.requests[0].id);
  await fs.access(marker); await restarted.review(recovered.id, approve);
  const before = await restarted.account(buyer); assert.equal(before.availableCredit, 223.45); assert.equal(before.notifications.length, 1);
  await fs.unlink(marker);
  try {
    fs.writeFile = async (target, ...args) => {if (target === marker) throw Object.assign(Error('Injected missing marker path'), {code: 'ENOENT'}); return writeFile(target, ...args);};
    await assert.rejects(createTopupService({dataDir}).account(buyer), status(503));
  } finally {fs.writeFile = writeFile;}
  assert.deepEqual(await createTopupService({dataDir}).account(buyer), before); await fs.access(marker);
});

test('top-up HTTP routes enforce authentication, owner isolation and administrator host/origin policy', async t => {
  const {service} = await fixture(t), route = createTopupRouter(service, {auth, security});
  assert.equal((await call(route, '/api/billing/account', {user: null})).status, 401);
  assert.equal((await call(route, '/api/billing/topups', {method: 'POST', value: input, headers: {origin: 'https://evil.example'}})).status, 403);
  assert.equal((await call(route, '/api/billing/topups', {method: 'POST', value: input, headers: {'x-csrf-token': ''}})).status, 403);
  assert.equal((await call(route, '/api/billing/topups', {method: 'POST', raw: '[]'})).status, 400);
  assert.equal((await call(route, '/api/billing/topups', {method: 'POST', raw: '{'})).status, 400);
  assert.equal((await call(route, '/api/billing/topups', {method: 'POST', value: input, headers: {'content-type': 'text/plain'}})).status, 415);
  assert.equal((await call(route, '/api/billing/topups', {method: 'POST', raw: ' '.repeat(5000)})).status, 413);
  const created = await call(route, '/api/billing/topups', {method: 'POST', value: input}); assert.equal(created.status, 201);
  const id = created.body.request.id;
  assert.equal((await call(route, '/api/billing/topups/' + id, {user: secondBuyer})).status, 404);
  assert.equal((await call(route, '/api/billing/topups/' + id)).status, 200);
  assert.equal((await call(route, '/api/admin/topups')).status, 401);
  assert.equal((await call(route, '/api/admin/topups', {admin: true, context: {onTerminal: true}})).status, 404);
  assert.equal((await call(route, '/api/admin/topups', {admin: true})).body.requests.length, 1);
  const reviewPath = '/api/admin/topups/' + id + '/review';
  assert.equal((await call(route, reviewPath, {method: 'POST', value: approve, admin: true, headers: {origin: 'https://evil.example'}})).status, 403);
  assert.equal((await call(route, reviewPath, {method: 'POST', value: {decision: 'Approve'}, admin: true})).status, 400);
  assert.equal((await call(route, reviewPath, {method: 'POST', value: {...approve, workspaceId: 'DEMO-fake'}, admin: true})).status, 400);
  const approved = await call(route, reviewPath, {method: 'POST', value: approve, admin: true}); assert.equal(approved.status, 200); assert.equal(approved.body.request.reviewedBy, 'Console administrator');
  assert.equal((await call(route, '/api/billing/account')).body.availableCredit, 223.45);
  assert.equal((await call(route, '/api/billing/checkout')).handled, false);
});

test('Demo top-ups and operations review remain isolated by session, workspace and API scope', async t => {
  const {service} = await fixture(t), demo = createDemoService({secureCookies: true, publicOrigin: 'https://terminal.example'});
  t.after(() => demo.close());
  const demoCall = (pathname, options) => call((req, res, url) => demo.handle(req, res, url), pathname, options);
  const start = await demoCall('/api/demo/start', {method: 'POST', value: {role: 'buyer'}}); assert.equal(start.status, 200);
  const cookie = start.headers['set-cookie'].split(';')[0], headers = {cookie, 'x-csrf-token': start.body.user.csrfToken};
  const created = await demoCall('/api/demo/billing/topups', {method: 'POST', value: input, headers}); assert.equal(created.status, 201);
  const id = created.body.request.id;
  assert.equal((await demoCall('/api/demo/billing/account', {headers})).body.availableCredit, 100);
  assert.equal((await demoCall('/api/demo/billing/account')).status, 401);
  const next = await demoCall('/api/demo/start', {method: 'POST', value: {role: 'buyer'}}), otherHeaders = {cookie: next.headers['set-cookie'].split(';')[0], 'x-csrf-token': next.body.user.csrfToken};
  assert.equal((await demoCall('/api/demo/billing/topups/' + id, {headers: otherHeaders})).status, 404);
  assert.equal((await demoCall('/api/demo/billing/checkout', {method: 'POST', value: input, headers})).status, 403);
  const route = createTopupRouter(service, {auth, security, demoService: demo});
  assert.equal((await call(route, '/api/admin/topups', {admin: true})).body.requests.length, 0);
  const snapshot = await call(route, '/api/admin/topups?scope=demo', {admin: true}); assert.equal(snapshot.status, 200); assert.equal(snapshot.body.requests.length, 1);
  const workspaceId = snapshot.body.requests[0].workspaceId; assert.match(workspaceId, /^DEMO-/); assert.equal(snapshot.body.requests[0].demo, true);
  const reviewPath = '/api/admin/topups/' + id + '/review';
  assert.equal((await call(route, reviewPath, {method: 'POST', value: approve, admin: true})).status, 404);
  assert.equal((await call(route, reviewPath + '?scope=demo', {method: 'POST', value: approve, admin: true})).status, 400);
  assert.equal((await call(route, reviewPath + '?scope=demo', {method: 'POST', value: {...approve, workspaceId}, admin: true})).status, 200);
  const account = (await demoCall('/api/demo/billing/account', {headers})).body; assert.equal(account.availableCredit, 223.45); assert.equal(account.paidCredit, 123.45); assert.equal(account.notifications.length, 1);
  assert.equal((await service.account(buyer)).availableCredit, 100); assert.equal((await service.list()).length, 0);
  assert.equal((await demoCall('/api/demo/billing/account', {headers: otherHeaders})).body.availableCredit, 100);
  await demoCall('/api/demo/auth/logout', {method: 'POST', value: {}, headers});
  assert.equal((await call(route, '/api/admin/topups?scope=demo', {admin: true})).body.requests.length, 0);
});

test('application routes manual top-up account and review without invoking legacy checkout', async t => {
  const {dataDir} = await fixture(t), {createAppServer} = require('../OpenNEXT-preview-server.cjs');
  let checkoutCalls = 0;
  const server = createAppServer({dataDir, env: {OPENNEXT_DEMO_ENABLED: '0', OPENNEXT_EXTERNAL_MARKETPLACE_ENABLED: '0'}, externalService: false,
    authService: {...auth, authenticate: async req => req.headers['x-fixture-user'] === 'buyer' ? buyer : null, handle: async () => false},
    pricingService: {close: async () => {}}, capacityService: {close: async () => {}}, newsService: {close: async () => {}},
    checkoutAdapter: {createCheckout: async () => {checkoutCalls++; throw Error('Must not run');}}});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));});
  const origin = 'http://127.0.0.1:' + server.address().port;
  const response = await fetch(origin + '/api/billing/topups', {method: 'POST', headers: {'Content-Type': 'application/json', 'x-fixture-user': 'buyer', Origin: 'https://terminal.example', 'x-csrf-token': 'csrf-token'}, body: JSON.stringify(input)});
  assert.equal(response.status, 201); const id = (await response.json()).request.id;
  const reviewed = await fetch(origin + '/api/admin/topups/' + id + '/review', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin}, body: JSON.stringify(approve)}); assert.equal(reviewed.status, 200);
  const account = await fetch(origin + '/api/billing/account', {headers: {'x-fixture-user': 'buyer'}}); assert.equal((await account.json()).availableCredit, 223.45); assert.equal(checkoutCalls, 0);
  const hidden = await fetch(origin + '/OpenNEXT-topup-service.cjs'); assert.equal(hidden.status, 404);
});
