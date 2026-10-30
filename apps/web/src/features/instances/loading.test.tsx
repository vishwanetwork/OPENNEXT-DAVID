import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { json, mockFetch, renderTerminal, signIn, testQueryClient } from '@/test/render';
import { EMPTY_WORKSPACE, initialWorkspace, useWorkspaceStore } from '@/terminal-kit';
import { InstancesPage } from './components/instances-page';
import { InstanceAutopilot } from './components/instance-autopilot';

const saved = {
  task: {
    version: 1,
    script: 'echo demo',
    env: { EPOCHS: '3' },
    secretNames: [],
    onSuccess: 'keep',
    onFailure: 'keep',
    onReplacement: 'rerun',
    maxMinutes: 5,
  },
  status: {
    state: 'waiting',
    onSuccess: 'keep',
    onFailure: 'keep',
    startedAt: null,
    stopRequested: false,
    outcome: null,
  },
  logTail: '',
};

beforeEach(() => {
  useWorkspaceStore.setState(initialWorkspace());
  signIn();
});

describe('instance loading and task cache', () => {
  it('shows first-load progress instead of an incorrect empty state', async () => {
    const gate = Promise.withResolvers<Response>();
    mockFetch((path) => (path.includes('/api/marketplace/me') ? gate.promise : json(200, {})));
    renderTerminal(<InstancesPage />);
    expect(screen.getByText('Loading instances…')).toBeInTheDocument();
    expect(screen.queryByText('No instances yet')).toBeNull();
    await act(async () => gate.resolve(json(200, EMPTY_WORKSPACE)));
    expect(await screen.findByText('No instances yet')).toBeInTheDocument();
  });

  it('keeps the list usable during refresh and shows its pending state', async () => {
    const gate = Promise.withResolvers<Response>();
    mockFetch((path) => (path.includes('/api/marketplace/me') ? gate.promise : json(200, {})));
    renderTerminal(<InstancesPage />, {
      workspace: {
        instances: [{ id: 'i-1', term: 'Spot', model: 'T4', count: 1, status: 'pending' }],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    expect(await screen.findByRole('button', { name: 'Refreshing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Find capacity' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Manage' })).toBeEnabled();
    await act(async () => gate.resolve(json(200, EMPTY_WORKSPACE)));
    expect(await screen.findByRole('button', { name: 'Refresh status' })).toBeEnabled();
  });

  it('renders cached configuration immediately, revalidates, and isolates accounts', async () => {
    let count = 0;
    const gate = Promise.withResolvers<Response>();
    mockFetch(() => (++count === 1 ? json(200, saved) : gate.promise));
    const queryClient = testQueryClient();
    const first = renderTerminal(<InstanceAutopilot id="rental-1" ended={false} />, {
      queryClient,
    });
    expect(await screen.findByDisplayValue('echo demo')).toBeInTheDocument();
    first.unmount();
    renderTerminal(<InstanceAutopilot id="rental-1" ended={false} />, { queryClient });
    expect(screen.getByDisplayValue('echo demo')).toBeInTheDocument();
    expect(await screen.findByText('Updating task status…')).toBeInTheDocument();
    act(() => signIn({ id: 'u2', email: 'other@example.com' }));
    expect(screen.queryByDisplayValue('echo demo')).toBeNull();
    expect(screen.getByText('Loading the autopilot…')).toBeInTheDocument();
    await act(async () => gate.resolve(json(200, { task: null, status: null, logTail: '' })));
  });

  it('disables duplicate saves, shows progress and closes the matching modal on success', async () => {
    const gate = Promise.withResolvers<Response>();
    mockFetch((_path, init) =>
      init?.method === 'POST' ? gate.promise : json(200, { task: null, status: null, logTail: '' }),
    );
    useWorkspaceStore.getState().openModal('instance-autopilot', { id: 'rental-1' });
    renderTerminal(<InstanceAutopilot id="rental-1" ended={false} />);
    fireEvent.change(await screen.findByPlaceholderText(/git clone/), {
      target: { value: 'echo demo' },
    });
    fireEvent.click(screen.getByLabelText('Keep the server running so I can investigate'));
    fireEvent.click(screen.getByRole('button', { name: 'Save autopilot' }));
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByText('Saving your autopilot changes…')).toBeInTheDocument();
    await act(async () => gate.resolve(json(200, saved)));
    await waitFor(() => expect(useWorkspaceStore.getState().modal).toBeNull());
  });
});
