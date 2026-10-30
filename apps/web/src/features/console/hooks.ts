'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useApi } from '@/components/providers/api-context';
import { queryKeys } from '@/lib/api/query-keys';
import type { ApiClient } from '@/lib/api/client';
import { adminApi } from './api';
import { isAccessError } from './components/admin-access';

function useOperationsQuery<T>(
  resource: string,
  read: (api: ApiClient, signal?: AbortSignal) => Promise<T>,
) {
  const api = useApi();
  const query = useQuery({
    queryKey: queryKeys.admin.overview(resource),
    queryFn: ({ signal }) => read(api, signal),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return { ...query, data: isAccessError(query.error) ? undefined : query.data };
}

export function useOperationsOverview() {
  const marketplace = useOperationsQuery('marketplace', adminApi.marketplace);
  const providers = useOperationsQuery('providers', adminApi.providers);
  const prices = useOperationsQuery('prices', adminApi.prices);
  const topups = useOperationsQuery('topups', adminApi.topups);
  const contacts = useOperationsQuery('contacts', adminApi.contacts);
  const publicMarket = useOperationsQuery('public-market', adminApi.publicMarket);
  return { marketplace, providers, prices, topups, contacts, publicMarket };
}

/** One page of purchased allocations; `cursor` is the backend's opaque page token. */
export function useOperationsAllocations(status: string, cursor: string) {
  const params: Record<string, string> = { limit: '50' };
  if (status) params.status = status;
  if (cursor) params.cursor = cursor;
  return useOperationsQuery('allocations:' + new URLSearchParams(params), (api, signal) =>
    adminApi.instances(api, signal, params),
  );
}

export function useOperationsInventory(filters: Record<string, string>) {
  const prices = useOperationsQuery('inventory:' + new URLSearchParams(filters), (api, signal) =>
    adminApi.prices(api, signal, filters),
  );
  const publicMarket = useOperationsQuery('public-market', adminApi.publicMarket);
  return { prices, publicMarket };
}
