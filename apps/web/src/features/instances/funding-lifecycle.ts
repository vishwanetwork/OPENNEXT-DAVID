import type { Instance } from '@opennext/contracts';
import type { SpotFundingOrder } from '@/lib/spot-funding';
import { isSpot, lifecycle, type Lifecycle } from './lifecycle';

/** Only a validated, owner-bound hourly-billing snapshot can override a wall-clock expiry. */
export function fundingLifecycle(
  instance: Partial<Instance>,
  funding?: SpotFundingOrder | null,
): Lifecycle {
  if (
    (!funding || funding.instanceId !== instance.id) &&
    instance.pricingVersion === 'spot-hourly-v1'
  )
    return { label: 'Awaiting status', ended: false, connecting: false, running: false };
  if (!funding || !isSpot(instance) || funding.instanceId !== instance.id)
    return lifecycle(instance);
  const state = funding.runtimeState;
  return {
    label:
      state === 'paused_insufficient_funds'
        ? 'Paused — insufficient funds'
        : state === 'waiting'
          ? 'Waiting for capacity'
          : state === 'reconnecting'
            ? 'Reconnecting'
            : state === 'ended'
              ? 'End'
              : 'Running',
    ended: state === 'ended',
    connecting: state === 'reconnecting',
    running: state === 'running',
    waiting: state === 'waiting',
    paused: state === 'paused_insufficient_funds',
  };
}
