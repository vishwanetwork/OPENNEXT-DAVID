import { create } from 'zustand';

/**
 * Cross-page detail requests: the notification popover and the overview queue ask for a
 * user / order / instance drawer that is rendered by its own page. The request is kept here
 * until that page mounts and consumes it (no registries, no module-level slots).
 */
export type DetailRequest = { kind: 'user' | 'order' | 'instance'; id: string };

interface DetailRequestState {
  pending: DetailRequest | null;
  request: (next: DetailRequest) => void;
  consume: (kind: DetailRequest['kind']) => string | null;
}

export const useDetailRequestStore = create<DetailRequestState>((set, get) => ({
  pending: null,
  request: (pending) => set({ pending }),
  consume: (kind) => {
    const current = get().pending;
    if (current?.kind !== kind) return null;
    set({ pending: null });
    return current.id;
  },
}));

export const detailPage = (kind: DetailRequest['kind']) =>
  kind === 'user' ? 'users' : kind === 'order' ? 'orders' : 'instances';
