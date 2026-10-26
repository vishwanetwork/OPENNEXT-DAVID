'use client';

import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/providers/app-context';
import { ConsoleIcon as Icon } from '@/components/icons';
import { CONSOLE_PAGES, HIDDEN_PAGES } from '../pages';
import { useConsoleStore } from '../store';
import { initials } from '../helpers';
import { useConsoleNav } from './shell';

export function Topbar({ page }: { page: string }) {
  const db = useConsoleStore((s) => s.db);
  const { crossHref } = useApp();
  const nav = useConsoleNav();
  const [menu, setMenu] = useState<'' | 'user' | 'notifications'>('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.top-popover') && !target.closest('[data-menu]')) setMenu('');
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu('');
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);
  const go = (target: string) => {
    setMenu('');
    nav(target);
  };
  const title =
    (CONSOLE_PAGES as Record<string, string>)[page] || HIDDEN_PAGES[page] || CONSOLE_PAGES.overview;
  return (
    <>
      <header className="topbar" ref={root}>
        <div className="breadcrumb">
          Operations <Icon name="chevron" />
          <strong>{title}</strong>
        </div>
        <div className="top-actions">
          <span className="env-pill">OPERATIONS</span>
          <button
            type="button"
            className="icon-button"
            data-menu="notifications"
            aria-label="Notifications"
            onClick={() => setMenu(menu === 'notifications' ? '' : 'notifications')}
          >
            <Icon name="bell" />
          </button>
          <button
            type="button"
            className="admin-user"
            data-menu="user"
            onClick={() => setMenu(menu === 'user' ? '' : 'user')}
          >
            <span className="avatar">{initials(db.profile.name)}</span>
            <div>
              <strong>{db.profile.name}</strong>
              <small>Administrator</small>
            </div>
            <Icon name="down" />
          </button>
        </div>
      </header>
      {menu === 'user' ? (
        <div className="top-popover">
          <header>
            <strong>{db.profile.name}</strong>
            <small className="muted">{db.profile.email}</small>
          </header>
          <button type="button" onClick={() => go('settings')}>
            <Icon name="settings" />
            My account &amp; preferences
          </button>
          <button type="button" onClick={() => go('users')}>
            <Icon name="users" />
            Team &amp; access
          </button>
          <button type="button" onClick={() => go('audit')}>
            <Icon name="audit" />
            Audit log
          </button>
          <a href={crossHref('terminal', '/market')} role="button">
            <Icon name="logout" />
            Return to Capacity Terminal
          </a>
        </div>
      ) : null}
      {menu === 'notifications' ? (
        <div className="top-popover">
          <header>
            <strong>Operations inbox</strong>
            <small className="muted">Items requiring your attention</small>
          </header>
          <div className="notice">
            <p>Review customer requests and the latest recorded decisions.</p>
          </div>
          <button type="button" onClick={() => go('requests')}>
            Open requests <Icon name="arrow" />
          </button>
          <button type="button" onClick={() => go('overview')}>
            Recent activity <Icon name="arrow" />
          </button>
        </div>
      ) : null}
    </>
  );
}
