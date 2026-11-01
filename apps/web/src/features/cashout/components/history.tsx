'use client';

import { money, stampUtc } from '@/lib/format';
import { useCashout } from '../hooks';

export function CashoutHistory() {
  const cashout = useCashout();
  return (
    <section className="panel cashout-history">
      <div className="bill-panel-head">
        <h2>Cashout requests</h2>
      </div>
      {!cashout.connected ? (
        <p className="form-note">
          Cashout processing is not connected yet. No request or bank details can be submitted.
        </p>
      ) : cashout.query.isError ? (
        <p className="form-note" role="alert">
          Cashout history is unavailable. Please refresh before making a request.
        </p>
      ) : !cashout.snapshot ? (
        <p className="form-note" role="status">
          Loading cashout requests…
        </p>
      ) : cashout.snapshot.requests.length ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Submitted (UTC)</th>
                <th>Amount</th>
                <th>Bank account</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {cashout.snapshot.requests.map((request) => (
                <tr key={request.id}>
                  <td>{stampUtc(request.submittedAt)}</td>
                  <td>{money(request.amountCents / 100)}</td>
                  <td>
                    {request.bankName} · {request.maskedAccount}
                  </td>
                  <td>
                    {request.status === 'completed'
                      ? 'Completed'
                      : request.status === 'failed'
                        ? 'Failed'
                        : 'Pending'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="form-note">No cashout requests yet.</p>
      )}
    </section>
  );
}
