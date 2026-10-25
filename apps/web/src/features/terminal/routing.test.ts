import { describe, expect, it } from 'vitest';
import {
  defaultRoute,
  legacyHashToPath,
  publicTargetRoute,
  resolveTarget,
  routeFromPath,
  routeTarget,
} from './routing';

describe('terminal routing', () => {
  it('maps unknown and legacy routes', () => {
    expect(routeTarget('credentials')).toBe('instances');
    expect(routeTarget('bogus')).toBe('market');
    expect(routeTarget('billing')).toBe('billing');
  });
  it('keeps completed accounts on pages their verified role can use', () => {
    expect(resolveTarget('supply', 'Buyer', true)).toBe('market');
    expect(resolveTarget('supply', 'Buyer', false)).toBe('supply');
    expect(resolveTarget('rfqs', 'Seller', true)).toBe('market');
    expect(resolveTarget('mandates', 'Seller', true)).toBe('market');
    expect(resolveTarget('instances', 'Seller', true)).toBe('instances');
    expect(defaultRoute('Seller')).toBe('supply');
    expect(defaultRoute('Buyer')).toBe('market');
  });
  it('translates legacy hashes and paths', () => {
    expect(legacyHashToPath('#terminal/instances')).toBe('/instances');
    expect(legacyHashToPath('#terminal/credentials')).toBe('/instances');
    expect(legacyHashToPath('#terminal')).toBe('/market');
    expect(legacyHashToPath('#')).toBeNull();
    expect(legacyHashToPath('#pricing')).toBeNull();
    expect(routeFromPath('/terminal/market', '/terminal')).toBe('market');
    expect(routeFromPath('/terminal', '/terminal')).toBe('');
    expect(routeFromPath('/saved', '')).toBe('saved');
    expect(publicTargetRoute('rfq')).toBe('rfqs');
    expect(publicTargetRoute('gpus')).toBe('market');
  });
});
