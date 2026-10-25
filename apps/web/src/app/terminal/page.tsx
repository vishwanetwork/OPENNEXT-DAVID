'use client';

import { useEffect } from 'react';
import { useSessionStore } from '@/lib/session-store';
import { TerminalPage } from '@/features/terminal/TerminalPage';
import { useTerminal } from '@/features/terminal/context';
import { defaultRoute } from '@/features/terminal/routing';
import { useWorkspaceStore } from '@/features/terminal/store';

function Redirect() {
  const { go } = useTerminal();
  const role = useWorkspaceStore((s) => s.role);
  const user = useSessionStore((s) => s.user);
  useEffect(() => {
    if (user?.onboardingCompleted) go(defaultRoute(role));
  }, [go, role, user?.onboardingCompleted]);
  return null;
}

/** Terminal root: Buyer → market, Seller → supply (legacy terminal-host default). */
export default function TerminalRootPage() {
  return (
    <TerminalPage>
      <Redirect />
    </TerminalPage>
  );
}
