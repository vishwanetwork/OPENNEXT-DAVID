'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type { OperationsUser } from '@opennext/contracts';
import { AdminLoginForm, useConsoleResource } from '@/features/console';
import { AsyncButton, AsyncFeedback } from '@/components/ui/async-feedback';
import type { ConsoleAccountService } from '@/lib/console-account';
import { describeError, isUnauthorized } from '@/lib/api/errors';
import { AccountTable, type AccountTab } from './account-table';
import { AccountDetails } from './account-details';
import { useAccountRecords } from './hooks';
import './accounts.css';

export function ConsoleAccountsPage({ service }: { service?: ConsoleAccountService }) {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [cursors, setCursors] = useState(['']);
  const state = useConsoleResource('users', { search, cursor: cursors.at(-1) ?? '', limit: '50' });
  const scope = state.sessionScope;
  const configured = scope && service?.sessionScope === scope ? service : undefined;
  const refresh = async () => {
    await state.refresh();
    if (scope) await client.invalidateQueries({ queryKey: ['admin', 'accounts', scope] });
  };
  return (
    <div className="console-accounts">
      <div className="head">
        <div>
          <h1>Account</h1>
          <p>Customer identity, bank information and recorded Credit activity.</p>
        </div>
        <AsyncButton
          type="button"
          className="btn"
          busy={state.isFetching}
          onClick={() => void refresh()}
        >
          Refresh accounts
        </AsyncButton>
      </div>
      <div className="ops-filters">
        <label>
          Search users
          <input
            type="search"
            placeholder="Name, company or email"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setCursors(['']);
            }}
          />
        </label>
      </div>
      {state.denied ? (
        <AdminLoginForm onConnected={state.refresh} />
      ) : state.loading ? (
        <AsyncFeedback>Loading user accounts…</AsyncFeedback>
      ) : state.error ? (
        <p className="ops-state" role="alert">
          {describeError(state.error).message}
        </p>
      ) : state.data && scope ? (
        <>
          <AccountBinding key={scope} users={state.data.users} service={configured} />
          <div className="ops-paging">
            <span>
              {state.data.filteredTotal} matching users · {state.data.users.length} on this page
            </span>
            <div>
              <button
                type="button"
                className="btn"
                disabled={cursors.length < 2}
                onClick={() => setCursors(cursors.slice(0, -1))}
              >
                Previous users
              </button>
              <button
                type="button"
                className="btn"
                disabled={!state.data.nextCursor}
                onClick={() => {
                  const cursor = state.data?.nextCursor;
                  if (cursor) setCursors([...cursors, cursor]);
                }}
              >
                Next users
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="ops-state">An authenticated administrator session is required.</p>
      )}
    </div>
  );
}

function AccountBinding({
  users,
  service,
}: {
  users: z.infer<typeof OperationsUser>[];
  service?: ConsoleAccountService;
}) {
  const [binding, setBinding] = useState({ service, generation: 0 });
  if (binding.service !== service) {
    setBinding({ service, generation: binding.generation + 1 });
    return null;
  }
  return <AccountWorkspace key={binding.generation} users={users} service={service} />;
}

function AccountWorkspace({
  users,
  service,
}: {
  users: z.infer<typeof OperationsUser>[];
  service?: ConsoleAccountService;
}) {
  const [selection, setSelection] = useState({ id: '', tab: 'bank' as AccountTab });
  const [creditCursors, setCreditCursors] = useState(['']);
  const [purchaseCursors, setPurchaseCursors] = useState(['']);
  const [denied, setDenied] = useState(false);
  const { summary, detail } = useAccountRecords({
    service,
    userIds: users.map((user) => user.id),
    selectedId: selection.id,
    creditCursor: creditCursors.at(-1) ?? '',
    purchaseCursor: purchaseCursors.at(-1) ?? '',
    blocked: denied,
  });
  if (!denied && (isUnauthorized(summary.error) || isUnauthorized(detail.error))) {
    setDenied(true);
    return null;
  }
  const selected = users.find((user) => user.id === selection.id);
  if (denied)
    return (
      <p className="ops-state" role="alert">
        Access is no longer authorized. Sign in again before viewing account records.
      </p>
    );
  const history =
    selection.tab === 'credit' ? detail.data?.creditHistory : detail.data?.purchaseHistory;
  const cursors = selection.tab === 'credit' ? creditCursors : purchaseCursors;
  const setCursors = selection.tab === 'credit' ? setCreditCursors : setPurchaseCursors;
  return (
    <>
      {!service ? (
        <p className="ops-state">
          User identities are live. Account numbers, bank details, KYB status, Credit balances and
          histories are awaiting the account service.
        </p>
      ) : summary.error ? (
        <p className="ops-state" role="alert">
          {describeError(summary.error).message}
        </p>
      ) : summary.isFetching ? (
        <AsyncFeedback>Loading account balances and verification status…</AsyncFeedback>
      ) : null}
      <AccountTable
        users={users}
        accounts={summary.error ? [] : (summary.data ?? [])}
        onOpen={(id, tab) => {
          setSelection({ id, tab });
          setCreditCursors(['']);
          setPurchaseCursors(['']);
        }}
      />
      {selected ? (
        <AccountDetails
          email={selected.email}
          tab={selection.tab}
          setTab={(tab) => setSelection({ ...selection, tab })}
          data={detail.error ? undefined : detail.data}
          error={detail.error}
          loading={detail.isFetching}
          connected={Boolean(service)}
          close={() => setSelection({ ...selection, id: '' })}
          next={() => {
            if (history?.nextCursor) setCursors([...cursors, history.nextCursor]);
          }}
          previous={cursors.length > 1 ? () => setCursors(cursors.slice(0, -1)) : undefined}
        />
      ) : null}
    </>
  );
}
