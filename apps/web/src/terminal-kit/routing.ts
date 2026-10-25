/** Terminal routes and the navigation rules of the legacy `go()` / `routeTarget()`. */
import type { Role } from './types';

export const TERMINAL_ROUTES = [
  'market',
  'insight',
  'models',
  'rfqs',
  'supply',
  'instances',
  'billing',
  'saved',
  'cart',
  'profile',
  'settings',
  'help',
  'mandates',
  'notifications',
] as const;
export type TerminalRoute = (typeof TERMINAL_ROUTES)[number];

export const routeTarget = (route: string | null | undefined): TerminalRoute =>
  route === 'credentials'
    ? 'instances'
    : (TERMINAL_ROUTES as readonly string[]).includes(route || '')
      ? (route as TerminalRoute)
      : 'market';

/** Role hints only preselect onboarding. Completed accounts retain their verified role. */
export function resolveTarget(
  route: string | null | undefined,
  role: Role,
  onboardingCompleted: boolean,
): TerminalRoute {
  let target = routeTarget(route);
  if (
    onboardingCompleted &&
    ((role === 'buyer' && target === 'supply') ||
      (role === 'seller' && ['rfqs', 'mandates'].includes(target)))
  )
    target = 'market';
  return target;
}

/** Default landing route on the terminal host when none is requested. */
export const defaultRoute = (role: Role): TerminalRoute => (role === 'seller' ? 'supply' : 'market');

/** Maps a legacy `#terminal/<route>` (or `#`) hash to a path. Returns null when the hash is not a terminal hash. */
export function legacyHashToPath(hash: string): string | null {
  if (!hash || hash === '#') return null;
  const match = /^#terminal(?:\/([a-z-]*))?/.exec(hash);
  if (!match) return null;
  return '/' + routeTarget(match[1] || 'market');
}

/** Pathname → route, given the application link base (e.g. '/terminal' locally, '' on the terminal host). */
export function routeFromPath(pathname: string, base: string): TerminalRoute | '' {
  const rest = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const segment = rest.replace(/^\/+/, '').split('/')[0];
  if (!segment) return '';
  return routeTarget(segment);
}

/** Public-site CTA target (`data-target`) → terminal route, mirroring `openPublicWorkspace()`. */
export const publicTargetRoute = (target: string | null | undefined): TerminalRoute =>
  target === 'models'
    ? 'models'
    : target === 'supply'
      ? 'supply'
      : target === 'rfq'
        ? 'rfqs'
        : 'market';
