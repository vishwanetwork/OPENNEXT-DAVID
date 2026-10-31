import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { jsonResponse, renderTerminal, signIn } from '@/test/render';
import { useSessionStore } from '@/lib/session-store';
import { initialWorkspace, useWorkspaceStore } from '@/terminal-kit';
import { TerminalPage } from './terminal-page';
import { HelpPage } from './components/help-page';
import { ModelsPage } from './components/models-page';
import { CollectionPage } from './components/collection-page';
import { TerminalHeader } from './components/terminal-header';
import { MarketPage } from './components/market-page';
import { TerminalModal, terminalModals } from './components/modals';

beforeEach(() => {
  useSessionStore.setState({ status: 'booting', user: null });
  useWorkspaceStore.setState(initialWorkspace());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/pricing/prices'))
        return jsonResponse({
          records: [
            {
              recordId: 'r1',
              provider: 'aws',
              gpuModel: 'H100',
              region: 'us-east-1',
              term: 'Spot',
              gpuCount: 8,
              perGpuHourly: 2.5,
              instanceHourly: 20,
              observedAt: '2026-10-20T00:00:00Z',
            },
          ],
          meta: { status: 'ok' },
        });
      if (url.startsWith('/api/pricing/history-catalog')) return jsonResponse({ regions: [] });
      if (url.startsWith('/api/pricing/regional-history'))
        return jsonResponse({
          term: 'Spot',
          metric: 'avg',
          regions: [{ code: 'us-east-1', name: 'US East' }],
          meta: { bucketMinutes: 60 },
          series: [
            {
              id: 'a',
              region: 'us-east-1',
              name: 'US East',
              configuration: '8 × H100',
              gpuCount: 8,
              points: [
                { time: '2026-10-20T00:00:00Z', avg: 2.5 },
                { time: '2026-10-20T01:00:00Z', avg: 2.6 },
              ],
            },
          ],
        });
      if (url.startsWith('/api/news'))
        return jsonResponse({
          status: 'ok',
          fetchedAt: '2026-10-20T00:00:00Z',
          articles: [
            {
              title: 'AWS adds capacity',
              url: 'https://aws.amazon.com/x',
              source: 'AWS',
              publishedAt: '2026-10-19',
            },
          ],
        });
      return jsonResponse({ user: null });
    }),
  );
});

describe('TerminalPage gate', () => {
  it('shows the sign-in view to anonymous visitors and keeps the landing off the terminal', () => {
    useSessionStore.getState().setUser(null);
    renderTerminal(
      <TerminalPage>
        <div>secret</div>
      </TerminalPage>,
    );
    expect(screen.getByText('Welcome back.')).toBeInTheDocument();
    expect(screen.getByText('Continue with Google')).toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });
  it('shows onboarding until the workspace is set up', () => {
    signIn({ onboardingCompleted: false });
    renderTerminal(
      <TerminalPage>
        <div>secret</div>
      </TerminalPage>,
    );
    expect(screen.getByText('How will you', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Buyer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
  });
  it('renders the page for verified, onboarded accounts', () => {
    signIn();
    renderTerminal(
      <TerminalPage>
        <HelpPage />
      </TerminalPage>,
    );
    expect(screen.getByText('Help & Documentation')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(6);
  });
});

describe('terminal pages', () => {
  it('lists supplier model quotes with the Coming soon market switcher', () => {
    signIn();
    renderTerminal(<ModelsPage />);
    expect(screen.getByText('Model Capacity', { selector: 'h1' })).toBeInTheDocument();
    expect(screen.getByText('29 quoted model tiers')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search model, brand, context tier or SKU…'), {
      target: { value: 'claude sonnet 5' },
    });
    const visible = document.querySelectorAll('.model-card:not([hidden])');
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(29);
  });
  it('shows an empty quote cart and guards compare', () => {
    signIn();
    renderTerminal(<CollectionPage type="cart" />);
    expect(screen.getByText('Your quote cart is empty')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Compare selected'));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Select at least two resources to compare',
    );
  });
  it('renders the header navigation for the buyer role and the user menu', () => {
    signIn();
    useWorkspaceStore.getState().applySession(useSessionStore.getState().user);
    renderTerminal(<TerminalHeader onSignOut={() => {}} onRole={() => {}} onContact={() => {}} />);
    expect(screen.getByRole('button', { name: 'GPU Market' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'OpenNEXT home' })).toBeNull();
    expect(screen.getByRole('button', { name: 'RFQs & Quote' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buyer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seller' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Broker' })).toBeNull();
  });
  it('keeps the original server balance and agent action while disabling seller entry', () => {
    signIn();
    useWorkspaceStore.getState().applySession(useSessionStore.getState().user);
    const switchRole = vi.fn();
    const signOut = vi.fn();
    renderTerminal(
      <TerminalHeader onSignOut={signOut} onRole={switchRole} onContact={() => {}} />,
      {
        billing: { availableCredit: 125 },
      },
    );
    expect(screen.getByRole('button', { name: /Credit/ })).toHaveTextContent('$125');
    fireEvent.click(screen.getByRole('button', { name: 'Seller' }));
    expect(switchRole).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(document.body.style.overflow).not.toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: /OpenNEXT Agent/ }));
    expect(useWorkspaceStore.getState().agentOpen).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
    expect(
      screen
        .getAllByRole('button', { name: 'Seller' })
        .every((button) => button.hasAttribute('disabled')),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledOnce();
  });
  it('renders the market page with filters, chart summary, news and matches', async () => {
    signIn();
    renderTerminal(
      <>
        <MarketPage />
        <TerminalModal />
      </>,
      { slots: { modals: terminalModals } },
    );
    expect(screen.getByText('Switch Market')).toBeInTheDocument();
    expect(await screen.findByText('AWS adds capacity')).toBeInTheDocument();
    await screen.findAllByText('$2.60');
    expect(document.getElementById('marketPrice')).toHaveTextContent('$2.60');
    expect(document.getElementById('marketChange')).toHaveTextContent('+4.00%');
    expect(screen.getByText('Best Matches')).toBeInTheDocument();
    expect(screen.getByText('Recent Observations')).toBeInTheDocument();
    expect(screen.getAllByText('1 actual price records')).toHaveLength(2);
    fireEvent.click(screen.getByText('Methodology'));
    expect(screen.getByRole('dialog', { name: 'GPU pricing methodology' })).toBeInTheDocument();
  });
});
