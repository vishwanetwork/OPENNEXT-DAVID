'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '@/components/providers/app-context';
import { useToast } from '@/components/ui/toast';
import { CONSOLE_LOGO_PATH, ConsoleIcon as Icon } from '@/components/icons';
import { CONSOLE_PAGES, HIDDEN_PAGES, pageFromPath, pagePath, type ConsolePage } from '../pages';
import { useConsoleStore } from '../store';
import { detailPage, useDetailRequestStore, type DetailRequest } from '../detail-request';
import { initials } from '../helpers';
import { OverlayProvider, useOverlay } from './overlay';
import { LegacyHashRedirect } from './legacy-hash-redirect';
import { Badge, Btn } from './forms';
import '../console.css';

const COUNTED: ConsolePage[] = ['advisory', 'orders', 'instances', 'schedules', 'users'];
const NAV_ICON: Partial<Record<ConsolePage, string>> = {
  pricing: 'database',
  topups: 'billing',
  agent: 'agent',
};

function useCurrentPage(): string {
  const pathname = usePathname();
  const { base } = useApp();
  const relative = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  return pageFromPath(relative);
}

/** Navigation helper mirroring legacy `nav()`: closes overlays, resets paging and scrolls to top. */
export function useConsoleNav() {
  const router = useRouter();
  const { href } = useApp();
  const { close } = useOverlay();
  const setUi = useConsoleStore((s) => s.setUi);
  return useCallback(
    (page: string) => {
      close();
      setUi({ pageNumber: 1 });
      router.push(href(pagePath(page)));
      window.scrollTo({ top: 0, behavior: 'instant' });
    },
    [close, setUi, router, href],
  );
}

function Sidebar({ page }: { page: string }) {
  const { href } = useApp();
  const db = useConsoleStore((s) => s.db);
  const instanceTab = useConsoleStore((s) => s.instanceTab);
  const setUi = useConsoleStore((s) => s.setUi);
  const nav = useConsoleNav();
  const count = (id: ConsolePage) =>
    id === 'advisory'
      ? db.advisory.filter((x) => x.status === 'Open').length
      : (db[id as 'orders' | 'instances' | 'schedules' | 'users'] || []).length;
  return (
    <aside className="sidebar">
      <Link className="brand" href={href('/')} aria-label="OpenNEXT Operations Console">
        <svg viewBox="0 0 42 44" aria-hidden="true">
          <path d={CONSOLE_LOGO_PATH} />
        </svg>
        <div>
          <strong>OpenNEXT</strong>
          <span>OPERATIONS CONSOLE</span>
        </div>
      </Link>
      <div className="side-section">Workspace</div>
      <nav className="side-nav">
        {(Object.entries(CONSOLE_PAGES) as [ConsolePage, string][])
          .filter(([id]) => id !== 'settings')
          .map(([id, label]) => (
            <span key={id} style={{ display: 'contents' }}>
              <button
                type="button"
                className={`nav-item ${page === id ? 'active' : ''}`}
                onClick={() => nav(id)}
              >
                <Icon name={NAV_ICON[id] || id} />
                <span>{label}</span>
                {COUNTED.includes(id) ? <b className="count">{count(id)}</b> : null}
              </button>
              {id === 'instances' ? (
                <div className="side-sub">
                  {['Platform supplied', 'Seller supplied'].map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      className={page === 'instances' && instanceTab === tab ? 'active' : ''}
                      onClick={() => {
                        setUi({ instanceTab: tab });
                        nav('instances');
                      }}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              ) : null}
            </span>
          ))}
      </nav>
      <div className="side-footer">
        <div className="system-status">
          <span className="dot" />
          Workspace ready
        </div>
        <p>Policy revision {db.config.revision} · Read-only agent</p>
      </div>
    </aside>
  );
}

function Topbar({ page }: { page: string }) {
  const db = useConsoleStore((s) => s.db);
  const { crossHref } = useApp();
  const nav = useConsoleNav();
  const [menu, setMenu] = useState<'' | 'user' | 'notifications'>('');
  const { drawerRequest } = { drawerRequest: useDetailRequest() };
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
          <span className="env-pill">LOCAL WORKSPACE</span>
          <button
            type="button"
            className="icon-button"
            data-menu="notifications"
            aria-label="Notifications"
            onClick={() => setMenu(menu === 'notifications' ? '' : 'notifications')}
          >
            <Icon name="bell" />
            <span className="unread" />
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
            <Badge label="Supplier review" tone="orange" />
            <p style={{ marginTop: 6 }}>Pacific Compute’s rights review is pending.</p>
            <Btn
              className="link small"
              onClick={() => {
                setMenu('');
                drawerRequest({ kind: 'user', id: 'USR-1003' });
              }}
            >
              Review supplier
            </Btn>
          </div>
          <div className="notice">
            <Badge label="Delivery readiness" tone="blue" />
            <p style={{ marginTop: 6 }}>B200 reservation starts tomorrow.</p>
            <Btn
              className="link small"
              onClick={() => {
                setMenu('');
                drawerRequest({ kind: 'order', id: 'ORD-8023' });
              }}
            >
              Open order
            </Btn>
          </div>
          <button type="button" onClick={() => go('advisory')}>
            View all recommendations <Icon name="arrow" />
          </button>
        </div>
      ) : null}
    </>
  );
}

/** Opens a user / order / instance drawer on its page (see ../detail-request.ts). */
export function useDetailRequest() {
  const nav = useConsoleNav();
  const request = useDetailRequestStore((s) => s.request);
  return useCallback(
    (next: DetailRequest) => {
      request(next);
      nav(detailPage(next.kind));
    },
    [nav, request],
  );
}

function StorageWarning() {
  const error = useConsoleStore((s) => s.storageError);
  const toast = useToast();
  useEffect(() => {
    if (error) toast(error);
  }, [error, toast]);
  return null;
}

function Hydrate() {
  const hydrate = useConsoleStore((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);
  return null;
}

export function ConsoleShell({ children }: { children: ReactNode }) {
  return (
    <OverlayProvider>
      <ShellLayout>{children}</ShellLayout>
    </OverlayProvider>
  );
}

function ShellLayout({ children }: { children: ReactNode }) {
  const page = useCurrentPage();
  return (
    <div id="admin-app" className="app-console">
      <Hydrate />
      <StorageWarning />
      <LegacyHashRedirect />
      <div className="app-layout">
        <Sidebar page={page} />
        <div className="workspace">
          <Topbar page={page} />
          <main className="page">{children}</main>
        </div>
      </div>
    </div>
  );
}
