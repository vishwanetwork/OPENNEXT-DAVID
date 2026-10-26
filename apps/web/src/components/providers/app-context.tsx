'use client';

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { appHref, appOrigins, type AppKind, type AppOrigins, type HostConfig } from '@/lib/apps';

export interface AppContextValue {
  app: AppKind;
  /** Link prefix inside this application ('' on a dedicated host). */
  base: string;
  demo: boolean;
  origins: AppOrigins;
  /** In-app href helper. */
  href: (path: string) => string;
  /** Cross-app href helper (absolute on production hosts, path-based elsewhere). */
  crossHref: (app: AppKind, path?: string) => string;
}

const AppContext = createContext<AppContextValue | null>(null);

const subscribeNever = () => () => {};

/**
 * The host the page is viewed on. Server renders use `requestHost` (null for the statically
 * rendered public site); the client always knows `location.hostname`, so a static page served
 * on an unconfigured host switches its cross-app links to path mode right after hydration.
 */
function useCurrentHost(requestHost: string | null): string | null {
  return useSyncExternalStore(
    subscribeNever,
    () => window.location.host,
    () => requestHost,
  );
}

export function AppProvider({
  app,
  base,
  demo,
  hosts,
  requestHost = null,
  children,
}: {
  app: AppKind;
  base: string;
  demo: boolean;
  /** Configured application hosts (SITE_HOST / TERMINAL_HOST / ADMIN_HOST). */
  hosts: HostConfig;
  requestHost?: string | null;
  children: ReactNode;
}) {
  const currentHost = useCurrentHost(requestHost);
  const value = useMemo<AppContextValue>(() => {
    const origins = appOrigins(hosts, currentHost);
    return {
      app,
      base,
      demo,
      origins,
      href: (path) => appHref(base, path),
      crossHref: (target, path = '/') => {
        const origin = origins[target];
        const clean = path.startsWith('/') ? path : '/' + path;
        if (origin.startsWith('http')) return origin + (clean === '/' ? '/' : clean);
        return appHref(origin, clean);
      },
    };
  }, [app, base, demo, hosts, currentHost]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>.');
  return value;
}
