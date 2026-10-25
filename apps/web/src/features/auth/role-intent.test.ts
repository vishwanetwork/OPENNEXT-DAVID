import { describe, expect, it } from 'vitest';
import { RoleIntentStore, allowedRole, roleIntentKey } from './role-intent';

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k), map };
};

describe('role intent', () => {
  it('separates demo and account keys and validates roles', () => {
    expect(roleIntentKey('/demo/')).toBe('opennext-auth-role-intent-v1:demo');
    expect(roleIntentKey('/terminal/demo/market')).toBe('opennext-auth-role-intent-v1:demo');
    expect(roleIntentKey('/market')).toBe('opennext-auth-role-intent-v1:account');
    expect(allowedRole(' Seller ')).toBe('seller');
    expect(allowedRole('broker')).toBe('');
  });
  it('takes a new URL hint but keeps a later user choice on reload with the same URL', () => {
    const storage = memory();
    const first = new RoleIntentStore('k', 'buyer', storage, () => 1000);
    expect(first.get()?.role).toBe('buyer');
    expect(first.set('seller', null)).toBe(true);
    const reload = new RoleIntentStore('k', 'buyer', storage, () => 2000);
    expect(reload.get()?.role).toBe('seller');
    const newCta = new RoleIntentStore('k', 'seller', storage, () => 3000);
    expect(newCta.get()).toMatchObject({ role: 'seller', queryRole: 'seller' });
  });
  it('expires after 24 hours and ignores future timestamps', () => {
    const storage = memory();
    storage.setItem('k', JSON.stringify({ role: 'buyer', queryRole: '', ownerId: null, updatedAt: 0 }));
    expect(new RoleIntentStore('k', '', storage, () => 86400001).get()).toBeNull();
    storage.setItem('k', JSON.stringify({ role: 'buyer', queryRole: '', ownerId: null, updatedAt: 10_000_000 }));
    expect(new RoleIntentStore('k', '', storage, () => 1000).get()).toBeNull();
  });
  it('drops the hint for completed accounts and for a different owner', () => {
    const storage = memory();
    const store = new RoleIntentStore('k', 'buyer', storage, () => 1000);
    store.bind({ id: 'u1', onboardingCompleted: false });
    expect(store.get()?.ownerId).toBe('u1');
    store.bind({ id: 'u2', onboardingCompleted: false });
    expect(store.get()).toBeNull();
    expect(store.set('buyer', { id: 'u2', onboardingCompleted: true })).toBe(false);
    expect(store.preferred({ onboardingCompleted: true })).toBe('');
  });
});
