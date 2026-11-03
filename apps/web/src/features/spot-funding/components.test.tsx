import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type {
  SpotFundingAccount,
  SpotFundingOrder,
  SpotFundingOrderDetail,
  SpotFundingPosition,
} from '@/lib/spot-funding';
import { renderTerminal, signIn } from '@/test/render';
import { initialWorkspace, useWorkspaceStore } from '@/terminal-kit';
import { FundingAccountSummary, SpotFundingPanel } from './components/funding-panel';
import { SpotFundingAlerts } from './components/funding-alerts';
import { HourlySpotLedger } from './components/hourly-ledger';
import { SpotOrderBilling, SpotOrderSummary } from './components/order-billing';
import { SpotPricingNotice } from './components/pricing-notice';

const mocks = vi.hoisted(() => ({ account: vi.fn(), order: vi.fn() }));
vi.mock('./hooks', () => ({
  useSpotFundingAccount: () => mocks.account(),
  useSpotFundingOrder: (...args: unknown[]) => mocks.order(...args),
}));

const funding = (): SpotFundingPosition => ({
  cycleId: 'cycle-1',
  baselineCents: 10000,
  remainingCents: 2000,
  remainingPercent: 20,
  nextHourRequiredCents: 100,
  projectedRemainingCents: 7200,
  status: 'low',
  warnings: ['remaining_20_percent', 'projected_shortfall'],
});
const order = (): SpotFundingOrder => ({
  orderId: 'order-1',
  instanceId: 'instance-1',
  model: 'H100',
  paymentMethod: 'Credit',
  initialPaymentCents: 10000,
  initialHourlyCents: 100,
  currentHourlyCents: 125,
  purchasedSeconds: 72 * 3600,
  remainingSeconds: 60 * 3600,
  runtimeState: 'running',
  retention: 'pending',
  funding: funding(),
});
const account = (): SpotFundingAccount => ({
  confirmed: true,
  pricingVersion: 'spot-hourly-v1',
  accountId: 'u1',
  demo: false,
  observedAt: '2026-11-03T12:00:00Z',
  currency: 'USD',
  credit: {
    ...funding(),
    remainingCents: 70000,
    baselineCents: 100000,
    remainingPercent: 70,
    status: 'healthy',
    warnings: [],
  },
  activeCreditOrders: 8,
  orders: [order()],
  ordersComplete: false,
});
const detail = (): SpotFundingOrderDetail => ({
  confirmed: true,
  pricingVersion: 'spot-hourly-v1',
  accountId: 'u1',
  demo: false,
  observedAt: '2026-11-03T12:00:00Z',
  currency: 'USD',
  order: order(),
  ledger: {
    totalCents: 300,
    complete: false,
    nextCursor: 'next-page',
    entries: [
      {
        id: 'charge-1',
        startedAt: '2026-11-03T10:00:00Z',
        endedAt: '2026-11-03T10:30:00Z',
        billableSeconds: 1800,
        hourlyCents: 100,
        computeCents: 50,
        adjustmentCents: 50,
        totalCents: 100,
        explanation: 'Order minimum adjustment.',
      },
      {
        id: 'charge-2',
        startedAt: '2026-11-03T11:00:00Z',
        endedAt: '2026-11-03T12:00:00Z',
        billableSeconds: 3600,
        hourlyCents: 125,
        computeCents: 125,
        adjustmentCents: -25,
        totalCents: 100,
        explanation: 'Recorded correction.',
      },
    ],
  },
});
const query = () => ({ isFetching: false, isError: false, refetch: vi.fn() });

beforeEach(() => {
  useWorkspaceStore.setState(initialWorkspace());
  signIn();
  mocks.account.mockReset();
  mocks.order.mockReset();
  mocks.account.mockReturnValue({ snapshot: null, connected: false, query: query() });
  mocks.order.mockReturnValue({ snapshot: null, connected: false, query: query() });
});

