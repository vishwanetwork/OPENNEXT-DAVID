'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/components/providers/api-context';
import { useIsDemo, useSettlements as useSettlementTape } from '@/terminal-kit';
import {
  buildCatalog,
  countryFor,
  marketApi,
  marketKeys,
  useHistoryCatalog,
} from '@/features/market';
import {
  buildDemoSettlements,
  marketplaceSettlements,
  normalizeFilterRow,
  type FilterRow,
  type Settlement,
} from './settlements';
import { useSellerStore } from './store';

const DEMO_SETTLEMENTS = buildDemoSettlements();
const regionCountry = (region: unknown) =>
  countryFor(region) || (typeof region === 'string' ? region : null);

/** Settlement rows for the insight page: injected, Demo tape or connected marketplace records. */
export function useSettlements(): Settlement[] {
  const demo = useIsDemo();
  const injected = useSellerStore((s) => s.injected);
  const tape = useSettlementTape(90);
  return useMemo(() => {
    if (injected !== null) return injected;
    if (demo) return DEMO_SETTLEMENTS;
    return marketplaceSettlements(tape.data?.rows || [], regionCountry);
  }, [injected, demo, tape.data]);
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
