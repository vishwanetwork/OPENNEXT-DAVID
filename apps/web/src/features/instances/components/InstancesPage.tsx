'use client';

import type { Instance } from '@opennext/contracts';
import { useTerminal } from '@/features/terminal/context';
import { useWorkspaceStore } from '@/features/terminal/store';
import { lifecycle, moneyOrNa, stampUtcFull, telemetry } from '../lifecycle';
import { example, instanceView } from '../preview';
import { IBtn, SshLibrary, StatusTagLive, usePreviewScope, useTick } from './common';

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

function InstanceCard({ original }: { original: Instance }) {
  const { openModal, toast } = useTerminal();
  const { scope, demo } = usePreviewScope();
  const i = instanceView(original, scope, demo);
  const life = lifecycle(i);
  const t = telemetry(i);
  const connect = () => {
    if (!life.running)
      return toast(
        life.ended
          ? 'This instance has ended.'
          : 'Connection is unavailable until the resource is Running.',
      );
    if (!i.sshHost) return toast('Verified connection details are not available yet.');
    openModal('connect', { id: i.id });
  };
  return (
    <article className="instance-card" data-instance-live={i.id} data-instance-life={life.label}>
      <div className="row spread">
        <h3>{i.name || i.model}</h3>
        <StatusTagLive life={life} />
      </div>
      <p className="instance-example-meta">{i.region || 'Region not provided'}</p>
      <div className="details-grid">
        <div>
          <small>CAPACITY</small>
          <strong>
            {i.count} × {i.model}
          </strong>
        </div>
        <div>
          <small>RATE / GPU-HOUR</small>
          <strong>{moneyOrNa(i.rate)}</strong>
        </div>
        <div>
          <small>{endLabel(i)}</small>
          <strong>{stampUtcFull(i.endedAt || i.serviceEnd || i.end)}</strong>
        </div>
      </div>
      <div className="instance-util">
        <div className="row spread">
          <span>GPU utilization</span>
          <strong>
            {life.ended
              ? 'Not active'
              : life.connecting
                ? 'Waiting for reconnection'
                : t.fresh
                  ? (t.value as number).toFixed(1) + '%'
                  : 'Awaiting telemetry'}
          </strong>
        </div>
        <progress
          max={100}
          value={life.running && t.fresh ? (t.value as number) : 0}
          aria-label="GPU utilization"
        />
        <small>
          {life.ended
            ? 'This allocation has ended.'
            : life.connecting
              ? 'A Spot interruption was reported. Connection and resale are paused.'
              : t.fresh
                ? 'Observed ' + stampUtcFull(t.at)
                : 'No current measurement is available.'}
        </small>
      </div>
      <div className="row">
        <IBtn
          act="instance-connect"
          id={i.id}
          disabled={!(life.running && i.sshHost)}
          onClick={connect}
        >
          Connect
        </IBtn>
        <IBtn
          act="instance-manage"
          id={i.id}
          onClick={() => openModal('instance-manage', { id: i.id })}
        >
          Manage
        </IBtn>
      </div>
    </article>
  );
}

/** Instances page (legacy `instanceCards` + SSH library). */
export function InstancesPage() {
  const { go } = useTerminal();
  const role = useWorkspaceStore((s) => s.role);
  const items = useWorkspaceStore((s) => s.instances) as Instance[];
  useTick();
  return (
    <>
      <div className="page-content">
        <div className="page-heading">
          <div>
            <h1>Instances</h1>
            <p>
              {role === 'Seller'
                ? 'Your verified supplied resources and delivery status.'
                : 'Your purchased GPU capacity, access and utilization.'}
            </p>
          </div>
          {role === 'Buyer' ? (
            <IBtn act="navigate-market" onClick={() => go('market')}>
              Find capacity
            </IBtn>
          ) : null}
        </div>
        {items.length ? (
          <div className="instance-grid">
            {items.map((i) => (
              <InstanceCard key={i.id} original={i} />
            ))}
          </div>
        ) : (
          <>
            <div className="instance-empty-summary">
              <strong>No instances yet</strong>
              <p>
                {role === 'Seller'
                  ? 'Your supplied GPU resources will appear here after verification and Agent installation.'
                  : 'Your GPU instances will appear here after a purchase is delivered.'}
              </p>
            </div>
            <ExampleCard />
          </>
        )}
      </div>
      <div className="page-content instance-access-page">
        <SshLibrary scope="instances" />
      </div>
    </>
  );
}
