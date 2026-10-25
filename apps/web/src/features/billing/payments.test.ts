import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from '@/lib/session-store';
import { useWorkspaceStore, initialWorkspace } from '@/features/terminal/store';
import { safeCheckoutUrl, validAmount, validRequest } from './payments';

beforeEach(() => {
  useWorkspaceStore.setState({ ...initialWorkspace(), identity: { name: 'Ada', email: 'ada@example.com', id: 'u1' } });
  useSessionStore.setState({ status: 'verified', user: { id: 'u1', email: 'ada@example.com', role: 'buyer', onboardingCompleted: true, promotionalCredit: 0, promotionalCreditGranted: 0, promotionalCreditWithdrawable: false } });
});

describe('top-up rules', () => {
  it('custom amounts preserve bounds and two-decimal validation', () => {
    expect(validAmount(1)).toBe(true);
    expect(validAmount(100000)).toBe(true);
    expect(validAmount(0.99)).toBe(false);
    expect(validAmount(100000.01)).toBe(false);
    expect(validAmount(12.345)).toBe(false);
    expect(validAmount(Number.NaN)).toBe(false);
  });
  it('malformed, mismatched or cross-account responses never count as a confirmed request', () => {
    const draft = { amount: 100, orderId: null, purchaseReference: '', owner: 'x', idempotencyKey: 'k', method: 'paypal' };
    const ok = { id: 'TOPUP-' + '0'.repeat(8) + '-0000-0000-0000-' + '0'.repeat(12), accountId: 'u1', amount: 100, amountCents: 10000, method: 'paypal', status: 'Pending' };
    expect(validRequest(ok, draft)).toBe(true);
    expect(validRequest({ ...ok, accountId: 'u2' }, draft)).toBe(false);
    expect(validRequest({ ...ok, amount: 99 }, draft)).toBe(false);
    expect(validRequest({ ...ok, status: 'Paid' }, draft)).toBe(false);
    expect(validRequest({ ...ok, id: 'TOPUP-1' }, draft)).toBe(false);
    expect(validRequest({ ...ok, purchaseReference: 'SPOT-1' }, draft)).toBe(false);
  });
  it('provider checkout URLs must be https without credentials', () => {
    expect(safeCheckoutUrl('https://pay.example.com/x')).toBe('https://pay.example.com/x');
    expect(() => safeCheckoutUrl('http://pay.example.com/x')).toThrow();
    expect(() => safeCheckoutUrl('https://user:pw@pay.example.com/x')).toThrow();
  });
});
