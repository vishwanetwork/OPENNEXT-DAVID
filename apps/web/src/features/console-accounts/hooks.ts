'use client';

import { useId, useLayoutEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConsoleAccountService } from '@/lib/console-account';
import { confirmedDetail, confirmedSummaries } from './validation';

export function useAccountRecords({
  service,
  userIds,
  selectedId,
  creditCursor,
  purchaseCursor,
  blocked,
}: {
  service?: ConsoleAccountService;
  userIds: string[];
  selectedId: string;
  creditCursor: string;
  purchaseCursor: string;
  blocked: boolean;
}) {
  const client = useQueryClient();
  const viewId = useId();
  const scope = service?.sessionScope;
  const key = useMemo(() => ['admin', 'accounts', scope, viewId] as const, [scope, viewId]);
  const options = { retry: false as const, gcTime: 0, staleTime: 0, refetchOnWindowFocus: true };
  const summary = useQuery({
    ...options,
    queryKey: [...key, 'summaries', userIds],
    enabled: Boolean(service && userIds.length && !blocked),
    queryFn: async ({ signal }) => {
      if (!service) throw new Error('The account service is not connected.');
      const response = await service.summaries({ userIds, signal });
      if (signal.aborted) throw new DOMException('The operator session changed.', 'AbortError');
      return confirmedSummaries(response, service.sessionScope, userIds);
    },
  });
  const detail = useQuery({
    ...options,
    queryKey: [...key, 'detail', selectedId, creditCursor, purchaseCursor],
    enabled: Boolean(service && selectedId && userIds.includes(selectedId) && !blocked),
    queryFn: async ({ signal }) => {
      if (!service) throw new Error('The account service is not connected.');
      const response = await service.details({
        userId: selectedId,
        creditCursor,
        purchaseCursor,
        signal,
      });
      if (signal.aborted) throw new DOMException('The operator session changed.', 'AbortError');
      return confirmedDetail(response, service.sessionScope, selectedId);
    },
  });
  useLayoutEffect(
    () => () => {
      void client.cancelQueries({ queryKey: key });
      client.removeQueries({ queryKey: key });
    },
    [client, key],
  );
  useLayoutEffect(() => {
    if (blocked) {
      void client.cancelQueries({ queryKey: key });
      client.removeQueries({ queryKey: key });
    }
  }, [blocked, client, key]);
  return { summary, detail };
}
