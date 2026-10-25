// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DELETE, GET, HEAD, POST } from './route';

/**
 * The pass-through must forward requests byte-for-byte as the browser sent them (Host, cookies,
 * CSRF headers, body) and apply the forwarded-header policy from `lib/env.ts`.
 */
interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let server: http.Server;
let seen: Seen[] = [];
let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void = (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'sid=1; HttpOnly' });
  res.end('{"ok":true}');
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen.push({ method: req.method || '', url: req.url || '', headers: req.headers, body });
      respond(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.API_ORIGIN = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  delete process.env.API_ORIGIN;
});

afterEach(() => {
  seen = [];
  delete process.env.OPENNEXT_TRUST_PROXY;
});

const browserRequest = (init: RequestInit = {}, path = '/api/marketplace/me?x=1') =>
  new Request(`http://terminal.localhost:4188${path}`, {
    ...init,
    headers: {
      host: 'terminal.localhost:4188',
      origin: 'http://terminal.localhost:4188',
      cookie: 'session=abc',
      'x-csrf-token': 'tok',
      'x-forwarded-for': '203.0.113.9',
      'x-forwarded-proto': 'https',
      ...(init.headers as Record<string, string>),
    },
  });

describe('/api/[...path] pass-through', () => {
  it('keeps the browser Host, cookies, CSRF header, path and query', async () => {
    const response = await GET(browserRequest());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe('GET');
    expect(seen[0]?.url).toBe('/api/marketplace/me?x=1');
    expect(seen[0]?.headers.host).toBe('terminal.localhost:4188');
    expect(seen[0]?.headers.origin).toBe('http://terminal.localhost:4188');
    expect(seen[0]?.headers.cookie).toBe('session=abc');
    expect(seen[0]?.headers['x-csrf-token']).toBe('tok');
  });

  it('drops forwarded headers unless OPENNEXT_TRUST_PROXY=1', async () => {
    await GET(browserRequest());
    expect(seen[0]?.headers['x-forwarded-for']).toBeUndefined();
    expect(seen[0]?.headers['x-forwarded-proto']).toBeUndefined();

    process.env.OPENNEXT_TRUST_PROXY = '1';
    await GET(browserRequest());
    expect(seen[1]?.headers['x-forwarded-for']).toBe('203.0.113.9');
    expect(seen[1]?.headers['x-forwarded-proto']).toBe('https');
  });

  it('streams request bodies and relays Set-Cookie from the backend', async () => {
    const response = await POST(
      browserRequest({
        method: 'POST',
        body: JSON.stringify({ token: 't' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.body).toBe('{"token":"t"}');
    expect(seen[0]?.headers['content-type']).toBe('application/json');
    expect(response.headers.get('set-cookie')).toBe('sid=1; HttpOnly');
  });

  it('returns empty bodies for HEAD and 204 and strips hop-by-hop headers', async () => {
    const original = respond;
    respond = (_req, res) => {
      res.writeHead(204, { Connection: 'close', 'X-Backend': 'legacy' });
      res.end();
    };
    try {
      const head = await HEAD(browserRequest({ method: 'HEAD' }));
      expect(head.status).toBe(204);
      expect(head.body).toBeNull();
      const del = await DELETE(browserRequest({ method: 'DELETE' }));
      expect(del.status).toBe(204);
      expect(del.headers.get('x-backend')).toBe('legacy');
      expect(del.headers.get('connection')).toBeNull();
    } finally {
      respond = original;
    }
  });

  it('answers 502 JSON when the backend is unreachable', async () => {
    const saved = process.env.API_ORIGIN;
    process.env.API_ORIGIN = 'http://127.0.0.1:1';
    try {
      const response = await GET(browserRequest());
      expect(response.status).toBe(502);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = (await response.json()) as { error: string; detail: string };
      expect(body.error).toMatch(/temporarily unavailable/);
      expect(body.detail).toBeTruthy();
    } finally {
      process.env.API_ORIGIN = saved;
    }
  });
});
