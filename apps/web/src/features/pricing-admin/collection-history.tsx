'use client';

import type { CollectionRun } from '@opennext/contracts';
import { fmt } from './api';
import { StatusBadge } from './provider-card-ui';

export function CollectionHistory({
  runs,
  nameOf,
  onRefresh,
  onOpen,
}: {
  runs: CollectionRun[];
  nameOf: (id: string) => string;
  onRefresh: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="pc-history">
      <div className="pc-history-head">
        <div>
          <h2>Collection history</h2>
          <p>Actual jobs, accepted prices and redacted diagnostics.</p>
        </div>
        <button type="button" onClick={onRefresh}>
          Refresh history
        </button>
      </div>
      <div className="pc-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Started</th>
              <th>Status</th>
              <th>Records</th>
              <th>Mode</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {runs.length ? (
              runs.slice(0, 20).map((r) => (
                <tr key={r.id}>
                  <td>{nameOf(r.provider)}</td>
                  <td>{fmt(r.startedAt)}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>{Number(r.recordCount ?? r.records ?? 0).toLocaleString()}</td>
                  <td>{r.mode || 'Incremental'}</td>
                  <td>
                    <button type="button" onClick={() => onOpen(r.id)}>
                      View log ↗
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>No collection jobs yet. Run a configured source to begin.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
