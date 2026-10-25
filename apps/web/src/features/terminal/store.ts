/**
 * Terminal workspace state — the React port of the legacy `S` object in OpenNEXT-terminal.js.
 *
 * Server-owned records (RFQs, instances, orders, balances…) are mirrored here by the
 * workspace refresh; identity comes from `useSessionStore`. Only display preferences are
 * persisted (`opennext-terminal-v4`), exactly like the legacy module.
 */
import { create } from 'zustand';
import type { SessionUser } from '@opennext/contracts';
import {
  ALL_REGIONS,
  normalizeMetrics,
  type Offer,
  type PriceMetric,
} from '@/features/market/catalog';
import type { WorkspaceRole } from './routing';

export const PREFERENCE_KEY = 'opennext-terminal-v4';

export type Record_ = Record<string, unknown>;

export interface ModalState {
  type: string;
  [key: string]: unknown;
}

export interface AgentMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ListingIntent {
  id: string;
  intent: 'buy' | 'offer';
}

export interface Identity {
  name: string;
  email: string;
  id?: string;
  company?: string;
  ssh?: string;
  preferences?: { quotes?: boolean; delivery?: boolean; market?: boolean; zone?: string };
}

export interface WorkspaceData {
  role: WorkspaceRole;
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
  rfqs: Record_[];
  instances: Record_[];
  listings: Record_[];
  orders: Record_[];
  notifications: Record_[];
  marketplaceNotifications: Record_[];
  billingNotifications: Record_[];
  topupRequests: Record_[];
  responses: Record_[];
  ledger: Record_[];
  payouts: Record_[];
  paymentSessions: Record_[];
  keys: Record_[];
  review: { step: number; status: string };
  balance: number;
  paidCredit: number;
  promotionalCredit: number;
  earningsBalance: number;
  billingAccountId: string | null;
  billingAccountConfirmed: boolean;
  paymentDraft: Record_ | null;
  activeRequirement: Record_ | null;
  afterReview: unknown;
  marketplaceAuthoritative: boolean;
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
  /** Free-form fields other features attach (legacy modules extended `S` ad hoc). */
  extra: Record_;
}

export interface WorkspaceActions {
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
  openModal: (type: string, extra?: Record_) => void;
  closeModal: () => void;
  setAgentOpen: (open: boolean) => void;
  pushAgentMessages: (messages: AgentMessage[]) => void;
  toggleSaved: (offer: Offer) => boolean;
  addToCart: (offer: Offer) => boolean;
  removeFrom: (type: 'cart' | 'saved', id: string) => void;
  setSelected: (ids: string[]) => void;
  indexOffers: (offers: Offer[]) => void;
  bumpMatchOffset: () => void;
  patch: (partial: Partial<WorkspaceData>) => void;
  setExtra: (key: string, value: unknown) => void;
  hydratePreferences: () => void;
}

export type WorkspaceStore = WorkspaceData & WorkspaceActions;

const SESSION_COLLECTIONS: (keyof WorkspaceData)[] = [
  'cart',
  'saved',
  'rfqs',
  'instances',
  'listings',
  'orders',
  'notifications',
  'marketplaceNotifications',
  'billingNotifications',
  'topupRequests',
  'responses',
  'ledger',
  'payouts',
  'paymentSessions',
  'keys',
  'agentMessages',
  'selected',
];

export const initialWorkspace = (): WorkspaceData => ({
  role: 'Buyer',
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
  rfqs: [],
  instances: [],
  listings: [],
  orders: [],
  notifications: [],
  marketplaceNotifications: [],
  billingNotifications: [],
  topupRequests: [],
  responses: [],
  ledger: [],
  payouts: [],
  paymentSessions: [],
  keys: [],
  review: { step: 0, status: 'Not started' },
  balance: 0,
  paidCredit: 0,
  promotionalCredit: 0,
  earningsBalance: 0,
  billingAccountId: null,
  billingAccountConfirmed: false,
  paymentDraft: null,
  activeRequirement: null,
  afterReview: null,
  marketplaceAuthoritative: false,
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
  extra: {},
});

