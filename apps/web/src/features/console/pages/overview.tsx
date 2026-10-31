'use client';

import Link from 'next/link';
import { useApp } from '@/components/providers/app-context';
import { agentInventory, regionCountry } from '@/features/spot-market';
import { stampUtc } from '@/lib/format';
import { useOperationsOverview } from '../hooks';
import { AdminLoginForm, isAccessError } from '../components/admin-access';
import { Btn, Head } from '../components/forms';
import { availableSourceCount, recentOperations } from './overview-data';
import type { LiveData } from '../live-api';

export function OverviewPage({
  summary,
  onRefresh,
}: {
  summary?: LiveData<'overview'>;
  onRefresh?: () => Promise<unknown>;
}) {
  const { href } = useApp();
  const data = useOperationsOverview(!summary);
  const queries = Object.values(data);
  const refresh = () => {
    if (onRefresh) {
      void onRefresh();
      return;
    }
    queries.forEach((query) => void query.refetch());
  };
  const denied = !summary && queries.some((query) => isAccessError(query.error));
  const market = data.marketplace.data;
  const liveSpot = summary
    ? summary.metrics.spotOffers
    : data.publicMarket.data
      ? agentInventory(data.publicMarket.data.supplies, regionCountry).filter(
          (row) => row.term === 'Spot' && !row.previewOnly,
        ).length
      : undefined;
  const sourceCount = summary
    ? summary.metrics.priceSources
    : data.providers.data && data.prices.data && data.prices.data.meta.truncated !== true
      ? availableSourceCount(data.providers.data.providers, data.prices.data.records)
      : undefined;
  const metrics = [
    {
      label: 'Available Price Sources',
      value: sourceCount,
      path: '/pricing',
      note:
        data.prices.data?.meta.truncated === true
          ? 'Complete source summary awaiting backend'
          : 'Enabled sources with fresh collected prices',
    },
    {
      label: 'Available Spot Instance',
      value: liveSpot,
      path: '/instances?term=Spot&view=terminal',
      note: 'Eligible offers in the Terminal feed · not GPU count',
    },
    {
      label: 'Pending Top-up Requests',
      value:
        summary?.metrics.pendingTopups ??
        data.topups.data?.requests.filter((r) => r.status === 'Pending' && !r.solved).length,
      path: '/topups',
      note: 'Live deposits awaiting review',
    },
    {
      label: 'Pending Payment Confirmed',
      value: summary?.metrics.pendingPayments,
      path: '/payments',
      note: summary
        ? 'Customer bank payments awaiting confirmation'
        : 'Bank receipt confirmation · Awaiting backend',
    },
    {
      label: 'Pending KYB Requests',
      value: summary?.metrics.pendingKyb,
      path: '/kyb',
      note: summary ? 'Buyer verification awaiting review' : 'Buyer KYB summary · Awaiting backend',
    },
    {
      label: 'Pending Contact Requests',
      value: summary
        ? summary.metrics.pendingContacts
        : data.contacts.data?.leads.filter((r) => r.status === 'New').length,
      path: '/leads',
      note: 'New enquiries awaiting first response',
    },
    {
      label: 'Pending RFQs',
      value: summary
        ? summary.metrics.pendingRfqs
        : market?.rfqs.filter(
            (r) =>
              !r.external &&
              ['Reviewing', 'Open', 'Quoted'].includes(r.workflowStatus || r.status || ''),
          ).length,
      path: '/rfqs',
      note: 'Reviewing, open or quoted buyer requests',
    },
    {
      label: 'Live Instances',
      value: summary?.metrics.liveInstances,
      path: '/instances',
      note: summary
        ? 'Running customer instances'
        : 'Running customer instances · Awaiting backend',
    },
  ];
  const activity = summary
    ? summary.events.map((event) => ({
        key: event.id,
        event: event.action + ' ' + event.target,
        actor: event.actor,
        at: event.at,
        path: '/audit',
      }))
    : denied
      ? []
      : recentOperations(market, data.topups.data?.requests, data.contacts.data?.leads);
  return (
    <>
      <Head
        title="Overview"
        copy="Market sources, customer requests and operations in one place."
        actions={
          <Btn onClick={refresh} disabled={queries.some((q) => q.isFetching)}>
            Refresh overview
          </Btn>
        }
      />
      <div className="ops-metrics">
        {metrics.map((metric) => (
          <Link key={metric.label} href={href(metric.path)} className="stat ops-metric">
            <div className="stat-label">{metric.label}</div>
            <div className="stat-value">
              {denied || metric.value == null ? '—' : metric.value.toLocaleString('en-US')}
            </div>
            <div className="stat-foot">{metric.note}</div>
          </Link>
        ))}
      </div>
      {denied ? <AdminLoginForm onConnected={refresh} /> : null}
      {!summary && queries.some((q) => q.error) ? (
        <p className="ops-state" role="alert">
          Some services could not be refreshed. Retained figures may be out of date; unavailable
          values are shown as —.
        </p>
      ) : null}
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Recent activity</h2>
            <p>Latest 10 recorded operations decisions · UTC</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Processed by</th>
                <th>Processed at</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((event) => (
                <tr key={event.key}>
                  <td>
                    <Link className="ops-activity-link" href={href(event.path)}>
                      {event.event}
                    </Link>
                  </td>
                  <td>{event.actor}</td>
                  <td>{stampUtc(event.at)}</td>
                </tr>
              ))}
              {!activity.length ? (
                <tr>
                  <td colSpan={3} className="ops-empty-table">
                    {denied
                      ? 'Connect an administrator session to view activity.'
                      : queries.some((q) => q.isPending)
                        ? 'Loading operations activity…'
                        : 'No recorded operations decisions available.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      <p className="page-note">
        Refreshes every 30 seconds while visible. — means unavailable, not zero. Pricing
        observations are not confirmed inventory.
      </p>
    </>
  );
}
