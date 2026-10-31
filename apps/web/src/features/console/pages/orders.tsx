'use client';

import { useState } from 'react';
import { stampUtc } from '@/lib/format';
import { Empty, Head, SearchBox, Status } from '../components/forms';
import { filterOrders, paymentAmount, type OperationsOrder } from './operations-records';

/** Read-only order table. The live route supplies authoritative orders from both backends. */
export function OrdersPage({
  orders,
  filters,
}: {
  orders?: readonly OperationsOrder[];
  filters?: {
    search: string;
    kind: string;
    state: string;
    onState: (value: string) => void;
    onSearch: (value: string) => void;
    onKind: (value: string) => void;
  };
}) {
  const [localSearch, setLocalSearch] = useState('');
  const [localKind, setLocalKind] = useState('All');
  const [localState, setLocalState] = useState('all');
  const state = filters?.state ?? localState;
  const setState = filters?.onState ?? setLocalState;
  const search = filters?.search ?? localSearch;
  const kind = filters?.kind ?? localKind;
  const setSearch = filters?.onSearch ?? setLocalSearch;
  const setKind = filters?.onKind ?? setLocalKind;
  const list = filterOrders(orders ?? [], search, kind, state);
  return (
    <>
      <Head
        title="Orders"
        copy="Instance purchases and RFQ orders, including completed and cancelled history."
      />
      {!orders && (
        <p className="ops-state" role="status">
          Awaiting backend · Platform-wide orders and payment confirmation are not connected.
        </p>
      )}
      <section className="panel">
        <div className="table-toolbar">
          <h2>Order history</h2>
          <SearchBox
            placeholder="Search order, email, model or country…"
            value={search}
            onChange={setSearch}
          />
        </div>
        <div className="ops-filters">
          <label>
            Order status
            <select value={state} onChange={(event) => setState(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="processing">In progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label>
            Order type
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              {['All', 'Instance', 'RFQ'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Type</th>
                <th>Email</th>
                <th>Model</th>
                <th>Capacity</th>
                <th>Country</th>
                <th>Terms</th>
                <th>Payment method</th>
                <th>Order limit</th>
                <th>Settled</th>
                <th>Status</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {list.map((order) => (
                <tr key={order.id}>
                  <td>{order.id}</td>
                  <td>{order.kind}</td>
                  <td>{order.email}</td>
                  <td>{order.model}</td>
                  <td>{order.gpuCount} GPUs</td>
                  <td>{order.country}</td>
                  <td>{order.term}</td>
                  <td>{order.paymentMethod ?? 'Unknown'}</td>
                  <td>
                    {order.amountKnown === false ? '—' : paymentAmount(order.total, order.currency)}
                  </td>
                  <td>
                    {order.settledTotal == null
                      ? '—'
                      : paymentAmount(order.settledTotal, order.currency)}
                  </td>
                  <td>
                    <Status label={order.status} />
                  </td>
                  <td>{stampUtc(order.submittedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.some((order) => order.amountKnown === false) ? (
          <p className="muted">
            Some historical orders have no linked payment record. Their amounts are shown as
            unknown, not inferred.
          </p>
        ) : null}
        {!list.length && (
          <Empty
            title={orders ? 'No matching orders' : 'Order service awaiting backend'}
            copy={
              orders
                ? 'Try another status, order type or search.'
                : 'Confirmed platform orders will appear here when the administrator order service is connected.'
            }
          />
        )}
      </section>
    </>
  );
}
