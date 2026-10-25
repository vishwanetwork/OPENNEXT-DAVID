import type { ReactNode } from 'react';
import type { AppKind } from '@/lib/apps';
import { serverEnv } from '@/lib/env';
import { requestApp } from '@/lib/request-app';
import { Providers } from '@/components/providers/providers';

/** Server wrapper for the terminal and console layouts: resolves host/base from the proxy tags. */
export async function AppShell({ app, children }: { app: AppKind; children: ReactNode }) {
  const location = await requestApp(app);
  const { origins } = serverEnv();
  return (
    <Providers app={location.app} base={location.base} demo={location.demo} origins={origins}>
      {children}
    </Providers>
  );
}

/**
 * Header-free shell for the public site: it is only ever served at `/` of its own host, so no
 * request data is needed and the page can be rendered statically / revalidated.
 */
export function SiteShell({ children }: { children: ReactNode }) {
  const { origins } = serverEnv();
  return (
    <Providers app="site" base="" demo={false} origins={origins}>
      {children}
    </Providers>
  );
}
