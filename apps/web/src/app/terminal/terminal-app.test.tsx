import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { SessionUser } from '@opennext/contracts';
import { useSessionStore } from '@/lib/session-store';
import { initialWorkspace, useTerminalSlots, useWorkspaceStore } from '@/terminal-kit';
import { jsonResponse, mockFetch, renderWithProviders } from '@/test/render';
import { TerminalApp } from './terminal-app';

const USER: SessionUser = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  role: 'buyer',
  onboardingCompleted: true,
  demo: false,
  promotionalCredit: 100,
  promotionalCreditGranted: 100,
  promotionalCreditWithdrawable: false,
  csrfToken: 'csrf',
};

/** Reads the composed slots the way a feature would, so the wiring itself is under test. */
function SlotProbe() {
  const slots = useTerminalSlots();
  return (
    <div data-testid="probe">
      <span data-testid="modals">{Object.keys(slots.modals).sort().join(',')}</span>
      <span data-testid="filled">
        {[
          slots.headerBell ? 'headerBell' : '',
          slots.listingTable ? 'listingTable' : '',
          slots.matchesPanel ? 'matchesPanel' : '',
          slots.sshLibrary ? 'sshLibrary' : '',
        ]
          .filter(Boolean)
          .join(',')}
      </span>
      <button type="button" onClick={() => slots.openContact({ message: 'Need 64 H100' })}>
        contact
      </button>
    </div>
  );
}

beforeEach(() => {
  useSessionStore.setState({ status: 'booting', user: null });
  useWorkspaceStore.setState(initialWorkspace());
  mockFetch((path) => {
    if (path.startsWith('/api/auth/session')) return jsonResponse({ user: USER });
    if (path.startsWith('/api/marketplace/me'))
      return jsonResponse({ rfqs: [], supplies: [], orders: [], instances: [], notifications: [] });
    if (path.startsWith('/api/billing/account'))
      return jsonResponse({ confirmed: true, accountId: 'u1', currency: 'USD', requests: [] });
    return jsonResponse({});
  });
});

describe('TerminalApp composition root', () => {
  it('fills every shell slot and merges the modal maps of all features', async () => {
    renderWithProviders(
      <TerminalApp initialUser={USER}>
        <SlotProbe />
      </TerminalApp>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toBeInTheDocument());
    expect(screen.getByTestId('filled').textContent).toBe(
      'headerBell,listingTable,matchesPanel,sshLibrary',
    );
    const modals = screen.getByTestId('modals').textContent?.split(',') ?? [];
    // One representative modal per feature proves each map made it into the composition.
    for (const type of ['info', 'rfq', 'bill-order', 'instance', 'spot-review', 'account-ssh-add'])
      expect(modals).toContain(type);
    expect(new Set(modals).size).toBe(modals.length);
  });

  it('opens the site contact dialog from the shared openContact slot', async () => {
    renderWithProviders(
      <TerminalApp initialUser={USER}>
        <SlotProbe />
      </TerminalApp>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'contact' }));
    expect(await screen.findByRole('heading', { name: /talk capacity/i })).toBeInTheDocument();
  });
});
