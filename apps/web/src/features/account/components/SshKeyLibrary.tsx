'use client';

import { useToast } from '@/components/ui/toast';
import { useOpenModal } from '@/features/terminal/context';
import { serviceConnected } from '../service';
import { useKeyLibrary, useLoadKeysOnMount } from '../hooks';
import { AccountIcons } from './icons';

export type SshLibraryScope = 'profile' | 'instances' | 'instance-access';

function addedOn(createdAt: string | null) {
  return createdAt
    ? ' · Added ' +
        new Date(createdAt).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        })
    : '';
}

/** Saved SSH public keys list (legacy `renderKeys`). */
export function SshKeyList() {
  const { account, library } = useKeyLibrary();
  const openModal = useOpenModal();
  const toast = useToast();
  const message = library.error ? (
    <p className="onx-account-service-note" role="status">
      {library.error}
    </p>
  ) : null;
  if (library.loading && !library.loaded)
    return (
      <div className="onx-account-empty" role="status">
        Loading SSH keys…
      </div>
    );
  if (!library.keys.length)
    return (
      <>
        {message}
        <div className="onx-account-empty">
          No saved keys yet. Add a public key to use when provisioning an instance.
        </div>
      </>
    );
  const copy = (id: string) => {
    const key = library.keys.find((item) => item.id === id);
    if (!key) return;
    if (!navigator?.clipboard?.writeText)
      return toast('Clipboard access is unavailable in this browser.');
    navigator.clipboard
      .writeText(key.publicKey)
      .then(() => toast('Public key copied.'))
      .catch(() => toast('Clipboard permission was denied.'));
  };
  return (
    <>
      {message}
      <div className="onx-account-key-list">
        {library.keys.map((key) => (
          <article key={key.id} className="onx-account-key" data-account-key={key.id}>
            <span className="onx-account-key-icon">
              <AccountIcons.key />
            </span>
            <div className="onx-account-key-info">
              <h3>{key.label}</h3>
              <code>{key.fingerprint}</code>
              <small>
                {key.algorithm}
                {addedOn(key.createdAt)}
              </small>
            </div>
            <div className="onx-account-key-actions">
              <button
                type="button"
                className="onx-account-icon"
                data-act="account-ssh-copy"
                data-id={key.id}
                aria-label={`Copy public key for ${key.label}`}
                title="Copy public key"
                onClick={() => copy(key.id)}
              >
                <AccountIcons.copy />
              </button>
              <button
                type="button"
                className="btn secondary small"
                data-act="account-ssh-remove"
                data-id={key.id}
                disabled={!account.demo && !serviceConnected('removeSshKey')}
                onClick={() => openModal('account-ssh-remove', { id: key.id })}
              >
                Remove
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

/** "SSH keys" section (legacy `sshSection`), reusable from the instances pages. */
export function SshKeyLibrary({ scope = 'profile' }: { scope?: SshLibraryScope }) {
  const openModal = useOpenModal();
  useLoadKeysOnMount();
  const area: SshLibraryScope = ['profile', 'instances', 'instance-access'].includes(scope)
    ? scope
    : 'profile';
  const titleId = 'account-ssh-title-' + area;
  return (
    <section
      className={`onx-account-ssh onx-account-ssh-${area}`}
      data-account-key-library
      aria-labelledby={titleId}
    >
      <header className="onx-account-section-header">
        <div>
          <h2 id={titleId}>SSH keys</h2>
          <p>Save public keys for secure access to your instances. Never share a private key.</p>
        </div>
        <button
          type="button"
          className="btn secondary small"
          data-act="account-ssh-add"
          onClick={() => openModal('account-ssh-add')}
        >
          + Add key
        </button>
      </header>
      <div data-account-ssh-list>
        <SshKeyList />
      </div>
      <p className="onx-account-footnote">
        Removing a key here does not revoke access to existing instances. Remove it from the
        instance separately.
      </p>
    </section>
  );
}
