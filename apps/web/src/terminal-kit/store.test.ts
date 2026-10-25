import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@opennext/contracts';
import type { Offer } from '@/features/market';
import { initialWorkspace, readPreferences, useWorkspaceStore } from './store';

const user = (over: Partial<SessionUser>): SessionUser => ({
  id: 'u1',
  email: 'a@b.c',
  name: 'Ada Lovelace',
  role: 'buyer',
  onboardingCompleted: true,
  promotionalCredit: 100,
  promotionalCreditGranted: 100,
  promotionalCreditWithdrawable: false,
  ...over,
});
const offer = (id: string): Offer => ({
  id,
  recordId: id,
  model: 'H100',
  provider: 'AWS',
  sourceProvider: 'aws',
  region: 'US East',
  regionCode: 'us-east-1',
  city: 'US East',
  term: 'Spot',
  count: 8,
  price: 2,
  instanceHourly: 16,
  instanceType: null,
  available: null,
  availability: null,
  delivery: null,
  rating: null,
  response: null,
  uptime: null,
  memory: 80,
  network: '',
  fit: null,
  reviews: null,
  validUntil: null,
  observedAt: null,
  effectiveAt: null,
  sourceUrl: null,
  priceKind: null,
  stale: false,
  currency: null,
  operatingSystem: null,
  tenancy: null,
});

describe('workspace store', () => {
  beforeEach(() => {
    useWorkspaceStore.setState(initialWorkspace());
    window.localStorage.clear();
  });
  it('applies the verified session and clears records when the account changes', () => {
    const s = useWorkspaceStore.getState();
    s.applySession(user({ fundedCredit: 50 }));
    expect(useWorkspaceStore.getState()).toMatchObject({
      role: 'buyer',
      identity: { name: 'Ada Lovelace', id: 'u1' },
    });
    useWorkspaceStore.getState().addToCart(offer('c'));
    useWorkspaceStore.getState().patch({ afterReview: 'supply-form' });
    s.applySession(user({ id: 'u2', role: 'seller', promotionalCredit: 0 }));
    expect(useWorkspaceStore.getState()).toMatchObject({
      role: 'seller',
      cart: [],
      afterReview: null,
    });
    s.applySession(null);
    expect(useWorkspaceStore.getState().identity).toEqual({ name: '', email: '' });
  });
  it('persists display preferences only', () => {
    useWorkspaceStore.getState().setFilter('model', 'H200');
    useWorkspaceStore.getState().setPriceMetrics(['min', 'max']);
    useWorkspaceStore.getState().toggleSaved(offer('x'));
    const stored = JSON.parse(window.localStorage.getItem('opennext-terminal-v4')!);
    expect(stored).toEqual({
      model: 'H200',
      region: 'All regions',
      priceMetric: 'max',
      priceMetrics: ['max', 'min'],
    });
    expect(
      readPreferences({
        getItem: () =>
          JSON.stringify({ model: 'B200', period: '1Y', cart: [1], priceMetric: 'min' }),
      }),
    ).toEqual({ model: 'B200', priceMetrics: ['min'], priceMetric: 'min' });
  });
  it('manages saved, cart, selection and hidden series', () => {
    const s = useWorkspaceStore.getState();
    expect(s.toggleSaved(offer('a'))).toBe(true);
    expect(s.toggleSaved(offer('a'))).toBe(false);
    expect(s.addToCart(offer('b'))).toBe(true);
    expect(s.addToCart(offer('b'))).toBe(false);
    s.setSelected(['b']);
    s.removeFrom('cart', 'b');
    expect(useWorkspaceStore.getState()).toMatchObject({ cart: [], selected: [] });
    s.toggleSeries(0, 3);
    s.toggleSeries(1, 3);
    s.toggleSeries(2, 3);
    expect(useWorkspaceStore.getState().hiddenSeries).toEqual([0, 1]);
  });
});
