'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { NewsResponse } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { marketApi } from './api';
import { BASE_REGIONS, mergeRegions, type Region } from './catalog';

export const marketKeys = {
  prices: ['market', 'prices'] as const,
  catalog: ['market', 'history-catalog'] as const,
  history: (query: string) => ['market', 'history', query] as const,
  regional: (query: string) => ['market', 'regional-history', query] as const,
  imported: (query: string) => ['market', 'imported-history', query] as const,
  news: ['market', 'news'] as const,
};

/** Collected provider prices. Failures keep the last snapshot (never replaced with generated values). */
export function usePrices() {
  const api = useApi();
  return useQuery({
    queryKey: marketKeys.prices,
    queryFn: () => marketApi.prices(api),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useHistoryCatalog() {
  const api = useApi();
  return useQuery({
    queryKey: marketKeys.catalog,
    queryFn: () => marketApi.historyCatalog(api),
    staleTime: 5 * 60_000,
  });
}

/** Region list with readable names from the history catalog merged in. */
export function useRegions(): Region[] {
  const catalog = useHistoryCatalog();
  return useMemo(() => mergeRegions(BASE_REGIONS, catalog.data?.regions), [catalog.data]);
}

/** Regional price history for the current selection; refreshes while visible, faster while the backend is syncing. */
export function useRegionalHistory(query: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: marketKeys.regional(query),
    queryFn: () => marketApi.regionalHistory(api, query),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.meta?.syncing ? 5_000 : 30_000),
    refetchIntervalInBackground: false,
  });
}

export const UNAVAILABLE_NEWS: NewsResponse = { status: 'unavailable', stale: true, articles: [] };

/** Official GPU news. Hourly refresh; failures keep the previous snapshot and mark it stale. */
export function useNews() {
  const api = useApi();
  return useQuery({
    queryKey: marketKeys.news,
    queryFn: () => marketApi.news(api),
    staleTime: 3_600_000,
    refetchInterval: 3_600_000,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    retry: false,
  });
}
