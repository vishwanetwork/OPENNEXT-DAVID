'use client';

import Link from 'next/link';
import { useApp } from '@/components/providers/app-context';
import { useSessionStore } from '@/lib/session-store';
import { useOpenModal } from '@/features/terminal/context';
import { useWorkspaceStore } from '@/features/terminal/store';
import { initialsOf, profileIdentity, verificationFor } from '../ssh-keys';
import { useAccountRef } from '../hooks';
import { AccountIcons } from './icons';
import { SshKeyLibrary } from './SshKeyLibrary';
import '../account.css';

/** Profile page (legacy `OpenNEXTAccountProfile.page`). */
export function ProfilePage() {
  const user = useSessionStore((s) => s.user);
  const account = useAccountRef();
  const role = useWorkspaceStore((s) => s.role);
  const review = useWorkspaceStore((s) => s.review);
  const openModal = useOpenModal();
  const { href } = useApp();
  const identity = profileIdentity(user as Record<string, unknown> | null, account);
  const check = verificationFor(role, review?.status);
  const initials = initialsOf(identity.name);
  const rows: [string, string][] = [['Name', identity.name], ['Email', identity.email], ['Sign-in', identity.provider]];
  return (
    <div className="page-content onx-account-profile" data-account-profile>
      <header className="onx-account-profile-header">
        <div className="onx-account-avatar" aria-hidden="true">{initials || <AccountIcons.user />}</div>
        <div className="onx-account-title">
          <h1>{identity.name || 'Your profile'}</h1>
          <p>{identity.email || 'Manage your account and access keys.'}</p>
        </div>
        <Link className="onx-account-icon onx-account-settings" href={href('/settings')} data-nav="settings" aria-label="Account settings"><AccountIcons.settings /></Link>
      </header>
      <section className="onx-account-identity" aria-label="Account information">
        <dl>
          {rows.map(([label, value]) => (
            <div key={label} className="onx-account-row"><dt>{label}</dt><dd>{value || '—'}</dd></div>
          ))}
        </dl>
        <div className="onx-account-verification">
          <button type="button" className={`onx-account-verify ${check.kind}`} data-act="account-verification" onClick={() => openModal(role === 'Seller' ? 'review' : 'account-verification')}>
            <AccountIcons.shield />
            <span>{check.label}</span>
            {check.status ? <span className="onx-account-review-status">{check.status}</span> : null}
          </button>
        </div>
      </section>
      <SshKeyLibrary />
    </div>
  );
}
