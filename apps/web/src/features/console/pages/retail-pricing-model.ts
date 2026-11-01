import type { OperationsRetailPricing, RetailPricingUpdate } from '@opennext/contracts';

export type RuleDraft = {
  id: string;
  gpuModel: string;
  region: string;
  provider: string;
  percent: string;
};
export type PricingDraft = { version: number; percent: string; rules: RuleDraft[] };
export const draftFrom = (policy: OperationsRetailPricing): PricingDraft => ({
  version: policy.version,
  percent: String(policy.defaultMarkupBps / 100),
  rules: policy.rules.map((rule) => ({
    id: rule.id,
    gpuModel: rule.gpuModel ?? '',
    region: rule.region ?? '',
    provider: rule.provider ?? '',
    percent: String(rule.markupBps / 100),
  })),
});
export function basisPoints(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim()) || Number(value) > 100)
    throw new Error('Enter a percentage from 0 to 100 with up to two decimal places.');
  return Math.round(Number(value) * 100);
}
export const updateFrom = (draft: PricingDraft): RetailPricingUpdate => ({
  expectedVersion: draft.version,
  defaultMarkupBps: basisPoints(draft.percent),
  rules: draft.rules.map((rule) => ({
    id: rule.id,
    gpuModel: rule.gpuModel.trim() || null,
    region: rule.region.trim() || null,
    provider: rule.provider.trim() || null,
    markupBps: basisPoints(rule.percent),
  })),
});

/** Exact decimal preview; final purchase prices are always verified by the server. */
export function retailPreview(cost: string, percent: string, feeBps: number) {
  if (!/^\d+(?:\.\d{1,6})?$/.test(cost.trim()) || Number(cost) <= 0 || Number(cost) > 100000)
    return null;
  try {
    const [whole, fraction = ''] = cost.trim().split('.');
    const units = BigInt(whole ?? '0') * 1000000n + BigInt(fraction.padEnd(6, '0'));
    const rate = (units * BigInt(10000 + basisPoints(percent)) + 99999999n) / 100000000n;
    const fee = (rate * BigInt(feeBps) + 5000n) / 10000n;
    return { rateCents: Number(rate), feeCents: Number(fee), totalCents: Number(rate + fee) };
  } catch {
    return null;
  }
}
