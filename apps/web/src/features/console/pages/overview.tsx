'use client';

import Link from 'next/link';
import { useApp } from '@/components/providers/app-context';
import { agentInventory, regionCountry } from '@/features/spot-market';
import { stampUtc } from '@/lib/format';
import { useOperationsOverview } from '../hooks';
import { AdminLoginForm, isAccessError } from '../components/admin-access';
import { Btn, Head } from '../components/forms';
import { availableSourceCount, recentOperations } from './overview-data';

export function OverviewPage() {
  const { href } = useApp();
  const data = useOperationsOverview();
  const queries = Object.values(data);
  const refresh = () => {
    queries.forEach((query) => void query.refetch());
  };
  const denied = queries.some((query) => isAccessError(query.error));
  const market = data.marketplace.data;
  const liveSpot = data.publicMarket.data
    ? agentInventory(data.publicMarket.data.supplies, regionCountry).filter(
        (row) => row.term === 'Spot' && !row.previewOnly,
      ).length
    : undefined;
  const sourceCount =
    data.providers.data && data.prices.data && data.prices.data.meta.truncated !== true
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
      value: data.topups.data?.requests.filter((r) => r.status === 'Pending' && !r.solved).length,
      path: '/topups',
      note: 'Live deposits awaiting review',
    },
    {
      label: 'Pending Payment Confirmed',
      value: undefined,
      path: '/payments',
      note: 'Bank receipt confirmation · Awaiting backend',
    },
    {
      label: 'Pending KYB Requests',
      value: market?.kyb.filter((r) => r.status === 'Reviewing').length,
      path: '/kyb',
      note: 'Due diligence awaiting review',
    },
    {
      label: 'Pending Contact Requests',
      value: data.contacts.data?.leads.filter((r) => r.status === 'New').length,
      path: '/leads',
      note: 'New enquiries awaiting first response',
    },
    {
      label: 'Pending RFQs',
      value: market?.rfqs.filter(
        (r) =>
          !r.external &&
          ['Reviewing', 'Open', 'Quoted'].includes(r.workflowStatus || r.status || ''),
      ).length,
      path: '/rfqs',
      note: 'Reviewing, open or quoted buyer requests',
    },
    {
      label: 'Live Instances',
      value: undefined,
      path: '/orders',
      note: 'Running customer instances · Awaiting backend',
    },
  ];
  const activity = denied
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
              {denied || metric.value === undefined ? '—' : metric.value.toLocaleString('en-US')}
            </div>
            <div className="stat-foot">{metric.note}</div>
          </Link>
        ))}
      </div>
      {denied ? <AdminLoginForm onConnected={refresh} /> : null}
      {queries.some((q) => q.error) ? (
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
