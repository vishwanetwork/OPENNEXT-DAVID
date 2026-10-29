import type { InstanceUsageService } from '@/lib/instance-usage';
import { confirmedUsage } from './usage';

export const instanceUsageApi = {
  async load(
    service: InstanceUsageService,
    accountId: string,
    instanceId: string,
    demo: boolean,
    signal?: AbortSignal,
  ) {
    const response = await service.load({ instanceId, signal });
    const snapshot = confirmedUsage(response, accountId, instanceId, demo);
    if (!snapshot)
      throw new Error('A confirmed usage record for this account and instance is required.');
    return snapshot;
  },
};
