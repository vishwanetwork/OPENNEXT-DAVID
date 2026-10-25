'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useApi } from '@/components/providers/api-context';
import { fetchCuratedRfqs, fetchPublicMarket, fetchShowcase, fetchTickerHistory } from './api';
import { validTickerRows } from './lib/ticker';

export function useCuratedRfqs() {
  const api = useApi();
  return useQuery({
    queryKey: ['site', 'curated-rfqs'],
    queryFn: () => fetchCuratedRfqs(api),
    staleTime: Infinity,
    retry: false,
  });
}

export function usePublicMarket() {
  const api = useApi();
  return useQuery({
    queryKey: ['marketplace', 'public'],
    queryFn: () => fetchPublicMarket(api),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** The showcase is only fetched when no approved rental lanes exist (legacy `loadShowcase`). */
export function useShowcase(enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['site', 'showcase'],
    queryFn: () => fetchShowcase(api),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
}

export function useTickerHistory() {
  const api = useApi();
  return useQuery({
    queryKey: ['pricing', 'ticker', '1W'],
    queryFn: async () => validTickerRows(await fetchTickerHistory(api)),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    retry: false,
  });
}
