import type { PriceRecord } from '@opennext/contracts';
import { countryFor } from '@/features/market';
import type { SpotRow } from '@/features/spot-market';

export const INSTANCE_TERMS = ['Spot', 'On-demand', 'Reserved'] as const;
export type InstanceTerm = (typeof INSTANCE_TERMS)[number];
export function instanceTerm(value: string | null | undefined): InstanceTerm | null {
  const term = String(value || '')
    .toLowerCase()
    .replace(/[ _-]/g, '');
  return term === 'spot'
    ? 'Spot'
    : term === 'ondemand'
      ? 'On-demand'
      : term === 'reserved' || term === 'reservation'
        ? 'Reserved'
        : null;
}
export interface CatalogRow {
  id: string;
  model: string;
  capacity: number;
  hourly: number;
  perGpuHourly: number;
  country: string;
  vcpu: number | null;
  memory: number | null;
  term: InstanceTerm;
  source: string;
  state: string;
  observedAt: string;
  currency: string;
}
export function collectedRows(prices: PriceRecord[]): CatalogRow[] {
  return prices.flatMap((price) => {
    const term = instanceTerm(price.term);
    if (
      !term ||
      !Number.isFinite(price.perGpuHourly) ||
      price.perGpuHourly <= 0 ||
      price.gpuCount <= 0
    )
      return [];
    return [
      {
        id: price.recordId,
        model: price.gpuModel || 'Not provided',
        capacity: price.gpuCount,
        hourly: price.instanceHourly ?? price.perGpuHourly * price.gpuCount,
        perGpuHourly: price.perGpuHourly,
        country: countryFor(price.region) || price.region,
        vcpu: price.vCpu ?? null,
        memory: price.gpuMemoryGb ?? null,
        term,
        source: price.provider,
        state: price.stale
          ? 'Stale observation'
          : price.availability === false
            ? 'Unavailable · reference price'
            : 'Price observation',
        observedAt: price.observedAt || '',
        currency: price.currency || 'USD',
      },
    ];
  });
}
export function terminalRows(rows: SpotRow[]): CatalogRow[] {
  return rows
    .filter((row) => !row.previewOnly)
    .map((row) => ({
      id: row.id,
      model: row.model,
      capacity: row.gpuCount,
      hourly: row.instanceHourly,
      perGpuHourly: row.perGpuHourly,
      country: row.country,
      vcpu: row.vcpu,
      memory: row.memory,
      term: row.term,
      source: row.provider,
      state: 'Terminal feed',
      observedAt: row.listedAt || '',
      currency: 'USD',
    }));
}
export interface CatalogFilters {
  query: string;
  model: string;
  country: string;
  source: string;
  capacity: string;
  vcpu: string;
  memory: string;
}
export const emptyCatalogFilters = (): CatalogFilters => ({
  query: '',
  model: '',
  country: '',
  source: '',
  capacity: '',
  vcpu: '',
  memory: '',
});
export function filterCatalog(rows: CatalogRow[], term: InstanceTerm, filters: CatalogFilters) {
  return rows.filter(
    (row) =>
      row.term === term &&
      [row.model, row.id, row.country, row.source]
        .join(' ')
        .toLowerCase()
        .includes(filters.query.toLowerCase()) &&
      (['model', 'country', 'source', 'capacity', 'vcpu', 'memory'] as const).every(
        (key) => !filters[key] || String(row[key]) === filters[key],
      ),
  );
}
