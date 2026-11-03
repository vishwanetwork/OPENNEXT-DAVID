import { useState } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  SpotFundingAccount,
  SpotFundingOrderDetail,
  SpotFundingService,
} from '@/lib/spot-funding';
import { useSessionStore } from '@/lib/session-store';
import { queryKeys } from '@/lib/api/query-keys';
import { accountIdentity, EMPTY_SLOTS, TerminalSlotsProvider } from '@/terminal-kit';
import { renderTerminal, signIn, testQueryClient } from '@/test/render';
import { useSpotFundingAccount, useSpotFundingInstances, useSpotFundingOrder } from './hooks';

const position = {
  cycleId: 'cycle-1',
  baselineCents: 1000,
  remainingCents: 1000,
  remainingPercent: 100,
  nextHourRequiredCents: 100,
  projectedRemainingCents: 500,
  status: 'healthy' as const,
  warnings: [],
};
const account = (accountId = 'u1'): SpotFundingAccount => ({
  confirmed: true,
  pricingVersion: 'spot-hourly-v1',
  accountId,
  demo: false,
  observedAt: '2026-11-03T12:00:00Z',
  currency: 'USD',
  credit: position,
  activeCreditOrders: 0,
  orders: [],
  ordersComplete: true,
});
const detail = (orderId = 'order-1'): SpotFundingOrderDetail => ({
  confirmed: true,
  pricingVersion: 'spot-hourly-v1',
  accountId: 'u1',
  demo: false,
  observedAt: '2026-11-03T12:00:00Z',
  currency: 'USD',
  order: {
    orderId,
    instanceId: 'instance-1',
    model: 'H100',
    paymentMethod: 'Credit',
    initialPaymentCents: 1000,
    initialHourlyCents: 100,
    currentHourlyCents: 100,
    purchasedSeconds: 36000,
    remainingSeconds: 36000,
    runtimeState: 'waiting',
    retention: 'pending',
    funding: position,
  },
  ledger: { totalCents: 0, entries: [], complete: true, nextCursor: null },
});
const service = (): SpotFundingService => ({
  scope: 'session-1',
  loadAccount: vi.fn(async () => account()),
  loadOrder: vi.fn(async () => detail()),
});

function AccountProbe() {
  const { snapshot, query, connected } = useSpotFundingAccount();
  return (
    <>
      <output data-testid="account">{snapshot?.accountId ?? 'none'}</output>
      <output data-testid="connected">{String(connected)}</output>
      <output data-testid="error">{String(query.isError)}</output>
      <button type="button" onClick={() => void query.refetch()}>
        Refresh
      </button>
    </>
  );
}
function OrderProbe({ id = 'order-1', cursor = '' }: { id?: string; cursor?: string }) {
  const { snapshot, query, connected } = useSpotFundingOrder({ orderId: id }, cursor);
  return (
    <>
      <output data-testid="order">{snapshot?.order.orderId ?? 'none'}</output>
      <output data-testid="connected">{String(connected)}</output>
      <output data-testid="error">{String(query.isError)}</output>
    </>
  );
}
function InstancesProbe({ ids = ['instance-1'] }: { ids?: string[] }) {
  const { orders, connected } = useSpotFundingInstances(ids);
  return (
    <>
      <output data-testid="instances">{orders.map((order) => order.instanceId).join(',')}</output>
      <output data-testid="instances-connected">{String(connected)}</output>
    </>
  );
}
function InstanceProbe() {
  const { snapshot } = useSpotFundingOrder({ instanceId: 'instance-1' });
  return <output data-testid="instance">{snapshot?.order.instanceId ?? 'none'}</output>;
}
function instanceDetail(instanceId: string) {
  const snapshot = detail(`order-for-${instanceId}`);
  return { ...snapshot, order: { ...snapshot.order, instanceId } };
}

beforeEach(() => signIn());

