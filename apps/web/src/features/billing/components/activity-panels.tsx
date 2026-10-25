'use client';

import { useTerminal } from '@/terminal-kit';
import { activityRows, stamp, usd, type BillingData } from '../analytics';
import { Btn } from './billing-ui';

export function Activity({ S, onExport }: { S: BillingData; onExport: (type: string) => void }) {
  const { openModal } = useTerminal();
  const rows = activityRows(S);
  return (
    <section className="panel bill-activity">
      <div className="bill-panel-head">
        <div>
          <h2>Activity</h2>
          <p>Your account records · test transactions are identified individually</p>
        </div>
        <Btn act="bill-export" value="activity" onClick={() => onExport('activity')}>
          Export CSV
        </Btn>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Description</th>
              <th>Date · UTC</th>
              <th>Status</th>
              <th>Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.orderId ? (
                      <button
                        type="button"
                        className="detail-link bill-order-link"
                        data-act="bill-order"
                        data-id={l.orderId}
                        onClick={() => openModal('bill-order', { id: String(l.orderId) })}
                      >
                        {l.orderId}
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {l.type}
                    {l.test ? <small className="bill-test-tag">Test transaction</small> : null}
                    <small className="bill-row-meta">{l.id}</small>
                  </td>
                  <td>{stamp(l.createdAt || l.date)}</td>
                  <td>
                    <span className="tag">{l.status || 'Posted'}</span>
                  </td>
                  <td className={`bill-number ${l.displayAmount > 0 ? 'positive' : ''}`}>
                    {l.displayAmount > 0 ? '+' : ''}
                    {usd(l.displayAmount)}
                  </td>
                  <td>
                    <Btn
                      act={l.orderId ? 'bill-order' : 'bill-record'}
                      id={l.orderId || l.id}
                      onClick={() =>
                        openModal(l.orderId ? 'bill-order' : 'bill-record', {
                          id: l.orderId || l.id,
                        })
                      }
                    >
                      View details
                    </Btn>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state">
                    <strong>No account activity yet</strong>Add credit or complete an order to begin
                    your account history.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Payouts({ S }: { S: BillingData }) {
  const { openModal } = useTerminal();
  if (S.role === 'buyer') return null;
  return (
    <section className="panel">
      <div className="bill-panel-head">
        <div>
          <h2>Payouts</h2>
          <p>Funds are reserved when a cashout request is submitted.</p>
        </div>
        <Btn act="cashout-start" onClick={() => openModal('cashout-start')}>
          Cash out
        </Btn>
      </div>
      {S.payouts.length ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Payout</th>
                <th>Destination</th>
                <th>Requested</th>
                <th>Amount</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {S.payouts.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.destination}</td>
                  <td>{stamp(p.createdAt)}</td>
                  <td>{usd(p.amount)}</td>
                  <td>
                    {p.status} {p.test ? <small className="bill-test-tag">Test</small> : null}
                  </td>
                  <td>
                    <Btn
                      act="cashout-detail"
                      id={p.id}
                      onClick={() => openModal('cashout-detail', { id: p.id })}
                    >
                      View details
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <strong>No payouts yet</strong>Settled sale proceeds become available for withdrawal.
          Prepaid purchasing credit cannot be cashed out.
        </div>
      )}
    </section>
  );
}
