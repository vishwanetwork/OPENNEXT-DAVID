import { z } from 'zod';
import { numberOrString } from '../_shared';
import { CreditTopup } from '../billing';
import { RfqRecord } from '../marketplace';

/* ---------- Administrator session and price sources (/api/admin/pricing) ---------- */

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
  .object({
    method: z.string(),
    url: z.string(),
    term: z.string().optional(),
    auth: z.string().optional(),
  })
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

export const ProvidersResponse = z.object({
  providers: z.array(PricingProvider),
  access: AdminAccess.optional(),
});
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

/* ---------- Marketplace inbox (/api/admin/marketplace, /api/admin/demo/marketplace) ---------- */

export const SubmissionReceipt = z
  .object({
    receiptId: z.string().optional(),
    source: z.string().optional(),
    status: z.string().optional(),
    receivedAt: z.string().optional(),
    updatedAt: z.string().optional(),
    revision: z.number().optional(),
  })
  .passthrough();

export const Provenance = z
  .object({
    kind: z.string().optional(),
    sourceId: z.string().optional(),
    sourceName: z.string().optional(),
    sourceUrl: z.string().optional(),
    sourceRecordId: z.string().optional(),
    sourceRecordIdKind: z.string().optional(),
    observedAt: z.string().optional(),
    importedAt: z.string().optional(),
    batchId: z.string().optional(),
  })
  .passthrough();

export const AuditEvent = z
  .object({
    at: z.string().optional(),
    action: z.string().optional(),
    event: z.string().optional(),
    actor: z.string().optional(),
    by: z.string().optional(),
    detail: z.string().optional(),
    reason: z.string().optional(),
  })
  .passthrough();

