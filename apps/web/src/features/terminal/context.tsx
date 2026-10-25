'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import type { SessionUser } from '@opennext/contracts';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from '@/components/providers/app-context';
import { useSessionStore } from '@/lib/session-store';
import { useToast } from '@/components/ui/toast';
import { resolveTarget, routeFromPath, type TerminalRoute } from './routing';
import { useWorkspaceStore, type Record_ } from './store';

export interface TerminalApi {
  /** Legacy `go()`: applies the role rules, remembers a pending route when signed out, navigates. */
  go: (route: string) => void;
  /** Current route derived from the pathname ('' on the terminal root). */
  route: TerminalRoute | '';
  openModal: (type: string, extra?: Record_) => void;
  closeModal: () => void;
  toast: (message: string) => void;
  /** Navigate to the public site (legacy "home"). */
  home: () => void;
}

const TerminalContext = createContext<TerminalApi | null>(null);
const InitialUserContext = createContext<SessionUser | null | undefined>(undefined);
export const useInitialUser = () => useContext(InitialUserContext);

export function TerminalProvider({
  children,
  initialUser,
}: {
  children: ReactNode;
  initialUser?: SessionUser | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { href, base, crossHref } = useApp();
  const toast = useToast();
  const route = routeFromPath(pathname, base);
  const go = useCallback(
    (requested: string) => {
      const user = useSessionStore.getState().user;
      const state = useWorkspaceStore.getState();
      const target = resolveTarget(requested, state.role, Boolean(user?.onboardingCompleted));
      const patch: Parameters<typeof state.patch>[0] = {
        menu: null,
        userOpen: false,
        modal: null,
        query: '',
        selected: [],
        tab: 'all',
      };
      if (!user || !user.onboardingCompleted) patch.pending = target;
      else {
        patch.pending = null;
        if (target === 'market' || target === 'models') patch.marketRoute = target;
      }
      state.patch(patch);
      router.push(href('/' + target));
    },
    [router, href],
  );
  const value = useMemo<TerminalApi>(
    () => ({
      go,
      route,
      openModal: (type, extra) => useWorkspaceStore.getState().openModal(type, extra),
      closeModal: () => useWorkspaceStore.getState().closeModal(),
      toast,
      home: () => {
        window.location.href = crossHref('site', '/');
      },
    }),
    [go, route, toast, crossHref],
  );
  return (
    <InitialUserContext.Provider value={initialUser}>
      <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>
    </InitialUserContext.Provider>
  );
}

export function useTerminal(): TerminalApi {
  const value = useContext(TerminalContext);
  if (!value) throw new Error('useTerminal must be used inside the terminal layout.');
  return value;
}

export const useGo = () => useTerminal().go;
export const useOpenModal = () => useTerminal().openModal;
export const useCloseModal = () => useTerminal().closeModal;

/**
 * Workspace refresh registry. The shell runs every registered refresher after sign-in,
 * every 30 s while the tab is visible, and on explicit `refreshWorkspace()` calls — the
 * replacement for the legacy `OpenNEXTExchange.refresh(S)` loop. Feature modules
 * (marketplace, billing, instances…) register their own loaders.
 */
export type WorkspaceRefresher = () => Promise<void> | void;
const refreshers = new Set<WorkspaceRefresher>();
export function registerWorkspaceRefresher(fn: WorkspaceRefresher): () => void {
  refreshers.add(fn);
  return () => refreshers.delete(fn);
}
export async function refreshWorkspace(): Promise<void> {
  await Promise.all([...refreshers].map((fn) => Promise.resolve().then(fn)));
}

/**
 * Hook point for resuming public-site intents (listing `?listing=&intent=` and
 * `?opportunity=&intent=`) once the workspace is authoritative. The procurement feature
 * registers a handler; until then the pending intent stays in the store untouched.
 */
export type IntentResumer = (intent: {
  kind: 'listing' | 'opportunity';
  id: string;
  intent: 'buy' | 'offer';
}) => boolean | void;
let intentResumer: IntentResumer | null = null;
export function registerIntentResumer(fn: IntentResumer | null) {
  intentResumer = fn;
}
export function resumePendingIntents() {
  const state = useWorkspaceStore.getState();
  if (!intentResumer) return;
  if (state.pendingListing) {
    const handled = intentResumer({ kind: 'listing', ...state.pendingListing });
    if (handled !== false) state.patch({ pendingListing: null });
  }
  if (state.pendingOpportunity && state.marketplaceAuthoritative) {
    const handled = intentResumer({ kind: 'opportunity', ...state.pendingOpportunity });
    if (handled !== false) state.patch({ pendingOpportunity: null });
  }
}
