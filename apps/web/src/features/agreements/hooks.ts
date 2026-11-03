'use client';

import { useQuery } from '@tanstack/react-query';
import { useBuyerKyb } from '@/features/buyer-kyb';
import { queryKeys } from '@/lib/api/query-keys';
import type { SpotAgreementContext } from '@/lib/spot-agreement';
import { useTerminalSlots } from '@/terminal-kit';
import { agreementApi } from './api';
import { contextKey } from './validation';

export function useAgreement(context: SpotAgreementContext) {
  const kyb = useBuyerKyb();
  const service = useTerminalSlots().services.spotAgreement;
  const verification = kyb.snapshot?.verification;
  const enabled = Boolean(
    service && kyb.approved && !kyb.demo && kyb.accountId === context.accountId,
  );
  const query = useQuery({
    queryKey: queryKeys.account.spotAgreement(
      kyb.identity,
      contextKey(context),
      verification?.revision ?? -1,
    ),
    queryFn: async ({ signal }) => {
      if (!enabled || !service || !verification)
        throw new Error('Verified agreement preparation is unavailable.');
      return agreementApi.prepare(service, context, verification, signal);
    },
    enabled,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  return {
    kyb,
    service,
    query,
    document: enabled && query.isSuccess && !query.isError ? query.data : undefined,
  };
}
