import { useEffect } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { json, mockFetch, renderTerminal, signIn } from '@/test/render';
import { initialWorkspace, useWorkspaceStore } from '@/terminal-kit';
import { Access } from './components/instance-dialogs';
import { instanceModals } from './components/instance-modals';
import { useInstanceLifecycleService } from './hooks';

const wire = (value: number[]) => [0, 0, 0, value.length, ...value];
const KEY =
  'ssh-ed25519 ' +
  btoa(
    String.fromCharCode(
      ...wire([...'ssh-ed25519'].map((c) => c.charCodeAt(0))),
      ...wire(Array.from({ length: 32 }, (_, i) => i + 1)),
    ),
  ) +
  ' laptop';
const instance = {
  id: 'rental-1',
  name: '1 × T4',
  model: 'T4',
  region: 'us-east-1',
  term: 'Spot',
  count: 1,
  rate: 0.29,
  status: 'active',
  serviceEnd: '2099-01-01T00:00:00Z',
};

beforeEach(() => {
  window.localStorage.clear();
  useWorkspaceStore.setState({ ...initialWorkspace() });
  signIn();
});

describe('Instance SSH keys', () => {
  it('adds a pasted key to the instance and shows when the server has it', async () => {
    const posts: unknown[] = [];
    let installed = false;
    mockFetch((path, init) => {
      if (path.includes('/api/marketplace/instances/rental-1/ssh-keys')) {
        if (init?.method === 'POST') posts.push(JSON.parse(String(init.body)));
        const keys = posts.length
          ? [{ publicKey: KEY, fingerprint: 'SHA256:abc', comment: 'laptop' }]
          : [];
        return json(200, { keys, version: posts.length + 1, installed });
      }
      return json(200, { keys: [] });
    });
    renderTerminal(<Access id="rental-1" isExample={false} />, {
      workspace: { instances: [instance] },
    });
    expect(await screen.findByText(/No keys are on this instance yet/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Paste your SSH public key'), {
      target: { value: KEY },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add to instance' }).at(-1)!);
    await waitFor(() => expect(posts).toEqual([{ keys: [KEY] }]));
    expect(await screen.findByText(/Installing the latest keys/)).toBeInTheDocument();
    expect(screen.getByText('SHA256:abc')).toBeInTheDocument();
    installed = true;
    expect(
      await screen.findByText('These keys are installed on the server.', {}, { timeout: 7000 }),
    ).toBeInTheDocument();
  }, 10000);

  it('keeps the provisioning note for instances without key management', async () => {
    mockFetch((path) =>
      path.includes('/ssh-keys')
        ? json(404, { error: 'This instance was not found.' })
        : json(200, { keys: [] }),
    );
    renderTerminal(<Access id="rental-1" isExample={false} />, {
      workspace: { instances: [instance] },
    });
    expect(
      await screen.findByText(/Instance-specific key installation is not connected yet/),
    ).toBeInTheDocument();
  });

  it('registers the SSH access dialog', () => {
    expect(Object.keys(instanceModals)).toContain('instance-access');
  });
});

describe('Instance END', () => {
  it('ends an instance through the backend', async () => {
    const calls: { path: string; body: unknown }[] = [];
    mockFetch((path, init) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      return json(200, { confirmed: true, instance: { ...instance, status: 'ended' } });
    });
    const seen: { service?: ReturnType<typeof useInstanceLifecycleService> } = {};
    function Probe() {
      const value = useInstanceLifecycleService();
      useEffect(() => {
        seen.service = value;
      });
      return null;
    }
    renderTerminal(<Probe />);
    let result: unknown;
    await act(async () => {
      result = await seen.service!.end({ instanceId: 'rental-1', confirmation: 'END' });
    });
    expect(calls[0]).toEqual({
      path: '/api/marketplace/instances/rental-1/end',
      body: { confirmation: 'END' },
    });
    expect((result as { instance: { status: string } }).instance.status).toBe('ended');
  });
});
