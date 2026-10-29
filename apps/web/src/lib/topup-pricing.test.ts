import { describe, expect, it } from 'vitest';
import { topupPricing, validTopupPricing } from './topup-pricing';

describe('top-up display pricing', () => {
  it('credits the full transferred amount without a top-up fee', () => {
    expect(topupPricing(10000)).toEqual({
      pricingVersion: 'credit-face-value-v1',
      creditAmountCents: 10000,
      feeAmountCents: 0,
      amountCents: 10000,
    });
    expect(topupPricing(10500)?.creditAmountCents).toBe(10500);
  });
  it('preserves exact cents and rejects unsupported credit amounts', () => {
    expect(topupPricing(12550)?.amountCents).toBe(12550);
    for (const amount of [0, 99, 100.5, 10_000_001, NaN, Infinity])
      expect(topupPricing(amount)).toBeNull();
  });
  it('requires an explicit consistent pricing version and breakdown', () => {
    const price = topupPricing(10000);
    if (!price) throw new Error('Fixture pricing unavailable');
    expect(validTopupPricing(price)).toBe(true);
    expect(validTopupPricing({ ...price, feeAmountCents: 525 })).toBe(false);
    expect(validTopupPricing({ amountCents: 10500 })).toBe(false);
    expect(validTopupPricing({ ...price, amountCents: 10500 })).toBe(false);
  });
});
