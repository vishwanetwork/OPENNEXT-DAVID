'use strict';

const net = require('node:net');
const tls = require('node:tls');
const os = require('node:os');
const crypto = require('node:crypto');
const ADDRESS = /^[^\s@<>"(),;:\\[\]]+@[^\s@<>"(),;:\\[\]]+\.[^\s@<>"(),;:\\[\]]+$/;
const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];

/* Dependency-free SMTP sender.
 * SMTP_SECURE=1 (or port 465) uses implicit TLS; otherwise STARTTLS is required before AUTH or
 * mail data. Plaintext is accepted only for a loopback relay (e.g. a local test inbox).
 * Credentials are never logged; header values are stripped of CR/LF to prevent injection.
 */
function parseAddresses(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean).filter(item => ADDRESS.test(item));
}
function mailbox(value) {
  const raw = String(value || '').replace(/[\r\n]/g, '').trim(), match = raw.match(/^(.*)<([^>]+)>$/);
  const address = (match ? match[2] : raw).trim();
  if (!ADDRESS.test(address)) return null;
  const name = match ? match[1].trim().replace(/^"|"$/g, '') : '';
  return {address, header: name ? encodeWord(name) + ' <' + address + '>' : address};
}
function encodeWord(value) {
  const clean = String(value).replace(/[\r\n]/g, ' ');
  return /^[\x20-\x7e]*$/.test(clean) ? clean : '=?UTF-8?B?' + Buffer.from(clean).toString('base64') + '?=';
}

function createSmtpMailer({env = process.env, connectTimeout = 20000} = {}) {
  const host = String(env.SMTP_HOST || '').trim();
  const port = Number(env.SMTP_PORT || (env.SMTP_SECURE === '1' ? 465 : 587));
  const secure = env.SMTP_SECURE === '1' || port === 465;
  const user = String(env.SMTP_USER || ''), pass = String(env.SMTP_PASS || '');
  const from = mailbox(env.SMTP_FROM || user);
  const configured = Boolean(host && Number.isInteger(port) && port > 0 && port < 65536 && from);

  function session(socket) {
    let buffer = '', waiting = null, failure = null;
    const lines = [];
    const settle = () => {
      if (!waiting) return;
      if (failure) {const {reject} = waiting; waiting = null; reject(failure); return;}
      const end = lines.findIndex(line => /^\d{3} /.test(line) || /^\d{3}$/.test(line));
      if (end < 0) return;
      const reply = lines.splice(0, end + 1), {resolve} = waiting; waiting = null;
      resolve({code: Number(reply[end].slice(0, 3)), lines: reply.map(line => line.slice(4))});
    };
    const attach = target => {
      target.setEncoding('utf8');
      target.on('data', chunk => {buffer += chunk; const parts = buffer.split('\r\n'); buffer = parts.pop(); lines.push(...parts); settle();});
      target.on('error', error => {failure = failure || error; settle();});
      target.on('close', () => {failure = failure || new Error('SMTP connection closed.'); settle();});
      target.setTimeout(connectTimeout, () => target.destroy(new Error('SMTP connection timed out.')));
    };
    attach(socket);
    const reply = () => new Promise((resolve, reject) => {waiting = {resolve, reject}; settle();});
    return {
      reply,
      async startTls() {
        for (const event of ['data', 'close', 'error', 'timeout']) socket.removeAllListeners(event);
        socket.setTimeout(0);
        const next = await new Promise((resolve, reject) => {
          const upgraded = tls.connect({socket, servername: host});
          upgraded.once('secureConnect', () => {upgraded.removeListener('error', reject); resolve(upgraded);});
          upgraded.once('error', reject);
        });
        socket = next; buffer = ''; lines.length = 0; attach(next);
      },
      async command(line, expected) {
        socket.write(line + '\r\n');
        const result = await reply();
        if (!expected.includes(result.code)) throw new Error(`SMTP ${line.split(' ')[0]} rejected (${result.code}).`);
        return result;
      },
      end() {socket.end();},
    };
  }
  function open() {
    return new Promise((resolve, reject) => {
      const socket = secure ? tls.connect({host, port, servername: host}) : net.connect({host, port});
      socket.once(secure ? 'secureConnect' : 'connect', () => {socket.removeListener('error', reject); resolve(socket);});
      socket.once('error', reject);
      socket.setTimeout(connectTimeout, () => socket.destroy(new Error('SMTP connection timed out.')));
    });
  }
  function message({to, subject, text, replyTo}) {
    const domain = from.address.split('@')[1];
    const headers = [
      'From: ' + from.header,
      'To: ' + to.join(', '),
      ...(replyTo ? ['Reply-To: ' + replyTo] : []),
      'Subject: ' + encodeWord(subject),
      'Date: ' + new Date().toUTCString().replace('GMT', '+0000'),
      'Message-ID: <' + crypto.randomUUID() + '@' + domain + '>',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
    ];
    const body = Buffer.from(String(text).replace(/\r?\n/g, '\r\n')).toString('base64').match(/.{1,76}/g) || [];
    return headers.join('\r\n') + '\r\n\r\n' + body.join('\r\n');
  }

  async function send({to, subject, text, replyTo}) {
    if (!configured) throw new Error('SMTP is not configured.');
    const recipients = (Array.isArray(to) ? to : parseAddresses(to)).filter(item => ADDRESS.test(item));
    if (!recipients.length) throw new Error('No valid recipients.');
    const reply = replyTo ? mailbox(replyTo) : null;
    const smtp = session(await open());
    try {
      if ((await smtp.reply()).code !== 220) throw new Error('SMTP server did not greet.');
      const name = os.hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'localhost';
      let features = (await smtp.command('EHLO ' + name, [250])).lines;
      if (!secure) {
        if (features.some(line => /^STARTTLS\b/i.test(line))) {
          await smtp.command('STARTTLS', [220]);
          await smtp.startTls();
          features = (await smtp.command('EHLO ' + name, [250])).lines;
        } else if (!LOOPBACK.includes(host)) throw new Error('SMTP server does not offer STARTTLS; refusing to send in plaintext.');
      }
      if (user) {
        const auth = features.find(line => /^AUTH\b/i.test(line)) || '';
        if (/\bPLAIN\b/i.test(auth)) await smtp.command('AUTH PLAIN ' + Buffer.from('\0' + user + '\0' + pass).toString('base64'), [235]);
        else if (/\bLOGIN\b/i.test(auth)) {
          await smtp.command('AUTH LOGIN', [334]);
          await smtp.command(Buffer.from(user).toString('base64'), [334]);
          await smtp.command(Buffer.from(pass).toString('base64'), [235]);
        } else throw new Error('SMTP server offers no supported AUTH mechanism.');
      }
      await smtp.command('MAIL FROM:<' + from.address + '>', [250]);
      for (const recipient of recipients) await smtp.command('RCPT TO:<' + recipient + '>', [250, 251]);
      await smtp.command('DATA', [354]);
      await smtp.command(message({to: recipients, subject, text, replyTo: reply?.header}) + '\r\n.', [250]);
      await smtp.command('QUIT', [221]).catch(() => {});
    } finally {smtp.end();}
  }

  return {configured, send};
}

module.exports = {createSmtpMailer, parseAddresses};
