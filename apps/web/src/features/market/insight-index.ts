/**
 * Historical GPU price index used on the seller "Market Insight" page. Pure logic ported from
 * legacy OpenNEXT-market-insight-index.js; the chart itself is RegionalHistoryChart.
 */
import type { CatalogRegion, HistoryCatalog, RegionalHistoryResponse, RegionalSeries } from '@opennext/contracts';
import { CATALOG, type PriceMetric } from './catalog';

export const INSIGHT_PERIODS: Record<string, string> = { '24H': '1D', '3D': '3D', '7D': '1W', '1M': '1M' };
export const INSIGHT_TERMS = ['Spot', 'On-demand', 'Reserved'] as const;
export const INSIGHT_METRICS: Record<PriceMetric, string> = { max: 'Maximum', avg: 'Average', min: 'Minimum' };

const COUNTRIES: Record<string, string> = {
  'af-south-1': 'South Africa', 'ap-east-1': 'Hong Kong', 'ap-east-2': 'Taiwan', 'ap-northeast-1': 'Japan', 'ap-northeast-2': 'South Korea',
  'ap-northeast-3': 'Japan', 'ap-south-1': 'India', 'ap-south-2': 'India', 'ap-southeast-1': 'Singapore', 'ap-southeast-2': 'Australia',
  'ap-southeast-3': 'Indonesia', 'ap-southeast-4': 'Australia', 'ap-southeast-5': 'Malaysia', 'ap-southeast-6': 'New Zealand',
  'ap-southeast-7': 'Thailand', 'ca-central-1': 'Canada', 'ca-west-1': 'Canada', 'cn-north-1': 'China', 'cn-northwest-1': 'China',
  'eu-central-1': 'Germany', 'eu-central-2': 'Switzerland', 'eu-north-1': 'Sweden', 'eu-south-1': 'Italy', 'eu-south-2': 'Spain',
  'eu-west-1': 'Ireland', 'eu-west-2': 'United Kingdom', 'eu-west-3': 'France', 'il-central-1': 'Israel', 'me-central-1': 'United Arab Emirates',
  'me-south-1': 'Bahrain', 'mx-central-1': 'Mexico', 'sa-east-1': 'Brazil', 'us-east-1': 'United States', 'us-east-2': 'United States',
  'us-west-1': 'United States', 'us-west-2': 'United States', 'us-gov-east-1': 'United States', 'us-gov-west-1': 'United States',
};
const CITY_COUNTRIES: Record<string, string> = {
  'cape town': 'South Africa', 'hong kong': 'Hong Kong', tokyo: 'Japan', osaka: 'Japan', seoul: 'South Korea', mumbai: 'India', hyderabad: 'India',
  singapore: 'Singapore', sydney: 'Australia', melbourne: 'Australia', jakarta: 'Indonesia', malaysia: 'Malaysia', 'canada central': 'Canada',
  frankfurt: 'Germany', zurich: 'Switzerland', stockholm: 'Sweden', milan: 'Italy', spain: 'Spain', ireland: 'Ireland', dublin: 'Ireland',
  london: 'United Kingdom', paris: 'France', 'tel aviv': 'Israel', uae: 'United Arab Emirates', dubai: 'United Arab Emirates', 'sao paulo': 'Brazil',
  'n. virginia': 'United States', ohio: 'United States', 'n. california': 'United States', oregon: 'United States',
};

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase();
const positive = (value: unknown) => value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) > 0;

export function normalizeCountry(value: unknown): string {
  const code = norm(value);
  return ({ usa: 'United States', us: 'United States', uk: 'United Kingdom', uae: 'United Arab Emirates', korea: 'South Korea' } as Record<string, string>)[code] || String(value || '').trim();
}

export function countryFor(region: unknown, details: { country?: string | null; city?: string | null; name?: string | null } = {}): string | null {
  const code = norm(region);
  if (COUNTRIES[code]) return COUNTRIES[code];
  if (details.country) return normalizeCountry(details.country);
  return CITY_COUNTRIES[norm(details.city)] || CITY_COUNTRIES[norm(details.name)] || CITY_COUNTRIES[code] || Object.values(COUNTRIES).find((value) => norm(value) === code) || null;
}

