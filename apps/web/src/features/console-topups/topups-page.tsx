'use client';

import './console-topups.css';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CreditTopup } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { AdminLoginForm, NativeDialog, isAccessError } from '@/features/console';
import {
  METHODS,
  POLL_MS,
  filterTopups,
  pendingRow,
  topupAmount,
  topupLabel,
  topupStamp,
  topupToken,
  type TopupScope,
} from './topups';
import { topupsApi } from './api';
import { ReviewDialog } from './review-dialog';

export type Dialog =
  | { kind: 'review'; token: string; decision: 'Approve' | 'Reject'; scope: TopupScope }
  | { kind: 'login' };

/** Manual credit top-up review (legacy OpenNEXT-console-topups.js). Approval records verified receipt only. */
export function ConsoleTopupsPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<TopupScope>('production');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [reviewing, setReviewing] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const key = ['admin', 'topups', scope];
  const topups = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => topupsApi.list(api, scope, signal),
    refetchInterval: reviewing ? false : POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: !reviewing,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const blocked = isAccessError(topups.error);
  const loaded = topups.isSuccess && !blocked;
  const rows: CreditTopup[] = blocked ? [] : (topups.data ?? []);
  const shownNotice = topups.error
    ? {
        text:
          (topups.error instanceof Error
            ? topups.error.message
            : 'The request could not be completed.') +
          (!blocked && topups.data ? ' The previous snapshot is retained.' : ''),
        error: true,
      }
    : notice;
  const reviewOpen = dialog?.kind === 'review' && !blocked ? dialog : null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const switchScope = (value: string) => {
    const selected: TopupScope = value === 'demo' ? 'demo' : 'production';
    if (selected === scope || reviewing) return;
    setScope(selected);
    setDialog(null);
    setNotice(null);
  };
  const matched = filterTopups(rows, query, filter);
  return (
    <section className="on-topups">
      <div className="page-head">
        <div>
          <h1>Top-up Requests</h1>
          <p>Verify incoming payments before adding Credit to an account.</p>
        </div>
        <button type="button" className="btn" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      <div
        className={`on-topups-message${shownNotice?.error ? ' is-error' : ''}`}
        role="status"
        hidden={!shownNotice}
      >
        {shownNotice?.text}
      </div>
      <div className="on-topups-test-notice" hidden={scope !== 'demo'}>
        Test accounts only. These approvals add test Credit and never affect live balances or real
        payments.
      </div>
      <section className="panel">
        <div className="on-topups-toolbar">
          <label>
            Accounts
            <select
              aria-label="Account scope"
              value={scope}
              disabled={reviewing}
              onChange={(e) => switchScope(e.target.value)}
            >
              <option value="production">Live accounts</option>
              <option value="demo">Test accounts</option>
            </select>
          </label>
          <label className="on-topups-search">
            <span className="sr-only">Search top-up requests</span>
            <input
              type="search"
              maxLength={256}
              placeholder="Search email or request…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Top-up status</span>
            <select
              aria-label="Top-up status"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="All">All statuses</option>
              <option value="Pending">Pending</option>
              <option value="Approved">Solved</option>
              <option value="Rejected">Rejected</option>
            </select>
          </label>
        </div>
        <div className="on-topups-count" aria-live="polite">
          {loaded && !blocked
            ? `${matched.length} of ${rows.length} requests · ${scope === 'demo' ? 'Test accounts' : 'Live accounts'}`
            : ''}
        </div>
        <div className="on-topups-table">
          {blocked ? (
            <div className="on-topups-empty">
              <strong>Administrator access required</strong>
              <p>Connect an administrator session to review private top-up requests.</p>
              <button
                type="button"
                className="btn primary"
                onClick={() => setDialog({ kind: 'login' })}
              >
                Connect administrator session
              </button>
            </div>
          ) : topups.isPending ? (
            <p className="on-topups-empty">Loading top-up requests…</p>
          ) : matched.length ? (
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>
                    Submitted time <small>UTC</small>
                  </th>
                  <th>Status</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {matched.map((row) => (
                  <tr key={topupToken(row)}>
                    <td>
                      <strong>{row.email}</strong>
                      <small>{row.id}</small>
                      {scope === 'demo' ? (
                        <small className="on-topup-test">Test account · {row.workspaceId}</small>
                      ) : null}
                    </td>
                    <td className="on-topup-amount">{topupAmount(row)}</td>
                    <td>{METHODS[String(row.method)] || row.method || 'Not provided'}</td>
                    <td>{topupStamp(row.createdAt)}</td>
                    <td>
                      <span
                        className={`on-topup-status ${row.status === 'Approved' ? 'solved' : row.status === 'Rejected' ? 'rejected' : 'pending'}`}
                      >
                        {topupLabel(row)}
                      </span>
                      {row.reviewedAt ? <small>{topupStamp(row.reviewedAt)} UTC</small> : null}
                      {row.reason ? <small>{row.reason}</small> : null}
                    </td>
                    <td>
                      <div className="on-topup-actions">
                        {pendingRow(row) ? (
                          <>
                            <button
                              type="button"
                              className="btn small primary"
                              disabled={reviewing}
                              onClick={() =>
                                setDialog({
                                  kind: 'review',
                                  token: topupToken(row),
                                  decision: 'Approve',
                                  scope,
                                })
                              }
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn small"
                              disabled={reviewing}
                              onClick={() =>
                                setDialog({
                                  kind: 'review',
                                  token: topupToken(row),
                                  decision: 'Reject',
                                  scope,
                                })
                              }
                            >
                              Reject
                            </button>
                          </>
                        ) : (
                          <span className="on-topup-complete">
                            {row.status === 'Approved'
                              ? 'Credit added'
                              : row.status === 'Rejected'
                                ? 'No Credit added'
                                : 'Review unavailable'}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="on-topups-empty">
              <strong>
                {!loaded
                  ? 'Top-up requests are unavailable'
                  : rows.length
                    ? 'No matching requests'
                    : 'No top-up requests yet'}
              </strong>
              <p>
                {!loaded
                  ? 'Refresh to load the latest server records.'
                  : rows.length
                    ? 'Try another email or status.'
                    : scope === 'demo'
                      ? 'New test-account top-ups will appear here.'
                      : 'Customer top-up requests will appear here after submission.'}
              </p>
            </div>
          )}
        </div>
      </section>
      <p className="on-topups-footnote">
        Approval requires payment verification. Rejected requests do not add Credit. Records refresh
        automatically while this page is open.
      </p>
      {dialog?.kind === 'login' ? (
        <NativeDialog
          className="on-topup-dialog"
          labelledBy="on-topup-heading"
          onClose={() => setDialog(null)}
        >
          <header>
            <h2 id="on-topup-heading">Administrator session</h2>
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
            labelClassName="on-topup-note"
            errorClassName="on-topup-error"
            onConnected={async () => {
              setDialog(null);
              await refresh();
            }}
          />
        </NativeDialog>
      ) : null}
      {reviewOpen ? (
        <ReviewDialog
          dialog={reviewOpen}
          rows={rows}
          currentScope={scope}
          reviewing={reviewing}
          onClose={() => setDialog(null)}
          onStart={() => setReviewing(true)}
          onEnd={() => setReviewing(false)}
          onDecided={(request, decision) => {
            queryClient.setQueryData<CreditTopup[]>(key, (current) =>
              (current || []).map((row) =>
                topupToken(row) === reviewOpen.token ? { ...row, ...request } : row,
              ),
            );
            setDialog(null);
            setNotice({
              text:
                decision === 'Approve'
                  ? 'Top-up solved. The server confirmed that Credit was added.'
                  : 'Request rejected. No Credit was added.',
              error: false,
            });
            void refresh();
          }}
          onFailed={(message, conflict) => {
            setNotice({
              text: 'The decision was not confirmed. Refresh to verify the latest status before trying again.',
              error: true,
            });
            if (conflict) void refresh();
            return message;
          }}
          onAccessLost={() => {
            setDialog(null);
            void refresh();
          }}
        />
      ) : null}
    </section>
  );
}
