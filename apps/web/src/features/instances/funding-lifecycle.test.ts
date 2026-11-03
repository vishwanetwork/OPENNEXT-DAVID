import { describe, expect, it } from 'vitest';
import type { SpotFundingOrder } from '@/lib/spot-funding';
import { fundingLifecycle } from './funding-lifecycle';

const instance = {
  id: 'ins-1',
  term: 'Spot',
  status: 'Running',
  serviceEnd: '2020-01-01T00:00:00Z',
};
const funding = (runtimeState: SpotFundingOrder['runtimeState']): SpotFundingOrder => ({
  orderId: 'order-1',
  instanceId: 'ins-1',
  model: 'H100',
  paymentMethod: 'Credit',
  initialPaymentCents: 7200,
  initialHourlyCents: 100,
  currentHourlyCents: 125,
  purchasedSeconds: 72 * 3600,
  remainingSeconds: 20 * 3600,
  runtimeState,
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

describe('authoritative floating-price runtime', () => {
  it('does not pause at 20% or infer completion from an old wall-clock estimate', () => {
    expect(fundingLifecycle(instance, funding('running'))).toMatchObject({
      running: true,
      paused: false,
      ended: false,
    });
    expect(fundingLifecycle(instance)).toMatchObject({ ended: true });
  });
  it('keeps funding pauses separate from provider reconnection and completion', () => {
    expect(fundingLifecycle(instance, funding('paused_insufficient_funds'))).toMatchObject({
      label: 'Paused — insufficient funds',
      paused: true,
      connecting: false,
      ended: false,
      running: false,
    });
    expect(fundingLifecycle(instance, funding('reconnecting'))).toMatchObject({
      connecting: true,
      paused: false,
    });
    expect(fundingLifecycle(instance, funding('ended'))).toMatchObject({
      ended: true,
      paused: false,
    });
  });
  it('only overrides the matching Spot instance', () => {
    expect(fundingLifecycle({ ...instance, id: 'other' }, funding('running')).ended).toBe(true);
    expect(fundingLifecycle({ ...instance, term: 'On-demand' }, funding('running')).ended).toBe(
      true,
    );
  });
});