const sessionKey = (user: SessionUser | null | undefined) =>
  JSON.stringify([user?.id || null, String(user?.role || '').toLowerCase(), !!user?.demo]);
let currentSessionKey = sessionKey(null);

/** Reads the persisted display preferences (client only). */
export function readPreferences(
  storage: Pick<Storage, 'getItem'> | null,
): Partial<Pick<WorkspaceData, 'model' | 'region' | 'priceMetric' | 'priceMetrics'>> {
  let stored: Record_ = {};
  try {
    stored = JSON.parse(storage?.getItem(PREFERENCE_KEY) || '{}') as Record_;
  } catch {
    stored = {};
  }
  const out: Record_ = Object.fromEntries(
    ['model', 'region', 'priceMetric', 'priceMetrics']
      .filter((k) => k in stored)
      .map((k) => [k, stored[k]]),
  );
  const priceMetrics = normalizeMetrics(out.priceMetrics, out.priceMetric);
  return {
    ...(typeof out.model === 'string' ? { model: out.model } : {}),
    ...(typeof out.region === 'string' ? { region: out.region } : {}),
    priceMetrics,
    priceMetric: priceMetrics.includes('avg') ? 'avg' : priceMetrics[0],
  };
}

function persistPreferences(state: WorkspaceData) {
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

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  ...initialWorkspace(),
  applySession: (user) => {
    const next = sessionKey(user);
    const reset: Partial<WorkspaceData> = {};
    if (next !== currentSessionKey) {
      currentSessionKey = next;
      for (const field of SESSION_COLLECTIONS) (reset as Record_)[field] = [];
      Object.assign(reset, {
        review: { step: 0, status: 'Not started' },
        balance: 0,
        paidCredit: 0,
        promotionalCredit: 0,
        billingAccountId: null,
        billingAccountConfirmed: false,
        earningsBalance: 0,
        paymentDraft: null,
        offerIndex: {},
        activeRequirement: null,
        afterReview: null,
        agentOpen: false,
        modal: null,
        userOpen: false,
        marketplaceAuthoritative: false,
      });
    }
    if (!user) {
      set({ ...reset, identity: { name: '', email: '' } });
      return;
    }
    const promotionalCredit = Math.max(0, Number(user.promotionalCredit) || 0);
    const paidCredit = Math.max(0, Number(user.fundedCredit) || 0);
    const confirmed = get().billingAccountConfirmed && !('billingAccountConfirmed' in reset);
    set({
      ...reset,
      identity: {
        name: user.name || '',
        email: user.email || '',
        id: user.id,
        company: user.company || '',
      },
      role: String(user.role).toLowerCase() === 'seller' ? 'Seller' : 'Buyer',
      ...(confirmed
        ? {}
        : { promotionalCredit, paidCredit, balance: paidCredit + promotionalCredit }),
    });
  },
  setFilter: (type, value) => {
    const patch: Partial<WorkspaceData> = { menu: null, hiddenSeries: [] };
    if (type === 'count') patch.count = Number(value);
    else if (type === 'priceMetric') {
      patch.priceMetrics = normalizeMetrics([value]);
      patch.priceMetric = patch.priceMetrics[0];
    } else (patch as Record_)[type] = value;
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
  openModal: (type, extra = {}) => set({ modal: { type, ...extra }, menu: null, userOpen: false }),
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
  setExtra: (key, value) => set({ extra: { ...get().extra, [key]: value } }),
  hydratePreferences: () => {
    if (typeof window === 'undefined') return;
    set(readPreferences(window.localStorage));
  },
}));

/** Find an offer by id across the index, cart, saved and a list of current offers. */
export function findOffer(
  state: Pick<WorkspaceData, 'offerIndex' | 'cart' | 'saved'>,
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
