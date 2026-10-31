import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { jsonResponse, renderTerminal, signIn } from '@/test/render';
import { useSessionStore } from '@/lib/session-store';
import { initialWorkspace, useWorkspaceStore } from '@/terminal-kit';
import { DemoSessionBoot } from './demo-session-boot';
import { TerminalHeader } from './components/terminal-header';

beforeEach(() => {
  useSessionStore.setState({ status: 'booting', user: null });
  useWorkspaceStore.setState(initialWorkspace());
});

describe('Isolated workspace without demo chrome', () => {
  it('still obtains the server session and preserves its isolation flag', async () => {
    signIn({ id: 'demo-u1', name: 'Demo Guest', demo: true });
    const user = useSessionStore.getState().user;
    useSessionStore.setState({ status: 'booting', user: null });
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({ user }));
    vi.stubGlobal('fetch', fetcher);
    const { container } = renderTerminal(<DemoSessionBoot />, {
      demo: true,
      base: '/terminal/demo',
    });
    await waitFor(() => expect(useSessionStore.getState().user?.id).toBe('demo-u1'));
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('/api/demo/start');
    expect(useSessionStore.getState().user?.demo).toBe(true);
    expect(useWorkspaceStore.getState().identity.id).toBe('demo-u1');
    await waitFor(() => expect(container.querySelector('.buyer-session-status')).toBeNull());
    expect(screen.queryByText(/Exit Demo|test data|Demo controls/)).toBeNull();
  });

  it('keeps failed session startup recoverable without a demo toolbar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Unavailable');
      }),
    );
    renderTerminal(<DemoSessionBoot />, { demo: true, base: '/terminal/demo' });
    expect(await screen.findByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/terminal/demo/market',
    );
    expect(screen.getByRole('status', { name: 'Session status' })).toHaveTextContent(
      'workspace is temporarily unavailable',
    );
    expect(useSessionStore.getState().user).toBeNull();
  });

  it('uses neutral account chrome without replacing the server identity', () => {
    signIn({ name: 'Demo Guest', demo: true });
    useWorkspaceStore.getState().applySession(useSessionStore.getState().user);
    renderTerminal(<TerminalHeader onSignOut={() => {}} onRole={() => {}} onContact={() => {}} />, {
      demo: true,
    });
    expect(screen.getByRole('button', { name: 'User menu' })).toHaveTextContent('My account');
    expect(screen.queryByText('Demo Guest')).toBeNull();
    expect(useSessionStore.getState().user?.name).toBe('Demo Guest');
  });
});
