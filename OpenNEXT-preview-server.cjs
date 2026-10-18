'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {getMarket} = require('./OpenNEXT-market-feed.cjs');
const {createNewsService} = require('./OpenNEXT-news-service.cjs');
const {createPricingService} = require('./OpenNEXT-pricing-service.cjs');
const {createPricingRouter} = require('./OpenNEXT-pricing-api.cjs');
const {createCapacityPriceService} = require('./OpenNEXT-capacity-prices.cjs');
const {createContactService, createContactRouter} = require('./OpenNEXT-contact-service.cjs');
const {createAuthService} = require('./OpenNEXT-auth-service.cjs');
const {createOAuthAdapter} = require('./OpenNEXT-oauth-adapter.cjs');
const {createMarketplaceService, createMarketplaceRouter} = require('./OpenNEXT-marketplace-service.cjs');
const {createPaymentRouter} = require('./OpenNEXT-payment-api.cjs');
const {createDemoService} = require('./OpenNEXT-demo-service.cjs');
const {listCuratedRfqs} = require('./OpenNEXT-curated-rfqs.cjs');
const {createReferenceCatalog} = require('./OpenNEXT-reference-catalog.cjs');

// Only browser assets are served. Source-only configuration and local files
// outside this allowlist are never exposed by the preview HTTP server.
const files = new Set([
  'index.html', 'admin/index.html',
  'OpenNEXT-preview-entry.html', 'OpenNEXT-terminal-preview.html',
  'OpenNEXT-original-homepage.js', 'OpenNEXT-original-homepage.css',
  'OpenNEXT-home-listings.js', 'OpenNEXT-home-listings.css',
  'OpenNEXT-curated-inquiries.js', 'OpenNEXT-curated-inquiries.css',
  'OpenNEXT-model-quotes.js', 'OpenNEXT-history-chart.js', 'OpenNEXT-history-chart.css',
  'OpenNEXT-capacity-chart.js', 'OpenNEXT-capacity-chart.css',
  'OpenNEXT-gci-index-factory.html', 'OpenNEXT-market-data.js',
  'OpenNEXT-terminal.js', 'OpenNEXT-terminal.css',
  'OpenNEXT-auth.js', 'OpenNEXT-auth.css',
  'OpenNEXT-demo.js', 'OpenNEXT-demo.css',
  'OpenNEXT-countries.js', 'OpenNEXT-instances.js', 'OpenNEXT-instances.css', 'OpenNEXT-payments.js',
  'OpenNEXT-console-marketplace.js', 'OpenNEXT-console-marketplace.css',
  'OpenNEXT-admin-console.html', 'OpenNEXT-admin.js', 'OpenNEXT-admin.css',
  'OpenNEXT-provider-console.js', 'OpenNEXT-provider-console.css', 'OpenNEXT-provider-logos.js',
  'OpenNEXT-contact.js', 'OpenNEXT-contact.css', 'OpenNEXT-console-leads.js', 'OpenNEXT-console-leads.css',
  'OpenNEXT-exchange.js', 'OpenNEXT-procurement.js', 'OpenNEXT-procurement.css', 'OpenNEXT-billing.js', 'OpenNEXT-billing.css',
]);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

// Optional host-based split. When SITE_HOST and TERMINAL_HOST are set, the
// Capacity Terminal is served only on TERMINAL_HOST. When ADMIN_HOST is also
// set, the Operations Console is served only on ADMIN_HOST. The site stays on
// SITE_HOST.
const SITE_HOST = (process.env.SITE_HOST || '').toLowerCase();
const TERMINAL_HOST = (process.env.TERMINAL_HOST || '').toLowerCase();
const ADMIN_HOST = (process.env.ADMIN_HOST || '').toLowerCase();
const adminFile = name => name.startsWith('admin/') || name.startsWith('OpenNEXT-admin') || name.startsWith('OpenNEXT-provider-console') || name.startsWith('OpenNEXT-provider-logos') || name.startsWith('OpenNEXT-console-leads') || name.startsWith('OpenNEXT-console-marketplace');

