import { FEE_POLICY_VERSION, type FeeFields } from '@opennext/contracts';

export const FEE_POLICY = FEE_POLICY_VERSION;
export const FEE_LABEL = 'OpenNEXT Fee 5%';
export const FEE_RATE = 0.05;

export const round2 = (value: unknown): number => Math.round((Number(value) || 0) * 100) / 100;
export const num = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** True when the server wrote the complete explicit-fee breakdown for this record. */
export function currentFees(
  record: Partial<FeeFields> | null | undefined,
): record is Required<
  Pick<FeeFields, 'subtotal' | 'buyerFee' | 'sellerFee' | 'buyerTotal' | 'sellerNet'>
> &
  FeeFields {
  return (
    !!record &&
    record.feePolicyVersion === FEE_POLICY &&
    (['subtotal', 'buyerFee', 'sellerFee', 'buyerTotal', 'sellerNet'] as const).every(
      (key) => record[key] != null && Number.isFinite(Number(record[key])),
    )
  );
}

/** Legacy base rate of a supply / response record. */
export const baseRate = (r: {
  unitPrice?: unknown;
  netPrice?: unknown;
  rate?: unknown;
  price?: unknown;
}): number | null => {
  for (const key of ['unitPrice', 'netPrice', 'rate', 'price'] as const) {
    const value = r[key];
    if (value !== null && value !== undefined) return Number(value);
  }
  return null;
};

export interface FeeEstimate {
  valid: boolean;
  base: number;
  fee: number;
  net: number;
}

/** Seller settlement estimate from a base unit price, quantity and duration (rounded on the base amount). */
export function sellerEstimate(rate: unknown, count: unknown, hours: unknown): FeeEstimate {
  const values: [number, number, number] = [Number(rate), Number(count), Number(hours)];
  const valid = values.every((value) => Number.isFinite(value) && value > 0);
  const base = Math.round(values[0] * values[1] * values[2] * 100) / 100;
  const fee = Math.round(base * FEE_RATE * 100) / 100;
  return { valid, base, fee, net: round2(base - fee) };
}

/**
 * Maximum quote price = budget × count × hours with one rounding at the subtotal, using
 * integer arithmetic (micro-rate precision). Mirrors the server's maximumQuotePrice.
 */
export function maximumQuotePrice(r: {
  kind?: unknown;
  budget?: unknown;
  count?: unknown;
  hours?: unknown;
}): number | null {
  const kind = String(r.kind || 'gpu_rental');
  const isModel = kind === 'model_capacity';
  const isHardware = kind === 'physical_gpu';
  const rate = Number(r.budget);
  const count = isModel ? 1 : Number(r.count);
  const hours = isModel || isHardware ? 1 : Number(r.hours);
  if (![rate, count, hours].every((value) => Number.isFinite(value) && value > 0)) return null;
  const micros = Math.round(rate * 1e6);
  const units = count * hours;
  if (!Number.isSafeInteger(micros) || !Number.isSafeInteger(units)) return null;
  const cents = (BigInt(micros) * BigInt(units) + 5000n) / 10000n;
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) / 100 : null;
}
