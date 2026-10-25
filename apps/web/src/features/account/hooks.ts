'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useApp } from '@/components/providers/app-context';
import { useSessionStore } from '@/lib/session-store';
import { useTerminalSlots, type AccountService } from '@/terminal-kit';
import { accountRef, type AccountRef } from './ssh-keys';
import {
  changeKey,
  loadKeys,
  libraryFor,
  useKeyLibraries,
  type ChangeKeyInput,
  type KeyLibraryDeps,
  type KeyLibraryState,
} from './store';

/** Current account as the key library sees it (identity comes from the verified session). */
export function useAccountRef(): AccountRef {
  const user = useSessionStore((s) => s.user);
  const { demo } = useApp();
  return useMemo(() => accountRef(user, demo), [user, demo]);
}

/** Backend adapter for the SSH key library, supplied by the composition root (undefined until connected). */
export function useAccountService(): {
  service: AccountService | undefined;
  connected: (method: keyof AccountService) => boolean;
} {
  const { account } = useTerminalSlots().services;
  return {
    service: account,
    connected: (method) => typeof account?.[method] === 'function',
  };
}

function depsFor(demo: boolean, service: AccountService | undefined): KeyLibraryDeps {
  return {
    account: () => accountRef(useSessionStore.getState().user, demo),
    service: () => service,
    storage: () => window.localStorage,
    uuid: () => crypto.randomUUID(),
    now: () => Date.now(),
  };
}

export function useKeyLibrary(): {
  account: AccountRef;
  library: KeyLibraryState;
  load: (force?: boolean) => Promise<void>;
  change: (input: ChangeKeyInput) => ReturnType<typeof changeKey>;
} {
  const account = useAccountRef();
  const { demo } = useApp();
  const { service } = useAccountService();
  const library = useKeyLibraries((s) => s.libraries[account.key]) || libraryFor(account.key);
  const load = useCallback(
    (force = false) => loadKeys(depsFor(demo, service), { force }),
    [demo, service],
  );
  const change = useCallback(
    (input: ChangeKeyInput) => changeKey(depsFor(demo, service), input),
    [demo, service],
  );
  return { account, library, load, change };
}

/** Loads the key library once the section is on screen (legacy `bind()` → `loadKeys`). */
export function useLoadKeysOnMount() {
  const { account, load } = useKeyLibrary();
  useEffect(() => {
    void load();
  }, [account.key, load]);
}
