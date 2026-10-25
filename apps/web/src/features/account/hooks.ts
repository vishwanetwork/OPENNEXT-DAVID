'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useApp } from '@/components/providers/app-context';
import { useSessionStore } from '@/lib/session-store';
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

function depsFor(demo: boolean): KeyLibraryDeps {
  return {
    account: () => accountRef(useSessionStore.getState().user, demo),
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
  const library = useKeyLibraries((s) => s.libraries[account.key]) || libraryFor(account.key);
  const load = useCallback((force = false) => loadKeys(depsFor(demo), { force }), [demo]);
  const change = useCallback((input: ChangeKeyInput) => changeKey(depsFor(demo), input), [demo]);
  return { account, library, load, change };
}

/** Loads the key library once the section is on screen (legacy `bind()` → `loadKeys`). */
export function useLoadKeysOnMount() {
  const { account, load } = useKeyLibrary();
  useEffect(() => {
    void load();
  }, [account.key, load]);
}
