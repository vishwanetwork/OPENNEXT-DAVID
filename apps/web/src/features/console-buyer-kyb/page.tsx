'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApp } from '@/components/providers/app-context';
import { useToast } from '@/components/ui/toast';
import { MarketplaceInboxPage } from '@/features/console-marketplace';
import { describeError, isUnauthorized } from '@/lib/api/errors';
import type { BuyerKybAdminService } from '@/lib/buyer-kyb';
import { KybBundleDownload } from './bundle-download';
import { BuyerKybDetails } from './details';
import { useBuyerKybQueue } from './hooks';
import { filterCases } from './review';
import './buyer-kyb.css';

/** The authenticated service is supplied by the Console composition root. */
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
  const [initialAction, setInitialAction] = useState<'details' | 'completed' | 'failed'>('details');
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
  const openCase = (id: string, action: typeof initialAction) => {
    setInitialAction(action);
    setSelectedId(id);
  };
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
                <option key={value} value={value}>
                  {value === 'Approved' ? 'Completed' : value === 'Rejected' ? 'Failed' : value}
                </option>
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
        {service && !service.downloadBundle && (
          <p className="buyer-kyb-package-note">
            Complete package download is not yet available from the backend. Select a company to
            review its submitted form and download individual original documents.
          </p>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {['Email', 'Company', 'Country', 'Download', 'Action'].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((record) => (
                <tr key={`${record.id}:${record.revision}:${record.status}`}>
                  <td>{record.email}</td>
                  <td>
                    <button
                      type="button"
                      className="buyer-kyb-company"
                      aria-label="Details"
                      onClick={() => openCase(record.id, 'details')}
                    >
                      {record.company.companyName}
                    </button>
                  </td>
                  <td>{record.company.country}</td>
                  <td>
                    {service && (
                      <KybBundleDownload
                        record={record}
                        service={service}
                        onAccessDenied={denyAccess}
                      />
                    )}
                  </td>
                  <td>
                    {record.status === 'Reviewing' ? (
                      <div className="buyer-kyb-row-actions">
                        <button
                          type="button"
                          className="btn small primary"
                          aria-label={`Completed KYB for ${record.email}`}
                          onClick={() => openCase(record.id, 'completed')}
                        >
                          Completed
                        </button>
                        <button
                          type="button"
                          className="btn small"
                          aria-label={`Failed KYB for ${record.email}`}
                          onClick={() => openCase(record.id, 'failed')}
                        >
                          Failed
                        </button>
                      </div>
                    ) : (
                      <span className="buyer-kyb-status">
                        {record.status === 'Approved' ? 'Completed' : 'Failed'}
                      </span>
                    )}
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
          initialAction={initialAction}
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