describe('floating Spot funding presentation', () => {
  it('keeps alerts hidden and billing unavailable without the optional service', () => {
    renderTerminal(
      <>
        <SpotFundingPanel />
        <SpotFundingAlerts />
      </>,
    );
    expect(screen.getByText('Hourly Spot billing is not connected yet.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Spot funding alerts')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add credit' })).toBeNull();
  });

  it('uses the server aggregate rather than adding the partial order list', () => {
    renderTerminal(<FundingAccountSummary snapshot={account()} />);
    expect(screen.getByText('$700.00')).toBeInTheDocument();
    expect(screen.queryByText('$20.00')).toBeNull();
    expect(screen.getByText('8 active Credit-funded orders')).toBeInTheDocument();
    expect(screen.getByText(/Direct Pay order funds are separate/)).toBeInTheDocument();
  });

  it('displays recorded hourly rates, charges and adjustments without deriving rates from totals', () => {
    renderTerminal(<HourlySpotLedger ledger={detail().ledger} />);
    const rows = screen.getAllByRole('row');
    const first = rows[1];
    const second = rows[2];
    if (!first || !second) throw new Error('Expected both recorded entries');
    expect(
      within(first)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([
      expect.stringContaining('Order minimum adjustment.'),
      '$1.00',
      '0.5 hours',
      '$0.50',
      '$0.50',
      '$1.00',
    ]);
    expect(
      within(second)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([
      expect.stringContaining('Recorded correction.'),
      '$1.25',
      '1 hours',
      '$1.25',
      '-$0.25',
      '$1.00',
    ]);
    expect(screen.getByText(/This is a partial ledger/)).toBeInTheDocument();
    expect(screen.getByText('$3.00')).toBeInTheDocument();
  });

  it('warns at 20% without claiming a running instance is paused and reuses Add credit', () => {
    renderTerminal(<SpotOrderSummary order={order()} />);
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText(/20% or less/)).toBeInTheDocument();
    expect(screen.getByText(/This warning does not stop a running instance/)).toBeInTheDocument();
    expect(screen.queryByText('Paused — insufficient funds')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add credit' }));
    expect(useWorkspaceStore.getState().modal).toEqual({ type: 'pay-start' });
  });

  it('shows pause only from server runtime state and does not invent confirmed retention', () => {
    const paused: SpotFundingOrder = {
      ...order(),
      runtimeState: 'paused_insufficient_funds',
      retention: 'pending',
      funding: { ...funding(), status: 'insufficient', warnings: ['next_hour_unfunded'] },
    };
    const view = renderTerminal(<SpotOrderSummary order={paused} />);
    expect(screen.getByText('Paused — insufficient funds')).toBeInTheDocument();
    expect(screen.getByText(/Data retention has not been confirmed/)).toBeInTheDocument();
    expect(screen.queryByText(/Your data is retained/)).toBeNull();
    view.unmount();
    renderTerminal(<SpotOrderSummary order={{ ...paused, retention: 'confirmed' }} />);
    expect(screen.getByText(/Your data is retained/)).toBeInTheDocument();
  });

  it('separates Direct Pay funds and avoids promising automatic Credit allocation', () => {
    renderTerminal(<SpotOrderSummary order={{ ...order(), paymentMethod: 'Direct Pay' }} />);
    expect(screen.getByText(/Adding Credit does not guarantee allocation/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Contact support' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Direct Pay' })).toBeNull();
  });

  it('does not present unavailable funding or retention as confirmed values', () => {
    renderTerminal(
      <SpotOrderSummary
        order={{
          ...order(),
          runtimeState: 'reconnecting',
          retention: 'unavailable',
          funding: { ...funding(), status: 'unavailable', warnings: [] },
        }}
      />,
    );
    expect(screen.getByText('Funding coverage is not available yet.')).toBeInTheDocument();
    expect(screen.getByText(/Data retention information is unavailable/)).toBeInTheDocument();
    expect(screen.queryByText('$20.00')).toBeNull();
    expect(screen.queryByText(/Your data is retained/)).toBeNull();
  });

  it('opens selected order details and pages only with the returned cursor', () => {
    mocks.account.mockReturnValue({ snapshot: account(), connected: true, query: query() });
    mocks.order.mockImplementation((_lookup: unknown, cursor: string) => ({
      snapshot: {
        ...detail(),
        ledger: { ...detail().ledger, nextCursor: cursor ? null : 'next-page' },
      },
      connected: true,
      query: query(),
    }));
    renderTerminal(<SpotFundingPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'View hourly billing for order-1' }));
    expect(screen.getByText('Hourly Spot charges')).toBeInTheDocument();
    expect(mocks.order).toHaveBeenLastCalledWith({ orderId: 'order-1' }, '');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(mocks.order).toHaveBeenLastCalledWith({ orderId: 'order-1' }, 'next-page');
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'First page' }));
    expect(mocks.order).toHaveBeenLastCalledWith({ orderId: 'order-1' }, '');
  });

  it('shares the same hourly ledger for an instance and exposes no charge editing actions', () => {
    mocks.order.mockReturnValue({ snapshot: detail(), connected: true, query: query() });
    renderTerminal(<SpotOrderBilling instanceId="instance-1" />);
    expect(mocks.order).toHaveBeenCalledWith({ instanceId: 'instance-1' }, '');
    expect(screen.getByLabelText('Hourly Spot charges')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /charge|debit|confirm payment/i })).toBeNull();
  });

  it('renders account and order warning contexts but hides healthy records', () => {
    mocks.account.mockReturnValue({
      snapshot: { ...account(), credit: funding() },
      connected: true,
      query: query(),
    });
    renderTerminal(<SpotFundingAlerts />);
    expect(screen.getByText('Shared account Credit')).toBeInTheDocument();
    expect(screen.getByText('H100 · order-1')).toBeInTheDocument();
    expect(screen.queryByText(/Runtime and compute billing are paused/)).toBeNull();
  });

  it('does not announce a floating checkout policy unless explicitly enabled', () => {
    const view = renderTerminal(<SpotPricingNotice />);
    expect(view.container.textContent).toBe('');
    view.unmount();
    renderTerminal(<SpotPricingNotice available />);
    expect(screen.getByText(/Spot rates may change each hour/)).toBeInTheDocument();
  });

  it('does not solicit more funding for ended orders with historical low-funds flags', () => {
    mocks.account.mockReturnValue({
      snapshot: {
        ...account(),
        orders: [{ ...order(), runtimeState: 'ended' }],
      },
      connected: true,
      query: query(),
    });
    renderTerminal(<SpotFundingAlerts />);
    expect(screen.queryByLabelText('Spot funding alerts')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add credit' })).toBeNull();
    expect(screen.queryByText('H100 · order-1')).toBeNull();
  });
});
