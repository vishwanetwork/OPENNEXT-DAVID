import { render, type RenderOptions } from '@testing-library/react';
import { vi } from 'vitest';
import type { ReactElement } from 'react';
import { Providers } from '@/components/providers/providers';
import { OverlayProvider } from './components/overlay';

/** Renders console UI inside the app providers with a mocked fetch. */
export function renderConsole(ui: ReactElement, options?: RenderOptions) {
  return render(
    <Providers
      app="admin"
      base="/admin"
      demo={false}
      origins={{ site: '', terminal: '/terminal', admin: '/admin' }}
    >
      <OverlayProvider>{ui}</OverlayProvider>
    </Providers>,
    options,
  );
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function mockFetch(
  handler: (path: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin',
}));
