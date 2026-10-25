'use client';

import type { WorkspaceNotification } from '@opennext/contracts';
import { useSessionStore } from '@/lib/session-store';
import { useTerminal } from '@/features/terminal/context';
import { useWorkspaceStore } from '@/features/terminal/store';
import { PBtn, date } from './shared';

/** Workspace notifications panel (latest 15) with "Mark all read" and the full page link. */
export function NotificationsPanel() {
  const { go, openModal } = useTerminal();
  const role = useWorkspaceStore((s) => s.role);
  const notifications = useWorkspaceStore((s) => s.notifications) as WorkspaceNotification[];
  const patch = useWorkspaceStore((s) => s.patch);
  const owner = useSessionStore((s) => s.user?.id);
  const items = notifications.filter((n) => (n.ownerId ? n.ownerId === owner : n.role === role || (role === 'Broker' && ['Buyer', 'Seller'].includes(String(n.role))))).slice(0, 15);
  const markRead = () => patch({ notifications: notifications.map((n) => (n.role === role || (role === 'Broker' && ['Buyer', 'Seller'].includes(String(n.role))) ? { ...n, read: true } : n)) });
  return (
    <section className="panel">
      <div className="row spread">
        <h2>Workspace notifications</h2>
        <div className="row">
          {items.some((n) => !n.read) ? <PBtn data-act="proc-read" onClick={markRead}>Mark all read</PBtn> : null}
          <PBtn data-act="proc-notifications" onClick={() => go('notifications')}>View notifications</PBtn>
        </div>
      </div>
      {items.length ? (
        items.map((n) => (
          <article key={n.id} className={`proc-notice ${n.read ? 'read' : ''}`}>
            <div>
              <strong>{n.subject}</strong>
              <small>
                {date(n.created || n.createdAt)}
                {n.supplier ? ' · ' + n.supplier : ''}
              </small>
              <p>{n.message}</p>
            </div>
            {n.orderId ? (
              <PBtn data-act="bill-order" data-id={n.orderId} onClick={() => openModal('bill-order', { id: n.orderId })}>Order details</PBtn>
            ) : n.rfqId ? (
              <PBtn data-act="view-rfq" data-id={n.rfqId} onClick={() => openModal('proc-request-details', { id: n.rfqId })}>View RFQ</PBtn>
            ) : null}
          </article>
        ))
      ) : (
        <p className="form-note">Quote, payment and delivery updates will appear here.</p>
      )}
    </section>
  );
}
