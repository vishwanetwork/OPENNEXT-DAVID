import { z } from 'zod';

/** `GET /api/admin/pricing/session` → `{ access }`; also embedded in 401 bodies and provider lists. */
export const AdminAccess = z.object({
  mutable: z.boolean(),
  local: z.boolean().optional(),
  reason: z.string().optional(),
});
export type AdminAccess = z.infer<typeof AdminAccess>;

export const AdminSessionResponse = z.object({ access: AdminAccess });
/** `POST /api/admin/pricing/session` `{ token }` → `{ ok: true }` + HttpOnly cookie (30 min). */
export const AdminSessionRequest = z.object({ token: z.string() });
export const AdminSessionOk = z.object({ ok: z.boolean() });

export const CollectionStatus = z.enum([
  'running',
  'completed',
  'completed_with_gaps',
  'failed',
  'needs_credentials',
  'not_implemented',
  'not_synced',
  'disabled',
]);
export type CollectionStatus = z.infer<typeof CollectionStatus>;

export const CollectionRun = z
  .object({
    id: z.string(),
    provider: z.string(),
    status: z.string(),
    mode: z.string().nullish(),
    startedAt: z.string().nullish(),
    finishedAt: z.string().nullish(),
    records: z.number().nullish(),
    recordCount: z.number().nullish(),
    logs: z.array(z.string()).nullish(),
  })
  .passthrough();
export type CollectionRun = z.infer<typeof CollectionRun>;

export const ProviderEndpoint = z
  .object({ method: z.string(), url: z.string(), term: z.string().optional(), auth: z.string().optional() })
  .passthrough();

/** One registered price source as returned by `GET /api/admin/pricing/providers`. */
export const PricingProvider = z
  .object({
    id: z.string(),
    name: z.string(),
    adapter: z.string().nullish(),
    adapterStatus: z.string().nullish(),
    enabled: z.boolean(),
    intervalMinutes: z.number(),
    credentialRequired: z.boolean().nullish(),
    credentialEnv: z.string().nullish(),
    credentialConfigured: z.boolean().nullish(),
    configured: z.boolean().nullish(),
    capabilities: z.array(z.string()).nullish(),
    supportedTerms: z.array(z.string()).nullish(),
    pendingTerms: z.array(z.string()).nullish(),
    endpoints: z.array(ProviderEndpoint).nullish(),
    scope: z.string().nullish(),
    docsUrl: z.string().nullish(),
    message: z.string().nullish(),
    status: z.string().nullish(),
    recordCount: z.number().nullish(),
    lastRun: CollectionRun.nullish(),
    latestRun: CollectionRun.nullish(),
  })
  .passthrough();
export type PricingProvider = z.infer<typeof PricingProvider>;

export const ProvidersResponse = z.object({ providers: z.array(PricingProvider), access: AdminAccess.optional() });
export const RunsResponse = z.object({ runs: z.array(CollectionRun) });
/** `PATCH /api/admin/pricing/providers/:id` */
export const ProviderSettingsRequest = z.object({
  enabled: z.boolean().optional(),
  intervalMinutes: z.number().int().min(10).max(1440).optional(),
});
/** `POST /api/admin/pricing/providers/:id/credential` */
export const ProviderCredentialRequest = z.object({ credential: z.string().min(5).max(4096) });
export const ProviderCredentialResponse = z.object({
  ok: z.boolean(),
  configured: z.boolean().optional(),
  storage: z.string().optional(),
  message: z.string().optional(),
});
/** `POST /api/admin/pricing/providers/:id/run` (202) and `/test` (200) return the run record. */

export const AdminPriceRecord = z
  .object({
    recordId: z.string().optional(),
    provider: z.string().optional(),
    instanceType: z.string().nullish(),
    gpuModel: z.string().nullish(),
    region: z.string().nullish(),
    term: z.string().nullish(),
    gpuCount: z.number().nullish(),
    perGpuHourly: z.number().nullish(),
    instanceHourly: z.number().nullish(),
  })
  .passthrough();
/** `GET /api/pricing/prices?provider=&limit=` */
export const AdminPricesResponse = z.object({
  records: z.array(AdminPriceRecord).default([]),
  meta: z.object({ message: z.string().optional(), status: z.string().optional() }).passthrough().optional(),
});
export type AdminPricesResponse = z.infer<typeof AdminPricesResponse>;
