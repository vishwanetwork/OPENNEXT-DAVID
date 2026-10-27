'use client';

import { useState } from 'react';
import type { AdminInstance } from '@opennext/contracts';
import { stampUtc } from '@/lib/format';
import { useOperationsAllocations } from '../hooks';
import { AdminLoginForm, isAccessError } from '../components/admin-access';

const STATUSES = ['', 'Running', 'Connecting', 'Attention', 'End'] as const;

/** Readable backend state, e.g. `WAITING_CAPACITY` → `Waiting capacity`. */
export const stateLabel = (state: string): string =>
  state.charAt(0) + state.slice(1).toLowerCase().replace(/_/g, ' ');

const usd = (value: string | null): string =>
  value === null ? '—' : '$' + Number(value).toFixed(2);

/** Purchased GPU allocations across accounts (protected Spot rentals). */
export function AllocationsView() {
  const [status, setStatus] = useState('');
  // Cursors of the pages before the current one; the last entry is the current page's cursor.
  const [cursors, setCursors] = useState<string[]>(['']);
  const cursor = cursors[cursors.length - 1] ?? '';
  const query = useOperationsAllocations(status, cursor);
  const denied = isAccessError(query.error);
  const rows = query.data?.instances ?? [];
  const nextCursor = query.data?.nextCursor ?? null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Allocations</h2>
        <div className="ops-tabs">
          {STATUSES.map((item) => (
            <button
              key={item || 'all'}
              type="button"
              aria-pressed={status === item}
              onClick={() => {
                setStatus(item);
                setCursors(['']);
              }}
            >
              {item || 'All'}
            </button>
          ))}
        </div>
      </div>
      {denied ? <AdminLoginForm onConnected={() => void query.refetch()} /> : null}
      {query.error && !denied ? (
        <p className="ops-state" role="alert">
          Could not load allocations. Retained data may be out of date.
        </p>
      ) : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {['Instance', 'Customer / order', 'Region', 'Status', 'Cost', 'Dates'].map(
                (label) => (
                  <th key={label}>{label}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <AllocationRow key={row.id} row={row} />
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={6} className="ops-empty-table">
                  {query.isPending
                    ? 'Loading allocations…'
                    : query.error
                      ? 'Allocation data unavailable.'
                      : 'No allocations match this status.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="ops-paging">
        <span>
          {rows.length} allocations on this page
          {query.data ? ' · as of ' + stampUtc(query.data.asOf) : ''}
        </span>
        <div>
          <button
            type="button"
            disabled={cursors.length < 2}
            onClick={() => setCursors(cursors.slice(0, -1))}
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!nextCursor}
            onClick={() => nextCursor && setCursors([...cursors, nextCursor])}
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}

function AllocationRow({ row }: { row: AdminInstance }) {
  return (
    <tr>
      <td>
        <strong>
          {row.gpuCount ?? '?'} × {row.model ?? 'GPU'}
        </strong>
        <small>
          {[row.instanceType, row.instanceId].filter(Boolean).join(' · ') || 'No server yet'} ·
          generation {row.generation}
        </small>
      </td>
      <td>
        <strong>{row.tenantId}</strong>
        <small>{row.orderId ?? row.id}</small>
      </td>
      <td>
        {row.region ?? '—'}
        {row.zone ? <small>{row.zone}</small> : null}
      </td>
      <td>
        <strong className="ops-source-label">{row.lifecycle}</strong>
        <small>
          {stateLabel(row.state)}
          {row.error ? ' · ' + row.error : ''}
          {row.degraded && row.degraded !== row.error ? ' · ' + row.degraded : ''}
        </small>
      </td>
      <td>
        <strong>{usd(row.estimatedCostUsd)}</strong>
        <small>
          budget {usd(row.budgetUsd)} · cap {usd(row.priceCeilingHourlyUsd)}/hour
        </small>
      </td>
      <td>
        <small>Created {stampUtc(row.createdAt)}</small>
        <small>
          {row.closedAt
            ? 'Closed ' + stampUtc(row.closedAt)
            : row.expiresAt
              ? 'Expires ' + stampUtc(row.expiresAt)
              : ''}
        </small>
      </td>
    </tr>
  );
}
