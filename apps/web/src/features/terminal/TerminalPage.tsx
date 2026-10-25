'use client';

import type { ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { SessionUser } from '@opennext/contracts';
import { useApp } from '@/components/providers/app-context';
import { useSessionStore } from '@/lib/session-store';
import { AuthView, OnboardingView } from '@/features/auth';
import { defaultRoute, useInitialUser, useTerminal, useWorkspaceStore } from '@/terminal-kit';

/**
 * Gate for every terminal page: anonymous visitors see the sign-in view, verified accounts
 * without a completed workspace see onboarding, everyone else sees the page. The URL keeps
 * the requested route so it resumes after sign-in (legacy `S.pending`).
 */
export function TerminalPage({ children }: { children: ReactNode }) {
  const storeStatus = useSessionStore((s) => s.status);
  const storeUser = useSessionStore((s) => s.user);
  const initialUser = useInitialUser();
  // Server-rendered pages already know the session; the client store confirms it after boot.
  const seeded = storeStatus === 'booting' && initialUser !== undefined;
  const status = seeded ? (initialUser ? 'verified' : 'anonymous') : storeStatus;
  const user = seeded ? initialUser : storeUser;
  const { route, go } = useTerminal();
  const { crossHref, demo } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const pending = useWorkspaceStore((s) => s.pending);
  const applySession = useWorkspaceStore((s) => s.applySession);

  const back = () => {
    useWorkspaceStore.getState().patch({ pending: null, pendingListing: null });
    window.location.href = crossHref('site', '/');
  };
  const verifiedLogin = (next: SessionUser) => {
    applySession(next);
    if (next.onboardingCompleted) {
      const target = pending || route || defaultRoute(useWorkspaceStore.getState().role);
      go(target);
    }
  };

  if (status === 'booting') return <main className="terminal preview-terminal" aria-busy="true" />;
  if (!user) {
    if (demo) return <main className="terminal preview-terminal" aria-busy="true" />;
    const requestedMode = params.get('auth') === 'signup' ? 'signup' : 'signin';
    return (
      <AuthView
        initialMode={requestedMode}
        onLogin={verifiedLogin}
        onBack={back}
        onMode={(mode) => router.replace(mode === 'signup' ? '?auth=signup' : '?')}
      />
    );
  }
  if (!user.onboardingCompleted)
    return <OnboardingView user={user} onComplete={verifiedLogin} onBack={back} />;
  return <>{children}</>;
}
