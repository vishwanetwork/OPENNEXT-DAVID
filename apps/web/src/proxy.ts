import { NextResponse, type NextRequest } from 'next/server';
import { normalizeHosts, resolveRequest } from '@/lib/apps';

export const APP_HEADERS = {
  app: 'x-on-app',
  base: 'x-on-base',
  demo: 'x-on-demo',
  host: 'x-on-host',
} as const;

/**
 * Maps the incoming host + path to one of the three applications (see src/lib/apps.ts),
 * rewrites to the internal route tree and tags the request so layouts know which
 * application and link base they are rendering for.
 */
export function proxy(request: NextRequest) {
  const hosts = normalizeHosts(process.env);
  const trustProxy = process.env.OPENNEXT_TRUST_PROXY === '1';
  const host =
    (trustProxy && request.headers.get('x-forwarded-host')) || request.headers.get('host') || '';
  const { pathname, search } = request.nextUrl;
  const result = resolveRequest(host, pathname, hosts);

  if (result.kind === 'not-found') {
    return new NextResponse('Not found', { status: 404 });
  }
  if (result.kind === 'redirect') {
    const location = result.location.startsWith('http')
      ? result.location + search
      : new URL(result.location + search, request.nextUrl);
    return NextResponse.redirect(location, result.permanent ? 308 : 307);
  }

  const headers = new Headers(request.headers);
  headers.set(APP_HEADERS.app, result.app);
  headers.set(APP_HEADERS.base, result.base);
  headers.set(APP_HEADERS.demo, result.demo ? '1' : '0');
  headers.set(APP_HEADERS.host, host);

  if (result.internalPath === pathname) {
    return NextResponse.next({ request: { headers } });
  }
  // Built on request.nextUrl so the router sees an internal (same-origin) rewrite. Note that
  // NextURL normalises loopback IPs to `localhost`, so bind the server to `localhost` or
  // `0.0.0.0` (never `127.0.0.1`) or the rewrite is treated as external.
  return NextResponse.rewrite(new URL(result.internalPath + search, request.nextUrl), {
    request: { headers },
  });
}

export const config = {
  // Everything except the API proxy, Next internals and static files.
  matcher: [
    '/((?!api/|_next/|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|html|txt|woff2?)$).*)',
  ],
};
