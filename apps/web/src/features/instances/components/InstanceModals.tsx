'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import type { Instance, Order } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { useToast } from '@/components/ui/toast';
import { ResellResponse } from '@opennext/contracts';
import {
  ModalFrame,
  useInvalidateWorkspace,
  useTerminal,
  useTerminalSlots,
  useWorkspaceData,
  type ModalComponent,
  type ModalComponents,
  type ModalOf,
  type ModalType,
} from '@/terminal-kit';
import {
  eligibility,
  lifecycle,
  moneyOrNa,
  sshCommand,
  stampUtcFull,
  telemetry,
  timestamp,
} from '../lifecycle';
import {
  endDemo,
  endExample,
  example,
  instanceView,
  localDemo,
  setExampleScenario,
} from '../preview';
import { IBtn, SshLibrary, usePreviewScope, useTick } from './common';


const ENDED = [
  'end',
  'ended',
  'released',
  'expired',
  'terminated',
  'completed',
  'cancelled',
  'canceled',
];
const ending = new Set<string>();

const Cell = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <small>{label}</small>
    <strong>{children}</strong>
  </div>
);

function useInstance(id: string | undefined, isExample: boolean) {
  const { scope, demo, role } = usePreviewScope();
  const instances = useWorkspaceData().instances as Instance[];
  const now = useTick();
  const original = isExample ? example(scope) : instances.find((row) => row.id === id);
  const i = original ? (isExample ? original : instanceView(original, scope, demo)) : undefined;
  return {
    i,
    original,
    scope,
    demo,
    role,
    now,
    life: i
      ? lifecycle(i)
      : { label: 'End' as const, ended: true, running: false, connecting: false },
    e: i
      ? eligibility(i, role)
      : { allowed: false, reason: 'The allocation is no longer available.' },
    t: i ? telemetry(i) : { fresh: false, value: null, at: null },
  };
}

function OrderField({ i, isExample }: { i: Instance; isExample: boolean }) {
  const { openModal, toast } = useTerminal();
  const orders = useWorkspaceData().orders as Order[];
  const idRef = i.orderId || i.purchaseOrderId;
  const order = isExample
    ? { id: 'ORDER-EXAMPLE-1024' }
    : orders.find((o) => (idRef && o.id === idRef) || (i.id && o.instanceId === i.id));
  const open = () =>
    isExample
      ? openModal('instance-example-order')
      : order
        ? openModal('bill-order', { id: order.id })
        : toast('The purchase record is not linked to this allocation yet.');
  return (
    <div>
      <small>ORDER</small>
      {order ? (
        <button
          type="button"
          className="detail-link instance-order-link"
          data-act={isExample ? 'instance-example-order' : 'instance-order'}
          data-id={i.id}
          onClick={open}
        >
          {order.id} <span aria-hidden="true">↗</span>
        </button>
      ) : (
        <strong>Purchase record not linked</strong>
      )}
    </div>
  );
}

function ExampleOrder() {
  const { openModal, closeModal } = useTerminal();
  const { scope } = usePreviewScope();
  const i = example(scope);
  const subtotal = 8 * 2.3 * 48;
  return (
    <>
      <p className="instance-example-record-note">
        Example only · no purchase, payment or active resource
      </p>
      <div className="details-grid">
        <Cell label="ORDER">ORDER-EXAMPLE-1024</Cell>
        <Cell label="RESOURCE">8 × H100 SXM</Cell>
        <Cell label="REGION">US East</Cell>
        <Cell label="MARKET TERMS">Spot</Cell>
        <Cell label="UNIT RATE">$2.30 / GPU-hour</Cell>
        <Cell label="ILLUSTRATIVE DURATION">48 hours</Cell>
        <Cell label="START">{stampUtcFull(i.createdAt)}</Cell>
        <Cell label="END">{stampUtcFull(i.endedAt || i.serviceEnd)}</Cell>
        <Cell label="RESOURCE STATUS">{lifecycle(i).label}</Cell>
        <Cell label="PAYMENT">Not charged · example only</Cell>
      </div>
      <div className="instance-example-pricing">
        <div>
          <span>Illustrative capacity subtotal</span>
          <strong>{moneyOrNa(subtotal)}</strong>
        </div>
        <div>
          <span>OpenNEXT Fee 5%</span>
          <strong>{moneyOrNa(subtotal * 0.05)}</strong>
        </div>
        <div>
          <span>Illustrative total</span>
          <strong>{moneyOrNa(subtotal * 1.05)}</strong>
        </div>
      </div>
      <p className="form-note">
        This record demonstrates the information linked to a purchased instance. It is not added to
        your real orders or Billing activity.
      </p>
      <div className="modal-footer">
        <IBtn act="instance-example-manage" onClick={() => openModal('instance-example-manage')}>
          Back to instance
        </IBtn>
        <IBtn act="close-modal" onClick={closeModal}>
          Close
        </IBtn>
      </div>
    </>
  );
}

