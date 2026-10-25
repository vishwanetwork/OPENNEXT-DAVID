import { describe, expect, it } from 'vitest';
import { at } from '@/test/at';
import {
  boundsFor,
  emptySelected,
  filteredRows,
  inventoryState,
  normalizeInjected,
  normalizeRow,
  optionsFor,
  paginate,
  GROUPS,
  FALLBACK_ROWS,
} from './inventory';

const fixture = {
  id: 'offer-one',
  model: 'H100 SXM',
  country: 'Singapore',
  gpuCount: 8,
  vcpu: 192,
  memory: 80,
  perGpuHourly: 1.8,
  term: 'Spot',
};

describe('Spot inventory', () => {
  it('fallback inventory is exclusive to an active Demo session', () => {
    expect(inventoryState({ injected: null, agentRows: [], demoActive: false }).rows.length).toBe(
      0,
    );
    expect(inventoryState({ injected: null, agentRows: [], demoActive: true }).rows.length).toBe(
      54,
    );
    expect(FALLBACK_ROWS.every((row) => row.previewOnly && row.sourceKind === 'fixture')).toBe(
      true,
    );
  });
  it('normalizes rows, derives instance hourly from the explicit node GPU count and drops observations', () => {
    const row = normalizeRow(fixture, 0, 'agent')!;
    expect(row.instanceHourly).toBe(14.4);
    expect(row.previewOnly).toBe(false);
    expect(normalizeRow({ ...fixture, referenceOnly: true }, 0, 'agent')).toBeNull();
    expect(normalizeRow({ ...fixture, gpuCount: undefined }, 0, 'agent')).toBeNull();
    expect(normalizeRow({ ...fixture, perGpuHourly: 0 }, 0, 'agent')).toBeNull();
    expect(normalizeInjected([fixture])[0]?.sourceKind).toBe('preview');
    expect(normalizeInjected([{ ...fixture, agentStatus: 'Succeeded' }])[0]?.sourceKind).toBe(
      'agent',
    );
  });
  it('price bounds follow the term and attribute filters but never the price filter itself', () => {
    const rows = normalizeInjected([
      fixture,
      { ...fixture, id: 'two', perGpuHourly: 2.4, country: 'Germany' },
      { ...fixture, id: 'three', term: 'Reserved', perGpuHourly: 9 },
    ]);
    const state = {
      term: 'Spot' as const,
      selected: emptySelected(),
      maxPrice: 2,
      sort: 'recent' as const,
    };
    expect(boundsFor(rows, state)).toMatchObject({ min: 1.8, max: 2.4 });
    expect(filteredRows(rows, state).map((row) => row.id)).toEqual(['offer-one']);
    expect(
      filteredRows(rows, { ...state, maxPrice: null, sort: 'price-desc' }).map((row) => row.id),
    ).toEqual(['two', 'offer-one']);
    expect(optionsFor(at(GROUPS, 1), rows, state)).toEqual(['Germany', 'Singapore']);
  });
  it('pages twelve rows at a time and clamps the page index', () => {
    const page = paginate(FALLBACK_ROWS, 99);
    expect(page.pages).toBe(5);
    expect(page.page).toBe(4);
    expect(page.visible.length).toBe(6);
    expect(paginate([], 0)).toMatchObject({ pages: 1, rangeStart: 0, rangeEnd: 0 });
  });
});
