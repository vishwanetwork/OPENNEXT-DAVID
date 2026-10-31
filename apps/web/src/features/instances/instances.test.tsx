import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderTerminal, signIn } from '@/test/render';
import { useWorkspaceStore, initialWorkspace } from '@/terminal-kit';
import { useSessionStore } from '@/lib/session-store';
import { InstancesPage } from './components/instances-page';

beforeEach(() => {
  window.localStorage.clear();
  useWorkspaceStore.setState({
    ...initialWorkspace(),
    identity: { name: 'Ada', email: 'ada@example.com', id: 'u1' },
  });
  useSessionStore.setState({ status: 'booting', user: null });
  signIn();
});

describe('Instances page', () => {
  it('an empty account shows an honest empty state without example resources', () => {
    renderTerminal(<InstancesPage />);
    expect(screen.getByText('No instances yet')).toBeInTheDocument();
    expect(screen.queryByLabelText('Example instance')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Manage' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Find capacity' })).toBeInTheDocument();
  });
  it('delivered allocations show live cards with region metadata and no supplier identity', () => {
    renderTerminal(<InstancesPage />, {
      slots: {
        sshLibrary: (scope) => <section aria-label={`SSH keys for ${scope}`}>SSH keys</section>,
      },
      workspace: {
        instances: [
          {
            id: 'INS-1',
            name: 'Training run',
            model: 'H100',
            region: 'US East',
            count: 8,
            rate: 2.3,
            status: 'Running',
            serviceEnd: new Date(Date.now() + 3600000).toISOString(),
            provider: 'Secret Supplier Ltd',
            sshHost: 'gpu.example.com',
            sshUser: 'ubuntu',
          },
        ],
      },
    });
    expect(screen.queryByLabelText('Example instance')).toBeNull();
    const card = document.querySelector('[data-instance-live="INS-1"]');
    expect(card).toBeInTheDocument();
    if (!card) throw new Error('Expected the delivered instance card.');
    const keys = screen.getByRole('region', { name: 'SSH keys for instances' });
    const heading = screen.getByRole('heading', { name: 'Instances' });
    expect(heading.compareDocumentPosition(keys) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(keys.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.getAttribute('data-instance-life')).toBe('Running');
    expect(card.textContent).toContain('8 × H100 - USA');
    expect(card.textContent).not.toContain('Secret Supplier');
    expect(screen.getByRole('button', { name: 'Connect' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(useWorkspaceStore.getState().modal).toEqual({ type: 'connect', id: 'INS-1' });
  });
});
