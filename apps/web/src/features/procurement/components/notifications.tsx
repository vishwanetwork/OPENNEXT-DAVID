'use client';

import type { WorkspaceNotification } from '@opennext/contracts';
import { useSessionStore } from '@/lib/session-store';
import { roleLabel, useNotifications, useTerminal, useWorkspaceStore } from '@/terminal-kit';
import { useProcurementUi } from '../ui-store';
import { PBtn, date } from './shared';

/** Workspace notifications panel (latest 15) with "Mark all read" and the full page link. */
export function NotificationsPanel() {
  const { go, openModal } = useTerminal();
  const role = useWorkspaceStore((s) => s.role);
  const readIds = useProcurementUi((s) => s.readNotificationIds);
  const markReadIds = useProcurementUi((s) => s.markRead);
  const owner = useSessionStore((s) => s.user?.id);
  const notifications: WorkspaceNotification[] = useNotifications().map((n) =>
    readIds.includes(n.id) ? { ...n, read: true } : n,
  );
  const items = notifications
    .filter((n) => (n.ownerId ? n.ownerId === owner : n.role === roleLabel(role)))
    .slice(0, 15);
  const markRead = () =>
    markReadIds(notifications.filter((n) => n.role === roleLabel(role)).map((n) => n.id));
  return (
    <section className="panel">
      <div className="row spread">
        <h2>Workspace notifications</h2>
        <div className="row">
          {items.some((n) => !n.read) ? (
            <PBtn data-act="proc-read" onClick={markRead}>
              Mark all read
            </PBtn>
          ) : null}
          <PBtn data-act="proc-notifications" onClick={() => go('notifications')}>
            View notifications
          </PBtn>
        </div>
      </div>
      {items.length ? (
        items.map((n) => {
          const orderId = n.orderId ? String(n.orderId) : '';
          const rfqId = n.rfqId ? String(n.rfqId) : '';
          return (
            <article key={n.id} className={`proc-notice ${n.read ? 'read' : ''}`}>
              <div>
                <strong>{n.subject}</strong>
                <small>
                  {date(n.created || n.createdAt)}
                  {n.supplier ? ' ' + n.supplier : ''}
                </small>
                <p>{n.message}</p>
              </div>
              {orderId ? (
                <PBtn
                  data-act="bill-order"
                  data-id={orderId}
                  onClick={() => openModal('bill-order', { id: orderId })}
                >
                  Order details
                </PBtn>
              ) : rfqId ? (
                <PBtn
                  data-act="view-rfq"
                  data-id={rfqId}
                  onClick={() => openModal('proc-request-details', { id: rfqId })}
                >
                  View RFQ
                </PBtn>
              ) : null}
            </article>
          );
        })
      ) : (
        <p className="form-note">Quote, payment and delivery updates will appear here.</p>
      )}
    </section>
  );
}
