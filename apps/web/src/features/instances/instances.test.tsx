import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderTerminal, signIn } from '@/test/terminal-utils';
import { useWorkspaceStore, initialWorkspace } from '@/features/terminal/store';
import { useSessionStore } from '@/lib/session-store';
import { InstancesPage } from './components/InstancesPage';

beforeEach(() => {
  window.localStorage.clear();
  useWorkspaceStore.setState({ ...initialWorkspace(), identity: { name: 'Ada', email: 'ada@example.com', id: 'u1' } });
  useSessionStore.setState({ status: 'booting', user: null });
  signIn();
});

describe('Instances page', () => {
  it('an empty workspace shows a clearly separate example instance with explanatory controls only', () => {
    renderTerminal(<InstancesPage />);
    expect(screen.getByText('No instances yet')).toBeInTheDocument();
    expect(screen.getByLabelText('Example instance')).toBeInTheDocument();
    expect(screen.getByText('Example only · not an active resource')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    expect(useWorkspaceStore.getState().modal?.type).toBe('instance-example-manage');
    expect(document.querySelector('[data-instance-example-live]')?.getAttribute('data-instance-life')).toBe('Running');
  });
  it('delivered allocations show live cards with region metadata and no supplier identity', () => {
    useWorkspaceStore.getState().patch({ instances: [{ id: 'INS-1', name: 'Training run', model: 'H100', region: 'US East', count: 8, rate: 2.3, status: 'Running', serviceEnd: new Date(Date.now() + 3600000).toISOString(), provider: 'Secret Supplier Ltd', sshHost: 'gpu.example.com', sshUser: 'ubuntu' }] });
    renderTerminal(<InstancesPage />);
    expect(screen.queryByLabelText('Example instance')).toBeNull();
    const card = document.querySelector('[data-instance-live="INS-1"]')!;
    expect(card.getAttribute('data-instance-life')).toBe('Running');
    expect(card.textContent).toContain('US East');
    expect(card.textContent).not.toContain('Secret Supplier');
    expect(screen.getByRole('button', { name: 'Connect' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(useWorkspaceStore.getState().modal).toEqual({ type: 'connect', id: 'INS-1' });
  });
});
