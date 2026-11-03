'use client';

import { useSpotFundingAccount } from '../hooks';
import { FundingHelp, FundingRuntime, FundingWarning } from './funding-ui';

export function SpotFundingAlerts() {
  const { snapshot } = useSpotFundingAccount();
  if (!snapshot) return null;
  const accountWarning =
    snapshot.credit.status !== 'unavailable' &&
    (snapshot.credit.warnings.length > 0 ||
      ['low', 'insufficient'].includes(snapshot.credit.status));
  const orders = snapshot.orders.filter(
    (order) =>
      order.runtimeState !== 'ended' &&
      ((order.funding.status !== 'unavailable' &&
        (order.funding.warnings.length > 0 ||
          ['low', 'insufficient'].includes(order.funding.status))) ||
        order.runtimeState === 'paused_insufficient_funds'),
  );
  if (!accountWarning && !orders.length) return null;
  return (
    <aside className="spot-funding-alerts" aria-label="Spot funding alerts">
      <div className="spot-funding-heading">
        <h2>Spot funding needs attention</h2>
        <FundingHelp />
      </div>
      {accountWarning ? (
        <section>
          <h3>Shared account Credit</h3>
          <FundingWarning position={snapshot.credit} />
        </section>
      ) : null}
      {orders.map((order) => (
        <section key={order.orderId}>
          <h3>
            {order.model} · {order.orderId}
          </h3>
          <FundingRuntime order={order} />
          <FundingWarning position={order.funding} />
          {order.paymentMethod === 'Direct Pay' ? (
            <p className="spot-funding-note">
              This order uses dedicated Direct Pay funds. Contact support to confirm replenishment;
              adding Credit does not automatically fund it.
            </p>
          ) : null}
        </section>
      ))}
    </aside>
  );
}
