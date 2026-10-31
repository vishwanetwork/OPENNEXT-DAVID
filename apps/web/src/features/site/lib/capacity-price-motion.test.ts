import { describe, expect, it } from 'vitest';
import { digitRoll, priceAtStep } from './capacity-price-motion';
describe('capacity display price motion', () => {
  it('stays centered and bounded without drifting away from each supplied value', () => {
    for (let offer = 0; offer < 6; offer++) {
      const prices = Array.from({ length: 96 }, (_, step) => priceAtStep(200, step, offer));
      expect(prices[0]).toBe(200);
      expect(Math.min(...prices)).toBe(197);
      expect(Math.max(...prices)).toBe(203);
      expect(prices.reduce((sum, p) => sum + p, 0) / prices.length).toBe(200);
      for (let step = 1; step < prices.length; step++)
        expect(Math.abs((prices[step] ?? 0) - (prices[step - 1] ?? 0))).toBeLessThanOrEqual(2);
    }
  });
  it('handles both carry and borrow while keeping the target digit in the reel', () => {
    expect(digitRoll(9, 0, 1)).toEqual({ from: 19, to: 20 });
    expect(digitRoll(0, 9, -1)).toEqual({ from: 10, to: 9 });
    for (const direction of [-1, 1])
      for (let previous = 0; previous < 10; previous++)
        for (let next = 0; next < 10; next++) {
          const { from, to } = digitRoll(previous, next, direction);
          expect(to % 10).toBe(next);
          expect(to).toBeGreaterThanOrEqual(0);
          expect(to).toBeLessThan(30);
          expect((to - from) * direction).toBeGreaterThanOrEqual(0);
        }
  });
});
