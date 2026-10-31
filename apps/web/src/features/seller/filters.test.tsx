import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FilterGroup } from './components/filters';
import { GROUPS, normalizeSettlement, tradeFiltered, type Settlement } from './settlements';
import { useSellerStore } from './store';

const rows: Settlement[] = ['Germany', 'Singapore'].map((country, index) => {
  const row = normalizeSettlement(
    {
      id: `trade-${index}`,
      model: 'H100 SXM',
      country,
      term: 'Spot',
      gpuCount: 8,
      vcpu: 192,
      memory: 80,
      perGpuHourly: 2,
      settledAt: '2026-10-01T00:00:00Z',
      status: 'Completed',
    },
    index,
  );
  if (!row) throw new Error('Invalid test settlement');
  return row;
});
const matching = () => {
  const ui = useSellerStore.getState();
  return tradeFiltered(rows, ui.term, ui.selected, 'H100 SXM', ui.emptyGroups);
};

beforeEach(() => {
  useSellerStore.getState().clear();
  useSellerStore.setState({ openGroups: ['model', 'country'] });
});

describe('Market Insight select all filters', () => {
  it('selects all initially and keeps All, partial selection and results consistent', () => {
    render(<FilterGroup group={GROUPS[1]} rows={rows} />);
    const all = screen.getByRole('checkbox', { name: /^All/ });
    const germany = screen.getByRole('checkbox', { name: /^Germany/ });
    const singapore = screen.getByRole('checkbox', { name: /^Singapore/ });
    expect(all).toBeChecked();
    expect(germany).toBeChecked();
    expect(singapore).toBeChecked();
    expect(matching()).toHaveLength(2);

    fireEvent.click(germany);
    expect(all).toBePartiallyChecked();
    expect(germany).not.toBeChecked();
    expect(singapore).toBeChecked();
    expect(matching().map((row) => row.country)).toEqual(['Singapore']);

    fireEvent.click(all);
    expect(all).toBeChecked();
    expect(germany).toBeChecked();
    expect(singapore).toBeChecked();
    expect(matching()).toHaveLength(2);
  });

  it('clears every option and returns no results, then restores all on Clear', () => {
    render(<FilterGroup group={GROUPS[1]} rows={rows} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /^All/ }));
    screen.getAllByRole('checkbox').forEach((checkbox) => expect(checkbox).not.toBeChecked());
    expect(matching()).toEqual([]);
    act(() => useSellerStore.getState().clear());
    screen.getAllByRole('checkbox').forEach((checkbox) => expect(checkbox).toBeChecked());
    expect(matching()).toHaveLength(2);
  });

  it('selects all options rather than only the searched options', () => {
    render(<FilterGroup group={GROUPS[1]} rows={rows} />);
    const all = screen.getByRole('checkbox', { name: /^All/ });
    fireEvent.click(all);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Germany' } });
    fireEvent.click(all);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    screen.getAllByRole('checkbox').forEach((checkbox) => expect(checkbox).toBeChecked());
    expect(matching()).toHaveLength(2);
  });

  it('keeps the separate trade model active when Index models is empty', () => {
    render(<FilterGroup group={GROUPS[0]} rows={rows} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /^All/ }));
    expect(useSellerStore.getState().emptyGroups).toEqual(['model']);
    expect(matching()).toHaveLength(2);
    act(() => useSellerStore.getState().selectGroup('country', []));
    expect(matching()).toEqual([]);
  });
});
