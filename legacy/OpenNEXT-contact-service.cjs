'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const STATUSES = ['New', 'Contacted', 'Qualified', 'Closed'];
const fail = (status, message) => Object.assign(new Error(message), {status});
const clean = (value, label, max, required = true) => {
  if (typeof value !== 'string') throw fail(400, `${label} is required.`);
  const text = value.trim().replace(/\r\n?/g, '\n');
  if ((required && !text) || text.length > max || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text)) throw fail(400, `${label} must contain ${required ? '1' : '0'}–${max} characters.`);
  return text;
};

function createContactService({dataDir, now = () => Date.now()} = {}) {
  const directory = path.resolve(dataDir || process.env.OPENNEXT_DATA_DIR || path.join(__dirname, '.opennext-data'));
  const filename = path.join(directory, 'contact-leads.json');
  let chain = Promise.resolve();
  const serial = task => {const result = chain.then(task); chain = result.catch(() => {}); return result;};
  async function read() {
    try {
      const data = JSON.parse(await fs.readFile(filename, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.leads)) throw fail(503, 'Contact storage is unavailable.');
      return data;
    } catch (error) {if (error.code === 'ENOENT') return {version: 1, leads: []}; throw fail(503, 'Contact storage is unavailable.');}
  }
  async function write(data) {
    await fs.mkdir(directory, {recursive: true});
    const temporary = filename + '.' + crypto.randomUUID() + '.tmp';
    try {
      await fs.writeFile(temporary, JSON.stringify(data, null, 2), {encoding: 'utf8', mode: 0o600, flag: 'wx'});
      await fs.rename(temporary, filename);
    } catch (error) {await fs.unlink(temporary).catch(() => {}); throw fail(503, 'Your request could not be saved. Please try again.');}
  }
  return {
    create(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'Enter your contact details.');
      if (input.website) throw fail(400, 'Unable to submit this request.'); // Unadvertised honeypot.
      const fields = {
        name: clean(input.name, 'Name', 100), company: clean(input.company, 'Company', 160),
        title: clean(input.title, 'Title', 100), email: clean(input.email, 'Email', 254).toLowerCase(),
        message: clean(input.message, 'How can we help', 4000),
      };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) throw fail(400, 'Enter a valid email address.');
      const submissionId = typeof input.submissionId === 'string' && /^[a-z0-9-]{16,80}$/i.test(input.submissionId) ? input.submissionId : crypto.randomUUID();
      return serial(async () => {
        const data = await read();
        const existing = data.leads.find(lead => lead.submissionId === submissionId);
        if (existing) {
          if (Object.keys(fields).some(key => existing[key] !== fields[key])) throw fail(409, 'This submission reference has already been used. Please reopen the form.');
          return {id: existing.id, status: existing.status, createdAt: existing.createdAt};
        }
        if (data.leads.length >= 10000) throw fail(503, 'Contact requests are temporarily unavailable. Please try again later.');
        const timestamp = new Date(now()).toISOString();
        let id; do {id = 'CONTACT-' + crypto.randomUUID().slice(0, 8).toUpperCase();} while (data.leads.some(lead => lead.id === id));
        const lead = {...fields, id, submissionId,
          status: 'New', source: 'Website contact form', createdAt: timestamp, updatedAt: timestamp,
          history: [{status: 'New', at: timestamp, note: 'Submitted through the website.'}]};
        data.leads.unshift(lead);
        await write(data);
        return {id: lead.id, status: lead.status, createdAt: lead.createdAt};
      });
    },
    list() {return serial(async () => (await read()).leads.map(({submissionId, ...lead}) => lead));},
    update(id, input) {
      if (!input || !STATUSES.includes(input.status)) throw fail(400, 'Choose a valid request status.');
      const note = clean(input.note || '', 'Note', 2000, false);
      return serial(async () => {
        const data = await read(), lead = data.leads.find(item => item.id === id);
        if (!lead) throw fail(404, 'Contact request not found.');
        if (input.updatedAt && input.updatedAt !== lead.updatedAt) throw fail(409, 'This request has changed. Refresh and try again.');
        lead.status = input.status;
        lead.updatedAt = new Date(Math.max(now(), Date.parse(lead.updatedAt) + 1)).toISOString();
        lead.history.unshift({status: input.status, at: lead.updatedAt, note});
        lead.history = lead.history.slice(0, 100);
        await write(data);
        const {submissionId, ...result} = lead;
        return result;
      });
    },
  };
}

function createContactRouter(service, {security, now = () => Date.now(), rateLimit = 5} = {}) {
  const attempts = new Map();
  const send = (res, status, value, headers = {}) => {res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers}); res.end(JSON.stringify(value));};
  async function body(req) {
    if (!/^application\/json(?:;|$)/i.test(String(req.headers['content-type'] || ''))) throw fail(415, 'Use a JSON request.');
    let size = 0; const chunks = [];
    for await (const chunk of req) {size += chunk.length; if (size > 8192) throw fail(413, 'Your message is too long.'); chunks.push(chunk);}
    try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw fail(400, 'Invalid request.');}
  }
  return async (req, res, url, {onTerminal = false} = {}) => {
    const publicRoute = url.pathname === '/api/contact';
    if (!publicRoute && !url.pathname.startsWith('/api/admin/contacts')) return false;
    try {
      if (publicRoute) {
        if (req.method !== 'POST') {send(res, 405, {error: 'Use the contact form to submit a request.'}, {Allow: 'POST'}); return true;}
        if (!security.sameOrigin(req)) throw fail(403, 'Origin not allowed.');
        const key = String(req.socket.remoteAddress || 'unknown'), time = now();
        for (const [address, value] of attempts) if (time - value.start > 15 * 60 * 1000) attempts.delete(address);
        if (attempts.size > 10000 && !attempts.has(key)) throw fail(429, 'Please wait before submitting another request.');
        const bucket = attempts.get(key) || {start: time, count: 0};
        bucket.count++; attempts.set(key, bucket);
        if (bucket.count > rateLimit) {send(res, 429, {error: 'Please wait 15 minutes before submitting another request.'}, {'Retry-After': '900'}); return true;}
        send(res, 201, await service.create(await body(req)));
        return true;
      }
      if (onTerminal) throw fail(404, 'Not found.');
      if (!security.authenticated(req)) throw fail(401, 'Administrator sign-in is required.');
      if (req.method !== 'GET' && !security.sameOrigin(req) && !security.bearerAuthenticated(req)) throw fail(403, 'Origin not allowed.');
      if (url.pathname === '/api/admin/contacts' && req.method === 'GET') {send(res, 200, {leads: await service.list()}); return true;}
      const match = url.pathname.match(/^\/api\/admin\/contacts\/(CONTACT-[A-F0-9]{8})$/);
      if (match && req.method === 'PATCH') {send(res, 200, {lead: await service.update(match[1], await body(req))}); return true;}
      if (req.method !== 'GET' && req.method !== 'PATCH') {send(res, 405, {error: 'Method not allowed.'}, {Allow: 'GET, PATCH'}); return true;}
      throw fail(404, 'Contact request not found.');
    } catch (error) {
      const known = [400, 401, 403, 404, 409, 413, 415, 429, 503].includes(error.status);
      send(res, known ? error.status : 503, {error: known ? error.message : 'Contact service is unavailable. Please try again.'});
      return true;
    }
  };
}
module.exports = {createContactService, createContactRouter};
