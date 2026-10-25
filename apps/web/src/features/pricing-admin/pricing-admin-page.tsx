'use client';

import './pricing-admin.css';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { ApiError } from '@/lib/api/client';
import { useApi } from '@/components/providers/api-context';
import { isAccessError } from '@/features/console';
import {
  filterProviders,
  fmt,
  pricingAdminApi,
  providerMetrics,
  providerState,
  type ProviderFilter,
} from './api';
import { PcDialog } from './provider-dialogs';
import { ProviderLogo, StatusBadge } from './provider-card-ui';

export const POLL_MS = 5000;

export type Dialog =
  | { kind: 'detail'; id: string }
  | { kind: 'job'; id: string }
  | { kind: 'prices'; id: string }
  | { kind: 'login' };

/** Price sources operations page (legacy OpenNEXT-provider-console.js). */
export function PricingAdminPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ProviderFilter>('all');
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const data = useQuery({
    queryKey: ['admin', 'pricing', 'providers'],
    queryFn: async ({ signal }) => {
      const [providers, runs] = await Promise.all([
        pricingAdminApi.providers(api, signal),
        pricingAdminApi.runs(api, signal),
      ]);
      return { ...providers, runs };
    },
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const providers = data.data?.providers ?? [];
  const runs = data.data?.runs ?? [];
  const access = data.data?.access ?? { mutable: false };
  const blocked = isAccessError(data.error);
  // Query failures are shown as the notice; action notices show while the query is healthy.
  const shownNotice = data.error
    ? {
        text: blocked
          ? 'Administrator access is required to manage provider connections. Sign in with the server administrator token.'
          : data.error instanceof Error
            ? data.error.message
            : 'The pricing operation could not be completed.',
        error: true,
      }
    : notice;

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['admin', 'pricing'] }),
    [queryClient],
  );
  const nameOf = (id: string) => providers.find((p) => p.id === id)?.name || id;
  const fail = (error: unknown) => {
    if (error instanceof ApiError && error.status === 0) return;
    setNotice({
      text:
        error instanceof Error ? error.message : 'The pricing operation could not be completed.',
      error: true,
    });
  };

  const runProvider = async (id: string, test: boolean) => {
    setBusy(id);
    try {
      const run = test
        ? await pricingAdminApi.test(api, id)
        : await pricingAdminApi.startRun(api, id);
      await refresh();
      setDialog({ kind: 'job', id: run.id });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };
  const syncAll = async () => {
    setBusy('all');
    try {
      const selected = providers.filter((p) => p.enabled && p.adapterStatus === 'implemented');
      for (const p of selected) await pricingAdminApi.startRun(api, p.id);
      setNotice({
        text: `Started or reused ${selected.length} configured collection jobs.`,
        error: false,
      });
      await refresh();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const visible = filterProviders(providers, query, filter);
  const metrics = providerMetrics(providers);

  return (
    <section className="provider-console">
      <div className="pc-heading">
        <div>
          <div className="pc-eyebrow">MARKET DATA OPERATIONS</div>
          <h1>Price sources</h1>
          <p>Collect provider prices. Normalize units. Publish one trusted API.</p>
        </div>
        <div className="pc-actions">
          <button type="button" onClick={() => void refresh()}>
            ↻ Refresh
          </button>
          <button
            type="button"
            className="pc-primary"
            disabled={!access.mutable || busy === 'all' || blocked}
            onClick={() => void syncAll()}
          >
            Run enabled sources
          </button>
        </div>
      </div>
      <div
        className={`pc-notice${shownNotice?.error ? ' pc-error' : ''}`}
        role="status"
        hidden={!shownNotice}
      >
        {shownNotice?.text}
      </div>
      <div className="pc-metrics">
        {(
          [
            ['Price sources', metrics.providers],
            ['Connected adapters', metrics.connected],
            ['Cached price records', metrics.records],
            ['Collections running', metrics.running],
          ] as [string, number][]
        ).map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{data.data ? value.toLocaleString() : '—'}</strong>
          </div>
        ))}
      </div>
      <div className="pc-toolbar">
        <label>
          <span>⌕</span>
          <input
            type="search"
            placeholder="Search providers…"
            aria-label="Search price sources"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter price-source status"
          value={filter}
          onChange={(e) => setFilter(e.target.value as ProviderFilter)}
        >
          <option value="all">All sources</option>
          <option value="connected">Implemented adapters</option>
          <option value="enabled">Enabled</option>
          <option value="attention">Needs attention</option>
        </select>
        <span className="pc-toolbar-note">
          Read-only price collection · no resource provisioning
        </span>
      </div>
      <div className="pc-grid">
        {blocked ? (
          <div className="pc-loading">
            Protected price-source operations.
            <br />
            <button type="button" onClick={() => setDialog({ kind: 'login' })}>
              Connect administrator session
            </button>
          </div>
        ) : !data.data ? (
          <div className="pc-loading">Loading price-source status…</div>
        ) : visible.length ? (
          visible.map((p) => {
            const state = providerState(p);
            return (
              <article className="pc-card" key={p.id}>
                <button
                  type="button"
                  className="pc-card-top"
                  onClick={() => setDialog({ kind: 'detail', id: p.id })}
                >
                  <span className="pc-provider">
                    <ProviderLogo id={p.id} />
                    <strong>{p.name}</strong>
                  </span>
                  <span className={`pc-enabled ${p.enabled ? 'is-enabled' : ''}`}>
                    {p.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </button>
                <p className="pc-cadence">Incremental · every {p.intervalMinutes} minutes</p>
                <div className="pc-card-run">
                  <span>LATEST RUN</span>
                  <StatusBadge status={state} />
                </div>
                <div className="pc-card-bottom">
                  <small>{fmt(p.lastRun?.finishedAt || p.lastRun?.startedAt)}</small>
                  <strong>
                    {p.lastRun
                      ? Number(p.lastRun.recordCount || 0).toLocaleString() + ' records'
                      : '—'}
                  </strong>
                </div>
                <div className="pc-card-actions">
                  <button type="button" onClick={() => setDialog({ kind: 'detail', id: p.id })}>
                    Configure
                  </button>
                  <button
                    type="button"
                    disabled={
                      !access.mutable ||
                      p.adapterStatus !== 'implemented' ||
                      state === 'running' ||
                      busy === p.id
                    }
                    onClick={() => void runProvider(p.id, false)}
                  >
                    {state === 'running' ? 'Running…' : 'Run now'}
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <div className="pc-loading">No price sources match these filters.</div>
        )}
      </div>
      <section className="pc-history">
        <div className="pc-history-head">
          <div>
            <h2>Collection history</h2>
            <p>Actual jobs, accepted prices and redacted diagnostics.</p>
          </div>
          <button type="button" onClick={() => void refresh()}>
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
                <th></th>
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
                      <button type="button" onClick={() => setDialog({ kind: 'job', id: r.id })}>
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
      <p className="pc-foot">
        AWS charts use AWS observations only. Catalog prices do not guarantee stock. Unsupported
        price types stay unavailable until an adapter and permissions are verified.
      </p>
      {dialog ? (
        <PcDialog
          dialog={dialog}
          providers={providers}
          access={access}
          busy={busy}
          onClose={() => setDialog(null)}
          onOpen={setDialog}
          onNotice={(text, error = false) => setNotice({ text, error })}
          onRun={runProvider}
          refresh={refresh}
        />
      ) : null}
    </section>
  );
}