function EndDialog({ id, isExample }: { id?: string; isExample: boolean }) {
  const { instanceLifecycle: lifecycleAdapter } = useTerminalSlots().services;
  const invalidate = useInvalidateWorkspace();
  const { openModal, closeModal } = useTerminal();
  const toast = useToast();
  const { i, original, scope, demo, life } = useInstance(id, isExample);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!i) return <p>Refresh your instances and try again.</p>;
  const local = isExample || localDemo(i, demo);
  const configured = Boolean(lifecycleAdapter);
  const key = scope + ':' + i.id;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (data.confirmEnd !== 'yes') return setError('Confirm that you want to end this instance.');
    if (ending.has(key)) return;
    ending.add(key);
    setBusy(true);
    try {
      if (lifecycle(i).ended) throw new Error('This instance has already ended.');
      if (local) {
        if (isExample) endExample(scope);
        else endDemo(scope, i.id);
        closeModal();
        toast('Local preview instance ended. No real resource or billing was changed.');
        return;
      }
      if (!lifecycleAdapter)
        throw new Error(
          'Termination is not connected. No resource has been released. Contact operations.',
        );
      const result = await lifecycleAdapter.end({ instanceId: i.id, confirmation: 'END' });
      const finalStatus = String(result?.instance?.status || '').toLowerCase();
      const terminal =
        Boolean(result?.instance?.releasedAt || result?.instance?.endedAt) ||
        ENDED.includes(finalStatus);
      if (result?.confirmed !== true || result.instance?.id !== i.id || !terminal)
        throw new Error(
          'Termination has not been confirmed. The allocation was not marked as ended. Refresh its status or contact operations.',
        );
      await invalidate();
      closeModal();
      toast('Instance ended. The backend confirmed release.');
    } catch (err) {
      setError((err as Error).message);
      toast((err as Error).message);
    } finally {
      ending.delete(key);
      setBusy(false);
    }
  };
  void original;
  return (
    <>
      <p className="instance-end-warning">
        {life.ended
          ? 'This allocation is no longer active.'
          : local
            ? 'This ends only the local example or demo allocation. No real server is released.'
            : 'Ending an instance stops its workloads and releases the allocation. Save any required data before proceeding.'}
      </p>
      <div className="details-grid">
        <Cell label="RESOURCE">
          {i.count} × {i.model}
        </Cell>
        <Cell label="REGION">{i.region || 'Not provided'}</Cell>
        <div>
          <small>STATUS</small>
          <strong data-instance-status>{life.label}</strong>
        </div>
      </div>
      {!local && !configured ? (
        <div className="instance-end-unavailable">
          Resource termination is not connected yet. No resource will be released and no billing
          change will be made. Contact operations to end this allocation.
        </div>
      ) : null}
      {!life.ended ? (
        <form
          data-form="instance-end"
          data-id={i.id}
          data-example={isExample ? 'true' : 'false'}
          onSubmit={submit}
        >
          <label className="instance-end-confirm">
            <input
              type="checkbox"
              name="confirmEnd"
              value="yes"
              required
              disabled={!local && !configured}
            />{' '}
            <span>
              I understand that this {local ? 'local preview' : 'allocation'} will end and
              connection access will stop.
            </span>
          </label>
          <p className="form-note" data-instance-end-error role="alert">
            {error}
          </p>
          <div className="modal-footer">
            <IBtn
              act={isExample ? 'instance-example-manage' : 'instance-manage'}
              id={i.id}
              onClick={() =>
                openModal(isExample ? 'instance-example-manage' : 'instance-manage', { id: i.id })
              }
            >
              Cancel
            </IBtn>
            <button
              type="submit"
              className="btn danger"
              disabled={(!local && !configured) || busy || life.ended}
            >
              END instance
            </button>
          </div>
        </form>
      ) : (
        <div className="modal-footer">
          <IBtn act="close-modal" onClick={closeModal}>
            Close
          </IBtn>
        </div>
      )}
    </>
  );
}

