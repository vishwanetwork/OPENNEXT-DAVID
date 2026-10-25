import { z } from 'zod';
import { RfqRecord } from '../rfq-details';

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
  netPrice: z.union([z.number(), z.string()]).nullish(),
  agentStatus: z.string().nullish(),
  resaleOf: z.string().nullish(),
  originSupply: z.string().nullish(),
  paymentTerms: z.string().nullish(),
  inputRate: z.union([z.number(), z.string()]).nullish(),
  outputRate: z.union([z.number(), z.string()]).nullish(),
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
  modelBudgets: z.record(z.union([z.number(), z.string()])).nullish(),
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
    side: z.enum(['supply', 'demand']).or(z.string()).nullish(),
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
        count: z.union([z.number(), z.string()]).nullish(),
        hours: z.union([z.number(), z.string()]).nullish(),
        term: z.string().nullish(),
        price: z.union([z.number(), z.string()]).nullish(),
        netPrice: z.union([z.number(), z.string()]).nullish(),
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

export const TopupMethod = z.enum(['credit_card', 'paypal', 'bank_transfer']).or(z.string());
export const TopupRequest = z
  .object({
    id: z.string(),
    email: z.string().nullish(),
    accountId: z.string().nullish(),
    purchaseReference: z.string().nullish(),
    amountCents: z.number().nullish(),
    amount: z.union([z.number(), z.string()]).nullish(),
    method: TopupMethod.nullish(),
    status: z.enum(['Pending', 'Approved', 'Rejected']).or(z.string()).nullish(),
    solved: z.boolean().nullish(),
    createdAt: z.string().nullish(),
    reviewedAt: z.string().nullish(),
    reason: z.string().nullish(),
    workspaceId: z.string().nullish(),
    demo: z.boolean().nullish(),
  })
  .passthrough();
export type TopupRequest = z.infer<typeof TopupRequest>;

/** `GET /api/admin/topups` (live) / `GET /api/admin/topups?scope=demo` (test accounts). */
export const TopupsResponse = z.object({
  scope: z.string().optional(),
  requests: z.array(TopupRequest),
});
/** `POST /api/admin/topups/:id/review` (`?scope=demo` for test accounts) → `{ request }`. */
export const TopupReviewRequest = z.object({
  decision: z.enum(['Approve', 'Reject']),
  reason: z.string().default(''),
  fundsVerified: z.literal(true).optional(),
  workspaceId: z.string().optional(),
});
export const TopupReviewResponse = z.object({ request: TopupRequest.optional() });
