/**
 * Market Insight data logic (legacy OpenNEXT-seller-activities-preview.js, pure part):
 * settlement normalization, demo tape, rolling windows, activity limits and price bands.
 */

export const DAY_MS = 86400000;
export const ACTIVITY_LIMIT = 100;
export const ACTIVITY_SHOW_OPTIONS = Object.freeze<[number, number, number]>([
  20,
  50,
  ACTIVITY_LIMIT,
]);
export const TERMS = ['All', 'Spot', 'On-demand', 'Reserved'] as const;
export type InsightTerm = (typeof TERMS)[number];
export const PANELS = ['index', 'analytics', 'activities'] as const;
export type Panel = (typeof PANELS)[number];
export interface RangeSpec {
  key: string;
  label: string;
  days: number | null;
  gated: boolean;
}
export const RANGES = [
  { key: '24H', label: '24H', days: 1, gated: false },
  { key: '3D', label: '3D', days: 3, gated: false },
  { key: '7D', label: '7D', days: 7, gated: false },
  { key: '1M', label: '1M', days: 30, gated: false },
  { key: '3M', label: '3M', days: 90, gated: true },
  { key: '6M', label: '6M', days: 180, gated: true },
  { key: '1Y', label: '1Y', days: 365, gated: true },
  { key: 'ALL', label: 'ALL', days: null, gated: true },
] as const satisfies readonly RangeSpec[];
export const GROUPING_STEPS = [100, 10, 1] as const;
export type GroupingStep = (typeof GROUPING_STEPS)[number];
export interface GroupSpec {
  key: 'model' | 'country' | 'vcpu' | 'memory';
  label: string;
  searchable?: boolean;
  numeric?: boolean;
  suffix?: string;
}
export const GROUPS = [
  { key: 'model', label: 'Model', searchable: true },
  { key: 'country', label: 'Country', searchable: true },
  { key: 'vcpu', label: 'vCPU', numeric: true },
  { key: 'memory', label: 'Memory', numeric: true, suffix: ' GB' },
] as const satisfies readonly GroupSpec[];
export type GroupKey = GroupSpec['key'];
export type Selected = Record<GroupKey, string[]>;
export const emptySelected = (): Selected => ({ model: [], country: [], vcpu: [], memory: [] });

const DEMO_PROFILES = [
  { model: 'H100 SXM', memory: 80, vcpu: 192, baseCents: 180 },
  { model: 'H200 SXM', memory: 141, vcpu: 192, baseCents: 244 },
  { model: 'B200', memory: 180, vcpu: 192, baseCents: 306 },
  { model: 'A100 SXM', memory: 80, vcpu: 96, baseCents: 112 },
  { model: 'L40S', memory: 48, vcpu: 64, baseCents: 78 },
];
const DEMO_COUNTRIES = [
  'Singapore',
  'United States',
  'Germany',
  'Japan',
  'United Kingdom',
  'Canada',
  'Sweden',
  'Australia',
];
const DEMO_COUNTS = [1, 2, 4, 8, 8, 16, 32];
const DEMO_TERMS = ['Spot', 'Spot', 'Spot', 'On-demand', 'Spot', 'Reserved', 'On-demand'] as const;
type DemoTerm = (typeof DEMO_TERMS)[number];
const TERM_BPS: Record<DemoTerm, number> = { Spot: 10000, 'On-demand': 11800, Reserved: 8600 };
const PRICE_WAVE_BPS = [-650, -420, -250, -100, 0, 120, 260, 410, 580, 330, 170, -180];

export const positive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;

export function canonicalTerm(value: unknown): 'Spot' | 'On-demand' | 'Reserved' | null {
  const term = String(value || '')
    .trim()
    .toLowerCase();
  if (term === 'spot') return 'Spot';
  if (term === 'on-demand' || term === 'on demand' || term === 'ondemand') return 'On-demand';
  if (term === 'reserved' || term === 'reservation') return 'Reserved';
  return null;
}

type AnyRow = Record<string, unknown> & { cpu?: { vcpu?: unknown } };

export function isReferenceRow(row: unknown): boolean {
  const r = row as AnyRow | null;
  return (
    r?.external === true ||
    r?.referenceOnly === true ||
    r?.observationOnly === true ||
    /(?:price|pricing)[_-]?observation/i.test(String(r?.sourceType || r?.provenance || ''))
  );
}

export interface Settlement {
  _key: string;
  id: string;
  model: string;
  country: string;
  term: 'Spot' | 'On-demand' | 'Reserved';
  gpuCount: number;
  vcpu: number | null;
  memory: number | null;
  priceCents: number;
  perGpuHourly: number;
  settledAt: string;
  settledAtTime: number;
  sourceKind: string;
}

