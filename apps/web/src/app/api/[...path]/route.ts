import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { HOP_BY_HOP, backendHeaders, serverEnv } from '@/lib/env';

/**
 * Transparent pass-through for every `/api/*` request to the backend (`API_ORIGIN`).
 *
 * Unlike `next.config` rewrites, this keeps the request as the browser sent it: the original
 * `Host` (the backend's same-origin checks compare it with `Origin`), cookies and CSRF headers.
 * Forwarded headers follow `OPENNEXT_TRUST_PROXY` (see `backendHeaders`).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function forward(request: Request): Promise<Response> {
  const { apiOrigin, trustProxy } = serverEnv();
  const target = new URL(apiOrigin);
  const url = new URL(request.url);
  const headers = backendHeaders(request.headers, trustProxy, url.host);
  const transport = target.protocol === 'https:' ? https : http;
  const hasBody = !['GET', 'HEAD'].includes(request.method) && request.body;

  return new Promise<Response>((resolve) => {
    const upstream = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        method: request.method,
        path: url.pathname + url.search,
        headers,
      },
      (response) => {
        const out = new Headers();
        for (let i = 0; i < response.rawHeaders.length; i += 2) {
          const name = response.rawHeaders[i] ?? '';
          if (!HOP_BY_HOP.has(name.toLowerCase()))
            out.append(name, response.rawHeaders[i + 1] ?? '');
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
