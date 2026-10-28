import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { json, mockFetch, renderTerminal, signIn, testQueryClient } from '@/test/render';
import { useWorkspaceStore } from '@/terminal-kit';
import { CHECKOUT_MODALS, type SpotCheckout } from './checkout';
import { spotCheckoutModals } from './components/checkout-modals';
import type { SpotRow } from './inventory';
import { SpotCheckoutProvider, useSpotCheckout, useSpotInventory } from './hooks';

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

describe('Spot purchase', () => {
  it('registers a dialog for every checkout step the engine opens', () => {
    expect(Object.keys(spotCheckoutModals).sort()).toEqual([...CHECKOUT_MODALS].sort());
  });
  it('Buy Now sends the confirmed purchase to the backend and shows the order', async () => {
    const posts: { body: unknown; headers: Record<string, string> }[] = [];
    mockFetch((path, init) => {
      if (path.includes('/api/marketplace/public'))
        return json(200, { rfqs: [], supplies: [offer] });
      if (path.includes('/api/billing/account'))
        return json(200, {
          confirmed: true,
          accountId: 'u1',
          currency: 'USD',
          availableCredit: 100,
          paidCredit: 0,
          promotionalCredit: 100,
        });
      if (path.includes('/api/marketplace/spot-purchases')) {
        const body = JSON.parse(String(init?.body)) as { durationHours: number };
        posts.push({ body, headers: init?.headers as Record<string, string> });
        return json(200, {
          confirmed: true,
          offerId: offer.id,
          orderId: 'rental-1',
          currency: 'USD',
          durationHours: body.durationHours,
          totalCents: 82,
        });
      }
      return json(200, {});
    });
    signIn();
    const queryClient = testQueryClient();
    useWorkspaceStore.getState().applySession({
      id: 'u1',
      email: 'ada@example.com',
      role: 'buyer',
      onboardingCompleted: true,
    } as never);
    renderTerminal(
      <SpotCheckoutProvider>
        <Probe />
      </SpotCheckoutProvider>,
      { billing: { availableCredit: 100, promotionalCredit: 100 }, workspace: {}, queryClient },
    );
    await waitFor(() => expect(seen.rows.map((row) => row.id)).toEqual([offer.id]));
    expect(seen.rows[0]?.sourceKind).toBe('agent');
    act(() => seen.engine!.beginCheckout(seen.rows[0]!));
    // The key is checked by the backend; jsdom's SubtleCrypto cannot fingerprint keys here.
    await act(() => seen.engine!.reviewPurchase({ durationHours: '2', sshPublicKey: '' }));
    await act(() => seen.engine!.chooseCredit());
    await act(() => seen.engine!.authorizeCredit());
    expect(seen.engine!.pending()?.error).toBe('');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({
      pricingVersion: 'duration-v1',
      offerId: offer.id,
      durationHours: 2,
      expectedPricing: {
        currency: 'USD',
        durationHours: 2,
        hourlyCents: 39,
        baseCents: 78,
        feeCents: 4,
        totalCents: 82,
      },
      sshPublicKey: null,
      idempotencyKey: expect.any(String),
    });
    expect(posts[0]?.headers['X-CSRF-Token']).toBe('csrf');
    expect(seen.engine!.pending()?.stage).toBe('completed');
    expect(seen.engine!.pending()?.orderId).toBe('rental-1');
    // The workspace (and with it Instances) is refreshed for the new order.
    const workspace = queryClient.getQueryCache().findAll({ queryKey: ['account', 'workspace'] });
    expect(workspace.length).toBeGreaterThan(0);
    expect(workspace.every((query) => query.state.isInvalidated)).toBe(true);
  });
});
