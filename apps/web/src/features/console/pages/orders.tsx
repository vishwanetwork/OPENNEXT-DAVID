'use client';

import { useEffect } from 'react';
import { useConsoleStore } from '../store';
import { ConsoleIcon as Icon } from '@/components/icons';
import { matchesQuery, money, omit } from '../helpers';
import { Btn, Empty, Head, Note, SearchBox, Status } from '../components/forms';
import { useConsoleDialogs } from '../dialogs/use-dialogs';
import { useDetailRequestStore } from '../detail-request';
import { usePageTools } from './use-page-tools';

export function OrdersPage() {
  const db = useConsoleStore((s) => s.db);
  const dialogs = useConsoleDialogs();
  const { search, setSearch, refresh, exportRows } = usePageTools('orders');
  const pending = useDetailRequestStore((s) => s.pending);
  const consume = useDetailRequestStore((s) => s.consume);
  useEffect(() => {
    const id = pending?.kind === 'order' ? consume('order') : null;
    if (id) dialogs.orderDetail(id);
  }, [pending, consume, dialogs]);
  const list = db.orders.filter((x) => matchesQuery(x, search));
  const stats: [string, string | number, string][] = [
    [
      'Accepted quote value',
      money(db.orders.reduce((a, x) => a + x.total, 0)),
      'Across all stages',
    ],
    [
      'Awaiting funds',
      db.orders.filter((x) => x.stage === 1).length,
      'Reference confirmation required',
    ],
    ['Reserved', db.orders.filter((x) => x.stage === 2).length, 'Preparing delivery'],
    ['Delivered', db.orders.filter((x) => x.stage === 3).length, 'Acceptance recorded'],
  ];
  return (
    <>
      <Head
        title="Orders"
        copy="Follow each accepted quote through funding confirmation, allocation and delivery."
        actions={
          <>
            <Btn
              className="btn-icon"
              onClick={() => exportRows(db.orders.map((x) => omit(x, 'events')))}
            >
              <Icon name="export" />
              Export
            </Btn>
            <Btn className="btn-icon" onClick={refresh}>
              <Icon name="refresh" />
              Refresh
            </Btn>
          </>
        }
      />
      <div className="stats">
        {stats.map(([l, v, f]) => (
          <div className="stat" key={l}>
            <div className="stat-label">{l}</div>
            <div className="stat-value" style={{ fontSize: 23 }}>
              {v}
            </div>
            <div className="stat-foot">{f}</div>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="table-toolbar">
          <h2>Order ledger</h2>
          <SearchBox
            placeholder="Search order, buyer or GPU…"
            value={search}
            onChange={setSearch}
          />
        </div>
        {list.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order / buyer</th>
                  <th>Allocation</th>
                  <th>Seller</th>
                  <th>Total</th>
                  <th>Progress</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <strong>{x.id}</strong>
                      <small>{x.buyer}</small>
                    </td>
                    <td>
                      <strong>
                        {x.count} × {x.model}
                      </strong>
                      <small>
                        {x.region} · {x.period}
                      </small>
                    </td>
                    <td>{x.seller}</td>
                    <td>{money(x.total)}</td>
                    <td>
                      <div className="order-stage">
                        {[0, 1, 2, 3].map((s) => (
                          <i key={s} className={s <= x.stage ? 'done' : ''} />
                        ))}
                      </div>
                    </td>
                    <td>
                      <Status label={x.status} />
                    </td>
                    <td>
                      <Btn className="link small" onClick={() => dialogs.orderDetail(x.id)}>
                        Manage
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No orders found" copy="Try searching a buyer or model." />
        )}
      </section>
      <Note />
    </>
  );
}