export interface InsightOptions {
  range: string | null;
  term: string;
  selected: Record<'model' | 'country' | 'vcpu' | 'memory', string[]>;
}

export function optionsCopy(options: { range?: unknown; term?: unknown; selected?: Partial<Record<string, unknown>> } = {}): InsightOptions {
  const range = typeof options.range === 'string' && INSIGHT_PERIODS[options.range] ? options.range : null;
  const term = (INSIGHT_TERMS as readonly string[]).includes(String(options.term)) ? String(options.term) : 'All';
  const selected = Object.fromEntries(
    (['model', 'country', 'vcpu', 'memory'] as const).map((key) => {
      const value = options.selected?.[key];
      return [key, Array.isArray(value) ? [...new Set(value.map(String))] : []];
    }),
  ) as InsightOptions['selected'];
  return { range, term, selected };
}

export interface InsightCatalog {
  loaded: boolean;
  loadedAt: number;
  models: string[];
  regions: CatalogRegion[];
  rows: { model: string; country: string | null; vcpu: number | null; memory: number | null; term: null }[];
  raw: Omit<RegionalSeries, 'points'>[];
}

export const emptyInsightCatalog = (): InsightCatalog => ({ loaded: false, loadedAt: 0, models: [], regions: [], rows: [], raw: [] });

export function buildCatalog(publicCatalog: HistoryCatalog | null | undefined, rawHistory: RegionalHistoryResponse | null | undefined): Omit<InsightCatalog, 'loaded' | 'loadedAt'> {
  const regions = publicCatalog?.regions || rawHistory?.regions || [];
  const raw = (rawHistory?.series || []).filter((row) => Number.isInteger(row.gpuCount) && (row.gpuCount as number) > 0);
  const source: Array<Partial<RegionalSeries> & { region: string; gpuModel?: string | null }> = raw.length
    ? raw
    : (publicCatalog?.specifications || []).flatMap((row) => (row.regions || []).map((region) => ({ ...row, region })));
  const distinct = new Map<string, InsightCatalog['rows'][number]>();
  for (const row of source) {
    const region = regions.find((item) => item.code === row.region) || {};
    const model = String(row.gpuModel || '').trim();
    if (!model) continue;
    const vcpuRaw = row.vCpu ?? row.vcpu;
    const entry = { model, country: countryFor(row.region, region), vcpu: positive(vcpuRaw) ? Number(vcpuRaw) : null, memory: positive(row.gpuMemoryGb) ? Number(row.gpuMemoryGb) : null, term: null };
    const key = JSON.stringify(entry);
    if (!distinct.has(key)) distinct.set(key, entry);
  }
  return {
    regions,
    raw: raw.map((row) => {
      const { points, ...metadata } = row;
      void points;
      return metadata;
    }),
    rows: [...distinct.values()],
    models: [...new Set(source.map((row) => String(row.gpuModel || '').trim()).filter(Boolean))].sort(),
  };
}

export function modelInfo(label: unknown, catalogModels: string[] = []): { base: string; form: string | null; memory: number | null } {
  const text = String(label ?? '');
  const direct = CATALOG.find((row) => row.name === text);
  const known = [...new Set([...catalogModels, ...CATALOG.map((row) => row.canonical)])].filter(Boolean).sort((a, b) => b.length - a.length);
  const base = direct?.canonical || known.find((value) => norm(text) === norm(value) || norm(text).startsWith(norm(value) + ' ')) || (text || 'H100').replace(/\s+(SXM|PCIe|NVL72)(?:\s.*)?$/i, '');
  const form = /\b(SXM|PCIe|NVL72)\b/i.exec(text)?.[1] || null;
  const memory = /\b(\d+(?:\.\d+)?)\s*GB\b/i.exec(text);
  return { base, form, memory: memory ? Number(memory[1]) : null };
}

export function availableModels(options: InsightOptions, catalogModels: string[]): string[] {
  if (options.selected.model.length) return options.selected.model;
  return [...new Set(['H100', ...catalogModels, ...CATALOG.map((row) => row.canonical).filter(Boolean)])];
}

