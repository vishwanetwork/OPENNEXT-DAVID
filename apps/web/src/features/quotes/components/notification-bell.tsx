'use client';

import { useEffect, useRef } from 'react';
import { useOpenNotice, useQuoteNotifications } from '../hooks';
import { useTerminal } from '@/terminal-kit';
import { BellIcon, EmptyNotifications, NotificationRows, ServiceError } from './notification-list';

/** Header bell with the latest-10 dropdown (legacy `bell()` / `bellContents()`). */
export function NotificationBell() {
  const { rows, store, refresh } = useQuoteNotifications();
  const openNotice = useOpenNotice();
  const { go } = useTerminal();
  const shell = useRef<HTMLDivElement>(null);
  const unread = rows.filter((n) => !n.read).length;
  const { panel, muted, ready, pending, error } = store;

  // Refresh on mount, on window focus and every 30 s while visible (legacy bind()).
  useEffect(() => {
    void refresh();
    const onFocus = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener('focus', onFocus);
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(timer);
    };
  }, [refresh]);

  // Outside click and Escape close the dropdown.
  useEffect(() => {
    if (!panel) return;
    const onClick = (event: MouseEvent) => {
      if (!shell.current?.contains(event.target as Node)) store.setPanel(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        store.setPanel(false);
        shell.current?.querySelector<HTMLButtonElement>('[data-qp-action="bell"]')?.focus();
      }
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [panel, store]);

  const toggle = async () => {
    const next = !panel;
    store.setPanel(next);
    if (next) await refresh(true);
  };
  const more = async () => {
    store.setPanel(false);
    store.setPage(0);
    go('notifications');
    await refresh(true);
  };
  const label = `Notifications${unread ? ', ' + unread + ' unread' : ''}${muted ? ', alerts muted on this device' : ''}`;
  return (
    <div className="qp-bell-shell" data-qp-bell-shell ref={shell}>
      <button
        type="button"
        className="qp-bell"
        data-qp-action="bell"
        aria-label={label}
        aria-expanded={panel}
        aria-controls="qp-notification-dropdown"
        onClick={() => void toggle()}
      >
        <BellIcon />
        {unread && !muted ? <span className="qp-count">{unread > 99 ? '99+' : unread}</span> : null}
      </button>
      {panel ? (
        <section
          className="qp-dropdown"
          id="qp-notification-dropdown"
          aria-label="Latest notifications"
        >
          <header>
            <strong>Notifications</strong>
            <button
              type="button"
              className="qp-text-button"
              data-qp-action="mute"
              title="Mute the notification badge on this device; email settings are unchanged"
              onClick={store.toggleMuted}
            >
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button
              type="button"
              className="qp-text-button"
              data-qp-action="read-all"
              disabled={!unread}
              onClick={() => store.markRead(rows.map((n) => n.id))}
            >
              {unread ? 'Mark all as read' : 'All marked as read'}
            </button>
          </header>
          <div className="qp-notification-list">
            <ServiceError error={error} onRetry={() => void refresh(true)} />
            {rows.length ? (
              <NotificationRows rows={rows.slice(0, 10)} onOpen={openNotice} />
            ) : !ready && pending ? (
              <p className="qp-service-error">Loading notifications…</p>
            ) : (
              <EmptyNotifications />
            )}
          </div>
          <footer>
            <span>{muted ? 'Alerts muted on this device' : 'Latest 10 updates'}</span>
            <button
              type="button"
              className="qp-text-button"
              data-qp-action="more"
              onClick={() => void more()}
            >
              More <span aria-hidden="true">→</span>
            </button>
          </footer>
        </section>
      ) : null}
    </div>
  );
}