export function normalizeSettlement(
  row: unknown,
  index: number,
  sourceKind = 'injected',
): Settlement | null {
  const r = row as AnyRow | null;
  if (!r || typeof r !== 'object' || isReferenceRow(r)) return null;
  if (r.status && !['completed', 'settled'].includes(String(r.status).trim().toLowerCase()))
    return null;
  const id = String(r.orderId || r.id || '').trim();
  const model = String(r.model || '').trim();
  const country = String(r.country || r.region || '').trim();
  const term = canonicalTerm(r.term);
  const rawPrice = Number(r.perGpuHourly ?? r.unitPrice ?? r.price ?? r.rate);
  const rawCount = Number(r.gpuCount ?? r.count);
  const settledAtTime = Date.parse(String(r.settledAt || r.completedAt || ''));
  if (
    !id ||
    !model ||
    !country ||
    !term ||
    !Number.isFinite(rawPrice) ||
    !(rawPrice > 0) ||
    !Number.isFinite(rawCount) ||
    !Number.isSafeInteger(rawCount) ||
    !(rawCount > 0) ||
    !Number.isFinite(settledAtTime)
  )
    return null;
  const priceCents = Math.round(rawPrice * 100);
  if (!Number.isSafeInteger(priceCents) || priceCents < 1) return null;
  const vcpuRaw = r.vcpu ?? r.vCPU ?? r.cpu?.vcpu;
  const memoryRaw = r.memory ?? r.gpuMemory ?? r.gpuMemoryGb;
  return {
    _key: id + ':' + index,
    id,
    model,
    country,
    term,
    gpuCount: Math.max(1, Math.round(rawCount)),
    vcpu: positive(vcpuRaw) ? Math.round(Number(vcpuRaw)) : null,
    memory: positive(memoryRaw) ? Number(memoryRaw) : null,
    priceCents,
    perGpuHourly: priceCents / 100,
    settledAt: new Date(settledAtTime).toISOString(),
    settledAtTime,
    sourceKind,
  };
}

function demoPriceCents(
  profile: (typeof DEMO_PROFILES)[number],
  term: DemoTerm,
  index: number,
): number {
  const wave = 10000 + (PRICE_WAVE_BPS[index % PRICE_WAVE_BPS.length] ?? 0);
  return Math.max(1, Math.round((profile.baseCents * TERM_BPS[term] * wave) / 100000000));
}

export function buildDemoSettlements(now = Date.now()): Settlement[] {
  const rows: (Settlement | null)[] = [];
  for (let index = 0; index < 168; index += 1) {
    const profile = DEMO_PROFILES[(index * 3 + Math.floor(index / 11)) % DEMO_PROFILES.length];
    const term = DEMO_TERMS[(index * 5 + Math.floor(index / 9)) % DEMO_TERMS.length];
    if (!profile || !term) continue;
    const hoursAgo = 0.25 + index * 0.97;
    rows.push(
      normalizeSettlement(
        {
          id: 'ORDER-DEMO-7D-' + String(index + 1).padStart(4, '0'),
          model: profile.model,
          country: DEMO_COUNTRIES[(index * 5 + Math.floor(index / 13)) % DEMO_COUNTRIES.length],
          vcpu: profile.vcpu,
          memory: profile.memory,
          gpuCount: DEMO_COUNTS[(index * 3 + Math.floor(index / 8)) % DEMO_COUNTS.length],
          perGpuHourly: demoPriceCents(profile, term, index) / 100,
          term,
          status: 'Completed',
          settledAt: new Date(now - hoursAgo * 3600000).toISOString(),
        },
        index,
        'demo',
      ),
    );
  }
  for (let index = 0; index < 24; index += 1) {
    const profile = DEMO_PROFILES[(index * 2 + 1) % DEMO_PROFILES.length];
    const term = DEMO_TERMS[(index + 2) % DEMO_TERMS.length];
    if (!profile || !term) continue;
    rows.push(
      normalizeSettlement(
        {
          id: 'ORDER-DEMO-OLDER-' + String(index + 1).padStart(4, '0'),
          model: profile.model,
          country: DEMO_COUNTRIES[(index * 3 + 2) % DEMO_COUNTRIES.length],
          vcpu: profile.vcpu,
          memory: profile.memory,
          gpuCount: DEMO_COUNTS[(index * 4 + 1) % DEMO_COUNTS.length],
          perGpuHourly: demoPriceCents(profile, term, index + 17) / 100,
          term,
          status: 'Completed',
          settledAt: new Date(now - (8 + index * 1.15) * DAY_MS).toISOString(),
        },
        168 + index,
        'demo',
      ),
    );
  }
  return rows.filter((row): row is Settlement => Boolean(row));
}

