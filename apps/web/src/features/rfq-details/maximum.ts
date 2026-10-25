import type { RfqKind, RfqRecord } from '@opennext/contracts';

export const present = (value: unknown): boolean =>
  value !== null && value !== undefined && value !== '';
export const numeric = (value: unknown): boolean =>
  present(value) && Number.isFinite(Number(value));

/** Normalises the legacy short kinds (`rental`, `hardware`, `model`) to the wire kinds. */
export function rfqKind(record: Pick<RfqRecord, 'kind'>): RfqKind {
  const map: Record<string, RfqKind> = {
    rental: 'gpu_rental',
    hardware: 'physical_gpu',
    model: 'model_capacity',
  };
  const raw = record.kind || '';
  if (map[raw]) return map[raw];
  if (raw === 'physical_gpu' || raw === 'model_capacity' || raw === 'gpu_rental') return raw;
  return raw ? (raw as RfqKind) : 'gpu_rental';
}

/**
 * Maximum quote amount: budget × units, rounded once at the subtotal using integer arithmetic
 * (micro-dollars × units → cents). Mirrors the server computation exactly.
 */
export function maximumQuote(record: RfqRecord): number | null {
  if (!numeric(record.budget)) return null;
  const kind = rfqKind(record);
  const units =
    kind === 'model_capacity'
      ? 1
      : Number(record.count) * (kind === 'physical_gpu' ? 1 : Number(record.hours));
  const micros = Math.round(Number(record.budget) * 1e6);
  if (!Number.isSafeInteger(units) || units < 1 || !Number.isSafeInteger(micros) || micros < 0)
    return null;
  const cents = (BigInt(micros) * BigInt(units) + 5000n) / 10000n;
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) / 100 : null;
}

export const defaultMoney = (value: unknown): string =>
  numeric(value)
    ? '$' +
      Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : 'Not provided';

export const defaultDate = (value: unknown): string =>
  present(value) && Number.isFinite(Date.parse(String(value)))
    ? new Date(String(value)).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC'
    : 'Not provided';
