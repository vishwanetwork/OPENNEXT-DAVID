import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { renderTerminal, signIn } from '@/test/render';
import { initialWorkspace, useWorkspaceStore } from '@/terminal-kit';
import { MarketOverview, modelHighlights } from './components/market-overview';
import { normalizeRow, type MarketTerm, type SpotRow } from './inventory';
import { useSpotMarketStore } from './store';

function offer(model: string, price: number, index: number, term: MarketTerm = 'Spot'): SpotRow {
  const row = normalizeRow(
    {
      id: `offer-${index}`,
      model,
      term,
      country: 'Singapore',
      gpuCount: 8,
      vcpu: 192,
      memory: 80,
      perGpuHourly: price,
    },
    index,
    'agent',
  );
  if (!row) throw new Error('Expected a valid normalized market offer.');
  return row;
}

const inventory = [
  offer('H100 SXM', 1.9, 1),
  offer('H100 SXM', 1.6, 2),
  offer('H100 SXM', 1.8, 3),
  offer('H200 SXM', 2.5, 4),
  offer('H200 SXM', 2.3, 5),
  offer('A100 SXM', 1.1, 6),
  offer('B200', 2.9, 7),
  offer('H100 SXM', 0.8, 8, 'On-demand'),
  offer('B200', 2.7, 9, 'Reserved'),
];

beforeEach(() => {
  useSpotMarketStore.getState().reset();
  useSpotMarketStore.setState({ term: 'Spot', view: 'list', sort: 'recent', page: 0 });
  useWorkspaceStore.setState(initialWorkspace());
  signIn();
});

describe('Market overview model highlights', () => {
  it('summarizes the current term by available offer count and minimum per-GPU price', () => {
    expect(modelHighlights(inventory, 'Spot')).toEqual([
      { model: 'H100 SXM', count: 3, price: 1.6 },
      { model: 'H200 SXM', count: 2, price: 2.3 },
      { model: 'A100 SXM', count: 1, price: 1.1 },
    ]);
    expect(modelHighlights(inventory, 'On-demand')).toEqual([
      { model: 'H100 SXM', count: 1, price: 0.8 },
    ]);
    expect(modelHighlights(inventory, 'Reserved')).toEqual([
      { model: 'B200', count: 1, price: 2.7 },
    ]);

    const { rerender } = renderTerminal(
      <MarketOverview rows={inventory} term="Spot" onNewRfq={() => {}} />,
    );
    const highlight = screen.getByRole('button', { name: 'View H100 SXM Spot offers' });
    expect(within(highlight).getByText('3 Spot offers')).toBeInTheDocument();
    expect(within(highlight).getByText('$1.60')).toBeInTheDocument();
    expect(within(highlight).getByText('/ GPU-hour')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View B200 Spot offers' })).toBeNull();

    rerender(<MarketOverview rows={inventory} term="On-demand" onNewRfq={() => {}} />);
    expect(screen.queryByRole('button', { name: 'View H100 SXM Spot offers' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'View H100 SXM On-demand offers' }),
    ).toHaveTextContent('$0.80');
  });

  it('omits non-finite, zero and negative prices instead of displaying a fabricated minimum', () => {
    const valid = offer('H100 SXM', 1.75, 20);
    const invalid = [NaN, Infinity, -Infinity, 0, -1].map((price, index) => ({
      ...valid,
      _key: `invalid-${index}`,
      model: 'Invalid model',
      perGpuHourly: price,
    }));
    expect(modelHighlights([valid, ...invalid], 'Spot')).toEqual([
      { model: 'H100 SXM', count: 1, price: 1.75 },
    ]);
    expect(modelHighlights(invalid, 'Spot')).toEqual([]);
    renderTerminal(<MarketOverview rows={invalid} term="Spot" onNewRfq={() => {}} />);
    expect(screen.queryByRole('button', { name: /^View .* offers$/ })).toBeNull();
    expect(screen.queryByText(/NaN|Infinity|\$0\.00|\$-1\.00/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Post RFQ' })).toBeInTheDocument();
  });

  it('selects and clears its model while retaining other filters and resetting pagination', () => {
    const store = useSpotMarketStore.getState();
    store.selectGroup('country', ['Germany']);
    store.selectGroup('vcpu', ['192']);
    store.selectGroup('memory', ['80']);
    store.setMaxPrice(2.1);
    store.setSort('price-asc');
    store.setPage(2);
    renderTerminal(<MarketOverview rows={inventory} term="Spot" onNewRfq={() => {}} />);

    const highlight = screen.getByRole('button', { name: 'View H100 SXM Spot offers' });
    fireEvent.click(highlight);
    expect(highlight).toHaveAttribute('aria-pressed', 'true');
    expect(useSpotMarketStore.getState().selected).toEqual({
      model: ['H100 SXM'],
      country: ['Germany'],
      vcpu: ['192'],
      memory: ['80'],
    });
    expect(useSpotMarketStore.getState()).toMatchObject({
      page: 0,
      maxPrice: 2.1,
      sort: 'price-asc',
    });

    act(() => useSpotMarketStore.getState().setPage(1));
    fireEvent.click(highlight);
    expect(highlight).toHaveAttribute('aria-pressed', 'false');
    expect(useSpotMarketStore.getState().selected).toEqual({
      model: [],
      country: ['Germany'],
      vcpu: ['192'],
      memory: ['80'],
    });
    expect(useSpotMarketStore.getState().page).toBe(0);
    expect(useSpotMarketStore.getState().maxPrice).toBe(2.1);
  });

  it('opens the original RFQ action and Agent state without changing account or filters', () => {
    const onNewRfq = vi.fn();
    const identity = useWorkspaceStore.getState().identity;
    const filters = useSpotMarketStore.getState().selected;
    renderTerminal(<MarketOverview rows={inventory} term="Spot" onNewRfq={onNewRfq} />);
    fireEvent.click(screen.getByRole('button', { name: 'Post RFQ' }));
    expect(onNewRfq).toHaveBeenCalledOnce();
    expect(useWorkspaceStore.getState().agentOpen).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Ask OpenNEXT Agent' }));
    expect(useWorkspaceStore.getState().agentOpen).toBe(true);
    expect(onNewRfq).toHaveBeenCalledOnce();
    expect(useWorkspaceStore.getState().identity).toEqual(identity);
    expect(useSpotMarketStore.getState().selected).toEqual(filters);
  });
});
