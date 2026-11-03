import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { json, mockFetch, renderTerminal, signIn } from '@/test/render';
import { useSessionStore } from '@/lib/session-store';
import { FloatingCheckout, type FloatingCheckoutProps } from './components/floating-checkout';

const openTransfer = vi.hoisted(() => vi.fn());
vi.mock('@/features/bank-transfer', () => ({ useOpenVerifiedBankTransfer: () => openTransfer }));
const envelope = {
  confirmed: true,
  pricingVersion: 'spot-hourly-v1',
  accountId: 'u1',
  demo: false,
  observedAt: '2026-11-03T12:00:00Z',
  currency: 'USD',
};
const quote = {
  ...envelope,
  quoteId: 'quote-1',
  offerId: 'offer-1',
  expiresAt: '2099-01-01T00:00:00Z',
  hourlyCents: 100,
  purchasedSeconds: 7200,
  paymentMethod: 'Credit',
  computeFundingCents: 200,
  storageReserveCents: 350,
  initialPaymentCents: 550,
  maxHourlyCents: 150,
  maxTotalCents: 1400,
  storageRetentionSeconds: 604800,
  protectedGiB: 100,
  storageMonthlyUsd: '0.15',
  serviceFeeCents: 0,
  inferencePresetId: null,
};
export const testOrder = {
  orderId: 'order-1',
  instanceId: null,
  model: 'L4',
  paymentMethod: 'Credit' as const,
  initialPaymentCents: 550,
  initialHourlyCents: 100,
  currentHourlyCents: null,
  purchasedSeconds: 7200,
  remainingSeconds: 7200,
  runtimeState: 'waiting' as const,
  retention: 'pending' as const,
  maxTotalCents: 1400,
  maxHourlyCents: 150,
  storageReserveCents: 350,
  funding: {
    cycleId: 'cycle-1',
    baselineCents: 200,
    remainingCents: 200,
    remainingPercent: 100,
    nextHourRequiredCents: null,
    projectedRemainingCents: null,
    status: 'unavailable' as const,
    warnings: [],
  },
};
const props = (): FloatingCheckoutProps => ({
  offerId: 'offer-1',
  durationHours: 2,
  hourlyCents: 100,
  sshPublicKey: null,
  inferenceBillingAcknowledged: false,
  idempotencyKey: 'purchase-1',
  onSubmission: vi.fn(),
  onComplete: vi.fn(),
  onBack: vi.fn(),
});
const acceptQuote = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Review current quote' }));
  await screen.findByRole('region', { name: 'Confirmed floating Spot quote' });
  for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
};
beforeEach(() => {
  signIn();
  openTransfer.mockReset();
  sessionStorage.clear();
});

describe('floating Spot purchase consent', () => {
  it('shows the server storage reserve and retries the exact authorization after a lost confirmation', async () => {
    const bodies: unknown[] = [];
    const config = props();
    mockFetch((path, init) => {
      if (path === '/api/billing/spot-quotes') return json(200, quote);
      if (path === '/api/billing/spot-purchases') {
        bodies.push(JSON.parse(String(init?.body)));
        return bodies.length === 1
          ? json(503, { error: 'Temporary failure' })
          : json(200, { ...envelope, order: testOrder });
      }
      return json(404, {});
    });
    renderTerminal(<FloatingCheckout {...config} />);
    expect(screen.getByRole('button', { name: 'Confirm Credit payment' })).toBeDisabled();
    await acceptQuote();
    expect(screen.getByText('$3.50')).toBeInTheDocument();
    expect(screen.getByText('$5.50')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Credit payment' }));
    await screen.findByRole('button', { name: 'Retry confirmation' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retry confirmation' })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry confirmation' }));
    await waitFor(() => expect(config.onComplete).toHaveBeenCalledWith('order-1', false));
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).toMatchObject({
      quoteId: 'quote-1',
      consent: true,
      storageRetentionAcknowledged: true,
    });
    expect(openTransfer).not.toHaveBeenCalled();
  });
  it('opens the dedicated Direct Pay intent without creating a second bank request', async () => {
    const config = props();
    const transfer = {
      confirmed: true,
      accountId: 'u1',
      demo: false,
      id: 'BT-1',
      purpose: 'order',
      currency: 'USD',
      amountCents: 550,
      idempotencyKey: 'initial',
      reference: 'ONX-1',
      expiresAt: '2099-01-01T00:00:00Z',
      status: 'Awaiting transfer',
      orderId: 'order-1',
    };
    const paths: string[] = [];
    mockFetch((path) => {
      paths.push(path);
      if (path === '/api/billing/spot-quotes')
        return json(200, { ...quote, paymentMethod: 'Direct Pay' });
      if (path === '/api/billing/spot-purchases')
        return json(200, {
          ...envelope,
          order: { ...testOrder, paymentMethod: 'Direct Pay' },
          transfer,
        });
      return json(404, {});
    });
    renderTerminal(<FloatingCheckout {...config} />);
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'Direct Pay' } });
    await acceptQuote();
    fireEvent.click(screen.getByRole('button', { name: 'Create bank transfer instructions' }));
    await waitFor(() => expect(openTransfer).toHaveBeenCalledWith(transfer));
    expect(config.onComplete).toHaveBeenCalledWith('order-1', true);
    expect(paths.some((p) => p.includes('bank-transfer-intents'))).toBe(false);
  });
  it('does not publish another account’s late result after a session change', async () => {
    const config = props();
    let resolve: (value: Response) => void = () => undefined;
    mockFetch((path) =>
      path === '/api/billing/spot-quotes'
        ? new Promise<Response>((done) => {
            resolve = done;
          })
        : json(404, {}),
    );
    renderTerminal(<FloatingCheckout {...config} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review current quote' }));
    await act(async () => {
      useSessionStore.getState().setUser(null);
      resolve(json(200, quote));
    });
    expect(
      screen.queryByRole('region', { name: 'Confirmed floating Spot quote' }),
    ).not.toBeInTheDocument();
    expect(config.onSubmission).not.toHaveBeenCalled();
  });
  it('replays a saved acceptance without generating a replacement quote', async () => {
    const config = props();
    config.acceptance = {
      pricingVersion: 'spot-hourly-v1',
      quoteId: 'old-quote',
      idempotencyKey: 'purchase-1',
      consent: true,
      storageRetentionAcknowledged: true,
      inferenceBillingAcknowledged: false,
      sshPublicKey: null,
    };
    const paths: string[] = [];
    mockFetch((path) => {
      paths.push(path);
      return json(200, { ...envelope, order: testOrder });
    });
    renderTerminal(<FloatingCheckout {...config} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry confirmation' }));
    await waitFor(() => expect(config.onComplete).toHaveBeenCalledWith('order-1', false));
    expect(paths).toContain('/api/billing/spot-purchases');
    expect(paths).not.toContain('/api/billing/spot-quotes');
    expect(config.onSubmission).toHaveBeenCalledWith(config.acceptance);
  });
});
