'use client';

import { useState } from 'react';
import type { Order, OwnedRfq } from '@opennext/contracts';
import { money } from '@/lib/format';
import { csvFrom, downloadText, useTerminal, useWorkspaceData } from '@/terminal-kit';
import { useOwnedRfqs } from '../records';
import { maximumQuotePrice } from '../fees';
import { unitSuffix } from '../exchange';
import { useProcurementUi } from '../ui-store';
import { NotificationsPanel } from './notifications';
import { PBtn, Tag, rfqStatus, volume } from './shared';

const FILTERS = [
  'All',
  'Reviewing',
  'Live RFQ',
  'Quoted',
  'Rejected',
  'Confirmed',
  'Provisioning',
  'Active',
  'Completed',
  'Cancelled',
];

function RfqRow({ r, hidden }: { r: OwnedRfq; hidden: boolean }) {
  const { openModal } = useTerminal();
  const pending = (r.quotes || []).filter((q) => q.status === 'Pending').length;
  const maximum = maximumQuotePrice(r);
  return (
    <tr
      data-search-item={[r.id, r.title, r.model, r.region, r.notes, r.term].join(' ')}
      hidden={hidden}
      data-rfq-kind={r.kind === 'model_capacity' ? 'model_capacity' : undefined}
    >
      <td>
        <strong>{r.model}</strong>
        <small className="proc-sub">
          {r.region} · {r.term || 'Model capacity'}
          <br />
          {volume(r)}
        </small>
        <Tag>{rfqStatus(r)}</Tag>
      </td>
      <td>
        {r.vcpu ? r.vcpu + ' vCPU' : 'Not specified'}
        <small className="proc-sub">
          {r.memory ? r.memory + ' GB / GPU' : 'Memory not specified'}
        </small>
      </td>
      <td>
        <strong>{maximum === null ? 'To confirm' : money(maximum)}</strong>
        <small className="proc-sub">
          {money(r.budget)}
          {unitSuffix(r)}
        </small>
        {pending ? (
          <PBtn
            data-act="view-rfq"
            data-id={r.id}
            onClick={() =>
              openModal(r.kind === 'model_capacity' ? 'model-rfq' : 'rfq', { id: r.id })
            }
          >
            Review quotes ({pending})
          </PBtn>
        ) : null}
      </td>
      <td>
        <PBtn
          data-act="proc-request-details"
          data-id={r.id}
          onClick={() => openModal('proc-request-details', { id: r.id })}
        >
          Details
        </PBtn>
      </td>
    </tr>
  );
}

/** RFQs & Quote (buyer) / RFQs & mandates (broker) — legacy `page(c)`. */
export function RfqPage() {
  const { openModal } = useTerminal();
  const rfqs = useOwnedRfqs();
  const orders = useWorkspaceData().orders as Order[];
  const { rfqFilter, setRfqFilter } = useProcurementUi();
  const [query, setQuery] = useState('');
  const q = query.toLowerCase();
  const rows = rfqs.filter(
    (r) =>
      !rfqFilter || rfqFilter === 'All' || r.status === rfqFilter || rfqStatus(r) === rfqFilter,
  );
  const stats: [string, number][] = [
    ['Open requirements', rfqs.filter((r) => r.status === 'Open').length],
    [
      'Quotes to review',
      rfqs.reduce((n, r) => n + (r.quotes || []).filter((x) => x.status === 'Pending').length, 0),
    ],
    [
      'Orders in progress',
      orders.filter((o) => !['Completed', 'Cancelled'].includes(o.status)).length,
    ],
  ];
  const exportCsv = () =>
    downloadText(
      'OpenNEXT-rfqs.csv',
      csvFrom(rfqs as Record<string, unknown>[]),
      'text/csv;charset=utf-8',
    );
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <h1>RFQs & Quote</h1>
          <p>Keep requirements, competing quotes, decisions and delivery together.</p>
        </div>
        <PBtn primary data-act="new-rfq" onClick={() => openModal('rfq-form')}>
          Post RFQ
        </PBtn>
      </div>
      <div className="stat-grid">
        {stats.map(([t, n]) => (
          <div key={t} className="stat-card">
            <span>{t}</span>
            <strong>{n}</strong>
          </div>
        ))}
      </div>
      <div className="panel">
        <div className="toolbar">
          <input
            className="field"
            data-search="rfqs"
            placeholder="Search model, country, market terms or requirements…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="field proc-filter"
            data-proc-filter="rfqFilter"
            aria-label="RFQ status"
            value={rfqFilter || 'All'}
            onChange={(e) => setRfqFilter(e.target.value)}
          >
            {FILTERS.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <PBtn data-act="export" data-value="rfqs" onClick={exportCsv}>
            Export CSV
          </PBtn>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>vCPU &amp; Memory</th>
                <th>Estimated Price</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((r) => (
                  <RfqRow
                    key={r.id}
                    r={r}
                    hidden={
                      q
                        ? ![r.id, r.title, r.model, r.region, r.notes, r.term]
                            .join(' ')
                            .toLowerCase()
                            .includes(q)
                        : false
                    }
                  />
                ))
              ) : (
                <tr>
                  <td colSpan={4}>No matching requirements.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <NotificationsPanel />
    </div>
  );
}
