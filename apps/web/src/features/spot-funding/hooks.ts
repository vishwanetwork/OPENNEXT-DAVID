'use client';

import { queryOptions, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/api/query-keys';
import { useSessionStore } from '@/lib/session-store';
import type { SpotFundingLookup } from '@/lib/spot-funding';
import { accountIdentity, useAccountIdentity, useIsDemo, useTerminalSlots } from '@/terminal-kit';
import { spotFundingApi } from './api';

function useFundingScope() {
  const user = useSessionStore((state) => state.user);
  const verified = useSessionStore((state) => state.status === 'verified');
  const identity = useAccountIdentity();
  const demo = useIsDemo();
  const service = useTerminalSlots().services.spotFunding;
  const scope = service?.scope ?? '';
  const accountId = user?.id ?? '';
  const connected = Boolean(
    verified && identity && accountId && user?.role === 'buyer' && !demo && scope.trim() && service,
  );
  const stillAuthorized = () => {
    const current = useSessionStore.getState();
    return (
      current.status === 'verified' &&
      current.user?.role === 'buyer' &&
      !current.user.demo &&
      accountIdentity(current.user, false) === identity
    );
  };
  return { identity, accountId, demo, service, scope, connected, stillAuthorized };
}

const refresh = {
  retry: false,
  staleTime: 30_000,
  gcTime: 0,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
} as const;

export function useSpotFundingAccount() {
  const client = useQueryClient();
  const { identity, accountId, demo, service, scope, connected, stillAuthorized } =
    useFundingScope();
  const queryKey = queryKeys.account.spotFunding(connected ? identity : '', scope);
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      try {
        if (!connected || !service || !stillAuthorized())
          throw new Error('Spot funding is not connected.');
        const snapshot = await spotFundingApi.account(service, accountId, demo, signal);
        signal.throwIfAborted();
        if (!stillAuthorized()) throw new Error('The account authorization changed.');
        return snapshot;
      } catch (error) {
        if (!signal.aborted) client.setQueryData(queryKey, null);
        throw error;
      }
    },
    enabled: connected,
    ...refresh,
  });
  return { snapshot: connected && !query.isError ? (query.data ?? null) : null, query, connected };
}

function orderOptions(
  client: QueryClient,
  context: ReturnType<typeof useFundingScope>,
  lookup: SpotFundingLookup,
  cursor = '',
) {
  const { identity, accountId, demo, service, scope, stillAuthorized } = context;
  const id = 'orderId' in lookup ? lookup.orderId : lookup.instanceId;
  const lookupKey = 'orderId' in lookup ? `order:${id}` : `instance:${id}`;
  const connected = context.connected && Boolean(id.trim()) && cursor.length <= 2048;
  const queryKey = queryKeys.account.spotFundingOrder(
    connected ? identity : '',
    scope,
    lookupKey,
    cursor,
  );
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }) => {
      try {
        if (!connected || !service || !stillAuthorized())
          throw new Error('Spot order funding is not connected.');
        const snapshot = await spotFundingApi.order(
          service,
          accountId,
          demo,
          lookup,
          cursor,
          signal,
        );
        signal.throwIfAborted();
        if (!stillAuthorized()) throw new Error('The account authorization changed.');
        return snapshot;
      } catch (error) {
        if (!signal.aborted) client.setQueryData(queryKey, null);
        throw error;
      }
    },
    enabled: connected,
    ...refresh,
  });
}

export function useSpotFundingOrder(lookup: SpotFundingLookup, cursor = '') {
  const client = useQueryClient();
  const context = useFundingScope();
  const options = orderOptions(client, context, lookup, cursor);
  const query = useQuery(options);
  const connected = options.enabled === true;
  return { snapshot: connected && !query.isError ? (query.data ?? null) : null, query, connected };
}

/** Instance grouping must not depend on a possibly paginated account order summary. */
export function useSpotFundingInstances(instanceIds: string[]) {
  const client = useQueryClient();
  const context = useFundingScope();
  const ids = [...new Set(instanceIds.filter((id) => id.trim()))];
  const queries = useQueries({
    queries: ids.map((instanceId) => orderOptions(client, context, { instanceId })),
  });
  const orders = context.connected
    ? queries.flatMap((query) => (!query.isError && query.data ? [query.data.order] : []))
    : [];
  return { orders, connected: context.connected };
}
