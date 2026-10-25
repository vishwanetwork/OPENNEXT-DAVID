'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { FeaturedCandidate, KybRecord, MarketRecord } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { NativeDialog } from '@/features/console/components/native-dialog';
import { AdminLoginForm, isAccessError } from '@/features/console/components/admin-access';
import {
  MARKETS,
  POLL_MS,
  TAB_LABELS,
  date,
  duration,
  filterFeatured,
  filterKyb,
  filterRecords,
  isExternal,
  marketplaceApi,
  money,
  number,
  present,
  quantity,
  receivedReceipt,
  recordKind,
  sourceKey,
  sourceName,
  unit,
  type InboxData,
  type InboxScope,
  type InboxTab,
} from './marketplace';
import {
  ExternalReviewForm,
  FeaturedDialogBody,
  GenericRecordBody,
  KybDialogBody,
  RfqDialogBody,
  RfqReviewForm,
} from './details';
import './console-marketplace.css';

type Dialog = { kind: 'details'; id: string; workspace: string } | { kind: 'login' };

const EMPTY: InboxData = { rfqs: [], supplies: [], kyb: [], featured: [], generatedAt: '' };

/**
 * Production inbox (`/api/admin/marketplace`) and isolated Demo submissions
 * (`/api/admin/demo/marketplace`). Legacy OpenNEXT-console-marketplace.js.
 */
