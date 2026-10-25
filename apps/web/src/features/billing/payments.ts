/** Manual credit top-ups (legacy OpenNEXT-payments.js): draft state, validation and polling rules. */
import type { CreditTopup, SessionUser } from '@opennext/contracts';
import { create } from 'zustand';
import { asRole, type Role } from '@/terminal-kit';

export const METHODS: [string, string][] = [
  ['credit_card', 'Credit card'],
  ['paypal', 'PayPal'],
];
export const PRESETS = [100, 500, 1000];

export interface PaymentDraft {
  amount: number;
  orderId: string | null;
  purchaseReference: string;
  owner: string;
  idempotencyKey: string;
  method?: string;
  busy?: boolean;
  submitted?: boolean;
  requestId?: string;
}

interface PaymentState {
  draft: PaymentDraft | null;
  setDraft: (draft: PaymentDraft | null) => void;
  update: (partial: Partial<PaymentDraft>) => void;
}
export const usePaymentStore = create<PaymentState>((set, get) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  update: (partial) => set({ draft: get().draft ? { ...get().draft!, ...partial } : null }),
}));

/** Identity of the signed-in, onboarded account (role and demo scope included). */
export function paymentIdentity(
  user: SessionUser | null,
  workspaceRole: Role,
  workspaceIdentityId: string | undefined,
  demo = false,
): string {
  return user?.id && workspaceIdentityId === user.id
    ? JSON.stringify([user.id, workspaceRole, asRole(user.role), !!user.demo || demo])
    : '';
}

export const ownRequests = (requests: CreditTopup[], userId: string | undefined): CreditTopup[] =>
  requests.filter((row) => row?.accountId === userId);
export const requestFor = (requests: CreditTopup[], id: string | undefined) =>
  requests.find((row) => row.id === id);
export const hasPendingTopup = (requests: CreditTopup[]) =>
  requests.some((request) => request.status === 'Pending');
export const canReturn = (request: CreditTopup | undefined, purchaseReference: string): boolean =>
  request?.status === 'Approved' &&
  !!request.purchaseReference &&
  request.purchaseReference === purchaseReference;

/** Amount rules: $1–$100,000 with at most two decimals. */
export const validAmount = (amount: number) =>
  Number.isFinite(amount) &&
  amount >= 1 &&
  amount <= 100000 &&
  Math.abs(amount * 100 - Math.round(amount * 100)) <= 0.000001;

export function safeCheckoutUrl(value: unknown): string {
  const url = new URL(String(value));
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Invalid payment checkout URL.');
  return url.href;
}

export function validRequest(
  request: CreditTopup | undefined,
  draft: PaymentDraft,
  userId: string | undefined,
): request is CreditTopup {
  return Boolean(
    request &&
      typeof request.id === 'string' &&
      /^TOPUP-[a-f0-9-]{36}$/.test(request.id) &&
      request.accountId === userId &&
      request.amount === draft.amount &&
      request.amountCents === Math.round(draft.amount * 100) &&
      request.method === draft.method &&
      ['Pending', 'Approved', 'Rejected'].includes(request.status) &&
      (request.purchaseReference || '') === (draft.purchaseReference || ''),
  );
}
