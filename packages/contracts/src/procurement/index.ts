import { z } from 'zod';
import { MarketplaceListing, PublicMarketResponse } from '../site';

/* ---------- Shared shapes ---------- */

const num = z.number().nullable().optional();
const str = z.string().nullable().optional();

/** Fee policy fields written by the server on quotes, orders and supply rows (5 % each side). */
export const FeeFields = z.object({
  feePolicyVersion: str,
  feePercent: num,
  subtotal: num,
  buyerFee: num,
  sellerFee: num,
  buyerTotal: num,
  sellerNet: num,
});
export type FeeFields = z.infer<typeof FeeFields>;
export const FEE_POLICY_VERSION = 'opennext-explicit-5pct-v1';

/** A public market row (`/api/marketplace/public`, matches, reference catalog, external imports). */
export const MarketRow = MarketplaceListing.extend({
  /** Reference catalog activity rows use side 'activity'. */
  side: z.enum(['demand', 'supply', 'activity']).optional(),
  originSupply: str,
  originRfq: str,
  buyerPrice: num,
  priceBasis: str,
  created: str,
  start: str,
  serviceEnd: str,
  quoteDeadline: str,
  biddingParties: num,
  bestMatch: z.boolean().optional(),
  referenceOnly: z.boolean().optional(),
  executable: z.boolean().optional(),
  timeBasis: str,
  activityAt: str,
  settledAt: str,
  /** External (sourced) rows: */
  responseMode: str,
  modelOptions: z.array(z.string()).optional(),
  modelBudgets: z.record(z.number().nullable()).optional(),
  regionScope: z
    .object({
      type: str,
      unionOnly: z.boolean().optional(),
      countries: z.array(z.string()).optional(),
      excludedCountries: z.array(z.string()).optional(),
    })
    .passthrough()
    .optional(),
  quantity: z
    .object({
      nodes: num,
      minNodes: num,
      maxNodes: num,
      gpusPerNode: num,
      totalGpus: num,
      totalGpusMin: num,
      totalGpusMax: num,
    })
    .passthrough()
    .optional(),
  rentalMonths: z
    .object({
      min: num,
      max: num,
      preferred: num,
      options: z.array(z.number()).optional(),
      notes: str,
    })
    .passthrough()
    .optional(),
  sku: str,
  inputMillion: num,
  outputMillion: num,
  days: num,
}).passthrough();
export type MarketRow = z.infer<typeof MarketRow>;

export { PublicMarketResponse };

/* ---------- GET /api/marketplace/reference-catalog ---------- */
export const ReferenceCatalogResponse = z
  .object({
    scope: z.string().optional(),
    supplies: z.array(MarketRow).default([]),
    rfqs: z.array(MarketRow).default([]),
    recent: z.array(MarketRow).default([]),
  })
  .passthrough();
export type ReferenceCatalogResponse = z.infer<typeof ReferenceCatalogResponse>;

/* ---------- GET /api/marketplace/matches?model=&region= ---------- */
export const MatchesResponse = z
  .object({
    rows: z.array(MarketRow).default([]),
    reason: z.string().default(''),
    requiresSubmission: z.boolean().optional(),
    submissionPrompt: z.string().default(''),
  })
  .passthrough();
export type MatchesResponse = z.infer<typeof MatchesResponse>;

/* ---------- GET /api/marketplace/settlements?days= | ?period= ---------- */
export const SettlementRow = z
  .object({
    id: z.string(),
    model: z.string(),
    region: str,
    term: str,
    count: num,
    hours: num,
    price: num,
    provider: str,
    settledAt: str,
    serverRecord: z.boolean().optional(),
    external: z.boolean().optional(),
    referenceOnly: z.boolean().optional(),
  })
  .passthrough();
export type SettlementRow = z.infer<typeof SettlementRow>;
export const SettlementsResponse = z
  .object({ rows: z.array(SettlementRow).default([]) })
  .passthrough();
export type SettlementsResponse = z.infer<typeof SettlementsResponse>;

/* ---------- Owner records (`/api/marketplace/me`) ---------- */

/** Server-issued submission receipt (see legacy/docs/TERMINAL_CONSOLE_SYNC.md). */
export const MarketplaceReceipt = z
  .object({
    receiptId: z.string(),
    source: str,
    status: z.string(),
    receivedAt: z.string(),
    updatedAt: str,
    revision: z.number().optional(),
  })
  .passthrough();
export type MarketplaceReceipt = z.infer<typeof MarketplaceReceipt>;

