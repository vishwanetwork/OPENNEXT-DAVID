'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import type { CollectionRun, PricingProvider } from '@opennext/contracts';
import { ApiError } from '@/lib/api/client';
import { useApi } from '@/components/providers/api-context';
import { NativeDialog } from '@/features/console/components/native-dialog';
import { AdminLoginForm, isAccessError } from '@/features/console/components/admin-access';
import { PROVIDER_LOGOS } from './provider-logos';
import {
  STATUS_LABELS,
  filterProviders,
  fmt,
  pricingAdminApi,
  providerMetrics,
  providerState,
  type ProviderFilter,
} from './api';
import './pricing-admin.css';

const POLL_MS = 5000;

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`pc-status pc-${status}`}>
      {STATUS_LABELS[status] || status || 'Not synced'}
    </span>
  );
}

function ProviderLogo({ id }: { id: string }) {
  const logo = PROVIDER_LOGOS[id];
  if (!logo) return null;
  return (
    <span className="pc-provider-logo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo.src} alt="" aria-hidden="true" width={28} height={28} decoding="async" />
    </span>
  );
}

type Dialog =
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

function PcDialog({
  dialog,
  providers,
  access,
  busy,
  onClose,
  onOpen,
  onNotice,
  onRun,
  refresh,
}: {
  dialog: Dialog;
  providers: PricingProvider[];
  access: { mutable: boolean };
  busy: string | null;
  onClose: () => void;
  onOpen: (dialog: Dialog) => void;
  onNotice: (text: string, error?: boolean) => void;
  onRun: (id: string, test: boolean) => Promise<void>;
  refresh: () => Promise<unknown>;
}) {
  const api = useApi();
  const nameOf = (id: string) => providers.find((p) => p.id === id)?.name || id;
  let title = '';
  let content: ReactNode = null;
  if (dialog.kind === 'login') {
    title = 'Connect administrator session';
    content = (
      <AdminLoginForm
        intro={
          <p>
            This token belongs to the OpenNEXT server, not a cloud provider. It is exchanged for a
            short-lived, HTTP-only session cookie.
          </p>
        }
        buttonClassName="pc-primary"
        errorClassName="pc-notice pc-error"
        onConnected={async () => {
          onClose();
          onNotice('Administrator session connected.');
          await refresh();
        }}
      />
    );
  } else if (dialog.kind === 'detail') {
    const p = providers.find((x) => x.id === dialog.id);
    if (!p) return null;
    title = p.name;
    content = (
      <ProviderDetail
        p={p}
        access={access}
        busy={busy}
        onClose={onClose}
        onOpen={onOpen}
        onNotice={onNotice}
        onRun={onRun}
        refresh={refresh}
      />
    );
  } else if (dialog.kind === 'job') {
    return <JobDialog id={dialog.id} nameOf={nameOf} onClose={onClose} onOpen={onOpen} />;
  } else if (dialog.kind === 'prices') {
    return <PricesDialog id={dialog.id} name={nameOf(dialog.id)} api={api} onClose={onClose} />;
  }
  return (
    <NativeDialog className="pc-dialog" onClose={onClose}>
      <header>
        <div>
          <span className="pc-eyebrow">PRICE SOURCE OPERATIONS</span>
          <h2>{title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close price-source dialog">
          ×
        </button>
      </header>
      <div className="pc-dialog-content">{content}</div>
    </NativeDialog>
  );
}

function ProviderDetail({
  p,
  access,
  busy,
  onClose,
  onOpen,
  onNotice,
  onRun,
  refresh,
}: {
  p: PricingProvider;
  access: { mutable: boolean };
  busy: string | null;
  onClose: () => void;
  onOpen: (dialog: Dialog) => void;
  onNotice: (text: string, error?: boolean) => void;
  onRun: (id: string, test: boolean) => Promise<void>;
  refresh: () => Promise<unknown>;
}) {
  const api = useApi();
  const [credential, setCredential] = useState('');
  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await pricingAdminApi.settings(api, p.id, {
        enabled: data.has('enabled'),
        intervalMinutes: Number(data.get('intervalMinutes')),
      });
      onClose();
      onNotice('Collection settings saved on the server.');
      await refresh();
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : 'The pricing operation could not be completed.',
        true,
      );
    }
  };
  const saveCredential = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = credential;
    setCredential('');
    try {
      await pricingAdminApi.credential(api, p.id, value);
      onClose();
      onNotice('Credential saved in server memory. It will be cleared when the server restarts.');
      await refresh();
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : 'The pricing operation could not be completed.',
        true,
      );
    }
  };
  return (
    <>
      <div className="pc-detail-status">
        <StatusBadge status={providerState(p)} />
        <span>{p.recordCount || 0} cached records</span>
      </div>
      <p className="pc-scope">{p.scope}</p>
      <dl className="pc-details">
        <div>
          <dt>Adapter</dt>
          <dd>
            {p.adapterStatus === 'implemented'
              ? 'Implemented'
              : 'API / schema verification pending'}
          </dd>
        </div>
        <div>
          <dt>Server credential</dt>
          <dd>
            {!p.credentialRequired
              ? 'Not needed for public catalog'
              : p.configured
                ? 'Configured — never returned to browser'
                : 'Not configured'}
          </dd>
        </div>
        <div>
          <dt>Supported price types</dt>
          <dd>{(p.capabilities || []).join(' · ') || 'Pending integration'}</dd>
        </div>
        <div>
          <dt>Credential environment</dt>
          <dd>{p.credentialEnv || 'Provider-specific server integration'}</dd>
        </div>
      </dl>
      {p.message ? <div className="pc-callout">{p.message}</div> : null}
      <form onSubmit={saveSettings}>
        <h3>Collection settings</h3>
        <label className="pc-checkbox">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={p.enabled}
            disabled={p.adapterStatus !== 'implemented'}
          />
          Enable scheduled collection
        </label>
        <label>
          Interval (minutes)
          <input
            type="number"
            name="intervalMinutes"
            min={10}
            max={1440}
            defaultValue={p.intervalMinutes}
            required
          />
        </label>
        <div className="pc-dialog-actions">
          <button className="pc-primary" disabled={!access.mutable}>
            Save settings
          </button>
          <button
            type="button"
            disabled={!access.mutable || p.adapterStatus !== 'implemented' || busy === p.id}
            onClick={() => void onRun(p.id, true)}
          >
            Test &amp; collect
          </button>
          <button type="button" onClick={() => onOpen({ kind: 'prices', id: p.id })}>
            View prices
          </button>
        </div>
      </form>
      {p.credentialEnv && p.adapterStatus === 'implemented' ? (
        <form onSubmit={saveCredential} autoComplete="off">
          <h3>Provider credential</h3>
          <p>
            For this session only. Saved to server memory, never browser storage. Use server
            environment or a secrets manager for persistent deployment.
          </p>
          <label>
            API key
            <input
              type="password"
              name="credential"
              autoComplete="new-password"
              placeholder="Enter a rotated read-only API key"
              required
              minLength={5}
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
            />
          </label>
          <button className="pc-primary" disabled={!access.mutable}>
            Save to server memory
          </button>
        </form>
      ) : null}
      <div className="pc-api-list">
        <h3>Read-only upstream API</h3>
        {(p.endpoints || []).length ? (
          (p.endpoints || []).map((e, i) => (
            <code key={i}>
              {e.method} {e.url}
            </code>
          ))
        ) : (
          <p>
            No verified connector endpoint yet. Credentials alone do not establish a price feed.
          </p>
        )}
        <a href={p.docsUrl || '#'} target="_blank" rel="noopener noreferrer">
          Official API documentation ↗
        </a>
      </div>
    </>
  );
}

/** Collection log dialog; the run record is re-read on the shared 5 s cadence while open. */
function JobDialog({
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

function PricesDialog({
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
