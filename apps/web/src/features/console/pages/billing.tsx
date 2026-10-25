'use client';

import { useConsoleStore } from '../store';
import { ConsoleIcon as Icon } from '@/components/icons';
import { money, omit } from '../helpers';
import { Badge, Btn, Head, Note } from '../components/forms';
import { useConsoleDialogs } from '../dialogs/use-dialogs';
import { usePageTools } from './use-page-tools';

export function BillingPage() {
  const db = useConsoleStore((s) => s.db);
  const dialogs = useConsoleDialogs();
  const { exportRows } = usePageTools('billing');
  const costs = [0.11, 0.08, 0.15, 0.1, 0.12, 0.09, 0.13, 0.07, 0.11, 0.12, 0.08, 0.1];
  const limit = db.spendLimit || 100;
  const stats: [string, string, string][] = [
    ['Workspace evaluation cost', '$1.26', 'Current billing period'],
    ['Monthly spending limit', money(limit), 'Operator-controlled cap'],
    ['Billable provider actions', '0', 'No connected execution service'],
    ['Payment status', 'Not connected', 'External settlement integration pending'],
  ];
  return (
    <>
      <Head
        title="Agent billing"
        copy="Review evaluation usage, spending limits and internal cost records."
        actions={
          <>
            <Btn
              className="btn-icon"
              onClick={() => exportRows(db.runs.map((x) => omit(x, 'log')))}
            >
              <Icon name="export" />
              Export
            </Btn>
            <Btn className="primary" onClick={dialogs.billingLimit}>
              Manage spending limit
            </Btn>
          </>
        }
      />
      <div className="stats">
        {stats.map(([l, v, f]) => (
          <div className="stat" key={l}>
            <div className="stat-label">{l}</div>
            <div className="stat-value" style={{ fontSize: v.length > 10 ? 18 : 24 }}>
              {v}
            </div>
            <div className="stat-foot">{f}</div>
          </div>
        ))}
      </div>
      <div className="grid-two">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Evaluation usage</h2>
              <p>Cost allocation across scheduled and manual evaluations.</p>
            </div>
            <span className="muted tiny">October 2026</span>
          </div>
          <div className="panel-body billing-chart-wrap">
            <div className="billing-chart">
              {costs.map((v, i) => (
                <div
                  className="billing-bar"
                  key={i}
                  style={{ height: `${(v / 0.15) * 100}%` }}
                  title={`Oct ${i + 1}: ${money(v)}`}
                >
                  <span>{String(i + 1).padStart(2, '0')}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Cost breakdown</h2>
          </div>
          <div className="panel-body">
            <div className="spend-line">
              <span>Market evaluations</span>
              <strong>$0.74</strong>
            </div>
            <div className="spend-line">
              <span>Plan analysis</span>
              <strong>$0.38</strong>
            </div>
            <div className="spend-line">
              <span>Evidence validation</span>
              <strong>$0.14</strong>
            </div>
            <div
              className="spend-line"
              style={{ borderTop: '1px solid var(--line)', paddingTop: 13, marginTop: 14 }}
            >
              <strong>Total allocated cost</strong>
              <strong>$1.26</strong>
            </div>
            <div className="progress-track">
              <span style={{ width: `${Math.max(1, Math.min(100, (1.26 / limit) * 100))}%` }} />
            </div>
            <p className="tiny muted" style={{ marginTop: 9 }}>
              {((1.26 / limit) * 100).toFixed(2)}% of the monthly cap
            </p>
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Usage ledger</h2>
          <Badge label="Internal records" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Operation</th>
                <th>Actor</th>
                <th>Date</th>
                <th>Cost</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {db.runs.slice(0, 10).map((x, i) => (
                <tr key={x.id}>
                  <td className="mono">{x.id}</td>
                  <td>{x.name}</td>
                  <td>{x.trigger}</td>
                  <td>{x.time}</td>
                  <td>{money([0.08, 0.11, 0.09][i % 3])}</td>
                  <td>
                    <Badge label="Allocated" tone="blue" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Note />
    </>
  );
}
