'use client';

import { useEffect, useId, useLayoutEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BuyerKybAdminService } from '@/lib/buyer-kyb';
import { isUnauthorized } from '@/lib/api/errors';
import { confirmedCases } from './review';

/** Private, short-lived cache: no record survives removal of this Console view. */
export function useBuyerKybQueue(service?: BuyerKybAdminService, blocked = false) {
  const client = useQueryClient();
  const scope = useId();
  const sessionScope = service?.sessionScope ?? 'unconfigured';
  const queryKey = useMemo(
    () => ['admin', 'buyer-kyb', sessionScope, scope] as const,
    [sessionScope, scope],
  );
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      if (!service) throw new Error('Buyer KYB service is not connected.');
      const response = await service.list(signal);
      if (signal.aborted) throw new DOMException('The operator session changed.', 'AbortError');
      return confirmedCases(response);
    },
    enabled: Boolean(service) && !blocked,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const unauthorized = isUnauthorized(query.error);
  useLayoutEffect(
    () => () => {
      void client.cancelQueries({ queryKey, exact: true });
      client.removeQueries({ queryKey, exact: true });
    },
    [client, queryKey],
  );
  useEffect(() => {
    if (unauthorized) client.removeQueries({ queryKey, exact: true });
  }, [client, queryKey, unauthorized]);
  return {
    ...query,
    data: service && !blocked && !query.error ? query.data : undefined,
    clear: () => {
      void client.cancelQueries({ queryKey, exact: true });
      client.removeQueries({ queryKey, exact: true });
    },
  };
}
