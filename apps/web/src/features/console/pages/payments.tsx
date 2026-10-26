'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { stampUtc } from '@/lib/format';
import { Btn, DetailGrid, Empty, Head, SearchBox, Status } from '../components/forms';
import { filterPayments, paymentAmount, type OperationsPayment } from './operations-records';

/** Bank payment confirmation is a distinct workflow from approving credit top-ups. */
export function PaymentsPage({ payments }: { payments?: readonly OperationsPayment[] }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [selected, setSelected] = useState<OperationsPayment | null>(null);
  const list = filterPayments(payments ?? [], search, status);
  return (
    <>
      <Head
        title="Payment Requests"
        copy="Review bank payment references against confirmed receipts."
      />
      <p className="ops-state" role="status">
        Awaiting backend · Bank receipt verification and user notifications are not connected. No
        payment can be approved here yet.
      </p>
      <section className="panel">
        <div className="table-toolbar">
          <h2>Payment requests</h2>
          <SearchBox
            placeholder="Search email, order or payment reference…"
            value={search}
            onChange={setSearch}
          />
        </div>
        <div className="ops-filters">
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {['All', 'Awaiting confirmation', 'Confirmed', 'Rejected'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Order</th>
                <th>Amount</th>
                <th>Reference</th>
                <th>Submitted</th>
                <th>Status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {list.map((payment) => (
                <tr key={payment.id}>
                  <td>{payment.email}</td>
                  <td>{payment.orderId}</td>
                  <td>{paymentAmount(payment.amount, payment.currency)}</td>
                  <td>{payment.reference}</td>
                  <td>{stampUtc(payment.submittedAt)}</td>
                  <td>
                    <Status label={payment.status} />
                  </td>
                  <td>
                    <Btn className="small" onClick={() => setSelected(payment)}>
                      Details
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.length && (
          <Empty
            title={payments ? 'No matching payment requests' : 'Payment service awaiting backend'}
            copy={
              payments
                ? 'Try another status or search.'
                : 'Bank payment requests will appear here after the payment confirmation service is connected.'
            }
          />
        )}
      </section>
      {selected && (
        <Dialog
          overlayClassName="modal-backdrop"
          className="modal"
          label="Payment request details"
          onClose={() => setSelected(null)}
        >
          <div className="modal-head">
            <h2>Payment request details</h2>
          </div>
          <div className="modal-body">
            <DetailGrid
              items={[
                ['Email', selected.email],
                ['Order', selected.orderId],
                ['Amount', paymentAmount(selected.amount, selected.currency)],
                ['Reference', selected.reference],
                ['Submitted', stampUtc(selected.submittedAt)],
                ['Status', selected.status],
              ]}
            />
            <p>{selected.detail || 'No additional details supplied.'}</p>
            <p className="ops-state">
              Approval requires a verified bank receipt, an atomic order update and a notification
              to the account owner.
            </p>
          </div>
          <div className="modal-footer">
            <Btn onClick={() => setSelected(null)}>Close</Btn>
            <Btn disabled>Reject</Btn>
            <Btn className="primary" disabled>
              Approve
            </Btn>
          </div>
        </Dialog>
      )}
    </>
  );
}
