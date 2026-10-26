'use client';

import type { ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { AppKind, HostConfig } from '@/lib/apps';
import { AppProvider } from './app-context';
import { ApiProvider } from './api-context';
import { ToastProvider } from '@/components/ui/toast';

export function Providers({
  app,
  base,
  demo,
  hosts,
  requestHost,
  queryClient,
  children,
}: {
  app: AppKind;
  base: string;
  demo: boolean;
  hosts: HostConfig;
  requestHost?: string | null;
  queryClient?: QueryClient;
  children: ReactNode;
}) {
  return (
    <AppProvider app={app} base={base} demo={demo} hosts={hosts} requestHost={requestHost}>
      <ApiProvider demo={demo} queryClient={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </ApiProvider>
    </AppProvider>
  );
}
