'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Display preferences only (filters, metric choice, time zone). Customer records, identity and
 * balances are never stored in the browser. Reads are deferred to the client to keep SSR stable.
 */
export function usePersistedPreference<T>(key: string, initial: T, validate?: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (!validate || validate(parsed)) setValue(parsed as T);
      }
    } catch {
      /* ignore unreadable storage */
    }
    setHydrated(true);
  }, [key, validate]);
  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const resolved = typeof next === 'function' ? (next as (current: T) => T)(current) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          /* storage may be unavailable */
        }
        return resolved;
      });
    },
    [key],
  );
  return [value, update, hydrated] as const;
}