function ExampleConnect() {
  const { closeModal } = useTerminal();
  const { scope } = usePreviewScope();
  useTick();
  const life = lifecycle(example(scope));
  return (
    <>
      <p className="form-note">
        {life.ended
          ? 'This example has ended. Reset it in Manage to explore the connection state.'
          : life.connecting
            ? 'This Spot example is reconnecting after an interruption. Access resumes only after the Running state is confirmed.'
            : 'This is an example instance, not an active resource. Delivered allocations show a verified SSH endpoint, port, username and SSH key instructions.'}
      </p>
      <div className="instance-example-access">
        <span>SSH access</span>
        <strong>{life.running ? 'Available after real delivery' : life.label}</strong>
      </div>
      <p className="form-note">No server connection is made from this example.</p>
      <div className="modal-footer">
        <IBtn act="close-modal" onClick={closeModal}>
          Close
        </IBtn>
      </div>
    </>
  );
}

function ExampleManage() {
  const { openModal, closeModal, toast } = useTerminal();
  const { scope } = usePreviewScope();
  useTick();
  const i = example(scope);
  const life = lifecycle(i);
  return (
    <>
      <div className="details-grid">
        <div>
          <small>STATUS</small>
          <strong data-instance-status>{life.label}</strong>
        </div>
        <Cell label="CAPACITY">8 × H100 SXM</Cell>
        <Cell label="REGION">US East</Cell>
        <Cell label="UNIT RATE">$2.30/GPU-hr</Cell>
        <Cell label="UTILIZATION">
          {life.running ? '71%' : life.ended ? 'Not active' : 'Awaiting reconnection'}
        </Cell>
        <OrderField i={i} isExample />
      </div>
      <p className="form-note">
        Example only. These controls demonstrate the instance lifecycle without creating a purchase,
        connecting to a server or changing Billing.
      </p>
      <div className="instance-example-controls">
        {life.ended ? (
          <IBtn act="instance-example-reset" onClick={() => setExampleScenario(scope, 'reset')}>
            Reset example
          </IBtn>
        ) : (
          <IBtn
            act={life.connecting ? 'instance-example-recover' : 'instance-example-interrupt'}
            onClick={() => setExampleScenario(scope, life.connecting ? 'running' : 'interrupted')}
          >
            {life.connecting ? 'Restore connection' : 'Preview Spot interruption'}
          </IBtn>
        )}
        <span>Local example controls</span>
      </div>
      <div className="modal-footer">
        <IBtn
          act="instance-access"
          example
          onClick={() => openModal('instance-access', { example: true })}
        >
          SSH keys
        </IBtn>
        <IBtn act="close-modal" onClick={closeModal}>
          Close
        </IBtn>
        <IBtn
          act="instance-example-connect"
          disabled={!life.running}
          onClick={() => openModal('instance-example-connect')}
        >
          Connect
        </IBtn>
        <IBtn
          act="instance-example-resell"
          disabled
          title="Example capacity cannot be listed for resale."
          onClick={() => toast('Example capacity cannot be listed for resale.')}
        >
          Resell
        </IBtn>
        <IBtn
          act="instance-example-end"
          disabled={life.ended}
          onClick={() => openModal('instance-example-end')}
        >
          END
        </IBtn>
      </div>
    </>
  );
}

function Manage({ id }: { id?: string }) {
  const { openModal, closeModal, toast } = useTerminal();
  const { i, life, e, t, demo, role } = useInstance(id, false);
  const api = useApi();
  const invalidate = useInvalidateWorkspace();
  if (!i) return <p>Refresh your instances and try again.</p>;
  const refresh = () => invalidate().catch((err: Error) => toast(err.message));
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
  void api;
  return (
    <>
      <p className="form-note" data-instance-live-status role="status">
        {e.reason}
      </p>
      <div className="details-grid">
        <div>
          <small>STATUS</small>
          <strong data-instance-status>{life.label}</strong>
        </div>
        <Cell label="CAPACITY">
          {i.count} × {i.model}
        </Cell>
        <Cell label="REGION">{i.region || 'Not provided'}</Cell>
        <Cell label="UNIT RATE">{moneyOrNa(i.rate)} / GPU-hour</Cell>
        <Cell label="UTILIZATION">
          {life.ended
            ? 'Not active'
            : life.connecting
              ? 'Awaiting reconnection'
              : t.fresh
                ? (t.value as number).toFixed(1) + '%'
                : 'Awaiting telemetry'}
        </Cell>
        <OrderField i={i} isExample={false} />
      </div>
      <p className="form-note">{e.reason}</p>
      <p className="form-note">
        Resale is limited to authorized, independently allocatable idle GPUs within your existing
        service window. Active allocations are never reclaimed automatically.
      </p>
      {localDemo(i, demo) ? (
        <p className="instance-example-record-note">
          Demo allocation · local lifecycle changes only
        </p>
      ) : null}
      <div className="modal-footer">
        <IBtn
          act="instance-access"
          id={i.id}
          onClick={() => openModal('instance-access', { id: i.id })}
        >
          SSH keys
        </IBtn>
        <IBtn
          act="instance-connect"
          id={i.id}
          disabled={!(life.running && i.sshHost)}
          onClick={connect}
        >
          Connection details
        </IBtn>
        {role === 'buyer' ? (
          <IBtn
            act="instance-resell"
            id={i.id}
            disabled={!e.allowed}
            title={e.reason}
            onClick={() => openModal('instance-resell', { id: i.id })}
          >
            Resell
          </IBtn>
        ) : null}
        <IBtn act="instance-refresh" id={i.id} onClick={refresh}>
          Refresh status
        </IBtn>
        <IBtn
          act="instance-end"
          id={i.id}
          disabled={life.ended}
          onClick={() => openModal('instance-end-confirm', { id: i.id })}
        >
          END
        </IBtn>
        <IBtn act="close-modal" onClick={closeModal}>
          Close
        </IBtn>
      </div>
    </>
  );
}

