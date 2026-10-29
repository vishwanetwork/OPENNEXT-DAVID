'use client';

import { useMemo } from 'react';
import { useApi } from '@/components/providers/api-context';
import type { BuyerKybService, BuyerKybSnapshot } from '@/lib/buyer-kyb';
import { fileToBase64 } from '@/lib/base64';

/** Buyer KYB through `/api/buyer-kyb/*`; results are verified by `buyerKybApi`. */
export function useBuyerKybApiService(): BuyerKybService {
  const api = useApi();
  return useMemo<BuyerKybService>(
    () => ({
      load: (signal) => api.get<BuyerKybSnapshot>('/api/buyer-kyb/me', { signal }),
      submit: async ({ company, mode, documents, consent, idempotencyKey }) => {
        const documentIds: string[] = [];
        // One file per request keeps each body within the 10 MB file limit plus encoding.
        for (const { kind, file } of documents) {
          const result = await api.post<{ document?: { id?: unknown } }>(
            '/api/buyer-kyb/documents',
            {
              kind,
              fileName: file.name,
              contentType: file.type,
              dataBase64: await fileToBase64(file),
            },
            { timeoutMs: 120_000 },
          );
          if (typeof result?.document?.id !== 'string')
            throw new Error('A document upload was not confirmed. Please try again.');
          documentIds.push(result.document.id);
        }
        return api.post<BuyerKybSnapshot>('/api/buyer-kyb/submissions', {
          company,
          mode,
          consent,
          idempotencyKey,
          documentIds,
        });
      },
    }),
    [api],
  );
}
