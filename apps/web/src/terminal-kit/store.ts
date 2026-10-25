/**
 * Terminal UI state — filters, selections, saved/cart offers, menus, the active modal and
 * pending public-site intents. Server-owned records (RFQs, orders, instances, balances…)
 * live in TanStack Query (see ./data.ts); identity comes from `useSessionStore`.
 * Only display preferences are persisted (`opennext-terminal-v4`).
 */
import { create } from 'zustand';
import type { SessionUser } from '@opennext/contracts';
import { ALL_REGIONS, normalizeMetrics, type Offer, type PriceMetric } from '@/features/market';
import type { ModalArgs, ModalState, ModalType } from './modal';
import {
  asRole,
  type AfterReview,
  type AgentMessage,
  type Identity,
  type ListingIntent,
  type RequirementDraft,
  type Role,
} from './types';

export const PREFERENCE_KEY = 'opennext-terminal-v4';

export interface WorkspaceUiState {
  role: Role;
  identity: Identity;
  model: string;
  region: string;
  term: string;
  count: number;
  period: string;
  priceMetric: PriceMetric;
  priceMetrics: PriceMetric[];
  hiddenSeries: number[];
  matchOffset: number;
  cart: Offer[];
  saved: Offer[];
  selected: string[];
  offerIndex: Record<string, Offer>;
  menu: string | null;
  userOpen: boolean;
  modal: ModalState | null;
  agentOpen: boolean;
  agentMessages: AgentMessage[];
  query: string;
  tab: string;
  marketRoute: 'market' | 'models';
  pendingListing: ListingIntent | null;
  pendingOpportunity: ListingIntent | null;
  /** Route requested before sign-in / onboarding completed. */
  pending: string | null;
  /** What to open once the supplier review is approved. */
  afterReview: AfterReview;
  /** Buyer requirement a seller is responding to. */
  activeRequirement: RequirementDraft | null;
}

export interface WorkspaceUiActions {
  applySession: (user: SessionUser | null) => void;
  setFilter: (
    type: 'model' | 'region' | 'term' | 'count' | 'priceMetric',
    value: string | number,
  ) => void;
  setPriceMetrics: (metrics: unknown) => void;
  setPeriod: (period: string) => void;
  toggleSeries: (index: number, seriesCount: number) => void;
  setMenu: (menu: string | null) => void;
  setUserOpen: (open: boolean) => void;
  openModal: <K extends ModalType>(type: K, ...args: ModalArgs<K>) => void;
  closeModal: () => void;
  setAgentOpen: (open: boolean) => void;
  pushAgentMessages: (messages: AgentMessage[]) => void;
  toggleSaved: (offer: Offer) => boolean;
  addToCart: (offer: Offer) => boolean;
  removeFrom: (type: 'cart' | 'saved', id: string) => void;
  setSelected: (ids: string[]) => void;
  indexOffers: (offers: Offer[]) => void;
  bumpMatchOffset: () => void;
  patch: (partial: Partial<WorkspaceUiState>) => void;
  hydratePreferences: () => void;
}

export type WorkspaceStore = WorkspaceUiState & WorkspaceUiActions;

export const initialWorkspace = (): WorkspaceUiState => ({
  role: 'buyer',
  identity: { name: '', email: '' },
  model: 'H100',
  region: ALL_REGIONS,
  term: 'Spot',
  count: 8,
  period: '3D',
  priceMetric: 'avg',
  priceMetrics: ['avg'],
  hiddenSeries: [],
  matchOffset: 0,
  cart: [],
  saved: [],
  selected: [],
  offerIndex: {},
  menu: null,
  userOpen: false,
  modal: null,
  agentOpen: false,
  agentMessages: [],
  query: '',
  tab: 'all',
  marketRoute: 'market',
  pendingListing: null,
  pendingOpportunity: null,
  pending: null,
  afterReview: null,
  activeRequirement: null,
});

/** Per-session state that must not leak between accounts, roles or demo scopes. */
const sessionReset = (): Partial<WorkspaceUiState> => ({
  cart: [],
  saved: [],
  selected: [],
  agentMessages: [],
  offerIndex: {},
  afterReview: null,
  activeRequirement: null,
  agentOpen: false,
  modal: null,
  userOpen: false,
});

export const sessionKey = (user: SessionUser | null | undefined) =>
  JSON.stringify([user?.id || null, asRole(user?.role), !!user?.demo]);

type StoredPreferences = Partial<
  Pick<WorkspaceUiState, 'model' | 'region' | 'priceMetric' | 'priceMetrics'>
>;

