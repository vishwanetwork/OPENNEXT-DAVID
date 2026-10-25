import { create } from 'zustand';
import type { AccountService } from '@/terminal-kit';
import {
  fingerprint,
  keyLabel,
  MAX_KEYS,
  normalizeKey,
  readDemoKeys,
  saveDemoKeys,
  UNCONFIGURED,
  validatePublicKey,
  type AccountRef,
  type KeyRuntime,
  type SshKeyRecord,
} from './ssh-keys';

export interface KeyLibraryState {
  keys: SshKeyRecord[];
  loaded: boolean;
  loading: boolean;
  loadedAt: number;
  error: string;
  pending: Promise<void> | null;
}

interface KeyLibraryStore {
  libraries: Record<string, KeyLibraryState>;
  set: (key: string, patch: Partial<KeyLibraryState>) => void;
}

const empty = (): KeyLibraryState => ({
  keys: [],
  loaded: false,
  loading: false,
  loadedAt: 0,
  error: '',
  pending: null,
});

/** Per-account SSH key libraries, keyed by `demo:<id>` / `account:<id>` (legacy `states` map). */
export const useKeyLibraries = create<KeyLibraryStore>((set, get) => ({
  libraries: {},
  set: (key, patch) =>
    set({
      libraries: { ...get().libraries, [key]: { ...(get().libraries[key] || empty()), ...patch } },
    }),
}));

export const libraryFor = (key: string): KeyLibraryState =>
  useKeyLibraries.getState().libraries[key] || empty();

export interface KeyLibraryDeps {
  service: () => AccountService | undefined;
  /** Current account; `null` means signed out. Re-read after every await (legacy `current()`). */
  account: () => AccountRef;
  storage: () => Pick<Storage, 'getItem' | 'setItem'>;
  runtime?: KeyRuntime;
  uuid: () => string;
  now: () => number;
}

const operations = new Set<string>();

export async function loadKeys(deps: KeyLibraryDeps, { force = false } = {}): Promise<void> {
  const account = deps.account();
  const state = libraryFor(account.key);
  const set = (patch: Partial<KeyLibraryState>) =>
    useKeyLibraries.getState().set(account.key, patch);
  if (!account.available) {
    set({ error: 'Sign in to manage your SSH keys.', loaded: true });
    return;
  }
  if (state.pending) return state.pending;
  if (!force && state.loaded && deps.now() - state.loadedAt < 60000) return;
  set({ loading: true, error: '' });
  const job = (async () => {
    try {
      let keys: SshKeyRecord[];
      if (account.demo) keys = await readDemoKeys(account, deps.storage(), deps.runtime);
      else {
        const service = deps.service();
        if (typeof service?.listSshKeys !== 'function') throw new Error(UNCONFIGURED);
        const result = await service.listSshKeys();
        if (!Array.isArray(result?.keys) || result.keys.length > MAX_KEYS)
          throw new Error('The account service returned an invalid key list.');
        keys = await Promise.all(result.keys.map((row: unknown) => normalizeKey(row, deps.runtime)));
      }
      if (deps.account().key === account.key) set({ keys });
    } catch (error) {
      if (deps.account().key === account.key)
        set({
          error:
            (error as Error).message === UNCONFIGURED
              ? UNCONFIGURED
              : account.demo
                ? 'Demo SSH keys could not be loaded. Please check browser storage access.'
                : 'SSH keys could not be loaded. Refresh your session and try again.',
        });
    } finally {
      set({ loading: false, loaded: true, loadedAt: deps.now(), pending: null });
    }
  })();
  set({ pending: job });
  return job;
}

export interface ChangeKeyInput {
  removing: boolean;
  id?: string;
  label?: unknown;
  publicKey?: unknown;
}

export interface ChangeKeyResult {
  ok: boolean;
  message: string;
}

/** Add or remove a key; returns the toast/error message. Never fabricates confirmation. */
export async function changeKey(
  deps: KeyLibraryDeps,
  input: ChangeKeyInput,
): Promise<ChangeKeyResult | null> {
  const account = deps.account();
  const current = () => deps.account().key === account.key && deps.account().available;
  if (operations.has(account.key)) return null;
  operations.add(account.key);
  const service = deps.service();
  const connected = (method: 'listSshKeys' | 'addSshKey' | 'removeSshKey') =>
    typeof service?.[method] === 'function';
  try {
    if (!account.available) throw new Error('Sign in to manage your SSH keys.');
    if (
      !account.demo &&
      (!connected('listSshKeys') || !connected(input.removing ? 'removeSshKey' : 'addSshKey'))
    )
      throw new Error(UNCONFIGURED);
    await loadKeys(deps, { force: true });
    if (!current()) return null;
    const state = libraryFor(account.key);
    if (state.error) throw new Error(state.error);
    const set = (patch: Partial<KeyLibraryState>) =>
      useKeyLibraries.getState().set(account.key, patch);
    if (input.removing) {
      const id = String(input.id || '');
      const key = state.keys.find((item) => item.id === id);
      if (!key) throw new Error('This key is no longer available.');
      if (account.demo)
        saveDemoKeys(
          account,
          state.keys.filter((item) => item.id !== id),
          deps.storage(),
        );
      else {
        const result = await service!.removeSshKey!({ id });
        if (result?.confirmed !== true || result.id !== id)
          throw new Error('Removal was not confirmed by the account service.');
      }
      if (!current()) return null;
      set({
        keys: libraryFor(account.key).keys.filter((item) => item.id !== id),
        loaded: true,
        loadedAt: deps.now(),
      });
    } else {
      const label = keyLabel(input.label);
      const parsed = validatePublicKey(input.publicKey, deps.runtime);
      if (state.keys.length >= MAX_KEYS)
        throw new Error('You can save up to 50 SSH keys. Remove an unused key first.');
      if (state.keys.some((key) => key.material === parsed.material))
        throw new Error('This public key has already been added.');
      let key: SshKeyRecord;
      if (account.demo) {
        key = {
          id: deps.uuid(),
          label,
          publicKey: parsed.publicKey,
          material: parsed.material,
          algorithm: parsed.algorithm,
          fingerprint: await fingerprint(parsed, deps.runtime),
          createdAt: new Date(deps.now()).toISOString(),
        };
        saveDemoKeys(account, [...state.keys, key], deps.storage());
      } else {
        const result = await service!.addSshKey!({ label, publicKey: parsed.publicKey });
        if (result?.confirmed !== true)
          throw new Error('The account service has not confirmed this key was saved.');
        key = await normalizeKey(result.key, deps.runtime);
        if (key.material !== parsed.material || key.label !== label)
          throw new Error(
            'The saved key did not match your submission. Refresh your profile to check its status.',
          );
      }
      if (!current()) return null;
      set({ keys: [...libraryFor(account.key).keys, key], loaded: true, loadedAt: deps.now() });
    }
    return {
      ok: true,
      message: account.demo
        ? input.removing
          ? 'Public key removed from this Demo browser workspace.'
          : 'Public key saved only to this Demo browser workspace.'
        : input.removing
          ? 'Public key removed. Existing instance access is unchanged.'
          : 'Public key saved to your account.',
    };
  } catch (error) {
    if (!current()) return null;
    return { ok: false, message: (error as Error).message || 'The key could not be updated.' };
  } finally {
    operations.delete(account.key);
  }
}