describe('scoped floating Spot funding hooks', () => {
  it('does not call an undefined adapter, including a manual refresh', async () => {
    renderTerminal(<AccountProbe />);
    expect(screen.getByTestId('connected')).toHaveTextContent('false');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('true'));
    expect(screen.getByTestId('account')).toHaveTextContent('none');
  });
  it.each(['route', 'session', 'seller', 'expired'] as const)(
    'never calls a live adapter in %s scope',
    (kind) => {
      const adapter = service();
      if (kind === 'session') signIn({ demo: true });
      if (kind === 'seller') signIn({ role: 'seller' });
      if (kind === 'expired') useSessionStore.getState().markExpired();
      renderTerminal(<AccountProbe />, {
        demo: kind === 'route',
        slots: { services: { spotFunding: adapter } },
      });
      expect(screen.getByTestId('connected')).toHaveTextContent('false');
      expect(adapter.loadAccount).not.toHaveBeenCalled();
    },
  );
  it('disables empty instance/order lookup IDs', () => {
    const adapter = service();
    renderTerminal(<OrderProbe id="" />, { slots: { services: { spotFunding: adapter } } });
    expect(screen.getByTestId('connected')).toHaveTextContent('false');
    expect(adapter.loadOrder).not.toHaveBeenCalled();
  });
  it('accepts a verified buyer response and passes an abort signal', async () => {
    const adapter = service();
    renderTerminal(<AccountProbe />, { slots: { services: { spotFunding: adapter } } });
    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('u1'));
    expect(adapter.loadAccount).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
    expect(screen.getByTestId('connected')).toHaveTextContent('true');
  });
  it('rejects a wrong-account response', async () => {
    const adapter = { ...service(), loadAccount: vi.fn(async () => account('other')) };
    renderTerminal(<AccountProbe />, { slots: { services: { spotFunding: adapter } } });
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('true'));
    expect(screen.getByTestId('account')).toHaveTextContent('none');
  });
  it('removes the previous private snapshot after a refresh error', async () => {
    const loadAccount = vi
      .fn()
      .mockResolvedValueOnce(account())
      .mockRejectedValueOnce(new Error('Read denied.'));
    const adapter = { ...service(), loadAccount };
    const client = testQueryClient();
    const identity = accountIdentity(useSessionStore.getState().user, false);
    renderTerminal(<AccountProbe />, {
      queryClient: client,
      slots: { services: { spotFunding: adapter } },
    });
    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('u1'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('true'));
    expect(screen.getByTestId('account')).toHaveTextContent('none');
    expect(client.getQueryData(queryKeys.account.spotFunding(identity, adapter.scope))).toBeNull();
  });
  it('cannot show the previous identity while the new account loads', async () => {
    const gate = Promise.withResolvers<SpotFundingAccount>();
    const loadAccount = vi
      .fn()
      .mockResolvedValueOnce(account())
      .mockImplementationOnce(() => gate.promise);
    const adapter = { ...service(), loadAccount };
    const client = testQueryClient();
    const firstIdentity = accountIdentity(useSessionStore.getState().user, false);
    renderTerminal(<AccountProbe />, {
      queryClient: client,
      slots: { services: { spotFunding: adapter } },
    });
    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('u1'));
    act(() => signIn({ id: 'u2' }));
    expect(screen.getByTestId('account')).toHaveTextContent('none');
    await waitFor(() => expect(loadAccount).toHaveBeenCalledTimes(2));
    await act(async () => gate.resolve(account('u2')));
    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('u2'));
    await waitFor(() =>
      expect(
        client.getQueryData(queryKeys.account.spotFunding(firstIdentity, adapter.scope)),
      ).toBeUndefined(),
    );
  });
  it('aborts an in-flight request when authorization is revoked', async () => {
    const gate = Promise.withResolvers<SpotFundingAccount>();
    let receivedSignal: AbortSignal | undefined;
    const adapter = {
      ...service(),
      loadAccount: vi.fn(({ signal }: { signal?: AbortSignal }) => {
        receivedSignal = signal;
        return gate.promise;
      }),
    };
    renderTerminal(<AccountProbe />, { slots: { services: { spotFunding: adapter } } });
    await waitFor(() => expect(adapter.loadAccount).toHaveBeenCalledTimes(1));
    act(() => useSessionStore.getState().markExpired());
    await waitFor(() => expect(receivedSignal?.aborted).toBe(true));
    await act(async () => gate.resolve(account()));
    expect(screen.getByTestId('account')).toHaveTextContent('none');
  });
  it('removes cached private data when verification is lost even if the user object remains', async () => {
    const adapter = service();
    const client = testQueryClient();
    const identity = accountIdentity(useSessionStore.getState().user, false);
    renderTerminal(<AccountProbe />, {
      queryClient: client,
      slots: { services: { spotFunding: adapter } },
    });
    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('u1'));
    act(() => useSessionStore.setState({ status: 'booting' }));
    expect(screen.getByTestId('connected')).toHaveTextContent('false');
    expect(screen.getByTestId('account')).toHaveTextContent('none');
    await waitFor(() =>
      expect(
        client.getQueryData(queryKeys.account.spotFunding(identity, adapter.scope)),
      ).toBeUndefined(),
    );
  });
  it('isolates a replacement adapter scope', async () => {
    const gate = Promise.withResolvers<SpotFundingAccount>();
    const loadAccount = vi
      .fn()
      .mockResolvedValueOnce(account())
      .mockImplementationOnce(() => gate.promise);
    function ScopeProbe() {
      const [scope, setScope] = useState('session-1');
      return (
        <TerminalSlotsProvider
          slots={{
            ...EMPTY_SLOTS,
            services: { spotFunding: { scope, loadAccount, loadOrder: service().loadOrder } },
          }}
        >
          <button type="button" onClick={() => setScope('session-2')}>
            Rotate scope
          </button>
          <AccountProbe />
        </TerminalSlotsProvider>
      );
    }
    renderTerminal(<ScopeProbe />);
    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('u1'));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate scope' }));
    expect(screen.getByTestId('account')).toHaveTextContent('none');
    await act(async () => gate.resolve(account()));
    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('u1'));
    expect(loadAccount).toHaveBeenCalledTimes(2);
  });
  it('passes cursor and lookup to the adapter and uses independently scoped query keys', async () => {
    const adapter = service();
    const client = testQueryClient();
    const identity = accountIdentity(useSessionStore.getState().user, false);
    renderTerminal(<OrderProbe cursor="page-two" />, {
      queryClient: client,
      slots: { services: { spotFunding: adapter } },
    });
    await waitFor(() => expect(screen.getByTestId('order')).toHaveTextContent('order-1'));
    expect(adapter.loadOrder).toHaveBeenCalledWith({
      orderId: 'order-1',
      cursor: 'page-two',
      signal: expect.any(AbortSignal),
    });
    expect(
      client.getQueryData(
        queryKeys.account.spotFundingOrder(identity, adapter.scope, 'order:order-1', 'page-two'),
      ),
    ).toEqual(detail());
    expect(
      client.getQueryData(
        queryKeys.account.spotFundingOrder(identity, adapter.scope, 'order:order-1', ''),
      ),
    ).toBeUndefined();
  });
});

