'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SellerSettlementsResponse } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { useApp } from '@/components/providers/app-context';
import { useSessionStore } from '@/lib/session-store';
import { marketApi } from '@/features/market/api';
import { marketKeys, useHistoryCatalog } from '@/features/market/hooks';
import { buildCatalog, countryFor } from '@/features/market/insight-index';
import {
  buildDemoSettlements,
  marketplaceSettlements,
  normalizeFilterRow,
  type FilterRow,
  type Settlement,
} from './settlements';
import { useSellerStore } from './store';

export const sellerKeys = { settlements: ['marketplace', 'settlements', 90] as const };

const DEMO_SETTLEMENTS = buildDemoSettlements();
const regionCountry = (region: unknown) =>
  countryFor(region) || (typeof region === 'string' ? region : null);

/** Anonymized settlement tape (GET /api/marketplace/settlements?days=90), windowed locally. */
export function useSettlementTape() {
  const api = useApi();
  return useQuery({
    queryKey: sellerKeys.settlements,
    queryFn: async () =>
      SellerSettlementsResponse.parse(await api.get('/api/marketplace/settlements?days=90')),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

/** Settlement rows for the insight page: injected, Demo tape or connected marketplace records. */
export function useSettlements(): Settlement[] {
  const { demo } = useApp();
  const user = useSessionStore((s) => s.user);
  const injected = useSellerStore((s) => s.injected);
  const tape = useSettlementTape();
  return useMemo(() => {
    if (injected !== null) return injected;
    if (demo || user?.demo) return DEMO_SETTLEMENTS;
    return marketplaceSettlements(tape.data?.rows || [], regionCountry);
  }, [injected, demo, user?.demo, tape.data]);
}

/** Verified catalog rows the price index contributes to the shared filters (legacy `indexFilterRows`). */
export function useIndexFilterRows(): FilterRow[] {
  const api = useApi();
  const catalogQuery = useHistoryCatalog();
  const rawQuery = useQuery({
    queryKey: marketKeys.imported('period=1D&unit=gpu'),
    queryFn: () => marketApi.importedHistory(api, 'period=1D&unit=gpu'),
    staleTime: 300_000,
    retry: false,
  });
  return useMemo(
    () =>
      buildCatalog(catalogQuery.data, rawQuery.data)
        .rows.map(normalizeFilterRow)
        .filter((row): row is FilterRow => Boolean(row)),
    [catalogQuery.data, rawQuery.data],
  );
}
