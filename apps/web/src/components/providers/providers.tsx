'use client';

import type { ReactNode } from 'react';
import type { AppKind, AppOrigins } from '@/lib/apps';
import { AppProvider } from './app-context';
import { ApiProvider } from './api-context';
import { ToastProvider } from '@/components/ui/toast';

export function Providers({
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
  return (
    <AppProvider app={app} base={base} demo={demo} origins={origins}>
      <ApiProvider demo={demo}>
        <ToastProvider>{children}</ToastProvider>
      </ApiProvider>
    </AppProvider>
  );
}
