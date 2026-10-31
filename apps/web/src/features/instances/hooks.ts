'use client';

import { useCallback, useMemo } from 'react';
import type { InstanceAutopilotRequest, InstanceAutopilotResponse } from '@opennext/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/components/providers/api-context';
import type { InstanceLifecycleAdapter } from '@/terminal-kit';
import { instancesApi } from './api';
import { useSessionStore } from '@/lib/session-store';
import { queryKeys } from '@/lib/api/query-keys';
import { useAccountIdentity, useIsDemo, useTerminalSlots } from '@/terminal-kit';
import { instanceUsageApi } from './usage-api';
import { confirmedUsage } from './usage';
import { loadUsage } from './request-queue';

/** Ending instances through the backend, for the composition root (`services.instanceLifecycle`). */
export function useInstanceLifecycleService(): InstanceLifecycleAdapter {
  const api = useApi();
  return useMemo(() => ({ end: ({ instanceId }) => instancesApi.end(api, instanceId) }), [api]);
}

export const instanceKeysKey = (id: string) => ['instance', 'ssh-keys', id] as const;

/** Refresh foreground instance state without refetching the entire public marketplace. */
export function useRefreshInstance(id?: string) {
  const client = useQueryClient();
  const identity = useAccountIdentity();
  return useCallback(async () => {
    await Promise.all([
      client.invalidateQueries(
        { queryKey: queryKeys.account.workspace(identity), exact: true },
        { throwOnError: true },
      ),
      client.invalidateQueries(
        { queryKey: queryKeys.account.billing(identity), exact: true },
        { throwOnError: true },
      ),
      ...(id
        ? [
            client.invalidateQueries(
              {
                queryKey: queryKeys.account.instanceUsage(identity, id),
                exact: true,
              },
              { throwOnError: true },
            ),
            client.invalidateQueries(
              { queryKey: instanceAutopilotKey(id, identity), exact: true },
              { throwOnError: true },
            ),
          ]
        : []),
    ]);
  }, [client, identity, id]);
}

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

export const instanceAutopilotKey = (id: string, identity = '') =>
  ['account', 'autopilot', identity, id] as const;

const autopilotQuery = (api: ReturnType<typeof useApi>, id: string, identity: string) => ({
  queryKey: instanceAutopilotKey(id, identity),
  queryFn: ({ signal }: { signal: AbortSignal }) => instancesApi.autopilot(api, id, signal),
  staleTime: 15_000,
  gcTime: 30 * 60_000,
});

export function usePrefetchAutopilot() {
  const api = useApi();
  const client = useQueryClient();
  const identity = useAccountIdentity();
  return (id: string) =>
    identity ? client.prefetchQuery(autopilotQuery(api, id, identity)) : Promise.resolve();
}

const SETTLED = new Set(['none', 'succeeded', 'failed', 'stopped']);

/** The instance's autopilot task; polls while it waits or runs. */
export function useInstanceAutopilot(id: string, enabled: boolean) {
  const api = useApi();
  const identity = useAccountIdentity();
  return useQuery({
    ...autopilotQuery(api, id, identity),
    enabled: enabled && Boolean(identity),
    refetchOnMount: 'always',
    retry: false,
    refetchInterval: (query) => {
      const state = query.state.data?.status?.state;
      return state && !SETTLED.has(state) ? 15_000 : false;
    },
  });
}

/** Save, remove and stop actions that store the server's answer. */
export function useAutopilotActions(id: string) {
  const api = useApi();
  const client = useQueryClient();
  const identity = useAccountIdentity();
  const store = <T extends InstanceAutopilotResponse>(result: T) => {
    client.setQueryData(instanceAutopilotKey(id, identity), result);
    return result;
  };
  return {
    save: (body: InstanceAutopilotRequest) => instancesApi.setAutopilot(api, id, body).then(store),
    remove: () => instancesApi.removeAutopilot(api, id).then(store),
    stop: () => instancesApi.stopAutopilot(api, id).then(store),
  };
}

export function useInstanceUsage(
  instanceId: string,
  options: { enabled?: boolean; live?: boolean } = {},
) {
  const accountId = useSessionStore((state) => state.user?.id ?? '');
  const verified = useSessionStore((state) => state.status === 'verified');
  const identity = useAccountIdentity();
  const demo = useIsDemo();
  const service = useTerminalSlots().services.instanceUsage;
  const connected = Boolean(verified && accountId && instanceId && service && !demo);
  const query = useQuery({
    queryKey: queryKeys.account.instanceUsage(identity, instanceId),
    queryFn: ({ signal }) => {
      if (!service || !connected) throw new Error('Instance usage history is not connected yet.');
      return loadUsage(
        () => instanceUsageApi.load(service, accountId, instanceId, demo, signal),
        signal,
      );
    },
    enabled: connected && options.enabled !== false,
    gcTime: 10 * 60_000,
    staleTime: 60_000,
    retry: false,
    refetchInterval: options.live === false ? false : 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const snapshot =
    connected && query.data ? confirmedUsage(query.data, accountId, instanceId, demo) : null;
  return { snapshot, query, connected };
}
