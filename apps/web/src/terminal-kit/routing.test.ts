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
    expect(resolveTarget('supply', 'buyer', true)).toBe('market');
    expect(resolveTarget('supply', 'buyer', false)).toBe('supply');
    expect(resolveTarget('rfqs', 'seller', true)).toBe('market');
    expect(resolveTarget('mandates', 'seller', true)).toBe('market');
    expect(resolveTarget('instances', 'seller', true)).toBe('instances');
    expect(defaultRoute('seller')).toBe('supply');
    expect(defaultRoute('buyer')).toBe('market');
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
