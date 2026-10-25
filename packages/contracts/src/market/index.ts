import { z } from 'zod';

const num = z.number().nullish();
const str = z.string().nullish();

/** One collected provider price (`GET /api/pricing/prices`). */
export const PriceRecord = z
  .object({
    recordId: z.string(),
    provider: z.string(),
    underlyingProvider: str,
    gpuModel: str,
    gpuMemoryGb: num,
    formFactor: str,
    region: z.string(),
    term: z.string(),
    gpuCount: z.number(),
    perGpuHourly: z.number(),
    instanceHourly: num,
    instanceType: str,
    availability: z.boolean().nullish(),
    observedAt: str,
    effectiveAt: str,
    sourceUrl: str,
    priceKind: str,
    stale: z.boolean().optional(),
    currency: str,
    operatingSystem: str,
    tenancy: str,
    vCpu: num,
  })
  .passthrough();
export type PriceRecord = z.infer<typeof PriceRecord>;

export const PricesMeta = z
  .object({ status: str, message: str, fetchedAt: str, stale: z.boolean().optional() })
  .passthrough();
export type PricesMeta = z.infer<typeof PricesMeta>;

export const PricesResponse = z
  .object({ records: z.array(PriceRecord).default([]), meta: PricesMeta.default({}) })
  .passthrough();
export type PricesResponse = z.infer<typeof PricesResponse>;

export const CatalogRegion = z
  .object({ code: z.string(), name: z.string(), city: str })
  .passthrough();
export type CatalogRegion = z.infer<typeof CatalogRegion>;

/** `GET /api/pricing/history-catalog` */
export const HistoryCatalog = z
  .object({
    regions: z.array(CatalogRegion).default([]),
    specifications: z
      .array(z.object({ gpuModel: str, regions: z.array(z.string()).optional() }).passthrough())
      .optional(),
  })
  .passthrough();
export type HistoryCatalog = z.infer<typeof HistoryCatalog>;

/** `GET /api/pricing/history` (AWS observation series). */
export const HistoryPoint = z
  .object({ time: z.string(), value: z.number(), instanceHourly: num })
  .passthrough();
export const HistorySeries = z
  .object({
    recordId: z.string(),
    region: z.string(),
    gpuCount: z.number().optional(),
    points: z.array(HistoryPoint).default([]),
  })
  .passthrough();
export const HistoryResponse = z
  .object({
    series: z.array(HistorySeries).default([]),
    meta: z
      .object({ status: str, message: str, stale: z.boolean().optional() })
      .passthrough()
      .default({}),
  })
  .passthrough();
export type HistoryResponse = z.infer<typeof HistoryResponse>;

/** `GET /api/pricing/regional-history` — one bucketed series per region/configuration. */
export const RegionalPoint = z
  .object({ time: z.string(), min: num, avg: num, max: num, value: num })
  .passthrough();
export type RegionalPoint = z.infer<typeof RegionalPoint>;
export const RegionalSeries = z
  .object({
    id: z.string(),
    region: z.string(),
    name: str,
    configuration: str,
    gpuCount: z.number().nullish(),
    gpuModel: str,
    formFactor: str,
    gpuMemoryGb: num,
    vCpu: num,
    vcpu: num,
    instanceType: str,
    term: str,
    points: z.array(RegionalPoint).default([]),
  })
  .passthrough();
export type RegionalSeries = z.infer<typeof RegionalSeries>;
export const RegionalHistoryMeta = z
  .object({
    bucketMinutes: num,
    lastSync: str,
    snapshotAsOf: str,
    aggregation: str,
    missingDataPolicy: str,
    syncing: z.boolean().optional(),
    sourceKind: str,
  })
  .passthrough();
export const RegionalHistoryResponse = z
  .object({
    series: z.array(RegionalSeries).default([]),
    regions: z.array(CatalogRegion).default([]),
    term: str,
    metric: str,
    meta: RegionalHistoryMeta.default({}),
  })
  .passthrough();
export type RegionalHistoryResponse = z.infer<typeof RegionalHistoryResponse>;

/** `GET /api/news` */
export const NewsArticle = z
  .object({ title: z.string(), url: str, source: str, publishedAt: str, date: str })
  .passthrough();
export type NewsArticle = z.infer<typeof NewsArticle>;
export const NewsResponse = z
  .object({
    status: z.string().default('unavailable'),
    fetchedAt: str,
    lastAttemptAt: str,
    stale: z.boolean().optional(),
    articles: z.array(NewsArticle).default([]),
  })
  .passthrough();
export type NewsResponse = z.infer<typeof NewsResponse>;
