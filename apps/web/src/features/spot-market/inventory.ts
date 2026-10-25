/**
 * Spot market inventory: row normalization, fixtures, filters, sorting and paging.
 * Pure port of the data half of OpenNEXT-spot-market-preview.js.
 */

export const PAGE_SIZE = 12;
export const TERMS = ['Spot', 'On-demand', 'Reserved'] as const;
export type MarketTerm = (typeof TERMS)[number];

export interface FilterGroupSpec {
  key: 'model' | 'country' | 'vcpu' | 'memory';
  label: string;
  searchable?: boolean;
  numeric?: boolean;
  suffix?: string;
}
export const GROUPS: FilterGroupSpec[] = [
  { key: 'model', label: 'Model', searchable: true },
  { key: 'country', label: 'Country', searchable: true },
  { key: 'vcpu', label: 'vCPU', numeric: true },
  { key: 'memory', label: 'Memory', numeric: true, suffix: ' GB' },
];
export type GroupKey = FilterGroupSpec['key'];

export const SORTS: [SortKey, string][] = [
  ['price-asc', 'Price: Low to High'],
  ['price-desc', 'Price: High to Low'],
  ['recent', 'Recently Listed'],
];
export type SortKey = 'price-asc' | 'price-desc' | 'recent';

const COUNTRIES = ['Singapore', 'Germany', 'United States', 'Japan', 'Netherlands', 'United Kingdom', 'Canada', 'France', 'Australia', 'Sweden', 'India', 'UAE'];
const BASE_FIXTURES: [string, number, number, number, number][] = [
  ['H100 SXM', 80, 192, 1.8, 0], ['H100 SXM', 80, 192, 1.65, 1], ['H100 SXM', 80, 192, 1.72, 2], ['H100 SXM', 80, 192, 1.95, 3], ['H100 SXM', 80, 192, 1.78, 4], ['H100 SXM', 80, 192, 1.88, 5],
  ['H200 SXM', 141, 192, 2.45, 0], ['H200 SXM', 141, 192, 2.38, 2], ['H200 SXM', 141, 192, 2.52, 6], ['H200 SXM', 141, 192, 2.41, 7],
  ['B200', 180, 192, 3.05, 0], ['B200', 180, 192, 2.96, 1],
  ['A100 SXM', 80, 96, 1.12, 8], ['A100 SXM', 80, 96, 1.08, 9], ['A100 SXM', 80, 128, 1.16, 10],
  ['H100 SXM', 80, 128, 1.74, 11], ['H200 SXM', 141, 192, 2.57, 3], ['B200', 180, 192, 3.18, 2],
];
const TERM_MULTIPLIER: Record<MarketTerm, number> = { Spot: 1, 'On-demand': 1.22, Reserved: 0.84 };
const TERM_OFFSET: Record<MarketTerm, number> = { Spot: 0, 'On-demand': 18, Reserved: 36 };
const FIXTURE_EPOCH = Date.parse('2026-10-23T12:00:00Z');

export type SourceKind = 'agent' | 'preview' | 'fixture';

export interface SpotRow {
  _key: string;
  id: string;
  model: string;
  country: string;
  vcpu: number | null;
  gpuCount: number;
  memory: number | null;
  perGpuHourly: number;
  instanceHourly: number;
  term: MarketTerm;
  listedAt: string | null;
  listedAtTime: number;
  provider: string;
  previewOnly: boolean;
  sourceKind: SourceKind;
}

export const round = (value: unknown) => Math.round(Number(value) * 100) / 100;
export const usd = (value: unknown) => '$' + Number(value).toFixed(2);
const finite = (value: unknown) => Number.isFinite(Number(value));
export const positive = (value: unknown) => finite(value) && Number(value) > 0;
const safeTime = (value: unknown) => {
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? time : 0;
};

export function canonicalTerm(value: unknown): MarketTerm {
  const normalized = String(value || 'Spot').trim().toLowerCase();
  if (normalized === 'on-demand' || normalized === 'on demand' || normalized === 'ondemand') return 'On-demand';
  if (normalized === 'reserved' || normalized === 'reservation') return 'Reserved';
  return 'Spot';
}

type AnyRow = Record<string, unknown> & { cpu?: { vcpu?: unknown }; node?: { gpuCount?: unknown } };

export function isPricingObservation(row: unknown): boolean {
  const r = row as AnyRow | null;
  return r?.referenceOnly === true || r?.external === true || r?.observationOnly === true || /(?:price|pricing)[_-]?observation/i.test(String(r?.sourceType || r?.provenance || ''));
}
export function isAgentMarketplaceRow(row: unknown): boolean {
  const r = row as AnyRow | null;
  return !isPricingObservation(r) && r?.executable !== false && (r?.agentStatus === 'Succeeded' || (r?.serverRecord === true && r?.status === 'Published'));
}
const explicitNodeGpuCount = (r: AnyRow) => r.gpuCount ?? r.gpus ?? r.nodeGpuCount ?? r.node?.gpuCount;
export function isValidatedInstanceRow(row: unknown): boolean {
  const r = row as AnyRow;
  return positive(explicitNodeGpuCount(r)) && positive(r.vcpu ?? r.vCPU ?? r.cpu?.vcpu) && positive(r.memory ?? r.gpuMemory ?? r.gpuMemoryGb);
}

