'use client';

import { useState, type FormEvent } from 'react';
import type { MarketRecord } from '@opennext/contracts';

export interface DecisionSubmit {
  (decision: string, reason: string): Promise<void>;
}

/** Decision form: the submitter's value is the decision; errors stay inside the dialog. */
export function DecisionForm({
  buttons,
  placeholder,
  onSubmit,
  validate,
}: {
  buttons: { value: string; label: string; primary?: boolean }[];
  placeholder: string;
  onSubmit: DecisionSubmit;
  validate?: (decision: string, reason: string) => string | null;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const decision = submitter?.value || '';
    const reason = String(new FormData(event.currentTarget).get('reason') || '');
    const problem = validate?.(decision, reason);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setBusy(true);
    try {
      await onSubmit(decision, reason);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <label>
        Decision notes
        <textarea
          className="field"
          name="reason"
          rows={3}
          maxLength={2000}
          placeholder={placeholder}
        />
      </label>
      <p className="market-console-error" role="alert" hidden={!error}>
        {error}
      </p>
      <div className="market-console-decisions">
        {buttons.map((b) => (
          <button
            key={b.value}
            type="submit"
            className={`btn ${b.primary ? 'primary' : ''}`}
            name="decision"
            value={b.value}
            disabled={busy}
          >
            {b.label}
          </button>
        ))}
      </div>
    </form>
  );
}

export function ExternalReviewForm({
  r,
  onDecide,
}: {
  r: MarketRecord;
  onDecide: (status: string, reason: string, revision: number) => Promise<void>;
}) {
  const status = r.reviewStatus || r.status;
  const revision = Number(r.reviewRevision);
  const note = (
    <p className="market-console-review-note">
      This external record is handled by operations, not a registered buyer or seller. Approval
      publishes the reviewed requirements in the Terminal. Future imports and material changes
      require a new review. Homepage placement is a separate decision.
    </p>
  );
  if (!['Reviewing', 'Approved'].includes(String(status)))
    return (
      <>
        {note}
        <p className="market-console-notes">
          {r.reviewReason ||
            'No review action is available for this record. A new source revision requires a new review.'}
        </p>
      </>
    );
  if (!Number.isInteger(revision) || revision < 1)
    return (
      <>
        {note}
        <p className="market-console-error">
          The review revision is unavailable. Refresh before reviewing this record.
        </p>
      </>
    );
  return (
    <>
      {note}
      <DecisionForm
        placeholder="Required when rejecting or withdrawing; optional approval notes"
        buttons={
          status === 'Reviewing'
            ? [
                { value: 'Rejected', label: 'Reject external record' },
                { value: 'Approved', label: 'Approve for Terminal', primary: true },
              ]
            : [{ value: 'Withdrawn', label: 'Withdraw from Terminal' }]
        }
        validate={(decision, reason) =>
          !['Approved', 'Rejected', 'Withdrawn'].includes(decision)
            ? 'Select a valid review decision.'
            : ['Rejected', 'Withdrawn'].includes(decision) && !reason.trim()
              ? 'Explain why the external record is being rejected or withdrawn.'
              : null
        }
        onSubmit={(decision, reason) => onDecide(decision, reason.trim(), revision)}
      />
    </>
  );
}

export function RfqReviewForm({
  r,
  demo,
  onDecide,
}: {
  r: MarketRecord;
  demo: boolean;
  onDecide: (status: string, reason: string) => Promise<void>;
}) {
  const note = (
    <p className="market-console-review-note">
      Operations approval makes this RFQ available to eligible suppliers. Homepage placement
      requires a separate Homepage review. Private RFQs remain visible only to the selected
      supplier.
    </p>
  );
  if (r.reviewStatus !== 'Reviewing')
    return (
      <>
        {note}
        {r.reviewReason ? (
          <p className="market-console-notes">Decision notes: {r.reviewReason}</p>
        ) : null}
      </>
    );
  return (
    <>
      {note}
      <DecisionForm
        placeholder="Required when rejecting; optional approval notes"
        buttons={[
          { value: 'Rejected', label: 'Reject RFQ' },
          { value: 'Approved', label: demo ? 'Approve Demo RFQ' : 'Approve RFQ', primary: true },
        ]}
        validate={(decision, reason) =>
          decision === 'Rejected' && !reason.trim()
            ? 'Explain why the submission is being rejected.'
            : null
        }
        onSubmit={onDecide}
      />
    </>
  );
}
