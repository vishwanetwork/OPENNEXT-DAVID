'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/api/query-keys';
import { useSessionStore } from '@/lib/session-store';
import { useAccountIdentity, useIsDemo, useTerminalSlots } from '@/terminal-kit';
import { buyerKybApi, confirmedKybSnapshot } from './api';

export function useBuyerKyb() {
  const user = useSessionStore((state) => state.user);
  const sessionStatus = useSessionStore((state) => state.status);
  const identity = useAccountIdentity();
  const demo = useIsDemo();
  const service = useTerminalSlots().services.buyerKyb;
  const connected = Boolean(
    typeof service?.load === 'function' &&
      typeof service?.submit === 'function' &&
      identity &&
      sessionStatus === 'verified' &&
      !demo &&
      user?.role === 'buyer',
  );
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    return () => {
      generation.current += 1;
    };
  }, [identity, demo, service, connected]);
  const accountId = user?.id ?? '';
  const query = useQuery({
    queryKey: queryKeys.account.buyerKyb(identity),
    queryFn: ({ signal }) => {
      if (!service || !connected) throw new Error('Secure Buyer KYB is not connected yet.');
      return buyerKybApi.load(service, accountId, demo, signal);
    },
    enabled: connected,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: (state) =>
      state.state.data?.verification?.status === 'Reviewing' ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  const snapshot =
    connected && query.isSuccess && !query.isError
      ? confirmedKybSnapshot(query.data, accountId, demo)
      : null;
  const approved = snapshot?.verification?.status === 'Approved';
  const refreshApproved = useCallback(async () => {
    if (!connected || !service) return false;
    const requestGeneration = generation.current;
    const result = await query.refetch();
    const current = useSessionStore.getState();
    if (
      generation.current !== requestGeneration ||
      current.status !== 'verified' ||
      current.user?.id !== accountId ||
      Boolean(current.user?.demo) ||
      current.user?.role !== 'buyer' ||
      !current.user.onboardingCompleted
    )
      return false;
    return (
      !result.isError &&
      confirmedKybSnapshot(result.data, accountId, demo)?.verification?.status === 'Approved'
    );
  }, [accountId, connected, demo, query, service]);
  return {
    query,
    approved,
    connected,
    snapshot,
    service,
    identity,
    accountId,
    demo,
    refreshApproved,
  };
}
