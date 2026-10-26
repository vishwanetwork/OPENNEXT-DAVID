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
 * A request whose host is not one of the configured hosts (e.g. the production image opened
 * at http://127.0.0.1:4188) is served in path mode as well, so links stay on that host instead
 * of jumping to production. The console keeps its isolation: with ADMIN_HOST configured,
 * `/admin` on an unknown host is only served to loopback hosts, otherwise it is a 404.
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
  const value = first.trim().toLowerCase();
  // Bracketed IPv6 literal, optionally with a port: `[::1]:4188` -> `[::1]`.
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1) || value;
  const [host = ''] = value.split(':');
  return host;
}

export function normalizeHosts(env: Record<string, string | undefined>): HostConfig {
  const pick = (key: string) => {
    const value = normalizeHost(env[key]);
    return value || undefined;
  };
  return { site: pick('SITE_HOST'), terminal: pick('TERMINAL_HOST'), admin: pick('ADMIN_HOST') };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** `localhost`, `*.localhost`, `127.0.0.1` or `[::1]` (as returned by normalizeHost). */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host) || host.endsWith('.localhost');
}

/** True when the hosts split the apps across domains (production). */
export function isSplit(hosts: HostConfig): boolean {
  return Boolean(hosts.site && (hosts.terminal || hosts.admin));
}

/** True when `host` is one of the configured application hosts (apex, `www.` apex or app host). */
export function isConfiguredHost(host: string, hosts: HostConfig): boolean {
  if (!host) return false;
  return (
    host === hosts.site ||
    (Boolean(hosts.site) && host === `www.${hosts.site}`) ||
    host === hosts.terminal ||
    host === hosts.admin
  );
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
  const known = isConfiguredHost(host, hosts);
  // Cross-host redirects only apply on the configured public host; any other host uses paths.
  const split = known && isSplit(hosts);

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
    // Unknown host with a dedicated console host configured: loopback only.
    if (!known && hosts.admin && !isLoopbackHost(host)) return { kind: 'not-found' };
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

const PATH_ORIGINS: AppOrigins = { site: '', terminal: '/terminal', admin: '/admin' };

/**
 * Cross-app origins. Absolute production URLs only when the apps are split across hosts and
 * the current host (when known) is one of them; otherwise path-based, staying on this host.
 */
export function appOrigins(hosts: HostConfig, currentHost?: string | null): AppOrigins {
  if (!isSplit(hosts)) return PATH_ORIGINS;
  if (currentHost && !isConfiguredHost(normalizeHost(currentHost), hosts)) return PATH_ORIGINS;
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
