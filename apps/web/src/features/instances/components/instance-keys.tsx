'use client';

import { AsyncButton } from '@/components/ui/async-feedback';
import { useState, type ReactNode } from 'react';
import { useToast } from '@/components/ui/toast';
import { useKeyLibrary, validatePublicKey } from '@/features/account';
import { useInstanceKeys, useSetInstanceKeys } from '../hooks';
import { AsyncFeedback } from '@/components/ui/async-feedback';

/** Two keys are the same when their type and material match; comments may differ. */
const material = (key: string) => key.trim().split(/\s+/).slice(0, 2).join(' ');

/**
 * Keys installed on one Spot instance. The backend replaces the whole set and the server
 * picks it up within about 15 seconds. Instances without key management show `fallback`.
 */
export function InstanceKeys({
  id,
  ended,
  fallback,
}: {
  id: string;
  ended: boolean;
  fallback: ReactNode;
}) {
  const query = useInstanceKeys(id, true);
  const setKeys = useSetInstanceKeys(id);
  const { library } = useKeyLibrary();
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (query.isPending) return <AsyncFeedback>Loading the keys on this instance…</AsyncFeedback>;
  if (query.error || !query.data) return <>{fallback}</>;
  const keys = query.data.keys;
  const installed = new Set(keys.map((k) => material(k.publicKey)));
  const saved = library.keys.filter((k) => !installed.has(material(k.publicKey)));

  const change = async (next: string[], done: string) => {
    setBusy(true);
    setError('');
    try {
      await setKeys(next);
      toast(done);
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const add = async (value: string) => {
    let key: string;
    try {
      key = validatePublicKey(value).publicKey;
    } catch (failure) {
      return setError((failure as Error).message);
    }
    if (installed.has(material(key))) return setError('This key is already on the instance.');
    const added = await change(
      [...keys.map((k) => k.publicKey), key],
      'Key added. The server installs it within about 15 seconds.',
    );
    if (added) setText('');
  };

  return (
    <div className="instance-keys" data-instance-keys>
      {busy ? <AsyncFeedback>Updating SSH keys…</AsyncFeedback> : null}
      <p className="form-note instance-access-installation" role="status">
        {ended
          ? 'This instance has ended. Its keys can no longer change.'
          : !keys.length
            ? 'No keys are on this instance yet. Add a public key to connect over SSH.'
            : query.data.installed
              ? 'These keys are installed on the server.'
              : 'Installing the latest keys on the server. This usually takes about 15 seconds.'}
      </p>
      {keys.length ? (
        <ul className="instance-keys-list">
          {keys.map((k) => (
            <li key={k.fingerprint}>
              <div>
                <strong>{k.comment || 'SSH key'}</strong>
                <small>{k.fingerprint}</small>
              </div>
              <AsyncButton
                busy={busy}
                type="button"
                className="btn secondary small"
                disabled={busy || ended}
                onClick={() =>
                  void change(
                    keys.filter((x) => x !== k).map((x) => x.publicKey),
                    'Key removed from the instance.',
                  )
                }
              >
                Remove
              </AsyncButton>
            </li>
          ))}
        </ul>
      ) : null}
      {!ended ? (
        <>
          {saved.length ? (
            <ul className="instance-keys-list">
              {saved.map((k) => (
                <li key={k.id}>
                  <div>
                    <strong>{k.label}</strong>
                    <small>{k.fingerprint}</small>
                  </div>
                  <AsyncButton
                    busy={busy}
                    type="button"
                    className="btn secondary small"
                    disabled={busy}
                    onClick={() => void add(k.publicKey)}
                  >
                    Add to instance
                  </AsyncButton>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="form-label">
            Public key
            <textarea
              className="field"
              rows={3}
              maxLength={16384}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Paste your SSH public key"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <AsyncButton
            busy={busy}
            type="button"
            className="btn small"
            disabled={busy || !text.trim()}
            onClick={() => void add(text)}
          >
            Add to instance
          </AsyncButton>
        </>
      ) : null}
      {error ? (
        <p className="onx-spot-purchase-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
