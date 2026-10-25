'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * Display preferences only (filters, metric choice, time zone). Customer records, identity and
 * balances are never stored in the browser. The server snapshot is always `initial`, so SSR and
 * the first client render agree; the stored value applies once hydrated.
 */
const EVENT = 'opennext:preference';
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const onStorage = () => listener();
  window.addEventListener('storage', onStorage);
  window.addEventListener(EVENT, onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(EVENT, onStorage);
  };
};

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function usePersistedPreference<T>(
  key: string,
  initial: T,
  validate?: (value: unknown) => value is T,
) {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const value = useMemo<T>(() => {
    if (raw === null) return initial;
    try {
      const parsed: unknown = JSON.parse(raw);
      return !validate || validate(parsed) ? (parsed as T) : initial;
    } catch {
      return initial;
    }
  }, [raw, initial, validate]);
  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      const current = ((): T => {
        const stored = read(key);
        if (stored === null) return initial;
        try {
          const parsed: unknown = JSON.parse(stored);
          return !validate || validate(parsed) ? (parsed as T) : initial;
        } catch {
          return initial;
        }
      })();
      const resolved = typeof next === 'function' ? (next as (current: T) => T)(current) : next;
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        /* storage may be unavailable */
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key, initial, validate],
  );
  return [value, update, hydrated] as const;
}
