'use client';

import { useCallback, useMemo } from 'react';
import type { MarketRow } from '@opennext/contracts';
import {
  useAccountIdentity,
  useMatches,
  usePublicMarket,
  useReferenceCatalog,
  useSettlements,
  useWorkspaceStore,
} from '@/terminal-kit';
import { emptyMarket, emptyReference, findRow, type MarketplaceView } from './exchange';

const SIGNED_OUT_PROMPT = 'Sign in to receive same-model recommendations.';

/** Marketplace records for the procurement views, assembled from the shared queries. */
export function useMarketplaceView(): MarketplaceView {
  const identity = useAccountIdentity();
  const publicMarket = usePublicMarket();
  const reference = useReferenceCatalog();
  const matches = useMatches();
  const settlements = useSettlements(90);
  return useMemo(() => {
    const market = publicMarket.data ?? emptyMarket();
    const signedIn = Boolean(identity);
    return {
      market,
      bestRows: signedIn ? (matches.data?.rows ?? []) : [],
      matchReason: signedIn ? matches.data?.reason || '' : 'No matches.',
      matchPrompt: signedIn ? matches.data?.submissionPrompt || '' : SIGNED_OUT_PROMPT,
      recentRows: settlements.data?.rows ?? [],
      referenceCatalog: reference.data ?? emptyReference(),
      loaded: publicMarket.isSuccess,
      error: publicMarket.error?.message || '',
    };
  }, [identity, publicMarket.data, publicMarket.isSuccess, publicMarket.error, matches.data, settlements.data, reference.data]);
}

/** Resolves a market row by id, including supply items saved to the cart / saved list. */
export function useFindMarketRow() {
  const view = useMarketplaceView();
  const cart = useWorkspaceStore((s) => s.cart);
  const saved = useWorkspaceStore((s) => s.saved);
  return useCallback(
    (id: string | null | undefined): MarketRow | null =>
      findRow(view, id, [...cart, ...saved] as unknown as { id: string; side?: string; kind?: string; originSupply?: unknown }[]),
    [view, cart, saved],
  );
}
