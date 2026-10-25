'use client';

import { useWorkspaceStore } from '@/features/terminal/store';
import { SellerActivitiesPage } from '@/features/seller/components/SellerActivitiesPage';
import { SpotMarketPage } from './SpotMarketPage';

/** Legacy `pages.market`: sellers see Market Insight, buyers the Spot GPU market. */
export function MarketRoute() {
  const role = useWorkspaceStore((s) => s.role);
  return role === 'Seller' ? <SellerActivitiesPage /> : <SpotMarketPage />;
}
