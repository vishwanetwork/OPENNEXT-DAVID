import { z } from 'zod';
import type { Instance, Order } from '@opennext/contracts';
import { countryList } from '@/lib/countries';
import type { InstanceUsageInterval, InstanceUsageSnapshot } from '@/lib/instance-usage';

const date = z.string().datetime({ offset: true });
const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const intervalSchema = z.object({
  startedAt: date,
  endedAt: date,
  state: z.enum(['connected', 'interrupted']),
  utilizationPercent: z.number().min(0).max(100).nullable(),
});
const usageSchema = z.object({
  confirmed: z.literal(true),
  accountId: z.string().min(1),
  instanceId: z.string().min(1),
  demo: z.boolean(),
  observedAt: date,
  windowStart: date,
  windowEnd: date,
  purchasedHours: z.number().positive().finite(),
  retainedDataConfirmed: z.boolean(),
  intervals: z.array(intervalSchema),
  events: z.array(
    z.object({
      id: z.string().min(1),
      at: date,
      type: z.enum(['started', 'interrupted', 'reconnected', 'ended']),
      initiatedBy: z.enum(['platform', 'provider', 'user']),
      description: z.string(),
    }),
  ),
  billing: z
    .object({
      currency: z.literal('USD'),
      startedAt: date.nullable(),
      stoppedAt: date.nullable(),
      totalCents: cents,
      complete: z.boolean(),
      entries: z.array(
        z.object({
          id: z.string().min(1),
          startedAt: date,
          endedAt: date,
          billableSeconds: z.number().nonnegative().finite(),
          computeCents: cents,
          feeCents: cents,
          totalCents: cents,
        }),
      ),
    })
    .nullable(),
});

export function confirmedUsage(
  value: unknown,
  accountId: string,
  instanceId: string,
  demo: boolean,
) {
  const parsed = usageSchema.safeParse(value);
  if (!parsed.success) return null;
  const data = parsed.data;
  if (data.accountId !== accountId || data.instanceId !== instanceId || data.demo !== demo)
    return null;
  const start = Date.parse(data.windowStart);
  const end = Date.parse(data.windowEnd);
  if (end <= start || end > Date.parse(data.observedAt)) return null;
  const intervals = [...data.intervals].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  );
  let previousEnd = start;
  for (const interval of intervals) {
    const from = Date.parse(interval.startedAt);
    const to = Date.parse(interval.endedAt);
    if (from < previousEnd || to <= from || to > end) return null;
    if (interval.state === 'interrupted' && interval.utilizationPercent !== null) return null;
    previousEnd = to;
  }
  const entries = data.billing?.entries ?? [];
  const observedAt = Date.parse(data.observedAt);
  const billingStart = data.billing?.startedAt ? Date.parse(data.billing.startedAt) : null;
  const billingStop = data.billing?.stoppedAt ? Date.parse(data.billing.stoppedAt) : null;
  if (entries.length && billingStart === null) return null;
  if (billingStart !== null && billingStart > observedAt) return null;
  if (
    billingStop !== null &&
    (billingStart === null || billingStop < billingStart || billingStop > observedAt)
  )
    return null;
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) return null;
  if (new Set(data.events.map((event) => event.id)).size !== data.events.length) return null;
  if (data.events.some((event) => Date.parse(event.at) < start || Date.parse(event.at) > end))
    return null;
  let previousBillingEnd = -Infinity;
  for (const entry of [...entries].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  )) {
    if (Date.parse(entry.startedAt) < previousBillingEnd) return null;
    previousBillingEnd = Date.parse(entry.endedAt);
  }
  for (const entry of entries) {
    const entryStart = Date.parse(entry.startedAt);
    const entryEnd = Date.parse(entry.endedAt);
    const elapsedSeconds = (entryEnd - entryStart) / 1000;
    if (
      elapsedSeconds <= 0 ||
      elapsedSeconds > 3600 ||
      entryEnd > observedAt ||
      (billingStart !== null && entryStart < billingStart) ||
      (billingStop !== null && entryEnd > billingStop) ||
      entry.billableSeconds > elapsedSeconds ||
      (entry.billableSeconds === 0 && entry.totalCents > 0) ||
      entry.totalCents !== entry.computeCents + entry.feeCents
    )
      return null;
    if (entryStart >= start && entryEnd <= end) {
      const connectedSeconds = intervals
        .filter((interval) => interval.state === 'connected')
        .reduce(
          (sum, interval) =>
            sum +
            Math.max(
              0,
              Math.min(entryEnd, Date.parse(interval.endedAt)) -
                Math.max(entryStart, Date.parse(interval.startedAt)),
            ) /
              1000,
          0,
        );
      if (entry.billableSeconds > connectedSeconds) return null;
    }
  }
  if (
    data.billing &&
    entries.reduce((sum, entry) => sum + entry.totalCents, 0) > data.billing.totalCents
  )
    return null;
  if (
    data.billing?.complete &&
    entries.reduce((sum, entry) => sum + entry.totalCents, 0) !== data.billing.totalCents
  )
    return null;
  return data as InstanceUsageSnapshot;
}

