import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { SpotFundingOrder } from '@/lib/spot-funding';
import { json, mockFetch, renderTerminal, signIn } from '@/test/render';
import { OrderFundingActions } from './components/order-funding-actions';

const openTransfer = vi.hoisted(() => vi.fn());
vi.mock('@/features/bank-transfer', () => ({ useOpenVerifiedBankTransfer: () => openTransfer }));
const order: SpotFundingOrder = {
  orderId: 'order-1',
  instanceId: 'instance-1',
  model: 'L4',
  paymentMethod: 'Credit',
  initialPaymentCents: 550,
  initialHourlyCents: 100,
  currentHourlyCents: 150,
  purchasedSeconds: 7200,
  remainingSeconds: 3600,
  runtimeState: 'paused_insufficient_funds',
  retention: 'confirmed',
  maxTotalCents: 1400,
  funding: {
    cycleId: 'cycle-1',
    baselineCents: 200,
    remainingCents: 50,
    remainingPercent: 25,
    nextHourRequiredCents: 150,
    projectedRemainingCents: 150,
    status: 'insufficient',
    warnings: ['next_hour_unfunded'],
  },
};
const envelope = {
  confirmed: true,
  pricingVersion: 'spot-hourly-v1',
  accountId: 'u1',
  demo: false,
  observedAt: '2026-11-03T12:00:00Z',
  currency: 'USD',
};
beforeEach(() => {
  signIn();
  openTransfer.mockReset();
  sessionStorage.clear();
});

describe('order-linked funding', () => {
  it('retains a Credit allocation key across a lost response and component remount', async () => {
    const bodies: unknown[] = [];
    mockFetch((path, init) => {
      if (path.endsWith('/replenishments')) {
        bodies.push(JSON.parse(String(init?.body)));
        return bodies.length === 1
          ? json(503, { error: 'Retry later' })
          : json(200, { ...envelope, order });
      }
      return json(404, {});
    });
    const first = renderTerminal(<OrderFundingActions order={order} />);
    fireEvent.click(screen.getByRole('button', { name: 'Allocate Credit' }));
    await screen.findByRole('alert');
    first.unmount();
    renderTerminal(<OrderFundingActions order={order} />);
    expect(screen.getByLabelText('Amount (USD)')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry funding confirmation' }));
    await screen.findByText(
      'Credit allocated. The Agent will check funding and recovery readiness.',
    );
    expect(bodies[0]).toEqual(bodies[1]);
    expect(openTransfer).not.toHaveBeenCalled();
  });
  it('opens only the matching Direct Pay receipt and never adds shared Credit', async () => {
    const transfer = {
      confirmed: true,
      accountId: 'u1',
      demo: false,
      id: 'BT-1',
      purpose: 'order',
      currency: 'USD',
      amountCents: 100,
      idempotencyKey: 'allocation-1',
      reference: 'ONX-1',
      expiresAt: '2099-01-01T00:00:00Z',
      status: 'Awaiting transfer',
      orderId: 'order-1',
    };
    const paths: string[] = [];
    mockFetch((path) => {
      paths.push(path);
      return path.endsWith('/replenishments')
        ? json(200, { ...envelope, transfer })
        : json(404, {});
    });
    renderTerminal(<OrderFundingActions order={{ ...order, paymentMethod: 'Direct Pay' }} />);
    expect(screen.queryByRole('button', { name: 'Add Credit' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create order bank transfer' }));
    await waitFor(() => expect(openTransfer).toHaveBeenCalledWith(transfer));
    expect(paths.filter((p) => p.endsWith('/replenishments'))).toEqual([
      '/api/billing/spot-orders/order-1/replenishments',
    ]);
  });
  it('rejects a bank receipt linked to a different order', async () => {
    mockFetch((path) =>
      path.endsWith('/replenishments')
        ? json(200, {
            ...envelope,
            transfer: {
              confirmed: true,
              accountId: 'u1',
              demo: false,
              id: 'BT-wrong',
              purpose: 'order',
              currency: 'USD',
              amountCents: 100,
              idempotencyKey: 'allocation-1',
              reference: 'ONX-wrong',
              expiresAt: '2099-01-01T00:00:00Z',
              status: 'Awaiting transfer',
              orderId: 'another-order',
            },
          })
        : json(404, {}),
    );
    renderTerminal(<OrderFundingActions order={{ ...order, paymentMethod: 'Direct Pay' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create order bank transfer' }));
    await screen.findByText('The funding receipt could not be matched to your order.');
    expect(openTransfer).not.toHaveBeenCalled();
  });
});
