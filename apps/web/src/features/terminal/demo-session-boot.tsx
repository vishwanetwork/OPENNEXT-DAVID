'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { demoApi } from './api';
import { useApp } from '@/components/providers/app-context';
import { useApi } from '@/components/providers/api-context';
import { useSessionStore } from '@/lib/session-store';
import { useWorkspaceStore } from '@/terminal-kit';

type DemoState = 'loading' | 'ready' | 'error';

/**
 * Isolated guest workspace (`/demo/`): starts a sandbox session on mount and has no additional product chrome. Sandbox API routing is handled by the API client (`demo: true`).
 */
export function DemoSessionBoot() {
  const api = useApi();
  const { href } = useApp();
  const params = useSearchParams();
  const requestedRole = params.get('role');
  const role: 'buyer' | 'seller' = requestedRole === 'seller' ? 'seller' : 'buyer';
  const [localState, setState] = useState<DemoState>('loading');
  const [localFailure, setFailure] = useState('');
  const setUser = useSessionStore((s) => s.setUser);
  const sessionStatus = useSessionStore((s) => s.status);
  const applySession = useWorkspaceStore((s) => s.applySession);

  const expired = sessionStatus === 'expired';
  const state: DemoState = expired ? 'error' : localState;
  const failure = expired ? 'Your session expired. Please try again.' : localFailure;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let result = await demoApi.start(api, role);
        // Resuming a sandbox must not silently alter its role; an explicit role selection changes it.
        if (['buyer', 'seller'].includes(requestedRole || '') && result.user.role !== role) {
          useSessionStore.getState().setUser(result.user);
          result = await demoApi.switchRole(api, role);
        }
        if (cancelled) return;
        const demoUser = { ...result.user, demo: true };
        setUser(demoUser);
        applySession(demoUser);
        setState('ready');
      } catch (error) {
        if (cancelled) return;
        setState('error');
        setFailure(
          (error as Error).message === 'The request timed out.'
            ? 'The workspace timed out. Please try again.'
            : 'The workspace is temporarily unavailable. Please try again.',
        );
        setUser(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  if (state === 'ready') return null;
  return (
    <div className="buyer-session-status" role="status" aria-label="Session status">
      <p>{state === 'loading' ? 'Loading workspace…' : failure}</p>
      {state === 'error' ? <a href={href('/market')}>Try again</a> : null}
    </div>
  );
}
