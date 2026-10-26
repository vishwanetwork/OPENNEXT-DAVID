'use client';

import Link from 'next/link';
import { useApp } from '@/components/providers/app-context';
import { CONSOLE_LOGO_PATH, ConsoleIcon as Icon } from '@/components/icons';
import { CONSOLE_PAGES, REQUEST_PAGES, SIDEBAR_PAGES } from '../pages';
import { useConsoleNav } from './shell';

export function Sidebar({ page }: { page: string }) {
  const { href } = useApp();
  const nav = useConsoleNav();
  const active = REQUEST_PAGES.some((item) => item === page)
    ? 'requests'
    : page === 'billing'
      ? 'agent'
      : page;
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
      <nav className="side-nav" aria-label="Console navigation">
        {SIDEBAR_PAGES.map((id) => (
          <div key={id}>
            <button
              type="button"
              className={'nav-item ' + (active === id ? 'active' : '')}
              aria-current={active === id ? 'page' : undefined}
              onClick={() => nav(id)}
            >
              <Icon name={id === 'requests' ? 'advisory' : id === 'pricing' ? 'database' : id} />
              <span>{CONSOLE_PAGES[id]}</span>
            </button>
            {id === 'requests' && active === id ? (
              <div className="side-sub">
                {REQUEST_PAGES.map((item) => (
                  <Link
                    key={item}
                    href={href('/' + item)}
                    aria-current={page === item ? 'page' : undefined}
                  >
                    {item === 'kyb' ? 'KYB Review Requests' : CONSOLE_PAGES[item]}
                  </Link>
                ))}
              </div>
            ) : null}
            {id === 'instances' && active === id ? (
              <div className="side-sub">
                {['Spot', 'On-demand', 'Reserved'].map((term) => (
                  <Link key={term} href={href('/instances?term=' + encodeURIComponent(term))}>
                    {term}
                  </Link>
                ))}
              </div>
            ) : null}
            {id === 'agent' && active === id ? (
              <div className="side-sub">
                <Link href={href('/agent')}>Configuration</Link>
                <Link href={href('/agent?tab=billing')}>Agent billing</Link>
              </div>
            ) : null}
          </div>
        ))}
      </nav>
      <div className="side-footer">
        <div className="system-status">
          <span className="dot" />
          Operations workspace
        </div>
        <p>Private access · Human approval required</p>
      </div>
    </aside>
  );
}
