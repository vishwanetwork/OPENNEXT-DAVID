import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FilterGroup } from './components/filters';
import { filteredRows, GROUPS, normalizeInjected, type GroupKey } from './inventory';
import { useSpotMarketStore } from './store';

const rows = normalizeInjected([
  {
    id: 'a',
    model: 'H100 SXM',
    country: 'Singapore',
    vcpu: 192,
    memory: 80,
    gpuCount: 8,
    perGpuHourly: 1.8,
    term: 'Spot',
  },
  {
    id: 'b',
    model: 'H200 SXM',
    country: 'Germany',
    vcpu: 256,
    memory: 141,
    gpuCount: 8,
    perGpuHourly: 2.4,
    term: 'Spot',
  },
]);

function renderGroup(key: GroupKey, inventory = rows) {
  const group = GROUPS.find((item) => item.key === key);
  if (!group) throw new Error('Missing filter group');
  act(() => useSpotMarketStore.getState().setGroupOpen(key, true));
  return render(<FilterGroup group={group} rows={inventory} />);
}

const results = () => filteredRows(rows, useSpotMarketStore.getState()).map((row) => row.id);

beforeEach(() => {
  useSpotMarketStore.getState().reset();
  useSpotMarketStore.getState().setTerm('Spot');
});

describe('Market select all filters', () => {
  it.each(['model', 'country', 'vcpu', 'memory'] as const)(
    'keeps All and every %s option checked together',
    (key) => {
      renderGroup(key);
      for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeChecked();
      const all = screen.getByRole('checkbox', { name: /^All/ });
      fireEvent.click(all);
      for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).not.toBeChecked();
      expect(results()).toEqual([]);
      fireEvent.click(all);
      for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeChecked();
      expect(results()).toHaveLength(2);
    },
  );

  it('unchecks one option from All without clearing the other options', () => {
    renderGroup('model');
    fireEvent.click(screen.getByRole('checkbox', { name: /^H100 SXM/ }));
    expect(screen.getByRole('checkbox', { name: /^H200 SXM/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^All/ })).toBePartiallyChecked();
    expect(results()).toEqual(['b']);
    fireEvent.click(screen.getByRole('checkbox', { name: /^H200 SXM/ }));
    expect(screen.getByRole('checkbox', { name: /^All/ })).not.toBeChecked();
    expect(results()).toEqual([]);
    fireEvent.click(screen.getByRole('checkbox', { name: /^H100 SXM/ }));
    expect(results()).toEqual(['a']);
    fireEvent.click(screen.getByRole('checkbox', { name: /^H200 SXM/ }));
    expect(screen.getByRole('checkbox', { name: /^All/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^All/ })).not.toBePartiallyChecked();
  });

  it('selects the full group even while the option search hides some values', () => {
    renderGroup('model');
    fireEvent.click(screen.getByRole('checkbox', { name: /^All/ }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'H100' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /^All/ }));
    for (const checkbox of screen.getAllByRole('checkbox', { hidden: true }))
      expect(checkbox).toBeChecked();
    expect(results()).toHaveLength(2);
  });

  it('resets an empty group and restores all results without changing other controls', () => {
    renderGroup('model');
    fireEvent.click(screen.getByRole('checkbox', { name: /^All/ }));
    act(() => {
      useSpotMarketStore.getState().setSort('price-asc');
      useSpotMarketStore.getState().setPage(3);
      useSpotMarketStore.getState().reset();
    });
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeChecked();
    expect(results()).toEqual(['a', 'b']);
    expect(useSpotMarketStore.getState()).toMatchObject({
      page: 0,
      sort: 'price-asc',
      emptyGroups: [],
    });
  });

  it('disables All when no options are available', () => {
    renderGroup('model', []);
    expect(screen.getByRole('checkbox', { name: /^All/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /^All/ })).not.toBeChecked();
  });
});
