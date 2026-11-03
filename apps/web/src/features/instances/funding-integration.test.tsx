import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { SpotFundingOrder } from '@/lib/spot-funding';
import { accountIdentity, initialWorkspace, useWorkspaceStore } from '@/terminal-kit';
import { queryKeys } from '@/lib/api/query-keys';
import { useSessionStore } from '@/lib/session-store';
import { instanceUsageFixture } from '@/test/instance-usage-fixture';
import { renderTerminal, signIn, testQueryClient } from '@/test/render';
import { InstancesPage } from './components/instances-page';
import { Manage } from './components/instance-dialogs';

const state = vi.hoisted(() => ({ orders: [] as SpotFundingOrder[] }));
vi.mock('@/features/spot-funding', () => ({
  SpotFundingAlerts: () => null,
  useSpotFundingInstances: () => ({ orders: state.orders }),
  useSpotFundingOrder: ({ instanceId }: { instanceId: string }) => ({
    snapshot: state.orders.find((order) => order.instanceId === instanceId)
      ? { order: state.orders.find((order) => order.instanceId === instanceId) }
      : null,
  }),
}));

const instance = {
  id: 'ins-1',
  term: 'Spot',
  model: 'H100',
  count: 1,
  region: 'us-east-1',
  rate: 1,
  status: 'Running',
  serviceEnd: '2020-01-01T00:00:00Z',
  sshHost: 'gpu.example.com',
};
const order = (state: SpotFundingOrder['runtimeState']): SpotFundingOrder => ({
  orderId: 'order-1',
  instanceId: 'ins-1',
  model: 'H100',
  paymentMethod: 'Credit',
  initialPaymentCents: 7200,
  initialHourlyCents: 100,
  currentHourlyCents: 125,
  purchasedSeconds: 72 * 3600,
  remainingSeconds: 20 * 3600,
  runtimeState: state,
  retention: 'confirmed',
  funding: {
    cycleId: 'cycle-1',
    baselineCents: 7200,
    remainingCents: 1440,
    remainingPercent: 20,
    nextHourRequiredCents: 125,
    projectedRemainingCents: 2500,
    status: 'low',
    warnings: ['remaining_20_percent', 'projected_shortfall'],
  },
});

beforeEach(() => {
  useWorkspaceStore.setState(initialWorkspace());
  signIn();
  state.orders = [];
});

describe('floating billing integration with Instances', () => {
  it('renders authoritative rate and remaining runtime without ending a live order', () => {
    state.orders = [order('running')];
    renderTerminal(<InstancesPage />, { workspace: { instances: [instance] } });
    expect(screen.getByText('1 × H100 - 72H - USA')).toBeInTheDocument();
    expect(screen.getByText('20.00 running hours remaining')).toBeInTheDocument();
    expect(screen.getByText('Current rate: $1.25 / hour')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).not.toBeDisabled();
    expect(document.querySelector('[data-instance-life="Running"]')).toBeInTheDocument();
  });
  it('groups a funding-paused instance separately and prevents connection', () => {
    state.orders = [{ ...order('paused_insufficient_funds'), retention: 'unavailable' }];
    renderTerminal(<InstancesPage />, { workspace: { instances: [instance] } });
    const group = Array.from(document.querySelectorAll('.instance-state-group')).find((node) =>
      node.querySelector('summary')?.textContent?.includes('Paused — insufficient funds'),
    );
    if (!group) throw new Error('Expected the funding-pause group.');
    expect(within(group as HTMLElement).getByRole('button', { name: 'Connect' })).toBeDisabled();
    expect(screen.getByText(/Data retention is not confirmed/)).toBeInTheDocument();
    expect(screen.queryByText(/Your data is retained/)).toBeNull();
  });
  it('Manage uses the same funding-paused state and whole-instance rate', () => {
    state.orders = [order('paused_insufficient_funds')];
    renderTerminal(<Manage id="ins-1" />, { workspace: { instances: [instance] } });
    expect(screen.getByText('Paused — insufficient funds')).toBeInTheDocument();
    expect(screen.getByText('$1.25 / hour')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connection details' })).toBeDisabled();
  });
  it('does not use an old usage retention flag when current floating retention is pending', () => {
    state.orders = [{ ...order('reconnecting'), retention: 'pending' }];
    const queryClient = testQueryClient();
    const snapshot = {
      ...instanceUsageFixture(),
      accountId: 'u1',
      instanceId: 'ins-1',
      confirmed: true,
      demo: false,
      retainedDataConfirmed: true,
    };
    queryClient.setQueryData(
      queryKeys.account.instanceUsage(
        accountIdentity(useSessionStore.getState().user, false),
        'ins-1',
      ),
      snapshot,
    );
    renderTerminal(<InstancesPage />, {
      queryClient,
      workspace: { instances: [instance] },
      slots: { services: { instanceUsage: { load: vi.fn().mockResolvedValue(snapshot) } } },
    });
    expect(screen.getByText(/Data preservation will be confirmed/)).toBeInTheDocument();
    expect(screen.queryByText(/Your data is preserved/)).toBeNull();
  });
});
