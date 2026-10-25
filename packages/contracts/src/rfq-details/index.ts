import { z } from 'zod';

/** Market kind of an RFQ / supply record. Legacy short forms are normalised by `rfqKind()`. */
export const RfqKind = z.enum(['gpu_rental', 'physical_gpu', 'model_capacity']);
export type RfqKind = z.infer<typeof RfqKind>;

export const SelectedOffer = z
  .object({
    id: z.string().optional(),
    model: z.string().optional(),
    country: z.string().optional(),
    term: z.string().optional(),
    gpuCount: z.number().optional(),
    instanceHourly: z.number().optional(),
    perGpuHourly: z.number().optional(),
  })
  .passthrough();
export type SelectedOffer = z.infer<typeof SelectedOffer>;

/**
 * Submitted RFQ as stored by the marketplace service and shown read-only by the Terminal and the
 * Console. Every field is optional on the wire; the renderer prints "Not provided" for gaps.
 */
export const RfqRecord = z
  .object({
    id: z.string().optional(),
    kind: z.string().optional(),
    requestKind: z.enum(['rfq', 'quote_request']).or(z.string()).optional(),
    model: z.string().nullish(),
    region: z.string().nullish(),
    vcpu: z.union([z.number(), z.string()]).nullish(),
    count: z.union([z.number(), z.string()]).nullish(),
    memory: z.union([z.number(), z.string()]).nullish(),
    hours: z.union([z.number(), z.string()]).nullish(),
    days: z.union([z.number(), z.string()]).nullish(),
    inputMillion: z.union([z.number(), z.string()]).nullish(),
    outputMillion: z.union([z.number(), z.string()]).nullish(),
    tps: z.union([z.number(), z.string()]).nullish(),
    condition: z.string().nullish(),
    term: z.string().nullish(),
    budget: z.union([z.number(), z.string()]).nullish(),
    start: z.string().nullish(),
    quoteDeadline: z.string().nullish(),
    shippingAddress: z.string().nullish(),
    incoterms: z.string().nullish(),
    warranty: z.string().nullish(),
    accessPolicy: z.string().nullish(),
    network: z.string().nullish(),
    storage: z.string().nullish(),
    image: z.string().nullish(),
    sla: z.string().nullish(),
    deliveryMethod: z.string().nullish(),
    urgency: z.string().nullish(),
    visibility: z.string().nullish(),
    notes: z.string().nullish(),
    shareClosingPrice: z.boolean().nullish(),
    selectedOffer: SelectedOffer.nullish(),
    maximumQuotePrice: z.number().nullish(),
  })
  .passthrough();
export type RfqRecord = z.infer<typeof RfqRecord>;
