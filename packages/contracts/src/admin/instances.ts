import { z } from 'zod';

/* ---------- Purchased GPU allocations (/api/admin/instances) ---------- */

/**
 * Console lifecycle of an allocation. `Running` excludes `Connecting` (being obtained, verified,
 * handed off or replaced) and `End`; `Attention` needs an operator.
 */
export const AdminInstanceLifecycle = z.enum(['Running', 'Connecting', 'Attention', 'End']);
export type AdminInstanceLifecycle = z.infer<typeof AdminInstanceLifecycle>;

/**
 * One protected Spot rental, served by the SpotOrderBot backend. Money fields are decimal
 * strings in USD. No credentials, agent tokens or server addresses are included.
 */
export const AdminInstance = z.object({
  id: z.string(),
  tenantId: z.string(),
  orderId: z.string().nullable(),
  rfqId: z.string().nullable(),
  model: z.string().nullable(),
  gpuCount: z.number().int().nullable(),
  term: z.literal('Spot'),
  region: z.string().nullable(),
  zone: z.string().nullable(),
  instanceType: z.string().nullable(),
  instanceId: z.string().nullable(),
  /** Increments each time the server is replaced. */
  generation: z.number().int(),
  /** Authoritative backend state, e.g. `ACTIVE`, `RECOVERING`, `ACTION_REQUIRED`, `CLOSED`. */
  state: z.string(),
  lifecycle: AdminInstanceLifecycle,
  error: z.string().nullable(),
  degraded: z.string().nullable(),
  priceCeilingHourlyUsd: z.string().nullable(),
  estimatedCostUsd: z.string().nullable(),
  budgetUsd: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  closedAt: z.string().nullable(),
});
export type AdminInstance = z.infer<typeof AdminInstance>;

/** `GET /api/admin/instances?status=&cursor=&limit=` → newest first, cursor-paginated. */
export const AdminInstancesResponse = z.object({
  instances: z.array(AdminInstance),
  nextCursor: z.string().nullable(),
  asOf: z.string(),
});
export type AdminInstancesResponse = z.infer<typeof AdminInstancesResponse>;
