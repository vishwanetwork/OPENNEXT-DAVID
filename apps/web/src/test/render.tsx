import type { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import type { BillingAccount, WorkspaceResponse } from '@opennext/contracts';
import { Providers } from '@/components/providers/providers';
import { OverlayProvider } from '@/features/console';
import { queryKeys } from '@/lib/api/query-keys';
import { useSessionStore } from '@/lib/session-store';
import type { AppKind } from '@/lib/apps';
import {
  EMPTY_SLOTS,
  EMPTY_WORKSPACE,
  TerminalProvider,
  TerminalSlotsProvider,
  accountIdentity,
  type TerminalSlots,
} from '@/terminal-kit';

/**
 * The one render helper for component tests: app + API + toast providers and optional terminal
 * providers with explicit slots. The `next/navigation` mock lives in `vitest.setup.ts` so it
 * applies to every suite regardless of import order.
 */

const ORIGINS = { site: '', terminal: '/terminal', admin: '/admin' };

export interface RenderWithProvidersOptions extends RenderOptions {
  app?: AppKind;
  base?: string;
  demo?: boolean;
  queryClient?: QueryClient;
}

export const testQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000 } } });

export function renderWithProviders(
  ui: ReactNode,
  {
    app = 'terminal',
    base,
    demo = false,
    queryClient,
    ...options
  }: RenderWithProvidersOptions = {},
) {
  const resolvedBase = base ?? (app === 'site' ? '' : `/${app}`);
  const client = queryClient ?? testQueryClient();
  const result = render(
    <Providers app={app} base={resolvedBase} demo={demo} origins={ORIGINS} queryClient={client}>
      {ui}
    </Providers>,
    options,
  );
  return { ...result, queryClient: client };
}

export interface RenderTerminalOptions extends RenderWithProvidersOptions {
  slots?: Partial<TerminalSlots>;
  /** Seeds the account workspace records for the signed-in session. */
  workspace?: Partial<WorkspaceResponse>;
  /** Seeds the confirmed billing account for the signed-in session. */
  billing?: Partial<BillingAccount>;
}

/** Seeds server records the way the backend would return them for the current session. */
export function seedAccount(
  client: QueryClient,
  {
    workspace,
    billing,
    demo = false,
  }: { workspace?: Partial<WorkspaceResponse>; billing?: Partial<BillingAccount>; demo?: boolean },
) {
  const user = useSessionStore.getState().user;
  const identity = accountIdentity(user, demo);
  if (workspace)
    client.setQueryData(queryKeys.account.workspace(identity), {
      ...EMPTY_WORKSPACE,
      ...workspace,
    });
  if (billing)
    client.setQueryData(queryKeys.account.billing(identity), {
      confirmed: true,
      accountId: user?.id ?? '',
      currency: 'USD',
      availableCredit: 0,
      paidCredit: 0,
      promotionalCredit: 0,
      requests: [],
      notifications: [],
      ...billing,
    });
}

/** Renders inside the terminal providers with the given slots (modals, bell, listing table…). */
export function renderTerminal(
  ui: ReactNode,
  { slots, workspace, billing, demo = false, queryClient, ...options }: RenderTerminalOptions = {},
) {
  const client = queryClient ?? testQueryClient();
  seedAccount(client, { workspace, billing, demo });
  return renderWithProviders(
    <TerminalProvider>
      <TerminalSlotsProvider slots={{ ...EMPTY_SLOTS, ...slots }}>{ui}</TerminalSlotsProvider>
    </TerminalProvider>,
    { app: 'terminal', demo, queryClient: client, ...options },
  );
}

/** Console pages render inside the console overlay provider on the admin path base. */
export function renderConsole(ui: ReactElement, options?: RenderOptions) {
  return renderWithProviders(<OverlayProvider>{ui}</OverlayProvider>, { app: 'admin', ...options });
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const jsonResponse = (body: unknown, status = 200) => json(status, body);

export function mockFetch(
  handler: (path: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

export function signIn(over: Record<string, unknown> = {}) {
  useSessionStore.getState().setUser({
    id: 'u1',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    role: 'buyer',
    onboardingCompleted: true,
    promotionalCredit: 100,
    promotionalCreditGranted: 100,
    promotionalCreditWithdrawable: false,
    csrfToken: 'csrf',
    ...over,
  });
}
