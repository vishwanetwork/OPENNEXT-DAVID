'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { describeError, isUnauthorized } from '@/lib/api/errors';
import type { CashoutAdminService } from '@/lib/cashout';
import { money, stampUtc } from '@/lib/format';
import { useCashoutQueue } from './hooks';
import { CashoutRequestDialog } from './request-dialog';
import './cashouts.css';

export function ConsoleCashoutsPage({ service }: { service?: CashoutAdminService }) {
  const scope = service?.sessionScope;
  const [binding, setBinding] = useState({ service, scope, generation: 0 });
  if (binding.service !== service || binding.scope !== scope) {
    setBinding({ service, scope, generation: binding.generation + 1 });
    return null;
  }
  return (
    <Queue key={`${scope}:${binding.generation}`} service={scope?.trim() ? service : undefined} />
  );
}

function Queue({ service }: { service?: CashoutAdminService }) {
  const [blocked, setBlocked] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [selection, setSelection] = useState<{ id: string; completing: boolean } | null>(null);
  const query = useCashoutQueue(service, blocked);
  const clear = query.clear;
  const toast = useToast();
  useEffect(() => {
    if (blocked) clear();
  }, [blocked, clear]);
  if (isUnauthorized(query.error) && !blocked) {
    setBlocked(true);
    return null;
  }
  const rows = blocked || query.error ? [] : (query.data ?? []);
  const visible = rows.filter(
    (row) =>
      (status === 'All' || row.status === status) &&
      [row.id, row.accountNumber, row.email, row.companyName]
        .join(' ')
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const selected = rows.find((row) => row.id === selection?.id);
  const close = () => setSelection(null);
  return (
    <section className="cashout-review">
      <header className="page-head">
        <div>
          <h1>Cashout Requests</h1>
          <p>Review verified company bank details and record completed Credit payouts.</p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={!service || blocked || query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh
        </button>
      </header>
      {!service && (
        <p className="cashout-review-state" role="status">
          Awaiting backend · Private cashout requests, reserved Credit settlement, notifications and
          emails are not connected. No payout can be completed here yet.
        </p>
      )}
      {service && (!service.complete || !service.details) && (
        <p className="cashout-review-state" role="status">
          Completed is unavailable until verified bank details and payout settlement are connected.
        </p>
      )}
      {(query.error || blocked) && (
        <p role="alert">
          {blocked
            ? 'Administrator access expired. Sign in again to view cashout requests.'
            : describeError(query.error).message}
        </p>
      )}
      <section className="panel">
        <div className="cashout-review-toolbar">
          <label>
            Search
            <input
              type="search"
              placeholder="Account, email or company"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="All">All</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </label>
        </div>
        <div className="cashout-review-table">
          <table>
            <thead>
              <tr>
                {[
                  'Account #',
                  'Email / Company',
                  'Cashout Amount',
                  'Submitted (UTC)',
                  'Status',
                  'Action',
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td>{row.accountNumber}</td>
                  <td>
                    <strong>{row.email}</strong>
                    <small>{row.companyName}</small>
                  </td>
                  <td>{money(row.amountCents / 100)} USD</td>
                  <td>{stampUtc(row.submittedAt)}</td>
                  <td>
                    <span className="cashout-review-status">{row.status}</span>
                  </td>
                  <td>
                    <div className="cashout-review-actions">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setSelection({ id: row.id, completing: false })}
                      >
                        Details
                      </button>
                      {row.status === 'pending' && (
                        <button
                          type="button"
                          className="btn primary"
                          disabled={!service?.complete || !service.details}
                          onClick={() => setSelection({ id: row.id, completing: true })}
                        >
                          Completed
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && (
          <p className="cashout-review-empty">
            {!service
              ? 'Cashout service awaiting backend'
              : query.isLoading
                ? 'Loading cashout requests…'
                : 'No matching cashout requests'}
          </p>
        )}
      </section>
      {selected && service && selection && (
        <CashoutRequestDialog
          key={`${selected.id}:${selected.revision}:${selected.status}:${selection.completing}`}
          record={selected}
          service={service}
          completing={selection.completing && selected.status === 'pending'}
          onClose={close}
          onCompleted={() => {
            close();
            toast('Cashout completed. The customer notification and email have been queued.');
            void query.refetch();
          }}
          onRefresh={() => {
            close();
            void query.refetch();
          }}
          onAccessDenied={() => {
            close();
            setBlocked(true);
            query.clear();
          }}
        />
      )}
    </section>
  );
}
