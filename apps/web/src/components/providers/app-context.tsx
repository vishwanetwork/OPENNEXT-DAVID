'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { appHref, type AppKind, type AppOrigins } from '@/lib/apps';

export interface AppContextValue {
  app: AppKind;
  /** Link prefix inside this application ('' on a dedicated host). */
  base: string;
  demo: boolean;
  origins: AppOrigins;
  /** In-app href helper. */
  href: (path: string) => string;
  /** Cross-app href helper (absolute on production hosts, path-based locally). */
  crossHref: (app: AppKind, path?: string) => string;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  app,
  base,
  demo,
  origins,
  children,
}: {
  app: AppKind;
  base: string;
  demo: boolean;
  origins: AppOrigins;
  children: ReactNode;
}) {
  const value = useMemo<AppContextValue>(
    () => ({
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
    }),
    [app, base, demo, origins],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>.');
  return value;
}