/** Completed marketplace settlements from the anonymized tape (legacy `autoSettlements`). */
export function marketplaceSettlements(
  rows: unknown[],
  regionCountry: (region: unknown) => string | null | undefined,
): Settlement[] {
  return rows
    .filter((row) => (row as AnyRow)?.serverRecord === true && !isReferenceRow(row))
    .map((row, index) => {
      const r = row as AnyRow;
      return normalizeSettlement(
        { ...r, country: r.country || regionCountry(r.region) || r.region },
        index,
        'marketplace',
      );
    })
    .filter((row): row is Settlement => Boolean(row));
}

/** Catalog rows contributed by the price index for the shared filters (legacy `normalizeFilterRow`). */
export interface FilterRow {
  _key: string;
  model: string | null;
  country: string | null;
  vcpu: number | null;
  memory: number | null;
  term: 'Spot' | 'On-demand' | 'Reserved' | null;
  _indexFilterRow: true;
}
export function normalizeFilterRow(row: unknown, index: number): FilterRow | null {
  const r = row as AnyRow | null;
  if (!r || typeof r !== 'object') return null;
  const model = String(r.model || '').trim();
  const country = String(r.country || r.region || '').trim();
  const vcpuRaw = r.vcpu ?? r.vCPU ?? r.cpu?.vcpu;
  const memoryRaw = r.memory ?? r.gpuMemory ?? r.gpuMemoryGb;
  const term = canonicalTerm(r.term);
  if (!model && !country && !positive(vcpuRaw) && !positive(memoryRaw)) return null;
  return {
    _key: 'index-filter:' + index,
    model: model || null,
    country: country || null,
    vcpu: positive(vcpuRaw) ? Math.round(Number(vcpuRaw)) : null,
    memory: positive(memoryRaw) ? Number(memoryRaw) : null,
    term,
    _indexFilterRow: true,
  };
}

export type FilterableRow = Settlement | FilterRow;
const isFilterRow = (row: FilterableRow): row is FilterRow =>
  (row as FilterRow)._indexFilterRow === true;

export function pruneSelections(selected: Selected, rows: FilterableRow[]): Selected {
  const next = { ...selected };
  for (const group of GROUPS) {
    const available = new Set(
      rows
        .map((row) => row[group.key])
        .filter((value) => value !== null && value !== undefined)
        .map(String),
    );
    next[group.key] = selected[group.key].filter((value) => available.has(String(value)));
  }
  return next;
}

