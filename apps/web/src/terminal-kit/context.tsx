'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import type { SessionUser } from '@opennext/contracts';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from '@/components/providers/app-context';
import { useSessionStore } from '@/lib/session-store';
import { useToast } from '@/components/ui/toast';
import type { ModalArgs, ModalType } from './modal';
import { resolveTarget, routeFromPath, type TerminalRoute } from './routing';
import { useWorkspaceStore } from './store';

export interface TerminalApi {
  /** Legacy `go()`: applies the role rules, remembers a pending route when signed out, navigates. */
  go: (route: string) => void;
  /** Current route derived from the pathname ('' on the terminal root). */
  route: TerminalRoute | '';
  openModal: <K extends ModalType>(type: K, ...args: ModalArgs<K>) => void;
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
      openModal: (type, ...args) => useWorkspaceStore.getState().openModal(type, ...args),
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
