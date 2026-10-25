'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { CollectionRun } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { NativeDialog } from '@/features/console';
import { fmt, pricingAdminApi } from './api';
import { Dialog, POLL_MS } from './pricing-admin-page';
import { StatusBadge } from './provider-card-ui';

/** Collection log dialog; the run record is re-read on the shared 5 s cadence while open. */
export function JobDialog({
  id,
  nameOf,
  onClose,
  onOpen,
}: {
  id: string;
  nameOf: (id: string) => string;
  onClose: () => void;
  onOpen: (dialog: Dialog) => void;
}) {
  const api = useApi();
  const run = useQuery<CollectionRun>({
    queryKey: ['admin', 'pricing', 'run', id],
    queryFn: () => pricingAdminApi.run(api, id),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const r = run.data;
  return (
    <NativeDialog className="pc-dialog" onClose={onClose}>
      <header>
        <div>
          <span className="pc-eyebrow">PRICE SOURCE OPERATIONS</span>
          <h2>{r ? nameOf(r.provider) + ' · collection log' : 'Collection log'}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close price-source dialog">
          ×
        </button>
      </header>
      <div className="pc-dialog-content">
        {run.error ? (
          <p className="pc-notice pc-error">
            {run.error instanceof Error ? run.error.message : 'Run not found'}
          </p>
        ) : null}
        <div className="pc-detail-status">
          <StatusBadge status={r?.status || 'running'} />
          <span>{Number(r?.recordCount ?? r?.records ?? 0)} records</span>
        </div>
        <p className="pc-scope">
          Started {fmt(r?.startedAt)} · Finished {fmt(r?.finishedAt)}
        </p>
        <pre className="pc-log">
          {(r?.logs || []).join('\n') ||
            'Collection is queued or running. Refresh to see progress.'}
        </pre>
        <div className="pc-dialog-actions">
          <button type="button" onClick={() => void run.refetch()}>
            Refresh log
          </button>
          {r ? (
            <button type="button" onClick={() => onOpen({ kind: 'detail', id: r.provider })}>
              Provider settings
            </button>
          ) : null}
        </div>
      </div>
    </NativeDialog>
  );
}

export function PricesDialog({
  id,
  name,
  api,
  onClose,
}: {
  id: string;
  name: string;
  api: ReturnType<typeof useApi>;
  onClose: () => void;
}) {
  const prices = useQuery({
    queryKey: ['admin', 'pricing', 'prices', id],
    queryFn: ({ signal }) => pricingAdminApi.prices(api, id, signal),
    retry: false,
  });
  const data = prices.data;
  return (
    <NativeDialog className="pc-dialog" onClose={onClose}>
      <header>
        <div>
          <span className="pc-eyebrow">PRICE SOURCE OPERATIONS</span>
          <h2>{name} · cached prices</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close price-source dialog">
          ×
        </button>
      </header>
      <div className="pc-dialog-content">
        <p className="pc-scope">
          {data?.meta?.message || 'Actual provider observations. No stock is implied.'} · Showing up
          to 100 records.
        </p>
        <div className="pc-table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU / GPU</th>
                <th>Region</th>
                <th>Terms</th>
                <th>GPUs</th>
                <th>USD / GPU-h</th>
                <th>USD / instance-h</th>
              </tr>
            </thead>
            <tbody>
              {data?.records.length ? (
                data.records.map((r, i) => (
                  <tr key={r.recordId || i}>
                    <td>
                      {r.instanceType}
                      <small>{r.gpuModel}</small>
                    </td>
                    <td>{r.region}</td>
                    <td>{r.term}</td>
                    <td>{r.gpuCount}</td>
                    <td>{Number(r.perGpuHourly).toFixed(4)}</td>
                    <td>{Number(r.instanceHourly).toFixed(4)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>
                    {prices.isPending
                      ? 'Loading…'
                      : 'No collected prices for this source. Configure and run its adapter first.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </NativeDialog>
  );
}
