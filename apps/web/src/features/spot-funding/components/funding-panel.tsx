'use client';

import { useState } from 'react';
import type { SpotFundingAccount } from '@/lib/spot-funding';
import { stampUtc } from '@/lib/format';
import { useSpotFundingAccount } from '../hooks';
import {
  FundingHelp,
  FundingPositionMetrics,
  FundingWarning,
  fundingMoney,
  runtimeHours,
} from './funding-ui';
import { SpotOrderBillingContent } from './order-billing';

export function FundingAccountSummary({ snapshot }: { snapshot: SpotFundingAccount }) {
  return (
    <div className="spot-funding-account">
      <div className="spot-funding-heading">
        <h3>Shared account Credit</h3>
        <span>{snapshot.activeCreditOrders} active Credit-funded orders</span>
      </div>
      <FundingPositionMetrics position={snapshot.credit} />
      <p className="spot-funding-note">
        Server totals cover all active Credit-funded orders, including orders outside this list.
        Direct Pay order funds are separate and are not included in these account totals.
      </p>
      <FundingWarning position={snapshot.credit} />
    </div>
  );
}

export function SpotFundingPanel() {
  const { snapshot, query, connected } = useSpotFundingAccount();
  const [selected, setSelected] = useState('');
  const selectedOrder = snapshot?.orders.find((order) => order.orderId === selected);
  return (
    <section className="panel spot-funding-panel" aria-label="Spot funding and hourly billing">
      <div className="spot-funding-heading">
        <div>
          <h2>Spot funding &amp; hourly billing</h2>
          <p>Recorded prices, funding and cumulative runtime.</p>
        </div>
        {snapshot ? <FundingHelp /> : null}
      </div>
      {!snapshot ? (
        <p className="spot-funding-note" role="status">
          {!connected
            ? 'Hourly Spot billing is not connected yet.'
            : query.isFetching
              ? 'Loading Spot funding…'
              : 'Spot funding could not be verified. No balances or hourly rates are estimated.'}
        </p>
      ) : (
        <>
          <FundingAccountSummary snapshot={snapshot} />
          <small className="spot-funding-asof">Updated {stampUtc(snapshot.observedAt)}</small>
          <div
            className="spot-funding-table-wrap"
            tabIndex={0}
            aria-label="Scrollable Spot orders table"
          >
            <table>
              <thead>
                <tr>
                  <th>Order / model</th>
                  <th>Funding</th>
                  <th>Latest rate / hour</th>
                  <th>Runtime remaining</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {snapshot.orders.map((order) => (
                  <tr key={order.orderId}>
                    <td>
                      <strong>{order.model}</strong>
                      <small>{order.orderId}</small>
                    </td>
                    <td>
                      {fundingMoney(
                        order.funding.status === 'unavailable'
                          ? null
                          : order.funding.remainingCents,
                      )}
                      <small>{order.paymentMethod}</small>
                    </td>
                    <td>{fundingMoney(order.currentHourlyCents)}</td>
                    <td>{runtimeHours(order.remainingSeconds)} hours</td>
                    <td>
                      <button
                        type="button"
                        className="btn secondary small"
                        aria-label={`View hourly billing for ${order.orderId}`}
                        aria-pressed={selectedOrder?.orderId === order.orderId}
                        onClick={() => setSelected(order.orderId)}
                      >
                        View details
                      </button>
                    </td>
                  </tr>
                ))}
                {!snapshot.orders.length ? (
                  <tr>
                    <td colSpan={5}>No Spot funding records are available.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {!snapshot.ordersComplete ? (
            <p className="spot-funding-note">
              This order list is partial. Account funding still includes all active Credit-funded
              orders.
            </p>
          ) : null}
          {selectedOrder ? (
            <SpotOrderBillingContent
              key={selectedOrder.orderId}
              lookup={{ orderId: selectedOrder.orderId }}
            />
          ) : null}
        </>
      )}
      {connected ? (
        <div className="spot-funding-actions">
          {query.isError ? (
            <p role="status">The latest funding update could not be loaded.</p>
          ) : null}
          <button
            type="button"
            className="btn secondary small"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? 'Refreshing…' : 'Refresh funding'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