describe('visible instance funding reads', () => {
  it('reads every distinct visible instance without relying on account summary completeness', async () => {
    const adapter = {
      ...service(),
      loadOrder: vi.fn<SpotFundingService['loadOrder']>(async (lookup) =>
        instanceDetail('instanceId' in lookup ? lookup.instanceId : ''),
      ),
    };
    renderTerminal(<InstancesProbe ids={['instance-1', '', ' ', 'instance-2', 'instance-1']} />, {
      slots: { services: { spotFunding: adapter } },
    });
    await waitFor(() =>
      expect(screen.getByTestId('instances')).toHaveTextContent('instance-1,instance-2'),
    );
    expect(adapter.loadOrder).toHaveBeenCalledTimes(2);
    expect(adapter.loadOrder).toHaveBeenCalledWith({
      instanceId: 'instance-2',
      cursor: '',
      signal: expect.any(AbortSignal),
    });
    expect(adapter.loadAccount).not.toHaveBeenCalled();
  });
  it('shares its confirmed snapshot and in-flight request with the individual instance hook', async () => {
    const adapter = service();
    renderTerminal(
      <>
        <InstancesProbe />
        <InstanceProbe />
      </>,
      { slots: { services: { spotFunding: adapter } } },
    );
    await waitFor(() => expect(screen.getByTestId('instances')).toHaveTextContent('instance-1'));
    expect(screen.getByTestId('instance')).toHaveTextContent('instance-1');
    expect(adapter.loadOrder).toHaveBeenCalledTimes(1);
  });
  it.each(['route', 'session', 'seller', 'expired', 'missing'] as const)(
    'does not read any instance in %s scope',
    (kind) => {
      const adapter = service();
      if (kind === 'session') signIn({ demo: true });
      if (kind === 'seller') signIn({ role: 'seller' });
      if (kind === 'expired') useSessionStore.getState().markExpired();
      renderTerminal(<InstancesProbe />, {
        demo: kind === 'route',
        slots: { services: { spotFunding: kind === 'missing' ? undefined : adapter } },
      });
      expect(screen.getByTestId('instances-connected')).toHaveTextContent('false');
      expect(screen.getByTestId('instances')).toBeEmptyDOMElement();
      expect(adapter.loadOrder).not.toHaveBeenCalled();
    },
  );
  it('omits an invalid instance response without hiding confirmed sibling instances', async () => {
    const adapter = {
      ...service(),
      loadOrder: vi.fn<SpotFundingService['loadOrder']>(async (lookup) => {
        const instanceId = 'instanceId' in lookup ? lookup.instanceId : '';
        return {
          ...instanceDetail(instanceId),
          accountId: instanceId === 'instance-1' ? 'u1' : 'another-account',
        };
      }),
    };
    renderTerminal(<InstancesProbe ids={['instance-1', 'instance-2']} />, {
      slots: { services: { spotFunding: adapter } },
    });
    await waitFor(() => expect(screen.getByTestId('instances')).toHaveTextContent('instance-1'));
    expect(screen.getByTestId('instances')).not.toHaveTextContent('instance-2');
  });
  it('removes a previously confirmed row after its refresh fails', async () => {
    const adapter = {
      ...service(),
      loadOrder: vi.fn().mockResolvedValueOnce(detail()).mockRejectedValueOnce(new Error('Denied')),
    };
    const client = testQueryClient();
    const identity = accountIdentity(useSessionStore.getState().user, false);
    const key = queryKeys.account.spotFundingOrder(
      identity,
      adapter.scope,
      'instance:instance-1',
      '',
    );
    renderTerminal(<InstancesProbe />, {
      queryClient: client,
      slots: { services: { spotFunding: adapter } },
    });
    await waitFor(() => expect(screen.getByTestId('instances')).toHaveTextContent('instance-1'));
    await act(async () => client.invalidateQueries({ queryKey: key }));
    await waitFor(() => expect(screen.getByTestId('instances')).toBeEmptyDOMElement());
    expect(client.getQueryData(key)).toBeNull();
  });
  it('aborts pending instance reads and hides all rows when authorization is revoked', async () => {
    const gate = Promise.withResolvers<SpotFundingOrderDetail>();
    let receivedSignal: AbortSignal | undefined;
    const adapter = {
      ...service(),
      loadOrder: vi.fn(({ signal }: { signal?: AbortSignal }) => {
        receivedSignal = signal;
        return gate.promise;
      }),
    };
    renderTerminal(<InstancesProbe />, { slots: { services: { spotFunding: adapter } } });
    await waitFor(() => expect(adapter.loadOrder).toHaveBeenCalledTimes(1));
    act(() => useSessionStore.setState({ status: 'booting' }));
    expect(screen.getByTestId('instances-connected')).toHaveTextContent('false');
    await waitFor(() => expect(receivedSignal?.aborted).toBe(true));
    await act(async () => gate.resolve(detail()));
    expect(screen.getByTestId('instances')).toBeEmptyDOMElement();
  });
});
