'use client';

import { num, seriesFor, usd, type Analytics, type BillingData } from '../analytics';
import { Btn } from './billing-ui';

export function DailyTable({
  billing,
  a,
  onExport,
}: {
  billing: BillingData;
  a: Analytics;
  onExport: (type: string) => void;
}) {
  const columns = seriesFor(billing.role);
  const hasActivity = a.rows.some((row) => columns.some(([key]) => Math.abs(num(row[key])) > 0));
  const rows = hasActivity ? a.rows.slice().reverse() : a.rows.slice(-1);
  const emptyLabel =
    billing.role === 'buyer'
      ? 'No spent history yet'
      : billing.role === 'seller'
        ? 'No earnings history yet'
        : 'No financial history yet';
  return (
    <section className="panel">
      <div className="bill-panel-head">
        <h2>
          Daily {billing.role === 'buyer' ? 'spend' : 'financial'} details
          {a.sample ? ' · example' : ''}
        </h2>
        <Btn act="bill-export" value="daily" onClick={() => onExport('daily')}>
          Export daily data
        </Btn>
      </div>
      <div className="table-scroll bill-daily-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date · UTC</th>
              {columns.map(([, label]) => (
                <th key={label}>{label}</th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day}>
                <td>{r.day}</td>
                {columns.map(([key]) => (
                  <td key={key} className="bill-number">
                    {usd(r[key])}
                  </td>
                ))}
                <td className="bill-number">
                  <strong>{usd(columns.reduce((sum, [k]) => sum + r[k], 0))}</strong>
                </td>
              </tr>
            ))}
            {hasActivity ? null : (
              <tr className="bill-daily-empty">
                <td colSpan={columns.length + 2}>
                  <div>{emptyLabel}</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
export { Activity } from './activity-panels';
export { CapacityPanel } from './capacity-panel';
export { Payouts } from './activity-panels';
