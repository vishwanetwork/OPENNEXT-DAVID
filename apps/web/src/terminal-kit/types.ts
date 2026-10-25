import type { SessionUser } from '@opennext/contracts';

/** The one role model of the terminal: the verified account role as the backend reports it. */
export type Role = 'buyer' | 'seller';
export const ROLES: readonly Role[] = ['buyer', 'seller'];
export const asRole = (value: unknown): Role =>
  String(value ?? '').toLowerCase() === 'seller' ? 'seller' : 'buyer';
export const roleLabel = (role: Role): 'Buyer' | 'Seller' =>
  role === 'seller' ? 'Seller' : 'Buyer';
export const roleOf = (user: Pick<SessionUser, 'role'> | null | undefined): Role =>
  asRole(user?.role);

export interface Identity {
  name: string;
  email: string;
  id?: string;
  company?: string;
  preferences?: { quotes?: boolean; delivery?: boolean; market?: boolean; zone?: string };
}

export interface AgentMessage {
  role: 'user' | 'assistant';
  text: string;
}

export type Intent = 'buy' | 'offer';

export interface ListingIntent {
  id: string;
  intent: Intent;
}

/** Prefill accepted by the RFQ form (collected price records, catalog items, opportunities…). */
export interface RfqPrefill {
  kind?: string;
  id?: string;
  title?: string;
  model?: string;
  region?: string;
  count?: number | string;
  term?: string;
  hours?: number | string;
  budget?: number | string;
  priceKind?: string;
  originListingId?: string;
  offerId?: string;
  notes?: string;
  project?: string;
  condition?: string;
  months?: number;
  sku?: string;
  [extra: string]: unknown;
}

/** A buyer requirement a seller is about to respond to (legacy `activeRequirement`). */
export interface RequirementDraft extends RfqPrefill {
  id: string;
  model: string;
  count: number;
  region: string;
  term: string;
  hours: number;
  budget: number;
}

/** What to open once the supplier review (KYB) is approved. */
export type AfterReview = 'supply-form' | { type: 'respond'; requirement: RequirementDraft } | null;