export function requestQuery(options: InsightOptions, model: string, term: string, catalogModels: string[] = []): string {
  const spec = modelInfo(model, catalogModels);
  const query = new URLSearchParams({ gpuModel: spec.base, region: 'all', term, period: INSIGHT_PERIODS[options.range || ''] || '1D', metric: 'avg' });
  if (spec.form) query.set('formFactor', spec.form);
  if (spec.memory !== null) query.set('gpuMemoryGb', String(spec.memory));
  return query.toString();
}

function exactMetadata(series: RegionalSeries, data: RegionalHistoryResponse, catalog: InsightCatalog): { vcpu: number | null } {
  const direct = series.vCpu ?? series.vcpu;
  if (positive(direct)) return { vcpu: Number(direct) };
  if (data.meta?.sourceKind !== 'uploaded_daily_history') return { vcpu: null };
  const instance = series.instanceType || series.configuration;
  const matches = catalog.raw.filter(
    (row) => row.region === series.region && row.gpuModel === series.gpuModel && row.instanceType === instance && row.gpuCount === series.gpuCount && Number(row.gpuMemoryGb) === Number(series.gpuMemoryGb),
  );
  const counts = [...new Set(matches.map((row) => row.vCpu ?? row.vcpu).filter(positive).map(Number))];
  return { vcpu: counts.length === 1 ? counts[0] : null };
}

export interface FilteredInsight {
  data: RegionalHistoryResponse;
  unknown: { vcpu: number; country: number; form: number };
}

export function filterData(data: RegionalHistoryResponse, options: InsightOptions, focusedModel: string, focusedTerm: string = options.term, catalog: InsightCatalog = emptyInsightCatalog()): FilteredInsight {
  const model = modelInfo(focusedModel, catalog.models);
  const want = options.selected;
  const unknown = { vcpu: 0, country: 0, form: 0 };
  const sourceRegions = data.regions || [];
  const series = (data.series || [])
    .filter((row) => {
      if ((INSIGHT_TERMS as readonly string[]).includes(focusedTerm) && (data.term !== focusedTerm || (row.term && row.term !== focusedTerm))) return false;
      if (!Number.isInteger(row.gpuCount) || (row.gpuCount as number) < 1 || norm(row.gpuModel) !== norm(model.base)) return false;
      if (model.form && norm(row.formFactor) !== norm(model.form)) {
        if (!row.formFactor) unknown.form++;
        return false;
      }
      if (model.memory !== null && Number(row.gpuMemoryGb) !== model.memory) return false;
      const region = sourceRegions.find((item) => item.code === row.region) || catalog.regions.find((item) => item.code === row.region) || {};
      const country = countryFor(row.region, region);
      const metadata = exactMetadata(row, data, catalog);
      if (want.country.length && !want.country.some((value) => norm(normalizeCountry(value)) === norm(country))) {
        if (!country) unknown.country++;
        return false;
      }
      if (want.vcpu.length && (!positive(metadata.vcpu) || !want.vcpu.some((value) => Number(value) === metadata.vcpu))) {
        if (!positive(metadata.vcpu)) unknown.vcpu++;
        return false;
      }
      if (want.memory.length && (!positive(row.gpuMemoryGb) || !want.memory.some((value) => Number(value) === Number(row.gpuMemoryGb)))) return false;
      return true;
    })
    .map((row) => ({ ...row, points: (row.points || []).map((point) => ({ ...point })) }));
  const codes = new Set(series.map((row) => row.region));
  return { data: { ...data, series, regions: sourceRegions.filter((row) => codes.has(row.code)), meta: { ...data.meta } }, unknown };
}

export function emptyReason(unknown: FilteredInsight['unknown']): string {
  return unknown.vcpu
    ? 'The recorded offerings do not provide a verified matching vCPU configuration.'
    : unknown.form
      ? 'The historical catalog does not verify this form-factor variant.'
      : unknown.country
        ? 'The recorded regions could not be verified against the selected countries.'
        : 'No recorded configuration matches the selected model, country and hardware filters.';
}

export function scopeText(options: InsightOptions): string {
  return [
    options.selected.country.length ? options.selected.country.map(normalizeCountry).join(', ') : 'All countries',
    options.selected.vcpu.length ? options.selected.vcpu.join(' / ') + ' vCPU per node' : null,
    options.selected.memory.length ? options.selected.memory.join(' / ') + ' GB per GPU' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
