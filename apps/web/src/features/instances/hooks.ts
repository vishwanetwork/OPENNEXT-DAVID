'use client';

import { useQuery } from '@tanstack/react-query';
import { useSessionStore } from '@/lib/session-store';
import { queryKeys } from '@/lib/api/query-keys';
import { useAccountIdentity, useIsDemo, useTerminalSlots } from '@/terminal-kit';
import { instanceUsageApi } from './usage-api';
import { confirmedUsage } from './usage';

export function useInstanceUsage(instanceId: string) {
  const accountId = useSessionStore((state) => state.user?.id ?? '');
  const verified = useSessionStore((state) => state.status === 'verified');
  const identity = useAccountIdentity();
  const demo = useIsDemo();
  const service = useTerminalSlots().services.instanceUsage;
  const connected = Boolean(verified && accountId && instanceId && service && !demo);
  const query = useQuery({
    queryKey: queryKeys.account.instanceUsage(identity, instanceId),
    queryFn: ({ signal }) => {
      if (!service || !connected) throw new Error('Instance usage history is not connected yet.');
      return instanceUsageApi.load(service, accountId, instanceId, demo, signal);
    },
    enabled: connected,
    gcTime: 0,
    retry: false,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const snapshot =
    connected && query.isSuccess && !query.isError
      ? confirmedUsage(query.data, accountId, instanceId, demo)
      : null;
  return { snapshot, query, connected };
}
