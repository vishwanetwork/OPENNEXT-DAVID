import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { SpotFundingOrder } from '@/lib/spot-funding';
import { queryKeys } from '@/lib/api/query-keys';
import { useSessionStore } from '@/lib/session-store';
import { accountIdentity, initialWorkspace, useWorkspaceStore } from '@/terminal-kit';
import { instanceUsageFixture } from '@/test/instance-usage-fixture';
import { json, mockFetch, renderTerminal, signIn, testQueryClient } from '@/test/render';
import { UsageDialog } from './components/usage-dialogs';
import { EndDialog } from './components/end-dialog';
import { instanceModals } from './components/instance-modals';
import { useRefreshInstance } from './hooks';

const state = vi.hoisted(() => ({ orders: [] as SpotFundingOrder[] }));
vi.mock('@/features/spot-funding', () => ({
  useSpotFundingOrder: ({ instanceId }: { instanceId: string }) => {
    const order = state.orders.find((item) => item.instanceId === instanceId);
    return { snapshot: order ? { order } : null };
  },
  SpotOrderBilling: () => <p>Verified floating billing</p>,
}));
vi.mock('./components/instance-autopilot', () => ({
  InstanceAutopilot: ({ ended }: { ended: boolean }) => <p>Autopilot ended: {String(ended)}</p>,
  autopilotSummary: () => 'Idle',
}));
vi.mock('./components/instance-inference', () => ({
  InstanceInference: ({ ended }: { ended: boolean }) => <p>Inference ended: {String(ended)}</p>,
}));

const instance = {
  id: 'ins-1',
  term: 'Spot',
  model: 'H100',
  count: 1,
  region: 'US',
  status: 'Running',
  serviceEnd: '2020-01-01T00:00:00Z',
};
const floating = (): SpotFundingOrder => ({
  orderId: 'order-1',
  instanceId: 'ins-1',
  model: 'H100',
  paymentMethod: 'Credit',
  initialPaymentCents: 7200,
  initialHourlyCents: 100,
  currentHourlyCents: 125,
  purchasedSeconds: 259200,
  remainingSeconds: 72000,
  runtimeState: 'running',
  retention: 'pending',
  funding: {
    cycleId: 'cycle-1',
    baselineCents: 7200,
    remainingCents: 1440,
    remainingPercent: 20,
    nextHourRequiredCents: 125,
    projectedRemainingCents: 2500,
    status: 'low',
    warnings: ['remaining_20_percent'],
  },
});

beforeEach(() => {
  useWorkspaceStore.setState(initialWorkspace());
  signIn();
  state.orders = [];
  mockFetch(() => json(200, {}));
});

describe('floating pricing preserves fixed-order behavior', () => {
  it('keeps the original ledger for a fixed order even when a floating service exists', async () => {
    const load = vi.fn().mockResolvedValue({
      ...instanceUsageFixture(),
      accountId: 'u1',
      instanceId: 'ins-1',
      confirmed: true,
      demo: false,
    });
    renderTerminal(<UsageDialog id="ins-1" view="billing" />, {
      slots: {
        services: {
          instanceUsage: { load },
          spotFunding: { scope: 'test', loadAccount: vi.fn(), loadOrder: vi.fn() },
        },
      },
    });
    expect(await screen.findByText('RECORDED TOTAL')).toBeInTheDocument();
    expect(screen.queryByText('Verified floating billing')).toBeNull();
  });

  it('uses the floating ledger only for the confirmed matching order', () => {
    state.orders = [floating()];
    renderTerminal(<UsageDialog id="ins-1" view="billing" />);
    expect(screen.getByText('Verified floating billing')).toBeInTheDocument();
    expect(screen.queryByText('RECORDED TOTAL')).toBeNull();
  });

  it('allows ending a running cumulative-runtime order after its old wall-clock end', async () => {
    state.orders = [floating()];
    const end = vi.fn().mockResolvedValue({
      confirmed: true,
      instance: { ...instance, status: 'Ended', endedAt: '2026-11-03T12:00:00Z' },
    });
    renderTerminal(<EndDialog id="ins-1" isExample={false} />, {
      workspace: { instances: [instance] },
      slots: { services: { instanceLifecycle: { end } } },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'END instance' }));
    await waitFor(() =>
      expect(end).toHaveBeenCalledWith({ instanceId: 'ins-1', confirmation: 'END' }),
    );
    expect(screen.queryByText('This instance has already ended.')).toBeNull();
  });

  it('passes authoritative lifecycle state to Autopilot and inference dialogs', () => {
    state.orders = [{ ...floating(), runtimeState: 'paused_insufficient_funds' }];
    const Autopilot = instanceModals['instance-autopilot'];
    const Inference = instanceModals['instance-inference'];
    if (!Autopilot || !Inference) throw new Error('Expected both instance modals.');
    const view = renderTerminal(
      <Autopilot modal={{ type: 'instance-autopilot', id: 'ins-1' }} close={vi.fn()} />,
      { workspace: { instances: [instance] } },
    );
    expect(screen.getByText('Autopilot ended: false')).toBeInTheDocument();
    view.unmount();
    renderTerminal(
      <Inference modal={{ type: 'instance-inference', id: 'ins-1' }} close={vi.fn()} />,
      { workspace: { instances: [instance] } },
    );
    expect(screen.getByText('Inference ended: false')).toBeInTheDocument();
  });

  it('refreshes current account funding summaries and detail pages without crossing accounts', async () => {
    const identity = accountIdentity(useSessionStore.getState().user, false);
    const client = testQueryClient();
    const accountKey = queryKeys.account.spotFunding(identity, 'scope');
    const orderKey = queryKeys.account.spotFundingOrder(
      identity,
      'scope',
      'instance:ins-1',
      'page-2',
    );
    const otherKey = queryKeys.account.spotFunding('another-account', 'scope');
    for (const key of [accountKey, orderKey, otherKey]) client.setQueryData(key, {});
    function Refresh() {
      const refresh = useRefreshInstance('ins-1');
      return (
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      );
    }
    renderTerminal(<Refresh />, { queryClient: client });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(client.getQueryState(accountKey)?.isInvalidated).toBe(true));
    expect(client.getQueryState(orderKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });
});
