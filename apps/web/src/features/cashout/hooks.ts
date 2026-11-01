'use client';

import { useQuery } from '@tanstack/react-query';
import { useSessionStore } from '@/lib/session-store';
import { queryKeys } from '@/lib/api/query-keys';
import { useAccountIdentity, useIsDemo, useTerminalSlots } from '@/terminal-kit';
import { cashoutApi } from './api';

export function useCashout() {
  const user = useSessionStore((state) => state.user);
  const status = useSessionStore((state) => state.status);
  const identity = useAccountIdentity();
  const demo = useIsDemo();
  const service = useTerminalSlots().services.cashout;
  const accountId = user?.id ?? '';
  const connected = Boolean(
    service && identity && status === 'verified' && user?.role === 'buyer' && !demo,
  );
  const query = useQuery({
    queryKey: queryKeys.account.cashout(identity),
    queryFn: ({ signal }) => {
      if (!service || !connected) throw new Error('Cashout is not connected yet.');
      return cashoutApi.load(service, accountId, signal);
    },
    enabled: connected,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  return {
    query,
    identity,
    accountId,
    service,
    connected,
    snapshot: connected && query.isSuccess && !query.isError ? query.data : undefined,
  };
}
