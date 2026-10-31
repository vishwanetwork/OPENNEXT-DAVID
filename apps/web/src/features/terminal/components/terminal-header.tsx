'use client';

import { useEffect, useRef, useState } from 'react';
import { ConsoleIcon, LucideIcon } from '@/components/icons';
import { TerminalBrand } from '@/components/ui/terminal-brand';
import { money } from '@/lib/format';
import {
  roleLabel,
  useBalance,
  useIsDemo,
  useTerminal,
  useTerminalSlots,
  useWorkspaceStore,
  type Role,
  type TerminalRoute,
} from '@/terminal-kit';

export interface TerminalHeaderProps {
  onSignOut: () => void;
  onRole: (role: Role) => void;
  onContact: () => void;
}

export function TerminalHeader({ onSignOut, onRole, onContact }: TerminalHeaderProps) {
  const { go, route, home } = useTerminal();
  const { headerBell } = useTerminalSlots();
  const role = useWorkspaceStore((s) => s.role);
  const identity = useWorkspaceStore((s) => s.identity);
  const balance = useBalance();
  const isDemo = useIsDemo();
  const displayName = isDemo ? 'My account' : identity.name;
  const userOpen = useWorkspaceStore((s) => s.userOpen);
  const setUserOpen = useWorkspaceStore((s) => s.setUserOpen);
  const savedCount = useWorkspaceStore((s) => s.saved.length);
  const cartCount = useWorkspaceStore((s) => s.cart.length);
  const header = useRef<HTMLElement>(null);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const setAgentOpen = useWorkspaceStore((s) => s.setAgentOpen);
  useEffect(() => {
    if (!userOpen) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest('.user-pop') && !target.closest('.user-button')) setUserOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [userOpen, setUserOpen]);

  useEffect(() => {
    if (!navigationOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavigationOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [navigationOpen]);

  const seller = role === 'seller';
  const navIcons: Partial<Record<TerminalRoute, string>> = {
    market: 'overview',
    insight: 'market',
    rfqs: 'orders',
    supply: 'orders',
    instances: 'instances',
    billing: 'billing',
  };
  const items: [TerminalRoute, string][] = [
    ['market', seller ? 'Market Insight' : 'GPU Market'],
    ...(seller ? [] : ([['insight', 'Market Insight']] as [TerminalRoute, string][])),
    [seller ? 'supply' : 'rfqs', seller ? 'Supply' : 'RFQs & Quote'],
    ['instances', 'Instances'],
    ['billing', 'Billing'],
  ];
  const initials = displayName
    .split(' ')
    .map((x) => x[0])
    .slice(0, 2)
    .join('');
  const nav = (target: TerminalRoute) => {
    setUserOpen(false);
    setNavigationOpen(false);
    go(target);
  };
  return (
    <>
      {navigationOpen ? (
        <button
          type="button"
          className="buyer-nav-scrim"
          aria-label="Close navigation backdrop"
          onClick={() => setNavigationOpen(false)}
        />
      ) : null}
      <header ref={header} className="terminal-head preview-terminal-head">
        <button
          type="button"
          className="buyer-mobile-nav"
          aria-label="Open navigation"
          aria-expanded={navigationOpen}
          onClick={() => setNavigationOpen(!navigationOpen)}
        >
          <LucideIcon name="list" size={21} />
        </button>

        <a
          className="preview-terminal-brand"
          href="#"
          data-act="home"
          aria-label="OpenNEXT home"
          onClick={(e) => {
            e.preventDefault();
            home();
          }}
        >
          <TerminalBrand />
        </a>
        <div className={`buyer-top-navigation ${navigationOpen ? 'is-open' : ''}`}>
          <button
            type="button"
            className="buyer-sidebar-close"
            aria-label="Close navigation"
            onClick={() => setNavigationOpen(false)}
          >
            ×
          </button>

          <div
            className="buyer-role-switch"
            aria-label={`Current workspace role: ${roleLabel(role)}`}
          >
            <button
              type="button"
              className={role === 'buyer' ? 'active' : ''}
              onClick={() => onRole('buyer')}
            >
              Buyer
            </button>
            <button type="button" disabled aria-disabled="true">
              Seller
            </button>
          </div>
          <nav className="preview-terminal-nav" aria-label="Terminal navigation">
            {items.map(([target, label]) => (
              <button
                key={target}
                type="button"
                data-nav={target}
                aria-current={route === target ? 'page' : undefined}
                onClick={() => nav(target)}
              >
                <ConsoleIcon name={navIcons[target] || 'overview'} className="buyer-nav-icon" />
                {label}
              </button>
            ))}
          </nav>
          <nav className="buyer-collections" aria-label="Saved capacity and quote cart">
            <button
              type="button"
              aria-label="Saved capacity"
              title="Saved capacity"
              aria-current={route === 'saved' ? 'page' : undefined}
              onClick={() => nav('saved')}
            >
              <ConsoleIcon name="database" className="buyer-nav-icon" />
              <span className="buyer-collection-label">Saved capacity</span>
              <span className="buyer-collection-count">{savedCount || ''}</span>
            </button>
            <button
              type="button"
              aria-label="Quote cart"
              title="Quote cart"
              aria-current={route === 'cart' ? 'page' : undefined}
              onClick={() => nav('cart')}
            >
              <ConsoleIcon name="orders" className="buyer-nav-icon" />
              <span className="buyer-collection-label">Quote cart</span>
              <span className="buyer-collection-count">{cartCount || ''}</span>
            </button>
          </nav>
          <div className="buyer-sidebar-bottom">
            <button
              type="button"
              className="buyer-agent-button"
              onClick={() => {
                setNavigationOpen(false);
                setAgentOpen(true);
              }}
            >
              <ConsoleIcon name="agent" className="buyer-nav-icon" />
              OpenNEXT Agent <span aria-hidden="true">↗</span>
            </button>
            <button type="button" onClick={() => nav('help')}>
              Help &amp; documentation
            </button>
          </div>
        </div>

        <button type="button" className="credit" data-nav="billing" onClick={() => nav('billing')}>
          Credit <strong>{money(balance.available)}</strong>
        </button>
        {headerBell}
        <button
          type="button"
          className="user-button"
          data-act="user-toggle"
          aria-expanded={userOpen}
          aria-label="User menu"
          onClick={() => setUserOpen(!userOpen)}
        >
          <span className="avatar">{initials}</span>
          <b>{displayName}⌄</b>
        </button>
        {userOpen ? (
          <div className="user-pop">
            <div className="buyer-account-role buyer-role-switch" aria-label="Workspace role">
              <button type="button" className="active" onClick={() => onRole('buyer')}>
                Buyer
              </button>
              <button type="button" disabled aria-disabled="true">
                Seller
              </button>
            </div>
            <strong style={{ fontSize: 13 }}>{displayName}</strong>
            {!isDemo && identity.email ? (
              <div className="buyer-account-email">{identity.email}</div>
            ) : null}
            <div className="user-links">
              <button type="button" data-nav="profile" onClick={() => nav('profile')}>
                Profile
              </button>
              <button type="button" data-nav="notifications" onClick={() => nav('notifications')}>
                Notification
              </button>
              <button type="button" data-nav="saved" onClick={() => nav('saved')}>
                Saved <span className="preview-menu-count">{savedCount}</span>
              </button>
              <button type="button" data-nav="cart" onClick={() => nav('cart')}>
                Quote Cart <span className="preview-menu-count">{cartCount}</span>
              </button>
              <button type="button" data-nav="settings" onClick={() => nav('settings')}>
                Settings
              </button>
              <button type="button" data-nav="help" onClick={() => nav('help')}>
                Help & documentation
              </button>
              <button type="button" data-act="signout" onClick={onSignOut}>
                Sign out
              </button>
            </div>
            <div className="preview-menu-footer">
              <button
                className="preview-menu-contact"
                type="button"
                data-act="contact-us"
                onClick={() => {
                  setUserOpen(false);
                  onContact();
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="m3 6 9 7 9-7" />
                </svg>
                Contact us
              </button>
              <div className="preview-menu-socials" aria-label="Social media">
                <button
                  type="button"
                  className="preview-menu-social"
                  disabled
                  aria-label="X — link coming soon"
                  title="X — link coming soon"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.4l8.2-9.4L2 2h6.5l4.4 6.7L18.9 2Zm-1.1 18h1.7L7.5 4H5.7l12.1 16Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="preview-menu-social"
                  disabled
                  aria-label="LinkedIn — link coming soon"
                  title="LinkedIn — link coming soon"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M5.2 7.7H1.6V22h3.6V7.7ZM3.4 1A2.1 2.1 0 1 0 3.4 5.2 2.1 2.1 0 0 0 3.4 1ZM22 13.2c0-4.3-2.3-6.3-5.3-6.3a4.6 4.6 0 0 0-4.1 2.2V7.7H9V22h3.6v-8c0-2.1.4-4.1 2.9-4.1 2.5 0 2.5 2.3 2.5 4.2V22h4V13.2Z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </header>
    </>
  );
}