function Resell({ id }: { id?: string }) {
  const invalidate = useInvalidateWorkspace();
  const { closeModal, toast } = useTerminal();
  const api = useApi();
  const { i, e, now } = useInstance(id, false);
  const [busy, setBusy] = useState(false);
  if (!i) return <p>Refresh your instances and try again.</p>;
  if (!e.allowed)
    return (
      <>
        <p>{e.reason}</p>
        <IBtn
          act="instance-refresh"
          id={i.id}
          onClick={() => invalidate().catch((err: Error) => toast(err.message))}
        >
          Refresh status
        </IBtn>
      </>
    );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    setBusy(true);
    try {
      const result = await api.post(
        `/api/marketplace/instances/${encodeURIComponent(i.id)}/resell`,
        { count: Number(data.count), rate: Number(data.rate), hours: Number(data.hours) },
      );
      ResellResponse.parse(result);
      closeModal();
      toast('Resale request submitted. Track it in your supply.');
      await invalidate();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const maxHours = Math.max(0, Math.floor((timestamp(i.serviceEnd ?? i.end) - now) / 3600000));
  return (
    <form data-form="instance-resell" data-id={i.id} onSubmit={submit}>
      <p className="form-note" data-instance-live-status role="status">
        {e.reason}
      </p>
      <p className="form-note">
        A server-side availability and utilization check is required before listing. Your listed
        unit price has no markup. OpenNEXT Fee 5% is added at buyer checkout and deducted from
        seller proceeds, each based on the order subtotal.
      </p>
      <div className="form-grid">
        <label className="form-label">
          Idle GPU count
          <input
            className="field"
            type="number"
            name="count"
            min={1}
            max={i.availableResellCount || 0}
            step={1}
            required
          />
        </label>
        <label className="form-label">
          Your unit price · USD / GPU-hour
          <input className="field" type="number" name="rate" min="0.01" step="0.01" required />
        </label>
        <label className="form-label">
          Duration · hours
          <input className="field" type="number" name="hours" min={1} max={maxHours} required />
        </label>
      </div>
      <p className="form-note">
        Pending offers pause when utilization reaches 95% or telemetry is stale.
      </p>
      <div className="modal-footer">
        <button className="btn" disabled={busy || !e.allowed}>
          Submit resale request
        </button>
      </div>
    </form>
  );
}

function Access({ id, isExample }: { id?: string; isExample: boolean }) {
  const { openModal, closeModal } = useTerminal();
  const { i } = useInstance(id, isExample);
  if (!i) return <p>Refresh your instances and try again.</p>;
  return (
    <>
      <div className="instance-access-summary">
        <strong>
          {i.count} × {i.model}
        </strong>
        <span>{i.region || 'Region not provided'}</span>
      </div>
      <p className="form-note instance-access-installation">
        {isExample
          ? 'This example has no server to connect to.'
          : 'Instance-specific key installation is not connected yet.'}{' '}
        Save a public key below for provisioning. Adding a key here does not install it on an
        existing instance.
      </p>
      <SshLibrary scope="instance-access" />
      <div className="modal-footer">
        <IBtn
          act={isExample ? 'instance-example-manage' : 'instance-manage'}
          id={i.id}
          onClick={() =>
            openModal(isExample ? 'instance-example-manage' : 'instance-manage', { id: i.id })
          }
        >
          Back to instance
        </IBtn>
        <IBtn act="close-modal" onClick={closeModal}>
          Close
        </IBtn>
      </div>
    </>
  );
}

function Connect({ id }: { id?: string }) {
  const toast = useToast();
  const { i } = useInstance(id, false);
  const command = i ? sshCommand(i) : '';
  if (!command)
    return (
      <p className="form-note">
        Verified connection details have not been provided by the supplier yet.
      </p>
    );
  return (
    <>
      <p className="form-note">
        Use your registered key in your own SSH client. Never share private keys.
      </p>
      <pre className="modal-code">{command}</pre>
      <div className="modal-footer">
        <button
          type="button"
          className="btn"
          data-act="copy"
          data-value={command}
          onClick={() =>
            navigator.clipboard
              ?.writeText(command)
              .then(() => toast('Copied to clipboard'))
              .catch(() => toast('Copy is unavailable in this browser'))
          }
        >
          Copy SSH command
        </button>
      </div>
    </>
  );
}

declare module '@/terminal-kit/modal' {
  interface TerminalModalMap {
    'instance-example-order': Record<string, never>;
    'instance-example-connect': Record<string, never>;
    'instance-example-manage': Record<string, never>;
    'instance-example-end': Record<string, never>;
    instance: { id: string };
    'instance-manage': { id: string };
    'instance-resell': { id: string };
    'instance-end-confirm': { id: string };
    'instance-access': { id?: string; example?: boolean };
    connect: { id: string };
  }
}

type InstanceModalType =
  | 'instance-example-order'
  | 'instance-example-connect'
  | 'instance-example-manage'
  | 'instance-example-end'
  | 'instance'
  | 'instance-manage'
  | 'instance-resell'
  | 'instance-end-confirm'
  | 'instance-access'
  | 'connect';

/** One component renders every instance modal (legacy `OpenNEXTInstances.modal` + terminal `connect`). */
function InstanceModal({ modal, close }: { modal: ModalOf<InstanceModalType>; close: () => void }) {
  const instances = useWorkspaceData().instances as Instance[];
  const id = 'id' in modal ? modal.id : undefined;
  const name = () => {
    const i = instances.find((row) => row.id === id);
    return i ? i.name || i.model || 'Instance' : 'Instance unavailable';
  };
  switch (modal.type) {
    case 'instance-example-order':
      return (
        <ModalFrame title="Example purchase record" wide close={close}>
          <ExampleOrder />
        </ModalFrame>
      );
    case 'instance-example-connect':
      return (
        <ModalFrame title="Connect to your workspace" close={close}>
          <ExampleConnect />
        </ModalFrame>
      );
    case 'instance-example-manage':
      return (
        <ModalFrame title="Training workspace · example" close={close}>
          <ExampleManage />
        </ModalFrame>
      );
    case 'instance-example-end':
      return (
        <ModalFrame title="End this instance?" close={close}>
          <EndDialog isExample />
        </ModalFrame>
      );
    case 'instance':
    case 'instance-manage':
      return (
        <ModalFrame title={name()} close={close}>
          <Manage id={id} />
        </ModalFrame>
      );
    case 'instance-resell':
      return (
        <ModalFrame title="Resell idle capacity" close={close}>
          <Resell id={id} />
        </ModalFrame>
      );
    case 'instance-end-confirm':
      return (
        <ModalFrame title="End this instance?" close={close}>
          <EndDialog id={id} isExample={false} />
        </ModalFrame>
      );
    case 'instance-access':
      return (
        <ModalFrame title="SSH access" wide close={close}>
          <Access id={id} isExample={modal.example === true} />
        </ModalFrame>
      );
    case 'connect':
      return (
        <ModalFrame title="Connection details" close={close}>
          <Connect id={id} />
        </ModalFrame>
      );
    default:
      return null;
  }
}

const TYPES: InstanceModalType[] = [
  'instance-example-order',
  'instance-example-connect',
  'instance-example-manage',
  'instance-example-end',
  'instance',
  'instance-manage',
  'instance-resell',
  'instance-end-confirm',
  'instance-access',
  'connect',
];

/** Modals owned by the instances feature, keyed by type for the composition root. */
export const instanceModals: ModalComponents = Object.fromEntries(
  TYPES.map((type) => [type, InstanceModal as ModalComponent<ModalType>]),
) as ModalComponents;
