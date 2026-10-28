'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/components/providers/api-context';
import type { InstanceLifecycleAdapter } from '@/terminal-kit';
import { instancesApi } from './api';

/** Ending instances through the backend, for the composition root (`services.instanceLifecycle`). */
export function useInstanceLifecycleService(): InstanceLifecycleAdapter {
  const api = useApi();
  return useMemo(() => ({ end: ({ instanceId }) => instancesApi.end(api, instanceId) }), [api]);
}

export const instanceKeysKey = (id: string) => ['instance', 'ssh-keys', id] as const;

/** Keys on one instance; polls while the server has not installed the latest set. */
export function useInstanceKeys(id: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: instanceKeysKey(id),
    queryFn: ({ signal }) => instancesApi.sshKeys(api, id, signal),
    enabled,
    retry: false,
    refetchInterval: (query) => (query.state.data && !query.state.data.installed ? 5000 : false),
  });
}

/** Replaces the instance's keys and stores the server's answer. */
export function useSetInstanceKeys(id: string) {
  const api = useApi();
  const client = useQueryClient();
  return async (keys: string[]) => {
    const result = await instancesApi.setSshKeys(api, id, keys);
    client.setQueryData(instanceKeysKey(id), result);
    return result;
  };
}
