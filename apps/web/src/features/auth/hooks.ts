'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type { SessionUser } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { ApiError } from '@/lib/api/client';
import { create } from 'zustand';
import { useSessionStore } from '@/lib/session-store';
import { authApi } from './api';
import { allowedRole, roleIntentKey, RoleIntentStore } from './role-intent';
import { useRegistrationIntent } from './registration-intent';

/**
 * One `RoleIntentStore` per (storage key, URL hint) shared by every component on the page.
 * A new pathname scope or `?role=` hint creates a new instance; tests reset the map.
 */
export const useRoleIntentStores = create<{ map: Record<string, RoleIntentStore> }>(() => ({
  map: {},
}));

function roleIntentFor(pathname: string, queryRole: string | null): RoleIntentStore {
  const key = roleIntentKey(pathname);
  const hint = allowedRole(queryRole);
  const id = key + '|' + hint;
  const existing = useRoleIntentStores.getState().map[id];
  if (existing) return existing;
  const storage = typeof window === 'undefined' ? null : window.sessionStorage;
  const store = new RoleIntentStore(key, hint, storage);
  useRoleIntentStores.setState((s) => ({ map: { ...s.map, [id]: store } }));
  return store;
}

/** Role preference carried from public CTAs (sessionStorage-backed), keyed by page scope and hint. */
export function useRoleIntent(): RoleIntentStore {
  const pathname = usePathname();
  const params = useSearchParams();
  const queryRole = params.get('role');
  return useMemo(() => roleIntentFor(pathname, queryRole), [pathname, queryRole]);
}

/** Loads the verified session once (`GET /api/auth/session`) into the session store. */
export function useSessionBoot(enabled = true) {
  const api = useApi();
  const status = useSessionStore((s) => s.status);
  const setUser = useSessionStore((s) => s.setUser);
  const intent = useRoleIntent();
  useEffect(() => {
    if (!enabled || status !== 'booting') return;
    let cancelled = false;
    authApi
      .session(api)
      .then((user) => {
        if (cancelled) return;
        intent.bind(user);
        setUser(user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, [api, enabled, status, setUser, intent]);
  return status;
}

export function useRefreshSession() {
  const api = useApi();
  const setUser = useSessionStore((s) => s.setUser);
  const intent = useRoleIntent();
  return useCallback(async () => {
    const user = await authApi.session(api);
    intent.bind(user);
    setUser(user);
    return user;
  }, [api, setUser, intent]);
}

export function useLogout() {
  const api = useApi();
  const setUser = useSessionStore((s) => s.setUser);
  const intent = useRoleIntent();
  return useCallback(async () => {
    try {
      await authApi.logout(api);
    } catch (reason) {
      if (!(reason instanceof ApiError) || reason.status !== 401) throw reason;
    }
    intent.clear();
    useRegistrationIntent.getState().clear();
    setUser(null);
  }, [api, setUser, intent]);
}

export function useSwitchRole() {
  const api = useApi();
  const setUser = useSessionStore((s) => s.setUser);
  const intent = useRoleIntent();
  return useCallback(
    async (role: 'buyer' | 'seller'): Promise<SessionUser | null> => {
      const user = await authApi.switchRole(api, role);
      intent.bind(user);
      setUser(user);
      return user;
    },
    [api, setUser, intent],
  );
}
