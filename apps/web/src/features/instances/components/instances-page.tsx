'use client';

import type { Instance, Order } from '@opennext/contracts';
import { useEffect, useRef, useState } from 'react';
import { useTerminal, useWorkspace, useWorkspaceStore } from '@/terminal-kit';
import { AsyncFeedback } from '@/components/ui/async-feedback';
import { PaidPurchases } from '@/features/bank-transfer';
import { SpotFundingAlerts, useSpotFundingInstances } from '@/features/spot-funding';
import type { SpotFundingOrder } from '@/lib/spot-funding';
import { moneyOrNa, stampUtcFull, isSpot } from '../lifecycle';
import { fundingLifecycle } from '../funding-lifecycle';
import { instanceView } from '../preview';
import { useInstanceUsage, usePrefetchAutopilot, useRefreshInstance } from '../hooks';
import { instanceTitle, purchasedHours } from '../usage';
import { IBtn, SshLibrary, StatusTagLive, usePreviewScope, useTick } from './common';
import { ReconnectingNote, UsageChart } from './usage-chart';

function InstanceCard({
  instance,
  orders,
  funding,
}: {
  instance: Instance;
  orders: Order[];
  funding?: SpotFundingOrder;
}) {
  const { openModal, toast } = useTerminal();
  const life = fundingLifecycle(instance, funding);
  const card = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(
    () => typeof window !== 'undefined' && !('IntersectionObserver' in window),
  );
  const prefetch = usePrefetchAutopilot();
  useEffect(() => {
    if (!('IntersectionObserver' in window)) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' },
    );
    if (card.current) observer.observe(card.current);
    return () => observer.disconnect();
  }, []);
  const { snapshot, query } = useInstanceUsage(instance.id, {
    enabled: visible && !life.waiting,
    live: !life.ended,
  });
  const prepare = () => {
    if (isSpot(instance)) void prefetch(instance.id);
  };
  const connect = () => {
    if (!life.running) return toast('Connection is unavailable until the resource is Running.');
    if (!instance.sshHost) return toast('Verified connection details are not available yet.');
    openModal('connect', { id: instance.id });
  };
  return (
    <article
      ref={card}
      className="instance-card"
      data-instance-live={instance.id}
      data-instance-life={life.label}
    >
      <div className="row spread">
        <h3>
          {instanceTitle(
            instance,
            funding ? funding.purchasedSeconds / 3600 : purchasedHours(instance, orders, snapshot),
          )}
        </h3>
        <StatusTagLive life={life} />
      </div>
      <div className="instance-compact-meta">
        {funding ? (
          <>
            <span>
              Current rate:{' '}
              {funding.currentHourlyCents === null
                ? 'Not available'
                : `${moneyOrNa(funding.currentHourlyCents / 100)} / hour`}
            </span>
            <span>{(funding.remainingSeconds / 3600).toFixed(2)} running hours remaining</span>
          </>
        ) : (
          <>
            <span>{moneyOrNa(instance.rate)} / GPU-hour</span>
            <span>
              {life.ended ? 'Ended' : 'Ends'}{' '}
              {stampUtcFull(instance.endedAt || instance.serviceEnd || instance.end)}
            </span>
          </>
        )}
      </div>
      <UsageChart snapshot={snapshot} loading={query.isFetching} />
      {life.connecting ? (
        <ReconnectingNote
          retained={
            funding ? funding.retention === 'confirmed' : snapshot?.retainedDataConfirmed === true
          }
        />
      ) : null}
      {life.paused ? (
        <p className="instance-funding-paused" role="status">
          Paused after funding became insufficient. Remaining runtime is preserved.
          {funding?.retention === 'confirmed'
            ? ' Your data is retained.'
            : funding?.retention === 'unavailable'
              ? ' Data retention is not confirmed. Contact support before resuming.'
              : ' Data retention is awaiting confirmation.'}{' '}
          Resume requires confirmed funding and backend checks.
        </p>
      ) : null}
      <div className="row instance-card-actions">
        <IBtn
          act="instance-connect"
          id={instance.id}
          disabled={!(life.running && instance.sshHost)}
          onClick={connect}
        >
          Connect
        </IBtn>
        <IBtn
          act="instance-manage"
          id={instance.id}
          onPointerEnter={prepare}
          onFocus={prepare}
          onClick={() => {
            prepare();
            openModal('instance-manage', { id: instance.id });
          }}
        >
          Manage
        </IBtn>
        {life.paused ? (
          <IBtn act="pay-start" onClick={() => openModal('pay-start')}>
            Add credit
          </IBtn>
        ) : null}
      </div>
    </article>
  );
}

