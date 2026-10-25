'use client';

import Link from 'next/link';
import { useApp } from '@/components/providers/app-context';
import { CONSOLE_LOGO_PATH, ConsoleIcon as Icon } from '@/components/icons';
import { CONSOLE_PAGES, type ConsolePage } from '../pages';
import { useConsoleStore } from '../store';
import { useConsoleNav } from './shell';

const COUNTED: ConsolePage[] = ['advisory', 'orders', 'instances', 'schedules', 'users'];

const NAV_ICON: Partial<Record<ConsolePage, string>> = {
  pricing: 'database',
  topups: 'billing',
  agent: 'agent',
};

export function Sidebar({ page }: { page: string }) {
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
