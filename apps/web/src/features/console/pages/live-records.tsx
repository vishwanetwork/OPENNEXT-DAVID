'use client';

import { useState } from 'react';
import { useConsoleResource } from '../live-hooks';
import { LiveFrame, LivePagination } from '../components/live-frame';
import { UsersPage } from './users';
import { OrdersPage } from './orders';
import { OverviewPage } from './overview';

export function LiveOverviewPage() {
  const state = useConsoleResource('overview');
  return (
    <LiveFrame title="overview" state={state}>
      <OverviewPage summary={state.data} />
    </LiveFrame>
  );
}

export function LiveUsersPage() {
  const [cursors, setCursors] = useState(['']);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('All');
  const state = useConsoleResource('users', {
    cursor: cursors[cursors.length - 1] ?? '',
    limit: '50',
    search,
    role: role === 'All' ? '' : role,
  });
  return (
    <LiveFrame title="users" state={state}>
      <UsersPage
        snapshot={state.data}
        filters={{
          search,
          role,
          onSearch: (value) => {
            setCursors(['']);
            setSearch(value);
          },
          onRole: (value) => {
            setCursors(['']);
            setRole(value);
          },
        }}
      />
      <p className="muted">
        This page shows {state.data?.users.length ?? 0} accounts. Totals and growth include all
        accounts.
      </p>
      <LivePagination
        next={state.data?.nextCursor ?? null}
        previous={cursors.length > 1}
        onNext={() => {
          const next = state.data?.nextCursor;
          if (next) setCursors([...cursors, next]);
        }}
        onPrevious={() => setCursors(cursors.slice(0, -1))}
      />
    </LiveFrame>
  );
}

export function LiveOrdersPage() {
  const [cursors, setCursors] = useState(['']);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('All');
  const state = useConsoleResource('orders', {
    cursor: cursors[cursors.length - 1] ?? '',
    limit: '50',
    state: 'processing',
    search,
    kind,
  });
  return (
    <LiveFrame title="orders" state={state}>
      <OrdersPage
        orders={state.data?.orders}
        filters={{
          search,
          kind,
          onSearch: (value) => {
            setCursors(['']);
            setSearch(value);
          },
          onKind: (value) => {
            setCursors(['']);
            setKind(value);
          },
        }}
      />
      <p className="muted">{state.data?.total ?? 0} in-progress orders across all customers.</p>
      <LivePagination
        next={state.data?.nextCursor ?? null}
        previous={cursors.length > 1}
        onNext={() => {
          const next = state.data?.nextCursor;
          if (next) setCursors([...cursors, next]);
        }}
        onPrevious={() => setCursors(cursors.slice(0, -1))}
      />
    </LiveFrame>
  );
}
