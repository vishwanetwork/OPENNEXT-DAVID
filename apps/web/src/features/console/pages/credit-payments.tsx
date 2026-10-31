'use client';

import { useState } from 'react';
import { stampUtc } from '@/lib/format';
import { LiveFrame, LivePagination } from '../components/live-frame';
import { useConsoleResource } from '../live-hooks';
import { Head, SearchBox, Status } from '../components/forms';
import { paymentAmount } from './operations-records';

const labels: Record<string, string> = {
  held: 'Credit held',
  charged: 'Credit committed',
  billed: 'Settled',
  refunded: 'Refunded',
};

export function CreditPaymentsPage() {
  const [search, setSearch] = useState('');
  const [paymentState, setPaymentState] = useState('all');
  const [cursors, setCursors] = useState(['']);
  const state = useConsoleResource('creditPayments', {
    cursor: cursors[cursors.length - 1] ?? '',
    limit: '50',
    search,
    paymentState,
  });
  return (
    <LiveFrame title="Credit payments" state={state}>
      <Head
        title="Credit purchase records"
        copy="Credit holds, final usage charges and released amounts. Direct Pay bank transfers are listed separately."
      />
      <section className="panel">
        <div className="table-toolbar">
          <h2>Credit purchase history</h2>
          <SearchBox
            placeholder="Search email or order reference…"
            value={search}
            onChange={(value) => {
              setSearch(value);
              setCursors(['']);
            }}
          />
        </div>
        <div className="ops-filters">
          <label>
            Payment status
            <select
              value={paymentState}
              onChange={(event) => {
                setPaymentState(event.target.value);
                setCursors(['']);
              }}
            >
              <option value="all">All statuses</option>
              {Object.entries(labels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  'Order',
                  'Email',
                  'Payment method',
                  'Order limit',
                  'Settled',
                  'Released',
                  'Status',
                  'Submitted',
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.data?.payments.map((row) => (
                <tr key={row.id}>
                  <td>{row.orderId}</td>
                  <td>{row.email}</td>
                  <td>Credit</td>
                  <td>{paymentAmount(row.authorizedCents / 100, row.currency)}</td>
                  <td>
                    {row.settledCents == null
                      ? '—'
                      : paymentAmount(row.settledCents / 100, row.currency)}
                  </td>
                  <td>{paymentAmount(row.releasedCents / 100, row.currency)}</td>
                  <td>
                    <Status label={labels[row.state] ?? row.state} />
                  </td>
                  <td>{stampUtc(row.submittedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {state.data?.payments.length === 0 ? (
          <p className="muted">No matching Credit purchase records.</p>
        ) : null}
      </section>
      <p className="muted">
        {state.data?.total ?? 0} matching Credit purchase records. Order limits are holds, not final
        usage charges.
      </p>
      <LivePagination
        next={state.data?.nextCursor ?? null}
        previous={cursors.length > 1}
        onNext={() => {
          if (state.data?.nextCursor) setCursors([...cursors, state.data.nextCursor]);
        }}
        onPrevious={() => setCursors(cursors.slice(0, -1))}
      />
    </LiveFrame>
  );
}
