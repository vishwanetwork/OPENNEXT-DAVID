/**
 * Account notifications and quote requests (legacy OpenNEXT-quote-preview.js, pure part).
 * Records come from the verified workspace (`/api/marketplace/me`); ownership is established
 * by `ownerId` on the server record, never by role alone.
 */
import type { Record_ } from '@/features/terminal/store';

export const QUOTE_MARKER = 'OpenNEXT Terminal quote request';
export const NOTIFICATION_PAGE = 20;
export const PREF_PREFIX = 'opennext-notification-preferences-v1:';

export interface Notice {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  orderId?: string;
  rfqId?: string;
  topupId?: string;
}

export interface NotificationPreferences {
  muted: boolean;
  readIds: string[];
}

export function ownerKey(user: { id?: unknown; role?: unknown; onboardingCompleted?: unknown; demo?: unknown } | null | undefined, demoMode: boolean): string {
  return user?.id && user.onboardingCompleted ? JSON.stringify([user.id, String(user.role).toLowerCase(), Boolean(user.demo) || demoMode]) : '';
}

export const formatDate = (value: unknown): string => {
  const d = new Date(String(value));
  return Number.isFinite(+d) ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : 'Date not available';
};

/** Rows that belong to the verified account (server records carry `ownerId`; orders carry buyer/seller ids). */
export function accountRows(rows: unknown, field: 'notifications' | 'rfqs' | 'orders', userId: string | undefined, owner: string): Record_[] {
  if (!owner || !userId || !Array.isArray(rows)) return [];
  return (rows as Record_[]).filter((row) => row && (field === 'orders' ? row.buyerId === userId || row.sellerId === userId : row.ownerId === userId));
}

export function notices(rows: Record_[], readIds: ReadonlySet<string>): Notice[] {
  const unique = new Map<string, Notice>();
  for (const n of rows)
    if (typeof n.id === 'string')
      unique.set(n.id, {
        id: n.id,
        title: String(n.subject || n.title || 'Workspace update'),
        message: String(n.message || ''),
        createdAt: String(n.created || n.createdAt || ''),
        read: Boolean(n.read) || readIds.has(n.id),
        orderId: typeof n.orderId === 'string' ? n.orderId : undefined,
        rfqId: typeof n.rfqId === 'string' ? n.rfqId : undefined,
        topupId: typeof n.topupId === 'string' ? n.topupId : undefined,
      });
  return [...unique.values()].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
}

export function quoteRequests(rfqs: Record_[]): Record_[] {
  return rfqs
    .filter((r) => ['On-demand', 'Reserved'].includes(String(r.term)) && (r.requestKind === 'quote_request' || String(r.notes || '').includes(QUOTE_MARKER)))
    .sort((a, b) => (Date.parse(String(b.createdAt || b.created)) || 0) - (Date.parse(String(a.createdAt || a.created)) || 0));
}

export function visibleStatus(r: Record_): string {
  return r.reviewStatus === 'Approved' && ['Open', 'Quoted'].includes(String(r.status)) ? (r.visibility === 'Private RFQ' ? 'Approved · Private RFQ' : 'Live RFQ') : String(r.status || 'Status unavailable');
}

const bounded = (value: unknown, max: number) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

const COUNTRY_ALIASES: Record<string, string> = { UAE: 'AE', UK: 'GB', USA: 'US', 'Hong Kong': 'HK', 'South Korea': 'KR' };

/** Resolves a country name/code through Intl (same source the legacy country list used). */
export function countryName(raw: string): string {
  const lookup = COUNTRY_ALIASES[raw] || raw;
  if (/^[A-Z]{2}$/.test(lookup)) {
    try {
      const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(lookup);
      if (name && name !== lookup) return name;
    } catch {
      /* Intl unavailable */
    }
  }
  return raw;
}

export interface QuoteOffer {
  id?: unknown;
  model?: unknown;
  country?: unknown;
  term?: unknown;
  gpuCount?: unknown;
  vcpu?: unknown;
  memory?: unknown;
  perGpuHourly?: unknown;
  instanceHourly?: unknown;
}

/** RFQ form prefill for an On-demand / Reserved offer. */
export function prefill(offer: QuoteOffer | null | undefined) {
  if (!offer || !['On-demand', 'Reserved'].includes(String(offer.term))) throw Error('Choose an On-demand or Reserved resource to request a quote.');
  const model = bounded(offer.model, 100);
  if (!model) throw Error('The selected resource has no model. Refresh the market.');
  const raw = bounded(offer.country, 100);
  const country = raw ? countryName(raw) : '';
  const positive = (value: unknown, max: number, integer = false, min = 0.000001): number | null => {
    const number = Number(value);
    return value != null && value !== '' && Number.isFinite(number) && number >= min && number <= max && (!integer || Number.isInteger(number)) ? number : null;
  };
  const gpu = positive(offer.gpuCount, 4096, true, 1);
  const vcpu = positive(offer.vcpu, 65536, true, 1);
  const memory = positive(offer.memory, 65536, false, 0.01);
  const price = positive(offer.perGpuHourly, 1000000);
  const selectedOffer = { id: bounded(offer.id, 160), model, country: raw, term: String(offer.term), gpuCount: gpu, vcpu, memory, perGpuHourly: price, instanceHourly: positive(offer.instanceHourly, 1000000000) };
  return {
    kind: 'gpu_rental',
    requestKind: 'quote_request',
    model,
    region: country,
    term: String(offer.term),
    count: gpu || 8,
    vcpu: vcpu ?? '',
    memory: memory ?? '',
    budget: price ?? '',
    notes: '',
    selectedOffer,
    visibility: 'Public requirements',
    shareClosingPrice: false,
  };
}

export function readPreferences(storage: Pick<Storage, 'getItem'> | null, owner: string): NotificationPreferences {
  if (!owner) return { muted: false, readIds: [] };
  try {
    const saved = JSON.parse(storage?.getItem(PREF_PREFIX + owner) || '{}') as { muted?: unknown; readIds?: unknown };
    return { muted: saved.muted === true, readIds: Array.isArray(saved.readIds) ? saved.readIds.filter((x): x is string => typeof x === 'string').slice(-3000) : [] };
  } catch {
    return { muted: false, readIds: [] };
  }
}

export function writePreferences(storage: Pick<Storage, 'setItem'> | null, owner: string, preferences: NotificationPreferences) {
  if (!owner) return;
  try {
    storage?.setItem(PREF_PREFIX + owner, JSON.stringify({ muted: preferences.muted, readIds: preferences.readIds.slice(-3000) }));
  } catch {
    /* storage unavailable */
  }
}
