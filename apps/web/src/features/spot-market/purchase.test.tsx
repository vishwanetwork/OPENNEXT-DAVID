import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { json, mockFetch, renderTerminal, signIn, testQueryClient } from '@/test/render';
import { signedAgreementFixture } from '@/test/spot-agreement-fixture';
import type { SpotAgreementService } from '@/lib/spot-agreement';
import { useWorkspaceStore } from '@/terminal-kit';
import { CHECKOUT_MODALS, durationHours, type SpotCheckout } from './checkout';
import { spotCheckoutModals } from './components/checkout-modals';
import type { SpotRow } from './inventory';
import { serviceFixture } from '@/features/buyer-kyb/test-fixtures';
import { SpotCheckoutProvider, useSpotCheckout, useSpotInventory } from './hooks';
import { CreditConfirmBody } from './components/checkout-bodies';

const offer = {
  id: 'spotbot-us-west-2-g6.xlarge',
  kind: 'rental',
  side: 'supply',
  term: 'Spot',
  model: 'L4',
  title: '1 × L4',
  region: 'us-west-2',
  gpuCount: 1,
  vcpu: 4,
  memory: 24,
  perGpuHourly: 0.39,
  listedAt: '2026-10-28T01:00:00+00:00',
  status: 'Published',
  serverRecord: true,
  agentStatus: 'Succeeded',
};
const seen: { engine?: SpotCheckout; rows: SpotRow[] } = { rows: [] };
function Probe() {
  const inventory = useSpotInventory();
  const engine = useSpotCheckout(inventory);
  useEffect(() => {
    seen.engine = engine;
    seen.rows = inventory.rows;
  });
  return null;
}
function agreementPort() {
  return {
    prepare: vi.fn<SpotAgreementService['prepare']>(),
    sign: vi.fn<SpotAgreementService['sign']>(),
    purchaseByCredit: vi
      .fn<SpotAgreementService['purchaseByCredit']>()
      .mockImplementation(async ({ agreement, purchase }) => ({
        confirmed: true,
        agreementId: agreement.agreementId,
        offerId: purchase.offerId,
        orderId: 'rental-1',
        currency: 'USD',
        durationHours: purchase.durationHours,
        totalCents: purchase.expectedPricing.totalCents,
      })),
    createBankTransfer: vi.fn<SpotAgreementService['createBankTransfer']>(),
    download: vi.fn<SpotAgreementService['download']>(),
  };
}
function readApi() {
  return mockFetch((path) => {
    if (path.includes('/api/marketplace/public')) return json(200, { rfqs: [], supplies: [offer] });
    if (path.includes('/api/billing/account'))
      return json(200, {
        confirmed: true,
        accountId: 'u1',
        currency: 'USD',
        availableCredit: 100,
        paidCredit: 0,
        promotionalCredit: 100,
      });
    return json(200, {});
  });
}
function buyer() {
  signIn();
  useWorkspaceStore.getState().applySession({
    id: 'u1',
    email: 'ada@example.com',
    role: 'buyer',
    onboardingCompleted: true,
  } as never);
}
async function review() {
  await waitFor(() => expect(seen.rows.map((row) => row.id)).toEqual([offer.id]));
  const engine = seen.engine;
  const row = seen.rows[0];
  if (!engine || !row) throw new Error('Expected checkout engine and offer');
  act(() => engine.beginCheckout(row));
  await act(async () => engine.reviewPurchase({ durationHours: '2', sshPublicKey: '' }));
  return engine;
}
async function signAndChooseCredit(engine: SpotCheckout) {
  act(() => engine.recordAgreement(signedAgreementFixture(engine.agreementContext('credit'))));
  await act(async () => engine.chooseCredit());
}

