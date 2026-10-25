'use client';

import type { Order, OwnedRfq } from '@opennext/contracts';
import { money } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import { useTerminal, useWorkspaceData } from '@/terminal-kit';
import { PBtn, ReceiptDetails, RfqReviewNote, Tag, date, rfqStatus } from './shared';
import { RequirementFields } from './requirement-fields';
import { QuoteRows } from './quote-rows';

export function RecordView({ r }: { r: OwnedRfq | undefined }) {
  const { openModal } = useTerminal();
  const orders = useWorkspaceData().orders as Order[];
  const toast = useToast();
  if (!r) return <p>Requirement not found.</p>;
  const order = orders.find((o) => o.id === r.orderId);
  const backendOnly = () =>
    toast(
      'This action requires a verified backend transaction. Contact operations for assistance.',
    );
  return (
    <>
      <ReceiptDetails record={r} />
      <div className="row spread">
        <span className="form-note">
          {r.id}
          {r.sample ? ' · Preview requirement' : ''}
        </span>
        <Tag>{rfqStatus(r)}</Tag>
      </div>
      <RfqReviewNote r={r} />
      <RequirementFields r={r} />
      {['Open', 'Quoted'].includes(r.status) ? <QuoteRows r={r} /> : null}
      {order ? (
        <section className="proc-award">
          <h3>Selected supplier · {order.provider}</h3>
          <p>
            {order.id} · {money(order.total)} · {order.status}
          </p>
          <div className="row">
            <PBtn
              data-act="bill-order"
              data-id={order.id}
              onClick={() => openModal('bill-order', { id: order.id })}
            >
              Order details
            </PBtn>
            {order.paymentStatus !== 'Paid' ? (
              <PBtn
                primary
                data-act="proc-payment"
                data-id={order.id}
                onClick={() => openModal('proc-payment', { id: order.id })}
              >
                Review &amp; pay
              </PBtn>
            ) : order.status === 'Paid' ? (
              <PBtn
                primary
                data-act="proc-delivery"
                data-id={order.id}
                onClick={() => openModal('proc-delivery', { id: order.id })}
              >
                Confirm delivery details
              </PBtn>
            ) : order.status === 'Provisioning' ? (
              <PBtn
                primary
                data-act="proc-verify"
                data-id={order.id}
                onClick={() => openModal('proc-verify', { id: order.id })}
              >
                Verify delivery
              </PBtn>
            ) : order.status === 'Active' ? (
              <PBtn
                primary
                data-act="proc-manage"
                data-id={order.id}
                onClick={() => openModal('proc-manage', { id: order.id })}
              >
                Manage service
              </PBtn>
            ) : (
              <PBtn
                data-act="bill-order"
                data-id={order.id}
                onClick={() => openModal('bill-order', { id: order.id })}
              >
                View completed order
              </PBtn>
            )}
          </div>
        </section>
      ) : null}
      <div className="modal-footer">
        {['Reviewing', 'Rejected', 'Open', 'Quoted'].includes(r.status) ? (
          <PBtn
            data-act="proc-edit"
            data-id={r.id}
            onClick={() => openModal('proc-edit', { id: r.id })}
          >
            Edit requirement
          </PBtn>
        ) : null}
        {['Open', 'Quoted'].includes(r.status) ? (
          <PBtn data-act="proc-close" data-id={r.id} onClick={backendOnly}>
            Close RFQ
          </PBtn>
        ) : null}
      </div>
      <details className="proc-audit">
        <summary>Decision history &amp; rejected quotes</summary>
        {(r.audit || []).length ? (
          (r.audit || []).map((a, i) => (
            <p key={i}>
              {date(a.at)} · {a.event}
            </p>
          ))
        ) : (
          <p>No decisions yet.</p>
        )}
        {(r.quotes || [])
          .filter((q) => q.status !== 'Pending')
          .map((q) => (
            <p key={q.id}>
              {q.provider} · {q.status} · {money(q.price)}
            </p>
          ))}
      </details>
    </>
  );
}
