'use client';

import './console-marketplace.css';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { FeaturedCandidate, KybRecord, MarketRecord } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { AdminLoginForm, NativeDialog, isAccessError } from '@/features/console';
import {
  POLL_MS,
  TAB_LABELS,
  date,
  filterFeatured,
  filterKyb,
  filterRecords,
  sourceKey,
  sourceName,
  type InboxData,
  type InboxScope,
  type InboxTab,
} from './marketplace';
import { marketplaceApi } from './api';
import { DetailsDialog } from './details-dialog';
import { FeaturedTable, RecordsTable } from './inbox-tables';
import { InboxToolbar } from './inbox-toolbar';

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
  const rows: (MarketRecord | KybRecord)[] =
    tab === 'kyb'
      ? filterKyb(data.kyb, filters)
      : tab === 'featured'
        ? []
        : filterRecords(data[tab], tab, demo, filters);
  const featuredRows: FeaturedCandidate[] =
    tab === 'featured' ? filterFeatured(data.featured, query, reviewFilter) : [];

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
        <InboxToolbar
          tab={tab}
          demo={demo}
          data={data}
          filters={{ ...filters, reviewFilter }}
          sources={sources}
          statusValues={statusValues}
          onTab={(k) => {
            setTab(k);
            setStatusFilter('All');
          }}
          onChange={(patch) => {
            if (patch.query !== undefined) setQuery(patch.query);
            if (patch.kindFilter !== undefined) setKindFilter(patch.kindFilter);
            if (patch.sourceFilter !== undefined) setSourceFilter(patch.sourceFilter);
            if (patch.statusFilter !== undefined) setStatusFilter(patch.statusFilter);
            if (patch.reviewFilter !== undefined) setReviewFilter(patch.reviewFilter);
          }}
        />
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
                <FeaturedTable rows={featuredRows} open={details} />
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
            <RecordsTable tab={tab} rows={rows} demo={demo} open={details} />
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
