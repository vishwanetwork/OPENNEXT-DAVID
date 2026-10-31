'use client';

import type { Order } from '@opennext/contracts';
import { money } from '@/lib/format';
import { useTerminal, useWorkspaceStore } from '@/terminal-kit';
import { FeeBreakdown, FieldList, date } from './shared';

/* ---------- Orders ---------- */
export function OrderAction({
  type,
  o,
}: {
  type: 'proc-payment' | 'proc-delivery' | 'proc-verify' | 'proc-manage';
  o: Order | undefined;
}) {
  const { go, closeModal } = useTerminal();
  const role = useWorkspaceStore((s) => s.role);
  if (!o) return <>The order could not be found.</>;
  const side = o.side || (role === 'seller' ? 'sell' : 'buy');
  const note =
    type === 'proc-payment'
      ? 'Secure order checkout is not connected yet. The payment provider must confirm payment before provisioning begins. No funds have been charged.'
      : type === 'proc-delivery'
        ? 'Delivery begins after verified payment and backend provisioning. Access details will be attached to this order by the delivery integration.'
        : type === 'proc-verify'
          ? 'Acceptance checks become available after the backend confirms delivery. Browser actions cannot create or activate GPU instances.'
          : 'Manage active capacity in My Instances. The backend verifies service windows, access rights and utilization before changes are allowed.';
  return (
    <>
      <div className="details-grid">
        <FieldList
          items={[
            ['Order', o.id],
            ['Resource', o.model],
            ['Region', o.region],
            ['Quantity', o.count + ' GPU'],
            ['Base unit price', money(o.unitPrice ?? o.rate)],
            ['Payment', o.paymentStatus || 'Unpaid'],
            ['Service starts', date(o.serviceStart)],
            ['Service ends', date(o.serviceEnd)],
          ]}
        />
      </div>
      <FeeBreakdown record={o} side={side} />
      <div className="callout">{note}</div>
      <div className="modal-footer">
        {type === 'proc-payment' ? (
          <button
            className="btn"
            type="button"
            disabled
            title="Order payment integration is pending"
          >
            Proceed to payment
          </button>
        ) : null}
        <button
          className="btn secondary"
          type="button"
          data-nav={type === 'proc-manage' ? 'instances' : 'billing'}
          onClick={() => {
            closeModal();
            go(type === 'proc-manage' ? 'instances' : 'billing');
          }}
        >
          {type === 'proc-manage' ? 'My Instances' : 'Open billing'}
        </button>
      </div>
    </>
  );
}

export const orderActionTitle = (type: string, o: Order | undefined) =>
  o
    ? (type === 'proc-payment'
        ? 'Review payment'
        : type === 'proc-delivery'
          ? 'Delivery details'
          : type === 'proc-verify'
            ? 'Verify delivery'
            : 'Manage service') +
      ' ' +
      o.id
    : 'Order unavailable';
