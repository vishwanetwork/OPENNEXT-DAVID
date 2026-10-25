/**
 * Marketplace record logic ported from OpenNEXT-exchange.js. Everything here is pure: the
 * public market, matches, settlements and reference catalog live in `useMarketplaceStore`
 * (see workspace.ts) and are passed in explicitly.
 */
import { create } from 'zustand';
import type { MarketRow, ReferenceCatalogResponse, SettlementRow, WorkspaceNotification } from '@opennext/contracts';
import { ALL_REGIONS } from '@/features/market/catalog';
import { countryList, findCountry } from './countries';

export type MarketKindShort = 'rental' | 'model' | 'hardware';
export type RecordKind = 'gpu_rental' | 'model_capacity' | 'physical_gpu';
export type MarketSide = 'supply' | 'demand';

export const round = (n: unknown): number => Math.round(Number(n) * 100) / 100;
export const uid = (prefix: string): string => prefix + '-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
export const nowIso = () => new Date().toISOString();

export const publicKind = (value: unknown): string => ({ gpu_rental: 'rental', model_capacity: 'model', physical_gpu: 'hardware' } as Record<string, string>)[String(value)] || String(value);
export const kindOf = (r: { kind?: unknown } | null | undefined): RecordKind =>
  (({ model: 'model_capacity', hardware: 'physical_gpu', rental: 'gpu_rental' } as Record<string, RecordKind>)[String(r?.kind)] || (r?.kind as RecordKind) || 'gpu_rental');
export const isModel = (r: { kind?: unknown } | null | undefined) => kindOf(r) === 'model_capacity';
export const isHardware = (r: { kind?: unknown } | null | undefined) => kindOf(r) === 'physical_gpu';
export const unitLabel = (r: { kind?: unknown }): string => (kindOf(r) === 'model_capacity' ? 'total' : kindOf(r) === 'physical_gpu' ? 'GPU' : 'GPU-hour');
export const unitSuffix = (r: { kind?: unknown }): string => (isModel(r) ? ' total' : isHardware(r) ? ' / GPU' : ' / GPU-hour');
export const deliveryMethod = (r: { kind?: unknown }): string =>
  kindOf(r) === 'model_capacity' ? 'Authorized API access' : kindOf(r) === 'physical_gpu' ? 'Insured shipment with serial-number manifest' : 'SSH / dedicated instance';

/** Order total for a unit price: tokens are quoted as totals, hardware per GPU, rentals per GPU-hour. */
export function totalFor(r: { kind?: unknown; count?: unknown; hours?: unknown }, price: unknown): number {
  return round(kindOf(r) === 'model_capacity' ? Number(price) : Number(price) * Number(r.count) * (kindOf(r) === 'physical_gpu' ? 1 : Number(r.hours)));
}
export function tokenTotal(r: { inputMillion?: unknown; outputMillion?: unknown }, input: unknown, output: unknown): number {
  return round(Number(r.inputMillion || 0) * Number(input) + Number(r.outputMillion || 0) * Number(output));
}

/* ---------- Geography ---------- */

