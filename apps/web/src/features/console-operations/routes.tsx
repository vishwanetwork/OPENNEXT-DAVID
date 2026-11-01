'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/components/providers/api-context';
import type { BuyerKybAdminService, BuyerKybDocument } from '@/lib/buyer-kyb';
import type { PaymentReviewService } from '@/lib/payment-review';
import type { ConsoleAccountService } from '@/lib/console-account';
import { ConsoleAccountsPage } from '@/features/console-accounts';
import { base64ToBytes } from '@/lib/base64';
import { PaymentReviewQueue } from '@/features/console-payments';
import { KybReviewWorkspace } from '@/features/console-buyer-kyb';
import { PaymentsPage } from '@/features/console';

/**
 * The operator session scope from `/api/admin/operations/session`. It changes with every
 * administrator sign-in; without a signed-in administrator there is no service.
 */
function useOperationsSession() {
  const api = useApi();
  const query = useQuery({
    queryKey: ['admin', 'operations-session'],
    queryFn: ({ signal }) =>
      api.get<{ confirmed?: unknown; sessionScope?: unknown; capabilities?: string[] }>(
        '/api/admin/operations/session',
        {
          signal,
        },
      ),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: true,
  });
  const scope =
    !query.error && query.data?.confirmed === true ? query.data.sessionScope : undefined;
  return {
    scope: typeof scope === 'string' && scope ? scope : undefined,
    capabilities: Array.isArray(query.data?.capabilities) ? query.data.capabilities : [],
  };
}

export function usePaymentReviewService(): PaymentReviewService | undefined {
  const api = useApi();
  const { scope, capabilities } = useOperationsSession();
  const continuation = capabilities.includes('direct-pay-continuation-v1');
  return useMemo<PaymentReviewService | undefined>(
    () =>
      scope
        ? {
            sessionScope: scope,
            ...(continuation
              ? {
                  completeDirectPay: (input: Parameters<PaymentReviewService['decide']>[0]) =>
                    api.post(
                      `/api/admin/payment-requests/${encodeURIComponent(input.caseId)}/complete`,
                      input,
                    ),
                }
              : {}),
            list: (kind, signal) =>
              api.get(`/api/admin/payment-requests?kind=${encodeURIComponent(kind)}`, { signal }),
            decide: (input) =>
              api.post(
                `/api/admin/payment-requests/${encodeURIComponent(input.caseId)}/decision`,
                input,
              ),
          }
        : undefined,
    [api, scope, continuation],
  );
}

export function useBuyerKybAdminService(): BuyerKybAdminService | undefined {
  const api = useApi();
  const { scope, capabilities } = useOperationsSession();
  const bundles = capabilities.includes('kyb-bundle-v1');
  return useMemo<BuyerKybAdminService | undefined>(
    () =>
      scope
        ? {
            sessionScope: scope,
            list: (signal) => api.get('/api/admin/buyer-kyb', { signal }),
            ...(bundles
              ? {
                  downloadBundle: async ({
                    caseId,
                    accountId,
                    expectedRevision,
                  }: {
                    caseId: string;
                    accountId: string;
                    expectedRevision: number;
                  }) => {
                    const result = await api.get<{
                      confirmed: boolean;
                      caseId: string;
                      accountId: string;
                      revision: number;
                      fileName: string;
                      contentType: string;
                      dataBase64: string;
                      form: { fileName: string; contentType: 'application/pdf'; sizeBytes: number };
                      documents: BuyerKybDocument[];
                    }>(
                      `/api/admin/buyer-kyb/${encodeURIComponent(caseId)}/bundle?${new URLSearchParams({ accountId, revision: String(expectedRevision) })}`,
                    );
                    return {
                      ...result,
                      blob: new Blob([base64ToBytes(result.dataBase64)], {
                        type: result.contentType,
                      }),
                    };
                  },
                }
              : {}),
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
    [api, scope, bundles],
  );
}

/** Route compositions: each page receives its service once an administrator is signed in. */
export function TopupRequestsRoute() {
  return <PaymentReviewQueue kind="topup" service={usePaymentReviewService()} />;
}

export function PaymentRequestsRoute() {
  return <PaymentsPage service={usePaymentReviewService()} />;
}

export function KybReviewRoute() {
  return <KybReviewWorkspace service={useBuyerKybAdminService()} />;
}

export function AccountsRoute() {
  const api = useApi();
  const { scope, capabilities } = useOperationsSession();
  const enabled = capabilities.includes('accounts-v1');
  const service = useMemo<ConsoleAccountService | undefined>(
    () =>
      scope && enabled
        ? {
            sessionScope: scope,
            summaries: ({ userIds, signal }) =>
              api.get(`/api/admin/accounts?userIds=${encodeURIComponent(userIds.join(','))}`, {
                signal,
              }),
            details: ({ userId, creditCursor, purchaseCursor, signal }) =>
              api.get(
                `/api/admin/accounts/${encodeURIComponent(userId)}?${new URLSearchParams({ creditCursor, purchaseCursor })}`,
                { signal },
              ),
          }
        : undefined,
    [api, scope, enabled],
  );
  return <ConsoleAccountsPage service={service} />;
}
