import { z } from 'zod';

/* ---------- GET /api/marketplace/settlements?days=|period= ---------- */

/** Anonymized completed settlement (no supplier identity). */
export const SellerSettlementRow = z
  .object({
    id: z.string(),
    model: z.string(),
    region: z.string().nullish(),
    country: z.string().nullish(),
    term: z.string().nullish(),
    count: z.number().nullish(),
    gpuCount: z.number().nullish(),
    hours: z.number().nullish(),
    price: z.number().nullish(),
    perGpuHourly: z.number().nullish(),
    vcpu: z.number().nullish(),
    memory: z.number().nullish(),
    provider: z.string().nullish(),
    status: z.string().nullish(),
    settledAt: z.string(),
    serverRecord: z.boolean().optional(),
    external: z.boolean().optional(),
  })
  .passthrough();
export type SellerSettlementRow = z.infer<typeof SellerSettlementRow>;

export const SellerSettlementsResponse = z.object({ rows: z.array(z.unknown()).default([]) });
export type SellerSettlementsResponse = z.infer<typeof SellerSettlementsResponse>;
