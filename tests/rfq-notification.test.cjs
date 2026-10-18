'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createSmtpMailer} = require('../OpenNEXT-mailer.cjs');
const {createRfqNotifier, rfqEmail} = require('../OpenNEXT-rfq-notifier.cjs');
const {createMarketplaceService} = require('../OpenNEXT-marketplace-service.cjs');

const epoch = Date.parse('2026-10-18T12:00:00Z');
const buyer = {id:'notify-buyer',email:'buyer@example.test',name:'Verified Buyer',role:'buyer',onboardingCompleted:true};
const rfq = {kind:'gpu_rental',model:'H200',region:'Singapore',title:'H200 training requirement',project:'Training rollout',count:8,hours:24,term:'On-demand',budget:3,start:'2026-10-20T12:00:00Z',quoteDeadline:'2026-10-19T12:00:00Z',notes:'Dedicated hardware with root access.',visibility:'Private RFQ',clientSubmissionId:'rfq-notify-0001'};

// Minimal SMTP server that records each session; plaintext is allowed only because it is loopback.
async function smtpServer(t, {auth = 'PLAIN LOGIN', reject} = {}) {
  const sessions = [];
  const server = net.createServer(socket => {
    const session = {commands: [], data: ''}; sessions.push(session);
    let buffer = '', inData = false, login = 0;
    socket.write('220 test.local ESMTP\r\n');
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        if (inData) {if (line === '.') {inData = false; socket.write('250 queued\r\n');} else session.data += line + '\r\n'; continue;}
        session.commands.push(line);
        if (login) {login = login === 1 ? 2 : 0; socket.write(login ? '334 UGFzc3dvcmQ6\r\n' : '235 ok\r\n'); continue;}
        const verb = line.split(' ')[0].toUpperCase();
        if (reject && reject === verb) socket.write('550 rejected\r\n');
        else if (verb === 'EHLO') socket.write('250-test.local\r\n' + (auth ? '250-AUTH ' + auth + '\r\n' : '') + '250 8BITMIME\r\n');
        else if (verb === 'AUTH' && line.includes('LOGIN')) {login = 1; socket.write('334 VXNlcm5hbWU6\r\n');}
        else if (verb === 'AUTH') socket.write('235 ok\r\n');
        else if (verb === 'DATA') {inData = true; socket.write('354 go\r\n');}
        else if (verb === 'QUIT') {socket.write('221 bye\r\n'); socket.end();}
        else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const env = {SMTP_HOST: '127.0.0.1', SMTP_PORT: String(server.address().port), SMTP_USER: 'mailer@opennextlab.ai', SMTP_PASS: 'app-password', SMTP_FROM: 'OpenNEXT <noreply@opennextlab.ai>', OPENNEXT_RFQ_NOTIFY_TO: 'ops@opennextlab.ai, sales@opennextlab.ai'};
  return {sessions, env};
}
function decode(data) {
  const [head, body] = data.split('\r\n\r\n');
  return {head, body: Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')};
}

test('SMTP mailer authenticates, addresses every recipient and sends UTF-8 base64 text', async t => {
  const smtp = await smtpServer(t);
  await createSmtpMailer({env: smtp.env}).send({to: ['ops@opennextlab.ai', 'sales@opennextlab.ai'], subject: 'RFQ 已提交\r\nBcc: attacker@example.test', text: 'Line one\nLine two', replyTo: 'Buyer <buyer@example.test>'});
  const [session] = smtp.sessions;
  assert.equal(session.commands.find(line => line.startsWith('AUTH')), 'AUTH PLAIN ' + Buffer.from('\0mailer@opennextlab.ai\0app-password').toString('base64'));
  assert.deepEqual(session.commands.filter(line => line.startsWith('MAIL') || line.startsWith('RCPT')), ['MAIL FROM:<noreply@opennextlab.ai>', 'RCPT TO:<ops@opennextlab.ai>', 'RCPT TO:<sales@opennextlab.ai>']);
  const message = decode(session.data);
  assert.match(message.head, /^From: OpenNEXT <noreply@opennextlab\.ai>$/m);
  assert.match(message.head, /^Reply-To: Buyer <buyer@example\.test>$/m);
  assert.match(message.head, /^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/m);
  assert.doesNotMatch(message.head, /^Bcc:/m);
  assert.equal(message.body, 'Line one\r\nLine two');
});

test('SMTP mailer falls back to AUTH LOGIN and surfaces server rejections', async t => {
  const login = await smtpServer(t, {auth: 'LOGIN'});
  await createSmtpMailer({env: login.env}).send({to: ['ops@opennextlab.ai'], subject: 'x', text: 'y'});
  const commands = login.sessions[0].commands;
  assert.deepEqual(commands.slice(commands.indexOf('AUTH LOGIN') + 1, commands.indexOf('AUTH LOGIN') + 3), [Buffer.from('mailer@opennextlab.ai').toString('base64'), Buffer.from('app-password').toString('base64')]);
  const rejecting = await smtpServer(t, {reject: 'RCPT'});
  await assert.rejects(createSmtpMailer({env: rejecting.env}).send({to: ['ops@opennextlab.ai'], subject: 'x', text: 'y'}), /RCPT rejected \(550\)/);
});

test('notifier is disabled until SMTP and recipients are configured', () => {
  assert.equal(createRfqNotifier({env: {}}).enabled, false);
  assert.equal(createRfqNotifier({env: {SMTP_HOST: 'smtp.example.test', SMTP_FROM: 'noreply@opennextlab.ai'}}).enabled, false);
  assert.equal(createRfqNotifier({env: {SMTP_HOST: 'smtp.example.test', SMTP_FROM: 'noreply@opennextlab.ai', OPENNEXT_RFQ_NOTIFY_TO: 'ops@opennextlab.ai'}}).enabled, true);
});

test('a submitted RFQ emails operations once, without waiting on delivery', async t => {
  const smtp = await smtpServer(t);
  const notifier = createRfqNotifier({env: smtp.env});
  t.after(() => notifier.close());
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'on-rfq-notify-'));
  t.after(() => fs.rm(dataDir, {recursive: true, force: true}));
  const service = createMarketplaceService({dataDir, now: () => epoch, onRfqSubmitted: notifier.rfqSubmitted});
  const saved = await service.saveRfq(buyer, rfq);
  assert.equal(smtp.sessions.length, 0, 'saving returns before the email is sent');
  await service.saveRfq(buyer, rfq);
  await notifier.idle();
  assert.equal(smtp.sessions.length, 1, 'an idempotent replay does not send a second email');
  const message = decode(smtp.sessions[0].data);
  assert.match(message.head, new RegExp('^Subject: \\[OpenNEXT\\] New RFQ for review: H200 training requirement \\(' + saved.id + '\\)$', 'm'));
  assert.match(message.head, /^To: ops@opennextlab\.ai, sales@opennextlab\.ai$/m);
  assert.match(message.head, /^Reply-To: buyer@example\.test$/m);
  for (const expected of ['RFQ: ' + saved.id, 'Type: GPU rental', 'Model: H200', 'Region: Singapore', 'GPU count: 8', 'Term: On-demand', 'Buyer: Verified Buyer <buyer@example.test>', 'Dedicated hardware with root access.', 'https://admin.opennextlab.ai/'])
    assert.ok(message.body.includes(expected), expected);
  await service.saveRfq(buyer, {...rfq, title: 'H200 training requirement v2'}, saved.id);
  await notifier.idle();
  assert.equal(smtp.sessions.length, 2);
  assert.match(decode(smtp.sessions[1].data).head, /Subject: \[OpenNEXT\] RFQ updated for review: H200 training requirement v2/);
});

test('mail failures retry in the background and never fail the RFQ', async t => {
  const smtp = await smtpServer(t, {reject: 'MAIL'});
  const logs = [], logger = {warn: message => logs.push(message), error: message => logs.push(message)};
  const notifier = createRfqNotifier({env: smtp.env, retryDelays: [5, 5], logger});
  t.after(() => notifier.close());
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'on-rfq-notify-fail-'));
  t.after(() => fs.rm(dataDir, {recursive: true, force: true}));
  const service = createMarketplaceService({dataDir, now: () => epoch, onRfqSubmitted: notifier.rfqSubmitted});
  const saved = await service.saveRfq(buyer, rfq);
  assert.equal(saved.reviewStatus, 'Reviewing');
  for (let i = 0; i < 50 && smtp.sessions.length < 3; i++) {await new Promise(resolve => setTimeout(resolve, 10)); await notifier.idle();}
  await notifier.idle();
  assert.equal(smtp.sessions.length, 3);
  assert.equal(logs.length, 3);
  assert.match(logs.at(-1), /failed after 3 attempts: SMTP MAIL rejected \(550\)/);
  assert.ok(logs.every(line => !line.includes('app-password')));
});

test('model capacity RFQs describe token volume instead of GPU count', () => {
  const {text} = rfqEmail({id: 'RFQ-1', title: 'Tokens', kind: 'model_capacity', model: 'Llama', inputMillion: 50, outputMillion: 10, days: 30, tps: null, notes: 'n'}, {adminUrl: 'https://admin.opennextlab.ai/'});
  assert.match(text, /Input tokens \(M\): 50/);
  assert.match(text, /Output tokens \(M\): 10/);
  assert.doesNotMatch(text, /GPU count/);
});
