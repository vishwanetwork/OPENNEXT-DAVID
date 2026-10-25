/**
 * GPU catalog, regions and provider-price matching. Ported from legacy OpenNEXT-market-data.js
 * as pure functions; the collected records come from React Query (see hooks.ts).
 */
import type { CatalogRegion, PriceRecord } from '@opennext/contracts';

export interface CatalogModel {
  name: string;
  memory: number | string;
  canonical: string;
  network: string;
  seed: number;
}

export interface Region {
  name: string;
  code: string;
  city: string;
  aliases?: string[];
}

const RAW_CATALOG: [string, number | string, string][] = [
  ['H100', 80, 'H100'],
  ['H100 SXM', 80, 'H100'],
  ['H100 PCIe', 80, 'H100'],
  ['H200', 141, 'H200'],
  ['B200', 180, 'B200'],
  ['B300', 288, 'B300'],
  ['GB200 Grace Blackwell', 186, 'GB200'],
  ['GB200 NVL72', 186, 'GB200'],
  ['GB300 NVL72', 279, 'GB300'],
  ['A100 80GB', 80, 'A100'],
  ['A100 (all memory sizes)', '40 / 80', 'A100'],
  ['A100 PCIe', 80, 'A100'],
  ['L40S', 48, 'L40S'],
  ['RTX PRO 6000 Blackwell', 96, 'RTX PRO 6000'],
  ['RTX 5090', 32, 'RTX 5090'],
  ['RTX 4090', 24, 'RTX 4090'],
  ['AMD MI300X', 192, 'MI300X'],
  ['AMD MI325X', 256, 'MI325X'],
  ['AMD MI355X', 288, 'MI355X'],
  ['NVIDIA GH200', 96, 'GH200'],
  ['A10G', 24, 'A10G'],
  ['L4', 24, 'L4'],
  ['T4', 16, 'T4'],
  ['T4G', 16, 'T4G'],
  ['AMD V520', 8, 'V520'],
  ['RTX PRO 4500', 32, 'RTX PRO 4500'],
  ['V100', 32, 'V100'],
];

export const CATALOG: readonly CatalogModel[] = RAW_CATALOG.map(([name, memory, canonical], i) => ({
  name,
  memory,
  canonical,
  network: 'Instance topology confirmed in supplier quote',
  seed: i + 1,
}));

export const BASE_REGIONS: readonly Region[] = [
  { name: 'US East', code: 'us-east-1', city: 'N. Virginia' },
  { name: 'US East · Ohio', code: 'us-east-2', city: 'Ohio' },
  { name: 'US West', code: 'us-west-2', city: 'Oregon' },
  { name: 'Singapore', code: 'ap-southeast-1', city: 'Singapore' },
  { name: 'Frankfurt', code: 'eu-central-1', city: 'Frankfurt' },
  { name: 'Ireland', code: 'eu-west-1', city: 'Dublin' },
  { name: 'Tokyo', code: 'ap-northeast-1', city: 'Tokyo' },
  { name: 'Mumbai', code: 'ap-south-1', city: 'Mumbai' },
  { name: 'Seoul', code: 'ap-northeast-2', city: 'Seoul' },
  { name: 'Dubai', code: 'me-central-1', city: 'Dubai' },
];

export const PROVIDER_NAMES: Record<string, string> = {
  aws: 'AWS',
  vultr: 'Vultr',
  lambda: 'Lambda',
  shadeform: 'Shadeform',
};

export const ALL_REGIONS = 'All regions';

/** Regions after the history catalog has been loaded: readable names win, old names become aliases. */
export function mergeRegions(
  base: readonly Region[],
  catalog: readonly CatalogRegion[] | undefined,
): Region[] {
  const regions: Region[] = base.map((r) => ({
    ...r,
    aliases: r.aliases ? [...r.aliases] : undefined,
  }));
  for (const entry of catalog || []) {
    const current = regions.find((x) => x.code === entry.code);
    if (current) {
      current.aliases = [...(current.aliases || []), current.name];
      current.name = entry.name;
      current.city = entry.city || entry.name;
    } else regions.push({ name: entry.name, code: entry.code, city: entry.city || entry.name });
  }
  return regions;
}

export const modelOf = (name: string | undefined): CatalogModel =>
  CATALOG.find((m) => m.name === name) || {
    name: String(name ?? ''),
    canonical: String(name ?? ''),
    memory: '',
    network: '',
    seed: 0,
  };

export const regionCode = (regions: readonly Region[], value: string): string =>
  regions.find((r) => r.name === value || r.code === value || r.aliases?.includes(value))?.code ||
  value;

export const regionLabel = (regions: readonly Region[], value: string | null | undefined): string =>
  regions.find((r) => r.code === value)?.name ||
  (value === 'unspecified' ? 'Region not specified' : String(value ?? ''));