export function normalizeRow(row: unknown, index: number, sourceKind: SourceKind): SpotRow | null {
  const r = row as AnyRow | null;
  if (!r || typeof r !== 'object' || isPricingObservation(r)) return null;
  const perGpuHourly = Number(r.perGpuHourly ?? r.rate ?? r.price ?? r.netPrice ?? r.unitPrice);
  if (!(perGpuHourly > 0) || !Number.isFinite(perGpuHourly)) return null;
  const nodeGpuCount = explicitNodeGpuCount(r);
  if (!positive(nodeGpuCount)) return null;
  const gpuCount = Math.max(1, Math.round(Number(nodeGpuCount)));
  const memorySource = r.memory ?? r.gpuMemory ?? r.gpuMemoryGb;
  const vcpuSource = r.vcpu ?? r.vCPU ?? r.cpu?.vcpu;
  const term = canonicalTerm(r.term);
  const id = String(r.id || 'spot-preview-' + term.toLowerCase().replace(/[^a-z]+/g, '-') + '-' + index);
  const listedAt = (r.listedAt || r.createdAt || r.created || r.updatedAt || null) as string | null;
  return {
    _key: term + ':' + id + ':' + index,
    id,
    model: String(r.model || r.name || 'GPU model to confirm'),
    country: String(r.country || r.region || r.regionLabel || 'Country to confirm'),
    vcpu: positive(vcpuSource) ? Math.round(Number(vcpuSource)) : null,
    gpuCount,
    memory: positive(memorySource) ? Number(memorySource) : null,
    perGpuHourly: round(perGpuHourly),
    instanceHourly: round(perGpuHourly * gpuCount),
    term,
    listedAt,
    listedAtTime: safeTime(listedAt),
    provider: String(r.provider || 'Supplier to confirm'),
    previewOnly: sourceKind !== 'agent' || r.previewOnly === true,
    sourceKind,
  };
}

function fixtureRows(): SpotRow[] {
  return TERMS.flatMap((term) =>
    BASE_FIXTURES.map(([model, memory, vcpu, rate, countryIndex], index) =>
      normalizeRow(
        {
          id: 'preview-' + term.toLowerCase().replace(/[^a-z]+/g, '-') + '-' + String(index + 1).padStart(2, '0'),
          model, memory, vcpu,
          perGpuHourly: round(rate * TERM_MULTIPLIER[term]),
          country: COUNTRIES[countryIndex],
          gpuCount: 8,
          term,
          listedAt: new Date(FIXTURE_EPOCH - (TERM_OFFSET[term] + index) * 37 * 60000).toISOString(),
          previewOnly: true,
        },
        index,
        'fixture',
      ),
    ),
  ).filter((row): row is SpotRow => Boolean(row));
}
export const FALLBACK_ROWS: SpotRow[] = fixtureRows();

export interface Inventory {
  rows: SpotRow[];
  scope: string;
  kind: 'agent' | 'preview' | 'fixture';
}

/** Rows published through the connected marketplace (legacy `autoInventory`). */
export function agentInventory(publicSupplies: unknown[], regionCountry: (region: unknown) => string | null | undefined): SpotRow[] {
  return publicSupplies
    .filter((row) => isAgentMarketplaceRow(row) && isValidatedInstanceRow(row))
    .map((row, index) => {
      const r = row as AnyRow;
      return normalizeRow({ ...r, country: r.country || regionCountry(r.region) || r.region }, index, 'agent');
    })
    .filter((row): row is SpotRow => Boolean(row));
}

export function normalizeInjected(rows: unknown[]): SpotRow[] {
  return rows.map((row, index) => normalizeRow(row, index, isAgentMarketplaceRow(row) ? 'agent' : 'preview')).filter((row): row is SpotRow => Boolean(row));
}

export function inventoryState(input: { injected: SpotRow[] | null; agentRows: SpotRow[]; demoActive: boolean }): Inventory {
  if (input.injected !== null) {
    const hasAgent = input.injected.some((row) => row.sourceKind === 'agent' && !row.previewOnly);
    const hasPreview = input.injected.some((row) => row.previewOnly);
    return {
      rows: input.injected,
      scope: hasAgent && hasPreview ? 'Mixed connected and preview feed · checkout remains disabled' : hasAgent ? 'Connected inventory preview · checkout remains disabled' : 'Injected preview feed · no live availability claim',
      kind: hasAgent && !hasPreview ? 'agent' : 'preview',
    };
  }
  if (input.agentRows.length) return { rows: input.agentRows, scope: 'Connected marketplace records · checkout remains preview-only', kind: 'agent' };
  if (input.demoActive) return { rows: FALLBACK_ROWS, scope: 'Demo inventory', kind: 'fixture' };
  return { rows: [], scope: 'Connected marketplace inventory', kind: 'agent' };
}

