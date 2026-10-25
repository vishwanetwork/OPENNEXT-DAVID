import { create } from 'zustand';
import { readPreferences, writePreferences } from './notifications';

interface QuoteState {
  owner: string;
  muted: boolean;
  readIds: string[];
  panel: boolean;
  page: number;
  ready: boolean;
  error: string;
  lastLoaded: number;
  pending: Promise<void> | null;
  /** Re-scopes the device-local preferences when the verified account changes. */
  sync: (owner: string) => void;
  setPanel: (open: boolean) => void;
  setPage: (page: number) => void;
  toggleMuted: () => void;
  markRead: (ids: string[]) => void;
  patch: (partial: Partial<Pick<QuoteState, 'ready' | 'error' | 'lastLoaded' | 'pending'>>) => void;
}

const storage = () => (typeof window === 'undefined' ? null : window.localStorage);

/** Notification bell / history state. Read and mute preferences are device-local per account. */
export const useQuoteStore = create<QuoteState>((set, get) => ({
  owner: '',
  muted: false,
  readIds: [],
  panel: false,
  page: 0,
  ready: false,
  error: '',
  lastLoaded: 0,
  pending: null,
  sync: (owner) => {
    if (owner === get().owner) return;
    const prefs = readPreferences(storage(), owner);
    set({
      owner,
      muted: prefs.muted,
      readIds: prefs.readIds,
      panel: false,
      page: 0,
      ready: false,
      error: '',
      lastLoaded: 0,
      pending: null,
    });
  },
  setPanel: (panel) => set({ panel }),
  setPage: (page) => set({ page: Math.max(0, page) }),
  toggleMuted: () => {
    const muted = !get().muted;
    set({ muted });
    writePreferences(storage(), get().owner, { muted, readIds: get().readIds });
  },
  markRead: (ids) => {
    const readIds = [...new Set([...get().readIds, ...ids])].slice(-3000);
    set({ readIds });
    writePreferences(storage(), get().owner, { muted: get().muted, readIds });
  },
  patch: (partial) => set(partial),
}));
