'use client';

import { useState, type FormEvent } from 'react';
import { useApi } from '@/components/providers/api-context';
import { useToast } from '@/components/ui/toast';
import { useApiErrorToast } from '@/components/hooks/use-api-error-toast';
import { instancesApi } from '../api';
import { useInvalidateWorkspace, useTerminal } from '@/terminal-kit';
import { lifecycle, moneyOrNa, sshCommand, timestamp } from '../lifecycle';
import { localDemo } from '../preview';
import { IBtn, SshLibrary } from './common';
import { Cell, OrderField, useInstance } from './instance-shared';
import { InstanceKeys } from './instance-keys';

export function Manage({ id }: { id?: string }) {
  const { openModal, closeModal, toast } = useTerminal();
  const { i, life, e, t, demo, role } = useInstance(id, false);
  const api = useApi();
  const invalidate = useInvalidateWorkspace();
  const toastError = useApiErrorToast();
  if (!i) return <p>Refresh your instances and try again.</p>;
  const refresh = () => invalidate().catch(toastError);
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

export function Resell({ id }: { id?: string }) {
  const toastError = useApiErrorToast();
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
        <IBtn act="instance-refresh" id={i.id} onClick={() => invalidate().catch(toastError)}>
          Refresh status
        </IBtn>
      </>
    );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    setBusy(true);
    try {
      await instancesApi.resell(api, i.id, {
        count: Number(data.count),
        rate: Number(data.rate),
        hours: Number(data.hours),
      });
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
        <button type="submit" className="btn" disabled={busy || !e.allowed}>
          Submit resale request
        </button>
      </div>
    </form>
  );
}

export function Access({ id, isExample }: { id?: string; isExample: boolean }) {
  const { openModal, closeModal } = useTerminal();
  const { i, demo } = useInstance(id, isExample);
  if (!i) return <p>Refresh your instances and try again.</p>;
  const notConnected = (
    <p className="form-note instance-access-installation">
      {isExample
        ? 'This example has no server to connect to.'
        : 'Instance-specific key installation is not connected yet.'}{' '}
      Save a public key below for provisioning. Adding a key here does not install it on an existing
      instance.
    </p>
  );
  return (
    <>
      <div className="instance-access-summary">
        <strong>
          {i.count} × {i.model}
        </strong>
        <span>{i.region || 'Region not provided'}</span>
      </div>
      {isExample || localDemo(i, demo) ? (
        notConnected
      ) : (
        <InstanceKeys id={i.id} ended={lifecycle(i).ended} fallback={notConnected} />
      )}
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

export function Connect({ id }: { id?: string }) {
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
      <p className="form-note">
        If the key is not your SSH client&apos;s default key, add its private key file, for example{' '}
        <code>ssh -i ~/.ssh/your_key …</code>. Keys are managed under Manage → SSH keys.
      </p>
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
