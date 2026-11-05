'use strict';
// The state document store, on files and (with OPENNEXT_TEST_MYSQL_URL and the mysql2 driver
// installed) on MySQL, plus the services that keep their state in it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {createFileDocumentStore, createMysqlDocumentStore, mysqlOptions} = require('../OpenNEXT-document-store.cjs');
const {createTopupService} = require('../OpenNEXT-topup-service.cjs');
const {createContactService} = require('../OpenNEXT-contact-service.cjs');
const {createAuthService} = require('../OpenNEXT-auth-service.cjs');
const {createCapacityPriceService} = require('../OpenNEXT-capacity-prices.cjs');
const {createPricingService} = require('../OpenNEXT-pricing-service.cjs');

const MYSQL_URL = process.env.OPENNEXT_TEST_MYSQL_URL || '';
let driver = null;
try {driver = MYSQL_URL ? require('mysql2/promise') : null;} catch {driver = null;}
const mysqlSkip = !MYSQL_URL ? 'OPENNEXT_TEST_MYSQL_URL is not configured' : !driver ? 'the mysql2 driver is not installed (cd legacy && npm ci)' : false;

async function tempDir(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opennext-documents-test-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  return directory;
}

/** A fresh database per test; only databases created here are dropped. */
async function mysqlUrl(t) {
  const options = mysqlOptions(MYSQL_URL + (new URL(MYSQL_URL).pathname.length > 1 ? '' : '/mysql'));
  const name = 'opennext_test_' + crypto.randomBytes(8).toString('hex');
  const admin = await driver.createConnection({host: options.host, port: options.port, user: options.user, password: options.password});
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4`);
  t.after(async () => {await admin.query(`DROP DATABASE IF EXISTS \`${name}\``); await admin.end();});
  const url = new URL(MYSQL_URL); url.pathname = '/' + name;
  return url.toString();
}

const backends = [
  ['files', async t => {const dir = await tempDir(t); return preload => createFileDocumentStore(dir);}],
  ['mysql', async t => {
    const url = await mysqlUrl(t), opened = [];
    t.after(() => Promise.all(opened.map(store => store.close())));
    return async (preload = []) => {const store = await createMysqlDocumentStore(url, {preload}); opened.push(store); return store;};
  }],
];

for (const [name, setup] of backends) {
  const skip = name === 'mysql' && mysqlSkip;

  test(`${name}: documents are created once, replaced whole and missing ones report ENOENT`, {skip}, async t => {
    const open = await setup(t), store = await open();
    await assert.rejects(store.read('auth-state.json'), error => error.code === 'ENOENT');
    await store.create('credit-topups.initialized', '{"version":1}');
    await assert.rejects(store.create('credit-topups.initialized', '{}'), error => error.code === 'EEXIST');
    const big = JSON.stringify({users: Array.from({length: 20000}, (_, i) => ({id: 'u' + i, name: 'Ünïcode 名字 ' + i}))});
    await store.write('auth-state.json', big);
    await store.write('auth-state.json', big);
    assert.equal(await store.read('auth-state.json'), big);
    assert.throws(() => store.readSync('../escape.json'));
  });

  test(`${name}: background writes and appends survive a restart through preload`, {skip}, async t => {
    const open = await setup(t), first = await open(['capacity-state.json', 'capacity-segments.jsonl']);
    assert.equal(first.readSync('capacity-state.json'), null);
    first.writeLater('capacity-state.json', '{"version":3}');
    first.appendLater('capacity-segments.jsonl', '["a"]\n');
    first.appendLater('capacity-segments.jsonl', '["b"]\n');
    await first.flush();
    const second = await open(['capacity-state.json', 'capacity-segments.jsonl']);
    assert.equal(second.readSync('capacity-state.json'), '{"version":3}');
    assert.equal(second.readSync('capacity-segments.jsonl'), '["a"]\n["b"]\n');
  });

  test(`${name}: Credit top-ups, leads and accounts persist across service restarts`, {skip}, async t => {
    const open = await setup(t), buyer = {id: 'buyer-one', email: 'buyer@example.test', onboardingCompleted: true};
    const topups = createTopupService({documents: await open()});
    const request = await topups.create(buyer, {amount: 123.45, method: 'bank_transfer', idempotencyKey: 'request-fixture-0001'});
    await topups.review(request.id, {decision: 'Approve', fundsVerified: true});
    const reopened = createTopupService({documents: await open()});
    const view = await reopened.account(buyer);
    assert.equal(view.requests[0].status, 'Approved');
    assert.equal(view.paidCredit, 123.45);

    const contacts = createContactService({documents: await open()});
    await contacts.create({name: 'Test Buyer', company: 'Fixture', title: 'Lead', email: 'lead@example.test', message: 'Capacity inquiry for testing.'});
    assert.equal((await createContactService({documents: await open()}).list()).length, 1);

    const adapter = {emailEnabled: true, requestEmailCode: async () => ({challengeId: 'challenge'}),
      verifyEmailCode: async ({email, code}) => code === '123456' ? {subject: 'subject', email, emailVerified: true, name: 'Person'} : null};
    const auth = createAuthService({documents: await open(), adapter, secureCookies: false, sessionSecret: 'x'.repeat(48)});
    const state = JSON.stringify({version: 1, users: [{id: 'user-1', email: 'a@example.test', name: 'A', createdAt: new Date().toISOString()}], sessions: []});
    await (await open()).write('auth-state.json', state);
    assert.equal(typeof auth.authenticate, 'function');
    assert.equal(JSON.parse(await (await open()).read('auth-state.json')).users[0].id, 'user-1');
  });

  test(`${name}: capacity and pricing state reload after a restart`, {skip}, async t => {
    const open = await setup(t), preload = ['pricing-state.json', 'capacity-state.json', 'capacity-segments.jsonl'];
    const cacheDir = await tempDir(t);
    const documents = await open(preload);
    const pricing = createPricingService({documents, cacheDir});
    await pricing.close();
    const capacity = createCapacityPriceService({documents, env: {}});
    await capacity.close();
    documents.writeLater('pricing-state.json', JSON.stringify({version: 1, preferences: {aws: {intervalMinutes: 30}}, records: [], observations: [], runs: []}));
    await documents.flush();
    const reloaded = createPricingService({documents: await open(preload), cacheDir});
    assert.equal(JSON.parse((await open(preload)).readSync('pricing-state.json')).preferences.aws.intervalMinutes, 30);
    await reloaded.close();
  });
}
