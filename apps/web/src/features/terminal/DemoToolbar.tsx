'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DemoSessionResponse } from '@opennext/contracts';
import { useApp } from '@/components/providers/app-context';
import { useApi } from '@/components/providers/api-context';
import { useSessionStore } from '@/lib/session-store';
import { useWorkspaceStore } from './store';
import './demo.css';

type DemoState = 'loading' | 'ready' | 'error';

/**
 * Isolated guest workspace (`/demo/`): starts a sandbox session on mount and shows the fixed
 * demo toolbar. Sandbox API routing is handled by the API client (`demo: true`).
 */
export function DemoToolbar() {
  const api = useApi();
  const { href, origins } = useApp();
  const params = useSearchParams();
  const requestedRole = params.get('role');
  const role: 'buyer' | 'seller' = requestedRole === 'seller' ? 'seller' : 'buyer';
  const [localState, setState] = useState<DemoState>('loading');
  const [localFailure, setFailure] = useState('');
  const user = useSessionStore((s) => s.user);
  const setUser = useSessionStore((s) => s.setUser);
  const sessionStatus = useSessionStore((s) => s.status);
  const applySession = useWorkspaceStore((s) => s.applySession);

  useEffect(() => {
    document.documentElement.classList.add('onx-demo-mode');
    return () => document.documentElement.classList.remove('onx-demo-mode');
  }, []);
  const expired = sessionStatus === 'expired';
  const state: DemoState = expired ? 'error' : localState;
  const failure = expired ? 'Your demo session expired. Start a new test workspace.' : localFailure;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let result = DemoSessionResponse.parse(await api.request('/api/demo/start', { method: 'POST', body: { role }, timeoutMs: 15_000 }));
        // Resuming a sandbox must not silently alter its role; an explicit toolbar selection changes it.
        if (['buyer', 'seller'].includes(requestedRole || '') && result.user.role !== role) {
          useSessionStore.getState().setUser(result.user);
          result = DemoSessionResponse.parse(await api.request('/api/demo/auth/role', { method: 'POST', body: { role }, timeoutMs: 15_000 }));
        }
        if (cancelled) return;
        const demoUser = { ...result.user, demo: true };
        setUser(demoUser);
        applySession(demoUser);
        setState('ready');
      } catch (error) {
        if (cancelled) return;
        setState('error');
        setFailure((error as Error).message === 'The request timed out.' ? 'The demo timed out. Please try again.' : (error as Error).message || 'The demo is temporarily unavailable. Please try again.');
        setUser(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const exit = async (event: React.MouseEvent) => {
    event.preventDefault();
    try {
      if (user?.csrfToken) await api.request('/api/demo/auth/logout', { method: 'POST', body: {}, timeoutMs: 3000 });
    } catch {
      /* leave regardless */
    } finally {
      const terminal = origins.terminal;
      window.location.assign((terminal.startsWith('http') ? terminal : terminal || '') + '/market');
    }
  };
  const status = state === 'loading' ? 'Preparing your test workspace…' : state === 'error' ? failure : 'Demo · test data · no real transactions';
  const active = user?.role || role;
  return (
    <aside className="onx-demo-toolbar" aria-label="Demo workspace" data-state={state}>
      <div className="onx-demo-label">
        <span className="onx-demo-dot" aria-hidden="true" />
        <strong data-demo-status role="status">{status}</strong>
      </div>
      <nav className="onx-demo-actions" aria-label="Demo controls">
        <a data-demo-role="buyer" href={href('/market') + '?role=buyer'} aria-current={active === 'buyer' ? 'true' : 'false'}>Buyer</a>
        <a data-demo-role="seller" href={href('/market') + '?role=seller'} aria-current={active === 'seller' ? 'true' : 'false'}>Seller</a>
        <a data-demo-retry href={href('/market')} hidden={state !== 'error'}>Try again</a>
        <a className="onx-demo-exit" data-demo-exit href="/market" onClick={exit}>Exit Demo <span aria-hidden="true">↗</span></a>
      </nav>
    </aside>
  );
}
