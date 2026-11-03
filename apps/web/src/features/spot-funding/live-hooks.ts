'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/components/providers/api-context';
import { ApiError } from '@/lib/api/client';
import { useSessionStore } from '@/lib/session-store';
import type { SpotFundingService } from '@/lib/spot-funding';
import { useAccountIdentity, useIsDemo } from '@/terminal-kit';
import { liveSpotFundingApi } from './live-api';

export function useFloatingCapabilities() {
  const api = useApi();
  const identity = useAccountIdentity();
  const demo = useIsDemo();
  const user = useSessionStore((s) => s.user);
  const verified = useSessionStore((s) => s.status === 'verified');
  const eligible = verified && user?.role === 'buyer' && !demo && !user.demo;
  const scope = useMemo(
    () => `${identity}:${api.demo ? 'demo' : 'live'}:${crypto.randomUUID()}`,
    [api, identity],
  );
  const accountId = user?.id ?? '';
  const query = useQuery({
    queryKey: ['account', 'spot-funding-capabilities', identity, scope],
    queryFn: async ({ signal }) => {
      try {
        const result = await liveSpotFundingApi.capabilities(api, signal);
        if (result.accountId !== accountId) throw new Error('The funding account changed.');
        return result;
      } catch (cause) {
        // An older adapter has no capability endpoint. Service failures do not
        // silently authorize a legacy purchase without the required consent.
        if (cause instanceof ApiError && cause.status === 404)
          return { enabled: false, readEnabled: false, required: false };
        throw cause;
      }
    },
    enabled: eligible,
    retry: false,
    staleTime: 30_000,
    gcTime: 0,
  });
  return {
    api,
    scope,
    query,
    eligible,
    accountId,
    enabled: eligible && query.data?.enabled === true,
  };
}

export function useLiveSpotFundingService(): SpotFundingService | undefined {
  const { api, scope, query, eligible } = useFloatingCapabilities();
  const connected = eligible && Boolean(query.data?.enabled || query.data?.readEnabled);
  return useMemo(
    () =>
      connected
        ? {
            scope,
            loadAccount: ({ signal }) => liveSpotFundingApi.account(api, signal),
            loadOrder: (input) =>
              'orderId' in input
                ? liveSpotFundingApi.order(api, input.orderId, input.cursor, input.signal)
                : liveSpotFundingApi.instance(api, input.instanceId, input.cursor, input.signal),
          }
        : undefined,
    [api, scope, connected],
  );
}
