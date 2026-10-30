'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/components/providers/api-context';
import type { BuyerKybAdminService } from '@/lib/buyer-kyb';
import type { PaymentReviewService } from '@/lib/payment-review';
import { base64ToBytes } from '@/lib/base64';
import { ConsoleTopupsPage } from '@/features/console-topups';
import { KybReviewWorkspace } from '@/features/console-buyer-kyb';
import { PaymentsPage } from '@/features/console';

/**
 * The operator session scope from `/api/admin/operations/session`. It changes with every
 * administrator sign-in; without a signed-in administrator there is no service.
 */
function useOperationsScope(): string | undefined {
  const api = useApi();
  const query = useQuery({
    queryKey: ['admin', 'operations-session'],
    queryFn: ({ signal }) =>
      api.get<{ sessionScope?: unknown }>('/api/admin/operations/session', { signal }),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: true,
  });
  const scope = query.data?.sessionScope;
  return typeof scope === 'string' && scope ? scope : undefined;
}

export function usePaymentReviewService(): PaymentReviewService | undefined {
  const api = useApi();
  const scope = useOperationsScope();
  return useMemo<PaymentReviewService | undefined>(
    () =>
      scope
        ? {
            sessionScope: scope,
            list: (kind, signal) =>
              api.get(`/api/admin/payment-requests?kind=${encodeURIComponent(kind)}`, { signal }),
            decide: (input) =>
              api.post(
                `/api/admin/payment-requests/${encodeURIComponent(input.caseId)}/decision`,
                input,
              ),
          }
        : undefined,
    [api, scope],
  );
}

export function useBuyerKybAdminService(): BuyerKybAdminService | undefined {
  const api = useApi();
  const scope = useOperationsScope();
  return useMemo<BuyerKybAdminService | undefined>(
    () =>
      scope
        ? {
            sessionScope: scope,
            list: (signal) => api.get('/api/admin/buyer-kyb', { signal }),
            download: async ({ caseId, documentId, expectedRevision }) => {
              const result = await api.get<{
                caseId: string;
                documentId: string;
                fileName: string;
                contentType: string;
                dataBase64: string;
              }>(
                `/api/admin/buyer-kyb/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}?revision=${expectedRevision}`,
              );
              return {
                caseId: result.caseId,
                documentId: result.documentId,
                fileName: result.fileName,
                blob: new Blob([base64ToBytes(result.dataBase64)], { type: result.contentType }),
              };
            },
            decide: ({ caseId, ...body }) =>
              api.post(`/api/admin/buyer-kyb/${encodeURIComponent(caseId)}/decision`, body),
          }
        : undefined,
    [api, scope],
  );
}

/** Route compositions: each page receives its service once an administrator is signed in. */
export function TopupRequestsRoute() {
  return <ConsoleTopupsPage service={usePaymentReviewService()} />;
}

export function PaymentRequestsRoute() {
  return <PaymentsPage service={usePaymentReviewService()} />;
}

export function KybReviewRoute() {
  return <KybReviewWorkspace service={useBuyerKybAdminService()} />;
}
