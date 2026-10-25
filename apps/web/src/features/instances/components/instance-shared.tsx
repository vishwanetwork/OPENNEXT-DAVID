'use client';

import { type ReactNode } from 'react';
import type { Instance, Order } from '@opennext/contracts';
import { useTerminal, useWorkspaceData } from '@/terminal-kit';
import { eligibility, lifecycle, telemetry } from '../lifecycle';
import { example, instanceView } from '../preview';
import { usePreviewScope, useTick } from './common';

export const Cell = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <small>{label}</small>
    <strong>{children}</strong>
  </div>
);

export function useInstance(id: string | undefined, isExample: boolean) {
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

export function OrderField({ i, isExample }: { i: Instance; isExample: boolean }) {
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
