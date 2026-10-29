'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApp } from '@/components/providers/app-context';
import { useToast } from '@/components/ui/toast';
import { MarketplaceInboxPage } from '@/features/console-marketplace';
import { describeError, isUnauthorized } from '@/lib/api/errors';
import type { BuyerKybAdminService } from '@/lib/buyer-kyb';
import { stampUtc } from '@/lib/format';
import { BuyerKybDetails } from './details';
import { useBuyerKybQueue } from './hooks';
import { filterCases } from './review';
import './buyer-kyb.css';

/** Future service supplied by the Console composition root; no network endpoint is invented. */
export function BuyerKybReviewPage({ service }: { service?: BuyerKybAdminService }) {
  const scope = service?.sessionScope;
  const [binding, setBinding] = useState({ service, scope, generation: 0 });
  // Reset before rendering private children, including adapter changes within the same session.
  if (binding.service !== service || binding.scope !== scope) {
    setBinding({ service, scope, generation: binding.generation + 1 });
    return null;
  }
  const configured = typeof scope === 'string' && scope.trim() ? service : undefined;
  return (
    <BuyerKybQueuePage key={JSON.stringify([scope, binding.generation])} service={configured} />
  );
}

function BuyerKybQueuePage({ service }: { service?: BuyerKybAdminService }) {
  const [accessDenied, setAccessDenied] = useState(false);
  const queue = useBuyerKybQueue(service, accessDenied);
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [selectedId, setSelectedId] = useState('');
  const clear = queue.clear;
  useEffect(() => {
    if (accessDenied) clear();
  }, [accessDenied, clear]);
  // Stop polling before clearing the cache; cache removal alone would restart the query.
  if (isUnauthorized(queue.error) && !accessDenied) {
    setAccessDenied(true);
    return null;
  }
  const records = accessDenied ? [] : (queue.data ?? []);
  const rows = filterCases(records, search, status);
  const selected = records.find((row) => row.id === selectedId);
  const denyAccess = () => {
    setAccessDenied(true);
    setSelectedId('');
    queue.clear();
  };
  const confirmed = async () => {
    setSelectedId('');
    toast('KYB decision confirmed. The applicant notification and email have been queued.');
    await queue.refetch();
  };
  return (
    <div className="buyer-kyb-console">
      <header className="buyer-kyb-heading">
        <h1>Buyer KYB</h1>
        <p>Review business verification documents and record ALLScale&apos;s decision.</p>
      </header>
      {!service ? (
        <p className="buyer-kyb-state" role="status">
          Awaiting backend · Buyer KYB submissions, private document downloads and review
          notifications are not connected. No applications can be approved here yet.
        </p>
      ) : null}
      {(queue.error || accessDenied) && (
        <p className="buyer-kyb-error" role="alert">
          {accessDenied
            ? 'Access is no longer authorized. Sign in again before viewing Buyer KYB records.'
            : describeError(queue.error).message}
        </p>
      )}
      <section className="panel">
        <div className="buyer-kyb-toolbar">
          <label className="buyer-kyb-field">
            Search
            <input
              type="search"
              placeholder="Email, company or country"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="buyer-kyb-field">
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {['All', 'Reviewing', 'Approved', 'Rejected'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn"
            disabled={!service || queue.isFetching || accessDenied}
            onClick={() => void queue.refetch()}
          >
            Refresh
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  'Email',
                  'Company',
                  'Country',
                  'Collection',
                  'Submitted',
                  'Status',
                  'Details',
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((record) => (
                <tr key={record.id}>
                  <td>{record.email}</td>
                  <td>{record.company.companyName}</td>
                  <td>{record.company.country}</td>
                  <td>{record.mode}</td>
                  <td>{stampUtc(record.submittedAt)}</td>
                  <td>
                    <span className="buyer-kyb-status">{record.status}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => setSelectedId(record.id)}
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <div className="buyer-kyb-empty">
            <h2>
              {!service
                ? 'Buyer KYB service awaiting backend'
                : queue.isLoading
                  ? 'Loading applications…'
                  : queue.error || accessDenied
                    ? 'Applications unavailable'
                    : 'No matching applications'}
            </h2>
            <p>
              {!service
                ? 'Only confirmed submissions from the private Buyer KYB service will appear here.'
                : 'Use the search and status filters to find a submitted application.'}
            </p>
          </div>
        )}
      </section>
      {selected && service && (
        <BuyerKybDetails
          key={`${selected.id}:${selected.revision}:${selected.status}`}
          record={selected}
          service={service}
          onClose={() => setSelectedId('')}
          onConfirmed={confirmed}
          onRefresh={() => {
            setSelectedId('');
            void queue.refetch();
          }}
          onAccessDenied={denyAccess}
        />
      )}
    </div>
  );
}

export function KybReviewWorkspace({ service }: { service?: BuyerKybAdminService }) {
  const { href } = useApp();
  const supplier = useSearchParams().get('tab') === 'supplier';
  return (
    <>
      <nav className="buyer-kyb-tabs" aria-label="KYB review type">
        <Link href={href('/kyb')} aria-current={!supplier ? 'page' : undefined}>
          Buyer KYB
        </Link>
        <Link href={href('/kyb?tab=supplier')} aria-current={supplier ? 'page' : undefined}>
          Supplier KYB
        </Link>
      </nav>
      {supplier ? <MarketplaceInboxPage tab="kyb" /> : <BuyerKybReviewPage service={service} />}
    </>
  );
}
