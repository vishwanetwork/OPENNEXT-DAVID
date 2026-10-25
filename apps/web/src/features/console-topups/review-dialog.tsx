'use client';

import { useState, type FormEvent } from 'react';
import type { CreditTopup } from '@opennext/contracts';
import { ApiError } from '@/lib/api/client';
import { useApi } from '@/components/providers/api-context';
import { NativeDialog, isAccessError } from '@/features/console';
import { METHODS, pendingRow, topupAmount, topupToken, type TopupScope } from './topups';
import { topupsApi } from './api';
import { Dialog } from './topups-page';

export function ReviewDialog({
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
  rows: CreditTopup[];
  currentScope: TopupScope;
  reviewing: boolean;
  onClose: () => void;
  onStart: () => void;
  onEnd: () => void;
  onDecided: (request: CreditTopup, decision: 'Approve' | 'Reject') => void;
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
