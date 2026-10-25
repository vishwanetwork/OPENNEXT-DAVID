'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Offer } from '@/features/market';
import type { ModalComponents } from './modal';
import type { TerminalServices } from './services';
import type { Intent } from './types';

/**
 * Explicit composition of the terminal: the composition root (src/app/terminal) decides which
 * feature renders the header bell, the market listing table, the matches panels, the SSH key
 * library and every modal, and which feature handles contact / opportunity requests.
 * Features read these through `useTerminalSlots()`; nothing registers itself at import time.
 */
export interface TerminalSlots {
  headerBell?: ReactNode;
  listingTable?: (offers: Offer[]) => ReactNode;
  matchesPanel?: (kind: 'best' | 'recent') => ReactNode;
  sshLibrary?: (scope: 'instances' | 'instance-access') => ReactNode;
  modals: ModalComponents;
  openContact: (options?: { message?: string }) => void;
  openOpportunity: (id: string, intent: Intent) => void;
  services: TerminalServices;
}

export const EMPTY_SLOTS: TerminalSlots = {
  modals: {},
  openContact: () => {},
  openOpportunity: () => {},
  services: {},
};

const SlotsContext = createContext<TerminalSlots>(EMPTY_SLOTS);

export function TerminalSlotsProvider({
  slots,
  children,
}: {
  slots: TerminalSlots;
  children: ReactNode;
}) {
  return <SlotsContext.Provider value={slots}>{children}</SlotsContext.Provider>;
}

export const useTerminalSlots = (): TerminalSlots => useContext(SlotsContext);
