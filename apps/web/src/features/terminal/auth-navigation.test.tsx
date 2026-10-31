import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { SessionUser } from '@opennext/contracts';
import { useLogout } from '@/features/auth';
import { useSessionStore } from '@/lib/session-store';
import { initialWorkspace, useWorkspaceStore } from '@/terminal-kit';
import { jsonResponse, mockFetch, renderTerminal } from '@/test/render';
import { TerminalPage } from './terminal-page';

const navigation = vi.hoisted(() => ({
  pathname: '/terminal/market',
  search: 'role=buyer',
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

const BUYER: SessionUser = {
  id: 'buyer-auth-test',
  name: 'Buyer',
  email: 'buyer@example.com',
  role: 'buyer',
  onboardingCompleted: true,
  promotionalCredit: 0,
  promotionalCreditGranted: 0,
  promotionalCreditWithdrawable: false,
  csrfToken: 'verified-csrf',
};

function BuyerWorkspace() {
  const logout = useLogout();
  return (
    <TerminalPage>
      <h1>Buyer workspace</h1>
      <button type="button" onClick={() => void logout()}>
        End session
      </button>
    </TerminalPage>
  );
}

async function submitEmailAndCode() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), {
    target: { value: BUYER.email },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send verification code' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Verification code' }), {
    target: { value: '123456' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
}

beforeEach(() => {
  navigation.pathname = '/terminal/market';
  navigation.search = 'role=buyer';
  navigation.push.mockClear();
  navigation.replace.mockClear();
  useSessionStore.getState().setUser(null);
  useWorkspaceStore.setState(initialWorkspace());
});

describe('Buyer sign-in navigation', () => {
  it('preserves the Buyer and listing intent while switching auth modes', () => {
    navigation.search = 'role=buyer&listing=offer-1&intent=buy';
    renderTerminal(<BuyerWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(navigation.replace).toHaveBeenLastCalledWith(
      '?role=buyer&listing=offer-1&intent=buy&auth=signup',
    );
    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ }));
    expect(navigation.replace).toHaveBeenLastCalledWith('?role=buyer&listing=offer-1&intent=buy');
    expect(screen.queryByRole('heading', { name: 'Buyer workspace' })).not.toBeInTheDocument();
  });

  it('uses the verified account and resumes the requested Buyer route after email sign-in', async () => {
    navigation.search = 'role=buyer&next=https%3A%2F%2Funtrusted.example';
    const request = mockFetch((path) => {
      if (path === '/api/auth/email/request') return jsonResponse({ challengeId: 'challenge-1' });
      if (path === '/api/auth/email/verify') return jsonResponse({ user: BUYER });
      return jsonResponse({ error: 'Unexpected endpoint' }, 404);
    });
    renderTerminal(<BuyerWorkspace />);
    await submitEmailAndCode();
    expect(await screen.findByRole('heading', { name: 'Buyer workspace' })).toBeInTheDocument();
    expect(useSessionStore.getState().user).toEqual(BUYER);
    expect(navigation.push).toHaveBeenLastCalledWith('/terminal/market');
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/api/auth/email/request',
      '/api/auth/email/verify',
    ]);
  });

  it('keeps the sign-in gate closed when verification does not confirm a session', async () => {
    mockFetch((path) =>
      jsonResponse(
        path === '/api/auth/email/request' ? { challengeId: 'challenge-1' } : { user: null },
      ),
    );
    renderTerminal(<BuyerWorkspace />);
    await submitEmailAndCode();
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in was not confirmed.');
    expect(useSessionStore.getState().user).toBeNull();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Buyer workspace' })).not.toBeInTheDocument();
  });

  it('requires server-confirmed Buyer onboarding before showing the workspace', async () => {
    mockFetch((path) => {
      if (path === '/api/auth/email/request') return jsonResponse({ challengeId: 'challenge-1' });
      if (path === '/api/auth/email/verify')
        return jsonResponse({ user: { ...BUYER, onboardingCompleted: false } });
      if (path === '/api/auth/onboarding') return jsonResponse({ user: BUYER });
      return jsonResponse({ error: 'Unexpected endpoint' }, 404);
    });
    renderTerminal(<BuyerWorkspace />);
    await submitEmailAndCode();
    expect(await screen.findByRole('group', { name: 'Choose your role' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Buyer workspace' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Buyer/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { name: 'Buyer workspace' })).toBeInTheDocument();
    expect(useSessionStore.getState().user?.onboardingCompleted).toBe(true);
  });

  it('shows an existing verified session directly and returns to sign-in after logout', async () => {
    useSessionStore.getState().setUser(BUYER);
    const request = mockFetch(() => jsonResponse({ ok: true }));
    renderTerminal(<BuyerWorkspace />);
    expect(screen.getByRole('heading', { name: 'Buyer workspace' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome back.' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    await waitFor(() => expect(useSessionStore.getState().status).toBe('anonymous'));
    expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'verified-csrf' }),
      }),
    );
  });
});
