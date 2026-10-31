'use client';

import { useState, type FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';
import {
  ModalFrame,
  useCloseModal,
  type ModalComponent,
  type ModalComponents,
} from '@/terminal-kit';
import { useAccountService } from '../hooks';
import { UNCONFIGURED } from '../ssh-keys';
import { useKeyLibrary } from '../hooks';
import { BuyerKybContent } from '@/features/buyer-kyb';

function AddKeyModal() {
  const { connected: serviceConnected } = useAccountService();
  const { account, change } = useKeyLibrary();
  const closeModal = useCloseModal();
  const toast = useToast();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const available =
    account.available &&
    (account.demo || (serviceConnected('listSshKeys') && serviceConnected('addSshKey')));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    const result = await change({
      removing: false,
      label: data.get('label'),
      publicKey: data.get('publicKey'),
    });
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
      <label className="form-label">
        Label
        <input
          className="field"
          name="label"
          autoComplete="off"
          maxLength={80}
          required
          placeholder="Work laptop"
        />
      </label>
      <label className="form-label">
        Public key
        <textarea
          className="field"
          name="publicKey"
          rows={5}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={16384}
          required
          placeholder="Paste your single-line SSH public key"
        />
      </label>
      <p className="form-note">
        ED25519, RSA (2,048–8,192 bits) and ECDSA keys are supported. A saved key is not
        automatically added to any running instance.
      </p>
      {account.demo ? (
        <p className="form-note">Stored only in this browser workspace.</p>
      ) : !available ? (
        <p className="onx-account-service-note">{UNCONFIGURED}</p>
      ) : null}
      <p className="onx-account-form-error" data-account-error role="alert">
        {error}
      </p>
      <div className="modal-footer">
        <button type="button" className="btn secondary" data-act="close-modal" onClick={closeModal}>
          Cancel
        </button>
        <button type="submit" className="btn" disabled={!available || busy}>
          Add key
        </button>
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
    <form
      data-form="account-ssh-remove"
      data-id={key.id}
      className="onx-account-form"
      onSubmit={submit}
    >
      <p>
        Remove <strong>{key.label}</strong> from {account.demo ? 'this workspace' : 'your account'}?
      </p>
      <code className="onx-account-remove-fingerprint">{key.fingerprint}</code>
      <p className="form-note">
        This does not revoke access to existing instances or remove the public key from their
        authorized keys.
      </p>
      <p className="onx-account-form-error" data-account-error role="alert">
        {error}
      </p>
      <div className="modal-footer">
        <button type="button" className="btn secondary" data-act="close-modal" onClick={closeModal}>
          Cancel
        </button>
        <button type="submit" className="btn danger" disabled={busy}>
          Remove key
        </button>
      </div>
    </form>
  );
}

declare module '@/terminal-kit/modal' {
  interface TerminalModalMap {
    'account-verification': Record<string, never>;
    'account-ssh-add': Record<string, never>;
    'account-ssh-remove': { id: string };
  }
}

const VerificationDialog: ModalComponent<'account-verification'> = ({ close }) => (
  <ModalFrame title="Business verification" eyebrow="BUYER KYB" wide close={close}>
    <BuyerKybContent />
  </ModalFrame>
);
const AddKeyDialog: ModalComponent<'account-ssh-add'> = ({ close }) => (
  <ModalFrame title="Add SSH key" close={close}>
    <AddKeyModal />
  </ModalFrame>
);
const RemoveKeyDialog: ModalComponent<'account-ssh-remove'> = ({ modal, close }) => (
  <ModalFrame title="Remove SSH key?" close={close}>
    <RemoveKeyModal id={String(modal.id || '')} />
  </ModalFrame>
);

/** Account dialogs, keyed by type for the composition root. */
export const accountModals: ModalComponents = {
  'account-verification': VerificationDialog,
  'account-ssh-add': AddKeyDialog,
  'account-ssh-remove': RemoveKeyDialog,
};
