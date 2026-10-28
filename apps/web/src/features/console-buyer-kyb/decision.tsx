'use client';

import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Dialog } from '@/components/ui/dialog';
import type { BuyerKybAdminService, BuyerKybCase } from '@/lib/buyer-kyb';
import { describeError, isConflict, isUnauthorized } from '@/lib/api/errors';
import { confirmedDecision } from './review';

export function KybDecision({
  record,
  service,
  onConfirmed,
  onRefresh,
  onAccessDenied,
}: {
  record: BuyerKybCase;
  service: BuyerKybAdminService;
  onConfirmed: () => Promise<void>;
  onRefresh: () => void;
  onAccessDenied: () => void;
}) {
  const [allscaleApproved, setAllscaleApproved] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const locked = useRef(false);
  const submission = useRef<{ signature: string; key: string } | null>(null);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const decide = async (decision: 'Approved' | 'Rejected') => {
    if (locked.current || record.status !== 'Reviewing') return;
    const rejectionReason = decision === 'Rejected' ? reason.trim() : '';
    if (decision === 'Rejected' && !rejectionReason) {
      setError('Enter the rejection reason provided by ALLScale.');
      return;
    }
    if (decision === 'Approved' && !allscaleApproved) {
      setError('Confirm that ALLScale has approved this application.');
      return;
    }
    const signature = JSON.stringify([record.id, record.revision, decision, rejectionReason]);
    if (submission.current && submission.current.signature !== signature) {
      setError(
        'A decision may already be recorded. Refresh this case before changing the decision.',
      );
      return;
    }
    if (!submission.current) submission.current = { signature, key: crypto.randomUUID() };
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await service.decide({
        caseId: record.id,
        expectedRevision: record.revision,
        decision,
        reason: rejectionReason,
        allscaleApproved: decision === 'Approved' && allscaleApproved,
        idempotencyKey: submission.current.key,
      });
      if (!active.current) return;
      if (!confirmedDecision(response, record, decision))
        throw new Error(
          'The decision and user notification were not fully confirmed. Refresh the case before retrying.',
        );
      await onConfirmed();
    } catch (failure) {
      if (!active.current) return;
      if (isUnauthorized(failure)) onAccessDenied();
      else {
        setError(describeError(failure).message);
        if (isConflict(failure)) onRefresh();
      }
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  };
  const reject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void decide('Rejected');
  };
  if (record.status !== 'Reviewing')
    return (
      <p className="buyer-kyb-note">
        This application has a final decision. Rejection details are delivered privately through the
        applicant&apos;s notification.
      </p>
    );
  return (
    <section className="buyer-kyb-decision">
      <h3>ALLScale review outcome</h3>
      <label className="buyer-kyb-confirm">
        <input
          type="checkbox"
          checked={allscaleApproved}
          disabled={busy}
          onChange={(event) => setAllscaleApproved(event.target.checked)}
        />
        I confirm ALLScale has approved this application.
      </label>
      {!rejecting && error && (
        <p className="buyer-kyb-error" role="alert">
          {error}
        </p>
      )}
      <div className="buyer-kyb-actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            setError('');
            setRejecting(true);
          }}
        >
          Reject
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !allscaleApproved}
          onClick={() => void decide('Approved')}
        >
          {busy && !rejecting ? 'Saving…' : 'Approve'}
        </button>
      </div>
      {rejecting && (
        <Dialog
          overlayClassName="buyer-kyb-overlay"
          className="buyer-kyb-modal buyer-kyb-reject"
          label="Reject Buyer KYB"
          onClose={() => {
            if (!busy) {
              setRejecting(false);
              setReason('');
              setError('');
            }
          }}
          closeOnEscape={!busy}
        >
          <h2>Reject Buyer KYB</h2>
          <p>
            Enter ALLScale&apos;s reason. It will be sent privately to the applicant in their
            notification.
          </p>
          <form onSubmit={reject} noValidate>
            <label className="buyer-kyb-field">
              Rejection reason
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={2000}
                rows={5}
                required
                disabled={busy}
              />
            </label>
            {error && (
              <p className="buyer-kyb-error" role="alert">
                {error}
              </p>
            )}
            <div className="buyer-kyb-actions">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  setRejecting(false);
                  setReason('');
                  setError('');
                }}
              >
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Saving…' : 'Confirm rejection'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
