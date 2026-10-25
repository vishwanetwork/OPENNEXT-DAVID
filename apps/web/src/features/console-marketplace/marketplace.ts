import {
  MarketplaceSnapshot,
  type FeaturedCandidate,
  type KybRecord,
  type MarketRecord,
} from '@opennext/contracts';
import type { ApiClient } from '@/lib/api/client';

export type InboxScope = 'production' | 'demo';
export type InboxTab = 'rfqs' | 'supplies' | 'kyb' | 'featured';
export const POLL_MS = 30000;

export const TAB_LABELS: Record<InboxTab, string> = {
  rfqs: 'Buyer RFQs',
  supplies: 'Supplier capacity',
  kyb: 'Supplier KYB',
  featured: 'Homepage review',
};
export const MARKETS: Record<string, string> = {
  gpu_rental: 'GPU rental',
  model_capacity: 'Model capacity',
  physical_gpu: 'Physical GPUs',
};

export const present = (value: unknown): boolean =>
  value !== null && value !== undefined && value !== '';
export const date = (value: unknown): string =>
  value && Number.isFinite(Date.parse(String(value)))
    ? new Date(String(value)).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC'
    : 'Not provided';
export const money = (value: unknown): string =>
  present(value) && Number.isFinite(Number(value))
    ? '$' +
      Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
    : 'Not provided';
export const number = (value: unknown): string =>
  present(value) && Number.isFinite(Number(value))
    ? Number(value).toLocaleString('en-US')
    : 'Not provided';

export const receivedReceipt = (r: MarketRecord): boolean =>
  r.submission?.status === 'Received' &&
  typeof r.submission.receiptId === 'string' &&
  r.submission.receiptId.trim().length > 0 &&
  Number.isFinite(Date.parse(String(r.submission.receivedAt)));

export const recordKind = (r: Pick<MarketRecord, 'kind'>): string =>
  (
    ({ rental: 'gpu_rental', model: 'model_capacity', hardware: 'physical_gpu' }) as Record<
      string,
      string
    >
  )[r.kind || ''] ||
  r.kind ||
  'gpu_rental';
export const unit = (r: MarketRecord): string =>
  recordKind(r) === 'model_capacity'
    ? 'USD total request'
    : recordKind(r) === 'physical_gpu'
      ? 'USD / GPU'
      : 'USD / GPU-hour';

export const isExternal = (r: MarketRecord, demo: boolean): boolean =>
  !demo && (r.external === true || r.provenance?.kind === 'external');
export const sourceName = (r: MarketRecord, demo: boolean): string =>
  demo
    ? 'Demo · test only'
    : isExternal(r, demo)
      ? r.provenance?.sourceName || 'External source'
      : 'OpenNEXT Terminal';
export const sourceKey = (r: MarketRecord, demo: boolean): string =>
  demo
    ? 'demo'
    : isExternal(r, demo)
      ? 'external:' + (r.provenance?.sourceId || r.provenance?.sourceName || 'unknown')
      : 'terminal';

export function safeSourceUrl(value: unknown): string {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

export function range(value: unknown, suffix = ''): string {
  if (!present(value)) return '';
  if (typeof value === 'number') return number(value) + suffix;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item) => range(item)).join(' / ') + suffix;
  if (typeof value !== 'object') return '';
  const v = value as Record<string, unknown>;
  if (present(v.label)) return String(v.label);
  if (Array.isArray(v.options) && v.options.length)
    return v.options.map((item) => number(item)).join(' / ') + suffix;
  const min = v.min ?? v.minimum;
  const max = v.max ?? v.maximum;
  if (present(min) && present(max))
    return number(min) + (Number(min) !== Number(max) ? '–' + number(max) : '') + suffix;
  if (present(min)) return number(min) + (v.atLeast || v.max === null ? '+' : '') + suffix;
  return present(v.value) ? number(v.value) + suffix : '';
}

export function quantity(r: MarketRecord, demo: boolean): string {
  if (isExternal(r, demo) && r.quantity) {
    const q = r.quantity as Record<string, unknown> | string;
    if (typeof q === 'string') return q;
    const nodes = present(q.nodes)
      ? range(q.nodes, ' nodes')
      : range({ min: q.minNodes, max: q.maxNodes }, ' nodes');
    const gpus = present(q.totalGpusMin)
      ? number(q.totalGpusMin) + (q.sourceMinimum ? '+' : '') + ' GPUs'
      : range(q.totalGpus ?? q.gpus, ' GPUs');
    const parts = [
      nodes,
      gpus,
      present(q.gpusPerNode) ? number(q.gpusPerNode) + ' GPUs / node' : '',
    ].filter(Boolean);
    if (parts.length) return parts.join(' · ');
    const label = range(q, q.unit ? ' ' + q.unit : '');
    if (label) return label;
  }
  return recordKind(r) === 'model_capacity'
    ? present(r.inputMillion) || present(r.outputMillion)
      ? `${present(r.inputMillion) ? number(r.inputMillion) + 'M' : 'Unspecified'} input / ${present(r.outputMillion) ? number(r.outputMillion) + 'M' : 'unspecified'} output tokens`
      : 'Token allocation not provided'
    : present(r.count)
      ? `${number(r.count)} GPUs`
      : 'Quantity not provided';
}

