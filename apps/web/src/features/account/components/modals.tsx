'use client';

import { useState, type FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';
import { useCloseModal } from '@/features/terminal/context';
import { openContact, registerTerminalModal, type ModalRender } from '@/features/terminal/components/TerminalModal';
import type { ModalState } from '@/features/terminal/store';
import { serviceConnected } from '../service';
import { UNCONFIGURED } from '../ssh-keys';
import { useKeyLibrary } from '../hooks';

function VerificationModal() {
  const closeModal = useCloseModal();
  return (
    <div className="onx-account-dialog">
      <p>Buyer identity verification is not connected yet. Contact OpenNEXT support if verification is required for your order.</p>
      <p className="form-note">No documents have been submitted and no approval has been granted.</p>
      <div className="modal-footer">
        <button type="button" className="btn secondary" data-act="close-modal" onClick={closeModal}>Close</button>
        <button type="button" className="btn" data-act="account-contact-support" onClick={() => { closeModal(); openContact({ message: 'I would like help with account verification.' }); }}>Contact support</button>
      </div>
    </div>
  );
}

function AddKeyModal() {
  const { account, change } = useKeyLibrary();
  const closeModal = useCloseModal();
  const toast = useToast();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const available = account.available && (account.demo || (serviceConnected('listSshKeys') && serviceConnected('addSshKey')));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    const result = await change({ removing: false, label: data.get('label'), publicKey: data.get('publicKey') });
    setBusy(false);
    if (!result) return;
    if (result.ok) {
      closeModal();
      toast(result.message);
    } else {
      setError(result.message);
      toast(result.message);
    }
  };
  return (
    <form data-form="account-ssh-add" className="onx-account-form" onSubmit={submit}>
      <label className="form-label">Label<input className="field" name="label" autoComplete="off" maxLength={80} required placeholder="Work laptop" /></label>
      <label className="form-label">Public key<textarea className="field" name="publicKey" rows={5} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={16384} required placeholder="Paste your single-line SSH public key" /></label>
      <p className="form-note">ED25519, RSA (2,048–8,192 bits) and ECDSA keys are supported. A saved key is not automatically added to any running instance.</p>
      {account.demo ? <p className="form-note">Stored only in this Demo workspace on this browser.</p> : !available ? <p className="onx-account-service-note">{UNCONFIGURED}</p> : null}
      <p className="onx-account-form-error" data-account-error role="alert">{error}</p>
      <div className="modal-footer">
        <button type="button" className="btn secondary" data-act="close-modal" onClick={closeModal}>Cancel</button>
        <button type="submit" className="btn" disabled={!available || busy}>Add key</button>
      </div>
    </form>
  );
}

function RemoveKeyModal({ id }: { id: string }) {
  const { account, library, change } = useKeyLibrary();
  const closeModal = useCloseModal();
  const toast = useToast();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = library.keys.find((item) => item.id === id);
  if (!key) return <p>This key is no longer available. Refresh your profile.</p>;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result = await change({ removing: true, id });
    setBusy(false);
    if (!result) return;
    if (result.ok) {
      closeModal();
      toast(result.message);
    } else {
      setError(result.message);
      toast(result.message);
    }
  };
  return (
    <form data-form="account-ssh-remove" data-id={key.id} className="onx-account-form" onSubmit={submit}>
      <p>Remove <strong>{key.label}</strong> from {account.demo ? 'this Demo workspace' : 'your account'}?</p>
      <code className="onx-account-remove-fingerprint">{key.fingerprint}</code>
      <p className="form-note">This does not revoke access to existing instances or remove the public key from their authorized keys.</p>
      <p className="onx-account-form-error" data-account-error role="alert">{error}</p>
      <div className="modal-footer">
        <button type="button" className="btn secondary" data-act="close-modal" onClick={closeModal}>Cancel</button>
        <button type="submit" className="btn danger" disabled={busy}>Remove key</button>
      </div>
    </form>
  );
}

export function accountModal(modal: ModalState): ModalRender | null {
  if (modal.type === 'account-verification') return { title: 'Identity verification', body: <VerificationModal /> };
  if (modal.type === 'account-ssh-add') return { title: 'Add SSH key', body: <AddKeyModal /> };
  if (modal.type === 'account-ssh-remove') {
    const id = String(modal.id || '');
    return { title: 'Remove SSH key?', body: <RemoveKeyModal id={id} /> };
  }
  return null;
}

let registered = false;
/** Registers the account dialogs with the terminal modal registry (idempotent). */
export function registerAccountModals() {
  if (registered) return;
  registered = true;
  registerTerminalModal(accountModal);
}
