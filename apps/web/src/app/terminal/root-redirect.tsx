'use client';

import { useEffect } from 'react';
import { useSessionStore } from '@/lib/session-store';
import { defaultRoute, useTerminal, useWorkspaceStore } from '@/terminal-kit';

/** Terminal root: Buyer → market, Seller → supply (legacy terminal-host default). */
export function RootRedirect() {
  const { go } = useTerminal();
  const role = useWorkspaceStore((s) => s.role);
  const user = useSessionStore((s) => s.user);
  useEffect(() => {
    if (user?.onboardingCompleted) go(defaultRoute(role));
  }, [go, role, user?.onboardingCompleted]);
  return null;
}