const LEGACY_REGIONS: [string, string][] = [
  ['US East', 'us-east-1'],
  ['Singapore', 'ap-southeast-1'],
  ['Frankfurt', 'eu-central-1'],
  ['Tokyo', 'ap-northeast-1'],
  ['US West', 'us-west-2'],
];
const REGION_COUNTRIES: Record<string, string> = {
  'eu-west-1': 'Ireland', 'eu-west-2': 'United Kingdom', 'eu-west-3': 'France', 'eu-central-1': 'Germany', 'eu-central-2': 'Switzerland',
  'eu-north-1': 'Sweden', 'eu-south-1': 'Italy', 'eu-south-2': 'Spain', 'ap-south-1': 'India', 'ap-south-2': 'India', 'ap-southeast-1': 'Singapore',
  'ap-southeast-2': 'Australia', 'ap-southeast-3': 'Indonesia', 'ap-southeast-4': 'Australia', 'ap-southeast-5': 'Malaysia', 'ap-southeast-6': 'New Zealand',
  'ap-southeast-7': 'Thailand', 'ap-east-1': 'Hong Kong SAR China', 'ap-east-2': 'Taiwan', 'ap-northeast-1': 'Japan', 'ap-northeast-2': 'South Korea',
  'ap-northeast-3': 'Japan', 'af-south-1': 'South Africa', 'me-south-1': 'Bahrain', 'me-central-1': 'United Arab Emirates', 'il-central-1': 'Israel',
  'mx-central-1': 'Mexico', 'sa-east-1': 'Brazil',
};
const CITY_COUNTRIES: Record<string, string> = {
  Frankfurt: 'Germany', Tokyo: 'Japan', Seoul: 'South Korea', Mumbai: 'India', Sydney: 'Australia', London: 'United Kingdom', Paris: 'France',
  Stockholm: 'Sweden', Zurich: 'Switzerland', Jakarta: 'Indonesia', Oregon: 'United States', 'N. Virginia': 'United States', Ohio: 'United States', California: 'United States',
};

/** Resolves a region label / AWS code / city to a country name (legacy `regionCountry`). */
export function regionCountry(value: unknown): string {
  const label = String(value || '').trim();
  const known = findCountry(label);
  if (known) return known.name;
  if (REGION_COUNTRIES[label]) return REGION_COUNTRIES[label];
  if (/^us-|^US (East|West)/i.test(label)) return 'United States';
  if (/^ca-/i.test(label)) return 'Canada';
  if (/^cn-/i.test(label)) return 'China';
  return CITY_COUNTRIES[label] || label;
}

/** Region code lookup with the market catalog as the primary source. */
export type RegionCoder = (region: string) => string;
export const legacyRegionCode: RegionCoder = (region) => LEGACY_REGIONS.find((r) => r.includes(region))?.[1] || region;

export const regionMatches = (a: unknown, b: unknown, code: RegionCoder = legacyRegionCode): boolean => regionCountry(code(String(a ?? ''))) === regionCountry(code(String(b ?? '')));

const EUROPE = new Set('AL AD AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM TR UA VA'.split(' '));
const EUROPEAN_UNION = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' '));

/** Region match for native and external (sourced) rows, honouring external region scopes. */
export function recordRegionMatches(row: MarketRow, selected: string | undefined, code: RegionCoder = legacyRegionCode): boolean {
  if (!selected || selected === ALL_REGIONS) return true;
  if (!row.external) return regionMatches(row.region, selected, code);
  const area = row.regionScope || {};
  const country = regionCountry(code(selected));
  const entry = countryList().find((item) => item.name === country || item.code === country);
  if (!entry) return selected === row.region;
  if ((area.excludedCountries || []).some((value) => regionMatches(value, entry.name, code))) return false;
  if (area.type === 'worldwide' || area.type === 'flexible') return true;
  if (area.type === 'europe') return (area.unionOnly ? EUROPEAN_UNION : EUROPE).has(entry.code);
  if (area.type === 'countries') return (area.countries || []).some((value) => regionMatches(value, entry.name, code));
  return regionMatches(row.region, selected, code);
}

export function recordCount(row: MarketRow): number | null {
  if (!row.external) return Number(row.count);
  const q = row.quantity || {};
  const perNode = Number(q.gpusPerNode);
  for (const value of [q.totalGpus, q.totalGpusMax, q.totalGpusMin]) if (value != null && Number.isFinite(Number(value))) return Number(value);
  const nodes = q.maxNodes ?? q.nodes ?? q.minNodes;
  return nodes != null && perNode > 0 ? Number(nodes) * perNode : null;
}

export interface MarketFilters {
  model: string;
  region: string;
  count?: number;
  term?: string;
  role?: string;
}

