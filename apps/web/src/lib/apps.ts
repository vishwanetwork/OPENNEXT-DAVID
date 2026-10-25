/**
 * Host and path resolution for the three OpenNEXT front-ends.
 *
 * Production binds one hostname per application:
 *   SITE_HOST      opennextlab.ai            -> (site)    routes under src/app/(site)
 *   TERMINAL_HOST  terminal.opennextlab.ai   -> terminal  routes under src/app/terminal
 *   ADMIN_HOST     admin.opennextlab.ai      -> admin     routes under src/app/admin
 *
 * Locally (no *_HOST configured) the same applications are reachable by path:
 *   /            site
 *   /terminal/*  terminal   (/terminal/demo/* = isolated demo workspace)
 *   /admin/*     admin
 *
 * `resolveRequest` is a pure function so it can be unit-tested and reused by the
 * proxy (edge) and by server components. It never touches `process.env`.
 */

export type AppKind = 'site' | 'terminal' | 'admin';

/** Request headers the proxy sets so layouts know which application they render. */
export const APP_HEADERS = {
  app: 'x-on-app',
  base: 'x-on-base',
  demo: 'x-on-demo',
  host: 'x-on-host',
} as const;

export interface HostConfig {
  site?: string;
  terminal?: string;
  admin?: string;
}

export interface AppLocation {
  /** Which front-end is being served. */
  app: AppKind;
  /** Path prefix to prepend to in-app links ('' on a dedicated host). */
  base: string;
  /** Internal Next.js path the request is rewritten to. */
  internalPath: string;
  /** True when the terminal is running as the isolated demo workspace. */
  demo: boolean;
}

export type Resolution =
  | ({ kind: 'serve' } & AppLocation)
  | { kind: 'redirect'; location: string; permanent: boolean }
  | { kind: 'not-found' };

export const APP_SEGMENT: Record<AppKind, string> = {
  site: '',
  terminal: '/terminal',
  admin: '/admin',
};

export function normalizeHost(raw: string | null | undefined): string {
  const [first = ''] = String(raw || '').split(',');
  const [host = ''] = first.split(':');
  return host.trim().toLowerCase();
}

export function normalizeHosts(env: Record<string, string | undefined>): HostConfig {
  const pick = (key: string) => {
    const value = normalizeHost(env[key]);
    return value || undefined;
  };
  return { site: pick('SITE_HOST'), terminal: pick('TERMINAL_HOST'), admin: pick('ADMIN_HOST') };
}

const stripTrailing = (pathname: string) =>
  pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

function serve(app: AppKind, base: string, rest: string, demo = false): Resolution {
  const path = rest === '' || rest === '/' ? '' : stripTrailing(rest);
  return { kind: 'serve', app, base, internalPath: APP_SEGMENT[app] + path || '/', demo };
}

function matchPrefix(pathname: string, prefix: string): string | null {
  if (pathname === prefix) return '/';
  if (pathname.startsWith(prefix + '/')) return pathname.slice(prefix.length);
  return null;
}

export function resolveRequest(
  hostHeader: string,
  pathname: string,
  hosts: HostConfig,
): Resolution {
  const host = normalizeHost(hostHeader);
  const onAdmin = Boolean(hosts.admin) && host === hosts.admin;
  const onTerminal = Boolean(hosts.terminal) && host === hosts.terminal;
  const split = Boolean(hosts.site && (hosts.terminal || hosts.admin));

  if (onAdmin) {
    // The console host serves only the console. Legacy `/admin/` links land on `/`.
    const legacy = matchPrefix(pathname, '/admin');
    if (legacy !== null) return { kind: 'redirect', location: legacy, permanent: true };
    if (matchPrefix(pathname, '/terminal') !== null || matchPrefix(pathname, '/demo') !== null)
      return { kind: 'not-found' };
    return serve('admin', '', pathname);
  }

  if (onTerminal) {
    if (matchPrefix(pathname, '/admin') !== null) return { kind: 'not-found' };
    const legacy = matchPrefix(pathname, '/terminal');
    if (legacy !== null) return { kind: 'redirect', location: legacy, permanent: true };
    const demo = matchPrefix(pathname, '/demo');
    if (demo !== null) return serve('terminal', '/demo', demo, true);
    return serve('terminal', '', pathname);
  }

  // Public site host, or an unconfigured (local) deployment that serves everything by path.
  const admin = matchPrefix(pathname, '/admin');
  if (admin !== null) {
    if (split && hosts.admin)
      return { kind: 'redirect', location: `https://${hosts.admin}${admin}`, permanent: true };
    if (split) return { kind: 'not-found' };
    return serve('admin', '/admin', admin);
  }
  const terminal = matchPrefix(pathname, '/terminal');
  if (terminal !== null) {
    if (split && hosts.terminal)
      return {
        kind: 'redirect',
        location: `https://${hosts.terminal}${terminal}`,
        permanent: true,
      };
    if (split) return { kind: 'not-found' };
    const demo = matchPrefix(terminal, '/demo');
    if (demo !== null) return serve('terminal', '/terminal/demo', demo, true);
    return serve('terminal', '/terminal', terminal);
  }
  const demo = matchPrefix(pathname, '/demo');
  if (demo !== null) {
    if (split && hosts.terminal)
      return {
        kind: 'redirect',
        location: `https://${hosts.terminal}/demo${demo === '/' ? '/' : demo}`,
        permanent: true,
      };
    if (split) return { kind: 'not-found' };
    return serve('terminal', '/demo', demo, true);
  }
  return serve('site', '', pathname);
}

/** Origins used for cross-application links (site -> terminal, terminal -> console …). */
export interface AppOrigins {
  site: string;
  terminal: string;
  admin: string;
}

export function appOrigins(hosts: HostConfig): AppOrigins {
  const split = Boolean(hosts.site && (hosts.terminal || hosts.admin));
  if (!split) return { site: '', terminal: '/terminal', admin: '/admin' };
  return {
    site: `https://${hosts.site}`,
    terminal: hosts.terminal ? `https://${hosts.terminal}` : '/terminal',
    admin: hosts.admin ? `https://${hosts.admin}` : '/admin',
  };
}

/** Build an href inside the current application. */
export function appHref(base: string, path: string): string {
  const clean = path.startsWith('/') ? path : '/' + path;
  if (clean === '/') return base || '/';
  return base + clean;
}
