'use client';

import { useEffect } from 'react';
import { NOTIFICATION_PAGE } from '../notifications';
import { useOpenNotice, useQuoteNotifications } from '../hooks';
import { EmptyNotifications, NotificationRows, ServiceError } from './NotificationList';
import '../quotes.css';

/** Notifications history page (legacy `history()`). */
export function NotificationsPage() {
  const { rows, store, refresh } = useQuoteNotifications();
  const openNotice = useOpenNotice();
  const unread = rows.some((n) => !n.read);
  const pages = Math.max(0, Math.ceil(rows.length / NOTIFICATION_PAGE) - 1);
  const page = Math.min(store.page, pages);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const start = page * NOTIFICATION_PAGE;
  return (
    <div className="page-content qp-page" data-qp-history>
      <div className="qp-page-heading">
        <div><h1>Notifications</h1><p>Account updates and quote decisions in one place.</p></div>
        <button type="button" className="btn secondary" data-qp-action="read-all" disabled={!unread} onClick={() => store.markRead(rows.map((n) => n.id))}>Mark all as read</button>
      </div>
      <div className="qp-history-panel">
        <ServiceError error={store.error} onRetry={() => void refresh(true)} />
        {rows.length ? <NotificationRows rows={rows.slice(start, start + NOTIFICATION_PAGE)} onOpen={openNotice} /> : <EmptyNotifications />}
      </div>
      <div className="qp-pagination">
        <span>{rows.length ? `${start + 1}–${Math.min(start + NOTIFICATION_PAGE, rows.length)} of ${rows.length} notifications` : 'No previous updates'}</span>
        <button type="button" className="btn secondary small" data-qp-action="previous" disabled={!page} onClick={() => store.setPage(page - 1)}>Previous</button>
        <button type="button" className="btn secondary small" data-qp-action="next" disabled={start + NOTIFICATION_PAGE >= rows.length} onClick={() => store.setPage(page + 1)}>Next</button>
      </div>
      <p className="qp-request-empty">Read and mute preferences are saved on this device. Email delivery depends on the configured notification service.</p>
    </div>
  );
}
