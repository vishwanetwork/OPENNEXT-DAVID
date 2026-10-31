import { describe, expect, it, vi } from 'vitest';
import { at } from '@/test/at';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderTerminal, signIn, jsonResponse } from '@/test/render';
import { useWorkspaceStore } from '@/terminal-kit';
import { useSpotMarketStore } from './store';
import { SpotMarketPage } from './components/spot-market-page';
import { SpotCheckoutProvider } from './hooks';
import { SellerActivitiesPage, normalizeSettlement, useSellerStore } from '@/features/seller';
import { NotificationsPage } from '@/features/quotes';
import { ProfilePage } from '@/features/account';

vi.stubGlobal(
  'fetch',
  vi.fn(async () =>
    jsonResponse({
      rfqs: [],
      supplies: [],
      featured: { rfqs: [], supplies: [] },
      rows: [],
      regions: [],
      series: [],
    }),
  ),
);

describe('Spot market page', () => {
  it('shows Demo inventory as a table with the legacy column order and Buy Now actions', async () => {
    signIn({ demo: true });
    useWorkspaceStore.getState().applySession({
      id: 'u1',
      email: 'ada@example.com',
      role: 'buyer',
      onboardingCompleted: true,
      demo: true,
    } as never);
    renderTerminal(
      <SpotCheckoutProvider>
        <SpotMarketPage />
      </SpotCheckoutProvider>,
      { demo: true },
    );
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers.slice(0, 6)).toEqual([
      'Model',
      'Capacity',
      'Price',
      'Country',
      'vCPU',
      'Memory',
    ]);
    await waitFor(() =>
      expect(document.querySelector('.onx-spot-result-count')?.textContent).toMatch(/^18 offers$/),
    );
    expect(screen.getAllByText('8 GPUs').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^Buy Now/ }).length).toBe(12);
    expect(screen.queryByText(/GPU memory/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Card view' }));
    expect(document.querySelectorAll('.onx-spot-card').length).toBe(12);
    fireEvent.click(screen.getByRole('tab', { name: 'On-demand' }));
    expect(screen.getAllByRole('button', { name: /^Ask for quote/ }).length).toBeGreaterThan(0);
    useSpotMarketStore.getState().setTerm('Spot');
    useSpotMarketStore.getState().setView('list');
  });
  it('Buy Now opens the review dialog with duration, compute, fee and total', async () => {
    signIn({ demo: true });
    renderTerminal(
      <SpotCheckoutProvider>
        <SpotMarketPage />
      </SpotCheckoutProvider>,
      { demo: true },
    );
    fireEvent.click(at(screen.getAllByRole('button', { name: /^Buy Now/ }), 0));
    expect(useWorkspaceStore.getState().modal?.type).toBe('spot-review');
  });
});

describe('Market Insight page', () => {
  it('renders all three panels, range buttons and twenty activities by default', () => {
    signIn({ role: 'seller' });
    useWorkspaceStore.getState().applySession({
      id: 'u1',
      email: 'ada@example.com',
      role: 'seller',
      onboardingCompleted: true,
    } as never);
    const rows = Array.from(
      { length: 125 },
      (_, i) =>
        normalizeSettlement(
          {
            id: 'ORD-' + i,
            model: 'H100 SXM',
            country: 'Singapore',
            term: 'Spot',
            gpuCount: 8,
            vcpu: 192,
            memory: 80,
            perGpuHourly: 2.31,
            status: 'Completed',
            settledAt: new Date(Date.now() - i * 60000).toISOString(),
          },
          i,
        )!,
    );
    useSellerStore.getState().setInjected(rows);
    renderTerminal(<SellerActivitiesPage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Market Insight');
    for (const panel of ['index', 'analytics', 'activities'])
      expect(
        document.querySelector(`[data-sa-panel="${panel}"]`)?.getAttribute('aria-pressed'),
      ).toBe('true');
    for (const range of ['24H', '3D', '7D', '1M', '3M', '6M', '1Y', 'ALL'])
      expect(document.querySelector(`[data-sa-range="${range}"]`)).not.toBeNull();
    expect(document.querySelectorAll('.onx-sa-activity-row').length).toBe(20);
    expect(screen.getByText('Showing 20 of 125 in the selected range')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Show activities'), { target: { value: '50' } });
    expect(document.querySelectorAll('.onx-sa-activity-row').length).toBe(50);
    fireEvent.click(document.querySelector('[data-sa-range="3M"]')!);
    expect(screen.getByRole('dialog').textContent).toMatch(/contact Sales/);
    useSellerStore.getState().closeHistory();
    useSellerStore.getState().setInjected(null);
  });
});

describe('Notifications and profile pages', () => {
  it('notifications page shows the empty state and disabled read-all', () => {
    signIn();
    useWorkspaceStore.getState().applySession({
      id: 'u1',
      email: 'ada@example.com',
      role: 'buyer',
      onboardingCompleted: true,
    } as never);
    renderTerminal(<NotificationsPage />);
    expect(screen.getByText('No notifications yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
    expect(screen.getByText('No previous updates')).toBeInTheDocument();
  });
  it('profile shows verified identity for real accounts and hides it in Demo', () => {
    signIn({ provider: 'google' } as never);
    useWorkspaceStore.getState().applySession({
      id: 'u1',
      email: 'ada@example.com',
      role: 'buyer',
      onboardingCompleted: true,
    } as never);
    const real = renderTerminal(<ProfilePage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ada Lovelace');
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText('SSH keys')).toBeInTheDocument();
    real.unmount();
    renderTerminal(<ProfilePage />, { demo: true });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Your profile');
    expect(screen.getAllByText('—').length).toBe(3);
  });
});