export const Quote = FeeFields.extend({
  id: z.string(),
  rfqId: str,
  provider: str,
  supplierId: str,
  price: num,
  total: num,
  input: num,
  output: num,
  priceBasis: str,
  delivery: num,
  sla: str,
  status: z.string(),
  validUntil: str,
  submittedAt: str,
  sample: z.boolean().optional(),
  paymentTerms: str,
  deliveryMethod: str,
  cancellation: str,
  cancellationTerms: str,
  notes: str,
  orderId: str,
}).passthrough();
export type Quote = z.infer<typeof Quote>;

export const OwnedRfq = z
  .object({
    id: z.string(),
    kind: str,
    requestKind: str,
    title: str,
    project: str,
    client: str,
    model: z.string(),
    sku: str,
    region: str,
    term: str,
    count: num,
    hours: num,
    days: num,
    vcpu: num,
    memory: num,
    budget: num,
    inputMillion: num,
    outputMillion: num,
    tps: num,
    start: str,
    quoteDeadline: str,
    status: z.string(),
    reviewStatus: str,
    reviewReason: str,
    reviewedAt: str,
    visibility: str,
    urgency: str,
    notes: str,
    deliveryMethod: str,
    shareClosingPrice: z.boolean().optional(),
    originSupply: str,
    selectedSupplier: str,
    selectedOffer: z.unknown().optional(),
    priceSnapshot: z.unknown().optional(),
    orderId: str,
    accepted: z.unknown().optional(),
    quotes: z.array(Quote).default([]),
    audit: z.array(z.object({ at: str, event: z.string(), actor: str }).passthrough()).default([]),
    submission: MarketplaceReceipt.optional(),
    serverRecord: z.boolean().optional(),
    sample: z.boolean().optional(),
    external: z.boolean().optional(),
    created: str,
    createdAt: str,
  })
  .passthrough();
export type OwnedRfq = z.infer<typeof OwnedRfq>;

export const OwnedSupply = FeeFields.extend({
  id: z.string(),
  kind: str,
  title: str,
  name: str,
  type: str,
  model: z.string(),
  region: str,
  count: num,
  hours: num,
  term: str,
  netPrice: num,
  rate: num,
  unitPrice: num,
  price: num,
  status: z.string(),
  agentStatus: str,
  serviceStart: str,
  serviceEnd: str,
  notes: str,
  resaleOf: str,
  submission: MarketplaceReceipt.optional(),
  serverRecord: z.boolean().optional(),
  sshProvided: z.boolean().optional(),
}).passthrough();
export type OwnedSupply = z.infer<typeof OwnedSupply>;

export const KybReview = z
  .object({
    id: str,
    status: z.string(),
    step: z.number().default(0),
    company: str,
    registration: str,
    country: str,
    submittedAt: str,
    reason: str,
  })
  .passthrough();
export type KybReview = z.infer<typeof KybReview>;

export const Party = z.object({ name: str, company: str, email: str }).passthrough();

export const Order = FeeFields.extend({
  id: z.string(),
  rfqId: str,
  quoteId: str,
  title: str,
  kind: str,
  model: str,
  sku: str,
  count: num,
  region: str,
  term: str,
  hours: num,
  days: num,
  inputMillion: num,
  outputMillion: num,
  unitPrice: num,
  rate: num,
  inputRate: num,
  outputRate: num,
  total: num,
  amount: num,
  fees: num,
  tax: num,
  currency: str,
  buyer: z.union([Party, z.string()]).nullish(),
  seller: z.union([Party, z.string()]).nullish(),
  broker: z.union([Party, z.string()]).nullish(),
  provider: str,
  role: str,
  side: z.enum(['buy', 'sell']).optional(),
  status: z.string(),
  paymentStatus: str,
  paymentMethod: str,
  paymentId: str,
  paymentReference: str,
  tradeMethod: str,
  createdAt: str,
  created: str,
  paidAt: str,
  deliveredAt: str,
  completedAt: str,
  settledAt: str,
  quoteValidUntil: str,
  deliveryMinutes: num,
  deliveryMethod: str,
  serviceStart: str,
  serviceEnd: str,
  instanceId: str,
  notes: str,
  sample: z.boolean().optional(),
  audit: z.array(z.object({ at: str, event: z.string() }).passthrough()).default([]),
  priceUnit: str,
  shippingAddress: str,
  consignee: str,
  contactPhone: str,
  condition: str,
  warranty: str,
  incoterms: str,
  sla: str,
  cancellationTerms: str,
  commissionAmount: num,
  brokerCommission: num,
  commission: num,
  telemetry: z.object({ usedGpuHours: num }).passthrough().nullish(),
}).passthrough();
export type Order = z.infer<typeof Order>;

