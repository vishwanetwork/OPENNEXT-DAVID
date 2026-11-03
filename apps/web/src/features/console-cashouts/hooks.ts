'use client';

import { useCallback, useId, useLayoutEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CashoutAdminService, CashoutRecord } from '@/lib/cashout';
import { verifiedCashoutDetails, verifiedCashouts } from './validation';

function usePrivateQueryKey(scope: string, kind: string, record?: CashoutRecord) {
  const client = useQueryClient();
  const instance = useId();
  const id = record?.id;
  const revision = record?.revision;
  const key = useMemo(
    () => ['admin', 'cashouts', scope, kind, instance, id, revision],
    [scope, kind, instance, id, revision],
  );
  const clear = useCallback(() => {
    void client.cancelQueries({ queryKey: key, exact: true });
    client.removeQueries({ queryKey: key, exact: true });
  }, [client, key]);
  useLayoutEffect(() => clear, [clear]);
  return { key, clear };
}

export function useCashoutQueue(service?: CashoutAdminService, blocked = false) {
  const scope = service?.sessionScope ?? '';
  const { key, clear } = usePrivateQueryKey(scope, 'queue');
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      if (!service || !scope.trim()) throw new Error('Cashout review is not connected.');
      const response = await service.list(signal);
      if (signal.aborted) throw new DOMException('Operator session changed.', 'AbortError');
      return verifiedCashouts(response, scope);
    },
    enabled: Boolean(service && scope.trim()) && !blocked,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  return { ...query, clear };
}

export function useCashoutDetails(service: CashoutAdminService, record: CashoutRecord) {
  const scope = service.sessionScope;
  const { key } = usePrivateQueryKey(scope, 'details', record);
  return useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      if (!service.details) throw new Error('Private bank details are not connected.');
      const response = await service.details({
        requestId: record.id,
        accountId: record.accountId,
        expectedRevision: record.revision,
        signal,
      });
      if (signal.aborted) throw new DOMException('Operator session changed.', 'AbortError');
      return verifiedCashoutDetails(response, record, scope);
    },
    enabled: Boolean(service.details && scope.trim()),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
  });
}
