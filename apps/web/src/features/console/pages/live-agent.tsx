'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/components/providers/api-context';
import { AsyncButton } from '@/components/ui/async-feedback';
import { stampUtc } from '@/lib/format';
import { csvFrom, downloadText } from '@/terminal-kit';
import { useConsoleResource } from '../live-hooks';
import { liveApi } from '../live-api';
import { LiveFrame, LivePagination } from '../components/live-frame';
import { Head, Status } from '../components/forms';

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const csv = (rows: string[][]) =>
  csvFrom(
    rows
      .slice(1)
      .map((row) =>
        Object.fromEntries((rows[0] ?? []).map((column, index) => [column, row[index] ?? ''])),
      ),
  );

export function LiveAgentPage() {
  const state = useConsoleResource('agent');
  const api = useApi();
  const client = useQueryClient();
  const [attempt, setAttempt] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const action = useMutation({
    mutationFn: (key: string) => liveApi.reconcile(api, key),
    onSuccess: async () => {
      setAttempt(null);
      setMessage('Reconciliation queued. This page may be closed.');
      await client.invalidateQueries({ queryKey: ['admin', 'live'] });
    },
  });
  const busy = state.data?.jobs.some((job) => job.state === 'queued' || job.state === 'running');
  return (
    <LiveFrame title="agent status" state={state}>
      <Head
        title="Platform agent"
        copy="Real Bot health, customer rental states and durable maintenance jobs."
      />
      <div className="config-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Execution services</h2>
          </div>
          <div className="panel-body">
            {Object.entries(state.data?.health ?? {}).map(([key, value]) => (
              <div className="permission-row" key={key}>
                <span>{key.replaceAll('_', ' ')}</span>
                <strong>{value === null ? 'Unavailable' : String(value)}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Rental lifecycle</h2>
          </div>
          <div className="panel-body">
            {Object.entries(state.data?.rentalStates ?? {}).map(([key, value]) => (
              <div className="permission-row" key={key}>
                <span>{key}</span>
                <strong>{value}</strong>
              </div>
            ))}
            {!Object.keys(state.data?.rentalStates ?? {}).length ? (
              <p>No customer rentals recorded.</p>
            ) : null}
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Maintenance</h2>
        </div>
        <div className="panel-body">
          <p>
            Retry existing paid-order provisioning, reconcile usage and process pending
            notifications. Existing orders retain their rules. This operation does not create a new
            purchase.
          </p>
          <AsyncButton
            type="button"
            className="btn primary"
            busy={action.isPending}
            disabled={action.isPending || busy}
            onClick={() => {
              const key = attempt ?? crypto.randomUUID();
              setAttempt(key);
              setMessage('');
              action.mutate(key);
            }}
          >
            Reconcile pending operations
          </AsyncButton>
          {message ? <p role="status">{message}</p> : null}
          {action.error ? <p role="alert">{action.error.message}</p> : null}
          {state.data?.maintenanceError ? <p role="alert">{state.data.maintenanceError}</p> : null}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Run history</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {['Reference', 'Operation', 'Status', 'Submitted', 'Finished', 'Detail'].map(
                  (label) => (
                    <th key={label}>{label}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {state.data?.jobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.id}</td>
                  <td>{job.action}</td>
                  <td>
                    <Status label={job.state} />
                  </td>
                  <td>{stampUtc(job.createdAt)}</td>
                  <td>{job.finishedAt ? stampUtc(job.finishedAt) : '—'}</td>
                  <td>{job.error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!state.data?.jobs.length ? <p className="ops-state">No maintenance jobs yet.</p> : null}
      </section>
    </LiveFrame>
  );
}

export function LiveBillingPage() {
  const state = useConsoleResource('billing');
  const rows = state.data?.entries ?? [];
  const exportRows = () =>
    downloadText(
      'OpenNEXT-usage-ledger.csv',
      csv([
        ['Reference', 'Rental', 'State', 'Held USD', 'Billed USD', 'Released USD', 'Updated UTC'],
        ...rows.map((row) => [
          row.id,
          row.rentalId ?? '',
          row.state,
          usd(row.heldCents),
          row.billedCents === null ? '' : usd(row.billedCents),
          row.releasedCents === null ? '' : usd(row.releasedCents),
          row.at,
        ]),
      ]),
      'text/csv;charset=utf-8',
    );
  return (
    <LiveFrame title="usage ledger" state={state}>
      <Head
        title="Agent billing"
        copy="Customer usage settlement and credit holds from the authoritative ledger."
        actions={
          <button type="button" className="btn" onClick={exportRows} disabled={!rows.length}>
            Export displayed records
          </button>
        }
      />
      <div className="stats">
        {[
          ['Customer usage billed', usd(state.data?.billedCents ?? 0)],
          ['Open credit holds', usd(state.data?.heldCents ?? 0)],
          ['Credit released', usd(state.data?.releasedCents ?? 0)],
          ['Cloud provider invoices', 'Not connected'],
        ].map(([label, value]) => (
          <div className="stat" key={label}>
            <div className="stat-label">{label}</div>
            <div className="stat-value">{value}</div>
          </div>
        ))}
      </div>
      <p className="ops-state">
        Customer charges are not cloud provider invoices. No estimated AI evaluation costs or
        unenforced spending cap are displayed.
      </p>
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {['Reference', 'Rental', 'Status', 'Held', 'Billed', 'Released', 'Updated'].map(
                  (label) => (
                    <th key={label}>{label}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.rentalId ?? '—'}</td>
                  <td>{row.state}</td>
                  <td>{usd(row.heldCents)}</td>
                  <td>{row.billedCents === null ? '—' : usd(row.billedCents)}</td>
                  <td>{row.releasedCents === null ? '—' : usd(row.releasedCents)}</td>
                  <td>{row.at ? stampUtc(row.at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length ? <p className="ops-state">No usage ledger records yet.</p> : null}
      </section>
      <p className="muted">Showing the latest 200 records. Summary totals cover the full ledger.</p>
    </LiveFrame>
  );
}

export function LiveAuditPage() {
  const [search, setSearch] = useState('');
  const [cursors, setCursors] = useState(['']);
  const state = useConsoleResource('activity', {
    cursor: cursors[cursors.length - 1] ?? '',
    limit: '50',
    search,
  });
  const rows = state.data?.events ?? [];
  return (
    <LiveFrame title="audit log" state={state}>
      <Head
        title="Audit log"
        copy="Server-recorded operator actions and customer review decisions."
        actions={
          <button
            type="button"
            className="btn"
            disabled={!rows.length}
            onClick={() =>
              downloadText(
                'OpenNEXT-audit.csv',
                csv([
                  ['Time UTC', 'Actor', 'Action', 'Reference', 'Detail'],
                  ...rows.map((row) => [row.at, row.actor, row.action, row.target, row.detail]),
                ]),
                'text/csv;charset=utf-8',
              )
            }
          >
            Export displayed records
          </button>
        }
      />
      <label>
        Search audit events
        <input
          className="field"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setCursors(['']);
          }}
        />
      </label>
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {['Time', 'Actor', 'Action', 'Reference', 'Detail'].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{stampUtc(row.at)}</td>
                  <td>{row.actor}</td>
                  <td>{row.action}</td>
                  <td>{row.target}</td>
                  <td>{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length ? <p className="ops-state">No matching events.</p> : null}
      </section>
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
