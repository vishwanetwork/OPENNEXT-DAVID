'use strict';
/**
 * Test site entry point. Runs the bundled legacy API with email-code sign-in delivered by SMTP
 * (Mailpit on the test host), and the Next.js server pointed at the SpotOrderBot adapter.
 * Production uses docker/start.cjs and its OAuth providers; never use this outside the test site.
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { createAppServer } = require('/app/legacy/OpenNEXT-preview-server.cjs');
const { createOAuthAdapter } = require('/app/legacy/OpenNEXT-oauth-adapter.cjs');
const { createSmtpMailer } = require('/app/legacy/OpenNEXT-mailer.cjs');

const CODE_TTL = 10 * 60 * 1000;
const mailer = createSmtpMailer({ env: process.env });
const codes = new Map();
const authAdapter = {
  ...createOAuthAdapter({ env: process.env }),
  emailEnabled: true,
  async requestEmailCode({ email }) {
    const challengeId = crypto.randomUUID();
    const code = String(crypto.randomInt(100000, 1000000));
    codes.set(challengeId, { email, code, expires: Date.now() + CODE_TTL });
    await mailer.send({
      to: [email],
      subject: 'Your OpenNEXT test sign-in code',
      text: `Your OpenNEXT test sign-in code is ${code}. It expires in 10 minutes.\n`,
    });
    return { challengeId };
  },
  async verifyEmailCode({ challengeId, email, code }) {
    const entry = codes.get(challengeId);
    if (!entry || entry.expires < Date.now() || entry.email !== email) return null;
    if (!crypto.timingSafeEqual(Buffer.from(entry.code), Buffer.from(String(code).padEnd(6).slice(0, 6))))
      return null;
    codes.delete(challengeId);
    const subject = 'email-' + crypto.createHash('sha256').update(email).digest('hex').slice(0, 24);
    return { subject, email, emailVerified: true, name: email.split('@')[0] };
  },
};

const server = createAppServer({ authAdapter });
server.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
server.listen(4189, '127.0.0.1', () => {
  console.log('[api] legacy API with test email sign-in on 127.0.0.1:4189');
  server.pricing.startScheduler();
  server.capacity.start();
  server.news.start().catch((error) => console.error('News refresh: ' + error.message));
  const web = spawn(process.execPath, ['/app/apps/web/server.js'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: '4188', HOSTNAME: '0.0.0.0', API_ORIGIN: 'http://127.0.0.1:4191' },
  });
  web.on('exit', (code) => process.exit(code === 0 ? 0 : 1));
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => {
      web.kill('SIGTERM');
      setTimeout(() => process.exit(0), 2000).unref();
    });
});
