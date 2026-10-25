'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { TopupRequest } from '@opennext/contracts';
import { ApiError } from '@/lib/api/client';
import { useApi } from '@/components/providers/api-context';
import { NativeDialog } from '@/features/console/components/native-dialog';
import { AdminLoginForm, isAccessError } from '@/features/console/components/admin-access';
import {
  METHODS,
  POLL_MS,
  filterTopups,
  pendingRow,
  topupAmount,
  topupLabel,
  topupStamp,
  topupToken,
  topupsApi,
  type TopupScope,
} from './topups';
import './console-topups.css';

type Dialog =
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
  const rows: TopupRequest[] = blocked ? [] : (topups.data ?? []);
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
            queryClient.setQueryData<TopupRequest[]>(key, (current) =>
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

function ReviewDialog({
  dialog,
  rows,
  currentScope,
  reviewing,
  onClose,
  onStart,
  onEnd,
  onDecided,
  onFailed,
  onAccessLost,
}: {
  dialog: Extract<Dialog, { kind: 'review' }>;
  rows: TopupRequest[];
  currentScope: TopupScope;
  reviewing: boolean;
  onClose: () => void;
  onStart: () => void;
  onEnd: () => void;
  onDecided: (request: TopupRequest, decision: 'Approve' | 'Reject') => void;
  onFailed: (message: string, conflict: boolean) => string;
  onAccessLost: () => void;
}) {
  const api = useApi();
  const [error, setError] = useState('');
  const row = rows.find((item) => topupToken(item) === dialog.token);
  const stale = !pendingRow(row);
  if (!row) return null;
  const approve = dialog.decision === 'Approve';
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (reviewing) return;
    const fields = new FormData(event.currentTarget);
    setError('');
    if (dialog.scope !== currentScope || stale) {
      setError('The request has changed. Close this dialog and refresh.');
      return;
    }
    if (approve && fields.get('fundsVerified') !== 'on') {
      setError('Confirm that the payment has been received before approving.');
      return;
    }
    onStart();
    try {
      const payload: Parameters<typeof topupsApi.review>[3] = {
        decision: dialog.decision,
        reason: String(fields.get('reason') || ''),
      };
      if (approve) payload.fundsVerified = true;
      if (dialog.scope === 'demo') payload.workspaceId = row.workspaceId || '';
      const result = await topupsApi.review(api, dialog.scope, row.id, payload);
      const request = result.request;
      if (
        !request ||
        request.id !== row.id ||
        request.status !== (approve ? 'Approved' : 'Rejected') ||
        (dialog.scope === 'demo'
          ? request.workspaceId !== row.workspaceId
          : Boolean(request.workspaceId || request.demo))
      )
        throw new Error(
          'The server did not confirm this decision. Refresh to check the request status before trying again.',
        );
      onDecided(request, dialog.decision);
    } catch (e) {
      if (isAccessError(e)) {
        onAccessLost();
        return;
      }
      const conflict = e instanceof ApiError && e.status === 409;
      setError(
        onFailed(
          conflict
            ? 'This request was reviewed elsewhere. Refresh to see the recorded decision.'
            : e instanceof Error
              ? e.message
              : 'The request could not be completed.',
          conflict,
        ),
      );
    } finally {
      onEnd();
    }
  };
  return (
    <NativeDialog className="on-topup-dialog" labelledBy="on-topup-heading" onClose={onClose}>
      <header>
        <h2 id="on-topup-heading">{approve ? 'Approve top-up' : 'Reject top-up'}</h2>
        <button type="button" className="btn" onClick={onClose} aria-label="Close dialog">
          ×
        </button>
      </header>
      {dialog.scope === 'demo' ? (
        <p className="on-topup-test-warning">
          Test account only. No live Credit or real payment is affected.
        </p>
      ) : null}
      <div className="on-topup-summary">
        <div>
          <small>Email</small>
          <strong>{row.email}</strong>
        </div>
        <div>
          <small>Amount</small>
          <strong>{topupAmount(row)}</strong>
        </div>
        <div>
          <small>Method</small>
          <strong>{METHODS[String(row.method)] || row.method}</strong>
        </div>
        <div>
          <small>Request</small>
          <strong>{row.id}</strong>
        </div>
      </div>
      <p>
        {approve
          ? 'Only approve after independently verifying receipt of this payment. Approval adds the requested Credit once.'
          : 'Rejecting this request will not add Credit to the account.'}
      </p>
      <form onSubmit={submit} data-topup-form="review">
        {approve ? (
          <label className="on-topup-confirm">
            <input type="checkbox" name="fundsVerified" required />
            <span>I have verified that the payment has been received.</span>
          </label>
        ) : null}
        <label className="on-topup-note">
          {approve ? 'Review notes' : 'Rejection reason'} <span>(optional)</span>
          <textarea name="reason" rows={3} maxLength={2000} />
        </label>
        <p className="on-topup-error" hidden={!stale}>
          This request was already reviewed. Close this dialog and refresh before taking another
          action.
        </p>
        <p className="on-topup-error" role="alert" hidden={!error}>
          {error}
        </p>
        <div className="on-topup-dialog-actions">
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${approve ? 'primary' : ''}`}
            type="submit"
            disabled={reviewing || stale}
          >
            {approve ? 'Approve and add Credit' : 'Reject request'}
          </button>
        </div>
      </form>
    </NativeDialog>
  );
}
