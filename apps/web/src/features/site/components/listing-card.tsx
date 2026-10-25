'use client';

import { isCurated, isExchange, type Listing } from '../lib/listings';
import { CuratedCard } from './curated-card';
import { ExchangeCard } from './exchange-card';
import { CatalogCard } from './catalog-card';

export function ListingCard({
  item,
  index,
  total,
}: {
  item: Listing;
  index: number;
  total: number;
}) {
  if (isCurated(item)) return <CuratedCard item={item} index={index} total={total} />;
  if (isExchange(item)) return <ExchangeCard item={item} index={index} total={total} />;
  return <CatalogCard item={item} index={index} total={total} />;
}
