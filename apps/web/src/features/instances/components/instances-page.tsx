'use client';

import type { Instance, Order } from '@opennext/contracts';
import { useTerminal, useWorkspaceData, useWorkspaceStore } from '@/terminal-kit';
import { lifecycle, moneyOrNa, stampUtcFull } from '../lifecycle';
import { instanceView } from '../preview';
import { useInstanceUsage } from '../hooks';
import { instanceTitle, purchasedHours } from '../usage';
import { IBtn, SshLibrary, StatusTagLive, usePreviewScope, useTick } from './common';
import { ReconnectingNote, UsageChart } from './usage-chart';

function InstanceCard({ instance, orders }: { instance: Instance; orders: Order[] }) {
  const { openModal, toast } = useTerminal();
  const life = lifecycle(instance);
  const { snapshot, query } = useInstanceUsage(instance.id);
  const connect = () => {
    if (!life.running) return toast('Connection is unavailable until the resource is Running.');
    if (!instance.sshHost) return toast('Verified connection details are not available yet.');
    openModal('connect', { id: instance.id });
  };
  return (
    <article
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
          onClick={() => openModal('instance-manage', { id: instance.id })}
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
  const workspace = useWorkspaceData();
  const { scope, demo } = usePreviewScope();
  useTick();
  const items = (workspace.instances as Instance[]).map((instance) =>
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
            {role === 'buyer' && items.length > 0 ? (
              <IBtn act="navigate-market" onClick={() => go('market')}>
                Find capacity
              </IBtn>
            ) : null}
          </div>
        </div>
        {items.length ? (
          <>
            <div className="instance-access-page">
              <SshLibrary scope="instances" />
            </div>
            {groups.map((group) => (
              <InstanceGroup key={group.title} {...group} orders={workspace.orders as Order[]} />
            ))}
            {unknown.length ? (
              <InstanceGroup
                title="Awaiting status"
                items={unknown}
                orders={workspace.orders as Order[]}
              />
            ) : null}
          </>
        ) : (
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
        )}
      </div>
    </>
  );
}
