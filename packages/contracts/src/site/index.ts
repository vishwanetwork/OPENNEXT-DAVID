import { z } from 'zod';

/* ---------- GET /api/homepage/rfqs (public, no session) ---------- */

export const CuratedSpecification = z.object({ label: z.string(), value: z.string() });

/** Operations-curated customer requirement shown on the landing page. */
export const CuratedRfq = z.object({
  id: z.string(),
  kind: z.literal('rental'),
  side: z.literal('demand'),
  sourceKind: z.literal('customer_requirement'),
  title: z.string(),
  model: z.string(),
  modelOptions: z.array(z.string()).optional(),
  region: z.string(),
  description: z.string().optional().default(''),
  price: z.number().nullable().optional(),
  priceLabel: z.string().optional(),
  paymentTerms: z.string().optional(),
  publishedAt: z.string().optional(),
  quantityLabel: z.string().optional(),
  termLabel: z.string().optional(),
  termMonths: z.array(z.number()).optional(),
  deliveryLabel: z.string().optional(),
  specifications: z.array(CuratedSpecification),
});
export type CuratedRfq = z.infer<typeof CuratedRfq>;

export const CuratedRfqsResponse = z.object({ rfqs: z.array(z.unknown()) });

/* ---------- GET /api/demo/showcase (public, isolated demo feed) ---------- */

/** A rental listing from either the demo showcase or the production marketplace. */
export const MarketplaceListing = z
  .object({
    id: z.string(),
    kind: z.string(),
    side: z.enum(['demand', 'supply']).optional(),
    model: z.string(),
    title: z.string().optional(),
    region: z.string().optional(),
    count: z.number().nullable().optional(),
    hours: z.number().nullable().optional(),
    term: z.string().nullable().optional(),
    price: z.number().nullable().optional(),
    priceLabel: z.string().optional(),
    description: z.string().optional(),
    provider: z.string().optional(),
    urgency: z.string().optional(),
    status: z.string().optional(),
    input: z.number().nullable().optional(),
    output: z.number().nullable().optional(),
    outputPrice: z.number().nullable().optional(),
    external: z.boolean().optional(),
    sample: z.boolean().optional(),
    serverRecord: z.boolean().optional(),
  })
  .passthrough();
export type MarketplaceListing = z.infer<typeof MarketplaceListing>;

export const ShowcaseResponse = z.object({
  demo: z.boolean().optional(),
  featured: z
    .object({ rfqs: z.array(z.unknown()).optional(), supplies: z.array(z.unknown()).optional() })
    .optional(),
  updatedAt: z.string().optional(),
});
export type ShowcaseResponse = z.infer<typeof ShowcaseResponse>;

/* ---------- GET /api/marketplace/public ---------- */

export const PublicMarketResponse = z.object({
  rfqs: z.array(MarketplaceListing).default([]),
  supplies: z.array(MarketplaceListing).default([]),
  featured: z
    .object({ rfqs: z.array(MarketplaceListing).default([]), supplies: z.array(MarketplaceListing).default([]) })
    .default({ rfqs: [], supplies: [] }),
  updatedAt: z.string().optional(),
});
export type PublicMarketResponse = z.infer<typeof PublicMarketResponse>;

/* ---------- GET /api/pricing/ticker?period=1W ---------- */

export const TickerPoint = z.object({
  date: z.string().optional(),
  time: z.string().optional(),
  timestamp: z.string().optional(),
  observedAt: z.string().optional(),
  value: z.number().nullable(),
});
export type TickerPoint = z.infer<typeof TickerPoint>;

export const TickerRecord = z
  .object({
    recordId: z.string().optional(),
    provider: z.string().optional(),
    gpuModel: z.string().optional(),
    region: z.string().optional(),
    regionName: z.string().optional(),
    country: z.string().optional(),
    instanceType: z.string().optional(),
    gpuCount: z.number().optional(),
    term: z.string().optional(),
    vcpu: z.number().nullable().optional(),
    gpuMemoryGb: z.number().nullable().optional(),
    perGpuHourly: z.number().nullable().optional(),
    observedAt: z.string().optional(),
    historical: z.boolean().optional(),
    points: z.array(TickerPoint).optional(),
  })
  .passthrough();
export type TickerRecord = z.infer<typeof TickerRecord>;

export const TickerResponse = z.object({ records: z.array(z.unknown()).default([]), meta: z.unknown().optional() });

/* ---------- POST /api/contact ---------- */

export const ContactRequest = z.object({
  name: z.string().max(100),
  company: z.string().max(160),
  title: z.string().max(100),
  email: z.string().max(254),
  message: z.string().max(4000),
  /** Honeypot; must be empty. */
  website: z.string().optional(),
  /** Client-generated idempotency key so a timed-out retry never creates a duplicate. */
  submissionId: z.string(),
});
export type ContactRequest = z.infer<typeof ContactRequest>;

export const ContactResponse = z.object({ id: z.string() }).passthrough();
export type ContactResponse = z.infer<typeof ContactResponse>;