export function eligible(row: MarketRow, filters: MarketFilters, code?: RegionCoder): boolean {
  const count = recordCount(row);
  return (
    row.model === filters.model &&
    recordRegionMatches(row, filters.region, code) &&
    (!filters.count || count == null || count >= Number(filters.count)) &&
    (!filters.term || (Boolean(row.external) && !row.term) || row.term === filters.term)
  );
}

const priceSort = (side: MarketSide) => (a: MarketRow, b: MarketRow) =>
  a.price == null ? (b.price == null ? 0 : 1) : b.price == null ? -1 : side === 'supply' ? a.price - b.price : b.price - a.price;

/** External rows that accept alternative GPU models are projected onto the selected model. */
export function projectModel(row: MarketRow, selected: string): MarketRow {
  if (!row.external || (row.model !== selected && !(row.modelOptions || []).includes(selected))) return row;
  return { ...row, model: selected, price: row.modelBudgets?.[selected] ?? (row.model === selected ? row.price : null), bestMatch: false };
}

/* ---------- Market store ---------- */

export interface PublicMarket {
  rfqs: MarketRow[];
  supplies: MarketRow[];
  featured: { rfqs: MarketRow[]; supplies: MarketRow[] };
}

export interface MarketplaceState {
  market: PublicMarket;
  bestRows: MarketRow[];
  matchReason: string;
  matchPrompt: string;
  recentRows: SettlementRow[];
  referenceCatalog: ReferenceCatalogResponse;
  referenceLoaded: boolean;
  loaded: boolean;
  error: string;
  /** Rows shown to the user (by id) so dialogs can resolve them without a second lookup. */
  generated: Map<string, MarketRow>;
  set: (patch: Partial<Omit<MarketplaceState, 'set' | 'reset'>>) => void;
  reset: () => void;
}

const emptyMarket = (): PublicMarket => ({ rfqs: [], supplies: [], featured: { rfqs: [], supplies: [] } });
const emptyReference = (): ReferenceCatalogResponse => ({ supplies: [], rfqs: [], recent: [] });

export const useMarketplaceStore = create<MarketplaceState>((set) => ({
  market: emptyMarket(),
  bestRows: [],
  matchReason: '',
  matchPrompt: '',
  recentRows: [],
  referenceCatalog: emptyReference(),
  referenceLoaded: false,
  loaded: false,
  error: '',
  generated: new Map(),
  set: (patch) => set(patch),
  reset: () => set({ bestRows: [], matchReason: 'No matches.', matchPrompt: '' }),
}));

export const marketStatus = (s: Pick<MarketplaceState, 'loaded' | 'error' | 'matchReason' | 'matchPrompt'>) => ({ loaded: s.loaded, error: s.error, matchReason: s.matchReason, matchPrompt: s.matchPrompt });

export function listPublic(market: PublicMarket, kind: MarketKindShort | string = 'rental', side: MarketSide = 'supply'): MarketRow[] {
  return (side === 'demand' ? market.rfqs : market.supplies).filter((r) => publicKind(r.kind) === publicKind(kind));
}

export function getPublic(market: PublicMarket, id: string | null | undefined): MarketRow | null {
  if (!id) return null;
  for (const kind of ['rental', 'model', 'hardware'] as const) for (const side of ['supply', 'demand'] as const) {
    const row = listPublic(market, kind, side).find((r) => r.id === id);
    if (row) return row;
  }
  return null;
}

export function matchesFor(market: PublicMarket, filters: MarketFilters, side: MarketSide = 'supply', code?: RegionCoder): MarketRow[] {
  return listPublic(market, 'rental', side)
    .map((r) => projectModel(r, filters.model))
    .filter((r) => eligible(r, filters, code))
    .sort(priceSort(side));
}

