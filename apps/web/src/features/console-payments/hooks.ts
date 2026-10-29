'use client';

import { useCallback, useId, useLayoutEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaymentReviewKind, PaymentReviewService } from '@/lib/payment-review';
import { confirmedPaymentRecords } from './validation';

export function usePaymentReviewQueue(
  kind: PaymentReviewKind,
  service: PaymentReviewService | undefined,
  blocked: boolean,
) {
  const client = useQueryClient();
  const instance = useId();
  const scope = service?.sessionScope ?? '';
  const queryKey = useMemo(
    () => ['admin', 'payment-review', scope, kind, instance],
    [scope, kind, instance],
  );
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      if (!service) throw new Error('Payment review is not connected.');
      const result = await service.list(kind, signal);
      if (signal.aborted) throw new DOMException('Operator session changed.', 'AbortError');
      return confirmedPaymentRecords(result, kind, scope);
    },
    enabled: Boolean(service) && !blocked,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  useLayoutEffect(
    () => () => {
      void client.cancelQueries({ queryKey, exact: true });
      client.removeQueries({ queryKey, exact: true });
    },
    [client, queryKey],
  );
  const clear = useCallback(() => {
    void client.cancelQueries({ queryKey, exact: true });
    client.removeQueries({ queryKey, exact: true });
  }, [client, queryKey]);
  return { ...query, clear };
}