function InstanceGroup({
  title,
  items,
  orders,
  fundingOrders,
}: {
  title: string;
  items: Instance[];
  orders: Order[];
  fundingOrders: SpotFundingOrder[];
}) {
  return (
    <details className="instance-state-group" open>
      <summary>
        <span>{title}</span>
        <span className="instance-group-count">{items.length}</span>
        <span className="instance-group-chevron" aria-hidden="true">
          ⌄
        </span>
      </summary>
      {items.length ? (
        <div className="instance-grid">
          {items.map((instance) => (
            <InstanceCard
              key={instance.id}
              instance={instance}
              orders={orders}
              funding={fundingOrders.find((order) => order.instanceId === instance.id)}
            />
          ))}
        </div>
      ) : (
        <p className="instance-group-empty">No {title.toLowerCase()} instances.</p>
      )}
    </details>
  );
}

export function InstancesPage() {
  const { go } = useTerminal();
  const role = useWorkspaceStore((state) => state.role);
  const query = useWorkspace();
  const workspace = query.data;
  const { orders: fundingOrders } = useSpotFundingInstances(
    ((workspace?.instances ?? []) as Instance[])
      .filter((instance) => isSpot(instance))
      .map((instance) => instance.id),
  );
  const lifeOf = (instance: Instance) =>
    fundingLifecycle(
      instance,
      fundingOrders.find((order) => order.instanceId === instance.id),
    );
  const refresh = useRefreshInstance();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const reload = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError('');
    try {
      await refresh();
    } catch {
      setRefreshError('Instances could not be refreshed. Please try again.');
    } finally {
      setRefreshing(false);
    }
  };
  const { scope, demo } = usePreviewScope();
  useTick(30_000);
  const items = ((workspace?.instances ?? []) as Instance[]).map((instance) =>
    instanceView(instance, scope, demo),
  );
  const groups = [
    {
      // Paid orders still waiting for Spot capacity; their autopilot can be set from Manage.
      title: 'Waiting',
      items: items.filter((instance) => lifeOf(instance).waiting),
    },
    { title: 'Running', items: items.filter((instance) => lifeOf(instance).running) },
    { title: 'Reconnecting', items: items.filter((instance) => lifeOf(instance).connecting) },
    {
      title: 'Paused — insufficient funds',
      items: items.filter((instance) => lifeOf(instance).paused),
    },
    { title: 'End', items: items.filter((instance) => lifeOf(instance).ended) },
  ].filter(
    (group) =>
      !['Waiting', 'Paused — insufficient funds'].includes(group.title) || group.items.length,
  );
  const unknown = items.filter((instance) => lifeOf(instance).label === 'Awaiting status');
  return (
    <>
      <div className="page-content instance-page">
        <div className="page-heading">
          <div>
            <h1>Instances</h1>
            <p>
              {role === 'seller'
                ? 'Your verified supplied resources and delivery status.'
                : 'Your purchased GPU capacity, access and utilization.'}
            </p>
          </div>
          <div className="row">
            <IBtn
              act="instances-refresh"
              busy={refreshing || query.isFetching}
              busyLabel="Refreshing…"
              onClick={() => void reload()}
            >
              Refresh status
            </IBtn>
            {role === 'buyer' && items.length > 0 ? (
              <IBtn act="navigate-market" onClick={() => go('market')}>
                Find capacity
              </IBtn>
            ) : null}
          </div>
        </div>
        <PaidPurchases />
        {role === 'buyer' ? <SpotFundingAlerts /> : null}
        {query.isFetching ? (
          <AsyncFeedback>
            {workspace ? 'Refreshing instances…' : 'Loading instances…'}
          </AsyncFeedback>
        ) : null}
        {query.isError || refreshError ? (
          <p role="alert">
            {refreshError || 'Instances could not be loaded. Please refresh to try again.'}
          </p>
        ) : null}
        {!workspace && query.isPending ? (
          <div
            className="instance-loading-skeleton"
            aria-label="Loading instances"
            aria-busy="true"
          >
            {[0, 1, 2].map((key) => (
              <div key={key} className="instance-card">
                <p>Loading instance details…</p>
              </div>
            ))}
          </div>
        ) : items.length ? (
          <>
            <div className="instance-access-page">
              <SshLibrary scope="instances" />
            </div>
            {groups.map((group) => (
              <InstanceGroup
                key={group.title}
                {...group}
                orders={(workspace?.orders ?? []) as Order[]}
                fundingOrders={fundingOrders}
              />
            ))}
            {unknown.length ? (
              <InstanceGroup
                title="Awaiting status"
                items={unknown}
                orders={(workspace?.orders ?? []) as Order[]}
                fundingOrders={fundingOrders}
              />
            ) : null}
          </>
        ) : !query.isError ? (
          <div className="instance-empty-layout">
            <div className="instance-empty-summary">
              <strong>No instances yet</strong>
              <p>
                {role === 'seller'
                  ? 'Your supplied GPU resources will appear here after verification and Agent installation.'
                  : 'Your GPU instances will appear here after a purchase is delivered.'}
              </p>
              {role === 'buyer' ? (
                <IBtn act="navigate-market" onClick={() => go('market')}>
                  Find capacity
                </IBtn>
              ) : null}
            </div>
            <div className="instance-access-page">
              <SshLibrary scope="instances" />
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