describe('agreement-linked Spot purchase', () => {
  it('shows payment progress while uncertain and blocks duplicate confirmation', async () => {
    const gate =
      Promise.withResolvers<Awaited<ReturnType<SpotAgreementService['purchaseByCredit']>>>();
    const service = agreementPort();
    service.purchaseByCredit.mockImplementation(() => gate.promise);
    const api = readApi();
    buyer();
    renderTerminal(
      <SpotCheckoutProvider>
        <Probe />
        <CreditConfirmBody />
      </SpotCheckoutProvider>,
      {
        workspace: {},
        billing: { availableCredit: 100, promotionalCredit: 100 },
        slots: {
          services: {
            buyerKyb: serviceFixture('Approved'),
            spotAgreementRequired: true,
            spotAgreement: service,
          },
        },
      },
    );
    const engine = await review();
    await signAndChooseCredit(engine);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Credit payment' }));
    expect(
      await screen.findByText('Confirming your payment and order. Please wait…'),
    ).toBeInTheDocument();
    await waitFor(() => expect(service.purchaseByCredit).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Confirm Credit payment' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Credit payment' }));
    expect(service.purchaseByCredit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/OpenNEXT Fee 5%/)).not.toBeInTheDocument();
    expect(screen.getAllByText('$0.78')).toHaveLength(2);
    await act(async () =>
      gate.resolve({
        confirmed: true,
        agreementId: 'agreement-1',
        offerId: offer.id,
        orderId: 'rental-1',
        currency: 'USD',
        durationHours: 2,
        totalCents: 78,
      }),
    );
    await waitFor(() => expect(engine.pending()?.stage).toBe('completed'));
    expect(
      api.mock.calls.some(([path]) => String(path).includes('/api/marketplace/spot-purchases')),
    ).toBe(false);
  });
  it('orders at least one hour, since usage has a 1-hour minimum', () => {
    expect(durationHours('1')).toBe(1);
    expect(durationHours('2.25')).toBe(2.25);
    for (const value of ['0.5', '0.99', '0', '1.005', 'x'])
      expect(() => durationHours(value)).toThrow('at least 1 hour');
  });
  it('registers a dialog for every checkout step including the agreement', () => {
    expect(Object.keys(spotCheckoutModals).sort()).toEqual([...CHECKOUT_MODALS].sort());
  });
  it('uses the signed-payment capability with the immutable agreement and refreshes Instances', async () => {
    const service = agreementPort();
    const api = readApi();
    buyer();
    const queryClient = testQueryClient();
    renderTerminal(
      <SpotCheckoutProvider>
        <Probe />
      </SpotCheckoutProvider>,
      {
        billing: { availableCredit: 100, promotionalCredit: 100 },
        workspace: {},
        queryClient,
        slots: {
          services: {
            buyerKyb: serviceFixture('Approved'),
            spotAgreementRequired: true,
            spotAgreement: service,
          },
        },
      },
    );
    const engine = await review();
    await act(async () => engine.chooseCredit());
    expect(useWorkspaceStore.getState().modal?.type).toBe('spot-agreement');
    expect(service.purchaseByCredit).not.toHaveBeenCalled();
    await signAndChooseCredit(engine);
    await act(async () => engine.authorizeCredit());
    expect(engine.pending()?.error).toBe('');
    expect(service.purchaseByCredit).toHaveBeenCalledTimes(1);
    expect(service.purchaseByCredit.mock.calls[0]?.[0]).toEqual({
      agreement: expect.objectContaining({
        agreementId: 'agreement-1',
        executionComplete: true,
        context: expect.objectContaining({
          accountId: 'u1',
          offerId: offer.id,
          paymentMethod: 'credit',
        }),
      }),
      purchase: {
        pricingVersion: 'duration-v1',
        offerId: offer.id,
        durationHours: 2,
        expectedPricing: {
          currency: 'USD',
          durationHours: 2,
          hourlyCents: 39,
          baseCents: 78,
          feeCents: 0,
          totalCents: 78,
        },
        sshPublicKey: null,
        idempotencyKey: expect.any(String),
      },
    });
    expect(
      api.mock.calls.some(([path]) => String(path).includes('/api/marketplace/spot-purchases')),
    ).toBe(false);
    expect(engine.pending()?.stage).toBe('completed');
    expect(engine.pending()?.orderId).toBe('rental-1');
    const workspace = queryClient.getQueryCache().findAll({ queryKey: ['account', 'workspace'] });
    expect(workspace.length).toBeGreaterThan(0);
    expect(workspace.every((query) => query.state.isInvalidated)).toBe(true);
    act(() => engine.action('spot-checkout-instances'));
    expect(useWorkspaceStore.getState().modal).toBeNull();
  });
  it('never falls back to the legacy purchase endpoint when agreement payments are unavailable', async () => {
    const api = readApi();
    buyer();
    renderTerminal(
      <SpotCheckoutProvider>
        <Probe />
      </SpotCheckoutProvider>,
      {
        billing: { availableCredit: 100 },
        workspace: {},
        slots: { services: { buyerKyb: serviceFixture('Approved'), spotAgreementRequired: true } },
      },
    );
    const engine = await review();
    await signAndChooseCredit(engine);
    await act(async () => engine.authorizeCredit());
    expect(engine.pending()?.error).toMatch(/Agreement-linked payment is not connected/);
    expect(engine.pending()?.stage).not.toBe('completed');
    expect(engine.pending()?.paymentSubmitted).toBe(false);
    await act(async () => engine.authorizeCredit());
    expect(engine.pending()?.paymentSubmitted).toBe(false);
    act(() => engine.action('spot-checkout-review'));
    expect(engine.pending()?.stage).toBe('review');
    expect(
      api.mock.calls.some(([path]) => String(path).includes('/api/marketplace/spot-purchases')),
    ).toBe(false);
  });
});
