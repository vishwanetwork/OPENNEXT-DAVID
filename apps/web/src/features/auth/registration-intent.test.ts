import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '@/test/render';
import { useSessionStore } from '@/lib/session-store';
import { useRegistrationIntent } from './registration-intent';

beforeEach(() => useRegistrationIntent.getState().clear());

describe('first registration UI intent', () => {
  it('only creates a prompt for a confirmed first Buyer onboarding', () => {
    signIn();
    const user = useSessionStore.getState().user;
    if (!user) throw new Error('Expected test session');
    useRegistrationIntent.getState().completed({ ...user, onboardingCompleted: false }, user);
    expect(useRegistrationIntent.getState().buyerKybAccount).toBe('u1');
    useRegistrationIntent.getState().clear();
    useRegistrationIntent.getState().completed(user, user);
    expect(useRegistrationIntent.getState().buyerKybAccount).toBe('');
  });
  it('rejects unconfirmed, different-owner, Seller and Demo completion', () => {
    signIn({ onboardingCompleted: false });
    const before = useSessionStore.getState().user;
    if (!before) throw new Error('Expected test session');
    const complete = { ...before, onboardingCompleted: true };
    for (const after of [
      before,
      { ...complete, id: 'other' },
      { ...complete, role: 'seller' as const },
      { ...complete, demo: true },
    ]) {
      useRegistrationIntent.getState().completed(before, after);
      expect(useRegistrationIntent.getState().buyerKybAccount).toBe('');
    }
  });
});