export interface OfferFilters {
  model?: string;
  gpuModel?: string;
  region?: string;
  term?: string;
  count?: number | string | null;
}

export function matchesRecord(
  row: PriceRecord,
  filters: OfferFilters,
  regions: readonly Region[],
): boolean {
  const model = filters.model || filters.gpuModel;
  const m = modelOf(model);
  if (filters.model && row.gpuModel !== m.canonical) return false;
  if (['A100 80GB', 'A100 PCIe'].includes(filters.model || '') && row.gpuMemoryGb !== 80)
    return false;
  if (/PCIe/i.test(filters.model || '') && !/pcie/i.test(row.formFactor || '')) return false;
  if (/SXM/i.test(filters.model || '') && !/sxm/i.test(row.formFactor || '')) return false;
  if (/NVL72/i.test(filters.model || '') && !/nvl72/i.test(row.formFactor || '')) return false;
  if (
    filters.region &&
    filters.region !== ALL_REGIONS &&
    row.region !== regionCode(regions, filters.region)
  )
    return false;
  if (filters.term && row.term !== filters.term) return false;
  if (
    filters.count !== undefined &&
    filters.count !== null &&
    row.gpuCount !== Number(filters.count)
  )
    return false;
  return true;
}

/** A provider price presented as a market offer (the shape every page and modal consumes). */
export interface Offer {
  id: string;
  recordId: string;
  model: string;
  provider: string;
  sourceProvider: string;
  region: string;
  regionCode: string;
  city: string;
  term: string;
  count: number;
  price: number;
  instanceHourly: number | null;
  instanceType: string | null;
  available: number | null;
  availability: boolean | null;
  delivery: number | null;
  rating: number | null;
  response: number | null;
  uptime: number | null;
  memory: number | string | null;
  network: string;
  fit: number | null;
  reviews: number | null;
  validUntil: string | null;
  observedAt: string | null;
  effectiveAt: string | null;
  sourceUrl: string | null;
  priceKind: string | null;
  stale: boolean;
  currency: string | null;
  operatingSystem: string | null;
  tenancy: string | null;
  side?: string;
}

export function offersFor(
  records: readonly PriceRecord[],
  filters: OfferFilters,
  regions: readonly Region[],
): Offer[] {
  const m = modelOf(filters.model);
  return records
    .filter((row) => matchesRecord(row, filters, regions))
    .map<Offer>((row) => ({
      id: row.recordId,
      recordId: row.recordId,
      model: filters.model || row.gpuModel || '',
      provider:
        (PROVIDER_NAMES[row.provider] || row.provider) +
        (row.underlyingProvider ? ' · ' + row.underlyingProvider : ''),
      sourceProvider: row.provider,
      region: regionLabel(regions, row.region),
      regionCode: row.region,
      city: regionLabel(regions, row.region),
      term: row.term,
      count: row.gpuCount,
      price: row.perGpuHourly,
      instanceHourly: row.instanceHourly ?? null,
      instanceType: row.instanceType ?? null,
      available: null,
      availability: row.availability ?? null,
      delivery: null,
      rating: null,
      response: null,
      uptime: null,
      memory: row.gpuMemoryGb ?? m.memory,
      network: m.network,
      fit: null,
      reviews: null,
      validUntil: null,
      observedAt: row.observedAt ?? null,
      effectiveAt: row.effectiveAt ?? null,
      sourceUrl: row.sourceUrl ?? null,
      priceKind: row.priceKind ?? null,
      stale: Boolean(row.stale),
      currency: row.currency ?? null,
      operatingSystem: row.operatingSystem ?? null,
      tenancy: row.tenancy ?? null,
    }))
    .sort((a, b) => a.price - b.price);
}

/** Lowest collected price for a model and term, or null when nothing was collected. */
export function basePrice(
  records: readonly PriceRecord[],
  model: CatalogModel | undefined,
  term: string,
  regions: readonly Region[],
): number | null {
  const prices = records
    .filter((r) => matchesRecord(r, { model: model?.name, term }, regions))
    .map((r) => r.perGpuHourly);
  return prices.length ? Math.min(...prices) : null;
}

/** AWS On-demand reference for a model. */
export function reference(
  records: readonly PriceRecord[],
  model: CatalogModel,
  regions: readonly Region[],
  meta: { fetchedAt?: string | null; status?: string | null },
) {
  const rows = records.filter(
    (r) =>
      r.provider === 'aws' && matchesRecord(r, { model: model.name, term: 'On-demand' }, regions),
  );
  return {
    source: 'AWS public On-demand catalog',
    url: 'https://aws.amazon.com/ec2/pricing/on-demand/',
    updated: meta.fetchedAt ?? null,
    status: meta.status ?? null,
    locations: [...new Set(rows.map((r) => r.region))],
    nodeGPUs: null,
    publicPrice: rows.length ? Math.min(...rows.map((r) => r.perGpuHourly)) : null,
  };
}

