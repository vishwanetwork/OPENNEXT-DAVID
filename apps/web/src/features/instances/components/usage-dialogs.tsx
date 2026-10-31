'use client';

import type { InstanceUsageSnapshot } from '@/lib/instance-usage';
import { useTerminal } from '@/terminal-kit';
import { moneyOrNa, stampUtcFull } from '../lifecycle';
import { useInstanceUsage } from '../hooks';
import { IBtn } from './common';
import { UsageChart } from './usage-chart';

const billedSeconds = (billing: NonNullable<InstanceUsageSnapshot['billing']>) =>
  billing.entries.reduce((sum, entry) => sum + entry.billableSeconds, 0);

export function BillingHistory({ snapshot }: { snapshot: InstanceUsageSnapshot }) {
  const billing = snapshot.billing;
  if (!billing)
    return (
      <p className="form-note">
        The authoritative billing ledger is not available yet. Usage bars are not used to calculate
        charges.
      </p>
    );
  return (
    <>
      <div className="details-grid instance-billing-summary">
        <div>
          <small>BILLING STARTED</small>
          <strong>{stampUtcFull(billing.startedAt)}</strong>
        </div>
        <div>
          <small>BILLING STOPPED</small>
          <strong>
            {billing.stoppedAt ? stampUtcFull(billing.stoppedAt) : 'No final stop recorded'}
          </strong>
        </div>
        <div>
          <small>RECORDED TOTAL</small>
          <strong>{moneyOrNa(billing.totalCents / 100)}</strong>
        </div>
      </div>
      <p className="form-note">
        Only connected, billable usage is charged. Interrupted periods pause compute billing. All
        amounts below come from the recorded ledger.
      </p>
      {billing.totalCents > 0 && billedSeconds(billing) < 3600 ? (
        <p className="form-note" data-instance-billing-minimum>
          Usage is billed per minute with a 1-hour minimum per order. This order has run for less
          than an hour, so the minimum is charged and spread across the periods below.
        </p>
      ) : null}
      <div className="instance-ledger-wrap">
        <table className="instance-ledger">
          <thead>
            <tr>
              <th>Usage period (UTC)</th>
              <th>Billable time</th>
              <th>Compute</th>
              <th>Fee</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {billing.entries.map((entry) => (
              <tr key={entry.id}>
                <td>
                  {stampUtcFull(entry.startedAt)}
                  <small>to {stampUtcFull(entry.endedAt)}</small>
                </td>
                <td>
                  {(entry.billableSeconds / 3600).toFixed(2)} hours
                  {entry.billableSeconds === 0 ? <small>Billing paused</small> : null}
                </td>
                <td>{moneyOrNa(entry.computeCents / 100)}</td>
                <td>{moneyOrNa(entry.feeCents / 100)}</td>
                <td>{moneyOrNa(entry.totalCents / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!billing.entries.length ? (
        <p className="form-note">No hourly ledger entries have been recorded.</p>
      ) : null}
      {!billing.complete ? (
        <p className="form-note">
          This is a partial ledger. The recorded total may include entries outside the displayed
          period.
        </p>
      ) : null}
    </>
  );
}

export function InterruptionHistory({ snapshot }: { snapshot: InstanceUsageSnapshot }) {
  const events = snapshot.events
    .filter(
      (event) =>
        event.initiatedBy !== 'user' &&
        (event.type === 'interrupted' || event.type === 'reconnected'),
    )
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <>
      <UsageChart snapshot={snapshot} />
      <p className="form-note">
        Provider interruptions and automatic reconnections during your purchased usage period.
        Actions initiated by you are excluded.
      </p>
      {events.length ? (
        <ol className="instance-event-list">
          {events.map((event) => (
            <li key={event.id}>
              <span className={`instance-event-dot ${event.type}`} />
              <div>
                <strong>
                  {event.type === 'interrupted' ? 'Interrupted (billing paused)' : 'Reconnected'}
                </strong>
                <time dateTime={event.at}>{stampUtcFull(event.at)}</time>
                <p>{event.description}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="form-note">
          No non-user interruptions or reconnections are recorded for this period.
        </p>
      )}
    </>
  );
}

export function UsageDialog({ id, view }: { id: string; view: 'billing' | 'history' }) {
  const { openModal } = useTerminal();
  const { snapshot, query } = useInstanceUsage(id);
  const alternate = view === 'billing' ? 'history' : 'billing';
  return (
    <>
      {snapshot ? (
        view === 'billing' ? (
          <BillingHistory snapshot={snapshot} />
        ) : (
          <InterruptionHistory snapshot={snapshot} />
        )
      ) : (
        <p className="form-note" role="status">
          {query.isFetching
            ? 'Loading recorded history…'
            : 'Recorded usage and billing history are not connected yet. No charges or interruption events are estimated.'}
        </p>
      )}
      <div className="modal-footer">
        <IBtn act="instance-manage" onClick={() => openModal('instance-manage', { id })}>
          Back to instance
        </IBtn>
        <IBtn
          act={`instance-${alternate}`}
          onClick={() =>
            openModal(alternate === 'billing' ? 'instance-billing' : 'instance-history', {
              id,
            })
          }
        >
          {alternate === 'billing' ? 'Billing' : 'History'}
        </IBtn>
      </div>
    </>
  );
}
