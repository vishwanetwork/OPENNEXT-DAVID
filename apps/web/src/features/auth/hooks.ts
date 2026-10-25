'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type { SessionUser } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { ApiError } from '@/lib/api/client';
import { useSessionStore } from '@/lib/session-store';
import { authApi } from './api';
import { allowedRole, roleIntentKey, RoleIntentStore } from './role-intent';

let roleIntentSingleton: RoleIntentStore | null = null;

function roleIntentFor(pathname: string, queryRole: string | null): RoleIntentStore {
  if (!roleIntentSingleton) {
    const storage = typeof window === 'undefined' ? null : window.sessionStorage;
    roleIntentSingleton = new RoleIntentStore(roleIntentKey(pathname), allowedRole(queryRole), storage);
  }
  return roleIntentSingleton;
}

/** Role preference carried from public CTAs; one instance per page (sessionStorage-backed). */
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