export interface MarketSelection {
  model: string;
  region: string;
  term: string;
  count: number;
  period: string;
  priceMetric: PriceMetric;
  priceMetrics: PriceMetric[];
}

export type PriceMetric = 'min' | 'avg' | 'max';
export const PRICE_METRICS: PriceMetric[] = ['max', 'avg', 'min'];
export const METRIC_LABELS: Record<PriceMetric, string> = {
  min: 'Lowest price',
  avg: 'Average price',
  max: 'Highest price',
};
export const METRIC_SHORT: Record<PriceMetric, string> = {
  min: 'Lowest',
  avg: 'Average',
  max: 'Highest',
};
export const METRIC_DASH: Record<PriceMetric, string> = { max: '8 4', avg: '', min: '2 4' };
export const PERIODS = ['1D', '3D', '1W', '1M', '3M', '6M', '1Y', 'ALL'] as const;
export const FREE_PERIODS = ['1D', '3D', '1W', '1M', '3M'] as const;
export const TERMS = ['Spot', 'On-demand', 'Reserved'] as const;

/** Ordered, de-duplicated metric list; always at least `['avg']`. */
export function normalizeMetrics(values: unknown, legacy: unknown = 'avg'): PriceMetric[] {
  const selected = Array.isArray(values) ? values : [legacy];
  const valid = PRICE_METRICS.filter((metric) => selected.includes(metric));
  return valid.length ? valid : ['avg'];
}

export const metricsOf = (selection: {
  priceMetrics?: unknown;
  priceMetric?: unknown;
}): PriceMetric[] => {
  const selected = Array.isArray(selection.priceMetrics)
    ? PRICE_METRICS.filter((metric) => (selection.priceMetrics as unknown[]).includes(metric))
    : [];
  if (selected.length) return selected;
  return [
    PRICE_METRICS.includes(selection.priceMetric as PriceMetric)
      ? (selection.priceMetric as PriceMetric)
      : 'avg',
  ];
};
export const primaryMetric = (selection: {
  priceMetrics?: unknown;
  priceMetric?: unknown;
}): PriceMetric =>
  metricsOf(selection).includes('avg') ? 'avg' : (metricsOf(selection)[0] ?? 'avg');

/** Query string for `/api/pricing/regional-history` (the chart the Terminal shows). */
export function regionalHistoryQuery(
  selection: MarketSelection,
  regions: readonly Region[],
): string {
  const query = new URLSearchParams({
    gpuModel: modelOf(selection.model).canonical,
    gpuCount: String(selection.count),
    region: selection.region === ALL_REGIONS ? 'all' : regionCode(regions, selection.region),
    term: selection.term || 'Spot',
    period: (FREE_PERIODS as readonly string[]).includes(selection.period)
      ? selection.period
      : '3D',
    metric: primaryMetric(selection),
  });
  const form = /PCIe|SXM|NVL72/i.exec(selection.model);
  if (form) query.set('formFactor', form[0]);
  if (['A100 80GB', 'A100 PCIe'].includes(selection.model)) query.set('gpuMemoryGb', '80');
  return query.toString();
}

/** Query string for the legacy AWS observation history (`/api/pricing/history`). */
export function historyQuery(
  filters: { model: string; region: string; term: string; period?: string; count?: number },
  regions: readonly Region[],
): string {
  const q = new URLSearchParams({
    provider: 'aws',
    gpuModel: modelOf(filters.model).canonical,
    region: filters.region === ALL_REGIONS ? 'all' : regionCode(regions, filters.region),
    term: filters.term,
    period: filters.period || '1M',
    gpuCount: String(filters.count || 8),
  });
  if (['A100 80GB', 'A100 PCIe'].includes(filters.model)) q.set('gpuMemoryGb', '80');
  if (/PCIe/i.test(filters.model)) q.set('formFactor', 'PCIe');
  if (/SXM/i.test(filters.model)) q.set('formFactor', 'SXM');
  if (/NVL72/i.test(filters.model)) q.set('formFactor', 'NVL72');
  return q.toString();
}

/** Display labels drop machine identities (instance sizes, region codes). */
export const cleanLabel = (value: unknown): string =>
  String(value ?? '')
    .replace(/\b[a-z][a-z0-9-]*\.(?:\d*xlarge|large|medium|small|micro|nano|metal)\b/gi, '')
    .replace(/\b(?:af|ap|ca|cn|eu|il|me|mx|sa|us)(?:-[a-z0-9]+)+-\d[a-z]?\b/gi, '')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/\s*[·|,]\s*(?=[·|,]|$)/g, '')
    .replace(/^[\s·|,–—-]+|[\s·|,–—-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

/** Region label as the Terminal shows it (cleaned of instance/zone suffixes). */
export const regionText = (regions: readonly Region[], value: string | null | undefined): string =>
  cleanLabel(regionLabel(regions, value));
