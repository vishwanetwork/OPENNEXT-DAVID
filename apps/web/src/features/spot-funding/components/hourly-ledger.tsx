'use client';

import type { SpotFundingOrderDetail } from '@/lib/spot-funding';
import { stampUtc } from '@/lib/format';
import { fundingMoney, runtimeHours } from './funding-ui';

export function HourlySpotLedger({ ledger }: { ledger: SpotFundingOrderDetail['ledger'] }) {
  return (
    <section className="spot-hourly-ledger" aria-label="Hourly Spot charges">
      <div className="spot-funding-heading">
        <h3>Hourly Spot charges</h3>
        <span>
          Recorded total <strong>{fundingMoney(ledger.totalCents)}</strong>
        </span>
      </div>
      <p className="spot-funding-note">
        Rates are for the whole instance per hour. Each amount is recorded by the billing service;
        current market prices are not used to recalculate past charges.
      </p>
      <div
        className="spot-funding-table-wrap"
        tabIndex={0}
        aria-label="Scrollable hourly billing table"
      >
        <table>
          <thead>
            <tr>
              <th>Usage period (UTC)</th>
              <th>Rate / hour</th>
              <th>Billable time</th>
              <th>Compute</th>
              <th>Adjustment</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {ledger.entries.map((entry) => (
              <tr key={entry.id}>
                <td>
                  {stampUtc(entry.startedAt)}
                  <small>to {stampUtc(entry.endedAt)}</small>
                  {entry.explanation ? <small>{entry.explanation}</small> : null}
                </td>
                <td>{fundingMoney(entry.hourlyCents)}</td>
                <td>{runtimeHours(entry.billableSeconds)} hours</td>
                <td>{fundingMoney(entry.computeCents)}</td>
                <td>{fundingMoney(entry.adjustmentCents)}</td>
                <td>{fundingMoney(entry.totalCents)}</td>
              </tr>
            ))}
            {!ledger.entries.length ? (
              <tr>
                <td colSpan={6}>No hourly charges are recorded on this page.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {!ledger.complete ? (
        <p className="spot-funding-note">
          This is a partial ledger. The recorded total can include charges outside this page.
        </p>
      ) : null}
    </section>
  );
}
