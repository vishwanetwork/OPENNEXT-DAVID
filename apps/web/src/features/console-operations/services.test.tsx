import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ApiProvider } from '@/components/providers/api-context';
import { base64ToBytes, fileToBase64 } from '@/lib/base64';
import { json, mockFetch, testQueryClient } from '@/test/render';
import { useBuyerKybApiService } from '@/features/buyer-kyb';
import { useBankTransferApiService } from '@/features/bank-transfer';
import { useInstanceUsageApiService } from '@/features/instances';
import { useBuyerKybAdminService, usePaymentReviewService } from './routes';

const wrapper = ({ children }: { children: ReactNode }) => (
  <ApiProvider demo={false} queryClient={testQueryClient()}>
    {children}
  </ApiProvider>
);

describe('backend service adapters', () => {
  it('round-trips binary files through base64', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]);
    const encoded = await fileToBase64(new Blob([bytes]));
    expect(encoded).toBe('JVBERgD/EA==');
    expect([...base64ToBytes(encoded)]).toEqual([...bytes]);
  });

  it('uploads every KYB document before submitting their ids', async () => {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    mockFetch((path, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ path, body });
      return path.endsWith('/documents')
        ? json(200, { confirmed: true, document: { id: 'DOC-' + calls.length } })
        : json(200, { confirmed: true, accountId: 'u1', demo: false, verification: null });
    });
    const { result } = renderHook(() => useBuyerKybApiService(), { wrapper });
    await result.current.submit({
      company: {} as never,
      mode: 'Auto',
      consent: true,
      idempotencyKey: 'k1',
      documents: [
        {
          kind: 'legal-presence',
          file: new File(['%PDF-1'], 'a.pdf', { type: 'application/pdf' }),
        },
        {
          kind: 'proof-of-address',
          file: new File(['%PDF-2'], 'b.pdf', { type: 'application/pdf' }),
        },
      ],
    });
    expect(calls.map((c) => c.path)).toEqual([
      '/api/buyer-kyb/documents',
      '/api/buyer-kyb/documents',
      '/api/buyer-kyb/submissions',
    ]);
    expect(calls[0]!.body).toMatchObject({
      kind: 'legal-presence',
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      dataBase64: btoa('%PDF-1'),
    });
    expect(calls[2]!.body).toMatchObject({ documentIds: ['DOC-1', 'DOC-2'], consent: true });
  });

  it('routes transfers and usage to their endpoints', async () => {
    const paths: string[] = [];
    mockFetch((path) => {
      paths.push(path);
      return json(200, { confirmed: true });
    });
    const transfer = renderHook(() => useBankTransferApiService(), { wrapper }).result.current;
    const usage = renderHook(() => useInstanceUsageApiService(), { wrapper }).result.current;
    await transfer.reportSent({ intentId: 'BT-1', idempotencyKey: 'r1' });
    await usage.load({ instanceId: 'i/1' });
    expect(paths).toEqual([
      '/api/billing/bank-transfer-intents/BT-1/report-sent',
      '/api/marketplace/instances/i%2F1/usage',
    ]);
  });

  it('offers operator services only for a signed-in operator session', async () => {
    mockFetch((path) =>
      path === '/api/admin/operations/session'
        ? json(200, { confirmed: true, sessionScope: 'ops-abc' })
        : json(200, {}),
    );
    const { result } = renderHook(
      () => ({ payments: usePaymentReviewService(), kyb: useBuyerKybAdminService() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.payments?.sessionScope).toBe('ops-abc'));
    expect(result.current.kyb?.sessionScope).toBe('ops-abc');
    mockFetch(() => json(401, { error: 'Administrator sign-in required' }));
    const signedOut = renderHook(() => usePaymentReviewService(), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(signedOut.result.current).toBeUndefined();
  });
});
