import { z } from 'zod';
import { lenientArray, num, numberOrString, str } from '../_shared';

/* ---------- Listings and rows ---------- */

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

/* ---------- GET /api/marketplace/public ---------- */

export const PublicMarketResponse = z.object({
  rfqs: z.array(MarketplaceListing).default([]),
  supplies: z.array(MarketplaceListing).default([]),
  featured: z
    .object({
      rfqs: z.array(MarketplaceListing).default([]),
      supplies: z.array(MarketplaceListing).default([]),
    })
    .default({ rfqs: [], supplies: [] }),
  updatedAt: z.string().optional(),
});
export type PublicMarketResponse = z.infer<typeof PublicMarketResponse>;

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

export const CuratedRfqsResponse = z.object({ rfqs: lenientArray(CuratedRfq) });
export type CuratedRfqsResponse = z.infer<typeof CuratedRfqsResponse>;

/* ---------- Submitted RFQ record (read-only renderer, Terminal + Console) ---------- */

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
    /** `rfq` | `quote_request`; other values are tolerated and shown verbatim. */
    requestKind: z.string().optional(),
    model: z.string().nullish(),
    region: z.string().nullish(),
    vcpu: numberOrString.nullish(),
    count: numberOrString.nullish(),
    memory: numberOrString.nullish(),
    hours: numberOrString.nullish(),
    days: numberOrString.nullish(),
    inputMillion: numberOrString.nullish(),
    outputMillion: numberOrString.nullish(),
    tps: numberOrString.nullish(),
    condition: z.string().nullish(),
    term: z.string().nullish(),
    budget: numberOrString.nullish(),
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

/* ---------- Delivered allocations ---------- */

/** Delivered allocation (`/api/marketplace/instances`, also inside `/api/marketplace/me`). */
export const Instance = z
  .object({
    id: z.string(),
    name: str,
    model: str,
    region: str,
    term: str,
    count: num,
    rate: num,
    status: str,
    connectionStatus: str,
    paymentStatus: str,
    orderId: str,
    purchaseOrderId: str,
    serviceStart: str,
    serviceEnd: str,
    end: z.union([z.string(), z.number()]).nullish(),
    endedAt: str,
    releasedAt: str,
    createdAt: str,
    sshHost: str,
    sshUser: str,
    sshPort: num,
    resaleAllowed: z.boolean().optional(),
    availableResellCount: num,
    telemetry: z
      .object({ utilizationPercent: num, observedAt: str, idleGpuCount: num })
      .passthrough()
      .nullish(),
    sample: z.boolean().optional(),
    demo: z.boolean().optional(),
    preview: z.boolean().optional(),
  })
  .passthrough();
export type Instance = z.infer<typeof Instance>;

export const InstancesResponse = z
  .object({ instances: z.array(Instance).default([]) })
  .passthrough();
export type InstancesResponse = z.infer<typeof InstancesResponse>;

/* ---------- Shared shapes ---------- */

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
/** Anonymized completed settlement (no supplier identity) as shown in matches and the insight tape. */
export const SettlementRow = z
  .object({
    id: z.string(),
    model: z.string(),
    region: str,
    country: str,
    term: str,
    count: num,
    gpuCount: num,
    hours: num,
    price: num,
    perGpuHourly: num,
    vcpu: num,
    memory: num,
    provider: str,
    status: str,
    settledAt: str,
    serverRecord: z.boolean().optional(),
    external: z.boolean().optional(),
    referenceOnly: z.boolean().optional(),
  })
  .passthrough();
export type SettlementRow = z.infer<typeof SettlementRow>;
export const SettlementsResponse = z.object({ rows: lenientArray(SettlementRow) }).passthrough();
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
    instances: z.array(Instance).default([]),
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
export type KybResponse = z.infer<typeof KybResponse>;

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
export type QuoteInterestRequest = z.infer<typeof QuoteInterestRequest>;
export const QuoteInterestResponse = z.object({}).passthrough();

/** POST /api/marketplace/instances/:id/resell */
export const ResellRequest = z.object({
  count: z.number().int().positive(),
  rate: z.number().positive(),
  hours: z.number().int().positive(),
});
export type ResellRequest = z.infer<typeof ResellRequest>;
export const ResellResponse = z.object({ supply: OwnedSupply }).passthrough();
export type ResellResponse = z.infer<typeof ResellResponse>;

/* ---------- Spot instance SSH keys and END (SpotOrderBot) ---------- */

/** One customer key installed on an instance; `fingerprint` is OpenSSH `SHA256:…`. */
export const InstanceSshKey = z.object({
  publicKey: z.string(),
  fingerprint: z.string(),
  comment: z.string(),
});
export type InstanceSshKey = z.infer<typeof InstanceSshKey>;

/**
 * `GET|POST /api/marketplace/instances/:id/ssh-keys` — the keys on a Spot instance. A POST
 * with `InstanceSshKeysRequest` replaces them; `installed` turns true once the running
 * server has the current set (usually within 15 seconds).
 */
export const InstanceSshKeysResponse = z.object({
  keys: z.array(InstanceSshKey).max(20),
  version: z.number().int(),
  installed: z.boolean(),
});
export type InstanceSshKeysResponse = z.infer<typeof InstanceSshKeysResponse>;
export const InstanceSshKeysRequest = z.object({
  keys: z.array(z.string().min(1).max(4096)).max(20),
});
export type InstanceSshKeysRequest = z.infer<typeof InstanceSshKeysRequest>;

/** `POST /api/marketplace/instances/:id/end` — ends a Spot instance; prepaid time is not refunded. */
export const InstanceEndRequest = z.object({ confirmation: z.literal('END') });
export const InstanceEndResponse = z.object({ confirmed: z.literal(true), instance: Instance });
export type InstanceEndResponse = z.infer<typeof InstanceEndResponse>;
