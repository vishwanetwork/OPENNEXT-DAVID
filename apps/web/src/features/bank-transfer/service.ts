'use client';

import { useMemo } from 'react';
import { useApi } from '@/components/providers/api-context';
import type { BankTransferIntent, BankTransferService } from '@/lib/buyer-kyb';

/** Bank transfer intents through `/api/billing/bank-transfer-intents`. */
export function useBankTransferApiService(): BankTransferService {
  const api = useApi();
  return useMemo<BankTransferService>(
    () => ({
      create: (request) =>
        api.post<BankTransferIntent>('/api/billing/bank-transfer-intents', request),
      reportSent: ({ intentId, idempotencyKey }) =>
        api.post(`/api/billing/bank-transfer-intents/${encodeURIComponent(intentId)}/report-sent`, {
          idempotencyKey,
        }),
    }),
    [api],
  );
}
