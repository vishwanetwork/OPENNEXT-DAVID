'use client';

import { useWorkspaceStore } from '@/terminal-kit';
import { SellerActivitiesPage } from '@/features/seller';
import { SpotMarketPage } from '@/features/spot-market';

/** Legacy `pages.market`: sellers see Market Insight, buyers the Spot GPU market. */
export function MarketRoute() {
  const role = useWorkspaceStore((s) => s.role);
  return role === 'seller' ? <SellerActivitiesPage /> : <SpotMarketPage />;
}