/** Shared columns of RFQ and supply rows in the Console inbox. */
export const MarketRecord = RfqRecord.extend({
  id: z.string(),
  title: z.string().nullish(),
  status: z.string().nullish(),
  workflowStatus: z.string().nullish(),
  reviewStatus: z.string().nullish(),
  reviewRevision: z.number().nullish(),
  reviewSubmittedAt: z.string().nullish(),
  reviewedAt: z.string().nullish(),
  reviewedBy: z.string().nullish(),
  reviewReason: z.string().nullish(),
  ownerId: z.string().nullish(),
  ownerName: z.string().nullish(),
  ownerEmail: z.string().nullish(),
  ownerCompany: z.string().nullish(),
  accountName: z.string().nullish(),
  email: z.string().nullish(),
  company: z.string().nullish(),
  sku: z.string().nullish(),
  country: z.string().nullish(),
  project: z.string().nullish(),
  requestId: z.string().nullish(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
  serviceStart: z.string().nullish(),
  serviceEnd: z.string().nullish(),
  netPrice: numberOrString.nullish(),
  agentStatus: z.string().nullish(),
  resaleOf: z.string().nullish(),
  originSupply: z.string().nullish(),
  paymentTerms: z.string().nullish(),
  inputRate: numberOrString.nullish(),
  outputRate: numberOrString.nullish(),
  external: z.boolean().nullish(),
  provenance: Provenance.nullish(),
  submission: SubmissionReceipt.nullish(),
  audit: z.array(AuditEvent).nullish(),
  workspaceId: z.string().nullish(),
  workspaceExpiresAt: z.string().nullish(),
  quantity: z.unknown().optional(),
  rentalMonths: z.unknown().optional(),
  regionScope: z.unknown().optional(),
  regionLabel: z.string().nullish(),
  modelOptions: z.array(z.string()).nullish(),
  modelBudgets: z.record(numberOrString).nullish(),
}).passthrough();
export type MarketRecord = z.infer<typeof MarketRecord>;

export const KybRecord = z
  .object({
    id: z.string(),
    company: z.string().nullish(),
    email: z.string().nullish(),
    registration: z.string().nullish(),
    country: z.string().nullish(),
    submittedAt: z.string().nullish(),
    status: z.string().nullish(),
    evidence: z.string().nullish(),
    rights: z.string().nullish(),
    reason: z.string().nullish(),
    workspaceId: z.string().nullish(),
    workspaceExpiresAt: z.string().nullish(),
  })
  .passthrough();
export type KybRecord = z.infer<typeof KybRecord>;

export const FeaturedCandidate = z
  .object({
    id: z.string(),
    sourceId: z.string().nullish(),
    model: z.string().nullish(),
    side: z.string().nullish(),
    status: z.string().nullish(),
    current: z.boolean().nullish(),
    fingerprint: z.string().nullish(),
    submittedAt: z.string().nullish(),
    reviewedAt: z.string().nullish(),
    reviewedBy: z.string().nullish(),
    reason: z.string().nullish(),
    snapshot: z
      .object({
        title: z.string().nullish(),
        description: z.string().nullish(),
        ownerEmail: z.string().nullish(),
        region: z.string().nullish(),
        count: numberOrString.nullish(),
        hours: numberOrString.nullish(),
        term: z.string().nullish(),
        price: numberOrString.nullish(),
        netPrice: numberOrString.nullish(),
        start: z.string().nullish(),
        serviceEnd: z.string().nullish(),
        quoteDeadline: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();
export type FeaturedCandidate = z.infer<typeof FeaturedCandidate>;

/** `GET /api/admin/marketplace` (production) and `GET /api/admin/demo/marketplace` (scope "demo"). */
export const MarketplaceSnapshot = z
  .object({
    scope: z.string().optional(),
    generatedAt: z.string().optional(),
    rfqs: z.array(MarketRecord).default([]),
    supplies: z.array(MarketRecord).default([]),
    kyb: z.array(KybRecord).default([]),
    featured: z.array(FeaturedCandidate).default([]),
    audit: z.array(AuditEvent).optional(),
  })
  .passthrough();
export type MarketplaceSnapshot = z.infer<typeof MarketplaceSnapshot>;

/** `PATCH /api/admin/marketplace/rfqs/:id` (production) / `/api/admin/demo/marketplace/rfqs/:id` (demo). */
export const RfqDecisionRequest = z.object({
  status: z.enum(['Approved', 'Rejected']),
  reason: z.string().default(''),
  expectedRevision: z.number().int().min(1),
  workspaceId: z.string().optional(),
});
/** `PATCH /api/admin/marketplace/kyb/:id` and the demo equivalent. */
export const KybDecisionRequest = z.object({
  status: z.enum(['Approved', 'Rejected']),
  reason: z.string().default(''),
  workspaceId: z.string().optional(),
});
/** `PATCH /api/admin/marketplace/featured/:id` */
export const FeaturedDecisionRequest = z.object({
  status: z.enum(['Approved', 'Rejected']),
  reason: z.string().default(''),
  fingerprint: z.string(),
});
/** `PATCH /api/admin/marketplace/external/:id` */
export const ExternalDecisionRequest = z.object({
  status: z.enum(['Approved', 'Rejected', 'Withdrawn']),
  reason: z.string().default(''),
  expectedRevision: z.number().int().min(1),
});

/* ---------- Contact inbox (/api/admin/contacts) ---------- */

export const LeadStatus = z.enum(['New', 'Contacted', 'Qualified', 'Closed']);
export type LeadStatus = z.infer<typeof LeadStatus>;

export const ContactLead = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    title: z.string().nullish(),
    email: z.string().nullish(),
    company: z.string().nullish(),
    message: z.string().nullish(),
    source: z.string().nullish(),
    status: z.string().nullish(),
    createdAt: z.string().nullish(),
    updatedAt: z.string().nullish(),
    history: z
      .array(
        z
          .object({
            status: z.string().nullish(),
            at: z.string().nullish(),
            note: z.string().nullish(),
          })
          .passthrough(),
      )
      .nullish(),
  })
  .passthrough();
export type ContactLead = z.infer<typeof ContactLead>;

export const LeadsResponse = z.object({ leads: z.array(ContactLead) });
/** `PATCH /api/admin/contacts/:id` → `{ lead }`; 409 when `updatedAt` no longer matches. */
export const LeadUpdateRequest = z.object({
  status: LeadStatus,
  note: z.string().max(2000),
  updatedAt: z.string(),
});
export const LeadUpdateResponse = z.object({ lead: ContactLead.optional() });

/* ---------- Manual credit top-ups (/api/admin/topups) ---------- */

/** `GET /api/admin/topups` (live) / `GET /api/admin/topups?scope=demo` (test accounts). */
export const TopupsResponse = z.object({
  scope: z.string().optional(),
  requests: z.array(CreditTopup),
});
export type TopupsResponse = z.infer<typeof TopupsResponse>;
/** `POST /api/admin/topups/:id/review` (`?scope=demo` for test accounts) → `{ request }`. */
export const TopupReviewRequest = z.object({
  decision: z.enum(['Approve', 'Reject']),
  reason: z.string().default(''),
  fundsVerified: z.literal(true).optional(),
  workspaceId: z.string().optional(),
});
export const TopupReviewResponse = z.object({ request: CreditTopup.optional() });

export * from './instances';
