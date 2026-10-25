'use client';

import type { Notice } from '../notifications';
import { formatDate } from '../notifications';

export const BellIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="19"
    height="19"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden="true"
  >
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
    <path d="M10 21h4" />
  </svg>
);

export function EmptyNotifications() {
  return (
    <div className="qp-empty">
      <div className="qp-empty-icon">
        <BellIcon />
      </div>
      <h3>No notifications yet</h3>
      <p>Quote, review, payment and delivery updates will appear here.</p>
    </div>
  );
}

export function NotificationRows({
  rows,
  onOpen,
}: {
  rows: Notice[];
  onOpen: (n: Notice) => void;
}) {
  return (
    <>
      {rows.map((n) => (
        <button
          key={n.id}
          type="button"
          className={`qp-notification ${n.read ? '' : 'qp-unread'}`}
          data-qp-action="notification"
          data-qp-id={n.id}
          onClick={() => onOpen(n)}
        >
          <span className="qp-read-dot" aria-label={n.read ? 'Read' : 'Unread'} />
          <span>
            <strong>{n.title}</strong>
            <span className="qp-notification-copy">{n.message}</span>
            <time dateTime={n.createdAt}>{formatDate(n.createdAt)}</time>
          </span>
        </button>
      ))}
    </>
  );
}

export function ServiceError({ error, onRetry }: { error: string; onRetry: () => void }) {
  if (!error) return null;
  return (
    <p className="qp-service-error" role="status">
      {error}{' '}
      <button type="button" className="qp-text-button" data-qp-action="refresh" onClick={onRetry}>
        Retry
      </button>
    </p>
  );
}