/** Reads the persisted display preferences (client only). */
export function readPreferences(storage: Pick<Storage, 'getItem'> | null): StoredPreferences {
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(storage?.getItem(PREFERENCE_KEY) || '{}') as Record<string, unknown>;
  } catch {
    stored = {};
  }
  const priceMetrics = normalizeMetrics(stored.priceMetrics, stored.priceMetric);
  return {
    ...(typeof stored.model === 'string' ? { model: stored.model } : {}),
    ...(typeof stored.region === 'string' ? { region: stored.region } : {}),
    priceMetrics,
    priceMetric: priceMetrics.includes('avg') ? 'avg' : priceMetrics[0],
  };
}

function persistPreferences(state: WorkspaceUiState) {
  try {
    window.localStorage.setItem(
      PREFERENCE_KEY,
      JSON.stringify({
        model: state.model,
        region: state.region,
        priceMetric: state.priceMetric,
        priceMetrics: state.priceMetrics,
      }),
    );
  } catch {
    /* storage unavailable */
  }
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => {
  let currentSessionKey = sessionKey(null);
  return {
    ...initialWorkspace(),
    applySession: (user) => {
      const next = sessionKey(user);
      const reset = next !== currentSessionKey ? sessionReset() : {};
      currentSessionKey = next;
      if (!user) {
        set({ ...reset, identity: { name: '', email: '' } });
        return;
      }
      set({
        ...reset,
        identity: {
          name: user.name || '',
          email: user.email || '',
          id: user.id,
          company: user.company || '',
          preferences: get().identity.id === user.id ? get().identity.preferences : undefined,
        },
        role: asRole(user.role),
      });
    },
    setFilter: (type, value) => {
      const patch: Partial<WorkspaceUiState> = { menu: null, hiddenSeries: [] };
      if (type === 'count') patch.count = Number(value);
      else if (type === 'priceMetric') {
        patch.priceMetrics = normalizeMetrics([value]);
        patch.priceMetric = patch.priceMetrics[0];
      } else patch[type] = String(value);
      set(patch);
      persistPreferences(get());
    },
    setPriceMetrics: (metrics) => {
      const priceMetrics = normalizeMetrics(metrics);
      set({
        priceMetrics,
        priceMetric: priceMetrics.includes('avg') ? 'avg' : priceMetrics[0],
        hiddenSeries: [],
      });
      persistPreferences(get());
    },
    setPeriod: (period) => set({ period, hiddenSeries: [] }),
    toggleSeries: (index, seriesCount) => {
      const hidden = get().hiddenSeries;
      if (hidden.includes(index)) set({ hiddenSeries: hidden.filter((x) => x !== index) });
      else if (hidden.length < Math.max(0, seriesCount - 1))
        set({ hiddenSeries: [...hidden, index] });
    },
    setMenu: (menu) => set({ menu, userOpen: menu ? false : get().userOpen }),
    setUserOpen: (userOpen) => set({ userOpen, menu: null }),
    openModal: (type, ...args) =>
      set({
        modal: { type, ...(args[0] ?? {}) } as ModalState,
        menu: null,
        userOpen: false,
      }),
    closeModal: () => set({ modal: null }),
    setAgentOpen: (agentOpen) => set({ agentOpen }),
    pushAgentMessages: (messages) => set({ agentMessages: [...get().agentMessages, ...messages] }),
    toggleSaved: (offer) => {
      const saved = get().saved;
      const exists = saved.some((x) => x.id === offer.id);
      set({ saved: exists ? saved.filter((x) => x.id !== offer.id) : [...saved, offer] });
      return !exists;
    },
    addToCart: (offer) => {
      const cart = get().cart;
      if (cart.some((x) => x.id === offer.id)) return false;
      set({ cart: [...cart, offer] });
      return true;
    },
    removeFrom: (type, id) =>
      set({
        [type]: get()[type].filter((x) => x.id !== id),
        selected: get().selected.filter((x) => x !== id),
      }),
    setSelected: (selected) => set({ selected }),
    indexOffers: (offers) => {
      const offerIndex = { ...get().offerIndex };
      for (const o of offers) offerIndex[o.id] = o;
      set({ offerIndex });
    },
    bumpMatchOffset: () => set({ matchOffset: get().matchOffset + 3 }),
    patch: (partial) => set(partial),
    hydratePreferences: () => {
      if (typeof window === 'undefined') return;
      set(readPreferences(window.localStorage));
    },
  };
});

/** Find an offer by id across the index, cart, saved and a list of current offers. */
export function findOffer(
  state: Pick<WorkspaceUiState, 'offerIndex' | 'cart' | 'saved'>,
  id: string | undefined,
  current: Offer[] = [],
): Offer | undefined {
  if (!id) return undefined;
  return (
    state.offerIndex[id] ||
    state.cart.find((o) => o.id === id) ||
    state.saved.find((o) => o.id === id) ||
    current.find((o) => o.id === id)
  );
}
