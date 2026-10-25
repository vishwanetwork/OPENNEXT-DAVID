import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

/**
 * Transparent pass-through for every `/api/*` request to the backend (`API_ORIGIN`).
 *
 * Unlike `next.config` rewrites, this keeps the request exactly as the browser sent it:
 * the original `Host` (the backend's same-origin checks compare it with `Origin`), cookies,
 * CSRF headers, and whatever `X-Forwarded-*` headers the outer reverse proxy added. No
 * forwarded headers are invented, so in local development the backend still sees a direct
 * localhost client, and in production it trusts only the HTTPS reverse proxy in front of Next.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const API_ORIGIN = new URL((process.env.API_ORIGIN || 'http://127.0.0.1:4189').replace(/\/$/, ''));
const TRUST_PROXY = process.env.OPENNEXT_TRUST_PROXY === '1';
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-connection',
]);

async function forward(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key)) headers[key] = value;
  });
  // Next synthesises x-forwarded-* headers for every request. They are only meaningful when a
  // trusted reverse proxy sits in front of Next (production: OPENNEXT_TRUST_PROXY=1). Otherwise
  // they are dropped so the backend sees a direct client — its "localhost administrator" rule and
  // same-origin checks depend on that in local development.
  if (!TRUST_PROXY) {
    for (const key of Object.keys(headers))
      if (key.startsWith('x-forwarded-') || key === 'forwarded') delete headers[key];
  }
  // Keep the client-facing host so the backend can scope routes per host and verify origins.
  headers.host = headers['x-forwarded-host'] || request.headers.get('host') || url.host;

  const transport = API_ORIGIN.protocol === 'https:' ? https : http;
  const hasBody = !['GET', 'HEAD'].includes(request.method) && request.body;

  return new Promise<Response>((resolve) => {
    const upstream = transport.request(
      {
        protocol: API_ORIGIN.protocol,
        hostname: API_ORIGIN.hostname,
        port: API_ORIGIN.port || (API_ORIGIN.protocol === 'https:' ? 443 : 80),
        method: request.method,
        path: url.pathname + url.search,
        headers,
      },
      (response) => {
        const out = new Headers();
        for (let i = 0; i < response.rawHeaders.length; i += 2) {
          const key = response.rawHeaders[i].toLowerCase();
          if (!HOP_BY_HOP.has(key)) out.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
        }
        const status = response.statusCode || 502;
        const empty = request.method === 'HEAD' || status === 204 || status === 304;
        const body = empty ? null : (Readable.toWeb(response) as unknown as ReadableStream);
        resolve(new Response(body, { status, headers: out }));
      },
    );
    upstream.on('error', (error) => {
      resolve(
        new Response(
          JSON.stringify({
            error: 'The OpenNEXT service is temporarily unavailable.',
            detail: error.message,
          }),
          {
            status: 502,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          },
        ),
      );
    });
    request.signal.addEventListener('abort', () => upstream.destroy());
    if (hasBody) Readable.fromWeb(request.body as unknown as NodeReadableStream).pipe(upstream);
    else upstream.end();
  });
}

export const GET = forward;
export const HEAD = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
export const OPTIONS = forward;
