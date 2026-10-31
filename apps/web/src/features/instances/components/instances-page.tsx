'use client';

import type { Instance, Order } from '@opennext/contracts';
import { useEffect, useRef, useState } from 'react';
import { useTerminal, useWorkspace, useWorkspaceStore } from '@/terminal-kit';
import { AsyncFeedback } from '@/components/ui/async-feedback';
import { lifecycle, moneyOrNa, stampUtcFull, isSpot } from '../lifecycle';
import { instanceView } from '../preview';
import { useInstanceUsage, usePrefetchAutopilot, useRefreshInstance } from '../hooks';
import { instanceTitle, purchasedHours } from '../usage';
import { IBtn, SshLibrary, StatusTagLive, usePreviewScope, useTick } from './common';
import { ReconnectingNote, UsageChart } from './usage-chart';

function InstanceCard({ instance, orders }: { instance: Instance; orders: Order[] }) {
  const { openModal, toast } = useTerminal();
  const life = lifecycle(instance);
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
        <h3>{instanceTitle(instance, purchasedHours(instance, orders, snapshot))}</h3>
        <StatusTagLive life={life} />
      </div>
      <div className="instance-compact-meta">
        <span>{moneyOrNa(instance.rate)} / GPU-hour</span>
        <span>
          {life.ended ? 'Ended' : 'Ends'}{' '}
          {stampUtcFull(instance.endedAt || instance.serviceEnd || instance.end)}
        </span>
      </div>
      <UsageChart snapshot={snapshot} loading={query.isFetching} />
      {life.connecting ? (
        <ReconnectingNote retained={snapshot?.retainedDataConfirmed === true} />
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
      </div>
    </article>
  );
}

function InstanceGroup({
  title,
  items,
  orders,
}: {
  title: string;
  items: Instance[];
  orders: Order[];
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
            <InstanceCard key={instance.id} instance={instance} orders={orders} />
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
      items: items.filter((instance) => lifecycle(instance).waiting),
    },
    { title: 'Running', items: items.filter((instance) => lifecycle(instance).running) },
    { title: 'Reconnecting', items: items.filter((instance) => lifecycle(instance).connecting) },
    { title: 'End', items: items.filter((instance) => lifecycle(instance).ended) },
  ].filter((group) => group.title !== 'Waiting' || group.items.length);
  const unknown = items.filter((instance) => lifecycle(instance).label === 'Awaiting status');
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
              />
            ))}
            {unknown.length ? (
              <InstanceGroup
                title="Awaiting status"
                items={unknown}
                orders={(workspace?.orders ?? []) as Order[]}
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
