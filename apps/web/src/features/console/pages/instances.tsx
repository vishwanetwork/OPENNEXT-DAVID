'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useApp } from '@/components/providers/app-context';
import { agentInventory, regionCountry } from '@/features/spot-market';
import { stampUtc } from '@/lib/format';
import { useOperationsInventory } from '../hooks';
import { Head } from '../components/forms';
import { InstanceFilters } from './instance-filters';
import {
  INSTANCE_TERMS,
  collectedRows,
  emptyCatalogFilters,
  filterCatalog,
  instanceTerm,
  terminalRows,
  type InstanceTerm,
} from './instance-catalog';

export function InstancesPage() {
  const params = useSearchParams();
  const term = instanceTerm(params.get('term')) || 'Spot';
  const terminal = params.get('view') === 'terminal';
  return <InstanceCatalogView key={term + ':' + terminal} term={term} terminal={terminal} />;
}

function InstanceCatalogView({ term, terminal }: { term: InstanceTerm; terminal: boolean }) {
  const { href } = useApp();
  const [filters, setFilters] = useState(emptyCatalogFilters);
  const { prices, publicMarket } = useOperationsInventory({
    term,
    provider: filters.source,
    gpuModel: filters.model,
    gpuCount: filters.capacity,
    gpuMemoryGb: filters.memory,
  });
  const [page, setPage] = useState(0);
  const rows = terminal
    ? terminalRows(agentInventory(publicMarket.data?.supplies || [], regionCountry))
    : collectedRows(prices.data?.records || []);
  const query = terminal ? publicMarket : prices;
  const list = filterCatalog(rows, term, filters);
  const maxPage = Math.max(0, Math.ceil(list.length / 50) - 1);
  const current = Math.min(page, maxPage);
  const path = (nextTerm: string, view = terminal ? 'terminal' : 'collected') =>
    href('/instances?' + new URLSearchParams({ term: nextTerm, view }).toString());
  return (
    <>
      <Head
        title="Instances"
        copy="Source-collected capacity and the inventory visible in Terminal."
        actions={
          <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
            Refresh
          </button>
        }
      />
      <nav className="ops-tabs" aria-label="Instance terms">
        {INSTANCE_TERMS.map((item) => (
          <Link
            key={item}
            href={path(item)}
            aria-current={term === item ? 'page' : undefined}
            onClick={() => {
              setPage(0);
              setFilters(emptyCatalogFilters());
            }}
          >
            {item}
          </Link>
        ))}
      </nav>
      <section className="panel">
        <div className="panel-head">
          <h2>{term}</h2>
          <div className="ops-tabs">
            <Link href={path(term, 'collected')} aria-current={!terminal ? 'page' : undefined}>
              Collected prices
            </Link>
            <Link href={path(term, 'terminal')} aria-current={terminal ? 'page' : undefined}>
              Terminal feed
            </Link>
          </div>
        </div>
        <InstanceFilters
          rows={rows.filter((row) => row.term === term)}
          filters={filters}
          onChange={(value) => {
            setFilters(value);
            setPage(0);
          }}
        />
        {!terminal && prices.data?.meta.truncated === true ? (
          <p className="ops-state" role="status">
            Partial catalog: showing the first 5,000 price observations for this server query. Enter
            a Model or Source to narrow the query. Country, vCPU and search filter only these loaded
            records.
          </p>
        ) : null}
        {query.error ? (
          <p className="ops-state" role="alert">
            Could not refresh this feed. Retained data may be out of date.
          </p>
        ) : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {['Model', 'Capacity', 'Price', 'Country', 'vCPU', 'Memory', 'Source / status'].map(
                  (label) => (
                    <th key={label}>{label}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {list.slice(current * 50, (current + 1) * 50).map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.model}</strong>
                  </td>
                  <td>{row.capacity} GPUs</td>
                  <td>
                    <strong>
                      {row.hourly.toFixed(2)} {row.currency} / hour
                    </strong>
                    <small>
                      {row.perGpuHourly.toFixed(2)} {row.currency}/GPU-hour
                    </small>
                  </td>
                  <td>{row.country}</td>
                  <td>{row.vcpu ?? 'Not provided'}</td>
                  <td>{row.memory === null ? 'Not provided' : row.memory + ' GB'}</td>
                  <td>
                    <strong className="ops-source-label">
                      {row.source} · {row.state}
                    </strong>
                    <small>
                      {row.observedAt ? stampUtc(row.observedAt) : 'Timestamp not provided'}
                    </small>
                  </td>
                </tr>
              ))}
              {!list.length ? (
                <tr>
                  <td colSpan={7} className="ops-empty-table">
                    {query.isPending
                      ? 'Loading source records…'
                      : query.error
                        ? 'Source data unavailable.'
                        : 'No records match this term and these filters.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="ops-paging">
          <span>
            {list.length} matching loaded records
            {!terminal && prices.data?.meta.truncated === true ? ' · partial catalog' : ''}
          </span>
          <div>
            <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>
              Previous
            </button>
            <button
              type="button"
              disabled={current === maxPage}
              onClick={() => setPage(current + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>
      <p className="ops-state">
        {terminal
          ? 'This view uses the same eligibility rules as Terminal. Payment and provisioning still require connected backend services.'
          : 'Collected prices are reference observations, not a promise of available stock. Only validated marketplace offers enter the Terminal feed. Memory is per GPU; vCPU is per node.'}
      </p>
    </>
  );
}
