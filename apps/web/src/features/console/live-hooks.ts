'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/components/providers/api-context';
import { isAccessError } from './components/admin-access';
import { liveApi, type LiveResource } from './live-api';

export function useConsoleResource<K extends LiveResource>(
  resource: K,
  params: Record<string, string> = {},
) {
  const api = useApi();
  const client = useQueryClient();
  const session = useQuery({
    queryKey: ['admin', 'operations-session'],
    queryFn: ({ signal }) => liveApi.session(api, signal),
    retry: false,
    gcTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const scope = session.error ? undefined : session.data?.sessionScope;
  const query = useQuery({
    queryKey: ['admin', 'live', scope, resource, params],
    queryFn: ({ signal }) => liveApi.read(api, resource, params, signal),
    enabled: !!scope,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === scope ? previous : undefined,
    retry: false,
    gcTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (isAccessError(query.error))
      void client.invalidateQueries({ queryKey: ['admin', 'operations-session'] });
  }, [query.error, client]);
  const error = session.error || query.error;
  return {
    ...query,
    data: scope && !isAccessError(error) ? query.data : undefined,
    error,
    denied: isAccessError(error),
    loading: session.isPending || (!!scope && query.isPending),
    refresh: async () => {
      await session.refetch();
      if (scope) await query.refetch();
    },
  };
}