export type Selected = Record<GroupKey, string[]>;
export const emptySelected = (): Selected => ({ model: [], country: [], vcpu: [], memory: [] });

export interface FilterState {
  term: MarketTerm;
  selected: Selected;
  maxPrice: number | null;
  sort: SortKey;
}

export function pruneSelections(selected: Selected, rows: SpotRow[]): Selected {
  const next = { ...selected };
  for (const group of GROUPS) {
    const available = new Set(rows.map((row) => row[group.key]).filter((value) => value !== null && value !== undefined).map(String));
    next[group.key] = selected[group.key].filter((value) => available.has(String(value)));
  }
  return next;
}

export const termRows = (rows: SpotRow[], term: MarketTerm) => rows.filter((row) => row.term === term);

export function attributeFiltered(rows: SpotRow[], selected: Selected, skippedKey: GroupKey | null = null): SpotRow[] {
  return rows.filter((row) =>
    GROUPS.every((group) => {
      if (group.key === skippedKey || !selected[group.key].length) return true;
      return selected[group.key].includes(String(row[group.key]));
    }),
  );
}

/** Price bounds follow the term and attribute filters; the price filter never feeds its own range. */
export function boundsFor(rows: SpotRow[], state: Pick<FilterState, 'term' | 'selected'>): { min: number | null; max: number | null; rows: SpotRow[] } {
  const candidates = attributeFiltered(termRows(rows, state.term), state.selected);
  const prices = candidates.map((row) => row.perGpuHourly).filter(positive);
  if (!prices.length) return { min: null, max: null, rows: candidates };
  return { min: round(Math.min(...prices)), max: round(Math.max(...prices)), rows: candidates };
}

export function filteredRows(rows: SpotRow[], state: FilterState): SpotRow[] {
  const bounded = boundsFor(rows, state).rows.filter((row) => state.maxPrice === null || row.perGpuHourly <= state.maxPrice + 1e-9);
  const sorted = bounded.slice();
  if (state.sort === 'price-asc') sorted.sort((a, b) => a.instanceHourly - b.instanceHourly || a.perGpuHourly - b.perGpuHourly || b.listedAtTime - a.listedAtTime || a._key.localeCompare(b._key));
  else if (state.sort === 'price-desc') sorted.sort((a, b) => b.instanceHourly - a.instanceHourly || b.perGpuHourly - a.perGpuHourly || b.listedAtTime - a.listedAtTime || a._key.localeCompare(b._key));
  else sorted.sort((a, b) => b.listedAtTime - a.listedAtTime || a._key.localeCompare(b._key));
  return sorted;
}

export function optionsFor(group: FilterGroupSpec, rows: SpotRow[], state: Pick<FilterState, 'term' | 'selected'>): string[] {
  const values = new Set(termRows(rows, state.term).map((row) => row[group.key]).filter((value) => value !== null && value !== undefined).map(String));
  state.selected[group.key].forEach((value) => values.add(String(value)));
  return [...values].sort(group.numeric ? (a, b) => Number(a) - Number(b) : (a, b) => a.localeCompare(b));
}

export function optionCount(group: FilterGroupSpec, value: string, rows: SpotRow[], state: Pick<FilterState, 'term' | 'selected'>): number {
  return attributeFiltered(termRows(rows, state.term), state.selected, group.key).filter((row) => String(row[group.key]) === String(value)).length;
}

export function selectedCount(state: Pick<FilterState, 'selected' | 'maxPrice'>): number {
  return GROUPS.reduce((sum, group) => sum + state.selected[group.key].length, 0) + (state.maxPrice === null ? 0 : 1);
}

export const formatSpec = (value: unknown, fallback = 'To confirm') => (value === null || value === undefined ? fallback : String(value));

export interface SpotOffer {
  id: string;
  model: string;
  country: string;
  vcpu: number | null;
  gpuCount: number;
  memory: number | null;
  perGpuHourly: number;
  instanceHourly: number;
  term: MarketTerm;
}
export const offerFor = (row: SpotRow): SpotOffer => ({ id: row.id, model: row.model, country: row.country, vcpu: row.vcpu, gpuCount: row.gpuCount, memory: row.memory, perGpuHourly: row.perGpuHourly, instanceHourly: row.instanceHourly, term: row.term });

export function paginate(rows: SpotRow[], page: number) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.max(0, Math.min(page, pages - 1));
  const start = current * PAGE_SIZE;
  return { pages, page: current, visible: rows.slice(start, start + PAGE_SIZE), rangeStart: rows.length ? start + 1 : 0, rangeEnd: Math.min(start + PAGE_SIZE, rows.length) };
}
