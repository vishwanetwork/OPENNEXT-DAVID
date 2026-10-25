import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { Providers } from '@/components/providers/providers';
import { TerminalProvider } from '@/features/terminal/context';
import { useSessionStore } from '@/lib/session-store';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/terminal/market',
  useSearchParams: () => new URLSearchParams(),
}));

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Renders inside the app, API, toast and terminal providers with the local path base. */
export function renderTerminal(ui: ReactNode, { demo = false }: { demo?: boolean } = {}) {
  return render(
    <Providers app="terminal" base="/terminal" demo={demo} origins={{ site: '', terminal: '/terminal', admin: '/admin' }}>
      <TerminalProvider>{ui}</TerminalProvider>
    </Providers>,
  );
}

export function signIn(over: Record<string, unknown> = {}) {
  useSessionStore.getState().setUser({ id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace', role: 'buyer', onboardingCompleted: true, promotionalCredit: 100, promotionalCreditGranted: 100, promotionalCreditWithdrawable: false, csrfToken: 'csrf', ...over });
}
