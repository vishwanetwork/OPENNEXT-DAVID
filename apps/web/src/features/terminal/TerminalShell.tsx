'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { SessionUser } from '@opennext/contracts';
import { useSearchParams } from 'next/navigation';
import { useApp } from '@/components/providers/app-context';
import { useToast } from '@/components/ui/toast';
import { useSessionStore } from '@/lib/session-store';
import { CATALOG } from '@/features/market/catalog';
import { useLogout, useRoleIntent, useSessionBoot, useSwitchRole } from '@/features/auth';
import { refreshWorkspace, resumePendingIntents, TerminalProvider, useTerminal } from './context';
import { AgentHintProvider } from './components/AgentDrawer';
import { TerminalHeader } from './components/TerminalHeader';
import { openContact } from './components/TerminalModal';
import { TerminalOverlays } from './components/TerminalOverlays';
import { DemoToolbar } from './DemoToolbar';
import { LegacyHashRedirect } from './LegacyHashRedirect';
import { useWorkspaceStore } from './store';
import './terminal.css';
import './preview-shell.css';

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
    if (params.get('listing') && (listingIntent === 'buy' || listingIntent === 'offer')) next.pendingListing = { id: params.get('listing')!, intent: listingIntent };
    if (params.get('opportunity') && (listingIntent === 'buy' || listingIntent === 'offer')) next.pendingOpportunity = { id: params.get('opportunity')!, intent: listingIntent };
    const preferred = intent.preferred(useSessionStore.getState().user);
    if (preferred && !useSessionStore.getState().user?.onboardingCompleted) next.role = preferred === 'seller' ? 'Seller' : 'Buyer';
    patch(next);
    // Boot-time only: later query changes are handled by the pages themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function SessionSync({ initialUser }: { initialUser?: SessionUser | null }) {
  const { demo } = useApp();
  // Seed the store from the server-rendered session before the client boot confirms it.
  useState(() => {
    if (initialUser !== undefined && !demo && typeof window !== 'undefined' && useSessionStore.getState().status === 'booting') useSessionStore.getState().setUser(initialUser);
    return true;
  });
  const status = useSessionBoot(!demo);
  const user = useSessionStore((s) => s.user);
  const applySession = useWorkspaceStore((s) => s.applySession);
  useEffect(() => {
    if (status === 'booting') return;
    applySession(user);
  }, [status, user, applySession]);
  // Workspace refresh loop: after sign-in, every 30 s while visible.
  useEffect(() => {
    if (!user?.onboardingCompleted) return;
    let active = true;
    const run = () => {
      if (!active || document.hidden) return;
      refreshWorkspace()
        .then(() => active && resumePendingIntents())
        .catch(() => {});
    };
    run();
    const timer = setInterval(run, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user?.id, user?.onboardingCompleted, user?.role]);
  return null;
}

function Chrome({ children }: { children: ReactNode }) {
  const user = useSessionStore((s) => s.user);
  const { go } = useTerminal();
  const toast = useToast();
  const logout = useLogout();
  const switchRole = useSwitchRole();
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
  const role = (value: 'Buyer' | 'Seller') => {
    switchRole(value.toLowerCase() as 'buyer' | 'seller')
      .then((next) => {
        applySession(next);
        void refreshWorkspace();
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

/** Client shell mounted by the terminal layout: session boot, preferences, header, overlays, demo. */
export function TerminalShell({ children, initialUser }: { children: ReactNode; initialUser?: SessionUser | null }) {
  const { demo } = useApp();
  return (
    <TerminalProvider initialUser={initialUser}>
      <AgentHintProvider>
        <LegacyHashRedirect />
        <BootQuery />
        <SessionSync initialUser={initialUser} />
        <Chrome>{children}</Chrome>
        {demo ? <DemoToolbar /> : null}
      </AgentHintProvider>
    </TerminalProvider>
  );
}
