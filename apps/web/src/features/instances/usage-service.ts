'use client';

import { useMemo } from 'react';
import { useApi } from '@/components/providers/api-context';
import type { InstanceUsageService, InstanceUsageSnapshot } from '@/lib/instance-usage';

/** Instance usage through `/api/marketplace/instances/:id/usage`, verified by `confirmedUsage`. */
export function useInstanceUsageApiService(): InstanceUsageService {
  const api = useApi();
  return useMemo<InstanceUsageService>(
    () => ({
      load: ({ instanceId, signal }) =>
        api.get<InstanceUsageSnapshot>(
          `/api/marketplace/instances/${encodeURIComponent(instanceId)}/usage`,
          { signal },
        ),
    }),
    [api],
  );
}