async function readDemoAdminBody(req) {
  const fail = (status, message) => Object.assign(new Error(message), {status});
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, 'Use a JSON request.');
  const chunks = []; let size = 0;
  for await (const chunk of req) {size += chunk.length; if (size > 4096) throw fail(413, 'The request is too large.'); chunks.push(chunk);}
  let input;
  try {input = JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw fail(400, 'Invalid JSON request.');}
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'Invalid request object.');
  return input;
}

function createAppServer(options = {}) {
  const environment = options.env || process.env;
  const demoEnabled = environment.OPENNEXT_DEMO_ENABLED !== '0';
  const referenceCatalog = environment.OPENNEXT_REFERENCE_CATALOG_ENABLED === '0' ? {scope:'reference-only',supplies:[],rfqs:[],recent:[]} : createReferenceCatalog();
  const demo = options.demoService || createDemoService({enabled:demoEnabled, secureCookies:options.secureCookies, trustProxy:environment.OPENNEXT_TRUST_PROXY === '1'});
  const privateDataDir = options.dataDir || (options.env || process.env).OPENNEXT_DATA_DIR || (options.env || process.env).OPENNEXT_PRICING_DATA_DIR || path.join(__dirname, '.opennext-data');
  const news = options.newsService || createNewsService({dataDir:privateDataDir, env:environment});
  const pricing = options.pricingService || createPricingService({dataDir:options.dataDir});
  const capacity = options.capacityService || createCapacityPriceService({env:options.env || process.env, dataDir:options.dataDir});
  const pricingRoute = createPricingRouter(pricing, {env:options.env || process.env, capacity});
  const contacts = options.contactService || createContactService({dataDir:options.dataDir});
  const contactRoute = createContactRouter(contacts, {security:pricingRoute.security});
  const auth = options.authService || createAuthService({dataDir:privateDataDir, adapter:options.authAdapter || createOAuthAdapter({env:options.env || process.env}), publicOrigin:options.publicOrigin, secureCookies:options.secureCookies});
  const marketplace = options.marketplaceService || createMarketplaceService({dataDir:privateDataDir, agentAdapter:options.agentAdapter});
  const marketplaceRoute = createMarketplaceRouter(marketplace, {auth, security:pricingRoute.security, env:options.env || process.env});
  const paymentRoute = createPaymentRouter({auth, checkoutAdapter:options.checkoutAdapter, allowedOrigins:options.checkoutOrigins});
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!['GET', 'HEAD'].includes(req.method) && !/^\/api\/(?:demo\/|auth\/|marketplace\/|billing\/|internal\/marketplace\/|admin\/(?:demo\/marketplace(?:\/|\?|$)|marketplace(?:\/|\?|$)|pricing\/|contacts(?:\/|\?|$))|contact(?:\?|$))/.test(String(req.url))) {
      res.writeHead(405, {Allow: 'GET, HEAD'});
      res.end('Method not allowed');
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400);
      res.end('Invalid URL');
      return;
    }
    const forwardedHost = (options.env || process.env).OPENNEXT_TRUST_PROXY === '1' ? req.headers['x-forwarded-host'] : undefined;
    const host = String(forwardedHost || req.headers.host || '').split(',')[0].split(':')[0].trim().toLowerCase();
    const onTerminal = Boolean(TERMINAL_HOST) && host === TERMINAL_HOST;
    const onAdmin = Boolean(ADMIN_HOST) && host === ADMIN_HOST;
    const restrictAdmin = onTerminal || (Boolean(ADMIN_HOST) && !onAdmin);

    if (pathname === '/api/admin/demo/marketplace' || pathname.startsWith('/api/admin/demo/marketplace/')) {
      const send = (status, value) => {res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'});res.end(req.method === 'HEAD' ? '' : JSON.stringify(value));};
      const fail = (status, message) => Object.assign(new Error(message), {status});
      try {
        if (restrictAdmin || !demoEnabled) throw fail(404, 'Not found.');
        const security = pricingRoute.security;
        if (!security.authenticated(req)) throw fail(401, 'Administrator sign-in is required.');
        if (!['GET', 'HEAD'].includes(req.method) && !security.sameOrigin(req) && !security.bearerAuthenticated(req)) throw fail(403, 'Origin not allowed.');
        if (pathname === '/api/admin/demo/marketplace' && req.method === 'GET') {send(200, await demo.consoleSnapshot()); return;}
        const match = pathname.match(/^\/api\/admin\/demo\/marketplace\/kyb\/(KYB-[A-F0-9]+)$/);
        if (match && req.method === 'PATCH') {send(200, await demo.decideConsoleKyb(match[1], await readDemoAdminBody(req))); return;}
        const rfqMatch = pathname.match(/^\/api\/admin\/demo\/marketplace\/rfqs\/(RFQ-[A-F0-9]+)$/);
        if (rfqMatch && req.method === 'PATCH') {send(200, await demo.decideConsoleRfq(rfqMatch[1], await readDemoAdminBody(req))); return;}
        throw fail(404, 'Not found.');
      } catch (error) {
        const known = [400, 401, 403, 404, 409, 413, 415, 503].includes(error.status);
        send(known ? error.status : 503, {error: known ? error.message : 'Demo submissions are temporarily unavailable.', demo: true, scope: 'demo'});
        return;
      }
    }

    if(pathname==='/api/marketplace/reference-catalog'){
      const allowed = !onAdmin && ['GET','HEAD'].includes(req.method);
      res.writeHead(allowed ? 200 : 404, {'Content-Type':'application/json; charset=utf-8'});
      res.end(req.method==='HEAD' ? '' : JSON.stringify(allowed ? referenceCatalog : {error:'Not found.'}));
      return;
    }

    if(pathname==='/api/homepage/rfqs'){
      const allowedHost=!SITE_HOST||host===SITE_HOST||host==='www.'+SITE_HOST||onTerminal;
      res.writeHead(onAdmin||!allowedHost?404:200,{'Content-Type':'application/json; charset=utf-8'});
      res.end(req.method==='HEAD'?'':JSON.stringify(onAdmin||!allowedHost?{error:'Not found.'}:{rfqs:listCuratedRfqs()}));
      return;
    }

    // Demo workspaces have a separate cookie and API namespace. They never use
    // the production auth, billing, marketplace or operations service instances.
    if (pathname.startsWith('/api/demo/')) {
      const publicShowcase = pathname === '/api/demo/showcase' && req.method === 'GET' && (!SITE_HOST || host === SITE_HOST || host === 'www.' + SITE_HOST || onTerminal);
      if (onAdmin || (TERMINAL_HOST && !onTerminal && !publicShowcase) || !demoEnabled) {
        res.writeHead(404, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({error:'Demo is unavailable on this host.'}));
        return;
      }
      try {
        if (await demo.handle(req, res, new URL(req.url, 'http://localhost'))) return;
      } catch {
        if (!res.headersSent) res.writeHead(503, {'Content-Type':'application/json; charset=utf-8'});
        res.end(JSON.stringify({error:'The demo workspace is temporarily unavailable.'}));
        return;
      }
      res.writeHead(404, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({error:'Demo endpoint not found.'}));
      return;
    }
    if (pathname === '/demo' || pathname === '/demo/') {
      if (!['GET','HEAD'].includes(req.method) || !demoEnabled || onAdmin) {
        res.writeHead(404); res.end('Not found'); return;
      }
      if (TERMINAL_HOST && !onTerminal) {
        res.writeHead(308, {Location:'https://' + TERMINAL_HOST + '/demo/'});
        res.end(); return;
      }
      const html = fs.readFileSync(path.join(__dirname, 'OpenNEXT-preview-entry.html'), 'utf8')
        .replace(/(src|href)="\.\//g, '$1="/')
        .replace('<head>', '<head><script src="/OpenNEXT-demo.js"></script>')
        .replace('</head>', '<link rel="stylesheet" href="/OpenNEXT-demo.css"></head>');
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','X-Robots-Tag':'noindex, nofollow'});
      res.end(req.method === 'HEAD' ? undefined : html);
      return;
    }

    if (await pricingRoute(req, res, new URL(req.url, 'http://localhost'), {onTerminal:restrictAdmin})) return;
    if (await contactRoute(req, res, new URL(req.url, 'http://localhost'), {onTerminal:restrictAdmin})) return;
    // OAuth redirect URIs are registered for TERMINAL_HOST only, so sign-in starts there.
    if (TERMINAL_HOST && !onTerminal && /^\/api\/auth\/oauth\/(?:google|github)\/start$/.test(pathname)) {
      res.writeHead(302, {Location: 'https://' + TERMINAL_HOST + pathname});
      res.end(); return;
    }
    if (await auth.handle(req, res, new URL(req.url, 'http://localhost'))) return;
    if (await marketplaceRoute(req, res, new URL(req.url, 'http://localhost'), {onTerminal:restrictAdmin})) return;
    if (await paymentRoute(req, res, new URL(req.url, 'http://localhost'))) return;
    
    if (ADMIN_HOST && SITE_HOST) {
      if (!onAdmin && !onTerminal && (pathname === '/admin' || pathname === '/admin/')) {
        res.writeHead(308, {Location: 'https://' + ADMIN_HOST + '/'});
        res.end();
        return;
      }
      if (onAdmin && (pathname === '/admin' || pathname === '/admin/')) {
        res.writeHead(308, {Location: '/'});
        res.end();
        return;
      }
    }
    
    if (TERMINAL_HOST && SITE_HOST) {
      if (!onTerminal && pathname === '/terminal') {
        res.writeHead(308, {Location: 'https://' + TERMINAL_HOST + '/'});
        res.end();
        return;
      }
      if (onTerminal && (pathname === '/terminal' || pathname === '/terminal/')) {
        res.writeHead(308, {Location: '/'});
        res.end();
        return;
      }
    }
    if (pathname === '/admin' || pathname === '/terminal/') {
      res.writeHead(308, {Location: pathname === '/admin' ? '/admin/' : '/terminal'});
      res.end();
      return;
    }
    if (!onAdmin && (pathname === '/api/market' || pathname === '/api/news')) {
      try {
        const data = await (pathname === '/api/market' ? getMarket() : news.getNews());
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data));
      } catch {
        res.writeHead(503, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify({error: 'Feed unavailable'}));
      }
      return;
    }
    const aliases = {
      '/': onAdmin ? 'admin/index.html' : onTerminal ? 'OpenNEXT-preview-entry.html' : 'index.html',
      '/terminal': 'OpenNEXT-preview-entry.html',
      '/admin/': 'admin/index.html',
    };
    const name = aliases[pathname] || pathname.slice(1);
    if (!files.has(name) || (restrictAdmin && adminFile(name)) || (onAdmin && !adminFile(name))) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const file = path.join(__dirname, name);
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {'Content-Type': types[path.extname(name)] || 'application/octet-stream'});
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
  server.pricing = pricing;
  server.capacity = capacity;
  server.contacts = contacts;
  server.auth = auth;
  server.marketplace = marketplace;
  server.news = news;
  server.on('close', () => {Promise.resolve(news.close?.()).catch(() => {});});
  server.on('close', () => {pricing.close().catch(() => {}); capacity.close().catch(() => {}); auth.close?.(); demo.close().catch(() => {});});
  return server;
}

if (require.main === module) {
  // Local development reads secrets from .env; production injects them via docker-compose.
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);
  const port = Number(process.env.PORT || 4188);
  const host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535');
  }
  const server = createAppServer();
  server.on('error', error => {console.error(error.message); process.exitCode = 1;});
  server.listen(port, host, () => {
    const actualPort = server.address().port;
    console.log('OpenNEXT website: http://' + host + ':' + actualPort + '/');
    console.log('Operations Console: http://' + host + ':' + actualPort + '/admin/');
    server.pricing.startScheduler();
    server.capacity.start();
    server.news.start().catch(error => console.error('News refresh: ' + error.message));
  });
}

module.exports = {createAppServer};
