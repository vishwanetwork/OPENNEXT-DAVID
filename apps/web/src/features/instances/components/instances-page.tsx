'use client';

import type { Instance, Order } from '@opennext/contracts';
import { useTerminal, useWorkspaceData, useWorkspaceStore } from '@/terminal-kit';
import { lifecycle, moneyOrNa, stampUtcFull } from '../lifecycle';
import { example, instanceView } from '../preview';
import { useInstanceUsage } from '../hooks';
import { instanceTitle, purchasedHours } from '../usage';
import { IBtn, SshLibrary, StatusTagLive, usePreviewScope, useTick } from './common';
import { ReconnectingNote, UsageChart } from './usage-chart';

const endLabel = (i: Partial<Instance>) => (lifecycle(i).ended ? 'ENDED AT' : 'ENDS AT');

function ExampleCard() {
  const { openModal } = useTerminal();
  const { scope } = usePreviewScope();
  const i = example(scope);
  const life = lifecycle(i);
  const end =
    new Date(i.endedAt || i.serviceEnd!).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    }) + ' UTC';
  return (
    <section className="instance-example" aria-label="Example instance">
      <div className="instance-example-caption">
        <strong>Example instance</strong>
        <span>Example only · not an active resource</span>
      </div>
      <article
        className="instance-card instance-example-card"
        data-instance-example-live=""
        data-instance-life={life.label}
      >
        <div className="row spread">
          <h3>Training workspace</h3>
          <StatusTagLive life={life} />
        </div>
        <p className="instance-example-meta">US East</p>
        <div className="instance-example-specs">
          <div>
            <small>CAPACITY</small>
            <strong>8 × H100 SXM</strong>
          </div>
          <div>
            <small>RATE</small>
            <strong>$2.30/GPU-hr</strong>
          </div>
          <div>
            <small>{endLabel(i)}</small>
            <strong>{end}</strong>
          </div>
        </div>
        <svg
          className={`instance-example-chart ${life.ended ? 'instance-chart-ended' : life.connecting ? 'instance-chart-connecting' : ''}`}
          viewBox="0 0 1000 150"
          preserveAspectRatio="none"
          role="img"
          aria-label={
            life.ended
              ? 'Example utilization history before the instance ended'
              : life.connecting
                ? 'Example utilization history before a Spot interruption'
                : 'Example GPU utilization trend, ending at 71 percent'
          }
        >
          <path
            d="M190 118 L220 114 L250 99 L280 108 L310 75 L340 84 L370 66 L400 73 L430 57 L460 66 L490 50 L520 61 L550 73 L580 64 L610 58 L640 69 L670 57 L700 48 L730 63 L760 50 L790 55"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="instance-example-footer">
          <span>
            {life.ended
              ? 'Instance ended · no active utilization'
              : life.connecting
                ? 'Spot interrupted · reconnecting to capacity'
                : 'GPU utilization 71% · healthy'}
          </span>
          <div className="row">
            <IBtn
              act="instance-example-connect"
              disabled={!life.running}
              onClick={() => openModal('instance-example-connect')}
            >
              Connect
            </IBtn>
            <IBtn
              act="instance-example-manage"
              onClick={() => openModal('instance-example-manage')}
            >
              Manage
            </IBtn>
          </div>
        </div>
      </article>
    </section>
  );
}

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
    { title: 'Running', items: items.filter((instance) => lifecycle(instance).running) },
    { title: 'Reconnecting', items: items.filter((instance) => lifecycle(instance).connecting) },
    { title: 'End', items: items.filter((instance) => lifecycle(instance).ended) },
  ];
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
            {role === 'buyer' ? (
              <IBtn act="navigate-market" onClick={() => go('market')}>
                Find capacity
              </IBtn>
            ) : null}
          </div>
        </div>
        <div className="instance-access-page">
          <SshLibrary scope="instances" />
        </div>
        {items.length ? (
          <>
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
          <>
            <div className="instance-empty-summary">
              <strong>No instances yet</strong>
              <p>
                {role === 'seller'
                  ? 'Your supplied GPU resources will appear here after verification and Agent installation.'
                  : 'Your GPU instances will appear here after a purchase is delivered.'}
              </p>
            </div>
            <ExampleCard />
          </>
        )}
      </div>
    </>
  );
}
