'use client';

import { useEffect, type ComponentType, type ReactNode } from 'react';
import type { SessionUser } from '@opennext/contracts';
import { useSearchParams } from 'next/navigation';
import { useApp } from '@/components/providers/app-context';
import { useToast } from '@/components/ui/toast';
import { useSessionStore } from '@/lib/session-store';
import { CATALOG } from '@/features/market';
import { useLogout, useRoleIntent, useSessionBoot, useSwitchRole } from '@/features/auth';
import {
  TerminalProvider,
  TerminalSlotsProvider,
  useInvalidateWorkspace,
  useTerminal,
  useTerminalSlots,
  useWorkspaceStore,
  type Role,
  type TerminalSlots,
} from '@/terminal-kit';
import { AgentHintProvider } from './components/AgentDrawer';
import { TerminalHeader } from './components/TerminalHeader';
import { TerminalOverlays } from './components/TerminalOverlays';
import { DemoToolbar } from './DemoToolbar';
import { LegacyHashRedirect } from './LegacyHashRedirect';
import './terminal.css';
import './preview-shell.css';

/** Boot-time query handling: `?gpu=&count=&role=&listing=&intent=&opportunity=`. */
function BootQuery() {
  const params = useSearchParams();
  const patch = useWorkspaceStore((s) => s.patch);
  const hydrate = useWorkspaceStore((s) => s.hydratePreferences);
  const intent = useRoleIntent();
  useEffect(() => {
    hydrate();
    const next: Parameters<typeof patch>[0] = {};
    const gpu = params.get('gpu');
    if (gpu && CATALOG.some((m) => m.name === gpu)) next.model = gpu;
    const count = Number(params.get('count'));
    if (params.has('count') && [1, 2, 4, 8, 16].includes(count)) next.count = count;
    const listingIntent = params.get('intent');
    if (params.get('listing') && (listingIntent === 'buy' || listingIntent === 'offer'))
      next.pendingListing = { id: params.get('listing')!, intent: listingIntent };
    if (params.get('opportunity') && (listingIntent === 'buy' || listingIntent === 'offer'))
      next.pendingOpportunity = { id: params.get('opportunity')!, intent: listingIntent };
    const preferred = intent.preferred(useSessionStore.getState().user);
    if (preferred && !useSessionStore.getState().user?.onboardingCompleted)
      next.role = preferred === 'seller' ? 'seller' : 'buyer';
    patch(next);
    // Boot-time only: later query changes are handled by the pages themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Seeds the session from the server render, confirms it on the client, mirrors it into the UI store. */
function SessionSync({ initialUser }: { initialUser?: SessionUser | null }) {
  const { demo } = useApp();
  useEffect(() => {
    if (initialUser !== undefined && !demo && useSessionStore.getState().status === 'booting')
      useSessionStore.getState().setUser(initialUser);
  }, [initialUser, demo]);
  const status = useSessionBoot(!demo);
  const user = useSessionStore((s) => s.user);
  const applySession = useWorkspaceStore((s) => s.applySession);
  useEffect(() => {
    if (status === 'booting') return;
    applySession(user);
  }, [status, user, applySession]);
  return null;
}

function Chrome({ children }: { children: ReactNode }) {
  const user = useSessionStore((s) => s.user);
  const { go } = useTerminal();
  const { openContact } = useTerminalSlots();
  const toast = useToast();
  const logout = useLogout();
  const switchRole = useSwitchRole();
  const invalidate = useInvalidateWorkspace();
  const { crossHref } = useApp();
  const applySession = useWorkspaceStore((s) => s.applySession);
  const signOut = () => {
    logout()
      .then(() => {
        applySession(null);
        window.location.href = crossHref('site', '/');
      })
      .catch((e: Error) => toast(e.message));
  };
  const role = (value: Role) => {
    switchRole(value)
      .then((next) => {
        applySession(next);
        void invalidate();
        go('market');
      })
      .catch((e: Error) => toast(e.message));
  };
  const ready = Boolean(user?.onboardingCompleted);
  return (
    <>
      {ready ? (
        <main className="terminal preview-terminal">
          <section className="terminal-main">
            <TerminalHeader onSignOut={signOut} onRole={role} onContact={() => openContact()} />
            {children}
          </section>
        </main>
      ) : (
        children
      )}
      {ready ? <TerminalOverlays /> : null}
    </>
  );
}

function SlotsBoundary({
  useSlots,
  children,
}: {
  useSlots: () => TerminalSlots;
  children: ReactNode;
}) {
  const slots = useSlots();
  return <TerminalSlotsProvider slots={slots}>{children}</TerminalSlotsProvider>;
}

export interface TerminalShellProps {
  children: ReactNode;
  initialUser?: SessionUser | null;
  /** Hook evaluated inside the terminal providers that assembles the feature slots. */
  useSlots: () => TerminalSlots;
  /** Headless feature components (pollers, intent resumers) mounted beside the chrome. */
  integrations?: ReactNode;
  /** Feature context providers that must wrap the chrome and the modals (e.g. Spot checkout). */
  providers?: ComponentType<{ children: ReactNode }>;
}

/**
 * Client shell mounted by the terminal layout: session boot, preferences, header, overlays,
 * demo toolbar. Which features fill the slots is decided by the composition root.
 */
export function TerminalShell({
  children,
  initialUser,
  useSlots,
  integrations,
  providers: Providers = Passthrough,
}: TerminalShellProps) {
  const { demo } = useApp();
  return (
    <TerminalProvider initialUser={initialUser}>
      <SlotsBoundary useSlots={useSlots}>
        <Providers>
          <AgentHintProvider>
            <LegacyHashRedirect />
            <BootQuery />
            <SessionSync initialUser={initialUser} />
            {integrations}
            <Chrome>{children}</Chrome>
            {demo ? <DemoToolbar /> : null}
          </AgentHintProvider>
        </Providers>
      </SlotsBoundary>
    </TerminalProvider>
  );
}

const Passthrough = ({ children }: { children: ReactNode }) => <>{children}</>;
