'use client';

import { createContext, useCallback, useContext, type ReactNode } from 'react';
import type { CuratedRfq } from '@opennext/contracts';
import { useApp } from '@/components/providers/app-context';
import {
  allowedRole,
  implicitRole,
  readRoleIntent,
  targetRoute,
  workspacePath,
  writeRoleIntent,
  type ListingIntent,
  type PublicRole,
  type PublicTarget,
} from '../lib/workspace-links';

export type InfoKind = 'privacy' | 'terms' | 'usage' | 'regions' | 'service' | 'contact';

export interface OpenWorkspaceOptions {
  target?: PublicTarget;
  preferredRole?: PublicRole | '';
  /** Explicit terminal route (used by listing intents, which bypass the target mapping). */
  route?: string;
  listing?: { id: string; intent: ListingIntent };
  opportunity?: { id: string; intent: ListingIntent };
}

export interface SiteActions {
  /** Navigate into the Capacity Terminal carrying the legacy role / listing / opportunity hints. */
  openWorkspace: (options?: OpenWorkspaceOptions) => void;
  openContact: (options?: { message?: string }) => void;
  openInfo: (kind: InfoKind) => void;
  showCuratedDetails: (item: CuratedRfq) => void;
  offerCurated: (item: CuratedRfq) => void;
}

const SiteActionsContext = createContext<SiteActions | null>(null);

export function SiteActionsProvider({ value, children }: { value: SiteActions; children: ReactNode }) {
  return <SiteActionsContext.Provider value={value}>{children}</SiteActionsContext.Provider>;
}

export function useSiteActions(): SiteActions {
  const value = useContext(SiteActionsContext);
  if (!value) throw new Error('useSiteActions must be used inside the landing page.');
  return value;
}

/**
 * Builds the terminal URL exactly like the legacy `openPublicWorkspace` + `go()` pair: a CTA
 * role becomes an onboarding hint stored for the session; the URL carries the effective role.
 */
export function useWorkspaceNavigation() {
  const { crossHref } = useApp();
  return useCallback(
    (options: OpenWorkspaceOptions = {}) => {
      const storage = typeof window === 'undefined' ? undefined : window.sessionStorage;
      const queryRole = allowedRole(new URLSearchParams(window.location.search).get('role'));
      const hinted = allowedRole(options.preferredRole) || implicitRole(options.target);
      if (hinted) writeRoleIntent(storage, hinted, queryRole);
      const stored = readRoleIntent(storage);
      const role: PublicRole | '' = hinted || stored?.role || queryRole || 'buyer';
      const route = options.route || targetRoute(options.target);
      const href = crossHref(
        'terminal',
        workspacePath({ route, role, listing: options.listing, opportunity: options.opportunity }),
      );
      window.scrollTo(0, 0);
      window.location.assign(href);
    },
    [crossHref],
  );
}
