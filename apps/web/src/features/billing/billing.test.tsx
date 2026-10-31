import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderTerminal, signIn } from '@/test/render';
import { useWorkspaceStore, initialWorkspace } from '@/terminal-kit';
import { useSessionStore } from '@/lib/session-store';
import { BillingPage } from './components/billing-page';
import { useBillingUi } from './ui-store';

beforeEach(() => {
  useWorkspaceStore.setState({
    ...initialWorkspace(),
    identity: { name: 'Ada', email: 'ada@example.com', id: 'u1' },
  });
  useSessionStore.setState({ status: 'booting', user: null });
  useBillingUi.setState({ sample: false, hidden: [], chart: 'bars' });
  signIn();
});

describe('Billing page', () => {
  it('renders buyer billing with credit, controls, chart and an empty daily history row', () => {
    renderTerminal(<BillingPage />, { billing: { availableCredit: 100, paidCredit: 100 } });
    expect(screen.getByRole('heading', { name: 'Billing & usage' })).toBeInTheDocument();
    expect(screen.getByText('$100.00', { selector: '.bill-wallet strong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add credit' })).toBeInTheDocument();
    expect(screen.getByText('No spent history yet')).toBeInTheDocument();
    expect(screen.getByText('No posted activity in this period')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview example analytics' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add credit' }));
    expect(useWorkspaceStore.getState().modal?.type).toBe('pay-start');
  });
  it('ignores an old saved example toggle and reports account records only', () => {
    useBillingUi.setState({ sample: true });
    renderTerminal(<BillingPage />);
    expect(screen.queryByText('Example analytics')).toBeNull();
    expect(screen.getByText('No spent history yet')).toBeInTheDocument();
    expect(screen.getByText('No posted activity in this period')).toBeInTheDocument();
  });
  it('sellers see earnings, payouts and role-specific columns', () => {
    useWorkspaceStore.getState().patch({ role: 'seller' });
    renderTerminal(<BillingPage />, { billing: { earningsBalance: 42 } as never });
    expect(screen.getByRole('heading', { name: 'Earnings & payouts' })).toBeInTheDocument();
    expect(screen.getByText('$42.00')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Payouts' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toContain(
      'Commission paid',
    );
    expect(screen.getByText('No earnings history yet')).toBeInTheDocument();
  });
});
