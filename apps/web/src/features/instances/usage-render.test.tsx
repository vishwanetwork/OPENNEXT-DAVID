import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderTerminal, signIn } from '@/test/render';
import { initialWorkspace, useWorkspaceStore } from '@/terminal-kit';
import { InstancesPage } from './components/instances-page';
import { Manage } from './components/instance-dialogs';
import { BillingHistory, UsageDialog } from './components/usage-dialogs';
import { instanceUsageFixture } from '@/test/instance-usage-fixture';

beforeEach(() => {
  useWorkspaceStore.setState(initialWorkspace());
  signIn();
});
const future = '2099-01-01T00:00:00Z';
const row = {
  id: 'ins-1',
  model: 'A10G',
  count: 1,
  region: 'us-east-1',
  durationHours: 72,
  term: 'Spot',
  status: 'Running',
  serviceEnd: future,
};

describe('instance lifecycle and ledger presentation', () => {
  it('groups running, reconnecting and ended instances and preserves unknown states', () => {
    renderTerminal(<InstancesPage />, {
      workspace: {
        instances: [
          row,
          { ...row, id: 'ins-2', status: 'interrupted' },
          { ...row, id: 'ins-3', status: 'Ended' },
          { ...row, id: 'ins-4', status: 'provisioning' },
        ],
      },
    });
    const groups = Array.from(document.querySelectorAll('.instance-state-group'));
    expect(groups).toHaveLength(4);
    expect(groups[0]?.querySelector('[data-instance-live="ins-1"]')).toBeInTheDocument();
    expect(groups[1]?.querySelector('[data-instance-live="ins-2"]')).toBeInTheDocument();
    expect(groups[2]?.querySelector('[data-instance-live="ins-3"]')).toBeInTheDocument();
    expect(screen.getAllByText('1 × A10G - 72H - USA')).toHaveLength(4);
    expect(screen.getByText(/Data preservation will be confirmed/)).toBeInTheDocument();
    expect(screen.queryByText(/Your data is preserved/)).toBeNull();
  });
  it('Manage has Billing and History instead of the duplicate Close button', () => {
    renderTerminal(<Manage id="ins-1" />, { workspace: { instances: [row] } });
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Billing' }));
    expect(useWorkspaceStore.getState().modal).toEqual({ type: 'instance-billing', id: 'ins-1' });
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(useWorkspaceStore.getState().modal).toEqual({ type: 'instance-history', id: 'ins-1' });
  });
  it('does not estimate real billing from a current rate or missing history', () => {
    renderTerminal(<UsageDialog id="ins-1" view="billing" />);
    expect(screen.getByText(/No charges or interruption events are estimated/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
  it('fetches confirmed history through the optional service and does not fetch it in Demo', async () => {
    const load = vi.fn().mockResolvedValue({
      ...instanceUsageFixture(),
      confirmed: true,
      demo: false,
      accountId: 'u1',
      instanceId: 'ins-1',
    });
    const mounted = renderTerminal(<UsageDialog id="ins-1" view="history" />, {
      slots: { services: { instanceUsage: { load } } },
    });
    await waitFor(() =>
      expect(screen.getByText('Interrupted · billing paused')).toBeInTheDocument(),
    );
    expect(screen.getByText('Reconnected', { selector: 'strong' })).toBeInTheDocument();
    mounted.unmount();
    load.mockClear();
    renderTerminal(<UsageDialog id="ins-1" view="billing" />, {
      demo: true,
      slots: { services: { instanceUsage: { load } } },
    });
    expect(load).not.toHaveBeenCalled();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('explains the 1-hour minimum when an order ran less than an hour', () => {
    const snapshot = instanceUsageFixture();
    const short = {
      ...snapshot,
      billing: {
        ...snapshot.billing!,
        totalCents: 29,
        entries: [
          {
            id: 'hour-1',
            startedAt: '2026-10-29T12:02:19Z',
            endedAt: '2026-10-29T12:10:57Z',
            billableSeconds: 518,
            computeCents: 28,
            feeCents: 1,
            totalCents: 29,
          },
        ],
      },
    };
    const view = renderTerminal(<BillingHistory snapshot={short} />);
    expect(document.querySelector('[data-instance-billing-minimum]')).not.toBeNull();
    view.unmount();
    renderTerminal(<BillingHistory snapshot={snapshot} />);
    expect(document.querySelector('[data-instance-billing-minimum]')).toBeNull();
  });
});
