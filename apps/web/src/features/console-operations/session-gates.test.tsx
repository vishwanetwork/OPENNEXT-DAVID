import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { ApiProvider } from '@/components/providers/api-context';
import { json, mockFetch, renderConsole, testQueryClient } from '@/test/render';
import { TopupRequestsRoute, useBuyerKybAdminService, usePaymentReviewService } from './routes';

const sessionPath = '/api/admin/operations/session';
const sessionKey = ['admin', 'operations-session'];

function sessionHarness() {
  const client = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiProvider demo={false} queryClient={client}>
      {children}
    </ApiProvider>
  );
  const view = renderHook(
    () => ({ payments: usePaymentReviewService(), kyb: useBuyerKybAdminService() }),
    { wrapper },
  );
  return { ...view, client };
}

describe('operator session service gates', () => {
  it('enables completion and bundle services only when the live backend advertises them', async () => {
    const paths: string[] = [];
    mockFetch((path) => {
      paths.push(path);
      return path === sessionPath
        ? json(200, {
            confirmed: true,
            sessionScope: 'capable-operator',
            capabilities: ['direct-pay-continuation-v1', 'kyb-bundle-v1'],
          })
        : path.includes('/bundle?')
          ? json(200, {
              confirmed: true,
              caseId: 'k1',
              accountId: 'u1',
              revision: 1,
              fileName: 'kyb.zip',
              contentType: 'application/zip',
              dataBase64: 'UEs=',
              form: {},
              documents: [],
            })
          : json(200, { confirmed: true });
    });
    const { result } = sessionHarness();
    await waitFor(() => expect(result.current.payments?.completeDirectPay).toBeTypeOf('function'));
    if (!result.current.payments?.completeDirectPay || !result.current.kyb?.downloadBundle)
      throw new Error('Expected enabled capabilities.');
    await result.current.payments.completeDirectPay({
      caseId: 'p1',
      accountId: 'u1',
      expectedRevision: 1,
      idempotencyKey: 'key',
      decision: 'Confirm',
      fundsVerified: true,
      reason: '',
    });
    const bundle = await result.current.kyb.downloadBundle({
      caseId: 'k1',
      accountId: 'u1',
      expectedRevision: 1,
    });
    expect(bundle.blob.type).toBe('application/zip');
    expect(paths).toContain('/api/admin/payment-requests/p1/complete');
    expect(paths).toContain('/api/admin/buyer-kyb/k1/bundle?accountId=u1&revision=1');
    expect(paths.some((path) => path.endsWith('/decision'))).toBe(false);
  });
  it('does not provide services for an unconfirmed session even when a scope is present', async () => {
    mockFetch((path) =>
      path === sessionPath
        ? json(200, { confirmed: false, sessionScope: 'unverified-operator' })
        : json(404, {}),
    );
    const { client, result } = sessionHarness();
    await waitFor(() => expect(client.getQueryState(sessionKey)?.status).toBe('success'));
    expect(client.getQueryData(sessionKey)).toEqual({
      confirmed: false,
      sessionScope: 'unverified-operator',
    });
    expect(result.current.payments).toBeUndefined();
    expect(result.current.kyb).toBeUndefined();
  });

  it('removes both services after a 401 refetch even while the same client retains old data', async () => {
    let expired = false;
    mockFetch((path) =>
      path !== sessionPath
        ? json(404, {})
        : expired
          ? json(401, { error: 'Administrator access expired' })
          : json(200, { confirmed: true, sessionScope: 'operator-before-expiry' }),
    );
    const { client, result } = sessionHarness();
    await waitFor(() =>
      expect(result.current.payments?.sessionScope).toBe('operator-before-expiry'),
    );
    expect(result.current.kyb?.sessionScope).toBe('operator-before-expiry');
    expired = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: sessionKey, exact: true });
    });
    await waitFor(() => {
      expect(result.current.payments).toBeUndefined();
      expect(result.current.kyb).toBeUndefined();
    });
    expect(client.getQueryState(sessionKey)?.status).toBe('error');
    expect(client.getQueryData(sessionKey)).toEqual({
      confirmed: true,
      sessionScope: 'operator-before-expiry',
    });
  });

  it('does not advertise unimplemented completion or document-bundle capabilities', async () => {
    mockFetch((path) =>
      path === sessionPath
        ? json(200, { confirmed: true, sessionScope: 'verified-operator' })
        : json(404, {}),
    );
    const { result } = sessionHarness();
    await waitFor(() => expect(result.current.payments).toBeDefined());
    expect(result.current.kyb).toBeDefined();
    expect(result.current.payments?.completeDirectPay).toBeUndefined();
    expect(result.current.kyb?.downloadBundle).toBeUndefined();
    expect(result.current.payments?.decide).toBeTypeOf('function');
    expect(result.current.kyb?.download).toBeTypeOf('function');
  });
});

describe('versioned top-up route isolation', () => {
  it.each([200, 401])(
    'never falls back to legacy top-up calls when session status is %s',
    async (status) => {
      const fetchSpy = mockFetch((path) =>
        path === sessionPath
          ? json(status, { confirmed: false, sessionScope: 'not-authorized' })
          : json(404, {}),
      );
      const { queryClient } = renderConsole(<TopupRequestsRoute />);
      await waitFor(() =>
        expect(queryClient.getQueryState(sessionKey)?.status).toBe(
          status === 200 ? 'success' : 'error',
        ),
      );
      expect(screen.getByRole('heading', { name: 'Top-up Requests' })).toBeInTheDocument();
      expect(screen.getByText(/Verified payment decisions, account updates/)).toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Account scope' })).not.toBeInTheDocument();
      expect(
        fetchSpy.mock.calls.some(([path]) => String(path).startsWith('/api/admin/topups')),
      ).toBe(false);
      expect(
        fetchSpy.mock.calls.some(([path]) =>
          String(path).startsWith('/api/admin/payment-requests'),
        ),
      ).toBe(false);
    },
  );
});
