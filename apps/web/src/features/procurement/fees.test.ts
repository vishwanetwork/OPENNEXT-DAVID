import { describe, expect, it } from 'vitest';
import { FEE_POLICY, currentFees, maximumQuotePrice, sellerEstimate } from './fees';

describe('maximum quote price', () => {
  it('rounds once at the subtotal with integer arithmetic and preserves micro-rate precision', () => {
    expect(maximumQuotePrice({ kind: 'gpu_rental', budget: 2.345678, count: 8, hours: 72 })).toBe(1351.11);
    expect(maximumQuotePrice({ kind: 'gpu_rental', budget: 0.000001, count: 1, hours: 1 })).toBe(0);
    expect(maximumQuotePrice({ kind: 'physical_gpu', budget: 24500, count: 4 })).toBe(98000);
    expect(maximumQuotePrice({ kind: 'model_capacity', budget: 123.456789 })).toBe(123.46);
    expect(maximumQuotePrice({ kind: 'gpu_rental', budget: 2, count: 0, hours: 72 })).toBeNull();
    expect(maximumQuotePrice({ kind: 'gpu_rental', budget: 'x', count: 1, hours: 1 })).toBeNull();
  });
});

describe('fees', () => {
  it('seller estimate uses the base order amount with independent cent rounding and never changes the input rate', () => {
    expect(sellerEstimate(2.345, 8, 10)).toEqual({ valid: true, base: 187.6, fee: 9.38, net: 178.22 });
    expect(sellerEstimate('', 8, 10).valid).toBe(false);
  });
  it('recognises only the complete explicit-fee breakdown', () => {
    expect(currentFees({ feePolicyVersion: FEE_POLICY, subtotal: 100, buyerFee: 5, sellerFee: 5, buyerTotal: 105, sellerNet: 95 })).toBe(true);
    expect(currentFees({ feePolicyVersion: FEE_POLICY, subtotal: 100, buyerFee: 5 })).toBe(false);
    expect(currentFees({ subtotal: 100, buyerFee: 5, sellerFee: 5, buyerTotal: 105, sellerNet: 95 })).toBe(false);
    expect(currentFees(null)).toBe(false);
  });
});
