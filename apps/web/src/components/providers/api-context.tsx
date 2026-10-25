'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient, type ApiClient } from '@/lib/api/client';
import { useSessionStore } from '@/lib/session-store';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ demo, children }: { demo: boolean; children: ReactNode }) {
  const client = useMemo(
    () =>
      createApiClient({
        demo,
        csrfToken: () => useSessionStore.getState().user?.csrfToken,
        onUnauthorized: () => useSessionStore.getState().markExpired(),
      }),
    [demo],
  );
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: true },
        },
      }),
    [],
  );
  return (
    <ApiContext.Provider value={client}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  );
}

export function useApi(): ApiClient {
  const value = useContext(ApiContext);
  if (!value) throw new Error('useApi must be used inside <ApiProvider>.');
  return value;
}
