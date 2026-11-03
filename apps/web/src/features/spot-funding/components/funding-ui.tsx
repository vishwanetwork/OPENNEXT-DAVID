'use client';

import type { ReactNode } from 'react';
import type { SpotFundingPosition, SpotFundingOrder } from '@/lib/spot-funding';
import { money, stampUtc } from '@/lib/format';
import { useTerminal } from '@/terminal-kit';

export const fundingMoney = (cents: number | null) => money(cents === null ? null : cents / 100);
export const runtimeHours = (seconds: number) =>
  (seconds / 3600).toLocaleString('en-US', { maximumFractionDigits: 2 });

export function FundingMetric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="spot-funding-metric">
      <small>{label}</small>
      <strong>{children}</strong>
    </div>
  );
}

export function AddFundingButton() {
  const { openModal } = useTerminal();
  return (
    <button type="button" className="btn small" onClick={() => openModal('pay-start')}>
      Add credit
    </button>
  );
}

export function FundingWarning({ position }: { position: SpotFundingPosition }) {
  if (position.status === 'unavailable') return null;
  const low = position.warnings.includes('remaining_20_percent');
  const shortfall = position.warnings.includes('projected_shortfall');
  const unfunded = position.warnings.includes('next_hour_unfunded');
  if (!low && !shortfall && !unfunded && !['low', 'insufficient'].includes(position.status))
    return null;
  return (
    <div className="spot-funding-warning" role="status">
      {low ? (
        <p>20% or less of the funding baseline remains. Add credit to keep capacity funded.</p>
      ) : null}
      {shortfall ? (
        <p>At the latest recorded rate, funding may not cover all remaining purchased hours.</p>
      ) : null}
      {!low && !shortfall && !unfunded && position.status === 'low' ? (
        <p>Funding is low. Review the recorded funding position and add credit.</p>
      ) : null}
      {unfunded || position.status === 'insufficient' ? (
        <p>The next hour is not fully funded. Review the instance status and add funds.</p>
      ) : (
        <p>
          This warning does not stop a running instance. Running continues while the next hour is
          funded.
        </p>
      )}
    </div>
  );
}

const runtimeLabels: Record<SpotFundingOrder['runtimeState'], string> = {
  waiting: 'Waiting for capacity',
  running: 'Running',
  reconnecting: 'Reconnecting',
  paused_insufficient_funds: 'Paused — insufficient funds',
  ended: 'End',
};

export function FundingRuntime({ order }: { order: SpotFundingOrder }) {
  const interrupted = ['reconnecting', 'paused_insufficient_funds'].includes(order.runtimeState);
  const reasons = {
    price_unavailable: 'A current allocation price could not be verified.',
    hourly_limit: 'The current hourly price exceeds your accepted hourly limit.',
    total_limit: 'Additional funding would exceed your accepted total budget.',
    execution_review: 'Execution authorization requires a fresh price and funding review.',
    insufficient_funding:
      'Confirmed funding does not cover the next usage period and storage reserve.',
  };
  return (
    <div className="spot-funding-runtime" data-funding-runtime={order.runtimeState}>
      <span className="tag">{runtimeLabels[order.runtimeState]}</span>
      {order.runtimeState === 'paused_insufficient_funds' && order.pauseReason ? (
        <p>{reasons[order.pauseReason]}</p>
      ) : null}
      {order.runtimeState === 'paused_insufficient_funds' ? (
        <p>
          Runtime and compute billing are paused after funding became insufficient. The pause
          remains until the service confirms funding, available capacity and resumption of your
          remaining purchased hours.
        </p>
      ) : null}
      {interrupted ? (
        <p>
          {order.retention === 'confirmed'
            ? 'Your data is retained. You do not need to upload it again after reconnection.'
            : order.retention === 'pending'
              ? 'Data retention has not been confirmed yet. Verification is pending; contact support before assuming your data is preserved.'
              : 'Data retention information is unavailable. Contact support to check whether your data can be restored.'}
        </p>
      ) : null}
      {order.retentionExpiresAt ? (
        <p className="form-note">
          Data retention ends {stampUtc(order.retentionExpiresAt)}. Retained data is deleted after
          this deadline.
        </p>
      ) : null}
    </div>
  );
}

export function FundingPositionMetrics({ position }: { position: SpotFundingPosition }) {
  if (position.status === 'unavailable')
    return <p className="spot-funding-note">Funding coverage is not available yet.</p>;
  return (
    <div className="spot-funding-metrics">
      <FundingMetric label="Funding remaining">
        {fundingMoney(position.remainingCents)}
      </FundingMetric>
      <FundingMetric label="Current funding baseline">
        {fundingMoney(position.baselineCents)}
      </FundingMetric>
      <FundingMetric label="Remaining / baseline">
        {position.remainingPercent === null
          ? 'Not available'
          : `${position.remainingPercent.toFixed(1)}%`}
      </FundingMetric>
      <FundingMetric label="Next hour required">
        {fundingMoney(position.nextHourRequiredCents)}
      </FundingMetric>
      <FundingMetric label="Estimated remaining runtime cost">
        {fundingMoney(position.projectedRemainingCents)}
      </FundingMetric>
    </div>
  );
}

export function FundingHelp({ directPay = false }: { directPay?: boolean }) {
  const { go } = useTerminal();
  return (
    <div className="spot-funding-help">
      {directPay ? (
        <p>
          Direct Pay funds belong to this order and are separate from shared account Credit. Adding
          Credit does not guarantee allocation to this Direct Pay order; contact support to confirm
          how to replenish it.
        </p>
      ) : null}
      <div className="spot-funding-actions">
        <AddFundingButton />
        {directPay ? (
          <button type="button" className="btn secondary small" onClick={() => go('help')}>
            Contact support
          </button>
        ) : null}
      </div>
    </div>
  );
}
