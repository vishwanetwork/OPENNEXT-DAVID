'use client';

import { create } from 'zustand';

import { useState, type FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';
import { useInvalidateWorkspace, useTerminal, useTerminalSlots } from '@/terminal-kit';
import { lifecycle } from '../lifecycle';
import { endDemo, endExample, localDemo } from '../preview';
import { IBtn } from './common';
import { Cell, useInstance } from './instance-shared';
import { AsyncButton, AsyncFeedback } from '@/components/ui/async-feedback';

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

/** Instance keys with a termination request in flight; survives the dialog being remounted. */
const useEnding = create<{ keys: Record<string, true> }>(() => ({ keys: {} }));
const ending = {
  has: (key: string) => Boolean(useEnding.getState().keys[key]),
  add: (key: string) => useEnding.setState((s) => ({ keys: { ...s.keys, [key]: true } })),
  delete: (key: string) =>
    useEnding.setState((s) => {
      const keys = { ...s.keys };
      delete keys[key];
      return { keys };
    }),
};

export function EndDialog({ id, isExample }: { id?: string; isExample: boolean }) {
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
      closeModal();
      toast('Instance ended. The backend confirmed release.');
      void invalidate().catch((failure: unknown) => toast((failure as Error).message));
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
      {busy ? (
        <AsyncFeedback>Ending the instance. Waiting for release confirmation…</AsyncFeedback>
      ) : null}
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
            <AsyncButton
              type="submit"
              className="btn danger"
              disabled={(!local && !configured) || busy || life.ended}
              busy={busy}
              busyLabel="Ending…"
            >
              END instance
            </AsyncButton>
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
