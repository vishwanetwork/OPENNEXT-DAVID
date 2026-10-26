'use client';

import './console-marketplace.css';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { FeaturedCandidate, KybRecord, MarketRecord } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { isAccessError } from '@/features/console';
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
import { InboxLoginDialog } from './inbox-login-dialog';
import { EMPTY_RESOURCE_FILTERS, matchesResourceFilters } from './resource-filters';

type Dialog = { kind: 'details'; id: string; workspace: string; tab: InboxTab } | { kind: 'login' };

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
  const requestedRecord = useSearchParams().get('record') || '';
  const [dismissedRecord, setDismissedRecord] = useState('');
  const demo = scope === 'demo';
  const resolvedTab: InboxTab = demo && initialTab === 'featured' ? 'rfqs' : initialTab;
  const [tab, setTab] = useState<InboxTab>(resolvedTab);
  const [routeTab, setRouteTab] = useState(resolvedTab);
  const [query, setQuery] = useState('');
  const [reviewFilter, setReviewFilter] = useState('Current');
  const [statusFilter, setStatusFilter] = useState('All');
  const [kindFilter, setKindFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [resourceFilters, setResourceFilters] = useState(EMPTY_RESOURCE_FILTERS);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  if (routeTab !== resolvedTab) {
    // A different inbox must not inherit a previous page's hidden filters or dialog.
    setRouteTab(resolvedTab);
    setTab(resolvedTab);
    setResourceFilters(EMPTY_RESOURCE_FILTERS);
    setQuery('');
    setStatusFilter('All');
    setKindFilter('All');
    setSourceFilter('All');
    setDialog(null);
  }
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
  const linkedRecord =
    requestedRecord && requestedRecord !== dismissedRecord
      ? data[tab].find((record) => record.id === requestedRecord)
      : undefined;
  const detailsOpen = accessDenied
    ? null
    : dialog?.kind === 'details'
      ? dialog
      : linkedRecord
        ? {
            id: linkedRecord.id,
            workspace: typeof linkedRecord.workspaceId === 'string' ? linkedRecord.workspaceId : '',
            tab,
          }
        : null;
  const closeDialog = () => {
    setDialog(null);
    setDismissedRecord(requestedRecord);
  };
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
    statusFilter !== 'All' ||
    kindFilter !== 'All' ||
    sourceFilter !== 'All' ||
    query ||
    Object.values(resourceFilters).some((filter) => filter !== 'All');

  const heading = demo ? 'Demo submissions · ' + TAB_LABELS[tab] : TAB_LABELS[tab];
  const rows: (MarketRecord | KybRecord)[] =
    tab === 'kyb'
      ? filterKyb(data.kyb, filters)
      : tab === 'featured'
        ? []
        : filterRecords(data[tab], tab, demo, filters).filter((record) =>
            matchesResourceFilters(record, resourceFilters),
          );
  const featuredRows: FeaturedCandidate[] =
    tab === 'featured' ? filterFeatured(data.featured, query, reviewFilter) : [];

  const details = (id: string, workspace: string) =>
    setDialog({ kind: 'details', id, workspace, tab });

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
          resourceFilters={resourceFilters}
          onResourceChange={(patch) => setResourceFilters((current) => ({ ...current, ...patch }))}
          onTab={(k) => {
            setTab(k);
            setStatusFilter('All');
            setResourceFilters(EMPTY_RESOURCE_FILTERS);
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
            <RecordsTable
              tab={tab}
              rows={rows}
              demo={demo}
              open={details}
              candidates={data.featured}
              feature={(id) => setDialog({ kind: 'details', id, workspace: '', tab: 'featured' })}
            />
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
        <InboxLoginDialog
          onClose={closeDialog}
          onConnected={async () => {
            closeDialog();
            await refresh();
          }}
        />
      ) : null}
      {detailsOpen ? (
        <DetailsDialog
          id={detailsOpen.id}
          workspace={detailsOpen.workspace}
          tab={detailsOpen.tab}
          scope={scope}
          data={data}
          onClose={closeDialog}
          onDecided={async () => {
            closeDialog();
            await refresh();
          }}
        />
      ) : null}
    </section>
  );
}
