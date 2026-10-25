'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Brand } from '@/components/ui/brand';
import { money } from '@/lib/format';
import { useTerminal } from '../context';
import { useWorkspaceStore } from '../store';
import type { TerminalRoute } from '../routing';

/** Slot for the quote-preview notification bell (another feature registers it). */
let bellSlot: (() => ReactNode) | null = null;
export function registerHeaderBell(render: (() => ReactNode) | null) {
  bellSlot = render;
}

export interface TerminalHeaderProps {
  onSignOut: () => void;
  onRole: (role: 'Buyer' | 'Seller') => void;
  onContact: () => void;
}

export function TerminalHeader({ onSignOut, onRole, onContact }: TerminalHeaderProps) {
  const { go, route, home } = useTerminal();
  const role = useWorkspaceStore((s) => s.role);
  const identity = useWorkspaceStore((s) => s.identity);
  const balance = useWorkspaceStore((s) => s.balance);
  const userOpen = useWorkspaceStore((s) => s.userOpen);
  const setUserOpen = useWorkspaceStore((s) => s.setUserOpen);
  const savedCount = useWorkspaceStore((s) => s.saved.length);
  const cartCount = useWorkspaceStore((s) => s.cart.length);
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!userOpen) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest('.user-pop') && !target.closest('.user-button')) setUserOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [userOpen, setUserOpen]);

  const items: [TerminalRoute, string][] = [
    ['market', role === 'Seller' ? 'Market Insight' : 'GPU Market'],
    ...(role === 'Buyer' ? ([['insight', 'Market Insight']] as [TerminalRoute, string][]) : []),
    [role === 'Seller' ? 'supply' : 'rfqs', role === 'Seller' ? 'Supply' : 'RFQs & Quote'],
    ['instances', 'Instances'],
    ['billing', 'Billing'],
  ];
  const initials = identity.name
    .split(' ')
    .map((x) => x[0])
    .slice(0, 2)
    .join('');
  const nav = (target: TerminalRoute) => {
    setUserOpen(false);
    go(target);
  };
  return (
    <header ref={header} className="terminal-head preview-terminal-head">
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
        <Brand />
      </a>
      <span className="preview-workspace-role" aria-label={`Current workspace role: ${role}`}>
        {role.toUpperCase()}
      </span>
      <nav className="preview-terminal-nav" aria-label="Terminal navigation">
        {items.map(([target, label]) => (
          <button
            key={target}
            type="button"
            data-nav={target}
            aria-current={route === target ? 'page' : undefined}
            onClick={() => nav(target)}
          >
            {label}
          </button>
        ))}
      </nav>
      <button type="button" className="credit" data-nav="billing" onClick={() => nav('billing')}>
        Credit <strong>{money(balance)}</strong>
      </button>
      {bellSlot?.()}
      <button
        type="button"
        className="user-button"
        data-act="user-toggle"
        aria-expanded={userOpen}
        aria-label="User menu"
        onClick={() => setUserOpen(!userOpen)}
      >
        <span className="avatar">{initials}</span>
        <b>{identity.name}⌄</b>
      </button>
      {userOpen ? (
        <div className="user-pop">
          <strong style={{ fontSize: 13 }}>{identity.name}</strong>
          <div className="muted" style={{ fontSize: 11, margin: '6px 0 18px' }}>
            {identity.email}
          </div>
          <span className="eyebrow muted">Workspace role</span>
          <div className="role-tabs">
            {(['Buyer', 'Seller', 'Broker'] as const).map((r) => (
              <button
                key={r}
                type="button"
                className={`role-tab ${role === r ? 'active' : ''}`}
                data-act="role"
                data-value={r}
                disabled={r === 'Broker'}
                title={r === 'Broker' ? 'Coming soon' : undefined}
                onClick={() => r !== 'Broker' && onRole(r)}
              >
                {r}
              </button>
            ))}
          </div>
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
  );
}