export function termFiltered<T extends FilterableRow>(rows: T[], term: InsightTerm): T[] {
  return term === 'All'
    ? rows
    : rows.filter((row) => row.term === term || (isFilterRow(row) && !row.term));
}
export function attributeFiltered<T extends FilterableRow>(
  rows: T[],
  term: InsightTerm,
  selected: Selected,
  skippedKey: GroupKey | null = null,
  emptyGroups: GroupKey[] = [],
): T[] {
  return termFiltered(rows, term).filter((row) =>
    GROUPS.every((group) => {
      if (group.key === skippedKey) return true;
      if (emptyGroups.includes(group.key)) return false;
      if (!selected[group.key]?.length) return true;
      return selected[group.key].includes(String(row[group.key]));
    }),
  );
}
export function optionsFor(
  group: GroupSpec,
  rows: FilterableRow[],
  term: InsightTerm,
  selected: Selected,
): string[] {
  const values = new Set(
    termFiltered(rows, term)
      .map((row) => row[group.key])
      .filter((value) => value !== null && value !== undefined)
      .map(String),
  );
  selected[group.key].forEach((value) => values.add(String(value)));
  return [...values].sort(
    group.numeric ? (a, b) => Number(a) - Number(b) : (a, b) => a.localeCompare(b),
  );
}
export function optionCount(
  group: GroupSpec,
  value: string,
  rows: FilterableRow[],
  term: InsightTerm,
  selected: Selected,
  emptyGroups: GroupKey[] = [],
): number {
  return attributeFiltered(
    rows,
    term,
    { ...selected, model: [] },
    group.key,
    emptyGroups.filter((key) => key !== 'model'),
  ).filter((row) => String(row[group.key]) === String(value)).length;
}
export function selectedCount(
  selected: Selected,
  panels: readonly Panel[],
  tradeModel: string | null,
  emptyGroups: GroupKey[] = [],
): number {
  return (
    GROUPS.reduce(
      (total, group) =>
        total +
        (group.key === 'model' && !panels.includes('index')
          ? 0
          : selected[group.key].length + (emptyGroups.includes(group.key) ? 1 : 0)),
      0,
    ) + (tradeModel && panels.some((panel) => panel !== 'index') ? 1 : 0)
  );
}
export function tradeModels(rows: FilterableRow[]): string[] {
  return [
    ...new Set(
      rows
        .map((row) => row.model)
        .filter(Boolean)
        .map(String),
    ),
  ].sort((a, b) => a.localeCompare(b));
}
/** Picks a default trade model when the current one is unavailable (H100 SXM → H100 → first). */
export function synchronizeTradeModel(
  rows: FilterableRow[],
  current: string | null,
): string | null {
  const models = tradeModels(rows);
  if (current && models.includes(current)) return current;
  return (
    models.find((model) => model === 'H100 SXM') ||
    models.find((model) => model === 'H100') ||
    models[0] ||
    null
  );
}
export function tradeFiltered(
  rows: Settlement[],
  term: InsightTerm,
  selected: Selected,
  tradeModel: string | null,
  emptyGroups: GroupKey[] = [],
): Settlement[] {
  if (!tradeModel) return [];
  return attributeFiltered(
    rows,
    term,
    { ...selected, model: [tradeModel] },
    null,
    emptyGroups.filter((key) => key !== 'model'),
  );
}
export function recentWindow(
  rows: Settlement[],
  now = Date.now(),
  days: number | string | null = 7,
): Settlement[] {
  if (days === null || days === 'ALL') return rows.filter((row) => row.settledAtTime <= now);
  const safeDays = Number(days);
  if (!Number.isFinite(safeDays) || safeDays <= 0) return [];
  const start = now - safeDays * DAY_MS;
  return rows.filter((row) => row.settledAtTime >= start && row.settledAtTime <= now);
}
export function allowedActivityLimit(value: unknown): number | null {
  const limit = Number(value);
  return Number.isSafeInteger(limit) && ACTIVITY_SHOW_OPTIONS.includes(limit) ? limit : null;
}
export function latestMatching(rows: Settlement[], limit: unknown = ACTIVITY_LIMIT): Settlement[] {
  const safeLimit = allowedActivityLimit(limit) ?? ACTIVITY_LIMIT;
  return rows
    .slice()
    .sort((a, b) => b.settledAtTime - a.settledAtTime || b.id.localeCompare(a.id))
    .slice(0, safeLimit);
}

export interface PriceBand {
  lowerCents: number;
  trades: number;
  gpus: number;
  share: number;
  relative: number;
}
export function priceBands(rows: Settlement[], stepCents: number) {
  if (!(GROUPING_STEPS as readonly number[]).includes(stepCents))
    throw new RangeError('Unsupported grouping step.');
  const map = new Map<number, PriceBand>();
  let totalGpus = 0;
  let weightedCents = 0;
  for (const row of rows) {
    const lowerCents = Math.floor(row.priceCents / stepCents) * stepCents;
    const current = map.get(lowerCents) || {
      lowerCents,
      trades: 0,
      gpus: 0,
      share: 0,
      relative: 0,
    };
    current.trades += 1;
    current.gpus += row.gpuCount;
    map.set(lowerCents, current);
    totalGpus += row.gpuCount;
    weightedCents += row.priceCents * row.gpuCount;
  }
  const bands = [...map.values()].sort((a, b) => b.lowerCents - a.lowerCents);
  const maxBandGpus = Math.max(0, ...bands.map((band) => band.gpus));
  for (const band of bands) {
    band.share = totalGpus ? band.gpus / totalGpus : 0;
    band.relative = maxBandGpus ? band.gpus / maxBandGpus : 0;
  }
  const top = bands.reduce<PriceBand | null>(
    (best, band) => (!best || band.gpus > best.gpus ? band : best),
    null,
  );
  return {
    bands,
    trades: rows.length,
    totalGpus,
    weightedAverageCents: totalGpus ? Math.round(weightedCents / totalGpus) : null,
    topShare: top?.share || 0,
  };
}
export const usdCents = (cents: unknown, digits = 2) => '$' + (Number(cents) / 100).toFixed(digits);
export const integer = (value: unknown) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value) || 0);
export function bandLabel(lowerCents: number, stepCents: number): { short: string; range: string } {
  const digits = stepCents === 100 ? 0 : stepCents === 10 ? 1 : 2;
  const short = usdCents(lowerCents, digits);
  const upperCents = lowerCents + stepCents - 1;
  return {
    short,
    range: stepCents === 1 ? short : usdCents(lowerCents) + '–' + usdCents(upperCents),
  };
}
export const stepLabel = (stepCents: number) =>
  stepCents === 100 ? '$1' : stepCents === 10 ? '$0.10' : '$0.01';
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  return (
    new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'UTC',
    }).format(date) + ' UTC'
  );
}
