'use client';

import { useState } from 'react';
import type { SpotFundingLookup, SpotFundingOrder } from '@/lib/spot-funding';
import { stampUtc } from '@/lib/format';
import { useSpotFundingOrder } from '../hooks';
import {
  FundingHelp,
  FundingMetric,
  FundingPositionMetrics,
  FundingRuntime,
  FundingWarning,
  fundingMoney,
  runtimeHours,
} from './funding-ui';
import { HourlySpotLedger } from './hourly-ledger';
import { OrderFundingActions } from './order-funding-actions';

export function SpotOrderSummary({ order }: { order: SpotFundingOrder }) {
  return (
    <div className="spot-funding-order-summary">
      <div className="spot-funding-heading">
        <div>
          <h3>{order.model}</h3>
          <small>
            {order.orderId} · {order.paymentMethod}
          </small>
        </div>
        <FundingRuntime order={order} />
      </div>
      <div className="spot-funding-metrics">
        <FundingMetric label="Initial payment">
          {fundingMoney(order.initialPaymentCents)}
        </FundingMetric>
        <FundingMetric label="Rate at purchase / hour">
          {fundingMoney(order.initialHourlyCents)}
        </FundingMetric>
        <FundingMetric label="Latest recorded rate / hour">
          {fundingMoney(order.currentHourlyCents)}
        </FundingMetric>
        <FundingMetric label="Cumulative runtime remaining">
          {runtimeHours(order.remainingSeconds)} / {runtimeHours(order.purchasedSeconds)} hours
        </FundingMetric>
        {order.storageReserveCents !== undefined ? (
          <FundingMetric label="Storage reserve remaining">
            {fundingMoney(order.storageReserveCents)}
          </FundingMetric>
        ) : null}
        {order.maxHourlyCents !== undefined ? (
          <FundingMetric label="Accepted hourly limit">
            {fundingMoney(order.maxHourlyCents)}
          </FundingMetric>
        ) : null}
        {order.maxTotalCents !== undefined ? (
          <FundingMetric label="Accepted total funding limit">
            {fundingMoney(order.maxTotalCents)}
          </FundingMetric>
        ) : null}
        {order.totalFundedCents !== undefined ? (
          <FundingMetric label="Total funding allocated">
            {fundingMoney(order.totalFundedCents)}
          </FundingMetric>
        ) : null}
      </div>
      <FundingPositionMetrics position={order.funding} />
      <p className="spot-funding-note">
        The initial payment uses the price at purchase; it does not lock future hourly rates.
        Remaining runtime is cumulative running time, not a fixed end date. Funding percentages use
        the current server-recorded funding baseline, which may change after replenishment.
      </p>
      <FundingWarning position={order.funding} />
      <FundingHelp directPay={order.paymentMethod === 'Direct Pay'} />
      <OrderFundingActions order={order} />
    </div>
  );
}

export function SpotOrderBillingContent({ lookup }: { lookup: SpotFundingLookup }) {
  const [cursor, setCursor] = useState('');
  const { snapshot, query, connected } = useSpotFundingOrder(lookup, cursor);
  return (
    <div className="spot-order-billing">
      {!snapshot ? (
        <p className="spot-funding-note" role="status">
          {!connected
            ? 'Hourly Spot billing is not connected yet.'
            : query.isFetching
              ? 'Loading hourly Spot billing…'
              : 'Hourly Spot billing could not be verified. No rates or charges are estimated.'}
        </p>
      ) : (
        <>
          <SpotOrderSummary order={snapshot.order} />
          <small className="spot-funding-asof">Updated {stampUtc(snapshot.observedAt)}</small>
          <HourlySpotLedger ledger={snapshot.ledger} />
        </>
      )}
      {query.isError ? (
        <p className="spot-funding-note" role="status">
          The latest billing update could not be loaded.
        </p>
      ) : null}
      <div className="spot-funding-actions">
        {connected ? (
          <button
            type="button"
            className="btn secondary small"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? 'Refreshing…' : 'Refresh billing'}
          </button>
        ) : null}
        {cursor ? (
          <button
            type="button"
            className="btn secondary small"
            disabled={query.isFetching}
            onClick={() => setCursor('')}
          >
            First page
          </button>
        ) : null}
        {snapshot?.ledger.nextCursor ? (
          <button
            type="button"
            className="btn secondary small"
            disabled={query.isFetching}
            onClick={() => setCursor(snapshot.ledger.nextCursor ?? '')}
          >
            Next page
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function SpotOrderBilling({ instanceId }: { instanceId: string }) {
  return <SpotOrderBillingContent key={instanceId} lookup={{ instanceId }} />;
}
