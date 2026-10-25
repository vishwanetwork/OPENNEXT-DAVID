import type { ReactNode } from 'react';
import type { AppKind } from '@/lib/apps';
import { requestApp, serverEnv } from '@/lib/request-app';
import { Providers } from '@/components/providers/providers';

/** Server wrapper used by each application layout: resolves host/base and mounts the client providers. */
export async function AppShell({ app, children }: { app: AppKind; children: ReactNode }) {
  const location = await requestApp(app);
  const { origins } = serverEnv();
  return (
    <Providers app={location.app} base={location.base} demo={location.demo} origins={origins}>
      {children}
    </Providers>
  );
}