export const WorkspaceNotification = z
  .object({
    id: z.string(),
    ownerId: str,
    role: str,
    subject: str,
    message: str,
    created: str,
    createdAt: str,
    read: z.boolean().optional(),
    supplier: str,
    rfqId: str,
    orderId: str,
    topupId: str,
  })
  .passthrough();
export type WorkspaceNotification = z.infer<typeof WorkspaceNotification>;

/** Seller quotes (`responses`) as stored for the quoting account. */
export const SupplierResponse = FeeFields.extend({
  id: z.string(),
  rfqId: str,
  supplyId: str,
  model: str,
  region: str,
  rate: num,
  netPrice: num,
  unitPrice: num,
  price: num,
  delivery: num,
  validUntil: str,
  status: z.string(),
  notes: str,
  orderId: str,
  kind: str,
  count: num,
  hours: num,
  createdAt: str,
}).passthrough();
export type SupplierResponse = z.infer<typeof SupplierResponse>;

export const WorkspaceResponse = z
  .object({
    rfqs: z.array(OwnedRfq).default([]),
    listings: z.array(OwnedSupply).default([]),
    review: KybReview.default({ status: 'Not started', step: 0 }),
    responses: z.array(SupplierResponse).default([]),
    orders: z.array(Order).default([]),
    notifications: z.array(WorkspaceNotification).default([]),
    instances: z.array(z.record(z.unknown())).default([]),
  })
  .passthrough();
export type WorkspaceResponse = z.infer<typeof WorkspaceResponse>;

/* ---------- Writes ---------- */

export const KybRequest = z.object({
  company: z.string(),
  registration: z.string(),
  country: z.string(),
  evidence: z.string(),
  rights: z.string(),
  eligibility: z.boolean(),
  rightsConfirmed: z.boolean(),
});
export type KybRequest = z.infer<typeof KybRequest>;
export const KybResponse = z.object({ review: KybReview }).passthrough();

/** RFQ create/edit body. Dates are ISO strings; `clientSubmissionId` only on create. */
export const RfqRequest = z
  .object({
    kind: z.string(),
    requestKind: z.enum(['rfq', 'quote_request']).optional(),
    title: z.string().optional(),
    model: z.string(),
    region: z.string(),
    count: z.union([z.string(), z.number()]).optional(),
    hours: z.union([z.string(), z.number()]).optional(),
    budget: z.union([z.string(), z.number()]),
    term: z.string().optional(),
    start: z.string(),
    quoteDeadline: z.string(),
    shareClosingPrice: z.boolean(),
    clientSubmissionId: z.string().min(8).max(128).optional(),
    selectedOffer: z.unknown().optional(),
  })
  .passthrough();
export type RfqRequest = z.infer<typeof RfqRequest>;
export const RfqResponse = z.object({ rfq: OwnedRfq }).passthrough();
export type RfqResponse = z.infer<typeof RfqResponse>;

export const SupplyRequest = z
  .object({
    kind: z.string(),
    title: z.string(),
    model: z.string(),
    region: z.string(),
    count: z.union([z.string(), z.number()]),
    hours: z.union([z.string(), z.number()]),
    term: z.string(),
    netPrice: z.union([z.string(), z.number()]),
    serviceStart: z.string(),
    serviceEnd: z.string(),
    notes: z.string(),
    sshHost: z.string(),
    sshUser: z.string(),
    sshPort: z.union([z.string(), z.number()]),
    clientSubmissionId: z.string().min(8).max(128).optional(),
  })
  .passthrough();
export type SupplyRequest = z.infer<typeof SupplyRequest>;
export const SupplyResponse = z.object({ supply: OwnedSupply }).passthrough();
export type SupplyResponse = z.infer<typeof SupplyResponse>;

export const AgentRequestResponse = z
  .object({ message: z.string().optional(), status: str })
  .passthrough();
export type AgentRequestResponse = z.infer<typeof AgentRequestResponse>;

export const QuoteRequest = z
  .object({
    supplyId: z.string(),
    rate: z.union([z.string(), z.number()]),
    delivery: z.union([z.string(), z.number()]),
    validUntil: z.string(),
    notes: z.string(),
  })
  .passthrough();
export type QuoteRequest = z.infer<typeof QuoteRequest>;
export const QuoteResponse = z.object({ quote: Quote }).passthrough();
export type QuoteResponse = z.infer<typeof QuoteResponse>;
export const QuoteInterestRequest = z.object({ supplyId: z.string() });
export const QuoteInterestResponse = z.object({}).passthrough();
export type KybResponse = z.infer<typeof KybResponse>;
export type QuoteInterestRequest = z.infer<typeof QuoteInterestRequest>;