export function MarketplaceInboxPage({
  tab: initialTab,
  scope = 'production',
}: {
  tab: InboxTab;
  scope?: InboxScope;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const demo = scope === 'demo';
  const resolvedTab: InboxTab = demo && initialTab === 'featured' ? 'rfqs' : initialTab;
  const [tab, setTab] = useState<InboxTab>(resolvedTab);
  const [routeTab, setRouteTab] = useState(resolvedTab);
  if (routeTab !== resolvedTab) {
    // The route changed (sidebar navigation): follow it, like the legacy render(selected).
    setRouteTab(resolvedTab);
    setTab(resolvedTab);
  }
  const [query, setQuery] = useState('');
  const [reviewFilter, setReviewFilter] = useState('Current');
  const [statusFilter, setStatusFilter] = useState('All');
  const [kindFilter, setKindFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const key = ['admin', 'marketplace', scope];
  const snapshot = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => marketplaceApi.snapshot(api, scope, signal),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const accessDenied = isAccessError(snapshot.error);
  const data: InboxData = accessDenied ? EMPTY : (snapshot.data ?? EMPTY);
  const lastSuccess = accessDenied ? '' : snapshot.data?.generatedAt || '';
  const lastError = snapshot.error
    ? snapshot.error instanceof Error
      ? snapshot.error.message
      : 'Request failed.'
    : '';
  const detailsOpen = dialog?.kind === 'details' && !accessDenied ? dialog : null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const statusValues = useMemo(
    () =>
      [
        ...new Set(
          (data[tab] as { status?: string | null }[])
            .map((r) => r.status)
            .filter(Boolean) as string[],
        ),
      ].sort(),
    [data, tab],
  );
  const effectiveStatus =
    statusFilter !== 'All' && !statusValues.includes(statusFilter) ? 'All' : statusFilter;
  const sources = useMemo(() => {
    const map = new Map(
      [...data.rfqs, ...data.supplies].map((r) => [sourceKey(r, demo), sourceName(r, demo)]),
    );
    return [...map].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data, demo]);
  const effectiveSource =
    sourceFilter !== 'All' && !sources.some(([k]) => k === sourceFilter) ? 'All' : sourceFilter;
  const filters = {
    query,
    statusFilter: effectiveStatus,
    kindFilter,
    sourceFilter: effectiveSource,
  };
  const filtered =
    statusFilter !== 'All' || kindFilter !== 'All' || sourceFilter !== 'All' || query;

  const heading = demo ? 'Demo submissions · ' + TAB_LABELS[tab] : TAB_LABELS[tab];
  const visibleTabs = (Object.entries(TAB_LABELS) as [InboxTab, string][]).filter(
    ([k]) => !demo || k !== 'featured',
  );

  const rows: (MarketRecord | KybRecord)[] =
    tab === 'kyb'
      ? filterKyb(data.kyb, filters)
      : tab === 'featured'
        ? []
        : filterRecords(data[tab], tab, demo, filters);
  const featuredRows: FeaturedCandidate[] =
    tab === 'featured' ? filterFeatured(data.featured, query, reviewFilter) : [];

  const workspaceCell = (r: { workspaceId?: string | null; workspaceExpiresAt?: string | null }) =>
    demo ? (
      <>
        <small className="market-demo-workspace">{r.workspaceId}</small>
        <small>Expires {date(r.workspaceExpiresAt)}</small>
      </>
    ) : null;
  const sourceCell = (r: MarketRecord) => (
    <>
      <span
        className={`market-source ${isExternal(r, demo) ? 'external' : demo ? 'demo' : 'terminal'}`}
      >
        {sourceName(r, demo)}
      </span>
      {isExternal(r, demo) ? (
        <small>External · operations handled</small>
      ) : demo ? (
        <small>Isolated test workspace</small>
      ) : (
        <small>First-party submission</small>
      )}
    </>
  );
  const receiptCell = (r: MarketRecord) => {
    if (isExternal(r, demo))
      return (
        <>
          <span className="market-receipt imported">Imported</span>
          <small>{date(r.provenance?.importedAt)}</small>
          <small>Source observed {date(r.provenance?.observedAt)}</small>
        </>
      );
    const received = receivedReceipt(r);
    return (
      <>
        <span className={`market-receipt ${received ? 'received' : 'recorded'}`}>
          {received ? 'Received' : 'Recorded'}
        </span>
        <small>{received ? r.submission?.receiptId : 'Receipt not available'}</small>
        <small>{date(received ? r.submission?.receivedAt : r.createdAt)}</small>
        {r.submission?.updatedAt && r.submission.updatedAt !== r.submission.receivedAt ? (
          <small>Updated {date(r.submission.updatedAt)}</small>
        ) : null}
      </>
    );
  };
  const statusSpan = (status: unknown) => (
    <span
      className={`market-status${status === 'Reviewing' ? ' reviewing' : status === 'Rejected' ? ' rejected' : ''}`}
    >
      {String(status ?? '')}
    </span>
  );
  const details = (id: string, workspace: string) => setDialog({ kind: 'details', id, workspace });

  return (
    <section className="on-marketplace-console">
      <div className="page-head">
        <div>
          <h1>{heading}</h1>
          <p>
            {demo
              ? 'Test submissions from isolated guest workspaces. Never mixed with production.'
              : 'Terminal submissions and external market records with traceable sources and operational review.'}
          </p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={snapshot.isFetching}
          onClick={() => void refresh()}
        >
          {snapshot.isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {demo ? (
        <div className="market-console-demo-banner">
          <strong>DEMO · TEST ONLY</strong>
          <p>
            Only submissions made by demo users appear here; catalog fixtures are excluded.
            Workspaces expire automatically. Demo KYB review enables listing tests only, not real
            identity verification, payments or infrastructure.
          </p>
        </div>
      ) : null}
      <div className="market-console-status" role="status" hidden={!lastError}>
        {lastError}
        {lastError && lastSuccess ? ' The last successful snapshot is retained.' : ''}
      </div>
      <div className="market-console-sync" aria-live="polite">
        {(lastSuccess
          ? 'Last synced ' + date(lastSuccess) + '. '
          : 'No successful server sync yet. ') +
          (lastError
            ? 'Updates are unavailable; the last successful snapshot may be out of date.'
            : 'Refreshes every 30 seconds while this page is visible.')}
      </div>
      <section className="panel">
        <div className="market-console-toolbar">
          <div className="market-console-tabs">
            {visibleTabs.map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`btn ${k === tab ? 'primary' : ''}`}
                onClick={() => {
                  setTab(k);
                  setStatusFilter('All');
                }}
              >
                {label} <span>{(data[k] || []).length}</span>
              </button>
            ))}
          </div>
          <div className="market-console-filters">
            <input
              className="field"
              type="search"
              aria-label="Search submissions"
              placeholder="Search ID, model, location, account or source…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="field"
              aria-label="Market type"
              hidden={!['rfqs', 'supplies'].includes(tab)}
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
            >
              <option value="All">All markets</option>
              {Object.entries(MARKETS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <select
              className="field"
              aria-label="Submission source"
              hidden={!['rfqs', 'supplies'].includes(tab)}
              value={effectiveSource}
              onChange={(e) => setSourceFilter(e.target.value)}
            >
              <option value="All">All sources</option>
              {sources.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <select
              className="field"
              aria-label="Marketplace status"
              hidden={tab === 'featured'}
              value={effectiveStatus}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="All">All statuses</option>
              {statusValues.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <select
              className="field"
              aria-label="Homepage review status"
              hidden={tab !== 'featured'}
              value={reviewFilter}
              onChange={(e) => setReviewFilter(e.target.value)}
            >
              {['Current', 'Pending', 'Approved', 'Rejected', 'History'].map((value) => (
                <option key={value} value={value}>
                  {value === 'Current'
                    ? 'All current candidates'
                    : value === 'History'
                      ? 'Superseded history'
                      : value}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="market-console-results" aria-live="polite">
          {accessDenied
            ? ''
            : tab === 'featured'
              ? `${featuredRows.length} of ${data.featured.length} review records`
              : `${rows.length} of ${(data[tab] || []).length} records`}
        </div>
        <div className="market-console-table">
          {accessDenied ? (
            <div className="market-console-empty">
              <h3>Administrator access required</h3>
              <p>
                Connect the server administrator session to view private marketplace submissions.
              </p>
              <button
                type="button"
                className="btn primary"
                onClick={() => setDialog({ kind: 'login' })}
              >
                Connect administrator session
              </button>
            </div>
          ) : snapshot.isPending ? (
            <p>Loading private records…</p>
          ) : tab === 'featured' ? (
            <>
              <div className="market-console-review-note">
                The highest public buyer budget and lowest seller net price are selected for each
                GPU model. Only current, approved candidates appear on the homepage. A replacement
                or material edit requires a new review.
              </div>
              {featuredRows.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Model / side</th>
                      <th>Selected record</th>
                      <th>Price · USD / GPU-hour</th>
                      <th>Review dates</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {featuredRows.map((row) => {
                      const s = row.snapshot || {};
                      const supply = row.side === 'supply';
                      return (
                        <tr key={row.id}>
                          <td>
                            <strong>{row.model}</strong>
                            <small>{supply ? 'Supplier offer' : 'Buyer RFQ'}</small>
                            <small>{row.sourceId}</small>
                          </td>
                          <td>
                            <strong>{s.title}</strong>
                            <small>{s.ownerEmail}</small>
                            <small>
                              {s.region} · {s.count} GPU · {s.hours} hours
                            </small>
                          </td>
                          <td>
                            {money(supply ? s.netPrice : s.price)}
                            <small>
                              {supply ? 'Lowest quoted unit price' : 'Highest maximum buyer price'}
                            </small>
                            {supply ? (
                              <small>OpenNEXT Fee 5% per side at checkout / settlement</small>
                            ) : null}
                          </td>
                          <td>
                            {date(row.submittedAt)}
                            {row.reviewedAt ? <small>Reviewed {date(row.reviewedAt)}</small> : null}
                          </td>
                          <td>
                            <span
                              className={`market-status ${row.status === 'Pending' ? 'reviewing' : row.status === 'Rejected' ? 'rejected' : ''}`}
                            >
                              {row.status}
                            </span>
                            {row.current ? null : <small>Superseded · not displayed</small>}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn small"
                              onClick={() => details(row.id, '')}
                            >
                              {row.current ? 'Review candidate' : 'View history'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="market-console-empty">
                  <strong>No candidates in this view</strong>
                  <p>
                    Eligible public RFQs and published supply are selected automatically, then wait
                    for operations approval.
                  </p>
                </div>
              )}
            </>
          ) : rows.length ? (
            <table>
              <thead>
                <tr>
                  {(tab === 'kyb'
                    ? ['Business / account', 'Country', 'Registration', 'Submitted', 'Status', '']
                    : tab === 'rfqs'
                      ? ['Email', 'Model', 'vCPU', 'Memory', 'Request type', 'Details']
                      : [
                          'Supply / account',
                          'Source',
                          'Market / location',
                          'Offered capacity',
                          'Quoted price',
                          'Console receipt',
                          'Marketplace status',
                          '',
                        ]
                  ).map((c, i) => (
                    <th key={i}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tab === 'kyb'
                  ? (rows as KybRecord[]).map((r) => (
                      <tr key={r.id + (r.workspaceId || '')}>
                        <td>
                          <strong>{r.company}</strong>
                          <small>{r.email}</small>
                          {workspaceCell(r)}
                        </td>
                        <td>{r.country}</td>
                        <td>{r.registration}</td>
                        <td>{date(r.submittedAt)}</td>
                        <td>{statusSpan(r.status)}</td>
                        <td>
                          <button
                            type="button"
                            className="btn small"
                            onClick={() => details(r.id, r.workspaceId || '')}
                          >
                            Review submission
                          </button>
                        </td>
                      </tr>
                    ))
                  : tab === 'rfqs'
                    ? (rows as MarketRecord[]).map((r) => {
                        const request = r.requestKind === 'quote_request' ? 'Ask for quote' : 'RFQ';
                        return (
                          <tr key={r.id + (r.workspaceId || '')}>
                            <td>
                              <strong>
                                {r.ownerEmail ||
                                  r.email ||
                                  (isExternal(r, demo)
                                    ? 'No OpenNEXT account assigned'
                                    : 'Not provided')}
                              </strong>
                              {sourceCell(r)}
                              {workspaceCell(r)}
                            </td>
                            <td>
                              <strong>{r.model}</strong>
                            </td>
                            <td>{number(r.vcpu)}</td>
                            <td>
                              {present(r.memory) ? number(r.memory) + ' GB / GPU' : 'Not provided'}
                            </td>
                            <td>
                              <strong>{r.term || request}</strong>
                              <small>{request}</small>
                              {statusSpan(r.status)}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn small"
                                onClick={() => details(r.id, r.workspaceId || '')}
                              >
                                Details
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    : (rows as MarketRecord[]).map((r) => (
                        <tr key={r.id + (r.workspaceId || '')}>
                          <td>
                            <strong>{r.title || r.model}</strong>
                            {isExternal(r, demo) ? (
                              <small>External market record · no OpenNEXT account assigned</small>
                            ) : (
                              <>
                                <small>{r.ownerName || r.accountName || ''}</small>
                                <small>{r.company || r.ownerCompany || ''}</small>
                                <small>
                                  {r.ownerEmail || r.email || 'Account email unavailable'}
                                </small>
                              </>
                            )}
                            <small>{r.id}</small>
                            {workspaceCell(r)}
                          </td>
                          <td>{sourceCell(r)}</td>
                          <td>
                            <strong>{r.model}</strong>
                            <small>{MARKETS[recordKind(r)] || recordKind(r)}</small>
                            <small>{r.region}</small>
                          </td>
                          <td>
                            {quantity(r, demo)}
                            <small>{duration(r, demo)}</small>
                            <small>{r.term}</small>
                          </td>
                          <td>
                            {money(r.netPrice)}
                            <small>{unit(r)}</small>
                          </td>
                          <td>{receiptCell(r)}</td>
                          <td>
                            {statusSpan(r.status)}
                            {r.agentStatus ? <small>Agent: {r.agentStatus}</small> : null}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn small"
                              onClick={() => details(r.id, r.workspaceId || '')}
                            >
                              View details
                            </button>
                          </td>
                        </tr>
                      ))}
              </tbody>
            </table>
          ) : (
            <div className="market-console-empty">
              <strong>
                {filtered
                  ? 'No matching records'
                  : lastSuccess
                    ? 'No submissions yet'
                    : 'Submission data unavailable'}
              </strong>
              <p>
                {filtered
                  ? 'Try another search or filter.'
                  : lastSuccess
                    ? demo
                      ? 'New demo user submissions will appear here. Catalog fixtures are excluded; expired workspaces are removed.'
                      : 'Submitted customer RFQs and supply will appear here once the server acknowledges them.'
                    : 'Connect the backend and refresh to load customer submissions.'}
              </p>
            </div>
          )}
        </div>
      </section>
      <p className="form-note">
        {demo
          ? 'Demo records cannot be published to the live marketplace or homepage. Approval affects only the selected test workspace; agent installation is not simulated.'
          : 'Received confirms a Terminal submission; Imported identifies an external source record, not a customer account or a confirmed trade. Operational approval and homepage review remain separate. Demo workspaces stay isolated.'}
      </p>
      {dialog?.kind === 'login' ? (
        <NativeDialog className="market-console-dialog" onClose={() => setDialog(null)}>
          <header>
            <h2>Administrator session</h2>
            <button
              type="button"
              className="btn"
              onClick={() => setDialog(null)}
              aria-label="Close dialog"
            >
              ×
            </button>
          </header>
          <AdminLoginForm
            intro={<p>Use the server administrator token to create an HTTP-only session.</p>}
            inputClassName="field"
            onConnected={async () => {
              setDialog(null);
              await refresh();
            }}
          />
        </NativeDialog>
      ) : null}
      {detailsOpen ? (
        <DetailsDialog
          id={detailsOpen.id}
          workspace={detailsOpen.workspace}
          tab={tab}
          scope={scope}
          data={data}
          onClose={() => setDialog(null)}
          onDecided={async () => {
            setDialog(null);
            await refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function DetailsDialog({
  id,
  workspace,
  tab,
  scope,
  data,
  onClose,
  onDecided,
}: {
  id: string;
  workspace: string;
  tab: InboxTab;
  scope: InboxScope;
  data: InboxData;
  onClose: () => void;
  onDecided: () => Promise<void>;
}) {
  const api = useApi();
  const demo = scope === 'demo';
  const decide = async (
    collection: 'rfqs' | 'kyb' | 'featured',
    status: string,
    reason: string,
    extra: Record<string, unknown>,
  ) => {
    if (demo && (collection === 'featured' || !workspace))
      throw new Error('Select a valid demo submission.');
    await marketplaceApi.decide(api, scope, collection, id, {
      status,
      reason,
      ...(demo ? { workspaceId: workspace } : {}),
      ...extra,
    });
    await onDecided();
  };
  const external = async (r: MarketRecord, status: string, reason: string, revision: number) => {
    if (demo || !isExternal(r, demo)) throw new Error('Select a valid external market record.');
    if (!Number.isInteger(revision) || revision < 1 || revision !== Number(r.reviewRevision))
      throw new Error('The record has changed. Refresh and review its current revision.');
    await marketplaceApi.external(api, r.id, { status, reason, expectedRevision: revision });
    await onDecided();
  };
  let title = '';
  let body: React.ReactNode = null;
  if (tab === 'featured') {
    const row = data.featured.find((f) => f.id === id);
    if (!row) return null;
    title = 'Homepage candidate · ' + row.model;
    body = (
      <FeaturedDialogBody
        row={row}
        onDecide={(status, reason, fingerprint) =>
          decide('featured', status, reason, { fingerprint })
        }
      />
    );
  } else if (tab === 'kyb') {
    const r = data.kyb.find((k) => k.id === id && (!demo || k.workspaceId === workspace));
    if (!r) return null;
    title = r.id;
    body = (
      <KybDialogBody
        r={r}
        demo={demo}
        onDecide={(status, reason) => decide('kyb', status, reason, {})}
      />
    );
  } else {
    const r = data[tab].find((x) => x.id === id && (!demo || x.workspaceId === workspace));
    if (!r) return null;
    const review = isExternal(r, demo) ? (
      <ExternalReviewForm
        r={r}
        onDecide={(status, reason, revision) => external(r, status, reason, revision)}
      />
    ) : tab === 'rfqs' ? (
      <RfqReviewForm
        r={r}
        demo={demo}
        onDecide={(status, reason) =>
          decide('rfqs', status, reason, { expectedRevision: Number(r.reviewRevision) })
        }
      />
    ) : null;
    if (tab === 'rfqs' && !isExternal(r, demo)) {
      title = r.requestKind === 'quote_request' ? 'Ask for quote' : 'Capacity RFQ';
      body = (
        <>
          <RfqDialogBody r={r} demo={demo} />
          {review}
        </>
      );
    } else {
      title = r.id;
      body = (
        <GenericRecordBody r={r} tab={tab} demo={demo}>
          {review}
        </GenericRecordBody>
      );
    }
  }
  return (
    <NativeDialog className="market-console-dialog" onClose={onClose}>
      <header>
        <h2>{title}</h2>
        <button type="button" className="btn" onClick={onClose} aria-label="Close dialog">
          ×
        </button>
      </header>
      {body}
    </NativeDialog>
  );
}