/** Never infer purchased hours from elapsed service time or a reconnecting instance's expiry. */
export function purchasedHours(
  instance: Instance,
  orders: Order[],
  snapshot?: InstanceUsageSnapshot | null,
) {
  if (snapshot) return snapshot.purchasedHours;
  const orderId = instance.orderId || instance.purchaseOrderId;
  const order = orders.find(
    (item) => (orderId && item.id === orderId) || item.instanceId === instance.id,
  );
  for (const value of [
    instance.durationHours,
    instance.hours,
    order?.durationHours,
    order?.hours,
  ]) {
    if (
      (typeof value === 'number' || typeof value === 'string') &&
      Number.isFinite(Number(value)) &&
      Number(value) > 0
    )
      return Number(value);
  }
  return null;
}

const REGION_COUNTRIES: [RegExp, string][] = [
  [/^(us[- ]|usa$|united states)/i, 'USA'],
  [/^(ca[- ]|canada)/i, 'Canada'],
  [/^(eu-west-2|uk[- ]|gb[- ]|london|united kingdom)/i, 'UK'],
  [/^(eu-west-1|ireland|dublin)/i, 'Ireland'],
  [/^(eu-west-3|france|paris|fr[- ])/i, 'France'],
  [/^(eu-central-1|germany|frankfurt|de[- ])/i, 'Germany'],
  [/^(eu-north-1|sweden|stockholm|se[- ])/i, 'Sweden'],
  [/^(eu-central-2|switzerland|zurich|ch[- ])/i, 'Switzerland'],
  [/^(ap-northeast-[13]|japan|tokyo|osaka|jp[- ])/i, 'Japan'],
  [/^(ap-northeast-2|south korea|seoul|kr[- ])/i, 'South Korea'],
  [/^(ap-southeast-1|singapore|sg[- ])/i, 'Singapore'],
  [/^(ap-southeast-[24]|australia|sydney|melbourne|au[- ])/i, 'Australia'],
  [/^(ap-southeast-3|indonesia|jakarta|id[- ])/i, 'Indonesia'],
  [/^(ap-south-[12]|india|mumbai|hyderabad|in[- ])/i, 'India'],
  [/^(ap-east-1|hong kong|hk[- ])/i, 'Hong Kong'],
  [/^(sa-east-1|brazil|sao paulo|br[- ])/i, 'Brazil'],
  [/^(af-south-1|south africa|cape town|za[- ])/i, 'South Africa'],
];

export function instanceCountry(region: unknown, country?: unknown) {
  const raw =
    typeof country === 'string' && country.trim() ? country.trim() : String(region || '').trim();
  const match = countryList().find(
    (item) =>
      item.code.toLowerCase() === raw.toLowerCase() ||
      item.name.toLowerCase() === raw.toLowerCase(),
  );
  if (match) return match.code === 'US' ? 'USA' : match.code === 'GB' ? 'UK' : match.name;
  return (
    REGION_COUNTRIES.find(([expression]) => expression.test(raw))?.[1] ?? 'Country unavailable'
  );
}

export function instanceTitle(instance: Instance, hours: number | null) {
  return `${instance.count ?? '—'} × ${instance.model || 'GPU'}${hours ? ` - ${hours}H` : ''} - ${instanceCountry(instance.region, instance.country)}`;
}

export interface UsageBar {
  start: number;
  end: number;
  connected: number;
  interrupted: number;
  utilization: number | null;
}

/** Fixed time buckets preserve interruption gaps; billing never uses these display aggregates. */
export function usageBars(
  intervals: InstanceUsageInterval[],
  from: number,
  to: number,
  count = 36,
): UsageBar[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || count < 1) return [];
  const width = (to - from) / count;
  return Array.from({ length: count }, (_, index) => {
    const start = from + index * width;
    const end = start + width;
    let connected = 0;
    let interrupted = 0;
    let weighted = 0;
    let measured = 0;
    for (const interval of intervals) {
      const overlap = Math.max(
        0,
        Math.min(end, Date.parse(interval.endedAt)) -
          Math.max(start, Date.parse(interval.startedAt)),
      );
      if (interval.state === 'interrupted') interrupted += overlap;
      else {
        connected += overlap;
        if (interval.utilizationPercent !== null) {
          measured += overlap;
          weighted += overlap * interval.utilizationPercent;
        }
      }
    }
    return {
      start,
      end,
      connected: connected / width,
      interrupted: interrupted / width,
      utilization: measured ? weighted / measured : null,
    };
  });
}
