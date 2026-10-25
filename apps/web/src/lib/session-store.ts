import { create } from 'zustand';
import type { SessionUser } from '@opennext/contracts';

export type SessionStatus = 'booting' | 'anonymous' | 'verified' | 'expired';

interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
  setUser: (user: SessionUser | null) => void;
  markExpired: () => void;
}

/**
 * Verified session as reported by `GET /api/auth/session`. Identity is server-owned;
 * the browser only mirrors it. Nothing here is persisted.
 */
export const useSessionStore = create<SessionState>((set) => ({
  status: 'booting',
  user: null,
  setUser: (user) => set({ user, status: user ? 'verified' : 'anonymous' }),
  markExpired: () => set({ user: null, status: 'expired' }),
}));
