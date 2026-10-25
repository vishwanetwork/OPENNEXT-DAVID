'use client';

import { create } from 'zustand';
import { initialDb } from './reference-data';
import { stamp } from './helpers';
import type { ConsoleDb, MarketFilters, ScheduleDraft } from './types';

/**
 * Browser-local operations workspace. These are preview records (README: "legacy dashboard
 * modules remain browser-local previews"), so they persist in localStorage under the legacy key
 * and are never sent to the server. Customer records live in the server-backed features.
 */
export const STORAGE_KEY = 'opennext.operations.v2';

const legacyPreviewIdentity = (person: { name?: string; email?: string } | undefined) =>
  !!person &&
  (/^richard(?:\s+chen)?$/i.test(String(person.name || '').trim()) ||
    /^richard@opennext\.ai$/i.test(String(person.email || '').trim()));

/** Migrates the old demo identity without resetting reviews, orders, schedules or preferences. */
export function migrateIdentity(db: ConsoleDb): boolean {
  let migrated = false;
  for (const person of [db.profile, ...(db.users || [])]) {
    if (
      legacyPreviewIdentity(person) ||
      person.email === 'nova@vishwalab.com' ||
      person.name === 'Nova'
    ) {
      person.name = 'Administrator';
      person.email = '';
      migrated = true;
    }
  }
  for (const entry of db.audit || []) {
    if (/^richard(?:\s+chen)?$/i.test(String(entry.actor || '').trim())) {
      entry.actor = 'Operations';
      migrated = true;
    }
  }
  return migrated;
}

export function loadDb(storage: Pick<Storage, 'getItem' | 'setItem'> | null): ConsoleDb {
  let db: ConsoleDb | null = null;
  try {
    db = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
  } catch {
    db = null;
  }
  if (!db || !db.offers || !db.config) db = initialDb();
  if (migrateIdentity(db)) {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
      /* ignore */
    }
  }
  return db;
}

export const defaultMarketFilters = (): MarketFilters => ({
  dataset: 'current',
  provider: 'All providers',
  model: 'All models',
  count: 'All counts',
  region: 'All regions',
  terms: 'All terms',
  availability: 'All availability',
  min: '',
  max: '',
  score: 'All scores',
});

interface ConsoleState {
  db: ConsoleDb;
  hydrated: boolean;
  storageError: string | null;
  /** UI state that survives page changes, mirroring the legacy `ui` object. */
  market: MarketFilters;
  pageNumber: number;
  scheduleTab: 'schedules' | 'runs';
  instanceTab: string;
  userTab: string;
  scheduleDraft: ScheduleDraft | null;
  lastRefresh: string;
  hydrate: () => void;
  /** Mutate the dataset in place (on a clone), then persist. */
  mutate: (fn: (db: ConsoleDb) => void) => void;
  /** Append an audit entry (capped at 250) and persist. */
  record: (action: string, target: string, detail?: string) => void;
  setUi: (
    patch: Partial<
      Pick<
        ConsoleState,
        | 'market'
        | 'pageNumber'
        | 'scheduleTab'
        | 'instanceTab'
        | 'userTab'
        | 'scheduleDraft'
        | 'lastRefresh'
      >
    >,
  ) => void;
}

export const useConsoleStore = create<ConsoleState>((set, get) => {
  const persist = (db: ConsoleDb) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
      return null;
    } catch {
      return 'Browser storage is full. Export your records before continuing.';
    }
  };
  return {
    db: initialDb(),
    hydrated: false,
    storageError: null,
    market: defaultMarketFilters(),
    pageNumber: 1,
    scheduleTab: 'schedules',
    instanceTab: 'All instances',
    userTab: 'All accounts',
    scheduleDraft: null,
    lastRefresh: '',
    hydrate: () => {
      if (get().hydrated) return;
      set({
        db: loadDb(typeof window === 'undefined' ? null : window.localStorage),
        hydrated: true,
        lastRefresh: stamp(),
      });
    },
    mutate: (fn) => {
      const db = structuredClone(get().db);
      fn(db);
      set({ db, storageError: persist(db) });
    },
    record: (action, target, detail = '') => {
      const db = structuredClone(get().db);
      db.audit.unshift({ time: stamp(), actor: db.profile.name, action, target, detail });
      db.audit = db.audit.slice(0, 250);
      set({ db, storageError: persist(db) });
    },
    setUi: (patch) => set(patch),
  };
});