export function referenceRows(reference: ReferenceCatalogResponse, filters: MarketFilters, side: MarketSide = 'supply', demo = false, code?: RegionCoder): MarketRow[] {
  if (demo) return [];
  return (side === 'supply' ? reference.supplies : reference.rfqs)
    .filter(
      (r) =>
        r.model === filters.model &&
        (!filters.region || filters.region === ALL_REGIONS || regionMatches(r.region, filters.region, code)) &&
        (!filters.count || Number(r.count) >= Number(filters.count)) &&
        (!filters.term || r.term === filters.term),
    )
    .sort((a, b) => (side === 'supply' ? Number(a.price) - Number(b.price) : Number(b.price) - Number(a.price)));
}

/** Listing rows: genuine marketplace matches, or reference catalog rows when there are none. */
export function marketRows(state: MarketplaceState, filters: MarketFilters, side: MarketSide, demo = false, code?: RegionCoder): MarketRow[] {
  const actual = matchesFor(state.market, filters, side, code);
  const rows = actual.length ? actual : referenceRows(state.referenceCatalog, filters, side, demo, code);
  rows.forEach((r) => state.generated.set(r.id, r));
  return rows;
}

export function bestFor(state: MarketplaceState, filters: MarketFilters, demo = false, code?: RegionCoder): MarketRow[] {
  const actual = state.bestRows
    .map((r) => projectModel(r, filters.model))
    .filter((r) => r.model === filters.model && recordRegionMatches(r, filters.region, code))
    .map((r) => (r.external ? { ...r, bestMatch: false } : r));
  const rows = actual.length ? actual : referenceRows(state.referenceCatalog, filters, filters.role === 'Seller' ? 'demand' : 'supply', demo, code);
  rows.forEach((r) => state.generated.set(r.id, r));
  return rows;
}

export function recentFor(state: MarketplaceState, filters: MarketFilters | null, days = 3, demo = false, code?: RegionCoder): SettlementRow[] {
  if (!filters) return state.recentRows;
  const cutoff = Date.now() - Number(days) * 86400000;
  const actual = state.recentRows.filter(
    (r) =>
      !r.external &&
      r.model === filters.model &&
      (!filters.region || filters.region === ALL_REGIONS || regionMatches(r.region, filters.region, code)) &&
      Date.parse(String(r.settledAt)) >= cutoff &&
      Date.parse(String(r.settledAt)) <= Date.now(),
  );
  if (actual.length || demo) return actual;
  return state.referenceCatalog.recent.filter((r) => r.model === filters.model && (!filters.region || filters.region === ALL_REGIONS || regionMatches(r.region, filters.region, code))) as SettlementRow[];
}

/** Finds a market row by id across shown rows, the public market and saved/cart supply items. */
export function findRow(state: MarketplaceState, id: string | null | undefined, extra: { id: string; side?: string; kind?: string; originSupply?: unknown }[] = []): MarketRow | null {
  if (!id) return null;
  const current = state.generated.get(id) || getPublic(state.market, id);
  if (current) return current;
  const saved = extra.find(
    (r) => r && r.id === id && r.side === 'supply' && ['rental', 'model', 'hardware', 'gpu_rental', 'model_capacity', 'physical_gpu'].includes(String(r.kind)) && (/^(EX-|MATCH-|SUP)/.test(r.id) || Boolean(r.originSupply)),
  );
  return (saved as MarketRow | undefined) || null;
}

/* ---------- Notifications ---------- */

/** Merge marketplace and billing notifications owned by the signed-in account, newest first. */
export function mergeNotifications(ownerId: string | undefined, marketplaceRows: WorkspaceNotification[], billingRows: WorkspaceNotification[]): WorkspaceNotification[] {
  const rows = new Map<string, WorkspaceNotification>();
  for (const row of [...marketplaceRows, ...billingRows]) if (ownerId && row?.ownerId === ownerId && typeof row.id === 'string') rows.set(row.id, row);
  return [...rows.values()].sort((a, b) => (Date.parse(String(b.created || b.createdAt)) || 0) - (Date.parse(String(a.created || a.createdAt)) || 0));
}