export const duration = (r: MarketRecord, demo: boolean): string =>
  isExternal(r, demo) && present(r.rentalMonths)
    ? range(r.rentalMonths, ' months') || 'Rental duration not provided'
    : recordKind(r) === 'model_capacity'
      ? present(r.days)
        ? number(r.days) + ' days'
        : 'Service duration not provided'
      : recordKind(r) === 'physical_gpu'
        ? 'One-time hardware purchase'
        : present(r.hours)
          ? number(r.hours) + ' hours'
          : 'Rental duration not provided';

export interface InboxData {
  rfqs: MarketRecord[];
  supplies: MarketRecord[];
  kyb: KybRecord[];
  featured: FeaturedCandidate[];
  generatedAt: string;
}

/** Validates the scope of a snapshot and derives the displayed RFQ status (Live / Approved · Private). */
export function normalizeSnapshot(raw: unknown, scope: InboxScope): InboxData {
  const parsed = MarketplaceSnapshot.safeParse(raw);
  const demo = scope === 'demo';
  const required: (keyof InboxData)[] = demo
    ? ['rfqs', 'supplies', 'kyb']
    : ['rfqs', 'supplies', 'kyb', 'featured'];
  const record = raw as Record<string, unknown> | null;
  if (!parsed.success || !record || !required.every((key) => Array.isArray(record[key])))
    throw new Error('The marketplace backend returned an incomplete snapshot.');
  const result = parsed.data;
  if (
    demo
      ? result.scope !== 'demo' ||
        !(['rfqs', 'supplies', 'kyb'] as const).every((key) =>
          result[key].every((row) => typeof row.workspaceId === 'string' && row.workspaceId),
        )
      : result.scope === 'demo'
  )
    throw new Error('The backend returned records for a different workspace scope.');
  return {
    rfqs: result.rfqs.map((r) => ({
      ...r,
      workflowStatus: r.status,
      status:
        r.reviewStatus === 'Approved' && ['Open', 'Quoted'].includes(String(r.status))
          ? r.visibility === 'Private RFQ'
            ? 'Approved · Private RFQ'
            : 'Live RFQ'
          : r.status,
    })),
    supplies: result.supplies,
    kyb: result.kyb,
    featured: demo ? [] : result.featured,
    generatedAt: Number.isFinite(Date.parse(String(result.generatedAt)))
      ? String(result.generatedAt)
      : new Date().toISOString(),
  };
}

export interface InboxFilters {
  query: string;
  statusFilter: string;
  kindFilter: string;
  sourceFilter: string;
}

export function filterRecords(
  rows: MarketRecord[],
  tab: 'rfqs' | 'supplies',
  demo: boolean,
  f: InboxFilters,
): MarketRecord[] {
  const q = f.query.toLowerCase();
  return rows.filter(
    (r) =>
      [
        r.id,
        r.requestId,
        r.submission?.receiptId,
        r.model,
        r.sku,
        r.company,
        r.ownerCompany,
        r.ownerName,
        r.ownerEmail,
        r.email,
        r.workspaceId,
        r.region,
        r.country,
        r.status,
        r.title,
        r.project,
        sourceName(r, demo),
        r.provenance?.sourceId,
        r.provenance?.sourceRecordId,
        r.provenance?.batchId,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q) &&
      (f.statusFilter === 'All' || r.status === f.statusFilter) &&
      (f.kindFilter === 'All' || recordKind(r) === f.kindFilter) &&
      (f.sourceFilter === 'All' || sourceKey(r, demo) === f.sourceFilter) &&
      (tab === 'rfqs' || tab === 'supplies'),
  );
}

export function filterKyb(rows: KybRecord[], f: InboxFilters): KybRecord[] {
  const q = f.query.toLowerCase();
  return rows.filter(
    (r) =>
      [r.id, r.company, r.email, r.workspaceId, r.country, r.status]
        .join(' ')
        .toLowerCase()
        .includes(q) &&
      (f.statusFilter === 'All' || r.status === f.statusFilter),
  );
}

export function filterFeatured(
  rows: FeaturedCandidate[],
  query: string,
  reviewFilter: string,
): FeaturedCandidate[] {
  const q = query.toLowerCase();
  return rows.filter((row) => {
    const snapshot = row.snapshot || {};
    const matches = [
      row.id,
      row.sourceId,
      row.model,
      snapshot.title,
      snapshot.ownerEmail,
      snapshot.region,
      row.status,
    ]
      .join(' ')
      .toLowerCase()
      .includes(q);
    return (
      matches &&
      (reviewFilter === 'History'
        ? !row.current
        : row.current && (reviewFilter === 'Current' || row.status === reviewFilter))
    );
  });
}

export const inboxEndpoint = (scope: InboxScope) =>
  scope === 'demo' ? '/api/admin/demo/marketplace' : '/api/admin/marketplace';
