import type { CuratedRfq, MarketplaceListing, PublicMarketResponse } from '@opennext/contracts';
import { CATALOG_GROUPS, MARKET_KINDS, type CatalogItem, type MarketKind } from '../data/catalog';
import type { ShowcaseLanes } from '../api';

export type MarketSide = 'supply' | 'demand';

/** A curated customer requirement (demand lane only). */
export type CuratedListing = CuratedRfq & { curated: true; name: string };

/** A row from the production marketplace or the demo showcase, normalised for a card. */
export type ExchangeListing = MarketplaceListing & {
  exchange: true;
  demo?: boolean;
  side: MarketSide;
  name: string;
  note: string;
  region: string;
  input: number | null | undefined;
  output: number | null | undefined;
};

export type Listing = CuratedListing | ExchangeListing | CatalogItem;

export const isCurated = (item: Listing): item is CuratedListing =>
  'curated' in item && item.curated === true;
export const isExchange = (item: Listing): item is ExchangeListing =>
  'exchange' in item && item.exchange === true;

const publicKind = (value: string): string =>
  ({ gpu_rental: 'rental', model_capacity: 'model', physical_gpu: 'hardware' })[value] || value;

export const curatedListings = (rows: CuratedRfq[]): CuratedListing[] =>
  rows.map((item) => ({ ...item, curated: true as const, name: item.title }));

function mapExchange(item: MarketplaceListing, side: MarketSide, demo: boolean): ExchangeListing {
  return {
    ...item,
    exchange: true,
    demo: demo || undefined,
    side,
    name: item.title || item.model,
    note: item.description || '',
    region: item.region || 'Flexible region',
    input: item.input ?? item.price,
    output: item.output ?? item.outputPrice,
  };
}

export interface ListingSources {
  market: PublicMarketResponse | null | undefined;
  showcase: ShowcaseLanes | null | undefined;
  curated: CuratedRfq[];
}

/**
 * Rows for one market tab and side (legacy `rowsFor`). Approved marketplace records take
 * precedence; rental falls back to the isolated showcase; model/hardware supply falls back to
 * the dated catalog references. Demand lanes never show catalog references.
 */
export function rowsFor(kind: MarketKind, side: MarketSide, sources: ListingSources): Listing[] {
  const key = side === 'demand' ? 'rfqs' : 'supplies';
  const market = sources.market;
  const published: MarketplaceListing[] = market
    ? kind === 'rental'
      ? market.featured?.[key] || []
      : (side === 'demand' ? market.rfqs : market.supplies).filter(
          (r) => publicKind(r.kind) === publicKind(kind),
        )
    : [];
  if (kind === 'rental') {
    const requirements: Listing[] = side === 'demand' ? curatedListings(sources.curated) : [];
    const usingShowcase = !published.length;
    const listings = (published.length ? published : sources.showcase?.[key] || [])
      .filter((item) => !requirements.some((row) => row.id === item.id))
      .map((item) => mapExchange(item, side, usingShowcase));
    const combined: Listing[] = [];
    for (let i = 0; i < Math.max(requirements.length, listings.length); i++) {
      if (requirements[i]) combined.push(requirements[i]);
      if (listings[i]) combined.push(listings[i]);
    }
    return combined;
  }
  if (published.length) return published.map((item) => mapExchange(item, side, false));
  // Existing dated catalog quotes are references, never fabricated exchange inventory.
  return side === 'supply' ? CATALOG_GROUPS[kind] : [];
}

export const allGroups = (side: MarketSide, sources: ListingSources): Listing[][] =>
  MARKET_KINDS.map((kind) => rowsFor(kind, side, sources));

/** Whether both approved rental lanes are populated, making the showcase fetch unnecessary. */
export const hasApprovedRentalLanes = (market: PublicMarketResponse | null | undefined): boolean =>
  Boolean(market?.featured?.rfqs?.length && market?.featured?.supplies?.length);

export const isHighUrgency = (urgency: unknown): boolean =>
  /^(high(?:[\s_-]+urgency)?|urgent)$/i.test(String(urgency || '').trim());

export function disclosureFor(items: Listing[]): string {
  const demo = items.some((item) => isExchange(item) && item.demo);
  const curated = items.some(isCurated);
  if (demo)
    return curated
      ? 'Includes demo listings · Availability, pricing and delivery confirmed by quote.'
      : '';
  if (curated)
    return 'Buyer requirements · Pricing, capacity and delivery confirmed in supplier quotes.';
  const sample = items.some((item) => isExchange(item) && item.sample);
  return `${sample ? 'Preview marketplace · ' : ''}USD · Final availability, fees and delivery confirmed by quote.`;
}

export function positionLabel(cards: number, start: number, visible: number): string {
  if (!cards) return 'No listings';
  const shown = Math.min(visible, cards);
  const first = start + 1;
  const end = ((first + shown - 2) % cards) + 1;
  return `${String(first).padStart(2, '0')} — ${String(end).padStart(2, '0')} / ${cards}`;
}

/** Legacy `OpenNEXTListings.get`: rendered rows first, then curated, then the catalog. */
export function findListing(
  id: string | null | undefined,
  groups: Listing[][],
  curated: CuratedRfq[],
): Listing | undefined {
  if (!id) return undefined;
  return (
    groups.flat().find((item) => item.id === id) ||
    curatedListings(curated).find((item) => item.id === id) ||
    MARKET_KINDS.flatMap((kind) => CATALOG_GROUPS[kind]).find((item) => item.id === id)
  );
}
