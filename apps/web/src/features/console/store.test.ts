import { describe, expect, it } from 'vitest';
import { STORAGE_KEY, loadDb, migrateIdentity } from './store';
import { initialDb } from './reference-data';
import { filteredOffers, importOffers } from './pages/market';
import { defaultMarketFilters } from './store';
import { legacyHashToPath, pagePath } from './pages';
import { toCsv } from './helpers';

const memory = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
};

describe('browser-local operations dataset', () => {
  it('starts from the seeded preview dataset when storage is empty or invalid', () => {
    const storage = memory();
    storage.setItem(STORAGE_KEY, '{"broken":');
    const db = loadDb(storage);
    expect(db.offers).toHaveLength(36);
    expect(db.datasets.map((d) => d.id)).toEqual([
      'current',
      'history',
      'providers',
      'specs',
      'inventory',
    ]);
    expect(db.profile.name).toBe('Administrator');
  });
  it('keeps existing records and migrates the old preview identity without resetting reviews', () => {
    const storage = memory();
    const db = initialDb();
    db.profile = { ...db.profile, name: 'Richard Chen', email: 'richard@opennext.ai' };
    db.users[1] = { ...db.users[1], name: 'Nova', email: 'nova@vishwalab.com' };
    db.audit[0] = { ...db.audit[0], actor: 'Richard' };
    db.orders[0].stage = 3;
    storage.setItem(STORAGE_KEY, JSON.stringify(db));
    const loaded = loadDb(storage);
    expect(loaded.profile).toMatchObject({ name: 'Administrator', email: '' });
    expect(loaded.users[1]).toMatchObject({
      name: 'Administrator',
      email: '',
      review: db.users[1].review,
    });
    expect(loaded.audit[0].actor).toBe('Operations');
    expect(loaded.orders[0].stage).toBe(3);
    expect(JSON.parse(storage.map.get(STORAGE_KEY)!).profile.name).toBe('Administrator');
  });
  it('reports whether a migration happened', () => {
    expect(migrateIdentity(initialDb())).toBe(false);
  });
});

describe('market filters and CSV import', () => {
  it('applies every filter together with the search query', () => {
    const db = initialDb();
    const all = filteredOffers(db, defaultMarketFilters(), '');
    expect(all).toHaveLength(36);
    const spot = filteredOffers(
      db,
      { ...defaultMarketFilters(), terms: 'Spot', provider: 'Nebius' },
      '',
    );
    expect(spot.every((o) => o.terms === 'Spot' && o.provider === 'Nebius')).toBe(true);
    expect(filteredOffers(db, { ...defaultMarketFilters(), min: '100' }, '')).toHaveLength(0);
    expect(
      filteredOffers(db, defaultMarketFilters(), 'singapore').every(
        (o) => o.region === 'Singapore',
      ),
    ).toBe(true);
  });
  it('validates headers, skips invalid rows and records the import', () => {
    const db = initialDb();
    expect(importOffers(db, 'current', 'provider,model\nNebius,H100')).toEqual({
      error: 'CSV headers must include provider, model, count, region, terms and rate.',
    });
    expect(importOffers(db, 'current', 'provider,model,count,region,terms,rate')).toEqual({
      error: 'The CSV needs at least one data row.',
    });
    const result = importOffers(
      db,
      'current',
      'provider,model,count,region,terms,rate\nNebius,H100 SXM,8,US East,Spot,2.63\nBad,,0,,Spot,0',
    );
    expect(result).toEqual({ added: 1, skipped: 1 });
    expect(db.offers[0]).toMatchObject({
      provider: 'Nebius',
      model: 'H100 SXM',
      memory: 80,
      count: 8,
      rate: 2.63,
      source: 'Operator CSV import',
    });
    expect(db.datasets[0].count).toBe(37);
  });
  it('exports CSV with quoted values', () => {
    expect(toCsv([{ a: 'x"y', b: 1 }])).toBe('a,b\n"x""y","1"');
  });
});

describe('console routes', () => {
  it('maps legacy hashes to routes', () => {
    expect(legacyHashToPath('#pricing')).toBe('/pricing');
    expect(legacyHashToPath('#overview')).toBe('/');
    expect(legacyHashToPath('#demoSubmissions')).toBe('/demo-submissions');
    expect(legacyHashToPath('#unknown')).toBeNull();
    expect(legacyHashToPath('')).toBeNull();
    expect(pagePath('settings')).toBe('/settings');
  });
});
